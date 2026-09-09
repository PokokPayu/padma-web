-- ============================================================================
-- C3-a: PEMBATALAN, JADWAL ULANG, PENUKARAN HAK
-- ============================================================================
-- Ketiganya `security definer`, dan itu keputusan dengan dua alasan (spec C3 P5):
--
--  1. ATOMISITAS. Membatalkan di jenjang 2 adalah dua tulisan yang harus
--     berlaku sebagai satu keputusan: sesi menjadi batal, DAN haknya terbit.
--     Kegagalan di antaranya meninggalkan klien tanpa sesi dan tanpa gantinya.
--
--  2. PERMUKAAN TULIS. Policy UPDATE untuk klien atas `sessions` akan membuka
--     seluruh kolom baris itu — termasuk `status_bayar`, `partner_id`, dan
--     `jenjang`. Fungsi definer membuka TEPAT satu tindakan. Kepemilikan
--     diperiksa DI DALAM fungsi terhadap `auth.uid()`, tidak pernah
--     dipercayakan kepada pemanggil.

-- ---------------------------------------------------------------------------
-- `perpindahan_sesi_sah` DIBUKA UNTUK `dibatalkan_klien`
-- ---------------------------------------------------------------------------
-- Peta perpindahan (migration 20260909101000) ditulis SEBELUM nilai enum
-- `dibatalkan_klien` ada (migration 20260913100000), dan tidak seorang pun
-- kembali membukanya: 'terjadwal' hanya mengizinkan 'berjalan', 'selesai',
-- 'tidak_hadir', 'dibatalkan_padma'. Tanpa baris ini, `guard_sesi_perpindahan`
-- menolak SETIAP pembatalan oleh klien — bukan dengan pesan yang jelas,
-- melainkan sebagai galat yang tenggelam di balik RPC dan terlihat seperti
-- "sesi tidak ditemukan".
create or replace function public.perpindahan_sesi_sah(
  dari session_status,
  ke session_status
) returns boolean
language sql
immutable
as $$
  select case dari
    when 'terjadwal'        then ke in ('berjalan', 'selesai', 'tidak_hadir', 'dibatalkan_padma', 'dibatalkan_klien')
    when 'berjalan'         then ke in ('selesai', 'tidak_hadir')
    when 'selesai'          then false
    when 'tidak_hadir'      then false
    when 'dibatalkan_padma' then false
    when 'dibatalkan_klien' then false
  end;
$$;

revoke execute on function public.perpindahan_sesi_sah(session_status, session_status)
  from public, anon;

-- ---------------------------------------------------------------------------
-- Ambang jenjang, dalam SATU tempat di sisi SQL.
-- ---------------------------------------------------------------------------
-- Rumusnya kembar dengan `jenjangPembatalan()` di TypeScript, dan kembaran itu
-- disengaja & terbatas: TypeScript memakainya untuk MENAMPILKAN akibat sebelum
-- admin menekan, SQL memakainya untuk MEMUTUSKAN. Yang memutuskan tidak boleh
-- ada di lapisan yang bisa dilewati satu panggilan RPC. Pasangan yang sama
-- sudah ada untuk jarak (`jarak_km` vs `haversineKm`), dan dijaga uji
-- `tests/jarak-sql-vs-ts.test.ts`.
create or replace function public.jenjang_pembatalan(tanggal date, jam time)
returns smallint
language sql
-- `stable`, BUKAN `immutable`. Badannya membaca `now()`, dan Postgres
-- mempercayai label ini tanpa memeriksa isinya: fungsi `immutable` boleh
-- dilipat menjadi konstanta oleh perencana, dipakai di indeks fungsional, atau
-- dibekukan dalam rencana yang di-cache. Jenjang yang membeku adalah jenjang
-- yang berhenti mengikuti waktu — dan yang berhenti bersamanya adalah uang
-- klien.
stable
set search_path = public, pg_temp
as $$
  select case
    -- `at time zone 'Asia/Jakarta'` mengubah timestamp tanpa zona menjadi
    -- timestamptz yang benar. Menghitungnya dengan zona server (UTC di Vercel)
    -- menggeser batasnya tujuh jam, dan yang bergeser bersamanya adalah uang
    -- klien.
    when ((tanggal + jam) at time zone 'Asia/Jakarta') - now() >= interval '24 hours' then 1
    when ((tanggal + jam) at time zone 'Asia/Jakarta') - now() >= interval '2 hours'  then 2
    else 3
  end::smallint;
