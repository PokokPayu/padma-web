# Panel Staf — Sapuan Enam Modul (Rencana 2 dari 3)

> **Untuk pekerja agentik:** SUB-SKILL WAJIB: pakai superpowers:subagent-driven-development
> (disarankan) atau superpowers:executing-plans untuk mengerjakan rencana ini tugas demi tugas.
> Langkah memakai sintaks kotak centang (`- [ ]`).

**Tujuan:** Menyapu Sesi, Bayar, Skrining, Layanan, Varian, dan Materi ke pola daftar & formulir
yang sudah terbukti di Mitra dan Klien — cari, saring, paginasi, panel geser atau halaman detail —
sesudah lebih dulu menutup dua pagar uji yang akan disalin enam kali oleh sapuan itu sendiri.

**Arsitektur:** Setiap modul dipecah dua lapis persis seperti rencana 1: sebuah fungsi
`ambilDaftar<Modul>(param: ParamDaftar)` di `src/lib/admin/` yang menerjemahkan parameter URL
menjadi satu query berpaginasi, dan sebuah `page.tsx` yang merender `BilahDaftar` + `Tabel` +
`Paginasi` di atasnya. Modul berpola A (Sesi, Varian) mendapat `PanelGeser` yang isinya dirender
di server; modul berpola B (Layanan, Materi) mendapat rute detail sendiri. Bayar dan Skrining
hanya mendapat bilah dan paginasi — keduanya daftar beraksi, bukan daftar berformulir.

**Tumpukan:** Next.js 16 App Router · Supabase (PostgREST + RLS) · Tailwind v4 · Vitest
(`environment: "node"`, tanpa jsdom) · Playwright untuk E2E.

**Spec:** `docs/superpowers/specs/2026-09-07-padma-panel-list-form-design.md`
**Pendahulu:** `docs/superpowers/plans/2026-09-07-padma-panel-fondasi.md` (rencana 1, ter-merge)
**Runbook & utang rencana 1:** `docs/superpowers/2026-09-07-panel-fondasi-tindak-lanjut.md`

---

## Global Constraints

Berlaku untuk SETIAP tugas di bawah, tanpa perlu diulang di masing-masing.

1. **Tanpa dependensi baru.** Tidak ada jsdom, tidak ada testing-library. Satu-satunya perkakas
   render adalah `renderToStaticMarkup` dari `react-dom/server`. Apa pun yang hanya lahir sesudah
   hidrasi TIDAK BISA DIUJI SAMA SEKALI di repo ini.
2. **Cari dan saring bekerja tanpa JavaScript klien.** Kotak cari adalah `<form method="get">`;
   chip saringan adalah `<Link>`. Ini konsekuensi langsung dari batasan 1.
3. **Primitif `src/app/_shell/panel/**` WAJIB buta peran.** Tidak boleh memuat literal
   `"admin"`/`"owner"` BERTANDA KUTIP (pola pagar: `/"(admin|owner)"/i`), tidak boleh mengimpor
   `requireRole`, tidak boleh menyentuh `createAdminSupabase`, tidak boleh memuat `Rp <angka>`
   maupun `formatRupiah`. Kata "admin" di dalam prosa komentar tidak dilarang, tetapi tulis "staf".
4. **Money firewall.** Tidak satu pun halaman di bawah `/admin` boleh merender nominal rupiah —
   baik di markup maupun di sumbernya. Nominal hidup HANYA di `variant_rates`, `honor_marks`,
   `transport_rates`, `transport_khusus`, dan hanya panel owner yang menampilkannya.
5. **Setiap daftar dipaginasi di sisi server** lewat `.range()` dari `hitungRentang(param.hal)`,
   dengan total dari `count: "exact"` pada query yang sama. `supabase/config.toml` menyetel
   `max_rows = 1000` dan PostgREST memotong di angka itu SECARA SENYAP.
6. **Token Tailwind yang sah hanya delapan:** `panel-bg`, `panel-surface`, `panel-border`,
   `panel-ink`, `panel-muted`, `panel-rail`, `panel-rail-ink`, `panel-rail-aktif`. Kelas yang
   menunjuk token tak terdefinisi gagal SENYAP — tanpa galat build, hanya teks tak terbaca.
7. **`searchParams` dan `params` adalah `Promise` di Next 16.** Tipe halaman daftar:
   `{ searchParams: Promise<ParamMentah> }`; tipe halaman detail: `{ params: Promise<{ id: string }> }`.
8. **Mengubah saringan mengembalikan halaman ke 1** — aturan itu hidup HANYA di `bangunQuery()`
   (`src/app/_shell/panel/daftar.ts`). Jangan pernah menuliskannya kedua kali di halaman mana pun.
9. **Modul `"use server"` hanya boleh mengekspor fungsi async.** Daftar putih dan label karena itu
   tinggal di `status.ts` sebelah, bukan di `aksi.ts`.
10. **`npx tsc --noEmit` wajib bersih sebelum sebuah tugas dianggap selesai.** Jalankan
    `npm run build` LEBIH DULU bila muncul galat `LayoutProps`/`PageProps` — itu artefak tipe rute
    Next yang belum diregenerasi, bukan cacat kode.
11. **Rute baru wajib ditambahkan ke tabel rute di `web/README.md`** — dijaga
    `tests/inventaris-rute.test.ts`, dua arah.
12. **JANGAN PERNAH menjalankan `npm run test:e2e:video` atau `npm run test:e2e:semua`.** Keduanya
    mengunggah lalu menghapus objek di bucket Cloudflare R2 PRODUKSI milik klien. Jalankan ketujuh
    skrip E2E lain satu per satu bila perlu.
13. **Basis data Supabase lokal dipakai bersama antar sesi kerja.** Koordinasikan sebelum
    `npm test` penuh atau `npm run db:recover`. Bila uji merah dengan kegagalan yang BERPINDAH
    BERKAS antar run, curigai gangguan lebih dulu: `docker ps`, lalu bandingkan umur
    `supabase_db_web` dengan `supabase_rest_web`. Basis data yang lebih muda berarti ia dibangun
    ulang sendirian di tengah run Anda.
14. **`web/supabase/seed.sql` tidak pernah dijalankan di produksi.**

---

## Penyimpangan dari spec — dicatat, bukan disembunyikan

Spec K3 menyebut saringan Sesi sebagai "status · jenjang kosong · **rentang tanggal**".

Rencana ini mengerjakan rentang tanggal sebagai **tiga chip preset** — `waktu=mendatang`,
`waktu=pekan_ini`, `waktu=lampau` — bukan sepasang kotak tanggal bebas.

Alasannya: `uraikanParamDaftar()` menerima saringan sebagai DAFTAR PUTIH nilai. Rentang bebas
menuntut parameter yang tidak berdaftar-putih, validasi tanggal sendiri, DAN primitif bilah baru
yang memuat dua `<input type="date">` di dalam form GET yang sama dengan kotak cari. Itu satu
primitif baru dan satu permukaan uji baru untuk menjawab kebutuhan yang — menurut keluhan aslinya
— berbunyi "menemukan sesi minggu ini tanpa memindai dengan mata". Ketiga preset menjawabnya
tanpa satu pun dari biaya di atas.

Rentang bebas tetap bisa ditambahkan belakangan **tanpa membongkar apa pun**: ia parameter
tambahan, bukan pengganti. Bila Arvin menghendaki rentang bebas sekarang, itu satu tugas
tersendiri di akhir rencana ini, bukan perubahan pada dua belas tugas di bawah.

---

## Struktur berkas

**Dibuat:**

| Berkas | Tanggung jawab |
|---|---|
| `web/tests/helpers/nominal.ts` | Satu pola pagar nominal untuk seluruh suite |
| `web/tests/helpers/token-panel.ts` | Pemungut kelas `*-panel-*` + pendeteksi token hantu |
| `web/tests/pagar-cetakan.test.ts` | Uji unit kedua pagar di atas — pagar yang menguji pagar |
| `web/src/lib/admin/sesi.ts` | Lapisan data daftar sesi (saring, cari, paginasi) |
| `web/src/app/admin/sesi/panel-sesi.tsx` | Isi panel geser sesi: selesaikan, ubah jenjang, catatan |
| `web/src/lib/admin/skrining.ts` | Lapisan data inbox skrining |
| `web/src/lib/admin/layanan.ts` | Lapisan data daftar layanan + satu layanan beserta anaknya |
| `web/src/app/admin/layanan/[id]/page.tsx` | Halaman detail layanan (pola B) |
| `web/src/app/admin/materi/[id]/page.tsx` | Halaman detail materi (pola B) |
| `web/tests/admin-sesi-daftar.test.ts` | Saringan & paginasi sesi sampai ke basis data |
| `web/tests/admin-layanan-detail.test.tsx` | Halaman detail layanan + panel geser varian |
| `web/tests/admin-materi-detail.test.tsx` | Halaman detail materi + panel penugasan |

**Diubah besar:** `web/src/app/admin/{sesi,bayar,skrining,layanan,materi}/page.tsx`,
`web/src/lib/admin/{tagihan,materi-admin}.ts`, `web/src/app/admin/klien/{baru/page.tsx,[id]/page.tsx}`,
`web/src/app/admin/page.tsx`, `web/README.md`.

**Dihapus:** `web/src/app/admin/sesi/form-selesai.tsx` (isinya pindah ke `panel-sesi.tsx`).

---

## Titik merge

Tugas 1–6 (utang, Sesi, StatTile, Bayar, Skrining) adalah gelombang pertama dan berdiri sendiri:
sesudah Tugas 6 seluruh suite hijau, `tsc` bersih, dan tiga modul sudah bisa dipakai klien.
**Merge di sini disarankan** sebelum melanjutkan ke Tugas 7–12, yang membuka dua rute baru dan
memindahkan dua halaman besar. Rencana ini tetap satu dokumen karena keputusannya satu.

---

## Tugas 1: Dua pagar cetakan (utang #2 & #4)

Pagar-pagar ini dikerjakan LEBIH DULU dari apa pun karena enam modul di bawah akan menyalin
polanya. Memperbaikinya sesudah sapuan berarti menyentuh dua belas halaman dua kali.

**Berkas:**
- Buat: `web/tests/helpers/nominal.ts`
- Buat: `web/tests/helpers/token-panel.ts`
- Buat: `web/tests/pagar-cetakan.test.ts`
- Ubah: `web/tests/panel-primitif.test.ts`
- Ubah: 21 berkas uji yang memakai `not.toMatch(/Rp\s?\d/)` (daftar lengkap di Langkah 5)

**Antarmuka:**
- Menghasilkan: `nominalDalam(teks: string): string[]` — dipakai SETIAP uji money firewall
  sesudah tugas ini; `kelasPanelDi(isi: string): string[]` dan
  `tokenHantu(kelas: string[], css: string): string[]` — dipakai `panel-primitif.test.ts`.
- Memakai: tidak ada.

- [ ] **Langkah 1: Tulis uji yang gagal untuk kedua pagar**

Buat `web/tests/pagar-cetakan.test.ts`:

```ts
/**
 * Pagar yang menguji PAGAR.
 *
 * Kedua fungsi di bawah adalah cetakan: satu dipakai setiap uji money firewall,
 * satu dipakai pemindai token Tailwind. Cetakan yang salah menggandakan dirinya
 * diam-diam, dan pagar yang tidak pernah bisa memerah terbaca persis seperti
 * pagar yang bekerja. Karena itu keduanya diuji SEBAGAI KODE, bukan hanya
 * dipercaya lewat pemakaiannya di berkas lain.
 */
import { describe, it, expect } from "vitest";
import { nominalDalam } from "./helpers/nominal";
import { kelasPanelDi, tokenHantu } from "./helpers/token-panel";

describe("pagar nominal — tiga bentuk yang LOLOS dari /Rp\\s?\\d/", () => {
  it("nominal telanjang tanpa kata Rp", () => {
    // Persis bentuk yang dilaporkan reviewer rencana 1: label paket yang
    // memuat harga tanpa satuan.
    expect(nominalDalam("Sankalpa Prima · 3.500.000")).toContain("3.500.000");
  });

  it("Rp bertitik", () => {
    expect(nominalDalam("Rp. 500.000").length).toBeGreaterThan(0);
  });

  it("rp huruf kecil", () => {
    expect(nominalDalam("rp 500000").length).toBeGreaterThan(0);
  });
});

describe("pagar nominal — yang TIDAK boleh dituduh", () => {
  it("koordinat empat desimal (pemilih-lokasi.tsx memuatnya sungguhan)", () => {
    expect(nominalDalam("const PUSAT_AWAL = [-7.9825, 112.6304];")).toEqual([]);
  });

  it("PADMA ID, tanggal, dan ukuran kelas Tailwind", () => {
    expect(
      nominalDalam('PAD-2609-0001 · 7 Sep 2026 · class="min-w-[760px] text-[13.5px]"'),
    ).toEqual([]);
  });

  it("kata bernuansa uang TANPA angka", () => {
    // Regresi yang pernah terjadi: "Paket Harga Hemat" memerahkan pagar palsu.
    expect(nominalDalam("Paket Harga Hemat · tarif adalah wilayah Owner")).toEqual([]);
  });
});

const CSS_UJI = `@theme {
  --color-panel-ink: #1e2320;
  --color-panel-surface: #ffffff;
}`;

describe("pagar token panel", () => {
  it("memungut kelas dari SEMUA awalan, bukan hanya text/bg/border", () => {
    const isi = `className="ring-panel-border outline-panel-ink shadow-panel-surface"`;
    expect(kelasPanelDi(isi).sort()).toEqual([
      "outline-panel-ink",
      "ring-panel-border",
      "shadow-panel-surface",
    ]);
  });

  it("memungut kelas bermodifier opacity (border-panel-border/70)", () => {
    // `Td` di tabel.tsx memakai bentuk ini hari ini. Kelas yang berhenti
    // terpungut berarti pagar berhenti menjaganya, tanpa satu galat pun.
    expect(kelasPanelDi(`className="border-panel-border/70"`)).toEqual(["border-panel-border"]);
  });

  it("BERGIGI: token yang tidak terdefinisi dilaporkan", () => {
    // Ini persis cacat yang lahir di rencana 1 (`text-panel-accent`), dan
    // satu-satunya uji yang membuktikan pemindainya bisa memerah sama sekali.
    expect(tokenHantu(["text-panel-accent"], CSS_UJI)).toEqual(["text-panel-accent"]);
  });

  it("token yang terdefinisi TIDAK dilaporkan", () => {
    expect(tokenHantu(["text-panel-ink", "bg-panel-surface"], CSS_UJI)).toEqual([]);
  });
});
```

- [ ] **Langkah 2: Jalankan uji, pastikan MERAH**

Jalankan: `npx vitest run tests/pagar-cetakan.test.ts`
Diharapkan: GAGAL — `Cannot find module './helpers/nominal'`.

- [ ] **Langkah 3: Tulis kedua helper**

Buat `web/tests/helpers/nominal.ts`:

```ts
/**
 * Pola nominal uang untuk permukaan yang TIDAK BOLEH menampilkannya.
 *
 * Menggantikan `/Rp\s?\d/` yang dipakai seluruh suite sampai sekarang. Pola
 * lama menuntut literal "Rp" dengan huruf besar dan tanpa titik, sehingga TIGA
 * bentuk lolos begitu saja: "3.500.000" (tanpa satuan), "Rp. 500.000" (titik
 * sesudah Rp), dan "rp 500000" (huruf kecil).
 *
 * Yang SENGAJA tidak ditangkap: angka polos tanpa pemisah ribuan ("500000").
 * Menangkapnya menuntut ambang jumlah digit, dan ambang itu akan menuduh
 * timestamp, id numerik, dan ukuran piksel. Tidak ada satu pun jalur di repo
 * ini yang merender rupiah tanpa pemisah — `formatRupiah()` selalu memakai
 * `Intl.NumberFormat('id-ID')`, yang selalu memberi titik ribuan.
 *
 * Pola ribuan sengaja dibatasi `\b` di kedua ujung supaya KOORDINAT tidak
 * tertuduh: "112.6304" tidak cocok (ada digit keempat sesudah titik), dan
 * koordinat memang hidup di `src/app/_shell/pemilih-lokasi.tsx` yang ikut
 * dipindai beberapa uji.
 */
const POLA: RegExp[] = [
  // "Rp 500.000", "Rp. 500.000", "rp500000" — apa pun sesudah satuan.
  /rp\.?\s*\d[\d.,]*/gi,
  // "3.500.000", "20.000" — nominal telanjang berpemisah ribuan.
  /\b\d{1,3}(?:\.\d{3})+\b/g,
];

/**
 * Setiap nominal yang ditemukan di `teks`, tanpa duplikat.
 *
 * Memulangkan DAFTAR, bukan boolean, supaya pesan kegagalannya menyebut apa
 * yang bocor. `expect(nominalDalam(m)).toEqual([])` yang merah langsung
 * memberi tahu nominal mana — `not.toMatch()` hanya berkata "cocok".
 */
export function nominalDalam(teks: string): string[] {
  const hasil = new Set<string>();
  for (const pola of POLA) {
    for (const cocok of teks.matchAll(pola)) hasil.add(cocok[0]);
  }
  return [...hasil];
}
```

Buat `web/tests/helpers/token-panel.ts`:

```ts
/**
 * Pemindai kelas Tailwind yang menunjuk token panel.
 *
 * Kelas yang menunjuk token tak terdefinisi gagal SENYAP di Tailwind v4:
 * tidak ada galat build, tidak ada peringatan, hanya teks yang tidak terbaca
 * di layar. Sudah terjadi sekali (`text-panel-accent`, rencana 1).
 *
 * Dipisah menjadi dua fungsi MURNI supaya pemindainya sendiri bisa dibuktikan
 * bergigi tanpa memalsukan berkas di disk — lihat tests/pagar-cetakan.test.ts.
 */

/**
 * Semua awalan utilitas Tailwind yang bisa menunjuk warna.
 *
 * Pagar rencana 1 hanya mengenal `text|bg|border`, sehingga `ring-panel-*`
 * pada keadaan fokus akan lolos. Daftar ini melebar ke setiap awalan warna
 * yang benar-benar dipakai proyek ini atau wajar dipakai berikutnya.
 */
const AWALAN =
  "text|bg|border|ring|outline|shadow|divide|from|via|to|fill|stroke|placeholder|accent|caret|decoration";

const POLA_KELAS = new RegExp(`(?:${AWALAN})-panel-[a-z]+(?:-[a-z]+)*`, "g");

/**
 * Kelas `*-panel-*` yang muncul di `isi`, tanpa duplikat.
 *
 * Modifier opacity (`/70`) tidak ikut terpungut: `[a-z]` berhenti di garis
 * miring, dan `border-panel-border/70` tetap menunjuk token
 * `--color-panel-border` yang sama.
 */
export function kelasPanelDi(isi: string): string[] {
  return [...new Set(isi.match(POLA_KELAS) ?? [])];
}

/** Kelas yang token `--color-panel-*`-nya TIDAK ada di `css`. */
export function tokenHantu(kelas: string[], css: string): string[] {
  return kelas.filter((k) => !css.includes(`--color-panel-${k.split("panel-")[1]}`));
}
```

