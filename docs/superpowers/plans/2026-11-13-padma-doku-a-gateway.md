# Rencana A — mesin pesanan pindah dari Midtrans ke DOKU

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pembayaran produk digital (satuan & keranjang) lewat DOKU Checkout non-SNAP mode redirect, dengan seluruh jaminan mesin pesanan P1 bertahan dan nol sisa Midtrans.

**Architecture:** Mesin status tetap di satu RPC SQL (`terapkan_notifikasi_gateway`) yang dipanggil service role dari tiga lapis (webhook, Lapis 1b, Lapis 3). TS hanya mengurus jaringan DOKU (`src/lib/doku/*`): tanda tangan HMAC-SHA256, adapter Checkout + Check Status, dan rute webhook. Pekerjaan netral-gateway (Fase 1) dikerjakan sementara Midtrans masih hidup dan hijau; adapter, webhook, dan pembersihan Midtrans (Fase 2) baru dimulai setelah kunci sandbox DOKU ada di `web/.env.local`.

**Tech Stack:** Next.js 16 (versi termodifikasi — baca `web/node_modules/next/dist/docs/` sebelum menulis rute/komponen), Supabase Postgres (plpgsql, RLS), Zod, Vitest, `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-11-12-padma-doku-design.md` (disetujui 13 Nov 2026). Rencana ini memakai nomor bagian spec (§) dan nomor sumber DOKU (S1–S33).

**Rencana pasangan:** `docs/superpowers/plans/2026-11-13-padma-doku-b-tagihan-sesi.md` (P3). Urutan eksekusi lintas rencana: **A1–A12 → B1–B8 → review seluruh branch.** Kunci sandbox sudah terpasang di `web/.env.local` sejak 13 Nov, jadi gerbang Fase 2 terbuka. Bila kunci itu dicabut atau tidak sah, kerjakan B1–B5 (netral) dulu, lalu A5–A12, lalu B6–B8.

## Global Constraints

- **Jangan `supabase db push`.** Repo ter-link ke produksi. Semua perintah Supabase memakai instans lokal `web-doku` (port 547xx). Jangan query/menulis Supabase produksi.
- **Jangan `git push`, jangan merge ke `development`/`main`.** Commit lokal di `feat/doku` saja.
- **Kredensial DOKU hanya di `web/.env.local`.** Tidak pernah di-commit, di-log, atau masuk uji. Uji memakai `kunci-uji-doku` / `klien-uji-doku` dan klien sintetis (`ananda@padma.test`).
- Migrasi lama tidak disunting. Cap waktu migrasi baru `> 20261113100000`; bila `development` mendapat migrasi lebih baru sebelum tugas dieksekusi, `git mv` ke cap waktu sesudahnya.
- `invoice_number` = `kode` tanpa tanda hubung + satu digit percobaan, contoh `PSN261112A1B2C33` (16 karakter), pola `^PSN\d{6}[0-9A-F]{6}[1-9]$` (§5.2).
- `payment.payment_due_date` = sisa menit sampai `orders.kedaluwarsa_pada`, **dibulatkan ke bawah**; hasil `< 1` → tautan tidak dibuat. `order.recover_abandoned_cart = false` (§5.3).
- Webhook `POST /api/pembayaran/doku`: badan maks 16 KB; kunci kosong → 503; Zod non-strict; bentuk invoice; tanda tangan waktu-tetap atas **byte badan mentah**, `Client-Id` harus sama, **tanpa** cek selisih `Request-Timestamp`; normalisasi nominal; sidik → RPC (§5.4).
- Basis URL DOKU: sandbox `https://api-sandbox.doku.com`, produksi `https://api.doku.com`. Buat pembayaran `POST /checkout/v1/payment`; Check Status `GET /orders/v1/status/{invoice_number}` [S3, S18].
- Env baru: `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY`, `DOKU_PRODUKSI` (produksi hanya bila nilainya `"true"` persis). Env mati: `MIDTRANS_SERVER_KEY`, `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY`, `MIDTRANS_PRODUKSI` (§5.8).
- Konstanta: `MENIT_JEDA_PERIKSA = 5`, `BATAS_PERIKSA_SEKALI = 3`, `JAM_TENGGANG_TANPA_VONIS = 1` (nama baru `JAM_TENGGANG_404`).
- Kolom di tabel yang tidak ada di `TABEL_UANG` (`tests/money-firewall-struktural.test.ts:75`) tidak boleh cocok `POLA_NOMINAL` (`bayar`, `pembayaran`, …). Karena itu kolomnya `tautan_gateway`, bukan `tautan_bayar`.
- Status DOKU dibandingkan sebagai **himpunan bernama** (`src/lib/doku/status.ts`) di TS dan daftar eksplisit di SQL; tidak ada string status tunggal yang tersebar.
- **Setiap uji baru dibuktikan bisa merah:** mutasi kode yang diujinya, jalankan, lihat merah, kembalikan. Tulis mutasinya di pesan commit (`Merah-dibuktikan: …`).
- Identifier, komentar, dan pesan commit berbahasa Indonesia mengikuti repo. Setiap pesan commit diakhiri `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Semua perintah `npm`/`npx` dijalankan dari `.worktrees/doku/web`.

## Review Focus

Masukan yang tersirat dari spec tetapi tidak dijaga uji tabel mana pun. Masing-masing sudah diberi uji di tugas pemiliknya.

1. **Nominal berdesimal bukan nol** (`"150000.50"`, `150000.5`) dari DOKU → harus menjadi `null` lalu `ditahan` (`selisih_nominal`), tidak pernah dibulatkan menjadi lunas. Uji di Tugas A6 (`normalisasiNominal`) dan A7 (rute).
2. **Badan notifikasi berspasi/berindentasi atau berurutan kunci lain** → Digest dihitung dari byte mentah, jadi tetap sah. Serialisasi ulang JSON akan menolaknya. Uji di Tugas A7.
3. **Header `Signature` pendek, tanpa awalan `HMACSHA256=`, atau kosong** → 401, bukan 500 (`timingSafeEqual` melempar bila panjang beda). Uji di Tugas A5 dan A7.
4. **Klien menekan Bayar dua kali atau di dua tab** → tautan yang masih berlaku dipakai ulang tanpa memanggil DOKU lagi, bukan invoice baru. Uji di Tugas A6.
5. **Sisa tenggat kurang dari 60 detik saat Bayar** → menit = 0, nol panggilan ke DOKU, pesan "tagihan lewat tenggat". Uji di Tugas A6.

---

# FASE 1 — netral-gateway (Midtrans tetap hidup dan hijau)

### Tugas A1: Instans Supabase terisolasi `web-doku` dan merah bawaan

**Files:**
- Modify (lokal saja, `skip-worktree`): `web/supabase/config.toml`
- Create (diabaikan git): `web/.env.local`

**Interfaces:**
- Produces: instans lokal di `http://127.0.0.1:54721` (API) dan `:54722` (DB) yang dipakai semua uji ber-DB di kedua rencana. Angka merah bawaan sebagai pembanding.

- [ ] **Step 1: Geser port dan nama proyek**

