/**
 * YANG TIDAK DILAKUKAN PENILAIAN (spec C1 J10).
 *
 * Spec menuliskannya eksplisit "supaya tidak merayap": rating TIDAK memengaruhi
 * honor mitra, TIDAK dipakai memilih mitra secara otomatis, dan TIDAK pernah
 * terlihat oleh klien lain. Ia alat pembinaan, bukan papan skor.
 *
 * Kalimat di spec tidak bisa gagal. Berkas ini yang membuatnya bisa.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");

function berkas(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...berkas(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function tanpaKomentar(isi: string): string {
  return isi.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("rating tidak menyentuh uang", () => {
  it("modul honor & rekap owner tidak pernah membaca session_ratings", () => {
    // Honor mitra dihitung dari tarif pada tanggal sesi, titik. Begitu rating
    // ikut menentukannya, penilaian berhenti menjadi umpan balik dan menjadi
    // alat tawar — dan klien yang kecewa memotong penghasilan seseorang tanpa
    // pernah bermaksud begitu.
    for (const rel of ["src/lib/owner/rekap.ts", "src/lib/owner/data.ts", "src/lib/admin/tagihan.ts"]) {
      const kode = tanpaKomentar(readFileSync(path.join(AKAR, rel), "utf8"));
      expect(kode, `${rel} menyentuh session_ratings`).not.toContain("session_ratings");
    }
  });

  it("tidak ada kolom nominal uang di tabel penilaian", () => {
    // Dijaga ganda: `tests/money-firewall-struktural.test.ts` memindai SELURUH
    // skema untuk nama kolom bernuansa uang. Uji ini menyebut tabelnya
    // eksplisit supaya niatnya terbaca di tempat yang benar.
    const migrasi = readFileSync(
      path.join(AKAR, "supabase/migrations/20260911100000_penilaian_sesi.sql"),
      "utf8",
    );
    expect(migrasi).not.toMatch(/\b(harga|tarif|honor|nominal|rupiah)\b/i);
  });
});

describe("rating tidak memilih mitra", () => {
  it("pengurutan mitra tidak pernah membaca penilaian", () => {
    // `urutkanMitraMenurutJarak` sengaja hanya tahu jarak. Menambahkan rating
    // ke dalamnya berarti sistem mulai memutuskan siapa yang datang — padahal
    // ia tidak tahu cuti, jam kerja, maupun kecocokan keahlian.
    const kode = tanpaKomentar(
      readFileSync(path.join(AKAR, "src/lib/jadwal/urutan-mitra.ts"), "utf8"),
    );
    expect(kode).not.toContain("rating");
    expect(kode).not.toContain("bintang");
  });
});

describe("rating tidak pernah terlihat klien lain", () => {
  it("tidak ada halaman publik atau landing yang membaca penilaian", () => {
    // Klien membaca miliknya sendiri (policy RLS), staf membaca semua. Yang
    // dilarang di sini adalah permukaan yang membocorkannya ke pengunjung —
    // "bintang 4,8 dari 120 ulasan" adalah papan skor, dan spec menolaknya.
    const publik = [
      ...berkas(path.join(AKAR, "src/app/_landing")),
      path.join(AKAR, "src/app/page.tsx"),
      path.join(AKAR, "src/app/skrining/wizard.tsx"),
    ];
    for (const f of publik) {
      const kode = tanpaKomentar(readFileSync(f, "utf8"));
      expect(kode, `${path.relative(AKAR, f)} membaca penilaian`).not.toContain("session_ratings");
    }
  });

  it("komentar bebas tidak pernah dirender sebagai markup", () => {
    // Komentar adalah teks tak tepercaya dan bisa memuat keterangan kesehatan.
    // `dangerouslySetInnerHTML` di mana pun berkas yang menampilkannya adalah
    // cacat, bukan pilihan gaya.
    for (const f of berkas(path.join(AKAR, "src/app"))) {
      const isi = readFileSync(f, "utf8");
      if (!isi.includes("komentar")) continue;
      expect(isi, `${path.relative(AKAR, f)}`).not.toContain("dangerouslySetInnerHTML");
    }
  });
});