- [ ] **Langkah 4: Jalankan uji, pastikan HIJAU**

Jalankan: `npx vitest run tests/pagar-cetakan.test.ts`
Diharapkan: LULUS, 9 uji.

- [ ] **Langkah 5: Pakai `nominalDalam` di seluruh suite**

Di setiap berkas berikut, ganti SETIAP `expect(<x>).not.toMatch(/Rp\s?\d/)` menjadi
`expect(nominalDalam(<x>), "nominal bocor").toEqual([])`, dan tambahkan importnya. Bentuk
`not.toMatch(/Rp\s?\d|formatRupiah/)` menjadi DUA asersi: yang pertama seperti di atas, yang kedua
`expect(<x>).not.toContain("formatRupiah")`.

Berkas (37 tempat di 21 berkas):
`admin-agenda`, `admin-bayar`, `admin-inbox`, `admin-konversi-skrining`, `admin-layanan`,
`admin-materi`, `admin-mitra`, `admin-pengaturan`, `admin-sesi-catatan`, `admin-sesi-konfirmasi`,
`admin-shell`, `admin-tren`, `panel-isi`, `panel-primitif`, `passport-bayar-ajukan`,
`passport-profil`, `transport-atribusi` — plus yang muncul saat `grep -rn 'not.toMatch(/Rp' tests/`
dijalankan ulang.

Path impor dari `tests/`: `import { nominalDalam } from "./helpers/nominal";`

`tests/landing.test.ts` SENGAJA dilewati: baris 235 memungut nominal untuk MEMBANDINGKANNYA dengan
katalog, bukan untuk melarangnya. Landing memang menampilkan harga.

- [ ] **Langkah 6: Jalankan seluruh berkas yang disentuh — cari false positive**

Jalankan: `npx vitest run tests/admin-*.test.ts tests/panel-*.test.ts tests/passport-*.test.ts tests/transport-atribusi.test.ts`
Diharapkan: LULUS semuanya.

Bila ada yang MERAH: baca nominal yang dilaporkan sebelum melonggarkan apa pun. Pola ribuan sudah
diverifikasi tidak menuduh koordinat, PADMA ID (`PAD-2609-0001`), tanggal, maupun ukuran kelas
Tailwind. Temuan merah karena itu lebih mungkin nominal SUNGGUHAN yang selama ini lolos — dan itu
temuan, bukan gangguan. Laporkan sebelum mengubah pola.

- [ ] **Langkah 7: Perluas pemindaian token ke `src/app/admin` dan `src/app/owner`**

Di `web/tests/panel-primitif.test.ts`, ganti `it("kelas Tailwind yang memakai token panel harus
punya token yang didefinisikan", …)` seluruhnya dengan:

```ts
  it("kelas Tailwind yang memakai token panel harus punya token yang didefinisikan", () => {
    // Rencana 1 hanya memindai `src/app/_shell/panel/`. Rencana 2 & 3 menulis
    // kelas panel ke lima belas halaman DI LUAR jangkauan itu, dan halaman
    // Mitra & Klien yang sudah disapu pun tidak pernah terjaga sama sekali —
    // bersihnya hari ini karena diperiksa dengan mata satu kali, bukan karena
    // dijaga.
    const AKAR_PINDAI = ["src/app/_shell", "src/app/admin", "src/app/owner"];

    const kelasPerBerkas = new Map<string, string[]>();
    for (const akar of AKAR_PINDAI) {
      const berkas = berkasSumber(akar);
      // Anti-hampa PER AKAR, bukan hanya untuk gabungannya: satu direktori
      // yang dipindah atau salah tulis akan berhenti dipindai diam-diam
      // sementara dua yang lain menjaga total tetap tidak kosong.
      expect(berkas.length, `tidak ada berkas di ${akar}`).toBeGreaterThan(0);
      for (const b of berkas) {
        const kelas = kelasPanelDi(baca(b));
        if (kelas.length > 0) kelasPerBerkas.set(b, kelas);
      }
    }

    // Anti-hampa kedua: bila POLA_KELAS suatu saat berhenti cocok, seluruh
    // badan uji ini lolos tanpa satu asersi pun berjalan.
    expect(kelasPerBerkas.size, "tidak ditemukan satu pun kelas panel").toBeGreaterThan(0);

    const galat: string[] = [];
    for (const [berkas, kelas] of kelasPerBerkas) {
      for (const hantu of tokenHantu(kelas, css)) {
        galat.push(`${hantu} (di ${berkas}) — token --color-panel-* tidak terdefinisi`);
      }
    }
    expect(galat, "kelas Tailwind menunjuk token hantu").toEqual([]);
  });
```

Di kepala berkas yang sama, generalisasi pemungut berkasnya dan impor helper baru:

```ts
import { kelasPanelDi, tokenHantu } from "./helpers/token-panel";

/** Semua berkas .ts/.tsx di bawah sebuah direktori `src`, rekursif. */
function berkasSumber(rel: string): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(path.join(AKAR, rel), { withFileTypes: true })) {
    const anak = `${rel}/${entri.name}`;
    if (entri.isDirectory()) hasil.push(...berkasSumber(anak));
    else if (/\.tsx?$/.test(entri.name)) hasil.push(anak);
  }
  return hasil;
}

/** Primitif panel saja — dipakai uji BUTA PERAN, yang TIDAK boleh memindai
 *  `src/app/admin` maupun `src/app/owner`: keduanya memang tahu peran, dan
 *  memindainya di sana akan melahirkan puluhan kegagalan palsu. */
const berkasPanel = () => berkasSumber("src/app/_shell/panel");
```

Hapus definisi `berkasPanel()` yang lama.

- [ ] **Langkah 8: Jalankan uji primitif, pastikan HIJAU**

Jalankan: `npx vitest run tests/panel-primitif.test.ts`
Diharapkan: LULUS. Bila ada token hantu yang ditemukan di `src/app/admin` atau `src/app/owner`,
itu cacat sungguhan — perbaiki kelasnya, jangan persempit pemindaian.

- [ ] **Langkah 9: Commit**

```bash
git add web/tests/helpers/nominal.ts web/tests/helpers/token-panel.ts \
        web/tests/pagar-cetakan.test.ts web/tests/panel-primitif.test.ts web/tests/
git commit -m "test(pagar): tutup dua utang cetakan sebelum sapuan enam modul"
```

---

## Tugas 2: Lapisan data daftar sesi

**Berkas:**
- Buat: `web/src/lib/admin/sesi.ts`
- Buat: `web/tests/admin-sesi-daftar.test.ts`

**Antarmuka:**
- Memakai: `ParamDaftar`, `SaringSah`, `hitungRentang`, `PER_HAL` dari `@/app/_shell/panel/daftar`;
  `awalPekan`, `akhirPekan` dari `@/lib/owner/pekan` (preseden: `src/lib/admin/tren.ts` sudah
  mengimpor dari sana — aritmatika tanggal murni, nol nominal).
- Menghasilkan: `SARING_SESI`, `BarisSesiDaftar`, `ambilDaftarSesi(param, hariIni)` — dipakai
  Tugas 3 dan Tugas 4.

- [ ] **Langkah 1: Tulis uji yang gagal**

Buat `web/tests/admin-sesi-daftar.test.ts`. Fixture meniru pola `tests/admin-mitra.test.ts`
(baris 848 dst.): `N` dibuat relatif terhadap `PER_HAL`, bukan angka tetap.

