-- ============================================================================
-- KUNCI KOLOM IDENTITAS — pencabutan DELETE menjaga VERBA, bukan EFEK
-- ============================================================================
-- Temuan red team (29 Agu 2026), direproduksi sebagai admin sungguhan lewat
-- PostgREST dengan anon key + JWT admin — bukan dibaca dari policy:
--
--   [1] klinik menyetel nomornya lewat jalur sah:
--       PATCH /rest/v1/app_settings?key=eq.nomor_wa  {"value":"628111222333"}
--       -> CTA landing: https://wa.me/628111222333
--
--   [2] admin mencoba DELETE — pagar migration `cabut_hak_hapus_berlebih`
--       (20260829190000) BEKERJA:
--       DELETE /rest/v1/app_settings?key=eq.nomor_wa
--       -> HTTP 403 {"code":"42501","message":"permission denied for table app_settings"}
--
--   [2b] admin mem-PATCH KOLOM KUNCI — pagar yang sama TIDAK bekerja:
--       PATCH /rest/v1/app_settings?key=eq.nomor_wa  {"key":"alamat_klinik"}
--       -> HTTP 200 [{"key":"alamat_klinik","value":"628111222333"}]
--       isi tabel -> [{"key":"alamat_klinik", ...}]   # baris nomor_wa LENYAP
--
--   [3] CTA landing SESUDAHNYA -> https://wa.me/6287778400200, yaitu
--       NOMOR_WA_BAWAAN yang ditulis keras di src/lib/pengaturan/bentuk.ts —
--       bukan nomor yang disetel klinik. Tanpa error, tanpa test merah.
--
-- ===== KENAPA INI TETAP TEMUAN MESKI PELAKUNYA HARUS SUDAH ADMIN =====
-- Ini bukan eskalasi hak. Yang jebol adalah PAGAR YANG SENGAJA DIPASANG:
-- migration 20260829190000 menuliskan invariannya sendiri —
--   "`app_settings`: ... satu-satunya kuncinya hari ini (`nomor_wa`)
--    menggerakkan SELURUH CTA WhatsApp ... Menghapusnya mematikan CTA itu
--    diam-diam. Tidak ada alur produk yang pernah menghapus setelan."
-- — lalu menegakkannya dengan satu `revoke delete`. Pencabutan itu menjaga
-- VERBA; yang dijanjikan invariannya adalah EFEK. Baris `nomor_wa` yang lenyap
-- lewat PATCH punya akibat yang PERSIS SAMA dengan DELETE yang sudah dicabut,
-- jadi pagarnya cukup dilangkahi lewat pintu sebelah. Pola "penjaga memeriksa
-- verba, bukan efek" ini sudah beberapa kali dibayar mahal di repo ini
-- (materials vs material_chapters?urutan=gte.0; money firewall vs kolom vs
-- BARIS di app_settings).
--
-- ===== KENAPA TRIGGER, BUKAN HAK KOLOM =====
-- Saran auditor berbunyi:
--     revoke update on public.app_settings from authenticated;
--     grant  update (value) on public.app_settings to authenticated;
-- dengan premis "`simpanSetelan` tetap bekerja apa adanya — ia hanya menulis
-- `value` pada upsert dengan onConflict: 'key'".
--
-- PREMIS ITU SALAH, dan itu diukur sebelum ditolak — hak kolomnya dipasang
-- hidup di basis data lokal, lalu jalur sahnya ditembak lewat REST sebagai
-- admin sungguhan:
--     UPSERT  {"key":"nomor_wa","value":...} -> 42501 permission denied   <-- MATI
--     UPDATE  {"value":...}                  -> 200 [{"key":"nomor_wa"}]
--     UPDATE  {"key":"alamat_klinik"}        -> 42501                     <-- tertutup
-- Sebabnya: upsert PostgREST menerbitkan
--     insert into app_settings (key, value) values (...)
--       on conflict (key) do update set key = excluded.key, value = excluded.value
-- dan cabang DO UPDATE menuntut hak UPDATE pada kolom `key` MESKIPUN nilainya
-- tidak berubah. Jadi saran itu menutup celahnya sekaligus mematikan
-- satu-satunya jalur simpan panel /admin/pengaturan.
--
-- Penggantinya adalah pola yang sudah dipakai dua kali di repo ini dan sudah
-- ditulis alasannya di migration `kunci_kolom_penautan_klien` (20260828235000)
-- bagian "KENAPA TRIGGER, BUKAN HAK KOLOM": hak KOLOM mengikat KEHADIRAN kolom
-- di payload; TRIGGER mengikat PERUBAHAN NILAI. Payload baris utuh dengan
-- `key` bernilai sama — yaitu persis yang diterbitkan upsert — tetap lolos.
--
-- Cap waktu ditulis MANUAL dan lebih besar dari berkas terakhir
-- (20260830130000): `supabase migration new` memakai jam dinding dan sudah
-- pernah menyelipkan migration ke tengah riwayat sehingga `db reset` gagal.

