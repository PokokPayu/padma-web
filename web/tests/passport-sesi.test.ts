/**
 * Riwayat sesi (`src/app/passport/sesi/page.tsx` + `_komponen/kartu-sesi.tsx`).
 *
 * SEJAK `/passport/sesi/[id]` LAHIR, halaman ini adalah DAFTAR, bukan lagi
 * tempat catatan bidan dibaca. Laci yang dulu mengembang di dalam kartu sudah
 * dipensiunkan, dan itu bukan pemindahan kosmetik: selama laci itu ada,
 * SELURUH catatan perawatan ikut terkirim ke perangkat bersama halaman daftar
 * — tertutup atau tidak — dan Passport sering dibuka di ruang bersama. Test
 * "catatan tidak ikut daftar" di bawah adalah yang menjaga kemenangan itu
 * tidak diam-diam dibatalkan; penyajian catatannya sendiri kini dijaga
 * `tests/passport-sesi-detail.test.ts`.
 *
 * Dua bentuk kegagalan lain tetap senyap — halaman tetap 200:
 *
 *  1. Urutan terbalik. `ambilSesi` mengurutkan menurun di Postgres; halaman yang
 *     diam-diam mengurut ulang membuat sesi terlama muncul di puncak dan riwayat
 *     terbaca seperti mundur.
 *  2. Nama bidan jatuh ke fallback "Tim PADMA" — tanda `partner_publik` gagal
 *     terbaca (view hilang, grant hilang, policy berubah), tanpa error apa pun.
 *
 * Bentuk kartu diuji lewat atribut `data-*`, bukan kelas Tailwind: kelas berubah
 * setiap kali desain disetel, sedangkan TANGGAL, STATUS, dan penanda "berikutnya"
 * adalah kontrak yang sesungguhnya.
 *
 * Penanda "berikutnya" dihitung dengan `hariIniJakarta()` yang sama dengan
 * halaman, bukan literal tanggal — test tidak boleh mulai merah sendiri saat
 * jadwal seed terlewat (lihat Pagar Waktu).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { signInAs } from "./helpers/as-user";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const ANANDA = "44444444-4444-4444-4444-444444444401";

// Lapisan data passport memakai sesi pengguna (createServerSupabase). Di vitest
// tidak ada cookie, jadi klien ber-sesi sungguhan disuntikkan — RLS tetap yang
// menjadi penjaga, persis seperti di produksi.
const ref = vi.hoisted(() => ({ klien: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.klien!,
}));

// `notFound()` hanya penjaga tipe di halaman; kalau ia sampai terpanggil, itu
// regresi resolusi klien dan test harus meledak, bukan diam.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() terpanggil — resolusi klien gagal");
  },
}));

beforeAll(async () => {
  ref.klien = await signInAs("ananda@padma.test");
});

async function markupSesi(): Promise<string> {
  const { default: HalamanSesi } = await import("@/app/passport/sesi/page");
  // Server Component async: dipanggil sebagai fungsi, hasilnya pohon elemen
  // yang seluruh anaknya sinkron sehingga bisa dirender ke markup statis.
  return renderToStaticMarkup(await HalamanSesi());
}

function hitung(markup: string, pola: RegExp): number {
  return [...markup.matchAll(pola)].length;
}

/**
 * Catatan bidan seed memuat `&` ("Pijat relaksasi & pemetaan kondisi awal"),
 * dan React meloloskannya menjadi `&amp;` di markup. Membandingkan teks mentah
 * dengan markup akan gagal karena alasan yang sama sekali tidak menarik, jadi
 * teks harapan diloloskan dengan tabel yang sama seperti React.
 */
