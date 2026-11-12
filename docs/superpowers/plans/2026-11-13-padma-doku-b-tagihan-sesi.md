# Rencana B (P3) — tagihan sesi pengajuan lewat mesin pesanan DOKU

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tagihan pengajuan klien (jalur 1) menjadi pesanan berjenis `sesi` di mesin pesanan yang sama, dibayar lewat DOKU, dan sesinya lahir otomatis saat lunas. Jalur 2, penukaran kredit, dan paket tidak berubah satu baris pun.

**Architecture:**
- Harga dihitung **sekali** di SQL (`rincian_tagihan_permintaan`) lalu dibekukan ke `order_items`.
- Penerbitan, terbit ulang, pembatalan, dan ganti bidan adalah fungsi SQL berperan staf.
- Penutupan pesanan terbuka saat pengajuan batal atau masukan harga berubah ditegakkan **trigger** pada `booking_requests`, sehingga berlaku untuk setiap jalur tulis.
- Kelahiran sesi ada di penyalur tertutup `salurkan_sesi` yang dipanggil `salurkan_pesanan`. Penyalur itu tidak pernah melempar.
- Layar staf tetap nol rupiah. Klien membaca angka beku lewat RPC miliknya sendiri.

**Tech Stack:** sama dengan rencana A (Next.js 16 termodifikasi, Supabase Postgres, Zod, Vitest).

**Spec:** `docs/superpowers/specs/2026-11-12-padma-doku-design.md` §6–§7, §9–§10 (disetujui 13 Nov 2026).

**Prasyarat:**
- Rencana A **Tugas A1–A4** selesai: lingkungan, invoice, kolom netral, dan `terapkan_notifikasi_gateway`.
- **Tugas B6 juga butuh A6** (`terbitkanTautanBayar`).
- Kunci sandbox sudah ada di `web/.env.local` per 13 Nov, jadi urutan yang disarankan **A1–A12 lalu B1–B8**.

## Global Constraints

Semua Global Constraints rencana A berlaku. Tambahan khusus P3:

- **Jalur 2 tidak disentuh:** `jadwalkanSesi`, `klaim_sudah_bayar`, `tandaiLunas`, `tolakKlaim`, `/admin/bayar` tab klaim, QRIS di `/passport/bayar` untuk klaim, dan tiga kunci QRIS di `/admin/pengaturan`.
- **Tenggat bayar sesi** = `least(now() + JAM_TENGGAT_PESANAN jam, (tanggal + jam_mulai) di Asia/Jakarta)`. `booking_requests.tenggat` = **nilai yang sama persis** dengan `orders.kedaluwarsa_pada`. Penerbitan ditolak bila jam kunjungan sudah lewat.
- **Item pesanan sesi:** urutan 1 `"Sesi kunjungan PADMA"` (harga layanan) dan urutan 2 `"Biaya transport"` (tarif transport; dihilangkan bila 0). Tanpa nama layanan, karena nama layanan bisa mengungkap kondisi kesehatan (§5.3).
- **"Uang sudah masuk" untuk satu pengajuan** = salah satu dari tiga hal:
  - ada pesanan `lunas`/`ditahan` untuknya;
  - ada pesanannya yang `sebab_tinjauan = 'lunas_setelah_tutup'` dengan `butuh_tinjauan_pada is not null`;
  - `booking_requests.status_bayar <> 'belum'`.

  Bila salah satu benar, terbit ulang, pembatalan, dan tombol Bayar ditolak (§6.5).
- **Tidak ada pembatalan otomatis karena tenggat.** Tidak ada pembatalan massal (§6.5, §7).
- **`/admin/sesi` dan `?lihat=` nol rupiah** (`nominalDalam` = `[]`). Nominal hanya di `/admin/pesanan`, `/admin/bayar` (baris warisan), Passport milik klien, dan email tagihan.
- Kolom baru di tabel di luar `TABEL_UANG` tidak boleh cocok `POLA_NOMINAL`, jadi penanda kabari bidan bernama `kabari_bidan_sejak`.
- **Fungsi yang menulis tabel mesin** (`orders`, `order_items`, `jejak_pesanan`, `notifikasi_pesanan`) masuk tepat satu daftar di `tests/fungsi-mesin-tertutup.test.ts`: `MESIN_TERTUTUP`, atau `TERBUKA_SADAR` dengan gerbangnya.
- **Nilai enum baru dan pemakaiannya ada di migrasi berbeda.** `alter type … add value` belum bisa dipakai dalam transaksi yang sama.
- **Penyimpangan sadar dari spec §6.4:** `putuskan_pesanan_ditahan` **tetap tidak menyalurkan**. Itu keputusan P1 yang dijaga `tests/admin-pesanan.test.tsx:486-510`: putusan "lunas" lalu tombol "Terbitkan akses / Buat sesi". Spec §6.4 sudah dikoreksi 13 Nov.

## Review Focus

1. **Tenggat jatuh di tengah malam Jakarta.** Kunjungan `2026-11-20 06:00` yang diterbitkan `2026-11-20 01:00` WIB harus memakai jam Jakarta. Vercel berjalan UTC; salah zona menggeser tenggat 7 jam. Uji di B2.
2. **Admin menekan "Terbitkan tagihan" dua kali cepat, atau di dua tab** → satu pesanan terbuka saja. Indeks per pengajuan dan kunci baris menolak yang kedua. Uji di B2.
3. **Klien membatalkan pengajuan sementara sesinya tertahan** (pesanan sudah lunas) → ditolak dengan kalimat yang bisa dipahami, bukan galat mentah. Uji di B4.
4. **Pesanan sesi tidak boleh muncul sebagai "pesanan terbuka" di keranjang atau tombol beli**, dan sebaliknya. Ini terjadi saat klien punya tagihan sesi terbuka lalu membuka produk. Uji di B1.
5. **Email tagihan gagal terkirim** → tagihan tetap terbit dan `email_tagihan_pada` tetap null (D2). Uji di B5.

---

### Tugas B1: Jenis pesanan dan invarian "satu pesanan terbuka" (§6.6, §6.10)

**Files:**
- Create: `web/supabase/migrations/20261113140000_pesanan_jenis.sql`
- Modify:
  - `web/src/lib/keranjang/baca.ts` (`pesananTerbukaSaya`)
  - `web/src/app/produk/[slug]/tombol-beli.tsx` (bacaan `orders` di `:531-535`)
  - `web/src/lib/penjualan/baca.ts` (setiap kueri `orders`)
  - `web/src/lib/pesanan/status.ts` (dokblok `pesanan_terbuka_satu_per_klien`, bila ada)
