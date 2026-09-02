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
 *  3. `materials.aktif` disaring DUA LAPIS. Sejak migration
 *     `gating_materi_hormati_aktif`, policy baca klien pada `material_pages`
 *     & `material_videos` ikut mengevaluasi `materials.aktif` — materi yang
 *     ditarik admin benar-benar berhenti dijawab basis data. Query aplikasi
 *     TETAP menyaringnya sendiri, di daftar MAUPUN di reader: lapis itu yang
 *     menentukan halamannya 404 alih-alih merender kerangka kosong.
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

/** SELURUH kunci objek halaman yang ada di basis data, dibaca menembus RLS (pembanding). */
async function semuaObjekHalaman(): Promise<string[]> {
  const { data, error } = await svc.from("material_pages").select("objek");
  if (error) throw error;
  return (data as Array<{ objek: string }>).map((p) => p.objek);
}

/** SELURUH URL video yang ada di basis data, dibaca menembus RLS (pembanding). */
async function semuaUrlVideo(): Promise<string[]> {
  const { data, error } = await svc.from("material_videos").select("url");
  if (error) throw error;
  return (data as Array<{ url: string }>).map((v) => v.url);
}

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

  it("tidak memuat SATU PUN kunci objek halaman, terbuka maupun terkunci", async () => {
    const m = await markupDaftar();
    const objek = await semuaObjekHalaman();
    expect(objek.length).toBeGreaterThanOrEqual(1); // seed memang berisi
    for (const o of objek) {
      expect(m, `kunci objek "${o}" bocor ke halaman daftar`).not.toContain(o);
    }
  });

  it("materi yang ditarik admin (aktif=false) hilang dari daftar", async () => {
    // Policy chapters/videos kini ikut mengevaluasi `materials.aktif`, tetapi
    // baris `materials` sendiri TETAP terbaca setiap pengguna login (menutupnya
    // akan mengulangi bug `partner_publik`). Jadi hilangnya kartu dari daftar
    // tetap murni tanggung jawab query aplikasi ini.
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

/** SELURUH baris material_pages materi terbuka, dibaca menembus RLS (pembanding). */
async function halamanTerbuka(): Promise<
  Array<{ halaman: number; objek: string; lebar: number; tinggi: number }>
> {
  const { data, error } = await svc
    .from("material_pages")
    .select("halaman, objek, lebar, tinggi")
    .eq("material_id", TERBUKA_EBOOK)
    .order("halaman");
  if (error) throw error;
  return data as Array<{ halaman: number; objek: string; lebar: number; tinggi: number }>;
}

describe("reader materi — e-book yang sudah terbuka (M10: gambar halaman, bukan teks bab)", () => {
  it("seluruh halaman tampil berurutan sebagai gambar, dengan dimensi asli", async () => {
    const m = await markupReader(TERBUKA_EBOOK);
    const halaman = await halamanTerbuka();
    expect(halaman).toHaveLength(3); // seed: 3 baris material_pages

    let posisi = -1;
    for (const h of halaman) {
      const src = `/api/materi/${TERBUKA_EBOOK}/halaman/${h.halaman}`;
      expect(m, `gambar halaman ${h.halaman} tidak sampai ke layar`).toContain(
        `src="${src}"`,
      );
      // Dimensi ASLI wajib ikut — tanpanya peramban tidak menyediakan ruang
      // sebelum gambarnya tiba, dan halaman melompat setiap gambar dimuat.
      expect(m).toContain(`width="${h.lebar}"`);
      expect(m).toContain(`height="${h.tinggi}"`);
      expect(m).toContain(`Halaman ${h.halaman} dari 3`);

      const kini = m.indexOf(src);
      expect(kini, `halaman ${h.halaman} tampil di luar urutan`).toBeGreaterThan(posisi);
      posisi = kini;
    }
  });

  it("watermark CSS TIDAK dilapiskan lagi — sudah dibakar ke dalam gambar server", async () => {
    const m = await markupReader(TERBUKA_EBOOK);
    // Komponen `Watermark` (identitas berulang secara diagonal) adalah untuk
    // reader teks lama. Melapisinya di atas gambar yang SUDAH ber-watermark
    // hanya akan menggandakan teks yang sama di layar.
    expect(m).not.toContain("Ananda Putri · PAD-2607-0012");
    expect(m).not.toContain("pointer-events-none");
  });

  it("tidak ada berkas yang bisa diunduh atau diteruskan dari reader", async () => {
    const m = await markupReader(TERBUKA_EBOOK);
    expect(m).not.toMatch(/\bdownload\b/i);
    expect(m).not.toMatch(/href="https?:/);
    expect(m).not.toContain(".pdf");
  });

  it("gambar disulitkan disalin: select-none pada kontainernya", async () => {
    const m = await markupReader(TERBUKA_EBOOK);
    expect(m).toContain("select-none");
  });

  it("kunci objek storage mentah TIDAK PERNAH bocor ke markup — hanya URL rute halaman", async () => {
    const m = await markupReader(TERBUKA_EBOOK);
    for (const h of await halamanTerbuka()) {
      // `objek` (mis. "<uuid>/0001.webp") adalah kunci storage privat; yang
      // boleh sampai ke klien hanyalah URL rute `/api/materi/.../halaman/n`,
      // yang diperiksa lewat gerbang RLS & watermark setiap permintaan.
      expect(m, `kunci objek "${h.objek}" bocor ke markup reader`).not.toContain(h.objek);
    }
  });

  it("reader e-book PUNYA tautan balik & judul, di ATAS gambar (fix ronde 1)", async () => {
    // Draft pertama Task 10 mengikuti pseudokode brief apa adanya
    // (`return <ReaderPdf .../>` telanjang) — itu membuat SATU-SATUNYA layar
    // yang benar-benar lama dipandangi pasien justru satu-satunya TANPA
    // jalan keluar selain tombol back peramban, sementara keadaan 1 & 2
    // sama-sama punya "← Kembali ke Materi". Diperbaiki dengan menyalin
    // markup header yang sama persis dipakai cabang video (persis reader
    // ebook SEBELUM M10) — bukan gaya baru.
    const m = await markupReader(TERBUKA_EBOOK);
    expect(m).toMatch(/href="\/passport\/materi"/);
    expect(m).toContain("Kembali ke Materi");
    expect(m).toContain("Panduan Siklus Subur"); // judul materi
    expect(m).toContain("Sankalpa Fertility Massage"); // nama layanan
    expect(m).toContain("E-Book · baca di aplikasi");
    expect(m).toContain("E-book bergambar tentang membaca siklus."); // deskripsi seed

    // Urutannya mengikat: pasien yang mulai menggulir ke bawah harus sudah
    // MELIHAT jalan keluarnya sebelum tiba di gambar halaman pertama, bukan
    // sesudahnya.
    const posisiBalik = m.indexOf("Kembali ke Materi");
    const posisiJudul = m.indexOf("Panduan Siklus Subur");
    const posisiGambarPertama = m.indexOf(
      `src="/api/materi/${TERBUKA_EBOOK}/halaman/1"`,
    );
    expect(posisiBalik).toBeGreaterThan(-1);
    expect(posisiJudul).toBeGreaterThan(posisiBalik);
    expect(posisiGambarPertama).toBeGreaterThan(posisiJudul);
  });
});

/**
 * Keadaan 2 (M10): berhak, tapi adminnya belum mengunggah satu halaman pun.
 * Tidak ada fixture seed untuk ini — TERBUKA_EBOOK selalu punya 3 halaman,
 * TERKUNCI_EBOOK tidak pernah berhak — jadi materi & penugasannya dibuat
 * langsung di sini, dipola persis `materiTanpaLayanan`/`material_assignments`
 * di tests/materi-penugasan.test.ts.
 */
describe("reader materi — e-book berhak tapi isi belum diunggah (M10, keadaan 2)", () => {
  let materiId = "";

  beforeAll(async () => {
    const db = svc;
    const { data: staf } = await db.from("profiles").select("id").eq("role", "admin").single();
    const { data: klien } = await db
      .from("clients")
      .select("id")
      .eq("email", "ananda@padma.test")
      .single();
    // Materi lahir TANPA layanan sama sekali sejak Task 11 (materials.service_id
    // sudah dihapus) — tidak perlu lagi menyisipkan lalu menghapus tautan
    // material_services seperti sebelumnya. Berhak lewat PENUGASAN, bukan sesi
    // selesai: materi ini tidak dikaitkan ke layanan mana pun yang pernah
    // Ananda jalani.
    const { data: m } = await db
      .from("materials")
      .insert({ judul: "UJI-BELUM-UNGGAH", tipe: "ebook", deskripsi: "", aktif: true })
      .select("id")
      .single();
    materiId = m!.id as string;
    // Sengaja TIDAK ada baris material_pages sama sekali — itulah keadaan 2.
    await db
      .from("material_assignments")
      .insert({ material_id: materiId, client_id: klien!.id, ditugaskan_oleh: staf!.id });
  });

  afterAll(async () => {
    await svc.from("materials").delete().eq("id", materiId);
  });

  it("bukan 404, bukan reader kosong — kartu jujur + tautan balik (fix ronde 1)", async () => {
    // Sebelum fix ronde 1, keadaan ini juga tidak punya jalan keluar selain
    // tombol back peramban — bug yang sama dengan keadaan 3, hanya tidak
    // disebut eksplisit oleh coordinator karena tidak ada fixture yang
    // mendemonstrasikannya. Diperbaiki dengan pola yang sama: tautan balik
    // disalin dari `BelumTerbuka`, kartu paling mirip.
    const m = await markupReader(materiId);
    expect(m).toContain("Isi materi sedang disiapkan");
    expect(m).toContain("UJI-BELUM-UNGGAH");
    expect(m).toContain("belum diunggah tim PADMA");
    expect(m).toMatch(/href="\/passport\/materi"/);
    expect(m).toContain("Kembali ke Materi");
    // Bukan kerangka reader kosong: tidak ada satu pun <img> halaman.
    expect(m).not.toMatch(/<img\b/);
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

  it("watermark CSS TETAP dipasang — cabang video tidak disentuh M10", async () => {
    const m = await markupReader(TERBUKA_VIDEO);
    expect(m).toContain("Ananda Putri · PAD-2607-0012");
    expect(m).toContain('aria-hidden="true"');
    expect(m).toContain("pointer-events-none");
  });

  it("menyediakan jalan kembali ke daftar materi — TIDAK berubah dari sebelum M10", async () => {
    const m = await markupReader(TERBUKA_VIDEO);
    expect(m).toMatch(/href="\/passport\/materi"/);
    expect(m).toContain("Kembali ke Materi");
  });
});

describe("reader materi — yang belum terbuka (akses langsung ke URL)", () => {
  it("e-book terkunci: halaman penjelasan, BUKAN isi bab", async () => {
    const m = await markupReader(TERKUNCI_EBOOK);
    expect(m).toContain("Materi ini belum terbuka");
    expect(m).toContain("Panduan ASI Perah"); // judulnya boleh — hanya meta

    const { data } = await svc
      .from("material_pages")
      .select("halaman, objek")
      .eq("material_id", TERKUNCI_EBOOK);
    const halaman = data as Array<{ halaman: number; objek: string }>;
    // Seed MEMANG menaruh baris material_pages untuk materi ini (lihat
    // supabase/seed.sql) — persis supaya pemeriksaan di bawah membuktikan RLS
    // benar-benar menutup, bukan lolos kebetulan karena tidak ada apa pun yang
    // bisa bocor.
    expect(halaman.length).toBeGreaterThan(0);
    for (const h of halaman) {
      expect(m, `kunci objek terkunci "${h.objek}" bocor lewat akses langsung`).not.toContain(
        h.objek,
      );
    }
    expect(m).not.toMatch(/<img\b/);
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

  it("materi yang ditarik admin (aktif=false) tertutup di POLICY maupun di reader", async () => {
    await svc.from("materials").update({ aktif: false }).eq("id", TERBUKA_EBOOK);
    try {
      // Dulu bab materi ini TETAP dikembalikan RLS untuk Ananda, dan yang
      // menyaring hanyalah query reader — artinya "menonaktifkan materi" cuma
      // menyembunyikan kartu sementara isinya tetap bisa diambil dengan satu
      // permintaan REST. Sejak migration `gating_materi_hormati_aktif`, policy
      // baca klien ikut mengevaluasi `materials.aktif`, jadi yang dijaga di
      // sini MENGUAT: halamannya tidak lagi dijawab basis data sama sekali.
      // TERBUKA_EBOOK punya 3 halaman SUNGGUHAN (lihat seed) yang biasanya
      // terbaca Ananda — percobaan ini membuktikan aktif=false menutupnya,
      // bukan sekadar "materi ini kebetulan tidak ada isinya".
      const { data, error } = await ref.klien!
        .from("material_pages")
        .select("halaman")
        .eq("material_id", TERBUKA_EBOOK);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);

      // Lapis kedua tetap diuji: query reader menyaring `aktif` sendiri, jadi
      // halamannya 404 — bukan kerangka kosong — bahkan bila kelak policy-nya
      // diubah lagi.
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
  const sumberReaderPdf = baca("src/app/passport/materi/[id]/reader-pdf.tsx");
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
    // menarik URL pemutar video sungguhan (materi bertipe video) ke payload
    // halaman yang paling sering dibuka — bukan "gambar halaman": pengambil
    // detail itu tidak pernah memilih kunci objek e-book, hanya nomor & dimensi
    // halamannya; byte gambar tetap terkunci di belakang rute bergerbang
    // per halaman.
    expect(sumberDaftar).not.toContain("ambilMateriDetail");
    expect(sumberDaftar).not.toContain("material_pages");
    expect(sumberDaftar).not.toContain("material_videos");
  });

  it("gerbang akses berasal dari RPC berhak_isi_materi, bukan dari bentuk konten", () => {
    // Sebelum M10, "berhak" DISIMPULKAN dari bentuk data (`bab.length > 0`
    // untuk ebook, `videoUrl !== null` untuk video). Cara itu tidak bisa
    // membedakan "tidak berhak" dari "berhak tapi isinya belum diunggah
    // admin" — dua keadaan yang bentuknya SAMA-SAMA kosong. Reader sekarang
    // memakai `m.berhak`, SATU sumber kebenaran yang sama dipakai policy RLS
    // lewat RPC `berhak_isi_materi` (lihat `ambilMateriDetail`).
    //
    // Dicocokkan pada sumber TANPA komentar baris: berkas ini sendiri
    // menjelaskan perubahannya dengan MENYEBUT pola lama itu di dalam
    // komentar (persis kalimat di atas), dan pemindaian mentah akan salah
    // menganggap penjelasan itu sebagai pola yang masih dipakai.
    const kode = sumberReader.replace(/\/\/.*$/gm, "");
    expect(kode).toMatch(/if\s*\(\s*!m\.berhak\s*\)/);
    expect(kode).not.toMatch(/videoUrl\s*!==\s*null/);
    expect(kode).not.toMatch(/\bbab\.length/);
    // Keadaan "berhak tapi belum diunggah" (khusus ebook) MEMANG memeriksa
    // bentuk konten — tapi itu keadaan ISI, bukan gerbang akses; gerbangnya
    // sendiri (baris di atas) sudah lolos sebelum baris ini pernah dicapai.
    expect(kode).toMatch(/m\.halaman\.length\s*===\s*0/);
  });

  it("judul halaman mengandalkan template metadata, tidak mengulang nama aplikasi", () => {
    expect(sumberDaftar).toMatch(/title:\s*"Materi Panduan"/);
    for (const sumber of [sumberDaftar, sumberReader]) {
      expect(sumber).not.toMatch(/title:\s*"[^"]*PADMA[^"]*"/);
    }
  });

  it("isi materi tidak pernah dicatat ke log", () => {
    for (const sumber of [sumberDaftar, sumberReader, sumberReaderPdf, sumberWatermark]) {
      expect(sumber).not.toContain("console.");
    }
  });

  it("reader menyulitkan penyalinan tanpa menjanjikan proteksi mutlak", () => {
    // Cabang video (page.tsx) & reader e-book (reader-pdf.tsx) kini dua
    // berkas terpisah — masing-masing harus tetap membawa deterrent-nya
    // sendiri, bukan hanya salah satu.
    expect(sumberReader).toContain("select-none");
    expect(sumberReaderPdf).toContain("select-none");
    // Kejujuran yang diminta spec: watermark & select-none adalah deterrent.
    expect(sumberWatermark.toLowerCase()).toContain("deterrent");
  });

  it("watermark gambar e-book dibakar server, TIDAK dilapis ulang lewat komponen CSS", () => {
    // Konstraint eksplisit brief Task 10: melapiskan `<Watermark/>` di atas
    // gambar yang sudah ber-watermark hanya menggandakan teks yang sama, dan
    // lapisan CSS itu sendiri hilang begitu gambarnya disimpan — sementara
    // yang dibakar server tidak. `ReaderPdf` (dipakai satu-satunya di cabang
    // ebook) tidak boleh MENGIMPOR ATAU MEMAKAI komponen itu.
    //
    // Diperiksa lewat pola impor/JSX, bukan kata "Watermark" mentah: doc
    // comment berkas ini sendiri menjelaskan ketiadaannya memakai kata yang
    // sama persis (lihat komentar di atas fungsi `ReaderPdf`).
    expect(sumberReaderPdf).not.toMatch(/import\s*\{[^}]*\bWatermark\b/);
    expect(sumberReaderPdf).not.toMatch(/<Watermark\b/);
  });
});

afterAll(async () => {
  // Jaring pengaman bila sebuah test gagal di tengah blok aktif=false.
  await svc.from("materials").update({ aktif: true }).eq("id", TERBUKA_EBOOK);
});
