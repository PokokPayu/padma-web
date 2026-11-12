/**
 * Agregasi penjualan, DIUJI TANPA BASIS DATA.
 *
 * Seluruh keputusan "apa yang disebut terjual" hidup di modul murni ini,
 * justru supaya ia bisa diuji dengan fixture alih-alih dengan Supabase lokal
 * yang dipakai bersama sesi lain. Kalau sebuah aturan uang hanya bisa
 * dibuktikan dengan basis data yang menyala, ia akan jarang dibuktikan.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { PESANAN_BERUANG } from "@/lib/pesanan/status";
import {
  golongkan,
  hitungPenjualan,
  nilaiBaris,
  urutkanBaris,
  type BarisPenjualan,
} from "@/lib/penjualan/hitung";

/** Pesanan `lunas` bersih pada 15 Okt 2026, satu produk Rp 150.000. */
function barisDasar(ubah: Partial<BarisPenjualan> = {}): BarisPenjualan {
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
    item: [{ productId: "prod-1", judulBeku: "Kelas Menyusui", hargaBeku: 150_000, urutan: 1 }],
    ...ubah,
  };
}

describe("golongkan", () => {
  it("lunas bersih adalah omzet", () => {
    expect(golongkan(barisDasar())).toBe("omzet");
  });

  it("setiap status pembawa uang masuk golongan penjualan, tidak ada yang lenyap", () => {
    // Nilai enum pembawa uang yang lahir kelak jatuh ke `bukan_penjualan` dan
    // lenyap tanpa terhitung kalau `golongkan` tidak ikut disunting. Uji ini
    // memerah saat itu terjadi.
    for (const status of PESANAN_BERUANG) {
      expect(golongkan(barisDasar({ status }))).not.toBe("bukan_penjualan");
    }
  });

  it("ditahan BUKAN omzet — uangnya ada di Midtrans, belum di PADMA", () => {
    expect(golongkan(barisDasar({ status: "ditahan", lunasPada: null }))).toBe("ditahan");
  });

  it("kedaluwarsa berjejak lunas_setelah_tutup masuk kelompoknya sendiri", () => {
    expect(
      golongkan(
        barisDasar({ status: "kedaluwarsa", lunasPada: null, lunasSetelahTutup: true }),
      ),
    ).toBe("lewat_tenggat");
  });

  it("kedaluwarsa BIASA bukan penjualan sama sekali", () => {
    expect(
      golongkan(barisDasar({ status: "kedaluwarsa", lunasPada: null, uangPada: null })),
    ).toBe("bukan_penjualan");
  });

  it("lunas yang pernah dikembalikan keluar dari omzet", () => {
    // `sebab_tinjauan` ditulis `coalesce(o.sebab_tinjauan, v_sebab)`, jadi
    // alasan PERTAMA yang menang. Pesanan yang lebih dulu bertanda
    // `selisih_nominal` lalu kena chargeback tetap terbaca `selisih_nominal`
    // selamanya — dan saringan yang bersandar pada kolom itu akan
    // menghitungnya sebagai pendapatan. Karena itu `pernahDikembalikan`
    // datang dari notifikasi, bukan dari kolom sebab.
    expect(golongkan(barisDasar({ pernahDikembalikan: true }))).toBe("dikembalikan");
  });
});

describe("nilaiBaris", () => {
  it("menjumlahkan harga beku seluruh item", () => {
    expect(
      nilaiBaris(
        barisDasar({
          item: [
            { productId: "a", judulBeku: "A", hargaBeku: 100_000, urutan: 1 },
            { productId: "b", judulBeku: "B", hargaBeku: 50_000, urutan: 2 },
          ],
        }),
      ),
    ).toBe(150_000);
  });

  it("produk GRATIS memulangkan nol, bukan null", () => {
    // Nol yang SAH tetap angka. Yang memisahkannya dari "tidak terbaca"
    // adalah ada/tidaknya item, bukan jumlahnya.
    expect(
      nilaiBaris(
        barisDasar({
          item: [{ productId: "g", judulBeku: "Panduan gratis", hargaBeku: 0, urutan: 1 }],
        }),
      ),
    ).toBe(0);
  });

  it("item yang TIDAK TERBACA memulangkan null, bukan nol", () => {
    expect(nilaiBaris(barisDasar({ item: null }))).toBeNull();
    expect(nilaiBaris(barisDasar({ item: [] }))).toBeNull();
  });
});