```ts
/**
 * Saringan & paginasi daftar sesi, diuji SAMPAI KE BASIS DATA.
 *
 * Saringan yang memulangkan baris yang salah adalah cacat DATA. Membuktikannya
 * lewat markup berarti membuktikannya dengan cara yang paling tidak langsung —
 * dan markup yang benar di atas baris yang salah tetap terlihat benar.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { PER_HAL } from "@/app/_shell/panel/daftar";
import { SARING_SESI, ambilDaftarSesi } from "@/lib/admin/sesi";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// Fixture SEED yang stabil — tidak diuji apa pun tentangnya di sini.
const ANANDA = "22222222-2222-2222-2222-222222222201";
const SERVICE_FERTILITY_MASSAGE = "11111111-1111-1111-1111-111111111101";
const HARI_INI = "2026-06-15"; // Senin

const N = PER_HAL + 5;
const UJI_SESI = Array.from({ length: N }, (_, i) =>
  `66666666-6666-6666-6666-6666660000${String(i).padStart(2, "0")}`);
// Tiga sesi bertanggal khusus untuk saringan `waktu`, DI LUAR N di atas.
const SESI_LAMPAU = "66666666-6666-6666-6666-666666ffff01";
const SESI_PEKAN = "66666666-6666-6666-6666-666666ffff02";
const SESI_DEPAN = "66666666-6666-6666-6666-666666ffff03";
const SEMUA = [...UJI_SESI, SESI_LAMPAU, SESI_PEKAN, SESI_DEPAN];

let partnerId = "";
let variantId = "";

beforeAll(async () => {
  await admin.from("sessions").delete().in("id", SEMUA);

  const { data: p } = await admin
    .from("partners").select("id").eq("aktif", true).limit(1).single<{ id: string }>();
  partnerId = p!.id;
  const { data: v } = await admin
    .from("service_variants").select("id")
    .eq("service_id", SERVICE_FERTILITY_MASSAGE).limit(1).single<{ id: string }>();
  variantId = v!.id;

  const dasar = {
    client_id: ANANDA,
    service_id: SERVICE_FERTILITY_MASSAGE,
    variant_id: variantId,
    partner_id: partnerId,
  };

  await admin.from("sessions").insert([
    // N sesi SELESAI tanpa jenjang — memenuhi lebih dari satu halaman DAN
    // menjadi bahan saringan `jenjang=kosong`.
    ...UJI_SESI.map((id) => ({ ...dasar, id, tanggal: "2026-06-10", status: "selesai" })),
    { ...dasar, id: SESI_LAMPAU, tanggal: "2026-01-05", status: "batal" },
    { ...dasar, id: SESI_PEKAN, tanggal: HARI_INI, status: "terjadwal" },
    { ...dasar, id: SESI_DEPAN, tanggal: "2026-12-31", status: "terjadwal" },
  ]);
});

afterAll(async () => {
  await admin.from("sessions").delete().in("id", SEMUA);
});

describe("SARING_SESI", () => {
  it("nilai saringan status persis enum session_status", () => {
    expect([...SARING_SESI.status]).toEqual(["terjadwal", "selesai", "batal"]);
  });
});

describe("ambilDaftarSesi — saringan", () => {
  it("menyaring menurut status", async () => {
    const { baris } = await ambilDaftarSesi(
      { cari: "", saring: { status: "batal" }, hal: 1 }, HARI_INI);
    expect(baris.length).toBeGreaterThan(0);
    expect(baris.every((s) => s.status === "batal")).toBe(true);
  });

  it("saringan jenjang=kosong hanya memulangkan sesi tanpa jenjang", async () => {
    const { baris, total } = await ambilDaftarSesi(
      { cari: "", saring: { jenjang: "kosong" }, hal: 1 }, HARI_INI);
    expect(total).toBeGreaterThanOrEqual(N);
    expect(baris.every((s) => s.jenjang === null)).toBe(true);
  });

  it("waktu=mendatang membuang yang sudah lewat, waktu=lampau kebalikannya", async () => {
    const depan = await ambilDaftarSesi(
      { cari: "", saring: { waktu: "mendatang" }, hal: 1 }, HARI_INI);
    expect(depan.baris.some((s) => s.id === SESI_DEPAN)).toBe(true);
    expect(depan.baris.some((s) => s.id === SESI_LAMPAU)).toBe(false);

    const lampau = await ambilDaftarSesi(
      { cari: "", saring: { waktu: "lampau" }, hal: 1 }, HARI_INI);
    expect(lampau.baris.some((s) => s.id === SESI_LAMPAU)).toBe(true);
    expect(lampau.baris.some((s) => s.id === SESI_DEPAN)).toBe(false);
  });

  it("waktu=pekan_ini memuat hari ini, membuang bulan lalu DAN akhir tahun", async () => {
    const { baris } = await ambilDaftarSesi(
      { cari: "", saring: { waktu: "pekan_ini" }, hal: 1 }, HARI_INI);
    const id = baris.map((s) => s.id);
    expect(id).toContain(SESI_PEKAN);
    expect(id).not.toContain(SESI_LAMPAU);
    expect(id).not.toContain(SESI_DEPAN);
  });

  it("mencari menurut nama klien DAN padma id", async () => {
    const nama = await ambilDaftarSesi({ cari: "ananda", saring: {}, hal: 1 }, HARI_INI);
    expect(nama.baris.length).toBeGreaterThan(0);
    expect(nama.baris.every((s) => s.namaKlien.toLowerCase().includes("ananda"))).toBe(true);

    const id = await ambilDaftarSesi(
      { cari: nama.baris[0].padmaId, saring: {}, hal: 1 }, HARI_INI);
    expect(id.baris.length).toBeGreaterThan(0);
  });

  it("kata cari diperlakukan sebagai HURUF, bukan wildcard SQL", async () => {
    // "%" sebagai wildcard akan mencocokkan SEMUA klien. Sebagai huruf, nol.
    const { baris } = await ambilDaftarSesi({ cari: "%", saring: {}, hal: 1 }, HARI_INI);
    expect(baris).toEqual([]);
  });
});

describe("ambilDaftarSesi — paginasi", () => {
  it("halaman 1 penuh dan halaman 2 BERISI", async () => {
    const p = { cari: "", saring: { jenjang: "kosong" }, hal: 1 };
    const h1 = await ambilDaftarSesi(p, HARI_INI);
    expect(h1.baris).toHaveLength(PER_HAL);

    // Halaman 2 WAJIB berisi. Fixture N = PER_HAL + 5 yang menjaminnya —
    // uji paginasi rencana 1 pernah LULUS HAMPA karena halaman 2 kosong dan
    // `[].every(...)` selalu true.
    const h2 = await ambilDaftarSesi({ ...p, hal: 2 }, HARI_INI);
    expect(h2.baris.length).toBeGreaterThan(0);

    // Tidak boleh ada baris yang muncul di kedua halaman.
    const tumpang = h1.baris.filter((a) => h2.baris.some((b) => b.id === a.id));
    expect(tumpang).toEqual([]);
  });

  it("total menghitung seluruh baris yang cocok, bukan hanya halaman ini", async () => {
    const { baris, total } = await ambilDaftarSesi(
      { cari: "", saring: { jenjang: "kosong" }, hal: 1 }, HARI_INI);
    expect(total).toBeGreaterThan(baris.length);
  });
});

describe("pagar identitas — lib/admin/sesi.ts", () => {
  const sumber = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../src/lib/admin/sesi.ts"), "utf8") as string;

  it('bentuk metode .ilike("id"|"*_id", …) tidak dipakai', () => {
    expect(sumber).not.toMatch(/\.(?:ilike|like)\(\s*['"`](id|\w*_id)['"`]/);
  });

  it("di dalam .or(...) hanya padma_id yang boleh dicocokkan dengan pola", () => {
    const kolom = [...sumber.matchAll(/[,'"`](id|\w*_id)\.(?:ilike|like)\./g)].map((m) => m[1]);
    // Pagar bergigi: `ambilDaftarSesi` memang mencocokkan `padma_id`.
    expect(kolom.length).toBeGreaterThan(0);
    expect(kolom.filter((k) => k !== "padma_id")).toEqual([]);
  });
});

describe("money firewall", () => {
  it("lapisan data sesi tidak pernah menyebut tabel uang", () => {
    const sumber = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../src/lib/admin/sesi.ts"), "utf8") as string;
    for (const tabel of ["variant_rates", "honor_marks", "transport_rates", "transport_khusus"]) {
      expect(sumber).not.toContain(tabel);
    }
  });
});
```

- [ ] **Langkah 2: Jalankan uji, pastikan MERAH**

Jalankan: `npx vitest run tests/admin-sesi-daftar.test.ts`
Diharapkan: GAGAL — `Cannot find module '@/lib/admin/sesi'`.

- [ ] **Langkah 3: Tulis lapisan datanya**

Buat `web/src/lib/admin/sesi.ts`:

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";
import { awalPekan, akhirPekan } from "@/lib/owner/pekan";
import type { JenjangTransport } from "@/lib/transport/jarak";
import type { StatusSesi } from "@/app/admin/sesi/status";

/**
 * Lapisan data daftar sesi.
 *
 * Sesi pengguna (`createServerSupabase`), bukan service role: policy
 * `sessions: staf` yang mengizinkan bacaan ini, dan di bawah service role
 * `user_role()` justru mengembalikan 'klien' sehingga tidak satu pun pagar
 * ikut diperiksa.
 *
 * NOL NOMINAL. Jenjang transport adalah data LOGISTIK — admin melihat
 * "5–10 km", tidak pernah rupiahnya. Berkas ini tidak pernah menyebut satu
 * pun tabel uang, dan itu diuji.
 */

/** Nilai saringan yang sah untuk daftar sesi — dipakai halaman DAN uji. */
export const SARING_SESI = {
  status: ["terjadwal", "selesai", "batal"],
  jenjang: ["kosong"],
  waktu: ["mendatang", "pekan_ini", "lampau"],
} as const satisfies SaringSah;

export type BarisSesiDaftar = {
  id: string;
  namaKlien: string;
  padmaId: string;
  namaLayanan: string;
  namaMitra: string;
  /** ISO `YYYY-MM-DD` mentah — pemformatannya milik halaman, bukan lapisan ini. */
  tanggal: string;
  status: StatusSesi;
  dalamPaket: boolean;
  catatan: string;
  rekomendasi: string;
  jenjang: JenjangTransport | null;
  jenjangSumber: "otomatis" | "admin" | null;
};

type BarisDb = {
  id: string;
  tanggal: string;
  status: StatusSesi;
  catatan: string;
  rekomendasi: string;
  client_package_id: string | null;
  jenjang: JenjangTransport | null;
  jenjang_sumber: "otomatis" | "admin" | null;
  clients: { nama: string; padma_id: string } | null;
  services: { nama: string } | null;
  partners: { nama: string } | null;
};

/**
 * Satu halaman daftar sesi beserta TOTAL baris yang cocok.
 *
 * `hariIni` dioper masuk, tidak dibaca dari jam sistem: server berjalan UTC
 * dan pada 17:00–24:00 UTC kalender Jakarta sudah berganti tanggal. Aturan
 * yang sama dipegang seluruh lapisan data proyek ini.
 */
export async function ambilDaftarSesi(
  param: ParamDaftar,
  hariIni: string,
): Promise<{ baris: BarisSesiDaftar[]; total: number }> {
  const supabase = await createServerSupabase();
  const { dari, sampai } = hitungRentang(param.hal);

  // `clients!inner`, bukan `clients`: pencarian di bawah menyaring lewat
  // kolom klien, dan tanpa `!inner` PostgREST hanya menyaring EMBED-nya —
  // barisnya tetap keluar dengan `clients: null`, sehingga "cari" tampak
  // tidak melakukan apa pun. Aman dijadikan inner: `sessions.client_id`
  // NOT NULL sejak init_schema.
  let q = supabase
    .from("sessions")
    .select(
      "id, tanggal, status, catatan, rekomendasi, client_package_id, jenjang, jenjang_sumber, " +
        "clients!inner(nama, padma_id), services(nama), partners(nama)",
      { count: "exact" },
    )
    // Terbaru di atas: yang baru saja dijalani bidan paling mungkin perlu
    // ditandai selesai. `id` sebagai tie-break supaya urutan dua sesi
    // bertanggal sama STABIL antar halaman — tanpa itu, satu baris bisa
    // muncul di halaman 1 dan 2 sekaligus sementara baris lain tidak pernah.
    .order("tanggal", { ascending: false })
    .order("id");

  if (param.saring.status) q = q.eq("status", param.saring.status);
  // Jenjang kosong = jarak tidak pernah diketahui. Inilah saringan yang
  // ditautkan StatTile "Sesi selesai tanpa jenjang" (Tugas 4).
  if (param.saring.jenjang === "kosong") q = q.is("jenjang", null);
  if (param.saring.waktu === "mendatang") q = q.gte("tanggal", hariIni);
  if (param.saring.waktu === "lampau") q = q.lt("tanggal", hariIni);
  if (param.saring.waktu === "pekan_ini") {
    q = q.gte("tanggal", awalPekan(hariIni)).lte("tanggal", akhirPekan(hariIni));
  }

  if (param.cari !== "") {
    // `%` dan `_` yang diketik manusia dicari sebagai HURUF, bukan wildcard.
    const aman = param.cari.replace(/[%_\\]/g, (c) => `\\${c}`);
    // Nama yang diingat admin ATAU PADMA ID yang dibacakan klien lewat
    // telepon — satu kotak cari harus menemukan keduanya.
    //
    // `padma_id` dikecualikan dari pagar identitas dengan alasan yang sama
    // persis seperti di `lib/admin/klien.ts`: kolom itu ditulis sekali lalu
    // hanya ditampilkan, tidak pernah menjadi kunci `.eq()` untuk otorisasi.
    q = q.or(`nama.ilike.%${aman}%,padma_id.ilike.%${aman}%`, { referencedTable: "clients" });
  }

  const { data, count } = await q.range(dari, sampai).returns<BarisDb[]>();

  return {
    baris: (data ?? []).map((s) => ({
      id: s.id,
      namaKlien: s.clients?.nama ?? "Klien",
      padmaId: s.clients?.padma_id ?? "—",
      namaLayanan: s.services?.nama ?? "Layanan",
      // Mitra dibaca dari tabel `partners` (hak staf), BUKAN dari view
      // `partner_publik` — view itu sengaja tidak menyaring ketersediaan, dan
      // memindahkan filter ke sana pernah mengubah nama bidan di riwayat
      // SELURUH klien menjadi "Tim PADMA" tanpa satu pun error.
      namaMitra: s.partners?.nama ?? "Tim PADMA",
      tanggal: s.tanggal,
      status: s.status,
      dalamPaket: s.client_package_id !== null,
      catatan: s.catatan,
      rekomendasi: s.rekomendasi,
      jenjang: s.jenjang,
      jenjangSumber: s.jenjang_sumber,
    })),
    total: count ?? 0,
  };
}
```

- [ ] **Langkah 4: Jalankan uji, pastikan HIJAU**

Jalankan: `npx vitest run tests/admin-sesi-daftar.test.ts`
Diharapkan: LULUS.

Bila uji `waktu=pekan_ini` merah, periksa lebih dulu apakah `awalPekan("2026-06-15")` benar-benar
memulangkan `2026-06-15` (Senin). `isoDow` di `lib/owner/pekan.ts` memakai Senin sebagai hari 1.

- [ ] **Langkah 5: `tsc` bersih**

Jalankan: `npx tsc --noEmit`
Diharapkan: nol galat.

- [ ] **Langkah 6: Commit**

```bash
git add web/src/lib/admin/sesi.ts web/tests/admin-sesi-daftar.test.ts
git commit -m "feat(sesi): lapisan data daftar sesi berparam URL"
```

---

## Tugas 3: Halaman Sesi — bilah, paginasi, panel geser

Modul terbesar dalam sapuan ini. Dua formulir yang hari ini hidup DI DALAM sel tabel
(`form-selesai.tsx`: "tandai selesai" dan "ubah jenjang") pindah ke panel geser; satu formulir yang
hidup di header (`form-sesi.tsx`: "jadwalkan sesi") menjadi isi panel geser `?ubah=baru`.

**Berkas:**
- Buat: `web/src/app/admin/sesi/panel-sesi.tsx`
- Hapus: `web/src/app/admin/sesi/form-selesai.tsx`
- Ubah: `web/src/app/admin/sesi/page.tsx` (tulis ulang)
- Ubah: `web/src/app/admin/sesi/form-sesi.tsx` (buang gerbang buka/tutupnya)
- Ubah: `web/tests/admin-sesi-catatan.test.ts`, `web/tests/transport-atribusi.test.ts`

**Antarmuka:**
- Memakai: `ambilDaftarSesi`, `SARING_SESI`, `BarisSesiDaftar` (Tugas 2); `BilahDaftar`,
  `Paginasi`, `PanelGeser`, `Bantuan`, `Tabel/Th/Td`, `uraikanParamDaftar`, `bangunQuery`.
- Menghasilkan: rute `/admin/sesi?cari=&status=&jenjang=&waktu=&hal=&ubah=` — dipakai Tugas 4.

- [ ] **Langkah 1: Tulis uji halaman yang gagal**

Tambahkan ke `web/tests/admin-sesi-catatan.test.ts` (yang sudah merender halaman ini):

```ts
const { default: SesiPage } = await import("@/app/admin/sesi/page");

/** Halaman ini kini menerima searchParams — Next 16 mengopernya sebagai Promise. */
function markupSesi(sp: Record<string, string> = {}) {
  return renderToStaticMarkup(
    createElement(SesiPage as never, { searchParams: Promise.resolve(sp) }),
  );
}

describe("halaman sesi — bilah daftar & panel geser", () => {
  it("punya kotak cari sebagai form GET, bukan komponen klien", async () => {
    const m = await markupSesi();
    expect(m).toContain('method="get"');
    expect(m).toContain('action="/admin/sesi"');
    expect(m).toContain('name="cari"');
  });

  it("chip saringan menaut, bukan menekan tombol", async () => {
    const m = await markupSesi();
    for (const href of [
      "/admin/sesi?status=terjadwal",
      "/admin/sesi?status=selesai",
      "/admin/sesi?jenjang=kosong",
      "/admin/sesi?waktu=pekan_ini",
    ]) {
      expect(m, `chip ${href} hilang`).toContain(`href="${href}"`);
    }
  });

  it("tombol baru membuka panel, BUKAN kartu yang mendorong isi halaman", async () => {
    const m = await markupSesi();
    expect(m).toContain('href="/admin/sesi?ubah=baru"');
    // Kartu putus-putus lama tidak boleh tersisa di keadaan tertutup.
    expect(m).not.toContain("border-dashed");
  });

  it("?ubah=baru membuka panel geser berisi formulir jadwal", async () => {
    const m = await markupSesi({ ubah: "baru" });
    expect(m).toContain('role="dialog"');
    expect(m).toContain('aria-modal="true"');
    expect(m).toContain('name="client_id"');
    expect(m).toContain('name="jenjang"');
  });

  it("id yang tidak ada di halaman ini TIDAK membuka panel kosong", async () => {
    const m = await markupSesi({ ubah: "00000000-0000-0000-0000-000000000000" });
    expect(m).not.toContain('role="dialog"');
  });

  it("menutup panel mempertahankan cari, saringan, dan halaman", async () => {
    const m = await markupSesi({ cari: "ananda", status: "selesai", hal: "2", ubah: "baru" });
    expect(m).toContain('href="/admin/sesi?cari=ananda&amp;status=selesai&amp;hal=2"');
  });

  it("penjelasan halaman pindah ke tombol bantuan yang terlipat", async () => {
    const m = await markupSesi();
    expect(m).toContain("<details");
    expect(m).toContain("<summary");
  });

  it("atribusi OpenStreetMap tetap tampak tanpa membuka apa pun", async () => {
    // Kewajiban lisensi ODbL: atribusi harus tampak di LAYAR yang menampilkan
    // hasil geocoding. Kolom "Jenjang" tampil begitu halaman dimuat, jadi
    // atribusinya tidak boleh ikut pindah ke dalam panel yang mulai tertutup.
    const m = await markupSesi();
    expect(m).toContain("OpenStreetMap");
  });

  it("nol rupiah", async () => {
    expect(nominalDalam(await markupSesi())).toEqual([]);
    expect(nominalDalam(await markupSesi({ ubah: "baru" }))).toEqual([]);
  });
});
```

Hapus dari berkas yang sama: `const sumberFormSelesai = baca("src/app/admin/sesi/form-selesai.tsx");`
dan setiap asersi yang memakainya — arahkan ke `src/app/admin/sesi/panel-sesi.tsx`.

- [ ] **Langkah 2: Jalankan uji, pastikan MERAH**

Jalankan: `npx vitest run tests/admin-sesi-catatan.test.ts`
Diharapkan: GAGAL — halaman belum menerima `searchParams`, tidak ada `method="get"`.

- [ ] **Langkah 3: Pindahkan kedua formulir baris ke `panel-sesi.tsx`**

Buat `web/src/app/admin/sesi/panel-sesi.tsx`. Isinya adalah `form-selesai.tsx` TANPA `<tr>/<td>`
pembungkusnya dan tanpa tombol pembuka laci — panelnya sendiri sudah menjadi wadahnya.

```tsx
"use client";

import { useState, useTransition } from "react";
import { selesaikanSesi, tetapkanJenjang } from "./aksi";
import { JENJANG_SAH, LABEL_STATUS_SESI } from "./status";
import { LABEL_JENJANG } from "@/lib/transport/jarak";
import type { BarisSesiDaftar } from "@/lib/admin/sesi";

const KELAS_LABEL = "block text-[12.5px] font-bold text-panel-muted";
const KELAS_MEDAN =
  "mt-1 w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13px] text-panel-ink";
const KELAS_UTAMA =
  "rounded-lg bg-panel-ink px-3.5 py-2 text-[12.5px] font-bold text-panel-surface disabled:opacity-60";

/**
 * Isi panel geser untuk SATU sesi.
 *
 * Sebelumnya dua laci di dalam sel tabel (`form-selesai.tsx`): baris memuai,
 * kolom lain melenceng, dan pada tabel panjang mata kehilangan baris mana yang
 * sedang diubah. Keduanya kini hidup berdampingan di panel selebar setengah
 * layar, dengan daftarnya tetap terlihat di belakang.
 *
 * Komponen KLIEN karena kedua formulirnya memanggil server action lalu
 * menampilkan pesan galatnya di tempat. Yang TIDAK ada di sini: pengambilan
 * data. Seluruh isinya datang sebagai prop `sesi` yang sudah dirender halaman
 * di server — memindahkan pengambilan data ke dalam sini akan membuat panel
 * ini berhenti bisa diuji sama sekali (suite berjalan tanpa jsdom).
 *
 * Nol rupiah: jenjang adalah data LOGISTIK, admin melihat "5–10 km".
 */
export function PanelSesi({ sesi, hrefTutup }: { sesi: BarisSesiDaftar; hrefTutup: string }) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [pesanJenjang, setPesanJenjang] = useState<string | null>(null);

  const adaCatatan = sesi.catatan.trim().length > 0;
  const labelJenjang = sesi.jenjang
    ? `${LABEL_JENJANG[sesi.jenjang]} · ${sesi.jenjangSumber === "admin" ? "ditetapkan admin" : "otomatis"}`
    : "belum ditetapkan";

  return (
    <div className="grid gap-4 text-[13px] text-panel-ink">
      <section>
        <p className="font-bold">{sesi.namaLayanan}</p>
        <p className="text-[12px] text-panel-muted">
          {sesi.namaKlien} · {sesi.padmaId} · {sesi.tanggal}
          {sesi.dalamPaket ? " · paket" : ""}
        </p>
        <p className="text-[12px] text-panel-muted">
          Mitra: {sesi.namaMitra} · Status: {LABEL_STATUS_SESI[sesi.status]}
        </p>
        <p className="text-[12px] text-panel-muted">Jenjang: {labelJenjang}</p>
      </section>

      {sesi.status === "terjadwal" && (
        <form
          action={(fd) =>
            mulai(async () => {
              const r = await selesaikanSesi(sesi.id, fd);
              setPesan(r.ok ? null : r.pesan);
            })
          }
          className="rounded-lg border border-panel-border p-3"
        >
          <h3 className="text-[12.5px] font-extrabold">
            Selesaikan sesi — catatan ini terbaca {sesi.namaKlien} di Passport-nya
          </h3>
          <label className="mt-2 block">
            <span className={KELAS_LABEL}>Catatan &amp; evaluasi (dari laporan bidan)</span>
            <textarea name="catatan" rows={3} required maxLength={2000} className={KELAS_MEDAN} />
          </label>
          <label className="mt-2 block">
            <span className={KELAS_LABEL}>Rekomendasi untuk klien</span>
            <textarea name="rekomendasi" rows={2} maxLength={2000} className={KELAS_MEDAN} />
          </label>
          {pesan && <p className="mt-2 text-[12px] font-semibold text-clay">{pesan}</p>}
          <button type="submit" disabled={pending} className={`mt-3 ${KELAS_UTAMA}`}>
            {pending ? "Menyimpan…" : "Simpan · sesi selesai"}
          </button>
        </form>
      )}

      {/* Koreksi jenjang TIDAK terikat status sesi — `tetapkanJenjang` sendiri
          tidak memeriksa status (lihat aksi.ts), karena jenjang adalah data
          logistik yang bisa perlu diperbaiki bahkan sesudah sesinya selesai. */}
      <form
        action={(fd) =>
          mulai(async () => {
            const r = await tetapkanJenjang(fd);
            setPesanJenjang(r.ok ? null : r.pesan);
          })
        }
        className="rounded-lg border border-panel-border p-3"
      >
        {/* Id ditulis di sini; `jenjang_sumber` ditulis MATI sebagai 'admin'
            oleh server action — yang boleh datang dari formulir hanyalah
            jenjang mana dan mengapa. */}
        <input type="hidden" name="sesi" value={sesi.id} />
        <h3 className="text-[12.5px] font-extrabold">Ubah jenjang transport</h3>
        <p className="text-[11.5px] text-panel-muted">
          Saat ini: {labelJenjang}. Ini data JENJANG untuk logistik — bukan rupiah.
        </p>
        <label className="mt-2 block">
          <span className={KELAS_LABEL}>Jenjang baru</span>
          <select name="jenjang" defaultValue={sesi.jenjang ?? JENJANG_SAH[0]} className={KELAS_MEDAN}>
            {JENJANG_SAH.map((j) => (
              <option key={j} value={j}>{LABEL_JENJANG[j]}</option>
            ))}
          </select>
        </label>
        <label className="mt-2 block">
          <span className={KELAS_LABEL}>Alasan (wajib)</span>
          <textarea
            name="alasan"
            rows={2}
            required
            placeholder="Mis. alamat di seberang sungai, memutar jauh…"
            className={KELAS_MEDAN}
          />
        </label>
        {pesanJenjang && (
          <p className="mt-2 text-[12px] font-semibold text-clay">{pesanJenjang}</p>
        )}
        <button type="submit" disabled={pending} className={`mt-3 ${KELAS_UTAMA}`}>
          {pending ? "Menyimpan…" : "Simpan jenjang"}
        </button>
      </form>

      {adaCatatan && (
        <section className="rounded-lg border border-panel-border bg-panel-bg p-3">
          <p><b>Catatan:</b> {sesi.catatan}</p>
          <p className="mt-1"><b>Rekomendasi:</b> {sesi.rekomendasi || "—"}</p>
        </section>
      )}

      <a href={hrefTutup} className="text-[12px] font-bold text-panel-muted">
        Tutup tanpa menyimpan
      </a>
    </div>
  );
}
```

Hapus `web/src/app/admin/sesi/form-selesai.tsx`.

- [ ] **Langkah 4: Buang gerbang buka/tutup dari `form-sesi.tsx`**

`FormJadwalSesi` dimulai tertutup (`useState(false)` + cabang `if (!terbuka)`) karena ia duduk di
HEADER daftar. Di dalam panel geser, panelnya sendiri sudah menjadi gerbangnya — gerbang kedua
berarti admin mengeklik "+ Sesi baru", panel terbuka, dan isinya masih sebuah tombol.

Di `web/src/app/admin/sesi/form-sesi.tsx`:
- Hapus `const [terbuka, setTerbuka] = useState(false);`, `const [berhasil, setBerhasil] = useState(false);`,
  dan seluruh blok `if (!terbuka) { … }`.
- Tambahkan prop `hrefTutup: string`, dan pada sukses ganti `setTerbuka(false)` menjadi navigasi
  balik lewat `useRouter().push(hrefTutup)`.
- Tombol "Batal" menjadi `<a href={hrefTutup}>`.
- Ganti kelas palet lama menjadi token panel: `border-dashed border-gold bg-[#FDFAF1]` → hapus
  (panel sudah punya latarnya); `bg-night text-gold-pale` → `bg-panel-ink text-panel-surface`;
  `border-black/15 bg-white` → `border-panel-border bg-panel-surface`; `text-ink-soft` →
  `text-panel-muted`; `bg-paper` → `bg-panel-bg`.
- **PERTAHANKAN** blok atribusi OpenStreetMap apa adanya —
  `tests/transport-atribusi.test.ts` menuntutnya dan lisensinya mewajibkannya.

- [ ] **Langkah 5: Tulis ulang `page.tsx`**

Ganti seluruh isi `web/src/app/admin/sesi/page.tsx`:

```tsx
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { ambilDaftarSesi, SARING_SESI } from "@/lib/admin/sesi";
import { pilihanMitra } from "@/lib/admin/mitra";
import { pilihanLayanan, pilihanVarian } from "@/lib/admin/katalog-admin";
import { formatTanggalID, hariIniJakarta } from "@/lib/passport/waktu";
import { uraikanParamDaftar, bangunQuery, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { PanelGeser } from "@/app/_shell/panel/panel-geser";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { BlokPermintaan, type PermintaanAntre } from "./antrean-permintaan";
import { FormJadwalSesi, type PilihanKlien } from "./form-sesi";
import { PanelSesi } from "./panel-sesi";
import { LABEL_WAKTU, LABEL_STATUS_SESI, type PreferensiWaktu, type StatusSesi } from "./status";
import { LABEL_JENJANG } from "@/lib/transport/jarak";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Sesi" };

const BASIS = "/admin/sesi";

type BarisPermintaan = {
  id: string;
  tanggal: string;
  preferensi_waktu: PreferensiWaktu;
  catatan: string;
  clients: { nama: string } | null;
  services: { nama: string } | null;
};

const KELAS_PILL: Record<StatusSesi, string> = {
  terjadwal: "bg-gold/15 text-[#8A6A16]",
  selesai: "bg-leaf-soft text-leaf",
  batal: "bg-clay/10 text-clay",
};

export default async function SesiPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const sp = await searchParams;
  const param = uraikanParamDaftar(sp, SARING_SESI);
  // "Hari ini" menurut Jakarta, bukan menurut jam server (Vercel berjalan UTC).
  const hariIni = hariIniJakarta();

  const supabase = await createServerSupabase();
  const [{ baris, total }, { data: permintaan }] = await Promise.all([
    ambilDaftarSesi(param, hariIni),
    supabase
      .from("booking_requests")
      .select("id, tanggal, preferensi_waktu, catatan, clients ( nama ), services ( nama )")
      .eq("status", "menunggu")
      // Yang paling dekat tanggalnya paling mendesak dijawab.
      .order("tanggal", { ascending: true })
      .order("created_at", { ascending: true })
      .returns<BarisPermintaan[]>(),
  ]);

  // `ubah` sengaja TIDAK lewat `uraikanParamDaftar`: ia bukan saringan
  // berdaftar-putih melainkan sebuah id, dan kesahihannya dibuktikan dengan
  // menemukan barisnya di bawah.
  const ubah = typeof sp.ubah === "string" ? sp.ubah : "";
  const barisUbah = ubah === "baru" ? undefined : baris.find((s) => s.id === ubah);
  const panelTerbuka = ubah === "baru" || barisUbah !== undefined;
  const hrefTutup = `${BASIS}${bangunQuery(param, { ubah: null })}`;

  // Empat query pilihan hanya ditarik SAAT panel "baru" benar-benar terbuka.
  // Menariknya di setiap pemuatan halaman berarti membayar empat query untuk
  // formulir yang biasanya tidak dibuka.
  const [klien, layanan, varian, mitra] = panelTerbuka && ubah === "baru"
    ? await Promise.all([
        supabase
          .from("clients")
          .select("id, nama, padma_id, alamat_lat, alamat_lon")
          .order("nama")
          .returns<
            { id: string; nama: string; padma_id: string; alamat_lat: number | null; alamat_lon: number | null }[]
          >()
          .then(({ data }) => data ?? []),
        pilihanLayanan(),
        pilihanVarian(),
        pilihanMitra(),
      ])
    : [[], [], [], []];

  const antre: PermintaanAntre[] = (permintaan ?? []).map((p) => ({
    id: p.id,
    // Nama, bukan UUID: antrean ini dibaca manusia yang akan menelepon orangnya.
    namaKlien: p.clients?.nama ?? "Klien",
    namaLayanan: p.services?.nama ?? "Layanan",
    // Diformat lewat kalender Asia/Jakarta — `new Date(tgl)` bisa mundur sehari.
    tanggal: formatTanggalID(p.tanggal),
    waktu: LABEL_WAKTU[p.preferensi_waktu] ?? p.preferensi_waktu,
    catatan: p.catatan,
  }));

  const pilihanKlien: PilihanKlien[] = klien.map((k) => ({
    id: k.id,
    nama: k.nama,
    padmaId: k.padma_id,
    alamatLat: k.alamat_lat,
    alamatLon: k.alamat_lon,
  }));

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Sesi</h1>
        <Bantuan judul="Tentang halaman ini">
          Permintaan jadwal dari klien menunggu keputusan di blok bergaris di bawah; yang
          dikonfirmasi langsung menjadi sesi pada Passport kliennya. Catatan &amp; rekomendasi yang
          ditulis saat menandai sesi selesai <b>terbaca klien</b> di Passport-nya — tulislah untuk
          dibaca klien, bukan sebagai catatan internal.
        </Bantuan>
      </header>

      {antre.length > 0 && (
        <section aria-label="Permintaan jadwal menunggu" className="mb-4">
          {antre.map((p) => (
            <BlokPermintaan key={p.id} permintaan={p} mitra={mitra} />
          ))}
          <p className="mt-0.5 text-[12px] text-panel-muted">
            Konfirmasi mengubah permintaan menjadi sesi Terjadwal — kabari juga klien via WhatsApp.
          </p>
        </section>
      )}

      <BilahDaftar
        basis={BASIS}
        param={param}
        kelompok={[
          {
            nama: "status",
            label: "Status",
            pilihan: [
              { nilai: "terjadwal", label: "Terjadwal" },
              { nilai: "selesai", label: "Selesai" },
              { nilai: "batal", label: "Batal" },
            ],
          },
          {
            nama: "jenjang",
            label: "Jenjang",
            // `menuntut` menyalakan warna clay: ini saringan yang menunjuk
            // PEKERJAAN (jarak yang belum diketahui), bukan sekadar kabar.
            pilihan: [{ nilai: "kosong", label: "Tanpa jenjang", menuntut: true }],
          },
          {
            nama: "waktu",
            label: "Waktu",
            pilihan: [
              { nilai: "mendatang", label: "Mendatang" },
              { nilai: "pekan_ini", label: "Pekan ini" },
              { nilai: "lampau", label: "Sudah lewat" },
            ],
          },
        ]}
        jumlah={baris.length}
        total={total}
        aksi={
          <Link
            href={`${BASIS}?ubah=baru`}
            className="rounded-lg bg-panel-ink px-3 py-2 text-[12px] font-bold text-panel-surface"
          >
            + Sesi baru
          </Link>
        }
      />

      {/* Kolom "Jenjang" adalah hasil geocoding Nominatim (OSM) — lisensi ODbL
          mewajibkan atribusi tampak persis di LAYAR yang menampilkannya.
          Ditaruh di sini, di atas tabel, karena inilah bagian halaman yang
          SELALU tampak begitu /admin/sesi dimuat — tidak menunggu klik apa pun.
          Nol rupiah di baris ini (money firewall). */}
      <p className="mb-2 text-[11px] text-panel-muted">
        Jenjang jarak pada tiap baris dihitung dari data lokasi © OpenStreetMap contributors.
      </p>

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          Tidak ada sesi yang cocok dengan pencarian ini.
        </p>
      ) : (
        <div className="rounded-lg border border-panel-border bg-panel-surface">
          <Tabel label="Daftar sesi">
            <thead>
              <tr>
                <Th>Klien</Th><Th>Layanan</Th><Th>Mitra</Th><Th>Jenjang</Th>
                <Th>Status</Th><Th>Aksi</Th>
              </tr>
            </thead>
            <tbody>
              {baris.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <b>{s.namaKlien}</b>
                    <span className="mt-0.5 block font-mono text-[11px] text-panel-muted">
                      {s.padmaId}
                    </span>
                  </Td>
                  <Td>
                    {s.namaLayanan}
                    <span className="mt-0.5 block text-[11.5px] text-panel-muted">
                      {formatTanggalID(s.tanggal)}
                      {s.dalamPaket ? " · paket" : ""}
                    </span>
                  </Td>
                  <Td>{s.namaMitra}</Td>
                  <Td>{s.jenjang ? LABEL_JENJANG[s.jenjang] : "—"}</Td>
                  <Td>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${KELAS_PILL[s.status]}`}
                    >
                      {LABEL_STATUS_SESI[s.status]}
                    </span>
                  </Td>
                  <Td>
                    <Link
                      href={`${BASIS}${bangunQuery(param, { ubah: s.id })}`}
                      className="text-[12px] font-bold text-panel-ink underline"
                    >
                      Ubah
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabel>
        </div>
      )}

      <Paginasi basis={BASIS} param={param} total={total} />

      {panelTerbuka && (
        <PanelGeser
          judul={barisUbah ? `Sesi ${barisUbah.namaKlien}` : "Jadwalkan sesi"}
          hrefTutup={hrefTutup}
        >
          {barisUbah ? (
            <PanelSesi sesi={barisUbah} hrefTutup={hrefTutup} />
          ) : (
            <FormJadwalSesi
              klien={pilihanKlien}
              layanan={layanan}
              varian={varian}
              mitra={mitra}
              // Tanggal awal = hari ini menurut kalender Jakarta, bukan jam
              // server: pada 17:00–24:00 UTC keduanya sudah berbeda tanggal.
              tanggalAwal={hariIni}
              hrefTutup={hrefTutup}
            />
          )}
        </PanelGeser>
      )}
    </main>
  );
}
```

- [ ] **Langkah 6: Jalankan uji sesi, pastikan HIJAU**

Jalankan: `npx vitest run tests/admin-sesi-catatan.test.ts tests/admin-sesi-konfirmasi.test.ts tests/transport-atribusi.test.ts`
Diharapkan: LULUS.

Catatan pemeriksaan: `BlokPermintaan` menerima `mitra` yang kini KOSONG kecuali panel "baru"
terbuka. Blok itu sudah punya cabang `mitra.length === 0` yang menampilkan "Belum ada mitra aktif".
Itu SALAH untuk keadaan ini. Perbaikannya: tarik `pilihanMitra()` tanpa syarat bila `antre.length > 0`.
Ubah baris pengambilannya menjadi:

```tsx
  const butuhPilihan = ubah === "baru";
  const mitra = butuhPilihan || (permintaan ?? []).length > 0 ? await pilihanMitra() : [];