```bash
cd /Users/arvinfairuz/Documents/padma/.worktrees/doku/web
sed -i '' -E 's/^project_id = "web"$/project_id = "web-doku"/; s/(^|[^0-9])543([0-9]{2})([^0-9]|$)/\1547\2\3/g' supabase/config.toml
grep -nE '^project_id|port' supabase/config.toml
git update-index --skip-worktree supabase/config.toml
```

Expected: `project_id = "web-doku"`, tidak ada lagi angka `543xx`, dan `git status` bersih.

- [ ] **Step 2: Hidupkan instans** — `npx supabase start`. Expected: `API URL: http://127.0.0.1:54721`. Bila Docker menggantung, keluar dari Docker Desktop lalu buka ulang (memori `padma-dev-tanpa-docker`). Jangan mematikan CleanMyMac, dan jangan memakai instans `web`, `web-p4`, atau `web-sk`.

- [ ] **Step 3: Tulis `.env.local`** dari `.env.example`:
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` diambil dari `npx supabase status -o env`;
  - semua `R2_*` diisi placeholder;
  - `NEXT_PUBLIC_BASIS_URL=http://localhost:3000`.

  Jangan menyalin `.env.local` dari checkout lain.

- [ ] **Step 4: Dependensi dan tipe** — `npm ci && npm run seed:users && npx next typegen && npx tsc --noEmit`. Expected: tsc tanpa galat.

- [ ] **Step 5: Ukur merah bawaan** — `npx vitest run 2>&1 | tail -30`. Expected (`development` `bf0195d`): hanya `materi-video-r2` ×6 merah. Catat jumlah hijau dan merah; angka ini pembanding untuk setiap tugas berikutnya dan untuk laporan ke `padma-c3`. Tidak ada commit.

### Tugas A2: Format invoice DOKU dan himpunan status DOKU (TS murni)

**Files:**
- Modify: `web/src/lib/pesanan/order-id.ts`
- Create: `web/src/lib/doku/status.ts`
- Test: `web/tests/doku-invoice.test.ts`

**Interfaces:**
- Produces (`order-id.ts`; `POLA_ORDER_ID`, `rakitOrderId`, dan `uraiOrderId` dibiarkan sampai Tugas A10):
  - `POLA_INVOICE_DOKU: RegExp` = `/^PSN\d{6}[0-9A-F]{6}[1-9]$/` (tanpa flag `g`);
  - `rakitInvoice(kode: string, percobaan: number): string`, yang melempar bila `kode` tidak cocok `POLA_KODE_PESANAN` atau `percobaan` di luar 1..9;
  - `uraiInvoice(invoice: string): { kode: string; percobaan: number } | null`, yang memulangkan `kode` berbentuk `PSN-YYMMDD-XXXXXX`.
- Produces (`status.ts`), semuanya `as const`:
  - `STATUS_DOKU_LUNAS = ["SUCCESS"]`
  - `STATUS_DOKU_MENUNGGU = ["PENDING", "REDIRECT", "TIMEOUT", "FAILED"]`
  - `STATUS_DOKU_KEDALUWARSA = ["EXPIRED"]`
  - `STATUS_DOKU_REFUND = ["REFUNDED", "PARTIAL_REFUNDED"]`
  - `STATUS_DOKU_ASING_DIKENAL = ["VOIDED"]`
  - `STATUS_TIDAK_DITEMUKAN = "TIDAK_DITEMUKAN"` (sintetis, hanya lahir dari Check Status, §5.5 baris 9)

- [ ] **Step 1: Tulis uji yang gagal**

```ts
describe("invoice DOKU", () => {
  it("rakitInvoice membuang tanda hubung dan menambah satu digit percobaan", () => {
    expect(rakitInvoice("PSN-261112-A1B2C3", 3)).toBe("PSN261112A1B2C33");
  });
  it("hasilnya 16 karakter, alfanumerik saja, cocok POLA_INVOICE_DOKU", () => {
    const inv = rakitInvoice("PSN-261112-A1B2C3", 9);
    expect(inv).toHaveLength(16);
    expect(inv).toMatch(/^[A-Z0-9]+$/);
    expect(POLA_INVOICE_DOKU.test(inv)).toBe(true);
  });
  it.each([["psn-261112-a1b2c3", 1], ["PSN-261112-A1B2C3", 0], ["PSN-261112-A1B2C3", 10]])(
    "rakitInvoice(%s, %s) melempar", (k, p) => expect(() => rakitInvoice(k, p)).toThrow());
  it("uraiInvoice kebalikan rakitInvoice", () => {
    expect(uraiInvoice("PSN261112A1B2C33")).toEqual({ kode: "PSN-261112-A1B2C3", percobaan: 3 });
  });
  it.each(["PSN-261112-A1B2C3.3", "PSN261112A1B2C30", "PSN261112a1b2c33", "PSN261112A1B2C33X", ""])(
    "uraiInvoice(%s) = null", (s) => expect(uraiInvoice(s)).toBeNull());
  it("kelima himpunan status saling lepas", () => {
    const semua = [...STATUS_DOKU_LUNAS, ...STATUS_DOKU_MENUNGGU, ...STATUS_DOKU_KEDALUWARSA,
      ...STATUS_DOKU_REFUND, ...STATUS_DOKU_ASING_DIKENAL, STATUS_TIDAK_DITEMUKAN];
    expect(new Set(semua).size).toBe(semua.length);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/doku-invoice.test.ts`. Expected: FAIL (ekspor belum ada).
- [ ] **Step 3: Implementasikan** ekspor di atas. `uraiInvoice` memakai `POLA_INVOICE_DOKU.test` lalu `slice`.
- [ ] **Step 4:** Jalankan lagi. Expected: PASS. Buktikan merah: ganti `[1-9]` menjadi `[0-9]` di pola, uji baris `PSN261112A1B2C30` memerah, lalu kembalikan.
- [ ] **Step 5: Commit** — `feat(doku): format invoice alfanumerik dan himpunan status DOKU`.

### Tugas A3: Migrasi nama kolom netral-gateway (Midtrans tetap jalan)

**Files:**
- Create: `web/supabase/migrations/20261113130000_kolom_gateway_netral.sql`
- Modify:
  - `web/src/lib/admin/pesanan.ts` (`status_midtrans` → `status_gateway`, `statusMidtrans` → `statusGateway`) beserta pemakainya di `web/src/app/admin/pesanan/tabel-pesanan.tsx`
  - `web/src/lib/penjualan/baca.ts` (nama kolom saja; nilai `STATUS_KEMBALI` diganti di A10)
  - `web/src/app/api/pesanan/checkout/route.ts` (`catat_token_snap` → `catat_tautan_gateway` dengan `p_percobaan`)
- Test:
  - Create `web/tests/kolom-gateway-db.test.ts`
  - Modify `web/tests/fungsi-mesin-tertutup.test.ts` dan setiap uji dari `grep -rln "snap_token\|snap_diterbitkan_pada\|status_midtrans\|catat_token_snap" tests`

**Interfaces:**
- Produces (DB):
  - `orders.tautan_gateway text`, `orders.tautan_terbit_pada timestamptz`, `orders.status_gateway text`, `notifikasi_pesanan.status_gateway text`;
  - `catat_tautan_gateway(p_pesanan_id uuid, p_percobaan smallint, p_tautan text) returns void`, digerbangi `auth.uid()`, terbuka bagi `authenticated`.

