-- ===========================================================================
-- INTI PEMBAYARAN (3/6) — JEJAK & NOTIFIKASI
-- ===========================================================================
-- Kejadian di P1 adalah SATU BARIS di `jejak_pesanan`, diterbitkan di dalam
-- transaksi yang menggeser status. Bukan bus, bukan antrean, bukan NOTIFY:
-- repo ini punya NOL infrastruktur pekerjaan latar, dan pembatas laju yang ada
-- pun mengakui di komentarnya sendiri bahwa `Map` per-proses tidak bertahan di
-- serverless (src/lib/skrining/pembatas.ts:25).
--
-- Notifikasi WhatsApp adalah proyek TERSENDIRI. P1 menerbitkan dan mencatat;
-- NOL pelanggan. Tidak ada kolom `dikirim_wa_pada` di sini — hanya proyek WA
-- yang tahu apa artinya "sudah terkirim", dan kolom mati adalah persis yang
-- doktrin repo ini tolak.

-- ---------------------------------------------------------------------------
-- (1) JEJAK
-- ---------------------------------------------------------------------------
create table public.jejak_pesanan (
  id uuid primary key default gen_random_uuid(),

  -- SENGAJA TANPA foreign key, pola 20260829160000_jejak_status_bayar.sql:
  -- jejak audit yang ikut lenyap bersama yang diaudit tidak berguna sama
  -- sekali. Ongkosnya nyata dan diterima: tidak ada cascade yang menyapu baris
  -- yatim, jadi setiap berkas uji wajib menyapu miliknya sendiri lewat service
  -- role — itulah yang dijaga tests/pesanan-jejak-yatim.test.ts.
  pesanan_id uuid,

  -- DIDENORMALISASI dengan sengaja: pelanggan kejadian (proyek WhatsApp)
  -- tidak perlu hak baca `clients` untuk tahu jejak ini milik siapa.
  padma_id text,

  kejadian public.order_event not null,
  keterangan text,
  dibuat_pada timestamptz not null default now()
);

comment on table public.jejak_pesanan is
  'Jejak kejadian pesanan. TANPA foreign key (jejak yang ikut lenyap bersama '
  'yang diaudit tidak berguna) dan tanpa hak tulis bagi peran API: pengisiannya '
  'lewat fungsi security definer. Pembersihan baris yatim WAJIB lewat service '
  'role. Satu-satunya janji ke proyek WhatsApp ada di indeks '
  'jejak_pesanan_lunas_sekali.';

-- SATU indeks unik, dan ia SEKALIGUS kontraknya: jejak 'lunas' lahir TEPAT
-- SATU KALI per pesanan. `unique (pesanan_id, kejadian)` SALAH dan akan
-- mematahkan tiga kejadian sekaligus — `notifikasi` lahir satu per notifikasi
-- Midtrans, `diperiksa_ulang` satu per panggilan penyapu, `token_terbit` satu
-- per percobaan. Bentuk kegagalannya: webhook menolak notifikasi KEDUA
-- Midtrans, yaitu settlement.
create unique index jejak_pesanan_lunas_sekali
  on public.jejak_pesanan (pesanan_id) where kejadian = 'lunas';

create index jejak_pesanan_pesanan_idx on public.jejak_pesanan (pesanan_id, dibuat_pada desc);

alter table public.jejak_pesanan enable row level security;

-- Hanya BACA untuk staf. Sengaja TIDAK ada policy INSERT/UPDATE/DELETE untuk
-- peran API mana pun: pengisian dikerjakan fungsi SECURITY DEFINER (migrasi 4
-- & 5), sehingga jejak tidak bisa dikarang maupun dihapus oleh admin yang
-- sedang diaudit.
create policy "jejak pesanan: staf baca" on public.jejak_pesanan for select
  to authenticated
  using (public.user_role() in ('admin','owner'));

revoke all on public.jejak_pesanan from anon;
revoke all on public.jejak_pesanan from authenticated;
grant select on public.jejak_pesanan to authenticated;