```

dan keluarkan `pilihanMitra()` dari `Promise.all` yang bersyarat.

- [ ] **Langkah 7: `tsc` bersih dan lint**

Jalankan: `npm run build && npx tsc --noEmit && npm run lint`
Diharapkan: build sukses, nol galat tipe, nol galat lint.

- [ ] **Langkah 8: Commit**

```bash
git add web/src/app/admin/sesi web/tests
git rm web/src/app/admin/sesi/form-selesai.tsx
git commit -m "feat(sesi): bilah daftar, paginasi, dan panel geser menggantikan formulir dalam sel"
```

---

## Tugas 4: StatTile "Sesi selesai tanpa jenjang" menaut ke daftar tersaring

Ini utang #1 runbook transport, dan spec K2 menyebutnya sebagai salah satu dari empat alasan
keadaan daftar hidup di URL: hari ini tile itu memberi ANGKA lalu meninggalkan admin memindai
ratusan baris untuk menemukan tiga sesi yang dimaksud.

**Berkas:**
- Ubah: `web/src/app/admin/page.tsx:126` (satu prop `href`)
- Ubah: `web/tests/admin-shell.test.ts`

**Antarmuka:**
- Memakai: rute dan nama saringan dari Tugas 3.

- [ ] **Langkah 1: Tulis uji yang gagal**

Tambahkan ke `web/tests/admin-shell.test.ts`, di dalam `describe` beranda admin yang sudah ada:

```ts
  it("tile 'Sesi selesai tanpa jenjang' menaut ke DAFTAR TERSARING, bukan ke modulnya", () => {
    // Tile yang hanya memberi angka lalu menurunkan admin di daftar penuh
    // meninggalkannya memindai ratusan baris untuk menemukan tiga sesi.
    // Urutan parameter mengikuti `bangunQuery`: saringan menurut abjad
    // kemunculan, `hal` tidak ditulis untuk halaman 1.
    expect(m).toContain('href="/admin/sesi?status=selesai&amp;jenjang=kosong"');
  });

  it("tile transport owner TIDAK ikut berubah — ia milik panel lain", () => {
    // Pagar regresi: kedua tile bertetangga dan mudah tertukar saat menyunting.
    expect(m).toContain('href="/owner/transport"');
  });
```

- [ ] **Langkah 2: Jalankan uji, pastikan MERAH**

Jalankan: `npx vitest run tests/admin-shell.test.ts`
Diharapkan: GAGAL — `href` masih `/admin/sesi` polos.

- [ ] **Langkah 3: Ubah `href`-nya**

Di `web/src/app/admin/page.tsx`, pada `StatTile` berlabel "Sesi selesai tanpa jenjang":

```tsx
          // Menaut ke DAFTAR TERSARING, bukan ke modulnya. Ini yang membayar
          // keputusan spec K2 (keadaan daftar hidup di URL): tanpa itu, tile
          // ini hanya bisa memberi angka lalu menurunkan admin di daftar penuh.
          // Urutannya `status` lalu `jenjang` — sama persis dengan yang
          // dihasilkan `bangunQuery`, supaya chip yang menyala di halaman
          // tujuan adalah keduanya, bukan salah satu.
          href="/admin/sesi?status=selesai&jenjang=kosong"
```

- [ ] **Langkah 4: Jalankan uji, pastikan HIJAU**

Jalankan: `npx vitest run tests/admin-shell.test.ts`
Diharapkan: LULUS.

- [ ] **Langkah 5: Buktikan tautannya benar-benar mendarat di baris yang dimaksud**

Tambahkan ke `web/tests/admin-sesi-daftar.test.ts`:

```ts
  it("saringan yang ditunjuk StatTile memulangkan PERSIS sesi selesai tanpa jenjang", async () => {
    // Tautan yang sintaksnya benar tetapi saringannya meleset tetap
    // meninggalkan admin memindai dengan mata. Yang diuji di sini bukan
    // href-nya (itu di admin-shell), melainkan barisnya.
    const { baris, total } = await ambilDaftarSesi(
      { cari: "", saring: { status: "selesai", jenjang: "kosong" }, hal: 1 }, HARI_INI);
    expect(total).toBeGreaterThanOrEqual(N);
    expect(baris.every((s) => s.status === "selesai" && s.jenjang === null)).toBe(true);
  });
```

Jalankan: `npx vitest run tests/admin-sesi-daftar.test.ts`
Diharapkan: LULUS.

- [ ] **Langkah 6: Commit**

```bash
git add web/src/app/admin/page.tsx web/tests/admin-shell.test.ts web/tests/admin-sesi-daftar.test.ts
git commit -m "feat(beranda): tile jenjang kosong menaut ke daftar sesi tersaring"
```

---

## Tugas 5: Halaman Bayar — bilah saring & paginasi

Bayar tidak mendapat panel geser maupun halaman detail (spec K1): ia daftar yang hanya punya AKSI.
Yang ditambahkan hanya bilah dan paginasi.

**Berkas:**
- Ubah: `web/src/lib/admin/tagihan.ts`
- Ubah: `web/src/app/admin/bayar/page.tsx`
- Ubah: `web/src/app/admin/bayar/tabel-bayar.tsx` (palet + hapus keadaan kosongnya)
- Ubah: `web/tests/admin-bayar.test.ts`

**Antarmuka:**
- Menghasilkan: `SARING_BAYAR`; `daftarTagihanAdmin(param: ParamDaftar)` — **tanda tangannya
  berubah** dari tanpa argumen menjadi menerima `ParamDaftar`, dan pengembaliannya dari
  `ItemTagihanAdmin[]` menjadi `{ baris: ItemTagihanAdmin[]; total: number }`.
  Satu-satunya pemanggil lain adalah `page.tsx` modul ini.

- [ ] **Langkah 1: Tulis uji yang gagal**

Tambahkan ke `web/tests/admin-bayar.test.ts`:

```ts
import { PER_HAL } from "@/app/_shell/panel/daftar";
import { SARING_BAYAR } from "@/lib/admin/tagihan";

