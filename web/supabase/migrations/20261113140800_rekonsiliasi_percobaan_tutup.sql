-- ===========================================================================
-- Perbaikan akhir feat/doku (review seluruh branch, 17 Nov). SATU migrasi untuk
-- semua perubahan SQL putaran ini (Ruling 13): `terapkan_notifikasi_gateway`
-- sudah didefinisikan di 20261113130100, dan menyunting migrasi lama berisiko
-- menimpa definisi yang lebih baru. Definisi di bawah DISALIN dari definisi
-- yang terpasang (md5 badan = 130100) lalu diubah di tempat yang ditandai.
--
-- Akarnya satu: uang yang mendarat di tempat yang tidak pernah dilihat
-- rekonsiliasi menjadi senyap (anti-tujuan §3 butir 1).
--
-- Isi:
--   (1) orders.percobaan_lunas + terapkan_notifikasi_gateway   F1: pembanding
--       cabang bayar ganda (Ruling 7) adalah percobaan PELUNAS, bukan
--       percobaan kini (Ruling 12: kolom baru, `orders.percobaan` tidak ditimpa)
--   (1b) notifikasi_pesanan.percobaan                           putaran 2 (I2):
--       SUCCESS kedua untuk percobaan yang SAMA pada pesanan tertutup tidak
--       lagi menyalakan lunas_setelah_tutup kedua (webhook vs Check Status
--       punya sidik berbeda untuk uang yang sama)
--   (2) orders.rekonsiliasi_tutup_pada + indeks sapuan          F2b: penanda
--       "pesanan tertutup ini sudah ditanyakan ke DOKU sesudah tautannya
--       pasti mati" untuk sapuan Lapis 3 (`sapuPesananTertutup`)
--   (3) putuskan_pesanan_ditahan                                F3.4: kalimat
--       P0001 netral-gateway (dulu menyebut Midtrans di layar staf)
--   (4) catat_tautan_gateway                                    F3.4: tautan
--       yang tidak diawali https:// ditolak
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- (1) orders.percobaan_lunas
-- ---------------------------------------------------------------------------
-- Diisi `terapkan_notifikasi_gateway` di UPDATE yang memindahkan pesanan ke
-- `lunas` ATAU `ditahan` — keduanya berarti uang sudah masuk lewat invoice
-- percobaan itu. Tidak pernah ditulis jalur lain; `putuskan_pesanan_ditahan`
-- (ditahan -> lunas) tidak mengubahnya karena uangnya tetap uang yang sama.
-- Baris lama tetap NULL dan pembandingnya jatuh ke `percobaan` (perilaku lama).
alter table public.orders
  add column if not exists percobaan_lunas smallint;

alter table public.orders
  drop constraint if exists pesanan_percobaan_lunas_wajar;
alter table public.orders
  add constraint pesanan_percobaan_lunas_wajar
  check (percobaan_lunas is null or (percobaan_lunas >= 1 and percobaan_lunas <= 9));

comment on column public.orders.percobaan_lunas is
  'Percobaan invoice yang melunasi pesanan (uang masuk: lunas atau ditahan). '
  'Pembanding cabang bayar ganda terapkan_notifikasi_gateway. NULL = belum ada '
  'uang masuk, atau baris sebelum 20261113140800.';

-- ---------------------------------------------------------------------------
-- (1b) notifikasi_pesanan.percobaan
-- ---------------------------------------------------------------------------
-- Percobaan invoice yang dijawab notifikasi ini (digit terakhir
-- `invoice_number`). Tabel ini tidak menyimpan invoice-nya, dan `sidik`
-- sengaja berbeda antara webhook (digest badan) dan Check Status (status),
-- jadi tanpa kolom ini mesin tidak bisa tahu bahwa SUCCESS yang ditemukan
-- sapuan adalah SUCCESS yang SAMA dengan yang sudah dikirim webhook. Diisi
-- `terapkan_notifikasi_gateway` (langkah 4); baris lama tetap NULL dan tidak
-- pernah dianggap "sudah tercatat" (perilaku lama: ditandai).
alter table public.notifikasi_pesanan
  add column if not exists percobaan smallint;

alter table public.notifikasi_pesanan
  drop constraint if exists notifikasi_percobaan_wajar;
alter table public.notifikasi_pesanan
  add constraint notifikasi_percobaan_wajar
  check (percobaan is null or (percobaan >= 1 and percobaan <= 9));

comment on column public.notifikasi_pesanan.percobaan is
  'Percobaan invoice yang dijawab notifikasi ini (1..9). Dipakai mesin untuk '
  'tidak menandai lunas_setelah_tutup dua kali atas SUCCESS percobaan yang sama. '
  'NULL = baris sebelum 20261113140800.';

