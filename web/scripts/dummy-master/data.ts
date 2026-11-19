/**
 * Data master DUMMY untuk lingkungan dev: produk digital, mitra, testimoni
 * draf, dan alamat berpin untuk klien seed Ananda.
 *
 * Semua isinya sintetis dan menyatakan dirinya data contoh. Tidak ada satu pun
 * kalimat yang berfungsi sebagai saran klinis, nomor HP mengikuti pola
 * fixture `0811-0000-xxxx`, dan koordinat hanya titik kira-kira di sekitar
 * Malang, kota tempat mitra seed berada.
 *
 * Id ditulis tetap (awalan `d0d0d0d0-`) supaya `seed:master` idempoten:
 * menjalankannya dua kali memperbarui baris yang sama, bukan menggandakannya.
 * Bentuknya UUID huruf kecil karena `objekSampulSah()` menolak id lain.
 */

export type MateriDummy = {
  id: string;
  judul: string;
  keterangan: string;
  /** Materi pratinjau bisa dibuka siapa pun selama produknya tayang. */
  pratinjau: boolean;
  /** Halaman `.webp` yang dibangkitkan dan diunggah ke `produk-halaman`. */
  jumlahHalaman: number;
};

export type BabDummy = { id: string; judul: string; materi: MateriDummy[] };

export type ProdukDummy = {
  id: string;
  /** UUID tetap untuk nama objek sampul (`<produk>/sampul-<uuid>.webp`). */
  idSampul: string;
  judul: string;
  slug: string;
  deskripsi: string;
  aktif: boolean;
  urutan: number;
  /** `null` = tanpa batas waktu. */
  masaBerlakuBulan: number | null;
  harga: number;
  hargaCoret: number | null;
  bab: BabDummy[];
};

const CATATAN = "Data contoh untuk uji lingkungan dev, bukan materi klinis.";

export const PRODUK_DUMMY: ProdukDummy[] = [
  {
    id: "d0d0d0d0-0000-4000-8000-000000000101",
    idSampul: "d0d0d0d0-0000-4000-8000-000000000201",
    judul: "Panduan Menyusui Minggu Pertama",
    slug: "panduan-menyusui-minggu-pertama",
    deskripsi: `E-book berbab tentang minggu pertama menyusui. ${CATATAN}`,
    aktif: true,
    urutan: 1,
    masaBerlakuBulan: null,
    harga: 10_000,
    hargaCoret: 25_000,
    bab: [
      {
        id: "d0d0d0d0-0000-4000-8000-000000000311",
        judul: "Sebelum Mulai",
        materi: [
          {
            id: "d0d0d0d0-0000-4000-8000-000000000411",
            judul: "Pengantar Panduan",
            keterangan: "Materi pratinjau, terbuka sebelum membeli.",
            pratinjau: true,
            jumlahHalaman: 2,
          },
          {
            id: "d0d0d0d0-0000-4000-8000-000000000412",
            judul: "Posisi dan Pelekatan",
            keterangan: "",
            pratinjau: false,
            jumlahHalaman: 3,
          },
        ],
      },
      {
        id: "d0d0d0d0-0000-4000-8000-000000000312",
        judul: "Hari-hari Pertama",
        materi: [
          {
            id: "d0d0d0d0-0000-4000-8000-000000000413",
            judul: "Catatan Harian Menyusui",
            keterangan: "",
            pratinjau: false,
            jumlahHalaman: 3,
          },
        ],
      },
    ],
  },
  {
    id: "d0d0d0d0-0000-4000-8000-000000000102",
    idSampul: "d0d0d0d0-0000-4000-8000-000000000202",
    judul: "Kelas Pijat Bayi untuk Ayah Bunda",
    slug: "kelas-pijat-bayi-ayah-bunda",
    deskripsi: `Kelas berbab dengan akses 6 bulan sejak dibeli. ${CATATAN}`,
    aktif: true,
    urutan: 2,
    masaBerlakuBulan: 6,
    harga: 25_000,
    hargaCoret: null,
    bab: [
      {
        id: "d0d0d0d0-0000-4000-8000-000000000321",
        judul: "Persiapan",
        materi: [
          {
            id: "d0d0d0d0-0000-4000-8000-000000000421",
            judul: "Alat dan Suasana",
            keterangan: "Materi pratinjau.",
            pratinjau: true,
            jumlahHalaman: 2,
          },
        ],
      },
      {
        id: "d0d0d0d0-0000-4000-8000-000000000322",
        judul: "Gerakan Dasar",
        materi: [
          {
            id: "d0d0d0d0-0000-4000-8000-000000000422",
            judul: "Urutan Gerakan Kaki dan Tangan",
            keterangan: "",
            pratinjau: false,
            jumlahHalaman: 4,
          },
        ],
      },
    ],
  },
  {
    id: "d0d0d0d0-0000-4000-8000-000000000103",
    idSampul: "d0d0d0d0-0000-4000-8000-000000000203",
    judul: "Checklist Persiapan Persalinan",
    slug: "checklist-persiapan-persalinan",
    deskripsi: `Produk GRATIS untuk menguji jalur "Ambil gratis" dan gerbang S&K. ${CATATAN}`,
    aktif: true,
    urutan: 3,
    masaBerlakuBulan: null,
    harga: 0,
    hargaCoret: null,
    bab: [
      {
        id: "d0d0d0d0-0000-4000-8000-000000000331",
        judul: "Checklist",
        materi: [
          {
            id: "d0d0d0d0-0000-4000-8000-000000000431",
            judul: "Daftar Perlengkapan",
            keterangan: "",
            pratinjau: false,
            jumlahHalaman: 2,
          },
        ],
      },
    ],
  },
  {
    id: "d0d0d0d0-0000-4000-8000-000000000104",
    idSampul: "d0d0d0d0-0000-4000-8000-000000000204",
    judul: "Nutrisi Ibu Hamil Trimester Ketiga",
    slug: "nutrisi-ibu-hamil-trimester-ketiga",
    deskripsi: `DRAF yang belum tayang, untuk menguji tampilan admin. ${CATATAN}`,
    aktif: false,
    urutan: 4,
    masaBerlakuBulan: 12,
    harga: 15_000,
    hargaCoret: 20_000,
    bab: [
      {
        id: "d0d0d0d0-0000-4000-8000-000000000341",
        judul: "Kerangka",
        materi: [
          {
            id: "d0d0d0d0-0000-4000-8000-000000000441",
            judul: "Kerangka Materi",
            keterangan: "",
            pratinjau: false,
            jumlahHalaman: 1,
          },
        ],
      },
    ],
  },
];

