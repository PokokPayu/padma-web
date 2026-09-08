-- ============================================================================
-- C3-a: PEMBATALAN, JADWAL ULANG, PENUKARAN HAK
-- ============================================================================
-- Ketiganya `security definer`, dan itu keputusan dengan dua alasan (spec C3 P5):
--
--  1. ATOMISITAS. Membatalkan di jenjang 2 adalah dua tulisan yang harus
--     berlaku sebagai satu keputusan: sesi menjadi batal, DAN haknya terbit.
--     Kegagalan di antaranya meninggalkan klien tanpa sesi dan tanpa gantinya.
--
--  2. PERMUKAAN TULIS. Policy UPDATE untuk klien atas `sessions` akan membuka
--     seluruh kolom baris itu — termasuk `status_bayar`, `partner_id`, dan
--     `jenjang`. Fungsi definer membuka TEPAT satu tindakan. Kepemilikan
--     diperiksa DI DALAM fungsi terhadap `auth.uid()`, tidak pernah
--     dipercayakan kepada pemanggil.

-- ---------------------------------------------------------------------------
-- `perpindahan_sesi_sah` DIBUKA UNTUK `dibatalkan_klien`
-- ---------------------------------------------------------------------------
-- Peta perpindahan (migration 20260909101000) ditulis SEBELUM nilai enum
-- `dibatalkan_klien` ada (migration 20260913100000), dan tidak seorang pun
-- kembali membukanya: 'terjadwal' hanya mengizinkan 'berjalan', 'selesai',
-- 'tidak_hadir', 'dibatalkan_padma'. Tanpa baris ini, `guard_sesi_perpindahan`
-- menolak SETIAP pembatalan oleh klien — bukan dengan pesan yang jelas,
-- melainkan sebagai galat yang tenggelam di balik RPC dan terlihat seperti
-- "sesi tidak ditemukan".
create or replace function public.perpindahan_sesi_sah(
  dari session_status,
  ke session_status
) returns boolean
language sql
immutable
as $$
  select case dari
    when 'terjadwal'        then ke in ('berjalan', 'selesai', 'tidak_hadir', 'dibatalkan_padma', 'dibatalkan_klien')
    when 'berjalan'         then ke in ('selesai', 'tidak_hadir')
    when 'selesai'          then false
    when 'tidak_hadir'      then false
    when 'dibatalkan_padma' then false
    when 'dibatalkan_klien' then false
  end;
$$;

revoke execute on function public.perpindahan_sesi_sah(session_status, session_status)
  from public, anon;

-- ---------------------------------------------------------------------------
-- Ambang jenjang, dalam SATU tempat di sisi SQL.
-- ---------------------------------------------------------------------------
-- Rumusnya kembar dengan `jenjangPembatalan()` di TypeScript, dan kembaran itu
-- disengaja & terbatas: TypeScript memakainya untuk MENAMPILKAN akibat sebelum
-- admin menekan, SQL memakainya untuk MEMUTUSKAN. Yang memutuskan tidak boleh
-- ada di lapisan yang bisa dilewati satu panggilan RPC. Pasangan yang sama
-- sudah ada untuk jarak (`jarak_km` vs `haversineKm`), dan dijaga uji
-- `tests/jarak-sql-vs-ts.test.ts`.
create or replace function public.jenjang_pembatalan(tanggal date, jam time)
returns smallint
language sql
-- `stable`, BUKAN `immutable`. Badannya membaca `now()`, dan Postgres
-- mempercayai label ini tanpa memeriksa isinya: fungsi `immutable` boleh
-- dilipat menjadi konstanta oleh perencana, dipakai di indeks fungsional, atau
-- dibekukan dalam rencana yang di-cache. Jenjang yang membeku adalah jenjang
-- yang berhenti mengikuti waktu — dan yang berhenti bersamanya adalah uang
-- klien.
stable
set search_path = public, pg_temp
as $$
  select case
    -- `at time zone 'Asia/Jakarta'` mengubah timestamp tanpa zona menjadi
    -- timestamptz yang benar. Menghitungnya dengan zona server (UTC di Vercel)
    -- menggeser batasnya tujuh jam, dan yang bergeser bersamanya adalah uang
    -- klien.
    when ((tanggal + jam) at time zone 'Asia/Jakarta') - now() >= interval '24 hours' then 1
    when ((tanggal + jam) at time zone 'Asia/Jakarta') - now() >= interval '2 hours'  then 2
    else 3
  end::smallint;
$$;

revoke execute on function public.jenjang_pembatalan(date, time) from public, anon;
grant execute on function public.jenjang_pembatalan(date, time) to authenticated;