-- ---------------------------------------------------------------------------
-- (1) terapkan_notifikasi_gateway — salinan 20261113130100 dengan lima
--     perubahan: v_percobaan_lunas dibaca, cabang bayar ganda membandingkan
--     dengan percobaan pelunas, UPDATE transisi mengisi percobaan_lunas,
--     sisipan notifikasi mencatat percobaannya (1b), dan langkah 9 tidak
--     menandai SUCCESS percobaan yang sudah tercatat untuk kedua kalinya.
-- ---------------------------------------------------------------------------
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
  -- Percobaan yang benar-benar MELUNASI pesanan (20261113140800). NULL untuk
  -- pesanan yang uangnya belum pernah masuk, dan untuk baris lama sebelum
  -- kolomnya lahir: keduanya jatuh ke `v_percobaan_kini` (perilaku lama).
  v_percobaan_lunas smallint;
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
  select o.id, o.status, o.percobaan, o.percobaan_lunas, o.jumlah_item, c.padma_id
    into v_pesanan_id, v_status, v_percobaan_kini, v_percobaan_lunas, v_jumlah_item, v_padma_id
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
    pesanan_id, sidik, transaksi_id, status_gateway, kanal, nominal_diterima, percobaan
  ) values (
    v_pesanan_id, p_sidik, nullif(p_transaksi_id, ''), p_status,
    nullif(p_kanal, ''), p_nominal, v_percobaan
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
    -- (9a) SUCCESS untuk percobaan yang SAMA sudah tercatat pada pesanan ini
    -- (20261113140800, putaran 2): uang yang sama, bukan uang kedua. Webhook
    -- dan Check Status punya sidik berbeda untuk satu pembayaran, jadi tanpa
    -- pemeriksaan ini sapuan Lapis 3 yang menemukan SUCCESS yang sudah
    -- dikirim webhook — dan sudah ditinjau staf — menyalakan tanda lagi:
    -- `uang_sudah_masuk_permintaan` kembali benar dan staf membaca
    -- "diterima Y" kedua (refund manual ganda). Cerminan baris 1 §5.5
    -- "percobaan sama: tanpa efek"; jejak `notifikasi` di langkah 5 sudah
    -- mencatatnya. TIDAK membandingkan `transaksi_id` (R-F3, K4). Pembayaran
    -- lewat percobaan LAIN tetap ditandai di bawah.
    if exists (
      select 1
        from public.notifikasi_pesanan n
       where n.pesanan_id = v_pesanan_id
         and n.id <> v_notif_id
         and n.percobaan = v_percobaan
         and n.status_gateway = 'SUCCESS'
    ) then
      return 'tanpa_efek';
    end if;

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
      -- nominalnya cocok pada percobaan YANG SAMA tetap tanpa tanda (spec
      -- §5.5 baris 1, K4).
      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (v_pesanan_id, v_padma_id, 'selisih_nominal',
              format('%s bernominal tidak cocok mendarat pada pesanan lunas; ditagih %s, diterima %s',
                     v_status_teks, v_total, v_nominal_teks));

      update public.orders o
         set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
             sebab_tinjauan = coalesce(o.sebab_tinjauan, 'selisih_nominal')
       where o.id = v_pesanan_id
         and o.status = any (array['lunas']::public.order_status[]);

    elsif v_status = 'lunas' and v_vonis = 'lunas'
          and v_percobaan <> coalesce(v_percobaan_lunas, v_percobaan_kini) then
      -- SUCCESS untuk invoice percobaan LAIN dari percobaan yang MELUNASI:
      -- tautan lain yang masih di tangan pembeli dibayar sesudah pesanan
      -- lunas. Itu pembayaran kedua yang sungguhan, bukan pengiriman ulang,
      -- dan tanpa tanda ia hanya tercatat di jejak `notifikasi`.
      --
      -- Pembandingnya percobaan PELUNAS, bukan `orders.percobaan` (percobaan
      -- KINI). Versi 20261113130100 membandingkan dengan percobaan kini, dan
      -- itu salah ke dua arah begitu yang melunasi adalah percobaan lama:
      -- pesanan di percobaan 2, tautan percobaan 1 dibayar (lunas), lalu
      -- tautan percobaan 2 dibayar juga -> "percobaan sama", tanpa tanda; dan
      -- kiriman kedua percobaan 1 dituduh bayar ganda. `coalesce` menjaga
      -- baris lama yang lunas sebelum kolomnya lahir pada perilaku lama.
      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (v_pesanan_id, v_padma_id, 'selisih_status',
              format('SUCCESS percobaan %s mendarat pada pesanan yang sudah lunas di percobaan %s — kemungkinan bayar ganda',
                     v_percobaan, coalesce(v_percobaan_lunas, v_percobaan_kini)));

      update public.orders o
         set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
             sebab_tinjauan = coalesce(o.sebab_tinjauan, 'selisih_status')
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
         -- Uang MASUK pada kedua tujuan ini (`ditahan` = nominal meleset, bukan
         -- uang yang tidak datang). Percobaan invoice-nya yang dicatat, bukan
         -- percobaan kini: itulah pembanding cabang bayar ganda di atas.
         percobaan_lunas = case when v_tujuan = any (array['lunas','ditahan']::public.order_status[])
                                then v_percobaan else o.percobaan_lunas end,
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
  'SUCCESS percobaan lain dari percobaan PELUNAS pada pesanan lunas = tinjauan '
  'bayar ganda. Memulangkan diterapkan / duplikat / tanpa_efek / '
  'pesanan_tidak_ada; galat basis data dibiarkan melempar.';

-- Tertutup bagi setiap pemegang sesi: vonis DOKU tidak boleh menjadi parameter
-- yang bisa dikirim lewat PostgREST. Hanya service role (webhook, rekonsiliasi).
-- `create or replace` mempertahankan ACL; revoke diulang supaya berkas ini
-- benar sendiri bila kelak dibaca tanpa 130100.
revoke all on function
  public.terapkan_notifikasi_gateway(text, text, text, text, numeric, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- (2) orders.rekonsiliasi_tutup_pada — penanda sapuan pesanan tertutup (F2b)
-- ---------------------------------------------------------------------------
-- Pesanan yang KITA tutup (`dibatalkan`) sementara tautan DOKU-nya bisa masih
-- hidup disapu Lapis 3 sampai tautan itu pasti mati. Kolom ini diisi Lapis 3
-- (service role, `src/lib/pesanan/periksa-menggantung.ts`) oleh pemeriksaan
-- yang DIMULAI sesudah `kedaluwarsa_pada` + JAM_TENGGANG_TANPA_VONIS dan yang
-- setiap percobaannya terjawab DOKU. Sesudahnya baris tidak pernah dipilih
-- lagi. Tidak pernah dikosongkan.
--
-- Kenapa kolom baru, bukan `diperiksa_pada`: kolom itu pagar laju lima menit,
-- dan `terapkan_notifikasi_gateway` menyetelnya pada SETIAP jawaban Check
-- Status — juga ketika baru satu dari beberapa percobaan yang terjawab. Makna
-- "setiap percobaan sudah ditanyakan sesudah tautan mati" tidak bisa dibaca
-- darinya tanpa membuat percobaan yang gagal ditanyakan tampak selesai.
alter table public.orders
  add column if not exists rekonsiliasi_tutup_pada timestamptz;

comment on column public.orders.rekonsiliasi_tutup_pada is
  'Lapis 3: pesanan tertutup ini sudah ditanyakan ke DOKU (setiap percobaan '
  'kecuali percobaan pelunas) SESUDAH kedaluwarsa_pada + tenggang. NULL = '
  'belum, atau tidak pernah perlu (tanpa tautan).';

-- Kembaran `orders_sapuan_idx` (sapuan pesanan terbuka). Daftar statusnya =
-- PESANAN_TUTUP_DISAPU (src/lib/pesanan/status.ts); tests/pesanan-status-db
-- mengikat keduanya.
create index if not exists orders_sapuan_tutup_idx
  on public.orders (diperiksa_pada nulls first)
  where status = 'dibatalkan' and rekonsiliasi_tutup_pada is null;

-- ---------------------------------------------------------------------------
-- (3) putuskan_pesanan_ditahan — salinan 20260926130000 (md5 badan = yang
--     terpasang), hanya kalimat P0001 "belum punya catatan nominal" dan satu
--     komentar yang tidak lagi menyebut Midtrans. Kalimat itu dibaca staf di
--     /admin/pesanan; nama gateway lama menyuruh orang mencari di Back Office
--     yang salah. Hak (revoke public/anon, grant authenticated) dipertahankan
--     `create or replace`.
-- ---------------------------------------------------------------------------
create or replace function public.putuskan_pesanan_ditahan(
  p_pesanan_id uuid,
  p_putusan text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_pemutus text;
  v_tujuan public.order_status;
  v_padma_id text;
  v_status public.order_status;
  v_kena uuid;
begin
  if public.user_role() not in ('admin', 'owner') then
    raise exception 'Hanya staf yang boleh memutuskan pesanan yang ditahan.'
      using errcode = '42501';
  end if;

  if p_putusan not in ('lunas', 'dibatalkan') then
    raise exception 'Putusan harus "lunas" atau "dibatalkan", bukan "%".', p_putusan
      using errcode = 'P0001';
  end if;
  v_tujuan := p_putusan::public.order_status;

  if not coalesce(
    public.perpindahan_pesanan_sah('ditahan'::public.order_status, v_tujuan), false) then
    raise exception 'Mesin status menolak perpindahan ditahan -> %.', p_putusan
      using errcode = 'P0001';
  end if;

  -- KEADAAN BARIS diperiksa SEBELUM catatan nominal: pesanan yang belum
  -- pernah `ditahan` juga belum pernah punya notifikasi ber-nominal, jadi
  -- urutan terbalik membuat pesan "belum punya catatan nominal" muncul untuk
  -- pesanan yang sebenarnya belum pernah disentuh gateway sama sekali —
  -- pesan yang benar untuk sebab yang salah. `is distinct from` juga menutup
  -- pesanan_id asing (v_status null) dengan pesan yang sama: keduanya sama-
  -- sama "tidak ada yang bisa diputuskan di sini sekarang".
  select o.status into v_status from public.orders o where o.id = p_pesanan_id;
  if v_status is distinct from 'ditahan' then
    raise exception 'Pesanan itu tidak sedang ditahan.' using errcode = 'P0001';
  end if;

  -- Uangnya harus pernah TERCATAT masuk, bukan sekadar diklaim admin.
  if not exists (
    select 1 from public.notifikasi_pesanan n
     where n.pesanan_id = p_pesanan_id and n.nominal_diterima is not null
  ) then
    raise exception
      'Pesanan ini belum punya catatan nominal yang diterima gateway pembayaran; tidak ada yang bisa diputuskan.'
      using errcode = 'P0001';
  end if;

  select p.nama into v_pemutus from public.profiles p where p.id = auth.uid();

  select c.padma_id into v_padma_id
    from public.orders o
    join public.clients c on c.id = o.client_id
   where o.id = p_pesanan_id;

  update public.orders o
     set status = v_tujuan,
         lunas_pada = case when v_tujuan = 'lunas' then now() else o.lunas_pada end,
         -- `ditahan` sudah bercap tutup; capnya dipertahankan, bukan ditimpa.
         ditutup_pada = coalesce(o.ditutup_pada, now())
   where o.id = p_pesanan_id
     and o.status = any (array['ditahan']::public.order_status[])
  returning o.id into v_kena;

  if v_kena is null then
    raise exception 'Pesanan itu tidak sedang ditahan.' using errcode = 'P0001';
  end if;

  -- `padma_id` tetap milik KLIEN pesanan (itulah gunanya kolom itu
  -- didenormalisasi: pelanggan kejadian tidak perlu hak baca `clients`).
  -- Identitas PEMUTUS dicatat di keterangan — staf tidak punya padma_id.
  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (p_pesanan_id, v_padma_id, v_tujuan::text::public.order_event,
          format('putusan staf: %s — oleh %s', p_putusan, coalesce(v_pemutus, 'staf tanpa nama')));
end;
$$;

-- ---------------------------------------------------------------------------
-- (4) catat_tautan_gateway — salinan 20261113130000 (md5 badan = yang
--     terpasang) ditambah satu saringan: tautan harus diawali https://.
-- ---------------------------------------------------------------------------
create or replace function public.catat_tautan_gateway(
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

  -- BARU (20261113140800). Tautan ini dikirim balik ke peramban pembeli lewat
  -- `window.location.assign` (jalur pakai-ulang `terbitkanTautanBayar`), dan
  -- RPC ini terbuka bagi `authenticated`: tanpa saringan, klien bisa
  -- menyimpan `javascript:` atau alamat http apa pun di barisnya sendiri.
  -- Halaman bayar DOKU selalu https. Diperiksa SESUDAH gerbang identitas
  -- (urutan 42501 lebih dulu dipertahankan) dan SEBELUM baris dicari, jadi
  -- kalimatnya tidak membocorkan apa pun tentang pesanan siapa pun.
  if coalesce(p_tautan, '') !~ '^https://' then
    raise exception 'Tautan pembayaran harus diawali https://.' using errcode = 'P0001';
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
  'Mencatat tautan gateway (https://) pada pesanan MILIK PEMANGGIL yang masih '
  'menunggu bayar pada percobaan yang sama. Tautan bukan bukti pembayaran; yang '
  'dijaga hanya kepemilikan barisnya dan bentuk alamatnya.';
