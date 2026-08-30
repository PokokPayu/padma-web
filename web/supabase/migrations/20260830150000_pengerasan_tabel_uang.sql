-- ============================================================================
-- PENGERASAN TABEL UANG — integritas & jejak audit, bukan kerahasiaan
-- ============================================================================
-- Temuan red team (30 Agu 2026), direproduksi sebagai OWNER sungguhan lewat
-- PostgREST (anon key + JWT owner@padma.test) — bukan dibaca dari policy.
-- Baseline saat itu, dan itulah seluruh masalahnya:
--
--   select conname, contype from pg_constraint
--    where conrelid in ('service_rates'::regclass,'honor_marks'::regclass);
--   -- honor_marks_ditandai_oleh_fkey        | f
--   -- honor_marks_partner_id_fkey           | f
--   -- honor_marks_partner_id_week_start_key | u
--   -- honor_marks_pkey                      | p
--   -- service_rates_pkey                    | p
--   -- service_rates_service_id_fkey         | f
--   (6 rows)  -- NOL check, NOL unique(service_id,berlaku_sejak)
--   select tgname from pg_trigger where tgrelid='service_rates'::regclass
--     and not tgisinternal;  -- (0 rows)
--
-- Seluruh doktrin uang PADMA — "rate card INSERT-only, tarif lama TIDAK PERNAH
-- diubah" (spec bagian 5), "ditandai_oleh & dibayar_pada tidak pernah dari
-- payload", "week_start selalu Senin" — hidup HANYA di TypeScript
-- (src/app/owner/tarif/aksi.ts, src/app/owner/rekap/aksi.ts). Owner memegang
-- peran SQL `authenticated` yang sama seperti setiap pemegang JWT lain, dan
-- REST /rest/v1/... selalu terbuka baginya: memanggilnya langsung MELEWATI
-- seluruh validator itu. Sembilan operasi berikut semuanya HTTP 200/201:
--
--   POST   service_rates {berlaku_sejak:'2020-01-01', harga:999999}    -> 201
--   POST   service_rates {harga_klien:-500000, honor_mitra:-250000}    -> 201
--   POST   service_rates {harga_klien:100000,  honor_mitra:900000}     -> 201
--   POST   service_rates {(service_id,berlaku_sejak) kembar dgn seed}  -> 201
--   PATCH  service_rates?id=eq.<baris seed lama> {harga:1,honor:1}     -> 200
--   PATCH  service_rates?honor_mitra=gt.0 {honor_mitra:7}              -> 204
--                                          (13 baris tertimpa, SATU request)
--   POST   honor_marks {week_start:'2026-08-26' (RABU)}                -> 201
--   POST   honor_marks {ditandai_oleh:<uid ADMIN>, dibayar_pada:'1999-01-01'}
--                                                                      -> 201
--   PATCH  honor_marks?id=eq.<tanda lama> {dibayar_pada:'1999-01-01'}  -> 200
--
-- Dan 1298 test tetap hijau di atas tabel telanjang itu, karena tidak ada satu
-- pun yang menjaganya. Pengeras di berkas ini datang bersama
-- tests/owner-pengerasan.test.ts yang menembak REST langsung — bukan lewat
-- server action — sehingga pagar TypeScript tidak pernah bisa membuatnya hijau
-- palsu.
--
-- ===== APA YANG SEBENARNYA JEBOL, DAN APA YANG TIDAK =====
-- Yang JEBOL adalah INTEGRITAS dan JEJAK AUDIT uang:
--   (a) menimpa baris tarif lama menulis ulang riwayat harga, sehingga rekap
--       pekan yang honornya SUDAH dibayarkan ikut bergeser. Terukur: sesi
--       selesai yang sudah ditandai dibayar bergerak dari honor 100.000 /
--       margin 150.000 menjadi honor 999.000 / margin -699.000 hanya karena
--       satu tarif retroaktif disisipkan.
--   (b) `ditandai_oleh` palsu membuat owner menandai honor ATAS NAMA ADMIN
--       bertanggal 1999. Karena hak DELETE atas `honor_marks` sudah (benar)
--       dicabut migration `cabut_hak_hapus_berlebih`, catatan otorisasi
--       pembayaran palsu itu PERMANEN — non-repudiation runtuh. Bukti yang
--       bisa ditulis ulang bukan bukti.
-- Yang TIDAK jebol: money firewall (kerahasiaan nominal terhadap admin &
-- klien) terbukti rapat di lapisan RLS maupun render, dan berkas ini tidak
-- menggeser satu policy pun. Verba DELETE tetap tercabut.
--
-- ===== KENAPA TRIGGER, BUKAN `revoke update` =====
-- Saran auditor berbunyi: "cabut verba UPDATE `service_rates` & `honor_marks`
-- dari `authenticated`; rate card INSERT-only tidak butuh UPDATE sama sekali."
-- Premisnya benar, kesimpulannya SENGAJA TIDAK DIJALANKAN, dan alasannya sudah
-- terpasang permanen di repo ini sebagai bantahan berbukti:
--
--   1. Owner, admin, dan klien login sebagai peran SQL yang SAMA
--      (`authenticated`). Pencabutan hak tabel tidak bisa membedakan mereka.
--      tests/hak-hapus-berlebih.test.ts menjalankan probe sungguhan di dalam
--      transaksi yang di-rollback — `revoke all on public.service_rates from
--      authenticated` lalu `set local role authenticated` -> "permission denied
--      for table service_rates" — dan berkas yang sama mengunci peta hak
--      non-DELETE tabel uang sebagai assertion. Menyentuh verbanya berarti
--      merah di sana, dan itu memang sinyal yang diinginkan.
--   2. Pelajaran `kunci_kolom_penautan_klien` (20260828235000) dan
--      `kunci_kolom_identitas` (20260830140000), keduanya sudah dibayar:
--      hak KOLOM/VERBA mengikat KEHADIRAN kolom di payload; TRIGGER mengikat
--      PERUBAHAN NILAI. Pada `app_settings` pencabutan verba itu justru
--      mematikan jalur simpan yang sah, karena upsert PostgREST menerbitkan
--      `on conflict do update set ...` dan menuntut hak UPDATE meski nilainya
--      tidak berubah.
--   3. Efeknya sama tanpa risiko itu. Sesudah berkas ini, TIDAK ADA satu pun
--      payload UPDATE yang bisa mengubah satu kolom pun dari kedua tabel lewat
--      peran API — verbanya tinggal ada, kemampuannya nol. Jalur sah tidak
--      memakainya: tarif = INSERT baris baru, tanda bayar = upsert
--      `ignoreDuplicates` yang diterjemahkan menjadi `ON CONFLICT DO NOTHING`
--      dan hanya menuntut hak INSERT.
--
-- Cap waktu ditulis MANUAL dan lebih besar dari berkas terakhir
-- (20260830140000): `supabase migration new` memakai jam dinding dan sudah
-- pernah menyelipkan migration ke tengah riwayat sehingga `db reset` gagal.
--
-- ===== DATA SEED DIPERIKSA LEBIH DULU =====
--   select count(*) from service_rates where honor_mitra > harga_klien;   -- 0
--   select count(*) from service_rates where harga_klien < 0
--                                         or honor_mitra < 0;             -- 0
--   select service_id, berlaku_sejak, count(*) from service_rates
--    group by 1,2 having count(*) > 1;                                    -- 0 baris
--   select count(*) from honor_marks
--    where extract(isodow from week_start) <> 1;                          -- 0
-- Sepuluh baris seed (250000/100000 … 450000/200000) lolos keempat pemeriksa;
-- tidak ada satu pun constraint yang perlu dilonggarkan untuk memasangnya.

