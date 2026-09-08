-- ============================================================================
-- C2 (2/2): PAGAR PEMBAYARAN
-- ============================================================================
-- Berkas terpisah dari yang menambah nilai enum — lihat alasan 55P04 di sana.

-- ---------------------------------------------------------------------------
-- (1) KEADAAN PEMBAYARAN PADA PENGAJUAN
--
-- Yang ditambahkan hanyalah KEADAAN, bukan angka. Nominal tagihan TIDAK
-- disimpan (spec C2 P2): money firewall membatasi kolom nominal uang pada empat
-- tabel tarif, dan `tests/money-firewall-struktural.test.ts` memindai SELURUH
-- skema termasuk tabel yang belum lahir. Nominal turunan yang disimpan juga
-- hanya menambah tempat untuk berselisih — tagihan dihitung dari
-- `variant_rates` menurut TANGGAL SESI ditambah `transport_rates` menurut
-- jenjang, persis cara rekap owner bekerja.
--
-- `status_bayar` memakai enum `pay_status` yang sudah ada, dan money firewall
-- mengecualikannya SECARA EKSPLISIT karena ia keadaan, bukan nominal —
-- pengecualian yang diikat ke TIPE: `status_bayar int` tetap akan merah.
alter table public.booking_requests
  add column status_bayar pay_status not null default 'belum',
  add column bukti_objek text,
  -- NAMANYA `tenggat`, bukan `tenggat_bayar`. Money firewall memindai NAMA
  -- kolom dengan regex per-kata dan `bayar` ada di daftarnya — dan itu benar:
  -- ia tidak bisa membedakan cap waktu dari nominal hanya dari namanya.
  -- Mengganti nama lebih murah daripada melonggarkan pagar yang menjaga
  -- seluruh skema, termasuk tabel yang belum lahir.
  add column tenggat timestamptz;

comment on column public.booking_requests.status_bayar is
  'Keadaan pembayaran tagihan pengajuan (spec C2). Nominalnya TIDAK disimpan di '
  'mana pun — ia diturunkan dari variant_rates + transport_rates menurut '
  'tanggal sesi.';

comment on column public.booking_requests.tenggat is
  'Batas waktu membayar, diisi saat tagihan terbit (mitra_siap -> menunggu_bayar). '
  'Lewat tenggat = pengajuan dibatalkan otomatis DAN skriningnya dikembalikan.';

-- Tenggat hanya bermakna sesudah tagihan terbit; sebelum itu ia harus kosong.
-- Tanpa CHECK ini, tenggat yang tertinggal dari percobaan sebelumnya membuat
-- pembatal terjadwal menyapu pengajuan yang belum pernah ditagih.
alter table public.booking_requests
  add constraint booking_requests_tenggat_hanya_saat_ditagih
  check (
    (status = 'menunggu_bayar' and tenggat is not null)
    or (status <> 'menunggu_bayar')
  );

-- ---------------------------------------------------------------------------
-- (2) PETA PERPINDAHAN BARU
--
-- `mitra_siap -> dikonfirmasi` DIHAPUS. Itu seluruh inti C2: konfirmasi tidak
-- lagi bisa terjadi tanpa uang berpindah. Wajib identik dengan
-- `PERPINDAHAN_PERMINTAAN` di src/lib/jadwal/status.ts — dua daftar yang harus
-- sama adalah kesalahan yang paling mudah terjadi, karena itu
-- tests/rantai-status-db.test.ts membaca KEDUANYA dan membandingkannya.
create or replace function public.perpindahan_permintaan_sah(
  dari booking_status,
  ke booking_status
) returns boolean
language sql
immutable
as $$
  select case dari
    when 'diminta'            then ke in ('mencari_mitra', 'dibatalkan_klien')
    when 'mencari_mitra'      then ke in ('mitra_siap', 'diminta', 'dibatalkan_klien')
    when 'mitra_siap'         then ke in ('menunggu_bayar', 'mencari_mitra', 'dibatalkan_klien')
    when 'menunggu_bayar'     then ke in ('dikonfirmasi', 'mencari_mitra',
                                          'dibatalkan_klien', 'dibatalkan_tenggat')
    when 'dikonfirmasi'       then false
    when 'dibatalkan_klien'   then false
    when 'dibatalkan_tenggat' then false
    when 'ditolak'            then false
  end;
$$;

revoke execute on function public.perpindahan_permintaan_sah(booking_status, booking_status)
  from public, anon;

-- ---------------------------------------------------------------------------
-- (3) KONFIRMASI MENUNTUT LUNAS — DI DALAM FUNGSINYA
--
-- `konfirmasi_permintaan()` dari C1-a mengklaim dari `mitra_siap`. Ia WAJIB
-- berubah, dan syarat "sudah lunas" WAJIB hidup DI DALAM fungsi ini — bukan di
-- server action. Fungsi ini `security definer` dan ber-EXECUTE untuk
-- `authenticated`: admin bisa memanggilnya langsung tanpa lewat layar mana pun,
-- dan pemanggil yang bisa melewati syaratnya adalah syarat yang tidak ada.
--
-- Sisa badan disalin APA ADANYA dari migration `pagar_jam_dan_jenjang`,
-- termasuk komentarnya: `create or replace` mengganti seluruh badan, dan apa
-- yang tidak disalin, hilang. Pelajaran ini dibayar mahal di C1-a — menulis
-- ulang `klaim_sudah_bayar` dari ingatan menghilangkan empat perilaku sekaligus.
create or replace function public.konfirmasi_permintaan(permintaan_id uuid)
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
  if user_role() not in ('admin', 'owner') then
    raise exception 'hanya staf yang boleh mengonfirmasi permintaan jadwal'
      using errcode = '42501';
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
    status_bayar
  ) values (
    p.client_id, p.service_id, p.variant_id, p.partner_id,
    p.tanggal, p.jam_mulai,
    p.alamat, p.alamat_lat, p.alamat_lon,
    jenjang_hitung,
    case when jenjang_hitung is null then null else 'otomatis'::sumber_jenjang end,
    '',
    'terjadwal', p.id,
    'lunas'
  )
  returning id into sesi_id;

  return sesi_id;
end;
$$;

revoke execute on function public.konfirmasi_permintaan(uuid) from public, anon;
grant execute on function public.konfirmasi_permintaan(uuid) to authenticated;
