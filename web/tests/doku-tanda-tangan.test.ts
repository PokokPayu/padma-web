import { describe, it, expect } from "vitest";
import {
  hitungDigest,
  rakitKomponenTandaTangan,
  hitungTandaTangan,
  tandaTanganCocok,
  hitungSidikDoku,
} from "@/lib/doku/tanda-tangan";

/**
 * Nilai emas dihitung dengan `openssl` di luar Node, BUKAN dengan fungsi yang
 * diuji, lalu ditempel sebagai literal:
 *   printf '%s' "$B" | openssl dgst -sha256 -binary | base64
 *   printf '%s' "$K" | openssl dgst -sha256 -hmac 'kunci-uji-doku' -binary | base64
 * Vektor resmi S10 tidak tersedia luring; ini vektor buatan sendiri.
 */
const BADAN = '{"order":{"invoice_number":"PSN261112A1B2C31","amount":150000}}';
const DIGEST_EMAS = "l59hYu6On9r8vWtzIc3fMgRt7iAe7eGpLKB4GJAggD4=";
const TTD_EMAS = "yWZ6KE9BlOt6FM4944IEFoDqa+62vy+lWptt3CXuL0w=";
const TTD_GET_EMAS = "tDlnuzVGumM+YpUfd6c2aiElM590bqwxFFSqg2pfFHo=";
const KOMPONEN =
  "Client-Id:klien-uji-doku\n" +
  "Request-Id:req-uji-1\n" +
  "Request-Timestamp:2026-11-13T01:02:03Z\n" +
  "Request-Target:/api/pembayaran/doku\n" +
  `Digest:${DIGEST_EMAS}`;
const DASAR = {
  clientId: "klien-uji-doku",
  requestId: "req-uji-1",
  requestTimestamp: "2026-11-13T01:02:03Z",
  requestTarget: "/api/pembayaran/doku",
  digest: DIGEST_EMAS,
};

describe("hitungDigest", () => {
  it("cocok dengan nilai emas openssl", () => {
    expect(hitungDigest(BADAN)).toBe(DIGEST_EMAS);
  });
});

describe("rakitKomponenTandaTangan", () => {
  it("merakit lima baris persis, tanpa baris baru di akhir", () => {
    const k = rakitKomponenTandaTangan(DASAR);
    expect(k).toBe(KOMPONEN);
    expect(k.endsWith("\n")).toBe(false);
  });

  it("digest null (GET) menghilangkan baris Digest", () => {
    const k = rakitKomponenTandaTangan({
      ...DASAR,
      requestId: "req-uji-2",
      requestTarget: "/orders/v1/status/PSN261112A1B2C31",
      digest: null,
    });
    expect(k).not.toContain("Digest:");
    expect(k.endsWith("\n")).toBe(false);
    expect(hitungTandaTangan(k, "kunci-uji-doku")).toBe("HMACSHA256=" + TTD_GET_EMAS);
  });
});

describe("hitungTandaTangan", () => {
  it("cocok dengan nilai emas openssl dan berawalan HMACSHA256=", () => {
    expect(hitungTandaTangan(KOMPONEN, "kunci-uji-doku")).toBe("HMACSHA256=" + TTD_EMAS);
  });

  it("komponen berakhiran baris baru menghasilkan tanda tangan lain", () => {
    expect(hitungTandaTangan(KOMPONEN + "\n", "kunci-uji-doku")).not.toBe(
      "HMACSHA256=" + TTD_EMAS,
    );
  });
});

describe("tandaTanganCocok", () => {
  const benar = "HMACSHA256=" + TTD_EMAS;

  it("true untuk yang identik", () => {
    expect(tandaTanganCocok(benar, benar)).toBe(true);
  });

  it.each([
    ["string pendek", "HMACSHA256=abc"],
    ["tanpa awalan", TTD_EMAS],
    ["kosong", ""],
    ["sama panjang, beda satu karakter", benar.slice(0, -2) + (benar.at(-2) === "A" ? "B" : "A") + benar.at(-1)],
  ])("false tanpa melempar: %s", (_nama, dikirim) => {
    expect(() => tandaTanganCocok(dikirim, benar)).not.toThrow();
    expect(tandaTanganCocok(dikirim, benar)).toBe(false);
  });
});

describe("hitungSidikDoku", () => {
  const dasar = { sumber: "webhook" as const, invoice: "PSN261112A1B2C31", status: "SUCCESS", pembeda: "x" };

  it("masukan identik, sidik identik", () => {
    expect(hitungSidikDoku({ ...dasar })).toBe(hitungSidikDoku({ ...dasar }));
  });
  it("status beda, sidik beda", () => {
    expect(hitungSidikDoku(dasar)).not.toBe(hitungSidikDoku({ ...dasar, status: "FAILED" }));
  });
  it("webhook vs status_api, sidik beda", () => {
    expect(hitungSidikDoku(dasar)).not.toBe(hitungSidikDoku({ ...dasar, sumber: "status_api" }));
  });
  it("batas medan tetangga tidak bisa bergeser", () => {
    const a = hitungSidikDoku({ ...dasar, status: "a|b", pembeda: "c" });
    const b = hitungSidikDoku({ ...dasar, status: "a", pembeda: "b|c" });
    expect(a).not.toBe(b);
  });
  it("heksa sha256 64 karakter", () => {
    expect(hitungSidikDoku(dasar)).toMatch(/^[0-9a-f]{64}$/);
  });
});
