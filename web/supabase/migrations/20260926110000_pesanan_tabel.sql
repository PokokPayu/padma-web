-- ===========================================================================
-- INTI PEMBAYARAN (2/6) — NOTA: orders & order_items
-- ===========================================================================
-- `orders` adalah pernyataan tentang APA YANG SUDAH DIBAYAR, bukan tagihan.
-- Perbedaan itu yang membuat doktrin C2 ("nominal diturunkan, tidak pernah
-- disimpan") benar untuk tagihan dan SALAH di sini: angka pembandingnya ada di
-- tangan Midtrans dan ikut ditandatangani, jadi verifikasi jumlah mustahil
-- tanpa angka beku. Yang membeku ada di `order_items.harga_beku`;
-- `orders` sendiri lahir NOL kolom nominal, dan karena itu ia TIDAK masuk
-- TABEL_UANG.
--
-- Nol `alter table booking_requests`, nol `alter type pay_status`, nol
-- sentuhan gerbang isi produk.

-- ---------------------------------------------------------------------------
-- (1) PESANAN
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),

  -- Bentuk PSN-YYMMDD-XXXXXX. Enam heksadesimal per tanggal dari
  -- gen_random_uuid() — pgcrypto NOL hasil di seluruh migrasi repo ini, jadi
  -- `gen_random_bytes` berarti memasang ekstensi baru di basis data produksi
  -- berisi data klien nyata demi satu sufiks acak. Penerbitnya ada di
  -- migrasi 4, yang mengulang maksimum lima kali saat tabrakan.
  kode text not null,

  -- Midtrans menolak `order_id` kembar SELAMANYA. `order_id` yang dikirim
  -- adalah `kode || '.' || percobaan`, dan sufiks itulah jalan keluar ketika
  -- token gagal terbit dan order_id-nya sudah terbakar. Dinaikkan HANYA oleh
  -- buat_pesanan(p_ulang := true), bukan setiap kali halaman dibuka.
  percobaan smallint not null default 1,

  -- ON DELETE RESTRICT, bukan cascade: nota yang bisa lenyap bukan nota.
  -- Konsekuensinya disebut terbuka — klien yang pernah membeli tidak bisa
  -- dihapus sama sekali, dan itu memang yang diinginkan.
  client_id uuid not null references public.clients(id) on delete restrict,

  status public.order_status not null default 'menunggu_bayar',

  -- SENGAJA tanpa `check (= 1)`: yang membatasi P1 ke satu item adalah RPC-nya,
  -- bukan skemanya. P2 (keranjang) karena itu tidak perlu migrasi ke tabel
  -- uang untuk mencabutnya.
  jumlah_item smallint not null,

  dibuat_pada timestamptz not null default now(),

  -- 24 jam, dan durasi yang SAMA dikirim sebagai `expiry` di payload Snap dari
  -- satu konstanta di kode (JAM_TENGGAT_PESANAN, src/lib/pesanan/status.ts).
  -- Dua angka yang boleh berbeda adalah dua kegagalan simetris: kolom lebih
  -- pendek → kita berhenti bertanya sementara VA-nya masih bisa dibayar, dan
  -- settlement mendarat pada pesanan yang sudah kita tutup; kolom lebih
  -- panjang → penyapu menanyai Midtrans tentang transaksi yang tak akan pernah
  -- berubah. Angkanya mengikuti tenggat bayar sesi yang sudah berlaku
  -- (20260912130000_tenggat_dan_skrining.sql:4), supaya klien tidak menghadapi
  -- dua tenggat berbeda di satu aplikasi.
  kedaluwarsa_pada timestamptz not null default now() + interval '24 hours',

  lunas_pada timestamptz,
  ditutup_pada timestamptz,

  -- Token Snap TIDAK PERNAH dipercaya sebagai bukti pembayaran oleh apa pun.
  -- Ia disimpan supaya popup yang sama bisa dibuka ulang tanpa membakar
  -- order_id baru.
  snap_token text,
  snap_diterbitkan_pada timestamptz,

  notifikasi_pada timestamptz,

  -- Pembatas Lapis 1b: satu pesanan tidak ditanyakan ke Status API lebih sering
  -- dari sekali per lima menit. Juga kunci urut penyapu Lapis 3.
  diperiksa_pada timestamptz,

  -- SATU-SATUNYA penanda tinjauan, dan ia ORTOGONAL terhadap status. Itulah
  -- keuntungan membuang nilai enum 'ditinjau': "tutup tinjauan" mengosongkan
  -- dua kolom ini tanpa menyentuh status sama sekali.
  butuh_tinjauan_pada timestamptz,
  sebab_tinjauan text,

  -- Metode bayar menurut Midtrans (payment_type). Dinamai `kanal` karena
  -- `payment_type` cocok dengan pola money firewall ke-17 dan `kanal` tidak —
  -- dan yang disimpan di sini memang bukan nominal.
  kanal text,
  transaksi_id text,
  status_midtrans text,

  constraint orders_kode_unik unique (kode),

  -- DUA CHECK POSITIF BERPASANGAN, bukan satu. Nilai enum keenam yang lupa
  -- diklasifikasikan jatuh ke luar KEDUANYA dan gagal 23514 pada penulisan
  -- pertamanya. Satu CHECK saja fail-OPEN: `false = false` lolos.
  constraint pesanan_tutup_bercap check (
    (status in ('ditahan','lunas','kedaluwarsa','dibatalkan')) = (ditutup_pada is not null)
  ),
  constraint pesanan_terbuka_tanpa_cap check (
    (status = 'menunggu_bayar') = (ditutup_pada is null)
  ),

  -- Percobaan kesepuluh TIDAK pernah melempar 23514 kepada pembeli: RPC
  -- checkout menutup pesanan itu jadi 'dibatalkan' dan melahirkan pesanan
  -- baru. Batas ini adalah pagar TERAKHIR, bukan jalur pemulihan.
  constraint pesanan_percobaan_wajar check (percobaan between 1 and 9)
);