- [ ] **Step 1: Tulis uji yang gagal** (`kolom-gateway-db.test.ts`, pola fixture `tests/pesanan-webhook.test.ts:28-150`, pesanan dibuat lewat `buat_pesanan` dengan sesi klien):
  - `information_schema.columns`: `orders` punya `tautan_gateway`, `tautan_terbit_pada`, dan `status_gateway`, dan tidak lagi punya `snap_token`, `snap_diterbitkan_pada`, atau `status_midtrans`; `notifikasi_pesanan` punya `status_gateway`;
  - `pg_proc`: `catat_token_snap` tidak ada lagi;
  - `catat_tautan_gateway` sebagai pemilik dengan percobaan yang sama → `tautan_gateway` terisi, `tautan_terbit_pada` tidak null, dan ada jejak `token_terbit`;
  - percobaan berbeda → galat `P0002`, kolom tetap null;
  - klien lain (`tests/helpers/klien-kedua.ts`) → `P0002`;
  - pesanan tidak `menunggu_bayar` → `P0002`.
- [ ] **Step 2:** `npx vitest run tests/kolom-gateway-db.test.ts`. Expected: FAIL.
- [ ] **Step 3: Tulis migrasi**, berurutan:
  1. `alter table public.orders rename column snap_token to tautan_gateway`, sama untuk `snap_diterbitkan_pada → tautan_terbit_pada` dan `status_midtrans → status_gateway`; `alter table public.notifikasi_pesanan rename column status_midtrans to status_gateway`.
  2. `create or replace function public.buat_pesanan_keranjang` — salinan definisi terakhir (`20261016120000_produk_masa_berlaku_pesanan.sql:260`, sampai akhir fungsinya), dengan hanya `snap_token`/`snap_diterbitkan_pada` diganti nama barunya. Komentar fungsi dan grant disalin apa adanya.
  3. `drop function public.catat_token_snap(uuid, text);` lalu `create function public.catat_tautan_gateway(...)`:
     - badannya badan `catat_token_snap` (`20260926130000_pesanan_rpc.sql:358-408`) ditambah syarat `and o.percobaan = p_percobaan`;
     - keterangan jejaknya `'tautan gateway dicatat'`;
     - `revoke all … from public, anon; grant execute … to authenticated`.
  4. `create or replace function public.terapkan_notifikasi_midtrans` — salinan definisi terakhir (`20260927100000_sebab_tinjauan_lestari.sql:241` sampai `$$;`), dengan hanya `status_midtrans` (insert `notifikasi_pesanan` dan update `orders`) diganti `status_gateway`. Beri komentar SQL di atasnya: **SEMENTARA — di-drop di `20261113130200`**.
  5. Audit: `grep -n "snap_\|status_midtrans" supabase/migrations/*.sql`. Setiap objek yang **definisi terakhirnya** masih menyebut nama lama wajib didefinisikan ulang di migrasi ini. View tidak perlu: Postgres mengikat kolom view lewat attnum.
- [ ] **Step 4:** `npx supabase migration up --local --include-all`, lalu ubah TS dan uji lama yang menyebut nama lama. Di `fungsi-mesin-tertutup.test.ts`, kunci `TERBUKA_SADAR.catat_token_snap` menjadi `catat_tautan_gateway: "auth.uid"`.
- [ ] **Step 5:** Jalankan `npx vitest run tests/kolom-gateway-db.test.ts tests/fungsi-mesin-tertutup.test.ts tests/pesanan-webhook.test.ts tests/pesanan-checkout-rute.test.ts tests/admin-pesanan.test.tsx tests/penjualan-hitung.test.ts tests/keranjang-pesanan-db.test.ts tests/money-firewall-struktural.test.ts`, lalu `npx tsc --noEmit`. Expected: semuanya PASS. Buktikan merah: hapus syarat percobaan dari fungsi, uji "percobaan berbeda" memerah, lalu kembalikan.
- [ ] **Step 6: Commit** — `feat(pesanan): kolom netral-gateway dan catat_tautan_gateway`.

### Tugas A4: `terapkan_notifikasi_gateway` — tabel §5.5 dan penutupan cacat P1

**Files:**
- Create: `web/supabase/migrations/20261113130100_terapkan_notifikasi_gateway.sql`
- Test: create `web/tests/notifikasi-gateway-db.test.ts`; modify `web/tests/fungsi-mesin-tertutup.test.ts` (tambah ke `MESIN_TERTUTUP`)

**Interfaces:**
- Consumes: `rakitInvoice`, `POLA_INVOICE_DOKU`, dan himpunan `STATUS_DOKU_*` (A2); kolom netral (A3).
- Produces (dipakai A7, A9, dan rencana B):

```sql
public.terapkan_notifikasi_gateway(
  p_invoice text, p_status text, p_transaksi_id text, p_kanal text,
  p_nominal numeric,          -- null = tidak bisa dinormalisasi / tidak tahu
  p_sidik text,
  p_sumber text default 'webhook',   -- 'webhook' | 'status_api'
  p_keterangan text default null     -- ditempel ke jejak 'notifikasi'
) returns text                -- 'diterapkan' | 'duplikat' | 'tanpa_efek' | 'pesanan_tidak_ada'
```

Security definer, `set search_path = public`. Grant disalin dari `20260926140000_pesanan_webhook_rpc.sql:565-567`: `revoke all … from public, anon, authenticated`.

