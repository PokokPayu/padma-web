/**
 * Penjagaan jalur pemulihan setup Supabase lokal.
 *
 * Kenapa test ini ada: `npx supabase db reset` bisa gagal karena sebab
 * LINGKUNGAN, bukan karena isi repo — Docker daemon sedang tersendat, tarikan
 * image gagal, atau container stack lokal tertinggal di keadaan basi sehingga
 * CLI berhenti dengan `LegacyDbSetupError` / `LegacyRestartServicesError`.
 * Developer baru yang mengikuti README tidak punya petunjuk apa pun saat itu
 * terjadi, dan gampang menyimpulkan repo-nya rusak.
 *
 * Pemulihannya selalu sama: bangun ulang stack lokal (`supabase stop` lalu
 * `supabase start`), baru `db reset` lagi. Test ini menjaga agar jalan keluar
 * itu tetap terdokumentasi di README DAN tersedia sebagai satu perintah npm —
 * menghapus salah satunya membuat `npm test` MERAH.
 *
 * Test ini sengaja hanya MEMBACA berkas; ia tidak pernah menjalankan
 * `db:recover` (menjalankannya akan mematikan stack Supabase yang sedang
 * dipakai test lain).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");

const README = readFileSync(path.join(AKAR, "README.md"), "utf8");
const PKG = JSON.parse(readFileSync(path.join(AKAR, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};

describe("pemulihan setup Supabase — script npm", () => {
  it("package.json menyediakan script db:recover", () => {
    expect(
      PKG.scripts?.["db:recover"],
      "script `db:recover` hilang dari package.json",
    ).toBeTypeOf("string");
  });

  it("db:recover membangun ulang stack lalu reset, berurutan", () => {
    const perintah = PKG.scripts?.["db:recover"] ?? "";
    const urutan = ["supabase stop", "supabase start", "supabase db reset"];
    let posisi = -1;
    for (const langkah of urutan) {
      const ditemukan = perintah.indexOf(langkah, posisi + 1);
      expect(
        ditemukan,
        `db:recover harus memuat \`${langkah}\` sesudah langkah sebelumnya (perintah: ${perintah})`,
      ).toBeGreaterThan(posisi);
      posisi = ditemukan;
    }
  });
});

describe("pemulihan setup Supabase — catatan README", () => {
  it("README menyebut perintah pemulihan satu langkah", () => {
    expect(README, "README tidak menyebut `npm run db:recover`").toContain(
      "npm run db:recover",
    );
  });

  it("README menyebut padanan manualnya", () => {
    expect(
      README,
      "README tidak menyebut `npx supabase stop && npx supabase start`",
    ).toContain("npx supabase stop && npx supabase start");
  });

  it("README menyebut gejala error agar developer bisa mencocokkan", () => {
    for (const gejala of ["LegacyDbSetupError", "LegacyRestartServicesError"]) {
      expect(README, `README tidak menyebut gejala \`${gejala}\``).toContain(gejala);
    }
  });
});
