import { PESANAN_MATI, type StatusPesanan } from "@/lib/pesanan/status";
import { bulanJakarta } from "./bulan";

// ============================================================================
// AGREGASI PENJUALAN — murni, nol IO
// ============================================================================
// Seluruh keputusan "apa yang disebut terjual" hidup di sini dan hanya di
// sini. Itu bukan kerapian: aturan uang yang tersebar di beberapa `filter()`
// di beberapa komponen adalah aturan yang akan menyimpang di salah satunya,
// dan penyimpangan itu tidak akan terlihat sebagai galat melainkan sebagai
// dua layar yang menyebut angka berbeda untuk bulan yang sama.
//
// Penjumlahannya di TypeScript, bukan di SQL, dan itu mengikuti doktrin yang
// sudah tertulis di `src/app/owner/rekap/page.tsx`: sebuah view penjumlah
// dimiliki `postgres`, berjalan dengan hak PEMILIK, dan karenanya MELEWATI
// RLS.

export type ItemPenjualan = {
  /** null untuk item non-produk (P3 `jenis: 'sesi'`). */
  productId: string | null;
  judulBeku: string;
  hargaBeku: number;
  urutan: number;
};

export type BarisPenjualan = {
  pesananId: string;
  kode: string;
  status: StatusPesanan;
  /** Terisi HANYA pada transisi sungguhan ke `lunas`. */
  lunasPada: string | null;
  /** Cap notifikasi terakhir yang membawa uang. Satu-satunya tanggal yang
   *  dimiliki pesanan `ditahan` dan pesanan yang dibayar lewat tenggat. */
  uangPada: string | null;
  /** "" berarti embed-nya TIDAK terbaca, bukan "klien tanpa PADMA ID". */
  padmaId: string;
  /** "" berarti embed-nya TIDAK terbaca, bukan "klien tanpa nama". */
  namaKlien: string;
  /** Pernah menerima notifikasi refund/chargeback. Dibaca dari
   *  `notifikasi_pesanan`, TIDAK PERNAH dari kolom alasan tinjauan pada `orders`. */
  pernahDikembalikan: boolean;
  /** Berjejak `lunas_setelah_tutup` di `jejak_pesanan`. */
  lunasSetelahTutup: boolean;
  /** null = itemnya TIDAK TERBACA. Larik kosong diperlakukan sama. */
  item: ItemPenjualan[] | null;
};

export type Golongan =
  | "omzet"
  | "dikembalikan"
  | "ditahan"
  | "lewat_tenggat"
  | "bukan_penjualan";

/**
 * URUTAN KLAUSA DI BAWAH ADALAH BAGIAN DARI ATURANNYA, bukan selera.
 *
 * `dikembalikan` diperiksa SEBELUM `omzet`: pesanan yang uangnya sudah keluar
 * lagi tetap berstatus `lunas` selamanya — webhook sengaja tidak
 * memindahkannya, karena repo ini tidak punya kebijakan refund dan menebaknya
 * di webhook lebih buruk daripada memanggil manusia. Memeriksa `lunas` lebih
 * dulu akan memungutnya sebagai pendapatan.
 */
export function golongkan(b: BarisPenjualan): Golongan {
  if (b.status === "lunas" && b.pernahDikembalikan) return "dikembalikan";
  if (b.status === "lunas") return "omzet";
  if (b.status === "ditahan") return "ditahan";
  // `PESANAN_MATI`, bukan literal "kedaluwarsa"/"dibatalkan": nilai enum baru
  // yang kelak diklasifikasikan mati ikut terbawa tanpa satu baris disunting.
  if (b.lunasSetelahTutup && PESANAN_MATI.includes(b.status)) return "lewat_tenggat";
  return "bukan_penjualan";
}

/**
 * Tanggal UANG MASUK, bukan tanggal pesanan dibuat.
 *
 * `lunasPada` lebih dulu karena ia yang paling tepat untuk omzet; `uangPada`
 * adalah satu-satunya yang dimiliki `ditahan` dan `lewat_tenggat`, yang
 * statusnya memang tidak pernah berpindah ke `lunas`.
 */
export function tanggalUang(b: BarisPenjualan): string | null {
  return b.lunasPada ?? b.uangPada;
}

/**
 * Nilai satu nota. `null` BERARTI TIDAK TERBACA, bukan nol rupiah.
 *
 * `pesanan_item_staf` bergerbang `user_role()` di dalam badan view-nya, jadi
 * bentuk ketidakterbacaannya adalah NOL BARIS — bukan galat yang bisa
 * dilempar di atas. "Rp 0" yang diucapkan dengan yakin tidak terbaca sebagai
 * data yang hilang melainkan sebagai angka. Produk gratis tetap punya
 * itemnya, jadi yang memisahkan keduanya adalah ada/tidaknya item.
 */
export function nilaiBaris(b: BarisPenjualan): number | null {
  if (b.item === null || b.item.length === 0) return null;
  return b.item.reduce((n, i) => n + i.hargaBeku, 0);
}

export type RingkasProduk = {
  /** `productId` bila ada, jatuh ke `judulBeku` untuk item tanpa produk. */
  kunci: string;
  judul: string;
  banyak: number;
  nilai: number;
};

export type Pengecualian = {
  golongan: Exclude<Golongan, "omzet" | "bukan_penjualan">;
  banyak: number;
  nilai: number;
};

