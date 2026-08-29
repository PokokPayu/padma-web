-- ============================================================================
-- SESI BERPAKET TIDAK MEMIKUL STATUS PEMBAYARAN
-- ============================================================================
-- Spec bagian 5: "status_bayar hanya relevan untuk sesi lepas; sesi dalam paket
-- mengikuti status paketnya." Sampai migration sebelumnya aturan itu hidup
-- sebagai SARINGAN yang disalin ke tiga tempat — RPC `klaim_sudah_bayar`,
-- `susunTagihan()` di src/lib/passport/turunan.ts, dan `hitungKlaimMenunggu()`
-- di src/lib/admin/antrean.ts. Tiga salinan aturan yang sama adalah tiga
-- kesempatan untuk berpisah diam-diam, dan yang berpisah tidak akan terlihat
-- sebagai error melainkan sebagai angka badge yang tidak bisa dibersihkan.
--
-- Constraint di bawah memindahkan aturannya ke akar: keadaan "sesi berpaket
-- berstatus bayar" bukan lagi keadaan yang disaring, melainkan keadaan yang
-- TIDAK BISA ADA. CHECK berlaku untuk service role, untuk SECURITY DEFINER,
-- dan untuk psql — tidak ada jalur yang mengecualikannya.
--
-- Ia juga menutup pintu belakang yang tidak dijaga saringan mana pun: membayar
-- sesi sebagai sesi LEPAS lalu memindahkannya ke dalam paket. Karena predikat
-- menyebut kedua kolom, UPDATE `client_package_id` saja pun dievaluasi ulang.
--
-- URUTAN PENTING: constraint ini HARUS dipasang SESUDAH RPC klaim diperbaiki
-- (20260830100000_klaim_hanya_sesi_lepas.sql). CHECK berlaku juga untuk
-- SECURITY DEFINER; bila urutannya dibalik, RPC klaim melempar 23514 ->
-- PostgREST 400 -> klien membaca "Gagal memproses" padahal jawaban yang benar
-- adalah "item ini memang bukan tagihan". RPC yang sudah diperbaiki menyaring
-- barisnya lebih dulu sehingga UPDATE-nya tidak pernah menyentuh sesi berpaket.
--
-- Cap waktu ditulis MANUAL. `npx supabase migration new` memakai jam dinding
-- dan sudah pernah menyelipkan berkas ke tengah riwayat sehingga `db reset`
-- gagal.

-- Perbaikan data mendahului pemasangan pagar, bukan pelonggaran pagar.
-- Pada data hari ini (seed + dev) hitungannya 0 baris — diverifikasi dengan
-- `select count(*) from sessions where client_package_id is not null
--  and status_bayar <> 'belum'` sebelum berkas ini ditulis. Baris ini tetap
-- ada karena database dev/produksi yang sudah berjalan bisa membawa baris
-- warisan dari sebelum RPC klaim diperbaiki, dan `add constraint` akan mati
-- karenanya. Trigger jejak menyala di sini (service role -> peran_aktor
-- 'service_role'), dan itu memang yang diinginkan: koreksi data uang pun
-- meninggalkan bukti.
update public.sessions
   set status_bayar = 'belum'
 where client_package_id is not null
   and status_bayar <> 'belum';

alter table public.sessions
  add constraint sessions_bayar_hanya_lepas
  check (client_package_id is null or status_bayar = 'belum');

comment on constraint sessions_bayar_hanya_lepas on public.sessions is
  'Sesi di dalam paket mengikuti status bayar paketnya; hanya sesi lepas yang '
  'memikul status_bayar sendiri. Menutup "tagihan hantu" di antrean verifikasi '
  'admin sekaligus pintu belakang bayar-dulu-lalu-masukkan-paket.';
