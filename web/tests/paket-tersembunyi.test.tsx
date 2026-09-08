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
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { signInAs } from "./helpers/as-user";

/** Klien seed yang memang punya paket aktif — nilai yang sama dipakai
 *  tests/admin-klien.test.ts:46 dan tests/admin-layanan.test.ts:53. */
const ANANDA = "44444444-4444-4444-4444-444444444401";

/**
 * Parameter daftar halaman-1 tanpa cari/saring.
 *
 * Sapuan panel staf memberi enam halaman admin `searchParams: Promise<...>`
 * dan memberi lapisan datanya `ParamDaftar`. Pemanggilan telanjang di berkas
 * ini (`HalamanBayar()`, `daftarTagihanAdmin()`) sudah tidak sah sejak itu —
 * yang berubah cuma cara memanggilnya, bukan yang dijaga.
 */
const PARAM = { cari: "", saring: {}, hal: 1 } as const;
const SP = (sp: Record<string, string> = {}) => ({ searchParams: Promise.resolve(sp) });

/** Merender komponen halaman async apa pun tanpa menulis cast di tiap uji. */
async function render(
  halaman: unknown,
  props: unknown = {},
): Promise<string> {
  return renderToStaticMarkup(
    await (halaman as (p: unknown) => Promise<ReactElement>)(props),
  );
}

// `ref` di tingkat modul, sesinya disetel per-`describe` — berkas ini akan
// dipakai bersama tugas-tugas berikutnya dengan sesi berbeda (admin, owner),
// jadi tidak boleh mengunci satu sesi untuk seluruh berkas.
const ref = vi.hoisted(() => ({ klien: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.klien!,
}));

