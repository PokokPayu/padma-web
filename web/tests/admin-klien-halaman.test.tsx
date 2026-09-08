import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signInAs } from "./helpers/as-user";
import { pesanBerikutnya } from "@/app/admin/klien/form-klien";
import { nominalDalam } from "./helpers/nominal";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

vi.mock("@/lib/auth/require-role", () => ({ requireRole: async () => "admin" }));

// `ambilDaftarKlien` (dan pembacaan `phases` di rute /baru) memakai SESI
// PENGGUNA (`createServerSupabase`), bukan service role — RLS `clients: staf`
// yang mengizinkan bacaannya. Di vitest tidak ada cookie untuk `cookies()`
// disuntikkan lewat request Next asli, jadi klien ber-SESI SUNGGUHAN
// disuntikkan di sini, pola yang sama dengan tests/admin-mitra-halaman.test.tsx.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

beforeAll(async () => {
  ref.sesi = await signInAs("admin@padma.test");
});

const klienMod = await import("@/lib/admin/klien");
const { default: HalamanKlien } = await import("@/app/admin/klien/page");

const render = async (sp: Record<string, string> = {}) =>
  renderToStaticMarkup(await HalamanKlien({ searchParams: Promise.resolve(sp) }));

describe("halaman /admin/klien", () => {
  it("setiap baris menaut ke halaman detailnya", async () => {
    // Pola B: klien punya isi turunan (riwayat sesi, paket, akses materi),
    // jadi barisnya membuka halaman, bukan panel geser.
    const m = await render();
    expect(m).toMatch(/href="\/admin\/klien\/[0-9a-f-]{36}"/);
  });

  it("TIDAK ada panel geser di modul ini", async () => {
    expect(await render()).not.toContain('role="dialog"');
  });

  it("punya bilah cari dan chip aktivasi", async () => {
    const m = await render();
    expect(m).toContain('name="cari"');
    expect(m).toContain("aktivasi=belum");
  });

  it("pencarian menyempitkan tabel yang dirender", async () => {
    const semua = await render();
    const disaring = await render({ cari: "ananda" });
    const hitung = (s: string) => (s.match(/href="\/admin\/klien\/[0-9a-f-]{36}"/g) ?? []).length;
    expect(hitung(disaring)).toBeLessThan(hitung(semua));
    expect(hitung(disaring)).toBeGreaterThan(0);
  });

  it("penjelasan halaman terlipat, bukan hilang", async () => {
    expect(await render()).toContain("<details");
  });

  it("TIDAK menampilkan satu nominal rupiah pun", async () => {
    expect(nominalDalam(await render()), "nominal bocor").toEqual([]);
  });

  it("pencarian tanpa hasil menampilkan kalimat keadaan kosong, bukan tabel kosong senyap", async () => {
    // Sama seperti /admin/mitra: kepala tabel enam kolom di atas badan yang
    // tidak menampilkan apa-apa terbaca sebagai galat, bukan sebagai "tidak
    // ada yang cocok". "zzznotfoundzzz" tidak cocok padma_id maupun nama
    // klien seed manapun.
    const m = await render({ cari: "zzznotfoundzzz" });
    expect(m).toContain("Tidak ada klien yang cocok dengan pencarian ini.");
    expect(m).not.toMatch(/href="\/admin\/klien\/[0-9a-f-]{36}"/);
  });

  it("daftar kosong TANPA pencarian/saringan aktif menampilkan kalimat hari-pertama, bukan kalimat pencarian", async () => {
    // BLOCKING 3 (review sapuan panel): "tidak cocok dengan pencarian ini"
    // hanya benar bila ADA pencarian/saringan yang gagal — klinik yang baru
    // dipasang dan belum punya satu klien pun bukan itu. `ambilDaftarKlien`
    // di-spy supaya baris kosong bisa diuji tanpa mengosongkan tabel `clients`
    // yang dipakai bersama seluruh suite.
    const spy = vi
      .spyOn(klienMod, "ambilDaftarKlien")
      .mockResolvedValue({ baris: [], total: 0 });
    try {
      const m = await render();
      expect(m).toContain("Belum ada klien terdaftar");
      expect(m).not.toContain("cocok dengan pencarian ini");
    } finally {
      spy.mockRestore();
    }
  });

  it("berkas rute /admin/klien/baru berisi formulir klien baru, bukan markup halaman detail", async () => {
    // Membuktikan ISI berkas ini — bukan bahwa Next.js benar-benar mengarahkan
    // request `/admin/klien/baru` kemari alih-alih ke `[id]/page.tsx` dengan
    // `id="baru"`. Prioritas segmen statis di atas dinamis adalah perilaku
    // ROUTER Next sendiri, bukan sesuatu yang bisa diregresi oleh kode di
    // berkas ini — jadi tidak diuji ulang di sini.
    const { default: Baru } = await import("@/app/admin/klien/baru/page");
    const m = renderToStaticMarkup(await Baru());
    expect(m).toContain('name="nama"');
    expect(m).toContain("Kembali ke Klien");
  });
});

