-- ============================================================================
-- FAIL-CLOSED DEFAULT PRIVILEGES UNTUK SEQUENCE & FUNCTION
-- ============================================================================
-- Temuan auditor, direproduksi langsung di Postgres lokal (28 Agu 2026):
-- migration `cabut_grant_anon_berlebih` menutup sumber kebocoran HANYA untuk
-- TABLES. SEQUENCES dan FUNCTIONS masih memakai default Supabase, dan
-- default itu masih memberi `anon`:
--
--   begin;
--   create table public.zz_probe(id bigserial primary key, x text);
--   create function public.zz_probe_fn() returns int
--     language sql security definer as $$ select 1 $$;
--   select has_sequence_privilege('anon','public.zz_probe_id_seq','USAGE'),   -- t
--          has_sequence_privilege('anon','public.zz_probe_id_seq','SELECT'),  -- t
--          has_sequence_privilege('anon','public.zz_probe_id_seq','UPDATE'),  -- t
--          has_function_privilege('anon','public.zz_probe_fn()','EXECUTE'),   -- t
--          has_table_privilege('anon','public.zz_probe','SELECT');            -- f  <-- hanya TABEL yang sudah benar
--   rollback;
--
--   -- pg_default_acl, pemilik postgres, schema public:
--   --   objtype S -> {postgres=rwU, anon=rwU, authenticated=rwU, service_role=rwU}
--   --   objtype f -> {postgres=X,   anon=X,   authenticated=X,   service_role=X}
--   --   objtype r -> anon SUDAH dicabut (migration sebelumnya)
--
-- Kenapa ini ranjau, bukan sekadar kerapian katalog:
--
--   (a) FUNCTION — ini yang berbahaya. Fungsi `SECURITY DEFINER` berjalan
--       dengan hak PEMILIKNYA (postgres) sehingga MENEMBUS RLS dan menembus
--       seluruh pencabutan hak tabel yang susah payah dipasang migration
--       sebelumnya. Plan 2 menambahkan RPC baru (skrining publik, klaim
--       undangan, inbox admin). Setiap RPC itu lahir OTOMATIS bisa dipanggil
--       `anon` — dan anon key memang tertanam di bundel browser, jadi
--       "dipanggil anon" berarti "dipanggil siapa saja di internet". Satu
--       fungsi lupa dikunci = seluruh money firewall & isolasi data pasien
--       dilewati lewat satu panggilan.
--       Perhatikan kebocorannya BERLAPIS DUA: selain grant `anon` dari
--       default privileges Supabase, Postgres sendiri memberi EXECUTE ke
--       PUBLIC pada setiap fungsi baru (`proacl` berisi `=X/postgres`).
--       Mencabut `anon` saja tidak menutup apa pun selama PUBLIC memegangnya.
--
--   (b) SEQUENCE — `anon=rwU` berarti anon boleh `nextval`/`setval` atas
--       sequence milik tabel yang tabelnya sendiri sudah tertutup rapat.
--       `setval(..., 1)` memaksa tabrakan primary key: DoS tulis pada alur
--       booking/skrining tanpa pernah menyentuh tabelnya. `currval`/SELECT
--       membocorkan laju bisnis (berapa banyak skrining masuk). RLS tidak
--       pernah menyaring sequence — untuk objek ini hak objek adalah
--       SATU-SATUNYA penjaga, sama seperti kasus TRUNCATE pada tabel.

-- ===== 1) TUTUP SUMBERNYA: default privileges SEQUENCES & FUNCTIONS =====
-- Pola mengikuti migration `cabut_grant_anon_berlebih`: bentuk tanpa `for
-- role` berlaku untuk current_user, dan `for role postgres` ditulis eksplisit
-- supaya invariannya tidak bergantung pada peran yang kebetulan menjalankan
-- migration.
alter default privileges in schema public
  revoke all on sequences from anon;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;

-- `revoke all on functions` = mencabut EXECUTE.
alter default privileges in schema public
  revoke all on functions from public, anon;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon;