// `PanelGeser` (panel geser sapuan panel staf) memanggil `useRouter()` di badan
// komponennya untuk tombol Escape/overlay — `renderToStaticMarkup` tidak
// menjalankan efeknya, tapi pemanggilan hook-nya sendiri tetap melempar
// "invariant expected app router to be mounted" tanpa mock ini. Modul aslinya
// disebar ulang lewat `importOriginal` supaya `notFound()` TETAP asli: halaman
// /passport & /owner di berkas ini mengandalkannya, dan menggantinya dengan
// stub akan mengubah arti uji-uji itu diam-diam.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
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
    const { baris } = await daftarTagihanAdmin(PARAM);
    expect(baris.some((t) => t.jenis === "paket")).toBe(false);
  });

  // GERBANG KELIMA (merge sapuan panel): `ambilDaftarLayanan()` lahir SESUDAH
  // saklar ini ditulis — ia menghitung `packages` sendiri, tidak lewat
  // `daftarKatalogAdmin()` yang sudah digerbang. Tanpa gerbangnya sendiri,
  // angka paket per layanan tetap sampai ke lapisan data halaman /admin/layanan.
  it("daftar layanan admin memulangkan jumlahPaket NOL untuk setiap baris", async () => {
    const { ambilDaftarLayanan } = await import("@/lib/admin/layanan");
    const { baris } = await ambilDaftarLayanan(PARAM);
    expect(baris.length).toBeGreaterThan(0); // katalog seed memang berisi
    expect(baris.every((l) => l.jumlahPaket === 0)).toBe(true);
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
    const m = await render(HalamanKlien, SP());
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
    // Dua bentuk halaman ini yang dilihat staf: daftar biasa, dan daftar dengan
    // panel geser "Layanan baru" TERBUKA (`?ubah=baru`). Panel geser tidak
    // dirender sama sekali pada bentuk pertama — memeriksa bentuk pertama saja
    // membuat apa pun yang duduk di dalam panel lolos tanpa diperiksa.
    expect(await render(HalamanLayanan, SP())).not.toMatch(/paket/i);
    expect(await render(HalamanLayanan, SP({ ubah: "baru" }))).not.toMatch(/paket/i);
  });

  // Halaman DETAIL layanan lahir dari sapuan panel (pola B): pengelolaan paket
  // per layanan pindah ke sini dari /admin/layanan. Ia bukan bagian dari
  // sembilan halaman brief awal saklar ini karena rutenya belum ada waktu itu.
  it("halaman /admin/layanan/[id] tidak menyebut paket", async () => {
    const { ambilDaftarLayanan } = await import("@/lib/admin/layanan");
    const { default: DetailLayanan } = await import("@/app/admin/layanan/[id]/page");
    const { baris } = await ambilDaftarLayanan(PARAM);
    expect(baris.length).toBeGreaterThan(0);
    const m = await render(DetailLayanan, {
      params: Promise.resolve({ id: baris[0].id }),
      searchParams: Promise.resolve({}),
    });
    expect(m).not.toMatch(/paket/i);
  });

  it("halaman /admin/bayar tidak menyebut paket", async () => {
    const { default: HalamanBayar } = await import("@/app/admin/bayar/page");
    const m = await render(HalamanBayar, SP());
    expect(m).not.toMatch(/paket/i);
    // Perbaikan review Task 4: `/paket/i` di atas HARI INI kebetulan masih
    // cukup — `TabelBayar` (tabel-bayar.tsx) menulis literal kata "Paket"
    // terpisah dari label utama untuk setiap baris berjenis paket
    // (`{t.jenis === "paket" ? "Paket" : "Sesi lepas"}`), jadi kebocoran
    // masih tertangkap lewat teks itu — dibuktikan lewat "kontrol positif" di
    // bawah. Tapi itu jaring pengaman KEBETULAN, bukan LABEL yang sebenarnya
    // dijaga: `daftarTagihanAdmin()` (lib/admin/tagihan.ts) merakit LABEL
    // baris itu sendiri dari `${p.packages?.nama ?? "Paket"} · ${jumlahSesi}
    // sesi` — begitu nama paketnya TERISI (seed Ananda: "Sankalpa Prima"),
    // LABEL itu sendiri tidak mengandung substring "paket" sama sekali,
    // persis lubang yang sama dengan /passport/bayar. Kalau indikator jenis
    // terpisah itu suatu hari dihapus atau digabung ke label utama (seperti
    // sisi klien), sapuan akan diam-diam kembali buta. Diperiksa langsung
    // nama paket seed dan pola labelnya ("· N sesi") supaya jaminannya tidak
    // bergantung pada detail rendering yang tidak terkait dengan label itu
    // sendiri.
    expect(m).not.toContain("Sankalpa Prima");
    expect(m).not.toMatch(/·\s*\d+\s*sesi\b/i);
  });

  // KONTROL POSITIF (review Task 4): membuktikan ketiga assertion di atas
  // benar-benar bisa MERAH, bukan sekadar tidak pernah tersentuh. Saklar
  // dinyalakan SEMENTARA hanya untuk render ini — begitu
  // ambilPaket()/daftarTagihanAdmin() bocor sungguhan, baris "Sankalpa Prima
  // · 8 sesi" MEMANG muncul di markup. `/paket/i` sendiri MEMANG masih
  // menangkapnya hari ini (lewat indikator jenis terpisah di atas) — itu
  // sebabnya `toMatch(/paket/i)` di bawah diharapkan BENAR, bukan salah;
  // yang dibuktikan bukan bahwa /paket/i buta di admin, melainkan bahwa
  // LABELnya sendiri ("Sankalpa Prima · 8 sesi") sungguh muncul dan
  // tertangkap assertion baru secara independen dari indikator jenis itu.
  it("kontrol positif: dengan saklar HIDUP, baris tagihan paket ('Sankalpa Prima · 8 sesi') sungguh muncul di /admin/bayar", async () => {
    vi.resetModules();
    vi.doMock("@/lib/paket-tampil", () => ({ PAKET_TAMPIL: true }));
    const { default: HalamanBayarSaklarHidup } = await import("@/app/admin/bayar/page");
    const m = await render(HalamanBayarSaklarHidup, SP());
    vi.doUnmock("@/lib/paket-tampil");
    vi.resetModules();

    expect(m).toMatch(/paket/i); // indikator jenis terpisah — masih hijau hari ini
    expect(m).toContain("Sankalpa Prima"); // LABEL itu sendiri, independen dari indikator di atas
    expect(m).toMatch(/·\s*\d+\s*sesi\b/i);
  });

  it("halaman /admin/sesi tidak menyebut paket", async () => {
    // Formulir "Jadwalkan sesi" (form-sesi.tsx) dan `PanelSesi` (panel-sesi.tsx)
    // sama-sama hidup di dalam panel geser yang dimulai TERTUTUP, jadi isinya
    // tidak muncul di render SSR awal ini terlepas dari saklarnya — itu bukan
    // yang dibuktikan test ini, dan justru itulah sebabnya kedua berkas itu
    // punya pagar PEMINDAIAN SUMBER sendiri di bawah (Ruling 22). Yang
    // dibuktikan di sini: tidak ada satu pun teks tetap di halaman — termasuk
    // literal " · paket" per baris TABEL, yang sapuan panel pindahkan ke sini
    // dari form-selesai.tsx — yang menyebut "paket" pada keadaan awal.
    const { default: HalamanSesi } = await import("@/app/admin/sesi/page");
    expect(await render(HalamanSesi, SP())).not.toMatch(/paket/i);
  });

  // Baris tabel /admin/sesi menulis " · paket" hanya untuk sesi yang
  // `client_package_id`-nya terisi. Uji di atas hijau juga bila kebetulan tidak
  // ada satu pun sesi semacam itu di halaman pertama — jadi gerbangnya
  // dibuktikan terpisah lewat KONTROL POSITIF: dengan saklar dinyalakan, literal
  // itu MEMANG muncul untuk sesi berpaket seed.
  it("kontrol positif: dengan saklar HIDUP, baris sesi berpaket di /admin/sesi menulis ' · paket'", async () => {
    const { data } = await ref.klien!
      .from("sessions")
      .select("id")
      .not("client_package_id", "is", null)
      .limit(1);
    expect((data ?? []).length, "seed wajib punya sesi berpaket").toBeGreaterThan(0);

    vi.resetModules();
    vi.doMock("@/lib/paket-tampil", () => ({ PAKET_TAMPIL: true }));
    const { default: HalamanSesiHidup } = await import("@/app/admin/sesi/page");
    const m = await render(HalamanSesiHidup, SP());
    vi.doUnmock("@/lib/paket-tampil");
    vi.resetModules();

    expect(m).toMatch(/·\s*paket/);
  });

  it("halaman /admin (dashboard) tidak menyebut paket", async () => {
    const { default: HalamanAdmin } = await import("@/app/admin/page");
    expect(await render(HalamanAdmin)).not.toMatch(/paket/i);
  });

  // Landing (`/`) tidak butuh sesi apa pun — katalog dibaca dengan anon key
  // (lihat lib/katalog.ts) dan pengaturan dengan service role (lib/settings.ts),
  // keduanya tidak pernah lewat `createServerSupabase()` yang di-mock berkas
  // ini. Ditaruh di sini (bukan describe tersendiri) karena tidak butuh
  // `beforeAll` sendiri — sesi admin yang aktif di blok ini tidak berpengaruh.
  it("halaman landing '/' tidak menyebut paket", async () => {
    const { default: Home } = await import("@/app/page");
    expect(await render(Home)).not.toMatch(/paket/i);
  });
});

