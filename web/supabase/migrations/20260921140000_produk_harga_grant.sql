-- ===========================================================================
-- GRANT SELECT, INSERT ATAS digital_product_prices — jalur yang sudah
-- direncanakan migration `produk_harga` (20260921110000)
-- ===========================================================================
-- Migration itu mencabut SELURUH hak tabel dari `authenticated` karena pada
-- saat itu belum ada satu pun alur produk yang menulis lewat sesi
-- `authenticated` milik owner sendiri. Komentarnya sendiri menuliskan
-- rencananya: "sudah siap kalau kelak ada tugas yang memberi authenticated
-- hak SELECT/INSERT langsung untuk UI owner menetapkan harga — saat itu
-- tiba, firewall RLS-nya sudah berdiri, tinggal hak tabelnya yang dibuka."
-- Task 7 (panel owner menetapkan harga) ADALAH tugas itu, dan dibuktikan
-- EMPIRIS lewat sesi owner sungguhan (anon key + JWT owner, bukan service
-- role): tanpa migration ini, INSERT owner berhenti di 42501 "permission
-- denied for table" — bukan RLS, GRANT-nya memang belum ada.
--
-- ===========================================================================
-- KENAPA INI BUKAN PENGULANGAN KESALAHAN Task 6
-- ===========================================================================
-- `20260921130000_produk_hapus_isi.sql` menolak `grant delete` kepada
-- `authenticated` atas `digital_product_pages`/`digital_product_files` karena
-- DELETE (dan UPDATE/SELECT berfilter) memakai FILTER PostgREST sebagai
-- pembatas baris — dan filter adalah pilihan PEMANGGIL, bukan pembatas baris
-- sungguhan. Permintaan tautologis (`?halaman=gte.0`) bisa menyapu SELURUH
-- tabel dalam satu panggilan.
--
-- INSERT tidak punya bentuk sweep itu: setiap baris yang lahir datang dari
-- NILAI yang eksplisit di body permintaan (`product_id`, `harga`, …), bukan
-- dari filter atas baris yang SUDAH ADA. Tidak ada `?product_id=neq.<x>`
-- yang bisa membuat satu INSERT menulis harga untuk produk lain. Radiusnya
-- sudah terkunci oleh bentuk verbanya sendiri — bukan oleh niat baik
-- pemanggil.
--
-- SELECT yang diberikan di sini pun tidak membuka apa pun yang belum
-- dijaga: kedua policy RLS ("harga produk: owner sisip", "harga produk:
-- owner baca", migration `produk_harga`) sudah memeriksa
-- `user_role() = 'owner'` di dalam WITH CHECK / USING masing-masing. Admin
-- dan klien tetap authenticated yang sama secara SQL, tetapi RLS-lah yang
-- menjawab untuk mereka: 0 baris, bukan galat — pola yang identik dengan
-- `variant_rates`, yang sudah lebih dulu diberi `select, insert` dengan
-- alasan yang sama persis (lihat komentar `ambilTarif()` di
-- `src/lib/owner/data.ts`).
--
-- Yang TETAP TIDAK diberikan: UPDATE dan DELETE. Append-only bukan hanya
-- pesan di server action — basis data sendiri yang menolaknya, dan tidak
-- ada satu baris kode pun di berkas ini yang membukanya kembali.
grant select, insert on public.digital_product_prices to authenticated;

comment on table public.digital_product_prices is
  'Riwayat harga produk digital. INSERT & SELECT terbuka untuk authenticated '
  '(sejak Task 7), dibatasi RLS ke owner — bukan filter, jadi tidak ada '
  'radius sweep. UPDATE & DELETE TETAP tercabut total: harga lama tidak '
  'pernah berubah maupun hilang. harga = 0 berarti GRATIS, bukan belum '
  'ditetapkan. Dipajang publik lewat harga_produk_publik; daftar kolomnya '
  'dikunci di tests/produk-harga-publik.test.ts.';
