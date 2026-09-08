/**
 * Saring & paginasi rekap honor — sebagai ARITMATIKA, bukan render.
 *
 * Satu aturan di berkas ini menyangkut uang, bukan tata letak: sebuah pekan
 * hanya "tuntas" bila SETIAP mitra di dalamnya sudah ditandai dibayar. Pekan
 * tanpa mitra sama sekali TIDAK tuntas — ia kosong, dan menyebut kekosongan
 * sebagai keberesan akan menyembunyikan pekan yang honornya belum sempat
 * dihitung.
 */
import { describe, it, expect } from "vitest";
import type { BarisMitra, RekapPekan } from "@/lib/owner/rekap";
import { pekanTuntas, saringRekap, SARING_REKAP, PER_HAL_REKAP } from "@/lib/owner/daftar-rekap";
import { uraikanParamDaftar } from "@/app/_shell/panel/daftar";

function mitra(nama: string, sudahDibayar: boolean): BarisMitra {
  return {
    partnerId: `p-${nama}`,
    nama,
    jumlahSesi: 1,
    jumlahTakBertarif: 0,
    totalHonor: 100_000,
    sudahDibayar,
    dibayarPada: sudahDibayar ? "2026-01-10T00:00:00.000Z" : null,
    adaSesiSesudahDitandai: false,
  };
}

function pekan(senin: string, perMitra: BarisMitra[]): RekapPekan {
  return {
    senin,
    rentang: senin,
    jumlahSesi: perMitra.length,
    perMitra,
    totalHonor: 0,
    totalHarga: 0,
    margin: 0,
    sesiTakBertarif: [],
  };
}

const TUNTAS = pekan("2026-01-05", [mitra("Bidan Ayu", true), mitra("Bidan Sari", true)]);
const SEBAGIAN = pekan("2026-01-12", [mitra("Bidan Ayu", true), mitra("Bidan Sari", false)]);
const KOSONG = pekan("2026-01-19", []);
const REKAP = [KOSONG, SEBAGIAN, TUNTAS];

const param = (sp: Record<string, string>) => uraikanParamDaftar(sp, SARING_REKAP);

describe("pekanTuntas", () => {
  it("tuntas hanya bila SETIAP mitra sudah ditandai dibayar", () => {
    expect(pekanTuntas(TUNTAS)).toBe(true);
    expect(pekanTuntas(SEBAGIAN)).toBe(false);
  });

  it("pekan tanpa mitra TIDAK tuntas — kosong bukan beres", () => {
    expect(pekanTuntas(KOSONG)).toBe(false);
  });
});

describe("saringRekap", () => {
  it("tanpa parameter memulangkan seluruh pekan dalam urutan aslinya", () => {
    const { baris, total } = saringRekap(REKAP, param({}));
    expect(baris.map((p) => p.senin)).toEqual(["2026-01-19", "2026-01-12", "2026-01-05"]);
    expect(total).toBe(3);
  });

  it("honor=belum menyisakan pekan yang masih punya honor belum ditandai", () => {
    const { baris, total } = saringRekap(REKAP, param({ honor: "belum" }));
    expect(baris.map((p) => p.senin)).toEqual(["2026-01-19", "2026-01-12"]);
    expect(total).toBe(2);
  });

  it("honor=tuntas menyisakan pekan yang seluruh honornya sudah ditandai", () => {
    expect(saringRekap(REKAP, param({ honor: "tuntas" })).baris.map((p) => p.senin)).toEqual([
      "2026-01-05",
    ]);
  });

  it("cari mencocokkan nama mitra, dan menyisakan KARTU pekannya UTUH", () => {
    const { baris } = saringRekap(REKAP, param({ cari: "sari" }));
    expect(baris.map((p) => p.senin)).toEqual(["2026-01-12", "2026-01-05"]);
    // Kartunya tidak dipangkas: margin dan total pekan dihitung atas SELURUH
    // mitra, jadi kartu yang isinya disaring akan menampilkan angka yang tidak
    // cocok dengan baris yang terlihat.
    expect(baris[0].perMitra).toHaveLength(2);
  });

  it("memotong 8 kartu per halaman, bukan 25", () => {
    expect(PER_HAL_REKAP).toBe(8);
    const banyak = Array.from({ length: 20 }, (_, i) =>
      pekan(`2026-02-${String(i + 1).padStart(2, "0")}`, [mitra("Bidan Ayu", false)]),
    );
    const h1 = saringRekap(banyak, param({}));
    expect(h1.baris).toHaveLength(8);
    expect(h1.total).toBe(20);
    const h3 = saringRekap(banyak, param({ hal: "3" }));
    expect(h3.baris).toHaveLength(4);
  });

  it("halaman di luar jangkauan memulangkan daftar kosong, bukan melempar", () => {
    expect(saringRekap(REKAP, param({ hal: "9" })).baris).toEqual([]);
  });
});
