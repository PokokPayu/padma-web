-- ===========================================================================
-- MASA BERLAKU DI ALUR BAYAR (spec 2026-10-16)
-- ===========================================================================

-- ===== 1. DURASI BEKU =====
-- Sepasang dengan judul_beku & harga_beku: pembeli yang membayar sesudah
-- melihat "9 Bulan" mendapat 9 bulan, walaupun owner mengubahnya saat
-- pesanannya masih menunggu bayar. order_items append-only (trigger
-- item_pesanan_beku) — kolom ini hanya pernah diisi saat INSERT.
alter table public.order_items
  add column masa_berlaku_bulan_beku int
    check (masa_berlaku_bulan_beku is null or masa_berlaku_bulan_beku between 1 and 120);

-- ===== 2. "PEMBAYARAN MENGGANTUNG" — SATU DEFINISI =====
-- P1 menulis kriteria ini DUA KALI (punya_pesanan_menunggu & gerbang
-- buat_pesanan_keranjang) dengan catatan "WAJIB cermin". Keduanya
-- menganggap SETIAP pesanan `lunas` menggantung — aman selama akses
-- selamanya, karena layar memeriksa entitlement lebih dulu. Dengan masa
-- berlaku, pesanan lunas lama yang aksesnya sudah habis akan memblokir beli
-- ulang SELAMANYA.
--
-- Kini: pesanan beruang menggantung HANYA bila belum ada entitlement tak
-- dicabut yang terbit SESUDAH pesanan itu dibuat. `dibuat_pada`, bukan
-- `lunas_pada`: pesanan `lunas_setelah_tutup` berstatus kedaluwarsa/
-- dibatalkan dan tidak selalu punya lunas_pada. Entitlement yang dicabut
-- tidak pernah menyelesaikan apa pun — `akses_tertahan` tetap menggantung,
-- persis seperti hari ini.
create or replace function public.pembayaran_produk_menggantung(
  p_client_id uuid,
  p_product_id uuid
) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.orders o
      join public.order_items i on i.pesanan_id = o.id
     where o.client_id = p_client_id
       and i.product_id = p_product_id
       and (
         o.status = any (array['ditahan','lunas']::public.order_status[])
         or o.sebab_tinjauan = 'lunas_setelah_tutup'
       )
       and not exists (
         select 1
           from public.digital_entitlements e
          where e.client_id = o.client_id
            and e.product_id = i.product_id
            and e.dicabut_pada is null
            and e.diberikan_pada >= o.dibuat_pada
       )
  );
$$;

