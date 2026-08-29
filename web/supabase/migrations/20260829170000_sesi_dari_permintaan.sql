-- ============================================================================
-- PENAUT PERMINTAAN JADWAL -> SESI
-- ============================================================================
-- Konfirmasi permintaan jadwal adalah DUA tulisan: `booking_requests.status`
-- menjadi 'dikonfirmasi', dan satu baris `sessions` baru lahir. Tanpa kolom
-- penaut, tidak ada satu pun fakta di basis data yang menghubungkan keduanya —
-- dan akibatnya dua admin yang menekan "Konfirmasi" pada permintaan yang sama
-- dalam detik yang sama melahirkan DUA sesi untuk satu permintaan. Klien
-- kedatangan bidan dua kali, dan tidak ada error apa pun yang memberi tahu.
--
-- Klaim status ('menunggu' -> 'dikonfirmasi' dengan WHERE status='menunggu')
-- sudah menyerialkan balapan itu di tingkat baris. Index unik di bawah adalah
-- jaring KEDUA yang tidak bergantung pada urutan pernyataan mana pun: percobaan
-- menautkan sesi kedua ke permintaan yang sama gagal 23505, bukan menggandakan.
--
-- Nama kolomnya sengaja `booking_request_id`: money firewall struktural
-- (tests/money-firewall-struktural.test.ts) memindai nama kolom dengan regex
-- per-kata, dan nama ini tidak menyentuh satu pun polanya.

-- Tanpa `on delete`: FK-nya sengaja MENAHAN penghapusan permintaan yang sudah
-- menjadi sesi. Permintaan jadwal memang antrean, bukan rekam medis — tetapi
-- begitu ia berubah menjadi sesi, ia menjadi asal-usul sesi itu. `set null`
-- akan menghapus asal-usulnya diam-diam sekaligus melepas jaring unik di atas.
alter table public.sessions
  add column booking_request_id uuid references public.booking_requests(id);

create unique index sessions_booking_request_unik
  on public.sessions (booking_request_id)
  where booking_request_id is not null;

comment on column public.sessions.booking_request_id is
  'Permintaan jadwal yang melahirkan sesi ini; NULL untuk sesi yang dijadwalkan admin langsung.';