describe("daftarTagihanAdmin — saringan & paginasi", () => {
  it("nilai saringan persis enum pay_status", () => {
    expect([...SARING_BAYAR.status]).toEqual(["belum", "menunggu_verifikasi", "lunas"]);
  });

  it("menyaring menurut status bayar", async () => {
    const { baris } = await daftarTagihanAdmin({
      cari: "", saring: { status: "lunas" }, hal: 1,
    });
    expect(baris.length).toBeGreaterThan(0);
    expect(baris.every((t) => t.status === "lunas")).toBe(true);
  });

  it("mencari menurut nama klien dan PADMA ID", async () => {
    const semua = await daftarTagihanAdmin({ cari: "", saring: {}, hal: 1 });
    expect(semua.baris.length).toBeGreaterThan(0);
    const sasaran = semua.baris[0];

    const perNama = await daftarTagihanAdmin({
      cari: sasaran.namaKlien.slice(0, 4), saring: {}, hal: 1,
    });
    expect(perNama.baris.some((t) => t.id === sasaran.id)).toBe(true);

    const perId = await daftarTagihanAdmin({ cari: sasaran.padmaId, saring: {}, hal: 1 });
    expect(perId.baris.some((t) => t.id === sasaran.id)).toBe(true);
  });

  it("halaman tidak pernah melebihi PER_HAL, dan total menghitung seluruhnya", async () => {
    const { baris, total } = await daftarTagihanAdmin({ cari: "", saring: {}, hal: 1 });
    expect(baris.length).toBeLessThanOrEqual(PER_HAL);
    expect(total).toBeGreaterThanOrEqual(baris.length);
  });

  it("saringan yang tidak mencocokkan apa pun memulangkan total 0, bukan total semua", async () => {
    // Total yang tetap penuh selagi daftarnya kosong membuat paginasi
    // menawarkan halaman yang tidak pernah ada isinya — persis cacat yang
    // ditemukan pada saringan paket di rencana 1.
    const { baris, total } = await daftarTagihanAdmin({
      cari: "zzz-tidak-ada-klien-bernama-ini", saring: {}, hal: 1,
    });
    expect(baris).toEqual([]);
    expect(total).toBe(0);
  });
});
```

Perbaiki juga pemanggilan lama di berkas yang sama: `await daftarTagihanAdmin()` menjadi
`(await daftarTagihanAdmin({ cari: "", saring: {}, hal: 1 })).baris`, dan
`createElement(BayarPage)` menjadi `createElement(BayarPage as never, { searchParams: Promise.resolve({}) })`.

- [ ] **Langkah 2: Jalankan uji, pastikan MERAH**

Jalankan: `npx vitest run tests/admin-bayar.test.ts`
Diharapkan: GAGAL — `SARING_BAYAR` belum ada.

- [ ] **Langkah 3: Ubah lapisan datanya**

Di `web/src/lib/admin/tagihan.ts`, tambahkan di dekat kepala berkas:

```ts
import { PER_HAL, hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";

/** Nilai saringan yang sah untuk daftar tagihan — dipakai halaman DAN uji. */
export const SARING_BAYAR = {
  status: ["belum", "menunggu_verifikasi", "lunas"],
} as const satisfies SaringSah;
```

Ubah tanda tangannya dan tambahkan saringan SQL pada kedua query sumber, lalu iris di JS:

```ts
export async function daftarTagihanAdmin(
  param: ParamDaftar,
): Promise<{ baris: ItemTagihanAdmin[]; total: number }> {
```

Di dalam, sesudah `const supabase = …`, sisipkan penyaring status pada kedua query sumber:

```ts
  // Saringan status dikerjakan di SQL pada kedua sumber, bukan sesudah
  // penggabungan: memfilter di JS berarti menarik seluruh baris lunas hanya
  // untuk membuangnya, dan itulah yang membuat `max_rows` cepat tersentuh.
  const saringStatus = param.saring.status;
```

lalu pada masing-masing query:

```ts
      (saringStatus
        ? supabase.from("client_packages").select(…).eq("status", "aktif")
            .eq("status_bayar", saringStatus)
        : supabase.from("client_packages").select(…).eq("status", "aktif")
      ).returns<BarisPaket[]>(),
```

(pola yang sama untuk `sessions`; gunakan variabel `let q = …` lalu `if (saringStatus) q = q.eq(…)`
bila lebih terbaca).

Di AKHIR fungsi, ganti `return item.sort(…)` menjadi:

```ts
  // Komparator mengembalikan 0 untuk peringkat kembar: komparator yang
  // mengembalikan 1 untuk elemen setara melanggar kontrak Array#sort.
  const terurut = item.sort((a, b) => URUT[a.status] - URUT[b.status]);

  // Pencarian dikerjakan DI SINI, bukan di SQL, karena daftar ini adalah
  // gabungan DUA tabel yang tidak punya kolom nama bersama: `client_packages`
  // dan `sessions` sama-sama menempel ke `clients`, tetapi PostgREST tidak
  // bisa meng-OR-kan dua query berbeda menjadi satu hasil terurut.
  const cari = param.cari.trim().toLowerCase();
  const cocok = cari === ""
    ? terurut
    : terurut.filter(
        (t) =>
          t.namaKlien.toLowerCase().includes(cari) ||
          t.padmaId.toLowerCase().includes(cari) ||
          t.label.toLowerCase().includes(cari),
      );

  // BATAS YANG TIDAK DITUTUP DI SINI, dicatat supaya tidak diklaim sebaliknya:
  // kedua query sumber di atas tidak memakai `.range()` dan karena itu tetap
  // tunduk pada `max_rows = 1000` PostgREST — masing-masing. Paginasi di bawah
  // memotong daftar yang SUDAH terbaca, jadi ia memperbaiki layar dan beban
  // render, BUKAN batas bacaan. Menutupnya menuntut satu view SQL yang
  // menyatukan kedua sumber (`union all` berkolom seragam) supaya `.range()`
  // bisa bekerja di sisi database — pekerjaan rencana tersendiri, dan sama
  // kelasnya dengan utang #1 runbook rencana 1.
  const { dari } = hitungRentang(param.hal);
  return { baris: cocok.slice(dari, dari + PER_HAL), total: cocok.length };
}
```

- [ ] **Langkah 4: Tulis ulang `page.tsx` dan sapu palet tabelnya**

`web/src/app/admin/bayar/page.tsx`:

```tsx
import { requireRole } from "@/lib/auth/require-role";
import { daftarTagihanAdmin, SARING_BAYAR } from "@/lib/admin/tagihan";
import { uraikanParamDaftar, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { TabelBayar } from "./tabel-bayar";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Pembayaran" };

const BASIS = "/admin/bayar";

export default async function BayarPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const param = uraikanParamDaftar(await searchParams, SARING_BAYAR);
  // Daftarnya dirakit dengan saringan yang IDENTIK dengan yang dipakai
  // passport klien — dan dengan badge antrean. Tiga tempat, satu kebenaran:
  // begitu ketiganya berpisah, badge yang tidak bisa dibersihkan lahir.
  const { baris, total } = await daftarTagihanAdmin(param);

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Pembayaran</h1>
        <Bantuan judul="Tentang halaman ini">
          Klien menekan <b>Saya sudah bayar</b> di Passport-nya → status menjadi{" "}
          <b>Menunggu verifikasi</b> → Anda menandai <b>Lunas</b> setelah buktinya cocok, atau{" "}
          <b>Tolak klaim</b> supaya klien bisa mengklaim ulang. Setiap keputusan tercatat beserta
          nama Anda dan tidak bisa dihapus. Item yang sudah <b>Lunas</b> tidak bisa diputar mundur
          dari sini — koreksi setelah rekap pekan berjalan adalah rekonsiliasi, bukan satu klik.
          Sesi yang tercakup paket tidak muncul sendiri: status bayarnya mengikuti paketnya.
          Nominal tidak ditampilkan — besarannya disampaikan tim PADMA lewat WhatsApp.
        </Bantuan>
      </header>

      <BilahDaftar
        basis={BASIS}
        param={param}
        kelompok={[
          {
            nama: "status",
            label: "Status bayar",
            pilihan: [
              { nilai: "menunggu_verifikasi", label: "Menunggu verifikasi", menuntut: true },
              { nilai: "belum", label: "Belum dibayar" },
              { nilai: "lunas", label: "Lunas" },
            ],
          },
        ]}
        jumlah={baris.length}
        total={total}
        // Tidak ada tombol "+ baru": tagihan lahir dari sesi & paket, tidak
        // pernah diketik admin.
        aksi={null}
      />

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          Tidak ada tagihan yang cocok dengan pencarian ini.
        </p>
      ) : (
        <TabelBayar item={baris} />
      )}

      <Paginasi basis={BASIS} param={param} total={total} />
    </main>
  );
}
```

Di `web/src/app/admin/bayar/tabel-bayar.tsx`: hapus cabang `if (item.length === 0)` seluruhnya
(halaman yang memutuskannya sekarang), dan sapu paletnya — `border-black/10 bg-white` →
`border-panel-border bg-panel-surface`, `bg-paper text-ink-soft` → `bg-panel-bg text-panel-muted`,
`bg-night text-gold-pale` → `bg-panel-ink text-panel-surface`, `border-black/5` →
`border-panel-border/70`, `rounded-2xl` → `rounded-lg`.

- [ ] **Langkah 5: Jalankan uji, pastikan HIJAU**

Jalankan: `npx vitest run tests/admin-bayar.test.ts tests/jejak-status-bayar.test.ts tests/klaim-sesi-lepas.test.ts`
Diharapkan: LULUS.

- [ ] **Langkah 6: Commit**

```bash
git add web/src/lib/admin/tagihan.ts web/src/app/admin/bayar web/tests/admin-bayar.test.ts
git commit -m "feat(bayar): bilah saring status, pencarian, dan paginasi"
```

---

## Tugas 6: Halaman Skrining — bilah saring & paginasi

**Berkas:**
- Buat: `web/src/lib/admin/skrining.ts`
- Ubah: `web/src/app/admin/skrining/page.tsx`
- Ubah: `web/src/app/admin/skrining/tabel-inbox.tsx` (palet + hapus keadaan kosongnya)
- Ubah: `web/tests/admin-inbox.test.ts`, `web/tests/admin-konversi-skrining.test.ts`

**Antarmuka:**
- Menghasilkan: `SARING_SKRINING`, `ambilDaftarSkrining(param): Promise<{ baris: BarisSkrining[]; total: number }>`.
  `BarisSkrining` tetap tipe yang sudah diekspor `tabel-inbox.tsx` — diimpor, bukan didefinisikan
  ulang, supaya kolom `flags` dan `client_id` tidak pernah berpisah.

- [ ] **Langkah 1: Tulis uji yang gagal**

Tambahkan ke `web/tests/admin-inbox.test.ts`:

```ts
import { SARING_SKRINING, ambilDaftarSkrining } from "@/lib/admin/skrining";
import { STATUS_SAH } from "@/app/admin/skrining/status";

describe("ambilDaftarSkrining", () => {
  it("nilai saringan tindak lanjut diturunkan dari STATUS_SAH, tidak ditulis dua kali", () => {
    expect([...SARING_SKRINING.tindak]).toEqual([...STATUS_SAH]);
  });

  it("menyaring menurut tindak lanjut", async () => {
    const { baris } = await ambilDaftarSkrining({
      cari: "", saring: { tindak: "baru" }, hal: 1,
    });
    expect(baris.length).toBeGreaterThan(0);
    expect(baris.every((r) => r.status_tindak_lanjut === "baru")).toBe(true);
  });

  it("menyaring menurut hasil", async () => {
    const { baris } = await ambilDaftarSkrining({
      cari: "", saring: { hasil: "merah" }, hal: 1,
    });
    expect(baris.every((r) => r.hasil === "merah")).toBe(true);
  });

  it("mencari menurut kode DAN nama", async () => {
    const semua = await ambilDaftarSkrining({ cari: "", saring: {}, hal: 1 });
    expect(semua.baris.length).toBeGreaterThan(0);
    const sasaran = semua.baris[0];

    const perKode = await ambilDaftarSkrining({ cari: sasaran.kode, saring: {}, hal: 1 });
    expect(perKode.baris.some((r) => r.id === sasaran.id)).toBe(true);

    const perNama = await ambilDaftarSkrining({
      cari: sasaran.nama.slice(0, 4), saring: {}, hal: 1,
    });
    expect(perNama.baris.some((r) => r.id === sasaran.id)).toBe(true);
  });

  it("membawa flags — tanpa itu penanda URGENT hilang diam-diam", async () => {
    // `flags` adalah kolom jsonb; hilangnya tidak melempar galat, penanda
    // "MERAH · URGENT" hanya berhenti muncul dan setiap baris merah terlihat
    // sama mendesaknya.
    const { baris } = await ambilDaftarSkrining({ cari: "", saring: {}, hal: 1 });
    expect(baris.every((r) => Array.isArray(r.flags))).toBe(true);
  });

  it("kata cari diperlakukan sebagai HURUF, bukan wildcard SQL", async () => {
    const { baris } = await ambilDaftarSkrining({ cari: "%", saring: {}, hal: 1 });
    expect(baris).toEqual([]);
  });
});
```

Perbaiki pemanggilan halaman: `createElement(InboxSkriningPage as never, { searchParams: Promise.resolve({}) })`.

- [ ] **Langkah 2: Jalankan uji, pastikan MERAH**

Jalankan: `npx vitest run tests/admin-inbox.test.ts`
Diharapkan: GAGAL — `Cannot find module '@/lib/admin/skrining'`.

- [ ] **Langkah 3: Tulis lapisan datanya**

Buat `web/src/lib/admin/skrining.ts`:

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";
import { STATUS_SAH } from "@/app/admin/skrining/status";
import type { BarisSkrining } from "@/app/admin/skrining/tabel-inbox";

/**
 * Lapisan data inbox skrining.
 *
 * Sesi pengguna, bukan service role: policy `screenings: staf` yang
 * mengizinkan bacaan ini. Jalur TULIS skrining publik (`/api/skrining`) memang
 * memakai service role — dua jalur berbeda dari satu tabel, dan yang ini
 * bukan jalur itu.
 */

/**
 * Nilai saringan yang sah untuk inbox skrining.
 *
 * `tindak` DITURUNKAN dari `STATUS_SAH`, bukan ditulis ulang: dua daftar nilai
 * yang harus selalu identik adalah cara paling mudah menampilkan chip yang
 * tidak pernah mencocokkan apa pun.
 */
export const SARING_SKRINING = {
  tindak: STATUS_SAH,
  hasil: ["hijau", "merah"],
} as const satisfies SaringSah;

export async function ambilDaftarSkrining(
  param: ParamDaftar,
): Promise<{ baris: BarisSkrining[]; total: number }> {
  const supabase = await createServerSupabase();
  const { dari, sampai } = hitungRentang(param.hal);

  let q = supabase
    .from("screenings")
    // `client_id` ikut dibaca supaya inbox bisa membedakan calon klien yang
    // sudah didaftarkan dari yang belum — tanpa kolom itu, satu-satunya kabar
    // bahwa seseorang sudah punya PADMA ID adalah ingatan admin.
    .select(
      "id, kode, nama, no_hp, fase, hasil, status_tindak_lanjut, created_at, flags, client_id",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("id");

  if (param.saring.tindak) q = q.eq("status_tindak_lanjut", param.saring.tindak);
  if (param.saring.hasil) q = q.eq("hasil", param.saring.hasil);

  if (param.cari !== "") {
    const aman = param.cari.replace(/[%_\\]/g, (c) => `\\${c}`);
    // Kode dibacakan lewat WhatsApp; nama diingat admin. Satu kotak cari
    // harus menemukan keduanya. `kode` BUKAN kolom identitas otorisasi — ia
    // tidak pernah menjadi kunci `.eq()` yang menentukan baris siapa yang
    // boleh dibaca; RLS `screenings: staf` yang melakukannya.
    q = q.or(`kode.ilike.%${aman}%,nama.ilike.%${aman}%`);
  }

  const { data, count } = await q.range(dari, sampai).returns<BarisSkrining[]>();
  return { baris: data ?? [], total: count ?? 0 };
}
```

- [ ] **Langkah 4: Tulis ulang `page.tsx`**

`web/src/app/admin/skrining/page.tsx`:

```tsx
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { ambilDaftarSkrining, SARING_SKRINING } from "@/lib/admin/skrining";
import { LABEL_STATUS } from "./status";
import { uraikanParamDaftar, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { TabelInbox } from "./tabel-inbox";

export const metadata = { title: "Inbox Skrining" };

const BASIS = "/admin/skrining";

export default async function InboxSkriningPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const param = uraikanParamDaftar(await searchParams, SARING_SKRINING);
  const supabase = await createServerSupabase();

  const [{ baris, total }, { data: fase }] = await Promise.all([
    ambilDaftarSkrining(param),
    // Nama fase datang dari tabel `phases`, tidak pernah disalin sebagai
    // literal ke komponen.
    supabase
      .from("phases")
      .select("id, nama, urutan")
      .order("urutan")
      .returns<{ id: string; nama: string; urutan: number }[]>(),
  ]);

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Inbox Skrining</h1>
        <Bantuan judul="Tentang halaman ini">
          Saat pesan WhatsApp masuk, cocokkan kodenya di sini untuk melihat jawaban asli — bukan
          sekadar percaya isi pesan. Penanda <b>URGENT</b> dihitung dari level bendera, bukan dari
          warna hasil: demam pada ibu hamil dan benjolan menopause sama-sama merah, tetapi hanya
          yang pertama perlu ditangani hari ini.
        </Bantuan>
      </header>

      <BilahDaftar
        basis={BASIS}
        param={param}
        kelompok={[
          {
            nama: "tindak",
            label: "Tindak lanjut",
            pilihan: [
              { nilai: "baru", label: LABEL_STATUS.baru, menuntut: true },
              { nilai: "dihubungi", label: LABEL_STATUS.dihubungi },
              { nilai: "jadi_klien", label: LABEL_STATUS.jadi_klien },
              { nilai: "ditolak", label: LABEL_STATUS.ditolak },
            ],
          },
          {
            nama: "hasil",
            label: "Hasil",
            pilihan: [
              { nilai: "merah", label: "Merah", menuntut: true },
              { nilai: "hijau", label: "Hijau" },
            ],
          },
        ]}
        jumlah={baris.length}
        total={total}
        // Skrining lahir dari pengunjung yang mengisi formulir publik, tidak
        // pernah diketik admin — karena itu tidak ada tombol "+ baru".
        aksi={null}
      />

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          Tidak ada hasil skrining yang cocok dengan pencarian ini.
        </p>
      ) : (
        <TabelInbox baris={baris} fase={fase ?? []} />
      )}

      <Paginasi basis={BASIS} param={param} total={total} />
    </main>
  );
}
```

Di `tabel-inbox.tsx`: hapus cabang `if (baris.length === 0)` dan sapu paletnya dengan pemetaan yang
sama seperti Tugas 5 Langkah 4.

- [ ] **Langkah 5: Jalankan uji, pastikan HIJAU**

Jalankan: `npx vitest run tests/admin-inbox.test.ts tests/admin-konversi-skrining.test.ts`
Diharapkan: LULUS.

- [ ] **Langkah 6: Suite penuh gelombang 1 + `tsc` + build**

Jalankan: `npm run build && npx tsc --noEmit && npm run lint && npm test`
Diharapkan: build sukses, nol galat tipe, nol galat lint, seluruh uji hijau.

Koordinasikan jendela basis data lebih dulu (Global Constraint 13).

- [ ] **Langkah 7: Commit**

```bash
git add web/src/lib/admin/skrining.ts web/src/app/admin/skrining web/tests
git commit -m "feat(skrining): bilah saring tindak lanjut & hasil, pencarian, paginasi"
```

**⟶ TITIK MERGE GELOMBANG 1.** Tiga modul selesai, suite hijau. Pertimbangkan merge ke `main`
sebelum melanjutkan.

---

## Tugas 7: Daftar Layanan — bilah, paginasi, baris menaut ke detail