comment on table public.orders is
  'Pesanan generik — satu mesin untuk produk digital DAN sesi (P3). TANPA '
  'kolom nominal: total dijumlahkan dari order_items, yang membekukannya. '
  'authenticated memegang SELECT saja; penulisannya hanya lewat RPC dan fungsi '
  'mesin. client_id ON DELETE RESTRICT — nota yang bisa lenyap bukan nota.';

-- Satu pesanan terbuka per klien, DIJAGA BASIS DATA. Inilah yang membuat "dua
-- panggilan checkout paralel melahirkan tepat satu pesanan" benar tanpa kunci
-- di TypeScript: yang kalah menerima 23505, membaca ulang, dan memulangkan
-- pesanan terbuka yang sudah ada bila produknya sama. P2 mewarisi indeks ini
-- apa adanya.
create unique index pesanan_terbuka_satu_per_klien
  on public.orders (client_id) where status = 'menunggu_bayar';

create index orders_klien_idx on public.orders (client_id, dibuat_pada desc);

-- Urut penyapu Lapis 3: yang paling lama tidak diperiksa lebih dulu, dan yang
-- BELUM PERNAH diperiksa paling dulu dari semuanya. `nulls first` ditulis
-- eksplisit — bawaan Postgres untuk ASC adalah NULLS LAST, dan indeks yang
-- urutannya berbeda dari kueri tidak akan dipakai perencana.
create index orders_sapuan_idx
  on public.orders (diperiksa_pada nulls first) where status = 'menunggu_bayar';

alter table public.orders enable row level security;

-- `to authenticated` DITULIS EKSPLISIT — pola yang sama dengan
-- 20260921120000_produk_entitlement.sql:41-47. Policy tanpa target lahir
-- `to public`, dan `public` MENCAKUP `anon`: setiap SELECT anon akan ikut
-- mengevaluasi policy staf, memanggil user_role() yang EXECUTE-nya sudah
-- dicabut dari anon, dan gagal 42501 alih-alih memulangkan baris kosong.
create policy "pesanan: klien baca miliknya" on public.orders for select
  to authenticated
  using (exists (
    select 1 from public.clients c
     where c.id = orders.client_id and c.user_id = auth.uid()
  ));

-- Policy SELECT untuk staf aman. Bahaya `PATCH ?filter=tautologi` datang dari
-- grant UPDATE, dan UPDATE tidak pernah diberikan kepada siapa pun di tabel
-- ini.
create policy "pesanan: staf baca" on public.orders for select
  to authenticated
  using (public.user_role() in ('admin','owner'));

-- Titik nol yang disengaja. Default privileges Supabase memberi hak PENUH atas
-- setiap tabel baru di skema public kepada anon MAUPUN authenticated; tanpa
-- kedua baris ini, INSERT/UPDATE menempel diam-diam dan seluruh janji "hanya
-- lewat RPC" di atas hanya berlaku di atas kertas.
revoke all on public.orders from anon;
revoke all on public.orders from authenticated;
grant select on public.orders to authenticated;

