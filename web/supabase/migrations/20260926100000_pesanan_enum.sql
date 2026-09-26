-- ===========================================================================
-- INTI PEMBAYARAN (1/6) — TIGA ENUM + PENILAI PERPINDAHAN
-- ===========================================================================
-- Cap waktu 20260926* dipilih di atas 20260924100000, BUKAN sekadar di atas
-- tip `main` (20260921170000). Cabang `umpan-balik-klien-gelombang-1` membawa
-- 20260922100000 dan 20260924100000 yang belum ter-merge; mulai dari 20260926
-- membuat urutan penerapan sama antara DB segar dan DB yang sudah menerima
-- cabang itu.
--
-- Berkas ini HANYA melahirkan tipe dan satu fungsi murni. Tidak ada tabel di
-- sini, dan itu disengaja: `alter type ... add value` tidak boleh dipakai di
-- transaksi yang sama dengan pemakaian nilainya (55P04), dan Supabase CLI
-- menjalankan tiap berkas migrasi dalam transaksinya sendiri. Memisahkan enum
-- ke berkasnya sendiri membuat migrasi berikutnya bebas memakainya.

-- ---------------------------------------------------------------------------
-- (1) STATUS PESANAN — LIMA nilai, bukan enam
-- ---------------------------------------------------------------------------
-- `ditinjau` sengaja TIDAK dibuat. Ia akan menjadi mekanisme tinjauan kedua
-- yang hidup berdampingan dengan `orders.butuh_tinjauan_pada` tanpa satu pun
-- kalimat yang menyebut apa yang melahirkannya, dan pesanan yang masuk ke
-- sana tidak punya jalan pulang. Penanda tinjauan sekarang SATU kolom, dan ia
-- ortogonal terhadap status.
--
-- Tipe ini SENGAJA terpisah dari `pay_status`. Nol `alter type pay_status add
-- value` berarti nol risiko 55P04 pada enum yang sudah dipakai tiga tabel,
-- dan assertion money firewall yang mengunci ketiga pemilik kolom
-- `status_bayar` tetap utuh. Kolom status pesanan karena itu bernama `status`,
-- bukan `status_bayar`.
--
-- Urutan nilainya mengikuti alur nyata, dan urutan itu MENGIKAT:
-- tests/pesanan-status-db.test.ts membandingkannya dengan
-- src/lib/pesanan/status.ts menurut `enumsortorder`, bukan menurut abjad.
create type public.order_status as enum (
  'menunggu_bayar',
  'ditahan',
  'lunas',
  'kedaluwarsa',
  'dibatalkan'
);

comment on type public.order_status is
  'Keadaan sebuah pesanan. LIMA nilai: menunggu_bayar (satu-satunya yang boleh '
  'menerima uang), ditahan (uang masuk, jumlah tidak cocok — keadaan AKHIR, '
  'bukan antrean), lunas, kedaluwarsa, dibatalkan. Tanpa "ditinjau": penanda '
  'tinjauan adalah orders.butuh_tinjauan_pada, dan ia ortogonal terhadap status.';

-- ---------------------------------------------------------------------------
-- (2) SUMBER ITEM
-- ---------------------------------------------------------------------------
-- `sesi` lahir sekarang meski NOL penulis di P1 — preseden yang sama dengan
-- `entitlement_source.'beli'`. Yang membuatnya bukan nilai mati: `order_items`
-- (migrasi 2) membawa dua CHECK bercermin yang menjadikan nilai ini sah HANYA
-- bersama `booking_request_id`, jadi P3 tinggal mengisinya tanpa `alter table`
-- pada tabel uang yang sudah memuat nota nyata.
create type public.order_item_source as enum (
  'produk_digital',
  'sesi'
);

comment on type public.order_item_source is
  'Apa yang dibeli sebuah baris nota. `sesi` lahir tanpa penulis di P1 dan '
  'diisi P3; ongkosnya asimetris — satu nilai enum hari ini versus alter type '
  'pada tabel uang berisi nota nyata besok.';

-- ---------------------------------------------------------------------------
-- (3) KEJADIAN PESANAN — 16 nilai
-- ---------------------------------------------------------------------------
-- Tidak ada nilai "tinjauan dibuka". Yang membuka tinjauan SELALU salah satu
-- dari lima: selisih_nominal, selisih_status, lunas_setelah_tutup,
-- akses_tertahan, penangan_belum_ada. Nilai enum yang tidak punya penulis
-- adalah nilai yang pasti salah dibaca kelak.
--
-- Kejadian inilah yang dijanjikan ke proyek WhatsApp (proyek TERPISAH): P1
-- menerbitkan dan mencatat, nol pelanggan. Tidak ada kolom `dikirim_wa_pada`
-- di mana pun — hanya proyek WA yang tahu apa artinya "sudah terkirim", dan
-- kolom mati adalah persis yang doktrin repo ini tolak.
create type public.order_event as enum (
  'dibuat',
  'token_terbit',
  'notifikasi',
  'lunas',
  'ditahan',
  'kedaluwarsa',
  'dibatalkan',
  'selisih_nominal',
  'selisih_status',
  'lunas_setelah_tutup',
  'akses_terbit',
  'akses_sudah_ada',
  'akses_tertahan',
  'penangan_belum_ada',
  'diperiksa_ulang',
  'tinjauan_ditutup'
);

