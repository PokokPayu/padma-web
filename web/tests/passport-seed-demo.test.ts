import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

// Seed demo adalah BAHAN PRESENTASI, bukan sekadar fixture: kalau Ananda hanya
// punya 1 dari 8 sesi dan 1 badge, passport tampak kosong saat ditunjukkan ke
// klien. Test ini mengunci kekayaan seed itu — dan mengunci pula pagar yang
// mudah tertabrak sambil memperkayanya (satu baris `clients`, layanan Lactation
// Hero tetap belum pernah dijalani sehingga gating materi masih terbukti).
//
// Seluruh angka di sini dibaca lewat KODE NYATA (`ambilSesi`/`ambilPaket` +
// kalkulasi turunan), bukan lewat query tandingan, supaya yang terbukti adalah
// "passport menampilkan 6/8 & 3 badge", bukan "tabelnya berisi sesuatu".
const ref = vi.hoisted(() => ({ klien: null as SupabaseClient | null }));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.klien!,
}));

const svc = createAdminSupabase();

const ANANDA = "44444444-4444-4444-4444-444444444401";
const PAKET_ANANDA = "55555555-5555-5555-5555-555555555501";
const SVC_LACTATION = "11111111-1111-1111-1111-111111111106";

// Tanggal acuan disuntikkan, TIDAK dibaca dari jam mesin: test tidak boleh
// mulai gagal sendiri hanya karena hari berganti (lihat Pagar Waktu).
const SEKARANG = "2026-08-29";

beforeAll(async () => {
  ref.klien = await signInAs("ananda@padma.test");
});

describe("seed demo — passport Ananda terlihat penuh", () => {
  it("tiga badge layanan berbeda dari sesi yang sudah selesai", async () => {
    const { ambilSesi } = await import("@/lib/passport/data");
    const { badgeDari } = await import("@/lib/passport/turunan");

    const badge = badgeDari(await ambilSesi(ANANDA));
    expect(badge).toHaveLength(3);
    expect(badge.map((b) => b.nama).sort()).toEqual([
      "Konsultasi Nutrisi Prekonsepsi",
      "PADMA Flow Yoga - Prekonsepsi",
      "Sankalpa Fertility Massage",
    ]);
  });

  it("catatan & rekomendasi bidan pantas dibaca saat presentasi", async () => {
    const { ambilSesi } = await import("@/lib/passport/data");
    const selesai = (await ambilSesi(ANANDA)).filter((s) => s.status === "selesai");

    expect(selesai).toHaveLength(6);
    // Bukan "dummy"/"lorem": riwayat sesi adalah layar yang paling lama
    // dipandangi saat demo.
    expect(selesai.every((s) => s.catatan.length >= 60)).toBe(true);
    expect(selesai.every((s) => s.rekomendasi.length >= 40)).toBe(true);
    expect(selesai.some((s) => /dummy|lorem/i.test(s.catatan + s.rekomendasi))).toBe(false);
    // Nama bidan tampil di tiap kartu ("Tim PADMA" = pemetaan mitra gagal).
    expect(selesai.every((s) => s.namaMitra.startsWith("Bidan "))).toBe(true);
  });
});

