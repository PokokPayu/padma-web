/**
 * Halaman detail layanan (`/admin/layanan/[id]`) — Tugas 8.
 *
 * Layanan berpola B (spec K1): ia punya DUA daftar anak (varian, paket) plus
 * satu daftar bacaan (materi terkait). Tugas 7 memecah katalog bersarang lama
 * menjadi daftar datar; berkas ini menguji separuh lainnya — halaman yang
 * anak-anak itu benar-benar mendarat.
 *
 * RULING A (lihat task-7-8-report.md): kolom Aksi varian TIDAK dikirim sebagai
 * placeholder `{/* diisi Tugas 9 *\/}` — brief Tugas 8 memuatnya begitu, tetapi
 * sel kosong yang dikomentari adalah markup mati yang lolos rubrik review.
 * Tautan "Ubah" (`?ubah=<id varian>`) dan "+ Varian baru" (`?ubah=baru`) sudah
 * FINAL di sini; Tugas 9 hanya menambahkan `PanelGeser` + `FormVarian` yang
 * membaca query itu. Uji "setiap baris varian menaut ke ?ubah=" yang semula
 * direncanakan lahir di Tugas 9 dipindah ke berkas ini karena itu.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { nominalDalam } from "./helpers/nominal";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const sumberHalamanDetail = readFileSync(
  path.join(AKAR, "src/app/admin/layanan/[id]/page.tsx"),
  "utf8",
);

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ nama: "Admin Uji", role: "admin" }),
}));

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound,
  // `PanelGeser` dan `FormVarian` (Tugas 9) memakai `useRouter` untuk tombol
  // Escape/overlay dan navigasi tutup-setelah-simpan — `renderToStaticMarkup`
  // tidak menjalankan efeknya, tapi pemanggilan `useRouter()` sendiri di
  // badan komponen tetap butuh mock ini, pola yang sama dengan
  // tests/admin-mitra.test.ts.
  useRouter: () => ({ push: () => {} }),
}));

// `ambilLayanan`/`daftarKatalogAdmin`/`daftarMateriAdmin` memakai SESI PENGGUNA
// (`createServerSupabase`), bukan service role — sama seperti seluruh lapisan
// data admin lain (lihat dokblok `@/lib/admin/katalog-admin`). Di vitest tidak
// ada cookie sungguhan untuk `cookies()` disuntikkan lewat request Next asli,
// jadi klien ber-SESI SUNGGUHAN disuntikkan di sini, pola yang sama dengan
// tests/admin-klien-halaman.test.tsx dan tests/admin-layanan.test.ts.
//
// BRIEF ASLI Tugas 8 TIDAK memuat mock ini sama sekali. Tanpanya,
// `createServerSupabase()` memanggil `cookies()` sungguhan dari "next/headers"
// di luar konteks request Next — yang melempar, bukan sekadar memulangkan data
// kosong — dan seluruh berkas ini gagal sebelum satu `describe` pun sempat
// berjalan (bukan gagal di assertion, gagal di IMPOR modul, karena `LAYANAN`
// di bawah dihitung di level atas berkas).
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

// Top-level await, BUKAN di dalam `beforeAll`: `LAYANAN` di bawah dihitung
// sebelum satu `describe`/`beforeAll` pun berjalan (evaluasi modul ESM
// selesai duluan), jadi sesinya harus siap sebelum baris itu, bukan sesudah.
ref.sesi = await signInAs("admin@padma.test");

const { ambilDaftarLayanan } = await import("@/lib/admin/layanan");
const { default: DetailLayananPage } = await import("@/app/admin/layanan/[id]/page");

async function markup(id: string, sp: Record<string, string> = {}) {
  return renderToStaticMarkup(
    await (DetailLayananPage as never as (p: unknown) => Promise<ReactElement>)({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve(sp),
    }),
  );
}

const { baris } = await ambilDaftarLayanan({ cari: "", saring: {}, hal: 1 });
const LAYANAN = baris[0];

describe("halaman detail layanan", () => {
  it("menampilkan nama layanan sebagai judul", async () => {
    expect(await markup(LAYANAN.id)).toContain(LAYANAN.nama);
  });

  it("punya jalan kembali ke daftar", async () => {
    expect(await markup(LAYANAN.id)).toContain('href="/admin/layanan"');
  });

  it("memuat daftar VARIAN — inilah alasan layanan berpola detail", async () => {
    const m = await markup(LAYANAN.id);
    expect(m).toContain("Varian");
  });

  it("memuat daftar PAKET", async () => {
    expect(await markup(LAYANAN.id)).toContain("Paket");
  });

  it("memuat materi terkait sebagai BACAAN saja", async () => {
    const m = await markup(LAYANAN.id);
    expect(m).toContain("Materi yang termasuk layanan ini");
    // Keterkaitan materi<->layanan dikelola dari modul Materi. Tidak boleh
    // ada dua tempat yang bisa menulis satu relasi.
    expect(m).not.toContain('name="material_id"');
  });

  it("id yang tidak ada memanggil notFound(), bukan merender halaman kosong", async () => {
    await expect(markup("00000000-0000-0000-0000-000000000000")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("nol rupiah — tarif adalah wilayah Owner", async () => {
    expect(nominalDalam(await markup(LAYANAN.id))).toEqual([]);
  });

  it("RULING B: judul materi adalah TEKS POLOS, bukan tautan ke rute Tugas 11", () => {
    // `/admin/materi/[id]` belum ada sampai Tugas 11 lahir (gelombang ini).
    // Brief asli Tugas 8 menaut ke sana; menaut ke rute yang belum ada adalah
    // 404 yang bisa lolos merge kalau gelombang 2 terpotong sebelum Tugas 11.
    expect(sumberHalamanDetail).not.toMatch(/href=\{`\/admin\/materi\//);
    expect(sumberHalamanDetail).not.toContain("/admin/materi/${m.id}");
  });
});

// ---------------------------------------------------------------------------
// RULING A: kolom Aksi varian FINAL, bukan placeholder Tugas 9
// ---------------------------------------------------------------------------

describe("RULING A — Aksi varian & paket sudah final, tanpa sel kosong Tugas 9", () => {
  it("tidak ada satu pun sel kosong '{/* diisi Tugas 9 */}' di berkas halaman", () => {
    expect(sumberHalamanDetail).not.toContain("diisi Tugas 9");
  });

  it("Kartu Varian menawarkan '+ Varian baru' yang menaut ke ?ubah=baru pada layanan itu sendiri", async () => {
    const m = await markup(LAYANAN.id);
    expect(m).toContain("+ Varian baru");
    expect(m).toMatch(new RegExp(`href="/admin/layanan/${LAYANAN.id}\\?ubah=baru"`));
  });
});

