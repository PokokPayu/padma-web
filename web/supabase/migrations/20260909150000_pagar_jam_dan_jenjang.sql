-- ============================================================================
-- TIGA LUBANG YANG DITEMUKAN REVIEW MENYELURUH C1-a
-- ============================================================================
-- Ketiganya punya bentuk yang sama: pagar yang DIKLAIM ada di lapisan basis
-- data, tetapi sebenarnya hanya hidup di server action — sementara klien dan
-- staf sama-sama bisa memanggil PostgREST langsung dengan JWT-nya sendiri.

-- ---------------------------------------------------------------------------
-- (1) JAM WAJIB ANGGOTA `app_settings.jam_layanan`, DITEGAKKAN DI SINI
--
-- `booking_requests_jam_bulat` hanya menuntut menit :00/:30. Keanggotaan pada
-- daftar jam layanan diperiksa `ajukanJadwal`, dan itu SATU-SATUNYA tempatnya —
-- padahal klien memegang policy INSERT dan bisa menyisipkan `jam_mulai` pukul
-- 03:00 lewat satu panggilan PostgREST. Permintaan itu lalu masuk antrean admin
-- sebagai janji pukul tiga pagi, dan sejak J8 admin bahkan tidak punya tombol
-- untuk menolaknya.
--
-- Daftarnya dibaca dari `app_settings`, bukan ditulis ulang di sini: dua daftar
-- jam yang harus identik adalah persis kesalahan yang C1 habiskan seluruh
-- modul `lib/jadwal/status.ts` untuk mencegahnya.
--
-- Supaya pagar ini tidak lahir DIAM, baris setelannya ditanam di bawah dengan
-- daftar yang sama persis dengan `JAM_LAYANAN_BAWAAN`. Tanpa itu, keadaan
-- BAWAAN sistem — termasuk di produksi hari ini — adalah pagar yang tidak
-- menjaga apa pun, dan satu-satunya yang berlaku kembali menjadi server action.
-- `JAM_LAYANAN_BAWAAN` di TypeScript tetap ada sebagai jaring pengaman untuk
-- keadaan yang tersisa: barisnya sengaja dikosongkan admin.
--
-- Bila barisnya kosong, pagar ini DIAM — menolak semua jam ketika setelannya
-- kosong akan mematikan pemesanan sama sekali.
-- Pembaca setelan jam yang menembus RLS, dan HANYA itu.
--
-- Ruang lingkupnya sesempit mungkin: satu kunci, satu nilai, tanpa argumen —
-- sehingga tidak ada cara memakainya untuk membaca setelan lain. `stable`,
-- bukan `immutable`: nilainya memang bisa berubah di antara transaksi.
create or replace function public.jam_layanan_terpakai()
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select value from public.app_settings where key = 'jam_layanan';
$$;

revoke execute on function public.jam_layanan_terpakai() from public, anon;
-- `authenticated` WAJIB bisa menjalankannya: `guard_booking_pembatas` adalah
-- `security invoker`, jadi pemanggilnya adalah KLIEN yang sedang menyisipkan
-- barisnya sendiri. Tanpa grant ini pagar menyala untuk SEMUA jam, termasuk yang
-- sah — dan pemesanan mati total. `anon` tetap dicabut: ia tidak pernah menulis
-- permintaan jadwal, dan anon key tertanam di bundel peramban.

