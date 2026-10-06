/**
 * Render ketiga permukaan P4.
 *
 * Suite ini berjalan `environment: "node"` tanpa jsdom, jadi perkakasnya
 * `renderToStaticMarkup` — sama dengan seluruh uji panel lain.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { KartuBulan } from "@/app/owner/penjualan/kartu-bulan";
import { PeringatanData } from "@/app/owner/penjualan/peringatan-data";
import { TabelPenjualan } from "@/app/admin/penjualan/tabel-penjualan";
import { CatatanBatas } from "@/app/admin/penjualan/catatan-batas";
import { ringkasNota, notaTampil } from "@/app/admin/penjualan/ringkas";
import { BagianPembelian } from "@/app/admin/klien/[id]/kartu-pembelian";
import { BATAS_BARIS_PENJUALAN } from "@/lib/penjualan/baca";
import type { BarisPenjualan, PenjualanBulan } from "@/lib/penjualan/hitung";

// `CatatanBatas` mengimpor `BATAS_BARIS_PENJUALAN` dari `@/lib/penjualan/baca`,
// yang menyeret `@/lib/supabase/server` -> `next/headers` — modul yang hanya
// bermakna di dalam request scope. Suite ini TANPA DB dan tanpa request, jadi
// modulnya diganti; `createServerSupabase` tidak pernah dipanggil di sini.
// (`vi.mock` diangkat ke atas seluruh impor oleh vitest, jadi letaknya di
// bawah impor justru konvensi berkas uji lain di repo ini.)
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => {
    throw new Error("uji ini tidak boleh menyentuh Supabase");
  },
}));

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
    // JUMLAH BARISNYA yang dikunci, bukan sekadar kehadiran kedua judulnya.
    // Implementasi yang merender SATU <tr> per pesanan dengan judul-judulnya
    // disambung ", " memenuhi seluruh `toContain` di atas tanpa satu pun
    // assertion memerah — dan itu persis kegagalan yang blok ini ada untuk
    // mencegahnya. `data-pesanan` menempel di setiap <tr>.
    expect([...m.matchAll(/data-pesanan=/g)]).toHaveLength(2);
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

  it("baris BUKAN omzet tidak menyentuh total MAUPUN tanpaNilai", () => {
    // Blok ini menjaga satu baris di `ringkas.ts`:
    // `if (golongkan(b) !== "omzet") continue;`. Dengan fixture yang
    // seluruhnya `lunas`, baris itu bisa dihapus tanpa satu pun uji memerah —
    // penjaga yang tidak menjaga apa pun. Dua baris di bawah membuat
    // penghapusannya BERBEDA: yang dikembalikan akan menaikkan `total`, dan
    // yang ditahan tanpa item terbaca akan menaikkan `tanpaNilai`.
    const r = ringkasNota([
      notaDasar({ pesananId: "p-1" }),
      notaDasar({ pesananId: "p-2", pernahDikembalikan: true }),
      notaDasar({ pesananId: "p-3", status: "ditahan", lunasPada: null, item: null }),
    ]);
    expect(r.total).toBe(150_000);
    expect(r.tanpaNilai).toBe(0);
  });
});

describe("notaTampil", () => {
  it("nota lunas tetap tampil", () => {
    const hasil = notaTampil([notaDasar({ pesananId: "p-1" })]);
    expect(hasil).toHaveLength(1);
    expect(hasil[0].pesananId).toBe("p-1");
  });

  it("checkout terlantar (kedaluwarsa, tak pernah dibayar) DIBUANG", () => {
    // `order_items` dibekukan saat pesanan DIBUAT, jadi checkout yang
    // ditinggalkan sudah memikul `harga_beku` penuh dan `ditutup_pada` terisi
    // saat tenggatnya lewat. Tanpa saringan ini ia tercetak di tabel
    // byte-per-byte sama dengan nota yang sungguh dibayar — termasuk
    // nominalnya, dengan kolom catatan KOSONG.
    const hasil = notaTampil([
      notaDasar({
        pesananId: "p-mati",
        status: "kedaluwarsa",
        lunasPada: null,
        uangPada: "2026-10-04T05:00:00Z",
        lunasSetelahTutup: false,
      }),
    ]);
    expect(hasil).toHaveLength(0);
  });

  it("kedaluwarsa yang DIBAYAR LEWAT TENGGAT tetap tampil", () => {
    // Golongan `lewat_tenggat` adalah pengecualian sungguhan: uangnya
    // mendarat sesudah pesanannya ditutup, dan justru baris inilah yang harus
    // dilihat staf. Membuangnya bersama checkout terlantar akan
    // menyembunyikan uang yang benar-benar masuk.
    const hasil = notaTampil([
      notaDasar({
        pesananId: "p-tenggat",
        status: "kedaluwarsa",
        lunasPada: null,
        uangPada: "2026-10-04T05:00:00Z",
        lunasSetelahTutup: true,
      }),
    ]);
    expect(hasil).toHaveLength(1);
    expect(hasil[0].pesananId).toBe("p-tenggat");
  });

  it("ketiganya sekaligus: hanya yang terlantar yang hilang", () => {
    const hasil = notaTampil([
      notaDasar({ pesananId: "p-lunas" }),
      notaDasar({
        pesananId: "p-mati",
        status: "kedaluwarsa",
        lunasPada: null,
        lunasSetelahTutup: false,
      }),
      notaDasar({
        pesananId: "p-tenggat",
        status: "dibatalkan",
        lunasPada: null,
        lunasSetelahTutup: true,
      }),
      notaDasar({ pesananId: "p-ditahan", status: "ditahan", lunasPada: null }),
    ]);
    expect(hasil.map((b) => b.pesananId)).toEqual(["p-lunas", "p-tenggat", "p-ditahan"]);
  });
});

describe("CatatanBatas", () => {
  it('periode "semua" MENGUMUMKAN batasnya walau tidak terpotong', () => {
    // Batas yang tidak diumumkan adalah batas yang berbohong: instansi yang
    // barisnya masih di bawah 500 tidak pernah menyebut angkanya sama sekali,
    // lalu suatu hari melewatinya tanpa ada yang pernah membaca angka itu.
    const m = renderToStaticMarkup(<CatatanBatas periode="semua" terpotong={false} />);
    expect(m).toContain('data-batas="semua"');
    expect(m).toContain(String(BATAS_BARIS_PENJUALAN));
  });

  it('periode "semua" yang TERPOTONG memakai peringatan, bukan catatan biasa', () => {
    const m = renderToStaticMarkup(<CatatanBatas periode="semua" terpotong />);
    expect(m).toContain('data-batas="terpotong"');
    expect(m).not.toContain('data-batas="semua"');
    expect(m).toContain(String(BATAS_BARIS_PENJUALAN));
  });

  it("periode berjangka yang tidak terpotong tidak merender apa pun", () => {
    const m = renderToStaticMarkup(<CatatanBatas periode="bulan-ini" terpotong={false} />);
    expect(m).toBe("");
  });

  it("periode berjangka yang terpotong tetap memperingatkan", () => {
    const m = renderToStaticMarkup(<CatatanBatas periode="bulan-ini" terpotong />);
    expect(m).toContain('data-batas="terpotong"');
    expect(m).toContain(String(BATAS_BARIS_PENJUALAN));
  });

  it("angkanya datang dari BATAS_BARIS_PENJUALAN, bukan literal di berkasnya", () => {
    // Dua angka yang boleh berbeda adalah layar yang suatu hari mengumumkan
    // batas yang bukan batasnya.
    const sumber = readFileSync(
      path.join(__dirname, "..", "src/app/admin/penjualan/catatan-batas.tsx"),
      "utf8",
    );
    expect(sumber).toContain("BATAS_BARIS_PENJUALAN");
    // Lookaround, bukan `\b`: skala Tailwind seperti `text-clay-500` bukan
    // literal batas dan tidak boleh memerahkan uji ini.
    expect(sumber).not.toMatch(/(?<![\w-])500(?![\w-])/);
  });
});

describe("BagianPembelian", () => {
  it("memakai judul sejajar dengan Riwayat sesi", () => {
    const m = renderToStaticMarkup(<BagianPembelian baris={[notaDasar()]} />);
    expect(m).toContain("Riwayat pembelian");
    expect(m).toContain('data-bagian="riwayat-pembelian"');
  });

  it("klien tanpa pembelian memberi kalimat, bukan bagian kosong", () => {
    const m = renderToStaticMarkup(<BagianPembelian baris={[]} />);
    expect(m).toContain("data-kosong");
    expect(m).not.toContain("<table");
  });

  it("klien dengan pembelian tidak menampilkan penanda kosong", () => {
    const m = renderToStaticMarkup(<BagianPembelian baris={[notaDasar()]} />);
    expect(m).not.toContain("data-kosong");
    // Sisi POSITIFNYA dikunci juga: tanpa ini, `not.toContain("<table")` pada
    // kasus kosong di atas bisa hijau hanya karena tabelnya tidak pernah
    // dirender dalam keadaan apa pun.
    expect(m).toContain("<table");
  });

  it("merender nota klien beserta nominalnya", () => {
    const m = renderToStaticMarkup(<BagianPembelian baris={[notaDasar()]} />);
    expect(m).toContain("Kelas Menyusui");
    expect(m).toContain("150.000");
  });
});
