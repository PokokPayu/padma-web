# Tahap A — Sembunyikan Paket di Balik Satu Saklar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat seluruh tampilan paket lenyap dari layar klien maupun staf lewat satu konstanta, tanpa membongkar satu pun logika data, RLS, atau pagar uang.

**Architecture:** Satu konstanta `PAKET_TAMPIL` di satu berkas. Gerbangnya dipasang di **batas data**, bukan di setiap tempat render: keempat fungsi yang memasok data paket ke layar memulangkan hasil kosong ketika saklar mati, sehingga seluruh cabang tampilan di hilirnya lenyap dengan sendirinya. Hanya teks dan kontrol yang ditulis keras (judul, kolom tabel, saringan, checkbox) yang perlu disentuh satu per satu.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, Vitest + `renderToStaticMarkup`.

**Spec:** `docs/superpowers/specs/2026-09-08-padma-daftar-mandiri-design.md` (keputusan K11).

## Global Constraints

- **Bahasa Indonesia** untuk seluruh nama, komentar, dan teks antarmuka — mengikuti seluruh repo.
- **Komentar menjelaskan MENGAPA, bukan apa.** Setiap gerbang saklar menyebut alasannya.
- **Tidak ada logika data, RLS, migrasi, atau server action yang dihapus/diubah.** K11: ini saklar, bukan pembongkaran. Tabel `packages`, `client_packages`, dan seluruh policy-nya tidak disentuh.
- **TDD**: test ditulis dan dijalankan sampai MERAH sebelah implementasi.
- **`npm test` menjalankan seluruh suite terhadap Supabase lokal yang dipakai bersama.** Koordinasikan sebelum menjalankannya penuh; selama mengerjakan tugas, jalankan hanya berkas test yang bersangkutan.
- **27 berkas test yang menyentuh paket harus tetap hijau apa adanya.** Bila ada yang merah, gerbangnya dipasang di tempat yang salah — perbaiki gerbangnya, jangan ubah test itu.

## Struktur berkas

| Berkas | Tanggung jawab |
|---|---|
| `web/src/lib/paket-tampil.ts` | **Baru.** Satu konstanta + alasannya. Satu-satunya tempat yang diubah saat paket dihidupkan lagi. |
| `web/src/lib/passport/data.ts` | Gerbang pada `ambilPaket()` — memasok beranda Passport dan halaman Bayar klien. |
| `web/src/lib/admin/klien.ts` | Gerbang pada kolom `paketAktif` daftar klien. |
| `web/src/lib/admin/katalog-admin.ts` | Gerbang pada daftar paket per layanan di Admin › Layanan. |
| `web/src/lib/admin/antrean.ts` | Gerbang pada penghitung klaim bayar (badge angka). |
| 7 berkas halaman/komponen | Teks & kontrol yang ditulis keras. |
| `web/tests/paket-tersembunyi.test.ts` | **Baru.** Pagar: dengan saklar mati, kata "paket" tidak muncul di keluaran render mana pun. |

---

### Task 1: Konstanta saklar + gerbang data klien

**Files:**
- Create: `web/src/lib/paket-tampil.ts`
- Modify: `web/src/lib/passport/data.ts` (fungsi `ambilPaket`, sekitar baris 166–181)
- Test: `web/tests/paket-tersembunyi.test.ts` (baru)

**Interfaces:**
- Produces: `PAKET_TAMPIL: boolean` dari `@/lib/paket-tampil` — dipakai Task 2 dan 3.
- Produces: `ambilPaket(clientId: string): Promise<PaketRingkas[]>` memulangkan `[]` ketika saklar mati. Bentuk `PaketRingkas` tidak berubah.

- [ ] **Step 1: Tulis test yang gagal**