// GERBANG SAKLAR (K11, Task 4): tiga uji di bawah membaca `ambilPaket()`
// LANGSUNG — bukan lewat halaman — untuk mengunci kekayaan seed paket Ananda
// (progres 6/8, grid stempel, tagihan paket). `ambilPaket()` memulangkan []
// begitu `PAKET_TAMPIL` mati (gerbangnya sendiri diuji
// tests/paket-tersembunyi.test.tsx), jadi ketiganya dipertahankan dengan
// menyalakan saklar SEMENTARA hanya untuk blok ini — pola yang sama dengan
// tests/klaim-sesi-lepas.test.ts & tests/admin-klien-data.test.ts. Fungsi
// turunannya (progresPaket/gridStempel/susunTagihan) tidak menyentuh saklar
// sama sekali, jadi tidak perlu diimpor ulang.
describe("seed demo — passport Ananda terlihat penuh (paket, saklar K11 sementara)", () => {
  let ambilSesiSementara: (id: string) => Promise<Awaited<ReturnType<typeof import("@/lib/passport/data").ambilSesi>>>;
  let ambilPaketSementara: (id: string) => Promise<Awaited<ReturnType<typeof import("@/lib/passport/data").ambilPaket>>>;

  beforeAll(async () => {
    vi.doMock("@/lib/paket-tampil", () => ({ PAKET_TAMPIL: true }));
    vi.resetModules();
    ({ ambilSesi: ambilSesiSementara, ambilPaket: ambilPaketSementara } = await import(
      "@/lib/passport/data"
    ));
  });

  afterAll(() => {
    vi.doUnmock("@/lib/paket-tampil");
    vi.resetModules();
  });

  it("progres paket 6 dari 8 sesi (75%), bukan 1 dari 8", async () => {
    const { progresPaket } = await import("@/lib/passport/turunan");

    const [sesi, paket] = await Promise.all([
      ambilSesiSementara(ANANDA),
      ambilPaketSementara(ANANDA),
    ]);
    expect(paket).toHaveLength(1);

    expect(progresPaket({ totalSesi: paket[0].jumlahSesi, sesi })).toEqual({
      selesai: 6,
      total: 8,
      persen: 75,
    });
  });

  it("grid stempel: 6 terisi, 1 penanda berikutnya, 1 kosong", async () => {
    const { gridStempel } = await import("@/lib/passport/turunan");

    const [sesi, paket] = await Promise.all([
      ambilSesiSementara(ANANDA),
      ambilPaketSementara(ANANDA),
    ]);
    const grid = gridStempel({ totalSesi: paket[0].jumlahSesi, sesi, sekarang: SEKARANG });

    expect(grid.map((g) => g.jenis)).toEqual([
      "terisi", "terisi", "terisi", "terisi", "terisi", "terisi",
      "berikutnya",
      "kosong",
    ]);
  });

  it("ada satu sesi lepas belum dibayar sebagai bahan halaman Bayar", async () => {
    const { susunTagihan } = await import("@/lib/passport/turunan");

    const [sesi, paket] = await Promise.all([
      ambilSesiSementara(ANANDA),
      ambilPaketSementara(ANANDA),
    ]);
    const tagihan = susunTagihan({ paket, sesi });

    expect(tagihan.filter((t) => t.jenis === "paket")).toHaveLength(1);
    const lepas = tagihan.filter((t) => t.jenis === "sesi");
    expect(lepas).toHaveLength(1);
    expect(lepas[0].status).toBe("belum");
  });
});

describe("seed demo — pagar yang tidak boleh tertabrak saat memperkaya", () => {
  it("Ananda tetap TEPAT SATU baris clients", async () => {
    // Memperkaya demo menggoda untuk "menambah satu klien lagi buat Ananda";
    // itu akan meruntuhkan tests/rls-firewall.test.ts sekaligus melanggar
    // invarian satu akun ↔ satu klien.
    const { data: milik } = await svc
      .from("clients")
      .select("user_id")
      .eq("id", ANANDA)
      .single();
    const { data } = await svc
      .from("clients")
      .select("id")
      .eq("user_id", milik!.user_id);
    expect(data).toHaveLength(1);
  });

  it("Ananda tetap TIDAK punya sesi layanan Lactation Hero (gating materi tetap terbukti)", async () => {
    const { data } = await svc
      .from("sessions")
      .select("id")
      .eq("client_id", ANANDA)
      .eq("service_id", SVC_LACTATION);
    expect(data ?? []).toHaveLength(0);
  });

  it("seluruh sesi selesai Ananda memang tercatat di dalam paketnya", async () => {
    const { data } = await svc
      .from("sessions")
      .select("client_package_id")
      .eq("client_id", ANANDA)
      .eq("status", "selesai");
    expect(data ?? []).toHaveLength(6);
    expect((data ?? []).every((s) => s.client_package_id === PAKET_ANANDA)).toBe(true);
  });
});

describe("seed demo — materi", () => {
  // Dua test yang pernah hidup di sini DIHAPUS, bukan diadaptasi:
  //
  //  * "jumlah bab e-book cocok dengan yang dijanjikan deskripsinya" — bab
  //    teks dibongkar total di Task 11; deskripsi seed tidak lagi menjanjikan
  //    angka "N bab" apa pun ("E-book bergambar tentang membaca siklus."),
  //    jadi tidak ada lagi janji untuk dicocokkan.
  //  * "isi bab materi terbuka pantas dibaca, bukan placeholder" — isi e-book
  //    kini GAMBAR halaman (`material_pages.objek`, byte di storage), bukan
  //    teks tersimpan di baris basis data. Tidak ada lagi "isi" bertipe teks
  //    untuk diperiksa panjang/dummy-nya. Penggantinya — membuktikan objek
  //    demo di storage BENAR-BENAR berkas gambar sungguhan, bukan stub atau
  //    404 — sudah hidup di tests/materi-route-halaman.test.ts, yang
  //    memanggil rute penyaji halaman sungguhan dan memeriksa magic number
  //    byte WEBP/RIFF yang kembali.

  it("katalog materi aktif minimal empat, dengan yang terbuka dan yang terkunci", async () => {
    const { ambilDaftarMateri } = await import("@/lib/passport/data");
    const daftar = await ambilDaftarMateri();
    expect(daftar.length).toBeGreaterThanOrEqual(4);
    expect(daftar.some((m) => m.terbuka)).toBe(true);
    expect(daftar.some((m) => !m.terbuka)).toBe(true);
  });
});