-- ---------------------------------------------------------------------------
-- (2) NOTIFIKASI MIDTRANS — lapis idempotensi pertama
-- ---------------------------------------------------------------------------
create table public.notifikasi_pesanan (
  id uuid primary key default gen_random_uuid(),

  -- Tanpa FK, alasan yang sama dengan jejak di atas.
  pesanan_id uuid,

  -- Dihitung di rute webhook (Node crypto) dan dikirim sebagai argumen RPC:
  -- sha256hex([order_id, status_code, transaction_status, fraud_status ?? '',
  -- transaction_id].join('|')). Yang BUKAN sidik, dan kenapa: `order_id` saja
  -- atau `transaction_id` saja adalah tebakan yang sangat wajar dan keduanya
  -- MEMAKAN UANG — dengan sidik sepesanan, notifikasi `pending` mendarat
  -- duluan, mengunci barisnya, dan `settlement` ditolak sebagai duplikat.
  -- `fraud_status` ikut karena capture+challenge dan capture+accept adalah dua
  -- keputusan berbeda atas transaksi yang sama.
  sidik text not null,

  transaksi_id text,
  status_midtrans text,
  kanal text,

  -- SATU-SATUNYA tempat nominal yang benar-benar DITERIMA Midtrans disimpan,
  -- diambil dari gross_amount notifikasi yang SUDAH LOLOS signature — tidak
  -- pernah dari badan yang belum diverifikasi.
  --
  -- Kenapa perlu ada: untuk pesanan `lunas`, sum(harga_beku) sudah menjawab
  -- "berapa yang dibayar" karena verifikasi jumlah lolos. Untuk pesanan
  -- `ditahan` — satu-satunya baris yang angkanya benar-benar jadi keputusan
  -- manusia — yang tersimpan tanpa kolom ini hanyalah angka yang KITA tagih,
  -- dan staf tetap harus membuka dashboard Midtrans untuk tahu selisihnya.
  -- Ongkosnya disebut terbuka: tabel ini karena itu ikut masuk TABEL_UANG.
  --
  -- Nullable: notifikasi yang tanda tangannya sah tapi badannya tanpa
  -- gross_amount tetap dicatat, dan "tidak tahu" bukan "nol rupiah".
  nominal_diterima numeric(14,2),

  diterima_pada timestamptz not null default now(),

  constraint notifikasi_pesanan_sidik_unik unique (sidik)
);

comment on table public.notifikasi_pesanan is
  'Lapis idempotensi pertama webhook Midtrans, dan satu-satunya tempat nominal '
  'yang BENAR-BENAR diterima disimpan (nominal_diterima). Anggota TABEL_UANG. '
  'Policy baca staf saja, supaya /admin/pesanan membacanya dengan sesi '
  'pemanggil tanpa service role. Insert-nya berada DI DALAM transaksi yang '
  'sama dengan transisi & penyaluran: sidik yang commit lebih dulu mengubah '
  'kegagalan sementara menjadi permanen.';

create index notifikasi_pesanan_pesanan_idx
  on public.notifikasi_pesanan (pesanan_id, diterima_pada desc);

alter table public.notifikasi_pesanan enable row level security;

create policy "notifikasi pesanan: staf baca" on public.notifikasi_pesanan for select
  to authenticated
  using (public.user_role() in ('admin','owner'));

revoke all on public.notifikasi_pesanan from anon;
revoke all on public.notifikasi_pesanan from authenticated;
grant select on public.notifikasi_pesanan to authenticated;

-- ---------------------------------------------------------------------------
-- (3) PENGHITUNG NOTIFIKASI BERTANDA TANGAN SALAH
-- ---------------------------------------------------------------------------
-- Menghitung saja, dan NOL teks penyerang disimpan. Kolomnya bernama `jumlah`,
-- BUKAN `total`: /(^|_)totals?(_|$)/ adalah salah satu dari sembilan belas
-- pola money firewall, dan penghitung penyerang bukan tabel uang.
create table public.notifikasi_ditolak_harian (
  tanggal date primary key,

  -- Notifikasi bertanda tangan SALAH: serangan, atau kunci yang tidak cocok.
  jumlah integer not null default 0,

  -- Notifikasi bertanda tangan SAH yang `order_id`-nya tidak menunjuk pesanan
  -- mana pun. Dipisahkan dari `jumlah` karena artinya berlawanan: yang ini
  -- BENAR-BENAR dari Midtrans, artinya uangnya sungguhan milik kita, lalu kita
  -- membuang notifikasinya dan menyuruh Midtrans berhenti mengirim (200).
  -- Itu satu-satunya keluaran webhook yang tidak menulis apa pun ke mana pun:
  -- bukan `orders`, bukan `jejak_pesanan`, bukan `notifikasi_pesanan` (RPC
  -- keluar sebelum insert sidik). Kolom ini jejaknya. Dua jalan masuk yang
  -- nyata dan nol-galat: notifikasi untuk `percobaan` lama yang kelak
  -- "dirapikan" menjadi pencarian kode+percobaan, dan pergeseran bentuk `kode`
  -- di penerbitnya — keduanya membuat SETIAP notifikasi dijawab 200 lalu
  -- hilang, dengan suite tetap hijau.
  --
  -- Namanya bukan `total_tak_dikenal`: /(^|_)totals?(_|$)/ adalah pola ke-15
  -- money firewall, dan penghitung bukan nominal.
  tak_dikenal integer not null default 0
);

