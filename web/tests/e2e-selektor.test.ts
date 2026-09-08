/**
 * Pagar EJAAN selektor E2E.
 *
 * Skrip E2E tidak ikut `npm test` — ia butuh server hidup. Akibatnya sapuan
 * panel rencana 2 mengganti tiga label tombol menjadi tautan, dan seluruh suite
 * tetap hijau sampai seseorang kebetulan menjalankan E2E berminggu-minggu
 * kemudian. Pagar ini memeriksa satu hal murah dan SEMPIT — bukan "setiap
 * label", persisnya: literal string bertanda kutip ganda pada argumen `name:`
 * dari pola tepat `getByRole("button"|"link", { name: "…" })` di
 * `tests/e2e/*.e2e.ts` — 34 literal unik dari 64 pemanggilan `getByRole` total
 * (diukur 2026-09-08) — lalu memeriksa apakah tiap literal itu masih ada di
 * suatu tempat di `src/app/` sesudah komentar (`//` maupun blok gaya JSDoc)
 * dilucuti dari korpusnya. `getByLabel` dan `getByText` TIDAK dipindai sama
 * sekali; dua selektor rencana ini sendiri lolos dari pagar ini justru karena
 * memakainya (`getByLabel("Judul materi")`, `getByText("Video tersimpan.")`).
 *
 * YANG TIDAK DIJAGA, dan ini penting supaya tidak ada yang mengira lebih:
 * pagar ini buta terhadap tombol yang PINDAH HALAMAN sambil mempertahankan
 * namanya. "Nonaktifkan" tetap ada di `src/` sesudah ia pindah dari daftar ke
 * halaman detail, jadi kepatahan `admin-pelengkap.e2e.ts` TIDAK akan tertangkap
 * di sini. Ini pagar ejaan, bukan pagar alur.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

function berkasSumber(rel: string): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(path.join(AKAR, rel), { withFileTypes: true })) {
    const anak = `${rel}/${entri.name}`;
    if (entri.isDirectory()) hasil.push(...berkasSumber(anak));
    else if (/\.tsx?$/.test(entri.name)) hasil.push(anak);
  }
  return hasil;
}

/** Label literal yang dicari `getByRole("button"|"link", { name: "…" })`. */
export function labelDicari(isi: string): string[] {
  const pola = /getByRole\(\s*"(?:button|link)"\s*,\s*\{\s*name:\s*"([^"]+)"/g;
  return [...new Set([...isi.matchAll(pola)].map((m) => m[1]))];
}

/**
 * Buang komentar baris (`//`) dan blok gaya JSDoc dari isi berkas sebelum ia
 * ikut SUMBER_APP. Tanpa ini, label yang cuma DISEBUT ULANG di komentar (mis.
 * dokblok yang mengutip nama tombol yang baru saja dihapus verbatim) dianggap
 * "masih ada" oleh pagar ini — persis false-negative yang meloloskan
 * "Kelola penugasan": tombolnya sudah tidak ada di UI mana pun, tapi dokblok
 * `AksiMateri` (`src/app/admin/materi/form-materi.tsx`) mengutip namanya
 * verbatim untuk menjelaskan KENAPA ia dihapus.
 *
 * Regex baris DIJANGKARKAN ke awal baris (`^\s*\/\/`), bukan `//` telanjang,
 * supaya `//` di TENGAH literal string (mis. URL `"https://…"`) tidak ikut
 * membuat sisa barisnya terpotong.
 */
export function lucutiKomentar(isi: string): string {
  return isi.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// `src/app` saja, bukan seluruh `src/`: benar untuk keadaan proyek ini SAAT
// INI (nol `.tsx` di luar `src/app`), tapi label yang didefinisikan sebagai
// konstanta di `src/lib` lalu dirender lewat `src/app` akan jadi
// false-positive DI SINI (label dianggap hilang padahal ada, hanya di berkas
// yang tidak dipindai) — pembaca berikutnya yang menambah `.tsx` di `src/lib`
// perlu tahu ini sebelum menyalahkan skrip E2E-nya.
const SUMBER_APP = berkasSumber("src/app")
  .map((f) => lucutiKomentar(baca(f)))
  .join("\n");

const SKRIP_E2E = readdirSync(path.join(AKAR, "tests/e2e"))
  .filter((n) => n.endsWith(".e2e.ts"))
  .map((n) => `tests/e2e/${n}`);

/**
 * Label yang SENGAJA tidak dicari di `src/app/`, beserta alasannya. Daftar ini
 * pendek dengan sengaja: setiap tambahan adalah lubang pada pagar ini.
 */
const DIKECUALIKAN = new Map<string, string>([
  ["Kehamilan", "nama FASE dari kolom phases.nama di basis data, bukan literal di src/app"],
  ["Menopause", "nama FASE dari kolom phases.nama di basis data, bukan literal di src/app"],
]);

describe("pagar ejaan selektor E2E", () => {
  it("ada skrip E2E yang dipindai (anti-hampa)", () => {
    expect(SKRIP_E2E.length).toBeGreaterThan(0);
  });

  it("regex label benar-benar memungut sesuatu (anti-hampa)", () => {
    const semua = SKRIP_E2E.flatMap((f) => labelDicari(baca(f)));
    expect(semua.length).toBeGreaterThan(0);
  });

  it("setiap label yang dicari skrip E2E masih ada di src/app", () => {
    const hilang: string[] = [];
    for (const berkas of SKRIP_E2E) {
      for (const label of labelDicari(baca(berkas))) {
        if (DIKECUALIKAN.has(label)) continue;
        if (!SUMBER_APP.includes(label)) hilang.push(`${berkas}: "${label}"`);
      }
    }
    expect(hilang, "label E2E tidak ditemukan di src/app").toEqual([]);
  });
});

describe("labelDicari — bergigi", () => {
  it("memungut label dari button maupun link", () => {
    const isi = `getByRole("button", { name: "Simpan materi", exact: true })
                 getByRole("link", { name: "+ Sesi baru" })`;
    expect(labelDicari(isi).sort()).toEqual(["+ Sesi baru", "Simpan materi"]);
  });

  it("mengabaikan nama berpola regex — ia tidak bisa dicocokkan sebagai teks", () => {
    expect(labelDicari(`getByRole("button", { name: /Simpan jadwal/i })`)).toEqual([]);
  });
});

describe("lucutiKomentar — bergigi", () => {
  it("label yang HANYA muncul di komentar baris dianggap hilang sesudah dilucuti", () => {
    const isi = `// Tombol "Kelola penugasan" sudah dihapus dari sini.\nconst x = 1;`;
    // Sebelum dilucuti: substring MEMANG ketemu — inilah false-negative yang
    // ada di pagar sebelum pelucutan ini ditambahkan.
    expect(isi.includes("Kelola penugasan")).toBe(true);
    expect(lucutiKomentar(isi)).not.toContain("Kelola penugasan");
  });

  it("label yang HANYA muncul di komentar blok gaya JSDoc dianggap hilang sesudah dilucuti", () => {
    const isi = [
      "/**",
      ' * di balik tombol "Kelola isi"/"Kelola penugasan" yang harus diklik dulu.',
      " */",
    ].join("\n");
    expect(isi.includes("Kelola penugasan")).toBe(true);
    expect(lucutiKomentar(isi)).not.toContain("Kelola penugasan");
  });

  it("tidak memotong // di TENGAH literal string (URL, dll.) — hanya baris yang DIAWALI //", () => {
    const isi = `const url = "https://contoh.test/a"; // ini komentar sungguhan`;
    expect(lucutiKomentar(isi)).toContain("https://contoh.test/a");
  });
});
