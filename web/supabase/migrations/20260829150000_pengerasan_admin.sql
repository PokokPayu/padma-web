-- ============================================================================
-- PENGERASAN SEBELUM PANEL ADMIN
-- ============================================================================
-- Panel admin (Plan 3A) akan menulis ke hampir semua tabel operasional. Sebelum
-- medan tulis itu dibuka, tiga hak berbahaya dicabut dan tiga cacat ditutup.
--
-- Catatan penomoran: berkas ini sengaja diberi cap waktu 15:00:00 agar berjalan
-- SESUDAH 20260829130000_passport_penjaga.sql — di sanalah `partner_publik`
-- dibuat, dan bagian (3) di bawah menggantinya. `npx supabase migration new`
-- memakai jam dinding sungguhan (pagi), yang akan menempatkannya SEBELUM
-- migration itu dan membuat `db reset` gagal "view already exists".

-- (1) TRUNCATE tidak pernah difilter RLS.
--     Migration cabut_grant_anon_berlebih sudah menuliskan argumen ini, tetapi
--     hanya menerapkannya pada `anon`. Terverifikasi hari ini: `authenticated`
--     — yaitu SETIAP pengguna login, termasuk klien — masih memegang TRUNCATE
--     pada 17 tabel, termasuk clients, sessions, service_rates, honor_marks.
--     Untuk operasi itu RLS bukan lapisan kedua; tidak ada lapisan sama sekali.
--
--     Hanya TRUNCATE yang dicabut: klien, admin, dan owner login sebagai peran
--     SQL yang SAMA, jadi mencabut select/insert/update dari `authenticated`
--     akan ikut melumpuhkan staf. Tidak ada satu pun alur produk yang
--     men-TRUNCATE tabel — pembersihan test memakai service role.
revoke truncate on all tables in schema public from authenticated;
alter default privileges in schema public revoke truncate on tables from authenticated;
alter default privileges for role postgres in schema public
  revoke truncate on tables from authenticated;

-- (2) Penghapusan rekam medis.
--     Terverifikasi: admin memegang DELETE pada sessions, dan menghapus satu
--     baris clients menyapu sessions/client_packages/booking_requests/
--     client_invites lewat cascade. Klinik tidak punya alur bisnis "hapus
--     rekam medis" — pembatalan diwakili status `batal`.
--     Dicabut di lapis HAK TABEL (bukan hak kolom): hak kolom sudah tiga kali
--     mematahkan `select *`, sedangkan pencabutan tingkat tabel untuk satu
--     verba tidak menyentuh select/insert/update sama sekali.
--     `service_role` tidak ikut tersentuh: itulah jalur seed & pembersihan test.
revoke delete on public.sessions        from authenticated;
revoke delete on public.clients         from authenticated;
revoke delete on public.client_packages from authenticated;
revoke delete on public.screenings      from authenticated;
-- booking_requests TETAP boleh dihapus staf: ia antrean, bukan rekam medis.

-- (3) partner_publik menyembunyikan riwayat.
--     View lama menyaring `aktif = true`, sehingga menonaktifkan seorang bidan
--     menghapus namanya dari riwayat sesi SELURUH klien — berganti "Tim PADMA"
--     tanpa error apa pun. Yang dibutuhkan klien adalah NAMA untuk riwayat,
--     bukan daftar bidan yang sedang aktif. Daftar mitra aktif untuk penjadwalan
--     dibaca staf langsung dari `partners` (mereka memang berhak).
--     security_invoker = off tetap dipertahankan: view inilah batas kolomnya,
--     dan klien memang tidak punya hak baca atas `partners`.
create or replace view public.partner_publik
  with (security_invoker = off) as
  select id, nama from public.partners;

revoke all on public.partner_publik from anon;
grant select on public.partner_publik to authenticated;

-- (4) sessions.updated_at tidak pernah berubah (tidak ada trigger sama sekali).
--     Panel admin akan menampilkan "diperbarui kapan"; tanpa trigger, kolom itu
--     berbohong sejak baris dibuat.
create or replace function public.sentuh_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Fungsi baru wajib tertutup untuk public & anon (lihat migration
-- fail_closed_sequence_fungsi): PostgREST mengekspos setiap fungsi public
-- sebagai RPC.
revoke execute on function public.sentuh_updated_at() from public, anon;

create trigger trg_sessions_updated_at
  before update on public.sessions
  for each row execute function public.sentuh_updated_at();

-- (5) Allowlist host video.
--     Plan 4 keputusan E menjanjikan allowlist; pg_constraint membuktikan ia
--     tidak pernah ada. Belum berbahaya karena reader memakai pemutar tiruan,
--     tetapi Plan 3B akan memberi medan URL bebas kepada admin — dan
--     `javascript:` / `data:` tinggal menunggu satu halaman yang merendernya.
--     Seed memakai `https://vimeo.com/...`, jadi lolos apa adanya.
alter table public.material_videos
  add constraint material_videos_host_terproteksi
  check (
    url ~ '^https://(player\.)?vimeo\.com/'
    or url ~ '^https://[a-z0-9-]+\.cloudflarestream\.com/'
    or url ~ '^https://customer-[a-z0-9]+\.cloudflarestream\.com/'
  );
