


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."app_role" AS ENUM (
    'klien',
    'admin',
    'owner'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."booking_status" AS ENUM (
    'diminta',
    'mencari_mitra',
    'mitra_siap',
    'menunggu_bayar',
    'dikonfirmasi',
    'ditolak',
    'dibatalkan_klien',
    'dibatalkan_tenggat'
);


ALTER TYPE "public"."booking_status" OWNER TO "postgres";


COMMENT ON TYPE "public"."booking_status" IS 'Rantai status permintaan C1. ''ditolak'' DIPERTAHANKAN nilainya untuk permintaan lama, tetapi tidak lagi terjangkau dari layar mana pun (spec J8): admin tidak menolak, klien yang membatalkan. Menghapus nilainya berarti kehilangan riwayat. ''menunggu_bayar'' sengaja BELUM ada — ia milik C2, disisipkan antara ''mitra_siap'' dan ''dikonfirmasi''.';



CREATE TYPE "public"."jenjang_transport" AS ENUM (
    '0_5',
    '5_10',
    '10_15',
    '15_20',
    'di_atas_20'
);


ALTER TYPE "public"."jenjang_transport" OWNER TO "postgres";


CREATE TYPE "public"."material_type" AS ENUM (
    'ebook',
    'video'
);


ALTER TYPE "public"."material_type" OWNER TO "postgres";


CREATE TYPE "public"."package_status" AS ENUM (
    'aktif',
    'selesai',
    'berhenti'
);


ALTER TYPE "public"."package_status" OWNER TO "postgres";


CREATE TYPE "public"."pay_status" AS ENUM (
    'belum',
    'menunggu_verifikasi',
    'lunas'
);


ALTER TYPE "public"."pay_status" OWNER TO "postgres";


CREATE TYPE "public"."screening_followup" AS ENUM (
    'baru',
    'dihubungi',
    'jadi_klien',
    'ditolak'
);


ALTER TYPE "public"."screening_followup" OWNER TO "postgres";


CREATE TYPE "public"."screening_result" AS ENUM (
    'hijau',
    'merah'
);


ALTER TYPE "public"."screening_result" OWNER TO "postgres";


CREATE TYPE "public"."session_status" AS ENUM (
    'terjadwal',
    'berjalan',
    'selesai',
    'tidak_hadir',
    'dibatalkan_padma',
    'dibatalkan_klien'
);


ALTER TYPE "public"."session_status" OWNER TO "postgres";


CREATE TYPE "public"."sumber_jenjang" AS ENUM (
    'otomatis',
    'admin'
);


ALTER TYPE "public"."sumber_jenjang" OWNER TO "postgres";


CREATE TYPE "public"."varian_format" AS ENUM (
    'private',
    'circle'
);


ALTER TYPE "public"."varian_format" OWNER TO "postgres";


CREATE TYPE "public"."waktu_pref" AS ENUM (
    'pagi',
    'siang',
    'sore'
);


ALTER TYPE "public"."waktu_pref" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."batalkan_lewat_tenggat"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  jumlah integer;
begin
  with batal as (
    update public.booking_requests
       set status = 'dibatalkan_tenggat',
           -- SKRINING DIKEMBALIKAN — lihat dokblok kepala berkas ini.
           screening_id = null
     where status = 'menunggu_bayar'
       and tenggat is not null
       and tenggat <= now()
       and status_bayar <> 'lunas'
    returning id
  )
  select count(*) into jumlah from batal;

  return jumlah;
end;
$$;


ALTER FUNCTION "public"."batalkan_lewat_tenggat"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."batalkan_lewat_tenggat"() IS 'Membatalkan pengajuan yang lewat tenggat bayar dan MENGEMBALIKAN skriningnya. Idempoten. Pengajuan yang sudah lunas TIDAK PERNAH ikut dibatalkan — yang hilang di situ bukan slot melainkan uang orang. Dipanggil rute cron; lapis keduanya adalah evaluasi saat dibaca di layar admin & Passport, karena cron yang mati membuat tenggat berhenti berlaku tanpa satu pun galat.';



CREATE OR REPLACE FUNCTION "public"."batalkan_sesi"("sesi_id" "uuid", "alasan" "text", "darurat" boolean, "oleh" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  s public.sessions%rowtype;
  peran text := public.user_role();
  staf boolean := peran in ('admin', 'owner');
  jenjang smallint;
  akibat text;
  hak uuid;
  status_baru session_status;
begin
  if oleh is null or oleh not in ('klien', 'padma') then
    raise exception 'aktor pembatalan wajib disebut: klien atau padma'
      using errcode = '22023';
  end if;

  -- Diperiksa lebih dulu supaya penolakan tidak pernah menyentuh baris apa pun.
  if oleh = 'padma' then
    if not staf then
      raise exception 'hanya staf yang boleh membatalkan atas nama PADMA'
        using errcode = '42501';
    end if;
    if btrim(coalesce(alasan, '')) = '' then
      raise exception 'pembatalan oleh PADMA menuntut alasan tertulis'
        using errcode = '23514';
    end if;
    -- Darurat medis adalah pengecualian atas pembatalan KLIEN. Digabung dengan
    -- `oleh = 'padma'` ia tidak punya arti — jenjang 4 sudah refund penuh —
    -- dan menerimanya diam-diam berarti admin mengira ia menerapkan sesuatu
    -- yang sebenarnya diabaikan. Ditolak supaya pilihannya diperbaiki.
    if darurat then
      raise exception 'pengecualian darurat berlaku untuk pembatalan klien; PADMA yang membatalkan sudah jenjang 4'
        using errcode = '22023';
    end if;
  end if;

  -- Pengecualian tanpa catatan tidak bisa ditinjau siapa pun setelahnya.
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

  if oleh = 'padma' then
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

  -- `status` IKUT DIPULANGKAN. Layar memanggil fungsi ini lalu menampilkan
  -- kembali apa yang BASIS DATA putuskan — bukan tebakan yang dihitung layar
  -- sebelum tombol ditekan. Bila keduanya berselisih, yang terbaca admin
  -- sesudah menekan adalah yang benar-benar tertulis.
  return jsonb_build_object(
    'jenjang', jenjang,
    'akibat', akibat,
    'hak_id', hak,
    'status', status_baru,
    'oleh', oleh
  );
end;
$$;


ALTER FUNCTION "public"."batalkan_sesi"("sesi_id" "uuid", "alasan" "text", "darurat" boolean, "oleh" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."berhak_isi_materi"("p_material_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.materials m
     where m.id = p_material_id
       and m.aktif = true
       and (
         exists (
           select 1
             from public.material_services ms
             join public.sessions s
               on s.service_id = ms.service_id and s.status = 'selesai'
             join public.clients c on c.id = s.client_id
            where ms.material_id = m.id and c.user_id = auth.uid()
         )
         or exists (
           select 1
             from public.material_assignments ma
             join public.clients c on c.id = ma.client_id
            where ma.material_id = m.id and c.user_id = auth.uid()
         )
       )
  )
$$;


ALTER FUNCTION "public"."berhak_isi_materi"("p_material_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."catat_status_bayar"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  lama pay_status;
begin
  if tg_op = 'INSERT' then
    -- Kelahiran berstatus 'belum' bukan keputusan uang; trigger INSERT-nya
    -- sudah menyaring lewat klausa WHEN, ini pagar keduanya.
    if new.status_bayar is not distinct from 'belum'::pay_status then
      return null;
    end if;
    lama := null;
  else
    -- Trigger `after update of <kolom>` menyala saat kolomnya DISEBUT di SET,
    -- BUKAN saat nilainya berubah. Tanpa penjaga ini, upsert idempoten
    -- scripts/seed-users.ts — dijalankan tests/global-setup.ts setiap
    -- `npm test` — menumpuk satu baris jejak palsu per sesi per run.
    if new.status_bayar is not distinct from old.status_bayar then
      return null;
    end if;
    lama := old.status_bayar;
  end if;

  insert into public.jejak_status_bayar (
    sesi_id, paket_klien_id, status_lama, status_baru, aktor_id, peran_aktor
  ) values (
    case when tg_table_name = 'sessions' then new.id end,
    case when tg_table_name = 'client_packages' then new.id end,
    lama,
    new.status_bayar,
    auth.uid(),
    case when auth.uid() is null then 'service_role' else user_role()::text end
  );

  -- AFTER trigger: nilai kembalian diabaikan.
  return null;
end;
$$;


ALTER FUNCTION "public"."catat_status_bayar"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ganti_halaman_materi"("p_material_id" "uuid", "p_halaman" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  n int;
begin
  if p_material_id is null then
    raise exception 'p_material_id wajib diisi';
  end if;

  -- `security definer` MENEMBUS RLS, jadi otorisasi wajib diperiksa di sini —
  -- tidak ada policy yang akan menolak apa pun di dalam fungsi ini.
  --
  -- Diperiksa HANYA bila ada sesi pengguna sungguhan (`auth.uid()` terisi).
  -- Tanpa syarat itu, service role ikut tertolak: `user_role()` adalah
  -- `coalesce((select role from profiles where id = auth.uid()), 'klien')`
  -- (migration rls_policies), dan service role tidak punya baris profil sama
  -- sekali — auth.uid()-nya NULL — sehingga ia jatuh ke default 'klien' dan
  -- akan tertolak PERSIS seperti klien sungguhan. Itu memutus arsitektur
  -- brief sendiri (bucket tanpa policy storage.objects, "hanya service role
  -- dari route handler kita"), dan mematahkan kedua tes brief yang memanggil
  -- RPC ini lewat `svc()` — DIBUKTIKAN LANGSUNG saat menulis fix ini: tanpa
  -- syarat `auth.uid() is not null`, panggilan service role gagal dengan
  -- `{"code":"P0001","message":"hanya admin/owner boleh mengganti halaman
  -- materi"}`. Pola "auth.uid() is null -> perlakukan sebagai service_role"
  -- BUKAN karangan baru — sudah dipakai identik di `catat_status_bayar()`
  -- (migration tutup_celah_red_team) untuk kebutuhan yang sama.
  if auth.uid() is not null and public.user_role() not in ('admin','owner') then
    raise exception 'hanya admin/owner boleh mengganti halaman materi';
  end if;

  delete from public.material_pages where material_id = p_material_id;

  insert into public.material_pages (material_id, halaman, objek, lebar, tinggi)
  select p_material_id,
         (x->>'halaman')::int,
         x->>'objek',
         (x->>'lebar')::int,
         (x->>'tinggi')::int
    from jsonb_array_elements(p_halaman) as x;

  get diagnostics n = row_count;
  return n;
end $$;


ALTER FUNCTION "public"."ganti_halaman_materi"("p_material_id" "uuid", "p_halaman" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_booking_klien_batal"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if user_role() = 'klien' then

      if new.status is distinct from 'dibatalkan_klien'::booking_status then
        raise exception 'klien hanya boleh membatalkan pengajuannya'
          using errcode = '42501';
      end if;

      if old.status not in ('diminta', 'mencari_mitra', 'mitra_siap', 'menunggu_bayar') then
        raise exception 'pengajuan yang sudah dikonfirmasi tidak bisa dibatalkan dari sini'
          using errcode = '42501';
      end if;

      -- Seluruh medan lain WAJIB sama persis. `is distinct from` (bukan `<>`)
      -- supaya NULL dibandingkan benar.
      --
      -- `screening_id` TETAP dikunci: pembatalan oleh klien tidak
      -- mengembalikan skrining (spec C1 J3), dan membiarkannya bisa diubah
      -- berarti klien bisa melepas skriningnya sendiri lalu memakainya lagi.
      -- Yang melepas skrining hanya `batalkan_lewat_tenggat()`, yang berjalan
      -- sebagai service role dan karena itu tidak melewati penjaga ini.
      if new.id               is distinct from old.id
      or new.client_id        is distinct from old.client_id
      or new.service_id       is distinct from old.service_id
      or new.variant_id       is distinct from old.variant_id
      or new.partner_id       is distinct from old.partner_id
      or new.screening_id     is distinct from old.screening_id
      or new.tanggal          is distinct from old.tanggal
      or new.jam_mulai        is distinct from old.jam_mulai
      or new.preferensi_waktu is distinct from old.preferensi_waktu
      or new.catatan          is distinct from old.catatan
      or new.alamat           is distinct from old.alamat
      or new.alamat_lat       is distinct from old.alamat_lat
      or new.alamat_lon       is distinct from old.alamat_lon
      or new.status_bayar     is distinct from old.status_bayar
      or new.bukti_objek      is distinct from old.bukti_objek
      or new.tenggat          is distinct from old.tenggat
      or new.created_at       is distinct from old.created_at
      then
        raise exception 'klien tidak boleh mengubah isi pengajuan, hanya membatalkannya'
          using errcode = '42501';
      end if;

    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."guard_booking_klien_batal"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_booking_pembatas"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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


ALTER FUNCTION "public"."guard_booking_pembatas"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_booking_perpindahan"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not public.perpindahan_permintaan_sah(old.status, new.status) then
    raise exception 'perpindahan status permintaan tidak sah: % -> %', old.status, new.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."guard_booking_perpindahan"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_booking_skrining"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if user_role() = 'klien' then
      -- Hanya INSERT yang dijaga di sini. Perpindahan status punya penjaganya
      -- sendiri, dan pembatalan justru HARUS boleh melepas skriningnya.
      if tg_op = 'INSERT' then
        if new.screening_id is null then
          raise exception 'pengajuan jadwal wajib berdiri di atas skrining hijau milik Anda'
            using errcode = '42501';
        end if;
        if not exists (
          select 1
            from public.screenings s
           where s.id = new.screening_id
             and s.client_id = new.client_id
             and s.hasil = 'hijau'
        ) then
          raise exception 'pengajuan jadwal wajib berdiri di atas skrining hijau milik Anda'
            using errcode = '42501';
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."guard_booking_skrining"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_booking_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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


ALTER FUNCTION "public"."guard_booking_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_client_link"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    -- INSERT: baris klien baru selalu lahir BELUM tertaut. Admin membuat data
    -- klien, lalu server menerbitkan undangan — bukan admin menunjuk akunnya.
    if tg_op = 'INSERT'
       and (new.user_id is not null or new.linked_at is not null) then
      raise exception
        'penautan akun klien hanya boleh lewat token undangan (service-role)'
        using errcode = '42501';
    end if;
    -- UPDATE: mengikat PERUBAHAN nilai, sehingga payload yang menyertakan
    -- kolom ini dengan nilai lama tetap lolos.
    -- `is distinct from` sengaja dipakai agar NULL ikut terjaga di kedua arah:
    -- mengisi (null -> uid), MELEPAS (uid -> null), maupun MEMINDAHKAN
    -- (uid -> uid lain) semuanya perubahan. Melepas tautan pun bukan wewenang
    -- staf lewat API: yang berhak menerbitkan ulang undangan adalah server.
    if tg_op = 'UPDATE'
       and (new.user_id is distinct from old.user_id
            or new.linked_at is distinct from old.linked_at) then
      raise exception
        'penautan akun klien hanya boleh lewat token undangan (service-role)'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."guard_client_link"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."guard_client_link"() IS 'Menolak perubahan clients.user_id / clients.linked_at dari peran API (anon, authenticated, authenticator) — termasuk admin & owner. Penautan hanya sah lewat service role di server, dan hanya lewat tiga fungsi di src/lib/auth/link-client.ts yang masing-masing menuntut buktinya sendiri: linkClientByInvite (token undangan sekali pakai + email cocok), tautkanKlienLewatEmailTerverifikasi dan terbitkanKlienMandiri (keduanya menuntut email_confirmed_at terisi). Lihat komentar kolom clients.user_id.';



CREATE OR REPLACE FUNCTION "public"."guard_insert_status_bayar"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator')
     and new.status_bayar is distinct from 'belum'::pay_status then
    raise exception 'status pembayaran baru hanya boleh diputuskan lewat pembaruan, bukan saat baris dibuat'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."guard_insert_status_bayar"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_penilaian_sesi"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  s public.sessions%rowtype;
  pemilik uuid;
begin
  select * into s from public.sessions where id = new.session_id;
  if not found then
    raise exception 'sesi tidak ditemukan' using errcode = '42501';
  end if;

  -- Hanya sesi yang SELESAI yang bisa dinilai. Menilai sesi yang belum terjadi
  -- adalah menilai sesuatu yang belum ada; menilai sesi yang dibatalkan adalah
  -- menilai orang yang tidak pernah datang.
  if s.status <> 'selesai' then
    raise exception 'hanya sesi yang sudah selesai yang bisa dinilai'
      using errcode = '42501';
  end if;

  -- Untuk peran API, kepemilikan diperiksa terhadap SESI — bukan terhadap
  -- `client_id` yang dikirim. Payload yang menyebut client_id orang lain
  -- karena itu tidak menolong siapa pun.
  if current_user in ('anon', 'authenticated', 'authenticator') then
    select c.id into pemilik
      from public.clients c
     where c.user_id = auth.uid()
     limit 1;

    if pemilik is null or pemilik <> s.client_id then
      raise exception 'hanya pemilik sesi yang bisa menilainya'
        using errcode = '42501';
    end if;
  end if;

  -- `client_id` dan kedua salinan DITULIS ULANG dari baris sesi. Ini yang
  -- membuat "salinan keadaan saat itu" menjadi fakta, bukan janji.
  new.client_id := s.client_id;
  new.partner_id := s.partner_id;
  new.variant_id := s.variant_id;
  new.updated_at := now();

  return new;
end;
$$;


ALTER FUNCTION "public"."guard_penilaian_sesi"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_profile_role"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if tg_op = 'UPDATE' and new.role is distinct from old.role then
      raise exception 'perubahan peran hanya boleh lewat service-role'
        using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and new.role is distinct from 'klien'::app_role then
      raise exception 'penetapan peran non-klien hanya boleh lewat service-role'
        using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.id is distinct from old.id then
      raise exception 'id profil tidak boleh diubah'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."guard_profile_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_sertifikat"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  s public.sessions%rowtype;
begin
  select * into s from public.sessions where id = new.session_id;
  if not found then
    raise exception 'sesi tidak ditemukan' using errcode = '42501';
  end if;

  -- Sertifikat kunjungan yang belum terjadi adalah pernyataan yang tidak
  -- benar. Digerbang di sini, bukan hanya di layar admin: layar bisa diubah,
  -- pagar ini tidak.
  if s.status <> 'selesai' then
    raise exception 'sertifikat hanya untuk sesi yang sudah selesai'
      using errcode = '42501';
  end if;

  new.client_id := s.client_id;
  new.service_id := s.service_id;

  return new;
end;
$$;


ALTER FUNCTION "public"."guard_sertifikat"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_sesi_perpindahan"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not public.perpindahan_sesi_sah(old.status, new.status) then
    raise exception 'perpindahan status sesi tidak sah: % -> %', old.status, new.status
      using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."guard_sesi_perpindahan"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_tarif_transport_maju"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  terakhir date;
begin
  if current_user not in ('anon', 'authenticated', 'authenticator') then
    return new;
  end if;

  select max(berlaku_sejak) into terakhir
    from public.transport_rates
   where jenjang = new.jenjang
     and (tg_op = 'INSERT' or id <> new.id);

  if terakhir is not null and new.berlaku_sejak <= terakhir then
    raise exception
      'tarif transport baru harus berlaku sesudah % — rekap pekan lama tidak boleh berubah', terakhir
      using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."guard_tarif_transport_maju"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."guard_tarif_transport_maju"() IS 'Menolak transport_rates ber-berlaku_sejak <= tarif terakhir jenjang yang sama, dari peran API — owner sekalipun. Tarif retroaktif menggeser rekap pekan yang honornya SUDAH dibayarkan. Service role dilewatkan: seed & fixture test menyemai tanggal lampau.';



CREATE OR REPLACE FUNCTION "public"."guard_tarif_varian_maju"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  terakhir date;
begin
  if current_user not in ('anon', 'authenticated', 'authenticator') then
    return new;
  end if;

  select max(berlaku_sejak) into terakhir
    from public.variant_rates
   where variant_id = new.variant_id
     and (tg_op = 'INSERT' or id <> new.id);

  if terakhir is not null and new.berlaku_sejak <= terakhir then
    raise exception
      'tarif baru harus berlaku sesudah % — rekap pekan lama tidak boleh berubah', terakhir
      using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."guard_tarif_varian_maju"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."guard_tarif_varian_maju"() IS 'Menolak variant_rates ber-berlaku_sejak <= tarif terakhir varian yang sama, dari peran API (anon, authenticated, authenticator) — owner sekalipun. Tarif retroaktif berefek SAMA PERSIS dengan menimpa baris lama. Service role sengaja dilewatkan: seed & fixture test menyemai tanggal lampau.';



CREATE OR REPLACE FUNCTION "public"."guard_transisi_status_bayar"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.status_bayar is not distinct from old.status_bayar then
    return new;
  end if;

  -- Gerbang peran SQL WAJIB: tanpanya scripts/seed-users.ts dan pembersihan
  -- afterAll di test (keduanya service role) akan mati, dan seluruh suite ikut
  -- mati. Yang dijaga adalah peran API — jalur manusia lewat PostgREST.
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if old.status_bayar = 'lunas' then
      raise exception 'pembayaran yang sudah lunas tidak dapat diputar mundur'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."guard_transisi_status_bayar"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, nama)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."jadwal_ulang_sesi"("sesi_id" "uuid", "tanggal_baru" "date", "jam_baru" time without time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  s public.sessions%rowtype;
  peran text := public.user_role();
  staf boolean := peran in ('admin', 'owner');
  jenjang smallint;
  pakai_jatah boolean := false;
  daftar_jam text;
begin
  -- `for update`: lihat komentar panjang di atas fungsi ini soal balapan
  -- jenjang 2. Kunci dipegang sampai transaksi ini selesai, jadi panggilan
  -- bersamaan atas sesi yang sama menunggu di sini.
  select * into s from public.sessions where id = sesi_id for update;
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
    -- `s.jadwal_ulang_terpakai` dibaca dari baris yang SUDAH terkunci di atas:
    -- panggilan bersamaan yang lolos kunci belakangan melihat nilai yang
    -- ditulis panggilan pertama, bukan nilai basi dari sebelum keduanya mulai.
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


ALTER FUNCTION "public"."jadwal_ulang_sesi"("sesi_id" "uuid", "tanggal_baru" "date", "jam_baru" time without time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."jaga_identitas_fase"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator')
     and new.id is distinct from old.id then
    raise exception
      'id fase adalah taksonomi produk dan tidak boleh ditulis ulang lewat API'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."jaga_identitas_fase"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."jaga_identitas_fase"() IS 'Menolak perubahan phases.id dari peran API (anon, authenticated, authenticator). Id fase dipetakan literal di produk (FASE_SKRINING_KE_PHASE, enum FaseSkrining, glif Sanskerta landing); menulis ulangnya memutus pemetaan itu tanpa error di layar — efek yang sama dengan DELETE yang sudah dicabut. Kolom lain (nama, nama_sanskrit, urutan) tetap boleh disunting staf.';



CREATE OR REPLACE FUNCTION "public"."jaga_identitas_setelan"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  -- `is distinct from` sengaja dipakai: yang diikat adalah PERUBAHAN nilai,
  -- bukan kehadiran kolom `key` di payload. Upsert PostgREST selalu menyertakan
  -- `set key = excluded.key` dengan nilai yang SAMA, dan payload itu harus tetap
  -- lolos — kalau tidak, panel pengaturan mati seperti pada varian hak kolom.
  if current_user in ('anon', 'authenticated', 'authenticator')
     and new.key is distinct from old.key then
    raise exception
      'kunci setelan tidak boleh dipindahkan; ubah `value`, bukan `key`'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."jaga_identitas_setelan"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."jaga_identitas_setelan"() IS 'Menolak perubahan app_settings.key dari peran API (anon, authenticated, authenticator) — admin & owner sekalipun. Memindahkan kunci membuat baris lama LENYAP dari pencarian literal kode (mis. eq("key","nomor_wa")), yaitu efek yang sama persis dengan DELETE yang sudah dicabut migration cabut_hak_hapus_berlebih. Kunci baru lahir lewat INSERT yang sudah dijaga FK app_settings_key_terdaftar.';



CREATE OR REPLACE FUNCTION "public"."jaga_tanda_honor"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if current_user not in ('anon', 'authenticated', 'authenticator') then
    return new;
  end if;

  if new.week_start > (now() at time zone 'Asia/Jakarta')::date then
    raise exception
      'pekan % belum berjalan — honornya belum bisa ditandai dibayar, dan tanda bayar tidak bisa dibatalkan', new.week_start
      using errcode = '42501';
  end if;

  new.ditandai_oleh := auth.uid();
  new.dibayar_pada  := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."jaga_tanda_honor"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."jaga_tanda_honor"() IS 'BEFORE INSERT honor_marks untuk peran API: merebut ditandai_oleh & dibayar_pada dari payload (keduanya terbukti bisa dipalsukan — owner menandai honor atas nama ADMIN bertanggal 1999, secara PERMANEN karena DELETE sudah dicabut) dan menolak pekan yang belum berjalan. Batas pekannya memakai kalender Asia/Jakarta, sama persis dengan periksaPekan() di src/app/owner/rekap/status.ts. Service role dilewatkan: jalur seed & pemindahan riwayat pembayaran lama harus tetap bisa menentukan keduanya.';



CREATE OR REPLACE FUNCTION "public"."jaga_transport_khusus"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if current_user not in ('anon', 'authenticated', 'authenticator') then
    return new;
  end if;

  -- Siapa yang menetapkan nominal adalah BUKTI. Pelajaran yang sudah dibayar
  -- sekali di honor_marks: identitas yang datang dari payload bisa dipalsukan,
  -- dan pemalsuannya permanen karena DELETE dicabut.
  new.ditetapkan_oleh := auth.uid();
  new.ditetapkan_pada := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."jaga_transport_khusus"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."jaga_transport_khusus"() IS 'BEFORE INSERT transport_khusus untuk peran API: merebut ditetapkan_oleh & ditetapkan_pada dari payload. Service role dilewatkan untuk jalur seed & pemindahan data.';



CREATE OR REPLACE FUNCTION "public"."jam_layanan_terpakai"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select value from public.app_settings where key = 'jam_layanan';
$$;


ALTER FUNCTION "public"."jam_layanan_terpakai"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."jarak_km"("lat1" double precision, "lon1" double precision, "lat2" double precision, "lon2" double precision) RETURNS double precision
    LANGUAGE "sql" IMMUTABLE
    AS $$
  -- Haversine. Jari-jari rata-rata Bumi IUGG, angka yang sama persis dengan
  -- `JARI_JARI_BUMI_KM` di src/lib/transport/jarak.ts.
  select 2 * 6371.0088 * asin(least(1, sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ^ 2
  )));
$$;


ALTER FUNCTION "public"."jarak_km"("lat1" double precision, "lon1" double precision, "lat2" double precision, "lon2" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."jenjang_dari_jarak"("km" double precision) RETURNS "public"."jenjang_transport"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case
    when km is null then null
    when km <= 5  then '0_5'::jenjang_transport
    when km <= 10 then '5_10'::jenjang_transport
    when km <= 15 then '10_15'::jenjang_transport
    when km <= 20 then '15_20'::jenjang_transport
    else 'di_atas_20'::jenjang_transport
  end;
$$;


ALTER FUNCTION "public"."jenjang_dari_jarak"("km" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."jenjang_pembatalan"("tanggal" "date", "jam" time without time zone) RETURNS smallint
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."jenjang_pembatalan"("tanggal" "date", "jam" time without time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."klaim_sudah_bayar"("jenis" "text", "sasaran_id" "uuid") RETURNS SETOF "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  pemilik uuid;
begin
  if jenis not in ('paket', 'sesi') then
    raise exception 'jenis klaim tidak dikenal: %', jenis using errcode = '22023';
  end if;

  -- Kepemilikan diturunkan dari SESI, tidak pernah dari argumen — itulah yang
  -- membuat filter di bawah bermakna.
  select c.id into pemilik
    from public.clients c
   where c.user_id = auth.uid()
   limit 1;
  if pemilik is null then
    return; -- akun belum tertaut: tidak ada baris yang boleh disentuh
  end if;

  if jenis = 'sesi' then
    return query
      update public.sessions s
         set status_bayar = 'menunggu_verifikasi'
       where s.id = sasaran_id
         and s.client_id = pemilik
         and s.status_bayar = 'belum'
         -- Sesi berpaket memikul status paketnya, bukan status sendiri.
         and s.client_package_id is null
         -- Sesi yang dibatalkan tidak menagih apa pun — KEDUA nilai "batal",
         -- bukan satu. Yang dibatalkan klien pun tidak menagih: akibat uangnya
         -- sudah ditentukan jenjang saat pembatalan (refund penuh, hak sesi,
         -- atau hangus), dan tidak satu pun di antaranya berbentuk klien
         -- menekan "saya sudah bayar" setelahnya.
         --
         -- `tidak_hadir` SENGAJA tetap di luar daftar ini: apakah sesi yang
         -- kliennya tidak hadir tetap ditagih adalah keputusan C3 yang belum
         -- diambil, dan mengubahnya diam-diam di sini akan mendahului
         -- keputusan itu dengan cara yang tidak terlihat siapa pun. Sisi
         -- TypeScript memegang pilihan yang sama (`SESI_TIDAK_TERJADI`).
         and s.status not in ('dibatalkan_padma', 'dibatalkan_klien')
      returning s.id;
  else
    return query
      update public.client_packages p
         set status_bayar = 'menunggu_verifikasi'
       where p.id = sasaran_id
         and p.client_id = pemilik
         and p.status_bayar = 'belum'
         -- Sejajar dengan `ambilPaket()`: paket yang sudah tidak aktif tidak
         -- pernah muncul di halaman Bayar, jadi ia juga tidak boleh bisa
         -- diklaim lewat endpoint RPC langsung.
         and p.status = 'aktif'
      returning p.id;
  end if;
end;
$$;


ALTER FUNCTION "public"."klaim_sudah_bayar"("jenis" "text", "sasaran_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."konfirmasi_permintaan"("permintaan_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."konfirmasi_permintaan"("permintaan_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."kunci_riwayat_tarif_transport"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    raise exception
      'rate card transport bersifat append-only: tetapkan tarif baru sebagai BARIS BARU, jangan menimpa yang lama'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."kunci_riwayat_tarif_transport"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."kunci_riwayat_tarif_transport"() IS 'Menolak SETIAP UPDATE transport_rates dari peran API. Verba UPDATE sengaja TIDAK dicabut dari authenticated (owner login sebagai peran itu); yang dimatikan kemampuannya, bukan haknya.';



CREATE OR REPLACE FUNCTION "public"."kunci_riwayat_tarif_varian"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    raise exception
      'rate card bersifat append-only: tetapkan tarif baru sebagai BARIS BARU, jangan menimpa yang lama'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."kunci_riwayat_tarif_varian"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."kunci_riwayat_tarif_varian"() IS 'Menolak SETIAP UPDATE variant_rates dari peran API — owner sekalipun. Verba UPDATE sengaja TIDAK dicabut dari authenticated (owner login sebagai peran itu); yang dimatikan kemampuannya, bukan haknya. Service role tetap bebas sebagai jalur pemulihan data.';



CREATE OR REPLACE FUNCTION "public"."kunci_tanda_honor"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    raise exception
      'tanda bayar honor adalah bukti dan tidak bisa diubah; tidak ada jalur pembatalan'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."kunci_tanda_honor"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."kunci_tanda_honor"() IS 'Menolak SETIAP UPDATE honor_marks dari peran API (anon, authenticated, authenticator) — owner sekalipun. Tanda bayar adalah BUKTI bahwa seorang mitra sudah menerima uangnya; bukti yang bisa ditulis ulang bukan bukti, dan DELETE-nya memang sudah dicabut. Menandai ulang tetap idempoten lewat ON CONFLICT DO NOTHING, yang tidak menyentuh baris lama.';



CREATE OR REPLACE FUNCTION "public"."kunci_transport_khusus"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    raise exception
      'nominal transport khusus adalah bukti berapa yang ditagihkan dan siapa yang menetapkannya; bukti yang bisa ditulis ulang bukan bukti'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."kunci_transport_khusus"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."kunci_transport_khusus"() IS 'Menolak SETIAP UPDATE transport_khusus dari peran API (anon, authenticated, authenticator) — owner sekalipun. Menutup temuan B5b: merebut ditetapkan_oleh pada INSERT (trg_jaga_transport_khusus) tidak ada gunanya bila baris yang sudah berdiri masih bisa ditimpa sesudahnya. Verba UPDATE sengaja TIDAK dicabut dari authenticated (owner login sebagai peran itu); yang dimatikan kemampuannya, bukan haknya. Service role tetap bebas sebagai jalur pemulihan data — dan, untuk saat ini, satu-satunya jalur koreksi nominal transport khusus yang sudah ditetapkan. Apakah koreksi SAH butuh pola "fakta baru" seperti honor_marks (bukan penulisan ulang fakta lama) belum diputuskan; lihat task-3-4-report.md.';



CREATE OR REPLACE FUNCTION "public"."lepas_video_materi"("materi_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  terhapus uuid;
begin
  if public.user_role() not in ('admin', 'owner') then
    raise exception 'hanya staf yang boleh melepas video materi'
      using errcode = '42501';
  end if;

  delete from public.material_videos v
   where v.material_id = materi_id
  returning v.material_id into terhapus;

  return terhapus;
end;
$$;


ALTER FUNCTION "public"."lepas_video_materi"("materi_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_client_email"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.email := lower(btrim(new.email));
  return new;
end;
$$;


ALTER FUNCTION "public"."normalize_client_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."paksa_aktor_penugasan"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if current_user not in ('anon', 'authenticated', 'authenticator') then
    return new;
  end if;

  new.ditugaskan_oleh := auth.uid();
  return new;
end $$;


ALTER FUNCTION "public"."paksa_aktor_penugasan"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."perbarui_profil_klien"("p_nama" "text", "p_no_hp" "text", "p_alamat" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_alamat_lama text;
  v_alamat_baru text := btrim(p_alamat);
begin
  select alamat into v_alamat_lama
  from clients
  where user_id = auth.uid();

  -- Pemanggil tanpa sesi (`auth.uid()` NULL) dan pemanggil yang punya sesi
  -- tetapi bukan klien (admin, owner) sama-sama mendarat di sini.
  --
  -- Melempar, bukan diam. `update ... where user_id = auth.uid()` yang tidak
  -- cocok satu baris pun sudah AMAN — tetapi aman secara senyap: pemanggil
  -- tidak bisa membedakan "tidak berhak" dari "tidak ada yang berubah", dan
  -- layar akan melaporkan sukses atas perubahan yang tidak pernah terjadi.
  if not found then
    raise exception 'tidak ada baris klien untuk akun ini'
      using errcode = '42501';
  end if;

  update clients set
    nama   = btrim(p_nama),
    no_hp  = btrim(p_no_hp),
    alamat = v_alamat_baru,
    -- Ditulis sebagai CASE, bukan dua UPDATE bercabang, supaya "koordinat
    -- hangus bersama alamat" terjadi dalam SATU pernyataan — tidak ada jendela
    -- waktu di mana alamat sudah baru sementara koordinatnya masih lama.
    alamat_lat = case when v_alamat_baru is distinct from v_alamat_lama
                      then null else alamat_lat end,
    alamat_lon = case when v_alamat_baru is distinct from v_alamat_lama
                      then null else alamat_lon end
  where user_id = auth.uid();
end;
$$;


ALTER FUNCTION "public"."perbarui_profil_klien"("p_nama" "text", "p_no_hp" "text", "p_alamat" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."perbarui_profil_klien"("p_nama" "text", "p_no_hp" "text", "p_alamat" "text") IS 'Satu-satunya jalur tulis KLIEN ke barisnya sendiri di clients, terbatas pada nama, no_hp, dan alamat. Koordinat bukan parameter (klien tidak boleh menentukan jenjang tarifnya sendiri) dan dikosongkan bila teks alamat berubah — pengisiannya kembali adalah jalur server ber-service-role sesudah geocoding. Email, phase_id, dan padma_id TIDAK tersentuh: ketiganya keputusan identitas, bukan data operasional.';



CREATE OR REPLACE FUNCTION "public"."perpindahan_permintaan_sah"("dari" "public"."booking_status", "ke" "public"."booking_status") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
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


ALTER FUNCTION "public"."perpindahan_permintaan_sah"("dari" "public"."booking_status", "ke" "public"."booking_status") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."perpindahan_sesi_sah"("dari" "public"."session_status", "ke" "public"."session_status") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case dari
    when 'terjadwal'        then ke in ('berjalan', 'selesai', 'tidak_hadir', 'dibatalkan_padma', 'dibatalkan_klien')
    when 'berjalan'         then ke in ('selesai', 'tidak_hadir')
    when 'selesai'          then false
    when 'tidak_hadir'      then false
    when 'dibatalkan_padma' then false
    when 'dibatalkan_klien' then false
  end;
$$;


ALTER FUNCTION "public"."perpindahan_sesi_sah"("dari" "public"."session_status", "ke" "public"."session_status") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sentuh_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."sentuh_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."terbitkan_varian_baku"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.service_variants (service_id, label, durasi_menit, format, urutan)
  values (new.id, '', null, null, 0);
  return new;
end;
$$;


ALTER FUNCTION "public"."terbitkan_varian_baku"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."terbitkan_varian_baku"() IS 'Menerbitkan varian baku (label kosong, durasi & format NULL) untuk setiap baris services yang baru lahir. Menegakkan V3 spec ("setiap layanan wajib punya minimal satu varian") SELAMANYA — bukan cuma pada saat migrasi Task 1 dijalankan. BUKAN security definer dan TIDAK bergerbang peran: layanan yatim adalah bug yang sama untuk siapa pun yang menciptakannya.';



CREATE OR REPLACE FUNCTION "public"."tukar_hak_sesi"("hak_id" "uuid", "tanggal_baru" "date", "jam_baru" time without time zone, "mitra" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  h public.hak_sesi%rowtype;
  peran text := public.user_role();
  staf boolean := peran in ('admin', 'owner');
  varian uuid;
  alamat_asal text;
  lat_asal double precision;
  lon_asal double precision;
  m public.partners%rowtype;
  km double precision;
  jenjang_hitung jenjang_transport;
  daftar_jam text;
  sesi_baru uuid;
begin
  -- `for update` MENGUNCI baris hak sampai transaksi ini selesai. Panggilan
  -- bersamaan atas `hak_id` yang sama akan menunggu di sini, bukan membaca
  -- `dipakai_sesi_id` yang sama-sama masih null lalu sama-sama lolos.
  select * into h from public.hak_sesi where id = hak_id for update;
  if not found then
    return null;
  end if;

  -- Dijodohkan lewat `clients.user_id`: `clients.id` bukan id auth (lihat
  -- komentar panjang di `batalkan_sesi`).
  if not staf and not exists (
    select 1 from public.clients c
     where c.id = h.client_id and c.user_id = auth.uid()
  ) then
    raise exception 'hak ini bukan milik Anda' using errcode = '42501';
  end if;

  -- Diperiksa SESUDAH kunci didapat, dan SEBELUM sesi baru disisipkan — supaya
  -- panggilan kedua yang menunggu di atas melihat nilai yang sudah terbaru
  -- (ditulis oleh panggilan pertama yang sudah commit) dan berhenti di sini,
  -- bukan sesudah telanjur melahirkan baris `sessions` yatim.
  if h.dipakai_sesi_id is not null then
    return null;
  end if;

  if h.kedaluwarsa < (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'hak ini sudah kedaluwarsa pada %', h.kedaluwarsa
      using errcode = '23514';
  end if;

  -- `daftar_jam` disimpan dengan spasi sesudah koma ("08:00, 09:00, ..."),
  -- jadi pencocokannya wajib `btrim` tiap unsur — pola yang sama dipakai
  -- `guard_booking_pembatas` dan `jadwal_ulang_sesi` untuk daftar yang sama.
  daftar_jam := public.jam_layanan_terpakai();
  if daftar_jam is null or not exists (
    select 1 from unnest(string_to_array(daftar_jam, ',')) as j(teks)
     where btrim(j.teks) = to_char(jam_baru, 'HH24:MI')
  ) then
    raise exception 'jam % di luar jam layanan klinik', to_char(jam_baru, 'HH24:MI')
      using errcode = '22023';
  end if;

  -- WAKTU BARU HARUS DI MASA DEPAN — pagar yang setara dengan
  -- `jadwal_ulang_sesi`, dan sebelumnya TIDAK ADA di sini.
  --
  -- Fungsi ini memvalidasi kepemilikan, keterpakaian, kedaluwarsa, keanggotaan
  -- jam, dan bentrok bidan — tetapi tidak sekali pun bahwa tanggalnya belum
  -- lewat. Satu salah ketik tahun sudah cukup: haknya TERMAKAN pada sesi di
  -- masa lalu, `dipakai_sesi_id` terisi, dan indeks unik parsial menutup jalan
  -- kembali. Tidak ada layar yang bisa memulihkannya — hanya UPDATE manual ke
  -- basis data.
  --
  -- Ambangnya 2 jam, sama dengan `jadwal_ulang_sesi`, dan sebab yang sama:
  -- menaruh sesi 30 menit lagi bukan penjadwalan melainkan cara memaksa bidan
  -- berangkat tanpa pemberitahuan.
  if ((tanggal_baru + jam_baru) at time zone 'Asia/Jakarta') - now() < interval '2 hours' then
    raise exception 'waktu sesi pengganti terlalu dekat atau sudah lewat — pilih minimal 2 jam dari sekarang'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.sessions x
     where x.partner_id = mitra
       and x.tanggal = tanggal_baru
       and x.jam_mulai = jam_baru
       and x.status = 'terjadwal'
  ) then
    raise exception 'bidan sudah punya jadwal pada waktu itu — pilih waktu lain'
      using errcode = '23505';
  end if;

  -- SESI PENGGANTI LAHIR DARI BARIS ASALNYA, BUKAN DARI DELAPAN KOLOM SAJA.
  --
  -- Versi pertama fungsi ini menyisipkan delapan kolom dan berhenti di situ.
  -- `sessions.alamat` bertipe `not null default ''`, jadi penyisipannya
  -- BERHASIL DIAM-DIAM — dan sesi pengganti, sesi yang kliennya sudah bayar,
  -- lahir tanpa alamat. Bidan tidak punya rumah yang dituju, dan tidak ada
  -- satu pun galat yang menyebutkannya. Bandingkan jalur kelahiran sesi yang
  -- sudah baku, `konfirmasi_permintaan()` (migrasi
  -- `20260912101000_status_bayar_pagar.sql`): ia menyalin alamat & koordinat,
  -- lalu menghitung jenjang transportnya sendiri.
  --
  -- Alamat DISALIN dari baris asal, TIDAK diambil ulang dari profil klien —
  -- peringatan yang sudah tertulis di `konfirmasi_atomik.sql`: klien boleh
  -- memesan untuk alamat lain, dan mengambil ulang akan diam-diam mengubah ke
  -- mana bidan dikirim.
  select s.variant_id, s.alamat, s.alamat_lat, s.alamat_lon
    into varian, alamat_asal, lat_asal, lon_asal
    from public.sessions s
   where s.id = h.sesi_asal_id;

  -- HAK TANPA SESI ASAL DITOLAK, dan penolakan itu adalah keputusan.
  --
  -- Alamat sebuah sesi hanya punya satu sumber yang sah: baris asalnya. Hak
  -- yang diterbitkan tanpa sesi asal (mis. staf menerbitkannya langsung)
  -- karena itu tidak punya alamat tujuan sama sekali. Dua jalan tersedia:
  -- melahirkan sesi beralamat kosong, atau menolak.
  --
  -- Dipilih MENOLAK. Sesi beralamat kosong adalah persis kegagalan senyap yang
  -- fungsi ini baru saja ditutup — tidak ada seorang pun yang mengetahuinya
  -- sampai bidan berdiri di jalan tanpa tujuan, dan tidak ada layar yang bisa
  -- memperbaikinya setelahnya. Galat di sini muncul pada saat masih bisa
  -- diperbaiki: staf menjadwalkan sesi penggantinya langsung (formulir "Sesi
  -- baru" meminta alamat), atau menerbitkan haknya dari sesi yang batal.
  -- Dalam jalur yang hidup hari ini cabang ini TIDAK PERNAH terpicu: satu-
  -- satunya penerbit hak adalah `batalkan_sesi()`, dan ia selalu mencatat
  -- `sesi_asal_id`.
  if not found then
    raise exception 'hak ini tidak punya sesi asal, jadi alamat tujuannya tidak diketahui — jadwalkan sesi penggantinya langsung'
      using errcode = '23514';
  end if;

  -- Varian yang belum terisi pada baris asal tetap jatuh ke varian BAKU
  -- layanan — bentuk query backfill yang sama dipakai migration
  -- `varian_wajib`, ditambah filter `aktif` seperti helper uji `varianBaku()`
  -- (`varian_wajib.sql` sendiri TIDAK memfilter `aktif`).
  if varian is null then
    select v.id into varian
      from public.service_variants v
     where v.service_id = h.service_id
       and v.aktif
     order by v.urutan, v.created_at, v.id
     limit 1;
  end if;

  -- Jenjang transport DIHITUNG di sini, dengan cara yang sama persis seperti
  -- `konfirmasi_permintaan()`: jarak garis lurus antara domisili BIDAN yang
  -- ditugaskan dan alamat tujuan. Bidannya bisa berbeda dari sesi asal, jadi
  -- mewarisi `jenjang` apa adanya akan membayarkan transport yang salah.
  --
  -- Koordinat yang tidak lengkap BUKAN galat (alasan yang sama dengan
  -- `konfirmasi_permintaan`): alamat Malang sering gagal digeocode, dan
  -- domisili bidan boleh belum diisi. Jenjangnya tetap NULL, dan admin
  -- menetapkannya belakangan lewat `tetapkanJenjang`.
  select * into m from public.partners p where p.id = mitra;

  if m.lat is not null and m.lon is not null
     and lat_asal is not null and lon_asal is not null then
    km := public.jarak_km(m.lat, m.lon, lat_asal, lon_asal);
    jenjang_hitung := public.jenjang_dari_jarak(km);
  end if;

  insert into public.sessions (
    client_id, service_id, variant_id, partner_id,
    tanggal, jam_mulai,
    alamat, alamat_lat, alamat_lon,
    jenjang, jenjang_sumber, jenjang_alasan,
    status, status_bayar
  ) values (
    h.client_id, h.service_id, varian, mitra,
    tanggal_baru, jam_baru,
    alamat_asal, lat_asal, lon_asal,
    jenjang_hitung,
    case when jenjang_hitung is null then null else 'otomatis'::sumber_jenjang end,
    '',
    'terjadwal', 'lunas'
  )
  returning id into sesi_baru;

  -- Pagar kedua: `and dipakai_sesi_id is null` mengulang pemeriksaan yang
  -- sudah dilakukan sesudah `for update` di atas. Dalam alur normal klausa ini
  -- tidak pernah gagal — kuncinya sudah menutup celahnya — tapi bila ada jalur
  -- lain yang suatu hari menulis `dipakai_sesi_id` tanpa mengunci baris ini
  -- lebih dulu, `if not found` di bawah menolaknya dengan galat, bukan diam
  -- menimpa penukaran yang sudah ada.
  update public.hak_sesi
     set dipakai_sesi_id = sesi_baru
   where id = hak_id
     and dipakai_sesi_id is null;

  if not found then
    raise exception 'hak ini sudah dipakai oleh penukaran lain' using errcode = '23514';
  end if;

  insert into public.jejak_jadwal (
    sesi_id, tindakan, jenjang, ke_tanggal, ke_jam, aktor_id, peran_aktor
  ) values (
    sesi_baru, 'tukar_hak', 2, tanggal_baru, jam_baru, auth.uid(), peran
  );

  return sesi_baru;
end;
$$;


ALTER FUNCTION "public"."tukar_hak_sesi"("hak_id" "uuid", "tanggal_baru" "date", "jam_baru" time without time zone, "mitra" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_role"() RETURNS "public"."app_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select role from profiles where id = auth.uid()), 'klien'::app_role);
$$;


ALTER FUNCTION "public"."user_role"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."app_setting_keys" (
    "key" "text" NOT NULL,
    "keterangan" "text" NOT NULL,
    "bentuk" "text" NOT NULL,
    CONSTRAINT "app_setting_keys_bentuk_check" CHECK (("bentuk" = ANY (ARRAY['nomor_wa'::"text", 'teks_polos'::"text", 'daftar_jam'::"text"])))
);


ALTER TABLE "public"."app_setting_keys" OWNER TO "postgres";


COMMENT ON TABLE "public"."app_setting_keys" IS 'Daftar putih kunci app_settings. `app_settings` adalah key/value, jadi money firewall yang memindai nama KOLOM tidak melihatnya sama sekali: nominal uang bisa hidup sebagai BARIS. Registri ini menutupnya lewat FK. INSERT/UPDATE/DELETE sengaja dicabut dari `authenticated` — bila staf boleh mendaftarkan kuncinya sendiri, FK di app_settings hanya hiasan; kunci baru lahir lewat migration, tempat alasannya ikut tertulis. Kolom `bentuk` menentukan validator nilai di panel (nomor_wa = digit saja).';



CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."app_settings"."key" IS 'Nama setelan; dicari kode dengan LITERAL (eq("key","nomor_wa")), jadi ia identitas menurut makna, bukan sekadar primary key. TIDAK boleh dipindahkan lewat peran API — trigger trg_jaga_identitas_setelan menolaknya — karena baris yang berpindah kunci lenyap dari pencarian itu persis seperti baris yang dihapus, dan nomorWaTerpakai() menutupi hilangnya dengan nomor bawaan sehingga tidak ada satu pun error yang terbit. Kunci baru hanya lahir lewat INSERT, dan hanya yang terdaftar di app_setting_keys (FK).';



CREATE TABLE IF NOT EXISTS "public"."booking_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "service_id" "uuid" NOT NULL,
    "tanggal" "date" NOT NULL,
    "preferensi_waktu" "public"."waktu_pref" NOT NULL,
    "catatan" "text" DEFAULT ''::"text" NOT NULL,
    "status" "public"."booking_status" DEFAULT 'diminta'::"public"."booking_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "variant_id" "uuid" NOT NULL,
    "alamat" "text" DEFAULT ''::"text" NOT NULL,
    "alamat_lat" double precision,
    "alamat_lon" double precision,
    "jam_mulai" time without time zone NOT NULL,
    "partner_id" "uuid",
    "screening_id" "uuid",
    "status_bayar" "public"."pay_status" DEFAULT 'belum'::"public"."pay_status" NOT NULL,
    "bukti_objek" "text",
    "tenggat" timestamp with time zone,
    "email_tagihan_pada" timestamp with time zone,
    CONSTRAINT "booking_requests_jam_bulat" CHECK (((EXTRACT(minute FROM "jam_mulai") = ANY (ARRAY[(0)::numeric, (30)::numeric])) AND (EXTRACT(second FROM "jam_mulai") = (0)::numeric))),
    CONSTRAINT "booking_requests_mitra_siap_bermitra" CHECK ((("status" <> ALL (ARRAY['mitra_siap'::"public"."booking_status", 'dikonfirmasi'::"public"."booking_status"])) OR ("partner_id" IS NOT NULL))),
    CONSTRAINT "booking_requests_tenggat_hanya_saat_ditagih" CHECK (((("status" = 'menunggu_bayar'::"public"."booking_status") AND ("tenggat" IS NOT NULL)) OR ("status" <> 'menunggu_bayar'::"public"."booking_status")))
);


ALTER TABLE "public"."booking_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."booking_requests" IS 'Antrean permintaan jadwal dari klien, sekaligus BUKTI klien bahwa ia pernah meminta tanggal tertentu (terbaca pemiliknya lewat policy "booking: klien baca miliknya"). TIDAK PERNAH dihapus lewat peran API: bentuk penolakannya adalah status `ditolak`, yang sudah mengosongkan antrean admin, melepaskan index parsial booking_requests_antrean_unik, dan mengembalikan kuota klien tanpa menghapus jejaknya. DELETE hanya lewat service role.';



COMMENT ON COLUMN "public"."booking_requests"."jam_mulai" IS 'Jam mulai yang DIPILIH klien (spec J2). Jam dinding WIB. Daftar jam yang boleh dipilih tinggal di app_settings.jam_layanan, bukan di kode.';



COMMENT ON COLUMN "public"."booking_requests"."partner_id" IS 'Mitra yang dipilih admin saat status mitra_siap. Disalin ke sessions.partner_id pada konfirmasi. NULL selama masih dicarikan.';



COMMENT ON COLUMN "public"."booking_requests"."screening_id" IS 'Skrining hijau yang menopang pengajuan ini (spec J3). Satu skrining menopang TEPAT SATU pengajuan; sesudah dipakai ia hangus. Skrining yang menopang pengajuan yang dibatalkan TIDAK hidup kembali — itu disengaja: kondisi kesehatan bisa berubah di antara dua percobaan memesan.';



COMMENT ON COLUMN "public"."booking_requests"."status_bayar" IS 'Keadaan pembayaran tagihan pengajuan (spec C2). Nominalnya TIDAK disimpan di mana pun — ia diturunkan dari variant_rates + transport_rates menurut tanggal sesi.';



COMMENT ON COLUMN "public"."booking_requests"."bukti_objek" IS 'Kunci objek bukti bayar di bucket privat `bukti-bayar`. NULL = belum diunggah. Disimpan SAMPAI DIHAPUS MANUAL (keputusan pemilik repo 8 Sep 2026) — panel admin karena itu WAJIB punya tombol hapus per baris dan saringan "lunas > 90 hari", karena tanpa alat, "manual" pada praktiknya berarti "tidak pernah". Menghapus bukti tidak menghapus jejak siapa memverifikasi dan kapan: itu hidup di tabel jejak status bayar.';



COMMENT ON COLUMN "public"."booking_requests"."tenggat" IS 'Batas waktu membayar, diisi saat tagihan terbit (mitra_siap -> menunggu_bayar). Lewat tenggat = pengajuan dibatalkan otomatis DAN skriningnya dikembalikan.';



COMMENT ON COLUMN "public"."booking_requests"."email_tagihan_pada" IS 'Kapan email tagihan terakhir BERHASIL terkirim. NULL = belum pernah.';



CREATE TABLE IF NOT EXISTS "public"."certificates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "service_id" "uuid" NOT NULL,
    "objek" "text" NOT NULL,
    "mime" "text" NOT NULL,
    "diunggah_oleh" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."certificates" OWNER TO "postgres";


COMMENT ON TABLE "public"."certificates" IS 'Sertifikat kunjungan, satu per sesi. client_id & service_id adalah SALINAN keadaan saat terbit, bukan rujukan hidup — sesi yang dipindahkan ke layanan lain tidak boleh menyeret sertifikat yang sudah dicetak. Klien hanya bisa MEMBACA miliknya: tidak ada policy tulis untuk klien, karena sertifikat bukan sesuatu yang diterbitkan sendiri oleh penerimanya.';



CREATE TABLE IF NOT EXISTS "public"."client_invites" (
    "client_id" "uuid" NOT NULL,
    "token_hash" "text",
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "used_at" timestamp with time zone,
    "used_by" "uuid",
    CONSTRAINT "client_invites_token_sekali_pakai" CHECK ((("used_at" IS NULL) = ("token_hash" IS NOT NULL)))
);


ALTER TABLE "public"."client_invites" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_invites" IS 'Token undangan aktivasi akun klien: acak 32 byte, disimpan sebagai SHA-256, sekali pakai, berumur terbatas. Dikirim admin lewat pesan sambutan WhatsApp. Tidak boleh terbaca peran API mana pun — hanya service role di server.';



CREATE TABLE IF NOT EXISTS "public"."client_packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "package_id" "uuid" NOT NULL,
    "tanggal_mulai" "date" DEFAULT CURRENT_DATE NOT NULL,
    "status" "public"."package_status" DEFAULT 'aktif'::"public"."package_status" NOT NULL,
    "status_bayar" "public"."pay_status" DEFAULT 'belum'::"public"."pay_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_packages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "padma_id" "text" NOT NULL,
    "nama" "text" NOT NULL,
    "email" "text" NOT NULL,
    "no_hp" "text" DEFAULT ''::"text" NOT NULL,
    "phase_id" "text",
    "user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "linked_at" timestamp with time zone,
    "alamat" "text" DEFAULT ''::"text" NOT NULL,
    "alamat_lat" double precision,
    "alamat_lon" double precision,
    CONSTRAINT "clients_email_lowercase" CHECK (("email" = "lower"("btrim"("email"))))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


COMMENT ON COLUMN "public"."clients"."phase_id" IS 'Fase perjalanan klien (referensi public.phases). NULL = BELUM DITENTUKAN, bukan hilang: baris klien yang lahir dari pendaftaran mandiri belum punya fase karena fase datang dari skrining pertama yang tersambung — formulir pendaftaran sengaja tidak menanyakannya agar tidak ada dua jawaban yang bisa berbeda. Formulir admin tetap mewajibkannya di lapis aplikasi.';



COMMENT ON COLUMN "public"."clients"."user_id" IS 'Akun auth pemilik baris klien ini; dasar RLS "clients: milik sendiri" (user_id = auth.uid()) dan karenanya penentu siapa yang boleh membaca rekam medisnya. HANYA boleh ditulis service role dari server. Peran API — admin & owner sekalipun — ditolak trigger trg_guard_client_link. ADA TIGA penulis sah, semuanya di src/lib/auth/link-client.ts dan masing-masing membawa penjaganya sendiri: (1) linkClientByInvite() — token undangan sekali pakai DAN email cocok persis; (2) tautkanKlienLewatEmailTerverifikasi() — email yang sudah TERBUKTI (email_confirmed_at terisi) cocok dengan baris yang belum tertaut; (3) terbitkanKlienMandiri() — INSERT baris baru yang bertuan sejak lahir, juga menuntut email terbukti. Urutan ketiganya dipegang satu tempat, src/lib/auth/pastikan-klien.ts. SEJARAH: mencocokkan email pernah CUKUP untuk merebut rekam medis, karena saat itu email tidak pernah dibuktikan (enable_confirmations = false membuat GoTrue meng-auto-confirm pendaftaran mandiri). Yang membuat (2) & (3) sah bukan kecocokan alamatnya melainkan KONFIRMASINYA; mematikan enable_confirmations menghidupkan celah itu utuh seperti semula.';



COMMENT ON COLUMN "public"."clients"."linked_at" IS 'Waktu akun auth tertaut ke baris klien ini — lewat token undangan (public.client_invites), lewat email terverifikasi, atau sejak INSERT untuk klien yang mendaftar sendiri. NULL = belum ada akun yang memilikinya. Bukan rahasia (klien berhak tahu, admin perlu melihat siapa yang belum aktif), tetapi HANYA boleh ditulis service role bersama user_id — dijaga trigger trg_guard_client_link agar tidak ada jejak tautan palsu.';



CREATE TABLE IF NOT EXISTS "public"."geocode_cache" (
    "alamat_normal" "text" NOT NULL,
    "lat" double precision,
    "lon" double precision,
    "sumber" "text" DEFAULT 'nominatim'::"text" NOT NULL,
    "dicoba_pada" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."geocode_cache" OWNER TO "postgres";


COMMENT ON TABLE "public"."geocode_cache" IS 'Hasil geocoding per alamat kanonik. Baris ber-lat/lon NULL berarti KETIGA tingkat ladder (alamat penuh, tanpa nomor rumah, jalan + kota) sudah dicoba dan semuanya kosong — bukan sekadar satu pertanyaan yang gagal.';



CREATE TABLE IF NOT EXISTS "public"."hak_sesi" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "service_id" "uuid" NOT NULL,
    "kedaluwarsa" "date" NOT NULL,
    "sesi_asal_id" "uuid",
    "dipakai_sesi_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."hak_sesi" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."variant_rates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "variant_id" "uuid" NOT NULL,
    "harga_klien" integer NOT NULL,
    "harga_coret" integer,
    "honor_mitra" integer NOT NULL,
    "berlaku_sejak" "date" DEFAULT CURRENT_DATE NOT NULL,
    CONSTRAINT "variant_rates_nilai_wajar" CHECK ((("harga_klien" >= 0) AND ("honor_mitra" >= 0) AND ("honor_mitra" <= "harga_klien") AND (("harga_coret" IS NULL) OR ("harga_coret" >= "harga_klien"))))
);


ALTER TABLE "public"."variant_rates" OWNER TO "postgres";


COMMENT ON TABLE "public"."variant_rates" IS 'RIWAYAT tarif per VARIAN — bukan satu baris harga yang ditimpa. APPEND-ONLY untuk peran API: INSERT hanya dengan berlaku_sejak yang MAJU, UPDATE ditolak seluruhnya, DELETE sudah dicabut. Harga klien dipajang publik lewat view harga_publik; honor_mitra tidak pernah keluar dari sini.';



CREATE OR REPLACE VIEW "public"."harga_publik" WITH ("security_invoker"='off') AS
 SELECT "variant_id",
    "harga_klien",
    "harga_coret",
    "berlaku_sejak"
   FROM "public"."variant_rates"
  WHERE ("berlaku_sejak" <= (("now"() AT TIME ZONE 'Asia/Jakarta'::"text"))::"date");


ALTER VIEW "public"."harga_publik" OWNER TO "postgres";


COMMENT ON VIEW "public"."harga_publik" IS 'Harga klien untuk landing & katalog publik. security_invoker = off disengaja: view inilah batas kolomnya, dan anon memang tidak punya hak baca atas variant_rates. honor_mitra TIDAK ADA di proyeksi dan daftar kolomnya dikunci sebagai assertion di tests/harga-publik.test.ts.';



CREATE TABLE IF NOT EXISTS "public"."honor_marks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "partner_id" "uuid" NOT NULL,
    "week_start" "date" NOT NULL,
    "dibayar_pada" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ditandai_oleh" "uuid",
    CONSTRAINT "honor_marks_awal_pekan_senin" CHECK ((EXTRACT(isodow FROM "week_start") = (1)::numeric))
);


ALTER TABLE "public"."honor_marks" OWNER TO "postgres";


COMMENT ON TABLE "public"."honor_marks" IS 'BUKTI bahwa seorang mitra sudah dibayar untuk satu pekan (unik per partner_id, week_start). APPEND-ONLY untuk peran API: week_start wajib Senin (CHECK honor_marks_awal_pekan_senin, berlaku untuk SEMUA peran karena tanda yatim tidak punya arti bagi siapa pun), ditandai_oleh & dibayar_pada direbut dari payload (trigger trg_jaga_tanda_honor), UPDATE ditolak seluruhnya (trigger trg_kunci_tanda_honor), DELETE sudah dicabut (cabut_hak_hapus_berlebih). Pembatalan yang sah adalah fakta baru — sebuah kolom pembatalan berjejak — bukan penghapusan atau penulisan ulang fakta lama.';



COMMENT ON COLUMN "public"."honor_marks"."ditandai_oleh" IS 'Pengguna yang menandai honor ini dibayar. TIDAK PERNAH dari payload: trigger trg_jaga_tanda_honor memaksanya menjadi auth.uid() untuk peran API. Terbukti bisa dipalsukan sebelum pagar itu ada — owner menandai honor atas nama admin — dan karena DELETE sudah dicabut, pemalsuannya permanen.';



CREATE TABLE IF NOT EXISTS "public"."jejak_jadwal" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sesi_id" "uuid" NOT NULL,
    "tindakan" "text" NOT NULL,
    "jenjang" smallint NOT NULL,
    "dari_tanggal" "date",
    "dari_jam" time without time zone,
    "ke_tanggal" "date",
    "ke_jam" time without time zone,
    "alasan" "text" DEFAULT ''::"text" NOT NULL,
    "darurat" boolean DEFAULT false NOT NULL,
    "aktor_id" "uuid",
    "peran_aktor" "text" NOT NULL,
    "dicatat_pada" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "jejak_jadwal_jenjang_check" CHECK ((("jenjang" >= 1) AND ("jenjang" <= 4))),
    CONSTRAINT "jejak_jadwal_tindakan_check" CHECK (("tindakan" = ANY (ARRAY['batal'::"text", 'jadwal_ulang'::"text", 'tukar_hak'::"text"])))
);


ALTER TABLE "public"."jejak_jadwal" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."jejak_status_bayar" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sesi_id" "uuid",
    "paket_klien_id" "uuid",
    "status_lama" "public"."pay_status",
    "status_baru" "public"."pay_status" NOT NULL,
    "aktor_id" "uuid",
    "peran_aktor" "text" NOT NULL,
    "dicatat_pada" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "jejak_sasaran_tunggal" CHECK (((("sesi_id" IS NOT NULL) AND ("paket_klien_id" IS NULL)) OR (("sesi_id" IS NULL) AND ("paket_klien_id" IS NOT NULL))))
);


ALTER TABLE "public"."jejak_status_bayar" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."material_assignments" (
    "material_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "ditugaskan_oleh" "uuid" NOT NULL,
    "ditugaskan_pada" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."material_assignments" OWNER TO "postgres";


COMMENT ON TABLE "public"."material_assignments" IS 'Penugasan materi ke pasien tertentu. SENGAJA tidak terbaca klien sama sekali: ia hanya perlu dievaluasi di dalam policy isi materi, dan klien tidak butuh tahu alasan materinya terbuka. `ditugaskan_oleh` mengikuti pola honor_marks.ditandai_oleh — keputusan yang membuka konten selalu menyebut siapa pelakunya.';



CREATE TABLE IF NOT EXISTS "public"."material_pages" (
    "material_id" "uuid" NOT NULL,
    "halaman" integer NOT NULL,
    "objek" "text" NOT NULL,
    "lebar" integer NOT NULL,
    "tinggi" integer NOT NULL,
    CONSTRAINT "material_pages_halaman_check" CHECK (("halaman" >= 1)),
    CONSTRAINT "material_pages_lebar_check" CHECK (("lebar" > 0)),
    CONSTRAINT "material_pages_tinggi_check" CHECK (("tinggi" > 0))
);


ALTER TABLE "public"."material_pages" OWNER TO "postgres";


COMMENT ON TABLE "public"."material_pages" IS 'Isi e-book (gambar halaman). DELETE dicabut total dari authenticated — satu-satunya jalur tulis adalah RPC ganti_halaman_materi(p_material_id, p_halaman), yang mengganti SELURUH halaman satu materi sekaligus dengan radius terkunci parameter, bukan filter PostgREST yang bisa dibuat tautologis.';



COMMENT ON COLUMN "public"."material_pages"."objek" IS 'Kunci objek di bucket privat `materi-halaman`. BUKAN URL, dan tidak boleh pernah menjadi URL: baris ini terbaca klien, sementara bucket-nya tidak memberi hak apa pun kepada `authenticated`.';



CREATE TABLE IF NOT EXISTS "public"."material_services" (
    "material_id" "uuid" NOT NULL,
    "service_id" "uuid" NOT NULL
);


ALTER TABLE "public"."material_services" OWNER TO "postgres";


COMMENT ON TABLE "public"."material_services" IS 'Materi <-> Layanan, banyak-ke-banyak dan BOLEH NOL BARIS. Materi tanpa baris di sini tidak pernah terbuka otomatis; ia hanya terbuka lewat material_assignments. Panel admin wajib menandai keadaan itu — materi yang terkunci diam-diam tidak memunculkan gejala apa pun.';



CREATE TABLE IF NOT EXISTS "public"."material_videos" (
    "material_id" "uuid" NOT NULL,
    "objek" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mime" "text" DEFAULT 'video/mp4'::"text" NOT NULL,
    CONSTRAINT "material_videos_bentuk_objek" CHECK (((("mime" = 'video/mp4'::"text") AND ("objek" ~ (('^'::"text" || ("material_id")::"text") || '/[A-Za-z0-9._-]{1,120}\.mp4$'::"text"))) OR (("mime" = 'video/webm'::"text") AND ("objek" ~ (('^'::"text" || ("material_id")::"text") || '/[A-Za-z0-9._-]{1,120}\.webm$'::"text"))))),
    CONSTRAINT "material_videos_mime_check" CHECK (("mime" = ANY (ARRAY['video/mp4'::"text", 'video/webm'::"text"])))
);


ALTER TABLE "public"."material_videos" OWNER TO "postgres";


COMMENT ON TABLE "public"."material_videos" IS 'Video materi, satu baris per materi (material_id = primary key). Penyuntingan lewat insert/upsert/update TETAP terbuka untuk staf; verba DELETE dicabut dari peran API karena satu permintaan berfilter tautologis melepas video SELURUH materi sekaligus. Pelepasan satu video lewat public.lepas_video_materi(materi_id). Penghapusan massal hanya lewat service role.';



COMMENT ON COLUMN "public"."material_videos"."objek" IS 'Kunci objek di bucket R2 privat, BUKAN URL. Bentuk: {material_id}/{acak}.{ext}';



CREATE TABLE IF NOT EXISTS "public"."materials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "judul" "text" NOT NULL,
    "tipe" "public"."material_type" NOT NULL,
    "deskripsi" "text" DEFAULT ''::"text" NOT NULL,
    "aktif" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."materials" OWNER TO "postgres";


COMMENT ON TABLE "public"."materials" IS 'Metadata materi. TIDAK PERNAH dihapus lewat peran API: penghapusannya menyapu material_services, material_pages & material_videos lewat ON DELETE CASCADE dalam satu permintaan. Bentuk pensiunnya adalah `aktif = false`, yang sudah disaring passport klien. DELETE hanya lewat service role. Isi e-book hidup di material_pages (gambar halaman), isi video di material_videos. Keterkaitan dengan layanan ada di material_services dan BOLEH KOSONG — materi tanpa layanan hanya terbuka lewat material_assignments, dan panel admin wajib menandainya.';



COMMENT ON COLUMN "public"."materials"."aktif" IS 'Ketersediaan materi. `false` berarti materi DITARIK: policy baca klien pada material_chapters & material_videos ikut menutup isinya (sejak migration gating_materi_hormati_aktif), jadi menonaktifkan bukan sekadar menyembunyikan kartu di UI. Baris `materials` sendiri TETAP terbaca semua pengguna login — menutupnya akan mengulangi bug partner_publik. Staf tetap membaca isi materi nonaktif lewat policy "chapters: staf"/"video: staf", karena materi yang ditarik harus bisa diperbaiki lalu diterbitkan lagi.';



CREATE TABLE IF NOT EXISTS "public"."packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_id" "uuid" NOT NULL,
    "nama" "text" NOT NULL,
    "jumlah_sesi" integer NOT NULL,
    "aktif" boolean DEFAULT true NOT NULL,
    CONSTRAINT "packages_jumlah_sesi_check" CHECK (("jumlah_sesi" > 0))
);


ALTER TABLE "public"."packages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."partners" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nama" "text" NOT NULL,
    "no_hp" "text" DEFAULT ''::"text" NOT NULL,
    "aktif" boolean DEFAULT true NOT NULL,
    "alamat" "text" DEFAULT ''::"text" NOT NULL,
    "lat" double precision,
    "lon" double precision
);


ALTER TABLE "public"."partners" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."partner_publik" WITH ("security_invoker"='off') AS
 SELECT "id",
    "nama"
   FROM "public"."partners";


ALTER VIEW "public"."partner_publik" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."phases" (
    "id" "text" NOT NULL,
    "nama_sanskrit" "text" NOT NULL,
    "nama" "text" NOT NULL,
    "urutan" integer NOT NULL
);


ALTER TABLE "public"."phases" OWNER TO "postgres";


COMMENT ON COLUMN "public"."phases"."id" IS 'Id fase — taksonomi produk, bukan data operasional: dipetakan LITERAL oleh FASE_SKRINING_KE_PHASE (src/app/admin/skrining/status.ts) dan enum FaseSkrining. TIDAK boleh ditulis ulang lewat peran API (trigger trg_jaga_identitas_fase); DELETE-nya sudah dicabut migration cabut_hak_hapus_berlebih dengan alasan yang sama. Fase baru lahir lewat migration, bersama pemetaannya di kode.';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "role" "public"."app_role" DEFAULT 'klien'::"public"."app_role" NOT NULL,
    "nama" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."role" IS 'Peran aplikasi. HANYA boleh diubah lewat service-role/SQL langsung; dijaga oleh hak kolom + trigger trg_guard_profile_role.';



CREATE TABLE IF NOT EXISTS "public"."screening_claims" (
    "screening_id" "uuid" NOT NULL,
    "token_hash" "text",
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "used_at" timestamp with time zone,
    "used_by" "uuid",
    CONSTRAINT "screening_claims_sekali_pakai" CHECK ((("used_at" IS NULL) = ("token_hash" IS NOT NULL)))
);


ALTER TABLE "public"."screening_claims" OWNER TO "postgres";


COMMENT ON TABLE "public"."screening_claims" IS 'Token penyambung skrining ANONIM ke akun: acak 32 byte, disimpan sebagai SHA-256, sekali pakai, berumur 2 jam. Dititipkan di cookie httpOnly. Umur pendek disengaja: satu HP di ruang tunggu tidak boleh membuat orang kedua mewarisi skrining orang pertama lengkap dengan jawaban kesehatannya. Tidak boleh terbaca peran API mana pun — hanya service role di server.';



CREATE TABLE IF NOT EXISTS "public"."screenings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kode" "text" NOT NULL,
    "nama" "text" NOT NULL,
    "no_hp" "text" NOT NULL,
    "fase" "text" NOT NULL,
    "jawaban" "jsonb" NOT NULL,
    "hasil" "public"."screening_result" NOT NULL,
    "flags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status_tindak_lanjut" "public"."screening_followup" DEFAULT 'baru'::"public"."screening_followup" NOT NULL,
    "client_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "screenings_flags_ringkas" CHECK (("length"(("flags")::"text") <= 8192)),
    CONSTRAINT "screenings_jawaban_ringkas" CHECK (("length"(("jawaban")::"text") <= 4096)),
    CONSTRAINT "screenings_nama_wajar" CHECK (("char_length"("nama") <= 80)),
    CONSTRAINT "screenings_no_hp_wajar" CHECK (("char_length"("no_hp") <= 25))
);


ALTER TABLE "public"."screenings" OWNER TO "postgres";


COMMENT ON CONSTRAINT "screenings_jawaban_ringkas" ON "public"."screenings" IS 'Pagar kedua anti penggelembungan jsonb data kesehatan lewat rute publik /api/skrining.';



CREATE TABLE IF NOT EXISTS "public"."service_variants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_id" "uuid" NOT NULL,
    "label" "text" DEFAULT ''::"text" NOT NULL,
    "durasi_menit" integer,
    "format" "public"."varian_format",
    "urutan" integer DEFAULT 0 NOT NULL,
    "aktif" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "service_variants_durasi_menit_check" CHECK ((("durasi_menit" IS NULL) OR ("durasi_menit" > 0)))
);


ALTER TABLE "public"."service_variants" OWNER TO "postgres";


COMMENT ON TABLE "public"."service_variants" IS 'Varian satu layanan: durasi, format (Private/Circle), atau program bernama (Basic/Couple/2 modul). Harga menempel di sini, bukan di services. Setiap layanan wajib punya minimal satu varian — layanan tanpa varian membuat setiap perhitungan harga bercabang dua selamanya. DELETE dicabut: varian yang pernah dipakai sesi adalah riwayat.';



CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phase_id" "text" NOT NULL,
    "nama" "text" NOT NULL,
    "deskripsi" "text" DEFAULT ''::"text" NOT NULL,
    "aktif" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "service_id" "uuid" NOT NULL,
    "client_package_id" "uuid",
    "partner_id" "uuid" NOT NULL,
    "tanggal" "date" NOT NULL,
    "status" "public"."session_status" DEFAULT 'terjadwal'::"public"."session_status" NOT NULL,
    "catatan" "text" DEFAULT ''::"text" NOT NULL,
    "rekomendasi" "text" DEFAULT ''::"text" NOT NULL,
    "status_bayar" "public"."pay_status" DEFAULT 'belum'::"public"."pay_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "booking_request_id" "uuid",
    "variant_id" "uuid" NOT NULL,
    "alamat" "text" DEFAULT ''::"text" NOT NULL,
    "alamat_lat" double precision,
    "alamat_lon" double precision,
    "jenjang" "public"."jenjang_transport",
    "jenjang_sumber" "public"."sumber_jenjang",
    "jenjang_alasan" "text" DEFAULT ''::"text" NOT NULL,
    "jam_mulai" time without time zone NOT NULL,
    "jadwal_ulang_terpakai" boolean DEFAULT false NOT NULL,
    CONSTRAINT "sessions_alasan_penimpaan" CHECK ((("jenjang_sumber" IS DISTINCT FROM 'admin'::"public"."sumber_jenjang") OR ("length"("btrim"("jenjang_alasan")) > 0))),
    CONSTRAINT "sessions_bayar_hanya_lepas" CHECK ((("client_package_id" IS NULL) OR ("status_bayar" = 'belum'::"public"."pay_status"))),
    CONSTRAINT "sessions_jam_bulat" CHECK (((EXTRACT(minute FROM "jam_mulai") = ANY (ARRAY[(0)::numeric, (30)::numeric])) AND (EXTRACT(second FROM "jam_mulai") = (0)::numeric)))
);


ALTER TABLE "public"."sessions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sessions"."booking_request_id" IS 'Permintaan jadwal yang melahirkan sesi ini; NULL untuk sesi yang dijadwalkan admin langsung.';



COMMENT ON COLUMN "public"."sessions"."variant_id" IS 'Varian layanan yang dipesan — sumber harga sesi ini. Berpasangan dengan service_id lewat FK gabungan sessions_varian_milik_layanan, sehingga varian milik layanan LAIN ditolak basis data, bukan sekadar oleh validator.';



COMMENT ON COLUMN "public"."sessions"."jenjang" IS 'Jenjang jarak mitra→alamat sesi. Data OPERASIONAL, bukan nominal: admin melihatnya untuk memilih mitra terdekat, dan rupiahnya diturunkan dari transport_rates menurut TANGGAL SESI. Menyimpan rupiah di sini akan menabrak money firewall sekaligus membekukan tarif yang seharusnya historis.';



COMMENT ON COLUMN "public"."sessions"."jam_mulai" IS 'Jam mulai sesi, disalin dari permintaan saat konfirmasi. Batas 24 jam & 2 jam pada C3 dihitung dari tanggal + jam ini, zona Asia/Jakarta.';



COMMENT ON CONSTRAINT "sessions_bayar_hanya_lepas" ON "public"."sessions" IS 'Sesi di dalam paket mengikuti status bayar paketnya; hanya sesi lepas yang memikul status_bayar sendiri. Menutup "tagihan hantu" di antrean verifikasi admin sekaligus pintu belakang bayar-dulu-lalu-masukkan-paket.';



CREATE OR REPLACE VIEW "public"."sesi_menunggu_jenjang_transport" WITH ("security_invoker"='off') AS
 SELECT "s"."id",
    "c"."nama" AS "nama_klien",
    "s"."tanggal"
   FROM ("public"."sessions" "s"
     JOIN "public"."clients" "c" ON (("c"."id" = "s"."client_id")))
  WHERE (("s"."jenjang" IS NULL) AND ("s"."status" = 'selesai'::"public"."session_status") AND ("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));


ALTER VIEW "public"."sesi_menunggu_jenjang_transport" OWNER TO "postgres";


COMMENT ON VIEW "public"."sesi_menunggu_jenjang_transport" IS 'Sesi SELESAI dengan jenjang null — jaraknya tidak pernah diketahui, baik karena lahir sebelum kolom ini ada maupun karena geocoding sesi baru gagal (Ruling 24). Satu-satunya definisi "menunggu jenjang ditetapkan", dipakai badge admin (hitungAntrean). Diperbaiki lewat `tetapkanJenjang` (app/admin/sesi/aksi.ts) yang sudah ada sejak Task 9 — yang hilang sebelumnya hanya antrean yang menunjuk sesi mana. security_invoker = off disengaja: batas kolomnya (id, nama_klien, tanggal; NOL NOMINAL) ada di view ini, dan predikat `user_role() in (admin,owner)` menjaga batas PERAN karena ketiga peran aplikasi login sebagai satu peran SQL authenticated yang sama.';



CREATE TABLE IF NOT EXISTS "public"."transport_khusus" (
    "session_id" "uuid" NOT NULL,
    "tarif_klien" integer NOT NULL,
    "honor_mitra" integer NOT NULL,
    "ditetapkan_oleh" "uuid",
    "ditetapkan_pada" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "transport_khusus_nilai_wajar" CHECK ((("tarif_klien" >= 0) AND ("honor_mitra" >= 0)))
);


ALTER TABLE "public"."transport_khusus" OWNER TO "postgres";


COMMENT ON TABLE "public"."transport_khusus" IS 'PENIMPA per kasus atas tarif dasar `di_atas_20` di `transport_rates`, ditetapkan owner per SESI. Sebelum migrasi tarif_dasar_di_atas_20 tabel ini adalah SATU-SATUNYA sumber nominal >20 km, dan itulah yang membuat pengajuan >20 km tidak pernah bisa ditagih. Sekarang ia opsional: ketiadaannya berarti tarif dasar yang berlaku, bukan tagihan yang tertahan.';



CREATE TABLE IF NOT EXISTS "public"."transport_rates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "jenjang" "public"."jenjang_transport" NOT NULL,
    "tarif_klien" integer NOT NULL,
    "honor_mitra" integer NOT NULL,
    "berlaku_sejak" "date" DEFAULT CURRENT_DATE NOT NULL,
    CONSTRAINT "transport_rates_nilai_wajar" CHECK ((("tarif_klien" >= 0) AND ("honor_mitra" >= 0)))
);


ALTER TABLE "public"."transport_rates" OWNER TO "postgres";


COMMENT ON TABLE "public"."transport_rates" IS 'Rate card transport per jenjang jarak, append-only berjenjang. Termasuk `di_atas_20` sebagai tarif DASAR sejak migrasi tarif_dasar_di_atas_20 — lihat komentar di berkas migrasi itu untuk alasannya. Owner menimpanya per kasus lewat `transport_khusus`, dan penimpa selalu menang.';



CREATE OR REPLACE VIEW "public"."sesi_menunggu_tarif_transport" WITH ("security_invoker"='off') AS
 SELECT "s"."id",
    "c"."nama" AS "nama_klien",
    "s"."tanggal"
   FROM ("public"."sessions" "s"
     JOIN "public"."clients" "c" ON (("c"."id" = "s"."client_id")))
  WHERE (("s"."jenjang" = 'di_atas_20'::"public"."jenjang_transport") AND ("s"."status" <> 'dibatalkan_padma'::"public"."session_status") AND (NOT (EXISTS ( SELECT 1
           FROM "public"."transport_khusus" "tk"
          WHERE ("tk"."session_id" = "s"."id")))) AND (NOT (EXISTS ( SELECT 1
           FROM "public"."transport_rates" "tr"
          WHERE (("tr"."jenjang" = 'di_atas_20'::"public"."jenjang_transport") AND ("tr"."berlaku_sejak" <= "s"."tanggal"))))) AND ("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));


ALTER VIEW "public"."sesi_menunggu_tarif_transport" OWNER TO "postgres";


COMMENT ON VIEW "public"."sesi_menunggu_tarif_transport" IS 'Sesi >20 km, bukan batal, yang TIDAK PUNYA NOMINAL SAMA SEKALI: tanpa baris transport_khusus DAN tanpa baris transport_rates di_atas_20 yang berlaku pada tanggal sesi. Sejak migrasi menunggu_tarif_hanya_tanpa_nominal, ketiadaan transport_khusus SAJA tidak lagi berarti menunggu — tarif DASAR di_atas_20 (migrasi tarif_dasar_di_atas_20) sudah cukup untuk menagih dan membayar, dan transport_khusus hanyalah PENIMPA opsional. Tetap satu-satunya definisi "menunggu tarif" untuk badge admin (hitungMenungguTarifTransport) MAUPUN daftar owner (ambilSesiMenungguTarif) lewat satu query yang sama. security_invoker = off disengaja: admin tidak punya, dan tidak perlu, hak baca transport_khusus/transport_rates — view inilah batas kolomnya (id, nama_klien, tanggal; NOL NOMINAL). Predikat user_role() in (admin,owner) menjaga batas PERAN: ketiga peran aplikasi login sebagai satu peran SQL authenticated yang sama.';



CREATE TABLE IF NOT EXISTS "public"."session_ratings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "partner_id" "uuid" NOT NULL,
    "variant_id" "uuid" NOT NULL,
    "bintang_layanan" smallint NOT NULL,
    "bintang_bidan" smallint NOT NULL,
    "komentar" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "session_ratings_bintang_bidan_check" CHECK ((("bintang_bidan" >= 1) AND ("bintang_bidan" <= 5))),
    CONSTRAINT "session_ratings_bintang_layanan_check" CHECK ((("bintang_layanan" >= 1) AND ("bintang_layanan" <= 5))),
    CONSTRAINT "session_ratings_komentar_check" CHECK (("length"("komentar") <= 1000))
);


ALTER TABLE "public"."session_ratings" OWNER TO "postgres";


COMMENT ON TABLE "public"."session_ratings" IS 'Penilaian sesi: DUA angka (layanan & bidan) plus komentar opsional. partner_id & variant_id adalah SALINAN keadaan saat sesi terjadi, bukan rujukan hidup — mitra pada sesi bisa berganti, dan penilaian tidak boleh ikut berpindah orang. TIDAK ADA view agregat: view agregat persis yang dulu membocorkan rate card lengkap ke admin di repo ini.';



CREATE OR REPLACE VIEW "public"."varian_harga_staf" WITH ("security_invoker"='off') AS
 SELECT DISTINCT ON ("variant_id") "variant_id",
    "harga_klien",
    "harga_coret",
    "berlaku_sejak"
   FROM "public"."variant_rates" "vr"
  WHERE (("berlaku_sejak" <= (("now"() AT TIME ZONE 'Asia/Jakarta'::"text"))::"date") AND ("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])))
  ORDER BY "variant_id", "berlaku_sejak" DESC;


ALTER VIEW "public"."varian_harga_staf" OWNER TO "postgres";


COMMENT ON VIEW "public"."varian_harga_staf" IS 'Harga KLIEN per varian untuk staf admin. Kolom honor_mitra sengaja tidak ada di sini — view ini batas kolomnya, bukan UI. Kosong bagi peran klien.';



ALTER TABLE ONLY "public"."app_setting_keys"
    ADD CONSTRAINT "app_setting_keys_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_session_id_key" UNIQUE ("session_id");



ALTER TABLE ONLY "public"."client_invites"
    ADD CONSTRAINT "client_invites_pkey" PRIMARY KEY ("client_id");



ALTER TABLE ONLY "public"."client_invites"
    ADD CONSTRAINT "client_invites_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."client_packages"
    ADD CONSTRAINT "client_packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_padma_id_key" UNIQUE ("padma_id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."geocode_cache"
    ADD CONSTRAINT "geocode_cache_pkey" PRIMARY KEY ("alamat_normal");



ALTER TABLE ONLY "public"."hak_sesi"
    ADD CONSTRAINT "hak_sesi_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."honor_marks"
    ADD CONSTRAINT "honor_marks_partner_id_week_start_key" UNIQUE ("partner_id", "week_start");



ALTER TABLE ONLY "public"."honor_marks"
    ADD CONSTRAINT "honor_marks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."jejak_jadwal"
    ADD CONSTRAINT "jejak_jadwal_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."jejak_status_bayar"
    ADD CONSTRAINT "jejak_status_bayar_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."material_assignments"
    ADD CONSTRAINT "material_assignments_pkey" PRIMARY KEY ("material_id", "client_id");



ALTER TABLE ONLY "public"."material_pages"
    ADD CONSTRAINT "material_pages_pkey" PRIMARY KEY ("material_id", "halaman");



ALTER TABLE ONLY "public"."material_services"
    ADD CONSTRAINT "material_services_pkey" PRIMARY KEY ("material_id", "service_id");



ALTER TABLE ONLY "public"."material_videos"
    ADD CONSTRAINT "material_videos_pkey" PRIMARY KEY ("material_id");



ALTER TABLE ONLY "public"."materials"
    ADD CONSTRAINT "materials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."partners"
    ADD CONSTRAINT "partners_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phases"
    ADD CONSTRAINT "phases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."screening_claims"
    ADD CONSTRAINT "screening_claims_pkey" PRIMARY KEY ("screening_id");



ALTER TABLE ONLY "public"."screening_claims"
    ADD CONSTRAINT "screening_claims_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."screenings"
    ADD CONSTRAINT "screenings_kode_key" UNIQUE ("kode");



ALTER TABLE ONLY "public"."screenings"
    ADD CONSTRAINT "screenings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_variants"
    ADD CONSTRAINT "service_variants_pasangan_layanan" UNIQUE ("service_id", "id");



ALTER TABLE ONLY "public"."service_variants"
    ADD CONSTRAINT "service_variants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_ratings"
    ADD CONSTRAINT "session_ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_ratings"
    ADD CONSTRAINT "session_ratings_session_id_key" UNIQUE ("session_id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_khusus"
    ADD CONSTRAINT "transport_khusus_pkey" PRIMARY KEY ("session_id");



ALTER TABLE ONLY "public"."transport_rates"
    ADD CONSTRAINT "transport_rates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_rates"
    ADD CONSTRAINT "transport_rates_unik_per_tanggal" UNIQUE ("jenjang", "berlaku_sejak");



ALTER TABLE ONLY "public"."variant_rates"
    ADD CONSTRAINT "variant_rates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."variant_rates"
    ADD CONSTRAINT "variant_rates_unik_per_tanggal" UNIQUE ("variant_id", "berlaku_sejak");



CREATE UNIQUE INDEX "booking_requests_antrean_unik" ON "public"."booking_requests" USING "btree" ("client_id", "service_id", "tanggal", "preferensi_waktu") WHERE ("status" = ANY (ARRAY['diminta'::"public"."booking_status", 'mencari_mitra'::"public"."booking_status", 'mitra_siap'::"public"."booking_status"]));



COMMENT ON INDEX "public"."booking_requests_antrean_unik" IS 'Dedup ANTREAN, bukan RIWAYAT: permintaan yang sudah dikonfirmasi/dibatalkan tidak boleh menghalangi klien mengajukan hal serupa lagi. Ketiga keadaan pra-konfirmasi ikut karena ketiganya masih menunggu jawaban PADMA.';



CREATE UNIQUE INDEX "booking_requests_skrining_unik" ON "public"."booking_requests" USING "btree" ("screening_id") WHERE ("screening_id" IS NOT NULL);



CREATE INDEX "booking_requests_variant_idx" ON "public"."booking_requests" USING "btree" ("variant_id");



CREATE INDEX "certificates_klien_layanan_idx" ON "public"."certificates" USING "btree" ("client_id", "service_id", "created_at" DESC);



CREATE INDEX "client_invites_expires_idx" ON "public"."client_invites" USING "btree" ("expires_at");



CREATE INDEX "clients_email_lower_idx" ON "public"."clients" USING "btree" ("lower"("email"));



CREATE INDEX "clients_user_id_idx" ON "public"."clients" USING "btree" ("user_id");



CREATE UNIQUE INDEX "clients_user_id_unik" ON "public"."clients" USING "btree" ("user_id") WHERE ("user_id" IS NOT NULL);



CREATE UNIQUE INDEX "hak_sesi_dipakai_sekali" ON "public"."hak_sesi" USING "btree" ("dipakai_sesi_id") WHERE ("dipakai_sesi_id" IS NOT NULL);



CREATE INDEX "hak_sesi_milik_klien" ON "public"."hak_sesi" USING "btree" ("client_id", "kedaluwarsa");



CREATE INDEX "jejak_jadwal_sesi" ON "public"."jejak_jadwal" USING "btree" ("sesi_id", "dicatat_pada");



CREATE INDEX "jejak_status_bayar_paket_idx" ON "public"."jejak_status_bayar" USING "btree" ("paket_klien_id");



CREATE INDEX "jejak_status_bayar_sesi_idx" ON "public"."jejak_status_bayar" USING "btree" ("sesi_id");



CREATE INDEX "service_variants_service_idx" ON "public"."service_variants" USING "btree" ("service_id", "urutan");



CREATE INDEX "session_ratings_klien_idx" ON "public"."session_ratings" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "session_ratings_mitra_idx" ON "public"."session_ratings" USING "btree" ("partner_id");



CREATE INDEX "session_ratings_varian_idx" ON "public"."session_ratings" USING "btree" ("variant_id");



CREATE UNIQUE INDEX "sessions_booking_request_unik" ON "public"."sessions" USING "btree" ("booking_request_id") WHERE ("booking_request_id" IS NOT NULL);



CREATE INDEX "sessions_client_idx" ON "public"."sessions" USING "btree" ("client_id");



CREATE INDEX "sessions_tanggal_idx" ON "public"."sessions" USING "btree" ("tanggal");



CREATE INDEX "sessions_variant_idx" ON "public"."sessions" USING "btree" ("variant_id");



CREATE INDEX "transport_rates_lookup_idx" ON "public"."transport_rates" USING "btree" ("jenjang", "berlaku_sejak" DESC);



CREATE INDEX "variant_rates_lookup_idx" ON "public"."variant_rates" USING "btree" ("variant_id", "berlaku_sejak" DESC);



CREATE OR REPLACE TRIGGER "clients_normalize_email" BEFORE INSERT OR UPDATE OF "email" ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_client_email"();



CREATE OR REPLACE TRIGGER "trg_catat_status_bayar_paket" AFTER UPDATE OF "status_bayar" ON "public"."client_packages" FOR EACH ROW EXECUTE FUNCTION "public"."catat_status_bayar"();



CREATE OR REPLACE TRIGGER "trg_catat_status_bayar_paket_insert" AFTER INSERT ON "public"."client_packages" FOR EACH ROW WHEN (("new"."status_bayar" IS DISTINCT FROM 'belum'::"public"."pay_status")) EXECUTE FUNCTION "public"."catat_status_bayar"();



CREATE OR REPLACE TRIGGER "trg_catat_status_bayar_sesi" AFTER UPDATE OF "status_bayar" ON "public"."sessions" FOR EACH ROW EXECUTE FUNCTION "public"."catat_status_bayar"();



CREATE OR REPLACE TRIGGER "trg_catat_status_bayar_sesi_insert" AFTER INSERT ON "public"."sessions" FOR EACH ROW WHEN (("new"."status_bayar" IS DISTINCT FROM 'belum'::"public"."pay_status")) EXECUTE FUNCTION "public"."catat_status_bayar"();



CREATE OR REPLACE TRIGGER "trg_client_packages_updated_at" BEFORE UPDATE ON "public"."client_packages" FOR EACH ROW EXECUTE FUNCTION "public"."sentuh_updated_at"();



CREATE OR REPLACE TRIGGER "trg_guard_booking_klien_batal" BEFORE UPDATE ON "public"."booking_requests" FOR EACH ROW EXECUTE FUNCTION "public"."guard_booking_klien_batal"();



CREATE OR REPLACE TRIGGER "trg_guard_booking_pembatas" BEFORE INSERT ON "public"."booking_requests" FOR EACH ROW EXECUTE FUNCTION "public"."guard_booking_pembatas"();



CREATE OR REPLACE TRIGGER "trg_guard_booking_perpindahan" BEFORE UPDATE ON "public"."booking_requests" FOR EACH ROW EXECUTE FUNCTION "public"."guard_booking_perpindahan"();



CREATE OR REPLACE TRIGGER "trg_guard_booking_skrining" BEFORE INSERT ON "public"."booking_requests" FOR EACH ROW EXECUTE FUNCTION "public"."guard_booking_skrining"();



CREATE OR REPLACE TRIGGER "trg_guard_booking_status" BEFORE INSERT OR UPDATE ON "public"."booking_requests" FOR EACH ROW EXECUTE FUNCTION "public"."guard_booking_status"();



CREATE OR REPLACE TRIGGER "trg_guard_client_link" BEFORE INSERT OR UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."guard_client_link"();



CREATE OR REPLACE TRIGGER "trg_guard_insert_bayar_paket" BEFORE INSERT ON "public"."client_packages" FOR EACH ROW EXECUTE FUNCTION "public"."guard_insert_status_bayar"();



CREATE OR REPLACE TRIGGER "trg_guard_insert_bayar_sesi" BEFORE INSERT ON "public"."sessions" FOR EACH ROW EXECUTE FUNCTION "public"."guard_insert_status_bayar"();



CREATE OR REPLACE TRIGGER "trg_guard_penilaian_sesi" BEFORE INSERT OR UPDATE ON "public"."session_ratings" FOR EACH ROW EXECUTE FUNCTION "public"."guard_penilaian_sesi"();



CREATE OR REPLACE TRIGGER "trg_guard_profile_role" BEFORE INSERT OR UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."guard_profile_role"();



CREATE OR REPLACE TRIGGER "trg_guard_sertifikat" BEFORE INSERT OR UPDATE ON "public"."certificates" FOR EACH ROW EXECUTE FUNCTION "public"."guard_sertifikat"();



CREATE OR REPLACE TRIGGER "trg_guard_sesi_perpindahan" BEFORE UPDATE ON "public"."sessions" FOR EACH ROW EXECUTE FUNCTION "public"."guard_sesi_perpindahan"();



CREATE OR REPLACE TRIGGER "trg_guard_tarif_transport_maju" BEFORE INSERT OR UPDATE ON "public"."transport_rates" FOR EACH ROW EXECUTE FUNCTION "public"."guard_tarif_transport_maju"();



CREATE OR REPLACE TRIGGER "trg_guard_tarif_varian_maju" BEFORE INSERT OR UPDATE ON "public"."variant_rates" FOR EACH ROW EXECUTE FUNCTION "public"."guard_tarif_varian_maju"();



CREATE OR REPLACE TRIGGER "trg_guard_transisi_bayar_paket" BEFORE UPDATE OF "status_bayar" ON "public"."client_packages" FOR EACH ROW EXECUTE FUNCTION "public"."guard_transisi_status_bayar"();



CREATE OR REPLACE TRIGGER "trg_guard_transisi_bayar_sesi" BEFORE UPDATE OF "status_bayar" ON "public"."sessions" FOR EACH ROW EXECUTE FUNCTION "public"."guard_transisi_status_bayar"();



CREATE OR REPLACE TRIGGER "trg_jaga_identitas_fase" BEFORE UPDATE ON "public"."phases" FOR EACH ROW EXECUTE FUNCTION "public"."jaga_identitas_fase"();



CREATE OR REPLACE TRIGGER "trg_jaga_identitas_setelan" BEFORE UPDATE ON "public"."app_settings" FOR EACH ROW EXECUTE FUNCTION "public"."jaga_identitas_setelan"();



CREATE OR REPLACE TRIGGER "trg_jaga_tanda_honor" BEFORE INSERT ON "public"."honor_marks" FOR EACH ROW EXECUTE FUNCTION "public"."jaga_tanda_honor"();



CREATE OR REPLACE TRIGGER "trg_jaga_transport_khusus" BEFORE INSERT ON "public"."transport_khusus" FOR EACH ROW EXECUTE FUNCTION "public"."jaga_transport_khusus"();



CREATE OR REPLACE TRIGGER "trg_kunci_riwayat_tarif_transport" BEFORE UPDATE ON "public"."transport_rates" FOR EACH ROW EXECUTE FUNCTION "public"."kunci_riwayat_tarif_transport"();



CREATE OR REPLACE TRIGGER "trg_kunci_riwayat_tarif_varian" BEFORE UPDATE ON "public"."variant_rates" FOR EACH ROW EXECUTE FUNCTION "public"."kunci_riwayat_tarif_varian"();



CREATE OR REPLACE TRIGGER "trg_kunci_tanda_honor" BEFORE UPDATE ON "public"."honor_marks" FOR EACH ROW EXECUTE FUNCTION "public"."kunci_tanda_honor"();



CREATE OR REPLACE TRIGGER "trg_kunci_transport_khusus" BEFORE UPDATE ON "public"."transport_khusus" FOR EACH ROW EXECUTE FUNCTION "public"."kunci_transport_khusus"();



CREATE OR REPLACE TRIGGER "trg_paksa_aktor_penugasan" BEFORE INSERT OR UPDATE ON "public"."material_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."paksa_aktor_penugasan"();



CREATE OR REPLACE TRIGGER "trg_service_variants_updated_at" BEFORE UPDATE ON "public"."service_variants" FOR EACH ROW EXECUTE FUNCTION "public"."sentuh_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sessions_updated_at" BEFORE UPDATE ON "public"."sessions" FOR EACH ROW EXECUTE FUNCTION "public"."sentuh_updated_at"();



CREATE OR REPLACE TRIGGER "trg_terbitkan_varian_baku" AFTER INSERT ON "public"."services" FOR EACH ROW EXECUTE FUNCTION "public"."terbitkan_varian_baku"();



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_key_terdaftar" FOREIGN KEY ("key") REFERENCES "public"."app_setting_keys"("key");



COMMENT ON CONSTRAINT "app_settings_key_terdaftar" ON "public"."app_settings" IS 'Hanya kunci terdaftar yang boleh ada. FK dipilih, bukan CHECK berisi daftar literal, supaya daftarnya bisa dibaca panel (label + bentuk) dan supaya menghapus kunci yang masih dipakai ikut tertahan. Berlaku untuk SEMUA peran — service role dan SECURITY DEFINER tidak dikecualikan.';



ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id");



ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_screening_id_fkey" FOREIGN KEY ("screening_id") REFERENCES "public"."screenings"("id");



ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_varian_milik_layanan" FOREIGN KEY ("service_id", "variant_id") REFERENCES "public"."service_variants"("service_id", "id");



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_diunggah_oleh_fkey" FOREIGN KEY ("diunggah_oleh") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_invites"
    ADD CONSTRAINT "client_invites_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_invites"
    ADD CONSTRAINT "client_invites_used_by_fkey" FOREIGN KEY ("used_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."client_packages"
    ADD CONSTRAINT "client_packages_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_packages"
    ADD CONSTRAINT "client_packages_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "public"."phases"("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."hak_sesi"
    ADD CONSTRAINT "hak_sesi_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hak_sesi"
    ADD CONSTRAINT "hak_sesi_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."honor_marks"
    ADD CONSTRAINT "honor_marks_ditandai_oleh_fkey" FOREIGN KEY ("ditandai_oleh") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."honor_marks"
    ADD CONSTRAINT "honor_marks_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id");



ALTER TABLE ONLY "public"."material_assignments"
    ADD CONSTRAINT "material_assignments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_assignments"
    ADD CONSTRAINT "material_assignments_ditugaskan_oleh_fkey" FOREIGN KEY ("ditugaskan_oleh") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."material_assignments"
    ADD CONSTRAINT "material_assignments_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_pages"
    ADD CONSTRAINT "material_pages_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_services"
    ADD CONSTRAINT "material_services_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_services"
    ADD CONSTRAINT "material_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_videos"
    ADD CONSTRAINT "material_videos_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."screening_claims"
    ADD CONSTRAINT "screening_claims_screening_id_fkey" FOREIGN KEY ("screening_id") REFERENCES "public"."screenings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."screening_claims"
    ADD CONSTRAINT "screening_claims_used_by_fkey" FOREIGN KEY ("used_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."screenings"
    ADD CONSTRAINT "screenings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."service_variants"
    ADD CONSTRAINT "service_variants_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "public"."phases"("id");



ALTER TABLE ONLY "public"."session_ratings"
    ADD CONSTRAINT "session_ratings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_ratings"
    ADD CONSTRAINT "session_ratings_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id");



ALTER TABLE ONLY "public"."session_ratings"
    ADD CONSTRAINT "session_ratings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_ratings"
    ADD CONSTRAINT "session_ratings_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."service_variants"("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_requests"("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_client_package_id_fkey" FOREIGN KEY ("client_package_id") REFERENCES "public"."client_packages"("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_varian_milik_layanan" FOREIGN KEY ("service_id", "variant_id") REFERENCES "public"."service_variants"("service_id", "id");



ALTER TABLE ONLY "public"."transport_khusus"
    ADD CONSTRAINT "transport_khusus_ditetapkan_oleh_fkey" FOREIGN KEY ("ditetapkan_oleh") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."transport_khusus"
    ADD CONSTRAINT "transport_khusus_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."variant_rates"
    ADD CONSTRAINT "variant_rates_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."service_variants"("id");



ALTER TABLE "public"."app_setting_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "booking: klien ajukan" ON "public"."booking_requests" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."clients" "c"
  WHERE (("c"."id" = "booking_requests"."client_id") AND ("c"."user_id" = "auth"."uid"())))));



CREATE POLICY "booking: klien baca miliknya" ON "public"."booking_requests" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."clients" "c"
  WHERE (("c"."id" = "booking_requests"."client_id") AND ("c"."user_id" = "auth"."uid"())))));



CREATE POLICY "booking: klien membatalkan miliknya" ON "public"."booking_requests" FOR UPDATE TO "authenticated" USING (("client_id" IN ( SELECT "c"."id"
   FROM "public"."clients" "c"
  WHERE ("c"."user_id" = "auth"."uid"())))) WITH CHECK (("client_id" IN ( SELECT "c"."id"
   FROM "public"."clients" "c"
  WHERE ("c"."user_id" = "auth"."uid"()))));



CREATE POLICY "booking: staf" ON "public"."booking_requests" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



ALTER TABLE "public"."booking_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."certificates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_packages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_packages: milik sendiri" ON "public"."client_packages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."clients" "c"
  WHERE (("c"."id" = "client_packages"."client_id") AND ("c"."user_id" = "auth"."uid"())))));



CREATE POLICY "client_packages: staf" ON "public"."client_packages" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients: milik sendiri" ON "public"."clients" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "clients: staf" ON "public"."clients" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



ALTER TABLE "public"."geocode_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "geocode_cache: staf" ON "public"."geocode_cache" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



ALTER TABLE "public"."hak_sesi" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "hak_sesi: klien baca miliknya" ON "public"."hak_sesi" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "c"."id"
   FROM "public"."clients" "c"
  WHERE ("c"."user_id" = "auth"."uid"()))));



CREATE POLICY "hak_sesi: staf" ON "public"."hak_sesi" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



CREATE POLICY "halaman: klien berhak" ON "public"."material_pages" FOR SELECT TO "authenticated" USING ("public"."berhak_isi_materi"("material_id"));



CREATE POLICY "halaman: staf kelola" ON "public"."material_pages" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



CREATE POLICY "honor: hanya owner" ON "public"."honor_marks" TO "authenticated" USING (("public"."user_role"() = 'owner'::"public"."app_role")) WITH CHECK (("public"."user_role"() = 'owner'::"public"."app_role"));



ALTER TABLE "public"."honor_marks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "jejak: staf baca" ON "public"."jejak_status_bayar" FOR SELECT TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



ALTER TABLE "public"."jejak_jadwal" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "jejak_jadwal: staf baca" ON "public"."jejak_jadwal" FOR SELECT TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



ALTER TABLE "public"."jejak_status_bayar" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "materi-layanan: baca semua pengguna login" ON "public"."material_services" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "materi-layanan: staf kelola" ON "public"."material_services" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



ALTER TABLE "public"."material_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."material_pages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."material_services" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."material_videos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."materials" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "materials: baca meta" ON "public"."materials" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "materials: staf kelola" ON "public"."materials" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



ALTER TABLE "public"."packages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "packages: baca" ON "public"."packages" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "packages: baca publik" ON "public"."packages" FOR SELECT TO "anon" USING (("aktif" = true));



CREATE POLICY "packages: staf kelola" ON "public"."packages" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



ALTER TABLE "public"."partners" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "partners: staf" ON "public"."partners" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



CREATE POLICY "penilaian: klien baca miliknya" ON "public"."session_ratings" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "c"."id"
   FROM "public"."clients" "c"
  WHERE ("c"."user_id" = "auth"."uid"()))));