export type PenjualanBulan = {
  bulan: string;
  omzet: number;
  /** PESANAN, bukan item. Satu keranjang berisi tiga produk adalah satu. */
  jumlahPembelian: number;
  perProduk: RingkasProduk[];
  pengecualian: Pengecualian[];
};

// `Record` berkunci pada union, BUKAN larik: ia mewajibkan setiap kunci, jadi
// golongan pengecualian baru menjadi galat kompilasi alih-alih lenyap diam-diam
// dari keluaran.
const URUT_PENGECUALIAN: Record<Pengecualian["golongan"], number> = {
  ditahan: 1,
  lewat_tenggat: 2,
  dikembalikan: 3,
};

/**
 * Terbaru lebih dulu, dengan `kode` sebagai PEMECAH SERI.
 *
 * Pemecah serinya bertugas STABILITAS, bukan makna. `lunas_pada` dan
 * `ditutup_pada` hanyalah `now()`; tidak ada batasan yang membuat keduanya
 * unik per pesanan, dan dua pesanan BOLEH memikul cap yang sama persis.
 * Untuk baris yang seri, urutan menurut tanggal saja tidak menentukan apa
 * pun — dan daftar uang yang berganti urutan antar muat ulang membuat
 * pembacanya berhenti memercayai seluruh angkanya. `kode` unik lewat
 * constraint `orders_kode_unik`.
 */
export function urutkanBaris(baris: readonly BarisPenjualan[]): BarisPenjualan[] {
  return [...baris].sort((a, b) => {
    const ta = tanggalUang(a) ?? "";
    const tb = tanggalUang(b) ?? "";
    if (ta !== tb) return tb.localeCompare(ta);
    return b.kode.localeCompare(a.kode);
  });
}

export function hitungPenjualan(baris: readonly BarisPenjualan[]): {
  bulan: PenjualanBulan[];
  tanpaTanggal: number;
  /** Baris yang itemnya TIDAK TERBACA. Dikeluarkan dari seluruh angka. */
  tanpaNilai: number;
} {
  type Ember = {
    omzet: number;
    jumlahPembelian: number;
    produk: Map<string, RingkasProduk>;
    pengecualian: Map<Pengecualian["golongan"], Pengecualian>;
  };

  const ember = new Map<string, Ember>();
  let tanpaTanggal = 0;
  let tanpaNilai = 0;

  // DIURUTKAN LEBIH DULU, dan itu bukan kerapian: judul produk yang
  // ditampilkan adalah judul dari nota TERBARU, dan "terbaru" hanya punya
  // arti bila barisnya sudah berurutan sebelum dilipat.
  for (const b of urutkanBaris(baris)) {
    const golongan = golongkan(b);
    if (golongan === "bukan_penjualan") continue;

    const tanggal = tanggalUang(b);
    const kunciBulan = tanggal === null ? null : bulanJakarta(tanggal);
    if (kunciBulan === null) {
      // TIDAK dibuang diam-diam. Baris tanpa tanggal yang lenyap tanpa jejak
      // membuat laporan yang jumlahnya tidak pernah bisa dicocokkan dengan
      // apa pun, dan tidak ada yang tahu kenapa.
      tanpaTanggal += 1;
      continue;
    }

    const nilaiTerbaca = nilaiBaris(b);
    if (nilaiTerbaca === null) {
      // "Rp 0" yang diucapkan dengan yakin terbaca sebagai selisih; "tidak
      // terbaca" terbaca sebagai data hilang. Baris ini tidak menyumbang apa
      // pun ke omzet, pembelian, produk, maupun pengecualian.
      tanpaNilai += 1;
      continue;
    }
    const nilai = nilaiTerbaca;

    let e = ember.get(kunciBulan);
    if (e === undefined) {
      e = { omzet: 0, jumlahPembelian: 0, produk: new Map(), pengecualian: new Map() };
      ember.set(kunciBulan, e);
    }

    if (golongan === "omzet") {
      e.omzet += nilai;
      e.jumlahPembelian += 1;
      for (const i of b.item ?? []) {
        const kunci = i.productId ?? i.judulBeku;
        const ada = e.produk.get(kunci);
        if (ada === undefined) {
          // Judul dari nota TERBARU, karena barisnya sudah terurut.
          e.produk.set(kunci, { kunci, judul: i.judulBeku, banyak: 1, nilai: i.hargaBeku });
        } else {
          ada.banyak += 1;
          ada.nilai += i.hargaBeku;
        }
      }
      continue;
    }

    const ada = e.pengecualian.get(golongan);
    if (ada === undefined) {
      e.pengecualian.set(golongan, { golongan, banyak: 1, nilai });
    } else {
      ada.banyak += 1;
      ada.nilai += nilai;
    }
  }

  const bulan: PenjualanBulan[] = [...ember.entries()]
    .map(([kunci, e]) => ({
      bulan: kunci,
      omzet: e.omzet,
      jumlahPembelian: e.jumlahPembelian,
      perProduk: [...e.produk.values()].sort(
        (a, b) => b.nilai - a.nilai || a.judul.localeCompare(b.judul),
      ),
      pengecualian: [...e.pengecualian.values()].sort(
        (a, b) => URUT_PENGECUALIAN[a.golongan] - URUT_PENGECUALIAN[b.golongan],
      ),
    }))
    // Terbaru lebih dulu. Kunci `YYYY-MM` berurut secara leksikografis.
    .sort((a, b) => b.bulan.localeCompare(a.bulan));

  return { bulan, tanpaTanggal, tanpaNilai };
}