$$;

revoke execute on function public.jenjang_pembatalan(date, time) from public, anon;
grant execute on function public.jenjang_pembatalan(date, time) to authenticated;

-- ---------------------------------------------------------------------------
-- BATALKAN SESI
-- ---------------------------------------------------------------------------
-- AKTORNYA EKSPLISIT, TIDAK PERNAH DISIMPULKAN. Ini perbaikan atas versi
-- pertama fungsi ini, dan sebabnya layak ditulis panjang karena ia menyangkut
-- uang klien.
--
-- Versi pertama menentukan jenjang 4 dari `staf AND alasan tidak kosong AND
-- bukan darurat`. `alasan` adalah kotak teks biasa di panel — opsional, tanpa
-- satu isyarat pun bahwa mengetiknya mengubah hasil. Dua kegagalan uang yang
-- keduanya bisa dicapai dari satu-satunya layar yang hidup:
--
--   • Klien menelepon 6 jam sebelum sesi. Admin mengetik "klien minta batal"
--     di kolom alasan. Basis data mencatat jenjang 4, `dibatalkan_padma`,
--     refund penuh — padahal kebijakannya kredit 30 hari — dan jejaknya
--     menyebut PADMA yang membatalkan.
--   • Bidan sakit, admin membatalkan 1 jam sebelum sesi dan membiarkan alasan
--     kosong (memang opsional). Jatuh ke cabang waktu: jenjang 3, hangus,
--     `dibatalkan_klien`. Klien sudah membayar, PADMA yang berhalangan, klien
--     tidak menerima apa pun, dan catatannya menyalahkan klien.
--
-- Karena itu `oleh` kini ARGUMEN, dan tidak punya nilai bawaan: pemanggil
-- WAJIB menyatakan siapa yang membatalkan. Aturannya sesudah perbaikan:
--
--   oleh = 'padma'  → JENJANG 4, status `dibatalkan_padma` (refund penuh).
--                     Hanya staf. Alasan WAJIB.
--   oleh = 'klien'  → jenjang dari WAKTU, status `dibatalkan_klien`.
--                     Darurat medis (staf + alasan) menaikkannya ke jenjang 1.
--
-- KENAPA ALASAN WAJIB SAAT PADMA MEMBATALKAN — keputusan, bukan warisan.
-- Tiga sebab: (1) jenjang 4 adalah satu-satunya jenjang yang uangnya keluar
-- TANPA dituntut waktu, jadi ia butuh pembenaran yang bisa ditinjau
-- setelahnya, persis seperti pengecualian darurat; (2) ini cabang yang
-- SEBELUMNYA bisa terpicu tanpa sengaja, dan memaksa satu kalimat tertulis
-- membuatnya tindakan yang disengaja, bukan efek samping; (3) klinik perlu
-- tahu BERAPA SERING dan KENAPA ia sendiri membatalkan — angka yang tidak
-- pernah bisa dibaca dari baris tanpa alasan. Untuk `oleh = 'klien'` alasan
-- tetap OPSIONAL kecuali darurat: pembatalan klien adalah hak klien, dan
-- menuntut alasan tertulis untuk sesuatu yang tidak mengubah akibat apa pun
-- hanya melatih admin mengetik "batal" demi melewati pagar.
create or replace function public.batalkan_sesi(
  sesi_id uuid,
  alasan text,
  darurat boolean,
  oleh text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.sessions%rowtype;
  peran text := public.user_role();
  staf boolean := peran in ('admin', 'owner');
  jenjang smallint;
  akibat text;
  hak uuid;
  status_baru session_status;
begin
  if oleh is null or oleh not in ('klien', 'padma') then
    raise exception 'aktor pembatalan wajib disebut: klien atau padma'
      using errcode = '22023';
  end if;

  -- Diperiksa lebih dulu supaya penolakan tidak pernah menyentuh baris apa pun.
  if oleh = 'padma' then
    if not staf then
      raise exception 'hanya staf yang boleh membatalkan atas nama PADMA'
        using errcode = '42501';
    end if;
    if btrim(coalesce(alasan, '')) = '' then
      raise exception 'pembatalan oleh PADMA menuntut alasan tertulis'
        using errcode = '23514';
    end if;
    -- Darurat medis adalah pengecualian atas pembatalan KLIEN. Digabung dengan
    -- `oleh = 'padma'` ia tidak punya arti — jenjang 4 sudah refund penuh —
    -- dan menerimanya diam-diam berarti admin mengira ia menerapkan sesuatu
    -- yang sebenarnya diabaikan. Ditolak supaya pilihannya diperbaiki.
    if darurat then
      raise exception 'pengecualian darurat berlaku untuk pembatalan klien; PADMA yang membatalkan sudah jenjang 4'
        using errcode = '22023';
    end if;
  end if;

  -- Pengecualian tanpa catatan tidak bisa ditinjau siapa pun setelahnya.
  if darurat then
    if not staf then
      raise exception 'hanya staf yang boleh menerapkan pengecualian darurat'
        using errcode = '42501';
    end if;
    if btrim(coalesce(alasan, '')) = '' then
      raise exception 'pengecualian darurat menuntut alasan tertulis'
        using errcode = '23514';
    end if;
  end if;

  select * into s from public.sessions where id = sesi_id;
  if not found then
    return null;
  end if;

  -- Kepemilikan diperiksa DI SINI, bukan dipercayakan kepada pemanggil.
  --
  -- Menjodohkannya lewat `clients.user_id`, BUKAN `s.client_id = auth.uid()`:
  -- `clients.id` adalah id baris klien dan TIDAK PERNAH sama dengan id
  -- pengguna auth. Perbandingan langsung tidak menolak orang lain — ia menolak
  -- SEMUA ORANG, termasuk pemiliknya sendiri, dan bentuk kegagalannya adalah
  -- klien yang tidak bisa menyentuh sesinya sendiri. Pola ini disalin dari
  -- policy "sessions: milik sendiri" (migrasi 20260828095030).
  if not staf and not exists (
    select 1 from public.clients c
     where c.id = s.client_id and c.user_id = auth.uid()
  ) then
    raise exception 'sesi ini bukan milik Anda' using errcode = '42501';
  end if;

  if oleh = 'padma' then
    jenjang := 4;
    status_baru := 'dibatalkan_padma';
  else
    jenjang := case when darurat then 1 else public.jenjang_pembatalan(s.tanggal, s.jam_mulai) end;
    status_baru := 'dibatalkan_klien';
  end if;

  akibat := case jenjang when 2 then 'hak' when 3 then 'hangus' else 'refund' end;

  -- Hanya sesi yang MASIH terjadwal bisa dibatalkan. Klausa `and status` inilah
  -- yang membuat pemanggilan kedua tidak mengenai baris apa pun — sehingga
  -- menekan tombol dua kali tidak pernah menerbitkan dua hak.
  update public.sessions
     set status = status_baru
   where id = sesi_id
     and status = 'terjadwal'
  returning * into s;

  if not found then
    return null;
  end if;

  if akibat = 'hak' then
    insert into public.hak_sesi (client_id, service_id, kedaluwarsa, sesi_asal_id)
    values (
      s.client_id,
      s.service_id,
      -- 30 hari sejak TANGGAL SESI, bukan sejak hari ini (spec C3 P3).
      s.tanggal + 30,
      s.id
    )
    returning id into hak;
  end if;

  insert into public.jejak_jadwal (
    sesi_id, tindakan, jenjang, dari_tanggal, dari_jam,
    alasan, darurat, aktor_id, peran_aktor
  ) values (
    s.id, 'batal', jenjang, s.tanggal, s.jam_mulai,
    coalesce(alasan, ''), darurat, auth.uid(), peran
  );

  -- `status` IKUT DIPULANGKAN. Layar memanggil fungsi ini lalu menampilkan
  -- kembali apa yang BASIS DATA putuskan — bukan tebakan yang dihitung layar
  -- sebelum tombol ditekan. Bila keduanya berselisih, yang terbaca admin
  -- sesudah menekan adalah yang benar-benar tertulis.
  return jsonb_build_object(
    'jenjang', jenjang,
    'akibat', akibat,
    'hak_id', hak,
    'status', status_baru,
    'oleh', oleh
  );
end;
$$;

-- Tanda tangan LAMA (tanpa `oleh`) DIBUANG, bukan dibiarkan berdampingan.
-- Postgres meng-overload berdasarkan argumen: membiarkannya berarti setiap
-- pemanggil yang belum diperbarui tetap berjalan — diam-diam memakai aturan
-- aktor yang baru saja dinyatakan salah.
drop function if exists public.batalkan_sesi(uuid, text, boolean);

revoke execute on function public.batalkan_sesi(uuid, text, boolean, text) from public, anon;
grant execute on function public.batalkan_sesi(uuid, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- JADWAL ULANG
-- ---------------------------------------------------------------------------
-- MENGUBAH BARIS YANG SAMA, tidak pernah membuat baris baru (spec C3 P4).
-- Baris baru lahir dengan `jadwal_ulang_terpakai = false`, sehingga jatah
-- "1× per pemesanan" bisa di-reset tanpa batas hanya dengan menjadwal ulang
-- berulang — aturannya jadi bohong tanpa satu pun galat.
--
-- Bidannya DIPERTAHANKAN (spec C3 P8): hubungan klien–bidan sudah terbentuk,
-- dan mengganti orang yang akan masuk ke rumah seseorang bukan akibat wajar
-- dari memindahkan jam.
--
-- PAGARNYA TIDAK DIWARISI. `guard_booking_pembatas` adalah trigger
-- `before insert on booking_requests`; ia tidak pernah melihat `sessions`.
-- Jam layanan dibaca lewat `jam_layanan_terpakai()` — fungsi `security definer`
-- yang sudah ada — supaya jam buka klinik tetap punya SATU sumber. Membacanya
-- langsung dari `app_settings` di sini akan mengulang jebakan C1-a: pembacaan
-- dengan hak pemanggil memulangkan nol baris karena policy, dan pagarnya DIAM
-- alih-alih menolak.
--
-- Barisnya DIKUNCI (`for update`) sebelum `jadwal_ulang_terpakai` dibaca. Dua
-- panggilan bersamaan di jenjang 2 atas sesi yang sama, tanpa kunci, sama-sama
-- membaca "jatah belum terpakai" dan sama-sama lolos — yang kedua menimpa
-- tanggal/jam yang pertama, dan kedua panggilan menulis `jejak_jadwal` dengan
-- `dari_tanggal`/`dari_jam` identik seolah dua perpindahan mandiri terjadi.
-- `for update` membuat panggilan kedua MENUNGGU sampai yang pertama commit,
-- lalu membaca `jadwal_ulang_terpakai` yang sudah terbaru.
create or replace function public.jadwal_ulang_sesi(
  sesi_id uuid,
  tanggal_baru date,
  jam_baru time
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.sessions%rowtype;
  peran text := public.user_role();
  staf boolean := peran in ('admin', 'owner');
  jenjang smallint;
  pakai_jatah boolean := false;
  daftar_jam text;
begin
  -- `for update`: lihat komentar panjang di atas fungsi ini soal balapan
  -- jenjang 2. Kunci dipegang sampai transaksi ini selesai, jadi panggilan
  -- bersamaan atas sesi yang sama menunggu di sini.
  select * into s from public.sessions where id = sesi_id for update;
  if not found then
    return null;
  end if;

  -- Dijodohkan lewat `clients.user_id`: `clients.id` bukan id auth (lihat
  -- komentar panjang di `batalkan_sesi`).
  if not staf and not exists (
    select 1 from public.clients c
     where c.id = s.client_id and c.user_id = auth.uid()
  ) then
    raise exception 'sesi ini bukan milik Anda' using errcode = '42501';
  end if;

  jenjang := public.jenjang_pembatalan(s.tanggal, s.jam_mulai);

  -- Jenjang 3 tidak mengenal jadwal ulang: poster menyebutnya pemesanan baru.
  if jenjang = 3 then
    raise exception 'kurang dari 2 jam sebelum sesi — jadwal ulang dihitung sebagai pemesanan baru'
      using errcode = '23514';
  end if;

  if jenjang = 2 then
    -- `s.jadwal_ulang_terpakai` dibaca dari baris yang SUDAH terkunci di atas:
    -- panggilan bersamaan yang lolos kunci belakangan melihat nilai yang
    -- ditulis panggilan pertama, bukan nilai basi dari sebelum keduanya mulai.
    if s.jadwal_ulang_terpakai then
      raise exception 'jatah jadwal ulang gratis untuk pemesanan ini sudah terpakai'
        using errcode = '23514';
    end if;
    pakai_jatah := true;
  end if;

  -- Jam wajib anggota daftar jam layanan. Dibaca lewat fungsi definer yang
  -- sudah ada; daftar kosong berarti pemesanan memang sedang dimatikan.
  -- `daftar_jam` disimpan dengan spasi sesudah koma ("08:00, 09:00, ..."),
  -- jadi pencocokannya wajib `btrim` tiap unsur — persis pola yang sudah
  -- dipakai `guard_booking_pembatas` untuk daftar yang sama. Tanpa `btrim`,
  -- `<> all (string_to_array(...))` menolak SETIAP jam kecuali yang pertama.
  daftar_jam := public.jam_layanan_terpakai();
  if daftar_jam is null or not exists (
    select 1 from unnest(string_to_array(daftar_jam, ',')) as j(teks)
     where btrim(j.teks) = to_char(jam_baru, 'HH24:MI')
  ) then
    raise exception 'jam % di luar jam layanan klinik', to_char(jam_baru, 'HH24:MI')
      using errcode = '22023';
  end if;

  -- Waktu baru harus di masa depan, dan tidak boleh lebih dekat dari ambang
  -- berangkat: memindahkan sesi ke 30 menit lagi bukan jadwal ulang melainkan
  -- cara memaksa bidan berangkat tanpa pemberitahuan.
  if ((tanggal_baru + jam_baru) at time zone 'Asia/Jakarta') - now() < interval '2 hours' then
    raise exception 'waktu baru terlalu dekat — pilih minimal 2 jam dari sekarang'
      using errcode = '23514';
  end if;

  -- Bidan yang sama tidak bisa berada di dua tempat. Sesi yang sedang dipindah
  -- dikecualikan supaya memindahkannya ke jamnya sendiri tidak menabrak diri
  -- sendiri.
  if exists (
    select 1 from public.sessions x
     where x.partner_id = s.partner_id
       and x.tanggal = tanggal_baru
       and x.jam_mulai = jam_baru
       and x.status = 'terjadwal'
       and x.id <> s.id
  ) then
    raise exception 'bidan sudah punya jadwal pada waktu itu — pilih waktu lain'
      using errcode = '23505';
  end if;

  update public.sessions
     set tanggal = tanggal_baru,
         jam_mulai = jam_baru,
         jadwal_ulang_terpakai = s.jadwal_ulang_terpakai or pakai_jatah
   where id = sesi_id
     and status = 'terjadwal';

  if not found then
    return null;
  end if;

  insert into public.jejak_jadwal (
    sesi_id, tindakan, jenjang, dari_tanggal, dari_jam, ke_tanggal, ke_jam,
    aktor_id, peran_aktor
  ) values (
    s.id, 'jadwal_ulang', jenjang, s.tanggal, s.jam_mulai, tanggal_baru, jam_baru,
    auth.uid(), peran
  );

  return jsonb_build_object('jenjang', jenjang, 'jatah_terpakai', pakai_jatah);
end;
$$;

revoke execute on function public.jadwal_ulang_sesi(uuid, date, time) from public, anon;
grant execute on function public.jadwal_ulang_sesi(uuid, date, time) to authenticated;

-- ---------------------------------------------------------------------------
-- TUKAR HAK MENJADI SESI
-- ---------------------------------------------------------------------------
-- Sesi penggantinya lahir `status_bayar = 'lunas'`, dan itu wajib: uangnya
-- sudah dibayar untuk sesi yang batal. Tanpa ini klien menerima tagihan kedua
-- untuk sesi yang sudah ia bayar — kesalahan yang sama sudah ditutup di C2 saat
-- sesi lahir dari konfirmasi.
--
-- `varian` sengaja TIDAK diminta pemanggil: ia diwarisi dari sesi asal bila
-- ada, karena hak menjanjikan "satu sesi untuk layanan yang sama", dan varian
-- yang berbeda adalah harga yang berbeda.
--
-- Barisnya DIKUNCI (`for update`) sebelum diperiksa dan sebelum sesi baru
-- disisipkan. Tanpa kunci ini, dua panggilan bersamaan atas `hak_id` yang sama
-- sama-sama membaca `dipakai_sesi_id is null`, sama-sama lolos, dan sama-sama
-- menyisipkan sesi `lunas` — melahirkan dua sesi berbayar dari satu hak, salah
-- satunya yatim. Indeks unik parsial `hak_sesi_dipakai_sekali` TIDAK mencegah
-- ini: ia unik atas NILAI `dipakai_sesi_id`, jadi yang dijaminnya adalah satu
-- SESI tidak bisa diklaim dua hak — bukan satu HAK tidak bisa dipakai dua
-- kali. `for update` membuat panggilan kedua MENUNGGU sampai yang pertama
-- commit, lalu memeriksa ulang `dipakai_sesi_id` dengan nilai yang sudah
-- terbaru.
create or replace function public.tukar_hak_sesi(
  hak_id uuid,
  tanggal_baru date,
  jam_baru time,
  mitra uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  h public.hak_sesi%rowtype;
  peran text := public.user_role();
  staf boolean := peran in ('admin', 'owner');
  varian uuid;
  alamat_asal text;
  lat_asal double precision;
  lon_asal double precision;
  m public.partners%rowtype;
  km double precision;
  jenjang_hitung jenjang_transport;
  daftar_jam text;
  sesi_baru uuid;
begin
  -- `for update` MENGUNCI baris hak sampai transaksi ini selesai. Panggilan
  -- bersamaan atas `hak_id` yang sama akan menunggu di sini, bukan membaca
  -- `dipakai_sesi_id` yang sama-sama masih null lalu sama-sama lolos.
  select * into h from public.hak_sesi where id = hak_id for update;
  if not found then
    return null;
  end if;

  -- Dijodohkan lewat `clients.user_id`: `clients.id` bukan id auth (lihat
  -- komentar panjang di `batalkan_sesi`).
  if not staf and not exists (
    select 1 from public.clients c
     where c.id = h.client_id and c.user_id = auth.uid()
  ) then
    raise exception 'hak ini bukan milik Anda' using errcode = '42501';
  end if;

  -- Diperiksa SESUDAH kunci didapat, dan SEBELUM sesi baru disisipkan — supaya
  -- panggilan kedua yang menunggu di atas melihat nilai yang sudah terbaru
  -- (ditulis oleh panggilan pertama yang sudah commit) dan berhenti di sini,
  -- bukan sesudah telanjur melahirkan baris `sessions` yatim.
  if h.dipakai_sesi_id is not null then
    return null;
  end if;

  if h.kedaluwarsa < (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'hak ini sudah kedaluwarsa pada %', h.kedaluwarsa
      using errcode = '23514';
  end if;

  -- `daftar_jam` disimpan dengan spasi sesudah koma ("08:00, 09:00, ..."),
  -- jadi pencocokannya wajib `btrim` tiap unsur — pola yang sama dipakai
  -- `guard_booking_pembatas` dan `jadwal_ulang_sesi` untuk daftar yang sama.
  daftar_jam := public.jam_layanan_terpakai();
  if daftar_jam is null or not exists (
    select 1 from unnest(string_to_array(daftar_jam, ',')) as j(teks)
     where btrim(j.teks) = to_char(jam_baru, 'HH24:MI')
  ) then
    raise exception 'jam % di luar jam layanan klinik', to_char(jam_baru, 'HH24:MI')
      using errcode = '22023';
  end if;

  -- WAKTU BARU HARUS DI MASA DEPAN — pagar yang setara dengan
  -- `jadwal_ulang_sesi`, dan sebelumnya TIDAK ADA di sini.
  --
  -- Fungsi ini memvalidasi kepemilikan, keterpakaian, kedaluwarsa, keanggotaan
  -- jam, dan bentrok bidan — tetapi tidak sekali pun bahwa tanggalnya belum
  -- lewat. Satu salah ketik tahun sudah cukup: haknya TERMAKAN pada sesi di
  -- masa lalu, `dipakai_sesi_id` terisi, dan indeks unik parsial menutup jalan
  -- kembali. Tidak ada layar yang bisa memulihkannya — hanya UPDATE manual ke
  -- basis data.
  --
  -- Ambangnya 2 jam, sama dengan `jadwal_ulang_sesi`, dan sebab yang sama:
  -- menaruh sesi 30 menit lagi bukan penjadwalan melainkan cara memaksa bidan
  -- berangkat tanpa pemberitahuan.
  if ((tanggal_baru + jam_baru) at time zone 'Asia/Jakarta') - now() < interval '2 hours' then
    raise exception 'waktu sesi pengganti terlalu dekat atau sudah lewat — pilih minimal 2 jam dari sekarang'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.sessions x
     where x.partner_id = mitra
       and x.tanggal = tanggal_baru
       and x.jam_mulai = jam_baru
       and x.status = 'terjadwal'
  ) then
    raise exception 'bidan sudah punya jadwal pada waktu itu — pilih waktu lain'
      using errcode = '23505';
  end if;

  -- SESI PENGGANTI LAHIR DARI BARIS ASALNYA, BUKAN DARI DELAPAN KOLOM SAJA.
  --
  -- Versi pertama fungsi ini menyisipkan delapan kolom dan berhenti di situ.
  -- `sessions.alamat` bertipe `not null default ''`, jadi penyisipannya
  -- BERHASIL DIAM-DIAM — dan sesi pengganti, sesi yang kliennya sudah bayar,
  -- lahir tanpa alamat. Bidan tidak punya rumah yang dituju, dan tidak ada
  -- satu pun galat yang menyebutkannya. Bandingkan jalur kelahiran sesi yang
  -- sudah baku, `konfirmasi_permintaan()` (migrasi
  -- `20260912101000_status_bayar_pagar.sql`): ia menyalin alamat & koordinat,
  -- lalu menghitung jenjang transportnya sendiri.
  --
  -- Alamat DISALIN dari baris asal, TIDAK diambil ulang dari profil klien —
  -- peringatan yang sudah tertulis di `konfirmasi_atomik.sql`: klien boleh
  -- memesan untuk alamat lain, dan mengambil ulang akan diam-diam mengubah ke
  -- mana bidan dikirim.
  select s.variant_id, s.alamat, s.alamat_lat, s.alamat_lon
    into varian, alamat_asal, lat_asal, lon_asal
    from public.sessions s
   where s.id = h.sesi_asal_id;

  -- HAK TANPA SESI ASAL DITOLAK, dan penolakan itu adalah keputusan.
  --
  -- Alamat sebuah sesi hanya punya satu sumber yang sah: baris asalnya. Hak
  -- yang diterbitkan tanpa sesi asal (mis. staf menerbitkannya langsung)
  -- karena itu tidak punya alamat tujuan sama sekali. Dua jalan tersedia:
  -- melahirkan sesi beralamat kosong, atau menolak.
  --
  -- Dipilih MENOLAK. Sesi beralamat kosong adalah persis kegagalan senyap yang
  -- fungsi ini baru saja ditutup — tidak ada seorang pun yang mengetahuinya
  -- sampai bidan berdiri di jalan tanpa tujuan, dan tidak ada layar yang bisa
  -- memperbaikinya setelahnya. Galat di sini muncul pada saat masih bisa
  -- diperbaiki: staf menjadwalkan sesi penggantinya langsung (formulir "Sesi
  -- baru" meminta alamat), atau menerbitkan haknya dari sesi yang batal.
  -- Dalam jalur yang hidup hari ini cabang ini TIDAK PERNAH terpicu: satu-
  -- satunya penerbit hak adalah `batalkan_sesi()`, dan ia selalu mencatat
  -- `sesi_asal_id`.
  if not found then
    raise exception 'hak ini tidak punya sesi asal, jadi alamat tujuannya tidak diketahui — jadwalkan sesi penggantinya langsung'
      using errcode = '23514';
  end if;

  -- Varian yang belum terisi pada baris asal tetap jatuh ke varian BAKU
  -- layanan — bentuk query backfill yang sama dipakai migration
  -- `varian_wajib`, ditambah filter `aktif` seperti helper uji `varianBaku()`
  -- (`varian_wajib.sql` sendiri TIDAK memfilter `aktif`).
  if varian is null then
    select v.id into varian
      from public.service_variants v
     where v.service_id = h.service_id
       and v.aktif
     order by v.urutan, v.created_at, v.id
     limit 1;
  end if;

  -- Jenjang transport DIHITUNG di sini, dengan cara yang sama persis seperti
  -- `konfirmasi_permintaan()`: jarak garis lurus antara domisili BIDAN yang
  -- ditugaskan dan alamat tujuan. Bidannya bisa berbeda dari sesi asal, jadi
  -- mewarisi `jenjang` apa adanya akan membayarkan transport yang salah.
  --
  -- Koordinat yang tidak lengkap BUKAN galat (alasan yang sama dengan
  -- `konfirmasi_permintaan`): alamat Malang sering gagal digeocode, dan
  -- domisili bidan boleh belum diisi. Jenjangnya tetap NULL, dan admin
  -- menetapkannya belakangan lewat `tetapkanJenjang`.
  select * into m from public.partners p where p.id = mitra;

  if m.lat is not null and m.lon is not null
     and lat_asal is not null and lon_asal is not null then
    km := public.jarak_km(m.lat, m.lon, lat_asal, lon_asal);
    jenjang_hitung := public.jenjang_dari_jarak(km);
  end if;

  insert into public.sessions (
    client_id, service_id, variant_id, partner_id,
    tanggal, jam_mulai,
    alamat, alamat_lat, alamat_lon,
    jenjang, jenjang_sumber, jenjang_alasan,
    status, status_bayar
  ) values (
    h.client_id, h.service_id, varian, mitra,
    tanggal_baru, jam_baru,
    alamat_asal, lat_asal, lon_asal,
    jenjang_hitung,
    case when jenjang_hitung is null then null else 'otomatis'::sumber_jenjang end,
    '',
    'terjadwal', 'lunas'
  )
  returning id into sesi_baru;

  -- Pagar kedua: `and dipakai_sesi_id is null` mengulang pemeriksaan yang
  -- sudah dilakukan sesudah `for update` di atas. Dalam alur normal klausa ini
  -- tidak pernah gagal — kuncinya sudah menutup celahnya — tapi bila ada jalur
  -- lain yang suatu hari menulis `dipakai_sesi_id` tanpa mengunci baris ini
  -- lebih dulu, `if not found` di bawah menolaknya dengan galat, bukan diam
  -- menimpa penukaran yang sudah ada.
  update public.hak_sesi
     set dipakai_sesi_id = sesi_baru
   where id = hak_id
     and dipakai_sesi_id is null;

  if not found then
    raise exception 'hak ini sudah dipakai oleh penukaran lain' using errcode = '23514';
  end if;

  insert into public.jejak_jadwal (
    sesi_id, tindakan, jenjang, ke_tanggal, ke_jam, aktor_id, peran_aktor
  ) values (
    sesi_baru, 'tukar_hak', 2, tanggal_baru, jam_baru, auth.uid(), peran
  );

  return sesi_baru;
end;
$$;

revoke execute on function public.tukar_hak_sesi(uuid, date, time, uuid) from public, anon;
grant execute on function public.tukar_hak_sesi(uuid, date, time, uuid) to authenticated;
