-- ============================================================================
-- HARGA PUBLIK — view berkolom sempit sebagai batas kerahasiaan
-- ============================================================================
-- Pengunjung harus bisa melihat pricelist; honor mitra tidak boleh bocor
-- sedikit pun. Keduanya duduk di satu tabel, dan itu memang disengaja: CHECK
-- `honor_mitra <= harga_klien` hanya mungkin selama keduanya satu baris.
--
-- Batasnya karena itu bukan batas TABEL melainkan batas KOLOM, dan proyek ini
-- sudah punya polanya: `partner_publik` (pengerasan_admin) — view berkolom
-- sempit dengan security_invoker = off, dipakai justru karena klien tidak
-- punya, dan tidak boleh punya, hak baca atas tabel dasarnya.
--
-- Penolakan view di lib/owner/rekap.ts menyasar sesuatu yang lain: view
-- AGREGAT yang diam-diam melewati RLS dan membocorkan rate card lengkap ke
-- admin. Yang di sini sempit, disengaja, dan daftar kolomnya dikunci uji
-- (tests/harga-publik.test.ts).
--
-- `where berlaku_sejak <= hari ini`: tarif yang BELUM berlaku adalah rencana
-- harga, bukan harga. Kalendernya Asia/Jakarta, bukan `current_date` yang UTC —
-- setiap dini hari WIB `current_date` masih kemarin.
--
-- Cap waktu ditulis MANUAL dan lebih besar dari berkas terakhir
-- (20260906140000): `supabase migration new` memakai jam dinding dan sudah
-- pernah menyelipkan migration ke tengah riwayat sehingga `db reset` gagal.

create view public.harga_publik with (security_invoker = off) as
  select variant_id, harga_klien, harga_coret, berlaku_sejak
    from public.variant_rates
   where berlaku_sejak <= (now() at time zone 'Asia/Jakarta')::date;

revoke all on public.harga_publik from public, anon, authenticated;
grant select on public.harga_publik to anon, authenticated;

comment on view public.harga_publik is
  'Harga klien untuk landing & katalog publik. security_invoker = off '
  'disengaja: view inilah batas kolomnya, dan anon memang tidak punya hak baca '
  'atas variant_rates. honor_mitra TIDAK ADA di proyeksi dan daftar kolomnya '
  'dikunci sebagai assertion di tests/harga-publik.test.ts.';