-- ---------------------------------------------------------------------------
-- BATALKAN SESI
-- ---------------------------------------------------------------------------
-- Aturan aktor, dan ini pembedaan yang paling mudah hilang saat kode dirapikan:
--
--   staf + alasan terisi  → JENJANG 4, status `dibatalkan_padma`
--                            (PADMA yang berhalangan; refund penuh)
--   selain itu            → jenjang dari WAKTU, status `dibatalkan_klien`
--
-- Keduanya sama-sama "batal", dan siapa pun yang menyatukannya akan merasa
-- sedang menyederhanakan. Yang hilang bila disatukan: setiap layar dan setiap
-- laporan berhenti bisa menyebut siapa yang membatalkan.
create or replace function public.batalkan_sesi(
  sesi_id uuid,
  alasan text,
  darurat boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.sessions%rowtype;
  peran text := public.user_role();
  staf boolean := peran in ('admin', 'owner');
  jenjang smallint;
  akibat text;
  hak uuid;
  status_baru session_status;
begin
  -- Darurat medis adalah pengecualian yang HARUS bisa ditinjau setelahnya, dan
  -- pengecualian tanpa catatan tidak bisa ditinjau siapa pun. Diperiksa lebih
  -- dulu supaya penolakannya tidak menyentuh baris apa pun.
  if darurat then
    if not staf then
      raise exception 'hanya staf yang boleh menerapkan pengecualian darurat'
        using errcode = '42501';
    end if;
    if btrim(coalesce(alasan, '')) = '' then
      raise exception 'pengecualian darurat menuntut alasan tertulis'
        using errcode = '23514';
    end if;
  end if;

  select * into s from public.sessions where id = sesi_id;
  if not found then
    return null;
  end if;

  -- Kepemilikan diperiksa DI SINI, bukan dipercayakan kepada pemanggil.
  --
  -- Menjodohkannya lewat `clients.user_id`, BUKAN `s.client_id = auth.uid()`:
  -- `clients.id` adalah id baris klien dan TIDAK PERNAH sama dengan id
  -- pengguna auth. Perbandingan langsung tidak menolak orang lain — ia menolak
  -- SEMUA ORANG, termasuk pemiliknya sendiri, dan bentuk kegagalannya adalah
  -- klien yang tidak bisa menyentuh sesinya sendiri. Pola ini disalin dari
  -- policy "sessions: milik sendiri" (migrasi 20260828095030).
  if not staf and not exists (
    select 1 from public.clients c
     where c.id = s.client_id and c.user_id = auth.uid()
  ) then
    raise exception 'sesi ini bukan milik Anda' using errcode = '42501';
  end if;

  if staf and btrim(coalesce(alasan, '')) <> '' and not darurat then
    jenjang := 4;
    status_baru := 'dibatalkan_padma';
  else
    jenjang := case when darurat then 1 else public.jenjang_pembatalan(s.tanggal, s.jam_mulai) end;
    status_baru := 'dibatalkan_klien';
  end if;

  akibat := case jenjang when 2 then 'hak' when 3 then 'hangus' else 'refund' end;

  -- Hanya sesi yang MASIH terjadwal bisa dibatalkan. Klausa `and status` inilah
  -- yang membuat pemanggilan kedua tidak mengenai baris apa pun — sehingga
  -- menekan tombol dua kali tidak pernah menerbitkan dua hak.
  update public.sessions
     set status = status_baru
   where id = sesi_id
     and status = 'terjadwal'
  returning * into s;

  if not found then
    return null;
  end if;

  if akibat = 'hak' then
    insert into public.hak_sesi (client_id, service_id, kedaluwarsa, sesi_asal_id)
    values (
      s.client_id,
      s.service_id,
      -- 30 hari sejak TANGGAL SESI, bukan sejak hari ini (spec C3 P3).
      s.tanggal + 30,
      s.id
    )
    returning id into hak;
  end if;

  insert into public.jejak_jadwal (
    sesi_id, tindakan, jenjang, dari_tanggal, dari_jam,
    alasan, darurat, aktor_id, peran_aktor
  ) values (
    s.id, 'batal', jenjang, s.tanggal, s.jam_mulai,
    coalesce(alasan, ''), darurat, auth.uid(), peran
  );

  return jsonb_build_object('jenjang', jenjang, 'akibat', akibat, 'hak_id', hak);
end;
$$;

revoke execute on function public.batalkan_sesi(uuid, text, boolean) from public, anon;
grant execute on function public.batalkan_sesi(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- JADWAL ULANG
-- ---------------------------------------------------------------------------
-- MENGUBAH BARIS YANG SAMA, tidak pernah membuat baris baru (spec C3 P4).
-- Baris baru lahir dengan `jadwal_ulang_terpakai = false`, sehingga jatah
-- "1× per pemesanan" bisa di-reset tanpa batas hanya dengan menjadwal ulang
-- berulang — aturannya jadi bohong tanpa satu pun galat.
--
-- Bidannya DIPERTAHANKAN (spec C3 P8): hubungan klien–bidan sudah terbentuk,
-- dan mengganti orang yang akan masuk ke rumah seseorang bukan akibat wajar
-- dari memindahkan jam.
--
-- PAGARNYA TIDAK DIWARISI. `guard_booking_pembatas` adalah trigger
-- `before insert on booking_requests`; ia tidak pernah melihat `sessions`.
-- Jam layanan dibaca lewat `jam_layanan_terpakai()` — fungsi `security definer`
-- yang sudah ada — supaya jam buka klinik tetap punya SATU sumber. Membacanya
-- langsung dari `app_settings` di sini akan mengulang jebakan C1-a: pembacaan
-- dengan hak pemanggil memulangkan nol baris karena policy, dan pagarnya DIAM
-- alih-alih menolak.
create or replace function public.jadwal_ulang_sesi(
  sesi_id uuid,
  tanggal_baru date,
  jam_baru time
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.sessions%rowtype;
  peran text := public.user_role();
  staf boolean := peran in ('admin', 'owner');
  jenjang smallint;
  pakai_jatah boolean := false;
  daftar_jam text;
begin
  select * into s from public.sessions where id = sesi_id;
  if not found then
    return null;
  end if;

  -- Dijodohkan lewat `clients.user_id`: `clients.id` bukan id auth (lihat
  -- komentar panjang di `batalkan_sesi`).
  if not staf and not exists (
    select 1 from public.clients c
     where c.id = s.client_id and c.user_id = auth.uid()
  ) then
    raise exception 'sesi ini bukan milik Anda' using errcode = '42501';
  end if;

  jenjang := public.jenjang_pembatalan(s.tanggal, s.jam_mulai);

  -- Jenjang 3 tidak mengenal jadwal ulang: poster menyebutnya pemesanan baru.
  if jenjang = 3 then
    raise exception 'kurang dari 2 jam sebelum sesi — jadwal ulang dihitung sebagai pemesanan baru'
      using errcode = '23514';
  end if;

  if jenjang = 2 then
    if s.jadwal_ulang_terpakai then
      raise exception 'jatah jadwal ulang gratis untuk pemesanan ini sudah terpakai'
        using errcode = '23514';
    end if;
    pakai_jatah := true;
  end if;

  -- Jam wajib anggota daftar jam layanan. Dibaca lewat fungsi definer yang
  -- sudah ada; daftar kosong berarti pemesanan memang sedang dimatikan.
  -- `daftar_jam` disimpan dengan spasi sesudah koma ("08:00, 09:00, ..."),
  -- jadi pencocokannya wajib `btrim` tiap unsur — persis pola yang sudah
  -- dipakai `guard_booking_pembatas` untuk daftar yang sama. Tanpa `btrim`,
  -- `<> all (string_to_array(...))` menolak SETIAP jam kecuali yang pertama.
  daftar_jam := public.jam_layanan_terpakai();
  if daftar_jam is null or not exists (
    select 1 from unnest(string_to_array(daftar_jam, ',')) as j(teks)
     where btrim(j.teks) = to_char(jam_baru, 'HH24:MI')
  ) then
    raise exception 'jam % di luar jam layanan klinik', to_char(jam_baru, 'HH24:MI')
      using errcode = '22023';
  end if;

  -- Waktu baru harus di masa depan, dan tidak boleh lebih dekat dari ambang
  -- berangkat: memindahkan sesi ke 30 menit lagi bukan jadwal ulang melainkan
  -- cara memaksa bidan berangkat tanpa pemberitahuan.
  if ((tanggal_baru + jam_baru) at time zone 'Asia/Jakarta') - now() < interval '2 hours' then
    raise exception 'waktu baru terlalu dekat — pilih minimal 2 jam dari sekarang'
      using errcode = '23514';
  end if;

  -- Bidan yang sama tidak bisa berada di dua tempat. Sesi yang sedang dipindah
  -- dikecualikan supaya memindahkannya ke jamnya sendiri tidak menabrak diri
  -- sendiri.
  if exists (
    select 1 from public.sessions x
     where x.partner_id = s.partner_id
       and x.tanggal = tanggal_baru
       and x.jam_mulai = jam_baru
       and x.status = 'terjadwal'
       and x.id <> s.id
  ) then
    raise exception 'bidan sudah punya jadwal pada waktu itu — pilih waktu lain'
      using errcode = '23505';
  end if;

  update public.sessions
     set tanggal = tanggal_baru,
         jam_mulai = jam_baru,
         jadwal_ulang_terpakai = s.jadwal_ulang_terpakai or pakai_jatah
   where id = sesi_id
     and status = 'terjadwal';

  if not found then
    return null;
  end if;

  insert into public.jejak_jadwal (
    sesi_id, tindakan, jenjang, dari_tanggal, dari_jam, ke_tanggal, ke_jam,
    aktor_id, peran_aktor
  ) values (
    s.id, 'jadwal_ulang', jenjang, s.tanggal, s.jam_mulai, tanggal_baru, jam_baru,
    auth.uid(), peran
  );

  return jsonb_build_object('jenjang', jenjang, 'jatah_terpakai', pakai_jatah);
end;
$$;

revoke execute on function public.jadwal_ulang_sesi(uuid, date, time) from public, anon;
grant execute on function public.jadwal_ulang_sesi(uuid, date, time) to authenticated;