CREATE POLICY "penilaian: klien memperbarui miliknya" ON "public"."session_ratings" FOR UPDATE TO "authenticated" USING (("client_id" IN ( SELECT "c"."id"
   FROM "public"."clients" "c"
  WHERE ("c"."user_id" = "auth"."uid"())))) WITH CHECK (("client_id" IN ( SELECT "c"."id"
   FROM "public"."clients" "c"
  WHERE ("c"."user_id" = "auth"."uid"()))));



CREATE POLICY "penilaian: klien menilai" ON "public"."session_ratings" FOR INSERT TO "authenticated" WITH CHECK (("client_id" IN ( SELECT "c"."id"
   FROM "public"."clients" "c"
  WHERE ("c"."user_id" = "auth"."uid"()))));



CREATE POLICY "penilaian: staf baca" ON "public"."session_ratings" FOR SELECT TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



CREATE POLICY "penugasan: staf kelola" ON "public"."material_assignments" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



ALTER TABLE "public"."phases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "phases: baca" ON "public"."phases" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "phases: baca publik" ON "public"."phases" FOR SELECT TO "anon" USING (true);



CREATE POLICY "phases: staf kelola" ON "public"."phases" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



CREATE POLICY "profil: baca sendiri atau staf" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR ("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))));



CREATE POLICY "profil: staf ubah" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "registri kunci: staf baca" ON "public"."app_setting_keys" FOR SELECT TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



ALTER TABLE "public"."screening_claims" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."screenings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "screenings: klien baca miliknya" ON "public"."screenings" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "c"."id"
   FROM "public"."clients" "c"
  WHERE ("c"."user_id" = "auth"."uid"()))));