- Test: create `web/tests/pesanan-jenis-db.test.ts`; modify `web/tests/penjualan-hitung.test.ts` bila perlu

**Interfaces:**
- Produces (DB):
  - `orders.jenis public.order_item_source not null default 'produk_digital'`
  - `orders.booking_request_id uuid null references public.booking_requests(id)`
  - `check pesanan_jenis_bercermin ((jenis = 'sesi') = (booking_request_id is not null))`
  - indeks unik parsial `pesanan_produk_terbuka_satu_per_klien on orders (client_id) where status = 'menunggu_bayar' and jenis = 'produk_digital'`, menggantikan `pesanan_terbuka_satu_per_klien`
  - indeks unik parsial `pesanan_sesi_terbuka_satu_per_pengajuan on orders (booking_request_id) where status = 'menunggu_bayar'`

- [ ] **Step 1: Tulis uji yang gagal.** Fixture pesanan sesi dibuat dengan service role: `orders` (`jenis='sesi'`, `booking_request_id`) ditambah satu `order_items` `sesi`. Pengajuannya fixture `menunggu_bayar` yang sah lewat transisi legal; tiru `tests/admin-sesi-konfirmasi.test.ts:248-258`.
  - Klien yang punya pesanan sesi terbuka tetap bisa `buat_pesanan` produk, dan sebaliknya.
  - Dua pesanan sesi terbuka untuk pengajuan **berbeda** milik klien yang sama → sah.
  - Pesanan sesi terbuka kedua untuk pengajuan yang **sama** → `23505`.
  - `jenis='sesi'` tanpa `booking_request_id` → `23514`.
  - `batalkan_pesanan_saya` atas pesanan sesi → galat, status tetap.
  - `pesananTerbukaSaya` tidak memulangkan pesanan sesi.
  - Indeks lama tidak ada lagi di `pg_indexes`.
  - **P4:** `bacaPenjualan` tidak memuat pesanan sesi `lunas`, dan angka totalnya sama sebelum dan sesudah pesanan sesi lunas disemai.
- [ ] **Step 2:** `npx vitest run tests/pesanan-jenis-db.test.ts`. Expected: FAIL.
- [ ] **Step 3: Tulis migrasi.**
  - Kolom, check, dan indeks seperti di atas.
  - `create or replace` `buat_pesanan_keranjang`: salin definisi dari migrasi A3, lalu ubah dua hal:
    - pilihan pesanan terbuka ditambah `and o.jenis = 'produk_digital'` (dua tempat: `:367-371` dan di dalam handler);
    - nama kendala di handler `unique_violation` menjadi `pesanan_produk_terbuka_satu_per_klien`.
  - `create or replace` `batalkan_pesanan_saya` (salinan `20260926130000:409-476`) ditambah syarat `and o.jenis = 'produk_digital'`. Pesannya "Pesanan itu tidak ada pada akun ini." tetap sama.
  - TS: tambahkan `.eq("jenis", "produk_digital")` pada ketiga pembaca di atas.
- [ ] **Step 4:** Jalankan `npx supabase migration up --local --include-all && npx vitest run tests/pesanan-jenis-db.test.ts tests/keranjang-pesanan-db.test.ts tests/pesanan-checkout-db.test.ts tests/produk-tombol-beli.test.tsx tests/penjualan-hitung.test.ts`. Expected: PASS. Buktikan merah: hapus filter `jenis` dari `pesananTerbukaSaya` (Review Focus 4), lalu kembalikan.
- [ ] **Step 5: Commit** — `feat(pesanan): jenis pesanan dan satu pesanan terbuka per pengajuan`.

### Tugas B2: Rumus harga di SQL dan `terbitkan_tagihan_sesi` (§6.2, §6.5 kunci, D1)

**Files:**
- Create: `web/supabase/migrations/20261113140100_terbitkan_tagihan_sesi.sql`
- Modify:
  - `web/src/app/admin/sesi/aksi.ts` (`terbitkanTagihan`)
  - `web/src/lib/tagihan/tenggat.ts` (hapus `JAM_TENGGAT_BAYAR`; pemakai beralih ke `JAM_TENGGAT_PESANAN`)
  - `web/src/lib/tagihan/pengajuan.ts` (tambah `KALIMAT_SEBAB_ADMIN.jam_kunjungan_lewat`, `bidan_nonaktif`, `uang_sudah_masuk`)
- Test:
  - Create `web/tests/tagihan-sesi-db.test.ts`
  - Modify `web/tests/admin-rantai-mitra.test.ts` (`:206`)
  - Modify `web/tests/admin-sesi-catatan.test.ts` (hitungan `toISOString` di `:1247` dari 2 menjadi 1; uji itu memang menghitung)
  - Modify `web/tests/fungsi-mesin-tertutup.test.ts`

**Interfaces:**
- Produces (DB, keduanya `security definer`, gerbang `user_role() in ('admin','owner')` → `TERBUKA_SADAR: "user_role"`):

```sql
rincian_tagihan_permintaan(p_permintaan_id uuid)
  returns table (layanan integer, transport integer, jenjang public.jenjang_transport, sebab text)
-- sebab ∈ {null,'mitra_tanpa_titik','alamat_tanpa_pin','tarif_varian_kosong','tarif_transport_kosong'}
-- harga: variant_rates.harga_klien dengan berlaku_sejak <= tanggal, terbaru (sama dengan tarifPadaTanggal)
-- jenjang: jenjang_dari_jarak(jarak_km(partner, alamat)) bila keempat koordinat ada

terbitkan_tagihan_sesi(p_permintaan_id uuid) returns uuid   -- id pesanan baru
```

- Produces (TS): `terbitkanTagihan(permintaanId)` memanggil RPC itu. Galat yang ber-`hint = 'sebab_tagihan'` dipetakan `KALIMAT_SEBAB_ADMIN[error.message]`.

