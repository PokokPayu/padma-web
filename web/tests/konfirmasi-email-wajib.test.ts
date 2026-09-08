import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PANJANG_SANDI_MIN } from "@/lib/auth/daftar";

const config = readFileSync(path.resolve(__dirname, "..", "supabase", "config.toml"), "utf8");

/**
 * Mengiris satu seksi TOML `[nama]` sampai tepat sebelum header seksi
 * berikutnya (atau akhir berkas).
 *
 * Dibutuhkan karena `config.toml` punya DUA baris `enable_confirmations`:
 * satu di `[auth.email]` (harus `true`) dan satu di `[auth.sms]` (sengaja
 * `false` — SMS tidak dipakai PADMA). Mencocokkan `enable_confirmations`
 * tanpa mengikatnya ke seksinya bisa lolos palsu pada skenario sempit:
 * konfirmasi email dimatikan sementara konfirmasi SMS dinyalakan. Seluruh
 * guna test ini adalah menangkap setelan yang dibalik diam-diam, jadi lubang
 * sekecil apa pun di dalamnya layak ditutup.
 */
function seksi(nama: string): string {
  const awal = config.indexOf(`[${nama}]`);
  if (awal === -1) throw new Error(`seksi [${nama}] tidak ditemukan di config.toml`);
  const berikutnya = config.indexOf("\n[", awal + 1);
  return config.slice(awal, berikutnya === -1 ? config.length : berikutnya);
}

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
  it("konfirmasi email WAJIB menyala, di seksi [auth.email]", () => {
    expect(seksi("auth.email")).toMatch(/^enable_confirmations = true$/m);
  });

  it("panjang sandi minimum di config tidak lebih longgar daripada validator", () => {
    const cocok = config.match(/^minimum_password_length = (\d+)$/m);
    expect(cocok).not.toBeNull();
    expect(Number(cocok![1])).toBeGreaterThanOrEqual(PANJANG_SANDI_MIN);
  });
});
