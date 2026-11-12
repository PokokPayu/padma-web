-- Kolom netral-gateway (tugas A3): nama Midtrans diganti nama yang tidak
-- terikat gateway. Midtrans tetap berjalan sampai 20261113130200.
alter table public.orders rename column snap_token to tautan_gateway;
alter table public.orders rename column snap_diterbitkan_pada to tautan_terbit_pada;
alter table public.orders rename column status_midtrans to status_gateway;
alter table public.notifikasi_pesanan rename column status_midtrans to status_gateway;

-- ---------------------------------------------------------------------------
-- buat_pesanan_keranjang: salinan definisi 20261016120000, hanya nama kolom
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

-- ---------------------------------------------------------------------------
-- catat_tautan_gateway menggantikan catat_token_snap
-- ---------------------------------------------------------------------------
drop function public.catat_token_snap(uuid, text);

-- Tautan gateway BUKAN bukti pembayaran dan tidak pernah dipercaya sebagai
-- bukti oleh apa pun; ia hanya alamat halaman bayar. Yang dijaga: pesanan
-- harus milik pemanggil, masih terbuka, dan percobaannya masih yang sama.
create function public.catat_tautan_gateway(
  p_pesanan_id uuid,
  p_percobaan smallint,
  p_tautan text
) returns void
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

  update public.orders o
     set tautan_gateway = p_tautan,
         tautan_terbit_pada = now()
   where o.id = p_pesanan_id
     and o.client_id = v_client_id
     and o.percobaan = p_percobaan
     and o.status = any (array['menunggu_bayar']::public.order_status[])
  returning o.id into v_kena;

  if v_kena is null then
    -- P0002 ("no data found"), bukan 42501: pemanggil tidak boleh bisa
    -- membedakan "bukan milik saya" dari "sudah tidak terbuka" atau
    -- "percobaan sudah berganti".
    raise exception 'Pesanan terbuka itu tidak ada pada akun ini.' using errcode = 'P0002';
  end if;

  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (p_pesanan_id, v_padma_id, 'token_terbit', 'tautan gateway dicatat');
end;
$$;

comment on function public.catat_tautan_gateway(uuid, smallint, text) is
  'Mencatat tautan gateway pada pesanan MILIK PEMANGGIL yang masih menunggu '
  'bayar pada percobaan yang sama. Tautan bukan bukti pembayaran; yang dijaga '
  'hanya kepemilikan barisnya.';