- [ ] **Step 1: Tulis uji yang gagal.** Fixture pengajuan `mitra_siap` (bidan aktif bertitik, alamat berpin, varian dan transport bertarif) dibuat lewat transisi sah. Pemanggilnya `signInAs("admin@padma.test")`.
  - **Terbit pertama:**
    - pesanan `jenis='sesi'` dengan `booking_request_id`;
    - item sesuai Global Constraints, `harga_beku` = layanan dan transport dari `rincian_tagihan_permintaan`;
    - `jumlah_item` = jumlah item;
    - jejak `dibuat`;
    - pengajuan `menunggu_bayar`, `status_bayar='belum'`, `tenggat === kedaluwarsa_pada`.
  - **Tenggat:**
    - `kedaluwarsa_pada` ≈ now+24 jam (±60 detik) untuk kunjungan 3 hari lagi;
    - = jam kunjungan Jakarta untuk kunjungan 3 jam lagi;
    - kunjungan sudah lewat → galat `jam_kunjungan_lewat`.
  - **Zona Jakarta (Review Focus 1):** kunjungan `tanggal` hari ini Jakarta pukul `jam_mulai` = 2 jam dari sekarang (dihitung di uji dengan offset `+07:00`) → `kedaluwarsa_pada` = instan itu.
  - **Tarif tidak lengkap:** keempat sebab masing-masing menghasilkan galat ber-hint `sebab_tagihan` dan nol pesanan.
  - **Transport 0** → satu item.
  - **Bidan nonaktif** → `bidan_nonaktif`.
  - **Hak akses:** klien → `42501`; `anon` tidak punya EXECUTE.
  - **Terbit ulang dari `menunggu_bayar`:**
    - pesanan lama `dibatalkan` dengan jejak, pesanan baru terbuka, tenggat baru;
    - dengan pesanan `lunas` → `uang_sudah_masuk`;
    - dengan `lunas_setelah_tutup` yang belum ditutup → `uang_sudah_masuk`, dan sesudah `tutup_tinjauan` → sah;
    - `status_bayar='menunggu_verifikasi'` → `uang_sudah_masuk`.
  - **Dua panggilan bersamaan (Review Focus 2):** `Promise.all` dua RPC terbit ulang → tepat satu pesanan `menunggu_bayar` untuk pengajuan itu.
  - **Kesetaraan dengan rumus TS lama (D1):** untuk empat fixture (jenjang terisi; tanpa pin → sebab sama; tarif varian berganti `berlaku_sejak` di antara hari ini dan tanggal kunjungan; transport 0), `rincian_tagihan_permintaan` = `hitungTagihanPengajuan` yang diberi baris tarif yang sama.
  - **Angka beku:** menaikkan `variant_rates` sesudah terbit tidak mengubah `harga_beku` pesanan yang ada, dan terbit ulang sesudahnya memakai tarif baru.
- [ ] **Step 2:** `npx vitest run tests/tagihan-sesi-db.test.ts`. Expected: FAIL.
- [ ] **Step 3: Tulis kedua fungsi.**
  - **`terbitkan_tagihan_sesi`:**
    1. `select … for update` pengajuan.
    2. Status harus `mitra_siap` atau `menunggu_bayar`.
    3. Bila `menunggu_bayar`, periksa "uang sudah masuk" (Global Constraints) → `raise … using errcode = 'P0001', message = 'uang_sudah_masuk', hint = 'sebab_tagihan'`.
    4. Bidan `aktif`.
    5. `v_mulai := (tanggal + jam_mulai) at time zone 'Asia/Jakarta'`; `v_mulai <= now()` → `jam_kunjungan_lewat`.
    6. Rincian dari `rincian_tagihan_permintaan`; sebab tidak null → raise dengan sebab itu.
    7. Tutup pesanan terbuka pengajuan ini: `dibatalkan`, `ditutup_pada`, jejak `dibatalkan` `'tagihan diterbitkan ulang'`.
    8. Sisipkan `orders`. Pembangkitan `kode` dan loop `unique_violation` disalin dari `buat_pesanan_keranjang` (`20261016120000:420-450`). Nilainya: `jenis='sesi'`, `booking_request_id`, `client_id`, `jumlah_item`, `kedaluwarsa_pada = least(now() + interval '24 hours', v_mulai)`.
    9. Item, lalu jejak `dibuat` `'tagihan sesi'`.
    10. Update pengajuan: `tenggat`, `status_bayar='belum'`, dan `status='menunggu_bayar'` **hanya bila** status lamanya `mitra_siap`.
  - Interval `'24 hours'` diberi komentar SQL yang menunjuk `JAM_TENGGAT_PESANAN`. Uji tenggat di atas adalah pengikatnya.
  - **TS:** `terbitkanTagihan` membuang gerbang `daftarTagihanPengajuanAdmin`, memanggil RPC, memetakan galat, lalu `kirimEmailTagihan` seperti sekarang. Isi email diubah di B5.
