/**
 * Pagar yang menguji PAGAR.
 *
 * Kedua fungsi di bawah adalah cetakan: satu dipakai setiap uji money firewall,
 * satu dipakai pemindai token Tailwind. Cetakan yang salah menggandakan dirinya
 * diam-diam, dan pagar yang tidak pernah bisa memerah terbaca persis seperti
 * pagar yang bekerja. Karena itu keduanya diuji SEBAGAI KODE, bukan hanya
 * dipercaya lewat pemakaiannya di berkas lain.
 */
import { describe, it, expect } from "vitest";
import { nominalDalam } from "./helpers/nominal";
import { kelasPanelDi, tokenHantu } from "./helpers/token-panel";

describe("pagar nominal — tiga bentuk yang LOLOS dari /Rp\\s?\\d/", () => {
  it("nominal telanjang tanpa kata Rp", () => {
    // Persis bentuk yang dilaporkan reviewer rencana 1: label paket yang
    // memuat harga tanpa satuan.
    expect(nominalDalam("Sankalpa Prima · 3.500.000")).toContain("3.500.000");
  });

  it("Rp bertitik", () => {
    expect(nominalDalam("Rp. 500.000").length).toBeGreaterThan(0);
  });

  it("rp huruf kecil", () => {
    expect(nominalDalam("rp 500000").length).toBeGreaterThan(0);
  });
});

describe("pagar nominal — yang TIDAK boleh dituduh", () => {
  it("koordinat empat desimal (pemilih-lokasi.tsx memuatnya sungguhan)", () => {
    expect(nominalDalam("const PUSAT_AWAL = [-7.9825, 112.6304];")).toEqual([]);
  });

  it("PADMA ID, tanggal, dan ukuran kelas Tailwind", () => {
    expect(
      nominalDalam('PAD-2609-0001 · 7 Sep 2026 · class="min-w-[760px] text-[13.5px]"'),
    ).toEqual([]);
  });

  it("pecahan desimal tiga angka — ada SUNGGUHAN di repo ini", () => {
    // `opacity-[0.075]` hidup di src/app/passport/_komponen/watermark.tsx dan
    // ikut terbaca pagar money firewall halaman passport. Pola satu-kelompok
    // (`{1,}`) menuduhnya sebagai nominal dan memerahkan uji yang benar.
    expect(nominalDalam('className="opacity-[0.075]"')).toEqual([]);
    expect(nominalDalam("const ALFA = 0.016;")).toEqual([]);
    expect(nominalDalam('className="scale-[1.005]"')).toEqual([]);
  });

  it("gap yang DISENGAJA: satu kelompok tanpa 'Rp' tidak ditangkap", () => {
    // Didokumentasikan sebagai uji, bukan hanya sebagai komentar: kalau
    // seseorang kelak memperketat polanya, uji ini yang harus dihapus dengan
    // sadar — bukan gap yang diam-diam ditemukan lagi dari nol.
    expect(nominalDalam("20.000")).toEqual([]);
    // …tetapi bentuk yang benar-benar muncul di layar tetap tertangkap:
    expect(nominalDalam("Rp 20.000").length).toBeGreaterThan(0);
  });

  it("kata bernuansa uang TANPA angka", () => {
    // Regresi yang pernah terjadi: "Paket Harga Hemat" memerahkan pagar palsu.
    expect(nominalDalam("Paket Harga Hemat · tarif adalah wilayah Owner")).toEqual([]);
  });
});

const CSS_UJI = `@theme {
  --color-panel-ink: #1e2320;
  --color-panel-surface: #ffffff;
}`;

describe("pagar token panel", () => {
  it("memungut kelas dari SEMUA awalan, bukan hanya text/bg/border", () => {
    const isi = `className="ring-panel-border outline-panel-ink shadow-panel-surface"`;
    expect(kelasPanelDi(isi).sort()).toEqual([
      "outline-panel-ink",
      "ring-panel-border",
      "shadow-panel-surface",
    ]);
  });

  it("memungut kelas bermodifier opacity (border-panel-border/70)", () => {
    // `Td` di tabel.tsx memakai bentuk ini hari ini. Kelas yang berhenti
    // terpungut berarti pagar berhenti menjaganya, tanpa satu galat pun.
    expect(kelasPanelDi(`className="border-panel-border/70"`)).toEqual(["border-panel-border"]);
  });

  it("BERGIGI: token yang tidak terdefinisi dilaporkan", () => {
    // Ini persis cacat yang lahir di rencana 1 (`text-panel-accent`), dan
    // satu-satunya uji yang membuktikan pemindainya bisa memerah sama sekali.
    expect(tokenHantu(["text-panel-accent"], CSS_UJI)).toEqual(["text-panel-accent"]);
  });

  it("token yang terdefinisi TIDAK dilaporkan", () => {
    expect(tokenHantu(["text-panel-ink", "bg-panel-surface"], CSS_UJI)).toEqual([]);
  });
});