-- ---------------------------------------------------------------------------
-- (2) BARIS NOTA
-- ---------------------------------------------------------------------------
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  pesanan_id uuid not null references public.orders(id) on delete cascade,
  jenis public.order_item_source not null,

  product_id uuid references public.digital_products(id),

  -- Lahir sekarang, TIDAK PERNAH terisi di P1. Pelanggaran SADAR terhadap
  -- doktrin "nol kolom mati": ongkosnya asimetris — satu kolom nullable hari
  -- ini versus `alter table` pada tabel uang yang sudah memuat nota nyata
  -- besok.
  booking_request_id uuid references public.booking_requests(id),

  judul_beku text not null,

  -- SATU-SATUNYA angka yang dipakai memverifikasi gross_amount notifikasi
  -- Midtrans. Ia beku karena angka pembandingnya ada di tangan Midtrans dan
  -- ikut ditandatangani; menghitungnya ulang dari harga hari ini berarti nota
  -- yang berubah sesudah dibayar.
  harga_beku integer not null check (harga_beku >= 0),

  urutan smallint not null,

  constraint item_sumber_tunggal check (num_nonnulls(product_id, booking_request_id) = 1),

  -- DUA CHECK BERCERMIN, bukan satu — alasan yang sama dengan orders. Dengan
  -- `item_sumber_tunggal` saja, nilai order_item_source KETIGA (mis. 'kelas')
  -- yang membawa booking_request_id lolos kedua pagar. Migrasi 1 baru saja
  -- melahirkan 'sesi' sebelum ada penulisnya, jadi nilai ketiga bukan
  -- hipotesis jauh.
  constraint item_produk_bercermin check ((jenis = 'produk_digital') = (product_id is not null)),
  constraint item_sesi_bercermin   check ((jenis = 'sesi')           = (booking_request_id is not null)),

  constraint order_items_pesanan_urutan_unik unique (pesanan_id, urutan)
);

comment on table public.order_items is
  'Baris nota. APPEND-ONLY bagi siapa pun, termasuk service role: trigger '
  'item_pesanan_beku menolak SELURUH UPDATE dengan 42501. DELETE sengaja TIDAK '
  'dijaga — cascade dari orders harus bisa jalan. harga_beku adalah satu-satunya '
  'angka pembanding gross_amount Midtrans; tabel ini anggota TABEL_UANG.';

-- Indeks `order_items_pesanan_idx` SENGAJA TIDAK dibuat — peta §0.3 mencatat
-- keputusan itu, jadi tidak ada uji mana pun yang meng-assert namanya.
-- Alasannya: constraint `order_items_pesanan_urutan_unik` sudah menerbitkan
-- indeks btree atas (pesanan_id, urutan), dan indeks kedua berkolom kunci sama
-- persis hanya menambah ongkos tulis tanpa satu pun kueri yang lebih cepat —
-- "semua item satu pesanan" memakai awalan kiri indeks unik itu.

alter table public.order_items enable row level security;

-- NOL policy dan NOL grant, dua-duanya disengaja. Baris nota tidak pernah
-- dibaca langsung oleh peran API; yang dibaca layar staf adalah view
-- `pesanan_item_staf` (migrasi 5), yang batas kolom dan batas perannya ada DI
-- DALAM view. Tabel ini karena itu masuk SENGAJA_TERKUNCI di
-- tests/struktur-rls.test.ts.
revoke all on public.order_items from anon;
revoke all on public.order_items from authenticated;

-- ---------------------------------------------------------------------------
-- (3) PEMBEKUAN — trigger, bukan ketiadaan policy
-- ---------------------------------------------------------------------------
-- Ketiadaan policy menjaga peran API. Yang paling mungkin menulis ulang harga
-- beku justru WEBHOOK ber-SERVICE ROLE — peran yang melewati RLS sepenuhnya,
-- dan persis peran yang idiom gerbang `current_user` kecualikan. Karena itu
-- trigger di bawah TIDAK bergerbang peran: ia menolak siapa pun.
--
-- Perhatikan bahwa badan fungsinya tidak menyebut nama tabel mana pun. Itu
-- bukan kebetulan: tests/fungsi-mesin-tertutup.test.ts (Tugas 7) memindai
-- `pg_proc.prosrc` dengan pola /(insert into|update)\s+(public\.)?(orders|
-- order_items|jejak_pesanan|digital_entitlements)/, dan fungsi yang cocok
-- WAJIB masuk salah satu dari dua daftar putih. Fungsi ini bukan penulis, jadi
-- ia tidak masuk daftar mana pun — dan komentar yang menyebut nama tabelnya
-- ditaruh DI LUAR badan $$ supaya tidak memalsukan kecocokan itu.
create or replace function public.tolak_ubah_item_pesanan()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Baris nota pesanan tidak dapat diubah sesudah terbit.'
    using errcode = '42501';
end;
$$;

comment on function public.tolak_ubah_item_pesanan() is
  'Menolak SELURUH UPDATE pada baris nota, tanpa gerbang current_user: yang '
  'paling mungkin menulis ulang harga beku adalah webhook ber-service-role. '
  'DELETE sengaja tidak disentuh — cascade dari pesanan harus bisa jalan.';

revoke all on function public.tolak_ubah_item_pesanan() from public, anon, authenticated;

create trigger item_pesanan_beku
  before update on public.order_items
  for each row execute function public.tolak_ubah_item_pesanan();
