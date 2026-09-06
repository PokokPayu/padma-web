-- ============================================================================
-- BUBARKAN service_rates — dua sumber harga adalah satu sumber yang basi
-- ============================================================================
-- Barisnya sudah tersalin ke variant_rates (migration tarif_per_varian) dan
-- kode owner sudah pindah membacanya. Membiarkan keduanya hidup berdampingan
-- berarti dua sumber harga, dan yang satu pasti basi tanpa ada yang tahu
-- kapan.
--
-- Cap waktu ditulis MANUAL dan lebih besar dari berkas terakhir
-- (20260906130000): `supabase migration new` memakai jam dinding dan sudah
-- pernah menyelipkan migration ke tengah riwayat sehingga `db reset` gagal.
--
-- TIDAK ADA jejak audit yang perlu dipindah. Diverifikasi dengan
--   grep -rn "on public.service_rates" supabase/migrations/*.sql
-- yang hanya memulangkan dua pemicu pengerasan_tabel_uang, keduanya sudah
-- punya pasangan di variant_rates (trg_guard_tarif_varian_maju,
-- trg_kunci_riwayat_tarif_varian). `catat_status_bayar` menempel pada
-- sessions/client_packages — bukan pada tabel tarif.
drop trigger if exists trg_guard_tarif_maju     on public.service_rates;
drop trigger if exists trg_kunci_riwayat_tarif  on public.service_rates;
drop table public.service_rates;

-- Kedua fungsi ini khusus service_rates dan tidak dirujuk objek lain sesudah
-- tabelnya jatuh, jadi ia dibersihkan bersama tabelnya.
drop function if exists public.guard_tarif_maju();
drop function if exists public.kunci_riwayat_tarif();