-- Dua baris berikutnya TIDAK boleh dihapus sebagai "duplikat" — bentuknya
-- sengaja TANPA `in schema`, dan itu satu-satunya yang menutup pintu PUBLIC.
--
-- Diuji langsung (PostgreSQL 17.6, 28 Agu 2026): baris `pg_default_acl` yang
-- BERSKEMA di-MERGE di atas `acldefault()`, bukan menggantikannya. Karena
-- `acldefault()` untuk fungsi berisi `=X` (EXECUTE untuk PUBLIC), mencabut
-- PUBLIC di baris berskema TIDAK berpengaruh:
--
--   alter default privileges for role postgres in schema public
--     revoke execute on functions from public;
--   -- pg_default_acl(public,f) = {postgres=X,authenticated=X,service_role=X}  (PUBLIC memang hilang di baris ini)
--   create function public.zz_a() ...;
--   -- proacl                    = {=X/postgres,postgres=X,authenticated=X,service_role=X}   <-- PUBLIC HIDUP LAGI
--   -- has_function_privilege('anon', 'zz_a()', 'EXECUTE') = t
--
-- Baris GLOBAL (defaclnamespace = 0) menggantikan `acldefault()` itu sendiri,
-- sehingga PUBLIC benar-benar lenyap:
--
--   alter default privileges for role postgres revoke execute on functions from public;
--   -- pg_default_acl(GLOBAL,f)  = {postgres=X}
--   create function public.zz_pub() ...;
--   -- proacl                    = {postgres=X,authenticated=X,service_role=X}
--   -- anon=f, authenticated=t, service_role=t
--
-- Jadi kombinasinya yang bekerja: baris GLOBAL membuang PUBLIC & anon, baris
-- BERSKEMA `public` mengembalikan `authenticated` + `service_role` yang memang
-- dibutuhkan. Tanpa yang GLOBAL, seluruh migration ini tidak menutup apa-apa
-- untuk fungsi.
--
-- Radius dampaknya disadari dan DIINGINKAN: fungsi yang dibuat `postgres` di
-- schema SELAIN `public` kini lahir hanya dengan `postgres=X` — tertutup
-- rapat, harus di-grant eksplisit. Itu justru arah fail-closed yang sama.
-- Objek milik role lain (`supabase_admin`, `supabase_auth_admin`) tidak
-- tersentuh; baris default ACL mereka bukan milik kita (lihat catatan di
-- bagian 4).
alter default privileges
  revoke all on functions from public, anon;
alter default privileges for role postgres
  revoke all on functions from public, anon;

-- Hak default `authenticated` dan `service_role` SENGAJA DIBIARKAN UTUH,
-- persis seperti keputusan migration sebelumnya untuk tabel:
--   - `authenticated` adalah peran semua pengguna login (klien, admin, owner).
--     RPC yang memang untuk pengguna login harus tetap jalan tanpa satu baris
--     grant tambahan per fungsi; pembatas siapa-boleh-apa tetap RLS + cek
--     peran di dalam fungsinya.
--   - `service_role` adalah jalur resmi server (skrining publik, penautan
--     klien, seed). Mencabutnya akan melumpuhkan alur yang justru dirancang
--     untuk menggantikan akses langsung dari browser.

-- ===== 2) BERSIHKAN OBJEK YANG SUDAH TERLANJUR LAHIR =====
-- Default privileges hanya berlaku ke depan. Empat fungsi yang sudah ada
-- (`user_role`, `handle_new_user`, `guard_profile_role`,
-- `normalize_client_email`) saat ini memegang `anon=X` DAN `=X` (PUBLIC);
-- dua di antaranya SECURITY DEFINER. `user_role()` bahkan terekspos sebagai
-- RPC oleh PostgREST — anon bisa memanggilnya hari ini.
-- `all routines` dipakai (bukan `all functions`) agar prosedur dan fungsi
-- agregat ikut tersapu bila kelak ada.
revoke execute on all routines in schema public from public, anon;
revoke all on all sequences in schema public from anon;

-- ===== 3) LEPASKAN `anon` DARI POLICY YANG MEMANGGIL user_role() =====
-- Interaksi yang ditemukan saat menguji langkah 2, dan wajib ditangani
-- bersamanya: policy staf dibuat `to public`, dan `public` MENCAKUP `anon`.
-- Karena `phases`/`services`/`packages` sengaja dibiarkan bisa dibaca anon
-- (katalog publik untuk landing Plan 2), SELECT anon atas ketiganya ikut
-- mengevaluasi policy `staf kelola` — yang memanggil `user_role()`. Begitu
-- EXECUTE dicabut, hasilnya bukan "0 baris" melainkan:
--
--   set local role anon; select count(*) from public.phases;
--   ERROR:  permission denied for function user_role
--
-- Itu akan melumpuhkan landing publik Plan 2. Perbaikannya bukan
-- mengembalikan EXECUTE untuk anon (itu membatalkan seluruh migration ini),
-- melainkan MEMPERSEMPIT policy staf menjadi `to authenticated`.
--
-- Perubahan ini MENGENCANGKAN, bukan melonggarkan: `user_role()` mengembalikan
-- `coalesce(..., 'klien')`, jadi bagi anon hasilnya tidak pernah admin/owner
-- dan policy-policy ini memang tidak pernah meloloskan anon satu baris pun.
-- Yang berubah hanya: anon tidak lagi ikut dievaluasi terhadapnya sama sekali.
-- `service_role` tidak terpengaruh — ia BYPASSRLS.
alter policy "settings: staf"                 on public.app_settings      to authenticated;
alter policy "booking: staf"                  on public.booking_requests  to authenticated;
alter policy "client_packages: staf"          on public.client_packages   to authenticated;
alter policy "clients: staf"                  on public.clients           to authenticated;
alter policy "honor: hanya owner"             on public.honor_marks       to authenticated;
alter policy "chapters: staf"                 on public.material_chapters to authenticated;
alter policy "video: staf"                    on public.material_videos   to authenticated;
alter policy "materials: staf kelola"         on public.materials         to authenticated;
alter policy "packages: staf kelola"          on public.packages          to authenticated;
alter policy "partners: staf"                 on public.partners          to authenticated;
alter policy "phases: staf kelola"            on public.phases            to authenticated;
alter policy "profil: baca sendiri atau staf" on public.profiles          to authenticated;
alter policy "profil: staf ubah"              on public.profiles          to authenticated;
alter policy "screenings: staf"               on public.screenings        to authenticated;
alter policy "rates: hanya owner"             on public.service_rates     to authenticated;
alter policy "services: staf kelola"          on public.services          to authenticated;
alter policy "sessions: staf"                 on public.sessions          to authenticated;