create or replace function public.guard_booking_pembatas()
returns trigger
language plpgsql
as $$
declare
  batas constant int := 5;  -- sinkron dengan BATAS_PERMINTAAN_MENUNGGU
  antre int;
  daftar_jam text;
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if user_role() = 'klien' then

      -- (a) Layanan harus AKTIF. FK hanya menjamin baris itu ada.
      if not exists (
        select 1 from public.services s
         where s.id = new.service_id and s.aktif
      ) then
        raise exception 'layanan tidak tersedia untuk permintaan jadwal'
          using errcode = '42501';
      end if;

      -- (b) Tanggal tidak boleh di masa lalu, menurut kalender ASIA/JAKARTA —
      --     bukan jam server. Server berjalan UTC, dan antara 17:00–24:00 UTC
      --     tanggal Jakarta sudah besok.
      if new.tanggal < (now() at time zone 'Asia/Jakarta')::date then
        raise exception 'tanggal permintaan jadwal tidak boleh di masa lalu'
          using errcode = '42501';
      end if;

      -- (c) Jam harus salah satu yang ditawarkan klinik.
      --
      -- Dibaca lewat `jam_layanan_terpakai()` yang `security definer`, BUKAN
      -- langsung dari `app_settings`. Sebabnya: fungsi ini `security invoker`
      -- (disengaja — lihat migration 20260829140000), sehingga query di dalamnya
      -- berjalan di bawah RLS milik KLIEN, dan klien memang tidak punya hak baca
      -- atas `app_settings` (migration `cabut_grant_anon_berlebih`). Membacanya
      -- langsung memulangkan NOL BARIS, `daftar_jam` jatuh ke NULL, dan pagar
      -- ini diam untuk setiap jam yang dikirim klien — persis kegagalan senyap
      -- yang sedang ia coba cegah. Diketahui karena ujinya merah, bukan karena
      -- terbaca dari kode.
      daftar_jam := public.jam_layanan_terpakai();

      if daftar_jam is not null and btrim(daftar_jam) <> '' then
        if not exists (
          select 1
            from unnest(string_to_array(daftar_jam, ',')) as j(teks)
           where btrim(j.teks) = to_char(new.jam_mulai, 'HH24:MI')
        ) then
          raise exception 'jam mulai tidak termasuk jam layanan klinik'
            using errcode = '42501';
        end if;
      end if;

      -- (d) Batas panjang antrean, dengan kunci advisory per-klien lebih dulu.
      perform pg_advisory_xact_lock(
        hashtext('booking_requests:antrean'),
        hashtext(new.client_id::text)
      );

      select count(*) into antre
        from public.booking_requests b
       where b.client_id = new.client_id
         and b.status in ('diminta', 'mencari_mitra', 'mitra_siap');

      if antre >= batas then
        raise exception
          'permintaan jadwal yang masih menunggu sudah mencapai batas (%)', batas
          using errcode = '42501';
      end if;

    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_booking_pembatas() from public, anon;

-- ---------------------------------------------------------------------------
-- (2) `jenjang` DIHITUNG DI SINI, TIDAK LAGI DIOPER PEMANGGIL
--
-- Versi pertama `konfirmasi_permintaan()` membuang `jenjang_sumber` dari daftar
-- argumen dan menuliskannya sendiri sebagai 'otomatis' — lalu tetap menerima
-- `jenjang` dari pemanggil. Itu menutup separuh lubang dan MENGKLAIM menutup
-- seluruhnya: admin yang memanggil RPC langsung masih bisa menyodorkan jenjang
-- apa pun dan mendapatkannya tercatat sebagai hasil hitungan otomatis. Uji yang
-- menjaganya hanya memeriksa nama argumen, jadi ia hijau untuk lubang yang
-- masih terbuka.
--
-- Argumennya karena itu dihapus seluruhnya. Konsekuensinya rumus jarak kini
-- hidup di DUA bahasa — persis duplikasi yang ditolak Ruling 20 untuk
-- `LABEL_JENJANG` — dan itu diterima SADAR, dengan satu syarat yang tidak boleh
-- dilepas: `tests/jarak-sql-vs-ts.test.ts` membandingkan keduanya atas puluhan
-- pasang koordinat dan merah begitu jawabannya berselisih. Duplikasi yang
-- dijaga uji berbeda dari duplikasi yang dibiarkan; yang tidak bisa dijaga
-- adalah nilai yang datang dari pemanggil.
create or replace function public.jarak_km(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
) returns double precision
language sql
immutable
as $$
  -- Haversine. Jari-jari rata-rata Bumi IUGG, angka yang sama persis dengan
  -- `JARI_JARI_BUMI_KM` di src/lib/transport/jarak.ts.
  select 2 * 6371.0088 * asin(least(1, sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ^ 2
  )));
$$;

revoke execute on function public.jarak_km(double precision, double precision, double precision, double precision)
  from public, anon;

-- Batasnya ditulis PERSIS seperti `jenjangDariJarak()`: "0–5 km" lalu ">5–10
-- km", sehingga 5,0 km masih jenjang pertama dan 5,01 km sudah naik.
create or replace function public.jenjang_dari_jarak(km double precision)
returns jenjang_transport
language sql
immutable
as $$
  select case
    when km is null then null
    when km <= 5  then '0_5'::jenjang_transport
    when km <= 10 then '5_10'::jenjang_transport
    when km <= 15 then '10_15'::jenjang_transport
    when km <= 20 then '15_20'::jenjang_transport
    else 'di_atas_20'::jenjang_transport
  end;
$$;

revoke execute on function public.jenjang_dari_jarak(double precision) from public, anon;

