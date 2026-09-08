-- ============================================================================
-- KLIEN MEMBATALKAN PENGAJUANNYA SENDIRI (spec C1 J8)
-- ============================================================================
-- Admin untuk sementara TIDAK menolak pengajuan (tombolnya disembunyikan dengan
-- cara yang sama seperti saklar paket). Itu menutup satu-satunya pintu keluar
-- kedua dari antrean, sementara BATAS_PERMINTAAN_MENUNGGU = 5 mengunci klien
-- yang antreannya penuh: klien yang mengajukan lima tanggal yang tidak bisa
-- dilayani terkunci selamanya, dan tidak seorang pun punya cara membereskannya.
--
-- Penambalnya: kendali atas antrean berpindah ke pemiliknya.
--
-- Seperti seluruh tulisan klien di repo ini, syaratnya ditegakkan DI SINI —
-- bukan hanya di server action. Klien memegang JWT-nya sendiri dan bisa
-- memanggil PostgREST langsung.

-- ===== 1) POLICY UPDATE, DIPERSEMPIT KE BARIS MILIKNYA =====
-- `using` menyaring baris mana yang boleh disentuh; `with check` menyaring
-- baris seperti apa yang boleh dihasilkan. Keduanya perlu: tanpa `with check`,
-- klien bisa memindahkan barisnya ke client_id orang lain.
create policy "booking: klien membatalkan miliknya" on public.booking_requests
  for update to authenticated
  using (
    client_id in (select c.id from public.clients c where c.user_id = auth.uid())
  )
  with check (
    client_id in (select c.id from public.clients c where c.user_id = auth.uid())
  );

-- ===== 2) KUNCI KOLOM =====
-- Policy UPDATE membuka SELURUH kolom yang boleh ditulis peran itu, bukan hanya
-- `status`. Tanpa penjaga ini klien bisa menggeser tanggal, jam, alamat, atau
-- layanan sebuah pengajuan — termasuk pengajuan yang sudah dicarikan mitra —
-- sambil berpura-pura membatalkan. Pola yang diikuti: migration
-- `20260830140000_kunci_kolom_identitas`.
--
-- Daftarnya menyebut medan yang WAJIB SAMA, dan `status` adalah satu-satunya
-- yang boleh bergerak. Kolom baru yang ditambahkan kelak TIDAK otomatis masuk
-- daftar ini — karena itu ia ditutup dari sisi lain juga: policy UPDATE klien
-- hanya ada untuk membatalkan, dan setiap kolom baru yang berarti bagi klien
-- wajib ditambahkan ke daftar ini bersama migrasinya.
create or replace function public.guard_booking_klien_batal()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if user_role() = 'klien' then

      -- Satu-satunya perubahan yang boleh dilakukan klien atas barisnya.
      if new.status is distinct from 'dibatalkan_klien'::booking_status then
        raise exception 'klien hanya boleh membatalkan pengajuannya'
          using errcode = '42501';
      end if;

      if old.status not in ('diminta', 'mencari_mitra', 'mitra_siap') then
        raise exception 'pengajuan yang sudah dikonfirmasi tidak bisa dibatalkan dari sini'
          using errcode = '42501';
      end if;

      -- Seluruh medan lain WAJIB sama persis. `is distinct from` (bukan `<>`)
      -- supaya NULL dibandingkan benar.
      if new.id               is distinct from old.id
      or new.client_id        is distinct from old.client_id
      or new.service_id       is distinct from old.service_id
      or new.variant_id       is distinct from old.variant_id
      or new.partner_id       is distinct from old.partner_id
      or new.tanggal          is distinct from old.tanggal
      or new.jam_mulai        is distinct from old.jam_mulai
      or new.preferensi_waktu is distinct from old.preferensi_waktu
      or new.catatan          is distinct from old.catatan
      or new.alamat           is distinct from old.alamat
      or new.alamat_lat       is distinct from old.alamat_lat
      or new.alamat_lon       is distinct from old.alamat_lon
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

revoke execute on function public.guard_booking_klien_batal() from public, anon;

create trigger trg_guard_booking_klien_batal
  before update on public.booking_requests
  for each row execute function public.guard_booking_klien_batal();

-- ===== 3) `guard_booking_status` DILONGGARKAN, TEPAT SEBESAR INI =====
-- Versi sebelumnya menolak SETIAP perubahan status oleh klien. Sekarang satu
-- tujuan diizinkan — dan hanya karena tiga penjaga lain di atas sudah
-- mempersempitnya ke "barisnya sendiri, dari keadaan antrean, tanpa menyentuh
-- medan apa pun".
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
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_booking_status() from public, anon;

-- ===== 4) `ditolak` TETAP ADA, TIDAK LAGI TERJANGKAU =====
comment on type booking_status is
  'Rantai status permintaan C1. ''ditolak'' DIPERTAHANKAN nilainya untuk '
  'permintaan lama, tetapi tidak lagi terjangkau dari layar mana pun (spec J8): '
  'admin tidak menolak, klien yang membatalkan. Menghapus nilainya berarti '
  'kehilangan riwayat. ''menunggu_bayar'' sengaja BELUM ada — ia milik C2, '
  'disisipkan antara ''mitra_siap'' dan ''dikonfirmasi''.';
