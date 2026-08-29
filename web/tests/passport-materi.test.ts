/**
 * Materi panduan: daftar (`src/app/passport/materi/page.tsx`) dan reader
 * (`src/app/passport/materi/[id]/page.tsx`).
 *
 * Ini halaman paling sensitif di seluruh passport, dan kegagalannya SENYAP —
 * halaman tetap 200, kartu terkunci tetap tampak terkunci, sementara isinya
 * sudah ikut terkirim ke perangkat:
 *
 *  1. Halaman DAFTAR membawa isi. Cukup satu kolom `isi`/`url` ikut ter-select
 *     dan seluruh e-book beserta URL video masuk ke payload halaman — gembok di
 *     kartu hanya gambar, teksnya sudah ada di View Source. Karena itu markup
 *     daftar diperiksa terhadap SETIAP isi bab & URL video yang ada di basis
 *     data (dibaca dengan service role KHUSUS DI TEST sebagai pembanding),
 *     bukan terhadap satu contoh yang dipilih tangan.
 *  2. Reader menampilkan isi yang tidak berhak. RLS mengembalikan bab/video
 *     hanya untuk klien yang berhak, jadi "terkunci" berbentuk ARRAY KOSONG dan
 *     OBJEK NULL — bukan error. Halaman yang lupa memeriksanya akan merender
 *     kerangka kosong, atau lebih buruk: menyimpulkan berhak dari kolom lain.
 *     Akses langsung ke URL materi terkunci diuji apa adanya.
 *  3. `materials.aktif` tidak dievaluasi policy `material_chapters` /
 *     `material_videos`. Materi yang ditarik admin tetap punya bab yang terbaca
 *     RLS — penyaringan `aktif` adalah tanggung jawab query aplikasi sendiri,
 *     di daftar MAUPUN di reader.
 *
 * Bentuk kartu diuji lewat atribut `data-*`, bukan kelas Tailwind: kelas berubah
 * tiap kali desain disetel, sedangkan "materi ini terbuka atau tidak" adalah
 * kontrak yang sesungguhnya.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

// Layanan 1101 Sankalpa Fertility Massage — Ananda punya sesi `selesai`.
const TERBUKA_VIDEO = "77777777-7777-7777-7777-777777777701";
const TERBUKA_EBOOK = "77777777-7777-7777-7777-777777777702";
// Layanan 1106 Lactation Hero — Ananda tidak pernah menjalaninya.
const TERKUNCI_VIDEO = "77777777-7777-7777-7777-777777777703";
const TERKUNCI_EBOOK = "77777777-7777-7777-7777-777777777704";

const svc = createAdminSupabase();

// Lapisan data passport memakai sesi pengguna (createServerSupabase). Di vitest
// tidak ada cookie, jadi klien ber-sesi sungguhan disuntikkan — RLS tetap yang
// menjadi penjaga, persis seperti di produksi. Service role di berkas ini hanya
// dipakai sebagai PEMBANDING (apa yang seharusnya tidak terlihat), tidak pernah
// sebagai jalur baca halaman.
const ref = vi.hoisted(() => ({ klien: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.klien!,
}));

// `notFound()` melempar di Next.js sungguhan juga; di sini dibuat bisa dikenali
// supaya "halaman diam-diam merender kerangka kosong" tidak lolos sebagai lulus.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

beforeAll(async () => {
  ref.klien = await signInAs("ananda@padma.test");
});

async function markupDaftar(): Promise<string> {
  const { default: HalamanMateri } = await import("@/app/passport/materi/page");
  return renderToStaticMarkup(await HalamanMateri());
}

async function markupReader(id: string): Promise<string> {
  const { default: ReaderMateri } = await import("@/app/passport/materi/[id]/page");
  // Next 16: `params` adalah Promise.
  return renderToStaticMarkup(await ReaderMateri({ params: Promise.resolve({ id }) }));
}

function hitung(markup: string, pola: RegExp): number {
  return [...markup.matchAll(pola)].length;
}

/** React meloloskan `&`, `<`, `"`, `'` — teks harapan diloloskan dengan tabel yang sama. */
function esc(teks: string): string {
  return teks
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** SELURUH isi bab yang ada di basis data, dibaca menembus RLS (pembanding). */
async function semuaIsiBab(): Promise<Array<{ judul: string; isi: string }>> {
  const { data, error } = await svc.from("material_chapters").select("judul, isi");
  if (error) throw error;
  return data as Array<{ judul: string; isi: string }>;
}

/** SELURUH URL video yang ada di basis data, dibaca menembus RLS (pembanding). */
async function semuaUrlVideo(): Promise<string[]> {
  const { data, error } = await svc.from("material_videos").select("url");
  if (error) throw error;
  return (data as Array<{ url: string }>).map((v) => v.url);
}

/** Baris pertama isi bab — cuplikan yang cukup khas untuk dicari di markup. */
const cuplikan = (isi: string) => isi.split("\n")[0].slice(0, 60);

describe("daftar materi — apa yang klien lihat", () => {
  it("seluruh materi aktif tampil, terkunci maupun tidak", async () => {
    const m = await markupDaftar();
    for (const judul of [
      "Panduan ASI Perah",
      "Panduan Siklus Subur",
      "Pijat Mandiri Prekonsepsi",
      "Teknik Pelekatan Menyusui",
    ]) {
      expect(m, `materi "${judul}" hilang dari daftar`).toContain(judul);
    }
    expect(hitung(m, /data-materi-id="/g)).toBe(4);
  });

  it("materi terbuka menjadi tautan ke reader; materi terkunci tidak bisa diklik", async () => {
    const m = await markupDaftar();
    expect(m).toContain(`href="/passport/materi/${TERBUKA_EBOOK}"`);
    expect(m).toContain(`href="/passport/materi/${TERBUKA_VIDEO}"`);
    // Kartu terkunci tidak boleh punya tautan sama sekali — bukan tautan yang
    // "dinonaktifkan dengan CSS", karena itu tetap bisa diikuti.
    expect(m).not.toContain(`href="/passport/materi/${TERKUNCI_EBOOK}"`);
    expect(m).not.toContain(`href="/passport/materi/${TERKUNCI_VIDEO}"`);
    expect(hitung(m, /href="\/passport\/materi\/7/g)).toBe(2);
  });

  it("status terbuka/terkunci ditandai pada kartunya sendiri", async () => {
    const m = await markupDaftar();
    expect(hitung(m, /data-materi-terbuka="ya"/g)).toBe(2);
    expect(hitung(m, /data-materi-terbuka="tidak"/g)).toBe(2);
    const kartu = m.match(/data-materi-id="[^"]+" data-materi-terbuka="[^"]+"/g) ?? [];
    expect(kartu).toHaveLength(4);
    expect(kartu.join(" ")).toContain(`data-materi-id="${TERKUNCI_EBOOK}" data-materi-terbuka="tidak"`);
  });

  it("kartu terkunci menjelaskan cara membukanya, bukan sekadar gembok", async () => {
    const m = await markupDaftar();
    expect(hitung(m, /Terbuka setelah layanan terkait selesai/g)).toBe(2);
  });

  it("kartu terbuka menyebut jenis materi dan layanan asalnya", async () => {
    const m = await markupDaftar();
    expect(m).toContain("E-Book · baca di aplikasi");
    expect(m).toContain("Video · tonton di aplikasi");
    expect(m).toContain("Sankalpa Fertility Massage");
    // Layanan materi terkunci tidak perlu ikut disebut — kartu terkunci hanya
    // memberi judul dan cara membukanya.
    expect(m).not.toContain("Lactation Hero");
  });

  it("judul halaman menjelaskan aturan keterbukaan materi", async () => {
    const m = await markupDaftar();
    expect(m).toContain("Materi Panduan Anda");
    expect(m).toContain("terbuka sesuai layanan yang Anda jalani");
  });

  it("catatan pelindung ditulis apa adanya (tanpa unduhan, ditandai identitas)", async () => {
    const m = await markupDaftar();
    expect(m).toContain(esc("Semua materi eksklusif untuk klien PADMA"));
    expect(m).toContain("tanpa unduhan");
  });
});

describe("daftar materi — pagar kebocoran (halaman ini tidak boleh membawa isi)", () => {
  it("tidak memuat SATU PUN URL video, terbuka maupun terkunci", async () => {
    const m = await markupDaftar();
    for (const url of await semuaUrlVideo()) {
      expect(m, `URL video ${url} bocor ke halaman daftar`).not.toContain(url);
    }
    expect(m.toLowerCase()).not.toContain("vimeo.com");
  });

  it("tidak memuat SATU PUN potongan isi bab, terbuka maupun terkunci", async () => {
    const m = await markupDaftar();
    const bab = await semuaIsiBab();
    expect(bab.length).toBeGreaterThanOrEqual(4); // seed memang berisi
    for (const b of bab) {
      expect(m, `isi bab "${b.judul}" bocor ke halaman daftar`).not.toContain(
        esc(cuplikan(b.isi)),
      );
      expect(m, `judul bab "${b.judul}" bocor ke halaman daftar`).not.toContain(
        esc(b.judul),
      );
    }
  });

  it("materi yang ditarik admin (aktif=false) hilang dari daftar", async () => {
    // `materials.aktif` TIDAK dievaluasi policy chapters/videos: babnya tetap
    // terbaca RLS, jadi penyaringan ini murni tanggung jawab query aplikasi.
    await svc.from("materials").update({ aktif: false }).eq("id", TERBUKA_EBOOK);
    try {
      const m = await markupDaftar();
      expect(m).not.toContain("Panduan Siklus Subur");
      expect(hitung(m, /data-materi-id="/g)).toBe(3);
    } finally {
      await svc.from("materials").update({ aktif: true }).eq("id", TERBUKA_EBOOK);
    }
  });
});

describe("reader materi — e-book yang sudah terbuka", () => {
  it("seluruh bab tampil berurutan, judul beserta isinya", async () => {
    const m = await markupReader(TERBUKA_EBOOK);
    const { data } = await svc
      .from("material_chapters")
      .select("urutan, judul, isi")
      .eq("material_id", TERBUKA_EBOOK)
      .order("urutan");
    const bab = data as Array<{ urutan: number; judul: string; isi: string }>;
    expect(bab).toHaveLength(3);

    let posisi = -1;
    for (const b of bab) {
      expect(m, `judul bab "${b.judul}" tidak sampai ke layar`).toContain(esc(b.judul));
      expect(m, `isi bab "${b.judul}" tidak sampai ke layar`).toContain(
        esc(cuplikan(b.isi)),
      );
      const kini = m.indexOf(esc(b.judul));
      expect(kini, `bab "${b.judul}" tampil di luar urutan`).toBeGreaterThan(posisi);
      posisi = kini;
    }
    expect(m).toContain("Panduan Siklus Subur");
  });

  it("teks bab dirender utuh dengan pemisah paragraf, bukan satu blok rapat", async () => {
    const m = await markupReader(TERBUKA_EBOOK);
    expect(m).toContain("whitespace-pre-line");
  });

  it("watermark identitas klien menyertai isi (deterrent, bukan proteksi mutlak)", async () => {
    const m = await markupReader(TERBUKA_EBOOK);
    expect(m).toContain("Ananda Putri · PAD-2607-0012");
    expect(m).toContain('aria-hidden="true"');
    // Watermark tidak boleh menghalangi interaksi di atasnya.
    expect(m).toContain("pointer-events-none");
  });

  it("tidak ada berkas yang bisa diunduh atau diteruskan dari reader", async () => {
    const m = await markupReader(TERBUKA_EBOOK);
    expect(m).not.toMatch(/\bdownload\b/i);
    expect(m).not.toMatch(/href="https?:/);
    expect(m).not.toContain(".pdf");
  });

  it("menyediakan jalan kembali ke daftar materi", async () => {
    const m = await markupReader(TERBUKA_EBOOK);
    expect(m).toMatch(/href="\/passport\/materi"/);
    expect(m).toContain("Kembali ke Materi");
  });

  it("isi bab tidak pernah menjadi bagian URL", async () => {
    const m = await markupReader(TERBUKA_EBOOK);
    const bab = await semuaIsiBab();
    for (const b of bab) {
      expect(m).not.toContain(encodeURIComponent(cuplikan(b.isi)));
    }
    expect(m).not.toMatch(/href="[^"]*\bisi=/i);
  });
});

describe("reader materi — video yang sudah terbuka", () => {
  it("menampilkan pemutar dengan keterangan jujur, tanpa membocorkan URL-nya", async () => {
    const m = await markupReader(TERBUKA_VIDEO);
    expect(m).toContain("Pijat Mandiri Prekonsepsi");
    for (const url of await semuaUrlVideo()) {
      expect(m, `URL video ${url} bocor ke reader`).not.toContain(url);
    }
    expect(m.toLowerCase()).not.toContain("vimeo.com");
    // Kesiapan tidak boleh dikarang: pemutar sungguhan belum ada.
    expect(m).toContain("fase berikutnya");
  });

  it("tidak menyisipkan pemutar pihak ketiga apa pun", async () => {
    const m = await markupReader(TERBUKA_VIDEO);
    expect(m).not.toContain("<iframe");
    expect(m).not.toContain("<video");
  });
});

describe("reader materi — yang belum terbuka (akses langsung ke URL)", () => {
  it("e-book terkunci: halaman penjelasan, BUKAN isi bab", async () => {
    const m = await markupReader(TERKUNCI_EBOOK);
    expect(m).toContain("Materi ini belum terbuka");
    expect(m).toContain("Panduan ASI Perah"); // judulnya boleh — hanya meta

    const { data } = await svc
      .from("material_chapters")
      .select("judul, isi")
      .eq("material_id", TERKUNCI_EBOOK);
    const bab = data as Array<{ judul: string; isi: string }>;
    expect(bab.length).toBeGreaterThan(0); // babnya memang ada di basis data
    for (const b of bab) {
      expect(m, `isi bab terkunci "${b.judul}" bocor lewat akses langsung`).not.toContain(
        esc(cuplikan(b.isi)),
      );
      expect(m).not.toContain(esc(b.judul));
    }
    expect(m).toMatch(/href="\/passport\/materi"/); // tetap ada jalan kembali
  });

  it("video terkunci: halaman penjelasan, tanpa URL video", async () => {
    const m = await markupReader(TERKUNCI_VIDEO);
    expect(m).toContain("Materi ini belum terbuka");
    for (const url of await semuaUrlVideo()) {
      expect(m, `URL video ${url} bocor lewat akses langsung`).not.toContain(url);
    }
    expect(m.toLowerCase()).not.toContain("vimeo.com");
  });

  it("watermark tidak dipasang pada halaman yang tidak berisi materi", async () => {
    const m = await markupReader(TERKUNCI_EBOOK);
    expect(m).not.toContain("PAD-2607-0012");
  });

  it("materi yang ditarik admin (aktif=false) tidak bisa dibaca walau babnya terbaca RLS", async () => {
    await svc.from("materials").update({ aktif: false }).eq("id", TERBUKA_EBOOK);
    try {
      // Bab materi ini TETAP dikembalikan RLS untuk Ananda — buktinya di sini,
      // supaya jelas bahwa yang menyaring adalah query reader, bukan policy.
      const { data } = await ref.klien!
        .from("material_chapters")
        .select("id")
        .eq("material_id", TERBUKA_EBOOK);
      expect((data ?? []).length).toBeGreaterThan(0);

      await expect(markupReader(TERBUKA_EBOOK)).rejects.toThrow("NEXT_NOT_FOUND");
    } finally {
      await svc.from("materials").update({ aktif: true }).eq("id", TERBUKA_EBOOK);
    }
  });

  it("id materi yang tidak dikenal berakhir 404, bukan halaman kosong", async () => {
    await expect(
      markupReader("99999999-9999-9999-9999-999999999999"),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("komponen watermark", () => {
  it("mengulang identitas klien secukupnya untuk menutupi halaman", async () => {
    const { Watermark } = await import("@/app/passport/_komponen/watermark");
    const m = renderToStaticMarkup(
      createElement(Watermark, { nama: "Ananda Putri", padmaId: "PAD-2607-0012" }),
    );
    expect(hitung(m, /Ananda Putri · PAD-2607-0012/g)).toBeGreaterThanOrEqual(10);
    expect(m).toContain('aria-hidden="true"');
    expect(m).toContain("pointer-events-none");
  });
});

describe("materi — pagar sumber", () => {
  const sumberDaftar = baca("src/app/passport/materi/page.tsx");
  const sumberReader = baca("src/app/passport/materi/[id]/page.tsx");
  const sumberWatermark = baca("src/app/passport/_komponen/watermark.tsx");

  it("keduanya Server Component yang membaca lewat lapisan data passport", () => {
    for (const sumber of [sumberDaftar, sumberReader]) {
      expect(sumber).not.toContain('"use client"');
    }
    expect(sumberDaftar).toMatch(
      /import\s*\{[^}]*\bambilDaftarMateri\b[^}]*\}\s*from\s*["']@\/lib\/passport\/data["']/,
    );
    expect(sumberReader).toMatch(
      /import\s*\{[^}]*\bambilMateriDetail\b[^}]*\}\s*from\s*["']@\/lib\/passport\/data["']/,
    );
  });

  it("halaman daftar tidak pernah menyentuh pengambil detail materi", () => {
    // Satu pemanggilan `ambilMateriDetail` di halaman daftar sudah cukup untuk
    // menarik seluruh isi bab ke payload halaman yang paling sering dibuka.
    expect(sumberDaftar).not.toContain("ambilMateriDetail");
    expect(sumberDaftar).not.toContain("material_chapters");
    expect(sumberDaftar).not.toContain("material_videos");
  });

  it("keterbukaan disimpulkan dari bentuk embed yang benar (array vs objek/null)", () => {
    // `material_videos` adalah OBJEK atau null — `video.length === 0` selalu
    // salah dan akan membuat setiap video tampak terkunci.
    expect(sumberReader).not.toMatch(/videoUrl\s*\.\s*length/);
    expect(sumberReader).toMatch(/videoUrl\s*!==\s*null/);
    expect(sumberReader).toMatch(/bab\.length\s*>\s*0/);
  });

  it("judul halaman mengandalkan template metadata, tidak mengulang nama aplikasi", () => {
    expect(sumberDaftar).toMatch(/title:\s*"Materi Panduan"/);
    for (const sumber of [sumberDaftar, sumberReader]) {
      expect(sumber).not.toMatch(/title:\s*"[^"]*PADMA[^"]*"/);
    }
  });

  it("isi materi tidak pernah dicatat ke log", () => {
    for (const sumber of [sumberDaftar, sumberReader, sumberWatermark]) {
      expect(sumber).not.toContain("console.");
    }
  });

  it("reader menyulitkan penyalinan tanpa menjanjikan proteksi mutlak", () => {
    expect(sumberReader).toContain("select-none");
    // Kejujuran yang diminta spec: watermark & select-none adalah deterrent.
    expect(sumberWatermark.toLowerCase()).toContain("deterrent");
  });
});

afterAll(async () => {
  // Jaring pengaman bila sebuah test gagal di tengah blok aktif=false.
  await svc.from("materials").update({ aktif: true }).eq("id", TERBUKA_EBOOK);
});
