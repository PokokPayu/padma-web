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
const NILAI_MATI = ["'menunggu'", '"menunggu"', "'batal'", '"batal"'];

/** Nilai baru — sah, tetapi hanya boleh disebut modul sumbernya. */
const NILAI_BARU = [
  "'diminta'",
  '"diminta"',
  "'mencari_mitra'",
  '"mencari_mitra"',
  "'mitra_siap'",
  '"mitra_siap"',
  "'dibatalkan_klien'",
  '"dibatalkan_klien"',
  "'dibatalkan_padma'",
  '"dibatalkan_padma"',
];

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
        // disentuh C1 — literalnya berbeda, jadi pencocokan penuh di atas
        // (dengan kutip di kedua sisi) sudah memisahkannya.
        if (kode.includes(mati)) pelanggar.push(`${path.relative(AKAR, f)} → ${mati}`);
      }
    }
    expect(pelanggar).toEqual([]);
  });

  it("nilai status baru pun tidak ditulis literal di luar modulnya", () => {
    const pelanggar: string[] = [];
    for (const f of berkas) {
      const kode = tanpaKomentar(readFileSync(f, "utf8"));
      for (const nilai of NILAI_BARU) {
        if (kode.includes(nilai)) pelanggar.push(`${path.relative(AKAR, f)} → ${nilai}`);
      }
    }
    expect(pelanggar).toEqual([]);
  });
});
