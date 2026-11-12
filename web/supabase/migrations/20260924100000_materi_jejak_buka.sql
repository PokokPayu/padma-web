-- ===========================================================================
-- JEJAK "SUDAH DIBUKA KLIEN" untuk materi
-- ===========================================================================
-- Umpan balik klien 21 Sep 2026, butir 6, disalin utuh di
-- documents/umpan-balik-klien/2026-09-21-hasil-tes.md:
--
--   "Cara tahu e book sdh diterima klien gimana?"
--
-- Jawaban jujurnya, sebelum migrasi ini: TIDAK BISA.
-- `material_assignments` mencatat siapa DITUGASKAN materi apa — diukur di
-- basis data produksi 22 Sep 2026, ada 7 baris — tetapi tidak ada satu pun
-- tabel yang mencatat apakah materinya pernah dibuka. Ini karena itu fitur
-- BARU, bukan perbaikan atas sesuatu yang rusak.
--
-- YANG SENGAJA TIDAK DICATAT: berapa halaman yang dibaca, dan berapa lama.
-- Materi PADMA memuat keterangan kesehatan, dan orang yang membacanya sedang
-- hamil atau sedang menjalani program. "Sudah sampai" adalah pertanyaan
-- operasional yang sah; "sudah dibaca sampai halaman berapa" adalah
-- pengawasan, dan ia tidak pernah diminta.

create table public.material_opens (
  material_id uuid not null references public.materials(id) on delete cascade,
  client_id   uuid not null references public.clients(id)   on delete cascade,

  -- Kapan klien PERTAMA membukanya. Inilah jawaban atas pertanyaan klien, dan
  -- ia TIDAK PERNAH ditulis ulang sesudah lahir (lihat RPC di bawah): stempel
  -- "diterima" yang bisa bergeser bukan bukti apa pun.
  dibuka_pertama  timestamptz not null default now(),
  dibuka_terakhir timestamptz not null default now(),

  -- Hitungan kasar, untuk membedakan "dibuka sekali lalu ditinggalkan" dari
  -- "dibuka berulang". Bukan metrik keterlibatan — tidak ada layar yang
  -- mengambil keputusan darinya.
  jumlah integer not null default 1 check (jumlah > 0),

  primary key (material_id, client_id)
);

comment on table public.material_opens is
  'Jejak bahwa seorang klien MEMBUKA sebuah materi. Ditulis HANYA lewat RPC '
  'catat_buka_materi() — klien tidak punya satu pun hak atas tabel ini, dan '
  'itu disengaja: stempel "sudah diterima" yang bisa dikarang lewat REST '
  'tidak bisa dibedakan dari yang sungguhan. Sengaja TIDAK mencatat halaman '
  'yang dibaca maupun durasinya: "sudah sampai" itu pertanyaan operasional, '
  '"dibaca sampai mana" itu pengawasan.';

create index material_opens_klien_idx on public.material_opens (client_id);

alter table public.material_opens enable row level security;

-- Klien: NOL hak. Bukan "hak tanpa policy" seperti material_assignments —
-- di sini grant-nya sendiri dicabut, karena tidak ada satu pun alasan sah
-- bagi sesi klien untuk menyentuh tabel ini secara langsung.
revoke all on public.material_opens from anon, authenticated;
grant select on public.material_opens to authenticated;

-- ...dan SELECT itu hanya berguna bagi staf, karena hanya staf yang punya
-- policy. `to authenticated` wajib disebut: tanpanya policy lahir `to public`
-- (mencakup anon), dan karena ia memanggil `user_role()`,
-- tests/hak-default-sequence-fungsi.test.ts akan menangkapnya sebagai policy
-- staf yang menyasar anon.
create policy "jejak materi: staf baca"
  on public.material_opens for select
  to authenticated
  using (public.user_role() in ('admin','owner'));

-- ---------------------------------------------------------------------------
-- RPC: satu-satunya jalan masuk
-- ---------------------------------------------------------------------------
-- `security definer` WAJIB di sini, dan alasannya sama persis dengan
-- `berhak_isi_materi()` di migration materi_penugasan: fungsi ini menulis ke
-- tabel yang pemanggilnya sengaja tidak punya hak apa pun atasnya.
--
-- Ia aman meski menembus RLS karena tiga hal, dan ketiganya harus dibaca
-- bersama:
--
--   1. Satu-satunya parameternya adalah id materi. Tidak ada `client_id` yang
--      bisa dikirim pemanggil — ia diturunkan dari `auth.uid()` DI DALAM sini.
--      Tanpa itu, klien mana pun bisa mencatatkan "sudah membuka" atas nama
--      klien lain.
--   2. Tidak ada satu baris pun yang keluar dari fungsi ini. Ia `returns void`.
--   3. Ia menolak lebih dulu bila `berhak_isi_materi()` menjawab tidak. Jejak
--      buka atas materi yang tidak pernah bisa dilihat adalah bukti PALSU
--      bahwa pekerjaan sudah sampai ke klien — dan pemilik klinik membaca
--      angka itu untuk memutuskan apakah ia sudah selesai.
--
-- `auth.uid()` yang NULL (service role, migration, seed) berakhir di `select`
-- yang tidak memulangkan baris klien mana pun, sehingga fungsinya tidak
-- melakukan apa-apa. Itu perilaku yang benar: tidak ada manusia yang membuka
-- apa pun di jalur itu.
create or replace function public.catat_buka_materi(p_material_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
begin
  if not public.berhak_isi_materi(p_material_id) then
    return;
  end if;

  select c.id into v_client
    from public.clients c
   where c.user_id = auth.uid()
   limit 1;

  if v_client is null then
    return;
  end if;

  insert into public.material_opens (material_id, client_id)
  values (p_material_id, v_client)
  on conflict (material_id, client_id) do update
    -- `dibuka_pertama` SENGAJA tidak ikut disentuh. Ia satu-satunya kolom di
    -- tabel ini yang menjawab pertanyaan klien ("kapan sampai?"), dan kolom
    -- yang bergeser setiap kunjungan berhenti menjawabnya.
    set dibuka_terakhir = now(),
        jumlah = public.material_opens.jumlah + 1;
end $$;

comment on function public.catat_buka_materi(uuid) is
  'Mencatat bahwa klien yang sedang memanggil membuka sebuah materi. '
  'SECURITY DEFINER karena klien sengaja tidak punya hak tulis atas '
  'material_opens. client_id diturunkan dari auth.uid(), TIDAK PERNAH dari '
  'parameter. Menolak diam-diam bila berhak_isi_materi() menjawab tidak.';

revoke all on function public.catat_buka_materi(uuid) from public, anon;
grant execute on function public.catat_buka_materi(uuid) to authenticated;
