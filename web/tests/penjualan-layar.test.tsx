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
import { TabelPenjualan } from "@/app/admin/penjualan/tabel-penjualan";
import { ringkasNota } from "@/app/admin/penjualan/ringkas";
import type { BarisPenjualan, PenjualanBulan } from "@/lib/penjualan/hitung";

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

function notaDasar(ubah: Partial<BarisPenjualan> = {}): BarisPenjualan {
  return {
    pesananId: "p-1",
    kode: "PSN-261015-AAAAAA",
    status: "lunas",
    lunasPada: "2026-10-15T05:00:00Z",
    uangPada: "2026-10-15T05:00:00Z",
    padmaId: "PDM-0001",
    namaKlien: "Ibu A",
    pernahDikembalikan: false,
    lunasSetelahTutup: false,
    item: [{ productId: "a", judulBeku: "Kelas Menyusui", hargaBeku: 150_000, urutan: 1 }],
    ...ubah,
  };
}

describe("TabelPenjualan", () => {
  it("satu baris per ITEM, bukan per pesanan", () => {
    // Keranjang P2 membuat satu pesanan bisa memuat beberapa produk. Satu
    // baris per pesanan akan menyembunyikan produk kedua dan ketiga.
    const m = renderToStaticMarkup(
      <TabelPenjualan
        baris={[
          notaDasar({
            item: [
              { productId: "a", judulBeku: "Kelas Menyusui", hargaBeku: 100_000, urutan: 1 },
              { productId: "b", judulBeku: "Panduan MPASI", hargaBeku: 75_000, urutan: 2 },
            ],
          }),
        ]}
      />,
    );
    expect(m).toContain("Kelas Menyusui");
    expect(m).toContain("Panduan MPASI");
    expect(m).toContain("100.000");
    expect(m).toContain("75.000");
  });

  it("embed klien yang TIDAK TERBACA dirender sebagai kegagalan yang terlihat", () => {
    // Pembacaan yang ditahan RLS memulangkan NULL, bukan galat. Sel kosong
    // terbaca sebagai "klien tanpa nama" — pernyataan yang salah tentang data.
    const m = renderToStaticMarkup(
      <TabelPenjualan baris={[notaDasar({ padmaId: "", namaKlien: "" })]} />,
    );
    expect(m).toContain("tidak terbaca");
  });

  it("item yang TIDAK TERBACA tidak dirender sebagai Rp 0", () => {
    const m = renderToStaticMarkup(<TabelPenjualan baris={[notaDasar({ item: null })]} />);
    expect(m).toContain("tidak terbaca");
    expect(m).not.toContain("Rp 0");
  });

  it("produk GRATIS dirender sebagai Rp 0, bukan disembunyikan", () => {
    const m = renderToStaticMarkup(
      <TabelPenjualan
        baris={[
          notaDasar({
            item: [{ productId: "g", judulBeku: "Panduan gratis", hargaBeku: 0, urutan: 1 }],
          }),
        ]}
      />,
    );
    expect(m).toContain("Panduan gratis");
    expect(m).toContain("Rp 0");
  });

  it("nota yang dikembalikan diberi catatan, tidak diam-diam terlihat normal", () => {
    const m = renderToStaticMarkup(
      <TabelPenjualan baris={[notaDasar({ pernahDikembalikan: true })]} />,
    );
    expect(m).toContain("dikembalikan");
  });

  it("daftar kosong memberi kalimat, bukan tabel kosong tanpa penjelasan", () => {
    const m = renderToStaticMarkup(<TabelPenjualan baris={[]} />);
    expect(m).toContain("Belum ada");
  });
});

describe("ringkasNota", () => {
  it("baris yang itemnya tak terbaca dihitung di tanpaNilai, bukan sebagai nol diam-diam", () => {
    const r = ringkasNota([
      notaDasar({ pesananId: "p-1" }),
      notaDasar({ pesananId: "p-2", item: null }),
    ]);
    expect(r.total).toBe(150_000);
    expect(r.tanpaNilai).toBe(1);
  });

  it("produk yang memang gratis menyumbang 0 TANPA menaikkan tanpaNilai", () => {
    const r = ringkasNota([
      notaDasar({
        item: [{ productId: "g", judulBeku: "Panduan gratis", hargaBeku: 0, urutan: 1 }],
      }),
    ]);
    expect(r.total).toBe(0);
    expect(r.tanpaNilai).toBe(0);
  });

  it("daftar kosong menghasilkan nol dan nol", () => {
    expect(ringkasNota([])).toEqual({ total: 0, tanpaNilai: 0 });
  });
});