describe("hitungPenjualan", () => {
  it("menjumlahkan omzet per bulan dan menghitung pembelian, bukan item", () => {
    // Satu pesanan berisi TIGA produk adalah SATU pembelian. Keranjang P2
    // membuat bentuk ini biasa, bukan luar biasa.
    const hasil = hitungPenjualan([
      barisDasar({
        pesananId: "p-keranjang",
        item: [
          { productId: "a", judulBeku: "A", hargaBeku: 100_000, urutan: 1 },
          { productId: "b", judulBeku: "B", hargaBeku: 75_000, urutan: 2 },
          { productId: "c", judulBeku: "C", hargaBeku: 25_000, urutan: 3 },
        ],
      }),
    ]);

    expect(hasil.bulan).toHaveLength(1);
    expect(hasil.bulan[0].bulan).toBe("2026-10");
    expect(hasil.bulan[0].omzet).toBe(200_000);
    expect(hasil.bulan[0].jumlahPembelian).toBe(1);
    expect(hasil.bulan[0].perProduk).toHaveLength(3);
  });

  it("mengelompokkan per product_id, BUKAN per judul beku", () => {
    // Produk yang pernah diganti nama membekukan judul lama di nota lama.
    // Tanpa product_id keduanya pecah jadi dua baris laporan, dan keduanya
    // terlihat masuk akal.
    const hasil = hitungPenjualan([
      barisDasar({
        pesananId: "p-lama",
        kode: "PSN-260915-AAAAAA",
        lunasPada: "2026-10-01T05:00:00Z",
        item: [{ productId: "sama", judulBeku: "Judul LAMA", hargaBeku: 100_000, urutan: 1 }],
      }),
      barisDasar({
        pesananId: "p-baru",
        kode: "PSN-261015-BBBBBB",
        lunasPada: "2026-10-20T05:00:00Z",
        item: [{ productId: "sama", judulBeku: "Judul BARU", hargaBeku: 120_000, urutan: 1 }],
      }),
    ]);

    expect(hasil.bulan[0].perProduk).toHaveLength(1);
    expect(hasil.bulan[0].perProduk[0].banyak).toBe(2);
    expect(hasil.bulan[0].perProduk[0].nilai).toBe(220_000);
    // Judul yang DITAMPILKAN adalah yang TERBARU, karena itu nama produknya
    // hari ini — judul lama hanya hidup di nota lamanya.
    expect(hasil.bulan[0].perProduk[0].judul).toBe("Judul BARU");
  });

  it("item tanpa product_id dikelompokkan menurut judul bekunya, tidak dibuang", () => {
    // Baris ber-`jenis: 'sesi'` memulangkan product_id null dari view. Hari
    // ini nol baris, tetapi item yang kuncinya null akan saling bertabrakan
    // menjadi SATU baris produk bernama "null" kalau fallback-nya hilang.
    const hasil = hitungPenjualan([
      barisDasar({
        pesananId: "p-null",
        item: [
          { productId: null, judulBeku: "Sesi A", hargaBeku: 100_000, urutan: 1 },
          { productId: null, judulBeku: "Sesi B", hargaBeku: 50_000, urutan: 2 },
        ],
      }),
    ]);
    expect(hasil.bulan[0].perProduk).toHaveLength(2);
    expect(hasil.bulan[0].perProduk.map((p) => p.judul).sort()).toEqual(["Sesi A", "Sesi B"]);
  });

  it("pengecualian TIDAK ikut omzet, tetapi nilainya tercatat", () => {
    const hasil = hitungPenjualan([
      barisDasar(),
      barisDasar({ pesananId: "p-tahan", status: "ditahan", lunasPada: null }),
      barisDasar({
        pesananId: "p-tenggat",
        status: "kedaluwarsa",
        lunasPada: null,
        lunasSetelahTutup: true,
      }),
      barisDasar({ pesananId: "p-balik", pernahDikembalikan: true }),
    ]);

    const okt = hasil.bulan[0];
    expect(okt.omzet).toBe(150_000);
    expect(okt.jumlahPembelian).toBe(1);

    const per = Object.fromEntries(okt.pengecualian.map((p) => [p.golongan, p]));
    expect(per.ditahan).toEqual({ golongan: "ditahan", banyak: 1, nilai: 150_000 });
    expect(per.lewat_tenggat).toEqual({ golongan: "lewat_tenggat", banyak: 1, nilai: 150_000 });
    expect(per.dikembalikan).toEqual({ golongan: "dikembalikan", banyak: 1, nilai: 150_000 });
  });

  it("pengecualian TIDAK masuk rincian per produk", () => {
    const hasil = hitungPenjualan([
      barisDasar({ pesananId: "p-tahan", status: "ditahan", lunasPada: null }),
    ]);
    expect(hasil.bulan[0].omzet).toBe(0);
    expect(hasil.bulan[0].perProduk).toEqual([]);
  });

  it("pesanan 'ditahan' dikelompokkan menurut tanggal NOTIFIKASI, bukan lunas_pada", () => {
    // `ditahan` tidak pernah punya `lunas_pada` — statusnya tidak pernah
    // berpindah ke `lunas`. Tanpa jatuh ke `uangPada`, seluruh kelompok ini
    // tidak masuk bulan mana pun dan lenyap dari laporan.
    const hasil = hitungPenjualan([
      barisDasar({
        status: "ditahan",
        lunasPada: null,
        uangPada: "2026-08-20T05:00:00Z",
      }),
    ]);
    expect(hasil.bulan[0].bulan).toBe("2026-08");
    expect(hasil.bulan[0].pengecualian[0].golongan).toBe("ditahan");
  });

  it("baris tanpa tanggal apa pun DIHITUNG, tidak dibuang diam-diam", () => {
    const hasil = hitungPenjualan([
      barisDasar({ lunasPada: null, uangPada: null, status: "ditahan" }),
    ]);
    expect(hasil.tanpaTanggal).toBe(1);
    expect(hasil.bulan).toEqual([]);
  });

  it("bulan diurutkan TERBARU lebih dulu", () => {
    const hasil = hitungPenjualan([
      barisDasar({ pesananId: "a", lunasPada: "2026-08-10T05:00:00Z" }),
      barisDasar({ pesananId: "b", lunasPada: "2026-10-10T05:00:00Z" }),
      barisDasar({ pesananId: "c", lunasPada: "2026-09-10T05:00:00Z" }),
    ]);
    expect(hasil.bulan.map((b) => b.bulan)).toEqual(["2026-10", "2026-09", "2026-08"]);
  });

  it("larik kosong memulangkan nol, bukan NaN", () => {
    const hasil = hitungPenjualan([]);
    expect(hasil.bulan).toEqual([]);
    expect(hasil.tanpaTanggal).toBe(0);
    expect(hasil.tanpaNilai).toBe(0);
  });

  it("baris yang itemnya TIDAK TERBACA dihitung terpisah, bukan sebagai Rp 0", () => {
    const hasil = hitungPenjualan([barisDasar(), barisDasar({ pesananId: "x", item: null })]);
    expect(Number.isNaN(hasil.bulan[0].omzet)).toBe(false);
    expect(hasil.bulan[0].omzet).toBe(150_000);
    expect(hasil.bulan[0].jumlahPembelian).toBe(1);
    expect(hasil.tanpaNilai).toBe(1);
  });

  it("pengecualian keluar berurutan ditahan, lewat_tenggat, dikembalikan", () => {
    // Urutannya sengaja dibalik pada masukan.
    const hasil = hitungPenjualan([
      barisDasar({ pesananId: "p-balik", pernahDikembalikan: true }),
      barisDasar({
        pesananId: "p-tenggat",
        status: "kedaluwarsa",
        lunasPada: null,
        lunasSetelahTutup: true,
      }),
      barisDasar({ pesananId: "p-tahan", status: "ditahan", lunasPada: null }),
    ]);
    expect(hasil.bulan[0].pengecualian.map((p) => p.golongan)).toEqual([
      "ditahan",
      "lewat_tenggat",
      "dikembalikan",
    ]);
  });

  it("perProduk terurut menurut nilai MENURUN", () => {
    const hasil = hitungPenjualan([
      barisDasar({
        item: [
          { productId: "kecil", judulBeku: "Kecil", hargaBeku: 50_000, urutan: 1 },
          { productId: "besar", judulBeku: "Besar", hargaBeku: 300_000, urutan: 2 },
          { productId: "tengah", judulBeku: "Tengah", hargaBeku: 120_000, urutan: 3 },
        ],
      }),
    ]);
    expect(hasil.bulan[0].perProduk.map((p) => p.judul)).toEqual(["Besar", "Tengah", "Kecil"]);
  });
});