- [ ] **Step 1: Tulis uji tabel yang gagal.**
  - **Fixture:** `bentukPesanan(keadaan)` membuat pesanan lewat pintu depannya.
    - `menunggu_bayar`: `buat_pesanan` dengan sesi klien.
    - `lunas`: ditambah `SUCCESS` bernominal cocok.
    - `ditahan`: ditambah `SUCCESS` bernominal meleset.
    - `kedaluwarsa`: ditambah `EXPIRED`.
    - `dibatalkan`: `batalkan_pesanan_saya`.
  - **Pemanggil:** `terapkan(p, status, nominal)` memanggil RPC dengan service role, sidik `randomUUID()`, dan invoice `rakitInvoice(kode, percobaan)`.
  - **Kasus:** status-statusnya **diturunkan dari himpunan TS** (`STATUS_DOKU_*`), ditambah `"STATUS_ANEH"` dan `""`. Nominal: `cocok` (Σ `harga_beku`), `meleset` (+1), atau `null`. Hasilnya `it.each` atas 5 keadaan × setiap status.
  - **Yang diperiksa per sel:** nilai balik, status akhir, `sebab_tinjauan`, `butuh_tinjauan_pada` terisi bila dan hanya bila sebabnya tidak null, dan kejadian jejak baru yang diharapkan.

  | Status (nominal) | `menunggu_bayar` | `kedaluwarsa` / `dibatalkan` | `ditahan` (sebab awal `selisih_nominal`) | `lunas` |
  |---|---|---|---|---|
  | `SUCCESS` (cocok) | `diterapkan` → `lunas`; jejak `lunas`; entitlement terbit | `tanpa_efek`; tinjauan `lunas_setelah_tutup` | `tanpa_efek`; jejak `selisih_status`; sebab tetap `selisih_nominal` | `tanpa_efek`; hanya jejak `notifikasi` |
  | `SUCCESS` (meleset / `null`) | `diterapkan` → `ditahan`; tinjauan `selisih_nominal` | `tanpa_efek`; tinjauan **`lunas_setelah_tutup`** | `tanpa_efek`; jejak `selisih_status` | `tanpa_efek`; jejak + tinjauan `selisih_nominal` |
  | `STATUS_DOKU_MENUNGGU` | `tanpa_efek` | `tanpa_efek` | `tanpa_efek` | `tanpa_efek` |
  | `EXPIRED` | `diterapkan` → `kedaluwarsa` | `tanpa_efek` | `tanpa_efek` | `tanpa_efek` |
  | `STATUS_DOKU_REFUND` | `diterapkan`; status tetap; tinjauan `refund` | sama | sama (sebab tetap `selisih_nominal`) | sama; entitlement **tidak** dicabut |
  | `VOIDED`, `STATUS_ANEH`, `""` | `diterapkan`; status tetap; tinjauan `selisih_status` | sama | sama (sebab tetap `selisih_nominal`) | sama |

  - **Uji tambahan:**
    - sidik yang sama dua kali → `duplikat`, dan tepat satu jejak `notifikasi`;
    - `p_invoice = "PSN-261112-A1B2C3.1"` atau invoice sah yang tidak dikenal → `pesanan_tidak_ada`, nol baris `notifikasi_pesanan`;
    - **kesepakatan TS–SQL:** invoice dari `rakitInvoice` atas `kode`/`percobaan` yang dipulangkan `buat_pesanan` cocok `POLA_INVOICE_DOKU` **dan** dikenali RPC;
    - percobaan basi (invoice percobaan 1 sesudah `buat_pesanan_keranjang(p_ulang := true)`) → jejak `notifikasi` memuat `percobaan 1`;
    - `p_sumber = 'status_api'` → `diperiksa_pada` terisi dan ada jejak `diperiksa_ulang`; `p_keterangan` muncul di jejak `notifikasi`;
    - `p_sumber = 'lain'` → melempar;
    - `notifikasi_pesanan.status_gateway` = `p_status` dan `nominal_diterima` = `p_nominal`.
- [ ] **Step 2:** `npx vitest run tests/notifikasi-gateway-db.test.ts`. Expected: FAIL (fungsi belum ada).
- [ ] **Step 3: Tulis fungsi.** Kerangkanya mengikuti `terapkan_notifikasi_midtrans` (`20260927100000:241`), langkah demi langkah:
  - `p_invoice !~ '^PSN[0-9]{6}[0-9A-F]{6}[1-9]$'` → `pesanan_tidak_ada`.
  - `v_kode := 'PSN-' || substr(p_invoice, 4, 6) || '-' || substr(p_invoice, 10, 6)`; `v_percobaan := substr(p_invoice, 16, 1)::smallint`.
  - Pencarian `for update`, cabang `status_api`, sisipan sidik, dan cermin kolom sama dengan yang lama, memakai `status_gateway`. Jejak `notifikasi` = `p_status`, ditambah catatan percobaan, ditambah `coalesce(' — ' || p_keterangan, '')`.
  - **Vonis** dari daftar eksplisit:
    - `'SUCCESS'` → `lunas`;
    - `('PENDING','REDIRECT','TIMEOUT','FAILED')` → `menunggu` → `tanpa_efek`;
    - `'EXPIRED'` → `kedaluwarsa`;
    - `('REFUNDED','PARTIAL_REFUNDED')` → `refund`;
    - selainnya → `asing`.
  - `refund` dan `asing`: jejak `selisih_status` dan tanda tinjauan (`refund` atau `selisih_status`) dengan `coalesce` lestari, status tetap, pulangkan `diterapkan`.
  - **Penutupan cacat P1:** bila vonis `lunas` **dan** pesanan `kedaluwarsa`/`dibatalkan` → jejak `lunas_setelah_tutup` (`format('SUCCESS mendarat pada pesanan %s; ditagih %s, diterima %s', …)`) dan tinjauan `lunas_setelah_tutup`, pulangkan `tanpa_efek` — **sebelum** verifikasi nominal.
  - Sesudah itu verifikasi nominal (`p_nominal is distinct from v_total or v_cacah <> v_jumlah_item` → `ditahan` + `selisih_nominal`).
  - Cabang pesanan tidak terbuka:
    - `ditahan` dengan vonis `lunas`/`ditahan` → jejak dan tinjauan `selisih_status`;
    - `lunas` dengan vonis `ditahan` → jejak dan tinjauan `selisih_nominal`;
    - selainnya `tanpa_efek`.
  - Penjaga `perpindahan_pesanan_sah`, update, jejak kejadian (`format('doku %s, transaksi %s', …)`), jejak sebab, `perform public.salurkan_pesanan(...)` bila lunas: semuanya seperti yang lama.
  - Tambah `"terapkan_notifikasi_gateway"` ke `MESIN_TERTUTUP`. `terapkan_notifikasi_midtrans` tetap ada sampai A10.
- [ ] **Step 4:** `npx supabase migration up --local --include-all && npx vitest run tests/notifikasi-gateway-db.test.ts tests/fungsi-mesin-tertutup.test.ts`. Expected: PASS.
- [ ] **Step 5: Buktikan merah cacat P1:** pindahkan blok `lunas_setelah_tutup` ke **sesudah** verifikasi nominal (urutan lama), jalankan `migration up`, lihat sel "`SUCCESS` meleset × `kedaluwarsa`" memerah, lalu kembalikan. Buktikan juga satu sel lain: hapus `'TIMEOUT'` dari daftar SQL, sel `TIMEOUT` memerah (vonis jatuh ke `asing`).
- [ ] **Step 6: Commit** — `feat(pesanan): terapkan_notifikasi_gateway dengan pemetaan DOKU dan penutupan cacat lunas-setelah-tutup`.

---

# FASE 2 — DOKU (mulai hanya bila `DOKU_CLIENT_ID` dan `DOKU_SECRET_KEY` sandbox ada di `web/.env.local`)

Gerbang: `grep -c '^DOKU_CLIENT_ID=.\+' web/.env.local` = 1. Kalau tidak, berhenti dan kerjakan tugas netral rencana B.

### Tugas A5: Konfigurasi dan tanda tangan non-SNAP

**Files:**
- Create: `web/src/lib/doku/konfig.ts`, `web/src/lib/doku/tanda-tangan.ts`
- Modify: `web/.env.example` (tiga baris `DOKU_*` beserta penjelasan, meniru gaya blok Midtrans `:48-70`)
- Test: `web/tests/doku-tanda-tangan.test.ts`, `web/tests/doku-konfig.test.ts`

**Interfaces:**
- Produces (`konfig.ts`, tanpa `server-only`, tanpa membaca `NODE_ENV`):
  - `dokuProduksi(): boolean`
  - `clientIdDoku(): string` dan `secretKeyDoku(): string`, keduanya `""` bila tidak dipasang
  - `basisApiDoku(): string`
  - `PATH_WEBHOOK_DOKU = "/api/pembayaran/doku"` dan `PATH_BUAT_PEMBAYARAN = "/checkout/v1/payment"`
  - `pathStatusDoku(invoice: string): string` = `` `/orders/v1/status/${encodeURIComponent(invoice)}` ``
  - `urlKembali(path: string): string | null`, yang memakai `NEXT_PUBLIC_BASIS_URL` yang di-`trim`; `null` bila kosong
