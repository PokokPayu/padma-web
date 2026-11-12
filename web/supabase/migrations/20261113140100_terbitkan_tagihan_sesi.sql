-- Tagihan sesi menjadi pesanan beku (tugas B2, spec §6.2, §6.5 kunci, D1).
--
-- Tiga fungsi:
--   uang_sudah_masuk_permintaan  predikat "uang sudah masuk" untuk satu
--                                pengajuan, ditulis SEKALI (Ruling 1) dan dipakai
--                                B2 (kunci terbit ulang), B4 (penjaga batal),
--                                B6 (tombol Bayar). Tiga salinan logika yang sama
--                                pasti suatu hari berpisah diam-diam.
--   rincian_tagihan_permintaan   rumus harga, SATU-SATUNYA tempatnya. Sebelum
--                                B2 rumus ini hidup di TS (hitungTagihanPengajuan)
--                                dan angkanya dikirim pemanggil; kini nilai
--                                turunan tidak pernah menyeberang dari pemanggil
--                                (doktrin konfirmasi_permintaan). B7 menghapus
--                                rumus TS sesudah uji kesetaraan D1 hijau.
--   terbitkan_tagihan_sesi       menerbitkan (atau menerbitkan ulang) tagihan
--                                sebagai pesanan jenis 'sesi' dengan harga beku.
--
-- Galat yang bisa ditindak admin dilempar dengan hint 'sebab_tagihan' dan
-- message = kunci KALIMAT_SEBAB_ADMIN (src/lib/tagihan/pengajuan.ts). Kalimat
-- tinggal di TS; SQL hanya menyebut SEBABNYA.