export type MitraDummy = {
  id: string;
  nama: string;
  noHp: string;
  alamat: string;
  lat: number;
  lon: number;
};

/**
 * Satu mitra per jenjang jarak di atas 5 km dari `ALAMAT_KLIEN_DUMMY`. Dua
 * mitra seed sudah berada dalam 0–5 km. Jenjang sebenarnya dihitung dan
 * dicetak `seed:master` lewat `haversineKm`/`jenjangDariJarak`, jadi nama di
 * sini hanya perkiraan.
 */
export const MITRA_DUMMY: MitraDummy[] = [
  {
    id: "d0d0d0d0-0000-4000-8000-000000000501",
    nama: "Bidan Contoh Lowokwaru",
    noHp: "0811-0000-0501",
    alamat: "Jl. Contoh Uji No. 11, Lowokwaru, Kota Malang (data contoh)",
    lat: -7.933,
    lon: 112.605,
  },
  {
    id: "d0d0d0d0-0000-4000-8000-000000000502",
    nama: "Bidan Contoh Singosari",
    noHp: "0811-0000-0502",
    alamat: "Jl. Contoh Uji No. 12, Singosari, Kab. Malang (data contoh)",
    lat: -7.893,
    lon: 112.665,
  },
  {
    id: "d0d0d0d0-0000-4000-8000-000000000503",
    nama: "Bidan Contoh Lawang",
    noHp: "0811-0000-0503",
    alamat: "Jl. Contoh Uji No. 13, Lawang, Kab. Malang (data contoh)",
    lat: -7.835,
    lon: 112.695,
  },
  {
    id: "d0d0d0d0-0000-4000-8000-000000000504",
    nama: "Bidan Contoh Turen",
    noHp: "0811-0000-0504",
    alamat: "Jl. Contoh Uji No. 14, Turen, Kab. Malang (data contoh)",
    lat: -8.165,
    lon: 112.695,
  },
];

/**
 * Alamat berpin untuk klien seed Ananda. Tanpa pin, tagihan pengajuan sesi
 * tidak bisa terbit (sebab `alamat_tanpa_pin`), dan skenario uji pembayaran
 * sesi tidak bisa dijalankan sama sekali.
 */
export const ALAMAT_KLIEN_DUMMY = {
  alamat: "Jl. Contoh Uji No. 1, Klojen, Kota Malang (data contoh)",
  lat: -7.9797,
  lon: 112.6304,
};

export type TestimoniDummy = { id: string; nama: string; keterangan: string; kutipan: string };

/**
 * Testimoni DRAF saja. CHECK `testimonials_terbit_berizin` menuntut video dan
 * izin untuk terbit, dan video testimoni tinggal di R2, yang sengaja tidak
 * disentuh dari dev.
 */
export const TESTIMONI_DUMMY: TestimoniDummy[] = [
  {
    id: "d0d0d0d0-0000-4000-8000-000000000601",
    nama: "Ibu Contoh A.",
    keterangan: "Klien program menyusui (data contoh)",
    kutipan: "Data contoh: kalimat testimoni untuk menguji tampilan daftar testimoni di panel admin.",
  },
  {
    id: "d0d0d0d0-0000-4000-8000-000000000602",
    nama: "Ibu Contoh B.",
    keterangan: "Klien kelas pijat bayi (data contoh)",
    kutipan: "Data contoh: testimoni kedua, juga draf, tanpa video dan tanpa izin terbit.",
  },
];
