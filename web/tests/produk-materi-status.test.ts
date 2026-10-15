import { describe, it, expect } from "vitest";
import {
  ringkasJumlahMateri, labelMasaBerlaku, periksaMasaBerlaku, statusAkses, materiBerisi,
} from "@/lib/produk/status";
import {
  namaObjekVideoMateri, namaObjekHalamanMateri, namaObjekPdfMateri,
  namaObjekSampul, objekSampulSah, periksaBerkasSampul,
} from "@/lib/produk/objek";
import { objekPdfPembeli, prefiksPdfPembeli } from "@/lib/produk/cap-pdf";

const P = "11111111-1111-1111-1111-111111111111";
const M = "22222222-2222-2222-2222-222222222222";
const A = "33333333-3333-3333-3333-333333333333";

describe("ringkasJumlahMateri", () => {
  it("menghitung per jenis dengan label klien", () => {
    expect(ringkasJumlahMateri([...Array(11).fill("video"), "pdf"])).toBe("11 Video · 1 Artikel");
  });
  it("jenis yang nol tidak ditampilkan", () => {
    expect(ringkasJumlahMateri(["pdf", "pdf"])).toBe("2 Artikel");
    expect(ringkasJumlahMateri([])).toBe("");
  });
});

describe("masa berlaku", () => {
  it.each([
    [null, "Selamanya"], [1, "1 Bulan"], [9, "9 Bulan"], [12, "1 Tahun"], [24, "2 Tahun"], [18, "18 Bulan"],
  ])("labelMasaBerlaku(%s) = %s", (bulan, label) => {
    expect(labelMasaBerlaku(bulan)).toBe(label);
  });

  it("periksaMasaBerlaku", () => {
    expect(periksaMasaBerlaku("selamanya", "")).toEqual({ ok: true, nilai: null });
    expect(periksaMasaBerlaku("bulan", "9")).toEqual({ ok: true, nilai: 9 });
    expect(periksaMasaBerlaku("tahun", "2")).toEqual({ ok: true, nilai: 24 });
    expect(periksaMasaBerlaku("bulan", "0").ok).toBe(false);
    expect(periksaMasaBerlaku("tahun", "11").ok).toBe(false);
    expect(periksaMasaBerlaku("bulan", "1.5").ok).toBe(false);
    expect(periksaMasaBerlaku("minggu", "3").ok).toBe(false);
  });

  it("statusAkses", () => {
    const kini = new Date("2026-10-16T05:00:00Z");
    expect(statusAkses(null, kini)).toEqual({ keadaan: "selamanya" });
    expect(statusAkses("2027-07-12T05:00:00Z", kini).keadaan).toBe("aktif");
    expect(statusAkses("2026-10-16T04:59:59Z", kini).keadaan).toBe("habis");
  });
});

describe("materiBerisi", () => {
  it("video butuh berkas, PDF butuh halaman", () => {
    expect(materiBerisi("video", 1, 0)).toBe(true);
    expect(materiBerisi("video", 0, 5)).toBe(false);
    expect(materiBerisi("pdf", 1, 0)).toBe(false);
    expect(materiBerisi("pdf", 0, 3)).toBe(true);
  });
});

describe("nama objek per materi", () => {
  it("isi", () => {
    expect(namaObjekVideoMateri(P, M, "video/mp4")).toBe(`produk/${P}/${M}/isi.mp4`);
    expect(namaObjekHalamanMateri(P, M, 3)).toBe(`${P}/${M}/3.webp`);
    expect(namaObjekPdfMateri(P, M)).toBe(`${P}/${M}/isi.pdf`);
    expect(objekPdfPembeli(P, M, A)).toBe(`${P}/${M}/pembeli/${A}.pdf`);
    expect(prefiksPdfPembeli(P, M)).toBe(`${P}/${M}/pembeli`);
  });

  it("sampul unik per unggahan dan divalidasi ketat", () => {
    const produk = namaObjekSampul(P, null, "image/webp", A);
    const materi = namaObjekSampul(P, M, "image/jpeg", A);
    expect(produk).toBe(`${P}/sampul-${A}.webp`);
    expect(materi).toBe(`${P}/${M}/sampul-${A}.jpg`);
    expect(objekSampulSah(produk, P, null)).toBe(true);
    expect(objekSampulSah(materi, P, M)).toBe(true);
    expect(objekSampulSah(materi, P, null)).toBe(false);
    expect(objekSampulSah(`${P}/../x/sampul-${A}.webp`, P, null)).toBe(false);
  });

  it("periksaBerkasSampul", () => {
    expect(periksaBerkasSampul("image/png", 1000).ok).toBe(true);
    expect(periksaBerkasSampul("image/gif", 1000).ok).toBe(false);
    expect(periksaBerkasSampul("image/png", 3 * 1024 * 1024).ok).toBe(false);
  });
});
