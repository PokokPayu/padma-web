-- ===========================================================================
-- AMBIL PRODUK GRATIS — satu tindakan, satu transaksi
-- ===========================================================================
-- Klien tidak punya policy TULIS pada `digital_entitlements`, dan itu memang
-- disengaja: akses bukan sesuatu yang diterbitkan sendiri oleh penerimanya.
-- Fungsi ini adalah SATU-SATUNYA pintu klien menerbitkan entitlement untuk
-- dirinya, dan ia memilih client_id-nya SENDIRI dari auth.uid() alih-alih
-- memercayai payload: klien yang boleh menyebut client_id adalah klien yang
-- bisa memberi produk kepada orang lain.
--
-- KENAPA GRATISNYA DIPERIKSA DI SQL, bukan hanya di server action: server
-- action bukan satu-satunya jalan menuju RPC ini — PostgREST mengekspos
-- `rpc/ambil_produk_gratis` kepada siapa pun yang login. Pemeriksaan yang
-- hanya hidup di TypeScript adalah pemeriksaan yang bisa dilewati dengan satu
-- `curl`.
create or replace function public.ambil_produk_gratis(p_product_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid;
  v_harga int;
  v_id uuid;
begin
  select c.id into v_client_id
    from public.clients c
   where c.user_id = auth.uid();
  if v_client_id is null then
    raise exception 'Akun ini belum tertaut ke rekam klien.' using errcode = '42501';
  end if;

  -- Produk harus TAYANG. Produk yang belum ditayangkan belum punya halaman
  -- publik, dan tidak boleh bisa diambil lewat id yang bocor dari panel.
  -- Harga dibaca dari view yang SAMA dengan yang dipakai etalase, supaya
  -- "gratis menurut layar" dan "gratis menurut basis data" tidak pernah
  -- berbeda — termasuk soal tanggal berlaku.
  select h.harga into v_harga
    from public.digital_products p
    join public.harga_produk_publik h on h.product_id = p.id
   where p.id = p_product_id and p.aktif;

  if v_harga is null then
    raise exception 'Produk tidak tersedia.' using errcode = 'P0002';
  end if;
  if v_harga <> 0 then
    raise exception 'Produk ini berbayar.' using errcode = 'P0001';
  end if;

  -- `do nothing`, bukan `do update`: pengambilan ulang tidak boleh
  -- menghidupkan kembali entitlement yang sudah DICABUT admin. Yang kedua
  -- kalinya karena itu tidak melakukan apa pun, dan tidak melempar apa pun —
  -- "sudah punya" bukan kesalahan.
  insert into public.digital_entitlements (client_id, product_id, sumber)
  values (v_client_id, p_product_id, 'gratis')
  on conflict (client_id, product_id) do nothing
  returning id into v_id;

  if v_id is null then
    select e.id into v_id from public.digital_entitlements e
     where e.client_id = v_client_id and e.product_id = p_product_id;
  end if;

  return v_id;
end;
$$;

comment on function public.ambil_produk_gratis(uuid) is
  'Satu-satunya pintu klien menerbitkan entitlement untuk dirinya sendiri. '
  'client_id diambil dari auth.uid(), TIDAK dari payload. Gratisnya diperiksa '
  'di SQL karena PostgREST mengekspos RPC ini ke semua user login. '
  'on conflict do nothing: pengambilan ulang tidak menghidupkan entitlement '
  'yang sudah dicabut.';

-- Anon tidak pernah boleh memanggilnya: "harus login untuk membeli" berlaku
-- juga untuk yang gratis, karena daftar pengambilnya itulah yang diminta.
revoke all on function public.ambil_produk_gratis(uuid) from public, anon;
grant execute on function public.ambil_produk_gratis(uuid) to authenticated;
