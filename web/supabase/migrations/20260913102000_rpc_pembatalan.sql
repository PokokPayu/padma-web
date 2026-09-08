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