-- ---------------------------------------------------------------------------
-- (1) TARIF KEMBAR — pemilihan "berlaku_sejak terbesar" harus deterministik
-- ---------------------------------------------------------------------------
-- `service_rates` tidak punya `created_at` pemecah seri, jadi dua baris dengan
-- (service_id, berlaku_sejak) yang sama membuat `tarifPadaTanggal()` memilih
-- salah satunya secara sewenang-wenang: honor yang dibayarkan bergantung pada
-- urutan baris yang dikembalikan Postgres hari itu.
alter table public.service_rates
  add constraint service_rates_unik_per_tanggal unique (service_id, berlaku_sejak);

-- ---------------------------------------------------------------------------
-- (2) ANGKA MUSTAHIL
-- ---------------------------------------------------------------------------
-- Batasnya `<=`, bukan `<`: layanan bermargin NOL adalah keputusan bisnis yang
-- sah (mis. layanan sosial), sedangkan honor yang MELEBIHI harga berarti PADMA
-- membayar mitra lebih banyak daripada yang diterimanya dari klien — rekap
-- menampilkannya sebagai margin negatif tanpa satu pun peringatan.
alter table public.service_rates
  add constraint service_rates_nilai_wajar
  check (harga_klien >= 0 and honor_mitra >= 0 and honor_mitra <= harga_klien);

