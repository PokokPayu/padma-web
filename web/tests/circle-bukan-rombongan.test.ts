import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * CIRCLE BUKAN SESI ROMBONGAN (spec C1 J13).
 *
 * Perkara ini ditunda DUA kali sebelumnya — spec varian §9 dan spec transport —
 * dengan kalimat "hari ini Circle baru berarti harga". Klien menutupnya
 * 8 September 2026: tidak ada pembeda antara Private dan Circle selain harga.
 * Pemesan Circle tetap satu orang, satu akun, satu sesi.
 *
 * Karena tidak ada kode yang perlu ditulis, godaannya adalah tidak menulis apa
 * pun — dan kesunyian itu kelak terbaca sebagai "belum dikerjakan", lalu dibuka
 * lagi untuk ketiga kalinya. Uji ini bukan menjaga fitur; ia menjaga KETIADAAN
 * fitur, supaya keputusan yang sudah diambil punya wujud yang bisa gagal.
 */
const AKAR = path.resolve(__dirname, "..");

/**
 * Jalur pemesanan dari ujung ke ujung: tempat sesi rombongan akan merayap masuk
 * bila ia pernah dibuka lagi tanpa spec baru.
 */
const JALUR_PEMESANAN = [
  "src/lib/passport/aksi.ts",
  "src/app/passport/ajukan/form.tsx",
  "src/app/passport/ajukan/page.tsx",
  "src/app/admin/sesi/aksi.ts",
  "src/app/admin/sesi/antrean-permintaan.tsx",
];

/**
 * Kata yang hanya masuk akal bila sesi punya lebih dari satu penerima layanan.
 * "peserta" sengaja TIDAK termasuk `pesertaan`/`kepesertaan` — pencocokannya
 * pada kata utuh.
 */
const POLA_ROMBONGAN = /\b(peserta|rombongan|patungan)\b/i;

function tanpaKomentar(isi: string): string {
  return isi.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("Circle tidak punya perlakuan khusus di jalur pemesanan (spec J13)", () => {
  for (const rel of JALUR_PEMESANAN) {
    it(`${rel} tidak memuat konsep peserta jamak`, () => {
      const kode = tanpaKomentar(readFileSync(path.join(AKAR, rel), "utf8"));
      expect(POLA_ROMBONGAN.test(kode), `${rel} menyebut konsep rombongan`).toBe(false);
    });
  }

  it("formulir pemesanan menawarkan VARIAN, bukan jumlah orang", () => {
    // Circle adalah varian berformat lain dengan harga lebih murah; formulir
    // memperlakukannya persis seperti varian mana pun. Bila suatu saat ada
    // medan "jumlah peserta", uji ini merah — dan itulah maksudnya.
    const form = readFileSync(path.join(AKAR, "src/app/passport/ajukan/form.tsx"), "utf8");
    expect(form).toContain('name="varian"');
    expect(form).not.toMatch(/name="(jumlah|peserta|orang)"/);
  });
});