-- ---------------------------------------------------------------------------
-- uang_sudah_masuk_permintaan
-- ---------------------------------------------------------------------------
create or replace function public.uang_sudah_masuk_permintaan(p_permintaan_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    -- (1) Pesanan BERUANG untuk pengajuan ini. Daftar status ditulis eksplisit
    --     sebagai himpunan: nilai enum baru harus diputuskan masuk atau tidak,
    --     bukan lolos diam-diam lewat perbandingan tunggal.
    exists (
      select 1
        from public.orders o
       where o.booking_request_id = p_permintaan_id
         and o.status = any (array['lunas','ditahan']::public.order_status[])
    )
    -- (2) Uang mendarat di pesanan yang sudah kita tutup, dan staf belum
    --     menyelesaikannya (refund manual lalu tutup_tinjauan).
    or exists (
      select 1
        from public.orders o
       where o.booking_request_id = p_permintaan_id
         and o.sebab_tinjauan = 'lunas_setelah_tutup'
         and o.butuh_tinjauan_pada is not null
    )
    -- (3) Sisa alur QRIS lama: bukti sudah diunggah atau sudah ditandai lunas.
    or exists (
      select 1
        from public.booking_requests b
       where b.id = p_permintaan_id
         and b.status_bayar <> 'belum'
    );
$$;

comment on function public.uang_sudah_masuk_permintaan(uuid) is
  'Benar bila uang untuk pengajuan ini sudah masuk: pesanan lunas/ditahan, '
  'lunas_setelah_tutup yang tinjauannya belum ditutup, atau status_bayar <> belum. '
  'Satu definisi untuk terbit ulang (B2), penjaga batal (B4), dan tombol Bayar (B6).';

-- Tertutup bagi pemegang sesi mana pun: ia hanya dipanggil dari dalam fungsi
-- security definer lain, dan membukanya memberi tahu siapa saja pengajuan mana
-- yang sudah dibayar.
revoke all on function public.uang_sudah_masuk_permintaan(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- rincian_tagihan_permintaan
-- ---------------------------------------------------------------------------
-- Cermin rumus TS lama (hitungTagihanPengajuan + daftarTagihanPengajuanAdmin):
--   - tarif = baris `berlaku_sejak` terbesar yang <= TANGGAL SESI (bukan hari
--     ini), sama dengan tarifPadaTanggal. Seri dipecah `id` supaya hasilnya
--     tetap; UNIQUE (…, berlaku_sejak) membuat seri tidak mungkin lagi.
--   - jenjang hanya bila KEEMPAT koordinat ada. Bila tidak, sebabnya
--     mitra_tanpa_titik (titik mitra hilang) didahulukan atas alamat_tanpa_pin,
--     dan transport = null — jenjang yang tidak diketahui bukan transport gratis.
--   - urutan sebab sesudah jenjang: tarif varian dulu, lalu tarif transport.
--   - `transport_khusus` TIDAK ikut: ia berkunci session_id dan tidak pernah
--     dioper jalur tagihan pengajuan (daftarTagihanPengajuanAdmin).
create or replace function public.rincian_tagihan_permintaan(p_permintaan_id uuid)
returns table (
  layanan integer,
  transport integer,
  jenjang public.jenjang_transport,
  sebab text
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_variant_id uuid;
  v_tanggal date;
  v_alamat_lat double precision;
  v_alamat_lon double precision;
  v_mitra_lat double precision;
  v_mitra_lon double precision;
  v_layanan integer;
  v_transport integer;
  v_jenjang public.jenjang_transport;
begin
  if public.user_role() not in ('admin', 'owner') then
    raise exception 'Hanya staf yang boleh membaca rincian tagihan.' using errcode = '42501';
  end if;

  select b.variant_id, b.tanggal, b.alamat_lat, b.alamat_lon, m.lat, m.lon
    into v_variant_id, v_tanggal, v_alamat_lat, v_alamat_lon, v_mitra_lat, v_mitra_lon
    from public.booking_requests b
    left join public.partners m on m.id = b.partner_id
   where b.id = p_permintaan_id;
  if not found then
    raise exception 'Permintaan tidak ditemukan.' using errcode = 'P0002';
  end if;

  select vr.harga_klien into v_layanan
    from public.variant_rates vr
   where vr.variant_id = v_variant_id
     and vr.berlaku_sejak <= v_tanggal
   order by vr.berlaku_sejak desc, vr.id
   limit 1;

  if v_mitra_lat is null or v_mitra_lon is null then
    return query select v_layanan, null::integer, null::public.jenjang_transport, 'mitra_tanpa_titik'::text;
    return;
  end if;
  if v_alamat_lat is null or v_alamat_lon is null then
    return query select v_layanan, null::integer, null::public.jenjang_transport, 'alamat_tanpa_pin'::text;
    return;
  end if;

  v_jenjang := public.jenjang_dari_jarak(
    public.jarak_km(v_mitra_lat, v_mitra_lon, v_alamat_lat, v_alamat_lon));

  select tr.tarif_klien into v_transport
    from public.transport_rates tr
   where tr.jenjang = v_jenjang
     and tr.berlaku_sejak <= v_tanggal
   order by tr.berlaku_sejak desc, tr.id
   limit 1;

  return query select
    v_layanan,
    v_transport,
    v_jenjang,
    case
      when v_layanan is null then 'tarif_varian_kosong'
      when v_transport is null then 'tarif_transport_kosong'
    end::text;
end;
$$;

comment on function public.rincian_tagihan_permintaan(uuid) is
  'Rumus harga tagihan pengajuan (layanan + transport menurut tanggal sesi). '
  'Satu-satunya tempat rumus ini hidup; sebab tidak null berarti tagihan belum lengkap.';

revoke all on function public.rincian_tagihan_permintaan(uuid) from public, anon;
grant execute on function public.rincian_tagihan_permintaan(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- terbitkan_tagihan_sesi
-- ---------------------------------------------------------------------------
create or replace function public.terbitkan_tagihan_sesi(p_permintaan_id uuid)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_status public.booking_status;
  v_client_id uuid;
  v_partner_id uuid;
  v_tanggal date;
  v_jam_mulai time;
  v_padma_id text;
  v_aktif boolean;
  v_mulai timestamptz;
  v_tenggat timestamptz;
  v_layanan integer;
  v_transport integer;
  v_sebab text;
  v_n smallint;
  v_lama uuid;
  v_pesanan_id uuid;
  v_kode text;
  v_kendala text;
  v_sisa integer := 5;
begin
  if public.user_role() not in ('admin', 'owner') then
    raise exception 'Hanya staf yang boleh menerbitkan tagihan.' using errcode = '42501';
  end if;

  -- KUNCI BARIS PENGAJUAN. Dua klik "Terbitkan tagihan" (atau dua tab) masuk
  -- berurutan: yang kedua menunggu yang pertama selesai, lalu membaca status
  -- dan pesanan TERBARU dan menjadi terbit ulang yang sah. Tanpa kunci ini
  -- yang kedua membaca keadaan basi, tidak melihat pesanan pertama, dan
  -- menabrak indeks pesanan_sesi_terbuka_satu_per_pengajuan sebagai galat
  -- mentah. Indeks itu tetap jaring terakhir, bukan mekanisme utamanya.
  select b.status, b.client_id, b.partner_id, b.tanggal, b.jam_mulai, c.padma_id
    into v_status, v_client_id, v_partner_id, v_tanggal, v_jam_mulai, v_padma_id
    from public.booking_requests b
    join public.clients c on c.id = b.client_id
   where b.id = p_permintaan_id
   for update of b;

  if not found or v_status not in ('mitra_siap', 'menunggu_bayar') then
    raise exception 'permintaan_tidak_siap' using errcode = 'P0001', hint = 'sebab_tagihan';
  end if;

  -- Diperiksa dari KEDUA status asal, bukan hanya menunggu_bayar: pengajuan
  -- yang sudah dibayar bisa kembali ke mitra_siap lewat ganti bidan
  -- (menunggu_bayar -> mencari_mitra -> mitra_siap, jalan sah), dan tagihan
  -- kedua atas uang yang sudah masuk adalah penagihan ganda.
  if public.uang_sudah_masuk_permintaan(p_permintaan_id) then
    raise exception 'uang_sudah_masuk' using errcode = 'P0001', hint = 'sebab_tagihan';
  end if;

  select m.aktif into v_aktif from public.partners m where m.id = v_partner_id;
  if not coalesce(v_aktif, false) then
    raise exception 'bidan_nonaktif' using errcode = 'P0001', hint = 'sebab_tagihan';
  end if;

  -- Jam mulai kunjungan adalah jam DINDING Jakarta. `tanggal + jam_mulai`
  -- adalah timestamp tanpa zona; tanpa `at time zone 'Asia/Jakarta'` ia dibaca
  -- dalam zona sesi, yaitu UTC di Supabase maupun Vercel — tujuh jam terlambat,
  -- sehingga tagihan masih bisa dibayar sesudah bidan datang.
  v_mulai := (v_tanggal + v_jam_mulai) at time zone 'Asia/Jakarta';
  if v_mulai <= now() then
    raise exception 'jam_kunjungan_lewat' using errcode = 'P0001', hint = 'sebab_tagihan';
  end if;

  -- Harga dari SATU rumus, tidak pernah dari pemanggil.
  select r.layanan, r.transport, r.sebab
    into v_layanan, v_transport, v_sebab
    from public.rincian_tagihan_permintaan(p_permintaan_id) r;
  if v_sebab is not null then
    raise exception '%', v_sebab using errcode = 'P0001', hint = 'sebab_tagihan';
  end if;

  -- Tutup pesanan yang masih terbuka (terbit ulang, §6.5). Uang yang tetap
  -- mendarat di pesanan lama tertangkap sebagai lunas_setelah_tutup dan
  -- mengunci terbit ulang berikutnya lewat uang_sudah_masuk_permintaan.
  for v_lama in
    select o.id
      from public.orders o
     where o.booking_request_id = p_permintaan_id
       and o.status = 'menunggu_bayar'
     for update
  loop
    if not coalesce(
      public.perpindahan_pesanan_sah('menunggu_bayar'::public.order_status,
                                     'dibatalkan'::public.order_status), false) then
      raise exception 'Mesin status menolak menutup pesanan lama.' using errcode = 'P0001';
    end if;

    update public.orders o
       set status = 'dibatalkan',
           ditutup_pada = now()
     where o.id = v_lama
       and o.status = any (array['menunggu_bayar']::public.order_status[]);

    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_lama, v_padma_id, 'dibatalkan', 'tagihan diterbitkan ulang');
  end loop;

  -- Tenggat = yang LEBIH DULU antara 24 jam lagi dan jam mulai kunjungan
  -- (keputusan pemilik "mana yang lebih dulu"). Tagihan untuk kunjungan besok
  -- pagi tidak boleh masih bisa dibayar sesudah bidan datang; DOKU menolak
  -- pembayaran sesudah tenggat, dan penyalur sesi (B3) menolak sesi di masa
  -- lalu sebagai lapis kedua.
  -- '24 hours' = JAM_TENGGAT_PESANAN (src/lib/pesanan/status.ts). Pengikatnya
  -- uji tenggat di tests/tagihan-sesi-db.test.ts. Ditulis eksplisit, tidak
  -- bersandar pada default kolom kedaluwarsa_pada.
  v_tenggat := least(now() + interval '24 hours', v_mulai);

  -- Item transport bernilai 0 dihilangkan. jumlah_item WAJIB sama dengan
  -- jumlah baris item: mesin pembayaran membandingkannya.
  v_n := case when v_transport > 0 then 2 else 1 end;

  -- Pembangkitan kode disalin dari buat_pesanan_keranjang (20261113140000).
  -- Hanya tabrakan `orders_kode_unik` yang dicoba ulang; kendala lain
  -- (termasuk indeks satu pesanan terbuka per pengajuan) dilempar apa adanya.
  while v_pesanan_id is null and v_sisa > 0 loop
    v_sisa := v_sisa - 1;
    v_kode := 'PSN-'
           || to_char((now() at time zone 'Asia/Jakarta')::date, 'YYMMDD')
           || '-'
           || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.orders (
        kode, client_id, jumlah_item, jenis, booking_request_id, kedaluwarsa_pada
      )
      values (v_kode, v_client_id, v_n, 'sesi', p_permintaan_id, v_tenggat)
      returning orders.id into v_pesanan_id;
    exception when unique_violation then
      get stacked diagnostics v_kendala = constraint_name;
      if v_kendala <> 'orders_kode_unik' then
        raise;
      end if;
    end;
  end loop;

  if v_pesanan_id is null then
    raise exception 'Gagal menerbitkan kode pesanan sesudah lima percobaan. Coba lagi.'
      using errcode = 'P0001';
  end if;

  -- Judul TANPA nama layanan: nama layanan bisa mengungkap kondisi kesehatan
  -- klien di halaman pembayaran pihak ketiga (§5.3).
  insert into public.order_items (pesanan_id, jenis, booking_request_id, judul_beku, harga_beku, urutan)
  values (v_pesanan_id, 'sesi', p_permintaan_id, 'Sesi kunjungan PADMA', v_layanan, 1);
  if v_transport > 0 then
    insert into public.order_items (pesanan_id, jenis, booking_request_id, judul_beku, harga_beku, urutan)
    values (v_pesanan_id, 'sesi', p_permintaan_id, 'Biaya transport', v_transport, 2);
  end if;

  insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
  values (v_pesanan_id, v_padma_id, 'dibuat', 'tagihan sesi');

  -- tenggat = kedaluwarsa_pada PERSIS (satu variabel), supaya layar staf,
  -- Passport, dan mesin pembayaran tidak pernah berselisih satu detik pun.
  update public.booking_requests b
     set tenggat = v_tenggat,
         status_bayar = 'belum',
         status = case when b.status = 'mitra_siap'
                       then 'menunggu_bayar'::public.booking_status
                       else b.status end
   where b.id = p_permintaan_id;

  return v_pesanan_id;
end;
$$;

comment on function public.terbitkan_tagihan_sesi(uuid) is
  'Staf menerbitkan (ulang) tagihan pengajuan sebagai pesanan sesi berharga beku. '
  'Tenggat = least(now() + 24 jam, jam kunjungan Asia/Jakarta) dan sama persis di '
  'booking_requests.tenggat. Ditolak bila uang untuk pengajuan ini sudah masuk.';

revoke all on function public.terbitkan_tagihan_sesi(uuid) from public, anon;
grant execute on function public.terbitkan_tagihan_sesi(uuid) to authenticated;