Buat `web/tests/paket-tersembunyi.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

/** Klien seed yang memang punya paket aktif — nilai yang sama dipakai
 *  tests/admin-klien.test.ts:46 dan tests/admin-layanan.test.ts:53. */
const ANANDA = "44444444-4444-4444-4444-444444444401";

/**
 * PAGAR SAKLAR PAKET (spec K11).
 *
 * Yang dijaga: dengan `PAKET_TAMPIL = false`, tidak ada jalur data yang
 * memasok paket ke layar. Test ini sengaja memakai klien seed yang MEMANG
 * punya paket aktif — kalau ia dites dengan klien tanpa paket, ia akan hijau
 * tanpa membuktikan apa pun.
 */
describe("saklar paket: gerbang data klien", () => {
  it("ambilPaket memulangkan kosong walau kliennya punya paket aktif", async () => {
    const { ambilPaket } = await import("@/lib/passport/data");
    expect(await ambilPaket(ANANDA)).toEqual([]);
  });

  it("dengan saklar HIDUP, paket klien itu tetap terbaca", async () => {
    vi.resetModules();
    vi.doMock("@/lib/paket-tampil", () => ({ PAKET_TAMPIL: true }));
    const { ambilPaket } = await import("@/lib/passport/data");
    expect((await ambilPaket(ANANDA)).length).toBeGreaterThan(0);
    vi.doUnmock("@/lib/paket-tampil");
    vi.resetModules();
  });
});
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

```bash
cd web && npx vitest run tests/paket-tersembunyi.test.ts
```

Diharapkan: test pertama GAGAL — `ambilPaket` masih memulangkan paket seed.

- [ ] **Step 3: Buat konstanta saklar**

Buat `web/src/lib/paket-tampil.ts`:

```ts
/**
 * SAKLAR TAMPILAN PAKET (spec 8 Sep 2026, keputusan K11).
 *
 * Klien meminta seluruh tampilan paket hilang dari layar klien maupun staf
 * selama pertanyaan tentang paket bundling masih terbuka — terutama catatan
 * klien 6 September: "beli 1 paket isinya beberapa layanan, tapi yang beli 1
 * orang, penjadwalannya bagaimana?"
 *
 * Kenapa saklar dan bukan pembongkaran: paket menyentuh 31 berkas sumber dan
 * 27 berkas test. Membongkarnya berarti menulis ulang 27 test yang sudah hijau
 * supaya hijau lagi dalam bentuk lain — kerja besar yang hasilnya tak terlihat
 * siapa pun, untuk keadaan yang SEMENTARA. Dengan saklar, menyalakannya
 * kembali adalah satu baris di berkas ini.
 *
 * Yang TIDAK disentuh saklar ini: tabel `packages` & `client_packages`,
 * seluruh RLS-nya, server action-nya, dan pagar uang. Data paket tetap utuh;
 * yang hilang hanya jalan menuju layar.
 */
export const PAKET_TAMPIL = false;
```

- [ ] **Step 4: Pasang gerbang di `ambilPaket`**

Di `web/src/lib/passport/data.ts`, tambahkan impor di bagian atas berkas:

```ts
import { PAKET_TAMPIL } from "@/lib/paket-tampil";
```

lalu sisipkan sebagai baris pertama badan `ambilPaket`:

```ts
export async function ambilPaket(clientId: string): Promise<PaketRingkas[]> {
  // GERBANG SAKLAR (K11). Dipasang di batas data, bukan di tiap tempat render:
  // kedua pemanggilnya — beranda Passport dan halaman Bayar klien — adalah
  // jalur TAMPILAN, dan keduanya sudah punya cabang "klien tanpa paket" yang
  // benar. Beranda jatuh ke kartu "Perjalanan Anda" (page.tsx), tagihan hanya
  // berisi sesi lepas. Menggerbang di sini menghemat dua belas suntingan
  // tampilan dan menutup jalur yang mungkin ditambahkan kemudian.
  if (!PAKET_TAMPIL) return [];

  const supabase = await createServerSupabase();
  // ... sisa fungsi tidak berubah
}
```

- [ ] **Step 5: Jalankan, pastikan HIJAU**

```bash
cd web && npx vitest run tests/paket-tersembunyi.test.ts
```

Diharapkan: keduanya LULUS.

- [ ] **Step 6: Pastikan test Passport yang sudah ada tidak ikut merah**

```bash
cd web && npx vitest run tests/passport-beranda.test.ts tests/passport-bayar-ajukan.test.ts tests/passport-data.test.ts tests/admin-bayar.test.ts
```

Bila ada yang merah karena mengasersikan **tampilan** paket, gerbangnya benar dan asersi itu memang harus menyesuaikan — ubah asersinya dan tulis di komentar apa yang tetap dijaga. Bila merah karena **logika data** paket, gerbangnya salah tempat: kembalikan dan pasang lebih ke hilir.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/paket-tampil.ts web/src/lib/passport/data.ts web/tests/paket-tersembunyi.test.ts
git commit -m "feat(paket): saklar PAKET_TAMPIL dan gerbang data sisi klien"
```

---

### Task 2: Gerbang data sisi staf