function esc(teks: string): string {
  return teks
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Tag pembuka setiap kartu sesi, apa adanya. `<a>`, bukan `<div>`: kartu ini
 * kini SEBUAH TAUTAN ke detail kunjungannya.
 */
function kartu(markup: string): string[] {
  return markup.match(/<a data-sesi-tanggal[^>]*>/g) ?? [];
}

async function sesiSeed() {
  const { ambilSesi } = await import("@/lib/passport/data");
  return ambilSesi(ANANDA);
}

async function berikutnyaSeed() {
  const { sesiBerikutnya } = await import("@/lib/passport/turunan");
  const { hariIniJakarta } = await import("@/lib/passport/waktu");
  return sesiBerikutnya(await sesiSeed(), hariIniJakarta());
}

describe("riwayat sesi — daftar", () => {
  it("menampilkan seluruh sesi klien, terbaru di puncak", async () => {
    const m = await markupSesi();
    const urutanHalaman = [...m.matchAll(/data-sesi-tanggal="([\d-]+)"/g)].map(
      (x) => x[1],
    );
    const urutanData = (await sesiSeed()).map((s) => s.tanggal);

    expect(urutanHalaman).toHaveLength(8); // seed: 6 selesai + 2 terjadwal
    // Urutan Postgres dipertahankan apa adanya — halaman tidak mengurut ulang.
    expect(urutanHalaman).toEqual(urutanData);
    // Dan urutan itu memang menurun (perbandingan string, bukan Date).
    expect(urutanHalaman).toEqual([...urutanHalaman].sort().reverse());
  });

  it("setiap sesi membawa status dan label berbahasa Indonesia", async () => {
    const m = await markupSesi();
    const status = [...m.matchAll(/data-sesi-status="([a-z]+)"/g)].map((x) => x[1]);
    expect(status.filter((s) => s === "selesai")).toHaveLength(6);
    expect(status.filter((s) => s === "terjadwal")).toHaveLength(2);
    expect(hitung(m, /Selesai</g)).toBe(6);
    expect(hitung(m, /Terjadwal</g)).toBe(2);
  });

  it("setiap kartu menyebut layanan dan nama bidan sungguhan", async () => {
    const m = await markupSesi();
    for (const s of await sesiSeed()) {
      expect(m, `layanan sesi ${s.tanggal} hilang`).toContain(esc(s.namaLayanan));
      expect(m, `nama bidan sesi ${s.tanggal} hilang`).toContain(esc(s.namaMitra));
    }
    // Fallback "Tim PADMA" = tanda partner_publik gagal terbaca.
    expect(m).not.toContain("Tim PADMA");
  });

  it("tanggal kartu diformat pendek di zona Jakarta (tidak mundur sehari di UTC)", async () => {
    const m = await markupSesi();
    expect(m).toContain("8</b>JUL"); // sesi terawal 2026-07-08
    expect(m).toContain("11</b>DES"); // sesi terjauh 2026-12-11
  });

  it("sesi berikutnya ditandai tepat satu kali, pada tanggal yang benar", async () => {
    const berikut = await berikutnyaSeed();
    const bertanda = kartu(await markupSesi()).filter((k) =>
      k.includes('data-sesi-berikutnya="ya"'),
    );
    expect(bertanda).toHaveLength(berikut ? 1 : 0);
    if (berikut) {
      expect(bertanda[0]).toContain(`data-sesi-tanggal="${berikut.tanggal}"`);
    }
  });

  it("mengajak mengajukan jadwal baru ke rute passport yang benar", async () => {
    const m = await markupSesi();
    expect(m).toMatch(/href="\/passport\/ajukan"[^>]*>[^<]*Ajukan Jadwal Baru/);
  });

  it("judul halaman menjelaskan cara membaca catatan", async () => {
    const m = await markupSesi();
    expect(m).toContain("Riwayat Sesi");
    expect(m).toContain("ketuk satu kunjungan untuk membaca catatan bidan");
  });

  it("setiap kartu menaut ke halaman detail kunjungannya", async () => {
    const m = await markupSesi();
    for (const s of await sesiSeed()) {
      expect(m, `sesi ${s.tanggal} tidak bisa dibuka`).toContain(
        `href="/passport/sesi/${s.id}"`,
      );
    }
  });
});

describe("riwayat sesi — catatan bidan TIDAK ikut daftar", () => {
  it("tidak satu pun catatan atau rekomendasi seed ikut terkirim bersama daftar", async () => {
    const m = await markupSesi();
    const berisi = (await sesiSeed()).filter((s) => s.catatan.trim() !== "");
    expect(berisi).toHaveLength(6); // seed memang punya enam sesi bercatatan

    // Inilah alasan laci dipensiunkan. Selama ia ada, keenam catatan di bawah
    // ada di dalam HTML halaman ini — `hidden` hanya menyembunyikannya dari
    // mata, bukan dari perangkat, dan Passport sering dibuka di ruang bersama.
    for (const s of berisi) {
      expect(m, `catatan sesi ${s.tanggal} masih ikut daftar`).not.toContain(esc(s.catatan));
      expect(m, `rekomendasi sesi ${s.tanggal} masih ikut daftar`).not.toContain(
        esc(s.rekomendasi),
      );
    }
    expect(m).not.toContain("Rekomendasi untuk Anda");
  });

  it("tidak ada lagi laci yang bisa dibuka-tutup di daftar", async () => {
    const m = await markupSesi();
    // Jejak laci lama: blok `hidden` dan tombol ber-`aria-expanded`. Nol
    // dua-duanya, kalau tidak isinya sudah kembali ke halaman daftar.
    expect(hitung(m, /<div hidden=""/g)).toBe(0);
    expect(hitung(m, /aria-expanded=/g)).toBe(0);
  });

  it("data kesehatan tidak pernah menjadi bagian URL", async () => {
    const m = await markupSesi();
    expect(m).not.toMatch(/href="[^"]*(catatan|rekomendasi|isi=)/i);
    for (const s of await sesiSeed()) {
      if (s.catatan.trim() === "") continue;
      const penggal = encodeURIComponent(s.catatan.slice(0, 24));
      expect(m).not.toContain(penggal);
    }
  });
});

