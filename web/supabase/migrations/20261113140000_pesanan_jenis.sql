-- Jenis pesanan (tugas B1, spec §6.6/§6.10): `orders` kini memikul dua jenis,
-- produk digital dan sesi (tagihan pengajuan). Satu pesanan terbuka per klien
-- hanya berlaku untuk produk; pesanan sesi terbuka paling banyak satu per
-- pengajuan.
alter table public.orders
  add column jenis public.order_item_source not null default 'produk_digital',
  add column booking_request_id uuid references public.booking_requests(id);

alter table public.orders
  add constraint pesanan_jenis_bercermin
  check ((jenis = 'sesi') = (booking_request_id is not null));

drop index public.pesanan_terbuka_satu_per_klien;

create unique index pesanan_produk_terbuka_satu_per_klien
  on public.orders (client_id)
  where status = 'menunggu_bayar' and jenis = 'produk_digital';

create unique index pesanan_sesi_terbuka_satu_per_pengajuan
  on public.orders (booking_request_id)
  where status = 'menunggu_bayar';

-- ---------------------------------------------------------------------------
-- buat_pesanan_keranjang: salinan 20261113130000; berubah hanya (1) dua
-- pemilihan pesanan terbuka ditambah jenis = 'produk_digital', (2) nama
-- kendala di handler unique_violation.
-- ---------------------------------------------------------------------------
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
           and o.jenis = 'produk_digital'
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
             tautan_gateway = null,
             tautan_terbit_pada = null
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
      if v_kendala = 'pesanan_produk_terbuka_satu_per_klien' then
        select o.id, o.kode, o.percobaan
          into v_terbuka_id, v_terbuka_kode, v_terbuka_percobaan
          from public.orders o
         where o.client_id = v_client_id and o.status = 'menunggu_bayar'
           and o.jenis = 'produk_digital';

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

-- ---------------------------------------------------------------------------
-- batalkan_pesanan_saya: salinan 20260926130000; berubah hanya syarat
-- jenis = 'produk_digital'. Pesanan sesi dibatalkan lewat jalur pengajuan.
-- ---------------------------------------------------------------------------
create or replace function public.batalkan_pesanan_saya(p_pesanan_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid;
  v_padma_id text;
  v_kena uuid;
begin
  select c.id, c.padma_id into v_client_id, v_padma_id
    from public.clients c
   where c.user_id = auth.uid();
  if v_client_id is null then
    raise exception 'Akun ini belum tertaut ke rekam klien.' using errcode = '42501';
  end if;

  if not coalesce(
    public.perpindahan_pesanan_sah('menunggu_bayar'::public.order_status,
                                   'dibatalkan'::public.order_status), false) then
    raise exception 'Mesin status menolak pembatalan mandiri.' using errcode = 'P0001';
  end if;

  update public.orders o
     set status = 'dibatalkan',
         ditutup_pada = now()
   where o.id = p_pesanan_id
     and o.client_id = v_client_id
     and o.jenis = 'produk_digital'
     and o.status = any (array['menunggu_bayar']::public.order_status[])
  returning o.id into v_kena;

  -- Tidak mengenai baris mana pun bukan galat: sudah dibatalkan, sudah lunas,
  -- atau bukan miliknya. `false` dibedakan dari galat oleh pemanggilnya.
  if v_kena is null then
    return false;
  end if;

  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (p_pesanan_id, v_padma_id, 'dibatalkan', 'dibatalkan sendiri oleh klien');
  return true;
end;
$$;

comment on function public.batalkan_pesanan_saya(uuid) is
  'Pembatalan mandiri pesanan MILIK PEMANGGIL yang masih menunggu bayar. '
  'Memulangkan false (bukan galat) bila tidak mengenai baris mana pun.';

revoke all on function public.batalkan_pesanan_saya(uuid) from public, anon;
grant execute on function public.batalkan_pesanan_saya(uuid) to authenticated;