- Produces (`tanda-tangan.ts`):
  - `hitungDigest(badan: string): string` = base64(SHA-256(UTF-8))
  - `rakitKomponenTandaTangan(k: { clientId: string; requestId: string; requestTimestamp: string; requestTarget: string; digest: string | null }): string`. Barisnya `Client-Id:…`, `Request-Id:…`, `Request-Timestamp:…`, `Request-Target:…`, `Digest:…` digabung `"\n"`, tanpa baris baru di akhir. Baris `Digest` dihilangkan bila `null` (GET, S9).
  - `hitungTandaTangan(komponen: string, secretKey: string): string` = `"HMACSHA256=" + base64(HMAC-SHA256)`
  - `tandaTanganCocok(dikirim: string, dihitung: string): boolean`, waktu-tetap; panjang beda → `false` tanpa melempar
  - `hitungSidikDoku(s: { sumber: "webhook" | "status_api"; invoice: string; status: string; pembeda: string }): string` = sha256 heksa dari `[sumber, invoice, status, pembeda].join("|")`

- [ ] **Step 1: Siapkan nilai emas di luar Node** (bukan dihitung ulang dengan fungsi yang diuji):

```bash
B='{"order":{"invoice_number":"PSN261112A1B2C31","amount":150000}}'
printf '%s' "$B" | openssl dgst -sha256 -binary | base64           # DIGEST_EMAS
K=$(printf 'Client-Id:klien-uji-doku\nRequest-Id:req-uji-1\nRequest-Timestamp:2026-11-13T01:02:03Z\nRequest-Target:/api/pembayaran/doku\nDigest:%s' "<DIGEST_EMAS>")
printf '%s' "$K" | openssl dgst -sha256 -hmac 'kunci-uji-doku' -binary | base64   # TTD_EMAS
```

  Bila S10 memuat contoh masukan dan keluaran lengkap, tambahkan juga sebagai kasus kedua.
- [ ] **Step 2: Tulis uji yang gagal.**
  - `hitungDigest(B)` = `DIGEST_EMAS`.
  - `rakitKomponenTandaTangan` memulangkan string persis di atas. Versi `digest: null` tidak memuat `Digest:`, dan tidak ada string yang diakhiri `\n`.
  - `hitungTandaTangan(K, "kunci-uji-doku")` = `"HMACSHA256=" + TTD_EMAS`.
  - `tandaTanganCocok` memulangkan `false` untuk: string pendek, string tanpa awalan, `""`, dan string sepanjang sama yang beda satu karakter. Tidak ada yang melempar.
  - Sidik:
    - masukan identik → sidik identik;
    - status beda → sidik beda;
    - `webhook` vs `status_api` → sidik beda;
    - `["a|b","c"]` vs `["a","b|c"]` di dua medan bertetangga → tetap beda bila dirangkai dengan pemisah. Bila tidak, ganti pemisah menjadi `\u0000`.
  - `konfig`:
    - `DOKU_PRODUKSI` bernilai `"true"` → URL produksi;
    - `"TRUE"`, `"1"`, atau tidak ada → sandbox;
    - `urlKembali("/passport/produk")` dengan basis `"  "` → `null`.
- [ ] **Step 3:** `npx vitest run tests/doku-tanda-tangan.test.ts tests/doku-konfig.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implementasikan.** `createHash`/`createHmac`/`timingSafeEqual` dari `node:crypto`; pola penjaga panjangnya sama dengan `src/lib/midtrans/tanda-tangan.ts:39`.
- [ ] **Step 5:** Jalankan uji dan `npx vitest run tests/env-terdokumentasi.test.ts`. Expected: PASS. Buktikan merah: tambahkan `"\n"` di akhir komponen, uji emas memerah, lalu kembalikan.
- [ ] **Step 6: Commit** — `feat(doku): konfigurasi dan tanda tangan non-SNAP`.

### Tugas A6: Adapter DOKU, normalisasi nominal, dan penerbit tautan

**Files:**
- Create: `web/src/lib/doku/nominal.ts`, `web/src/lib/doku/adapter.ts` (`import "server-only"`), `web/src/lib/doku/tautan.ts` (`import "server-only"`)
- Test: `web/tests/doku-adapter.test.ts` (fetch distub, tanpa DB), `web/tests/doku-tautan-db.test.ts`

**Interfaces:**
- Consumes: A5 (`konfig`, `tanda-tangan`), A2 (`rakitInvoice`), A3 (`catat_tautan_gateway`).
- Produces:

```ts
// nominal.ts
export function normalisasiNominal(nilai: unknown): number | null;
// angka bulat ≥ 0, atau string /^\d+(\.0+)?$/ → integer; selainnya null

// adapter.ts
export type ItemDoku = { nama: string; harga: number };
export type PermintaanPembayaranDoku = {
  invoice: string; nominal: number; items: ItemDoku[]; menitBerlaku: number; callbackUrl: string;
};
export async function buatPembayaranDoku(
  p: PermintaanPembayaranDoku,
): Promise<{ ok: true; url: string; tokenId: string } | { ok: false; pesan: string }>;
export type StatusDoku = {
  invoice: string; status: string; nominal: number | null; transaksiId: string; kanal: string;
};
export async function bacaStatusDoku(
  invoice: string,
): Promise<{ ok: true; status: StatusDoku } | { ok: false; kode: number; pesan: string }>;
// kode: -1 kunci kosong (nol permintaan) · 0 tak terjangkau / jawaban tak terbaca
//       404 invoice tidak dikenal (bentuk K7 dibuktikan di A12) · lainnya = HTTP apa adanya