- [ ] **Step 4:** Jalankan `npx supabase migration up --local --include-all && npx vitest run tests/tagihan-sesi-db.test.ts tests/admin-rantai-mitra.test.ts tests/admin-sesi-catatan.test.ts tests/fungsi-mesin-tertutup.test.ts tests/tagihan-pengajuan.test.ts`, lalu `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Buktikan merah:**
  - hapus `at time zone 'Asia/Jakarta'` → uji zona memerah;
  - hapus `for update` dan jalankan uji Review Focus 2 lima kali; bila tidak memerah, tulis di commit bahwa indeks unik B1 yang menjaganya.

  Kembalikan keduanya.
- [ ] **Step 6: Commit** — `feat(tagihan): tagihan sesi menjadi pesanan beku dengan harga dihitung di SQL`.

### Tugas B3: Penyalur sesi — lunas melahirkan sesi (§6.4)

**Files:**
- Create:
  - `web/supabase/migrations/20261113140200_kejadian_sesi.sql`: hanya `alter type public.order_event add value 'sesi_terkonfirmasi'; … add value 'sesi_tertahan';`
  - `web/supabase/migrations/20261113140300_salurkan_sesi.sql`
- Modify:
  - `web/src/lib/pesanan/status.ts` (`KEJADIAN_PESANAN_SAH` diakhiri dua nilai baru sesuai urutan enum; `KEJADIAN_BUTUH_TINJAUAN` ditambah `sesi_tertahan`)
  - `web/src/app/api/pesanan/[id]/terbitkan-akses/route.ts`
  - `web/src/app/admin/pesanan/tombol-pesanan.tsx` (label "Terbitkan akses / Buat sesi")
  - `web/src/lib/admin/pesanan.ts`: pesanan `lunas` dengan item sesi tanpa baris `sessions` untuk `booking_request_id`-nya masuk "Butuh perhatian", padanan "akses belum terbit"
- Test:
  - Create `web/tests/penyalur-sesi-db.test.ts`
  - Modify `web/tests/pesanan-status-db.test.ts`, `web/tests/fungsi-mesin-tertutup.test.ts`, `web/tests/admin-pesanan.test.tsx`, `web/tests/admin-rantai-mitra.test.ts` (`:278-384`, `konfirmasi_permintaan`)

**Interfaces:**
- Produces (DB):
  - `sessions.kabari_bidan_sejak timestamptz null`.
  - `sisipkan_sesi_dari_permintaan(p_permintaan_id uuid, p_kabari boolean) returns uuid`, tertutup. Ia memuat sisipan `sessions` yang dipindah apa adanya dari `konfirmasi_permintaan` (`20260912101000:133-159`, termasuk jenjang otomatis) dan menambah `kabari_bidan_sejak = case when p_kabari then now() end`.
  - `salurkan_sesi(p_pesanan_id uuid) returns text`, tertutup, dengan nilai balik `'terkonfirmasi' | 'sudah_ada' | 'tertahan'`; **tidak pernah melempar**.
  - `salurkan_pesanan` (didefinisikan ulang dari salinan terakhirnya, `20260927100000_sebab_tinjauan_lestari.sql:179-236`): cabang `'sesi'` berhenti mencatat `penangan_belum_ada`. Sesudah loop item, bila pesanan punya item sesi → `perform public.salurkan_sesi(p_pesanan_id)` sekali.
  - `konfirmasi_permintaan`: ditambah penolakan `P0001` "Pengajuan ini dibayar lewat DOKU; sesinya lahir otomatis." bila ada `orders` apa pun dengan `booking_request_id` ini; sisipannya memanggil `sisipkan_sesi_dari_permintaan(id, false)`.
- Produces (TS): jawaban rute `terbitkan-akses` ditambah `sesi: "terkonfirmasi" | "sudah_ada" | "tertahan" | null`. Item sesi tidak lagi masuk `belumAdaPenangan`.

- [ ] **Step 1: Tulis uji yang gagal.** Pesanan sesi dibuat lewat `terbitkan_tagihan_sesi` (B2) lalu dilunasi lewat `terapkan_notifikasi_gateway` `SUCCESS` (service role, invoice dari `rakitInvoice`).
  - **Lunas:**
    - satu `sessions` `terjadwal` dan `status_bayar='lunas'`;
    - `booking_request_id`, alamat, koordinat, tanggal, jam, varian, dan bidan disalin dari pengajuan;
    - `jenjang_sumber='otomatis'`, `kabari_bidan_sejak` terisi;
    - pengajuan `dikonfirmasi` dan `status_bayar='lunas'`;
    - jejak `sesi_terkonfirmasi`, dan pesanan tanpa tanda tinjauan.
  - **Bidan dinonaktifkan sebelum notifikasi:**
    - RPC tetap `diterapkan` dan pesanan `lunas` (uangnya tercatat);
    - nol sesi;
    - jejak `sesi_tertahan` dan tinjauan `sesi_tertahan`;
    - pengajuan tetap `menunggu_bayar`.
  - **Jam kunjungan lewat sebelum notifikasi** (disetel lewat service role sesudah terbit) → `tertahan`.
  - **Pemulihan:**
    - aktifkan bidan → `salurkan_sesi` → `terkonfirmasi`;
    - panggilan kedua → `sudah_ada`, tetap satu sesi;
    - rute `terbitkan-akses` sebagai admin memulangkan `sesi: "terkonfirmasi"`, lalu `"sudah_ada"`.
  - **Hak akses:** `salurkan_sesi` dan `sisipkan_sesi_dari_permintaan` tidak bisa dieksekusi `authenticated`.
  - **`konfirmasi_permintaan`:**
    - atas pengajuan yang punya pesanan → `P0001`;
    - atas baris warisan (tanpa pesanan, `status_bayar='lunas'`) → sesi lahir dengan `kabari_bidan_sejak` null.
  - **Mirror TS–SQL:** urutan `KEJADIAN_PESANAN_SAH` = urutan enum SQL (uji yang sudah ada di `pesanan-status-db.test.ts`).
  - **`putuskan_pesanan_ditahan` "lunas"** atas pesanan sesi → nol sesi, pesanan masuk "Butuh perhatian" `bacaPesananStaf`, lalu rute → `terkonfirmasi`.
- [ ] **Step 2:** `npx vitest run tests/penyalur-sesi-db.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementasikan.**
  - **`salurkan_sesi`:** ambil `booking_request_id` dari item sesi pesanan, lalu `select … for update` pengajuannya.
    - Bila sudah ada `sessions` untuknya → `sudah_ada`.
    - Empat syarat §6.4: pengajuan `menunggu_bayar`, bidan `aktif`, pesanan `lunas`, dan `v_mulai > now()`.
    - Gagal syarat → jejak `sesi_tertahan` dengan alasan spesifik dan tinjauan `coalesce` lestari → `tertahan`.
    - Lolos syarat:
      1. update pengajuan `status='dikonfirmasi', status_bayar='lunas'`;
      2. `sisipkan_sesi_dari_permintaan(id, true)`;
      3. jejak `sesi_terkonfirmasi` → `terkonfirmasi`.
    - Seluruh badan dibungkus `begin … exception when others then` → jejak `sesi_tertahan` (`sqlerrm`) dan tinjauan → `tertahan`. Polanya sama dengan `akses_tertahan` di `terbitkan_akses_item` (`20261016120000:499`).
  - **Rute:** item `sesi` → `admin.rpc("salurkan_sesi", { p_pesanan_id })` sekali per pesanan.
- [ ] **Step 4:** Jalankan `npx supabase migration up --local --include-all && npx vitest run tests/penyalur-sesi-db.test.ts tests/pesanan-status-db.test.ts tests/fungsi-mesin-tertutup.test.ts tests/admin-pesanan.test.tsx tests/admin-rantai-mitra.test.ts tests/notifikasi-gateway-db.test.ts`. Expected: PASS.
- [ ] **Step 5: Buktikan merah:**
  - hapus blok `exception when others` lalu paksa galat (bidan dihapus `partner_id` lewat service role) → uji "RPC tetap diterapkan" memerah karena RPC melempar;
  - hapus syarat `v_mulai > now()` → uji jam lewat memerah.
- [ ] **Step 6: Commit** — `feat(sesi): lunas DOKU melahirkan sesi otomatis lewat penyalur tertutup`.

### Tugas B4: Pembatalan, ganti bidan, dan penjaga pengajuan (§6.3 batal klien, §6.5, §6.7 `status_bayar`)

