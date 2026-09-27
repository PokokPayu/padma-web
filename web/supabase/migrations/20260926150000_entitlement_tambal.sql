-- ===========================================================================
-- PENAMBALAN digital_entitlements — satu-satunya sentuhan P1 pada tabel yang
-- sudah dipakai produksi
-- ===========================================================================
-- Lubangnya MENDAHULUI P1, tapi P1 yang mengubah artinya. Sebelum P1,
-- entitlement tidak punya harga. Sesudah P1, `sumber='beli'` adalah KLAIM
-- PENDAPATAN yang bisa dikarang setiap akun staf lewat satu `curl` ke
-- PostgREST — tanpa satu baris `orders` maupun `jejak_pesanan` — dan cerita
-- rekonsiliasi yang P1 janjikan buta sepenuhnya terhadapnya, karena ia hanya
-- melihat dari sisi pesanan.
--
-- AMAN DILAKUKAN, diverifikasi bukan diasumsikan: ketiga kueri
-- `digital_entitlements` di `src/` seluruhnya `.select()`
-- (`admin/produk/[id]/page.tsx:47`, `produk/[slug]/tombol-ambil.tsx:114`,
-- `lib/passport/produk-saya.ts:64`), dan satu-satunya penulis produksi —
-- `ambil_produk_gratis` — adalah `security definer` sehingga pencabutan hak
-- `authenticated` tidak menyentuhnya. Karena kesimpulan itu bersandar pada
-- SATU kata kunci di SATU baris migrasi, uji yang membuktikannya lahir bersama
-- migrasi ini (`tests/produk-ambil-gratis.test.ts`, kasus "alur ambil gratis
-- TETAP hijau sesudah hak tulis authenticated dicabut").
--
-- DUA KEMAMPUAN STAF YANG DICABUT, DITERIMA SADAR:
--   1. menulis `dicabut_pada` — satu-satunya tuas rem yang bisa ditarik tanpa
--      akses basis data. Sesudah ini, rem darurat hanya bisa ditarik pemegang
--      service role.
--   2. menerbitkan `sumber='pemberian_admin'` — kategori yang sejak sekarang
--      TIDAK BISA LAGI LAHIR. Labelnya tetap dirender untuk baris lama
--      (`src/app/admin/produk/[id]/page.tsx:35`) dan tidak akan pernah
--      bertambah.
-- Keduanya praktis keadaan hari ini juga: tidak ada satu pun tombol di panel
-- untuk keduanya, jadi yang dicabut adalah kemampuan yang sudah menuntut orang
-- mengetik `curl` atau membuka SQL editor. Komentar di
-- `src/app/admin/produk/aksi.ts:274-288` menyebut "pencabutan punya tombolnya
-- SENDIRI" — bila tombol itu kelak benar-benar dibutuhkan, ia lahir sebagai
-- RPC kedua ber-radius terkunci, BUKAN sebagai pengembalian hak tulis tabel.

-- INSERT & UPDATE saja yang dicabut, sesuai spec. DELETE TIDAK disentuh migrasi
-- ini sama sekali — dan itu bukan celah: `digital_entitlements` lahir
-- (20260921120000) SESUDAH `20260829190000_cabut_hak_hapus_berlebih.sql`
-- mengubah default privileges skema `public` supaya tabel BARU berhenti
-- mewarisi DELETE untuk `authenticated`, dan tabel ini tidak pernah
-- menyatakan niat sebaliknya lewat `grant delete ... to authenticated`.
-- `authenticated` karena itu TIDAK PERNAH punya DELETE di tabel ini — dengan
-- atau tanpa migrasi ini — dan Postgres menolaknya di lapis HAK TABEL sebelum
-- RLS sempat dievaluasi (42501, bukan nol baris senyap). Lihat kasus "DELETE
-- tetap mustahil bagi staf" di tests/pesanan-rekonsiliasi-entitlement.test.ts,
-- yang menagih pagar itu langsung dari katalog alih-alih mempercayainya.
revoke insert, update on public.digital_entitlements from authenticated;

-- Policy staf dipersempit dari `for all` menjadi `for select`. Pagar tingkat
-- HAK di atas dan penyempitan policy di sini adalah DUA pagar untuk satu
-- lubang, dan itu disengaja: policy bisa ditambahkan seseorang besok tanpa
-- satu uji pun merah selama haknya masih ada, dan sebaliknya hak bisa
-- dikembalikan diam-diam selama policy-nya masih `for all`.
--
-- `to authenticated` DITULIS ULANG, bukan dilupakan: policy tanpa target lahir
-- `to public`, dan `public` MENCAKUP `anon` — setiap SELECT anon atas tabel ini
-- akan ikut mengevaluasi policy staf, memanggil `user_role()` yang EXECUTE-nya
-- sudah dicabut dari anon, dan gagal 42501 alih-alih memulangkan baris kosong
-- (alasan yang sama persis dengan yang tertulis di migrasi aslinya,
-- 20260921120000_produk_entitlement.sql:40-47).
drop policy "entitlement: staf" on public.digital_entitlements;

create policy "entitlement: staf" on public.digital_entitlements for select
  to authenticated
  using (public.user_role() in ('admin','owner'));

comment on table public.digital_entitlements is
  'Kepemilikan produk digital. SATU-SATUNYA sumber kebenaran akses — setiap '
  'gerbang isi membaca tabel ini, tidak pernah membaca pesanan. Sejak '
  'penambalan P1: peran API hanya MEMBACA. Penerbitan akses lewat '
  'ambil_produk_gratis (gratis) atau terbitkan_akses_item (beli); pencabutan '
  'hanya lewat service role.';