// tautan.ts
export async function terbitkanTautanBayar(
  sesi: SupabaseClient, pesananId: string, pathKembali: string,
): Promise<{ ok: true; url: string } | { ok: false; status: 409 | 502 | 503; pesan: string }>;
```

- [ ] **Step 1: Tulis uji adapter yang gagal** (`fetch` distub dan menangkap permintaan; kunci tiruan lewat `process.env`):
  - **Permintaan buat pembayaran:**
    - URL `basisApiDoku() + PATH_BUAT_PEMBAYARAN`, metode `POST`;
    - header `Client-Id`, `Request-Id` (UUID), `Request-Timestamp` (cocok `/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/`), dan `Signature`;
    - `Signature` = hasil `hitungTandaTangan` atas komponen yang dirakit dari header yang **tertangkap** dan `hitungDigest(badan yang tertangkap)`.
  - **Badan permintaan:**
    - `order.amount === nominal`, `order.invoice_number === invoice`;
    - `order.line_items` berisi `{ name, price, quantity: 1 }` per item, dengan Σ `price` = `amount`;
    - `order.callback_url`, `order.auto_redirect === true`, `order.recover_abandoned_cart === false`;
    - `payment.payment_due_date === menitBerlaku`;
    - **tidak ada** kunci `customer`.
  - **Jawaban:**
    - 200 dengan `response.payment.url` → `{ ok: true, url, tokenId }`;
    - 400 dengan `error_messages` → `ok: false`, dan pesannya tidak memuat isi `error_messages`;
    - lempar jaringan → `ok: false`;
    - kunci kosong → `ok: false` dan **nol** panggilan `fetch`;
    - Σ item ≠ nominal → `ok: false` dan nol panggilan.
  - **Check Status:**
    - GET ke `pathStatusDoku(invoice)`, dengan komponen tanda tangan **tanpa** `Digest`;
    - 200 `{ order: { invoice_number, amount: "150000.00" }, transaction: { status: "SUCCESS" } }` → `nominal: 150000`;
    - 404 → `kode: 404`;
    - 503 → `kode: 503`;
    - lempar → `kode: 0`;
    - 200 tanpa `transaction.status` → `kode: 0`;
    - kunci kosong → `kode: -1`, nol panggilan.
  - **`normalisasiNominal`:**
    - `150000`, `"150000"`, `"150000.00"` → `150000`;
    - `150000.5`, `"150000.50"`, `"1e5"`, `"-1"`, `""`, `null`, `{}` → `null`.
- [ ] **Step 2: Tulis uji tautan yang gagal** (DB; `fetch` ke host DOKU distub dan dihitung). Pesanan dibuat lewat `buat_pesanan` dengan sesi klien:
  - **Panggilan pertama** → 1 panggilan DOKU dengan `menitBerlaku` = `floor(sisa ms / 60000)`, `tautan_gateway` tercatat, dan jejak `token_terbit` ada.
  - **Panggilan kedua** → URL yang sama dan **0** panggilan baru (Review Focus 4).
  - **`kedaluwarsa_pada` = now+30 detik** (disetel lewat service role) → `{ ok: false, status: 409 }`, nol panggilan (Review Focus 5).
  - **`kedaluwarsa_pada` = now+90 detik** → `menitBerlaku === 1`.
  - **Pesanan klien lain**, dibaca lewat sesi `klien-kedua` → 409 dan nol panggilan.
  - **Kunci kosong atau `NEXT_PUBLIC_BASIS_URL` kosong** → 503 "Pembayaran belum aktif. Hubungi tim PADMA." dan nol panggilan.
  - **DOKU menjawab 400** → 502, `tautan_gateway` tetap null.
- [ ] **Step 3:** `npx vitest run tests/doku-adapter.test.ts tests/doku-tautan-db.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implementasikan.** Batas waktu `AbortSignal.timeout(10_000)`. Log galat menyebut kode HTTP dan `error_messages`, tetapi tidak pernah kunci atau badan permintaan.
  - **`terbitkanTautanBayar`:**
    1. Baca `orders` (`id, kode, percobaan, status, kedaluwarsa_pada, tautan_gateway`) **lewat `sesi`**; RLS adalah bukti kepemilikan.
    2. Sesudah itu baca `order_items (judul_beku, harga_beku)` lewat `createAdminSupabase()`, karena `order_items` nol grant bagi `authenticated`.
    3. Nominal = Σ `harga_beku`.
    4. Catat tautan lewat `sesi.rpc("catat_tautan_gateway")`. Kegagalannya dicatat ke log, tetapi tidak menggagalkan jawaban.
- [ ] **Step 5:** Jalankan lagi. Expected: PASS. Buktikan merah: ganti `Math.floor` menjadi `Math.ceil`, uji 90 detik memerah, lalu kembalikan.
- [ ] **Step 6: Commit** — `feat(doku): adapter Checkout & Check Status, penerbit tautan bayar`.

### Tugas A7: Webhook `/api/pembayaran/doku`

**Files:**
- Create: `web/src/app/api/pembayaran/doku/route.ts`, `web/src/lib/doku/skema.ts`, `web/src/lib/doku/kode-jawaban.ts`
- Test: `web/tests/doku-webhook.test.ts`

**Interfaces:**
- Consumes: A4 (RPC), A5, A6 (`normalisasiNominal`).
- Produces:
  - `SkemaNotifikasiDoku` (Zod, non-strict): `order: { invoice_number: string; amount: number | string }`, `transaction: { status: string; original_request_id?: string; date?: string }`, `channel?: { id: string }`, `service?: { id: string }`.
  - `HasilWebhook`, `KODE_JAWABAN`, dan `hasilRpcSah` disalin dari `src/lib/midtrans/kode-jawaban.ts`, dengan `bentuk_order_id` diganti `bentuk_invoice` (400).

- [ ] **Step 1: Tulis uji yang gagal.** Strukturnya mengikuti `tests/pesanan-webhook.test.ts`: `fetch` keluar dilarang, `vi.mock("@/lib/supabase/admin")` untuk galat paksa, dan fixture produk dan pesanan sendiri. Helper `kirim(badanMentah: string, ubah?: Partial<Header>)` menandatangani badan **persis seperti string yang dikirim**, dengan `Request-Target = PATH_WEBHOOK_DOKU`. Kasusnya:
  - 16 KB+1 (dengan dan tanpa `content-length`) → 400;
  - kunci kosong → 503;
  - JSON rusak, medan wajib hilang, atau header wajib hilang → 400;
  - medan tambahan tak dikenal → 200;
  - invoice berbentuk Midtrans (`PSN-…-….1`) → 400 dan nol sentuhan DB;
  - `Client-Id` beda → 401;
  - satu byte badan diubah sesudah ditandatangani → 401;
  - `Signature` pendek, tanpa awalan, atau `""` → 401, bukan 500;
  - tanda tangan salah → penghitung `catat_notifikasi_ditolak` naik satu;
  - invoice sah bentuknya tetapi tak dikenal → 200 `pesanan_tidak_ada` dan penghitung tak dikenal naik;
  - galat RPC → 500;
  - RPC memulangkan nilai asing → 500;
  - `SUCCESS` dengan `amount` `150000`, `"150000"`, atau `"150000.00"` → 200 `diterapkan`, pesanan lunas, entitlement terbit;
  - `"150000.50"` → `ditahan` dengan `selisih_nominal` (Review Focus 1);
  - badan yang sama diformat `JSON.stringify(x, null, 2)` dengan urutan kunci terbalik → 200 `diterapkan` (Review Focus 2);
  - badan identik dikirim dua kali → kedua `duplikat`;
  - `FAILED` → 200 `tanpa_efek`;
  - `KODE_JAWABAN` memetakan setiap anggota `HasilWebhook`.
