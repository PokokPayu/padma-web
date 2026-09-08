/**
 * Cari, saring, dan paginasi rate card — sebagai ARITMATIKA, bukan render.
 *
 * Berkas ini sengaja tidak menyentuh basis data dan tidak merender satu pun
 * komponen: `saringRateCard()` adalah fungsi murni, dan bentuk itulah yang
 * membuat aturan "varian belum bertarif adalah PEKERJAAN, bukan kabar" bisa
 * diuji tanpa satu baris JavaScript klien.
 */
import { describe, it, expect } from "vitest";
import type { BarisRateCard } from "@/lib/owner/data";
import { saringRateCard, SARING_TARIF } from "@/lib/owner/daftar-tarif";
import { uraikanParamDaftar } from "@/app/_shell/panel/daftar";

function varian(n: Partial<BarisRateCard> & { variantId: string }): BarisRateCard {
  return {
    serviceId: "svc",
    namaLayanan: "Pijat Nifas",
    labelVarian: "",
    namaFase: "Nifas",
    aktif: true,
    berlaku: null,
    riwayat: [],
    ...n,
  };
}

const TARIF_BERLAKU = {
  id: "r1",
  hargaKlien: 150_000,
  hargaCoret: null,
  honorMitra: 90_000,
  margin: 60_000,
  berlakuSejak: "2026-01-01",
  berlakuSekarang: true,
  belumBerlaku: false,
};

const KARTU: BarisRateCard[] = [
  varian({ variantId: "a", namaLayanan: "Pijat Nifas", labelVarian: "60 menit", berlaku: TARIF_BERLAKU }),
  varian({ variantId: "b", namaLayanan: "Pijat Nifas", labelVarian: "90 menit" }),
  varian({ variantId: "c", namaLayanan: "Senam Hamil", labelVarian: "", aktif: false, berlaku: TARIF_BERLAKU }),
];

const param = (sp: Record<string, string>) => uraikanParamDaftar(sp, SARING_TARIF);

describe("saringRateCard", () => {
  it("tanpa parameter memulangkan seluruh baris apa adanya", () => {
    const { baris, total } = saringRateCard(KARTU, param({}));
    expect(baris.map((b) => b.variantId)).toEqual(["a", "b", "c"]);
    expect(total).toBe(3);
  });

  it("cari mencocokkan nama layanan MAUPUN label varian, tanpa peduli huruf besar-kecil", () => {
    expect(saringRateCard(KARTU, param({ cari: "senam" })).baris.map((b) => b.variantId)).toEqual(["c"]);
    expect(saringRateCard(KARTU, param({ cari: "90 MENIT" })).baris.map((b) => b.variantId)).toEqual(["b"]);
  });

  it("saring tarif=belum hanya menyisakan varian tanpa tarif berlaku", () => {
    const { baris, total } = saringRateCard(KARTU, param({ tarif: "belum" }));
    expect(baris.map((b) => b.variantId)).toEqual(["b"]);
    // `total` adalah jumlah yang COCOK, bukan jumlah seluruh rate card —
    // bilah daftar menampilkan "menampilkan N dari TOTAL", dan total yang
    // salah membuat owner mengira ada baris yang hilang.
    expect(total).toBe(1);
  });

  it("saring aktif=tidak menyisakan varian layanan yang sudah tidak ditawarkan", () => {
    expect(saringRateCard(KARTU, param({ aktif: "tidak" })).baris.map((b) => b.variantId)).toEqual(["c"]);
  });

  it("cari dan saring berlaku BERSAMAAN, bukan saling menggantikan", () => {
    const { baris } = saringRateCard(KARTU, param({ cari: "pijat", tarif: "belum" }));
    expect(baris.map((b) => b.variantId)).toEqual(["b"]);
  });

  it("nilai saringan asing dibuang, bukan diteruskan sebagai penyaring", () => {
    // Daftar putih `uraikanParamDaftar` yang membuangnya. Nilai asing yang
    // lolos memulangkan nol baris, dan nol baris tidak bisa dibedakan dari
    // "memang belum ada datanya".
    expect(saringRateCard(KARTU, param({ tarif: "entah" })).total).toBe(3);
  });

  it("memotong menurut halaman, dan total tetap jumlah yang COCOK", () => {
    const banyak = Array.from({ length: 30 }, (_, i) =>
      varian({ variantId: `v${i}`, labelVarian: `${i} menit` }),
    );
    const h1 = saringRateCard(banyak, param({}));
    expect(h1.baris).toHaveLength(25);
    expect(h1.total).toBe(30);
    const h2 = saringRateCard(banyak, param({ hal: "2" }));
    expect(h2.baris).toHaveLength(5);
    expect(h2.total).toBe(30);
  });

  it("halaman di luar jangkauan memulangkan daftar kosong, bukan melempar", () => {
    expect(saringRateCard(KARTU, param({ hal: "9" })).baris).toEqual([]);
  });

  it("urutan asli ambilRateCard dipertahankan — fase, lalu aktif, lalu abjad", () => {
    // Urutan itu ditetapkan `ambilRateCard()` dan berarti sesuatu bagi
    // pembacanya (urutan perjalanan klien). Menyaring tidak boleh mengacaknya.
    const { baris } = saringRateCard(KARTU, param({ cari: "" }));
    expect(baris).toEqual(KARTU);
  });
});
