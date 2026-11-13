-- Penyalur sesi: pesanan sesi yang LUNAS melahirkan sesinya sendiri (tugas B3,
-- spec §6.4). Keputusan pemilik: konfirmasi otomatis. Klik "Konfirmasi jadwal"
-- admin hanya tersisa untuk baris warisan QRIS yang tidak punya pesanan.
--
-- Isi:
--   (1) sessions.kabari_bidan_sejak   penanda "Baru — kabari bidan" (§6.7)
--   (2) sisipkan_sesi_dari_permintaan sisipan sesi yang dipindah dari
--                                      konfirmasi_permintaan, dipakai bersama
--   (3) salurkan_sesi                 penyalur tertutup, tidak pernah melempar
--   (4) salurkan_pesanan              cabang 'sesi' memanggil (3)
--   (5) konfirmasi_permintaan         menolak pengajuan berpesanan; memakai (2)

-- ---------------------------------------------------------------------------
-- (1) Penanda kabari bidan
-- ---------------------------------------------------------------------------
-- Stempel waktu, bukan boolean: layar staf bisa mengurutkan "yang paling lama
-- belum dikabari", dan null berarti tidak ada yang perlu dikabari.
--
-- NAMANYA SENGAJA TANPA "bayar". `sessions` bukan anggota TABEL_UANG, dan
-- money firewall (tests/money-firewall-struktural.test.ts) menuduh setiap
-- kolom di luar tabel uang yang namanya cocok POLA_NOMINAL (`bayar`,
-- `pembayaran`, …). Penanda ini tentang memberi tahu bidan, bukan tentang uang.
alter table public.sessions
  add column kabari_bidan_sejak timestamptz;

comment on column public.sessions.kabari_bidan_sejak is
  'Diisi penyalur sesi saat sesi lahir otomatis dari pesanan lunas; dikosongkan '
  'aksi admin "Sudah dikabari". Null = tidak perlu dikabari (sesi warisan, jalur 2).';

comment on type public.order_event is
  'Kejadian yang dicatat jejak_pesanan. Enam di antaranya (selisih_nominal, '
  'selisih_status, lunas_setelah_tutup, akses_tertahan, penangan_belum_ada, '
  'sesi_tertahan) WAJIB menyalakan orders.butuh_tinjauan_pada di transaksi yang '
  'sama dengan jejaknya — itulah satu-satunya aturan yang membuat blok "Butuh '
  'perhatian" tidak perlu tumbuh setiap kali ada nilai enum baru.';