// ---------------------------------------------------------------------------
// Tugas 9: panel geser varian
// ---------------------------------------------------------------------------
//
// Brief asli Tugas 9 meminta LIMA uji di sini, termasuk "setiap baris varian
// menaut ke ?ubah=<id>" dan "tombol '+ Varian baru' menaut ke ?ubah=baru" —
// tetapi keduanya SUDAH ada di atas (RULING A) dan di
// "detail layanan — guarantee yang pindah dari Tugas 7" di bawah, ditulis
// Tugas 8. Mengulanginya di sini akan menguji markup yang sama dua kali dengan
// nama berbeda, bukan menambah jaminan baru — defect brief, dicatat di laporan
// Tugas 9, bukan diperbaiki diam-diam. Hanya TIGA uji baru yang benar-benar
// menambah cakupan (isi panel, pagar layanan lain, jalan menutup) yang tersisa
// di sini.
describe("panel geser varian di dalam halaman detail layanan", () => {
  it("?ubah=baru membuka panel geser berisi formulir varian", async () => {
    const m = await markup(LAYANAN.id, { ubah: "baru" });
    expect(m).toContain('role="dialog"');
    expect(m).toContain('name="label"');
    expect(m).toContain('name="durasi_menit"');
  });

  it("id varian milik layanan LAIN tidak membuka panel", async () => {
    // Pagar nyata, bukan kosmetik: panel yang terbuka untuk varian layanan
    // lain akan menyimpan perubahan ke baris yang tidak sedang dilihat admin.
    const m = await markup(LAYANAN.id, { ubah: "00000000-0000-0000-0000-000000000000" });
    expect(m).not.toContain('role="dialog"');
  });

  it("menutup panel kembali ke halaman detail tanpa ?ubah", async () => {
    const m = await markup(LAYANAN.id, { ubah: "baru" });
    expect(m).toContain(`href="/admin/layanan/${LAYANAN.id}"`);
  });
});