**Files:**
- Create: `web/supabase/migrations/20261113140400_penjaga_pengajuan.sql`
- Create: `web/src/app/admin/sesi/aksi-tagihan.ts` (`"use server"`, setiap ekspor diawali `requireRole(["admin","owner"])`, tanpa `createAdminSupabase`)
- Modify:
  - `web/src/app/admin/sesi/aksi-ubah-permintaan.ts` (status yang diizinkan memakai `STATUS_UBAH_PERMINTAAN_STAF`)
  - `web/src/lib/jadwal/status.ts` (`STATUS_UBAH_PERMINTAAN_STAF = [...STATUS_UBAH_PERMINTAAN, "menunggu_bayar"]`)
  - `web/src/lib/passport/aksi.ts` (`batalkanPengajuan` memetakan galat "uang sudah masuk" ke kalimat klien)
  - `web/src/app/admin/bayar/aksi-pengajuan.ts` (`verifikasiPengajuan` memanggil RPC warisan)
- Test: create `web/tests/penjaga-pengajuan-db.test.ts`; modify `web/tests/admin-sesi-catatan.test.ts` dan uji struktural lain yang menghitung ekspor atau berkas di `admin/sesi`

**Interfaces:**
- Produces (DB):
  - Trigger fn `guard_batal_permintaan_beruang()` BEFORE UPDATE OF status. Bila `new.status in ('dibatalkan_klien','dibatalkan_tenggat','mencari_mitra')` dan uang sudah masuk → `raise … errcode 'P0001', message 'Pembayaran pengajuan ini sudah masuk dan sedang diperiksa admin.'`. Berlaku untuk **semua** peran.
  - Trigger fn `tutup_pesanan_sesi_terbuka()` AFTER UPDATE (tertutup, `MESIN_TERTUTUP`). Bila status menjadi salah satu dari tiga di atas, **atau** `partner_id`/`variant_id`/`service_id`/`tanggal`/`jam_mulai`/`alamat_lat`/`alamat_lon` berubah, setiap pesanan `menunggu_bayar` pengajuan itu menjadi `dibatalkan` dengan jejak `dibatalkan` yang menyebut sebabnya.
  - Trigger fn `guard_status_bayar_permintaan()` BEFORE UPDATE. `new.status_bayar is distinct from old.status_bayar` dan `current_user in ('anon','authenticated','authenticator')` → `42501`.
  - `batalkan_pengajuan_staf(p_permintaan_id uuid) returns void`, `user_role`: dari `menunggu_bayar` → `dibatalkan_tenggat`, `screening_id = null`. Berlaku juga untuk baris warisan.
  - `ganti_bidan_permintaan(p_permintaan_id uuid, p_partner_id uuid) returns void`, `user_role`: hanya `menunggu_bayar`, bidan `aktif`, set `partner_id`. Pesanan terbuka tertutup lewat trigger; pesanan lunas tidak terpengaruh dan harganya tetap beku.
  - `verifikasi_bukti_warisan(p_permintaan_id uuid) returns void`, `user_role`: hanya pengajuan tanpa `orders`, `menunggu_bayar`, `status_bayar='menunggu_verifikasi'` → `'lunas'`.
- Produces (TS, `aksi-tagihan.ts`):
  - `batalkanPengajuanStaf(permintaanId: string): Promise<Berhasil | Gagal>`
  - `gantiBidanMenungguBayar(permintaanId: string, partnerId: string): Promise<Berhasil | Gagal>`
  - `tandaiSudahDikabari(sesiId: string): Promise<Berhasil | Gagal>`: update `sessions.kabari_bidan_sejak = null` dengan sesi staf

- [ ] **Step 1: Tulis uji yang gagal.**
  - **Pembatalan oleh klien:**
    - `batalkanPengajuan` atas `menunggu_bayar` berpesanan terbuka → pengajuan `dibatalkan_klien` dan pesanan `dibatalkan` dalam satu transaksi;
    - `SUCCESS` yang mendarat sesudahnya → `lunas_setelah_tutup`.
  - **Pengajuan tertahan berpesanan `lunas`:**
    - pembatalan klien ditolak dan kalimat klien tampil (Review Focus 3);
    - `batalkanPengajuanStaf` ditolak;
    - `cariMitra`-lewat-REST ke `mencari_mitra` ditolak.
  - **`batalkanPengajuanStaf`:**
    - baris berpesanan terbuka → `dibatalkan_tenggat`, `screening_id` null (skrining terlepas), pesanan `dibatalkan`;
    - baris warisan tanpa pesanan → sah;
    - `status_bayar='menunggu_verifikasi'` → ditolak.
  - **Masukan harga berubah saat pesanan terbuka:**
    - `perbaruiPermintaan` mengubah `jam_mulai` pada `menunggu_bayar` → pesanan terbuka `dibatalkan`;
    - `gantiBidanMenungguBayar` → sama;
    - mengubah `alamat` (teks) saja → pesanan **tetap** terbuka.
  - **Ganti bidan pada pesanan `lunas` (tertahan)** → `partner_id` berubah, pesanan tetap `lunas` dengan `harga_beku` sama; `salurkan_sesi` lalu `terkonfirmasi`.
  - **Penjaga `status_bayar`:**
    - staf mem-PATCH `booking_requests.status_bayar` lewat REST → `42501`;
    - fungsi mesin (B3) tetap bisa.
  - **`verifikasi_bukti_warisan`:**
    - atas baris berpesanan → galat;
    - atas baris warisan `menunggu_verifikasi` → `lunas`.
  - **`tandaiSudahDikabari`** mengosongkan penanda.
  - **Hak akses:** klien tidak bisa memanggil ketiga RPC staf.
- [ ] **Step 2:** `npx vitest run tests/penjaga-pengajuan-db.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementasikan migrasi dan aksi.**
  - Daftarkan `tutup_pesanan_sesi_terbuka` di `MESIN_TERTUTUP`, sedangkan `batalkan_pengajuan_staf` dan `ganti_bidan_permintaan` di `TERBUKA_SADAR: "user_role"` bila badannya menulis tabel mesin.
  - Kalimat galat SQL dipetakan ke kalimat layar di aksi TS. Aksi tidak pernah meneruskan `error.message` mentah ke klien, kecuali kode `P0001` yang memang kalimat manusia.
- [ ] **Step 4:** Jalankan `npx supabase migration up --local --include-all && npx vitest run tests/penjaga-pengajuan-db.test.ts tests/admin-sesi-catatan.test.ts tests/admin-sesi-konfirmasi.test.ts tests/passport-keamanan.test.ts tests/fungsi-mesin-tertutup.test.ts tests/rantai-status-db.test.ts`, lalu `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Buktikan merah:**
  - keluarkan `jam_mulai` dari daftar masukan harga di trigger → uji perubahan jam memerah;
  - batasi penjaga beruang ke peran API saja → uji `batalkanPengajuanStaf` (security definer) memerah.
