import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PANJANG_SANDI_MIN } from "@/lib/auth/daftar";

const config = readFileSync(path.resolve(__dirname, "..", "supabase", "config.toml"), "utf8");

/**
 * PAGAR FAIL-CLOSED atas setelan yang MENOPANG keputusan K1.
 *
 * Penautan lewat email terverifikasi sah HANYA KARENA konfirmasi email
 * menyala. Setelan yang menopang keputusan keamanan tetapi tidak dijaga test
 * adalah setelan yang suatu hari dimatikan "sebentar, untuk mempermudah
 * pengujian" lalu tidak pernah dinyalakan lagi — dan tidak ada satu pun test
 * yang memberi tahu.
 *
 * Test ini murni membaca berkas `config.toml` — tanpa DB, tanpa GoTrue.
 */
describe("setelan yang menopang keamanan penautan", () => {
  it("konfirmasi email WAJIB menyala", () => {
    expect(config).toMatch(/^enable_confirmations = true$/m);
  });

  it("panjang sandi minimum di config tidak lebih longgar daripada validator", () => {
    const cocok = config.match(/^minimum_password_length = (\d+)$/m);
    expect(cocok).not.toBeNull();
    expect(Number(cocok![1])).toBeGreaterThanOrEqual(PANJANG_SANDI_MIN);
  });
});
