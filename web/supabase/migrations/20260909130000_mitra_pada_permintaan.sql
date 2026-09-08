-- ============================================================================
-- MITRA DIPILIH SEBELUM KONFIRMASI (spec C1 J7)
-- ============================================================================
-- Sebelum C1, mitra dipilih PADA saat konfirmasi: `konfirmasiPermintaan`
-- menerima `partnerId` sebagai parameter dan langsung melahirkan sesi. Rantai
-- baru memisahkan keduanya — `mitra_siap` adalah keadaan tersendiri, dan
-- alasannya struktural, bukan kosmetik: tarif transport berasal dari domisili
-- MITRA ke alamat KLIEN, jadi transport tidak bisa dihitung sebelum mitranya
-- diketahui. Itu pula yang membuat tagihan tidak bisa terbit di 'diminta', dan
-- yang membuat C2 menyisipkan pembayaran SESUDAH 'mitra_siap'.
--
-- Karena itu pilihan mitra harus punya tempat tinggal di baris permintaan.
alter table public.booking_requests
  add column partner_id uuid references public.partners(id);

comment on column public.booking_requests.partner_id is
  'Mitra yang dipilih admin saat status mitra_siap. Disalin ke sessions.partner_id '
  'pada konfirmasi. NULL selama masih dicarikan.';

-- Keadaan 'mitra_siap' yang tidak punya mitra adalah keadaan yang berbohong:
-- layarnya menyebut "bidan siap" sementara tidak ada seorang pun yang
-- ditugaskan. CHECK, bukan trigger — invarian bentuk baris paling murah
-- ditegakkan di tempat ia hidup.
--
-- DAFTARNYA DUA STATUS, BUKAN SATU. Draf pertama menulis
-- `status <> 'mitra_siap' or partner_id is not null`, dan itu bocor tepat satu
-- langkah sesudah tempat ia menjaga: begitu permintaan berpindah ke
-- 'dikonfirmasi', `partner_id` boleh menjadi NULL lagi tanpa satu pun keluhan
-- — sementara `konfirmasi_permintaan()` MEMBACA kolom itu untuk menentukan
-- siapa yang datang.
--
-- Ditulis sebagai DAFTAR EKSPLISIT, bukan perbandingan urutan enum
-- (`status >= 'mitra_siap'`). Urutan enum sesudah C1 adalah
-- diminta < mencari_mitra < mitra_siap < dikonfirmasi < ditolak < dibatalkan_klien,
-- sehingga `>=` akan ikut menuntut mitra pada 'dibatalkan_klien' — termasuk
-- pembatalan dari 'diminta' yang memang tidak pernah punya mitra. Perbandingan
-- urutan atas enum yang urutannya ditentukan urusan lain adalah pagar yang
-- berubah arti setiap kali ada nilai baru disisipkan.
alter table public.booking_requests
  add constraint booking_requests_mitra_siap_bermitra
  check (status not in ('mitra_siap', 'dikonfirmasi') or partner_id is not null);