- [ ] **Step 6: Commit** — `feat(tagihan): pembatalan, ganti bidan, dan penjaga pengajuan bertagihan`.

### Tugas B5: Layar staf — `/admin/sesi` nol rupiah, kabari bidan, `/admin/pesanan` jenis Sesi, email & WA (§6.2, §6.5, §6.7, D2–D4)

**Files:**
- Create: `web/supabase/migrations/20261113140500_item_staf_pengajuan.sql` (`create or replace view public.pesanan_item_staf` = definisi `20261006100000` ditambah kolom `i.booking_request_id` **di akhir**)
- Modify:
  - `web/src/lib/admin/permintaan.ts` (status tagihan per pengajuan dari `orders`: `status`, `kedaluwarsa_pada`, `butuh_tinjauan_pada`, keberadaan sesi; tanpa nominal)
  - `web/src/app/admin/sesi/page.tsx` (`labelBayarPermintaan`, `tautanWaUntukLihat`, dan pemanggilan `daftarTagihanPengajuanAdmin` dicabut)
  - `web/src/app/admin/sesi/panel-permintaan.tsx` (rincian rupiah dibuang, diganti kata keadaan dan kode pesanan yang bertaut ke `/admin/pesanan`)
  - `web/src/app/admin/sesi/aksi-permintaan.tsx`: tombol per keadaan:
    - "Terbitkan ulang" dan "Batalkan pengajuan" saat tenggat lewat atau terbuka tanpa uang;
    - "Ganti bidan" untuk `menunggu_bayar`;
    - "Konfirmasi jadwal" **hanya** untuk baris warisan `status_bayar='lunas'` tanpa pesanan;
    - "Kirim tagihan via WA" dan "Kirim (ulang) email" tetap.
  - `web/src/app/admin/sesi/panel-sesi.tsx` dan daftar sesi: penanda "Baru — kabari bidan" dan tombol "Sudah dikabari" (sesi batal tidak ditandai)
  - `web/src/lib/admin/antrean.ts` (`hitungAntrean` ditambah `kabariBidan: number`) dan pemakainya di header admin
  - `web/src/lib/tagihan/pesan-tagihan.ts` (`pesanTagihan` tanpa medan harga)
  - `web/src/lib/tagihan/email-tagihan.ts` dan `kirimEmailTagihan` di `aksi.ts`
  - `web/src/app/admin/pesanan/tabel-pesanan.tsx` dan `web/src/lib/admin/pesanan.ts` (label jenis "Sesi" dan tautan ke pengajuan)
  - `web/tests/money-firewall-struktural.test.ts`: `pesanan_item_staf` tetap hanya `harga_beku` sebagai kolom uang; `booking_request_id` bukan uang, jadi allowlist tidak berubah
- Test: create `web/tests/admin-sesi-tagihan.test.tsx`; modify `web/tests/pesan-tagihan.test.ts`, `web/tests/admin-sesi-konfirmasi.test.ts`, `web/tests/admin-sesi-catatan.test.ts`, `web/tests/admin-pesanan.test.tsx`

**Interfaces:**
- Consumes: B2 (RPC terbit), B4 (aksi), `pesanan_item_staf` (dengan sesi staf).
- Produces:
  - `pesanTagihan(input: { namaKlien: string; namaLayanan: string; tanggal: string; jam: string; tautanPassport: string; sisaWaktu: string }): string`. Teksnya tanpa angka dan tanpa QRIS: "Tagihan Anda sudah terbit. Bayar di Digital Passport: <tautan>".
  - `emailTagihan(input: { …nama/tanggal/jam…, hargaLayanan: string; hargaTransport: string | null; total: string; tenggatAbsolut: string; tautanBayar: string })`. Angka dari `pesanan_item_staf` pesanan terbuka; `tautanBayar = ${basis}/passport/bayar/${permintaanId}`; tanpa kalimat unggah bukti atau QRIS.

- [ ] **Step 1: Tulis uji yang gagal.**
  - **Money firewall D3:** render `/admin/sesi` dengan `searchParams` `{ tab: "permintaan", lihat: <id menunggu_bayar> }` → `nominalDalam(html)` = `[]`; `href` WA tidak memuat angka berbentuk rupiah atau `Rp`. Lakukan juga untuk keadaan tertahan dan tenggat lewat.
  - **Kata keadaan:**
    - "Menunggu pembayaran, tenggat …";
    - "Tenggat lewat" (pesanan `kedaluwarsa`);
    - "Pembayaran perlu ditinjau" bertaut `/admin/pesanan` (tanda tinjauan);
    - "Pembayaran diterima — sesi tertahan".
  - **Tombol "Konfirmasi jadwal":**
    - tidak ada pada pengajuan berpesanan;
    - ada pada baris warisan `lunas` tanpa pesanan.
  - **Kabari bidan:**
    - sesi hasil penyalur tampil "Baru — kabari bidan";
    - sesudah `tandaiSudahDikabari` penanda hilang;
    - sesi jalur 2 (`jadwalkanSesi`) tidak bertanda;
    - `hitungAntrean().kabariBidan` menghitungnya.
  - **`/admin/pesanan`:** pesanan sesi berlabel "Sesi" dengan tautan `/admin/sesi?tab=permintaan&lihat=<id>`.
  - **Email D2:** `kirimEmail` dimock gagal → `terbitkanTagihan` tetap `{ ok: true }`, pesanan terbit, `email_tagihan_pada` null. Mock sukses → isi email memuat total beku, `/passport/bayar/<id>`, dan tidak memuat "unggah".
  - **`pesanTagihan`:** keluarannya tidak cocok `/rp|\d{1,3}(\.\d{3})+/i`.