- [ ] **Step 2:** `npx vitest run tests/doku-webhook.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementasikan rute.** Baca dulu panduan route handler di `node_modules/next/dist/docs/`. `export const runtime = "nodejs"`; POST saja. `bacaBodyTerbatas` dipindah dari rute Midtrans (salinan apa adanya). Urutan langkahnya §5.4 dan Global Constraints:
  - Header dibaca dengan `request.headers.get("client-id")` dan seterusnya.
  - Sidik = `hitungSidikDoku({ sumber: "webhook", invoice, status, pembeda: digestBadanMentah })`.
  - Parameter RPC:
    - `p_transaksi_id`: `transaction.original_request_id ?? ""`;
    - `p_kanal`: `channel?.id ?? service?.id ?? ""`;
    - `p_nominal`: `normalisasiNominal(order.amount)`.
  - Cabang `pesanan_tidak_ada` dan tanda tangan salah memanggil penghitung yang sama seperti rute Midtrans (`:115-182`).
- [ ] **Step 4:** Jalankan. Expected: PASS. Buktikan merah: hitung Digest dari `JSON.stringify(JSON.parse(teks))`; uji Review Focus 2 memerah. Kembalikan.
- [ ] **Step 5: Commit** — `feat(doku): webhook notifikasi pembayaran`.

### Tugas A8: Checkout produk dan peramban — redirect menggantikan Snap

**Files:**
- Modify:
  - `web/src/app/api/pesanan/checkout/route.ts`
  - `web/src/app/produk/[slug]/tombol-beli.tsx` dan `page.tsx`
  - `web/src/app/passport/keranjang/isi-keranjang.tsx` dan `page.tsx`
- Delete: `web/src/lib/midtrans/snap-peramban.ts`
- Test: modify `web/tests/pesanan-checkout-rute.test.ts`, `web/tests/produk-tombol-beli.test.tsx`, `web/tests/pesanan-checkout-persetujuan.test.ts`

**Interfaces:**
- Consumes: `terbitkanTautanBayar` (A6).
- Produces: jawaban checkout `200 { url: string; kode: string; pesananId: string }`. Kegagalan tautan diteruskan dengan status dari A6 dan `{ pesan }`. Tombol beli dan keranjang memanggil `window.location.assign(url)`.

- [ ] **Step 1: Ubah uji agar gagal.**
  - Rute:
    - sukses → badan memuat `url` dan tidak memuat `token` atau `produksi`;
    - kunci kosong → 503 dengan pesan "Pembayaran belum aktif. Hubungi tim PADMA.";
    - `ulang: true` → percobaan +1 dan `invoice_number` baru di permintaan DOKU yang tertangkap;
    - gerbang persetujuan tetap 403.
  - Tombol beli:
    - klik → `fetch` ke checkout → `window.location.assign` dipanggil dengan `url`;
    - tidak ada elemen `<script>` yang disisipkan;
    - 503 → pesan tampil dan tidak ada redirect.
- [ ] **Step 2:** `npx vitest run tests/pesanan-checkout-rute.test.ts tests/produk-tombol-beli.test.tsx tests/pesanan-checkout-persetujuan.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementasikan.**
  - Rute: sesudah `buat_pesanan_keranjang`, panggil `terbitkanTautanBayar(supabase, baris.pesanan_id, "/passport/produk")`.
  - Hapus props `produksi` dan `clientKey` dari kedua halaman, beserta pembacaan `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY`.
  - `picuPeriksaSekali` tetap dipakai tombol beli.
- [ ] **Step 4:** Jalankan uji tadi dan `npx tsc --noEmit`. Expected: PASS. Buktikan merah: kembalikan `token` ke jawaban rute; uji "tidak memuat token" memerah.
- [ ] **Step 5: Commit** — `feat(doku): checkout produk mengarah ke halaman bayar DOKU`.

### Tugas A9: Rekonsiliasi Lapis 1b, Lapis 3, dan rute staf memakai Check Status DOKU

**Files:**
- Modify:
  - `web/src/lib/pesanan/periksa-menggantung.ts`
  - `web/src/lib/pesanan/status.ts` (`JAM_TENGGANG_404` → `JAM_TENGGANG_TANPA_VONIS = 1`)
  - `web/src/app/api/pesanan/[id]/periksa-ulang/route.ts`
  - setiap rute di `web/src/app/api/pesanan/[id]/*` dan `web/src/app/api/cron/pesanan/route.ts` yang mengimpor nama yang berganti
- Test: modify `web/tests/pesanan-periksa-dibuka.test.ts` dan setiap uji rute `periksa-ulang`/cron yang ditemukan `grep -rln "terapkanJawabanMidtrans\|midtrans_tak_terjawab\|JAM_TENGGANG_404" tests`

**Interfaces:**
- Consumes: `bacaStatusDoku` (A6), `hitungSidikDoku` dan `rakitInvoice` (A2/A5), RPC (A4), himpunan `STATUS_DOKU_MENUNGGU` dan `STATUS_TIDAK_DITEMUKAN` (A2).
- Produces:
  - `terapkanJawabanGateway(p: PesananDiperiksa): Promise<HasilPeriksaPesanan>`, pengganti `terapkanJawabanMidtrans`.
  - `HasilPeriksaPesanan`: `midtrans_tak_terjawab` → `gateway_tak_terjawab`, `bentuk_order_id` → `bentuk_invoice`; nilai lain tetap.
  - `sapuPesananMenggantung` dan `periksaPesananMenggantung` tidak berubah tanda tangannya.

- [ ] **Step 1: Ubah dan tambah uji yang gagal**, dengan `bacaStatusDoku` dimock. `lewat` berarti `now ≥ kedaluwarsa_pada + 1 jam`.

  | Jawaban DOKU | Sebelum `lewat` | Sesudah `lewat` |
  |---|---|---|
  | 404 | `belum_kedaluwarsa`, RPC tidak dipanggil | RPC dipanggil dengan `p_status = 'EXPIRED'`, `p_sumber = 'status_api'`, `p_keterangan` memuat `TIDAK_DITEMUKAN`; pesanan `kedaluwarsa` |
  | `PENDING` / `REDIRECT` / `TIMEOUT` / `FAILED` | RPC dengan status asli → `tanpa_efek` | `EXPIRED` dengan `p_keterangan` memuat status asli → `kedaluwarsa` (baris 10) |
  | `SUCCESS` cocok | lunas | lunas |
  | `kode` 0 atau 5xx | `gateway_tak_terjawab`, RPC tidak dipanggil (baris 11) | sama |
  | `kode` -1 | `kunci_belum_terpasang` | sama |

  Uji tambahan:
  - `kode`/`percobaan` cacat → `bentuk_invoice`;
  - galat RPC → `galat_basis_data`;
  - pemeriksaan `PENDING` berulang sebelum `lewat` → `duplikat` pada panggilan kedua (sidik stabil);
  - rute periksa-ulang memetakan setiap anggota `HasilPeriksaPesanan` ke kalimat, dengan `gateway_tak_terjawab` → "DOKU tidak menjawab. Coba lagi beberapa saat lagi.".
- [ ] **Step 2:** `npx vitest run tests/pesanan-periksa-dibuka.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementasikan.**
  - Sidik Check Status: `hitungSidikDoku({ sumber: "status_api", invoice, status, pembeda: "" })`.
  - Sidik untuk vonis waktu lokal: `status: "EXPIRED"`, `pembeda: \`lewat_tenggang:${asli}\``.
  - `p_keterangan`: `` `DOKU menjawab ${asli} sesudah tenggat + ${JAM_TENGGANG_TANPA_VONIS} jam` ``.
  - `p_nominal`: `status.nominal` (`null` bila tidak terbaca); untuk vonis waktu lokal `null`.
  - Himpunan `SAH` lokal tetap ada; alasannya di dokblok `:209-240`.
- [ ] **Step 4:** Jalankan uji tadi, uji cron, dan `npx tsc --noEmit`. Expected: PASS. Buktikan merah: ganti `≥` menjadi `>` lalu geser jam uji tepat ke batas; atau hapus `FAILED` dari pemeriksaan "non-final" sehingga sel `FAILED`/`lewat` memerah.
- [ ] **Step 5: Commit** — `feat(pesanan): rekonsiliasi memakai Check Status DOKU`.

### Tugas A10: Mencabut Midtrans sampai ke akarnya

