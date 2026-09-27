-- ===========================================================================
-- sebab_tinjauan LESTARI — alasan PERTAMA tidak pernah tertimpa
-- ===========================================================================
-- Migrasi ke-91, dan ia tidak melahirkan apa pun: ketiga fungsi di bawah sudah
-- ada sejak `20260926140000_pesanan_webhook_rpc.sql`. Yang berubah cuma LIMA
-- assignment `sebab_tinjauan`, masing-masing dibungkus
-- `coalesce(o.sebab_tinjauan, …)`.
--
-- ===== KENAPA =====
-- Setiap UPDATE penanda tinjauan sudah menulis
-- `butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now())` — cap WAKTU
-- pertama yang bertahan. Pasangannya, `sebab_tinjauan`, menugaskan telanjang di
-- lima tempat, jadi cap waktunya menyebut kejadian pertama sementara alasannya
-- menyebut kejadian terakhir. Dua kolom yang hidup berpasangan dan bercerita
-- beda adalah kolom yang membuat staf memutuskan perkara uang dengan alasan
-- yang salah.
--
-- Jalannya terjangkau HARI INI, tanpa satu baris kode baru: notifikasi `refund`
-- atau `chargeback` yang mendarat pada pesanan yang sudah bertanda
-- `lunas_setelah_tutup` menimpa alasannya diam-diam — dan `lunas_setelah_tutup`
-- adalah satu-satunya petunjuk bahwa uang pernah masuk pada pesanan yang sudah
-- kami tutup.
--
-- ===== LIMA, BUKAN TUJUH =====
-- Dua UPDATE `sebab_tinjauan` yang lain TIDAK disentuh, dan keduanya sengaja:
--   * cabang "notifikasi mendarat pada pesanan yang sedang ditahan" sudah
--     menulis `coalesce(o.sebab_tinjauan, 'selisih_status')` sejak hari
--     pertama — dialah cetakan yang empat lainnya ikuti;
--   * UPDATE transisi (`set status = v_tujuan …`) menulis
--     `coalesce(v_sebab, o.sebab_tinjauan)`, arah yang KEBALIKAN dan memang
--     benar di sana: baris itu satu-satunya yang benar-benar MEMINDAHKAN
--     pesanan, dan alasan keadaan barunya menggantikan alasan keadaan lamanya.
--
-- ===== KENAPA `create or replace`, BUKAN `drop` + `create` =====
-- Ketiganya ada di `MESIN_TERTUTUP` (`tests/fungsi-mesin-tertutup.test.ts`):
-- hak eksekusinya sudah dicabut dari `public`, `anon`, dan `authenticated`.
-- `create or replace` mempertahankan OID fungsinya, jadi ACL DAN
-- `comment on function` ikut lestari tanpa satu baris pun ditulis ulang di
-- sini. `drop` + `create` mengembalikan default privileges Supabase, dan fungsi
-- mesin yang terbuka bagi `authenticated` berarti vonis Midtrans bisa diketik
-- pemanggil bersesi.
--
-- Bila revisi berikutnya TETAP memilih `drop` + `create`, ia WAJIB menulis ulang
-- ketiga barisnya:
--   revoke all on function public.terbitkan_akses_item(uuid) from public, anon, authenticated;
--   revoke all on function public.salurkan_pesanan(uuid) from public, anon, authenticated;
--   revoke all on function
--     public.terapkan_notifikasi_midtrans(text, text, text, text, text, numeric, text, text)
--     from public, anon, authenticated;
-- Lupa menulisnya bukan kegagalan senyap — `tests/fungsi-mesin-tertutup.test.ts`
-- menangkapnya, dan itu memang gunanya.
--
-- Badan ketiga fungsi di bawah adalah SALINAN PERSIS dari
-- `20260926140000_pesanan_webhook_rpc.sql`, kecuali kelima baris `coalesce` itu
-- dan komentar yang menjelaskannya. Menyalin dari berkas itu, bukan menulis
-- ulang dari ingatan, adalah bagian dari perintahnya.