- [ ] **Step 2:** `npx vitest run tests/admin-sesi-tagihan.test.tsx tests/pesan-tagihan.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementasikan.** Baca dulu panduan `searchParams` Promise di `node_modules/next/dist/docs/` sebelum menyentuh `page.tsx`.
- [ ] **Step 4:** Jalankan `npx supabase migration up --local --include-all && npx vitest run tests/admin-sesi-tagihan.test.tsx tests/pesan-tagihan.test.ts tests/admin-sesi-konfirmasi.test.ts tests/admin-sesi-catatan.test.ts tests/admin-pesanan.test.tsx tests/money-firewall-struktural.test.ts`, lalu `npx tsc --noEmit && npm run lint`. Expected: PASS.
- [ ] **Step 5: Buktikan merah:** kembalikan sementara rincian rupiah ke panel → uji D3 memerah.
- [ ] **Step 6: Commit** — `feat(admin): layar tagihan sesi tanpa nominal, penanda kabari bidan, jenis Sesi di pesanan`.

### Tugas B6: Klien membayar dari Passport (§6.3, §7 sisi klien) — butuh A6

**Files:**
- Create:
  - `web/supabase/migrations/20261113140600_tagihan_sesi_saya.sql`
  - `web/src/app/api/pesanan/sesi/[permintaan]/bayar/route.ts`
  - `web/src/app/passport/bayar/[id]/tombol-bayar.tsx` (`"use client"`)
- Modify:
  - `web/src/lib/tagihan/baca.ts` (`ambilTagihanPengajuan` dan `ambilTagihanPengajuanSatu` membaca RPC, tanpa rumus; tipe `TagihanPengajuan` diganti)
  - `web/src/app/passport/bayar/page.tsx` (bagian "Menunggu pembayaran" saja; klaim jalur 2 dan QRIS-nya tetap)
  - `web/src/app/passport/bayar/[id]/page.tsx`: QRIS dan `UnggahBukti` dibuang; Lapis 1b `periksaPesananMenggantung()` di awal render
- Test: create `web/tests/passport-bayar-sesi.test.ts`; modify `web/tests/passport-bayar-detail.test.ts`, `web/tests/passport-bayar-ajukan.test.ts`, `web/tests/tagihan-baca-hak.test.ts`

**Interfaces:**
- Produces (DB):

```sql
tagihan_sesi_saya(p_permintaan_id uuid default null)
  returns table (permintaan_id uuid, nama_layanan text, tanggal date, jam_mulai time,
                 status_permintaan public.booking_status, status_bayar public.pay_status,
                 pesanan_id uuid, kode text, status_pesanan public.order_status,
                 kedaluwarsa_pada timestamptz, butuh_tinjauan boolean, uang_sudah_masuk boolean,
                 tautan_baru boolean,         -- pesanan terbuka DAN tautan_terbit_pada > now() - 30 menit
                 sesi_id uuid, items jsonb)   -- items: [{judul, harga}] dari harga_beku, urut