revoke all on function public.pembayaran_produk_menggantung(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.punya_pesanan_menunggu(p_product_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  with klien as (select c.id from public.clients c where c.user_id = auth.uid())
  select exists (
           select 1
             from public.orders o
             join public.order_items i on i.pesanan_id = o.id
            where o.client_id = (select id from klien)
              and i.product_id = p_product_id
              and o.status = 'menunggu_bayar'
         )
      or coalesce(public.pembayaran_produk_menggantung((select id from klien), p_product_id), false);
$$;

comment on function public.punya_pesanan_menunggu(uuid) is
  'Benar bila pemanggil punya pesanan menunggu_bayar untuk produk ini, atau '
  'pembayaran yang belum melahirkan akses (pembayaran_produk_menggantung). '
  'Urutan layar: entitlement aktif dulu, lalu fungsi ini, baru tombol beli.';

revoke all on function public.punya_pesanan_menunggu(uuid) from public, anon;
grant execute on function public.punya_pesanan_menunggu(uuid) to authenticated;

-- ===== 3. KERANJANG =====
create or replace function public.tambah_ke_keranjang(p_product_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid;
  v_harga integer;
  v_isi integer;
begin
  select c.id into v_client_id from public.clients c where c.user_id = auth.uid();
  if v_client_id is null then
    raise exception 'Akun ini belum tertaut ke rekam klien.' using errcode = '42501';
  end if;

  select h.harga into v_harga
    from public.digital_products p
    join public.harga_produk_publik h on h.product_id = p.id
   where p.id = p_product_id and p.aktif;
  if v_harga is null then
    raise exception 'Produk tidak tersedia.' using errcode = 'P0002';
  end if;
  if v_harga = 0 then
    raise exception 'Produk ini gratis — ambil lewat tombolnya.' using errcode = 'P0001';
  end if;

  -- AKTIF, bukan sekadar ada: akses yang kedaluwarsa boleh dibeli lagi.
  if public.akses_aktif(v_client_id, p_product_id) then
    raise exception 'Anda sudah memiliki produk ini.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.cart_items k
     where k.client_id = v_client_id and k.product_id = p_product_id
  ) then
    return;
  end if;

  select count(*) into v_isi from public.cart_items k where k.client_id = v_client_id;
  if v_isi >= 20 then
    raise exception 'Keranjang penuh — paling banyak 20 produk.' using errcode = 'P0001';
  end if;

  insert into public.cart_items (client_id, product_id)
  values (v_client_id, p_product_id)
  on conflict do nothing;
end;
$$;

revoke all on function public.tambah_ke_keranjang(uuid) from public, anon;
grant execute on function public.tambah_ke_keranjang(uuid) to authenticated;

create or replace function public.baca_keranjang()
returns table (
  product_id uuid,
  judul text,
  slug text,
  harga integer,
  keadaan text,
  ditambahkan_pada timestamptz
)
language sql stable security definer set search_path = public
as $$
  select k.product_id,
         p.judul,
         p.slug,
         h.harga,
         case
           when not p.aktif or h.harga is null then 'tidak_tersedia'
           when h.harga = 0 then 'gratis'
           when public.akses_aktif(k.client_id, k.product_id) then 'sudah_dimiliki'
           when public.punya_pesanan_menunggu(k.product_id) then 'diproses'
           else 'siap'
         end,
         k.ditambahkan_pada
    from public.cart_items k
    join public.clients c on c.id = k.client_id
    join public.digital_products p on p.id = k.product_id
    left join public.harga_produk_publik h on h.product_id = k.product_id
   where c.user_id = auth.uid()
   order by k.ditambahkan_pada, k.product_id;
$$;

revoke all on function public.baca_keranjang() from public, anon;
grant execute on function public.baca_keranjang() to authenticated;

-- Pembersihan keranjang kini juga menyala saat entitlement DIPERBARUI
-- (beli ulang sesudah kedaluwarsa), bukan hanya saat lahir/dicabut.
create or replace function public.bersihkan_keranjang_saat_akses()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.dicabut_pada is null
     and (new.berlaku_sampai is null or new.berlaku_sampai > now()) then
    delete from public.cart_items k
     where k.client_id = new.client_id and k.product_id = new.product_id;
  end if;
  return null;
end;
$$;

revoke all on function public.bersihkan_keranjang_saat_akses() from public, anon, authenticated;

drop trigger keranjang_bersih_saat_akses on public.digital_entitlements;
create trigger keranjang_bersih_saat_akses
  after insert or update of dicabut_pada, berlaku_sampai on public.digital_entitlements
  for each row execute function public.bersihkan_keranjang_saat_akses();

-- ===== 4. AMBIL GRATIS =====
create or replace function public.ambil_produk_gratis(p_product_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid;
  v_harga int;
  v_bulan int;
  v_sampai timestamptz;
  v_id uuid;
begin
  select c.id into v_client_id from public.clients c where c.user_id = auth.uid();
  if v_client_id is null then
    raise exception 'Akun ini belum tertaut ke rekam klien.' using errcode = '42501';
  end if;

  select h.harga, p.masa_berlaku_bulan into v_harga, v_bulan
    from public.digital_products p
    join public.harga_produk_publik h on h.product_id = p.id
   where p.id = p_product_id and p.aktif;

  if v_harga is null then
    raise exception 'Produk tidak tersedia.' using errcode = 'P0002';
  end if;
  if v_harga <> 0 then
    raise exception 'Produk ini berbayar.' using errcode = 'P0001';
  end if;

  -- Produk gratis tidak punya pesanan, jadi tidak ada durasi beku: durasi
  -- produk SAAT INI yang dipakai.
  v_sampai := case when v_bulan is null then null
                   else now() + make_interval(months => v_bulan) end;

  -- `do update` HANYA untuk baris yang kedaluwarsa dan TIDAK dicabut.
  -- Pengambilan ulang tidak pernah menghidupkan entitlement yang dicabut
  -- admin, dan tidak memperpanjang akses yang masih berjalan.
  insert into public.digital_entitlements (client_id, product_id, sumber, berlaku_sampai)
  values (v_client_id, p_product_id, 'gratis', v_sampai)
  on conflict (client_id, product_id) do update
     set berlaku_sampai = excluded.berlaku_sampai,
         diberikan_pada = now(),
         sumber = 'gratis'
   where digital_entitlements.dicabut_pada is null
     and digital_entitlements.berlaku_sampai is not null
     and digital_entitlements.berlaku_sampai <= now()
  returning id into v_id;

  if v_id is null then
    select e.id into v_id from public.digital_entitlements e
     where e.client_id = v_client_id and e.product_id = p_product_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.ambil_produk_gratis(uuid) from public, anon;
grant execute on function public.ambil_produk_gratis(uuid) to authenticated;

create or replace function public.buat_pesanan_keranjang(
  p_product_ids uuid[],
  p_ulang boolean default false
)
returns table (
  pesanan_id uuid,
  kode text,
  percobaan smallint,
  nominal_tagih integer,
  judul text,
  jumlah_item smallint
)
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid;
  v_padma_id text;
  v_ids uuid[];
  v_n integer;
  v_id uuid;
  v_judul text;
  v_harga integer;
  v_judul_arr text[] := '{}';
  v_harga_arr integer[] := '{}';
  v_bulan integer;
  v_bulan_arr integer[] := '{}';
  v_pesanan_id uuid;
  v_kode text;
  v_percobaan smallint;
  v_terbuka_id uuid;
  v_terbuka_kode text;
  v_terbuka_percobaan smallint;
  v_kendala text;
  v_sisa integer := 5;
  v_baru boolean := false;
begin
  select c.id, c.padma_id into v_client_id, v_padma_id
    from public.clients c
   where c.user_id = auth.uid();
  if v_client_id is null then
    raise exception 'Akun ini belum tertaut ke rekam klien.' using errcode = '42501';
  end if;

  -- Kembar dan null dibuang, urutan pertama dipertahankan: produk digital
  -- tidak punya kuantitas, dan dua baris untuk produk yang sama berarti
  -- menagih dua kali.
  select array_agg(u.id order by u.ord) into v_ids
    from (
      select distinct on (x.id) x.id, x.ord
        from unnest(p_product_ids) with ordinality as x(id, ord)
       where x.id is not null
       order by x.id, x.ord
    ) u;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then
    raise exception 'Keranjang kosong.' using errcode = 'P0001';
  end if;
  if v_n > 20 then
    raise exception 'Paling banyak 20 produk dalam satu pesanan.' using errcode = 'P0001';
  end if;

  -- Gerbang P1, per produk. Untuk larik SATU produk kalimatnya SAMA PERSIS
  -- dengan P1 — uji P1 dan rute checkout bergantung padanya.
  for idx in 1 .. v_n loop
    v_id := v_ids[idx];
    v_judul := null;
    v_harga := null;
    v_bulan := null;

    select p.judul, h.harga, p.masa_berlaku_bulan into v_judul, v_harga, v_bulan
      from public.digital_products p
      join public.harga_produk_publik h on h.product_id = p.id
     where p.id = v_id and p.aktif;
    if v_harga is null then
      raise exception 'Produk tidak tersedia.' using errcode = 'P0002';
    end if;

    if v_harga = 0 then
      raise exception '%', case when v_n = 1
        then 'Produk ini gratis — ambil lewat tombol ambil, bukan checkout.'
        else format('"%s" gratis — hapus dari keranjang dan ambil lewat halamannya.', v_judul)
      end using errcode = 'P0001';
    end if;

    -- AKTIF, bukan sekadar ada: akses yang kedaluwarsa boleh dibeli lagi.
    if public.akses_aktif(v_client_id, v_id) then
      raise exception '%', case when v_n = 1
        then 'Anda sudah memiliki produk ini — buka di Pembelian Saya.'
        else format('Anda sudah memiliki "%s" — hapus dari keranjang.', v_judul)
      end using errcode = 'P0001';
    end if;

    -- Set WAJIB cermin `punya_pesanan_menunggu` (minus `menunggu_bayar`,
    -- yang ditangani blok pesanan terbuka di bawah).
    -- Satu definisi bersama punya_pesanan_menunggu (lihat atas).
    if public.pembayaran_produk_menggantung(v_client_id, v_id) then
      raise exception '%', case when v_n = 1
        then 'Pembayaran Anda untuk produk ini sedang ditinjau staf.'
        else format('Pembayaran Anda untuk "%s" sedang ditinjau staf — hapus dari keranjang.', v_judul)
      end using errcode = 'P0001';
    end if;

    v_judul_arr := v_judul_arr || v_judul;
    v_harga_arr := v_harga_arr || v_harga;
    v_bulan_arr := v_bulan_arr || v_bulan;
  end loop;

  -- Pesanan terbuka yang sudah ada. `for update` menyerialkan dua panggilan
  -- `p_ulang` yang datang bersamaan supaya `percobaan` tidak melompat dua.
  select o.id, o.kode, o.percobaan
    into v_terbuka_id, v_terbuka_kode, v_terbuka_percobaan
    from public.orders o
   where o.client_id = v_client_id and o.status = 'menunggu_bayar'
   for update;

  if v_terbuka_id is not null then
    -- TIDAK dibatalkan otomatis bila isinya berbeda: instruksi VA-nya mungkin
    -- sudah di tangan pembeli, dan menutupnya mengundang lunas_setelah_tutup.
    if not public.himpunan_produk_pesanan_sama(v_terbuka_id, v_ids) then
      raise exception
        'Selesaikan dulu pesanan % yang masih terbuka, atau batalkan lebih dulu.',
        v_terbuka_kode using errcode = 'P0001';
    end if;

    if not p_ulang then
      v_pesanan_id := v_terbuka_id;
      v_kode := v_terbuka_kode;
      v_percobaan := v_terbuka_percobaan;
    elsif v_terbuka_percobaan < 9 then
      update public.orders o
         set percobaan = v_terbuka_percobaan + 1,
             snap_token = null,
             snap_diterbitkan_pada = null
       where o.id = v_terbuka_id
         and o.status = any (array['menunggu_bayar']::public.order_status[])
      returning o.id, o.kode, o.percobaan
        into v_pesanan_id, v_kode, v_percobaan;

      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (v_pesanan_id, v_padma_id, 'dibuat', format('percobaan ke-%s', v_percobaan));
    else
      if not coalesce(
        public.perpindahan_pesanan_sah('menunggu_bayar'::public.order_status,
                                       'dibatalkan'::public.order_status), false) then
        raise exception 'Mesin status menolak menutup pesanan %.', v_terbuka_kode
          using errcode = 'P0001';
      end if;

      update public.orders o
         set status = 'dibatalkan',
             ditutup_pada = now()
       where o.id = v_terbuka_id
         and o.status = any (array['menunggu_bayar']::public.order_status[]);

      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (v_terbuka_id, v_padma_id, 'dibatalkan',
              'percobaan kesepuluh: pesanan lama ditutup, pesanan baru diterbitkan');
    end if;
  end if;

  while v_pesanan_id is null and v_sisa > 0 loop
    v_sisa := v_sisa - 1;
    v_kode := 'PSN-'
           || to_char((now() at time zone 'Asia/Jakarta')::date, 'YYMMDD')
           || '-'
           || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.orders (kode, client_id, jumlah_item)
      values (v_kode, v_client_id, v_n)
      -- DIKUALIFIKASI: `percobaan` juga nama parameter OUT (alasan di P1).
      returning orders.id, orders.percobaan into v_pesanan_id, v_percobaan;
      v_baru := true;
    exception when unique_violation then
      get stacked diagnostics v_kendala = constraint_name;
      if v_kendala = 'pesanan_terbuka_satu_per_klien' then
        select o.id, o.kode, o.percobaan
          into v_terbuka_id, v_terbuka_kode, v_terbuka_percobaan
          from public.orders o
         where o.client_id = v_client_id and o.status = 'menunggu_bayar';

        if not public.himpunan_produk_pesanan_sama(v_terbuka_id, v_ids) then
          raise exception
            'Selesaikan dulu pesanan % yang masih terbuka, atau batalkan lebih dulu.',
            v_terbuka_kode using errcode = 'P0001';
        end if;

        v_pesanan_id := v_terbuka_id;
        v_kode := v_terbuka_kode;
        v_percobaan := v_terbuka_percobaan;
      elsif v_kendala <> 'orders_kode_unik' then
        raise;
      end if;
    end;
  end loop;

  if v_pesanan_id is null then
    raise exception 'Gagal menerbitkan kode pesanan sesudah lima percobaan. Coba lagi.'
      using errcode = 'P0001';
  end if;

  if v_baru then
    -- Harga & judul DIBEKUKAN di sini, dalam urutan keranjang.
    insert into public.order_items (
      pesanan_id, jenis, product_id, judul_beku, harga_beku, masa_berlaku_bulan_beku, urutan
    )
    select v_pesanan_id, 'produk_digital', v_ids[k], v_judul_arr[k], v_harga_arr[k], v_bulan_arr[k], k
      from generate_series(1, v_n) as k;

    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'dibuat',
            case when v_n = 1 then 'checkout produk digital'
                 else format('checkout keranjang, %s produk', v_n) end);
  end if;

  return query
    select v_pesanan_id,
           v_kode,
           v_percobaan,
           (select coalesce(sum(oi.harga_beku), 0)::integer
              from public.order_items oi
             where oi.pesanan_id = v_pesanan_id),
           (select oi.judul_beku
              from public.order_items oi
             where oi.pesanan_id = v_pesanan_id
             order by oi.urutan
             limit 1),
           (select count(*)::smallint
              from public.order_items oi
             where oi.pesanan_id = v_pesanan_id);
end;
$$;

comment on function public.buat_pesanan_keranjang(uuid[], boolean) is
  'Satu-satunya pintu klien melahirkan pesanan (1..20 produk digital). client_id '
  'dari auth.uid(). Gerbang P1 per produk. Pesanan terbuka dipulangkan bila '
  'himpunan produknya sama, ditolak bila berbeda. buat_pesanan(uuid, boolean) '
  'adalah pembungkus satu-item.';

revoke all on function public.buat_pesanan_keranjang(uuid[], boolean) from public, anon;
grant execute on function public.buat_pesanan_keranjang(uuid[], boolean) to authenticated;

create or replace function public.terbitkan_akses_item(p_item_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_pesanan_id uuid;
  v_client_id uuid;
  v_padma_id text;
  v_product_id uuid;
  v_jenis public.order_item_source;
  v_ent_id uuid;
  v_dicabut timestamptz;
  v_baru uuid;
  v_bulan integer;
  v_sampai timestamptz;
  v_sampai_baru timestamptz;
begin
  select i.pesanan_id, i.product_id, i.jenis, o.client_id, c.padma_id, i.masa_berlaku_bulan_beku
    into v_pesanan_id, v_product_id, v_jenis, v_client_id, v_padma_id, v_bulan
    from public.order_items i
    join public.orders o on o.id = i.pesanan_id
    join public.clients c on c.id = o.client_id
   where i.id = p_item_id;

  if v_pesanan_id is null then
    raise exception 'Item pesanan % tidak ditemukan.', p_item_id using errcode = 'P0002';
  end if;
  if v_jenis <> 'produk_digital' then
    raise exception 'Item % bukan produk digital; aksesnya bukan urusan fungsi ini.', p_item_id
      using errcode = 'P0001';
  end if;

  -- Dihitung SEJAK AKSES TERBIT (now()), bukan sejak lunas_pada: di alur
  -- otomatis selisihnya detik, dan pesanan yang tertahan lalu diterbitkan
  -- admin berhari-hari kemudian tidak memakan masa berlaku pembeli.
  -- Dikonfirmasi pemilik repo 16 Okt 2026.
  v_sampai_baru := case when v_bulan is null then null
                        else now() + make_interval(months => v_bulan) end;

  select e.id, e.dicabut_pada, e.berlaku_sampai into v_ent_id, v_dicabut, v_sampai
    from public.digital_entitlements e
   where e.client_id = v_client_id and e.product_id = v_product_id
   for update;

  -- (1) BELUM ADA BARISNYA
  if v_ent_id is null then
    insert into public.digital_entitlements (client_id, product_id, sumber, pesanan_id, berlaku_sampai)
    values (v_client_id, v_product_id, 'beli', v_pesanan_id, v_sampai_baru)
    on conflict (client_id, product_id) do nothing
    returning id into v_baru;

    if v_baru is not null then
      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (v_pesanan_id, v_padma_id, 'akses_terbit', format('produk %s', v_product_id));
      return 'akses_terbit';
    end if;

    -- Balapan: barisnya lahir di antara SELECT dan INSERT (jalur gratis
    -- berjalan bersamaan). Nilai ulang, jangan menebak.
    select e.id, e.dicabut_pada, e.berlaku_sampai into v_ent_id, v_dicabut, v_sampai
      from public.digital_entitlements e
     where e.client_id = v_client_id and e.product_id = v_product_id;

    if v_ent_id is null then
      -- Mustahil di bawah `unique (client_id, product_id)`: INSERT gagal
      -- karena KONFLIK, tapi SELECT ulang tidak menemukan baris yang
      -- bertabrakan dengannya. Diam di sini berarti (2) di bawah berjalan
      -- dengan v_ent_id NULL — UPDATE `pesanan_id` mengenai nol baris, dan
      -- fungsi memulangkan 'akses_sudah_ada' padahal TIDAK ADA entitlement
      -- dan TIDAK ADA tinjauan yang menyala. Mustahil yang diam-diam adalah
      -- mustahil yang harus melempar, bukan mustahil yang harus dipercaya.
      raise exception 'Balapan entitlement produk % tidak terselesaikan.', v_product_id
        using errcode = 'P0002';
    end if;
  end if;

  -- (2b) ADA, BELUM DICABUT, SUDAH KEDALUWARSA → beli ulang memperbarui.
  -- Dicatat sebagai akses_terbit (bukan nilai enum baru): memang penerbitan
  -- akses, dan himpunan kejadian di TypeScript tidak perlu tumbuh.
  -- Notifikasi kembar untuk pesanan yang sama jatuh ke (2a) di bawah, karena
  -- aksesnya baru saja menjadi aktif — tidak ada perpanjangan ganda.
  if v_dicabut is null and v_sampai is not null and v_sampai <= now() then
    update public.digital_entitlements e
       set berlaku_sampai = v_sampai_baru,
           pesanan_id = v_pesanan_id,
           sumber = 'beli',
           diberikan_pada = now()
     where e.id = v_ent_id;

    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'akses_terbit', format('diperbarui, produk %s', v_product_id));
    return 'akses_terbit';
  end if;

  -- (2a) ADA, BELUM DICABUT, MASIH AKTIF
  if v_dicabut is null then
    -- `sumber` TIDAK dinaikkan menjadi 'beli': entitlement gratis yang
    -- produknya kemudian dibeli tetap gratis. Yang mencatat pendapatan adalah
    -- `orders`, bukan kolom ini.
    update public.digital_entitlements e
       set pesanan_id = v_pesanan_id
     where e.id = v_ent_id and e.pesanan_id is null;

    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'akses_sudah_ada', format('produk %s', v_product_id));
    return 'akses_sudah_ada';
  end if;

  -- (3) ADA DAN SUDAH DICABUT
  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (v_pesanan_id, v_padma_id, 'akses_tertahan',
          format('entitlement produk %s dicabut pada %s — akses tidak dihidupkan',
                 v_product_id, v_dicabut));

  -- Array POSITIF LIMA nilai, bukan dua: `status = any(...)` di sini bukan
  -- pagar CHECK (UPDATE ini tidak menyentuh `status` maupun `ditutup_pada`,
  -- jadi tidak ada kombinasi yang bisa melanggar `pesanan_tutup_bercap`),
  -- melainkan asumsi tentang SIAPA YANG MEMANGGIL. `status in ('lunas',
  -- 'ditahan')` benar untuk pemanggil hari ini (satu-satunya: cabang lunas
  -- `terapkan_notifikasi_midtrans`), tapi begitu Tugas 11 ("Terbitkan akses")
  -- memanggil fungsi ini pada baris yang SUDAH `kedaluwarsa`/`dibatalkan`/
  -- bahkan masih `menunggu_bayar`, dua nilai itu membuat UPDATE ini mengenai
  -- NOL baris — jejak `akses_tertahan` tetap tercatat, tapi
  -- `butuh_tinjauan_pada` TIDAK menyala, tidak ada yang melempar, dan fungsi
  -- memulangkan string yang SAMA dengan jalur sehat. Sama seperti langkah (5)
  -- "Cermin kolom Midtrans" di `terapkan_notifikasi_midtrans` di bawah, array
  -- di sini dilebarkan ke lima nilai supaya "uang masuk, barang tidak keluar"
  -- tidak pernah diam hanya karena pemanggilnya bukan yang dibayangkan hari
  -- ini.
  update public.orders o
     set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
         -- coalesce: sebab PERTAMA yang menyalakan tinjauan bertahan, sepasang
         -- dengan `butuh_tinjauan_pada` sebaris di atasnya. Baris `lunas` yang
         -- sudah bertanda `selisih_nominal` lalu gagal menerbitkan akses akan
         -- kehilangan alasan pertamanya kalau baris ini menugaskan telanjang.
         sebab_tinjauan = coalesce(o.sebab_tinjauan, 'akses_tertahan')
   where o.id = v_pesanan_id
     and o.status = any (array['menunggu_bayar','ditahan','lunas','kedaluwarsa','dibatalkan']::public.order_status[]);

  return 'akses_tertahan';
end;
$$;

revoke all on function public.terbitkan_akses_item(uuid) from public, anon, authenticated;
