-- ============================================================================
-- REGISTRI KUNCI PENGATURAN
-- ============================================================================
-- Money firewall (tests/money-firewall-struktural.test.ts) memindai nama
-- KOLOM: nominal uang hanya boleh hidup di `service_rates` & `honor_marks`.
-- Invarian itu kuat, tetapi buta terhadap satu bentuk — `app_settings` adalah
-- (key text, value text), sehingga nominal bisa hidup sebagai BARIS tanpa satu
-- pun nama kolom berubah. Direproduksi sebagai admin sungguhan lewat REST:
--
--   POST /rest/v1/app_settings  {"key":"uji","value":"425000"}  -> HTTP 201
--   -- nol test merah; angka rupiah kini terbaca seluruh panel admin.
--
-- Pagar yang dipasang di sini BUKAN validasi di server action. Server action
-- bisa dilewati: siapa pun yang memegang JWT admin bisa menembak PostgREST
-- langsung, dan panel pengaturan (Task 5) justru melahirkan jalur tulis baru.
-- Pagar yang benar adalah integritas referensial: hanya kunci yang TERDAFTAR
-- boleh ada, dan registrinya sendiri tidak bisa ditulis staf.
--
-- Cap waktu ditulis MANUAL. `npx supabase migration new` memakai jam dinding
-- dan sudah pernah menyelipkan berkas ke tengah riwayat sehingga `db reset`
-- gagal.

create table public.app_setting_keys (
  key text primary key,
  keterangan text not null,
  bentuk text not null check (bentuk in ('nomor_wa', 'teks_polos'))
);

comment on table public.app_setting_keys is
  'Daftar putih kunci app_settings. `app_settings` adalah key/value, jadi money '
  'firewall yang memindai nama KOLOM tidak melihatnya sama sekali: nominal '
  'uang bisa hidup sebagai BARIS. Registri ini menutupnya lewat FK. INSERT/'
  'UPDATE/DELETE sengaja dicabut dari `authenticated` — bila staf boleh '
  'mendaftarkan kuncinya sendiri, FK di app_settings hanya hiasan; kunci baru '
  'lahir lewat migration, tempat alasannya ikut tertulis. Kolom `bentuk` '
  'menentukan validator nilai di panel (nomor_wa = digit saja).';

-- Baris registri lahir DI SINI, bukan di seed.sql. `supabase db reset`
-- menjalankan seluruh migration lebih dulu, baru seed — dan seed sudah
-- menyisipkan `nomor_wa`. Bila kuncinya belum terdaftar saat migration
-- selesai, FK di bawah membuat baris seed itu gagal dan `db reset` mati.
insert into public.app_setting_keys (key, keterangan, bentuk) values
  ('nomor_wa', 'Nomor WhatsApp resmi PADMA (format internasional tanpa +)', 'nomor_wa'),
  ('alamat_klinik', 'Alamat/area layanan yang ditampilkan di footer', 'teks_polos'),
  ('jam_operasional', 'Jam operasional yang ditampilkan ke pengunjung', 'teks_polos');

-- Perbaikan data mendahului pemasangan pagar, bukan pelonggaran pagar.
-- Satu kunci sisa percobaan di basis data dev (atau baris fixture test yang
-- menggantung) membuat `add constraint` mati dengan 23503, dan migration yang
-- gagal di tengah jauh lebih mahal daripada baris setelan yang hilang —
-- setelan tak terdaftar tidak pernah dibaca kode mana pun.
delete from public.app_settings
 where key not in (select key from public.app_setting_keys);

alter table public.app_settings
  add constraint app_settings_key_terdaftar
  foreign key (key) references public.app_setting_keys(key);

comment on constraint app_settings_key_terdaftar on public.app_settings is
  'Hanya kunci terdaftar yang boleh ada. FK dipilih, bukan CHECK berisi daftar '
  'literal, supaya daftarnya bisa dibaca panel (label + bentuk) dan supaya '
  'menghapus kunci yang masih dipakai ikut tertahan. Berlaku untuk SEMUA '
  'peran — service role dan SECURITY DEFINER tidak dikecualikan.';

-- Tabel baru LAHIR dengan SELECT+INSERT+UPDATE(+REFERENCES/TRIGGER) untuk
-- `authenticated`: default privileges hari ini hanya mencabut ALL untuk anon
-- (migration cabut_grant_anon_berlebih) serta TRUNCATE & DELETE untuk
-- authenticated (migration cabut_hak_hapus_berlebih). Sisanya harus dicabut di
-- sini secara eksplisit — kalau tidak, admin cukup mendaftarkan kunci uangnya
-- sendiri lebih dulu dan seluruh daftar putih ini menjadi hiasan.
alter table public.app_setting_keys enable row level security;
revoke all on public.app_setting_keys from anon;
revoke all on public.app_setting_keys from authenticated;
grant select on public.app_setting_keys to authenticated;

-- `to authenticated`, bukan `to public`: policy yang memanggil `user_role()`
-- dan menyasar public memaksa anon mengevaluasi fungsi yang EXECUTE-nya sudah
-- dicabut (migration fail_closed_sequence_fungsi), sehingga anon menerima
-- "permission denied for function user_role" alih-alih penolakan hak tabel
-- yang jujur. Dijaga oleh tests/hak-default-sequence-fungsi.test.ts.
create policy "registri kunci: staf baca" on public.app_setting_keys
  for select to authenticated using (user_role() in ('admin', 'owner'));