-- ---------------------------------------------------------------------------
-- (3) week_start WAJIB SENIN
-- ---------------------------------------------------------------------------
-- Bucket rekap SELALU berkunci pada Senin (`awalPekan` di src/lib/owner/pekan.ts).
-- Tanda bertanggal Rabu tidak akan pernah cocok dengan bucket mana pun: honor
-- mitra terlihat "belum dibayar" selamanya sementara uangnya sudah ditransfer,
-- dan tandanya TIDAK BISA DIBERSIHKAN karena DELETE sudah dicabut (owner pun
-- dijawab 42501). Ia juga melemahkan `unique (partner_id, week_start)`: pekan
-- yang sama bisa ditandai tujuh kali dengan tujuh tanggal berbeda.
--
-- CHECK, bukan trigger bergerbang peran: bentuk `week_start` bukan soal
-- KEWENANGAN melainkan soal data yang tidak punya arti. Tanda yatim yang
-- disemai service role sama yatimnya. `extract(isodow) = 1` berarti Senin.
alter table public.honor_marks
  add constraint honor_marks_awal_pekan_senin
  check (extract(isodow from week_start) = 1);

-- ---------------------------------------------------------------------------
-- (4) TARIF RETROAKTIF — efeknya SAMA PERSIS dengan menimpa baris lama
-- ---------------------------------------------------------------------------
-- "INSERT baris baru, jangan UPDATE" saja tidak cukup. Menyisipkan baris
-- ber-`berlaku_sejak` 2020 menggeser tarif yang berlaku pada tanggal sesi
-- pekan-pekan yang sudah lewat — termasuk pekan yang honornya sudah
-- dibayarkan. Spec bagian 5 menuntut rekap pekan lama tidak berubah.
--
-- BUKAN `security definer`: `current_user` harus tetap peran PEMANGGIL, karena
-- justru itu yang membedakan jalur sah dari jalur terlarang.
--   - PostgREST menjalankan request sebagai `anon`/`authenticated`
--     (koneksinya sendiri `authenticator`) -> DIJAGA, owner sekalipun;
--   - seed.sql, migration, psql, dan seluruh fixture `beforeAll`/`afterAll`
--     suite test jalan sebagai `postgres`/`service_role` -> DILEWATKAN. Tanpa
--     gerbang itu, `supabase/seed.sql` dan tests/owner-tarif.test.ts (yang
--     menyemai `berlaku_sejak = '2020-01-06'` justru agar hasilnya tidak
--     bergantung pada tanggal `db reset`) mati seketika.
create or replace function public.guard_tarif_maju()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  terakhir date;
begin
  if current_user not in ('anon', 'authenticated', 'authenticator') then
    return new;
  end if;

  -- Pada UPDATE, baris itu sendiri tidak boleh menjadi pembanding dirinya.
  select max(berlaku_sejak) into terakhir
    from public.service_rates
   where service_id = new.service_id
     and (tg_op = 'INSERT' or id <> new.id);

  if terakhir is not null and new.berlaku_sejak <= terakhir then
    raise exception
      'tarif baru harus berlaku sesudah % — rekap pekan lama tidak boleh berubah', terakhir
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_tarif_maju() is
  'Menolak service_rates ber-berlaku_sejak <= tarif terakhir layanan yang sama, '
  'dari peran API (anon, authenticated, authenticator) — owner sekalipun. '
  'Tarif retroaktif berefek SAMA PERSIS dengan menimpa baris lama: rekap pekan '
  'yang honornya sudah dibayarkan ikut bergeser, melanggar spec bagian 5. '
  'Service role sengaja dilewatkan: seed & fixture test menyemai tanggal lampau.';

