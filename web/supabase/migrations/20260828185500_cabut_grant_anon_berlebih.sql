-- ============================================================================
-- CABUT GRANT `anon` YANG BERLEBIH — pertahanan berlapis untuk data pasien
-- ============================================================================
-- Temuan auditor: higienis GRANT masih timpang. `service_rates`, `honor_marks`,
-- dan `material_videos` sudah dicabut hak `anon`-nya (migration harden_rls &
-- gate_material_video), TETAPI `clients`, `sessions`, `screenings`,
-- `materials`, `material_chapters`, dan `profiles` masih memegang GRANT `anon`
-- warisan default Supabase (`alter default privileges ... grant all on tables
-- to anon, authenticated, service_role`). Keamanannya bergantung 100% pada
-- KETIADAAN policy RLS yang mengizinkan anon — satu lapis, bukan dua.
--
-- Kenapa itu bukan kekhawatiran teoretis:
--   (a) Plan 2 menambahkan landing + skrining publik yang menyentuh persis
--       tabel-tabel itu. Satu policy `using (true)` yang keliru — sekali ketik,
--       tanpa perubahan hak apa pun — langsung membuka nama, no. HP, catatan
--       sesi, dan rekomendasi pasien ke internet lewat anon key yang memang
--       tertanam di bundel browser. Dengan hak tabel dicabut, policy keliru
--       yang sama hanya menghasilkan 42501: bocor butuh DUA kesalahan.
--   (b) TRUNCATE tidak pernah difilter RLS. Selama `anon` memegang TRUNCATE
--       pada `clients`, untuk operasi itu RLS bukan lapisan kedua — tidak ada
--       lapisan sama sekali.
--
-- Prinsipnya: hak tabel = "boleh menyentuh tabel ini?", RLS = "baris mana?".
-- Peran yang tidak pernah butuh menyentuh tabelnya seharusnya tidak dijawab
-- oleh RLS sama sekali.

-- ===== 1) TABEL YANG `anon` TIDAK PUNYA URUSAN SAMA SEKALI =====
-- Data pasien & operasional. Klien mengaksesnya sesudah login (peran
-- `authenticated`, disaring RLS per-baris); staf lewat peran yang sama.
-- Tidak satu pun alur produk membacanya sebagai pengunjung anonim.
revoke all on public.profiles          from anon;
revoke all on public.clients           from anon;
revoke all on public.client_packages   from anon;
revoke all on public.sessions          from anon;
revoke all on public.booking_requests  from anon;

-- `screenings`: SENGAJA ikut dicabut, dan ini justru SEJALAN dengan Plan 2.
-- Spec memutuskan hasil skrining publik ditulis lewat SERVER (server action /
-- route handler dengan service role), bukan langsung dari browser dengan anon
-- key — supaya kode skrining, flag, dan tindak lanjut tidak bisa dipalsukan,
-- dibanjiri, atau dibaca balik oleh pengunjung. Policy RLS yang ada pun sudah
-- menyatakan itu ("screenings: staf"). Mencabut hak anon membuat keputusan
-- desain itu ditegakkan Postgres, bukan sekadar dicatat di komentar.
revoke all on public.screenings        from anon;

-- Materi: isi berbayar, tergating sesi `selesai` milik klien.
revoke all on public.materials         from anon;
revoke all on public.material_chapters from anon;

-- Data internal: nama & no. HP mitra, serta setelan aplikasi.
revoke all on public.partners          from anon;
revoke all on public.app_settings      from anon;

-- Tabel uang & video sudah dicabut di migration terdahulu; diulang agar
-- invariannya terbaca utuh di satu tempat dan tahan terhadap urutan migration.
revoke all on public.service_rates     from anon;
revoke all on public.honor_marks       from anon;
revoke all on public.material_videos   from anon;

-- `revoke ... on table` TIDAK menghapus GRANT tingkat kolom yang diberikan
-- terpisah (mis. pola `grant update (nama) ...` yang dipakai migration
-- harden_rls untuk `authenticated`). Sapu bersih supaya tabel tidak tampak
-- bersih di level tabel tetapi masih bocor per-kolom.
revoke all (id, role, nama, created_at) on public.profiles from anon;

-- ===== 2) HAK YANG SENGAJA DIPERTAHANKAN UNTUK `anon` =====
-- Katalog publik. `phases`, `services`, dan `packages` adalah materi PEMASARAN
-- (fase layanan, nama layanan, isi paket) — tidak ada data pribadi di sana, dan
-- landing publik Plan 2 memang perlu menampilkannya. Haknya dipertahankan,
-- tetapi dipersempit menjadi SELECT saja: tidak ada alur mana pun yang
-- membenarkan pengunjung anonim menulis katalog, apalagi men-TRUNCATE-nya.
--
-- Catatan: RLS pada ketiga tabel saat ini masih `auth.uid() is not null`,
-- sehingga anon tetap dapat 0 baris HARI INI. Yang dipertahankan adalah
-- RUANG GERAK Plan 2 — menambah policy baca publik nanti cukup satu policy,
-- tanpa perlu menyentuh hak tabel lagi.
revoke all on public.phases   from anon;
revoke all on public.services from anon;
revoke all on public.packages from anon;
grant select on public.phases   to anon;
grant select on public.services to anon;
grant select on public.packages to anon;

-- Hak peran `authenticated` sengaja DIBIARKAN UTUH di seluruh tabel di atas.
-- Alasannya: klien, admin, dan owner sama-sama login sebagai peran itu —
-- membedakan mereka di level hak tabel mustahil. Pembatasnya memang RLS
-- (per-baris) plus hak KOLOM untuk `profiles.role` (migration harden_rls).
-- Mencabut hak `authenticated` akan melumpuhkan pengelolaan oleh staf.
--
-- Hak `service_role` juga utuh: itulah jalur resmi server untuk skrining
-- publik, penautan klien, dan seed.
--
-- Supabase Auth tidak terpengaruh sama sekali: GoTrue menulis `auth.users`
-- sebagai peran `supabase_auth_admin`, dan profil dibuat trigger
-- `handle_new_user` yang SECURITY DEFINER — keduanya tidak pernah memakai hak
-- `anon`. Registrasi & login tetap jalan.

-- ===== 3) TUTUP SUMBERNYA: default privileges untuk tabel MASA DEPAN =====
-- Tanpa langkah ini, temuan yang sama kambuh otomatis: setiap tabel baru yang
-- dibuat migration Plan 2 langsung lahir dengan GRANT `anon` penuh, karena
-- Supabase memasang `alter default privileges in schema public grant all on
-- tables to anon`. Kita balik defaultnya menjadi TERTUTUP untuk anon.
--
-- Efeknya sengaja fail-closed dan berisik: tabel publik yang baru harus
-- menyatakan niatnya secara eksplisit dengan satu baris
-- `grant select on public.<tabel> to anon;`. Lupa melakukannya menghasilkan
-- error 42501 yang langsung kelihatan saat pengembangan — jauh lebih baik
-- daripada kebocoran yang diam.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
