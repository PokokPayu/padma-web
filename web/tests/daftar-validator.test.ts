import { describe, it, expect } from "vitest";
import { periksaPendaftaran, PANJANG_SANDI_MIN } from "@/lib/auth/daftar";

const sah = { nama: "Ananda Putri", email: "Ananda@Email.com ", noHp: "0812-3456-7890", sandi: "rahasia123" };

describe("validator pendaftaran", () => {
  it("menormalkan email menjadi huruf kecil tanpa spasi", () => {
    const h = periksaPendaftaran(sah);
    expect(h.ok && h.nilai.email).toBe("ananda@email.com");
  });

  it("menolak sandi lebih pendek dari batas", () => {
    const h = periksaPendaftaran({ ...sah, sandi: "a".repeat(PANJANG_SANDI_MIN - 1) });
    expect(h.ok).toBe(false);
  });

  it("menolak nama kosong", () => {
    expect(periksaPendaftaran({ ...sah, nama: "   " }).ok).toBe(false);
  });

  it("membatasi panjang nama supaya metadata tidak jadi tempat menitipkan teks", () => {
    expect(periksaPendaftaran({ ...sah, nama: "x".repeat(300) }).ok).toBe(false);
  });

  it("menolak email tanpa bentuk alamat", () => {
    expect(periksaPendaftaran({ ...sah, email: "bukan-email" }).ok).toBe(false);
  });

  it("TIDAK meminta fase — fase datang dari skrining, bukan dari pendaftaran", () => {
    expect(periksaPendaftaran(sah).ok).toBe(true);
  });
});
