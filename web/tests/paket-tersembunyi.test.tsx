/**
 * PAGAR SAKLAR PAKET (spec K11).
 *
 * Yang dijaga: dengan `PAKET_TAMPIL = false`, tidak ada jalur data yang
 * memasok paket ke layar. Test ini sengaja memakai klien seed yang MEMANG
 * punya paket aktif — kalau ia dites dengan klien tanpa paket, ia akan hijau
 * tanpa membuktikan apa pun.
 *
 * `.tsx` (bukan `.ts`) sejak awal: Tugas 3 menambah test yang merender
 * komponen React ke berkas ini, dan mengganti ekstensi belakangan hanya
 * berarti kerja ulang.
 *
 * `ambilPaket` memakai `createServerSupabase()` yang membaca `cookies()` dari
 * `next/headers` — tidak bermakna di vitest. Modulnya diganti dengan klien
 * Supabase ber-SESI NYATA (`signInAs`), pola yang sama dipakai
 * `tests/passport-data.test.ts`: query tetap melewati RLS sebagai Ananda,
 * persis seperti di server.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signInAs } from "./helpers/as-user";

/** Klien seed yang memang punya paket aktif — nilai yang sama dipakai
 *  tests/admin-klien.test.ts:46 dan tests/admin-layanan.test.ts:53. */
const ANANDA = "44444444-4444-4444-4444-444444444401";

// `ref` di tingkat modul, sesinya disetel per-`describe` — berkas ini akan
// dipakai bersama tugas-tugas berikutnya dengan sesi berbeda (admin, owner),
// jadi tidak boleh mengunci satu sesi untuk seluruh berkas.
const ref = vi.hoisted(() => ({ klien: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.klien!,
}));

describe("saklar paket: gerbang data klien", () => {
  beforeAll(async () => {
    ref.klien = await signInAs("ananda@padma.test");
  });

  it("ambilPaket memulangkan kosong walau kliennya punya paket aktif", async () => {
    const { ambilPaket } = await import("@/lib/passport/data");
    expect(await ambilPaket(ANANDA)).toEqual([]);
  });

  it("dengan saklar HIDUP, paket klien itu tetap terbaca", async () => {
    vi.resetModules();
    vi.doMock("@/lib/paket-tampil", () => ({ PAKET_TAMPIL: true }));
    const { ambilPaket } = await import("@/lib/passport/data");
    expect((await ambilPaket(ANANDA)).length).toBeGreaterThan(0);
    vi.doUnmock("@/lib/paket-tampil");
    vi.resetModules();
  });
});

// `ref.klien` dipakai ulang (bukan `ref` baru): `vi.mock` untuk satu path
// modul hanya efektif SEKALI per berkas — mock kedua akan menimpa mock
// pertama dan memutuskan `describe` di atas dari sesi yang disetelnya
// sendiri. Nama medannya "klien" adalah sisa Tugas 1; wadahnya generik untuk
// sesi APA PUN yang sedang aktif, staf maupun klien.
describe("saklar paket: gerbang data staf", () => {
  beforeAll(async () => {
    ref.klien = await signInAs("admin@padma.test");
  });

  it("daftar klien tidak membawa nama paket", async () => {
    const { ambilDaftarKlien } = await import("@/lib/admin/klien");
    // `ParamDaftar` mewajibkan ketiga medan ({} saja gagal tipe DAN runtime —
    // `param.saring.aktivasi` melempar begitu `saring` hilang); pola pemanggilan
    // sama dengan tests/admin-klien-data.test.ts.
    const hasil = await ambilDaftarKlien({ cari: "", saring: {}, hal: 1 });
    expect(hasil.baris.every((k) => k.paketAktif === null)).toBe(true);
  });

  it("katalog admin tidak membawa daftar paket per layanan", async () => {
    const { daftarKatalogAdmin } = await import("@/lib/admin/katalog-admin");
    const fase = await daftarKatalogAdmin();
    const semuaLayanan = fase.flatMap((f) => f.layanan);
    expect(semuaLayanan.length).toBeGreaterThan(0); // katalog seed memang berisi
    expect(semuaLayanan.every((l) => l.paket.length === 0)).toBe(true);
  });

  it("penghitung klaim hanya menghitung sesi lepas", async () => {
    const { hitungKlaimMenunggu } = await import("@/lib/admin/antrean");
    const { count } = await ref.klien!
      .from("sessions")
      .select("*", { count: "exact", head: true })
      .eq("status_bayar", "menunggu_verifikasi")
      .is("client_package_id", null)
      .neq("status", "batal");
    expect(await hitungKlaimMenunggu()).toBe(count ?? 0);
  });

  // Gerbang KEEMPAT (R4, keputusan pengontrol): daftar `daftarTagihanAdmin()`
  // yang tidak sama dengan yang tiga di atas — bukan dari brief awal, tetapi
  // tanpa ini `/admin/bayar` tetap menampilkan baris paket. Ananda (ANANDA)
  // memegang paket aktif di seed, jadi bila gerbang ini bocor, baris
  // `jenis: "paket"` miliknya akan muncul di daftar admin — sesi ADMIN
  // melihat SELURUH klien, bukan hanya Ananda, jadi cukup memeriksa daftar
  // keseluruhan tidak pernah membawa satu pun baris paket.
  it("daftar tagihan admin tidak membawa baris jenis 'paket'", async () => {
    const { daftarTagihanAdmin } = await import("@/lib/admin/tagihan");
    const daftar = await daftarTagihanAdmin();
    expect(daftar.some((t) => t.jenis === "paket")).toBe(false);
  });
});

