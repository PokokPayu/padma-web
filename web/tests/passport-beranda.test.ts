/**
 * Beranda passport (`src/app/passport/page.tsx` + `_komponen/*`).
 *
 * Beranda adalah halaman yang paling sering ditunjukkan ke klien, dan tiga
 * kelas kegagalannya semuanya SENYAP — halaman tetap 200, tetap "kelihatan
 * jalan":
 *
 *  1. Angka demo salah diam-diam. Kalau stempel terisi bukan 6, progres bukan
 *     75%, atau badge bukan 3, tidak ada yang meledak — passport cuma tampak
 *     kosong saat dipresentasikan. Karena itu angkanya dibaca lewat RENDER
 *     NYATA halaman di atas data seed, bukan lewat query tandingan.
 *  2. Nama bidan jatuh ke fallback "Tim PADMA". Itulah yang terjadi bila
 *     `partner_publik` gagal terbaca (view hilang, grant hilang, policy
 *     berubah) — tanpa error apa pun, hanya nama yang berubah jadi generik.
 *  3. Data kesehatan bocor ke halaman ringkas. Catatan bidan hanya milik
 *     halaman Sesi; kalau ia ikut ter-render di Beranda, isi rekam perawatan
 *     tersebar ke layar yang paling sering dibuka di depan orang lain.
 *
 * Bentuk stempel & badge diuji lewat atribut `data-*`, bukan kelas Tailwind:
 * kelas berubah setiap kali desain disetel, sedangkan JENIS slot adalah
 * kontrak yang sesungguhnya.
 *
 * Perbandingan tanggal memakai `hariIniJakarta()` yang sama dengan halaman,
 * bukan literal tanggal — test tidak boleh mulai merah sendiri saat jadwal
 * seed terlewat (lihat Pagar Waktu).
 *
 * Saklar K11 (`PAKET_TAMPIL`, Task 1): `ambilPaket()` memulangkan [] secara
 * default, jadi `paketAktif` di page.tsx selalu null selama saklar mati.
 * Describe "paket & stempel" di bawah karena itu tidak lagi menguji ANGKA
 * stempel/progres (paket klien seed memang aktif, tapi tidak pernah sampai ke
 * halaman) — ia menguji bahwa beranda jatuh bersih ke kartu fallback
 * "Perjalanan Anda", bukan diam-diam menampilkan section kosong atau setengah
 * jadi. Pagar saklarnya sendiri (data-level) diuji di
 * tests/paket-tersembunyi.test.tsx.
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

// `notFound()` hanya penjaga tipe di halaman; kalau ia sampai terpanggil,
// itu regresi resolusi klien dan test harus meledak, bukan diam.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() terpanggil — resolusi klien gagal");
  },
}));

beforeAll(async () => {
  ref.klien = await signInAs("ananda@padma.test");
});

async function markupBeranda(): Promise<string> {
  const { default: BerandaPassport } = await import("@/app/passport/page");
  // Server Component async: dipanggil sebagai fungsi, hasilnya pohon elemen
  // yang seluruh anaknya sinkron sehingga bisa dirender ke markup statis.
  return renderToStaticMarkup(await BerandaPassport());
}

function hitung(markup: string, pola: RegExp): number {
  return [...markup.matchAll(pola)].length;
}

describe("beranda passport — sampul", () => {
  it("menampilkan identitas klien dan fase perjalanannya", async () => {
    const m = await markupBeranda();
    expect(m).toContain("Digital Care Passport");
    expect(m).toContain("Ananda Putri");
    expect(m).toContain("PAD-2607-0012");
    expect(m).toContain("Sankalpa");
    expect(m).toContain("Prekonsepsi / Promil");
  });

  it("baris ringkas TIDAK lagi menyebut paket (saklar K11) — hanya PADMA ID", async () => {
    // Sebelum saklar K11 baris ini menyambung "<nama paket> · Sesi X/Y".
    // `ringkasProgres` sekarang selalu null (paketAktif tidak pernah terisi),
    // dan SampulPassport (_komponen/sampul.tsx) sengaja menyembunyikan seluruh
    // ekor " · ..." saat null — yang dijaga di sini adalah TIDAK adanya sisa
    // teks paket di sampul, bukan angka progresnya.
    const m = await markupBeranda();
    expect(m).not.toContain("Sankalpa Prima");
    expect(m).not.toMatch(/Sesi \d+\/\d+/);
  });

  it('"Sejak" diambil dari sesi terawal, bukan tanggal pembuatan baris klien', async () => {
    // Sesi terawal seed = 2026-07-08 → "Juli 2026". clients.created_at berubah
    // setiap `db reset`, jadi memakainya membuat sampul berbohong.
    const m = await markupBeranda();
    expect(m).toMatch(/Sejak[\s\S]{0,120}Juli 2026/);
  });
});

describe("beranda passport — paket & stempel", () => {
  it("tanpa paket aktif, seluruh grid stempel hilang dan digantikan kartu 'Perjalanan Anda'", async () => {
    // Klien seed (Ananda) MEMANG punya paket aktif — kalau grid stempel masih
    // muncul di sini, saklar K11 bocor di jalur tampilan beranda walau
    // `ambilPaket()` sendiri sudah terpagar.
    const m = await markupBeranda();
    expect(hitung(m, /data-stempel="[a-z]+"/g)).toBe(0);
    expect(m).toContain("Perjalanan Anda");
    expect(m).toContain("Anda mengambil layanan per sesi. Riwayat lengkapnya ada di halaman Sesi.");
    expect(m).not.toContain("Paket Aktif");
  });

  it("tanggal stempel paket (8 JUL, 19 AGU) tidak lagi muncul di beranda", async () => {
    const m = await markupBeranda();
    expect(m).not.toContain("8 JUL"); // sesi pertama 2026-07-08, dulu stempel #1
    expect(m).not.toContain("19 AGU"); // sesi keenam 2026-08-19, dulu stempel #6
  });

  it("teks progres paket ('sesi selesai', persentase) tidak lagi tertulis", async () => {
    const m = await markupBeranda();
    expect(m).not.toContain("sesi selesai");
    // Angka persen progres dirender lewat kelas unik ini (lihat page.tsx) —
    // dicari lewat kelasnya, bukan pola "\d+%" mentah, karena gradasi latar
    // sampul (_komponen/sampul.tsx) sendiri memakai literal "%" (mis. "60%").
    expect(m).not.toMatch(/text-\[15px\] text-night">\d+%/);
  });
});

describe("beranda passport — sesi berikutnya", () => {
  it("kartu sesi berikutnya menyebut nama bidan sungguhan, bukan fallback", async () => {
    const { ambilSesi } = await import("@/lib/passport/data");
    const { sesiBerikutnya } = await import("@/lib/passport/turunan");
    const { hariIniJakarta } = await import("@/lib/passport/waktu");

    const berikut = sesiBerikutnya(await ambilSesi(ANANDA), hariIniJakarta());
    const m = await markupBeranda();

    if (berikut) {
      expect(m).toContain(`Sesi berikutnya: ${berikut.namaLayanan}`);
      expect(m).toContain(berikut.namaMitra);
    } else {
      expect(m).toContain("Belum ada jadwal berikutnya");
    }
    // Fallback "Tim PADMA" = tanda partner_publik gagal terbaca. Ia tidak
    // boleh muncul di seed yang seluruh sesinya punya mitra.
    expect(m).not.toContain("Tim PADMA");
  });

  it("setiap sesi seed membawa nama mitra dari partner_publik", async () => {
    const { ambilSesi } = await import("@/lib/passport/data");
    for (const s of await ambilSesi(ANANDA)) {
      expect(s.namaMitra, `sesi ${s.tanggal} kehilangan nama mitra`).toMatch(
        /^Bidan /,
      );
    }
  });
});

describe("beranda passport — pencapaian & aksi cepat", () => {
  it("tiga badge, satu per layanan yang sudah dijalani", async () => {
    const m = await markupBeranda();
    expect(hitung(m, /data-badge="/g)).toBe(3);
    for (const nama of [
      "Sankalpa Fertility Massage",
      "PADMA Flow Yoga - Prekonsepsi",
      "Konsultasi Nutrisi Prekonsepsi",
    ]) {
      expect(m).toContain(nama);
    }
  });

  it("dua aksi cepat menuju rute passport yang benar", async () => {
    const m = await markupBeranda();
    expect(m).toMatch(/href="\/passport\/ajukan"[^>]*>[^<]*Ajukan Jadwal/);
    expect(m).toMatch(/href="\/passport\/materi"[^>]*>[^<]*Materi Saya/);
  });
});

describe("beranda passport — pagar", () => {
  it("catatan & rekomendasi bidan TIDAK ikut ter-render di beranda", async () => {
    const { ambilSesi } = await import("@/lib/passport/data");
    const m = await markupBeranda();
    const sesi = await ambilSesi(ANANDA);
    const berisi = sesi.filter((s) => s.catatan.length > 20);
    expect(berisi.length).toBeGreaterThan(0); // seed memang punya catatan
    for (const s of berisi) {
      expect(m, `catatan sesi ${s.tanggal} bocor ke beranda`).not.toContain(
        s.catatan,
      );
      if (s.rekomendasi.length > 20) {
        expect(m).not.toContain(s.rekomendasi);
      }
    }
  });

  it("judul halaman mengandalkan template metadata, tidak mengulang nama aplikasi", async () => {
    const halaman = baca("src/app/passport/page.tsx");
    expect(halaman).toMatch(/title:\s*"Digital Care Passport"/);
    expect(halaman).not.toMatch(/title:\s*"[^"]*PADMA[^"]*"/);
  });

  it("baris ringkas sampul boleh melipat di layar 390px (tanpa scroll horizontal)", async () => {
    // Deretan MRZ adalah satu-satunya baris panjang berjarak huruf lebar di
    // beranda: bila ia dipaksa `whitespace-nowrap` di mobile, seluruh halaman
    // ikut menggeser ke samping.
    const sampul = baca("src/app/passport/_komponen/sampul.tsx");
    expect(sampul).toContain("max-sm:whitespace-normal");
    expect(sampul).toContain("overflow-hidden");
  });

  it("grid stempel menyempit di mobile, bukan delapan kolom tetap", async () => {
    const grid = baca("src/app/passport/_komponen/grid-stempel.tsx");
    expect(grid).toContain("grid-cols-4");
    expect(grid).toContain("sm:grid-cols-8");
  });

  it("lambang teratai dipakai ulang, bukan salinan path SVG", async () => {
    for (const berkas of [
      "src/app/passport/_komponen/sampul.tsx",
      "src/app/passport/_komponen/grid-stempel.tsx",
      "src/app/passport/page.tsx",
    ]) {
      expect(baca(berkas)).toMatch(
        /import\s*\{[^}]*\bLotus\b[^}]*\}\s*from\s*["']@\/app\/_landing\/lotus["']/,
      );
    }
  });
});

describe("komponen grid stempel — jenis slot", () => {
  it("merender tiap jenis slot apa adanya, termasuk tanggal penanda", async () => {
    const { GridStempel } = await import("@/app/passport/_komponen/grid-stempel");
    const m = renderToStaticMarkup(
      createElement(GridStempel, {
        slot: [
          { jenis: "terisi" as const, tanggal: "2026-07-08" },
          { jenis: "berikutnya" as const, tanggal: "2026-12-04" },
          { jenis: "kosong" as const },
        ],
      }),
    );
    expect(hitung(m, /data-stempel="terisi"/g)).toBe(1);
    expect(hitung(m, /data-stempel="berikutnya"/g)).toBe(1);
    expect(hitung(m, /data-stempel="kosong"/g)).toBe(1);
    expect(m).toContain("8 JUL");
    expect(m).toContain("4 DES");
    expect(m).toContain("terjadwal");
  });

  it("slot kosong tidak menyebut tanggal apa pun", async () => {
    const { GridStempel } = await import("@/app/passport/_komponen/grid-stempel");
    const m = renderToStaticMarkup(
      createElement(GridStempel, { slot: [{ jenis: "kosong" as const }] }),
    );
    expect(m).not.toMatch(/\d{1,2} [A-Z]{3}/);
  });
});
