-- ============================================================================
-- RANTAI STATUS C1 (2/2): PAGAR, INDEKS, DAN PERPINDAHAN
-- ============================================================================
-- Berkas terpisah dari yang menambah nilai enum — lihat alasan 55P04 di sana.
--
-- Tiga hal dikerjakan di sini:
--   1. indeks antrean mengikuti rantai yang kini punya TIGA keadaan pra-konfirmasi;
--   2. dua penjaga lama (`guard_booking_status`, `guard_booking_pembatas`) ditulis
--      ulang karena keduanya menyimpan literal 'menunggu' sebagai TEKS di dalam
--      badan fungsi — sesudah RENAME literal itu bukan lagi anggota enum, dan
--      pemanggilannya akan gagal 22P02 saat dijalankan, bukan saat migrasi;
--   3. penjaga BARU: perpindahan status yang sah.
--
-- Kenapa penjaga perpindahan ada di DB dan bukan cukup di server action: klien
-- memegang policy INSERT atas `booking_requests` dan bisa memanggil PostgREST
-- langsung dengan anon key + JWT-nya sendiri — persis alasan
-- `guard_booking_pembatas` ada. Dan staf memegang policy `for all`, sehingga
-- satu server action baru yang lupa memeriksa urutan sudah cukup untuk membuat
-- permintaan melompat dari 'diminta' ke 'dikonfirmasi' tanpa pernah punya mitra.

-- ---------------------------------------------------------------------------
-- (1) INDEKS ANTREAN
--
-- Predikat lama `where status = 'menunggu'` kini terbaca `where status =
-- 'diminta'` (RENAME mempertahankan indeks apa adanya), dan itu SALAH sesudah
-- rantai diperpanjang: begitu admin menekan "Cari bidan", permintaan pindah ke
-- 'mencari_mitra' dan keluar dari predikat — sehingga klien bisa mengirim
-- permintaan kembar untuk tanggal, jam, dan layanan yang sama.
drop index if exists public.booking_requests_antrean_unik;

create unique index booking_requests_antrean_unik
  on public.booking_requests (client_id, service_id, tanggal, preferensi_waktu)
  where status in ('diminta', 'mencari_mitra', 'mitra_siap');

comment on index public.booking_requests_antrean_unik is
  'Dedup ANTREAN, bukan RIWAYAT: permintaan yang sudah dikonfirmasi/dibatalkan '
  'tidak boleh menghalangi klien mengajukan hal serupa lagi. Ketiga keadaan '
  'pra-konfirmasi ikut karena ketiganya masih menunggu jawaban PADMA.';

-- ---------------------------------------------------------------------------
-- (2a) PENJAGA NILAI STATUS — ditulis ulang untuk nama baru.
--
-- Isi aturannya TIDAK berubah dari versi 20260829130000: permintaan baru dari
-- klien selalu berstatus awal, dan klien tidak boleh menggeser status sama
-- sekali. Yang berubah hanya nama keadaan awalnya. Kelonggaran untuk pembatalan
-- oleh klien (spec J8) datang di migration `pembatalan_oleh_klien`, BUKAN di
-- sini — supaya perubahan nama dan perubahan kewenangan tidak bercampur dalam
-- satu diff yang tidak bisa dibaca.
create or replace function public.guard_booking_status()
returns trigger
language plpgsql
as $$
begin
  -- Bersarang, bukan `and`: plpgsql tidak menjamin short-circuit.
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if user_role() = 'klien' then
      if tg_op = 'INSERT' and new.status is distinct from 'diminta'::booking_status then
        raise exception 'permintaan jadwal baru selalu berstatus diminta'
          using errcode = '42501';
      end if;
      if tg_op = 'UPDATE' and new.status is distinct from old.status then
        raise exception 'status permintaan jadwal hanya boleh diubah staf'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_booking_status() from public, anon;