comment on type public.order_event is
  'Kejadian yang dicatat jejak_pesanan. Lima di antaranya (selisih_nominal, '
  'selisih_status, lunas_setelah_tutup, akses_tertahan, penangan_belum_ada) '
  'WAJIB menyalakan orders.butuh_tinjauan_pada di transaksi yang sama dengan '
  'jejaknya — itulah satu-satunya aturan yang membuat blok "Butuh perhatian" '
  'tidak perlu tumbuh setiap kali ada nilai enum baru.';

-- ---------------------------------------------------------------------------
-- (4) PENILAI PERPINDAHAN
-- ---------------------------------------------------------------------------
-- Dipisah menjadi FUNGSI PENILAI, bukan ditanam di badan RPC. Alasannya bisa
-- diuji: fungsi penilai dapat dipanggil langsung untuk SELURUH 25 pasangan
-- tanpa membuat satu pun baris fixture — dan uji yang mahal adalah uji yang
-- lubangnya tidak pernah ditutup.
--
-- `else false` BUKAN basa-basi. Tanpa cabang itu, nilai enum keenam yang kelak
-- lahir membuat `case` memulangkan NULL, dan `if not NULL then` TIDAK PERNAH
-- dieksekusi — penjaganya fail-OPEN pada persis nilai yang belum dikenal
-- siapa pun. Pasangannya di sisi pemanggil: setiap pemakaian di migrasi 4 & 5
-- WAJIB dibungkus `coalesce(..., false)`, karena `p_ke` yang NULL tetap
-- memulangkan NULL dari dalam cabang `then`.
--
-- TIDAK bergerbang peran, dan itu disengaja (pola yang sama dengan
-- `perpindahan_permintaan_sah`, lihat komentar panjang di
-- 20260909101000_rantai_status_pagar.sql): ini penjaga INTEGRITAS —
-- "perpindahan mana yang MASUK AKAL" — dan jawabannya sama untuk siapa pun.
-- Menyalin bungkus peran ke sini akan membebaskan seluruh jalur service role,
-- dan justru di jalur itulah data uang rusak paling sering lahir.
--
-- `security definer` di sini tidak membuka apa pun: badannya nol sentuhan
-- tabel, dan haknya dicabut dari ketiga peran API di bawah. Ia ditulis supaya
-- seluruh fungsi P1 punya bentuk kepala yang sama, sehingga daftar putih di
-- tests/fungsi-mesin-tertutup.test.ts (Tugas 7) tidak perlu mengecualikan satu
-- bentuk khusus.
create or replace function public.perpindahan_pesanan_sah(
  p_dari public.order_status,
  p_ke public.order_status
) returns boolean
language sql
immutable
security definer
set search_path = public
as $$
  select case p_dari
    when 'menunggu_bayar' then p_ke in ('lunas', 'ditahan', 'kedaluwarsa', 'dibatalkan')
    when 'ditahan'        then p_ke in ('lunas', 'dibatalkan')
    when 'lunas'          then false
    when 'kedaluwarsa'    then false
    when 'dibatalkan'     then false
    else false
  end;
$$;

comment on function public.perpindahan_pesanan_sah(public.order_status, public.order_status) is
  'Penilai perpindahan status pesanan. Ditutup else false: nilai enum yang '
  'belum dikenal dijawab FALSE, bukan NULL. Pemanggilnya tetap wajib '
  'coalesce(..., false) karena sasaran NULL memulangkan NULL. Tertutup untuk '
  'seluruh peran API — ia anggota MESIN_TERTUTUP.';

-- Fungsi baru LAHIR ber-EXECUTE untuk `authenticated` (dibuktikan empiris di
-- tests/hak-default-sequence-fungsi.test.ts:253-266). Templat aturan [F] repo
-- (20260828230000_fail_closed_sequence_fungsi.sql:176-177) hanya menulis
-- `from public, anon` — menyalinnya apa adanya di sini akan membuka fungsi
-- mesin pembayaran kepada setiap pengguna login, tanpa satu pun uji merah
-- sebelum Tugas 7 lahir. Bentuk ketat di bawah adalah preseden
-- 20260830150000_pengerasan_tabel_uang.sql:197.
revoke all on function public.perpindahan_pesanan_sah(public.order_status, public.order_status)
  from public, anon, authenticated;
