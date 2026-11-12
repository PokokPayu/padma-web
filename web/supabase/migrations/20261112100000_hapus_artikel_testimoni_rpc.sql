-- ===========================================================================
-- Radius satu permintaan untuk konten situs tulisan tangan: artikel & testimoni
-- ===========================================================================
-- Migration 20261001100000_artikel_testimoni memberi `authenticated` hak
-- DELETE langsung atas `articles` dan `testimonials`. Policy "staf kelola"
-- membatasi PERAN, bukan BARIS: filter PostgREST adalah pilihan pemanggil,
-- jadi satu `DELETE articles?id=not.is.null` dari sesi admin menyapu SELURUH
-- artikel — dibuktikan oleh tests/hak-hapus-berlebih.test.ts sebelum migration
-- ini ditulis (artikel dan testimoni sama-sama tersapu habis).
--
-- Kelasnya sama dengan bab/halaman materi (20260829200000): artikel adalah
-- karangan owner, testimoni adalah izin klien yang tercatat beserta videonya.
-- Keduanya lenyap permanen begitu barisnya hilang. Polanya pun sama:
--   * verba DELETE dicabut dari peran API;
--   * penghapusan satu baris lewat RPC security definer berparameter tunggal
--     yang memeriksa `user_role()` sendiri;
--   * penghapusan massal hanya lewat service role.
--
-- `user_role()` tidak pernah NULL (di-coalesce ke 'klien', kolomnya NOT NULL),
-- jadi `not in ('admin','owner')` tidak bisa lolos lewat NULL.

revoke delete on public.articles     from authenticated;
revoke delete on public.testimonials from authenticated;

-- Memulangkan slug artikel yang terhapus (NULL bila tidak ada): pemanggil
-- membutuhkannya untuk merevalidasi /artikel/[slug].
create or replace function public.hapus_artikel(artikel_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  terhapus text;
begin
  if public.user_role() not in ('admin', 'owner') then
    raise exception 'hanya staf yang boleh menghapus artikel'
      using errcode = '42501';
  end if;

  delete from public.articles a
   where a.id = artikel_id
  returning a.slug into terhapus;

  return terhapus;
end;
$$;

-- Memulangkan BARIS, bukan skalar: `video_objek` boleh NULL untuk testimoni
-- tanpa video, dan NULL skalar tidak bisa membedakan "terhapus, tanpa video"
-- dari "tidak ada". Nol baris = tidak ada; satu baris = terhapus, dan
-- `video_objek`-nya (bila ada) harus dibersihkan pemanggil dari R2.
create or replace function public.hapus_testimoni(testimoni_id uuid)
returns table (id uuid, video_objek text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.user_role() not in ('admin', 'owner') then
    raise exception 'hanya staf yang boleh menghapus testimoni'
      using errcode = '42501';
  end if;

  return query
    delete from public.testimonials t
     where t.id = testimoni_id
    returning t.id, t.video_objek;
end;
$$;

revoke execute on function public.hapus_artikel(uuid)   from public, anon;
revoke execute on function public.hapus_testimoni(uuid) from public, anon;
grant  execute on function public.hapus_artikel(uuid)   to authenticated;
grant  execute on function public.hapus_testimoni(uuid) to authenticated;

comment on table public.articles is
  'Artikel situs, karangan owner. Penyuntingan (insert/update) TETAP pekerjaan '
  'sah staf, tetapi verba DELETE dicabut dari peran API: filter PostgREST '
  'adalah pilihan pemanggil, bukan pembatas baris, sehingga satu permintaan '
  '`DELETE ...?id=not.is.null` menyapu seluruh artikel. Penghapusan satu '
  'artikel lewat public.hapus_artikel(artikel_id). Penghapusan massal hanya '
  'lewat service role.';

comment on table public.testimonials is
  'Testimoni klien beserta izin & videonya. Penyuntingan (insert/update) TETAP '
  'pekerjaan sah staf, tetapi verba DELETE dicabut dari peran API karena satu '
  'permintaan berfilter tautologis menyapu seluruh testimoni. Penghapusan satu '
  'testimoni lewat public.hapus_testimoni(testimoni_id), yang memulangkan '
  'video_objek agar pemanggil membersihkannya dari R2. Penghapusan massal '
  'hanya lewat service role.';
