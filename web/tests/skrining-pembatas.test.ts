import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  kunciPembatas,
  terlaluSering,
  resetPembatas,
  MAKS_PER_JENDELA,
  MAKS_GLOBAL_PER_JENDELA,
} from "@/lib/skrining/pembatas";

/**
 * Temuan red team #1: kunci rate limit dibaca langsung dari
 * `request.headers.get("x-forwarded-for")` — header yang SEPENUHNYA dikendalikan
 * klien. Memutar nilainya (10.0.0.1, 10.0.0.2, ...) melewati batas 5/60 detik
 * secara total: 12 permintaan -> 12x HTTP 201, 0x 429.
 *
 * Aturan yang ditegakkan berkas ini:
 *   1. hop yang dipakai adalah hop TERLUAR yang ditulis proxy tepercaya kita
 *      (paling kanan), bukan nilai paling kiri kiriman klien — klien hanya bisa
 *      MENAMBAH entri di kiri, tidak bisa menghapus hop yang ditulis proxy;
 *   2. bila tidak ada proxy tepercaya (PADMA_PROXY_TEPERCAYA=0), X-Forwarded-For
 *      diabaikan total — tidak ada alasan mempercayainya;
 *   3. ada pagar GLOBAL lintas-IP, jadi bahkan penyerang dengan banyak IP nyata
 *      (atau konfigurasi proxy yang salah) tetap terbentur langit-langit.
 */

const asliProxy = process.env.PADMA_PROXY_TEPERCAYA;

function permintaan(headers: Record<string, string>) {
  return new Request("http://localhost/api/skrining", { method: "POST", headers });
}

beforeEach(() => {
  resetPembatas();
  delete process.env.PADMA_PROXY_TEPERCAYA; // default: 1 proxy tepercaya
});

afterEach(() => {
  if (asliProxy === undefined) delete process.env.PADMA_PROXY_TEPERCAYA;
  else process.env.PADMA_PROXY_TEPERCAYA = asliProxy;
});

describe("kunciPembatas — X-Forwarded-For tidak dipercaya mentah-mentah", () => {
  it("memakai hop terluar yang ditulis proxy, bukan nilai kiriman klien", () => {
    const kunci = kunciPembatas(
      permintaan({ "x-forwarded-for": "10.0.0.1, 198.51.100.77" }),
    );
    expect(kunci).toBe("198.51.100.77");
    expect(kunci).not.toBe("10.0.0.1");
  });

  it("XFF yang diputar klien tetap jatuh ke SATU kunci yang sama", () => {
    const kunci = new Set<string>();
    for (let i = 0; i < 12; i++) {
      kunci.add(kunciPembatas(permintaan({ "x-forwarded-for": `10.0.0.${i}, 198.51.100.77` })));
    }
    expect([...kunci]).toEqual(["198.51.100.77"]);
  });

  it("klien yang mengirim banyak hop palsu tidak bisa menggeser hop proxy", () => {
    const kunci = kunciPembatas(
      permintaan({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3, 198.51.100.77" }),
    );
    expect(kunci).toBe("198.51.100.77");
  });

  it("tanpa proxy tepercaya, X-Forwarded-For diabaikan TOTAL", () => {
    process.env.PADMA_PROXY_TEPERCAYA = "0";
    const kunci = new Set<string>();
    for (let i = 0; i < 12; i++) {
      kunci.add(kunciPembatas(permintaan({ "x-forwarded-for": `10.0.0.${i}` })));
    }
    expect(kunci.size).toBe(1);
    expect([...kunci][0]).not.toContain("10.0.0.");
  });

  it("dua proxy tepercaya: hop yang diambil bergeser satu ke kiri", () => {
    process.env.PADMA_PROXY_TEPERCAYA = "2";
    const kunci = kunciPembatas(
      permintaan({ "x-forwarded-for": "10.0.0.1, 198.51.100.77, 172.16.0.1" }),
    );
    expect(kunci).toBe("198.51.100.77");
  });

  it("XFF kosong/absen tidak menghasilkan kunci undefined", () => {
    expect(kunciPembatas(permintaan({}))).toBeTruthy();
    expect(kunciPembatas(permintaan({ "x-forwarded-for": "" }))).toBeTruthy();
    expect(kunciPembatas(permintaan({ "x-forwarded-for": " , , " }))).toBeTruthy();
  });
});

describe("terlaluSering — dua lapis: per-kunci dan global", () => {
  it("menahan banjir dari satu kunci pada batas per-jendela", () => {
    const hasil: boolean[] = [];
    for (let i = 0; i < MAKS_PER_JENDELA + 1; i++) hasil.push(terlaluSering("198.51.100.77"));
    expect(hasil.slice(0, MAKS_PER_JENDELA)).toEqual(Array(MAKS_PER_JENDELA).fill(false));
    expect(hasil[MAKS_PER_JENDELA]).toBe(true);
  });

  it("kunci lain tidak ikut kena getahnya", () => {
    for (let i = 0; i < MAKS_PER_JENDELA + 3; i++) terlaluSering("198.51.100.77");
    expect(terlaluSering("198.51.100.88")).toBe(false);
  });

  it("PAGAR GLOBAL: memutar kunci sekalipun tetap terbentur langit-langit", () => {
    let ditolak = 0;
    for (let i = 0; i < MAKS_GLOBAL_PER_JENDELA + 10; i++) {
      if (terlaluSering(`kunci-unik-${i}`)) ditolak++;
    }
    expect(ditolak).toBeGreaterThanOrEqual(10);
    // Yang lolos tidak boleh lebih dari langit-langit global.
    expect(MAKS_GLOBAL_PER_JENDELA + 10 - ditolak).toBeLessThanOrEqual(MAKS_GLOBAL_PER_JENDELA);
  });

  it("MAKS_GLOBAL_PER_JENDELA nyata membatasi (bukan angka raksasa yang tak berguna)", () => {
    expect(MAKS_GLOBAL_PER_JENDELA).toBeLessThanOrEqual(120);
    expect(MAKS_GLOBAL_PER_JENDELA).toBeGreaterThanOrEqual(MAKS_PER_JENDELA);
  });
});