describe("pesanBerikutnya — pesan sukses dan galat FormKlienBaru saling meniadakan", () => {
  // Fungsi murni, sengaja dites langsung tanpa merender komponennya: suite
  // ini berjalan di `environment: "node"` (lihat vitest.config.ts) tanpa
  // jsdom/testing-library, jadi mensimulasikan "submit sukses, LALU submit
  // gagal di form yang sama tanpa reload" lewat klik sungguhan tidak
  // tersedia di sini. Fungsi ini adalah SELURUH logika yang menentukan
  // pesan mana yang tampil sesudah submit — mengujinya langsung membuktikan
  // invariannya tanpa perlu jsdom.
  it("submit GAGAL menghapus pesan sukses submit SEBELUMNYA (regresi Fix Round 1)", () => {
    // Skenario: klien A tersimpan (berhasil="PAD-0001"), lalu admin mengisi
    // klien B di form yang sama dan submitnya gagal. "Tersimpan sebagai
    // PAD-0001" TIDAK BOLEH ikut nempel di layar bersama pesan galat B.
    expect(pesanBerikutnya({ ok: false, pesan: "Email sudah dipakai." })).toEqual({
      pesan: "Email sudah dipakai.",
      berhasil: null,
    });
  });

  it("submit SUKSES menghapus pesan galat submit SEBELUMNYA", () => {
    expect(pesanBerikutnya({ ok: true, padmaId: "PAD-0002" })).toEqual({
      pesan: null,
      berhasil: "PAD-0002",
    });
  });
});

describe("palet — satu layar, satu palet", () => {
  const BERKAS = [
    "src/app/admin/klien/baru/page.tsx",
    "src/app/admin/klien/[id]/page.tsx",
    "src/app/admin/klien/form-klien.tsx",
    "src/app/admin/klien/[id]/kartu-aktivasi.tsx",
    "src/app/admin/skrining/jadikan-klien.tsx",
  ];

  it("tidak ada sisa palet lama di modul Klien", () => {
    // Kelas-kelas ini adalah palet halaman KLIEN (paper/night/gold), bukan
    // palet ruang kerja staf. Bertetangga dengan daftar bertoken panel-*,
    // keduanya terbaca sebagai dua aplikasi berbeda dalam satu layar.
    // "border-black/10" dan "border-black/15" dituliskan terpisah (bukan
    // sebagai awalan "border-black/1") supaya daftarnya tidak butuh
    // penjelasan tambahan untuk dibaca.
    const sisa: string[] = [];
    for (const b of BERKAS) {
      const isi = baca(b);
      for (const kelas of [
        "bg-night",
        "text-gold-pale",
        "border-gold",
        "bg-white",
        "border-black/10",
        "border-black/15",
      ]) {
        if (isi.includes(kelas)) sisa.push(`${b}: ${kelas}`);
      }
    }
    expect(sisa).toEqual([]);
  });

  it("pagar bergigi: daftar berkas tidak kosong dan berkasnya benar-benar terbaca", () => {
    // Tanpa ini, salah tulis path membuat `baca()` melempar — atau, bila
    // suatu saat diberi nilai cadangan, membuat seluruh uji lolos hampa.
    expect(BERKAS.length).toBeGreaterThan(0);
    for (const b of BERKAS) expect(baca(b).length).toBeGreaterThan(100);
  });
});