-- Tanda tangan berubah (argumen kedua hilang), jadi versi lama WAJIB dibuang
-- lebih dulu — `create or replace` tidak bisa mengubah daftar argumen.
drop function if exists public.konfirmasi_permintaan(uuid, jenjang_transport);

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
  -- Penjaga peran DI DALAM fungsi: `security definer` mematikan RLS, jadi tanpa
  -- baris ini setiap klien yang login bisa mengonfirmasi permintaannya sendiri
  -- lewat RPC.
  if user_role() not in ('admin', 'owner') then
    raise exception 'hanya staf yang boleh mengonfirmasi permintaan jadwal'
      using errcode = '42501';
  end if;

  update public.booking_requests
     set status = 'dikonfirmasi'
   where id = permintaan_id
     and status = 'mitra_siap'
  returning * into p;

  if not found then
    return null;
  end if;

  if p.partner_id is null then
    raise exception 'permintaan mitra_siap tanpa mitra: %', permintaan_id;
  end if;

  select * into m from public.partners where id = p.partner_id;

  -- Koordinat yang tidak lengkap BUKAN galat: alamat Malang sering gagal
  -- digeocode (26 dari 32; spec pemilih-lokasi §1), dan domisili mitra boleh
  -- belum diisi. Jenjangnya tetap NULL, dan admin menetapkannya belakangan
  -- lewat `tetapkanJenjang` — jalur yang memang menuntut alasan.
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
    status, booking_request_id
  ) values (
    p.client_id, p.service_id, p.variant_id, p.partner_id,
    p.tanggal, p.jam_mulai,
    -- Alamat & koordinat DISALIN dari baris permintaan (spec T6).
    p.alamat, p.alamat_lat, p.alamat_lon,
    jenjang_hitung,
    case when jenjang_hitung is null then null else 'otomatis'::sumber_jenjang end,
    '',
    'terjadwal', p.id
  )
  returning id into sesi_id;

  return sesi_id;
end;
$$;

revoke execute on function public.konfirmasi_permintaan(uuid) from public, anon;
grant execute on function public.konfirmasi_permintaan(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (3) STAF TIDAK BOLEH MENULIS `dibatalkan_klien`
--
-- Policy "booking: staf" adalah `for all`, jadi admin bisa menulis status apa
-- pun yang lolos penjaga perpindahan — termasuk `dibatalkan_klien` atas
-- pengajuan yang kliennya tidak pernah membatalkan. Nilai itu adalah CATATAN
-- TENTANG SIAPA, dan catatan yang bisa ditulis pihak lain adalah catatan yang
-- berbohong. Tidak ada jejak aktor pada tabel ini yang bisa meluruskannya.
--
-- Ini penjaga OTORISASI (siapa boleh menulis apa), jadi ia memang bergerbang
-- peran — berbeda dari `guard_booking_perpindahan` yang menjaga integritas dan
-- sengaja berlaku untuk semua peran.
--
-- Pembatalan oleh PADMA punya tempatnya sendiri: `sessions.dibatalkan_padma`,
-- dan seluruh perkaranya milik C3.
create or replace function public.guard_booking_status()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if user_role() = 'klien' then
      if tg_op = 'INSERT' and new.status is distinct from 'diminta'::booking_status then
        raise exception 'permintaan jadwal baru selalu berstatus diminta'
          using errcode = '42501';
      end if;
      if tg_op = 'UPDATE' and new.status is distinct from old.status then
        if new.status is distinct from 'dibatalkan_klien'::booking_status then
          raise exception 'status permintaan jadwal hanya boleh diubah staf'
            using errcode = '42501';
        end if;
      end if;
    end if;

    if user_role() in ('admin', 'owner') then
      if tg_op = 'UPDATE' and new.status is distinct from old.status then
        if new.status = 'dibatalkan_klien'::booking_status then
          raise exception 'hanya klien yang bisa membatalkan pengajuannya sendiri'
            using errcode = '42501';
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_booking_status() from public, anon;

-- ---------------------------------------------------------------------------
-- (4) NILAI BAWAAN `jam_layanan`
--
-- Registri melahirkan KUNCInya (migration `registri_jam_layanan`); ini yang
-- melahirkan NILAInya. Daftarnya identik dengan `JAM_LAYANAN_BAWAAN` di
-- src/lib/jadwal/jam.ts, dan dijaga tetap identik oleh
-- tests/pengaturan-jam-layanan.test.ts.
--
-- `on conflict do nothing`: klinik yang sudah menetapkan jamnya sendiri tidak
-- boleh dikembalikan ke bawaan oleh sebuah migrasi.
insert into public.app_settings (key, value)
values ('jam_layanan', '08:00, 09:00, 10:00, 11:00, 13:00, 14:00, 15:00, 16:00')
on conflict (key) do nothing;