-- Aturan [F] migration `fail_closed_sequence_fungsi`: hak fungsi baru
-- dinyatakan EKSPLISIT. Fungsi trigger tetap menyala tanpa EXECUTE (Postgres
-- memeriksa haknya saat CREATE TRIGGER, bukan saat trigger berjalan).
revoke all on function public.guard_tarif_maju() from public, anon, authenticated;

drop trigger if exists trg_guard_tarif_maju on public.service_rates;
create trigger trg_guard_tarif_maju
  before insert or update on public.service_rates
  for each row execute function public.guard_tarif_maju();

-- ---------------------------------------------------------------------------
-- (5) BARIS TARIF LAMA TIDAK BISA DITULIS ULANG DI TEMPAT
-- ---------------------------------------------------------------------------
-- Yang (4) jaga adalah TANGGAL; yang bocor di temuan A5/A6 adalah NOMINAL.
--   PATCH service_rates?id=eq.<seed> {harga_klien:1,honor_mitra:1} -> 200
--   PATCH service_rates?honor_mitra=gt.0 {honor_mitra:7} -> 204, 13 baris
-- Rekap pekan lama bergeser TANPA satu pun insert, jadi trigger tarif-maju
-- tidak menyentuhnya. Perhatikan bentuk yang kedua: filter pada URL adalah
-- PILIHAN PEMANGGIL, bukan pembatas baris — pelajaran yang sudah dibayar sekali
-- di `material_chapters?urutan=gte.0` (lihat batas_radius_hapus_isi_materi).
-- Satu permintaan menimpa SELURUH rate card klinik.
--
-- Tabel ini APPEND-ONLY menurut spec: "Edit rate card = insert baris baru,
-- tidak update baris lama". Karena itu yang dibekukan bukan sebagian kolom
-- melainkan setiap kolom yang punya arti — dan `is distinct from` tidak dipakai
-- di sini (berbeda dari `jaga_identitas_setelan`, yang harus meloloskan payload
-- upsert bernilai sama): tidak ada satu pun alur produk yang mengirim UPDATE ke
-- tabel ini, jadi tidak ada payload sah yang bisa ikut mati. Diverifikasi:
-- grep `.update(` atas `service_rates` di src/ -> nol hasil, dan
-- tests/owner-tarif.test.ts sudah meng-assert-nya sebagai invarian modul.
create or replace function public.kunci_riwayat_tarif()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    raise exception
      'rate card bersifat append-only: tetapkan tarif baru sebagai BARIS BARU, jangan menimpa yang lama'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.kunci_riwayat_tarif() is
  'Menolak SETIAP UPDATE service_rates dari peran API (anon, authenticated, '
  'authenticator) — owner sekalipun. Menimpa baris tarif lama menulis ulang '
  'riwayat harga, sehingga rekap pekan yang honornya SUDAH dibayarkan ikut '
  'bergeser; satu PATCH berfilter ?honor_mitra=gt.0 terbukti menimpa seluruh '
  'rate card klinik. Verba UPDATE sengaja TIDAK dicabut dari authenticated '
  '(owner login sebagai peran itu, lihat tests/hak-hapus-berlebih.test.ts); '
  'yang dimatikan kemampuannya, bukan haknya. Service role tetap bebas sebagai '
  'jalur pemulihan data.';