// Sesi KLIEN (Ananda) untuk kedua halaman /passport — beda dari sesi admin di
// atas, jadi butuh `beforeAll` sendiri seperti pola berkas ini. `ambilKlien`
// dkk memakai `createServerSupabase()` (di-mock ke `ref.klien`), sama seperti
// gerbang data klien di describe pertama berkas ini.
describe("saklar paket: halaman klien (passport) tidak menyebut paket", () => {
  beforeAll(async () => {
    ref.klien = await signInAs("ananda@padma.test");
  });

  it("halaman /passport tidak menyebut paket", async () => {
    // Ananda (ANANDA) memegang paket aktif di seed — kalau gerbang bocor,
    // section "Paket Aktif" akan muncul persis di sini.
    const { default: BerandaPassport } = await import("@/app/passport/page");
    expect(await render(BerandaPassport)).not.toMatch(/paket/i);
  });

  it("halaman /passport/bayar tidak menyebut paket", async () => {
    const { default: HalamanBayar } = await import("@/app/passport/bayar/page");
    const m = renderToStaticMarkup(await HalamanBayar());
    expect(m).not.toMatch(/paket/i);
    // Perbaikan review Task 4: `/paket/i` sendirian TIDAK CUKUP di halaman
    // ini — dibuktikan salah, bukan sekadar dicurigai. Baris tagihan paket
    // dirakit `susunTagihan()` (lib/passport/turunan.ts) dengan label
    // `${p.nama} · ${p.jumlahSesi} sesi`, dan nama paket seed Ananda adalah
    // "Sankalpa Prima" (supabase/seed.sql) — TIDAK mengandung substring
    // "paket" sama sekali. Diverifikasi langsung: menyalakan saklar sementara
    // dan merender ulang halaman ini menghasilkan markup yang LOLOS
    // `/paket/i` (match=false) padahal baris "Sankalpa Prima · 8 sesi" ada
    // di dalamnya — lihat "kontrol positif" di bawah untuk bukti yang
    // dipertahankan permanen di suite ini. Diperiksa langsung nama paket
    // seed dan pola label turunannya ("· N sesi") supaya kebocoran tetap
    // tertangkap meski labelnya sendiri tidak menyebut kata "paket".
    expect(m).not.toContain("Sankalpa Prima");
    expect(m).not.toMatch(/·\s*\d+\s*sesi\b/i);
  });

  // KONTROL POSITIF (review Task 4): membuktikan assertion di atas benar-
  // benar bisa MERAH, bukan sekadar tidak pernah tersentuh. Saklar dinyalakan
  // SEMENTARA hanya untuk render ini — begitu ambilPaket() bocor sungguhan,
  // baris "Sankalpa Prima · 8 sesi" MEMANG muncul di markup, dan `/paket/i`
  // MEMANG gagal menangkapnya (`not.toMatch(/paket/i)` di bawah tetap lolos)
  // — persis skenario yang membuat assertion utama vacuous sebelum
  // perbaikan ini. Assertion baru (nama paket & pola label) yang menangkap
  // kebocoran ini, bukan `/paket/i`.
  it("kontrol positif: dengan saklar HIDUP, baris tagihan paket ('Sankalpa Prima · 8 sesi') sungguh muncul di /passport/bayar dan lolos dari /paket/i", async () => {
    vi.resetModules();
    vi.doMock("@/lib/paket-tampil", () => ({ PAKET_TAMPIL: true }));
    const { default: HalamanBayarSaklarHidup } = await import("@/app/passport/bayar/page");
    const m = renderToStaticMarkup(await HalamanBayarSaklarHidup());
    vi.doUnmock("@/lib/paket-tampil");
    vi.resetModules();

    expect(m).not.toMatch(/paket/i); // buktinya persis: regex kata tidak pernah menangkap label ini
    expect(m).toContain("Sankalpa Prima");
    expect(m).toMatch(/·\s*\d+\s*sesi\b/i);
  });
});

