import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Pagar SUMBER, bukan pagar perilaku.
 *
 * Uji perilaku hanya menjaga jalur yang kebetulan dilewatinya. Yang perlu
 * dijaga di sini adalah SELURUH kode: begitu satu berkas menulis literal
 * "menunggu" sebagai status permintaan, ia berhenti cocok dengan basis data
 * tanpa satu pun error — dan akibatnya berbentuk permintaan yang tidak muncul
 * di layar siapa pun (spec C1 §"Risiko utama").
 *
 * Pemindaiannya mencari literal nilai status, dan mengecualikan berkas yang
 * memang BOLEH menyebutnya: modul sumbernya sendiri.
 */
const AKAR = path.resolve(__dirname, "..", "src");
const SUMBER_SAH = path.join(AKAR, "lib", "jadwal", "status.ts");

/** Nilai lama yang sudah tidak ada di basis data mana pun. */
const NILAI_MATI = ["menunggu", "batal"];

/**
 * Nilai yang BERGANTI NAMA atau BARU LAHIR di C1 — bukan seluruh anggota enum.
 *
 * ===== KENAPA BUKAN SEMUANYA, DAN APA ONGKOS KEPUTUSAN INI =====
 * Tinjauan menyeluruh menunjuk bahwa daftar ini meloloskan `terjadwal`,
 * `selesai`, `dikonfirmasi`, dan `ditolak` — dan itu benar: keempatnya memang
 * ditulis literal di 14 tempat di seluruh repo.
 *
 * Yang DIPILIH: melarang hanya nilai yang berubah. Bahaya yang pagar ini ada
 * untuk mencegahnya adalah perbandingan yang BERHENTI COCOK setelah sebuah
 * nilai berganti nama — kegagalan senyap yang tidak melempar error apa pun.
 * Keempat nilai stabil itu tidak berganti nama di C1, jadi tidak satu pun dari
 * 14 tempat itu rusak hari ini; memaksa semuanya lewat modul berarti menyunting
 * tujuh modul yang tidak ada hubungannya dengan pekerjaan ini
 * (`lib/admin/klien.ts`, `mitra.ts`, `penugasan.ts`, `tren.ts`, …) demi
 * kerapian, bukan demi kebenaran.
 *
 * ONGKOSNYA, ditulis terbuka: bila C2 atau C3 kelak MENGGANTI NAMA salah satu
 * dari keempat nilai stabil itu, pagar ini tidak akan menangkapnya. Siapa pun
 * yang melakukannya WAJIB menambahkan nilai lamanya ke `NILAI_MATI` di atas
 * dalam commit yang sama — persis seperti yang C1 lakukan untuk `menunggu` dan
 * `batal`.
 */
const NILAI_STATUS = [
  "diminta",
  "mencari_mitra",
  "mitra_siap",
  "dibatalkan_klien",
  "berjalan",
  "tidak_hadir",
  "dibatalkan_padma",
];

/**
 * Pencocokan DEKAT KATA `status`, bukan literalnya sendiri.
 *
 * Sebabnya: beberapa literal yang sama sah di tempat lain — `"ditolak"` juga
 * anggota enum `screening_followup`, dan `"selesai"` juga salah satu fase
 * pengunggah PDF. Melarang katanya di mana saja akan memaksa dua modul yang
 * tidak ada hubungannya dengan C1 memakai konstanta yang tidak berlaku bagi
 * mereka.
 *
 * `status` ditulis huruf kecil dan case-sensitive: `STATUS_SAH` milik modul
 * skrining karena itu tidak ikut terjaring.
 */
const dekatStatus = (nilai: string) =>
  new RegExp(`status[^\n]{0,40}["']${nilai}["']`);

function berkasTs(dir: string): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(dir, { withFileTypes: true })) {
    const penuh = path.join(dir, entri.name);
    if (entri.isDirectory()) hasil.push(...berkasTs(penuh));
    else if (entri.name.endsWith(".ts") || entri.name.endsWith(".tsx")) hasil.push(penuh);
  }
  return hasil;
}

/** Komentar dilucuti dulu — penjelasan riwayat BOLEH menyebut nama lama. */
function tanpaKomentar(isi: string): string {
  return isi.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("satu sumber nilai status", () => {
  const berkas = berkasTs(AKAR).filter((f) => f !== SUMBER_SAH);

  it("tidak ada kode yang masih menyebut nilai status lama", () => {
    const pelanggar: string[] = [];
    for (const f of berkas) {
      const kode = tanpaKomentar(readFileSync(f, "utf8"));
      for (const mati of NILAI_MATI) {
        // `menunggu_verifikasi` adalah enum pay_status yang SAH dan tidak
        // disentuh C1 — kutip penutup pada pola memisahkannya.
        if (dekatStatus(mati).test(kode)) pelanggar.push(`${path.relative(AKAR, f)} → ${mati}`);
      }
    }
    expect(pelanggar).toEqual([]);
  });

  it("tidak ada nilai status yang ditulis literal di luar modulnya", () => {
    const pelanggar: string[] = [];
    for (const f of berkas) {
      const kode = tanpaKomentar(readFileSync(f, "utf8"));
      for (const nilai of NILAI_STATUS) {
        if (dekatStatus(nilai).test(kode)) pelanggar.push(`${path.relative(AKAR, f)} → ${nilai}`);
      }
    }
    expect(pelanggar).toEqual([]);
  });
});
