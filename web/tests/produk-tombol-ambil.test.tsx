import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// Komponen ini "use client" dan mengimpor server action; actionnya tidak pernah
// dipanggil di berkas ini (yang diuji adalah TAMPILAN per keadaan), tapi
// impornya tetap dievaluasi — dan `ambil.ts` menarik `next/cache` serta klien
// Supabase sisi server. Di-mock supaya uji ini benar-benar hanya menguji
// render, bukan menyeret setengah server ke dalamnya.
vi.mock("@/app/produk/[slug]/ambil", () => ({
  ambilProdukGratis: async () => ({ ok: true, punya: true }),
}));

const { PanelAmbil, punyaProdukDiPeramban } = await import("@/app/produk/[slug]/tombol-ambil");

const kosong = { slug: "panduan-menyusui", pending: false, pesan: null, onAmbil: () => {} };

/**
 * Spec menjanjikan tiga keadaan tombol produk, dan yang KEDUA sebelumnya tidak
 * pernah ada: klien yang sudah memiliki produk gratis kembali ke halamannya dan
 * ditawari "Ambil gratis" lagi — kliknya "berhasil" (RPC `on conflict do
 * nothing`) tanpa memberi satu pun jalan menuju isinya.
 */
describe("tombol produk — tiga keadaan", () => {
  it('belum punya: menawarkan "Ambil gratis", bukan jalan masuk', () => {
    const m = renderToStaticMarkup(<PanelAmbil {...kosong} keadaan="belum" />);
    expect(m).toContain("Ambil gratis");
    expect(m).not.toContain("/passport/produk/panduan-menyusui");
  });

  it('sudah punya: menawarkan "Buka" ke reader produknya, bukan "Ambil gratis" lagi', () => {
    const m = renderToStaticMarkup(<PanelAmbil {...kosong} keadaan="punya" />);
    expect(m).toContain('href="/passport/produk/panduan-menyusui"');
    expect(m).toContain("Buka");
    expect(m).not.toContain("Ambil gratis");
    // Dan jalan ke daftar lengkapnya, karena itulah tab yang dulu tidak
    // pernah ditautkan dari mana pun.
    expect(m).toContain('href="/passport/produk"');
  });

  it("entitlement dicabut: TIDAK mengaku berhasil", () => {
    // RPC menjawab "tidak ada galat" untuk pengambilan ulang yang sengaja
    // tidak menghidupkan entitlement tercabut. Layar yang menyebutnya
    // berhasil berbohong, dan bohongnya baru ketahuan saat pembeli mengklik.
    const m = renderToStaticMarkup(<PanelAmbil {...kosong} keadaan="cabut" />);
    expect(m).not.toContain("Buka");
    expect(m).not.toContain("Ambil gratis");
    expect(m).toContain("tidak aktif");
  });
});

/**
 * Kepemilikan ditanyakan DARI PERAMBAN supaya `/produk/[slug]` tetap anon &
 * ter-cache (`revalidate = 300`). Pertanyaannya diajukan ke RPC `punya_produk`
 * — predikat yang SAMA dengan gerbang isi (tidak dicabut DAN belum
 * kedaluwarsa), bukan pembacaan tabel `digital_entitlements`. Sifatnya diuji
 * di sini dengan klien palsu, tanpa jaringan: tanpa sesi ia tidak bertanya
 * sama sekali, dan jawaban selain `true` BUKAN kepemilikan.
 */
describe("punyaProdukDiPeramban", () => {
  function klienPalsu(sesi: unknown, jawaban: boolean, panggilan: Array<[string, unknown]>) {
    return {
      auth: { getSession: async () => ({ data: { session: sesi } }) },
      rpc: async (nama: string, params: unknown) => {
        panggilan.push([nama, params]);
        return { data: jawaban, error: null };
      },
    } as unknown as SupabaseClient;
  }

  it("pengunjung anon: tidak bertanya apa pun, dan tidak dianggap memiliki", async () => {
    const panggilan: Array<[string, unknown]> = [];
    expect(await punyaProdukDiPeramban(klienPalsu(null, true, panggilan), "p1")).toBe(false);
    // Kalau ia tetap bertanya, `anon` hanya akan menerima galat di konsol
    // pengunjung — kebisingan tanpa jawaban.
    expect(panggilan).toEqual([]);
  });

  it("klien login dengan akses hidup: memiliki, lewat RPC punya_produk", async () => {
    const panggilan: Array<[string, unknown]> = [];
    const sb = klienPalsu({ user: "x" }, true, panggilan);
    expect(await punyaProdukDiPeramban(sb, "p1")).toBe(true);
    // Predikat kepemilikan SATU pintu: dicabut dan kedaluwarsa sudah
    // diputuskan di dalam RPC, bukan di sini.
    expect(panggilan).toEqual([["punya_produk", { p_product_id: "p1" }]]);
  });

  it("klien login tanpa akses hidup (tak punya, dicabut, atau kedaluwarsa): tidak memiliki", async () => {
    const panggilan: Array<[string, unknown]> = [];
    const sb = klienPalsu({ user: "x" }, false, panggilan);
    expect(await punyaProdukDiPeramban(sb, "p1")).toBe(false);
    expect(panggilan).toEqual([["punya_produk", { p_product_id: "p1" }]]);
  });
});