-- ---------------------------------------------------------------------------
-- (2) sisipkan_sesi_dari_permintaan
-- ---------------------------------------------------------------------------
-- Sisipan `sessions` dari konfirmasi_permintaan (20260912101000:128-159)
-- DIPINDAH ke sini apa adanya, termasuk jenjang otomatis dan komentarnya.
-- Satu-satunya tambahan: `kabari_bidan_sejak`. Dua pemanggil, satu sisipan:
-- salinan kedua adalah tempat kedua yang bisa berselisih diam-diam soal
-- kolom mana yang disalin dari pengajuan.
--
-- Pemanggil sudah mengunci baris pengajuan dan memindahkannya ke
-- `dikonfirmasi` sebelum memanggil fungsi ini; fungsi ini tidak memeriksa
-- syarat apa pun.
create or replace function public.sisipkan_sesi_dari_permintaan(
  p_permintaan_id uuid,
  p_kabari boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.booking_requests%rowtype;
  m public.partners%rowtype;
  km double precision;
  jenjang_hitung jenjang_transport;
  sesi_id uuid;
begin
  select * into p from public.booking_requests where id = p_permintaan_id;
  if not found then
    raise exception 'Pengajuan % tidak ditemukan.', p_permintaan_id using errcode = 'P0002';
  end if;

  select * into m from public.partners where id = p.partner_id;

  -- Koordinat yang tidak lengkap BUKAN galat: alamat Malang sering gagal
  -- digeocode, dan domisili mitra boleh belum diisi. Jenjangnya tetap NULL, dan
  -- admin menetapkannya belakangan lewat `tetapkanJenjang`.
  if m.lat is not null and m.lon is not null
     and p.alamat_lat is not null and p.alamat_lon is not null then
    km := public.jarak_km(m.lat, m.lon, p.alamat_lat, p.alamat_lon);
    jenjang_hitung := public.jenjang_dari_jarak(km);
  end if;

  insert into public.sessions (
    client_id, service_id, variant_id, partner_id,
    tanggal, jam_mulai,
    alamat, alamat_lat, alamat_lon,
    jenjang, jenjang_sumber, jenjang_alasan,
    status, booking_request_id,
    -- Sesi lahir LUNAS: uangnya sudah masuk dan sudah diverifikasi admin
    -- sebelum baris ini pernah ada. Tanpa ini, klien akan melihat tagihan
    -- kedua untuk sesi yang sudah ia bayar.
    status_bayar,
    -- B3: hanya sesi yang lahir OTOMATIS yang perlu dikabarkan ke bidan.
    -- Konfirmasi tangan (baris warisan) sudah dikerjakan admin yang sama
    -- yang akan menghubungi bidannya.
    kabari_bidan_sejak
  ) values (
    p.client_id, p.service_id, p.variant_id, p.partner_id,
    p.tanggal, p.jam_mulai,
    p.alamat, p.alamat_lat, p.alamat_lon,
    jenjang_hitung,
    case when jenjang_hitung is null then null else 'otomatis'::sumber_jenjang end,
    '',
    'terjadwal', p.id,
    'lunas',
    case when p_kabari then now() end
  )
  returning id into sesi_id;

  return sesi_id;
end;
$$;

comment on function public.sisipkan_sesi_dari_permintaan(uuid, boolean) is
  'Sisipan sessions dari baris pengajuan (jenjang dihitung di SQL, lahir lunas). '
  'Dipakai salurkan_sesi (p_kabari = true) dan konfirmasi_permintaan (false). '
  'Tidak memeriksa syarat; pemanggil yang memeriksa dan mengunci.';

-- Tertutup: melahirkan sesi LUNAS dari id pengajuan mana saja tanpa syarat.
revoke all on function public.sisipkan_sesi_dari_permintaan(uuid, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- (3) salurkan_sesi
-- ---------------------------------------------------------------------------
create or replace function public.salurkan_sesi(p_pesanan_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_padma_id text;
  v_status_pesanan public.order_status;
  v_pengajuan uuid[];
  v_permintaan_id uuid;
  v_status public.booking_status;
  v_partner_id uuid;
  v_tanggal date;
  v_jam_mulai time;
  v_aktif boolean;
  v_mulai timestamptz;
  v_alasan text;
  v_sesi_id uuid;
begin
  -- TIDAK PERNAH MELEMPAR. Pemanggil utamanya `salurkan_pesanan` di dalam
  -- transaksi `terapkan_notifikasi_gateway`: pengecualian apa pun dari sini
  -- menggulung SELURUH transaksi webhook — sidik, notifikasi, dan perpindahan
  -- ke `lunas` — sehingga uang yang sudah dibayar klien hilang dari basis
  -- data. Seluruh badan karena itu berada di dalam blok `exception when
  -- others`; galat apa pun menjadi jejak `sesi_tertahan` + tanda tinjauan,
  -- pola yang sama dengan `akses_tertahan` di `terbitkan_akses_item`.
  begin
    -- URUTAN KUNCI: pesanan → pengajuan (Ruling 4, rencana B), sama dengan
    -- `terbitkan_tagihan_sesi` dan webhook. Di jalur webhook pesanan ini sudah
    -- dikunci `terapkan_notifikasi_gateway`; dikunci lagi di sini untuk jalur
    -- rute pemulihan, yang memanggil fungsi ini langsung. Mengunci pengajuan
    -- lebih dulu lalu pesanan (misalnya untuk tanda tinjauan di bawah)
    -- membalik urutan terhadap `terbitkan_tagihan_sesi`, yang memegang semua
    -- pesanan pengajuan sambil menunggu baris pengajuannya: deadlock.
    select o.status, c.padma_id
      into v_status_pesanan, v_padma_id
      from public.orders o
      join public.clients c on c.id = o.client_id
     where o.id = p_pesanan_id
     for update of o;
    if not found then
      raise exception 'Pesanan % tidak ditemukan.', p_pesanan_id using errcode = 'P0002';
    end if;

    -- PER booking_request_id, BUKAN PER ITEM. Pesanan sesi membawa dua item
    -- (layanan + transport) untuk SATU pengajuan, dan sesi hanya boleh lahir
    -- sekali. `salurkan_pesanan` memanggil fungsi ini sekali per pesanan, dan
    -- pemeriksaan `sudah_ada` di bawah menjaga panggilan ulang (tombol
    -- pemulihan) tetap idempoten.
    select array_agg(distinct i.booking_request_id)
      into v_pengajuan
      from public.order_items i
     where i.pesanan_id = p_pesanan_id
       and i.jenis = 'sesi';
    if coalesce(cardinality(v_pengajuan), 0) <> 1 then
      raise exception 'Pesanan % tidak membawa tepat satu pengajuan sesi.', p_pesanan_id
        using errcode = 'P0001';
    end if;
    v_permintaan_id := v_pengajuan[1];

    -- Pengajuan dikunci SESUDAH pesanan (lihat atas). Tanpa kunci ini,
    -- perubahan bidan atau status yang commit di sela-sela pemeriksaan dan
    -- sisipan melahirkan sesi dari keadaan yang sudah basi.
    select b.status, b.partner_id, b.tanggal, b.jam_mulai
      into v_status, v_partner_id, v_tanggal, v_jam_mulai
      from public.booking_requests b
     where b.id = v_permintaan_id
     for update;
    if not found then
      raise exception 'Pengajuan % tidak ditemukan.', v_permintaan_id using errcode = 'P0002';
    end if;

    if exists (select 1 from public.sessions s where s.booking_request_id = v_permintaan_id) then
      return 'sudah_ada';
    end if;

    select m.aktif into v_aktif from public.partners m where m.id = v_partner_id;
    -- Jam DINDING Jakarta, sama dengan `terbitkan_tagihan_sesi`: tanpa
    -- `at time zone` ia dibaca UTC, tujuh jam terlambat.
    v_mulai := (v_tanggal + v_jam_mulai) at time zone 'Asia/Jakarta';

    -- EMPAT SYARAT §6.4, alasan gagalnya ditulis spesifik ke jejak.
    if v_status is distinct from 'menunggu_bayar' then
      v_alasan := format('pengajuan tidak lagi menunggu pembayaran (berstatus %s)', v_status);
    elsif v_partner_id is null then
      -- Mustahil lewat jalur sah: penerbitan dan ganti bidan sama-sama
      -- menuntut bidan aktif. Dilempar, bukan disamarkan sebagai "bidan
      -- nonaktif" — sama dengan konfirmasi_permintaan — lalu ditangkap blok
      -- exception di bawah seperti galat lain.
      raise exception 'permintaan menunggu_bayar tanpa mitra: %', v_permintaan_id;
    elsif not coalesce(v_aktif, false) then
      v_alasan := 'bidan pengajuan ini nonaktif — ganti bidan, lalu tekan "Terbitkan akses / Buat sesi"';
    elsif v_status_pesanan is distinct from 'lunas' then
      v_alasan := format('pesanan berstatus %s, bukan lunas', v_status_pesanan);
    elsif v_mulai <= now() then
      -- Pertahanan berlapis: tenggat "mana yang lebih dulu" seharusnya sudah
      -- membuat DOKU menolak pembayaran sesudah jam kunjungan, tetapi uang
      -- yang tetap mendarat tidak boleh melahirkan sesi di masa lalu.
      v_alasan := format('jam kunjungan %s %s WIB sudah lewat',
                         v_tanggal, to_char(v_jam_mulai, 'HH24:MI'));
    end if;

    if v_alasan is null then
      update public.booking_requests b
         set status = 'dikonfirmasi',
             status_bayar = 'lunas'
       where b.id = v_permintaan_id;

      v_sesi_id := public.sisipkan_sesi_dari_permintaan(v_permintaan_id, true);

      insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
      values (p_pesanan_id, v_padma_id, 'sesi_terkonfirmasi', format('sesi %s', v_sesi_id));

      return 'terkonfirmasi';
    end if;
  exception when others then
    -- Subtransaksi blok ini sudah digulung: tidak ada setengah konfirmasi
    -- (pengajuan `dikonfirmasi` tanpa sesi) yang tertinggal.
    v_alasan := format('galat: %s', sqlerrm);
  end;

  -- Syarat gagal ATAU galat: manusia dipanggil. Insert-select, bukan
  -- `values`: pesanan yang tidak ada tidak meninggalkan jejak yatim.
  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  select o.id, c.padma_id, 'sesi_tertahan', v_alasan
    from public.orders o
    join public.clients c on c.id = o.client_id
   where o.id = p_pesanan_id;

  -- Array POSITIF lima nilai dan `coalesce` lestari, alasan yang sama dengan
  -- `terbitkan_akses_item`: sebab tinjauan PERTAMA bertahan, dan pemanggil
  -- kedua (rute pemulihan) bisa mengenai pesanan di luar ('lunas','ditahan').
  update public.orders o
     set butuh_tinjauan_pada = coalesce(o.butuh_tinjauan_pada, now()),
         sebab_tinjauan = coalesce(o.sebab_tinjauan, 'sesi_tertahan')
   where o.id = p_pesanan_id
     and o.status = any (array['menunggu_bayar','ditahan','lunas','kedaluwarsa','dibatalkan']::public.order_status[]);

  return 'tertahan';
end;
$$;

comment on function public.salurkan_sesi(uuid) is
  'Penyalur sesi (spec §6.4): pesanan sesi lunas -> pengajuan dikonfirmasi + '
  'sesi lahir bertanda kabari bidan. Per booking_request_id. Memulangkan '
  'terkonfirmasi / sudah_ada / tertahan; TIDAK PERNAH melempar.';

-- Tertutup: dipanggil salurkan_pesanan (definer) dan rute pemulihan bersevice role.
revoke all on function public.salurkan_sesi(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- (4) salurkan_pesanan: salinan 20260927100000:179-236. Berubah hanya:
--     cabang 'sesi' berhenti mencatat penangan_belum_ada, dan sesudah loop
--     pesanan yang membawa item sesi memanggil salurkan_sesi SEKALI.
-- ---------------------------------------------------------------------------
create or replace function public.salurkan_pesanan(p_pesanan_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_padma_id text;
  v_ada_sesi boolean := false;
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
        -- Penyalur sesi bekerja per PENGAJUAN, bukan per item: dua item
        -- (layanan + transport) untuk satu pengajuan melahirkan satu sesi.
        -- Dicatat di sini, dipanggil sekali sesudah loop.
        v_ada_sesi := true;
      else
        -- Nilai `order_item_source` KETIGA yang kelak lahir berhenti di sini
        -- dengan kalimat, bukan dengan `case_not_found` yang tidak menyebut
        -- apa pun. Fail-closed disengaja: diam berarti uang diambil untuk
        -- barang yang tidak ada yang tahu cara menyerahkannya.
        raise exception 'Jenis item pesanan % belum punya penyalur: %', r.id, r.jenis
          using errcode = 'P0001';
    end case;
  end loop;

  if v_ada_sesi then
    -- `salurkan_sesi` tidak pernah melempar: kegagalannya menjadi
    -- `sesi_tertahan` + tinjauan, dan pelunasan di transaksi ini tetap utuh.
    perform public.salurkan_sesi(p_pesanan_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- (5) konfirmasi_permintaan: salinan 20260912101000:93-166. Berubah hanya:
--     (a) penolakan P0001 untuk pengajuan yang punya pesanan, dan
--     (b) sisipan sesi lewat sisipkan_sesi_dari_permintaan(id, false).
-- ---------------------------------------------------------------------------
-- RPC ini HANYA tersisa untuk tagihan warisan QRIS (§7): pengajuan yang tidak
-- punya satu pun pesanan. Untuk pengajuan berpesanan satu-satunya jalan
-- kelahiran sesi adalah penyalur. Konfirmasi tangan di sana memintas keempat
-- syarat §6.4 dan jejak pesanannya, sehingga sesi bisa lahir untuk tagihan
-- yang belum dibayar lewat DOKU.
create or replace function public.konfirmasi_permintaan(permintaan_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.booking_requests%rowtype;
  sesi_id uuid;
begin
  if user_role() not in ('admin', 'owner') then
    raise exception 'hanya staf yang boleh mengonfirmasi permintaan jadwal'
      using errcode = '42501';
  end if;

  -- SYARAT BARU B3. Pesanan apa pun statusnya: pesanan terbuka berarti
  -- uangnya sedang ditagih DOKU, pesanan lunas berarti penyalur yang
  -- bertugas, dan pesanan tertutup berarti uang yang mungkin mendarat
  -- sesudahnya ditangani tinjauan lunas_setelah_tutup.
  if exists (
    select 1 from public.orders o where o.booking_request_id = permintaan_id
  ) then
    raise exception 'Pengajuan ini dibayar lewat DOKU; sesinya lahir otomatis.'
      using errcode = 'P0001';
  end if;

  update public.booking_requests
     set status = 'dikonfirmasi'
   where id = permintaan_id
     and status = 'menunggu_bayar'
     -- SYARAT BARU C2. Tanpa baris ini, seluruh rantai pembayaran hanyalah
     -- layar yang bisa dilewati satu panggilan RPC.
     and status_bayar = 'lunas'
  returning * into p;

  if not found then
    return null;
  end if;

  if p.partner_id is null then
    raise exception 'permintaan menunggu_bayar tanpa mitra: %', permintaan_id;
  end if;

  -- Sisipan sesi (jenjang otomatis, lahir lunas) DIPINDAH ke
  -- sisipkan_sesi_dari_permintaan (B3), dipakai bersama penyalur sesi. Tanpa
  -- penanda kabari bidan: admin yang mengonfirmasi tangan sudah memegangnya.
  sesi_id := public.sisipkan_sesi_dari_permintaan(p.id, false);

  return sesi_id;
end;
$$;

revoke execute on function public.konfirmasi_permintaan(uuid) from public, anon;
grant execute on function public.konfirmasi_permintaan(uuid) to authenticated;
