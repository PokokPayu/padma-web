/**
 * Inventaris rute PADMA v1 — README vs kenyataan berkas.
 *
 * Kenapa test ini ada: tabel rute di README adalah satu-satunya peta PADMA yang
 * dibaca manusia, dan sampai berkas ini ditulis TIDAK ADA satu pun test yang
 * menjaganya. Akibatnya tabel itu sudah menyimpang diam-diam: `src/app` memuat
 * 29 rute, sementara tabelnya hanya menyebut 23 — enam rute (`/aktivasi`,
 * `/akun-belum-terhubung`, `/setelah-masuk`, `/auth/callback`, `/auth/keluar`,
 * `/api/skrining`) tidak terdaftar sama sekali. Justru rute yang tidak terdaftar
 * itulah yang paling berbahaya: `/aktivasi` menukarkan token undangan dan
 * `/api/skrining` menulis dengan service role, dua jalur yang tidak boleh hilang
 * dari radar siapa pun yang mengaudit permukaan serang.
 *
 * Penyimpangan ke arah SEBALIKNYA sama mahalnya: baris tabel untuk rute yang
 * sudah dihapus membuat pembacanya mengira ada halaman yang tidak pernah ada.
 * Karena itu pemeriksaannya dua arah.
 *
 * Test ini hanya MEMBACA berkas — tidak menjalankan apa pun, tidak butuh DB.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");
const APP = path.join(AKAR, "src", "app");
const README = readFileSync(path.join(AKAR, "README.md"), "utf8");
const PKG = JSON.parse(readFileSync(path.join(AKAR, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};

/**
 * Rute yang benar-benar ADA, dipungut dari sistem berkas.
 *
 * `page.tsx` dan `route.ts` sama-sama dihitung: keduanya rute yang bisa dibuka
 * peramban. Folder berawalan `_` adalah private folder Next (bukan segmen URL)
 * dan folder `(grup)` tidak dipakai repo ini.
 */
function ruteNyata(dir = APP, prefiks = ""): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(dir, { withFileTypes: true })) {
    if (entri.isDirectory()) {
      if (entri.name.startsWith("_")) continue;
      hasil.push(...ruteNyata(path.join(dir, entri.name), `${prefiks}/${entri.name}`));
    } else if (entri.name === "page.tsx" || entri.name === "route.ts") {
      hasil.push(prefiks === "" ? "/" : prefiks);
    }
  }
  return hasil.sort();
}

/** Rute yang TERDAFTAR di tabel README, dipungut dari kolom pertama. */
function ruteTerdaftar(): string[] {
  const baris = README.split("\n").filter((b) => /^\|\s*`\//.test(b));
  return baris
    .map((b) => b.match(/^\|\s*`([^`]+)`/)?.[1])
    .filter((r): r is string => typeof r === "string")
    .sort();
}

describe("inventaris rute: README memetakan seluruh permukaan aplikasi", () => {
  it("setiap rute di src/app terdaftar di tabel rute README", () => {
    const nyata = ruteNyata();
    const terdaftar = new Set(ruteTerdaftar());
    const takTerdaftar = nyata.filter((r) => !terdaftar.has(r));
    expect(
      takTerdaftar,
      `rute ini ada di src/app tetapi hilang dari tabel rute README: ${takTerdaftar.join(", ")}`,
    ).toEqual([]);
  });

  it("setiap rute di tabel README benar-benar ada di src/app", () => {
    const nyata = new Set(ruteNyata());
    const hantu = ruteTerdaftar().filter((r) => !nyata.has(r));
    expect(
      hantu,
      `tabel rute README menyebut rute yang tidak ada berkasnya: ${hantu.join(", ")}`,
    ).toEqual([]);
  });

  // PADMA v1 lengkap berarti seluruh rute spec bagian 4 terwujud. Angka ini
  // adalah lantai, bukan langit-langit: menambah halaman tidak memerahkannya,
  // menghapus halaman diam-diam iya.
  it("PADMA v1 memuat sekurangnya 25 rute", () => {
    expect(ruteNyata().length).toBeGreaterThanOrEqual(25);
  });

  // Ketiga panel wajib utuh — pagar ini menangkap rute yang terhapus tanpa
  // sengaja saat refactor, kelas kegagalan yang tidak ditangkap test mana pun
  // karena masing-masing test hanya menguji halaman yang memang dipanggilnya.
  it("ketiga panel peran punya rute intinya masing-masing", () => {
    const nyata = new Set(ruteNyata());
    for (const rute of [
      "/owner",
      "/owner/rekap",
      "/owner/tarif",
      "/owner/transport",
      "/admin",
      "/passport",
    ]) {
      expect(nyata.has(rute), `rute inti \`${rute}\` hilang dari src/app`).toBe(true);
    }
  });
});

describe("inventaris E2E: skrip terangkai dan terdokumentasi", () => {
  const SKRIP = [
    "test:e2e",
    // Pendaftaran mandiri (spec 8 Sep 2026, bagian Pengujian: "skrip baru
    // untuk pendaftaran mandiri, dirangkai ke test:e2e:semua"). Ia ditambahkan
    // ke daftar ini pada saat yang sama ia lahir — skrip yang ada tetapi tidak
    // terangkai adalah skrip yang tidak pernah dijalankan siapa pun.
    "test:e2e:daftar",
    "test:e2e:funnel",
    "test:e2e:passport",
    "test:e2e:admin",
    "test:e2e:pelengkap",
    "test:e2e:owner",
  ];

  it("setiap script E2E yang terdaftar ada di package.json", () => {
    for (const s of SKRIP) {
      expect(PKG.scripts?.[s], `script \`${s}\` hilang dari package.json`).toBeTypeOf("string");
    }
  });

  // `test:e2e:semua` adalah satu-satunya perintah yang dijalankan orang saat
  // merilis. Skrip yang ada tetapi tidak terangkai ke sini adalah skrip yang
  // tidak pernah dijalankan siapa pun — persis nasib test:e2e:owner sebelum
  // Plan 5 Task 6.
  it("test:e2e:semua merangkai semuanya", () => {
    const semua = PKG.scripts?.["test:e2e:semua"] ?? "";
    for (const s of SKRIP) {
      expect(
        new RegExp(`npm run ${s.replace(/:/g, ":")}(\\s|$|&)`).test(semua),
        `\`${s}\` tidak terangkai ke test:e2e:semua (isi: ${semua})`,
      ).toBe(true);
    }
  });

  it("README mendokumentasikan setiap script E2E", () => {
    for (const s of SKRIP) {
      expect(README, `README tidak menyebut \`npm run ${s}\``).toContain(`npm run ${s}`);
    }
  });
});
