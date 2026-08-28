/**
 * Penjagaan halaman wizard skrining (`/skrining`).
 *
 * Kenapa test ini ada: `tests/skrining-evaluasi.test.ts` menjaga mesin
 * penilaian, tetapi wizard-lah yang memutuskan pertanyaan mana ditanyakan,
 * kapan skrining dihentikan, dan teks keselamatan apa yang benar-benar dilihat
 * pengunjung. Bila wizard menyalin ulang bank soal, menampilkan blok darurat
 * 119 di semua hasil merah, atau menaruh kode/hasil skrining ke URL, seluruh
 * unit test lain tetap hijau dan regresi keselamatan lolos diam-diam.
 *
 * Dua lapis:
 *  1. Render sungguhan layar intro (react-dom/server) — memastikan pilihan
 *     fase memang 4 dan teks disclaimer benar-benar sampai ke markup.
 *  2. Pembacaan sumber apa adanya — untuk pagar yang hanya muncul pada layar
 *     lanjutan (blok 119, chip tersimpan, penghentian urgent).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LABEL_FASE } from "@/lib/skrining/bank-soal";
import { Wizard } from "@/app/skrining/wizard";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const sumberWizard = baca("src/app/skrining/wizard.tsx");
const sumberHalaman = baca("src/app/skrining/page.tsx");

const markupIntro = renderToStaticMarkup(
  createElement(Wizard, { nomorWaLink: "6287778400200" }),
);

describe("halaman /skrining — shell server", () => {
  it("rute publik: tidak memanggil requireRole", () => {
    expect(sumberHalaman).not.toContain("requireRole");
  });

  it("judul mengandalkan template layout (tanpa menempel PADMA sendiri)", () => {
    expect(sumberHalaman).toMatch(/title:\s*"Skrining Awal Klien"/);
    expect(sumberHalaman).not.toMatch(/title:\s*"[^"]*PADMA/);
  });

  it("nomor WA diambil server dari app_settings, bukan ditulis keras", () => {
    expect(sumberHalaman).toContain("bacaPengaturan");
    expect(sumberHalaman).not.toMatch(/\b62\d{8,}\b/);
  });

  it("wizard adalah komponen klien dan tidak menyentuh service role", () => {
    expect(sumberWizard.trimStart().startsWith('"use client"')).toBe(true);
    expect(sumberWizard).not.toContain("supabase/admin");
    expect(sumberWizard).not.toContain("createAdminSupabase");
    expect(sumberWizard).not.toContain("SERVICE_ROLE");
    expect(sumberWizard).not.toContain("@/lib/settings");
  });
});

describe("PAGAR KESELAMATAN: pilihan fase di wizard", () => {
  it("menawarkan tepat 4 fase — newborn/Shishu tidak diskrining", () => {
    const labelTampil = Object.values(LABEL_FASE).filter((l) =>
      markupIntro.includes(l),
    );
    expect(labelTampil).toHaveLength(4);
    expect(markupIntro).not.toMatch(/shishu/i);
    expect(markupIntro).not.toMatch(/newborn/i);
    expect(markupIntro).not.toMatch(/bayi baru lahir/i);
    expect(sumberWizard).not.toMatch(/newborn/i);
  });

  it("daftar fase diambil dari bank soal, tidak diambil dari tabel phases", () => {
    expect(sumberWizard).toContain("@/lib/skrining/bank-soal");
    expect(sumberWizard).not.toContain('from("phases")');
  });
});

describe("PAGAR KESELAMATAN: bank soal tetap satu sumber kebenaran", () => {
  it("wizard memakai daftarSoal & levelSoal, tidak menyalin ulang pertanyaan", () => {
    expect(sumberWizard).toContain("daftarSoal");
    expect(sumberWizard).toContain("levelSoal");
    // Potongan teks soal asli tidak boleh muncul sebagai literal di wizard.
    expect(sumberWizard).not.toContain("Apakah suhu tubuh Anda");
    expect(sumberWizard).not.toContain("nyeri dada");
    expect(sumberWizard).not.toMatch(/urgent"\s*,\s*teks/);
  });

  it("jawaban 'ya' pada soal urgent menghentikan skrining (pakai levelSoal, bukan level statis)", () => {
    expect(sumberWizard).toMatch(/levelSoal\(\s*s\w*\s*,\s*fase\s*\)\s*===\s*"urgent"/);
  });

  it("tombol Kembali menghapus jawaban berdasarkan id soal", () => {
    expect(sumberWizard).toMatch(/delete\s+\w+\[\s*\w+\.id\s*\]/);
  });

  it("progress mencapai 100% di pertanyaan terakhir ((i+1)/n)", () => {
    expect(sumberWizard).toMatch(/\(\s*indeks\s*\+\s*1\s*\)\s*\/\s*soal\.length/);
  });
});

describe("PAGAR KESELAMATAN: disclaimer & reassurance verbatim", () => {
  it("intro memuat disclaimer bukan diagnosis medis", () => {
    expect(markupIntro).toContain("Bukan diagnosis medis.");
    expect(markupIntro).toContain(
      "Skrining ini hanya alat keselamatan awal",
    );
  });

  it("intro memuat kotak reassurance jawaban jujur", () => {
    expect(markupIntro).toContain("Jawaban jujur tidak merugikan Anda.");
    expect(markupIntro).toContain(
      "kami justru membantu mengarahkan agar layanan tetap aman",
    );
    expect(markupIntro).toContain("bukan menghukum atau mempersulit");
  });

  it("layar hasil memuat kalimat pra-skrining & penundaan demi keselamatan", () => {
    expect(sumberWizard).toContain(
      "Hasil ini adalah pra-skrining, bukan izin medis",
    );
    expect(sumberWizard).toContain(
      "Ini penundaan demi keselamatan — bukan penolakan.",
    );
  });

  it("tidak menambah klaim sumber kepatuhan di luar ACOG & CDC", () => {
    for (const sumberLain of ["NHS", "WHO", "POGI", "Kemenkes"]) {
      expect(sumberWizard).not.toContain(sumberLain);
    }
  });
});

describe("PAGAR KESELAMATAN: blok darurat 119 hanya pada merah-urgent", () => {
  it("nomor darurat 119 dan bukan 112/911", () => {
    expect(sumberWizard).toContain("119");
    expect(sumberWizard).not.toMatch(/\b(112|911)\b/);
  });

  it("119 berada di dalam blok kondisional hasil.urgent", () => {
    const blok = sumberWizard.match(
      /\{hasil\.urgent\s*&&\s*\(([\s\S]*?)\)\}/,
    );
    expect(blok, "blok {hasil.urgent && (...)} harus ada").not.toBeNull();
    expect(blok![1]).toContain("119");
    // Hanya satu kemunculan 119 di seluruh berkas: tidak ada blok darurat
    // kedua yang lolos dari syarat urgent.
    expect(sumberWizard.split("119").length - 1).toBe(1);
  });

  it("layar intro & soal tidak pernah menampilkan blok darurat", () => {
    expect(markupIntro).not.toContain("119");
  });
});

describe("PAGAR KESELAMATAN: data kesehatan tidak boleh masuk URL atau log", () => {
  it("tidak ada kode/hasil skrining yang ditulis ke URL", () => {
    for (const terlarang of [
      "useRouter",
      "useSearchParams",
      "searchParams",
      "history.pushState",
      "history.replaceState",
      "window.location.search",
      "URLSearchParams",
    ]) {
      expect(sumberWizard).not.toContain(terlarang);
    }
    // Satu-satunya URL yang dibangun adalah tautan WhatsApp (dibuka pengguna),
    // bukan navigasi aplikasi.
    const encode = [...sumberWizard.matchAll(/encodeURIComponent\(/g)];
    expect(encode).toHaveLength(1);
    expect(sumberWizard).toContain("https://wa.me/");
  });

  it("tidak mencatat jawaban ke konsol", () => {
    expect(sumberWizard).not.toContain("console.");
  });
});

describe("wizard mengirim ke endpoint server-authoritative", () => {
  it("POST /api/skrining tanpa mengirim hasil", () => {
    expect(sumberWizard).toContain('"/api/skrining"');
    const body = sumberWizard.match(/body:\s*JSON\.stringify\(\{([^}]*)\}\)/);
    expect(body, "body fetch harus berupa objek literal").not.toBeNull();
    expect(body![1]).toContain("jawaban");
    expect(body![1]).not.toContain("hasil");
    expect(body![1]).not.toContain("flags");
  });

  it("chip 'tersimpan' hanya tampil bila kode benar-benar diterima", () => {
    expect(sumberWizard).toMatch(/\{hasil\.kode\s*&&\s*\(/);
    expect(sumberWizard).toMatch(/Tersimpan di sistem PADMA/);
  });

  it("gagal simpan tidak mematikan funnel: hasil & tombol WhatsApp tetap tampil", () => {
    expect(sumberWizard).toMatch(/catch\s*\{/);
    expect(sumberWizard).toMatch(/kode:\s*null|kode: string \| null/);
  });
});

describe("layar intro tidak bisa dimulai sebelum lengkap", () => {
  it("tombol Mulai Skrining nonaktif pada keadaan awal", () => {
    const tombol = markupIntro.match(
      /<button[^>]*>\s*Mulai Skrining\s*<\/button>/,
    );
    expect(tombol, "tombol Mulai Skrining harus ada").not.toBeNull();
    expect(tombol![0]).toContain("disabled");
  });

  it("syarat mulai mencakup nama, no HP, fase, dan pernyataan jujur", () => {
    const syarat = sumberWizard.match(/bolehMulai\s*=\s*([^;]+);/);
    expect(syarat).not.toBeNull();
    for (const bagian of ["fase", "nama", "hp", "jujur"]) {
      expect(syarat![1]).toContain(bagian);
    }
  });
});