/**
 * Sapuan teks & kontrol (Task 3). Berbeda dari dua `describe` di atas: yang
 * dijaga di sini bukan jalur DATA (sudah tuntas Task 1 & 2), melainkan JSX
 * yang menyebut "paket" secara harfiah — judul halaman, label kolom,
 * saringan, checkbox, dan teks pemasaran — yang tidak tersentuh gerbang data
 * sama sekali karena tidak pernah membaca `PAKET_TAMPIL` sendiri.
 *
 * Sesi admin dipasang ulang lewat `beforeAll` MILIK BLOK INI (bukan menumpang
 * punya "gerbang data staf" di atas) — mengikuti tepat pola yang sudah
 * dipakai berkas ini, dan supaya blok ini tetap benar berdiri sendiri bila
 * urutan blok lain berubah.
 */
describe("saklar paket: tidak ada kata 'paket' di layar", () => {
  beforeAll(async () => {
    ref.klien = await signInAs("admin@padma.test");
  });

  it("teaser Passport di landing tidak menyebut paket", async () => {
    const { PassportTeaser } = await import("@/app/_landing/passport-teaser");
    expect(renderToStaticMarkup(<PassportTeaser />)).not.toMatch(/paket/i);
  });

  it("halaman /admin/klien tidak menyebut paket, dan saringan 'punya paket' tidak lagi bisa dicapai dari layar", async () => {
    const { default: HalamanKlien } = await import("@/app/admin/klien/page");
    const m = renderToStaticMarkup(
      await HalamanKlien({ searchParams: Promise.resolve({}) }),
    );
    expect(m).not.toMatch(/paket/i);
    // R6 (keputusan pengontrol): tidak cukup kolomnya hilang — chip saringan
    // yang menaut ke `?paket=ada` (lihat bilah-daftar.tsx) wajib juga tidak
    // lagi punya jalan dari layar, karena chip itu sendiri sudah cukup untuk
    // mengetahui SIAPA yang berpaket, terlepas dari kolomnya tampil atau
    // tidak. Logika saringan di `klien.ts` sendiri TIDAK dibongkar (masih
    // menerima `saring.paket === "ada"` bila dipanggil langsung) — yang
    // dicabut cuma jalan menuju kontrolnya di layar.
    expect(m).not.toContain("paket=ada");
  });

  it("halaman /admin/layanan tidak menyebut paket", async () => {
    const { default: HalamanLayanan } = await import("@/app/admin/layanan/page");
    expect(renderToStaticMarkup(await HalamanLayanan())).not.toMatch(/paket/i);
  });

  it("halaman /admin/bayar tidak menyebut paket", async () => {
    const { default: HalamanBayar } = await import("@/app/admin/bayar/page");
    expect(renderToStaticMarkup(await HalamanBayar())).not.toMatch(/paket/i);
  });

  it("halaman /admin/sesi tidak menyebut paket", async () => {
    // Formulir "Jadwalkan sesi" (form-sesi.tsx) dimulai TERTUTUP, jadi checkbox
    // "Hitung ke paket aktif" di dalamnya tidak akan pernah muncul di render
    // SSR awal ini terlepas dari saklarnya — itu bukan yang dibuktikan test
    // ini. Yang dibuktikan: tidak ada satu pun teks tetap di halaman yang
    // menyebut "paket" pada keadaan awal yang dilihat setiap admin.
    const { default: HalamanSesi } = await import("@/app/admin/sesi/page");
    expect(renderToStaticMarkup(await HalamanSesi())).not.toMatch(/paket/i);
  });

  it("halaman /admin (dashboard) tidak menyebut paket", async () => {
    const { default: HalamanAdmin } = await import("@/app/admin/page");
    expect(renderToStaticMarkup(await HalamanAdmin())).not.toMatch(/paket/i);
  });
});
