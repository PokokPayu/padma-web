/**
 * Render ketiga permukaan P4.
 *
 * Suite ini berjalan `environment: "node"` tanpa jsdom, jadi perkakasnya
 * `renderToStaticMarkup` — sama dengan seluruh uji panel lain.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KartuBulan } from "@/app/owner/penjualan/kartu-bulan";
import { PeringatanData } from "@/app/owner/penjualan/peringatan-data";
import type { PenjualanBulan } from "@/lib/penjualan/hitung";

const BULAN_DASAR: PenjualanBulan = {
  bulan: "2026-10",
  omzet: 450_000,
  jumlahPembelian: 3,
  perProduk: [
    { kunci: "a", judul: "Kelas Menyusui", banyak: 2, nilai: 300_000 },
    { kunci: "b", judul: "Panduan MPASI", banyak: 1, nilai: 150_000 },
  ],
  pengecualian: [],
};

describe("KartuBulan", () => {
  it("membawa data-bulan supaya angkanya tidak tertukar antar kartu", () => {
    // Seluruh nominal di halaman ini tampak serupa. Tanpa penanda, sebuah
    // assertion (atau seorang pembaca) bisa membaca angka bulan lain sebagai
    // angka bulan yang sedang dilihatnya. Pola `data-pekan` di /owner/rekap
    // ada persis karena alasan ini.
    const m = renderToStaticMarkup(<KartuBulan bulan={BULAN_DASAR} />);
    expect(m).toContain('data-bulan="2026-10"');
  });

  it("menampilkan omzet dan jumlah pembelian", () => {
    const m = renderToStaticMarkup(<KartuBulan bulan={BULAN_DASAR} />);
    expect(m).toContain("Oktober 2026");
    expect(m).toContain("450.000");
    expect(m).toContain("3 pembelian");
  });

  it("merinci per produk", () => {
    const m = renderToStaticMarkup(<KartuBulan bulan={BULAN_DASAR} />);
    expect(m).toContain("Kelas Menyusui");
    expect(m).toContain("Panduan MPASI");
  });

  it("TANPA pengecualian, kotak pengecualian tidak dirender sama sekali", () => {
    const m = renderToStaticMarkup(<KartuBulan bulan={BULAN_DASAR} />);
    expect(m).not.toContain("data-pengecualian");
  });

  it("nilai pengecualian dirender TERPISAH, tidak terjumlah ke omzet", () => {
    // Inilah keputusan yang dibeli seluruh desain ini: tidak ada pengurangan
    // dan tidak ada penjumlahan diam-diam. Nominal refund tidak pernah
    // disimpan, jadi menjumlah atau mengurangkannya berarti mengarang angka.
    const m = renderToStaticMarkup(
      <KartuBulan
        bulan={{
          ...BULAN_DASAR,
          pengecualian: [
            { golongan: "ditahan", banyak: 1, nilai: 150_000 },
            { golongan: "lewat_tenggat", banyak: 2, nilai: 220_000 },
          ],
        }}
      />,
    );
    // Omzetnya TIDAK berubah oleh kehadiran pengecualian.
    expect(m).toContain("450.000");
    expect(m).toContain("data-pengecualian");
    expect(m).toContain("150.000");
    expect(m).toContain("220.000");
    // Dan tidak ada satu pun angka gabungan yang muncul.
    expect(m).not.toContain("820.000");
  });

  it("mengarahkan ke /admin/pesanan, tempat perkaranya diselesaikan", () => {
    const m = renderToStaticMarkup(
      <KartuBulan
        bulan={{
          ...BULAN_DASAR,
          pengecualian: [{ golongan: "ditahan", banyak: 1, nilai: 150_000 }],
        }}
      />,
    );
    expect(m).toContain("/admin/pesanan");
  });

  it("bulan tanpa penjualan tetap dirender, bukan dilompati", () => {
    const m = renderToStaticMarkup(
      <KartuBulan
        bulan={{ bulan: "2026-07", omzet: 0, jumlahPembelian: 0, perProduk: [], pengecualian: [] }}
      />,
    );
    expect(m).toContain('data-bulan="2026-07"');
    expect(m).toContain("Juli 2026");
  });

  it("bulan kosong (omzet 0, tanpa produk) tetap tampak: penanda dan labelnya ada", () => {
    // Bulan tanpa penjualan harus hadir sebagai nol yang terlihat, bukan
    // menghilang dari daftar.
    const m = renderToStaticMarkup(
      <KartuBulan
        bulan={{ bulan: "2026-08", omzet: 0, jumlahPembelian: 0, perProduk: [], pengecualian: [] }}
      />,
    );
    expect(m).toContain('data-bulan="2026-08"');
    expect(m).toContain("Agustus 2026");
    expect(m).toContain("0 pembelian");
  });
});

describe("PeringatanData", () => {
  it("tanpaNilai > 0 merender banner data tak terbaca", () => {
    // Bulan kosong + tanpaNilai > 0 berarti data tidak terbaca, bukan "tidak
    // ada penjualan". Banner inilah satu-satunya pembeda keduanya di layar.
    const m = renderToStaticMarkup(
      <PeringatanData terpotong={false} tanpaTanggal={0} tanpaNilai={3} />,
    );
    expect(m).toContain('data-peringatan="tanpa-nilai"');
    expect(m).toContain("3 pesanan tidak terbaca rincian itemnya");
    expect(m).not.toContain('data-peringatan="tanpa-tanggal"');
    expect(m).not.toContain('data-peringatan="terpotong"');
  });

  it("ketiganya bersih: tidak merender apa pun", () => {
    const m = renderToStaticMarkup(
      <PeringatanData terpotong={false} tanpaTanggal={0} tanpaNilai={0} />,
    );
    expect(m).toBe("");
  });
});
