/**
 * Halaman detail materi (`/admin/materi/[id]`) — Tugas 11.
 *
 * Materi berpola B (spec K1): ia punya SATU daftar anak yang sungguh butuh
 * layarnya sendiri — penugasan manual per klien (`material_assignments`) —
 * plus isinya sendiri (halaman e-book atau video). Tugas 10 memecah daftar
 * bersarang lama menjadi daftar datar berpaginasi tanpa aksi per baris;
 * berkas ini menguji separuh lainnya — halaman yang isi & penugasan itu
 * benar-benar mendarat, dan mengambil RULING dari task-7-8-report.md (pola
 * yang sama untuk Layanan) yang belum diketahui brief Tugas 11 saat ditulis:
 * `createServerSupabase` WAJIB disuntik sesi sungguhan, bukan dibiarkan
 * memanggil `cookies()` telanjang di luar request Next.
 */
import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signInAs } from "./helpers/as-user";
import { nominalDalam } from "./helpers/nominal";

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ nama: "Admin Uji", role: "admin" }),
}));

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound,
  // `IsiEbook`/`IsiVideo`/`PanelPenugasan` memakai `useRouter()` untuk
  // `router.refresh()` sesudah unggahan/penugasan — `renderToStaticMarkup`
  // tidak menjalankan efeknya, tapi pemanggilan `useRouter()` sendiri di
  // badan komponen tetap butuh mock ini, pola yang sama dengan
  // tests/admin-layanan-detail.test.tsx.
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

// `ambilMateri`/`pilihanLayananMateri`/`pilihanKlien`/`daftarPenugasan`
// memakai SESI PENGGUNA (`createServerSupabase`), bukan service role — di
// vitest tidak ada cookie sungguhan untuk `cookies()` disuntikkan lewat
// request Next asli, jadi klien ber-SESI SUNGGUHAN disuntikkan di sini.
//
// BRIEF ASLI Tugas 11 TIDAK memuat mock ini sama sekali (persis seperti brief
// Tugas 8 yang sudah dicatat kekurangan yang sama di admin-layanan-detail.test.tsx).
// Tanpanya `createServerSupabase()` melempar di luar konteks request Next, dan
// seluruh berkas ini gagal sebelum satu `describe` pun berjalan karena `MATERI`
// di bawah dihitung di level atas berkas (top-level await).
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

// Top-level await, BUKAN di dalam `beforeAll`: `MATERI` di bawah dihitung
// sebelum satu `describe`/`beforeAll` pun berjalan (evaluasi modul ESM selesai
// duluan), jadi sesinya harus siap sebelum baris itu, bukan sesudah.
ref.sesi = await signInAs("admin@padma.test");

const { ambilDaftarMateri } = await import("@/lib/admin/materi-admin");
const { default: DetailMateriPage } = await import("@/app/admin/materi/[id]/page");

async function markup(id: string) {
  return renderToStaticMarkup(
    await (DetailMateriPage as never as (p: unknown) => Promise<ReactElement>)({
      params: Promise.resolve({ id }),
    }),
  );
}

const { baris } = await ambilDaftarMateri({ cari: "", saring: {}, hal: 1 });
const MATERI = baris[0];

describe("halaman detail materi", () => {
  it("menampilkan judul materi", async () => {
    expect(await markup(MATERI.id)).toContain(MATERI.judul);
  });

  it("punya jalan kembali ke daftar", async () => {
    expect(await markup(MATERI.id)).toContain('href="/admin/materi"');
  });

  it("memuat panel penugasan per klien — inilah alasan materi berpola detail", async () => {
    const m = await markup(MATERI.id);
    expect(m).toContain('name="client_id"');
  });

  it("memuat pengunggah isi sesuai TIPE materi", async () => {
    // E-book mendapat pengunggah PDF, video mendapat pengunggah video. Materi
    // yang mendapat pengunggah salah tipe menyimpan isi yang tidak akan pernah
    // dibaca jalur mana pun.
    const m = await markup(MATERI.id);
    expect(m).toContain(MATERI.tipe === "ebook" ? "halaman" : "video");
  });

  it("id yang tidak ada memanggil notFound()", async () => {
    await expect(markup("00000000-0000-0000-0000-000000000000")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(notFound).toHaveBeenCalled();
  });

  it("nol rupiah", async () => {
    expect(nominalDalam(await markup(MATERI.id))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Empat Kartu: data, isi, layanan tertaut, penugasan
// ---------------------------------------------------------------------------

describe("empat Kartu halaman detail materi", () => {
  it("Kartu 'Data materi' memuat formulir Ubah beserta layanan tertautnya", async () => {
    const m = await markup(MATERI.id);
    expect(m).toContain("Data materi");
    expect(m).toContain("Ubah");
    expect(m).toMatch(/Aktifkan|Nonaktifkan/);
  });

  it("Kartu 'Isi' berjudul persis begitu", async () => {
    expect(await markup(MATERI.id)).toContain("Isi");
  });

  it("Kartu 'Layanan tertaut' menampilkan checkbox NONAKTIF (bacaan saja) — satu-satunya penulis relasi ini adalah AksiMateri", async () => {
    // RULING (Tugas 11): dua tempat yang bisa menulis relasi yang sama adalah
    // persis kelas bug yang membuat "Materi yang termasuk layanan ini" di
    // layanan/[id]/page.tsx bacaan saja untuk arah sebaliknya — Kartu ini
    // menahan diri dengan cara yang sama, lewat `disabled` pada checkbox-nya.
    const m = await markup(MATERI.id);
    expect(m).toContain("Layanan tertaut");
    // React server rendering tidak menjamin urutan atribut (`disabled=""`
    // muncul SEBELUM `name="service_id"` di markup nyata) — dicocokkan per
    // tag `<input>` utuh, bukan lewat satu regex berurutan.
    const checkboxLayanan = [...m.matchAll(/<input[^>]*>/g)]
      .map((x) => x[0])
      .filter((tag) => tag.includes('name="service_id"'));
    expect(checkboxLayanan.length).toBeGreaterThan(0);
    for (const tag of checkboxLayanan) expect(tag).toContain('disabled=""');
  });

  it("Kartu 'Penugasan manual' memuat komponen PanelPenugasan", async () => {
    expect(await markup(MATERI.id)).toContain("Penugasan manual");
  });
});
