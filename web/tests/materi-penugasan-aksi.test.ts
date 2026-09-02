// tests/materi-penugasan-aksi.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SUMBER = readFileSync(
  path.resolve(__dirname, "../src/app/admin/materi/penugasan-aksi.ts"), "utf8",
);

describe("aksi penugasan — pagar struktural", () => {
  it("setiap aksi memanggil requireRole SENDIRI, dan memeriksa hasil tulisnya SENDIRI", () => {
    const aksi = [...SUMBER.matchAll(/export async function (\w+)/g)];
    expect(aksi.length).toBeGreaterThan(0);

    // Jumlah total TIDAK CUKUP: dibuktikan lewat mutasi, kedua requireRole bisa
    // ditumpuk di satu aksi sementara aksi lain sama sekali tanpa penjaga, dan
    // totalnya tetap cocok. Server action adalah endpoint POST tersendiri — di
    // repo ini sudah dibuktikan bisa dipanggil dari rute lain — jadi SETIAP
    // badan aksi wajib memuat penjaganya sendiri. Begitu juga pemeriksaan hasil
    // tulis: satu kemunculan di mana pun pada berkas juga terbukti lolos lewat
    // mutasi yang sama (satu aksi kehilangan .select("material_id") sama
    // sekali). Kedua penjaga karena itu diikat PER BADAN FUNGSI, bukan pada
    // seluruh berkas.
    for (let i = 0; i < aksi.length; i++) {
      const mulai = aksi[i].index!;
      // Asumsi: badan tiap aksi berakhir tepat di deklarasi berikutnya (atau
      // EOF untuk yang terakhir) — kode SETELAH aksi terakhir, atau DI ANTARA
      // dua aksi tapi di luar keduanya, ikut terserap tanpa disadari. Benar
      // untuk susunan berkas ini hari ini; edit berikutnya yang menambah kode
      // di luar badan fungsi bisa membuat asumsi ini diam-diam salah.
      const akhir = i + 1 < aksi.length ? aksi[i + 1].index! : SUMBER.length;
      const tubuh = SUMBER.slice(mulai, akhir);

      // Regex toleran spasi DAN gaya kutip: pada rencana ini satu asersi
      // pernah dikalahkan hanya dengan mengganti kutip ganda ke tunggal, dan
      // satu lagi dikalahkan oleh reformat yang menambah/mengurangi spasi.
      expect(tubuh, `${aksi[i][1]} tidak memanggil requireRole sendiri`).toMatch(
        /requireRole\(\s*\[\s*["']admin["']\s*,\s*["']owner["']\s*\]\s*\)/,
      );
      // PostgREST menjawab 200 + [] untuk tulis yang ditolak RLS, bukan error.
      expect(tubuh, `${aksi[i][1]} tidak memeriksa hasil tulisnya`).toMatch(
        /\.select\(\s*["']material_id["']\s*\)/,
      );
    }
  });

  it("ditugaskan_oleh tidak pernah dikirim dari kode — trigger yang mengisinya", () => {
    // Diikat pada payload insert, BUKAN pada seluruh berkas: komentar yang
    // menjelaskan kenapa kolom itu tidak dikirim justru memuat namanya, dan
    // asersi yang memindai seluruh sumber akan merah karena komentar. Test yang
    // merah karena komentar akan dilemahkan orang berikutnya — lalu pagar
    // aslinya ikut hilang.
    const payload = SUMBER.match(/\.insert\(\{([^}]*)\}\)/)?.[1] ?? "";
    expect(payload).toContain("material_id");
    expect(payload).not.toContain("ditugaskan_oleh");
  });
});
