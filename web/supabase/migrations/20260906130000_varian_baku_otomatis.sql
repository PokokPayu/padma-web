-- ============================================================================
-- VARIAN BAKU OTOMATIS — V3 spec ditegakkan SELAMANYA, bukan sekali saat migrasi
-- ============================================================================
-- Migrasi `20260906100000_varian_layanan.sql` membackfill varian baku untuk
-- SELURUH layanan yang ada SAAT ITU. Itu memenuhi V3 ("setiap layanan wajib
-- punya minimal satu varian") untuk hari itu saja — layanan yang lahir
-- SESUDAHNYA lewat `simpanLayanan()` (src/app/admin/layanan/aksi.ts) tidak
-- pernah menyentuh `service_variants` sama sekali, dan tidak ada trigger yang
-- menegaknya.
--
-- Akibatnya bukan error, melainkan layanan yatim: `ambilRateCard()` sejak
-- Task 4 mendaftar PER VARIAN (bukan per layanan), jadi layanan tanpa varian
-- menyumbang NOL baris — hilang dari /owner/tarif, tidak terhitung di
-- peringatan "N varian belum bertarif", dan sesinya jatuh sebagai "tak
-- bertarif" tanpa satu pun jalan perbaikan dari panel mana pun.
--
-- Pagar yang hanya hidup di kode aplikasi (mis. menyuruh `simpanLayanan()`
-- ikut menyisipkan varian bakunya) akan dilewati REST langsung maupun service
-- role — persis kelas kebocoran yang berulang kali ditutup di plan ini lewat
-- trigger, bukan disiplin pemanggil. Maka trigger AFTER INSERT di sini.
--
-- BUKAN `security definer`: fungsi berjalan dengan hak PEMANGGIL, dan
-- `authenticated` sudah memegang INSERT atas `service_variants` (migrasi
-- varian_layanan) sementara policy "service_variants: staf kelola" mengizinkan
-- admin/owner menulisnya — pasangan hak yang sama yang mengizinkan pemanggil
-- itu menyisipkan `services` sejak awal. Trigger ini SENGAJA TIDAK bergerbang
-- `current_user`: layanan yatim sama yatimnya siapa pun yang membuatnya
-- (admin lewat panel, `postgres` lewat seed, atau siapa pun lewat REST) —
-- berbeda dari `guard_tarif_varian_maju`/`kunci_riwayat_tarif_varian` yang
-- justru HARUS melewatkan `postgres` supaya seed & fixture uji bisa menyemai
-- tanggal lampau. Tidak ada tanggal lampau di sini untuk dilewatkan.
--
-- `seed.sql` sudah menjaga dirinya sendiri terhadap trigger ini: blok CERMIN
-- di sana menyisipkan varian baku dengan `where not exists (...)`, jadi ia
-- menjadi no-op begitu trigger ini sudah membuatkan variannya lebih dulu.
--
-- Cap waktu 20260906130000 semula dijadwalkan untuk Task 5 (peleburan
-- service_rates ke variant_rates); digeser ke sini karena regresi ini lebih
-- mendesak. Task 5 memakai cap waktu berikutnya.

create or replace function public.terbitkan_varian_baku()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.service_variants (service_id, label, durasi_menit, format, urutan)
  values (new.id, '', null, null, 0);
  return new;
end;
$$;

comment on function public.terbitkan_varian_baku() is
  'Menerbitkan varian baku (label kosong, durasi & format NULL) untuk setiap '
  'baris services yang baru lahir. Menegakkan V3 spec ("setiap layanan wajib '
  'punya minimal satu varian") SELAMANYA — bukan cuma pada saat migrasi Task 1 '
  'dijalankan. BUKAN security definer dan TIDAK bergerbang peran: layanan '
  'yatim adalah bug yang sama untuk siapa pun yang menciptakannya.';

revoke all on function public.terbitkan_varian_baku() from public, anon, authenticated;

create trigger trg_terbitkan_varian_baku
  after insert on public.services
  for each row execute function public.terbitkan_varian_baku();
