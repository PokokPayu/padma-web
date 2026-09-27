/**
 * PAGAR: setiap env yang DIBACA kode punya barisnya sendiri di `.env.example`.
 *
 * Kelas kesalahan ini bukan hipotesis. `CRON_SECRET` dibaca
 * `src/app/api/cron/tenggat/route.ts` sejak rute itu lahir, dan sampai commit ini
 * ia TIDAK ADA di `.env.example` — jadi satu-satunya cara seseorang tahu ia harus
 * memasangnya adalah membaca kode rutenya. Bentuk kegagalannya khas dan mahal:
 * rute itu fail-closed, jadi env yang lupa dipasang tidak melahirkan galat
 * konfigurasi melainkan 401 yang terlihat seperti "penjadwalnya salah rahasia".
 *
 * ===== SATU ARAH, DAN ITU DISENGAJA =====
 * Yang diuji hanya "dibaca kode -> ada di contoh". Arah sebaliknya (terdokumentasi
 * tetapi belum dipakai) TIDAK memerahkan apa pun. Alasannya praktis: P1 menulis
 * keempat env Midtrans ke `.env.example` di tugas ini, sementara yang membacanya
 * lahir di tugas-tugas berikutnya. Pagar dua arah akan memaksa urutan mendarat
 * yang tidak ada hubungannya dengan kebenaran apa pun.
 *
 * ===== BATAS YANG DIKETAHUI =====
 * Pemindainya mencari literal `process.env.NAMA`. Pembacaan DINAMIS
 * (`process.env[nama]`, seperti helper `wajib()` di `src/lib/r2.ts:22`) tidak
 * terlihat olehnya — keempat env R2 memang sudah terdokumentasi, tapi itu karena
 * seseorang menulisnya, bukan karena pagar ini menuntutnya. Siapa pun yang
 * menambah pembacaan dinamis baru harus mendokumentasikannya sendiri.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");
const SRC = path.join(AKAR, "src");
const CONTOH = readFileSync(path.join(AKAR, ".env.example"), "utf8");

/**
 * Disediakan runtime, bukan oleh berkas konfigurasi kita. `NODE_ENV` disetel
 * Next.js/Node sendiri; menuliskannya di `.env.example` justru mengundang orang
 * menimpanya dan memecahkan build.
 */
const DISEDIAKAN_RUNTIME = new Set(["NODE_ENV"]);

function berkasSumber(dir: string): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(dir, { withFileTypes: true })) {
    const anak = path.join(dir, entri.name);
    if (entri.isDirectory()) hasil.push(...berkasSumber(anak));
    else if (/\.tsx?$/.test(entri.name)) hasil.push(anak);
  }
  return hasil;
}

/** Setiap `process.env.NAMA` yang ditulis harfiah di `src/`, tanpa duplikat. */
function envDibaca(): string[] {
  const nama = new Set<string>();
  for (const berkas of berkasSumber(SRC)) {
    const isi = readFileSync(berkas, "utf8");
    for (const cocok of isi.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      if (!DISEDIAKAN_RUNTIME.has(cocok[1])) nama.add(cocok[1]);
    }
  }
  return [...nama].sort();
}

/**
 * Terdokumentasi berarti punya BARISNYA SENDIRI (`NAMA=` di awal baris), bukan
 * sekadar disebut di dalam komentar. Komentar yang menyebut sebuah env tidak
 * memberi tahu siapa pun nilai apa yang harus dipasang — dan `.env.example`
 * repo ini memang penuh komentar yang menyebut nama env tetangganya.
 */
function terdokumentasi(nama: string): boolean {
  return new RegExp(`^${nama}=`, "m").test(CONTOH);
}

describe("env terdokumentasi", () => {
  it("pemindainya benar-benar menemukan sesuatu", () => {
    // Anti-hampa. Pemindai yang rusak memulangkan daftar kosong, dan daftar
    // kosong membuat assertion utama di bawah hijau selamanya tanpa memeriksa
    // apa pun. Angka ini LANTAI, bukan langit-langit.
    expect(envDibaca().length).toBeGreaterThanOrEqual(8);
  });

  it("cetakan `terdokumentasi` tidak hampa: mengenali yang ada, menolak yang tidak", () => {
    expect(terdokumentasi("NEXT_PUBLIC_SUPABASE_URL")).toBe(true);
    expect(terdokumentasi("PADMA_ENV_YANG_TIDAK_PERNAH_ADA")).toBe(false);
  });

  it("penyebutan di dalam KOMENTAR saja tidak dihitung terdokumentasi", () => {
    // Pagar terhadap "perbaikan" termurah yang salah: menambahkan nama env ke
    // sebuah komentar dan menganggap dokumentasinya selesai.
    const palsu = "# CRON_SECRET disebut di sini saja\nLAIN=1\n";
    expect(new RegExp("^CRON_SECRET=", "m").test(palsu)).toBe(false);
  });

  it("setiap env yang dibaca src/ punya barisnya sendiri di .env.example", () => {
    const hilang = envDibaca().filter((n) => !terdokumentasi(n));
    expect(
      hilang,
      hilang.length === 0
        ? ""
        : `Env ini dibaca kode tetapi tidak ada di web/.env.example: ${hilang.join(", ")}.\n` +
          `Tambahkan barisnya BESERTA komentar yang menjelaskan apa yang mati tanpanya —\n` +
          `itulah bentuk yang dipakai seluruh berkas itu, dan itulah yang membuatnya berguna.`,
    ).toEqual([]);
  });
});
