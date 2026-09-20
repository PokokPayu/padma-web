-- ===========================================================================
-- `aktif = false` BERARTI BERHENTI DIJUAL, BUKAN MENCABUT AKSES PEMBELI
-- ===========================================================================
-- Spec (`docs/superpowers/specs/2026-09-20-padma-produk-digital-design.md`)
-- menulis masa akses produk digital: "Selamanya; admin tetap bisa mencabut".
-- Pencabutan punya mekanismenya SENDIRI — `digital_entitlements.dicabut_pada`
-- — dan itulah satu-satunya tombol yang boleh menutup pintu seorang pembeli.
--
-- Sebelum migration ini, klien hanya bisa membaca `digital_products` lewat
-- policy "produk: baca publik yang aktif". Konsekuensinya: menarik produk dari
-- etalase (`nonaktifkanProduk`) diam-diam ikut mencabut akses SEMUA pemegang
-- entitlement — dan mencabutnya dengan cara yang TIDAK KONSISTEN, karena tiga
-- permukaan membaca `digital_products` (kartu "Pembelian saya", reader
-- `/passport/produk/[slug]`, rute unduh) sementara dua lainnya (rute video dan
-- rute halaman) sama sekali tidak membacanya dan tetap menyajikan isi. Lima
-- permukaan, tiga perilaku berbeda, untuk satu keadaan yang sama.
--
-- Policy di bawah menyatukannya di SATU tempat — di basis data, bukan di lima
-- berkas TypeScript: pemegang entitlement yang masih hidup boleh membaca baris
-- produknya, tayang atau tidak. Etalase publik tidak berubah sedikit pun:
-- policy "produk: baca publik yang aktif" tetap satu-satunya jalan anon, dan
-- `anon` tidak punya EXECUTE atas `punya_produk` (dicabut di migration
-- `produk_entitlement`) — karena itu `to authenticated` di sini bukan kosmetik:
-- tanpanya policy ini lahir `to public`, setiap SELECT anon atas tabel ini ikut
-- mengevaluasinya, lalu gagal 42501 alih-alih memulangkan baris kosong. Alasan
-- yang sama sudah ditulis panjang di migration `produk_digital`.
--
-- Predikatnya MEMAKAI ULANG `punya_produk(uuid)`, tidak disalin: fungsi itu
-- sudah persis berarti "ada entitlement milik pemanggil yang belum dicabut",
-- dan dua salinan predikat yang sama adalah dua tempat yang bisa berbeda saat
-- salah satunya disunting.
create policy "produk: pemilik entitlement baca" on public.digital_products for select
  to authenticated
  using (public.punya_produk(id));

comment on table public.digital_products is
  'Katalog produk digital yang dijual. TANPA kolom nominal — harga hidup di '
  'digital_product_prices, di balik money firewall. `aktif` dan `boleh_unduh` '
  'keduanya default false: yang terpajang dan yang bisa diunduh adalah '
  'keputusan sadar, bukan keadaan bawaan. `aktif = false` berarti BERHENTI '
  'DIJUAL, bukan mencabut akses: pemegang entitlement yang belum dicabut tetap '
  'membaca barisnya lewat policy "produk: pemilik entitlement baca". '
  'Pencabutan akses hanya lewat digital_entitlements.dicabut_pada.';
