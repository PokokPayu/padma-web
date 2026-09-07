# Tahap B — Halaman Auth, Pendaftaran Mandiri, dan Pemulihan Kata Sandi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Orang bisa mendaftar sendiri (lewat formulir atau Google), memulihkan kata sandinya, dan masuk ke lima halaman auth yang memakai panggung split-screen sesuai prototipe — tanpa membuka kembali celah penautan akun yang sudah dua kali ditutup.

**Architecture:** Satu komponen panggung melayani lima halaman. Seluruh jalur masuk bermuara di satu gerbang `pastikanKlien()` yang dipanggil `/setelah-masuk`, dengan urutan keputusan tetap; penautan lewat email hanya sah bila `email_confirmed_at` terisi, dan pemeriksaan itu terjadi DI DALAM fungsi penaut, bukan dipercayakan kepada pemanggil.

**Tech Stack:** Next.js App Router, TypeScript, Supabase Auth (`@supabase/ssr`), Tailwind v4, Vitest + `renderToStaticMarkup`.

**Spec:** `docs/superpowers/specs/2026-09-08-padma-daftar-mandiri-design.md` (keputusan K1–K7, K14, K17).

## Global Constraints

- **Bahasa Indonesia** untuk seluruh nama, komentar, dan teks antarmuka.
- **Label `/masuk` tidak boleh berubah.** `web/tests/e2e/access-matrix.e2e.ts:100-108` mengisi formulir lewat `getByLabel("Email")`, `getByLabel("Kata sandi")`, dan tombol bernama **persis** `"Masuk"`. Tombol Google bernama `"Masuk dengan Google"` sehingga pencarian `exact: true` tetap unik.
- **`linkClientByInvite` dan seluruh isi `src/lib/auth/link-client.ts` yang sudah ada TIDAK diubah.** Fungsi baru ditambahkan di sebelahnya.
- **Fungsi penaut baru menerima objek `User` Supabase utuh, bukan string email.** Fungsi yang menerima email telanjang adalah bentuk `linkClientByEmail` yang dulu dihapus; selama fungsi seperti itu ada, celahnya bisa kambuh hanya dengan satu pemanggilan dari rute baru.
- **Fase TIDAK ditanyakan saat mendaftar** dan `clients.phase_id` menjadi nullable (K3).
- **TDD**: test ditulis dan dijalankan sampai MERAH sebelum implementasi.
- **`npm test` memakai Supabase lokal yang dipakai bersama.** Koordinasikan sebelum menjalankannya penuh.
- Warna panggung dari prototipe: kartu `max-width: 900px`, kolom `1fr 1.1fr`, sudut `26px`, kolom kiri `--color-night` dengan radial-gradient. Menumpuk di bawah 860px.

## Struktur berkas

| Berkas | Tanggung jawab |
|---|---|
| `web/src/app/_auth/panggung.tsx` | **Baru.** Kerangka dua kolom + logo. Dipakai lima halaman. Folder `_` = bukan segmen URL. |
| `web/src/lib/auth/daftar.ts` | **Baru.** Validator MURNI (tanpa I/O) untuk isian pendaftaran. |
| `web/src/lib/auth/pastikan-klien.ts` | **Baru.** Gerbang lima langkah. Satu-satunya tempat keputusan penautan. |
| `web/src/lib/auth/tujuan-aman.ts` | **Baru.** Daftar putih tujuan redirect. Fungsi murni. |
| `web/src/lib/auth/link-client.ts` | Ditambah `tautkanKlienLewatEmailTerverifikasi` dan `terbitkanKlienMandiri`. Isi lama tidak disentuh. |
| `web/src/app/{daftar,lupa-sandi,atur-sandi,periksa-email}/` | **Baru.** Empat halaman. |
| `web/src/app/masuk/` | Dirombak tampilannya; label dipertahankan. |
| `web/src/app/icon.svg` | **Baru.** Favicon teratai emas. |

---

### Task 1: Panggung auth, halaman Masuk, logo, dan favicon