revoke all on function public.kunci_riwayat_tarif() from public, anon, authenticated;

drop trigger if exists trg_kunci_riwayat_tarif on public.service_rates;
create trigger trg_kunci_riwayat_tarif
  before update on public.service_rates
  for each row execute function public.kunci_riwayat_tarif();

comment on table public.service_rates is
  'RIWAYAT tarif per layanan — bukan satu baris harga yang ditimpa. '
  'APPEND-ONLY untuk peran API: INSERT hanya dengan berlaku_sejak yang MAJU '
  '(trigger trg_guard_tarif_maju), UPDATE ditolak seluruhnya (trigger '
  'trg_kunci_riwayat_tarif), DELETE sudah dicabut (cabut_hak_hapus_berlebih). '
  'Alasannya satu: tarif lama adalah dasar honor yang sudah terlanjur '
  'dibayarkan, dan rekap membacanya menurut tanggal sesi. Koreksi data hanya '
  'lewat service role.';

-- ---------------------------------------------------------------------------
-- (6) TANDA BAYAR — identitas & stempel waktu DIREBUT dari payload
-- ---------------------------------------------------------------------------
-- Temuan B1: owner menandai honor ATAS NAMA ADMIN bertanggal 1999, dan
-- tandanya tidak bisa dihapus lagi. Server action sudah menulis
-- `ditandai_oleh: userId` dari sesi dan membiarkan `dibayar_pada` jatuh ke
-- `default now()` — tetapi REST melewati action itu seluruhnya, jadi jaminannya
-- harus lahir di basis data.
--
-- `auth.uid()` membaca klaim JWT permintaan yang sedang berjalan; di bawah
-- service role ia null, dan karena itu gerbang perannya harus tetap ada —
-- memaksa ditandai_oleh := null pada jalur seed justru menghapus informasi.
--
-- Pekan yang BELUM berjalan ikut ditutup di sini (temuan B3: week_start
-- 2027-06-07 tanpa satu pun sesi -> 201). Menandai pekan depan berarti
-- menyatakan honor yang belum dikerjakan sudah dibayarkan, dan karena tandanya
-- tidak bisa dicabut, kekeliruan itu permanen. Aturannya disamakan PERSIS
-- dengan `periksaPekan` di src/app/owner/rekap/status.ts — pekan BERJALAN tetap
-- boleh ditandai, karena gajian PADMA jatuh Sabtu di dalam pekannya sendiri.
-- Perbandingannya memakai kalender JAKARTA, bukan `current_date` (UTC): setiap
-- Senin pukul 00:00–07:00 WIB, `current_date` masih Minggu dan pekan berjalan
-- akan terbaca sebagai pekan depan. Itu sebabnya ia trigger dan bukan CHECK —
-- `now()` bersifat STABLE dan tidak boleh muncul di CHECK.
create or replace function public.jaga_tanda_honor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated', 'authenticator') then
    return new;
  end if;

  if new.week_start > (now() at time zone 'Asia/Jakarta')::date then
    raise exception
      'pekan % belum berjalan — honornya belum bisa ditandai dibayar, dan tanda bayar tidak bisa dibatalkan', new.week_start
      using errcode = '42501';
  end if;

  new.ditandai_oleh := auth.uid();
  new.dibayar_pada  := now();
  return new;
end;
$$;