-- Trigger tidak terpengaruh pencabutan EXECUTE: Postgres memeriksa hak atas
-- fungsi trigger saat trigger DIBUAT, bukan saat menyala. Diprobe langsung:
--   revoke execute on function public.zz_trg() from public, anon;
--   set local role anon; insert into public.zz_t(id) values (1);  -- INSERT 0 1
-- Jadi `handle_new_user`, `guard_profile_role`, dan `normalize_client_email`
-- tetap bekerja untuk registrasi mandiri lewat anon key.

-- ===== 4) ATURAN WAJIB UNTUK MIGRATION PLAN 2 (dan seterusnya) =====
--
--   [F] SETIAP FUNGSI/RPC BARU wajib menyatakan haknya secara EKSPLISIT:
--
--         create function public.nama_rpc(...) ... ;
--         revoke execute on function public.nama_rpc(...) from public, anon;
--         grant  execute on function public.nama_rpc(...) to authenticated;
--
--       Baris `revoke` tetap DITULIS meski default privileges di atas sudah
--       menanganinya. Alasannya: default privileges hanya berlaku bagi objek
--       yang dibuat peran yang defaultnya kita ubah. Baris `pg_default_acl`
--       milik `supabase_admin` untuk schema `public` masih memberi anon dan
--       TIDAK BISA kita ubah — `alter default privileges for role
--       supabase_admin ...` sebagai postgres ditolak: "permission denied to
--       change default privileges" (diuji). Begitu pula baris
--       `postgres @ schema storage` yang masih memberi anon; ia dibiarkan
--       karena belum ada satu pun objek PADMA di schema `storage`, dan bila
--       nanti ada, aturan [F]/[S] ini yang berlaku.
--       Menulis revoke eksplisit membuat hak fungsi benar tanpa bergantung
--       pada siapa yang kebetulan menjalankan migration.
--
--       Fungsi `SECURITY DEFINER` yang harus dipanggil pengunjung anonim
--       (mis. submit skrining publik) TETAP tidak boleh diberi ke anon.
--       Keputusan desain yang sudah dicatat migration `cabut_grant_anon_berlebih`
--       berlaku: jalur publik ditulis SERVER dengan service role, bukan
--       browser dengan anon key — supaya bisa dibatasi rate, divalidasi, dan
--       tidak bisa dipanggil berulang dari luar.
--
--   [S] TABEL PUBLIK BARU pakai `id uuid primary key default gen_random_uuid()`,
--       BUKAN `serial`/`bigserial`/`generated as identity`. Tabel tanpa
--       sequence tidak punya objek sequence untuk dibocorkan sama sekali —
--       masalahnya dihilangkan, bukan ditambal. Bonusnya sejalan dengan skema
--       yang ada (semua tabel Plan 1 sudah uuid) dan id-nya tidak bisa
--       ditebak/diberurutkan oleh penyerang. Bila sebuah sequence benar-benar
--       dibutuhkan, tulis `revoke all on sequence public.<nama> from public, anon;`
--       di migration yang sama.
--
-- Kedua aturan dijaga otomatis oleh tests/hak-default-sequence-fungsi.test.ts:
-- test itu merah bila `pg_default_acl` kembali memberi anon pada objtype S/f,
-- DAN merah bila ada fungsi/sequence NYATA di schema public yang bisa
-- disentuh anon — termasuk objek yang belum ada saat migration ini ditulis.
