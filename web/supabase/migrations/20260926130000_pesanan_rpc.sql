-- ===========================================================================
-- RPC CHECKOUT & PUTUSAN STAF — enam pintu yang memilih barisnya SENDIRI
-- ===========================================================================
-- Arsitektur yang tidak boleh ditafsir ulang: checkout adalah RUTE TIPIS yang
-- memanggil RPC di bawah DENGAN SESI PEMANGGIL — bukan server action, dan
-- tidak pernah service role. RPC-lah yang memilih `client_id` dari
-- `auth.uid()`, membekukan harga, menerbitkan `kode`, dan menolak pesanan
-- terbuka kedua lewat unique parsial.
--
-- KENAPA KEENAMNYA BOLEH TERBUKA BAGI `authenticated`, padahal keempat fungsi
-- mesin di migrasi berikutnya ditutup rapat: fungsi di sini memeriksa SENDIRI
-- siapa pemanggilnya — empat lewat `auth.uid()`, dua lewat `user_role()`.
-- Yang tidak boleh diparameterkan adalah VONIS MIDTRANS, dan tidak satu pun
-- fungsi di berkas ini menerimanya. `tests/fungsi-mesin-tertutup.test.ts`
-- (Tugas 7) memaksa pilihan itu diambil sadar lewat daftar TERBUKA_SADAR.
--
-- Pola hak mengikuti aturan [F]
-- (`20260828230000_fail_closed_sequence_fungsi.sql:171-178`): setiap fungsi
-- menyatakan haknya sendiri, tidak menumpang warisan default ACL.