**Files:**
- Create: `web/src/app/_auth/panggung.tsx`, `web/src/app/icon.svg`
- Modify: `web/src/app/masuk/page.tsx`, `web/src/app/masuk/form-masuk.tsx`, `web/src/app/akun-belum-terhubung/page.tsx`
- Test: `web/tests/panggung-auth.test.tsx` (baru)

**Interfaces:**
- Produces: `PanggungAuth({ judul, kalimat, children }: { judul: string; kalimat: string; children: React.ReactNode })` dari `@/app/_auth/panggung` — dipakai Task 2, 3, dan 4.

- [ ] **Step 1: Tulis test yang gagal**

Buat `web/tests/panggung-auth.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PanggungAuth } from "@/app/_auth/panggung";
import MasukPage from "@/app/masuk/page";

describe("panggung auth", () => {
  it("menampilkan kalimat sisi kiri dan isi sisi kanan", () => {
    const m = renderToStaticMarkup(
      <PanggungAuth judul="Passport Anda menunggu." kalimat="Riwayat sesi.">
        <p>isi kanan</p>
      </PanggungAuth>,
    );
    expect(m).toContain("Passport Anda menunggu.");
    expect(m).toContain("isi kanan");
  });

  it("membawa logo PADMA di sisi gelap", () => {
    const m = renderToStaticMarkup(
      <PanggungAuth judul="X" kalimat="Y"><span /></PanggungAuth>,
    );
    expect(m).toContain("logo-padma.png");
  });
});

describe("halaman /masuk", () => {
  const m = renderToStaticMarkup(<MasukPage />);

  // PAGAR E2E: tests/e2e/access-matrix.e2e.ts mengisi formulir ini lewat
  // getByLabel("Email"), getByLabel("Kata sandi"), dan tombol persis "Masuk".
  // Mengganti ketiga nama itu memerahkan matriks akses tanpa menyentuh satu
  // pun test unit — jadi pagarnya dipasang di sini.
  it("mempertahankan label yang dipakai skrip E2E", () => {
    expect(m).toContain("Email");
    expect(m).toContain("Kata sandi");
    expect(m).toMatch(/>Masuk</);
  });

  it("menawarkan daftar dan lupa sandi", () => {
    expect(m).toContain('href="/daftar"');
    expect(m).toContain('href="/lupa-sandi"');
  });
});
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

```bash
cd web && npx vitest run tests/panggung-auth.test.tsx
```

Diharapkan: GAGAL — modul `@/app/_auth/panggung` belum ada.

- [ ] **Step 3: Buat panggung**

Buat `web/src/app/_auth/panggung.tsx`. Folder berawalan `_` bukan segmen URL — pola yang sama dengan `_landing` dan `_shell`. Logo PNG dipasang di kolom gelap; **jangan** dipakai di atas latar terang, emas bergradasi di atas krem kehilangan kontras.

```tsx
import Image from "next/image";

/**
 * PANGGUNG HALAMAN AUTH — dipakai /masuk, /daftar, /lupa-sandi, /atur-sandi,
 * /periksa-email, dan /akun-belum-terhubung.
 *
 * Angka-angkanya dari prototipe yang sudah disetujui klien
 * (padma-prototype.html baris 326-348): kartu 900px, kolom 1fr 1.1fr, sudut
 * 26px. Di bawah 860px kolom menumpuk dan sisi hijau TETAP ADA sebagai kepala
 * pendek — ia yang membawa logo, dan halaman auth tanpa lambang terasa seperti
 * halaman orang lain.
 */