**Files:**
- Modify: `web/src/lib/admin/klien.ts` (kolom `paketAktif`, sekitar baris 75–127)
- Modify: `web/src/lib/admin/katalog-admin.ts` — `daftarKatalogAdmin()`, tempat `paketPerLayanan` dirakit (sekitar baris 171) dan disematkan ke medan `paket: PaketKelola[]` pada `LayananKelola`
- Modify: `web/src/lib/admin/antrean.ts` — `hitungKlaimMenunggu()` (baris 45–63)
- Test: `web/tests/paket-tersembunyi.test.ts` (tambah blok)

**Interfaces:**
- Consumes: `PAKET_TAMPIL` dari Task 1.
- Produces: daftar klien tetap punya medan `namaFase` dan `paketAktif`; `paketAktif` selalu `null` ketika saklar mati (bentuk tidak berubah, hanya isinya).

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `web/tests/paket-tersembunyi.test.ts`:

Keduanya memakai `createServerSupabase()` (sesi pengguna, bukan service role), jadi berkas test
ini butuh sesi staf yang disuntikkan — pola yang sama dengan `tests/admin-klien-halaman.test.tsx`.
Tambahkan di kepala berkas test:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { signInAs } from "./helpers/as-user";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

beforeAll(async () => {
  ref.sesi = await signInAs("admin@padma.test");
});
```

lalu bloknya:

```ts
describe("saklar paket: gerbang data staf", () => {
  it("daftar klien tidak membawa nama paket", async () => {
    const { ambilDaftarKlien } = await import("@/lib/admin/klien");
    const hasil = await ambilDaftarKlien({});
    expect(hasil.baris.every((k) => k.paketAktif === null)).toBe(true);
  });

  it("katalog admin tidak membawa daftar paket per layanan", async () => {
    const { daftarKatalogAdmin } = await import("@/lib/admin/katalog-admin");
    const fase = await daftarKatalogAdmin();
    const semuaLayanan = fase.flatMap((f) => f.layanan);
    expect(semuaLayanan.length).toBeGreaterThan(0); // katalog seed memang berisi
    expect(semuaLayanan.every((l) => l.paket.length === 0)).toBe(true);
  });

  it("penghitung klaim hanya menghitung sesi lepas", async () => {
    const { hitungKlaimMenunggu } = await import("@/lib/admin/antrean");
    const { count } = await ref.sesi!
      .from("sessions")
      .select("*", { count: "exact", head: true })
      .eq("status_bayar", "menunggu_verifikasi")
      .is("client_package_id", null)
      .neq("status", "batal");
    expect(await hitungKlaimMenunggu()).toBe(count ?? 0);
  });
});
```

Nama medan pada `BarisKlienDaftar` dan bentuk `FaseKelola`/`LayananKelola` sudah dipastikan ada:
lihat `web/src/lib/admin/klien.ts:10` dan `web/src/lib/admin/katalog-admin.ts:51-58`.

- [ ] **Step 2: Jalankan, pastikan MERAH**

```bash
cd web && npx vitest run tests/paket-tersembunyi.test.ts
```

- [ ] **Step 3: Pasang ketiga gerbang**

Di `web/src/lib/admin/klien.ts`, tempat `namaPaket` dirakit menjadi `paketAktif`:

```ts
// GERBANG SAKLAR (K11): kolom Paket pada daftar klien ikut disembunyikan,
// jadi isinya tidak perlu dirakit. Kueri paketnya sendiri dibiarkan supaya
// bentuk fungsi ini tidak berubah bagi pemanggil lain.
paketAktif: PAKET_TAMPIL ? (namaPaket ?? null) : null,
```

Di `web/src/lib/admin/katalog-admin.ts`, pada tempat daftar paket per layanan disusun, kembalikan larik kosong ketika saklar mati, dengan komentar:

```ts
// GERBANG SAKLAR (K11): Admin › Layanan tidak lagi menampilkan sublist paket
// maupun tombol aktif/nonaktifkan paket. Server action-nya tetap ada dan tetap
// diuji — yang hilang hanya jalan menuju layar.
```

Di `web/src/lib/admin/antrean.ts`, pada `hitungKlaimMenunggu()` (baris 63):

```ts
// GERBANG SAKLAR (K11): badge angka harus cocok dengan jumlah baris yang
// benar-benar tampil di tabel. Menghitung klaim paket yang barisnya
// disembunyikan akan memunculkan angka yang tidak bisa ditemukan admin di
// layar mana pun — bentuk kesalahan yang paling melelahkan untuk dilacak.
const jumlahPaket = PAKET_TAMPIL ? (paket.count ?? 0) : 0;
return (sesi.count ?? 0) + jumlahPaket;
```

- [ ] **Step 4: Jalankan, pastikan HIJAU**

```bash
cd web && npx vitest run tests/paket-tersembunyi.test.ts tests/admin-klien.test.ts tests/admin-layanan.test.ts tests/admin-bayar.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/admin/klien.ts web/src/lib/admin/katalog-admin.ts web/src/lib/admin/antrean.ts web/tests/paket-tersembunyi.test.ts
git commit -m "feat(paket): gerbang saklar pada jalur data panel staf"
```

---

### Task 3: Teks dan kontrol yang ditulis keras

**Files:**
- Modify: `web/src/app/admin/klien/page.tsx:66` (saringan "Punya paket"), `:91` (`<Th>Paket</Th>`), `:109` (`<Td>`)
- Modify: `web/src/app/admin/layanan/page.tsx:8` (metadata title), `:46` (h1), `:56` (kalimat pembuka), serta blok `l.paket.length > 0` sekitar `:114`
- Modify: `web/src/app/admin/_shell/nav-admin.tsx:20` (label sidebar)
- Modify: `web/src/app/admin/bayar/page.tsx:40-41` (kalimat penjelas)
- Modify: `web/src/app/admin/page.tsx:92` (keterangan kartu)
- Modify: `web/src/app/admin/sesi/form-sesi.tsx:303-306` (checkbox "Hitung ke paket aktif")
- Modify: `web/src/app/_landing/passport-teaser.tsx:7,14` (teks pemasaran)

**Interfaces:**
- Consumes: `PAKET_TAMPIL` dari Task 1.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `web/tests/paket-tersembunyi.test.ts`:

```ts
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Sapuan teks. Kata "paket" tidak boleh muncul di keluaran render mana pun
 * selama saklar mati — termasuk pada judul, label kolom, dan teks pemasaran
 * yang tidak bersumber dari data sehingga tidak tersentuh gerbang Task 1 & 2.
 */
