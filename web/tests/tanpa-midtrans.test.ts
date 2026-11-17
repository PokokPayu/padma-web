/**
 * PAGAR: Midtrans sudah dicabut sampai ke akarnya (spec DOKU §5.8).
 *
 * Tiga hal dijaga, masing-masing lahir dari cara Midtrans bisa kembali tanpa
 * ada yang sengaja:
 *   1. `src/` tidak menyebut Midtrans di luar komentar. Komentar sejarah yang
 *      disengaja ("versi Midtrans P1 punya cacat X") boleh; kode, label layar,
 *      dan teks hukum tidak. Label layar dan dokumen hukum adalah JSX, bukan
 *      komentar, jadi mereka ikut terjaga.
 *   2. `.env.example` tidak lagi memuat env Midtrans. Env yang tidak dibaca
 *      siapa pun adalah sasaran empuk bagi orang yang mengira pembayaran masih
 *      lewat Snap.
 *   3. Fungsi basis data lama `terapkan_notifikasi_midtrans` sudah di-drop.
 *      Fungsi `security definer` yang masih hidup tapi tak dipanggil adalah
 *      pintu uang yang tidak dijaga uji mana pun.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { querySql } from "./helpers/db";

const AKAR = path.resolve(__dirname, "..");
const SRC = path.join(AKAR, "src");

function berkasSumber(dir: string): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(dir, { withFileTypes: true })) {
    const anak = path.join(dir, entri.name);
    if (entri.isDirectory()) hasil.push(...berkasSumber(anak));
    else if (/\.(tsx?|css|json|md)$/.test(entri.name)) hasil.push(anak);
  }
  return hasil;
}

/** Baris yang seluruhnya komentar: `//`, `/*`, `*`, atau `{/*` JSX. */
function barisKomentar(baris: string): boolean {
  return /^\s*(\/\/|\/\*|\*|\{\/\*)/.test(baris);
}

describe("tanpa Midtrans", () => {
  it("src/ tidak menyebut Midtrans di luar baris komentar", () => {
    const sisa: string[] = [];
    for (const berkas of berkasSumber(SRC)) {
      readFileSync(berkas, "utf8")
        .split("\n")
        .forEach((baris, i) => {
          if (/midtrans/i.test(baris) && !barisKomentar(baris)) {
            sisa.push(`${path.relative(AKAR, berkas)}:${i + 1}: ${baris.trim()}`);
          }
        });
    }
    expect(sisa).toEqual([]);
  });

  it(".env.example tidak memuat MIDTRANS", () => {
    const contoh = readFileSync(path.join(AKAR, ".env.example"), "utf8");
    expect(contoh).not.toMatch(/MIDTRANS/i);
  });

  it("fungsi terapkan_notifikasi_midtrans tidak ada lagi di basis data", async () => {
    const baris = await querySql<{ proname: string }>(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'terapkan_notifikasi_midtrans'`,
    );
    expect(baris).toEqual([]);
  });
});
