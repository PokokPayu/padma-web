-- supabase/migrations/20260831110000_materi_penugasan.sql
-- ============================================================================
-- PENUGASAN MATERI KE PASIEN TERTENTU
-- ============================================================================
-- Jalur otomatis (sesi `selesai` pada layanan materi) DIPERTAHANKAN dan tidak
-- diganti. Alasannya mode kegagalan: admin yang lupa meng-assign tidak
-- menghasilkan error, peringatan, maupun gejala apa pun — hanya pasien yang
-- diam-diam tidak pernah melihat materinya. Penugasan manual hidup DI ATAS
-- jalur otomatis itu, bukan menggantikannya.

create table public.material_assignments (
  material_id     uuid not null references public.materials(id) on delete cascade,
  client_id       uuid not null references public.clients(id)   on delete cascade,
  ditugaskan_oleh uuid not null references public.profiles(id),
  ditugaskan_pada timestamptz not null default now(),
  primary key (material_id, client_id)
);

comment on table public.material_assignments is
  'Penugasan materi ke pasien tertentu. SENGAJA tidak terbaca klien sama '
  'sekali: ia hanya perlu dievaluasi di dalam policy isi materi, dan klien '
  'tidak butuh tahu alasan materinya terbuka. `ditugaskan_oleh` mengikuti pola '
  'honor_marks.ditandai_oleh — keputusan yang membuka konten selalu menyebut '
  'siapa pelakunya.';

-- `ditugaskan_oleh` dipagari TRIGGER, bukan pencabutan grant kolom. Grant kolom
-- mengikat pada KEHADIRAN kolom di payload sehingga `select *` ikut mati 42501;
-- trigger mengikat pada NILAI. Pelajaran ini sudah tiga kali dibayar di repo ini.
--
-- BUKAN `security definer` — ini KRUSIAL, bukan gaya. Di dalam fungsi
-- SECURITY DEFINER, `current_user` adalah PEMILIK fungsi (postgres), BUKAN
-- peran pemanggil (diverifikasi langsung lewat transaksi rollback:
-- `security definer` -> current_user terlihat 'postgres'; invoker rights ->
-- current_user terlihat 'authenticated'). Guard di bawah bergantung MUTLAK
-- pada `current_user` == peran pemanggil untuk membedakan permintaan API
-- (anon/authenticated/authenticator, yang WAJIB dipaksa) dari service
-- role/migration/seed (yang DILEWATKAN). Dengan `security definer`,
-- `current_user` selalu 'postgres' — di LUAR ketiga nama itu — sehingga
-- cabang "not in" selalu true, cabang pemaksaan TIDAK PERNAH tercapai, dan
-- `ditugaskan_oleh` bisa dipalsukan bebas lewat payload oleh admin/owner mana
-- pun (with check policy hanya memeriksa PERAN pemanggil, bukan nilai kolom
-- ini). Fungsi ini juga tidak pernah butuh elevasi: ia hanya membaca
-- `auth.uid()` dan menulis ke NEW. Pola & alasannya kini PERSIS sama dengan
-- `jaga_tanda_honor()` (honor_marks.ditandai_oleh) dan `guard_tarif_maju()` di
-- migration `pengerasan_tabel_uang` — keduanya juga bukan security definer,
-- dengan alasan yang sama persis: "current_user harus tetap peran PEMANGGIL,
-- karena justru itu yang membedakan jalur sah dari jalur terlarang."
create or replace function public.paksa_aktor_penugasan()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('anon', 'authenticated', 'authenticator') then
    return new;
  end if;

  new.ditugaskan_oleh := auth.uid();
  return new;
end $$;

create trigger trg_paksa_aktor_penugasan
  before insert or update on public.material_assignments
  for each row execute function public.paksa_aktor_penugasan();

alter table public.material_assignments enable row level security;
revoke all on public.material_assignments from anon, authenticated;
grant select, insert, delete on public.material_assignments to authenticated;

-- Hanya staf. Tidak ada policy untuk klien: hak tabelnya memang ada, tetapi
-- tanpa policy tidak satu baris pun lolos RLS.
--
-- `to authenticated` wajib ada: tanpanya policy lahir `to public`, yang
-- mencakup `anon`, dan karena policy ini memanggil `user_role()`,
-- tests/hak-default-sequence-fungsi.test.ts akan menangkapnya sebagai policy
-- staf yang menyasar peran anon (persis regresi phases/services/packages yang
-- test itu ditulis untuk mencegah).
create policy "penugasan: staf kelola"
  on public.material_assignments for all
  to authenticated
  using (public.user_role() in ('admin','owner'))
  with check (public.user_role() in ('admin','owner'));

-- ---------------------------------------------------------------------------
-- Gating isi materi: SATU fungsi, dipakai policy MAUPUN UI
-- ---------------------------------------------------------------------------
-- `security definer` di sini WAJIB, dan alasannya adalah jebakan yang mudah
-- menelan: RLS berlaku REKURSIF pada tabel yang dirujuk sebuah policy. Bila
-- syarat penugasan ditulis inline sebagai `exists (select 1 from
-- material_assignments ...)` di dalam policy, subquery itu ikut dikenai RLS
-- material_assignments — yang SENGAJA tidak punya policy untuk klien. Hasilnya
-- cabang penugasan selalu bernilai false bagi klien, tanpa satu pun error:
-- tombol "assign" di panel admin akan tampak bekerja dan tidak membuka apa pun.
--
-- Fungsi ini aman meski menembus RLS: ia hanya menjawab ya/tidak tentang
-- `auth.uid()` yang sedang memanggil, dan satu-satunya parameternya adalah id
-- materi. Tidak ada baris siapa pun yang bisa keluar dari sini.
--
-- Dipakai ulang oleh reader passport untuk membedakan "tidak berhak" dari
-- "berhak tapi isinya belum diunggah" — dua keadaan yang tanpa fungsi ini
-- terlihat identik (nol baris), sehingga pasien yang berhak akan dibohongi
-- kalimat "terbuka setelah layanan terkait selesai".
create or replace function public.berhak_isi_materi(p_material_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.materials m
     where m.id = p_material_id
       and m.aktif = true
       and (
         exists (
           select 1
             from public.material_services ms
             join public.sessions s
               on s.service_id = ms.service_id and s.status = 'selesai'
             join public.clients c on c.id = s.client_id
            where ms.material_id = m.id and c.user_id = auth.uid()
         )
         or exists (
           select 1
             from public.material_assignments ma
             join public.clients c on c.id = ma.client_id
            where ma.material_id = m.id and c.user_id = auth.uid()
         )
       )
  )
$$;

revoke all on function public.berhak_isi_materi(uuid) from public, anon;
grant execute on function public.berhak_isi_materi(uuid) to authenticated;

-- Nama policy dipertahankan PERSIS. Policy bernama baru akan berdampingan
-- dengan yang lama (RLS meng-OR policy permisif) sehingga jalur lama tetap
-- terbuka tanpa satu pun error. `to authenticated` dipertahankan dari versi
-- sebelumnya (migration materi_banyak_layanan) — mengganti policy tidak boleh
-- diam-diam melebarkan peran yang menyasarnya ke `public`/anon.
drop policy if exists "chapters: klien dgn sesi selesai" on public.material_chapters;
create policy "chapters: klien dgn sesi selesai" on public.material_chapters
  for select
  to authenticated
  using (public.berhak_isi_materi(material_id));

drop policy if exists "video: klien dgn sesi selesai" on public.material_videos;
create policy "video: klien dgn sesi selesai" on public.material_videos
  for select
  to authenticated
  using (public.berhak_isi_materi(material_id));
