-- Menutup celah LIKE-injection pada penautan akun klien.
--
-- Penautan (src/lib/auth/link-client.ts) dulu memakai `.ilike("email", email)`;
-- PostgREST menerjemahkannya ke SQL LIKE, sehingga `%` dan `_` di dalam email
-- penyerang menjadi WILDCARD. Karena pendaftaran mandiri terbuka, mendaftar
-- dengan email `%@padma.test` cukup untuk menautkan akun penyerang ke baris
-- klien orang lain — membocorkan nama, no. HP, dan (lewat RLS
-- `clients.user_id = auth.uid()`) catatan sesi & rekomendasi: data kesehatan
-- pasien, ranah UU PDP.
--
-- Perbaikan aplikasi: pencocokan memakai `=` (persis) atas email yang
-- dinormalkan ke huruf kecil. Agar `email = lower(input)` selalu SETARA dengan
-- `lower(email) = lower(input)` — sehingga klien yang emailnya terlanjur
-- disimpan dengan huruf besar tetap bisa tertaut — email klien dinormalkan di
-- level DB, bukan hanya di aplikasi.

-- 1) Rapikan data yang sudah ada.
update clients
   set email = lower(btrim(email))
 where email <> lower(btrim(email));

-- 2) Normalkan setiap penulisan berikutnya (insert admin, impor, seed, dll).
create or replace function normalize_client_email()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end;
$$;

create trigger clients_normalize_email
  before insert or update of email on clients
  for each row execute function normalize_client_email();

-- 3) Invariannya ditegakkan DB, bukan sekadar konvensi. Dengan ini pencarian
--    `email = lower(input)` identik hasilnya dengan `lower(email) = lower(input)`
--    dan indeks clients_email_lower_idx tetap melayani pencarian
--    case-insensitive lain tanpa perlu LIKE.
alter table clients
  add constraint clients_email_lowercase check (email = lower(btrim(email)));
