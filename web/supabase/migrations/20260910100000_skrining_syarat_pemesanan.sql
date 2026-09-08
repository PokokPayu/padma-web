-- ============================================================================
-- SKRINING SEBAGAI SYARAT SETIAP PEMESANAN (spec C1 J3, J4, J6)
-- ============================================================================
-- Aturan bisnisnya: SKRINING SETIAP KALI AKAN MEMESAN. Skrining karena itu
-- bukan status akun melainkan LAMPIRAN pada tiap pengajuan — satu skrining
-- hijau menopang tepat satu pengajuan, lalu hangus.
--
-- Sebelum migrasi ini, dua ujung menganga saling berhadapan: corong skrining di
-- landing berakhir di WhatsApp, sementara siapa pun yang punya akun bisa
-- memesan tanpa pernah diskrining sama sekali.

-- ===== 1) TOKEN KLAIM DI TABEL TERPISAH =====
-- Skrining di landing diisi ANONIM (nama + no. HP, tanpa email); akun berdiri
-- di atas email. Penyambungnya token acak, BUKAN kode skriningnya:
-- `src/lib/skrining/kode.ts` sengaja membuat kode yang mudah dibacakan lewat
-- telepon (prefiks semenit + sufiks 4 karakter, ~1 juta kemungkinan per menit).
-- Itu tiket layanan pelanggan, bukan kredensial — menjadikannya kunci berarti
-- orang bisa menebak kode orang lain lalu menyedot JAWABAN KESEHATANNYA ke
-- Passport sendiri.
--
-- KENAPA TABEL SENDIRI, bukan kolom di `screenings`: migration
-- 20260828220000_undangan_penautan_klien sudah MEMBUKTIKAN di Postgres lokal
-- bahwa `revoke select (kolom)` menuntut pencabutan SELECT tingkat tabel lebih
-- dulu, dan begitu itu dilakukan `select *` gagal 42501 untuk SEMUA peran —
-- termasuk admin dan test. Polanya diikuti apa adanya.
create table public.screening_claims (
  screening_id uuid primary key references public.screenings(id) on delete cascade,
  -- SHA-256 heksadesimal dari token, BUKAN tokennya. Dump basis data yang bocor
  -- karena itu tidak berisi kunci yang bisa langsung dipakai menyambungkan
  -- jawaban kesehatan ke akun mana pun. NULL sesudah dipakai.
  token_hash text unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by uuid references auth.users(id),
  constraint screening_claims_sekali_pakai
    check ((used_at is null) = (token_hash is not null))
);

comment on table public.screening_claims is
  'Token penyambung skrining ANONIM ke akun: acak 32 byte, disimpan sebagai '
  'SHA-256, sekali pakai, berumur 2 jam. Dititipkan di cookie httpOnly. Umur '
  'pendek disengaja: satu HP di ruang tunggu tidak boleh membuat orang kedua '
  'mewarisi skrining orang pertama lengkap dengan jawaban kesehatannya. '
  'Tidak boleh terbaca peran API mana pun — hanya service role di server.';

alter table public.screening_claims enable row level security;
revoke all on public.screening_claims from anon;
revoke all on public.screening_claims from authenticated;
-- Tanpa policy apa pun: RLS aktif + nol policy = nol baris untuk setiap peran
-- API, termasuk admin & owner yang juga login sebagai `authenticated`. Tidak
-- ada satu pun alur produk yang mengharuskan token ini terbaca dari peramban.

-- ===== 2) KLIEN BOLEH MEMBACA SKRININGNYA SENDIRI =====
-- Passport perlu tahu apakah ada skrining hijau yang belum terpakai — itu yang
-- memutuskan apakah `/passport/ajukan` menampilkan formulir atau ajakan
-- skrining. Hanya BACA; menulis tetap lewat rute ber-service role, supaya
-- `hasil`, `flags`, dan `kode` selalu ditentukan server dan tidak pernah
-- dikirim peramban. Bila peramban boleh mengirim `hasil`, seluruh gerbang di
-- bawah runtuh menjadi satu baris JSON.
create policy "screenings: klien baca miliknya" on public.screenings
  for select to authenticated
  using (
    client_id in (select c.id from public.clients c where c.user_id = auth.uid())
  );

-- ===== 3) SETIAP PENGAJUAN BERDIRI DI ATAS SATU SKRINING =====
-- Langsung NOT NULL, tanpa tahap nullable→backfill: `supabase db reset`
-- menjalankan seluruh migrasi SEBELUM `seed.sql`, jadi tabelnya kosong saat
-- baris ini berjalan. Aplikasi juga belum rilis, sehingga tidak ada data yang
-- perlu diselamatkan (keputusan pemilik repo 8 September 2026).
alter table public.booking_requests
  add column screening_id uuid not null references public.screenings(id);

comment on column public.booking_requests.screening_id is
  'Skrining hijau yang menopang pengajuan ini (spec J3). Satu skrining menopang '
  'TEPAT SATU pengajuan; sesudah dipakai ia hangus. Skrining yang menopang '
  'pengajuan yang dibatalkan TIDAK hidup kembali — itu disengaja: kondisi '
  'kesehatan bisa berubah di antara dua percobaan memesan.';

-- Indeks unik inilah yang membuat "hangus setelah dipakai" menjadi fakta basis
-- data, bukan kebiasaan kode. Ia TIDAK parsial: pengajuan yang dibatalkan pun
-- tetap memegang skriningnya, sehingga skrining lama tidak bisa dipakai ulang
-- untuk pengajuan baru.
create unique index booking_requests_skrining_unik
  on public.booking_requests (screening_id);

-- ===== 4) GERBANG LAPIS KETIGA =====
-- Lapis pertama layar, kedua server action. Lapis ini bukan hiasan: klien
-- memegang policy INSERT atas `booking_requests` dan bisa memanggil PostgREST
-- langsung dengan anon key + JWT-nya sendiri — persis alasan
-- `guard_booking_pembatas` ada.
--
-- Pelajaran C1-a yang tidak diulang di sini: gerbang JAM sempat hanya dipasang
-- di server action, dan tinjauan menemukannya bisa dilewati satu panggilan API.
--
-- SECURITY INVOKER (default), seperti `guard_booking_pembatas`. Pemeriksaan di
-- bawah berjalan di bawah RLS pemanggil, dan policy "screenings: klien baca
-- miliknya" memperlihatkan TEPAT himpunan yang sedang diperiksa — skrining
-- milik klien itu sendiri. Skrining orang lain tidak terlihat, jadi menyebut
-- id-nya pun tidak menolong.
create or replace function public.guard_booking_skrining()
returns trigger
language plpgsql
as $$
begin
  -- Bersarang, bukan `and`: plpgsql tidak menjamin short-circuit.
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if user_role() = 'klien' then
      if not exists (
        select 1
          from public.screenings s
         where s.id = new.screening_id
           -- MILIKNYA. Tanpa ini, klien bisa menumpang skrining hijau orang
           -- lain yang id-nya ia ketahui.
           and s.client_id = new.client_id
           -- HIJAU. Merah berarti "perlu evaluasi dokter lebih dulu", dan
           -- seluruh maksud gerbang ini adalah menahan pemesanan sampai itu
           -- selesai.
           and s.hasil = 'hijau'
      ) then
        raise exception 'pengajuan jadwal wajib berdiri di atas skrining hijau milik Anda'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_booking_skrining() from public, anon;

create trigger trg_guard_booking_skrining
  before insert on public.booking_requests
  for each row execute function public.guard_booking_skrining();