export function PanggungAuth({
  judul,
  kalimat,
  children,
}: {
  judul: string;
  kalimat: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-paper-warm px-4 py-10">
      <div className="grid w-full max-w-[900px] overflow-hidden rounded-[26px] border border-black/10 bg-white md:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col justify-center bg-night bg-[radial-gradient(500px_400px_at_20%_0%,rgba(47,106,72,.55),transparent_60%)] p-9 md:p-12">
          <Image
            src="/logo-padma.png"
            alt="PADMA"
            width={72}
            height={72}
            className="mb-6 h-16 w-16"
            priority
          />
          <h2 className="font-serif text-[30px] leading-tight text-gold-pale">{judul}</h2>
          <p className="mt-3 max-w-[24em] text-sm text-[#A9BBAA]">{kalimat}</p>
        </div>
        <div className="p-8 md:p-11">{children}</div>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Rombak /masuk dan pindahkan /akun-belum-terhubung ke panggung**

Di `web/src/app/masuk/page.tsx`, bungkus `<FormMasuk />` dengan `<PanggungAuth judul="Passport Anda menunggu." kalimat="Riwayat sesi, catatan bidan, materi panduan, dan progres paket Anda — semua di satu tempat yang aman." >`.

Pertahankan `export const metadata = { title: "Masuk" }` — `tests/identitas-aplikasi.test.ts` mengasersikan bentuk persis itu.

Di `web/src/app/masuk/form-masuk.tsx`, tambahkan **tanpa mengubah** teks `<span>` label yang sudah ada:

```tsx
<div className="text-right -mt-2">
  <a href="/lupa-sandi" className="text-[12.5px] font-semibold text-leaf underline">
    Lupa kata sandi?
  </a>
</div>
```

dan di bawah tombol Google:

```tsx
<p className="text-center text-[13px] text-ink-soft">
  Belum punya akun?{" "}
  <a href="/daftar" className="font-semibold text-leaf underline">Daftar</a>
</p>
```

Ubah `web/src/app/akun-belum-terhubung/page.tsx` agar memakai panggung yang sama dengan judul "Satu langkah lagi." — isinya tidak berubah.

**Mode demo dari prototipe TIDAK dibawa.** Ia alat presentasi, bukan fitur produk.

- [ ] **Step 5: Buat favicon**

Buat `web/src/app/icon.svg` berisi jalur teratai yang **sama persis** dengan `web/src/app/_landing/lotus.tsx`, dengan `stroke="#D9B36A"` dan `fill="none"`, `viewBox="0 0 64 46"`.

PNG logo **tidak** dipakai sebagai favicon: cincin teksnya ("PREMIUM WOMEN'S WELLNESS HOMECARE") jadi bubur di 32px, dan yang terbaca di ukuran itu hanya teratainya. Tulis alasan itu sebagai komentar `<!-- -->` di dalam SVG supaya tidak "diperbaiki" orang berikutnya.

- [ ] **Step 6: Jalankan, pastikan HIJAU**

```bash
cd web && npx vitest run tests/panggung-auth.test.tsx tests/identitas-aplikasi.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add web/src/app/_auth web/src/app/icon.svg web/src/app/masuk web/src/app/akun-belum-terhubung web/tests/panggung-auth.test.tsx
git commit -m "feat(auth): panggung split-screen, logo klien, favicon teratai"
```

---

### Task 2: Validator pendaftaran dan halaman /daftar

**Files:**
- Create: `web/src/lib/auth/daftar.ts`, `web/src/app/daftar/page.tsx`, `web/src/app/daftar/form-daftar.tsx`
- Test: `web/tests/daftar-validator.test.ts` (baru)

**Interfaces:**
- Consumes: `PanggungAuth` dari Task 1.
- Produces: `periksaPendaftaran(input: { nama: string; email: string; noHp: string; sandi: string }): { ok: true; nilai: { nama: string; email: string; noHp: string } } | { ok: false; pesan: string }` dari `@/lib/auth/daftar` — dipakai Task 3 untuk membaca `user_metadata`.
- Produces: `PANJANG_SANDI_MIN = 8`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `web/tests/daftar-validator.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { periksaPendaftaran, PANJANG_SANDI_MIN } from "@/lib/auth/daftar";

const sah = { nama: "Ananda Putri", email: "Ananda@Email.com ", noHp: "0812-3456-7890", sandi: "rahasia123" };

describe("validator pendaftaran", () => {
  it("menormalkan email menjadi huruf kecil tanpa spasi", () => {
    const h = periksaPendaftaran(sah);
    expect(h.ok && h.nilai.email).toBe("ananda@email.com");
  });

  it("menolak sandi lebih pendek dari batas", () => {
    const h = periksaPendaftaran({ ...sah, sandi: "a".repeat(PANJANG_SANDI_MIN - 1) });
    expect(h.ok).toBe(false);
  });

  it("menolak nama kosong", () => {
    expect(periksaPendaftaran({ ...sah, nama: "   " }).ok).toBe(false);
  });

  it("membatasi panjang nama supaya metadata tidak jadi tempat menitipkan teks", () => {
    expect(periksaPendaftaran({ ...sah, nama: "x".repeat(300) }).ok).toBe(false);
  });

  it("menolak email tanpa bentuk alamat", () => {
    expect(periksaPendaftaran({ ...sah, email: "bukan-email" }).ok).toBe(false);
  });

  it("TIDAK meminta fase — fase datang dari skrining, bukan dari pendaftaran", () => {
    expect(periksaPendaftaran(sah).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

```bash
cd web && npx vitest run tests/daftar-validator.test.ts
```

- [ ] **Step 3: Tulis validator murni**

Buat `web/src/lib/auth/daftar.ts`. Berkas ini **tanpa I/O** supaya bisa diuji langsung — pola yang sama dengan `src/app/admin/sesi/status.ts`. Pakai `normalizeEmail` yang sudah ada dari `@/lib/auth/link-client`.

`PANJANG_SANDI_MIN = 8`; alasannya ditulis sebagai komentar: enam terlalu pendek untuk akun yang memegang catatan medis, dan sejak pendaftaran mandiri hidup, sandi bukan lagi barang yang hanya dipegang admin.

Batasi nama pada 120 karakter dan normalkan `noHp` dengan membuang selain digit dan `+`.

- [ ] **Step 4: Buat halaman /daftar**

`web/src/app/daftar/page.tsx` memakai `PanggungAuth` dengan judul "Mulai perjalanan Anda." dan kalimat "Buat akun untuk melihat riwayat sesi, materi panduan, dan mengatur jadwal Anda sendiri."

`form-daftar.tsx` adalah komponen klien dengan medan **nama, email, no. WhatsApp, kata sandi** (tanpa fase) plus tombol Google, memanggil:

```ts
const { error } = await supabase.auth.signUp({
  email: nilai.email,
  password: sandi,
  options: {
    emailRedirectTo: `${window.location.origin}/auth/callback`,
    // Nama mengalir ke profiles.nama lewat trigger handle_new_user yang sudah
    // ada; no_hp dibaca gerbang pastikanKlien saat menerbitkan baris klien.
    data: { full_name: nilai.nama, no_hp: nilai.noHp },
  },
});
```

Setelah berhasil, arahkan ke `/periksa-email` (dibuat Task 3). Bila `error`, tampilkan **satu kalimat yang sama** untuk semua kegagalan pendaftaran — pesan yang membedakan "email sudah terdaftar" dari "email belum terdaftar" mengubah halaman ini menjadi alat menebak siapa saja klien PADMA.

- [ ] **Step 5: Jalankan, pastikan HIJAU**

```bash
cd web && npx vitest run tests/daftar-validator.test.ts tests/panggung-auth.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/auth/daftar.ts web/src/app/daftar web/tests/daftar-validator.test.ts
git commit -m "feat(auth): halaman daftar dan validator pendaftaran"
```

---

### Task 3: Gerbang `pastikanKlien` — inti keamanan tahap ini

**Files:**
- Create: `web/src/lib/auth/pastikan-klien.ts`, `web/src/app/periksa-email/page.tsx`
- Modify: `web/src/lib/auth/link-client.ts` (TAMBAH dua fungsi; isi lama tidak disentuh), `web/src/app/setelah-masuk/route.ts`
- Create migration: `web/supabase/migrations/<stamp>_fase_klien_boleh_kosong.sql`
- Test: `web/tests/penautan-email-terverifikasi.test.ts` (baru)

**Interfaces:**
- Consumes: `periksaPendaftaran` dari Task 2; `linkClientByInvite`, `isClientLinked`, `normalizeEmail`, `COOKIE_UNDANGAN` yang sudah ada.
- Produces: `pastikanKlien(user: User, tokenUndangan: string): Promise<"/passport" | "/akun-belum-terhubung" | "/periksa-email">`
- Produces: `tautkanKlienLewatEmailTerverifikasi(user: User): Promise<boolean>`
- Produces: `terbitkanKlienMandiri(user: User): Promise<boolean>`

- [ ] **Step 1: Tulis test yang gagal**

Buat `web/tests/penautan-email-terverifikasi.test.ts` mengikuti pola `tests/penautan-undangan.test.ts` (baca berkas itu untuk cara membuat user uji lewat service role). Empat perkara yang **harus** benar:

```ts
describe("penautan lewat email terverifikasi", () => {
  it("email BELUM terverifikasi tidak menautkan apa pun, walau ada baris klien beremail sama", async () => {
    // Ini pintu yang menjaga seluruh keputusan K1. Bila test ini hijau karena
    // alasan yang salah (mis. barisnya memang tidak ada), ia tidak menjaga apa pun.
  });

  it("baris klien yang sudah dimiliki orang lain TIDAK bisa direbut", async () => {});

  it("email terverifikasi + baris klien belum tertaut -> tertaut", async () => {});

  it("email terverifikasi + tidak ada baris klien -> baris baru lahir dengan user_id terisi", async () => {
    // Dan phase_id-nya NULL: fase datang dari skrining, bukan dari pendaftaran.
  });
});
```

Isi setiap `it` dengan pembuatan fixture memakai `createAdminSupabase()` dan `auth.admin.createUser({ email, email_confirm: true | false })`, lalu panggil fungsi yang diuji langsung. Bersihkan barisnya di `afterEach`.

- [ ] **Step 2: Jalankan, pastikan MERAH**

```bash
cd web && npx vitest run tests/penautan-email-terverifikasi.test.ts
```

- [ ] **Step 3: Migrasi fase nullable**

Buat migrasi yang menjalankan `alter table public.clients alter column phase_id drop not null;` dengan komentar yang menjelaskan: fase kini datang dari skrining pertama yang tersambung, dan menanyakannya saat mendaftar berarti menyimpan dua jawaban yang bisa berbeda.

- [ ] **Step 4: Tambahkan dua fungsi ke `link-client.ts`**

`tautkanKlienLewatEmailTerverifikasi(user: User)` — memeriksa `user.email_confirmed_at` **di dalam dirinya sendiri**:

```ts
/**
 * Menautkan akun ke baris klien yang emailnya sama — HANYA bila email itu
 * sudah TERBUKTI milik penggunanya.
 *
 * Ini pembalikan sadar atas catatan di kepala berkas ini, dan alasannya harus
 * ikut terbaca: dulu "email cocok" ditolak karena email TIDAK PERNAH
 * dibuktikan — `enable_confirmations = false` membuat GoTrue meng-auto-confirm
 * setiap pendaftaran mandiri, sehingga menebak alamat email klien sudah cukup
 * untuk dianggap pemiliknya. Sejak 28 Agustus 2026 setelan itu menyala. Yang
 * berubah bukan pendapat, melainkan fakta.
 *
 * Fungsi ini menerima objek User utuh dan memeriksa `email_confirmed_at`
 * sendiri. Ia TIDAK boleh diubah menjadi menerima string email: bentuk itu
 * adalah `linkClientByEmail` yang dulu dihapus, dan selama fungsi seperti itu
 * ada, celahnya bisa kambuh hanya dengan satu pemanggilan dari rute baru.
 */
export async function tautkanKlienLewatEmailTerverifikasi(user: User): Promise<boolean> {
  if (!user?.id || !user.email || !user.email_confirmed_at) return false;
  // ... .eq("email", normalizeEmail(user.email)).is("user_id", null)
  // UPDATE dengan .is("user_id", null) diulang di dalam pernyataan tulisnya,
  // supaya tidak ada celah antara pemeriksaan dan penulisan.
}
```

`terbitkanKlienMandiri(user: User)` — memakai ulang pola percobaan-ulang PADMA ID dari `src/app/admin/klien/aksi.ts` (baris `for (let percobaan = 0; percobaan < PERCOBAAN_ID; percobaan++)`), dengan `phase_id: null`, `nama` dan `no_hp` dari `user.user_metadata`, dan penanganan 23505 yang sama: bentrok email berarti "ada yang mendahului" → pemanggil mengulang dari langkah 1; bentrok `padma_id` → coba nomor berikutnya.

- [ ] **Step 5: Tulis gerbang**

Buat `web/src/lib/auth/pastikan-klien.ts` dengan urutan keputusan **tetap** dan komentar yang menyebut bahwa urutannya tidak boleh ditukar:

```ts
export async function pastikanKlien(user: User, tokenUndangan: string) {
  if (await isClientLinked(user.id)) return "/passport";
  if (tokenUndangan && (await linkClientByInvite(user.id, user.email ?? "", tokenUndangan)))
    return "/passport";
  // Langkah 5 dinaikkan ke sini: ia yang MENJAGA dua langkah di bawahnya.
  if (!user.email_confirmed_at) return "/periksa-email";
  if (await tautkanKlienLewatEmailTerverifikasi(user)) return "/passport";
  if (await terbitkanKlienMandiri(user)) return "/passport";
  // Kalah balapan: baris klien lahir/tertaut oleh permintaan lain sepersekian
  // detik lalu. Periksa sekali lagi sebelum menyerah.
  return (await isClientLinked(user.id)) ? "/passport" : "/akun-belum-terhubung";
}
```

Ubah `web/src/app/setelah-masuk/route.ts` agar memanggil gerbang ini menggantikan blok penautannya, tanpa menyentuh cabang `owner`/`admin` di atasnya. Cookie undangan tetap dibuang apa pun hasilnya.

Buat `web/src/app/periksa-email/page.tsx` memakai `PanggungAuth`, berisi instruksi dan tombol kirim ulang (`supabase.auth.resend({ type: "signup", email })`).

- [ ] **Step 6: Jalankan, pastikan HIJAU**

```bash
cd web && npx vitest run tests/penautan-email-terverifikasi.test.ts tests/penautan-undangan.test.ts tests/link-client.test.ts tests/link-client-injeksi.test.ts
```

Keempatnya harus lulus. Tiga yang terakhir menjaga jalur undangan lama — bila salah satunya merah, Anda menyentuh kode yang seharusnya tidak disentuh.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/auth web/src/app/setelah-masuk web/src/app/periksa-email web/supabase/migrations web/tests/penautan-email-terverifikasi.test.ts
git commit -m "feat(auth): gerbang pastikanKlien dan penautan lewat email terverifikasi"
```

---

### Task 4: Lupa sandi, atur sandi, dan tujuan redirect berdaftar putih

**Files:**
- Create: `web/src/lib/auth/tujuan-aman.ts`, `web/src/app/lupa-sandi/page.tsx`, `web/src/app/atur-sandi/page.tsx`
- Modify: `web/src/app/auth/callback/route.ts`
- Test: `web/tests/tujuan-aman.test.ts` (baru)

**Interfaces:**
- Consumes: `PanggungAuth` dari Task 1; `PANJANG_SANDI_MIN` dari Task 2.
- Produces: `tujuanAman(next: string | null): string` dari `@/lib/auth/tujuan-aman`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `web/tests/tujuan-aman.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tujuanAman } from "@/lib/auth/tujuan-aman";

describe("tujuanAman", () => {
  it("meloloskan tujuan yang ada di daftar putih", () => {
    expect(tujuanAman("/atur-sandi")).toBe("/atur-sandi");
  });

  it("menolak host luar dalam segala bentuknya", () => {
    for (const jahat of [
      "https://jahat.com",
      "//jahat.com",
      "/\\jahat.com",
      "http:/\\jahat.com",
      "https://padma.test.jahat.com",
    ]) {
      expect(tujuanAman(jahat)).toBe("/setelah-masuk");
    }
  });

  it("menolak rute internal yang TIDAK di daftar putih", () => {
    // Daftar putih, bukan daftar hitam: rute internal mana pun yang tidak
    // disebut ikut ditolak, termasuk yang belum lahir saat ini ditulis.
    expect(tujuanAman("/admin")).toBe("/setelah-masuk");
  });

  it("menolak kosong dan null", () => {
    expect(tujuanAman(null)).toBe("/setelah-masuk");
    expect(tujuanAman("")).toBe("/setelah-masuk");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

```bash
cd web && npx vitest run tests/tujuan-aman.test.ts
```

- [ ] **Step 3: Tulis daftar putih**

`web/src/lib/auth/tujuan-aman.ts` — **daftar putih literal**, bukan pemeriksaan pola:

```ts
/**
 * Tujuan redirect sesudah pertukaran kode di /auth/callback.
 *
 * Daftar PUTIH, bukan daftar hitam. Parameter tujuan yang diterima mentah
 * adalah open redirect: penyerang mengirim tautan reset yang sah ke korban,
 * lalu mendaratkannya di situs tiruan. Memfilter "yang berbahaya" selalu
 * ketinggalan satu bentuk penulisan (`//`, `/\`, `http:/\`); membolehkan
 * "yang disebut" tidak bisa ketinggalan apa pun.
 */
const DIIZINKAN = new Set(["/atur-sandi", "/setelah-masuk"]);
export const TUJUAN_BAKU = "/setelah-masuk";

export function tujuanAman(next: string | null): string {
  return next && DIIZINKAN.has(next) ? next : TUJUAN_BAKU;
}
```

- [ ] **Step 4: Sambungkan ke callback dan buat dua halaman**

Di `web/src/app/auth/callback/route.ts`, baca `next` dari query dan pakai `tujuanAman(next)` sebagai tujuan redirect menggantikan `/setelah-masuk` yang ditulis keras.

`web/src/app/lupa-sandi/page.tsx` memakai `PanggungAuth` (judul "Tenang, ini bisa dipulihkan.") dan memanggil:

```ts
await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${window.location.origin}/auth/callback?next=/atur-sandi`,
});
```

Balasannya **selalu kalimat yang sama** — "Bila email itu terdaftar, tautan pemulihan sudah kami kirim." — entah emailnya ada atau tidak. Balasan yang membedakan keduanya mengubah halaman ini menjadi alat menebak siapa saja klien PADMA. Tulis alasan itu sebagai komentar.

`web/src/app/atur-sandi/page.tsx` meminta sandi baru dua kali, menolak yang lebih pendek dari `PANJANG_SANDI_MIN`, lalu `supabase.auth.updateUser({ password })` dan mengarahkan ke `/setelah-masuk`.

- [ ] **Step 5: Jalankan, pastikan HIJAU**

```bash
cd web && npx vitest run tests/tujuan-aman.test.ts tests/panggung-auth.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/auth/tujuan-aman.ts web/src/app/lupa-sandi web/src/app/atur-sandi web/src/app/auth/callback web/tests/tujuan-aman.test.ts
git commit -m "feat(auth): lupa sandi, atur sandi, dan daftar putih tujuan redirect"
```

---

### Task 5: Pagar setelan, inventaris rute, dan pelengkap bentrok email

**Files:**
- Modify: `web/supabase/config.toml` (`minimum_password_length`)
- Modify: `web/README.md` (tabel rute)
- Modify: `web/src/app/admin/klien/aksi.ts` (kalimat bentrok email)
- Test: `web/tests/konfirmasi-email-wajib.test.ts` (baru)

**Interfaces:**
- Consumes: `PANJANG_SANDI_MIN` dari Task 2.

- [ ] **Step 1: Tulis test yang gagal**

Buat `web/tests/konfirmasi-email-wajib.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PANJANG_SANDI_MIN } from "@/lib/auth/daftar";

const config = readFileSync(path.resolve(__dirname, "..", "supabase", "config.toml"), "utf8");

/**
 * PAGAR FAIL-CLOSED atas setelan yang MENOPANG keputusan K1.
 *
 * Penautan lewat email terverifikasi sah HANYA KARENA konfirmasi email
 * menyala. Setelan yang menopang keputusan keamanan tetapi tidak dijaga test
 * adalah setelan yang suatu hari dimatikan "sebentar, untuk mempermudah
 * pengujian" lalu tidak pernah dinyalakan lagi — dan tidak ada satu pun test
 * yang memberi tahu.
 */
describe("setelan yang menopang keamanan penautan", () => {
  it("konfirmasi email WAJIB menyala", () => {
    expect(config).toMatch(/^enable_confirmations = true$/m);
  });

  it("panjang sandi minimum di config tidak lebih longgar daripada validator", () => {
    const cocok = config.match(/^minimum_password_length = (\d+)$/m);
    expect(cocok).not.toBeNull();
    expect(Number(cocok![1])).toBeGreaterThanOrEqual(PANJANG_SANDI_MIN);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

```bash
cd web && npx vitest run tests/konfirmasi-email-wajib.test.ts
```

Diharapkan: perkara kedua GAGAL — `minimum_password_length` masih 6.

- [ ] **Step 3: Naikkan setelan dan perbarui README**

Ubah `minimum_password_length = 6` menjadi `8` di `web/supabase/config.toml`, dengan komentar alasannya.

Tambahkan lima rute baru ke tabel rute `web/README.md`: `/daftar`, `/lupa-sandi`, `/atur-sandi`, `/periksa-email`, dan `/auth/callback` bila belum terdaftar. `tests/inventaris-rute.test.ts` menjaga tabel itu **dua arah** — rute yang ada tapi tak terdaftar, dan baris yang terdaftar tapi rutenya tak ada, sama-sama memerahkan.

- [ ] **Step 4: Lengkapi kalimat bentrok email di panel admin**

`web/src/app/admin/klien/aksi.ts` sudah menjawab bentrok email dengan "Alamat itu sudah dipakai klien lain." Sejak pendaftaran mandiri hidup, penyebab yang paling mungkin berubah: orangnya sudah membuat akun sendiri. Ubah kalimatnya menjadi menyebut kemungkinan itu dan mengarahkan admin membuka data yang sudah ada, mis. "Alamat itu sudah terdaftar — kemungkinan klien ini sudah membuat akun sendiri. Buka datanya lewat pencarian di daftar klien."

Tidak ada penggabungan otomatis. Admin melihat datanya lalu memutuskan sendiri.

- [ ] **Step 5: Jalankan seluruh suite**

Koordinasikan lebih dulu — Supabase lokal dipakai bersama.

```bash
cd web && npm test
```

Setelah mengubah `config.toml`, stack lokal perlu dimuat ulang agar env container GoTrue ikut berubah:

```bash
cd web && npx supabase stop && npx supabase start
```

- [ ] **Step 6: Commit**

```bash
git add web/supabase/config.toml web/README.md web/src/app/admin/klien/aksi.ts web/tests/konfirmasi-email-wajib.test.ts
git commit -m "feat(auth): pagar konfirmasi email, sandi minimum 8, inventaris rute"
```

## Catatan untuk yang mengerjakan

**Satu hal yang membuat tahap ini gagal secara diam-diam:** memindahkan pemeriksaan `email_confirmed_at` keluar dari fungsi penaut, mis. karena pemanggilnya "sudah memeriksanya". Begitu pemeriksaan itu jadi tanggung jawab pemanggil, rute berikutnya yang lupa memeriksanya membuka kembali celah yang butuh dua kali perbaikan untuk ditutup. Pemeriksaan tinggal di dalam fungsinya, walau terasa mengulang.

**Yang tidak bisa diuji otomatis di tahap ini:** email konfirmasi benar-benar terkirim dan tautannya bekerja. Itu menuntut membaca kotak surat lokal. Jalankan sekali secara manual sebelum menyatakan tahap ini selesai, dan catat hasilnya di runbook.

**Prasyarat produksi yang tidak boleh lupa** (bukan bagian tahap ini, tetapi tanpanya pendaftaran mati di hari pertama live): SMTP sendiri, `site_url` dan `additional_redirect_urls` berisi domain produksi, provider Google dinyalakan, dan `[auth.rate_limit] email_sent` dinaikkan dari 2.