describe("urutkanBaris", () => {
  it("dua pesanan bercap waktu IDENTIK tetap berurutan stabil", () => {
    // `ditutup_pada` hanyalah `now()`; tidak ada batasan yang membuatnya unik
    // per pesanan. Untuk baris yang seri, urutan menurut tanggal saja tidak
    // menentukan apa pun — Postgres bebas memulangkan urutan mana saja, dan
    // daftar yang berganti urutan antar muat ulang membuat pembacanya
    // berhenti memercayai angkanya. `kode` dipilih sebagai pemecah seri
    // karena ia UNIK (constraint `orders_kode_unik`).
    const sama = "2026-10-15T05:00:00Z";
    const a = barisDasar({ pesananId: "p-a", kode: "PSN-261015-AAAAAA", lunasPada: sama });
    const b = barisDasar({ pesananId: "p-b", kode: "PSN-261015-BBBBBB", lunasPada: sama });

    expect(urutkanBaris([a, b]).map((x) => x.kode)).toEqual(
      urutkanBaris([b, a]).map((x) => x.kode),
    );
  });

  it("terbaru lebih dulu", () => {
    const lama = barisDasar({ kode: "PSN-260101-AAAAAA", lunasPada: "2026-01-01T05:00:00Z" });
    const baru = barisDasar({ kode: "PSN-261201-BBBBBB", lunasPada: "2026-12-01T05:00:00Z" });
    expect(urutkanBaris([lama, baru])[0].kode).toBe("PSN-261201-BBBBBB");
  });
});