-- ---------------------------------------------------------------------------
-- buat_pesanan
-- ---------------------------------------------------------------------------
-- Satu-satunya pintu klien MELAHIRKAN pesanan untuk dirinya sendiri, dan ia
-- memilih client_id-nya SENDIRI dari auth.uid() alih-alih memercayai payload:
-- klien yang boleh menyebut client_id adalah klien yang bisa menagih orang
-- lain. Pola ini disalin dari `ambil_produk_gratis`
-- (`20260921150000_ambil_produk_gratis.sql`), termasuk alasan harga dibaca
-- dari `harga_produk_publik` — view yang SAMA dengan yang dipakai etalase,
-- supaya "harga menurut layar" dan "harga menurut basis data" tidak pernah
-- berbeda, termasuk soal tanggal berlaku.
create or replace function public.buat_pesanan(
  p_product_id uuid,
  p_ulang boolean default false
)
returns table (
  pesanan_id uuid,
  kode text,
  percobaan smallint,
  nominal_tagih integer,
  judul text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid;
  v_padma_id text;
  v_judul text;
  v_harga integer;
  v_pesanan_id uuid;
  v_kode text;
  v_percobaan smallint;
  v_terbuka_id uuid;
  v_terbuka_kode text;
  v_terbuka_percobaan smallint;
  v_produk_terbuka uuid;
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

  -- Produk harus TAYANG dan harganya sudah ditetapkan. Produk yang belum
  -- ditayangkan tidak boleh bisa dipesan lewat id yang bocor dari panel.
  select p.judul, h.harga into v_judul, v_harga
    from public.digital_products p
    join public.harga_produk_publik h on h.product_id = p.id
   where p.id = p_product_id and p.aktif;
  if v_harga is null then
    raise exception 'Produk tidak tersedia.' using errcode = 'P0002';
  end if;

  -- Pagar harga nol dari sisi yang berlawanan: `ambil_produk_gratis` menolak
  -- yang berbayar, fungsi ini menolak yang gratis. Tanpa baris ini, Snap
  -- menerima tagihan Rp 0 dan menolaknya dengan galat yang tidak menyebut
  -- sebabnya.
  if v_harga = 0 then
    raise exception 'Produk ini gratis — ambil lewat tombol ambil, bukan checkout.'
      using errcode = 'P0001';
  end if;

  -- GERBANG ENTITLEMENT. Klien yang SUDAH memiliki produk ini tidak boleh
  -- membayarnya lagi, dan pemeriksaannya hidup DI SINI karena satu-satunya
  -- penjaga yang ada hari ini hidup di peramban: `punyaProdukDiPeramban`
  -- (src/app/produk/[slug]/tombol-ambil.tsx) menulis
  -- `const { data: baris } = await sb...` dan MEMBUANG `error` sepenuhnya —
  -- setiap kegagalan baca memulangkan `false`, yaitu FAIL-OPEN ke arah tombol
  -- beli. Sementara `rpc/buat_pesanan` terbuka bagi setiap pengguna login lewat
  -- PostgREST, jadi pemeriksaan yang hanya hidup di TypeScript bisa dilewati
  -- dengan satu `curl` (alasan yang sama persis dengan dokblok
  -- `ambil_produk_gratis`).
  --
  -- Bentuk kegagalan tanpa gerbang ini, dan ia sunyi sepenuhnya: pembeli
  -- membayar → settlement → `lunas` → `salurkan_pesanan` →
  -- `terbitkan_akses_item` keadaan (2) → jejak `akses_sudah_ada`, `sumber`
  -- tidak diubah, TANPA `butuh_tinjauan_pada`. Lalu `bacaPesananStaf` justru
  -- MENGELUARKAN baris itu dari blok "Butuh perhatian" karena jejak aksesnya
  -- ada. Uang masuk, nol barang baru keluar, nol tanda di layar staf maupun
  -- layar klien.
  --
  -- Spec diam soal ini, dan diamnya spec bukan izin: keadaan (2) ditulis
  -- dengan asumsi entitlement lamanya `gratis`, bukan `beli` yang dibayar dua
  -- kali. Bila pemilik repo justru ingin pembelian ulang DIIZINKAN (mis.
  -- memperpanjang akses), gerbang ini dicabut DAN keadaan (2)
  -- `terbitkan_akses_item` wajib menyalakan `butuh_tinjauan_pada` — pilih satu,
  -- jangan diam.
  if exists (
    select 1
      from public.digital_entitlements e
     where e.client_id = v_client_id
       and e.product_id = p_product_id
       and e.dicabut_pada is null
  ) then
    raise exception 'Anda sudah memiliki produk ini — buka di Pembelian Saya.'
      using errcode = 'P0001';
  end if;

  -- Pesanan BERUANG untuk produk yang sama menutup checkout ulang. `ditahan`
  -- dan `lunas` berarti uangnya sudah masuk; menjualnya lagi berarti menagih
  -- orang dua kali untuk satu barang. Pemeriksaan yang hanya hidup di
  -- TypeScript adalah pemeriksaan yang bisa dilewati satu `curl` — alasan yang
  -- sama dengan yang tertulis di `ambil_produk_gratis`.
  --
  -- SATU status saja TIDAK CUKUP — perbaikan review akhir P1-A, Temuan 1
  -- (CRITICAL). Versi pertama pagar ini hanya memeriksa `status = 'ditahan'`,
  -- dan lolos dari situ bukan berarti lolos dari bahaya: `expire` yang
  -- disusul `settlement` TERLAMBAT (urutan yang memang DIDESAIN spec ini)
  -- mendarat pada pesanan yang sudah `kedaluwarsa` — statusnya bukan
  -- `ditahan` dan bukan `lunas`, satu-satunya jejaknya adalah
  -- `sebab_tinjauan = 'lunas_setelah_tutup'` (lihat
  -- `KEJADIAN_BUTUH_TINJAUAN` di `src/lib/pesanan/status.ts:118-128`, yang
  -- menuliskan bahaya ini kata demi kata). Gerbang lama diam, gerbang
  -- entitlement pun diam (nol entitlement lahir dari pesanan yang tertutup
  -- sebelum lunas), dan klien membayar produk yang sama untuk KEDUA kalinya.
  -- Varian kedua: pesanan `lunas` yang aksesnya `akses_tertahan` karena
  -- entitlement lamanya sudah DICABUT — tidak ada entitlement hidup, dan
  -- `lunas` tidak pernah masuk daftar lama sama sekali.
  --
  -- Refund/chargeback TIDAK ikut terblokir oleh pelebaran ini:
  -- `terapkan_notifikasi_midtrans` (`20260926140000:409-424`) mencatat
  -- `sebab_tinjauan` sendiri ('refund'/'chargeback'/'selisih_status') TANPA
  -- menggerakkan `status`, jadi baris itu tidak pernah cocok array atau
  -- `sebab_tinjauan` di bawah. Refund atas pesanan `lunas` MEMANG diblokir —
  -- tapi itu tidak mengubah apa pun dalam praktik: webhook juga tidak
  -- mencabut akses pada refund, jadi entitlement-nya masih hidup dan pagar
  -- entitlement di atas sudah lebih dulu menyala untuk kasus itu. `lunas` di
  -- sini baru benar-benar menentukan saat entitlement-nya TIDAK ada —
  -- `akses_tertahan` atau pencabutan staf — dan di situ uang sudah diambil
  -- sementara akses belum diberikan, jadi jawabannya memanggil manusia, bukan
  -- menjual lagi.
  --
  -- SATU pengecualian yang diketahui, dan ditulis di sini supaya tidak
  -- ditemukan ulang: refund yang disusul pencabutan entitlement oleh operator
  -- meninggalkan `lunas` tanpa akses PADAHAL uangnya sudah pulang, dan pagar
  -- ini menolaknya. `lunas` terminal di `perpindahan_pesanan_sah` dan
  -- `tutup_tinjauan` hanya memadamkan penandanya, jadi tidak ada jalan keluar
  -- lewat aplikasi. Dibiarkan: satu-satunya cara masuk ke keadaan itu adalah
  -- SQL langsung (nihil penulis `dicabut_pada` di `src/`), dan itu juga jalan
  -- keluarnya. Yang TIDAK boleh dilakukan adalah melonggarkan pagar ini demi
  -- kasus yang hanya bisa dibuat tangan — harganya tagihan ganda yang bisa
  -- dibuat siapa saja.
  if exists (
    select 1
      from public.orders o
      join public.order_items i on i.pesanan_id = o.id
     where o.client_id = v_client_id
       and i.product_id = p_product_id
       and (
         o.status = any (array['ditahan','lunas']::public.order_status[])
         or o.sebab_tinjauan = 'lunas_setelah_tutup'
       )
  ) then
    raise exception 'Pembayaran Anda untuk produk ini sedang ditinjau staf.'
      using errcode = 'P0001';
  end if;

  -- Pesanan terbuka yang sudah ada. `for update` menyerialkan dua panggilan
  -- `p_ulang` yang datang bersamaan supaya `percobaan` tidak melompat dua.
  select o.id, o.kode, o.percobaan
    into v_terbuka_id, v_terbuka_kode, v_terbuka_percobaan
    from public.orders o
   where o.client_id = v_client_id and o.status = 'menunggu_bayar'
   for update;

  if v_terbuka_id is not null then
    select i.product_id into v_produk_terbuka
      from public.order_items i
     where i.pesanan_id = v_terbuka_id
     order by i.urutan
     limit 1;

    if v_produk_terbuka is distinct from p_product_id then
      raise exception
        'Selesaikan dulu pesanan % yang masih terbuka, atau batalkan lebih dulu.',
        v_terbuka_kode using errcode = 'P0001';
    end if;

    if not p_ulang then
      -- Panggilan kedua untuk produk yang SAMA memulangkan pesanan yang sama,
      -- berikut harga yang sudah dibekukan. Inilah yang membuat dua checkout
      -- paralel berakhir sebagai satu pesanan tanpa kunci di TypeScript.
      v_pesanan_id := v_terbuka_id;
      v_kode := v_terbuka_kode;
      v_percobaan := v_terbuka_percobaan;
    elsif v_terbuka_percobaan < 9 then
      -- `percobaan` dinaikkan HANYA di sini: saat Snap menolak menerbitkan
      -- token dan order_id-nya sudah terbakar. Bukan setiap kali halaman
      -- dibuka. Token lama ikut dikosongkan supaya tidak ada dua popup hidup.
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
      -- Percobaan KESEPULUH tidak melempar 23514: pesanan lama ditutup dan
      -- pesanan baru lahir di bawah. Batas 1..9 adalah pagar terakhir, bukan
      -- jalur pemulihan.
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

  -- Pesanan baru. Tabrakan `orders_kode_unik` diulang paling banyak lima kali;
  -- enam heksadesimal per tanggal membuat tabrakan kejadian yang tidak akan
  -- pernah dilihat siapa pun, tapi penulis yang tidak menanganinya membuat
  -- checkout gagal dengan 23505 telanjang.
  --
  -- `gen_random_uuid()` bawaan Postgres, BUKAN `gen_random_bytes`: pgcrypto
  -- nol hasil di seluruh migrasi repo ini, dan memasang ekstensi baru di basis
  -- data produksi berisi data klien nyata demi satu sufiks acak tidak sepadan.
  while v_pesanan_id is null and v_sisa > 0 loop
    v_sisa := v_sisa - 1;
    v_kode := 'PSN-'
           || to_char((now() at time zone 'Asia/Jakarta')::date, 'YYMMDD')
           || '-'
           || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.orders (kode, client_id, jumlah_item)
      values (v_kode, v_client_id, 1)
      -- Kolom DIKUALIFIKASI: `percobaan` juga nama parameter OUT fungsi ini, dan
      -- RETURNING yang tidak dikualifikasi akan gagal "column reference is
      -- ambiguous" saat pertama kali dipanggil — bukan saat migrasi dijalankan.
      returning orders.id, orders.percobaan into v_pesanan_id, v_percobaan;
      v_baru := true;
    exception when unique_violation then
      -- DUA constraint bisa melahirkan 23505 di sini, dan keduanya menuntut
      -- jawaban yang berbeda. Tanpa `constraint_name`, yang satu akan diobati
      -- dengan obat yang lain.
      get stacked diagnostics v_kendala = constraint_name;
      if v_kendala = 'pesanan_terbuka_satu_per_klien' then
        -- Kalah balapan dengan panggilan paralel: yang menang sudah commit,
        -- jadi barisnya terlihat sekarang. Baca ulang dan pulangkan miliknya.
        select o.id, o.kode, o.percobaan
          into v_terbuka_id, v_terbuka_kode, v_terbuka_percobaan
          from public.orders o
         where o.client_id = v_client_id and o.status = 'menunggu_bayar';

        select i.product_id into v_produk_terbuka
          from public.order_items i
         where i.pesanan_id = v_terbuka_id
         order by i.urutan
         limit 1;

        if v_produk_terbuka is distinct from p_product_id then
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
    -- Harga & judul DIBEKUKAN di sini. Nota yang ikut berubah saat harga
    -- berubah bukan nota.
    insert into public.order_items (
      pesanan_id, jenis, product_id, judul_beku, harga_beku, urutan
    ) values (
      v_pesanan_id, 'produk_digital', p_product_id, v_judul, v_harga, 1
    );

    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan_id, v_padma_id, 'dibuat', 'checkout produk digital');
  end if;

  -- Nominal dijumlahkan dari `order_items`, bukan dibaca ulang dari etalase:
  -- itulah bedanya "yang kami tagih" dengan "harga hari ini".
  return query
    select v_pesanan_id,
           v_kode,
           v_percobaan,
           (select coalesce(sum(i.harga_beku), 0)::integer
              from public.order_items i
             where i.pesanan_id = v_pesanan_id),
           (select i.judul_beku
              from public.order_items i
             where i.pesanan_id = v_pesanan_id
             order by i.urutan
             limit 1);