// Sesi OWNER untuk /owner/rekap — halaman ini memanggil requireRole(["owner"])
// LANGSUNG di badan page.tsx (bukan cuma di layout), jadi sesinya wajib benar
// berperan owner sebelum halaman dirender.
describe("saklar paket: halaman owner tidak menyebut paket", () => {
  beforeAll(async () => {
    ref.klien = await signInAs("owner@padma.test");
  });

  it("halaman /owner/rekap tidak menyebut paket", async () => {
    const { default: RekapPage } = await import("@/app/owner/rekap/page");
    expect(await render(RekapPage)).not.toMatch(/paket/i);
  });
});

/**
 * PAGAR SAKLAR PAKET — SISI TULIS (review akhir cabang, temuan 3).
 *
 * `FormJadwalSesi` (form-sesi.tsx) menyimpan satu-satunya centang staf yang
 * MENULIS `client_package_id` ke sesi baru: `jadwalkanSesi` (aksi.ts:220)
 * membaca `formData.get("pakai_paket")` apa adanya dan sengaja TIDAK
 * disentuh saklar ini — field yang tidak pernah dikirim form dibaca sebagai
 * "tidak dicentang", persis checkbox kosong biasa (lihat komentar gerbang di
 * form-sesi.tsx). Itu berarti SATU-SATUNYA pagar yang berdiri antara saklar
 * mati dan sesi baru yang diam-diam terikat ke paket adalah blok
 * `{PAKET_TAMPIL && (...)}` yang membungkus checkbox `<input
 * name="pakai_paket">` di form-sesi.tsx.
 *
 * Uji "/admin/sesi tidak menyebut paket" di describe pertama berkas ini
 * (di atas) MENGAKUI SENDIRI lewat komentarnya bahwa ia vakum untuk gerbang
 * ini: `FormJadwalSesi` mulai TERTUTUP (`useState(false)`, form-sesi.tsx:63),
 * jadi checkbox itu tidak pernah muncul di render SSR awal SAMA SEKALI —
 * gerbangnya bisa dihapus total dari sumbernya dan uji itu tetap hijau.
 * Tidak ada test lain di suite ini yang menyentuhnya.
 *
 * Merender formulir dalam keadaan TERBUKA butuh jsdom + testing-library
 * (tidak ada di proyek ini, dan menambahkannya hanya demi satu assertion
 * bukan bagian temuan ini) — persis alasan yang sama yang membuat
 * `tests/transport-atribusi.test.ts` menjatuhkan `FormJadwalSesi` ke
 * PEMINDAIAN SUMBER di bawah "Ruling 22" alih-alih render sungguhan. Berkas
 * ini mengikuti pola yang sama: baca sumbernya, singkirkan komentar (supaya
 * gerbang yang "dipindah ke komentar" tidak lolos palsu — kelas bug yang
 * sama yang membuat transport-atribusi.test.ts menulis `tanpaKomentar()`),
 * lalu buktikan checkbox itu duduk DI DALAM cakupan kurung `PAKET_TAMPIL &&
 * ( ... )`, bukan sekadar di bawahnya dalam urutan baris.
 */