-- security definer; klien dari auth.uid(); hanya pengajuan milik pemanggil yang
-- menunggu_bayar ATAU yang pesanan terkininya lunas/ditahan; pesanan = yang terbaru per pengajuan
```

  → `TERBUKA_SADAR: "auth.uid"` bila menulis (tidak menulis, jadi tidak wajib); tetap `revoke … from anon`.
- Produces (TS):
  - `ambilTagihanPengajuan(): Promise<TagihanPengajuan[]>`
  - `ambilTagihanPengajuanSatu(permintaanId: string): Promise<TagihanPengajuan | null>`
  - `type KeadaanTagihan = "bayar" | "diproses" | "lunas_sesi" | "lunas_tertahan" | "diperiksa" | "kedaluwarsa" | "warisan_dialihkan" | "warisan_bukti" | "warisan_lunas"`
  - `keadaanTagihan(t: TagihanPengajuan): KeadaanTagihan`, fungsi murni di `baca.ts` yang memetakan tabel §6.3 dan tabel §7. Keadaan `diproses` = `t.tautanBaru` dan pesanan masih `menunggu_bayar`.
  - Rute `POST /api/pesanan/sesi/[permintaan]/bayar` → `200 { url }`:
    - 401 tanpa sesi; 403 tanpa persetujuan S&K (`statusPersetujuan`, sama dengan checkout);
    - 409 bila tidak ada pesanan terbuka atau uang sudah masuk;
    - lainnya status dari `terbitkanTautanBayar(sesi, pesananId, \`/passport/bayar/${permintaan}\`)`.

- [ ] **Step 1: Tulis uji yang gagal.**
  - **RPC:**
    - hanya milik pemanggil (klien kedua → kosong);
    - `items` = angka beku;
    - `anon` tidak bisa.
  - **`keadaanTagihan`** untuk setiap baris tabel §6.3 dan §7:
    - `menunggu_bayar` sebelum tenggat → `bayar`;
    - `tautanBaru` dan pesanan masih `menunggu_bayar` → `diproses`;
    - lunas dengan `sesi_id` → `lunas_sesi`;
    - lunas tanpa sesi → `lunas_tertahan`;
    - `ditahan` atau tinjauan → `diperiksa`;
    - `kedaluwarsa` → `kedaluwarsa`;
    - tanpa pesanan dengan `status_bayar` `belum` / `menunggu_verifikasi` / `lunas` → tiga keadaan warisan.
  - **Halaman `[id]`:**
    - keadaan `bayar` memuat tombol Bayar, rincian beku, dan sisa waktu, dan tidak memuat "QRIS" atau "unggah";
    - `kedaluwarsa` memuat "Admin akan menghubungi Anda." tanpa tombol;
    - `lunas_tertahan` memuat "Pembayaran diterima, jadwal sedang disiapkan admin".
  - **Rute bayar:**
    - pemilik → `fetch` DOKU (distub) dengan `invoice_number` dari pesanan itu, `callback_url` berakhiran `/passport/bayar/<id>`, dan dua `line_items` bernama generik;
    - klien lain → 409;
    - uang sudah masuk → 409;
    - tanpa persetujuan → 403.
  - **Lapis 1b:** membuka halaman memanggil Check Status (distub) untuk pesanan sesi terbuka milik pemanggil.
- [ ] **Step 2:** `npx vitest run tests/passport-bayar-sesi.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementasikan.** Baca dulu panduan route handler dan `params` Promise di `node_modules/next/dist/docs/`.
  - Tombol Bayar: `fetch(rute) → window.location.assign(url)`; menonaktifkan diri selama permintaan berjalan.
  - Halaman kembali tidak membaca parameter apa pun dari DOKU (K11). Keadaan "sedang diproses" hanya diturunkan dari kolom RPC `tautan_baru`.
- [ ] **Step 4:** Jalankan `npx supabase migration up --local --include-all && npx vitest run tests/passport-bayar-sesi.test.ts tests/passport-bayar-detail.test.ts tests/passport-bayar-ajukan.test.ts tests/tagihan-baca-hak.test.ts`, lalu `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Buktikan merah:** hapus filter `auth.uid()` dari RPC → uji klien kedua memerah.
- [ ] **Step 6: Commit** — `feat(passport): bayar tagihan sesi lewat DOKU dari Digital Passport`.

### Tugas B7: Pensiun jalur QRIS pengajuan, cron tenggat, dan rumus TS (§6.8, §7)

**Files:**
- Create: `web/supabase/migrations/20261113140700_pensiun_tenggat.sql` (`drop function public.batalkan_lewat_tenggat();`)
- Delete:
  - `web/src/app/api/cron/tenggat/` dan `web/tests/cron-tenggat.test.ts`
  - `web/src/app/api/bukti/route.ts` (POST unggah). `web/src/app/api/bukti/[permintaan]/route.ts` (penampil staf) **tetap**.
  - `web/src/app/passport/bayar/[id]/unggah-bukti.tsx`
  - `hitungTagihanPengajuan`, `BarisTarif`, dan `BarisTarifTransport` di `web/src/lib/tagihan/pengajuan.ts` (`KALIMAT_SEBAB_*` tetap)
  - `sudahLewatTenggat` di `tenggat.ts`, beserta bagiannya di `web/tests/tenggat-bayar.test.ts` dan `web/tests/tagihan-pengajuan.test.ts`
- Modify:
  - `web/src/lib/admin/tagihan-pengajuan.ts`: dibatasi ke baris warisan **tanpa pesanan**; angkanya dari `rincian_tagihan_permintaan` (RPC staf B2), bukan rumus TS
  - `web/src/app/admin/bayar/page.tsx` (judul tab menyebut "warisan QRIS")
  - `web/.env.example:72` (rujukan cron tenggat)
  - `web/README.md` (baris rute `/api/cron/tenggat`, `/api/bukti` POST, dan rute bayar sesi baru)
  - `web/tests/pesanan-jadwal-actions.test.ts`: uji `:91-96` tetap; `/api/cron/tenggat` tidak boleh hidup kembali di workflow
- Test: create `web/tests/pensiun-qris-pengajuan.test.ts`

**Interfaces:** tidak ada yang baru.

- [ ] **Step 1: Tulis uji pagar yang gagal.**
  - `src/app/api/cron/tenggat` dan `src/app/api/bukti/route.ts` tidak ada.
  - `pg_proc` tidak memuat `batalkan_lewat_tenggat`.
  - `grep` `hitungTagihanPengajuan` di `src/` kosong.
  - `daftarTagihanPengajuanAdmin()` tidak memulangkan pengajuan yang punya pesanan.
  - Untuk baris warisan, angkanya sama dengan `rincian_tagihan_permintaan`.
  - Penampil bukti staf `GET /api/bukti/[permintaan]` masih melayani objek lama (uji `bukti-bayar.test.ts` yang ada tetap hijau).
- [ ] **Step 2:** `npx vitest run tests/pensiun-qris-pengajuan.test.ts`. Expected: FAIL.
- [ ] **Step 3: Kerjakan penghapusan dan pembatasan.** Bucket `bukti-bayar` **tidak** disentuh, dan `hapusBukti` tetap ada.
- [ ] **Step 4:** Jalankan `npx supabase migration up --local --include-all && npx tsc --noEmit && npm run lint && npx vitest run`. Expected: suite penuh = merah bawaan A1 saja.
- [ ] **Step 5: Commit** — `refactor(tagihan): pensiunkan QRIS pengajuan, cron tenggat, dan rumus harga TS`.

### Tugas B8: E2E `bayar-pengajuan` ditulis ulang untuk alur DOKU, dan verifikasi akhir

**Files:**
- Modify: `web/tests/e2e/bayar-pengajuan.e2e.ts` (skrip `npm run test:e2e:bayar`)
- Modify: `web/README.md` (Fase 3 butir 6 "Peralihan" dirinci dengan tabel §7 dan larangan pembatalan massal)

**Interfaces:** tidak ada.

- [ ] **Step 1: Tulis ulang skrip e2e.** Pola peramban dan helper diambil dari skrip e2e lain di `tests/e2e/`. Alurnya:
  1. Admin menerbitkan tagihan pengajuan fixture.
  2. Klien membuka `/passport/bayar/<id>` dan melihat rincian serta tombol Bayar.
  3. Klien menekan Bayar. Rute dijalankan dengan `fetch` DOKU yang **dicegat** di level server uji (env `DOKU_*` palsu dan intersepsi `globalThis.fetch` di proses dev server), dan peramban **berhenti di redirect** (navigasi ke host `*.doku.com` diblokir dan diperiksa URL-nya).
  4. Notifikasi `SUCCESS` bertanda tangan disimulasikan: `POST /api/pembayaran/doku` dengan badan dan tanda tangan dari `hitungTandaTangan` memakai kunci palsu yang sama.
  5. `/passport/bayar/<id>` menampilkan "Lunas" dan tautan jadwal; `/admin/sesi` menampilkan "Baru — kabari bidan".

  Bila mencegat `fetch` di dev server tidak mungkin dengan perkakas yang ada, langkah 3 diganti: pesanan diberi `tautan_gateway` palsu lewat service role sebelum klik (jalur pakai ulang A6), lalu yang diperiksa adalah navigasi ke URL palsu itu.
- [ ] **Step 2:** Jalankan `npm run dev` (port 3000, env `web-doku`) di latar, lalu `npm run test:e2e:bayar`. Expected: lulus. Lima skrip e2e basi lain tetap di luar cakupan.
- [ ] **Step 3: Verifikasi akhir branch.**
  - `npx supabase db reset --local` (instans sendiri), lalu `npx tsc --noEmit && npm run lint && npm run build && npx vitest run`.
  - Expected: build hijau; suite = merah bawaan A1.
  - `grep -rni midtrans src` hanya menyisakan komentar sejarah yang didaftar di A10.
- [ ] **Step 4: Commit** — `test(e2e): bayar-pengajuan lewat alur DOKU`.
- [ ] **Step 5: Serahkan** ke review seluruh branch (`superpowers:requesting-code-review`, satu reviewer segar atas `git diff development...feat/doku`). Sesudah itu kirim laporan ke `padma-c3` sesuai brief §8:
  - daftar commit;
  - migrasi berurutan, dari `20261113130000` sampai `20261113140700`;
  - butir "perlu konfirmasi DOKU" K1–K14 beserta yang sudah terjawab di A12;
  - langkah go-live yang butuh tangan manusia (README Fase 3).