-- ---------------------------------------------------------------------------
-- (2b) PEMBATAS ANTREAN — ditulis ulang untuk rantai yang lebih panjang.
--
-- Perubahan tunggalnya ada pada hitungan antrean: `status = 'menunggu'` menjadi
-- `status in (…)` atas ketiga keadaan pra-konfirmasi. Tanpa itu, batas 5
-- permintaan bisa dilewati begitu admin memindahkan satu permintaan ke
-- 'mencari_mitra' — permintaan itu keluar dari hitungan sementara klien masih
-- benar-benar menunggu jawabannya.
--
-- Sisa badan fungsi disalin apa adanya dari 20260829140000, TERMASUK komentar
-- alasannya, karena `create or replace function` mengganti seluruh badan: apa
-- yang tidak disalin, hilang. Kunci advisory per-klien tetap diambil SEBELUM
-- hitungan — tanpa itu 50 insert paralel membaca angka yang sama (0) lalu
-- semuanya lolos.
create or replace function public.guard_booking_pembatas()
returns trigger
language plpgsql
as $$
declare
  batas constant int := 5;  -- sinkron dengan BATAS_PERMINTAAN_MENUNGGU
  antre int;
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

      -- (c) Batas panjang antrean, dengan kunci advisory per-klien lebih dulu.
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
-- (3) PERPINDAHAN STATUS YANG SAH
--
-- Dipisah menjadi FUNGSI PENILAI (`…_sah`) dan TRIGGER, bukan satu badan
-- trigger raksasa. Alasannya bisa diuji: fungsi penilai dapat dipanggil
-- langsung dari uji untuk SELURUH pasangan (dari, ke) — 30 pasangan untuk
-- permintaan, 20 untuk sesi — tanpa membuat satu pun baris fixture. Trigger
-- saja hanya bisa diuji lewat baris nyata, dan uji yang mahal adalah uji yang
-- lubangnya tidak pernah ditutup.
--
-- Petanya WAJIB identik dengan `PERPINDAHAN_PERMINTAAN` di
-- src/lib/jadwal/status.ts. Dua daftar yang harus identik adalah jenis
-- kesalahan yang paling mudah terjadi; karena itu
-- tests/rantai-status-db.test.ts membaca KEDUANYA dan membandingkannya,
-- alih-alih menulis daftar ketiga.
create or replace function public.perpindahan_permintaan_sah(
  dari booking_status,
  ke booking_status
) returns boolean
language sql
immutable
as $$
  select case dari
    when 'diminta'          then ke in ('mencari_mitra', 'dibatalkan_klien')
    when 'mencari_mitra'    then ke in ('mitra_siap', 'diminta', 'dibatalkan_klien')
    when 'mitra_siap'       then ke in ('dikonfirmasi', 'mencari_mitra', 'dibatalkan_klien')
    -- Tidak ada panah keluar dari 'dikonfirmasi', termasuk panah mundur
    -- "pemulihan": konfirmasi dikerjakan sebagai SATU transaksi lewat
    -- `konfirmasi_permintaan()` (migration konfirmasi_atomik), jadi tidak ada
    -- keadaan setengah jadi yang perlu diputar balik.
    when 'dikonfirmasi'     then false
    when 'dibatalkan_klien' then false
    when 'ditolak'          then false
  end;
$$;

revoke execute on function public.perpindahan_permintaan_sah(booking_status, booking_status)
  from public, anon;

-- ===== PENJAGA INTEGRITAS TIDAK BERGERBANG PERAN =====
-- Perhatikan bahwa fungsi di bawah TIDAK dibungkus
-- `if current_user in ('anon','authenticated','authenticator') and user_role() = 'klien'`,
-- berbeda dari `guard_booking_status` beberapa puluh baris di atas.
--
-- Itu disengaja, dan bukan kelalaian menyalin. Kedua fungsi menjawab pertanyaan
-- yang berbeda:
--
--   * `guard_booking_status` adalah penjaga OTORISASI — "SIAPA boleh mengubah
--     status". Pertanyaan itu memang tentang peran, jadi bungkus peran ada di
--     tempat yang benar.
--   * fungsi ini penjaga INTEGRITAS — "perpindahan mana yang MASUK AKAL".
--     Jawabannya sama untuk siapa pun. Menyalin bungkus peran ke sini akan
--     membebaskan SELURUH jalur service role — seed, skrip uji, migrasi
--     mendatang — untuk membuat perpindahan ilegal tanpa satu pun keluhan, dan
--     justru di jalur itulah data rusak paling sering lahir.
--
-- Aturannya: penjaga otorisasi bergerbang peran; invarian integritas tidak.
create or replace function public.guard_booking_perpindahan()
returns trigger
language plpgsql
as $$
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

revoke execute on function public.guard_booking_perpindahan() from public, anon;

create trigger trg_guard_booking_perpindahan
  before update on public.booking_requests
  for each row execute function public.guard_booking_perpindahan();

-- ---------------------------------------------------------------------------
-- (4) PERPINDAHAN STATUS SESI
--
-- `terjadwal -> selesai` SENGAJA sah berdampingan dengan
-- `terjadwal -> berjalan -> selesai`: akun dan panel mitra belum ada (spec
-- "Di luar ruang lingkup"), jadi 'berjalan' ditandai admin dan akan sering
-- dilewati. Memaksa lewat 'berjalan' berarti memaksa admin berbohong tentang
-- jam, atau membuat sesi yang benar-benar terjadi tidak pernah bisa ditandai
-- selesai.
create or replace function public.perpindahan_sesi_sah(
  dari session_status,
  ke session_status
) returns boolean
language sql
immutable
as $$
  select case dari
    when 'terjadwal'        then ke in ('berjalan', 'selesai', 'tidak_hadir', 'dibatalkan_padma')
    when 'berjalan'         then ke in ('selesai', 'tidak_hadir')
    when 'selesai'          then false
    when 'tidak_hadir'      then false
    when 'dibatalkan_padma' then false
  end;
$$;

revoke execute on function public.perpindahan_sesi_sah(session_status, session_status)
  from public, anon;

create or replace function public.guard_sesi_perpindahan()
returns trigger
language plpgsql
as $$
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

revoke execute on function public.guard_sesi_perpindahan() from public, anon;

create trigger trg_guard_sesi_perpindahan
  before update on public.sessions
  for each row execute function public.guard_sesi_perpindahan();