comment on function public.jaga_tanda_honor() is
  'BEFORE INSERT honor_marks untuk peran API: merebut ditandai_oleh & '
  'dibayar_pada dari payload (keduanya terbukti bisa dipalsukan — owner '
  'menandai honor atas nama ADMIN bertanggal 1999, secara PERMANEN karena '
  'DELETE sudah dicabut) dan menolak pekan yang belum berjalan. Batas pekannya '
  'memakai kalender Asia/Jakarta, sama persis dengan periksaPekan() di '
  'src/app/owner/rekap/status.ts. Service role dilewatkan: jalur seed & '
  'pemindahan riwayat pembayaran lama harus tetap bisa menentukan keduanya.';

revoke all on function public.jaga_tanda_honor() from public, anon, authenticated;

drop trigger if exists trg_jaga_tanda_honor on public.honor_marks;
create trigger trg_jaga_tanda_honor
  before insert on public.honor_marks
  for each row execute function public.jaga_tanda_honor();

-- ---------------------------------------------------------------------------
-- (7) TANDA BAYAR — bukti tidak bisa ditulis ulang di tempat
-- ---------------------------------------------------------------------------
-- Temuan B5b: PATCH honor_marks?id=eq.<tanda lama> {dibayar_pada:'1999-01-01',
-- ditandai_oleh:<uid ADMIN>} -> HTTP 200. Merebut kolom pada INSERT (6) tidak
-- ada gunanya bila baris yang sudah berdiri masih bisa ditimpa sesudahnya.
--
-- Sama seperti (5), yang dibekukan adalah SELURUH baris: `honor_marks` adalah
-- catatan append-only berisi satu fakta — "mitra X sudah dibayar untuk pekan
-- Y". Tidak ada kolom yang pantas berubah sesudah faktanya terjadi. Jalur sah
-- menandai ulang memakai upsert `ignoreDuplicates` = `ON CONFLICT DO NOTHING`,
-- yang tidak pernah menyentuh baris lama dan tidak menuntut hak UPDATE.
create or replace function public.kunci_tanda_honor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    raise exception
      'tanda bayar honor adalah bukti dan tidak bisa diubah; tidak ada jalur pembatalan'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.kunci_tanda_honor() is
  'Menolak SETIAP UPDATE honor_marks dari peran API (anon, authenticated, '
  'authenticator) — owner sekalipun. Tanda bayar adalah BUKTI bahwa seorang '
  'mitra sudah menerima uangnya; bukti yang bisa ditulis ulang bukan bukti, '
  'dan DELETE-nya memang sudah dicabut. Menandai ulang tetap idempoten lewat '
  'ON CONFLICT DO NOTHING, yang tidak menyentuh baris lama.';

revoke all on function public.kunci_tanda_honor() from public, anon, authenticated;

drop trigger if exists trg_kunci_tanda_honor on public.honor_marks;
create trigger trg_kunci_tanda_honor
  before update on public.honor_marks
  for each row execute function public.kunci_tanda_honor();

comment on table public.honor_marks is
  'BUKTI bahwa seorang mitra sudah dibayar untuk satu pekan (unik per '
  'partner_id, week_start). APPEND-ONLY untuk peran API: week_start wajib '
  'Senin (CHECK honor_marks_awal_pekan_senin, berlaku untuk SEMUA peran karena '
  'tanda yatim tidak punya arti bagi siapa pun), ditandai_oleh & dibayar_pada '
  'direbut dari payload (trigger trg_jaga_tanda_honor), UPDATE ditolak '
  'seluruhnya (trigger trg_kunci_tanda_honor), DELETE sudah dicabut '
  '(cabut_hak_hapus_berlebih). Pembatalan yang sah adalah fakta baru — sebuah '
  'kolom pembatalan berjejak — bukan penghapusan atau penulisan ulang fakta lama.';

comment on column public.honor_marks.ditandai_oleh is
  'Pengguna yang menandai honor ini dibayar. TIDAK PERNAH dari payload: '
  'trigger trg_jaga_tanda_honor memaksanya menjadi auth.uid() untuk peran API. '
  'Terbukti bisa dipalsukan sebelum pagar itu ada — owner menandai honor atas '
  'nama admin — dan karena DELETE sudah dicabut, pemalsuannya permanen.';
