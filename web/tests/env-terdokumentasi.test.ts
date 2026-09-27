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
 * ===== BATASNYA DITUTUP, BUKAN LAGI DICATAT =====
 * Pemindainya mencari literal `process.env.NAMA`, jadi pembacaan DINAMIS
 * (`process.env[nama]`) dulu tidak terlihat olehnya. Itu pernah tercatat di
 * sini sebagai batas yang diketahui, ditutup dengan kalimat bahwa siapa pun
 * yang menambah pembacaan dinamis harus mendokumentasikannya sendiri.
 *
 * Aturan yang bersandar pada ingatan seseorang adalah yang digantikan oleh
 * pagar-pagar di repo ini, jadi batas itu kini DITEGAKKAN alih-alih dicatat:
 * `describe("env dibaca secara harfiah")` di bawah melarang `process.env[...]`
 * di seluruh `src/`, dan `src/lib/r2.ts` diubah untuk mengoper NILAI env, bukan
 * namanya. Asumsi pemindai ini karena itu tidak lagi diasumsikan.
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

/**
 * Pembacaan env DINAMIS dilarang di `src/`, dan pagar ini yang menegakkannya.
 *
 * Pemindai di atas hanya mengenali `process.env.NAMA` yang ditulis harfiah.
 * Selama ini itu tercatat sebagai "batas yang diketahui", ditutup dengan
 * kalimat bahwa siapa pun yang menambah pembacaan dinamis harus
 * mendokumentasikannya sendiri — yaitu aturan yang ditegakkan INGATAN, persis
 * hal yang digantikan oleh pagar-pagar di repo ini.
 *
 * Empat env R2 memang sudah terdokumentasi, tapi karena seseorang menulisnya,
 * bukan karena ada yang menuntutnya. Yang berikutnya tidak punya jaminan itu,
 * dan bentuk kegagalannya sama dengan `CRON_SECRET` dulu: env yang lupa
 * dipasang tidak melahirkan galat konfigurasi melainkan perilaku yang terlihat
 * seperti bug lain.
 *
 * Memaksa bentuk harfiah lebih murah daripada mengajari pemindai nama setiap
 * helper: satu helper baru bernama lain akan lolos, sebuah indeks ke
 * `process.env` tidak.
 *
 * SATU SIFAT YANG PERLU DIKETAHUI SEBELUM MENDEBUG MERAHNYA: pemindai ini
 * membaca per baris tanpa memisahkan komentar dari kode, jadi KOMENTAR yang
 * mengeja bentuk terlarang itu ikut memerahkannya. Itu disengaja. Pemindai
 * yang sadar komentar harus tahu soal `//`, komentar blok, dan string — dan
 * kerumitan itu tidak sebanding, karena kalimat apa pun bisa ditulis ulang
 * dengan kata (lihat dokblok `wajib()` di `src/lib/r2.ts`, yang melakukannya).
 */
const POLA_DINAMIS = /process\.env\s*\[/;

/** Nomor baris (mulai 1) yang memuat pembacaan env dinamis. */
function barisDinamis(isi: string): number[] {
  return isi
    .split("\n")
    .map((baris, i) => (POLA_DINAMIS.test(baris) ? i + 1 : 0))
    .filter((n) => n > 0);
}

describe("env dibaca secara harfiah", () => {
  it("pemindai dinamis mengenali yang dinamis dan melepas yang harfiah", () => {
    // Kontrol positif yang TINGGAL di repo. Sesudah perbaikan di bawah, jumlah
    // temuan nyatanya nol selamanya — dan pemindai yang rusak juga memulangkan
    // nol. Tanpa kontrol ini, keduanya tidak bisa dibedakan.
    expect(barisDinamis("const v = process.env[nama];")).toEqual([1]);
    expect(barisDinamis("const v = process.env [nama];")).toEqual([1]);
    expect(barisDinamis("const v = process.env.NAMA;")).toEqual([]);
    expect(barisDinamis("// process.env.NAMA disebut di komentar")).toEqual([]);
  });

  it("nol pembacaan env dinamis di src/", () => {
    const temuan: string[] = [];
    for (const berkas of berkasSumber(SRC)) {
      for (const baris of barisDinamis(readFileSync(berkas, "utf8"))) {
        temuan.push(`${path.relative(AKAR, berkas)}:${baris}`);
      }
    }

    expect(
      temuan,
      temuan.length === 0
        ? ""
        : `Pembacaan env dinamis di sini tidak terlihat oleh pemindai\n` +
          `"setiap env yang dibaca src/ punya barisnya sendiri":\n  ${temuan.join("\n  ")}\n\n` +
          `Tulis \`process.env.NAMA\` harfiah. Bila butuh helper yang melempar saat\n` +
          `kosong, oper NILAINYA — \`wajib("NAMA", process.env.NAMA)\` — bukan namanya.`,
    ).toEqual([]);
  });
});
