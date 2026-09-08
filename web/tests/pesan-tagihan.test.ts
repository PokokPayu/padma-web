import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pesanTagihan, tautanWaTagihan } from "@/lib/tagihan/pesan-tagihan";

const CONTOH = {
  namaKlien: "Ananda",
  namaLayanan: "Garbha Relief",
  tanggal: "20 Mei 2027",
  jam: "09.00 WIB",
  total: "Rp194.000",
  sisaWaktu: "24 jam lagi",
};

describe("pesan tagihan memuat LIMA unsur wajib", () => {
  it("nama, layanan, kapan, berapa, dan sampai kapan", () => {
    // Pesan tagihan tanpa batas waktu adalah pesan yang membuat orang
    // kehilangan slotnya tanpa pernah tahu ada tenggatnya.
    const p = pesanTagihan(CONTOH);
    expect(p).toContain("Ananda");
    expect(p).toContain("Garbha Relief");
    expect(p).toContain("20 Mei 2027");
    expect(p).toContain("09.00 WIB");
    expect(p).toContain("Rp194.000");
    expect(p).toContain("24 jam lagi");
  });

  it("menyebut apa yang terjadi bila lewat, dan bahwa itu bukan akhir", () => {
    const p = pesanTagihan(CONTOH);
    expect(p).toMatch(/lepas untuk klien lain/);
    expect(p).toMatch(/mengajukan ulang/);
  });

  it("total yang belum lengkap dikatakan apa adanya, bukan Rp0", () => {
    const p = pesanTagihan({ ...CONTOH, total: null });
    expect(p).toContain("menyusul dari tim");
    expect(p).not.toContain("Rp0");
  });

  it("menyebutkan bahwa nominal QRIS diketik sendiri", () => {
    // QRIS PADMA statis: ia tidak membawa nominal. Klien yang tidak tahu itu
    // akan memindai lalu bingung mencari angkanya.
    expect(pesanTagihan(CONTOH)).toMatch(/diketik sendiri/);
  });
});

describe("tautan WhatsApp", () => {
  it("mengencode pesannya, bukan menempelkan mentah", () => {
    const t = tautanWaTagihan("6287778400200", pesanTagihan(CONTOH));
    expect(t.startsWith("https://wa.me/6287778400200?text=")).toBe(true);
    expect(t).not.toContain("\n");
  });
});

describe("berkas pesan tetap MURNI", () => {
  it("tidak mengimpor apa pun", () => {
    // Kartu antrean admin adalah komponen "use client". Satu impor bermodul
    // Supabase di sini akan menyeret klien service role ke bundel peramban —
    // kelas cacat yang sudah menjatuhkan Tahap B.
    const sumber = readFileSync(
      path.resolve(__dirname, "..", "src/lib/tagihan/pesan-tagihan.ts"),
      "utf8",
    );
    expect(sumber).not.toMatch(/^import /m);
  });
});
