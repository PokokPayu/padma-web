import { describe, it, expect } from "vitest";
import { urutkanMitraMenurutJarak, labelJarak } from "@/lib/jadwal/urutan-mitra";

const MALANG = { lat: -7.9666, lon: 112.6326 };

const MITRA = [
  { id: "c", nama: "Citra", lat: -7.99, lon: 112.66 }, // paling jauh dari tiga
  { id: "a", nama: "Ayu", lat: -7.967, lon: 112.633 }, // paling dekat
  { id: "b", nama: "Bunga", lat: -7.98, lon: 112.64 },
  { id: "z", nama: "Zahra", lat: null, lon: null }, // domisili belum diisi
];

describe("urutan mitra menurut jarak", () => {
  it("yang terdekat lebih dulu", () => {
    const hasil = urutkanMitraMenurutJarak(MITRA, MALANG);
    expect(hasil.slice(0, 3).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("menyertakan jaraknya, supaya admin memutuskan dengan angka", () => {
    const [pertama] = urutkanMitraMenurutJarak(MITRA, MALANG);
    expect(pertama.km).toBeGreaterThan(0);
    expect(pertama.km).toBeLessThan(1);
  });

  it("mitra tanpa koordinat TETAP muncul, di urutan paling belakang", () => {
    // Membuangnya berarti mitra yang domisilinya belum diisi menjadi tidak
    // bisa ditugaskan sama sekali — kegagalan senyap yang menyalahkan orang
    // atas data yang belum sempat dimasukkan admin.
    const hasil = urutkanMitraMenurutJarak(MITRA, MALANG);
    expect(hasil[hasil.length - 1].id).toBe("z");
    expect(hasil[hasil.length - 1].km).toBeNull();
  });

  it("tanpa koordinat tujuan, urutannya menurut NAMA — bukan acak", () => {
    // Alamat klien yang gagal digeocode adalah keadaan yang wajar di Malang
    // (26 dari 32 gagal; spec pemilih-lokasi §1). Urutan yang berubah-ubah
    // antar-muat membuat admin kehilangan tempat.
    const hasil = urutkanMitraMenurutJarak(MITRA, null);
    expect(hasil.map((m) => m.nama)).toEqual(["Ayu", "Bunga", "Citra", "Zahra"]);
    expect(hasil.every((m) => m.km === null)).toBe(true);
  });

  it("tidak mengubah array masukan", () => {
    const salinan = [...MITRA];
    urutkanMitraMenurutJarak(MITRA, MALANG);
    expect(MITRA).toEqual(salinan);
  });

  it("dua mitra berjarak sama diurutkan menurut nama, hasilnya stabil", () => {
    const kembar = [
      { id: "y", nama: "Yuni", lat: -7.97, lon: 112.64 },
      { id: "x", nama: "Xena", lat: -7.97, lon: 112.64 },
    ];
    expect(urutkanMitraMenurutJarak(kembar, MALANG).map((m) => m.id)).toEqual(["x", "y"]);
  });
});

describe("format jarak untuk layar admin", () => {
  it("satu angka desimal dengan koma, bukan titik", () => {
    expect(labelJarak({ km: 4.234, sebab: null })).toBe("4,2 km");
    expect(labelJarak({ km: 0, sebab: null })).toBe("0,0 km");
  });

  it("menyebut APA yang kurang dan PADA SIAPA, bukan satu kalimat untuk dua sebab", () => {
    // "0 km" untuk mitra tanpa domisili akan membuatnya selalu tampak paling
    // dekat — kebohongan yang persis membalik urutan yang sedang dibangun.
    expect(labelJarak({ km: null, sebab: "domisili_mitra" })).toBe("domisili bidan belum diisi");
    // Dan yang ini dulunya juga berbunyi "domisili belum diisi": alamat
    // permintaan yang gagal digeocode menuduh mitra yang datanya sudah benar.
    expect(labelJarak({ km: null, sebab: "alamat_permintaan" })).toBe(
      "alamat permintaan belum berkoordinat",
    );
  });
});