-- ---------------------------------------------------------------------------
-- (1) app_settings.key — identitas MENURUT MAKNA
-- ---------------------------------------------------------------------------
-- Yang membedakan `app_settings` dari master data lain: kuncinya bukan surrogate
-- id, melainkan nama yang DICARI KODE DENGAN LITERAL (`eq("key","nomor_wa")` di
-- src/lib/settings.ts & src/lib/admin/pengaturan.ts). Memindahkan kuncinya sama
-- artinya dengan menghapus barisnya, karena tidak ada lagi baris yang menjawab
-- pencarian itu — dan `nomorWaTerpakai()` menutupinya dengan nomor bawaan,
-- sehingga kegagalannya SENYAP di semua kanal sekaligus.
--
-- BUKAN `security definer`: `current_user` harus tetap peran PEMANGGIL, karena
-- justru itu yang membedakan jalur sah dari jalur terlarang.
--   - PostgREST menjalankan request sebagai `anon`/`authenticated`
--     (koneksinya sendiri `authenticator`) → DITOLAK, admin & owner sekalipun;
--   - seed, migration, psql, dan pembersihan `afterAll` suite test jalan
--     sebagai `postgres`/`service_role` → DIIZINKAN. Itulah jalan keluar yang
--     sama seperti pada `revoke delete`, dan itulah yang membuat pagar ini
--     tidak melumpuhkan suite-nya sendiri.
create or replace function public.jaga_identitas_setelan()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- `is distinct from` sengaja dipakai: yang diikat adalah PERUBAHAN nilai,
  -- bukan kehadiran kolom `key` di payload. Upsert PostgREST selalu menyertakan
  -- `set key = excluded.key` dengan nilai yang SAMA, dan payload itu harus tetap
  -- lolos — kalau tidak, panel pengaturan mati seperti pada varian hak kolom.
  if current_user in ('anon', 'authenticated', 'authenticator')
     and new.key is distinct from old.key then
    raise exception
      'kunci setelan tidak boleh dipindahkan; ubah `value`, bukan `key`'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.jaga_identitas_setelan() is
  'Menolak perubahan app_settings.key dari peran API (anon, authenticated, '
  'authenticator) — admin & owner sekalipun. Memindahkan kunci membuat baris '
  'lama LENYAP dari pencarian literal kode (mis. eq("key","nomor_wa")), yaitu '
  'efek yang sama persis dengan DELETE yang sudah dicabut migration '
  'cabut_hak_hapus_berlebih. Kunci baru lahir lewat INSERT yang sudah dijaga '
  'FK app_settings_key_terdaftar.';

-- Aturan [F] migration `fail_closed_sequence_fungsi`: hak fungsi baru
-- dinyatakan EKSPLISIT. Fungsi trigger tetap menyala tanpa EXECUTE (Postgres
-- memeriksa haknya saat CREATE TRIGGER, bukan saat trigger berjalan) — sudah
-- diprobe saat `guard_client_link` ditulis.
revoke all on function public.jaga_identitas_setelan() from public, anon, authenticated;

drop trigger if exists trg_jaga_identitas_setelan on public.app_settings;
create trigger trg_jaga_identitas_setelan
  before update on public.app_settings
  for each row execute function public.jaga_identitas_setelan();

comment on column public.app_settings.key is
  'Nama setelan; dicari kode dengan LITERAL (eq("key","nomor_wa")), jadi ia '
  'identitas menurut makna, bukan sekadar primary key. TIDAK boleh dipindahkan '
  'lewat peran API — trigger trg_jaga_identitas_setelan menolaknya — karena '
  'baris yang berpindah kunci lenyap dari pencarian itu persis seperti baris '
  'yang dihapus, dan nomorWaTerpakai() menutupi hilangnya dengan nomor bawaan '
  'sehingga tidak ada satu pun error yang terbit. Kunci baru hanya lahir lewat '
  'INSERT, dan hanya yang terdaftar di app_setting_keys (FK).';

