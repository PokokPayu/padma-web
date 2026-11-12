-- ===========================================================================
-- terapkan_notifikasi_gateway — jantung mesin pembayaran untuk DOKU (tugas A4)
-- ===========================================================================
-- Satu fungsi menerapkan SATU jawaban DOKU (webhook atau Check Status) pada
-- pesanannya, dalam SATU transaksi: sisipan sidik, verifikasi nominal,
-- transisi, dan penyaluran. Rollback melepas sidiknya, jadi pengiriman ulang
-- DOKU dan rekonsiliasi masih bisa menyembuhkan kegagalan sementara.
--
-- Kerangkanya `terapkan_notifikasi_midtrans` (`20260927100000`), langkah demi
-- langkah. Yang berbeda:
--   * bentuk masukan: `invoice_number` DOKU (`PSN` + YYMMDD + 6 heksa + satu
--     digit percobaan, tanpa tanda hubung), bukan `order_id` Midtrans;
--   * vonis dari daftar status DOKU (tabel §5.5 spec). Daftar di bawah HARUS
--     sama dengan himpunan `STATUS_DOKU_*` di `src/lib/doku/status.ts`;
--     `tests/notifikasi-gateway-db.test.ts` mengadu keduanya;
--   * cabang `capture`/`challenge`/`deny`/`chargeback` Midtrans tidak punya
--     padanan DOKU dan tidak ikut. `ditahan` kini hanya lahir dari nominal;
--   * CACAT P1 DITUTUP (lihat langkah 9).
--
-- `terapkan_notifikasi_midtrans` tetap hidup sampai `20261113130200`.

