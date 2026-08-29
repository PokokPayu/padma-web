-- ============================================================================
-- PEMBATAS & VALIDASI ISI PERMINTAAN JADWAL  (temuan red team)
-- ============================================================================
-- `guard_booking_status` (migration 20260829130000) mengunci NILAI status, dan
-- itu terbukti pegang: klien tidak pernah bisa menyisipkan 'dikonfirmasi'.
-- Yang TIDAK dijaga siapa pun adalah VOLUME dan ISI:
--
--   * 50 permintaan dikirim serentak -> 50/50 tersimpan dalam 123ms. Semua
--     berstatus 'menunggu' (benar), tetapi antrean admin terkubur. Verifikasi
--     manual staf adalah SATU-SATUNYA gerbang menuju 'dikonfirmasi'/'lunas',
--     jadi membanjirinya sama dengan melumpuhkan gerbang itu.
--   * `services.aktif = false` tetap bisa dipesan — foreign key hanya menolak
--     service_id yang TIDAK ADA, bukan yang sudah dimatikan.
--   * tanggal '2020-01-01' diterima — regex bentuk YYYY-MM-DD di server action
--     memeriksa RUPA, bukan NILAI.
--
-- Kenapa penegaknya di sini, bukan cukup di server action: klien memegang
-- policy INSERT pada `booking_requests`, jadi ia bisa memanggil PostgREST
-- langsung dengan anon key + JWT-nya sendiri tanpa menyentuh server action.
-- Pembatas yang hanya hidup di TypeScript adalah pembatas yang bisa dilewati
-- dengan satu perintah curl.

-- ---------------------------------------------------------------------------
-- (1) DEDUP — satu antrean, bukan lima puluh salinan permintaan yang sama.
--     Parsial `where status = 'menunggu'`: yang dibatasi adalah ANTREAN, bukan
--     RIWAYAT. Permintaan lama yang sudah ditolak/dikonfirmasi tidak boleh
--     menghalangi klien mengajukan hal serupa lagi.
--     Index (bukan trigger) supaya penegakannya atomik terhadap race.
create unique index booking_requests_antrean_unik
  on public.booking_requests (client_id, service_id, tanggal, preferensi_waktu)
  where status = 'menunggu';

-- ---------------------------------------------------------------------------
-- (2) BATAS ANTREAN + LAYANAN AKTIF + TANGGAL TIDAK LAMPAU.
--     Fungsi terpisah dari `guard_booking_status` supaya invarian status (yang
--     sudah terbukti pegang) tidak ikut disentuh saat pembatas ini berubah.
--
--     SECURITY INVOKER (default) — disengaja. Hitungan di bawah berjalan di
--     bawah RLS milik pemanggil, dan policy "booking: klien baca miliknya"
--     memperlihatkan TEPAT baris klien itu sendiri, yaitu persis himpunan yang
--     sedang dihitung. SECURITY DEFINER justru akan menukar `current_user`
--     menjadi pemilik fungsi dan melumpuhkan penjaga peran di baris pertama.
create or replace function public.guard_booking_pembatas()
returns trigger
language plpgsql
as $$
declare
  batas constant int := 5;  -- sinkron dengan BATAS_PERMINTAAN_MENUNGGU
  antre int;
begin
  -- Bersarang, bukan `and`: plpgsql tidak menjamin short-circuit.
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

      -- (b) Tanggal tidak boleh di masa lalu. Kalender yang dipakai adalah
      --     ASIA/JAKARTA, bukan jam server: server berjalan UTC, dan antara
      --     17:00–24:00 UTC tanggal Jakarta sudah besok. `current_date` di
      --     sini akan menolak permintaan sah klien untuk "hari ini".
      if new.tanggal < (now() at time zone 'Asia/Jakarta')::date then
        raise exception 'tanggal permintaan jadwal tidak boleh di masa lalu'
          using errcode = '42501';
      end if;

      -- (c) Batas panjang antrean. Kunci advisory per-klien diambil LEBIH DULU
      --     supaya hitungan di bawah tidak bisa dilewati dengan mengirim
      --     puluhan insert serentak: tanpa kunci, 50 transaksi paralel
      --     membaca angka yang sama (0) lalu semuanya lolos. Kunci bersifat
      --     per-transaksi (dilepas otomatis) dan hanya menyerialkan permintaan
      --     milik SATU klien, jadi klien lain tidak ikut antre.
      perform pg_advisory_xact_lock(
        hashtext('booking_requests:antrean'),
        hashtext(new.client_id::text)
      );

      select count(*) into antre
        from public.booking_requests b
       where b.client_id = new.client_id
         and b.status = 'menunggu';

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

-- Tanpa ini, `anon` (anon key tertanam di bundel browser) bisa memanggilnya
-- sebagai RPC lewat PostgREST — dan tests/hak-default-sequence-fungsi.test.ts
-- akan merah.
revoke execute on function public.guard_booking_pembatas() from public, anon;

create trigger trg_guard_booking_pembatas
  before insert on public.booking_requests
  for each row execute function public.guard_booking_pembatas();
