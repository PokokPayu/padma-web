-- ============================================================================
-- SESI MENUNGGU TARIF TRANSPORT — anti-join di SQL, batas kolom yang sama
-- ============================================================================
-- Ruling 12 (coordinator, Task 8 fix round 1) — dua temuan, satu perbaikan.
--
-- TEMUAN 1: `hitungMenungguTarifTransport()` (TypeScript) menggerbangi hasilnya
-- dengan `user_role() = 'owner'`, karena RLS "transport_khusus: hanya owner"
-- membuat admin tidak bisa membaca tabel itu sama sekali — SELECT kosong
-- untuk SETIAP baris, bukan karena barisnya tidak ada. Gerbang itu
-- MEMINDAHKAN masalah, bukan menutupnya: bagi admin angkanya jadi KONSTANTA
-- nol, bukan saringan — dan admin, bukan owner, yang sehari-hari mengerjakan
-- antrean klinik. "Badge identik dengan daftarnya" jadi janji hampa untuk
-- peran yang justru menjalankan pekerjaannya.
--
-- TEMUAN 2: `ambilSesiMenungguTarif()` menembak `.in("session_id", [...])`
-- berisi sampai ribuan UUID dalam satu query string, dan TIDAK dipaginasi —
-- beda dari `ambilTarifTransport()` dua fungsi di atasnya, yang dipaginasi
-- justru karena `max_rows = 1000` (supabase/config.toml) memotong bacaan
-- SENYAP tanpa satu pun tanda "terpotong". Diurutkan menaik menurut tanggal,
-- potongan diam-diam itu membuang sesi TERBARU — yang justru paling mungkin
-- masih benar-benar menunggu.
--
-- Keduanya ditutup oleh SATU view yang melakukan anti-join-nya DI SQL, bukan
-- di TypeScript: proyek ini sudah punya polanya dua kali (`partner_publik`,
-- `harga_publik`) — view berkolom SEMPIT dengan `security_invoker = off`,
-- dipakai JUSTRU karena peran pemanggilnya tidak boleh, dan tidak perlu,
-- punya hak baca tabel dasarnya (`transport_khusus`, di sini).
--
-- Proyeksinya HANYA tiga kolom: id, nama_klien, tanggal. NOL NOMINAL —
-- `honor_mitra`/`tarif_klien` TIDAK PERNAH melintasi batas ini, jadi money
-- firewall (tests/money-firewall-struktural.test.ts) tetap utuh tanpa satu
-- pun pengecualian kolom.
--
-- `where public.user_role() in ('admin','owner')`: view inilah batas
-- KOLOMnya, tapi GRANT SQL saja tidak cukup sebagai batas PERAN — admin,
-- owner, dan klien login sebagai SATU peran SQL yang sama (`authenticated`).
-- Predikat inilah yang mencegah klien membaca keberadaan & tanggal sesi
-- klien LAIN yang kebetulan berjarak >20 km. `user_role()` tetap membaca
-- identitas PEMANGGIL yang sebenarnya (lewat `auth.uid()` / klaim JWT
-- request, disetel PostgREST per request) walau view berjalan dengan hak
-- pemilik — `security_invoker = off` membebaskan AKSES TABEL, bukan
-- identitas sesi.
--
-- Cap waktu ditulis MANUAL dan lebih besar dari berkas terakhir
-- (20260907130000_geocode_cache.sql): `supabase migration new` memakai jam
-- dinding dan pernah menyelipkan migration ke tengah riwayat sehingga
-- `db reset` gagal.

create view public.sesi_menunggu_tarif_transport
  with (security_invoker = off) as
  select s.id, c.nama as nama_klien, s.tanggal
    from public.sessions s
    join public.clients c on c.id = s.client_id
   where s.jenjang = 'di_atas_20'
     and s.status <> 'batal'
     and not exists (
       select 1 from public.transport_khusus tk where tk.session_id = s.id
     )
     and public.user_role() in ('admin', 'owner');

revoke all on public.sesi_menunggu_tarif_transport from anon;
grant select on public.sesi_menunggu_tarif_transport to authenticated;

comment on view public.sesi_menunggu_tarif_transport is
  'Sesi >20 km, bukan batal, tanpa baris transport_khusus — satu-satunya '
  'definisi "menunggu tarif khusus", dipakai badge admin (hitungAntrean) '
  'MAUPUN daftarnya (owner/transport) lewat satu query yang sama, sehingga '
  'keduanya tidak bisa berpisah diam-diam. security_invoker = off disengaja: '
  'admin tidak punya, dan tidak perlu, hak baca transport_khusus — view '
  'inilah batas kolomnya (id, nama_klien, tanggal; NOL NOMINAL). Predikat '
  '`user_role() in (admin,owner)` menjaga batas PERAN: ketiga peran aplikasi '
  'login sebagai satu peran SQL authenticated yang sama, dan klien tidak '
  'boleh membaca antrean sesi klien lain.';