comment on table public.notifikasi_ditolak_harian is
  'Dua penghitung harian webhook Midtrans, keduanya NOL teks penyerang: '
  'jumlah = notifikasi bertanda tangan SALAH; tak_dikenal = notifikasi '
  'bertanda tangan SAH yang order_id-nya tidak dikenal, yaitu satu-satunya '
  'keluaran webhook yang tidak menulis apa pun ke tabel mana pun. RLS aktif '
  'tanpa policy sama sekali: hanya service role. Kolomnya `jumlah`, bukan '
  '`total` — yang kedua akan memerahkan money firewall atas tabel yang sama '
  'sekali bukan tabel uang.';

-- RLS aktif, NOL policy: tidak ada peran API yang bisa menyentuhnya. Itulah
-- yang membuat tabel ini masuk SENGAJA_TERKUNCI di tests/struktur-rls.test.ts.
alter table public.notifikasi_ditolak_harian enable row level security;

revoke all on public.notifikasi_ditolak_harian from anon;
revoke all on public.notifikasi_ditolak_harian from authenticated;

-- Kenapa RPC, dan bukan upsert dari TypeScript: supabase-js `upsert` tidak
-- bisa menyatakan `jumlah = jumlah + 1` — ia MENIMPA. Dua notifikasi bertanda
-- tangan salah dalam satu hari akan tercatat sebagai satu, dan penghitung yang
-- selalu berkata "1" adalah penghitung yang tidak ada.
--
-- `security definer` karena peran pemanggilnya nanti (service role lewat rute
-- webhook) memang tidak diberi hak tabel apa pun di sini, dan supaya jalur
-- penulisan tetap SATU walau kelak ada pemanggil kedua.
create or replace function public.catat_notifikasi_ditolak()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifikasi_ditolak_harian as h (tanggal, jumlah)
  values (current_date, 1)
  on conflict (tanggal) do update set jumlah = h.jumlah + 1;
end;
$$;

comment on function public.catat_notifikasi_ditolak() is
  'Menaikkan penghitung notifikasi bertanda tangan salah hari ini. Dipanggil '
  'rute webhook dengan SERVICE ROLE sesudah signature gagal, sebelum 401. '
  'Tertutup untuk seluruh peran API: pemanggil bersesi tidak punya urusan '
  'menaikkan penghitung penyerang.';

-- Kembarannya untuk cabang `pesanan_tidak_ada`. Ditulis sebagai fungsi KEDUA,
-- bukan sebagai parameter pada fungsi di atas: tanda tangan yang berubah
-- adalah tanda tangan yang harus dicari di setiap pemanggil, dan kedua
-- penghitung ini memang dipanggil dari dua tempat berbeda di rute yang sama.
create or replace function public.catat_notifikasi_tak_dikenal()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifikasi_ditolak_harian as h (tanggal, tak_dikenal)
  values (current_date, 1)
  on conflict (tanggal) do update set tak_dikenal = h.tak_dikenal + 1;
end;
$$;

comment on function public.catat_notifikasi_tak_dikenal() is
  'Menaikkan penghitung notifikasi bertanda tangan SAH yang order_id-nya tidak '
  'menunjuk pesanan mana pun. Dipanggil rute webhook dengan SERVICE ROLE tepat '
  'sebelum menjawab 200: notifikasi sah yang kita buang tidak boleh lebih '
  'sunyi daripada notifikasi palsu yang kita tolak.';

-- Tertutup, TERMASUK dari `authenticated`. Templat aturan [F] repo
-- (20260828230000_fail_closed_sequence_fungsi.sql:176-177) hanya menulis
-- `from public, anon`; fungsi baru LAHIR ber-EXECUTE untuk setiap pengguna
-- login, jadi menyalin templat itu apa adanya membuka pintu tanpa satu pun uji
-- merah. Bentuk ketat di bawah adalah preseden
-- 20260830150000_pengerasan_tabel_uang.sql:197.
revoke all on function public.catat_notifikasi_ditolak() from public, anon, authenticated;
revoke all on function public.catat_notifikasi_tak_dikenal() from public, anon, authenticated;