describe("kartu sesi — perilaku per status", () => {
  const contoh = (o: Partial<import("@/lib/passport/turunan").SesiRingkas> = {}) => ({
    id: "s1",
    serviceId: "svc1",
    namaLayanan: "Sankalpa Fertility Massage",
    namaMitra: "Bidan Sri Wahyuni",
    tanggal: "2026-07-08",
    jamMulai: "09:00:00",
    status: "selesai" as const,
    clientPackageId: "pkg1",
    catatan: "Ketegangan punggung bawah jauh berkurang.",
    rekomendasi: "Lanjutkan jalan pagi 30 menit.",
    statusBayar: "lunas" as const,
    jenjang: null,
    varian: { label: "", durasiMenit: null, format: null },
    ...o,
  });

  async function markupKartu(
    sesi: import("@/lib/passport/turunan").SesiRingkas,
    berikutnya = false,
  ) {
    const { KartuSesi } = await import("@/app/passport/_komponen/kartu-sesi");
    return renderToStaticMarkup(createElement(KartuSesi, { sesi, berikutnya }));
  }

  it("sesi batal diberi label Dibatalkan", async () => {
    const m = await markupKartu(contoh({ status: "dibatalkan_padma", catatan: "", rekomendasi: "" }));
    expect(m).toContain("Dibatalkan");
    expect(m).toContain('data-sesi-status="dibatalkan_padma"');
  });

  it("kartu TIDAK membawa satu pun kalimat perawatan, seberapa pun terisi sesinya", async () => {
    // Kartu diberi catatan DAN rekomendasi yang terisi penuh: kalau salah satu
    // masih menyeberang ke markup, laci lama sudah kembali dalam bentuk lain.
    const m = await markupKartu(contoh());
    expect(m).not.toContain("Ketegangan punggung bawah");
    expect(m).not.toContain("Lanjutkan jalan pagi");
    expect(m).not.toContain("Catatan Bidan Sri Wahyuni");
    expect(m).not.toContain("Rekomendasi untuk Anda");
  });

  it("kartu adalah tautan ke detail sesinya, dengan id sesi apa adanya", async () => {
    const m = await markupKartu(contoh({ id: "abc-123" }));
    expect(m).toContain('href="/passport/sesi/abc-123"');
  });
});

describe("riwayat sesi — pagar", () => {
  const sumberHalaman = baca("src/app/passport/sesi/page.tsx");
  const sumberKartu = baca("src/app/passport/_komponen/kartu-sesi.tsx");

  it("kartu sesi adalah SERVER component — tidak ada lagi state buka-tutup", () => {
    // Pembalikan yang disengaja. Selama kartu ini komponen klien dengan laci,
    // isinya wajib ikut dikirim ke peramban supaya bisa dibuka tanpa
    // permintaan baru. Sebagai komponen server yang cuma menaut, catatan
    // perawatan tidak punya alasan menyeberang sama sekali.
    expect(sumberKartu).not.toContain('"use client"');
  });

  it("halaman tetap Server Component yang membaca lewat lapisan data passport", () => {
    expect(sumberHalaman).not.toContain('"use client"');
    expect(sumberHalaman).toMatch(
      /import\s*\{[^}]*\bambilSesi\b[^}]*\}\s*from\s*["']@\/lib\/passport\/data["']/,
    );
  });

  it("judul halaman mengandalkan template metadata, tidak mengulang nama aplikasi", () => {
    expect(sumberHalaman).toMatch(/title:\s*"Riwayat Sesi"/);
    expect(sumberHalaman).not.toMatch(/title:\s*"[^"]*PADMA[^"]*"/);
  });

  it("isi rekam perawatan tidak pernah dicatat ke log", () => {
    for (const sumber of [sumberHalaman, sumberKartu]) {
      expect(sumber).not.toContain("console.");
    }
  });

  it("klien baru mendapat kalimat sambutan, bukan halaman kosong", () => {
    expect(sumberHalaman).toContain("setelah kunjungan pertama");
  });
});
