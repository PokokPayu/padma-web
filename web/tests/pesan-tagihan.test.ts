import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pesanTagihan, tautanWaTagihan } from "@/lib/tagihan/pesan-tagihan";
import { NOMOR_WA_BAWAAN, nomorWaKlien } from "@/lib/pengaturan/bentuk";

const CONTOH = {
  namaKlien: "Ananda",
  namaLayanan: "Garbha Relief",
  tanggal: "20 Mei 2027",
  jam: "09.00 WIB",
  tautanPassport: "https://padma.test/passport/bayar/11111111-1111-1111-1111-111111111111",
  sisaWaktu: "24 jam lagi",
};

describe("pesan tagihan memuat unsur wajib, TANPA angka (D3)", () => {
  it("nama, layanan, kapan, tautan Passport, dan sampai kapan", () => {
    // Pesan tagihan tanpa batas waktu adalah pesan yang membuat orang
    // kehilangan slotnya tanpa pernah tahu ada tenggatnya.
    const p = pesanTagihan(CONTOH);
    expect(p).toContain("Ananda");
    expect(p).toContain("Garbha Relief");
    expect(p).toContain("20 Mei 2027");
    expect(p).toContain("09.00 WIB");
    expect(p).toContain("24 jam lagi");
    expect(p).toContain(
      "Tagihan Anda sudah terbit. Bayar di Digital Passport: " + CONTOH.tautanPassport,
    );
  });

  it("keluarannya tidak cocok /rp|\\d{1,3}(\\.\\d{3})+/i dan tanpa QRIS", () => {
    const p = pesanTagihan(CONTOH);
    expect(p).not.toMatch(/rp|\d{1,3}(\.\d{3})+/i);
    expect(p).not.toMatch(/qris|unggah|transfer/i);
  });

  it("menyebut apa yang terjadi bila lewat, dan bahwa itu bukan akhir", () => {
    const p = pesanTagihan(CONTOH);
    expect(p).toMatch(/lepas untuk klien lain/);
    expect(p).toMatch(/mengajukan ulang/);
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

describe("nomor tujuan tagihan adalah nomor KLIEN", () => {
  it("mengembalikan bentuk internasional dari nomor lokal klien", () => {
    expect(nomorWaKlien("0877-7840-0201")).toBe("6287778400201");
    expect(nomorWaKlien("6287778400201")).toBe("6287778400201");
  });

  it("mengembalikan KOSONG — bukan nomor cadangan — untuk nomor yang tidak sah", () => {
    // Pembeda pokok dari `nomorWaTerpakai`, dan alasannya adalah cacat yang
    // memunculkan uji ini: cadangan di sini berarti tagihan seorang klien
    // terbuka sebagai percakapan ke nomor PADMA sendiri. Admin yang tidak
    // memperhatikan mengirimkan rincian jadwal & nominal klien ke dirinya
    // sendiri, dan kliennya tidak pernah ditagih sama sekali — tenggat 24 jam
    // tetap berjalan. Lebih baik tombolnya hilang daripada menunjuk salah orang.
    for (const buruk of ["", "abc", "123", null, undefined]) {
      expect(nomorWaKlien(buruk)).toBe("");
    }
    expect(nomorWaKlien("")).not.toBe(NOMOR_WA_BAWAAN);
  });
});

describe("antrean admin tidak boleh menagih ke nomor klinik", () => {
  it("`page.tsx` tidak mengoper setelan `nomor_wa` ke tautan tagihan", () => {
    // Penjagaan BENTUK SUMBER, sepola tests/tagihan-baca-hak.test.ts: uji murni
    // atas `tautanWaTagihan` tidak bisa melihat cacat ini sama sekali, karena
    // fungsinya memang benar — yang salah nomor yang disodorkan pemanggilnya.
    const sumber = readFileSync(
      path.resolve(__dirname, "..", "src/app/admin/sesi/page.tsx"),
      "utf8",
    );
    expect(sumber).not.toMatch(/tautanWaTagihan\(\s*nomorWaLink/);
    // Nomor klien harus benar-benar ikut terbaca. Baris permintaan yang dipakai
    // panel Lihat kini datang dari `ambilDaftarPermintaan()`
    // (`@/lib/admin/permintaan`), bukan dari `page.tsx` sendiri — jadi
    // kolomnya diperiksa di sumber query itu; tanpa kolomnya, tautannya hanya
    // bisa benar secara kebetulan.
    const sumberPermintaan = readFileSync(
      path.resolve(__dirname, "..", "src/lib/admin/permintaan.ts"),
      "utf8",
    );
    expect(sumberPermintaan).toMatch(/clients!inner\s*\(\s*nama,\s*padma_id,\s*no_hp\s*\)/);
  });
});
