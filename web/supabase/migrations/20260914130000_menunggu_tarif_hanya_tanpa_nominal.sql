-- ============================================================================
-- "MENUNGGU TARIF" DIDEFINISIKAN ULANG — ALARM YANG BISA DIPADAMKAN
-- ============================================================================
-- View `sesi_menunggu_tarif_transport` (migrasi `20260907140000`) lahir dengan
-- definisi yang BENAR untuk doktrin waktu itu: sesi `di_atas_20` tanpa baris
-- `transport_khusus` = sesi yang nominalnya belum pernah ditetapkan siapa pun.
-- Selama CHECK `transport_rates_bukan_per_kasus` hidup, kedua kalimat itu
-- memang satu hal yang sama — `transport_khusus` adalah SATU-SATUNYA tempat
-- nominal >20 km bisa berada.
--
-- Migrasi `20260914100000_tarif_dasar_di_atas_20` MENCABUT constraint itu dan
-- memberi `di_atas_20` tarif DASAR di `transport_rates`. Sejak saat itu kedua
-- kalimat di atas BERPISAH, dan view ini menjawab pertanyaan yang salah:
--
--   * Yang ia jawab sekarang: "sesi jarak jauh mana yang belum punya PENIMPA
--     per kasus" — dan jawabannya adalah SETIAP sesi jarak jauh yang normal,
--     termasuk yang tagihannya sudah terbit, sudah dibayar, dan sudah lunas
--     atas dasar tarif dasar.
--   * Yang seharusnya ia jawab: "sesi jarak jauh mana yang TIDAK PUNYA NOMINAL
--     SAMA SEKALI" — tidak ada penimpa DAN tidak ada tarif dasar yang berlaku
--     pada tanggalnya.
--
-- Beda itu bukan soal ketelitian angka badge. Badge dasbor admin
-- (`hitungMenungguTarifTransport`) dan daftar `/owner/transport`
-- (`ambilSesiMenungguTarif`) keduanya membaca view ini, jadi keduanya jadi
-- ALARM PERMANEN yang tidak bisa dipadamkan oleh keadaan sehat mana pun. Dan
-- satu-satunya cara memadamkannya — mengisi `transport_khusus` — adalah pintu
-- SATU ARAH: tabel itu ber-primary-key `session_id` dan trigger
-- `kunci_transport_khusus` menolak UPDATE, jadi nominal yang telanjur diisi
-- tidak bisa dicabut lagi. Sesudah itu rekap owner (`hitungRekap()`,
-- `lib/owner/rekap.ts`) melaporkan nominal PENIMPA untuk sesi yang kliennya
-- sudah membayar tarif DASAR — pembukuan dan kas berselisih, dan selisihnya
-- lahir dari admin yang justru sedang membereskan antreannya.
--
-- ===== APA YANG DIPERTAHANKAN, DAN KENAPA =====
-- Seluruh sifat view lama ditiru PERSIS dari `20260907140000`, karena setiap
-- satunya adalah batas keamanan yang alasannya masih berlaku sepenuhnya:
--
--   * `security_invoker = off` — admin tidak punya, dan tidak perlu, hak baca
--     `transport_khusus`/`transport_rates` (RLS "hanya owner"). View inilah
--     batas KOLOMnya.
--   * `public.user_role() in ('admin','owner')` DI DALAM view — GRANT SQL saja
--     bukan batas PERAN: admin, owner, dan klien login sebagai satu peran SQL
--     `authenticated` yang sama. Predikat inilah yang mencegah klien membaca
--     keberadaan & tanggal sesi klien lain. `user_role()` tetap membaca
--     identitas pemanggil walau view berjalan dengan hak pemilik —
--     `security_invoker = off` membebaskan AKSES TABEL, bukan identitas sesi.
--   * Proyeksi NOL NOMINAL (`id, nama_klien, tanggal`) — `tarif_klien` dan
--     `honor_mitra` tidak melintasi batas ini, sehingga
--     `tests/money-firewall-struktural.test.ts` tetap utuh tanpa satu pun
--     pengecualian kolom. Perhatikan bahwa anti-join baru di bawah MEMBACA
--     `transport_rates` tetapi tidak memproyeksikan satu kolom pun darinya:
--     yang keluar hanyalah fakta "ada/tidak ada", bukan angkanya.
--   * `revoke ... from public, anon, authenticated` SEBELUM `grant select ...
--     to authenticated` — Supabase memberi hak bawaan PENUH atas setiap objek
--     baru di skema `public`, termasuk VIEW, dan `grant` MENAMBAH alih-alih
--     MENGGANTIKAN. Diulang di sini karena migrasi ini memakai
--     `create or replace view`, dan pembaca berikutnya tidak boleh harus
--     membuktikan sendiri bahwa hak lama masih utuh.
--
-- `s.status <> 'dibatalkan_padma'` DISALIN APA ADANYA dari view yang sedang
-- berjalan, BUKAN dari teks migrasi `20260907140000` (yang masih menulis
-- literal `'batal'`): nilai enum itu di-`rename` oleh `20260909101000`, dan
-- view menyimpan OID nilai enum sehingga definisinya ikut berubah sendiri
-- (lihat probe di `20260909145000_literal_batal_tertinggal`). Menyalin teks
-- migrasi lama di sini akan GAGAL — nilai `'batal'` sudah tidak ada.
-- Bahwa predikat itu menyebut SATU nilai batal sementara `session_status`
-- kini punya `dibatalkan_klien` juga adalah cacat TERSENDIRI yang sengaja
-- TIDAK ikut diubah di sini: memperbaikinya berarti mengubah himpunan baris
-- view untuk alasan yang tidak ada hubungannya dengan tarif dasar, dan
-- perubahan itu layak punya migrasi & pembahasannya sendiri.
--
-- ===== KENAPA `not exists`, BUKAN "ambil berlaku_sejak TERBESAR" =====
-- Yang ditanyakan view ini adalah KEBERADAAN nominal, bukan besarannya. Untuk
-- keberadaan, "tidak ada satu pun baris `di_atas_20` yang `berlaku_sejak <=
-- s.tanggal`" setara persis dengan "baris berlaku_sejak terbesar yang <=
-- s.tanggal tidak ada" — dan bentuk `not exists` tidak perlu memproyeksikan
-- satu kolom nominal pun untuk menjawabnya. Besarannya sendiri tetap dihitung
-- di satu tempat yang sama seperti sebelumnya: `tarifTransportPadaTanggal()`
-- (`lib/transport/tarif.ts`), dipakai lapisan tagihan maupun rekap owner.
--
-- Cap waktu ditulis MANUAL dan lebih besar dari
-- `20260914120000_harga_klien_untuk_staf.sql` — `supabase migration new`
-- memakai jam dinding dan pernah menyelipkan migrasi ke tengah riwayat.

create or replace view public.sesi_menunggu_tarif_transport
  with (security_invoker = off) as
  select s.id, c.nama as nama_klien, s.tanggal
    from public.sessions s
    join public.clients c on c.id = s.client_id
   where s.jenjang = 'di_atas_20'
     and s.status <> 'dibatalkan_padma'
     and not exists (
       select 1 from public.transport_khusus tk where tk.session_id = s.id
     )
     and not exists (
       select 1 from public.transport_rates tr
        where tr.jenjang = 'di_atas_20'
          and tr.berlaku_sejak <= s.tanggal
     )
     and public.user_role() in ('admin', 'owner');

revoke all on public.sesi_menunggu_tarif_transport from public, anon, authenticated;
grant select on public.sesi_menunggu_tarif_transport to authenticated;

comment on view public.sesi_menunggu_tarif_transport is
  'Sesi >20 km, bukan batal, yang TIDAK PUNYA NOMINAL SAMA SEKALI: tanpa baris '
  'transport_khusus DAN tanpa baris transport_rates di_atas_20 yang berlaku '
  'pada tanggal sesi. Sejak migrasi menunggu_tarif_hanya_tanpa_nominal, '
  'ketiadaan transport_khusus SAJA tidak lagi berarti menunggu — tarif DASAR '
  'di_atas_20 (migrasi tarif_dasar_di_atas_20) sudah cukup untuk menagih dan '
  'membayar, dan transport_khusus hanyalah PENIMPA opsional. Tetap satu-satunya '
  'definisi "menunggu tarif" untuk badge admin (hitungMenungguTarifTransport) '
  'MAUPUN daftar owner (ambilSesiMenungguTarif) lewat satu query yang sama. '
  'security_invoker = off disengaja: admin tidak punya, dan tidak perlu, hak '
  'baca transport_khusus/transport_rates — view inilah batas kolomnya (id, '
  'nama_klien, tanggal; NOL NOMINAL). Predikat user_role() in (admin,owner) '
  'menjaga batas PERAN: ketiga peran aplikasi login sebagai satu peran SQL '
  'authenticated yang sama.';