-- ---------------------------------------------------------------------------
-- (2) phases.id — taksonomi yang ditulis keras di produk
-- ---------------------------------------------------------------------------
-- Pola yang sama, tabel yang berbeda. Migration `cabut_hak_hapus_berlebih`
-- mencabut DELETE dari `phases` dengan alasan: "taksonomi lima fase yang
-- DITULIS KERAS di produk — enum `FaseSkrining`, bank soal skrining, dan glif
-- Sanskerta di landing semuanya memetakan id fase satu per satu. Menghapus satu
-- baris fase memutus pemetaan itu tanpa error apa pun di layar."
-- Alasan itu berlaku KATA PER KATA untuk penulisan ulang `id`:
-- `FASE_SKRINING_KE_PHASE` di src/app/admin/skrining/status.ts memetakan
-- 'prekonsepsi'/'kehamilan'/'nifas'/'menopause' ke `phases.id` dengan literal,
-- dan `phaseIdDariFaseSkrining()` mengembalikan null begitu id-nya tidak ada
-- lagi — skrining tidak bisa lagi dikonversi menjadi klien.
--
-- KEJUJURAN TENTANG BATASNYA: hari ini percobaan itu KEBETULAN sudah tertahan
-- foreign key `services_phase_id_fkey` (23503), karena kelima fase seed dirujuk
-- setidaknya satu layanan — diverifikasi lewat REST sebagai admin, untuk
-- 'newborn' maupun 'prekonsepsi'. Tetapi itu perlindungan yang bergantung pada
-- ISI DATA, bukan invarian: fase yang belum digantungi layanan apa pun (mis.
-- fase baru yang lahir lewat migration berikutnya) tidak terlindungi sama
-- sekali. Trigger menjadikannya invarian, dan biayanya nol — tidak ada satu pun
-- alur produk yang menulis `phases` (grep `.from("phases")` di src/: seluruhnya
-- `.select`).
create or replace function public.jaga_identitas_fase()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator')
     and new.id is distinct from old.id then
    raise exception
      'id fase adalah taksonomi produk dan tidak boleh ditulis ulang lewat API'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.jaga_identitas_fase() is
  'Menolak perubahan phases.id dari peran API (anon, authenticated, '
  'authenticator). Id fase dipetakan literal di produk (FASE_SKRINING_KE_PHASE, '
  'enum FaseSkrining, glif Sanskerta landing); menulis ulangnya memutus '
  'pemetaan itu tanpa error di layar — efek yang sama dengan DELETE yang sudah '
  'dicabut. Kolom lain (nama, nama_sanskrit, urutan) tetap boleh disunting staf.';

revoke all on function public.jaga_identitas_fase() from public, anon, authenticated;

drop trigger if exists trg_jaga_identitas_fase on public.phases;
create trigger trg_jaga_identitas_fase
  before update on public.phases
  for each row execute function public.jaga_identitas_fase();

comment on column public.phases.id is
  'Id fase — taksonomi produk, bukan data operasional: dipetakan LITERAL oleh '
  'FASE_SKRINING_KE_PHASE (src/app/admin/skrining/status.ts) dan enum '
  'FaseSkrining. TIDAK boleh ditulis ulang lewat peran API (trigger '
  'trg_jaga_identitas_fase); DELETE-nya sudah dicabut migration '
  'cabut_hak_hapus_berlebih dengan alasan yang sama. Fase baru lahir lewat '
  'migration, bersama pemetaannya di kode.';

-- ---------------------------------------------------------------------------
-- (3) YANG SENGAJA TIDAK IKUT DIKUNCI — keputusan, bukan kelalaian
-- ---------------------------------------------------------------------------
-- Tabel lain yang DELETE-nya dicabut (materials, booking_requests, partners,
-- services, packages, service_rates, honor_marks) ber-primary key `uuid` dengan
-- `default gen_random_uuid()`, dan kode TIDAK PERNAH mencarinya dengan literal —
-- katalog, daftar admin, dan passport semuanya membaca himpunan baris lalu
-- menyusun daftarnya. Menulis ulang sebuah uuid di sana tidak MENGHILANGKAN
-- barisnya dari layar mana pun; ia hanya memberi nama lain pada baris yang tetap
-- terbaca. Itu bukan efek DELETE, jadi tidak dikunci di sini.
--
-- Yang justru menahan penulisan ulang uuid itu adalah foreign key anak-anaknya
-- (`sessions.service_id`, `material_chapters.material_id`, dst.) yang tidak
-- ber-`on update cascade` — 23503, bukan 42501. Pagar tambahan di sana akan
-- menjadi larangan tanpa temuan, dan larangan semacam itu selalu dilepas orang
-- berikutnya.