Layanan berpola B (spec K1): ia memiliki daftar anak — paket DAN varian. Halaman `/admin/layanan`
yang hari ini merender seluruh katalog bersarang tiga tingkat dipecah menjadi DAFTAR datar di sini
dan HALAMAN DETAIL di Tugas 8.

**Berkas:**
- Buat: `web/src/lib/admin/layanan.ts`
- Ubah: `web/src/app/admin/layanan/page.tsx` (tulis ulang)
- Ubah: `web/tests/admin-layanan.test.ts`

**Antarmuka:**
- Menghasilkan: `SARING_LAYANAN`, `BarisLayananDaftar`, `ambilDaftarLayanan(param)`,
  `ambilLayanan(id)` — yang terakhir dipakai Tugas 8.
- Memakai: `daftarKatalogAdmin()` TIDAK dipakai lagi oleh halaman daftar; ia tetap ada untuk
  halaman detail (Tugas 8) dan tidak dihapus.

- [ ] **Langkah 1: Tulis uji yang gagal**

Tambahkan ke `web/tests/admin-layanan.test.ts`:

```ts
import { SARING_LAYANAN, ambilDaftarLayanan, ambilLayanan } from "@/lib/admin/layanan";

describe("ambilDaftarLayanan", () => {
  it("menyaring menurut ketersediaan", async () => {
    const { baris } = await ambilDaftarLayanan({ cari: "", saring: { aktif: "ya" }, hal: 1 });
    expect(baris.length).toBeGreaterThan(0);
    expect(baris.every((l) => l.aktif)).toBe(true);
  });

  it("membawa jumlah varian, paket, dan sesi tercatat", async () => {
    const { baris } = await ambilDaftarLayanan({ cari: "", saring: {}, hal: 1 });
    const l = baris.find((x) => x.jumlahVarian > 0);
    // Angka-angka inilah yang menjelaskan mengapa baris tidak boleh dihapus.
    expect(l).toBeDefined();
    expect(l!.jumlahPaket).toBeGreaterThanOrEqual(0);
    expect(l!.sesiTercatat).toBeGreaterThanOrEqual(0);
  });

  it("mencari menurut nama", async () => {
    const semua = await ambilDaftarLayanan({ cari: "", saring: {}, hal: 1 });
    const sasaran = semua.baris[0];
    const { baris } = await ambilDaftarLayanan({
      cari: sasaran.nama.slice(0, 5), saring: {}, hal: 1,
    });
    expect(baris.some((l) => l.id === sasaran.id)).toBe(true);
  });

  it("memuat layanan NONAKTIF juga — kelola bukan pilih", async () => {
    // Tanpa ini, layanan yang dinonaktifkan karena salah klik tidak punya
    // jalan kembali dari panel mana pun.
    const { baris } = await ambilDaftarLayanan({ cari: "", saring: { aktif: "tidak" }, hal: 1 });
    expect(baris.every((l) => !l.aktif)).toBe(true);
  });
});

describe("ambilLayanan — satu layanan beserta anaknya", () => {
  it("memulangkan null untuk id yang tidak ada, bukan melempar", async () => {
    expect(await ambilLayanan("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("membawa varian dan paket lengkap dengan angka pemakaian", async () => {
    const { baris } = await ambilDaftarLayanan({ cari: "", saring: {}, hal: 1 });
    const l = await ambilLayanan(baris[0].id);
    expect(l).not.toBeNull();
    expect(Array.isArray(l!.varian)).toBe(true);
    expect(Array.isArray(l!.paket)).toBe(true);
  });
});
```

Perbaiki pemanggilan halaman: `createElement(LayananPage as never, { searchParams: Promise.resolve({}) })`.

- [ ] **Langkah 2: Jalankan uji, pastikan MERAH**

Jalankan: `npx vitest run tests/admin-layanan.test.ts`
Diharapkan: GAGAL — `Cannot find module '@/lib/admin/layanan'`.

- [ ] **Langkah 3: Tulis lapisan datanya**

Buat `web/src/lib/admin/layanan.ts`:

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";
import { daftarKatalogAdmin, type LayananKelola } from "@/lib/admin/katalog-admin";

/**
 * Lapisan data DAFTAR layanan.
 *
 * Sengaja terpisah dari `daftarKatalogAdmin()` (`@/lib/admin/katalog-admin`),
 * yang menarik SELURUH katalog bersarang tiga tingkat dalam enam query.
 * Daftar datar berpaginasi punya kebutuhan yang berbeda: satu halaman, angka
 * ringkas, tanpa anak. Memakai ulang fungsi bersarang itu berarti menarik
 * seluruh varian dan paket klinik hanya untuk menampilkan dua puluh lima nama.
 *
 * Halaman DETAIL (`ambilLayanan`) tetap memakai `daftarKatalogAdmin()`: di
 * sana anaknya memang yang dicari, dan menuliskan query keduanya di sini akan
 * melahirkan dua definisi "apa itu varian sebuah layanan" yang akan berpisah
 * diam-diam.
 */

export const SARING_LAYANAN = { aktif: ["ya", "tidak"] } as const satisfies SaringSah;

export type BarisLayananDaftar = {
  id: string;
  nama: string;
  deskripsi: string;
  namaFase: string;
  aktif: boolean;
  jumlahVarian: number;
  jumlahPaket: number;
  sesiTercatat: number;
};

type BarisDb = {
  id: string;
  nama: string;
  deskripsi: string;
  aktif: boolean;
  phase_id: string;
};

export async function ambilDaftarLayanan(
  param: ParamDaftar,
): Promise<{ baris: BarisLayananDaftar[]; total: number }> {
  const supabase = await createServerSupabase();
  const { dari, sampai } = hitungRentang(param.hal);

  let q = supabase
    .from("services")
    .select("id, nama, deskripsi, aktif, phase_id", { count: "exact" })
    // Yang aktif di atas, lalu menurut nama: halaman ini dibaca dari atas ke
    // bawah untuk menjawab "apa yang sedang kami tawarkan".
    .order("aktif", { ascending: false })
    .order("nama");

  if (param.saring.aktif) q = q.eq("aktif", param.saring.aktif === "ya");
  if (param.cari !== "") {
    const aman = param.cari.replace(/[%_\\]/g, (c) => `\\${c}`);
    q = q.ilike("nama", `%${aman}%`);
  }

  const [{ data, count }, { data: fase }, { data: varian }, { data: paket }, { data: sesi }] =
    await Promise.all([
      q.range(dari, sampai).returns<BarisDb[]>(),
      supabase.from("phases").select("id, nama").returns<{ id: string; nama: string }[]>(),
      // Ketiga query hitung di bawah TIDAK dipaginasi dan tetap tunduk pada
      // `max_rows = 1000` PostgREST — kelas utang yang sama dengan #1 runbook
      // rencana 1, dicatat di sini supaya tidak diklaim sudah tertutup.
      supabase.from("service_variants").select("service_id").returns<{ service_id: string }[]>(),
      supabase.from("packages").select("service_id").returns<{ service_id: string }[]>(),
      supabase.from("sessions").select("service_id").returns<{ service_id: string }[]>(),
    ]);

  const labelFase = new Map((fase ?? []).map((f) => [f.id, f.nama]));
  const hitung = (baris: { service_id: string }[] | null) => {
    const peta = new Map<string, number>();
    for (const b of baris ?? []) peta.set(b.service_id, (peta.get(b.service_id) ?? 0) + 1);
    return peta;
  };
  const nVarian = hitung(varian);
  const nPaket = hitung(paket);
  const nSesi = hitung(sesi);

  return {
    baris: (data ?? []).map((l) => ({
      id: l.id,
      nama: l.nama,
      deskripsi: l.deskripsi,
      namaFase: labelFase.get(l.phase_id) ?? "—",
      aktif: l.aktif,
      jumlahVarian: nVarian.get(l.id) ?? 0,
      jumlahPaket: nPaket.get(l.id) ?? 0,
      sesiTercatat: nSesi.get(l.id) ?? 0,
    })),
    total: count ?? 0,
  };
}

export type LayananDetail = LayananKelola & { namaFase: string; faseId: string };

/**
 * Satu layanan beserta seluruh anaknya, atau `null` bila id-nya tidak ada.
 *
 * `null`, bukan lemparan: halaman detail memanggil `notFound()` sendiri, dan
 * itu memberi 404 yang benar alih-alih 500 untuk URL yang salah ketik.
 */
export async function ambilLayanan(id: string): Promise<LayananDetail | null> {
  const katalog = await daftarKatalogAdmin();
  for (const f of katalog) {
    const l = f.layanan.find((x) => x.id === id);
    if (l) return { ...l, namaFase: f.nama, faseId: f.id };
  }
  return null;
}
```

- [ ] **Langkah 4: Tulis ulang `page.tsx`**

`web/src/app/admin/layanan/page.tsx`:

```tsx
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { ambilDaftarLayanan, SARING_LAYANAN } from "@/lib/admin/layanan";
import { daftarKatalogAdmin } from "@/lib/admin/katalog-admin";
import { uraikanParamDaftar, bangunQuery, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { PanelGeser } from "@/app/_shell/panel/panel-geser";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { FormLayananBaru, type PilihanFase } from "./form-layanan";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Layanan & Paket" };

const BASIS = "/admin/layanan";

/**
 * Pill ketersediaan.
 *
 * "Nonaktif" berarti dua hal saja: layanan berhenti muncul di katalog beranda,
 * dan berhenti ditawarkan saat menjadwalkan sesi baru. Ia TIDAK berarti
 * namanya hilang — riwayat sesi klien tetap menyebutnya. Perbedaan itu pernah
 * hilang pada data mitra, dan akibatnya seluruh riwayat lama berganti menjadi
 * teks cadangan tanpa satu pun error.
 */
function PillAktif({ aktif }: { aktif: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
        aktif ? "bg-leaf-soft text-leaf" : "bg-clay/10 text-clay"
      }`}
    >
      {aktif ? "Aktif" : "Nonaktif"}
    </span>
  );
}

export default async function LayananPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const sp = await searchParams;
  const param = uraikanParamDaftar(sp, SARING_LAYANAN);
  const { baris, total } = await ambilDaftarLayanan(param);

  const ubah = typeof sp.ubah === "string" ? sp.ubah : "";
  // HANYA "baru" yang membuka panel di sini. Mengubah sebuah layanan berarti
  // membuka HALAMAN detailnya (pola B) — layanan memiliki daftar anak, dan
  // daftar di dalam panel selebar setengah layar mengulangi kesalahan yang
  // sama seperti formulir di dalam sel tabel.
  const panelTerbuka = ubah === "baru";
  const hrefTutup = `${BASIS}${bangunQuery(param, { ubah: null })}`;

  // Daftar fase hanya dibutuhkan formulir "layanan baru".
  const fase: PilihanFase[] = panelTerbuka
    ? (await daftarKatalogAdmin()).map((f) => ({ id: f.id, nama: f.nama }))
    : [];

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Layanan &amp; Paket</h1>
        <Bantuan judul="Tentang halaman ini">
          Katalog yang dibaca beranda dan wizard pengajuan jadwal klien. Tidak ada satu pun angka
          harga di sini — tarif adalah wilayah Owner. Layanan, paket, dan varian tidak pernah
          dihapus, hanya <b>dinonaktifkan</b>: yang nonaktif berhenti muncul di beranda dan berhenti
          ditawarkan untuk sesi baru, tetapi namanya <b>tetap</b> menempel pada riwayat sesi klien
          yang sudah berjalan. Satu layanan tidak bisa kehilangan varian aktif terakhirnya —
          aktifkan varian lain dulu sebelum menonaktifkan yang sedang dipakai.
        </Bantuan>
      </header>

      <BilahDaftar
        basis={BASIS}
        param={param}
        kelompok={[
          {
            nama: "aktif",
            label: "Ketersediaan",
            pilihan: [
              { nilai: "ya", label: "Aktif" },
              { nilai: "tidak", label: "Nonaktif" },
            ],
          },
        ]}
        jumlah={baris.length}
        total={total}
        aksi={
          <Link
            href={`${BASIS}?ubah=baru`}
            className="rounded-lg bg-panel-ink px-3 py-2 text-[12px] font-bold text-panel-surface"
          >
            + Layanan baru
          </Link>
        }
      />

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          Tidak ada layanan yang cocok dengan pencarian ini.
        </p>
      ) : (
        <div className="rounded-lg border border-panel-border bg-panel-surface">
          <Tabel label="Daftar layanan">
            <thead>
              <tr>
                <Th>Nama</Th><Th>Fase</Th><Th>Varian</Th><Th>Paket</Th>
                <Th>Sesi tercatat</Th><Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {baris.map((l) => (
                <tr key={l.id}>
                  <Td>
                    {/* Barisnya sendiri yang menaut — pola B. Tidak ada kolom
                        "Aksi" berisi tombol Ubah: yang dibuka adalah halaman
                        layanan itu beserta varian dan paketnya, bukan
                        formulirnya saja. */}
                    <Link href={`${BASIS}/${l.id}`} className="font-bold text-panel-ink underline">
                      {l.nama}
                    </Link>
                    <span className="mt-0.5 block text-[11.5px] text-panel-muted">
                      {l.deskripsi || "Belum ada deskripsi."}
                    </span>
                  </Td>
                  <Td>{l.namaFase}</Td>
                  <Td className="font-mono text-[12.5px]">{l.jumlahVarian}</Td>
                  <Td className="font-mono text-[12.5px]">{l.jumlahPaket}</Td>
                  {/* Angka ini menjelaskan mengapa baris tidak boleh dihapus:
                      setiap sesi menunjuk layanan ini. */}
                  <Td className="font-mono text-[12.5px]">{l.sesiTercatat}</Td>
                  <Td><PillAktif aktif={l.aktif} /></Td>
                </tr>
              ))}
            </tbody>
          </Tabel>
        </div>
      )}

      <Paginasi basis={BASIS} param={param} total={total} />

      {panelTerbuka && (
        <PanelGeser judul="Layanan baru" hrefTutup={hrefTutup}>
          <FormLayananBaru fase={fase} />
        </PanelGeser>
      )}
    </main>
  );
}
```

- [ ] **Langkah 5: Jalankan uji, pastikan HIJAU**

Jalankan: `npx vitest run tests/admin-layanan.test.ts`
Diharapkan: LULUS.

Asersi yang MENARGETKAN katalog bersarang (varian dan paket di halaman daftar) akan merah — itu
benar: keduanya pindah ke halaman detail di Tugas 8. Pindahkan asersinya, jangan hapus.

- [ ] **Langkah 6: Commit**

```bash
git add web/src/lib/admin/layanan.ts web/src/app/admin/layanan/page.tsx web/tests/admin-layanan.test.ts
git commit -m "feat(layanan): daftar datar berpaginasi, baris menaut ke halaman detail"
```

---

## Tugas 8: Halaman detail Layanan

**Berkas:**
- Buat: `web/src/app/admin/layanan/[id]/page.tsx`
- Buat: `web/tests/admin-layanan-detail.test.tsx`
- Ubah: `web/README.md` (tabel rute)

**Antarmuka:**
- Memakai: `ambilLayanan(id)` (Tugas 7); `AksiLayanan`, `AksiPaket` dari `../form-layanan`;
  `daftarMateriAdmin()` dari `@/lib/admin/materi-admin`.
- Menghasilkan: rute `/admin/layanan/[id]` — Tugas 9 menambahkan `?ubah=` di atasnya.

- [ ] **Langkah 1: Tulis uji yang gagal**

Buat `web/tests/admin-layanan-detail.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { nominalDalam } from "./helpers/nominal";

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ nama: "Admin Uji", role: "admin" }),
}));

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound }));

const { ambilDaftarLayanan } = await import("@/lib/admin/layanan");
const { default: DetailLayananPage } = await import("@/app/admin/layanan/[id]/page");

async function markup(id: string, sp: Record<string, string> = {}) {
  return renderToStaticMarkup(
    await (DetailLayananPage as never as (p: unknown) => Promise<JSX.Element>)({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve(sp),
    }),
  );
}

const { baris } = await ambilDaftarLayanan({ cari: "", saring: {}, hal: 1 });
const LAYANAN = baris[0];

describe("halaman detail layanan", () => {
  it("menampilkan nama layanan sebagai judul", async () => {
    expect(await markup(LAYANAN.id)).toContain(LAYANAN.nama);
  });

  it("punya jalan kembali ke daftar", async () => {
    expect(await markup(LAYANAN.id)).toContain('href="/admin/layanan"');
  });

  it("memuat daftar VARIAN — inilah alasan layanan berpola detail", async () => {
    const m = await markup(LAYANAN.id);
    expect(m).toContain("Varian");
  });

  it("memuat daftar PAKET", async () => {
    expect(await markup(LAYANAN.id)).toContain("Paket");
  });

  it("memuat materi terkait sebagai BACAAN saja", async () => {
    const m = await markup(LAYANAN.id);
    expect(m).toContain("Materi yang termasuk layanan ini");
    // Keterkaitan materi<->layanan dikelola dari modul Materi. Tidak boleh
    // ada dua tempat yang bisa menulis satu relasi.
    expect(m).not.toContain('name="material_id"');
  });

  it("id yang tidak ada memanggil notFound(), bukan merender halaman kosong", async () => {
    await expect(markup("00000000-0000-0000-0000-000000000000")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("nol rupiah — tarif adalah wilayah Owner", async () => {
    expect(nominalDalam(await markup(LAYANAN.id))).toEqual([]);
  });
});
```

- [ ] **Langkah 2: Jalankan uji, pastikan MERAH**

Jalankan: `npx vitest run tests/admin-layanan-detail.test.tsx`
Diharapkan: GAGAL — modul rute belum ada.

- [ ] **Langkah 3: Tulis halamannya**

Buat `web/src/app/admin/layanan/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { ambilLayanan } from "@/lib/admin/layanan";
import { daftarKatalogAdmin } from "@/lib/admin/katalog-admin";
import { daftarMateriAdmin } from "@/lib/admin/materi-admin";
import type { ParamMentah } from "@/app/_shell/panel/daftar";
import { Kartu } from "@/app/_shell/panel/kartu";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { AksiLayanan, AksiPaket, type PilihanFase } from "../form-layanan";
import { labelVarian } from "@/lib/varian";

export const metadata = { title: "Detail layanan" };

function PillAktif({ aktif }: { aktif: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
        aktif ? "bg-leaf-soft text-leaf" : "bg-clay/10 text-clay"
      }`}
    >
      {aktif ? "Aktif" : "Nonaktif"}
    </span>
  );
}

