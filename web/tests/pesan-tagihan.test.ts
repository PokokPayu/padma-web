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
  hargaLayanan: "Rp 174.000",
  hargaTransport: "Rp 20.000",
  labelJenjang: ">10–15 km",
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