create or replace function public.terapkan_notifikasi_gateway(
  p_invoice text,
  p_status text,
  p_transaksi_id text,
  p_kanal text,
  p_nominal numeric,
  p_sidik text,
  p_sumber text default 'webhook',
  p_keterangan text default null
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
  -- Untuk kalimat jejak saja. Kolom cermin dan `notifikasi_pesanan` tetap
  -- menyimpan `p_status` / `p_nominal` apa adanya.
  v_status_teks text := coalesce(nullif(p_status, ''), '(status kosong)');
  v_nominal_teks text := coalesce(p_nominal::text, 'tidak terbaca');
begin
  -- `coalesce`: sumber NULL bukan "webhook". Tanpa pembungkus, `null not in
  -- (...)` bernilai NULL dan pemeriksaannya diam-diam lolos.
  if coalesce(p_sumber, '') not in ('webhook', 'status_api') then
    raise exception 'Sumber notifikasi tidak dikenal: %', p_sumber using errcode = 'P0001';
  end if;

  -- (1) BENTUK INVOICE. Rute webhook sudah menyaringnya dengan
  -- `POLA_INVOICE_DOKU`, tetapi rekonsiliasi juga memanggil fungsi ini. Bentuk
  -- asing berarti tidak ada pesanan untuk disembuhkan, bukan galat yang layak
  -- diulang. Pola ini HARUS sama dengan `POLA_INVOICE_DOKU`
  -- (`src/lib/pesanan/order-id.ts`).
  if coalesce(p_invoice, '') !~ '^PSN[0-9]{6}[0-9A-F]{6}[1-9]$' then
    return 'pesanan_tidak_ada';
  end if;
  -- Kebalikan `rakitInvoice`: tanda hubung `kode` dikembalikan, digit
  -- terakhir adalah percobaan.
  v_kode := 'PSN-' || substr(p_invoice, 4, 6) || '-' || substr(p_invoice, 10, 6);
  v_percobaan := substr(p_invoice, 16, 1)::smallint;

  -- (2) Pesanan dicari lewat KODE saja, bukan kode+percobaan. Invoice lama
  -- yang masih terbuka di tangan pembeli tetap bisa dibayar sesudah ia menekan
  -- "coba lagi", dan uang yang mendarat lewat percobaan lama tetap uang yang
  -- mendarat. Selisih percobaan dicatat di jejak, tidak dipakai untuk membuang
  -- jawabannya.
  select o.id, o.status, o.percobaan, o.jumlah_item, c.padma_id
    into v_pesanan_id, v_status, v_percobaan_kini, v_jumlah_item, v_padma_id
    from public.orders o
    join public.clients c on c.id = o.client_id
   where o.kode = v_kode
   for update of o;

  if v_pesanan_id is null then
    return 'pesanan_tidak_ada';
  end if;

  -- (3) PEMERIKSAAN ULANG DICATAT SEBELUM PINTU SIDIK. Check Status yang
  -- menjawab sama berulang kali selalu 'duplikat'; bila `diperiksa_pada` hanya
  -- bergerak di jalur yang lolos sidik, pembatas "sekali per lima menit"
  -- Lapis 1b tidak pernah berlaku dan setiap muat ulang halaman menembak DOKU.
  if p_sumber = 'status_api' then
    update public.orders o
       set diperiksa_pada = now()
     where o.id = v_pesanan_id
       and o.status = any (array['menunggu_bayar','ditahan','lunas','kedaluwarsa','dibatalkan']::public.order_status[]);

    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'diperiksa_ulang',
            format('status api menjawab %s', v_status_teks));
  end if;

  -- (4) IDEMPOTENSI. Sidik dihitung rute atas jawaban DOKU, bukan atas
  -- invoice saja: satu invoice menerima lebih dari satu jawaban (PENDING lalu
  -- SUCCESS), dan sidik per-invoice akan menolak SUCCESS sebagai duplikat.
  insert into public.notifikasi_pesanan (
    pesanan_id, sidik, transaksi_id, status_gateway, kanal, nominal_diterima
  ) values (
    v_pesanan_id, p_sidik, nullif(p_transaksi_id, ''), p_status,
    nullif(p_kanal, ''), p_nominal
  )
  on conflict (sidik) do nothing
  returning id into v_notif_id;

  if v_notif_id is null then
    return 'duplikat';
  end if;

  -- (5) Cermin kolom gateway. Pagar `status = any(<array positif>)` ditulis
  -- walau status tidak disentuh, dengan alasan yang sama seperti versi
  -- Midtrans: nilai enum baru yang belum diklasifikasikan tidak mendapat
  -- cermin, alih-alih UPDATE tanpa pagar menjadi kebiasaan yang ditiru.
  update public.orders o
     set notifikasi_pada = case when p_sumber = 'webhook' then now() else o.notifikasi_pada end,
         transaksi_id    = coalesce(nullif(p_transaksi_id, ''), o.transaksi_id),
         status_gateway  = p_status,
         kanal           = coalesce(nullif(p_kanal, ''), o.kanal)
   where o.id = v_pesanan_id
     and o.status = any (array['menunggu_bayar','ditahan','lunas','kedaluwarsa','dibatalkan']::public.order_status[]);

  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (v_pesanan_id, v_padma_id, 'notifikasi',
          v_status_teks
          || case when v_percobaan <> v_percobaan_kini
                  then format(' (invoice percobaan %s, pesanan kini di percobaan %s)',
                              v_percobaan, v_percobaan_kini)
                  else '' end
          || coalesce(' — ' || nullif(p_keterangan, ''), ''));

  -- (6) VONIS, dari daftar eksplisit. Status yang tidak disebut di sini,
  -- termasuk string kosong dan `VOIDED`, jatuh ke `asing`: manusia dipanggil,
  -- status tidak bergerak.
  if p_status = 'SUCCESS' then
    v_vonis := 'lunas';
  elsif p_status in ('PENDING', 'REDIRECT', 'TIMEOUT', 'FAILED') then
    -- FAILED di DOKU Checkout bukan akhir: pembeli boleh berganti metode
    -- pada halaman yang sama.
    v_vonis := 'menunggu';
  elsif p_status = 'EXPIRED' then
    v_vonis := 'kedaluwarsa';
  elsif p_status in ('REFUNDED', 'PARTIAL_REFUNDED') then
    v_vonis := 'refund';
  else
    v_vonis := 'asing';
  end if;

  if v_vonis = 'menunggu' then
    return 'tanpa_efek';
  end if;

  -- (7) Refund dan status asing: status TIDAK bergerak, akses TIDAK dicabut,
  -- manusia dipanggil. Repo ini tidak punya mekanisme pengembalian uang, dan
  -- menebak kebijakannya di sini lebih buruk daripada memanggil staf.
  if v_vonis in ('refund', 'asing') then
    v_sebab := case when v_vonis = 'asing' then 'selisih_status' else 'refund' end;

    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'selisih_status',
            format('doku menjawab %s — ditangani manusia', v_status_teks));

    update public.orders o
       set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
           -- coalesce: sebab PERTAMA bertahan. Refund yang mendarat pada
           -- pesanan bertanda `lunas_setelah_tutup` tidak boleh menghapus
           -- satu-satunya petunjuk bahwa uang pernah masuk ke pesanan tertutup.
           sebab_tinjauan = coalesce(o.sebab_tinjauan, v_sebab)
     where o.id = v_pesanan_id
       and o.status = any (array['menunggu_bayar','ditahan','lunas','kedaluwarsa','dibatalkan']::public.order_status[]);

    return 'diterapkan';
  end if;

  -- (8) Angka pembanding dari harga BEKU, dihitung sebelum cabang mana pun
  -- yang menulis "ditagih X, diterima Y" ke jejak.
  select coalesce(sum(i.harga_beku), 0)::integer, count(*)::integer
    into v_total, v_cacah
    from public.order_items i
   where i.pesanan_id = v_pesanan_id;

  -- (9) PENUTUPAN CACAT P1: SUCCESS pada pesanan yang sudah kami tutup.
  -- Blok ini WAJIB berada SEBELUM verifikasi nominal. Di versi Midtrans
  -- urutannya terbalik: nominal yang meleset lebih dulu mengubah vonis menjadi
  -- `ditahan`, pemeriksaan `lunas_setelah_tutup` tidak lagi cocok, dan
  -- pembayaran terlambat bernominal salah jatuh ke `tanpa_efek` TANPA tanda
  -- tinjauan, padahal uangnya sudah masuk. SUCCESS apa pun pada pesanan
  -- tertutup adalah `lunas_setelah_tutup`, berapa pun nominalnya.
  if v_vonis = 'lunas'
     and v_status = any (array['kedaluwarsa','dibatalkan']::public.order_status[]) then
    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'lunas_setelah_tutup',
            format('%s mendarat pada pesanan %s; ditagih %s, diterima %s',
                   v_status_teks, v_status, v_total, v_nominal_teks));

    update public.orders o
       set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
           -- coalesce: pesanan tertutup bisa sudah bertanda sebab lain dari
           -- jawaban sebelumnya, dan sebab pertama itu yang bertahan.
           sebab_tinjauan = coalesce(o.sebab_tinjauan, 'lunas_setelah_tutup')
     where o.id = v_pesanan_id
       and o.status = any (array['kedaluwarsa','dibatalkan']::public.order_status[]);

    return 'tanpa_efek';
  end if;

  -- (10) VERIFIKASI NOMINAL terhadap angka yang KITA simpan. `p_nominal` NULL
  -- (rute tidak bisa menormalisasinya) tidak pernah dianggap cocok.
  if v_vonis = 'lunas'
     and (p_nominal is distinct from v_total::numeric or v_cacah <> v_jumlah_item) then
    v_vonis := 'ditahan';
    v_sebab := 'selisih_nominal';
  end if;

  -- (11) Pesanan yang tidak terbuka dan bukan kasus (9). Jawaban DOKU tidak
  -- pernah memindahkan `ditahan` (putusan staf, lewat
  -- `putuskan_pesanan_ditahan`) atau `lunas`.
  if v_status <> 'menunggu_bayar' then
    if v_status = 'ditahan' and v_vonis in ('lunas', 'ditahan') then
      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (v_pesanan_id, v_padma_id, 'selisih_status',
              format('%s mendarat pada pesanan yang sedang ditahan; ditagih %s, diterima %s',
                     v_status_teks, v_total, v_nominal_teks));

      update public.orders o
         set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
             sebab_tinjauan = coalesce(o.sebab_tinjauan, 'selisih_status')
       where o.id = v_pesanan_id
         and o.status = any (array['ditahan']::public.order_status[]);

    elsif v_status = 'lunas' and v_vonis = 'ditahan' then
      -- Pembayaran kedua bernominal lain pada pesanan yang sudah lunas: uang
      -- yang tidak cocok dengan apa pun yang kami tagih. SUCCESS kedua yang
      -- nominalnya cocok tetap tanpa tanda (spec §5.5 baris 1, K4).
      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (v_pesanan_id, v_padma_id, 'selisih_nominal',
              format('%s bernominal tidak cocok mendarat pada pesanan lunas; ditagih %s, diterima %s',
                     v_status_teks, v_total, v_nominal_teks));

      update public.orders o
         set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
             sebab_tinjauan = coalesce(o.sebab_tinjauan, 'selisih_nominal')
       where o.id = v_pesanan_id
         and o.status = any (array['lunas']::public.order_status[]);
    end if;

    return 'tanpa_efek';
  end if;

  if v_vonis = 'lunas' then
    v_tujuan := 'lunas'; v_kejadian := 'lunas';
  elsif v_vonis = 'ditahan' then
    v_tujuan := 'ditahan'; v_kejadian := 'ditahan';
  elsif v_vonis = 'kedaluwarsa' then
    v_tujuan := 'kedaluwarsa'; v_kejadian := 'kedaluwarsa';
  else
    -- Mustahil hari ini: `menunggu`, `refund`, dan `asing` sudah pulang di
    -- atas. Vonis baru yang lupa diberi tujuan berhenti di sini dengan
    -- kalimat, bukan memindahkan pesanan ke tujuan tebakan.
    raise exception 'Vonis % tidak punya tujuan status.', v_vonis using errcode = 'P0001';
  end if;

  -- (12) Penjaga transisi. `coalesce(..., false)` WAJIB: `not NULL` adalah
  -- NULL, dan `if NULL then` tidak dieksekusi, jadi tanpa pembungkus ini
  -- penjaganya fail-OPEN.
  if not coalesce(public.perpindahan_pesanan_sah(v_status, v_tujuan), false) then
    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'selisih_status',
            format('mesin status menolak %s -> %s', v_status, v_tujuan));

    update public.orders o
       set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
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
         -- Arah KEBALIKAN dari coalesce lestari, dan benar di sini: inilah
         -- satu-satunya UPDATE yang memindahkan pesanan, jadi alasan keadaan
         -- barunya menggantikan alasan keadaan lamanya.
         sebab_tinjauan = coalesce(v_sebab, o.sebab_tinjauan)
   where o.id = v_pesanan_id
     and o.status = any (array['menunggu_bayar']::public.order_status[]);

  get diagnostics v_baris = row_count;
  if v_baris = 0 then
    -- Balapan yang kalah: barisnya sudah dipindahkan transaksi lain.
    return 'tanpa_efek';
  end if;

  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (v_pesanan_id, v_padma_id, v_kejadian,
          format('doku %s, transaksi %s', p_status, p_transaksi_id));

  if v_sebab is not null then
    -- Aturan KEJADIAN_BUTUH_TINJAUAN: penandanya sudah disetel UPDATE di atas,
    -- di transaksi yang sama dengan jejak ini.
    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, v_sebab::public.order_event,
            format('ditagih %s, diterima %s', v_total, v_nominal_teks));
  end if;

  -- (13) PENYALURAN, di transaksi yang SAMA, dan hanya dari cabang yang
  -- benar-benar memindahkan baris ke `lunas`.
  if v_tujuan = 'lunas' then
    perform public.salurkan_pesanan(v_pesanan_id);
  end if;

  return 'diterapkan';
end;
$$;

comment on function public.terapkan_notifikasi_gateway(text, text, text, text, numeric, text, text, text) is
  'Jantung mesin pembayaran DOKU (spec §5.5). Sisipan sidik, verifikasi nominal, '
  'transisi, dan penyaluran berada di SATU transaksi. SUCCESS pada pesanan '
  'kedaluwarsa/dibatalkan selalu lunas_setelah_tutup, berapa pun nominalnya. '
  'Memulangkan diterapkan / duplikat / tanpa_efek / pesanan_tidak_ada; galat '
  'basis data dibiarkan melempar.';

-- Tertutup bagi setiap pemegang sesi: vonis DOKU tidak boleh menjadi parameter
-- yang bisa dikirim lewat PostgREST. Hanya service role (webhook, rekonsiliasi).
revoke all on function
  public.terapkan_notifikasi_gateway(text, text, text, text, numeric, text, text, text)
  from public, anon, authenticated;