CREATE POLICY "screenings: staf" ON "public"."screenings" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



CREATE POLICY "sertifikat: klien baca miliknya" ON "public"."certificates" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "c"."id"
   FROM "public"."clients" "c"
  WHERE ("c"."user_id" = "auth"."uid"()))));



CREATE POLICY "sertifikat: staf kelola" ON "public"."certificates" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



ALTER TABLE "public"."service_variants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_variants: baca publik" ON "public"."service_variants" FOR SELECT TO "anon" USING (("aktif" = true));



CREATE POLICY "service_variants: baca terautentikasi" ON "public"."service_variants" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "service_variants: staf kelola" ON "public"."service_variants" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "services: baca" ON "public"."services" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "services: baca publik" ON "public"."services" FOR SELECT TO "anon" USING (("aktif" = true));



CREATE POLICY "services: staf kelola" ON "public"."services" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



ALTER TABLE "public"."session_ratings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sessions: milik sendiri" ON "public"."sessions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."clients" "c"
  WHERE (("c"."id" = "sessions"."client_id") AND ("c"."user_id" = "auth"."uid"())))));



CREATE POLICY "sessions: staf" ON "public"."sessions" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



CREATE POLICY "settings: staf" ON "public"."app_settings" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));



ALTER TABLE "public"."transport_khusus" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_khusus: hanya owner" ON "public"."transport_khusus" TO "authenticated" USING (("public"."user_role"() = 'owner'::"public"."app_role")) WITH CHECK (("public"."user_role"() = 'owner'::"public"."app_role"));



