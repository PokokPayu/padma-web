-- Alarm "menunggu tarif transport" berhenti menghitung sesi yang DIBATALKAN KLIEN.
--
-- View `sesi_menunggu_tarif_transport` menyaring batal dengan SATU nilai,
-- `s.status <> 'dibatalkan_padma'`. Sejak C3-a (`20260913*`) `session_status`
-- punya anggota batal kedua, `dibatalkan_klien`, dan sesi >20 km yang
-- dibatalkan klien ikut menyalakan alarm di dasbor admin dan daftar
-- `/owner/transport` — owner diminta menetapkan nominal untuk kunjungan yang
-- tidak akan pernah terjadi. Cacat ini sudah dicatat (dan sengaja tidak
-- diperbaiki) di komentar `20260914130000_menunggu_tarif_hanya_tanpa_nominal`.
--
-- Himpunan batal yang ditulis di sini HARUS sama dengan `SESI_BATAL`
-- (`src/lib/jadwal/status.ts`, diturunkan dari `Record` menyeluruh
-- `SESI_TIDAK_TERJADI`). SQL tidak punya padanan `Record` yang menolak build,
-- jadi kesetaraannya dijaga uji: `tests/owner-transport.test.ts` menyemai satu
-- sesi untuk SETIAP anggota `SESI_BATAL` dan menuntut tak satu pun muncul di
-- view. Anggota batal berikutnya memerahkan uji itu sampai baris di bawah
-- ikut menyebutnya.
--
-- `tidak_hadir` sengaja TIDAK masuk: sesi itu masih ditagih (keputusan
-- tagihan no-show menunggu P3), jadi nominal transportnya tetap dibutuhkan.
--
-- Pembaca view yang lain tidak berubah perilakunya: `daftarTagihanAdmin()`
-- sudah menyaring `FILTER_SESI_BATAL` sebelum mencocokkan id dengan view ini,
-- dan rekap owner hanya menyebutnya di komentar.
--
-- Selain predikat status, definisi di bawah disalin APA ADANYA dari
-- `20260914130000` (kolom, urutan, `security_invoker = off`, gerbang peran),
-- karena `create or replace view` menuntut daftar kolom yang sama. Revoke
-- diulang sebelum grant karena alasan yang sama dengan migrasi itu: Supabase
-- memberi hak bawaan penuh atas objek di `public`, dan `grant` menambah.

create or replace view public.sesi_menunggu_tarif_transport
  with (security_invoker = off) as
  select s.id, c.nama as nama_klien, s.tanggal
    from public.sessions s
    join public.clients c on c.id = s.client_id
   where s.jenjang = 'di_atas_20'
     and s.status not in ('dibatalkan_padma', 'dibatalkan_klien')
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
