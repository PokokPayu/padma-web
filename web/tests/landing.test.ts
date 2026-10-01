/**
 * Penjagaan situs publik: `/`, `/layanan`, `/tentang`, `/digital-passport`
 * (handoff landing v2, docs/landingpage-v2/README.md).
 *
 * Aturan konten di README handoff berbunyi "jangan diubah tanpa persetujuan"
 * — tanpa harga, satu CTA utama, PADMA non-klinis, kata terlarang dari situs
 * lama wajib hilang. Semuanya kegagalan DIAM: halaman tetap 200 dan tampak
 * rapi walau satu kalimat terlarang menyelinap kembali. Karena itu berkas ini
 * merender keempat halaman sungguhan (server component, tanpa sesi) lalu
 * memeriksa markupnya, ditambah pembacaan sumber untuk pagar yang tidak
 * terlihat di markup (nomor WA tidak ditulis keras, tanpa service role).
 */
import { describe, it, expect } from "vitest";
import type React from "react";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import * as modBeranda from "@/app/page";
import * as modLayanan from "@/app/layanan/page";
import * as modTentang from "@/app/tentang/page";
import * as modPassport from "@/app/digital-passport/page";
import { bacaPengaturan } from "@/lib/settings";
import { PESAN_WA_SITUS } from "@/app/_situs/wa";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const BERKAS_HALAMAN = {
  "/": "src/app/page.tsx",
  "/layanan": "src/app/layanan/page.tsx",
  "/tentang": "src/app/tentang/page.tsx",
  "/digital-passport": "src/app/digital-passport/page.tsx",
} as const;
type Rute = keyof typeof BERKAS_HALAMAN;

const sumberSitus = Object.fromEntries(
  readdirSync(path.join(AKAR, "src/app/_situs")).map((f) => [f, baca(path.join("src/app/_situs", f))]),
);
const semuaSumber = [
  ...Object.values(BERKAS_HALAMAN).map(baca),
  ...Object.values(sumberSitus),
].join("\n");

const MODUL: Record<Rute, { default: () => Promise<React.ReactElement>; revalidate?: number }> = {
  "/": modBeranda,
  "/layanan": modLayanan,
  "/tentang": modTentang,
  "/digital-passport": modPassport,
};

const pengaturan = await bacaPengaturan();
const markup: Record<Rute, string> = {
  "/": renderToStaticMarkup(await MODUL["/"].default()),
  "/layanan": renderToStaticMarkup(await MODUL["/layanan"].default()),
  "/tentang": renderToStaticMarkup(await MODUL["/tentang"].default()),
  "/digital-passport": renderToStaticMarkup(await MODUL["/digital-passport"].default()),
};
const semuaRute = Object.keys(markup) as Rute[];

