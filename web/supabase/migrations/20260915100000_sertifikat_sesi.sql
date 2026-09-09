-- ===========================================================================
-- SERTIFIKAT KUNJUNGAN
-- ===========================================================================
-- Sertifikat adalah milik SATU orang, dan itulah yang membedakannya dari
-- `materials`. Baris `materials` adalah data KATALOG: satu baris dipakai semua
-- klien, dan haknya diatur penugasan. Menempatkan sertifikat di sana berarti
-- setiap lembar menunggu satu penugasan yang benar, dan satu salah-tugas
-- membuat sertifikat klien A terbaca klien B. Di tabel ini kepemilikan adalah
-- KOLOM, bukan kebiasaan.
create table public.certificates (
  id uuid primary key default gen_random_uuid(),

  -- SATU sesi = paling banyak satu sertifikat. UNIQUE, bukan index biasa:
  -- badge klien membuka "sertifikat terbaru untuk layanan ini", dan baris
  -- kedua untuk sesi yang sama membuat "terbaru" jadi pertanyaan tanpa
  -- jawaban pasti.
  session_id uuid not null unique references public.sessions(id) on delete cascade,

  -- Pemilik & layanan: SALINAN keadaan saat sertifikat terbit, bukan rujukan
  -- hidup. Admin bisa memindahkan sesi ke layanan lain, dan lembar yang sudah
  -- dicetak atas nama satu layanan tidak boleh ikut berganti nama. Policy RLS
  -- di bawah juga membandingkan `client_id` langsung — join di dalam policy
  -- adalah biaya yang dibayar setiap baris setiap kali.
  client_id uuid not null references public.clients(id) on delete cascade,
  service_id uuid not null references public.services(id),

  -- Nama objek di bucket `sertifikat`. Ditentukan server, tidak pernah
  -- browser: browser yang memilih path adalah browser yang bisa menimpa
  -- sertifikat klien lain.
  objek text not null,
  mime text not null,

  diunggah_oleh uuid references auth.users(id),
  created_at timestamptz not null default now()
);

comment on table public.certificates is
  'Sertifikat kunjungan, satu per sesi. client_id & service_id adalah SALINAN '
  'keadaan saat terbit, bukan rujukan hidup — sesi yang dipindahkan ke layanan '
  'lain tidak boleh menyeret sertifikat yang sudah dicetak. Klien hanya bisa '
  'MEMBACA miliknya: tidak ada policy tulis untuk klien, karena sertifikat '
  'bukan sesuatu yang diterbitkan sendiri oleh penerimanya.';

create index certificates_klien_layanan_idx
  on public.certificates (client_id, service_id, created_at desc);

alter table public.certificates enable row level security;
revoke all on public.certificates from anon;

-- ===== PENJAGA ISI =====
-- Policy menjawab "baris mana"; ia tidak bisa menjawab "apakah salinannya
-- jujur". Trigger ini MENULIS ULANG client_id & service_id dari baris sesi,
-- sehingga salinannya tidak pernah bisa dikarang oleh pengirim.
create or replace function public.guard_sertifikat()
returns trigger
language plpgsql
as $$
declare
  s public.sessions%rowtype;
begin
  select * into s from public.sessions where id = new.session_id;
  if not found then
    raise exception 'sesi tidak ditemukan' using errcode = '42501';
  end if;

  -- Sertifikat kunjungan yang belum terjadi adalah pernyataan yang tidak
  -- benar. Digerbang di sini, bukan hanya di layar admin: layar bisa diubah,
  -- pagar ini tidak.
  if s.status <> 'selesai' then
    raise exception 'sertifikat hanya untuk sesi yang sudah selesai'
      using errcode = '42501';
  end if;

  new.client_id := s.client_id;
  new.service_id := s.service_id;

  return new;
end;
$$;

revoke execute on function public.guard_sertifikat() from public, anon;

create trigger trg_guard_sertifikat
  before insert or update on public.certificates
  for each row execute function public.guard_sertifikat();

-- ===== POLICY =====
-- Klien MEMBACA miliknya. Tidak ada policy insert/update/delete untuk klien:
-- yang menerbitkan sertifikat adalah tim PADMA, bukan penerimanya.
create policy "sertifikat: klien baca miliknya" on public.certificates
  for select to authenticated
  using (client_id in (select c.id from public.clients c where c.user_id = auth.uid()));

create policy "sertifikat: staf kelola" on public.certificates
  for all to authenticated
  using (user_role() in ('admin', 'owner'))
  with check (user_role() in ('admin', 'owner'));

-- ===== BUCKET =====
-- SENGAJA tanpa satu pun policy pada storage.objects — sama seperti
-- `materi-halaman` dan `bukti-bayar`. Tanpa policy, anon & authenticated tidak
-- bisa menyentuh objeknya sama sekali; hanya service role, dari route handler
-- kita, sesudah RLS memutuskan hak. Path yang bocor tetap tidak bisa ditukar
-- jadi byte.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sertifikat', 'sertifikat', false, 5242880,
        array['application/pdf','image/jpeg','image/webp'])
on conflict (id) do nothing;