ALTER TABLE "public"."transport_rates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_rates: hanya owner" ON "public"."transport_rates" TO "authenticated" USING (("public"."user_role"() = 'owner'::"public"."app_role")) WITH CHECK (("public"."user_role"() = 'owner'::"public"."app_role"));



ALTER TABLE "public"."variant_rates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "variant_rates: hanya owner" ON "public"."variant_rates" TO "authenticated" USING (("public"."user_role"() = 'owner'::"public"."app_role")) WITH CHECK (("public"."user_role"() = 'owner'::"public"."app_role"));



CREATE POLICY "video: klien dgn sesi selesai" ON "public"."material_videos" FOR SELECT TO "authenticated" USING ("public"."berhak_isi_materi"("material_id"));



CREATE POLICY "video: staf" ON "public"."material_videos" TO "authenticated" USING (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"]))) WITH CHECK (("public"."user_role"() = ANY (ARRAY['admin'::"public"."app_role", 'owner'::"public"."app_role"])));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."batalkan_lewat_tenggat"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."batalkan_lewat_tenggat"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."batalkan_sesi"("sesi_id" "uuid", "alasan" "text", "darurat" boolean, "oleh" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."batalkan_sesi"("sesi_id" "uuid", "alasan" "text", "darurat" boolean, "oleh" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."batalkan_sesi"("sesi_id" "uuid", "alasan" "text", "darurat" boolean, "oleh" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."berhak_isi_materi"("p_material_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."berhak_isi_materi"("p_material_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."berhak_isi_materi"("p_material_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."catat_status_bayar"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."catat_status_bayar"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."catat_status_bayar"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ganti_halaman_materi"("p_material_id" "uuid", "p_halaman" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ganti_halaman_materi"("p_material_id" "uuid", "p_halaman" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ganti_halaman_materi"("p_material_id" "uuid", "p_halaman" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_booking_klien_batal"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_booking_klien_batal"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_booking_klien_batal"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_booking_pembatas"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_booking_pembatas"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_booking_pembatas"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_booking_perpindahan"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_booking_perpindahan"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_booking_perpindahan"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_booking_skrining"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_booking_skrining"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_booking_skrining"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_booking_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_booking_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_booking_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_client_link"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_client_link"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_insert_status_bayar"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_insert_status_bayar"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_insert_status_bayar"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_penilaian_sesi"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_penilaian_sesi"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_penilaian_sesi"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_profile_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_profile_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_profile_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_sertifikat"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_sertifikat"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_sertifikat"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_sesi_perpindahan"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_sesi_perpindahan"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_sesi_perpindahan"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_tarif_transport_maju"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_tarif_transport_maju"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_tarif_varian_maju"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_tarif_varian_maju"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_transisi_status_bayar"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_transisi_status_bayar"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_transisi_status_bayar"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."jadwal_ulang_sesi"("sesi_id" "uuid", "tanggal_baru" "date", "jam_baru" time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."jadwal_ulang_sesi"("sesi_id" "uuid", "tanggal_baru" "date", "jam_baru" time without time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."jadwal_ulang_sesi"("sesi_id" "uuid", "tanggal_baru" "date", "jam_baru" time without time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."jaga_identitas_fase"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."jaga_identitas_fase"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."jaga_identitas_setelan"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."jaga_identitas_setelan"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."jaga_tanda_honor"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."jaga_tanda_honor"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."jaga_transport_khusus"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."jaga_transport_khusus"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."jam_layanan_terpakai"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."jam_layanan_terpakai"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."jam_layanan_terpakai"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."jarak_km"("lat1" double precision, "lon1" double precision, "lat2" double precision, "lon2" double precision) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."jarak_km"("lat1" double precision, "lon1" double precision, "lat2" double precision, "lon2" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."jarak_km"("lat1" double precision, "lon1" double precision, "lat2" double precision, "lon2" double precision) TO "service_role";



REVOKE ALL ON FUNCTION "public"."jenjang_dari_jarak"("km" double precision) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."jenjang_dari_jarak"("km" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."jenjang_dari_jarak"("km" double precision) TO "service_role";



REVOKE ALL ON FUNCTION "public"."jenjang_pembatalan"("tanggal" "date", "jam" time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."jenjang_pembatalan"("tanggal" "date", "jam" time without time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."jenjang_pembatalan"("tanggal" "date", "jam" time without time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."klaim_sudah_bayar"("jenis" "text", "sasaran_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."klaim_sudah_bayar"("jenis" "text", "sasaran_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."klaim_sudah_bayar"("jenis" "text", "sasaran_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."konfirmasi_permintaan"("permintaan_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."konfirmasi_permintaan"("permintaan_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."konfirmasi_permintaan"("permintaan_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."kunci_riwayat_tarif_transport"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kunci_riwayat_tarif_transport"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."kunci_riwayat_tarif_varian"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kunci_riwayat_tarif_varian"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."kunci_tanda_honor"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kunci_tanda_honor"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."kunci_transport_khusus"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kunci_transport_khusus"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."lepas_video_materi"("materi_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lepas_video_materi"("materi_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lepas_video_materi"("materi_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."normalize_client_email"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."normalize_client_email"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_client_email"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."paksa_aktor_penugasan"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."paksa_aktor_penugasan"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."perbarui_profil_klien"("p_nama" "text", "p_no_hp" "text", "p_alamat" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."perbarui_profil_klien"("p_nama" "text", "p_no_hp" "text", "p_alamat" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."perbarui_profil_klien"("p_nama" "text", "p_no_hp" "text", "p_alamat" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."perpindahan_permintaan_sah"("dari" "public"."booking_status", "ke" "public"."booking_status") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."perpindahan_permintaan_sah"("dari" "public"."booking_status", "ke" "public"."booking_status") TO "authenticated";
GRANT ALL ON FUNCTION "public"."perpindahan_permintaan_sah"("dari" "public"."booking_status", "ke" "public"."booking_status") TO "service_role";



REVOKE ALL ON FUNCTION "public"."perpindahan_sesi_sah"("dari" "public"."session_status", "ke" "public"."session_status") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."perpindahan_sesi_sah"("dari" "public"."session_status", "ke" "public"."session_status") TO "authenticated";
GRANT ALL ON FUNCTION "public"."perpindahan_sesi_sah"("dari" "public"."session_status", "ke" "public"."session_status") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sentuh_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sentuh_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sentuh_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."terbitkan_varian_baku"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."terbitkan_varian_baku"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tukar_hak_sesi"("hak_id" "uuid", "tanggal_baru" "date", "jam_baru" time without time zone, "mitra" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tukar_hak_sesi"("hak_id" "uuid", "tanggal_baru" "date", "jam_baru" time without time zone, "mitra" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."tukar_hak_sesi"("hak_id" "uuid", "tanggal_baru" "date", "jam_baru" time without time zone, "mitra" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_role"() TO "service_role";


















GRANT ALL ON TABLE "public"."app_setting_keys" TO "service_role";
GRANT SELECT ON TABLE "public"."app_setting_keys" TO "authenticated";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."app_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."booking_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_requests" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."certificates" TO "authenticated";
GRANT ALL ON TABLE "public"."certificates" TO "service_role";



GRANT ALL ON TABLE "public"."client_invites" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."client_packages" TO "authenticated";
GRANT ALL ON TABLE "public"."client_packages" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."geocode_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."geocode_cache" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."hak_sesi" TO "authenticated";
GRANT ALL ON TABLE "public"."hak_sesi" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."variant_rates" TO "authenticated";
GRANT ALL ON TABLE "public"."variant_rates" TO "service_role";



GRANT ALL ON TABLE "public"."harga_publik" TO "service_role";
GRANT SELECT ON TABLE "public"."harga_publik" TO "anon";
GRANT SELECT ON TABLE "public"."harga_publik" TO "authenticated";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."honor_marks" TO "authenticated";
GRANT ALL ON TABLE "public"."honor_marks" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."jejak_jadwal" TO "authenticated";
GRANT ALL ON TABLE "public"."jejak_jadwal" TO "service_role";



GRANT ALL ON TABLE "public"."jejak_status_bayar" TO "service_role";
GRANT SELECT ON TABLE "public"."jejak_status_bayar" TO "authenticated";



GRANT ALL ON TABLE "public"."material_assignments" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."material_assignments" TO "authenticated";



GRANT ALL ON TABLE "public"."material_pages" TO "service_role";
GRANT SELECT ON TABLE "public"."material_pages" TO "authenticated";



GRANT ALL ON TABLE "public"."material_services" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."material_services" TO "authenticated";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."material_videos" TO "authenticated";
GRANT ALL ON TABLE "public"."material_videos" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."materials" TO "authenticated";
GRANT ALL ON TABLE "public"."materials" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."packages" TO "authenticated";
GRANT ALL ON TABLE "public"."packages" TO "service_role";
GRANT SELECT ON TABLE "public"."packages" TO "anon";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."partners" TO "authenticated";
GRANT ALL ON TABLE "public"."partners" TO "service_role";



GRANT ALL ON TABLE "public"."partner_publik" TO "service_role";
GRANT SELECT ON TABLE "public"."partner_publik" TO "authenticated";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."phases" TO "authenticated";
GRANT ALL ON TABLE "public"."phases" TO "service_role";
GRANT SELECT ON TABLE "public"."phases" TO "anon";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT UPDATE("nama") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."screening_claims" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."screenings" TO "authenticated";
GRANT ALL ON TABLE "public"."screenings" TO "service_role";



GRANT ALL ON TABLE "public"."service_variants" TO "service_role";
GRANT SELECT ON TABLE "public"."service_variants" TO "anon";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."service_variants" TO "authenticated";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";
GRANT SELECT ON TABLE "public"."services" TO "anon";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions" TO "service_role";



GRANT ALL ON TABLE "public"."sesi_menunggu_jenjang_transport" TO "service_role";
GRANT SELECT ON TABLE "public"."sesi_menunggu_jenjang_transport" TO "authenticated";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."transport_khusus" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_khusus" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."transport_rates" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_rates" TO "service_role";



GRANT ALL ON TABLE "public"."sesi_menunggu_tarif_transport" TO "service_role";
GRANT SELECT ON TABLE "public"."sesi_menunggu_tarif_transport" TO "authenticated";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."session_ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."session_ratings" TO "service_role";



GRANT ALL ON TABLE "public"."varian_harga_staf" TO "service_role";
GRANT SELECT ON TABLE "public"."varian_harga_staf" TO "authenticated";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" REVOKE ALL ON FUNCTIONS FROM PUBLIC;




