describe("saklar paket: tidak ada kata 'paket' di layar", () => {
  it("teaser Passport di landing tidak menyebut paket", async () => {
    const { PassportTeaser } = await import("@/app/_landing/passport-teaser");
    expect(renderToStaticMarkup(<PassportTeaser />)).not.toMatch(/paket/i);
  });
});
```

Berkas ini karena itu harus bernama `.tsx`, bukan `.ts` — ganti namanya menjadi
`web/tests/paket-tersembunyi.test.tsx` (pola yang sama dengan `tests/admin-klien-halaman.test.tsx`).
Ekspor `PassportTeaser` sudah dipastikan ada di `web/src/app/_landing/passport-teaser.tsx:18`.

Untuk halaman yang butuh sesi pengguna (admin klien, layanan, bayar, sesi), pakai pola `tests/admin-klien-halaman.test.tsx`: `vi.mock("@/lib/auth/require-role", ...)`, `signInAs("admin@padma.test")`, lalu impor halamannya secara dinamis dan render dengan `searchParams: Promise.resolve({})`. Tulis satu `it` per halaman dengan asersi `expect(markup).not.toMatch(/paket/i)`.

- [ ] **Step 2: Jalankan, pastikan MERAH**

```bash
cd web && npx vitest run tests/paket-tersembunyi.test.tsx
```

Diharapkan: gagal pada teaser landing dan pada setiap halaman admin yang masih memuat kata itu.

- [ ] **Step 3: Sunting ketujuh berkas**

Untuk **kontrol dan kolom** (saringan, `<Th>`/`<Td>`, checkbox, sublist paket, tombol paket), bungkus dengan `PAKET_TAMPIL &&` sehingga elemennya tidak dirender sama sekali — bukan disembunyikan lewat CSS. Contoh pada `web/src/app/admin/klien/page.tsx`:

```tsx
{PAKET_TAMPIL && <Th>Paket</Th>}
```

Perhatikan: berkas test ini juga me-mock `@/lib/supabase/server`, sedangkan halaman-halaman yang
dirender memakai mock yang sama — jadi satu `beforeAll` di kepala berkas melayani seluruh blok.

dan pada baris datanya:

```tsx
{PAKET_TAMPIL && <Td>{k.paketAktif ?? "—"}</Td>}
```

Saringan pada baris 66 dihilangkan dari larik saringan dengan cara yang sama:

```tsx
...(PAKET_TAMPIL
  ? [{ nama: "paket", label: "Paket", pilihan: [{ nilai: "ada", label: "Punya paket" }] }]
  : []),
