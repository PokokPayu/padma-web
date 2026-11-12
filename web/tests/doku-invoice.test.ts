/**
 * FORMAT INVOICE DOKU — pola, pembuat, dan pengurai, plus himpunan status.
 *
 * Murni TypeScript: tidak menyentuh basis data dan tidak memanggil jaringan.
 * Dijalankan lewat `npm run test:murni -- tests/doku-invoice.test.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  POLA_INVOICE_DOKU,
  rakitInvoice,
  uraiInvoice,
} from "@/lib/pesanan/order-id";
import {
  STATUS_DOKU_ASING_DIKENAL,
  STATUS_DOKU_KEDALUWARSA,
  STATUS_DOKU_LUNAS,
  STATUS_DOKU_MENUNGGU,
  STATUS_DOKU_REFUND,
  STATUS_TIDAK_DITEMUKAN,
} from "@/lib/doku/status";

describe("invoice DOKU", () => {
  it("rakitInvoice membuang tanda hubung dan menambah satu digit percobaan", () => {
    expect(rakitInvoice("PSN-261112-A1B2C3", 3)).toBe("PSN261112A1B2C33");
  });
  it("hasilnya 16 karakter, alfanumerik saja, cocok POLA_INVOICE_DOKU", () => {
    const inv = rakitInvoice("PSN-261112-A1B2C3", 9);
    expect(inv).toHaveLength(16);
    expect(inv).toMatch(/^[A-Z0-9]+$/);
    expect(POLA_INVOICE_DOKU.test(inv)).toBe(true);
  });
  it.each([
    ["psn-261112-a1b2c3", 1],
    ["PSN-261112-A1B2C3", 0],
    ["PSN-261112-A1B2C3", 10],
  ])("rakitInvoice(%s, %s) melempar", (k, p) => {
    expect(() => rakitInvoice(k, p)).toThrow();
  });
  it("uraiInvoice kebalikan rakitInvoice", () => {
    expect(uraiInvoice("PSN261112A1B2C33")).toEqual({
      kode: "PSN-261112-A1B2C3",
      percobaan: 3,
    });
  });
  it.each([
    "PSN-261112-A1B2C3.3",
    "PSN261112A1B2C30",
    "PSN261112a1b2c33",
    "PSN261112A1B2C33X",
    "",
  ])("uraiInvoice(%s) = null", (s) => {
    expect(uraiInvoice(s)).toBeNull();
  });
  it("kelima himpunan status saling lepas", () => {
    const semua = [
      ...STATUS_DOKU_LUNAS,
      ...STATUS_DOKU_MENUNGGU,
      ...STATUS_DOKU_KEDALUWARSA,
      ...STATUS_DOKU_REFUND,
      ...STATUS_DOKU_ASING_DIKENAL,
      STATUS_TIDAK_DITEMUKAN,
    ];
    expect(new Set(semua).size).toBe(semua.length);
  });
});