describe("saklar paket: gerbang TULIS pakai_paket (form-sesi.tsx)", () => {
  const SUMBER_FORM_SESI = path.resolve(__dirname, "../src/app/admin/sesi/form-sesi.tsx");

  /** Sama seperti tests/transport-atribusi.test.ts — komentar disingkirkan
   *  lebih dulu supaya gerbang yang "dipindah ke komentar" tidak lolos palsu. */
  function tanpaKomentar(kode: string): string {
    return kode
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  }

  /**
   * Mencari `{PAKET_TAMPIL && (` lalu menghitung kurung sampai seimbang ke 0
   * untuk mendapatkan CAKUPAN PERSIS blok yang digerbang — bukan sekadar
   * "muncul sesudah kata PAKET_TAMPIL" (yang akan lolos palsu bila gerbangnya
   * ditutup lebih awal dan checkbox ditulis di luar, sesudahnya).
   */
  function cakupanGerbangPaketTampil(kodeBersih: string): string | null {
    const penanda = "PAKET_TAMPIL && (";
    const mulaiPenanda = kodeBersih.indexOf(penanda);
    if (mulaiPenanda === -1) return null;
    const awalKurung = kodeBersih.indexOf("(", mulaiPenanda);
    let dalam = 0;
    for (let i = awalKurung; i < kodeBersih.length; i++) {
      if (kodeBersih[i] === "(") dalam++;
      else if (kodeBersih[i] === ")") {
        dalam--;
        if (dalam === 0) return kodeBersih.slice(awalKurung, i + 1);
      }
    }
    return null; // kurung tidak pernah seimbang — sumber cacat, bukan blok valid
  }

  it("checkbox 'pakai_paket' masih ada di sumber (kontrol: bukan sekadar dihapus)", () => {
    const sumber = readFileSync(SUMBER_FORM_SESI, "utf8");
    expect(sumber).toContain('name="pakai_paket"');
  });

  it("checkbox 'pakai_paket' duduk DI DALAM cakupan `{PAKET_TAMPIL && (...)}`, bukan cuma sesudahnya", () => {
    const bersih = tanpaKomentar(readFileSync(SUMBER_FORM_SESI, "utf8"));
    const blok = cakupanGerbangPaketTampil(bersih);
    expect(blok).not.toBeNull();
    expect(blok).toContain('name="pakai_paket"');
  });
});