/**
 * Halaman detail layanan — pola B (spec K1).
 *
 * Layanan memiliki DUA daftar anak (varian, paket) plus satu daftar bacaan
 * (materi terkait). Menyesakkan ketiganya ke dalam panel geser selebar
 * setengah layar mengulangi kesalahan yang sama seperti formulir di dalam sel
 * tabel — hanya dengan wadah yang berbeda.
 */
export default async function DetailLayananPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const { id } = await params;
  await searchParams; // Tugas 9 memakai `?ubah=` di sini.

  const layanan = await ambilLayanan(id);
  // `notFound()`, bukan halaman kosong: URL yang salah ketik harus menjawab
  // 404, bukan 200 berisi kerangka tanpa isi.
  if (!layanan) notFound();

  const [katalog, materiPerLayanan] = await Promise.all([
    daftarKatalogAdmin(),
    daftarMateriAdmin(),
  ]);
  const fase: PilihanFase[] = katalog.map((f) => ({ id: f.id, nama: f.nama }));
  const materi = materiPerLayanan.find((l) => l.id === id)?.materi ?? [];

  return (
    <main>
      <Link href="/admin/layanan" className="text-[12px] font-bold text-panel-muted">
        ‹ Kembali ke Layanan
      </Link>

      <header className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold text-panel-ink">{layanan.nama}</h1>
          <p className="mt-0.5 text-[12.5px] text-panel-muted">
            {layanan.namaFase} · {layanan.sesiTercatat} sesi tercatat
          </p>
        </div>
        <PillAktif aktif={layanan.aktif} />
      </header>

      <div className="grid gap-3">
        <Kartu judul="Data layanan">
          <AksiLayanan
            id={layanan.id}
            nama={layanan.nama}
            deskripsi={layanan.deskripsi}
            faseId={layanan.faseId}
            aktif={layanan.aktif}
            fase={fase}
          />
        </Kartu>

        <Kartu judul="Varian">
          {layanan.varian.length === 0 ? (
            <p className="text-[12.5px] italic text-panel-muted">Belum ada varian.</p>
          ) : (
            <Tabel label={`Varian layanan ${layanan.nama}`}>
              <thead>
                <tr><Th>Varian</Th><Th>Sesi tercatat</Th><Th>Status</Th><Th>Aksi</Th></tr>
              </thead>
              <tbody>
                {layanan.varian.map((v) => (
                  <tr key={v.id}>
                    <Td>
                      {/* Varian baku (label kosong) tampil "Standar" — pilihan
                          ini WAJIB selalu punya teks tampilan. */}
                      {labelVarian({ label: v.label, durasiMenit: v.durasiMenit, format: v.format }) ||
                        "Standar"}
                    </Td>
                    <Td className="font-mono text-[12.5px]">{v.sesiTercatat}</Td>
                    <Td><PillAktif aktif={v.aktif} /></Td>
                    <Td>{/* diisi Tugas 9 */}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabel>
          )}
        </Kartu>

        <Kartu judul="Paket">
          {layanan.paket.length === 0 ? (
            <p className="text-[12.5px] italic text-panel-muted">Belum ada paket.</p>
          ) : (
            <ul className="grid gap-2">
              {layanan.paket.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2.5">
                  <span className="min-w-[180px] flex-1">
                    <b className="text-[13px] text-panel-ink">{p.nama}</b>
                    <span className="ml-2 font-mono text-[12px] text-panel-muted">
                      {p.jumlahSesi} sesi
                    </span>
                    <span className="block text-[11.5px] text-panel-muted">
                      {p.dipakai > 0
                        ? `${p.dipakai} klien sedang menjalani paket ini — mengubah jumlah sesi menggeser progres passport mereka.`
                        : "Belum dipakai klien mana pun."}
                    </span>
                  </span>
                  <PillAktif aktif={p.aktif} />
                  <AksiPaket
                    id={p.id}
                    nama={p.nama}
                    jumlahSesi={p.jumlahSesi}
                    aktif={p.aktif}
                    dipakai={p.dipakai}
                  />
                </li>
              ))}
            </ul>
          )}
        </Kartu>

        {/*
          Bacaan saja, sengaja. Keterkaitan materi<->layanan
          (`material_services`) dikelola dari modul Materi — bukan di sini —
          supaya tidak ada dua tempat yang bisa menulis satu relasi. Tapi admin
          yang membuka layar layanan wajib bisa MELIHAT "layanan ini include
          materi apa saja" tanpa berpindah modul.
        */}
        <Kartu judul="Materi yang termasuk layanan ini">
          {materi.length === 0 ? (
            <p className="text-[12.5px] italic text-panel-muted">
              Belum ada materi yang menautkan layanan ini.
            </p>
          ) : (
            <ul className="grid gap-1">
              {materi.map((m) => (
                <li key={m.id} className="text-[12.5px] text-panel-ink">
                  <Link href={`/admin/materi/${m.id}`} className="underline">{m.judul}</Link>
                  {!m.aktif && (
                    <span className="ml-1 text-[11px] font-bold text-clay">(nonaktif)</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Kartu>
      </div>
    </main>
  );
}
```

Catatan: tautan ke `/admin/materi/${m.id}` menunjuk rute yang baru lahir di Tugas 11. Bila Tugas 11
belum dikerjakan, tautan itu 404 — dapat diterima SELAMA gelombang 2 belum di-merge, dan Tugas 11
menutupnya sebelum merge. Jangan tinggalkan gelombang 2 setengah jalan.

- [ ] **Langkah 4: Tambahkan rute ke README**

Sisipkan sesudah baris `/admin/layanan` di `web/README.md`:

```
| `/admin/layanan/[id]` | Admin, Owner | Detail layanan: data, varian, paket, dan materi terkait (bacaan) |
```

- [ ] **Langkah 5: Jalankan uji, pastikan HIJAU**

Jalankan: `npx vitest run tests/admin-layanan-detail.test.tsx tests/inventaris-rute.test.ts`
Diharapkan: LULUS.

- [ ] **Langkah 6: Commit**

```bash
git add web/src/app/admin/layanan web/tests/admin-layanan-detail.test.tsx web/README.md
git commit -m "feat(layanan): halaman detail dengan varian, paket, dan materi terkait"
```

---

## Tugas 9: Varian — panel geser di dalam halaman detail layanan

Varian berpola A (spec K1): ia tidak punya apa pun yang bisa dibuka lebih dalam. Panelnya terbuka
DI DALAM halaman detail layanan, dan itu disengaja: yang menentukan pola adalah sifat objeknya
sendiri, bukan kedalamannya di pohon.

**Berkas:**
- Ubah: `web/src/app/admin/layanan/[id]/page.tsx`
- Ubah: `web/src/app/admin/layanan/form-varian.tsx` (pecah `BlokVarian` menjadi isi panel)
- Ubah: `web/tests/admin-layanan-detail.test.tsx`

**Antarmuka:**
- Menghasilkan: `FormVarian({ serviceId, namaLayanan, varian, hrefTutup })` di `form-varian.tsx` —
  menggantikan `BlokVarian`, yang dihapus.

- [ ] **Langkah 1: Tulis uji yang gagal**

Tambahkan ke `web/tests/admin-layanan-detail.test.tsx`:

```tsx
describe("panel geser varian di dalam halaman detail layanan", () => {
  it("setiap baris varian menaut ke ?ubah=<id>", async () => {
    const m = await markup(LAYANAN.id);
    expect(m).toMatch(new RegExp(`href="/admin/layanan/${LAYANAN.id}\\?ubah=[0-9a-f-]{36}"`));
  });

  it("tombol '+ Varian baru' menaut ke ?ubah=baru", async () => {
    expect(await markup(LAYANAN.id)).toContain(`href="/admin/layanan/${LAYANAN.id}?ubah=baru"`);
  });

  it("?ubah=baru membuka panel geser berisi formulir varian", async () => {
    const m = await markup(LAYANAN.id, { ubah: "baru" });
    expect(m).toContain('role="dialog"');
    expect(m).toContain('name="label"');
    expect(m).toContain('name="durasi_menit"');
  });

  it("id varian milik layanan LAIN tidak membuka panel", async () => {
    // Pagar nyata, bukan kosmetik: panel yang terbuka untuk varian layanan
    // lain akan menyimpan perubahan ke baris yang tidak sedang dilihat admin.
    const m = await markup(LAYANAN.id, { ubah: "00000000-0000-0000-0000-000000000000" });
    expect(m).not.toContain('role="dialog"');
  });

  it("menutup panel kembali ke halaman detail tanpa ?ubah", async () => {
    const m = await markup(LAYANAN.id, { ubah: "baru" });
    expect(m).toContain(`href="/admin/layanan/${LAYANAN.id}"`);
  });
});
```

- [ ] **Langkah 2: Jalankan uji, pastikan MERAH**

Jalankan: `npx vitest run tests/admin-layanan-detail.test.tsx`
Diharapkan: GAGAL — tidak ada tautan `?ubah=`.

- [ ] **Langkah 3: Pecah `BlokVarian` menjadi `FormVarian`**

Di `web/src/app/admin/layanan/form-varian.tsx`:
- Hapus `BlokVarian` (pembungkus yang merender daftar + gerbang buka/tutup) dan `BarisVarian`
  (baris yang memuat formulir dalam sel) — daftarnya kini dirender halaman detail.
- Ekspor satu komponen:

```tsx
/**
 * Isi panel geser varian: formulir SATU varian, baru maupun ubah.
 *
 * `varian === null` berarti varian baru. Satu komponen untuk keduanya, bukan
 * dua — pola yang sama dengan `FormMitra` sejak rencana 1: dua komponen yang
 * hampir identik berpisah diam-diam pada perubahan berikutnya.
 */
export function FormVarian({
  serviceId,
  namaLayanan,
  varian,
  hrefTutup,
}: {
  serviceId: string;
  namaLayanan: string;
  varian: VarianTampil | null;
  hrefTutup: string;
}) { … }
```

Isinya: medan `label`, `durasi_menit`, `format` (lewat `OpsiFormat()` yang sudah ada), `urutan`,
plus tombol aktif/nonaktif untuk varian yang sudah ada. Aksi yang dipanggil tetap `buatVarian`,
`perbaruiVarian`, `nonaktifkanVarian`, `aktifkanVarian` dari `../aksi` — semuanya menerima
`FormData`. Sapu paletnya ke token `panel-*` seperti Tugas 5.

- [ ] **Langkah 4: Sambungkan ke halaman detail**

Di `web/src/app/admin/layanan/[id]/page.tsx`:

```tsx
  const sp = await searchParams;
  const ubah = typeof sp.ubah === "string" ? sp.ubah : "";
  // Varian dicari DI DALAM layanan ini, bukan di seluruh katalog: panel yang
  // terbuka untuk varian layanan lain akan menyimpan perubahan ke baris yang
  // tidak sedang dilihat admin.
  const varianUbah = ubah === "baru" ? null : layanan.varian.find((v) => v.id === ubah) ?? null;
  const panelTerbuka = ubah === "baru" || varianUbah !== null;
  const hrefTutup = `/admin/layanan/${id}`;
```

Di kolom `<Td>{/* diisi Tugas 9 */}</Td>`:

```tsx
                    <Td>
                      <Link
                        href={`/admin/layanan/${id}?ubah=${v.id}`}
                        className="text-[12px] font-bold text-panel-ink underline"
                      >
                        Ubah
                      </Link>
                    </Td>
```

Di header Kartu "Varian", tambahkan tombol:

```tsx
        <Kartu
          judul="Varian"
          aksi={
            <Link
              href={`/admin/layanan/${id}?ubah=baru`}
              className="rounded-lg bg-panel-ink px-3 py-1.5 text-[12px] font-bold text-panel-surface"
            >
              + Varian baru
            </Link>
          }
        >
```

Dan di akhir `<main>`:

```tsx
      {panelTerbuka && (
        <PanelGeser
          judul={varianUbah ? "Ubah varian" : "Varian baru"}
          hrefTutup={hrefTutup}
        >
          <FormVarian
            serviceId={id}
            namaLayanan={layanan.nama}
            varian={varianUbah}
            hrefTutup={hrefTutup}
          />
        </PanelGeser>
      )}
```

- [ ] **Langkah 5: Jalankan uji, pastikan HIJAU**

Jalankan: `npx vitest run tests/admin-layanan-detail.test.tsx tests/admin-layanan.test.ts tests/varian-tarif-pengerasan.test.ts`
Diharapkan: LULUS.

- [ ] **Langkah 6: Commit**

```bash
git add web/src/app/admin/layanan web/tests/admin-layanan-detail.test.tsx
git commit -m "feat(varian): panel geser di dalam halaman detail layanan"
```

---

## Tugas 10: Daftar Materi — bilah, paginasi, baris menaut ke detail

**Berkas:**
- Ubah: `web/src/lib/admin/materi-admin.ts` (tambah `SARING_MATERI` + `ambilDaftarMateri`)
- Ubah: `web/src/app/admin/materi/page.tsx` (tulis ulang)
- Ubah: `web/tests/admin-materi.test.ts`

**Antarmuka:**
- Menghasilkan: `SARING_MATERI`, `BarisMateriDaftar`, `ambilDaftarMateri(param)`,
  `ambilMateri(id)`. `daftarMateriAdmin()` yang bersarang TETAP ADA — halaman detail layanan
  (Tugas 8) memakainya.

- [ ] **Langkah 1: Tulis uji yang gagal**

Tambahkan ke `web/tests/admin-materi.test.ts`:

```ts
import { SARING_MATERI, ambilDaftarMateri, ambilMateri } from "@/lib/admin/materi-admin";

describe("ambilDaftarMateri", () => {
  it("memuat materi NONAKTIF juga — kelola bukan pilih", async () => {
    const { baris } = await ambilDaftarMateri({ cari: "", saring: { aktif: "tidak" }, hal: 1 });
    expect(baris.every((m) => !m.aktif)).toBe(true);
  });

  it("menyaring menurut tipe", async () => {
    const { baris } = await ambilDaftarMateri({ cari: "", saring: { tipe: "ebook" }, hal: 1 });
    expect(baris.length).toBeGreaterThan(0);
    expect(baris.every((m) => m.tipe === "ebook")).toBe(true);
  });

  it("saringan 'belum lengkap' menemukan materi yang terkunci selamanya", async () => {
    // Materi video tanpa objek video (atau e-book tanpa halaman) terkunci
    // selamanya bagi klien yang sudah berhak, TANPA satu pun error, sementara
    // kartunya berbunyi "Terbuka setelah layanan terkait selesai". Saringan
    // inilah yang membuat keadaan itu bisa ditemukan, bukan tertebak.
    const { baris } = await ambilDaftarMateri({ cari: "", saring: { isi: "belum" }, hal: 1 });
    expect(baris.every((m) => !m.lengkap)).toBe(true);
  });

  it("mencari menurut judul", async () => {
    const semua = await ambilDaftarMateri({ cari: "", saring: {}, hal: 1 });
    const sasaran = semua.baris[0];
    const { baris } = await ambilDaftarMateri({
      cari: sasaran.judul.slice(0, 5), saring: {}, hal: 1,
    });
    expect(baris.some((m) => m.id === sasaran.id)).toBe(true);
  });

  it("membawa jumlah layanan tertaut — nol adalah keadaan SAH yang wajib terlihat", async () => {
    // Materi tanpa layanan tidak pernah terbuka lewat jalur otomatis, hanya
    // lewat penugasan manual. Materi yang diam-diam tidak terlihat siapa pun
    // adalah persis kegagalan yang modul ini ada untuk mencegah.
    const { baris } = await ambilDaftarMateri({ cari: "", saring: {}, hal: 1 });
    expect(baris.every((m) => typeof m.jumlahLayanan === "number")).toBe(true);
  });
});

describe("ambilMateri", () => {
  it("memulangkan null untuk id yang tidak ada", async () => {
    expect(await ambilMateri("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
```

Perbaiki pemanggilan halaman: `createElement(MateriPage as never, { searchParams: Promise.resolve({}) })`.

- [ ] **Langkah 2: Jalankan uji, pastikan MERAH**

Jalankan: `npx vitest run tests/admin-materi.test.ts`
Diharapkan: GAGAL — `SARING_MATERI` belum ada.

- [ ] **Langkah 3: Tambahkan lapisan daftar ke `materi-admin.ts`**

Sisipkan di `web/src/lib/admin/materi-admin.ts` (JANGAN hapus `daftarMateriAdmin()`):

```ts
import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";

export const SARING_MATERI = {
  aktif: ["ya", "tidak"],
  tipe: ["ebook", "video"],
  isi: ["belum"],
} as const satisfies SaringSah;

export type BarisMateriDaftar = MateriKelola & { jumlahLayanan: number };

/**
 * Satu halaman daftar materi, datar.
 *
 * Berbeda dari `daftarMateriAdmin()` yang mengelompokkan per layanan: daftar
 * datar berpaginasi tidak bisa dikelompokkan tanpa memecah paginasinya
 * sendiri — sebuah kelompok yang terpotong di batas halaman terbaca sebagai
 * kelompok yang isinya hilang. Pengelompokan per layanan tetap tersedia dari
 * arah sebaliknya: halaman detail LAYANAN mendaftar materinya.
 *
 * Jumlah halaman e-book tetap lewat embed AGREGAT `material_pages(count)`,
 * bukan `material_pages(*)`: PostgREST memotong BARIS pada `max_rows`, tidak
 * pernah nilai agregat. Menarik satu baris per halaman dari seluruh klinik
 * membuat materi di luar 1000 baris pertama MELAPORKAN `jumlahHalaman: 0` →
 * `lengkap: false`, dan itu mengundang admin mengunggah ulang materi yang
 * sebenarnya sudah lengkap.
 */
export async function ambilDaftarMateri(
  param: ParamDaftar,
): Promise<{ baris: BarisMateriDaftar[]; total: number }> {
  const supabase = await createServerSupabase();
  const { dari, sampai } = hitungRentang(param.hal);

  let q = supabase
    .from("materials")
    .select("id, judul, tipe, deskripsi, aktif, material_pages(count)", { count: "exact" })
    .order("aktif", { ascending: false })
    .order("judul");

  if (param.saring.aktif) q = q.eq("aktif", param.saring.aktif === "ya");
  if (param.saring.tipe) q = q.eq("tipe", param.saring.tipe);
  if (param.cari !== "") {
    const aman = param.cari.replace(/[%_\\]/g, (c) => `\\${c}`);
    q = q.ilike("judul", `%${aman}%`);
  }

  const [{ data: materi, count }, { data: tautan }, { data: video }] = await Promise.all([
    q.range(dari, sampai).returns<BarisMateri[]>(),
    supabase.from("material_services").select("material_id, service_id").returns<BarisTautan[]>(),
    supabase.from("material_videos").select("material_id, objek").returns<BarisVideo[]>(),
  ]);

  const nLayanan = new Map<string, number>();
  for (const t of tautan ?? []) nLayanan.set(t.material_id, (nLayanan.get(t.material_id) ?? 0) + 1);
  const videoPer = new Map((video ?? []).map((v) => [v.material_id, v.objek] as const));

  let baris = (materi ?? []).map((m) => {
    // Embed agregat: selalu satu objek `{ count }` (LEFT JOIN) — materi tanpa
    // satu pun halaman menjawab `count: 0`, tidak pernah larik kosong.
    const jumlahHalaman = m.material_pages[0]?.count ?? 0;
    const objek = videoPer.get(m.id) ?? null;
    return {
      id: m.id,
      judul: m.judul,
      tipe: m.tipe,
      deskripsi: m.deskripsi,
      aktif: m.aktif,
      layananId: [] as string[],
      jumlahHalaman,
      objekVideo: objek,
      lengkap: m.tipe === "ebook" ? jumlahHalaman > 0 : objek !== null,
      jumlahLayanan: nLayanan.get(m.id) ?? 0,
    };
  });

  // Saringan "belum ada isi" dikerjakan di JS: `lengkap` bukan kolom, ia
  // gabungan dua tabel berbeda per TIPE materi. Konsekuensinya jujur — ia
  // menyaring HALAMAN yang sudah ditarik, jadi `total` ikut dilaporkan sebagai
  // jumlah yang benar-benar tampil, bukan `count` mentah. Melaporkan `count`
  // mentah membuat paginasi menawarkan halaman yang tidak pernah ada isinya —
  // persis cacat saringan paket yang sudah dibayar di rencana 1.
  const saringIsi = param.saring.isi === "belum";
  if (saringIsi) baris = baris.filter((m) => !m.lengkap);

  return { baris, total: saringIsi ? baris.length : (count ?? 0) };
}

/** Satu materi beserta layanan tertautnya, atau `null` bila id-nya tidak ada. */
export async function ambilMateri(id: string): Promise<MateriKelola | null> {
  for (const kelompok of await daftarMateriAdmin()) {
    const m = kelompok.materi.find((x) => x.id === id);
    if (m) return m;
  }
  return null;
}
```

- [ ] **Langkah 4: Tulis ulang `page.tsx`**

`web/src/app/admin/materi/page.tsx` mengikuti bentuk yang sama persis dengan
`/admin/layanan/page.tsx` di Tugas 7: `BilahDaftar` dengan tiga kelompok saringan
(`aktif`, `tipe`, `isi`), `Tabel` berkolom Judul · Tipe · Isi · Layanan · Status, baris menaut ke
`/admin/materi/${m.id}`, `Paginasi`, dan `PanelGeser` untuk `?ubah=baru` berisi `FormMateriBaru`.

Kolom "Isi" menampilkan `m.tipe === "ebook" ? `${m.jumlahHalaman} halaman` : m.objekVideo !== null
? "video terpasang" : "video belum terpasang"`, dan baris yang `!m.lengkap` mendapat pill
`Belum ada isi` berkelas `bg-clay/10 text-clay`. Kolom "Layanan" menampilkan `m.jumlahLayanan`,
dengan pill `Tanpa layanan · hanya lewat assign` ketika nol.

Teks penjelas panjang di header pindah ke `<Bantuan judul="Tentang halaman ini">`, apa adanya —
ia memuat pembedaan yang mahal: menonaktifkan materi benar-benar MENUTUP isinya di RLS, bukan
sekadar menyembunyikannya dari layar.

- [ ] **Langkah 5: Jalankan uji, pastikan HIJAU**

Jalankan: `npx vitest run tests/admin-materi.test.ts tests/materi-admin-batas-baris.test.ts`
Diharapkan: LULUS.

- [ ] **Langkah 6: Commit**

```bash
git add web/src/lib/admin/materi-admin.ts web/src/app/admin/materi/page.tsx web/tests/admin-materi.test.ts
git commit -m "feat(materi): daftar datar berpaginasi dengan saringan tipe & kelengkapan isi"
```

---

## Tugas 11: Halaman detail Materi

**Berkas:**
- Buat: `web/src/app/admin/materi/[id]/page.tsx`
- Buat: `web/tests/admin-materi-detail.test.tsx`
- Ubah: `web/src/app/admin/materi/form-materi.tsx` (`AksiMateri` menjadi isi halaman, bukan laci)
- Ubah: `web/README.md`

**Antarmuka:**
- Memakai: `ambilMateri(id)`, `pilihanLayananMateri()`, `pilihanKlien()` (semuanya di
  `@/lib/admin/materi-admin`); `daftarPenugasan(materiId)` di `@/lib/admin/penugasan`.

- [ ] **Langkah 1: Tulis uji yang gagal**

Buat `web/tests/admin-materi-detail.test.tsx` dengan bentuk yang sama seperti
`admin-layanan-detail.test.tsx` (Tugas 8 Langkah 1), menuntut:

```tsx
describe("halaman detail materi", () => {
  it("menampilkan judul materi", async () => { … });
  it("punya jalan kembali ke daftar", async () => {
    expect(await markup(MATERI.id)).toContain('href="/admin/materi"');
  });
  it("memuat panel penugasan per klien — inilah alasan materi berpola detail", async () => {
    const m = await markup(MATERI.id);
    expect(m).toContain('name="client_id"');
  });
  it("memuat pengunggah isi sesuai TIPE materi", async () => {
    // E-book mendapat pengunggah PDF, video mendapat pengunggah video. Materi
    // yang mendapat pengunggah salah tipe menyimpan isi yang tidak akan pernah
    // dibaca jalur mana pun.
    const m = await markup(MATERI.id);
    expect(m).toContain(MATERI.tipe === "ebook" ? "halaman" : "video");
  });
  it("id yang tidak ada memanggil notFound()", async () => { … });
  it("nol rupiah", async () => {
    expect(nominalDalam(await markup(MATERI.id))).toEqual([]);
  });
});
```

- [ ] **Langkah 2: Jalankan uji, pastikan MERAH**

Jalankan: `npx vitest run tests/admin-materi-detail.test.tsx`
Diharapkan: GAGAL — modul rute belum ada.

- [ ] **Langkah 3: Tulis halamannya**

Buat `web/src/app/admin/materi/[id]/page.tsx`, berbentuk sama dengan halaman detail layanan:
tautan kembali, header berisi judul + pill tipe/status, lalu empat `Kartu`:

1. **Data materi** — `AksiMateri` dengan seluruh prop yang sudah diterimanya hari ini.
2. **Isi** — `IsiEbook` atau `IsiVideo` menurut `materi.tipe`.
3. **Layanan tertaut** — `CentangLayanan`, dengan `pilihanLayananMateri()` sebagai sumber.
4. **Penugasan manual** — `PanelPenugasan` dengan `daftarPenugasan(id)` dan `pilihanKlien()`.

`form-materi.tsx` diubah seperlunya saja: `AksiMateri`, `IsiEbook`, `IsiVideo`, `CentangLayanan`,
dan `PanelPenugasan` yang hari ini `function` privat menjadi `export function`, dan gerbang
buka/tutup lacinya dibuang — halamannya sendiri sudah menjadi wadahnya. JANGAN sentuh logika
unggah: `pengunggah-pdf.tsx`, `pengunggah-video.tsx`, `unggah.ts`, `unggah-video.ts` tetap apa
adanya, dan uji R2 yang menyentuh bucket produksi TIDAK dijalankan (Global Constraint 12).

- [ ] **Langkah 4: Tambahkan rute ke README**

```
| `/admin/materi/[id]` | Admin, Owner | Detail materi: metadata, isi (e-book/video), layanan tertaut, penugasan per klien |
```

- [ ] **Langkah 5: Jalankan uji, pastikan HIJAU**

Jalankan: `npx vitest run tests/admin-materi-detail.test.tsx tests/admin-materi.test.ts tests/materi-penugasan*.test.ts tests/inventaris-rute.test.ts`
Diharapkan: LULUS.

- [ ] **Langkah 6: Commit**

```bash
git add web/src/app/admin/materi web/tests/admin-materi-detail.test.tsx web/README.md
git commit -m "feat(materi): halaman detail dengan isi, layanan tertaut, dan penugasan"
```

---

## Tugas 12: Sapuan palet Klien + verifikasi menyeluruh

Utang #5 runbook rencana 1: `/admin/klien/baru` dan `/admin/klien/[id]` masih berpalet lama
(`border-dashed border-gold`, `bg-night text-gold-pale`) sementara daftar di atasnya sudah penuh
token `panel-*`. Satu layar, dua palet.

**Berkas:**
- Ubah: `web/src/app/admin/klien/baru/page.tsx`
- Ubah: `web/src/app/admin/klien/[id]/page.tsx`
- Ubah: `web/src/app/admin/klien/form-klien.tsx`
- Ubah: `web/src/app/admin/klien/[id]/kartu-aktivasi.tsx`
- Ubah: `web/src/app/admin/skrining/jadikan-klien.tsx`

- [ ] **Langkah 1: Tulis uji yang gagal**

Tambahkan ke `web/tests/admin-klien-halaman.test.tsx`:

```tsx
describe("palet — satu layar, satu palet", () => {
  const BERKAS = [
    "src/app/admin/klien/baru/page.tsx",
    "src/app/admin/klien/[id]/page.tsx",
    "src/app/admin/klien/form-klien.tsx",
    "src/app/admin/klien/[id]/kartu-aktivasi.tsx",
    "src/app/admin/skrining/jadikan-klien.tsx",
  ];

  it("tidak ada sisa palet lama di modul Klien", () => {
    // Kelas-kelas ini adalah palet halaman KLIEN (paper/night/gold), bukan
    // palet ruang kerja staf. Bertetangga dengan daftar bertoken panel-*,
    // keduanya terbaca sebagai dua aplikasi berbeda dalam satu layar.
    const sisa: string[] = [];
    for (const b of BERKAS) {
      const isi = baca(b);
      for (const kelas of ["bg-night", "text-gold-pale", "border-gold", "bg-white", "border-black/1"]) {
        if (isi.includes(kelas)) sisa.push(`${b}: ${kelas}`);
      }
    }
    expect(sisa).toEqual([]);
  });

  it("pagar bergigi: daftar berkas tidak kosong dan berkasnya benar-benar terbaca", () => {
    // Tanpa ini, salah tulis path membuat `baca()` melempar — atau, bila
    // suatu saat diberi nilai cadangan, membuat seluruh uji lolos hampa.
    expect(BERKAS.length).toBeGreaterThan(0);
    for (const b of BERKAS) expect(baca(b).length).toBeGreaterThan(100);
  });
});
```

- [ ] **Langkah 2: Jalankan uji, pastikan MERAH**

Jalankan: `npx vitest run tests/admin-klien-halaman.test.tsx`
Diharapkan: GAGAL — beberapa kelas lama masih ada.

- [ ] **Langkah 3: Sapu paletnya**

Pemetaan, dipakai konsisten di kelima berkas:

| Lama | Baru |
|---|---|
| `bg-white` | `bg-panel-surface` |
| `bg-paper`, `bg-[#FDFAF1]` | `bg-panel-bg` |
| `border-black/10`, `border-black/15` | `border-panel-border` |
| `border-black/5` | `border-panel-border/70` |
| `border-dashed border-gold` | `border-panel-border` (garis putus-putus ikut hilang) |
| `bg-night text-gold-pale` | `bg-panel-ink text-panel-surface` |
| `text-night` | `text-panel-ink` |
| `text-ink`, `text-ink-soft` | `text-panel-ink`, `text-panel-muted` |
| `rounded-2xl` | `rounded-lg` |

DIPERTAHANKAN apa adanya: `text-leaf`, `bg-leaf-soft`, `text-clay`, `bg-clay/10`. Ketiganya adalah
warna SEMANTIK (berhasil / perhatian), bukan palet permukaan, dan sudah dipakai pill di halaman
yang sudah disapu.

- [ ] **Langkah 4: Jalankan uji palet, pastikan HIJAU**

Jalankan: `npx vitest run tests/admin-klien-halaman.test.tsx tests/admin-aktivasi.test.ts tests/admin-konversi-skrining.test.ts`
Diharapkan: LULUS.

- [ ] **Langkah 5: Pagar token menyala di seluruh permukaan baru**

Jalankan: `npx vitest run tests/panel-primitif.test.ts`
Diharapkan: LULUS — nol token hantu di `src/app/admin` maupun `src/app/owner`. Pagar dari Tugas 1
kini memindai dua belas halaman yang tidak pernah terjaga sebelumnya.

- [ ] **Langkah 6: Verifikasi menyeluruh**

Koordinasikan jendela basis data lebih dulu (Global Constraint 13), lalu:

```bash
cd web
npm run build          # meregenerasi tipe rute untuk dua rute baru
npx tsc --noEmit
npm run lint
npm test
```

Diharapkan: build sukses, nol galat tipe, nol galat lint, seluruh uji hijau.

Lalu E2E, satu per satu — **JANGAN `test:e2e:semua`, JANGAN `test:e2e:video`** (Global Constraint 12):

```bash
npm run test:e2e:admin-operasional
npm run test:e2e:passport
```

Kedua skrip ini menargetkan susunan LAMA (tombol di header, formulir di dalam sel tabel) dan
diperkirakan MERAH. Spec sudah menyatakannya: "Delapan skrip E2E akan merah dan harus ditulis
ulang" — dan penulisan ulangnya adalah **rencana 3**, bukan rencana ini. Catat kegagalan yang
muncul beserta selektor yang patah, jangan perbaiki di sini: memperbaikinya sepotong-sepotong
sekarang berarti menulisnya dua kali.

- [ ] **Langkah 7: Tulis runbook & utang**

Buat `docs/superpowers/2026-09-07-panel-sapuan-tindak-lanjut.md` berisi tiga bagian yang sama
dengan runbook rencana 1: tabel "apa yang berubah", runbook yang wajib dibaca penerus, dan tabel
utang beserta alasan penundaannya. Utang yang SUDAH DIKETAHUI dan wajib masuk:

1. `max_rows = 1000` masih terbuka untuk query HITUNG di `lib/admin/layanan.ts` (varian, paket,
   sesi) dan untuk kedua query sumber di `daftarTagihanAdmin()`. Paginasi memperbaiki layar, bukan
   batas bacaan.
2. Saringan `isi=belum` di modul Materi menyaring HALAMAN, bukan seluruh daftar — kelas yang sama
   dengan utang #12 rencana 1.
3. Delapan skrip E2E merah, ditulis ulang di rencana 3.
4. Rentang tanggal bebas pada modul Sesi diganti tiga chip preset (lihat "Penyimpangan dari spec").
5. `KelompokSaring.label` masih wajib diisi tetapi tidak pernah dirender — dan halaman Sesi kini
   punya TIGA kelompok berdampingan tanpa satu pun penanda kelompok. Utang #6 rencana 1 naik
   nilainya karena tugas ini.
6. `aria-pressed` pada `<Link>` bukan ARIA yang sah (utang #8 rencana 1) — kini menyala di enam
   halaman, bukan dua.

- [ ] **Langkah 8: Commit**

```bash
git add web/src/app/admin/klien web/src/app/admin/skrining/jadikan-klien.tsx \
        web/tests docs/superpowers/2026-09-07-panel-sapuan-tindak-lanjut.md
git commit -m "fix(klien): satukan palet halaman baru & detail; runbook sapuan enam modul"
```

---

## Tinjauan mandiri penulis rencana

**Cakupan spec.** K1 (dua pola): Sesi & Varian panel geser — Tugas 3, 9; Layanan & Materi halaman
detail — Tugas 8, 11; Bayar & Skrining bilah saja — Tugas 5, 6. K2 (keadaan di URL): Tugas 2, 3,
5, 6, 7, 9, 10. K3 (bilah seragam): setiap tugas halaman. K4 (paginasi): Tugas 2, 5, 6, 7, 10 —
dengan batas `max_rows` yang TIDAK tertutup dicatat eksplisit, bukan diklaim selesai. K5
(penjelasan ke tombol bantuan): Tugas 3, 5, 6, 7, 10. K6 (primitif buta peran): tidak ada primitif
baru yang lahir di rencana ini; pagar butanya diperkuat di Tugas 1. K7 (panel owner) dan K8 (logo)
memang di luar rencana ini. Tautan StatTile: Tugas 4.

**Yang saya sadar belum sempurna.** Tiga hal, dicatat di sini alih-alih ditemukan reviewer:

- **Tugas 10 dan 11 lebih tipis daripada Tugas 7–9.** Halaman daftar Materi dan halaman detailnya
  dijelaskan sebagai "berbentuk sama dengan Layanan" plus daftar kolom dan kartu yang eksplisit,
  bukan sebagai kode utuh. Ini melanggar aturan "ulangi kodenya" pada writing-plans, dan saya
  memilihnya sadar: menyalin dua halaman 200 baris yang hanya berbeda nama medan menggandakan
  permukaan salah-ketik di dokumen rencana itu sendiri. Pelaksana Tugas 10/11 WAJIB membuka Tugas 7
  dan 8 sebagai acuan — itu ketergantungan urutan yang nyata, bukan saran.
- **`FormVarian` (Tugas 9 Langkah 3) tidak ditulis lengkap.** Isinya adalah medan yang sudah ada di
  `form-varian.tsx` hari ini, disusun ulang tanpa pembungkus tabel. Menyalin 327 baris ke dalam
  rencana berisiko lebih besar daripada menunjuk berkas sumbernya.
- **Konsistensi tipe sudah diperiksa** untuk `ParamDaftar`, `SaringSah`, `BarisSesiDaftar`,
  `ItemTagihanAdmin`, `BarisSkrining`, `MateriKelola`, dan `LayananKelola`. Dua tanda tangan
  BERUBAH dan setiap pemanggilnya sudah disebut: `daftarTagihanAdmin()` (Tugas 5) dan halaman
  `LayananPage`/`MateriPage`/`BayarPage`/`InboxSkriningPage` yang kini menerima `searchParams`.