end;
$$;

comment on function public.buat_pesanan(uuid, boolean) is
  'Satu-satunya pintu klien melahirkan pesanan untuk dirinya sendiri. '
  'client_id diambil dari auth.uid(), TIDAK dari payload. Harga dibekukan dari '
  'harga_produk_publik — view yang sama dengan etalase. Pesanan terbuka kedua '
  'ditolak unique parsial pesanan_terbuka_satu_per_klien; yang kalah balapan '
  'memulangkan pesanan yang sudah ada bila produknya sama. p_ulang adalah '
  'SATU-SATUNYA yang menaikkan percobaan. Menolak P0001 bila pemanggil SUDAH '
  'memiliki produknya: penjaga yang hanya hidup di peramban adalah penjaga '
  'yang fail-open, dan bentuk kegagalannya uang masuk tanpa barang keluar.';

revoke all on function public.buat_pesanan(uuid, boolean) from public, anon;
grant execute on function public.buat_pesanan(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- catat_token_snap
-- ---------------------------------------------------------------------------
-- Token Snap BUKAN bukti pembayaran dan tidak pernah dipercaya sebagai bukti
-- oleh apa pun; ia hanya alamat popup. Yang dijaga di sini cuma satu: pesanan
-- yang ditulisi harus milik pemanggil, dan harus masih terbuka.
create or replace function public.catat_token_snap(
  p_pesanan_id uuid,
  p_token text
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
     set snap_token = p_token,
         snap_diterbitkan_pada = now()
   where o.id = p_pesanan_id
     and o.client_id = v_client_id
     and o.status = any (array['menunggu_bayar']::public.order_status[])
  returning o.id into v_kena;

  if v_kena is null then
    -- P0002 ("no data found"), bukan 42501: pemanggil tidak boleh bisa
    -- membedakan "bukan milik saya" dari "sudah tidak terbuka" — keduanya
    -- sama-sama bukan urusannya.
    raise exception 'Pesanan terbuka itu tidak ada pada akun ini.' using errcode = 'P0002';
  end if;

  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (p_pesanan_id, v_padma_id, 'token_terbit', 'token snap dicatat');
end;
$$;

comment on function public.catat_token_snap(uuid, text) is
  'Mencatat token Snap pada pesanan MILIK PEMANGGIL yang masih menunggu bayar. '
  'Token bukan bukti pembayaran; yang dijaga hanya kepemilikan barisnya.';

revoke all on function public.catat_token_snap(uuid, text) from public, anon;
grant execute on function public.catat_token_snap(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- batalkan_pesanan_saya
-- ---------------------------------------------------------------------------
-- Bukan hiasan: karena satu klien hanya boleh punya SATU pesanan terbuka,
-- tanpa tombol ini orang yang berubah pikiran soal produk harus menunggu 24
-- jam. Yang bisa disalahgunakan pemanggil hanyalah pesanannya sendiri.
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

-- ---------------------------------------------------------------------------
-- punya_pesanan_menunggu
-- ---------------------------------------------------------------------------
-- Dipakai layar sebagai penentu "Pembayaran Anda sedang diproses" alih-alih
-- tombol beli. `ditahan` WAJIB ikut: uangnya sudah masuk, hanya nominalnya
-- meleset, dan menghitungnya sebagai "tidak ada pesanan" mengembalikan tombol
-- beli kepada orang yang sudah menyetor.
--
-- SET-NYA HARUS CERMIN PERSIS gerbang `buat_pesanan` — perbaikan review akhir
-- P1-A, Temuan 1 (CRITICAL). Ketidakcocokan ini yang melahirkan bug: gerbang
-- SQL `buat_pesanan` sempat lebih sempit dari yang seharusnya, dan fungsi ini
-- ikut sempit dengan cara yang SAMA persis — keduanya diam pada pesanan yang
-- `kedaluwarsa` bercap `sebab_tinjauan = 'lunas_setelah_tutup'` (settlement
-- terlambat yang mendarat sesudah `expire`) dan pada pesanan `lunas` yang
-- aksesnya `akses_tertahan`. Pagar SQL yang benar tapi layar yang tak pernah
-- diberi tahu tetap menampilkan tombol beli, dan Lapis 1b tetap tidak
-- menyala — keduanya bersandar pada fungsi ini.
--
-- `security definer` bukan kemewahan: `order_items` lahir tanpa policy sama
-- sekali, jadi fungsi ber-invoker akan selalu memulangkan false.
create or replace function public.punya_pesanan_menunggu(p_product_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.orders o
      join public.order_items i on i.pesanan_id = o.id
      join public.clients c on c.id = o.client_id
     where c.user_id = auth.uid()
       and i.product_id = p_product_id
       and (
         o.status = any (array['menunggu_bayar','ditahan','lunas']::public.order_status[])
         or o.sebab_tinjauan = 'lunas_setelah_tutup'
       )
  );
$$;

comment on function public.punya_pesanan_menunggu(uuid) is
  'Benar bila pemanggil punya pesanan yang belum mati dan belum melahirkan '
  'akses untuk produk ini: menunggu_bayar, ditahan, ATAU lunas — ditambah '
  'kedaluwarsa/dibatalkan yang bersebab_tinjauan lunas_setelah_tutup (settlement '
  'terlambat yang mendarat sesudah pesanan ditutup). Set ini WAJIB cermin '
  'persis gerbang beruang di buat_pesanan; ketidakcocokan keduanya adalah bug. '
  'Urutan layar: entitlement dulu, lalu fungsi ini, baru tombol beli.';

revoke all on function public.punya_pesanan_menunggu(uuid) from public, anon;
grant execute on function public.punya_pesanan_menunggu(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- putuskan_pesanan_ditahan
-- ---------------------------------------------------------------------------
-- DUA putusan, bukan satu: "putuskan" yang hanya punya satu hasil bukan
-- putusan — admin yang menemukan pembayaran kurang Rp 50.000 harus punya
-- jalan selain "berikan saja".
--
-- Ini TIDAK membantah aturan "vonis Midtrans tidak boleh jadi parameter".
-- Bedanya: yang diputuskan di sini bukan "apa kata Midtrans" melainkan "apa
-- yang kita lakukan terhadap uang yang sudah masuk", dan ia dicatat dengan
-- nama pemutusnya.
--
-- `p_putusan` bertipe TEXT, bukan order_status: enum lewat PostgREST
-- menggagalkan nilai asing dengan 22P02 telanjang, dan yang dituntut di sini
-- adalah galat yang bisa dibaca manusia.
--
-- Fungsi ini SENGAJA tidak memanggil `salurkan_pesanan`: penyalur ada di
-- MESIN_TERTUTUP dan dipanggil lewat rute "Terbitkan akses" (Tugas 11) dengan
-- service role. Pesanan yang baru diputus `lunas` karena itu tetap terlihat di
-- blok "Butuh perhatian" — `lunas` tanpa `akses_terbit` — sampai aksesnya
-- benar-benar diterbitkan. Dua klik sadar, bukan satu klik yang menebak.
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
  -- pesanan yang sebenarnya belum pernah disentuh Midtrans sama sekali —
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
      'Pesanan ini belum punya catatan nominal yang diterima Midtrans; tidak ada yang bisa diputuskan.'
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

comment on function public.putuskan_pesanan_ditahan(uuid, text) is
  'Putusan MANUSIA atas pesanan yang sudah beruang: lunas atau dibatalkan. '
  'Hanya dari status ditahan, hanya bila ada notifikasi ber-nominal_diterima, '
  'dan pemutusnya dicatat di keterangan jejak. TIDAK menyalurkan akses — itu '
  'tugas rute "Terbitkan akses" yang memanggil fungsi mesin dengan service role.';

revoke all on function public.putuskan_pesanan_ditahan(uuid, text) from public, anon;
grant execute on function public.putuskan_pesanan_ditahan(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- tutup_tinjauan
-- ---------------------------------------------------------------------------
-- Mengosongkan penanda tinjauan TANPA menyentuh status — itulah keuntungan
-- membuang nilai enum `ditinjau`.
--
-- Dan justru karena ia tidak menyentuh status, ia MENOLAK baris `ditahan`.
-- Tanpa penolakan itu, satu klik menghasilkan pesanan `ditahan` ber-
-- `butuh_tinjauan_pada is null`: uang pembeli sudah di tangan Midtrans,
-- aksesnya tidak pernah terbit, dan barisnya lolos dari klausa penanda
-- sekaligus dari jaring `lunas`.
create or replace function public.tutup_tinjauan(p_pesanan_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_penutup text;
  v_padma_id text;
  v_status public.order_status;
  v_kena uuid;
begin
  if public.user_role() not in ('admin', 'owner') then
    raise exception 'Hanya staf yang boleh menutup tinjauan.' using errcode = '42501';
  end if;

  select o.status, c.padma_id into v_status, v_padma_id
    from public.orders o
    join public.clients c on c.id = o.client_id
   where o.id = p_pesanan_id;
  if v_status is null then
    raise exception 'Pesanan tidak ditemukan.' using errcode = 'P0002';
  end if;

  if v_status = 'ditahan' then
    raise exception
      'Pesanan ini ditahan — pakai "putuskan" (lunas atau dibatalkan), bukan "tutup tinjauan".'
      using errcode = 'P0001';
  end if;

  select p.nama into v_penutup from public.profiles p where p.id = auth.uid();

  update public.orders o
     set butuh_tinjauan_pada = null,
         sebab_tinjauan = null
   where o.id = p_pesanan_id
     and o.butuh_tinjauan_pada is not null
     and o.status = any (array['menunggu_bayar','lunas','kedaluwarsa','dibatalkan']::public.order_status[])
  returning o.id into v_kena;

  if v_kena is null then
    raise exception 'Pesanan itu tidak sedang menunggu tinjauan.' using errcode = 'P0001';
  end if;

  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (p_pesanan_id, v_padma_id, 'tinjauan_ditutup',
          format('ditutup oleh %s', coalesce(v_penutup, 'staf tanpa nama')));
end;
$$;

comment on function public.tutup_tinjauan(uuid) is
  'Mengosongkan butuh_tinjauan_pada + sebab_tinjauan tanpa menyentuh status. '
  'MENOLAK baris ditahan: yang ditahan diputuskan, bukan ditutup tinjauannya.';

revoke all on function public.tutup_tinjauan(uuid) from public, anon;
grant execute on function public.tutup_tinjauan(uuid) to authenticated;