describe("situs publik — berisi tanpa login", () => {
  it("tidak ada halaman yang dilindungi peran", () => {
    expect(semuaSumber).not.toMatch(/requireRole\s*\(/);
    expect(semuaSumber).not.toContain("@/lib/auth/require-role");
    expect(semuaSumber).not.toContain("redirect(");
  });

  it.each(semuaRute)("%s tidak dibekukan permanen di waktu build (ada revalidate)", (rute) => {
    // Nomor WA diganti admin; tanpa revalidate `next build` memanggang nomor
    // lama sampai deploy berikutnya.
    expect(MODUL[rute].revalidate).toBeGreaterThan(0);
  });

  it.each(semuaRute)("%s berisi header, footer, dan satu h1", (rute) => {
    const m = markup[rute];
    expect(m).toContain("<header");
    expect(m).toContain("<footer");
    expect(m.match(/<h1[\s>]/g) ?? []).toHaveLength(1);
  });
});

describe("situs publik — jalur konversi", () => {
  const tautanWa = `https://wa.me/${pengaturan.nomorWaLink}?text=${encodeURIComponent(PESAN_WA_SITUS)}`;

  it("pesan WA membawa kode sumber WEBSITE", () => {
    expect(PESAN_WA_SITUS).toContain("WEBSITE");
  });

  it.each(semuaRute)("%s punya CTA utama WA dari nomor app_settings", (rute) => {
    expect(markup[rute]).toContain(`href="${tautanWa}"`);
    expect(markup[rute]).toContain("Tanya Kelas &amp; Pricelist");
  });

  it("tidak ada tautan WA lain selain CTA utama (satu CTA, satu pesan)", () => {
    for (const rute of semuaRute) {
      const semuaWa = [...markup[rute].matchAll(/href="(https:\/\/wa\.me\/[^"]*)"/g)].map((x) => x[1]);
      expect(semuaWa.length, rute).toBeGreaterThan(0);
      for (const h of semuaWa) expect(h, rute).toBe(tautanWa);
    }
  });

  it("nomor WA tidak ditulis keras di sumber situs", () => {
    expect(semuaSumber).toContain("bacaPengaturan");
    expect(semuaSumber).not.toMatch(/\b62\d{8,}\b/);
    expect(semuaSumber).not.toMatch(/\b0\d{3}-\d{4}-\d{4}\b/);
  });

  it.each(semuaRute)("%s menautkan /masuk untuk klien lama", (rute) => {
    expect(markup[rute]).toContain('href="/masuk"');
  });

  it("alur PADMA Home di /layanan dibuka lewat /skrining", () => {
    expect(markup["/layanan"]).toContain('href="/skrining"');
    expect(markup["/layanan"]).toContain("Cek Kesiapan Sesi");
  });

  it("tidak ada tautan mati `#` (halaman Learn/Live/Home/Artikel belum ada)", () => {
    for (const rute of semuaRute) expect(markup[rute], rute).not.toContain('href="#"');
  });

  it("footer memajang kontak dari app_settings", () => {
    for (const rute of semuaRute) {
      expect(markup[rute]).toContain(pengaturan.nomorWaTampilan);
    }
  });
});

describe("situs publik — aturan konten handoff", () => {
  it.each(semuaRute)("%s tanpa harga atau nominal rupiah", (rute) => {
    // "Tidak ada harga, durasi, promo, QR, atau link PDF di website."
    expect(markup[rute]).not.toMatch(/Rp\s?\d/);
    expect(markup[rute]).not.toMatch(/Soft Launch|<s[\s>]/);
    expect(markup[rute]).not.toMatch(/\.pdf"/i);
  });

  it.each(semuaRute)("%s bebas teks lama yang wajib dibuang", (rute) => {
    for (const kata of [
      /Homecare Promil/i,
      /perawatan kesehatan perempuan/i,
      /ACOG/,
      /CDC/,
      /Skrining Gratis/i,
      /evaluasi (&amp;|dan) rekomendasi bidan/i,
      /Digital Care Passport/,
    ]) {
      expect(markup[rute], `${rute}: ${kata}`).not.toMatch(kata);
    }
  });

  it.each(semuaRute)("%s tidak memakai istilah klinis untuk layanan PADMA", (rute) => {
    expect(markup[rute]).not.toMatch(/screening|pemeriksaan|menyembuhkan|pengobatan/i);
  });

  it("kata 'diagnosis' hanya muncul untuk menyebut apa yang DI LUAR layanan PADMA", () => {
    for (const rute of semuaRute) {
      if (rute === "/tentang") continue;
      expect(markup[rute], rute).not.toMatch(/diagnosis/i);
    }
    const t = markup["/tentang"];
    expect(t.match(/diagnosis/gi) ?? []).toHaveLength(1);
    const blokLuar = t.slice(t.indexOf("Di luar layanan PADMA"));
    expect(blokLuar).toMatch(/asesmen individual, diagnosis, terapi medis/);
  });

  it("nama Passport satu di mana-mana: Digital Passport Journey", () => {
    expect(markup["/"]).toContain("Digital Passport Journey");
    expect(markup["/digital-passport"]).toContain("Digital Passport Journey");
  });

  it("testimoni placeholder tidak tayang sebelum ada kutipan asli berizin", () => {
    for (const rute of semuaRute) {
      expect(markup[rute]).not.toContain("[Kutipan");
      expect(markup[rute]).not.toContain("[Inisial");
    }
  });

  it("profil mitra tidak ditampilkan — hanya janji dikirim setelah booking", () => {
    expect(markup["/tentang"]).toContain("dikirim setelah booking terkonfirmasi");
  });
});

describe("situs publik — tata letak & batas", () => {
  it("tidak memakai lebar viewport penuh yang mengabaikan scrollbar", () => {
    expect(semuaSumber).not.toMatch(/w-screen|100vw/);
  });

  it("tanpa service role dan tanpa komponen klien", () => {
    for (const [berkas, sumber] of Object.entries(sumberSitus)) {
      expect(sumber, berkas).not.toContain("createAdminSupabase");
      expect(sumber, berkas).not.toContain("SERVICE_ROLE");
      expect(sumber, berkas).not.toContain("use client");
    }
  });

  it("gambar situs dilayani lewat next/image dari /situs", () => {
    for (const rute of semuaRute) {
      expect(markup[rute]).not.toMatch(/<img[^>]*src="\/situs\//);
    }
  });
});