// ---------------------------------------------------------------------------
// Guarantee yang PINDAH dari tests/admin-layanan.test.ts (Tugas 7)
// ---------------------------------------------------------------------------
//
// Empat pemeriksaan berikut dulu menyasar katalog bersarang di /admin/layanan
// (satu halaman berisi SELURUH fase/layanan/paket/varian). Tugas 7 membongkar
// halaman itu jadi daftar datar tanpa anak, jadi keempatnya tidak punya rumah
// lagi di sana — bukan hilang, pindah ke sini, karena di SINI-lah anak sebuah
// layanan sekarang benar-benar dirender.
//
// Fixture SENDIRI (PAD-UJI-DETAIL-*), bukan meminjam punya admin-layanan.test.ts:
// `fileParallelism: false` membuat kedua berkas berjalan berurutan, tetapi
// meminjam id fixture antar berkas tetap membuat berkas ini diam-diam gagal
// begitu berkas lain mengubah urutan/isi fixture-nya. Dibersihkan di afterAll.
describe("detail layanan — guarantee yang pindah dari Tugas 7", () => {
  const SVC_DETAIL = "11111111-1111-1111-1111-1111111119c1";
  const VARIAN_NONAKTIF_DETAIL = "77777777-7777-7777-7777-7777777779c1";
  const PAKET_DETAIL = "22222222-2222-2222-2222-2222222229c1";
  let varianBakuDetail: string;

  beforeAll(async () => {
    // `aktif: false` SEJAK LAHIR — layanan ini sengaja tidak pernah aktif,
    // supaya "menawarkan jalan MENGAKTIFKAN kembali" punya sasaran yang jelas
    // tanpa perlu toggle bolak-balik yang mengganggu test lain di file lain.
    await admin.from("services").insert({
      id: SVC_DETAIL,
      phase_id: "prekonsepsi",
      nama: "PAD-UJI Layanan Detail",
      deskripsi: "fixture",
      aktif: false,
    });
    // Trigger `trg_terbitkan_varian_baku` menerbitkan satu varian BAKU
    // otomatis begitu SVC_DETAIL disisipkan — id-nya `gen_random_uuid()`,
    // dicari di sini, bukan ditulis sebagai konstanta (pola yang sama dengan
    // tests/admin-layanan.test.ts).
    const { data: baku } = await admin
      .from("service_variants")
      .select("id")
      .eq("service_id", SVC_DETAIL)
      .single();
    varianBakuDetail = baku!.id;

    await admin.from("service_variants").insert({
      id: VARIAN_NONAKTIF_DETAIL,
      service_id: SVC_DETAIL,
      label: "PAD-UJI Varian Nonaktif",
      durasi_menit: 45,
      format: "circle",
      urutan: 1,
      aktif: false,
    });
    await admin.from("packages").insert({
      id: PAKET_DETAIL,
      service_id: SVC_DETAIL,
      nama: "PAD-UJI Paket Detail",
      jumlah_sesi: 6,
    });
  });

  afterAll(async () => {
    // Varian & paket disapu lebih dulu — FK menahan penghapusan `services`
    // sampai anaknya bersih, pola yang sama dengan `bersihkan()` di
    // tests/admin-layanan.test.ts.
    await admin.from("service_variants").delete().eq("service_id", SVC_DETAIL);
    await admin.from("packages").delete().eq("service_id", SVC_DETAIL);
    await admin.from("services").delete().eq("id", SVC_DETAIL);
  });

  it("menawarkan jalan MENGAKTIFKAN kembali layanan yang nonaktif", async () => {
    // Dulu: baris daftar sendiri membawa tombol ini. Pola B memindahkannya ke
    // halaman detail (AksiLayanan) — baris daftar hanya menaut, tidak lagi
    // membawa aksi.
    expect(await markup(SVC_DETAIL)).toContain("Aktifkan");
  });

  it("menampilkan paket beserta jumlah sesinya", async () => {
    const m = await markup(SVC_DETAIL);
    expect(m).toContain("PAD-UJI Paket Detail");
    expect(m).toMatch(/6 sesi/);
    expect(nominalDalam(m)).toEqual([]);
  });

  it("menampilkan varian nonaktif apa adanya, varian baku tampil sebagai \"Standar\"", async () => {
    const m = await markup(SVC_DETAIL);
    expect(m).toContain("PAD-UJI Varian Nonaktif");
    // Beda dari regex lama "/Varian baku/i" di Tugas 7: page.tsx Tugas 8
    // memakai fallback "Standar" (lihat `labelVarian(...) || "Standar"`),
    // bukan frasa "Varian baku" — mengulang teks lama di sini akan menguji
    // string yang tidak pernah dirender kode yang sebenarnya.
    expect(m).toContain("Standar");
  });

  it("RULING A: setiap baris varian menaut ke ?ubah=<id varian>nya sendiri", async () => {
    const m = await markup(SVC_DETAIL);
    expect(m).toMatch(
      new RegExp(`href="/admin/layanan/${SVC_DETAIL}\\?ubah=${varianBakuDetail}"`),
    );
    expect(m).toMatch(
      new RegExp(`href="/admin/layanan/${SVC_DETAIL}\\?ubah=${VARIAN_NONAKTIF_DETAIL}"`),
    );
  });
});