revoke all on function public.catat_tautan_gateway(uuid, smallint, text) from public, anon;
grant execute on function public.catat_tautan_gateway(uuid, smallint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- SEMENTARA — di-drop di 20261113130200. Salinan 20260927100000, hanya
-- status_midtrans -> status_gateway.
-- ---------------------------------------------------------------------------
create or replace function public.terapkan_notifikasi_midtrans(
  p_order_id text,
  p_transaction_status text,
  p_fraud_status text,
  p_transaction_id text,
  p_payment_type text,
  p_gross_amount numeric,
  p_sidik text,
  p_sumber text default 'webhook'
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_kode text;
  v_percobaan smallint;
  v_percobaan_kini smallint;
  v_pesanan_id uuid;
  v_status public.order_status;
  v_jumlah_item smallint;
  v_padma_id text;
  v_notif_id uuid;
  v_total integer;
  v_cacah integer;
  v_baris integer;
  v_vonis text;
  v_tujuan public.order_status;
  v_kejadian public.order_event;
  v_sebab text;
begin
  if p_sumber not in ('webhook', 'status_api') then
    raise exception 'Sumber notifikasi tidak dikenal: %', p_sumber using errcode = 'P0001';
  end if;

  -- (1) BENTUK order_id. Rute sudah menyaringnya sebelum satu sha512 pun
  -- dihitung, tapi Lapis 1b dan Lapis 3 memanggil fungsi ini juga. Bentuk yang
  -- tidak dikenal berarti tidak ada pesanan untuk disembuhkan — bukan galat
  -- yang layak di-retry.
  if p_order_id !~ '^PSN-[0-9]{6}-[0-9A-F]{6}\.[1-9]$' then
    return 'pesanan_tidak_ada';
  end if;
  v_kode := split_part(p_order_id, '.', 1);
  v_percobaan := split_part(p_order_id, '.', 2)::smallint;

  -- (2) Pesanan dicari lewat KODE saja, sengaja BUKAN kode+percobaan.
  -- Notifikasi bisa datang untuk percobaan lama (popup Snap lama yang masih
  -- terbuka saat klien menekan "coba lagi"), dan uang yang mendarat lewat
  -- percobaan lama tetap uang yang mendarat. Selisih percobaan dicatat di
  -- jejak, tidak dipakai untuk membuang notifikasinya.
  select o.id, o.status, o.percobaan, o.jumlah_item, c.padma_id
    into v_pesanan_id, v_status, v_percobaan_kini, v_jumlah_item, v_padma_id
    from public.orders o
    join public.clients c on c.id = o.client_id
   where o.kode = v_kode
   for update of o;

  if v_pesanan_id is null then
    return 'pesanan_tidak_ada';
  end if;

  -- (3) PEMERIKSAAN ULANG DICATAT SEBELUM PINTU SIDIK.
  -- Kalau `diperiksa_pada` hanya disetel pada jalur yang lolos sidik, Status
  -- API yang memulangkan status yang SAMA akan selalu 'duplikat', kolomnya
  -- tidak pernah bergerak, dan pembatas "sekali per lima menit" di Lapis 1b
  -- tidak pernah berlaku — satu halaman yang di-refresh berkali-kali berubah
  -- menjadi banjir permintaan ke Midtrans.
  if p_sumber = 'status_api' then
    update public.orders o
       set diperiksa_pada = now()
     where o.id = v_pesanan_id
       and o.status = any (array['menunggu_bayar','ditahan','lunas','kedaluwarsa','dibatalkan']::public.order_status[]);

    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'diperiksa_ulang',
            format('status api menjawab %s', p_transaction_status));
  end if;

  -- (4) IDEMPOTENSI. `sidik` dihitung di rute (Node crypto) atas lima medan
  -- notifikasi, BUKAN atas order_id saja: Midtrans mengirim beberapa
  -- notifikasi per pesanan (`pending` lalu `settlement`), dan sidik sepesanan
  -- akan menolak `settlement` sebagai duplikat — pembeli membayar, uang masuk,
  -- pesanan tinggal `menunggu_bayar` selamanya.
  insert into public.notifikasi_pesanan (
    pesanan_id, sidik, transaksi_id, status_gateway, kanal, nominal_diterima
  ) values (
    v_pesanan_id, p_sidik, nullif(p_transaction_id, ''), p_transaction_status,
    nullif(p_payment_type, ''), p_gross_amount
  )
  on conflict (sidik) do nothing
  returning id into v_notif_id;

  if v_notif_id is null then
    return 'duplikat';
  end if;

  -- (5) Cermin kolom Midtrans pada barisnya. `status = any(<array positif>)`
  -- ditulis walau UPDATE ini tidak menyentuh status: nilai enum keenam yang
  -- kelak lahir tanpa diklasifikasikan jatuh ke luar array dan TIDAK mendapat
  -- cermin — kehilangan yang kecil dan terbatas, dibanding UPDATE tanpa pagar
  -- status yang menjadi kebiasaan lalu ditiru cabang yang benar-benar
  -- memindahkan baris.
  update public.orders o
     set notifikasi_pada  = case when p_sumber = 'webhook' then now() else o.notifikasi_pada end,
         transaksi_id     = coalesce(nullif(p_transaction_id, ''), o.transaksi_id),
         status_gateway  = p_transaction_status,
         kanal            = coalesce(nullif(p_payment_type, ''), o.kanal)
   where o.id = v_pesanan_id
     and o.status = any (array['menunggu_bayar','ditahan','lunas','kedaluwarsa','dibatalkan']::public.order_status[]);

  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (v_pesanan_id, v_padma_id, 'notifikasi',
          p_transaction_status
          || coalesce(' / ' || nullif(p_fraud_status, ''), '')
          || case when v_percobaan <> v_percobaan_kini
                  then format(' (order_id percobaan %s, baris kini di %s)', v_percobaan, v_percobaan_kini)
                  else '' end);

  -- (6) VONIS. `fraud_status` ikut karena `capture`+`challenge` dan
  -- `capture`+`accept` adalah dua keputusan berbeda atas transaksi yang sama.
  if p_transaction_status = 'settlement'
     or (p_transaction_status = 'capture'
         and coalesce(nullif(p_fraud_status, ''), 'accept') = 'accept') then
    v_vonis := 'lunas';
  elsif p_transaction_status = 'capture' then
    -- capture + challenge/deny: uangnya ditahan Midtrans, bukan kita.
    v_vonis := 'curiga';
  elsif p_transaction_status in ('expire', 'cancel') then
    v_vonis := 'kedaluwarsa';
  elsif p_transaction_status = 'deny' then
    v_vonis := 'dibatalkan';
  elsif p_transaction_status in ('pending', 'authorize') then
    v_vonis := 'menunggu';
  elsif p_transaction_status in ('refund', 'partial_refund') then
    v_vonis := 'refund';
  elsif p_transaction_status in ('chargeback', 'partial_chargeback') then
    v_vonis := 'chargeback';
  else
    v_vonis := 'asing';
  end if;

  if v_vonis = 'menunggu' then
    return 'tanpa_efek';
  end if;

  -- Pengembalian uang & status asing: status TIDAK bergerak, akses TIDAK
  -- dicabut, manusia dipanggil. Repo ini tidak punya mekanisme pengembalian
  -- uang di mana pun; menebak kebijakannya di webhook lebih buruk daripada
  -- memanggil manusia.
  if v_vonis in ('refund', 'chargeback', 'asing') then
    v_sebab := case when v_vonis = 'asing' then 'selisih_status' else v_vonis end;

    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'selisih_status',
            format('midtrans menjawab %s — ditangani manusia', p_transaction_status));

    update public.orders o
       set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
           -- coalesce: INI kasus yang terjangkau hari ini tanpa satu baris kode
           -- baru. Notifikasi `refund`/`chargeback` yang mendarat pada pesanan
           -- yang sudah bertanda `lunas_setelah_tutup` menimpa alasannya, dan
           -- staf kehilangan satu-satunya petunjuk bahwa uang pernah masuk pada
           -- pesanan yang sudah ditutup.
           sebab_tinjauan = coalesce(o.sebab_tinjauan, v_sebab)
     where o.id = v_pesanan_id
       and o.status = any (array['menunggu_bayar','ditahan','lunas','kedaluwarsa','dibatalkan']::public.order_status[]);

    return 'diterapkan';
  end if;

  -- (7) VERIFIKASI JUMLAH terhadap angka yang KITA simpan. Mustahil tanpa
  -- harga beku: angka pembandingnya ada di tangan Midtrans dan ikut
  -- ditandatangani. `nominal_diterima` sudah tersimpan di langkah (4) apa pun
  -- hasilnya di bawah.
  --
  -- Dihitung TANPA syarat vonis — bukan hanya di dalam `if v_vonis = 'lunas'`:
  -- cabang `curiga -> ditahan` (capture + challenge/deny) juga menulis baris
  -- audit `format('ditagih %s, diterima %s', v_total, ...)` di bawah, dan
  -- v_total yang hanya terisi pada jalur 'lunas' membuat baris yang staf baca
  -- untuk memutuskan pembayaran kartu yang dicurigai kehilangan separuh
  -- angkanya (tertagih kosong) — pada persis kasus yang paling butuh dibaca
  -- manusia.
  select coalesce(sum(i.harga_beku), 0)::integer, count(*)::integer
    into v_total, v_cacah
    from public.order_items i
   where i.pesanan_id = v_pesanan_id;

  if v_vonis = 'lunas' then
    if p_gross_amount is distinct from v_total::numeric or v_cacah <> v_jumlah_item then
      v_vonis := 'ditahan';
      v_sebab := 'selisih_nominal';
    end if;
  end if;

  if v_vonis = 'curiga' then
    v_vonis := 'ditahan';
    v_sebab := 'selisih_status';
  end if;

  if v_vonis = 'lunas' then
    v_tujuan := 'lunas'; v_kejadian := 'lunas';
  elsif v_vonis = 'ditahan' then
    v_tujuan := 'ditahan'; v_kejadian := 'ditahan';
  elsif v_vonis = 'kedaluwarsa' then
    v_tujuan := 'kedaluwarsa'; v_kejadian := 'kedaluwarsa';
  else
    v_tujuan := 'dibatalkan'; v_kejadian := 'dibatalkan';
  end if;

  -- (8a) Pesanan yang SUDAH TIDAK TERBUKA. Webhook tidak pernah memindahkan
  -- `ditahan` — itu putusan staf, dan satu-satunya jalannya
  -- `putuskan_pesanan_ditahan`.
  if v_status <> 'menunggu_bayar' then
    if v_vonis = 'lunas'
       and v_status = any (array['kedaluwarsa','dibatalkan']::public.order_status[]) then
      -- Settlement yang mendarat pada pesanan yang sudah kami tutup: tidak ada
      -- transisi, penyalur tidak berjalan, akses tidak terbit — dan tanpa
      -- penanda di bawah barisnya tidak muncul di blok mana pun meski uangnya
      -- sudah masuk.
      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (v_pesanan_id, v_padma_id, 'lunas_setelah_tutup',
              format('settlement %s mendarat pada pesanan %s', p_transaction_id, v_status));

      update public.orders o
         set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
             -- coalesce: pesanan `dibatalkan` bisa sudah bertanda `selisih_status`
             -- dari notifikasi sebelumnya, dan alasan pertama itulah yang
             -- menjelaskan kenapa barisnya ditutup begitu.
             sebab_tinjauan = coalesce(o.sebab_tinjauan, 'lunas_setelah_tutup')
       where o.id = v_pesanan_id
         and o.status = any (array['kedaluwarsa','dibatalkan']::public.order_status[]);

    elsif v_status = 'ditahan' and v_vonis in ('lunas', 'ditahan') then
      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (v_pesanan_id, v_padma_id, 'selisih_status',
              format('notifikasi %s mendarat pada pesanan yang sedang ditahan', p_transaction_status));

      update public.orders o
         set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
             sebab_tinjauan = coalesce(o.sebab_tinjauan, 'selisih_status')
       where o.id = v_pesanan_id
         and o.status = any (array['ditahan']::public.order_status[]);
    end if;

    return 'tanpa_efek';
  end if;

  -- (8b) Penjaga transisi. `coalesce(..., false)` WAJIB: `not NULL` adalah
  -- NULL dan `if NULL then` tidak dieksekusi — tanpa pembungkus ini penjaganya
  -- fail-OPEN.
  if not coalesce(public.perpindahan_pesanan_sah(v_status, v_tujuan), false) then
    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'selisih_status',
            format('mesin status menolak %s -> %s', v_status, v_tujuan));

    update public.orders o
       set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
           -- coalesce: baris `menunggu_bayar` yang ditolak mesin status bisa
           -- sudah bertanda sebab lain (mis. `akses_tertahan` dari tombol
           -- "Terbitkan akses" Tugas 11), dan sebab pertama yang bertahan.
           sebab_tinjauan = coalesce(o.sebab_tinjauan, 'selisih_status')
     where o.id = v_pesanan_id
       and o.status = any (array['menunggu_bayar']::public.order_status[]);

    return 'tanpa_efek';
  end if;

  update public.orders o
     set status = v_tujuan,
         ditutup_pada = now(),
         lunas_pada = case when v_tujuan = 'lunas' then now() else o.lunas_pada end,
         butuh_tinjauan_pada = case when v_sebab is null
                                    then o.butuh_tinjauan_pada
                                    else coalesce(o.butuh_tinjauan_pada, now()) end,
         sebab_tinjauan = coalesce(v_sebab, o.sebab_tinjauan)
   where o.id = v_pesanan_id
     and o.status = any (array['menunggu_bayar']::public.order_status[]);

  get diagnostics v_baris = row_count;
  if v_baris = 0 then
    -- Balapan yang kalah: barisnya sudah dipindahkan transaksi lain. Keadaan
    -- akhir sudah tercapai, dan 200 adalah jawabannya.
    return 'tanpa_efek';
  end if;

  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (v_pesanan_id, v_padma_id, v_kejadian,
          format('midtrans %s, transaksi %s', p_transaction_status, p_transaction_id));

  if v_sebab is not null then
    -- Aturan penanda tinjauan: kelima kejadian dalam KEJADIAN_BUTUH_TINJAUAN
    -- WAJIB menyetel butuh_tinjauan_pada + sebab_tinjauan di transaksi yang
    -- sama dengan jejaknya. Penandanya sudah disetel UPDATE di atas.
    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, v_sebab::public.order_event,
            format('ditagih %s, diterima %s', v_total, p_gross_amount));
  end if;

  -- (9) PENYALURAN, di transaksi yang SAMA, dan HANYA dari cabang yang
  -- benar-benar memindahkan baris.
  if v_tujuan = 'lunas' then
    perform public.salurkan_pesanan(v_pesanan_id);
  end if;

  return 'diterapkan';
end;
$$;