/**
 * PAGAR SAKLAR PAKET — ISI PANEL GESER (merge sapuan panel staf).
 *
 * Sapuan panel staf menghapus `form-selesai.tsx` dan memindahkan isinya ke
 * `panel-sesi.tsx`, termasuk literal " · paket" yang di berkas lama SUDAH
 * digerbang. Gerbangnya dibawa ikut saat merge — dan pagar ini memastikan ia
 * tidak hilang lagi diam-diam.
 *
 * Kenapa PEMINDAIAN SUMBER, bukan render: `PanelSesi` hanya dirender bila
 * `?ubah=<id>` menunjuk sebuah sesi yang KEBETULAN ada di halaman pertama
 * daftar (`baris.find(...)`, sesi/page.tsx). Uji render "/admin/sesi tidak
 * menyebut paket" di atas merender keadaan awal — panelnya TERTUTUP di sana,
 * jadi gerbang ini bisa dihapus total dari sumbernya dan uji itu tetap hijau.
 * Persis kelas kevakuman yang membuat `tests/transport-atribusi.test.ts`
 * menjatuhkan `FormJadwalSesi` ke pemindaian sumber (Ruling 22), dan yang
 * membuat describe di atas ditulis untuk `form-sesi.tsx`.
 */
describe("saklar paket: gerbang TAMPIL ' · paket' (panel-sesi.tsx)", () => {
  const SUMBER_PANEL_SESI = path.resolve(__dirname, "../src/app/admin/sesi/panel-sesi.tsx");

  /** Duplikat sengaja dari describe di atas: `tanpaKomentar` di sana dilingkupi
   *  ke describe-nya sendiri, dan menaikkannya ke tingkat modul hanya demi
   *  dipakai dua kali membuat kedua describe berhenti bisa dibaca berdiri
   *  sendiri. Enam baris, bukan enam puluh. */
  function tanpaKomentar(kode: string): string {
    return kode
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  }

  it("literal ' · paket' masih ada di sumber (kontrol: bukan sekadar dihapus)", () => {
    // Saklar, bukan pembongkaran: teksnya tetap di berkas, tinggal menunggu
    // saklarnya dinyalakan. Tanpa kontrol ini, uji di bawah juga hijau bila
    // seseorang menghapus barisnya bulat-bulat.
    expect(readFileSync(SUMBER_PANEL_SESI, "utf8")).toContain("· paket");
  });

  it("literal ' · paket' hanya dirender bila PAKET_TAMPIL benar", () => {
    const bersih = tanpaKomentar(readFileSync(SUMBER_PANEL_SESI, "utf8"));
    // Setiap kemunculan "· paket" wajib berada pada baris yang sama dengan
    // `PAKET_TAMPIL &&` — bentuk yang benar-benar dipakai berkas ini
    // (`{PAKET_TAMPIL && sesi.dalamPaket ? " · paket" : ""}`), dan yang tidak
    // bisa dipalsukan dengan menaruh gerbang di baris lain.
    const baris = bersih.split("\n").filter((b) => b.includes("· paket"));
    expect(baris.length).toBeGreaterThan(0);
    for (const b of baris) expect(b, `tanpa gerbang: ${b.trim()}`).toContain("PAKET_TAMPIL &&");
  });
});

/**
 * PAGAR yang sama untuk TABEL /admin/sesi (`sesi/page.tsx`).
 *
 * Separuh lain dari `form-selesai.tsx` mendarat di sini. Berbeda dari
 * `panel-sesi.tsx`, baris tabel ini DIRENDER di keadaan awal — jadi uji render
 * di atas memang menyentuhnya. Yang tidak dijamin uji render itu: bahwa
 * halaman pertama daftar sungguh memuat sesi berpaket (kontrol positifnya ada
 * di atas, tapi ia bergantung pada isi seed). Pemindaian sumber ini berdiri
 * lepas dari data.
 */
describe("saklar paket: gerbang TAMPIL ' · paket' (sesi/page.tsx)", () => {
  const SUMBER_HALAMAN_SESI = path.resolve(__dirname, "../src/app/admin/sesi/page.tsx");

  it("literal ' · paket' di baris tabel hanya dirender bila PAKET_TAMPIL benar", () => {
    const bersih = readFileSync(SUMBER_HALAMAN_SESI, "utf8")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const baris = bersih.split("\n").filter((b) => b.includes("· paket"));
    expect(baris.length).toBeGreaterThan(0);
    for (const b of baris) expect(b, `tanpa gerbang: ${b.trim()}`).toContain("PAKET_TAMPIL &&");
  });
});