-- ---------------------------------------------------------------------------
-- 1/3 — terbitkan_akses_item: `akses_tertahan`
-- ---------------------------------------------------------------------------
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
begin
  select i.pesanan_id, i.product_id, i.jenis, o.client_id, c.padma_id
    into v_pesanan_id, v_product_id, v_jenis, v_client_id, v_padma_id
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

  select e.id, e.dicabut_pada into v_ent_id, v_dicabut
    from public.digital_entitlements e
   where e.client_id = v_client_id and e.product_id = v_product_id
   for update;

  -- (1) BELUM ADA BARISNYA
  if v_ent_id is null then
    insert into public.digital_entitlements (client_id, product_id, sumber, pesanan_id)
    values (v_client_id, v_product_id, 'beli', v_pesanan_id)
    on conflict (client_id, product_id) do nothing
    returning id into v_baru;

    if v_baru is not null then
      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (v_pesanan_id, v_padma_id, 'akses_terbit', format('produk %s', v_product_id));
      return 'akses_terbit';
    end if;

    -- Balapan: barisnya lahir di antara SELECT dan INSERT (jalur gratis
    -- berjalan bersamaan). Nilai ulang, jangan menebak.
    select e.id, e.dicabut_pada into v_ent_id, v_dicabut
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

  -- (2) ADA DAN BELUM DICABUT
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

-- ---------------------------------------------------------------------------
-- 2/3 — salurkan_pesanan: `penangan_belum_ada`
-- ---------------------------------------------------------------------------
create or replace function public.salurkan_pesanan(p_pesanan_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_padma_id text;
begin
  select c.padma_id into v_padma_id
    from public.orders o
    join public.clients c on c.id = o.client_id
   where o.id = p_pesanan_id;
  if v_padma_id is null then
    raise exception 'Pesanan % tidak ditemukan.', p_pesanan_id using errcode = 'P0002';
  end if;

  for r in
    select i.id, i.jenis
      from public.order_items i
     where i.pesanan_id = p_pesanan_id
     order by i.urutan
  loop
    case r.jenis
      when 'produk_digital' then
        perform public.terbitkan_akses_item(r.id);
      when 'sesi' then
        -- Nilai enum `sesi` lahir sebelum penulisnya (P3). Yang lahir di sini
        -- bukan penanganan diam-diam, melainkan panggilan kepada manusia.
        insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
        values (p_pesanan_id, v_padma_id, 'penangan_belum_ada',
                format('item %s berjenis sesi — P1 belum punya penyalurnya', r.id));

        -- Array POSITIF LIMA nilai — alasan yang sama persis dengan
        -- `terbitkan_akses_item` (lihat komentarnya): `status = any(...)` di
        -- sini adalah asumsi soal siapa pemanggil, bukan pagar CHECK, dan
        -- pemanggil kedua (Tugas 11) bisa mengenai baris yang tidak ada di
        -- ('lunas','ditahan'). Diam di sana berarti jejak tercatat tapi
        -- tinjauan tidak menyala.
        update public.orders o
           set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
               -- coalesce, alasan yang sama dengan `terbitkan_akses_item`:
               -- pesanan berisi DUA item bisa lebih dulu menyalakan tinjauan
               -- lewat item pertama, dan item kedua tidak boleh menimpanya.
               sebab_tinjauan = coalesce(o.sebab_tinjauan, 'penangan_belum_ada')
         where o.id = p_pesanan_id
           and o.status = any (array['menunggu_bayar','ditahan','lunas','kedaluwarsa','dibatalkan']::public.order_status[]);
      else
        -- Nilai `order_item_source` KETIGA yang kelak lahir berhenti di sini
        -- dengan kalimat, bukan dengan `case_not_found` yang tidak menyebut
        -- apa pun. Fail-closed disengaja: diam berarti uang diambil untuk
        -- barang yang tidak ada yang tahu cara menyerahkannya.
        raise exception 'Jenis item pesanan % belum punya penyalur: %', r.id, r.jenis
          using errcode = 'P0001';
    end case;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3/3 — terapkan_notifikasi_midtrans: `v_sebab` (refund/chargeback/asing),
--       `lunas_setelah_tutup`, dan `selisih_status` (transisi ditolak)
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
    pesanan_id, sidik, transaksi_id, status_midtrans, kanal, nominal_diterima
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
         status_midtrans  = p_transaction_status,
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
