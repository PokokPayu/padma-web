-- ============================================================================
-- SESI MENUNGGU JENJANG — sesi SELESAI yang jaraknya tidak pernah diketahui
-- ============================================================================
-- Ruling 24 (coordinator, gelombang perbaikan akhir sebelum merge).
--
-- `sessions.jenjang = null` punya DUA sumber, dan hanya satu yang sudah
-- ditulis komentarnya (lihat `lib/owner/rekap.ts`, sebelum perbaikan ini):
--
--  1. Sesi PRA-MIGRASI — lahir sebelum kolom `jenjang` ada. Sumber yang
--     dipikirkan Task 9: tidak akan pernah terisi retroaktif, dan memang
--     tidak boleh dihukum kehilangan honor variannya.
--
--  2. Sesi BARU yang GEOCODING-nya gagal (Task 6/7) — alamat tidak dikenal
--     OSM, `geocodeAlamat()` memulangkan `null`, admin tetap bisa menugaskan
--     mitra tanpa satu pun galat atau peringatan, dan sesi itu lahir dengan
--     `jenjang = null` yang SEHARUSNYA bisa diperbaiki (`tetapkanJenjang`,
--     `app/admin/sesi/aksi.ts`) — tetapi tidak ada satu tempat pun di
--     aplikasi yang menunjuk sesi mana yang butuh itu.
--
-- `hitungRekap()` memperlakukan `jenjang = null` sebagai NOL transport,
-- SENGAJA, supaya honor varian sesi lama tidak ikut hilang (lihat komentar di
-- sana). Itu keputusan yang benar untuk sumber (1) — tapi untuk sumber (2) ia
-- adalah lubang honor yang senyap total: sesi selesai, `hitungRekap()`
-- menganggapnya SEHAT (honor varian penuh, transport nol, `jumlahTakBertarif`
-- = 0), bidan kurang dibayar, klien kurang ditagih, dan `/owner/rekap`
-- terlihat lengkap sempurna. Spec §5.3: "antrean yang tidak menampilkannya
-- berarti pekerjaan yang hilang."
--
-- View ini menutupnya — persis pola `sesi_menunggu_tarif_transport` (migrasi
-- `20260907140000`, Task 8/Ruling 12-13): kolom SEMPIT, NOL NOMINAL,
-- `security_invoker = off` supaya admin tidak perlu hak baca tambahan apa
-- pun, predikat `user_role() in ('admin','owner')` sebagai batas PERAN (bukan
-- sekadar batas kolom) karena admin, owner, dan klien login sebagai satu
-- peran SQL yang sama (`authenticated`).
--
-- Predikatnya `jenjang is null and status = 'selesai'` — bukan `<> 'batal'`
-- seperti `sesi_menunggu_tarif_transport`. Sesi TERJADWAL yang belum
-- bermitra/berkoordinat memang wajar ber-`jenjang` null (belum ada yang perlu
-- dihitung), dan sesi BATAL tidak pernah menghasilkan honor apa pun — baik
-- satu pun tidak layak masuk antrean ini. Hanya sesi SELESAI yang jenjangnya
-- masih null yang benar-benar berarti "honor sedang dihitung salah hari ini".
--
-- Cap waktu ditulis MANUAL, lebih besar dari migrasi terakhir
-- (20260907140000_sesi_menunggu_tarif.sql): `supabase migration new` memakai
-- jam dinding dan pernah menyelipkan migration ke tengah riwayat sehingga
-- `db reset` gagal.

create view public.sesi_menunggu_jenjang_transport
  with (security_invoker = off) as
  select s.id, c.nama as nama_klien, s.tanggal
    from public.sessions s
    join public.clients c on c.id = s.client_id
   where s.jenjang is null
     and s.status = 'selesai'
     and public.user_role() in ('admin', 'owner');

-- WAJIB revoke SEBELUM grant: Supabase memberi hak bawaan PENUH atas SETIAP
-- objek baru di skema `public` — termasuk VIEW — kepada `anon` MAUPUN
-- `authenticated`, dan `grant select ... to authenticated` MENAMBAH, bukan
-- MENGGANTIKAN. Melewatkan urutan ini sudah sekali memerahkan
-- tests/admin-pengerasan.test.ts pada migrasi sebelumnya di branch ini.
revoke all on public.sesi_menunggu_jenjang_transport from public, anon, authenticated;
grant select on public.sesi_menunggu_jenjang_transport to authenticated;

comment on view public.sesi_menunggu_jenjang_transport is
  'Sesi SELESAI dengan jenjang null — jaraknya tidak pernah diketahui, baik '
  'karena lahir sebelum kolom ini ada maupun karena geocoding sesi baru '
  'gagal (Ruling 24). Satu-satunya definisi "menunggu jenjang ditetapkan", '
  'dipakai badge admin (hitungAntrean). Diperbaiki lewat `tetapkanJenjang` '
  '(app/admin/sesi/aksi.ts) yang sudah ada sejak Task 9 — yang hilang '
  'sebelumnya hanya antrean yang menunjuk sesi mana. security_invoker = off '
  'disengaja: batas kolomnya (id, nama_klien, tanggal; NOL NOMINAL) ada di '
  'view ini, dan predikat `user_role() in (admin,owner)` menjaga batas '
  'PERAN karena ketiga peran aplikasi login sebagai satu peran SQL '
  'authenticated yang sama.';
