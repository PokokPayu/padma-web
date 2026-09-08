-- ============================================================================
-- BATAL KARENA TENGGAT, DAN SKRINING YANG DIKEMBALIKAN (spec C2 P5, P6)
-- ============================================================================
-- Keputusan pemilik repo: tenggat 24 jam, lalu pengajuan dibatalkan otomatis.
--
-- Skrining yang menopangnya DIKEMBALIKAN. Ini pengecualian yang DISENGAJA atas
-- C1 J3 ("skrining yang menopang pengajuan yang dibatalkan tidak hidup
-- kembali"): aturan itu ditulis untuk klien yang MEMBATALKAN SENDIRI — sebuah
-- keputusan. Tenggat yang lewat bukan keputusan, dan memaksa orang mengulang
-- seluruh wizard skrining karena telat sehari adalah hukuman yang tidak
-- dimaksudkan siapa pun.
--
-- Pembedaan itu yang paling mudah hilang saat kode dirapikan, dan karena itu
-- diuji BERDAMPINGAN di tests/tenggat-bayar.test.ts.

-- ---------------------------------------------------------------------------
-- (1) `screening_id` BOLEH DILEPAS
--
-- Melonggarkan kolom adalah cara paling mudah membuka kembali lubang yang baru
-- saja ditutup, jadi gerbangnya BERPINDAH, bukan hilang:
--
--   sebelum : kolom NOT NULL  → setiap pengajuan pasti punya skrining
--   sesudah : trigger menuntut skrining pada status ANTREAN
--
-- Pengajuan yang sudah batal boleh tidak punya skrining; pengajuan yang masih
-- hidup tidak boleh.
alter table public.booking_requests alter column screening_id drop not null;

-- Indeks unik menjadi PARSIAL. Tanpa ini, skrining yang sudah dilepas tetap
-- "terpakai" oleh baris lama yang memegangnya sebagai NULL — dan NULL tidak
-- bentrok di indeks unik Postgres, tetapi baris batal yang MASIH memegang id
-- lamanya akan bentrok. Predikatnya memastikan hanya pemegang sungguhan yang
-- dihitung.
drop index if exists public.booking_requests_skrining_unik;

create unique index booking_requests_skrining_unik
  on public.booking_requests (screening_id)
  where screening_id is not null;

-- Gerbang skrining ditulis ulang: syaratnya sekarang "punya skrining hijau
-- miliknya" DAN "hanya untuk baris yang masih hidup".
create or replace function public.guard_booking_skrining()
returns trigger
language plpgsql
as $$
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

revoke execute on function public.guard_booking_skrining() from public, anon;

-- ---------------------------------------------------------------------------
-- (2) PEMBATAL TENGGAT — IDEMPOTEN
--
-- Dipanggil rute cron, dan aman dipanggil berkali-kali: filternya sendiri yang
-- membuat panggilan kedua tidak mengenai baris mana pun.
--
-- `status_bayar <> 'lunas'` bukan kehati-hatian berlebihan: pengajuan yang
-- uangnya SUDAH masuk tetapi belum sempat dikonfirmasi admin tidak boleh
-- dibatalkan mesin. Yang hilang di situ bukan slot, melainkan uang orang.
create or replace function public.batalkan_lewat_tenggat()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

revoke execute on function public.batalkan_lewat_tenggat() from public, anon, authenticated;

comment on function public.batalkan_lewat_tenggat() is
  'Membatalkan pengajuan yang lewat tenggat bayar dan MENGEMBALIKAN skriningnya. '
  'Idempoten. Pengajuan yang sudah lunas TIDAK PERNAH ikut dibatalkan — yang '
  'hilang di situ bukan slot melainkan uang orang. Dipanggil rute cron; '
  'lapis keduanya adalah evaluasi saat dibaca di layar admin & Passport, '
  'karena cron yang mati membuat tenggat berhenti berlaku tanpa satu pun galat.';

-- ---------------------------------------------------------------------------
-- (3) PENJAGA PEMBATALAN KLIEN IKUT MENGENAL KEADAAN BARU
--
-- `guard_booking_klien_batal` (C1-a) menyimpan daftar keadaan asal yang boleh
-- dibatalkan klien: diminta / mencari_mitra / mitra_siap. Daftar itu ditulis
-- sebelum `menunggu_bayar` ada, jadi tanpa baris ini klien yang tagihannya
-- sudah terbit TERKUNCI — ia tidak bisa membatalkan, dan satu-satunya jalan
-- keluarnya adalah menunggu tenggat lewat.
--
-- Ditemukan oleh uji, bukan oleh pembacaan kode: peta perpindahan sudah
-- menyahkan `menunggu_bayar -> dibatalkan_klien`, tetapi penjaga otorisasinya
-- belum. Dua daftar yang harus sepakat, dan hanya satu yang diperbarui — persis
-- kelas kesalahan yang C1 habiskan satu modul untuk mencegahnya.
--
-- Sisa badan disalin APA ADANYA dari migration `pembatalan_oleh_klien`,
-- termasuk kunci kolomnya: `create or replace` mengganti seluruh badan, dan apa
-- yang tidak disalin, hilang.
create or replace function public.guard_booking_klien_batal()
returns trigger
language plpgsql
as $$
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

revoke execute on function public.guard_booking_klien_batal() from public, anon;