/**
 * PAGAR STRUKTURAL: penggolongan TIDAK BOLEH bersandar pada `sebab_tinjauan`.
 *
 * Kolom itu ditulis `coalesce(o.sebab_tinjauan, v_sebab)` di webhook, jadi
 * alasan PERTAMA yang menang: pesanan yang lebih dulu bertanda
 * `selisih_nominal` lalu kena chargeback tetap terbaca `selisih_nominal`
 * selamanya. Menggolongkan lewat kolom itu akan menghitung uang yang sudah
 * keluar sebagai pendapatan.
 *
 * `BarisPenjualan` karena itu sengaja TIDAK punya medan untuk kolom tersebut.
 * Pagar ini menegakkan ketiadaan itu pada SUMBERNYA, karena tipe yang hilang
 * satu medan tidak memerahkan apa pun ketika seseorang menambahkannya kembali.
 */
describe("sebab_tinjauan tidak pernah menjadi sumber penggolongan", () => {
  it("hitung.ts tidak menyebut sebab_tinjauan di mana pun", () => {
    const isi = readFileSync(
      path.join(__dirname, "..", "src", "lib", "penjualan", "hitung.ts"),
      "utf8",
    );
    expect(isi).not.toContain("sebab_tinjauan");
    expect(isi).not.toContain("sebabTinjauan");
  });
});
