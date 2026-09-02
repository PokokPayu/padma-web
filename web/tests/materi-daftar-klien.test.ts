// tests/materi-daftar-klien.test.ts
import { describe, it, expect } from "vitest";
import { saringDaftarMateri } from "@/lib/passport/materi-tampil";

describe("aturan tampilan daftar materi klien (M10)", () => {
  const dasar = { id: "m", judul: "J", tipe: "ebook" as const, deskripsi: "", namaLayanan: "", jumlahHalaman: 0 };

  it("materi berlayanan tetap tampil walau terkunci — penggodanya masih benar", () => {
    const hasil = saringDaftarMateri([{ ...dasar, punyaLayanan: true, terbuka: false }]);
    expect(hasil).toHaveLength(1);
  });

  it("materi TANPA layanan dan tidak terbuka DISEMBUNYIKAN", () => {
    // "Terbuka setelah layanan terkait selesai" adalah kalimat bohong untuk
    // materi yang tidak punya layanan terkait sama sekali.
    const hasil = saringDaftarMateri([{ ...dasar, punyaLayanan: false, terbuka: false }]);
    expect(hasil).toHaveLength(0);
  });

  it("materi tanpa layanan TAPI sudah di-assign tetap tampil", () => {
    const hasil = saringDaftarMateri([{ ...dasar, punyaLayanan: false, terbuka: true }]);
    expect(hasil).toHaveLength(1);
  });
});