**Files:**
- Create: `web/supabase/migrations/20261113130200_hapus_midtrans.sql` (`drop function public.terapkan_notifikasi_midtrans(text, text, text, text, text, numeric, text, text);`)
- Delete:
  - `web/src/lib/midtrans/` (seluruhnya) dan `web/src/app/api/pembayaran/midtrans/`
  - `web/tests/pesanan-webhook.test.ts`, `web/tests/midtrans-konfig.test.ts`, `web/tests/midtrans-terbit-token.test.ts` (digantikan uji `doku-*`)
- Modify:
  - `web/src/lib/pesanan/order-id.ts`: hapus `POLA_ORDER_ID`, `rakitOrderId`, dan `uraiOrderId` beserta setiap pemanggilnya
  - `web/src/lib/penjualan/baca.ts`: `STATUS_KEMBALI` → `[...STATUS_DOKU_REFUND]`
  - label layar `"ditahan Midtrans"` dan teks penjelasan di `admin/pesanan/page.tsx:27-49`, `admin/penjualan/tabel-penjualan.tsx:20`, `owner/penjualan/kartu-bulan.tsx:15`, `owner/penjualan/page.tsx:83-86` → "DOKU" atau label netral. Arti kalimatnya tetap; "dashboard Midtrans" menjadi "Back Office DOKU".
  - `web/.env.example`: hapus blok Midtrans `:48-70`
  - `web/README.md`: baris rute `:140`, `:179`, `:183`, `:194`; catatan `:386-387`; dan **Fase 3 ditulis ulang** dengan isi §8 spec (sembilan langkah, termasuk "matikan Recover Abandoned Cart", "jangan nyalakan notifikasi kedaluwarsa Checkout", dan `NEXT_PUBLIC_BASIS_URL` sebagai env wajib pembayaran)
  - `web/tests/fungsi-mesin-tertutup.test.ts`: hapus `terapkan_notifikasi_midtrans` dari `MESIN_TERTUTUP`
  - semua uji tersisa dari `grep -rli midtrans tests`

**Interfaces:** tidak ada yang baru.

- [ ] **Step 1: Tulis uji pagar yang gagal** di `web/tests/tanpa-midtrans.test.ts`:
  - pindai `src/` (pola `env-terdokumentasi.test.ts:46-62`) untuk `/midtrans/i` di luar baris komentar → kosong;
  - `.env.example` tidak memuat `MIDTRANS`;
  - `pg_proc` tidak memuat `terapkan_notifikasi_midtrans`.
- [ ] **Step 2:** `npx vitest run tests/tanpa-midtrans.test.ts`. Expected: FAIL.
- [ ] **Step 3: Kerjakan penghapusan di atas.** Komentar sejarah yang sengaja disisakan, misalnya "versi Midtrans P1 punya cacat X", boleh tetap; daftarkan di pesan commit.
- [ ] **Step 4:** `npx supabase migration up --local --include-all && npx tsc --noEmit && npm run lint && npx vitest run`. Expected: tsc dan lint bersih; suite penuh = merah bawaan Tugas A1, tidak lebih.
- [ ] **Step 5: Commit** — `refactor(doku): mencabut Midtrans dari kode, env, uji, dan README`.

### Tugas A11: Teks hukum — kebijakan privasi dan S&K bagian pembayaran

**Files:**
- Modify: `web/src/app/_dokumen/isi-kebijakan-privasi.tsx` (baris 22, 68, 208), `web/src/app/_dokumen/isi-syarat-ketentuan.tsx` (±103–116)
- Test: modify `web/tests/dokumen-hukum.test.tsx`

**Interfaces:** `VERSI_DOKUMEN` **tidak** diubah. Keputusannya milik pemilik repo (§5.9).

- [ ] **Step 1: Ubah uji agar gagal.**
  - Kedua dokumen menyebut "DOKU" dan tidak menyebut "Midtrans".
  - Privasi menyebut kegunaan "pemrosesan pembayaran produk digital dan tagihan sesi".
  - S&K tidak lagi memuat "bukti pembayarannya diunggah" maupun "pengajuan batal dan slotnya dilepas".
  - S&K memuat "24 jam atau sampai jam kunjungan, mana yang lebih dulu".
  - `VERSI_DOKUMEN` sama dengan nilai sebelum tugas ini (literalnya disalin ke uji).
- [ ] **Step 2:** `npx vitest run tests/dokumen-hukum.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Tulis ulang teksnya** mengikuti empat butir usulan §5.9, dalam bahasa baku. Redaksi final tetap di tangan review hukum (checklist README Fase 3 butir 8).
- [ ] **Step 4:** Jalankan. Expected: PASS.
- [ ] **Step 5: Commit** — `docs(hukum): DOKU sebagai pemroses pembayaran; S&K pembayaran sesi lewat DOKU`.

### Tugas A12: Verifikasi terhadap sandbox DOKU (keluar saja, tanpa URL publik)

Webhook masuk tidak bisa dibuktikan dari mesin lokal: ngrok dilarang DOKU [S11], dan branch ini tidak di-push. Bagian itu tetap langkah manusia di README Fase 3 butir 2 (deploy preview). Tugas ini membuktikan semua yang **keluar** dari PADMA ke DOKU.

**Files:**
- Create (tidak di-commit): `/private/tmp/claude-503/-Users-arvinfairuz-Documents-padma/ae5a7f38-a64c-4bf5-83fe-364df7898804/scratchpad/uji-asap-doku.ts`
- Modify: spec §4.3 (jawaban K7, K11, dan kebutuhan `customer`) bila terbukti

- [ ] **Step 1: Tulis skrip asap.** Skrip memanggil `buatPembayaranDoku` dengan invoice uji `PSN261113ABCDEF1`, nominal 10000, satu item, 30 menit, dan callback `http://localhost:3000/passport/produk`. Ia mencetak **hanya** `ok`, panjang URL, dan host URL. Jalankan dengan `cd web && npx tsx --conditions=react-server --env-file=.env.local <skrip>`. Expected: `ok: true` dan host `*.doku.com`. DOKU yang menerima permintaan itu adalah bukti tanda tangan permintaan kita benar.
- [ ] **Step 2: Bila DOKU menolak karena `customer`,** tambahkan di adapter **hanya** medan yang disebut pesan galatnya. Nilainya diambil dari `clients.padma_id`, bukan nama atau email. Tambahkan uji untuk medan itu, ulangi Step 1, lalu catat di spec §4.2.
- [ ] **Step 3: Bayar lewat simulator sandbox** [S5, S29] dengan URL dari Step 1. Lalu jalankan `bacaStatusDoku("PSN261113ABCDEF1")`. Expected: `ok: true`, `status: "SUCCESS"`, `nominal: 10000`.
- [ ] **Step 4: Ukur K7.** Jalankan `bacaStatusDoku("PSN261113FFFFFF9")` untuk invoice yang tidak pernah dibuat. Catat kode HTTP dan bentuk badannya di spec §4.3 K7. Bila ternyata **bukan** 404, ubah cabang `kode === 404` di A6/A9 berikut ujinya, lalu commit.
- [ ] **Step 5: Commit** perubahan adapter dan spec (bila ada) — `fix(doku): sesuaikan adapter dengan jawaban sandbox` atau `docs(spec): jawaban sandbox K7/K11`. Hapus skrip asap dari scratchpad.