```

Untuk **teks tetap** (judul halaman, label sidebar, kalimat penjelas, teks pemasaran), tulis kalimat versi tanpa paket dan pilih dengan `PAKET_TAMPIL ? ... : ...`. Contoh pada `web/src/app/admin/layanan/page.tsx`:

```tsx
export const metadata = { title: PAKET_TAMPIL ? "Layanan & Paket" : "Layanan" };
```

Kalimat pada `web/src/app/admin/bayar/page.tsx:40-41` ("Sesi yang tercakup paket tidak muncul sendiri…") **dihapus seluruhnya** ketika saklar mati: ia menerangkan perilaku yang tidak lagi bisa diamati siapa pun, dan keterangan tentang hal yang tak terlihat hanya membingungkan.

Pada `web/src/app/_landing/passport-teaser.tsx`, kedua baris yang menyebut paket diganti kalimat yang tetap benar tanpa paket — mis. `"Riwayat sesi yang terlihat — seperti stempel di paspor"` dan pasangan `["Sesi berikutnya", "Garbha Relief · 90 menit"]`. Ini teks pemasaran di halaman publik: ia tidak boleh menjanjikan sesuatu yang tidak ada di produk.

- [ ] **Step 4: Jalankan, pastikan HIJAU**

```bash
cd web && npx vitest run tests/paket-tersembunyi.test.tsx tests/landing.test.ts tests/admin-shell.test.ts tests/admin-klien-halaman.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add web/src/app web/tests/paket-tersembunyi.test.tsx
git commit -m "feat(paket): sembunyikan teks dan kontrol paket di klien dan panel staf"
```

---

### Task 4: Sapuan menyeluruh dan pemeriksaan regresi

**Files:**
- Modify: `web/tests/paket-tersembunyi.test.tsx` (lengkapi cakupan halaman)

**Interfaces:**
- Consumes: seluruh gerbang dari Task 1–3.

- [ ] **Step 1: Lengkapi sapuan sampai seluruh halaman tercakup**

Pastikan berkas test memuat satu `it` untuk **setiap** halaman ini, masing-masing berasersi `not.toMatch(/paket/i)`: `/` (landing), `/passport`, `/passport/bayar`, `/admin`, `/admin/klien`, `/admin/layanan`, `/admin/bayar`, `/admin/sesi`, `/owner/rekap`.

Bila sebuah halaman sulit dirender di vitest karena kebutuhan sesi atau parameter, pakai pola `tests/admin-klien-halaman.test.tsx` yang sudah ada; jangan melewatinya diam-diam — halaman yang dilewati adalah halaman yang tidak dijaga.

- [ ] **Step 2: Jalankan sapuan**

```bash
cd web && npx vitest run tests/paket-tersembunyi.test.tsx
```

Diharapkan: seluruhnya LULUS. Setiap kegagalan menunjuk satu tempat paket yang masih bocor ke layar — tambal di berkas yang ditunjuk, bukan dengan melonggarkan asersinya.

- [ ] **Step 3: Jalankan seluruh suite**

Koordinasikan lebih dulu — Supabase lokal dipakai bersama sesi lain.

```bash
cd web && npm test
```

Diharapkan: HIJAU seluruhnya. **27 berkas test yang menyentuh paket harus lulus tanpa diubah**, kecuali yang secara khusus mengasersikan tampilan paket (ditangani di Task 1 Step 6). Bila sebuah test logika data paket merah, gerbangnya dipasang terlalu dalam.

- [ ] **Step 4: Commit**

```bash
git add web/tests/paket-tersembunyi.test.tsx
git commit -m "test(paket): sapuan menyeluruh bahwa paket tidak muncul di layar mana pun"
```

## Catatan untuk yang mengerjakan

**Yang membuat tahap ini gagal**, bila gagal: memasang gerbang terlalu dalam. Bila Anda mendapati diri menyunting migrasi, policy RLS, server action, atau `variant_rates`/`honor_marks`, berhentilah — itu bukan tampilan. Saklar ini hanya boleh memutus jalan dari data menuju layar.

**Yang tidak perlu disentuh sama sekali:** formulir pengajuan jadwal. `ajukanJadwal()` hanya menerima layanan, varian, dan tanggal — ia tidak pernah punya pilihan paket. Yang bertanda `jenis: "paket" | "sesi"` adalah `klaimSudahBayar()`, dan cabang paketnya menjadi tak terjangkau dengan sendirinya begitu tagihan paket tidak lagi tampil.
