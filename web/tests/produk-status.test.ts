import { describe, it, expect } from "vitest";
import {
  periksaJudul, slugDariJudul, periksaSlug, periksaJenis,
  periksaHarga, periksaHargaCoretProduk, PESAN_PRODUK,
} from "@/lib/produk/status";

describe("periksaJudul", () => {
  it("menolak judul terlalu pendek", () => {
    expect(periksaJudul("a")).toEqual({ ok: false, pesan: PESAN_PRODUK.judulPendek });
  });
  it("memangkas spasi tepi", () => {
    expect(periksaJudul("  Panduan Menyusui  ")).toEqual({ ok: true, nilai: "Panduan Menyusui" });
  });
  it("menolak judul melebihi 120 karakter", () => {
    expect(periksaJudul("x".repeat(121)).ok).toBe(false);
  });
});

describe("slugDariJudul", () => {
  it("mengubah judul jadi alamat yang aman", () => {
    expect(slugDariJudul("Panduan Menyusui Eksklusif")).toBe("panduan-menyusui-eksklusif");
  });
  it("membuang tanda baca dan merapatkan tanda hubung beruntun", () => {
    expect(slugDariJudul("E-Book: Nifas & Pemulihan!")).toBe("e-book-nifas-pemulihan");
  });
  it("membuang tanda hubung di tepi", () => {
    expect(slugDariJudul("— Yoga Hamil —")).toBe("yoga-hamil");
  });
  it("judul tanpa satu pun huruf/angka memulangkan string kosong, bukan tanda hubung", () => {
    expect(slugDariJudul("!!!")).toBe("");
  });
});

describe("periksaSlug", () => {
  it("menolak slug kosong", () => {
    expect(periksaSlug("").ok).toBe(false);
  });
  it("menolak huruf besar dan spasi", () => {
    expect(periksaSlug("Yoga Hamil").ok).toBe(false);
  });
  it("menerima slug yang sah", () => {
    expect(periksaSlug("yoga-hamil")).toEqual({ ok: true, nilai: "yoga-hamil" });
  });
});

describe("periksaJenis", () => {
  it("menolak jenis di luar daftar putih", () => {
    expect(periksaJenis("audio").ok).toBe(false);
  });
  it("menerima pdf", () => {
    expect(periksaJenis("pdf")).toEqual({ ok: true, nilai: "pdf" });
  });
});

describe("periksaHarga", () => {
  it("menerima nol sebagai GRATIS, bukan sebagai kosong", () => {
    expect(periksaHarga("0")).toEqual({ ok: true, nilai: 0 });
  });
  it("menolak medan kosong — gratis harus diketik 0 secara sadar", () => {
    expect(periksaHarga("")).toEqual({ ok: false, pesan: PESAN_PRODUK.hargaWajib });
  });
  it("menolak angka negatif", () => {
    expect(periksaHarga("-1").ok).toBe(false);
  });
  it("menolak pecahan — rupiah PADMA selalu bulat", () => {
    expect(periksaHarga("1000.5").ok).toBe(false);
  });
  it("menolak teks bukan angka", () => {
    expect(periksaHarga("gratis").ok).toBe(false);
  });
  it("menolak angka di atas batas wajar", () => {
    expect(periksaHarga("50000001").ok).toBe(false);
  });
});

describe("periksaHargaCoretProduk", () => {
  it("medan kosong sah dan berarti tidak ada coret", () => {
    expect(periksaHargaCoretProduk("", 100_000)).toEqual({ ok: true, nilai: null });
  });
  it("menolak coret yang lebih murah dari harga jual", () => {
    expect(periksaHargaCoretProduk("50000", 100_000))
      .toEqual({ ok: false, pesan: PESAN_PRODUK.coretLebihMurah });
  });
  it("menolak coret yang SAMA dengan harga jual — badge diskon nol rupiah", () => {
    expect(periksaHargaCoretProduk("100000", 100_000).ok).toBe(false);
  });
  it("menerima coret yang lebih mahal", () => {
    expect(periksaHargaCoretProduk("150000", 100_000)).toEqual({ ok: true, nilai: 150_000 });
  });
});
