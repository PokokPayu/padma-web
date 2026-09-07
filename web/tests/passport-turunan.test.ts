import { describe, it, expect } from "vitest";
import {
  progresPaket, gridStempel, sesiBerikutnya, badgeDari, susunTagihan,
  type SesiRingkas,
} from "@/lib/passport/turunan";
import { formatTanggalID } from "@/lib/passport/waktu";

// `jenjang: null` secara BAWAAN — sama seperti `sesi()` di tests/owner-rekap.test.ts:
// sesi lama yang belum menyebut jenjang tidak boleh diam-diam mendapat baris
// transport apa pun.
const s = (o: Partial<SesiRingkas>): SesiRingkas => ({
  id: "s1", serviceId: "svc1", namaLayanan: "Layanan", namaMitra: "Bidan A",
  tanggal: "2026-07-08", status: "selesai", clientPackageId: "pkg1",
  catatan: "", rekomendasi: "", statusBayar: "belum", jenjang: null,
  varian: { label: "", durasiMenit: null, format: null }, ...o,
});

describe("progresPaket", () => {
  it("menghitung sesi selesai dalam paket", () => {
    const r = progresPaket({ totalSesi: 8, sesi: [
      s({ id: "a" }), s({ id: "b" }), s({ id: "c", status: "terjadwal" }),
    ]});
    expect(r).toEqual({ selesai: 2, total: 8, persen: 25 });
  });

  it("mengabaikan sesi di luar paket", () => {
    const r = progresPaket({ totalSesi: 8, sesi: [
      s({ id: "a" }), s({ id: "b", clientPackageId: null }),
    ]});
    expect(r!.selesai).toBe(1);
  });

  it("tahan bila admin mengecilkan jumlah_sesi retroaktif (cap 100%)", () => {
    const r = progresPaket({ totalSesi: 2, sesi: [
      s({ id: "a" }), s({ id: "b" }), s({ id: "c" }),
    ]});
    expect(r!.selesai).toBe(3);
    expect(r!.total).toBe(2);
    expect(r!.persen).toBe(100); // tidak 150%
  });

  it("klien tanpa paket (model hybrid) mengembalikan null", () => {
    expect(progresPaket({ totalSesi: null, sesi: [s({})] })).toBeNull();
  });
});

describe("gridStempel", () => {
  it("terisi = sesi selesai, satu penanda berikutnya, sisanya kosong", () => {
    const g = gridStempel({ totalSesi: 4, sesi: [
      s({ id: "a", tanggal: "2026-07-08" }),
      s({ id: "b", tanggal: "2026-07-15" }),
      s({ id: "c", tanggal: "2026-09-04", status: "terjadwal" }),
    ], sekarang: "2026-08-29" });
    expect(g.map((x) => x.jenis)).toEqual(["terisi", "terisi", "berikutnya", "kosong"]);
    expect(g[0].tanggal).toBe("2026-07-08");
    expect(g[2].tanggal).toBe("2026-09-04");
  });

  it("tidak menambah slot bila sesi selesai melebihi total", () => {
    const g = gridStempel({ totalSesi: 2, sesi: [
      s({ id: "a" }), s({ id: "b" }), s({ id: "c" }),
    ], sekarang: "2026-08-29" });
    expect(g).toHaveLength(2);
    expect(g.every((x) => x.jenis === "terisi")).toBe(true);
  });

  it("sesi terjadwal yang sudah lewat BUKAN penanda berikutnya", () => {
    const g = gridStempel({ totalSesi: 3, sesi: [
      s({ id: "a" }),
      s({ id: "b", tanggal: "2026-08-01", status: "terjadwal" }),
    ], sekarang: "2026-08-29" });
    expect(g.map((x) => x.jenis)).toEqual(["terisi", "kosong", "kosong"]);
  });
});

describe("sesiBerikutnya", () => {
  it("memilih tanggal terdekat, bukan yang pertama ditemukan", () => {
    const r = sesiBerikutnya([
      s({ id: "jauh", tanggal: "2026-10-01", status: "terjadwal" }),
      s({ id: "dekat", tanggal: "2026-09-04", status: "terjadwal" }),
    ], "2026-08-29");
    expect(r!.id).toBe("dekat");
  });

  it("mengabaikan sesi terjadwal yang tanggalnya sudah lewat", () => {
    const r = sesiBerikutnya([s({ id: "x", tanggal: "2026-08-01", status: "terjadwal" })], "2026-08-29");
    expect(r).toBeNull();
  });

  it("sesi hari ini masih terhitung berikutnya", () => {
    const r = sesiBerikutnya([s({ id: "x", tanggal: "2026-08-29", status: "terjadwal" })], "2026-08-29");
    expect(r!.id).toBe("x");
  });

  it("mengembalikan null bila tidak ada", () => {
    expect(sesiBerikutnya([s({ status: "selesai" })], "2026-08-29")).toBeNull();
  });
});

describe("badgeDari", () => {
  it("satu badge per layanan yang punya sesi selesai, tanpa duplikat", () => {
    const b = badgeDari([
      s({ serviceId: "a", namaLayanan: "Massage" }),
      s({ serviceId: "a", namaLayanan: "Massage" }),
      s({ serviceId: "b", namaLayanan: "Yoga" }),
      s({ serviceId: "c", namaLayanan: "Nutrisi", status: "terjadwal" }),
    ]);
    expect(b.map((x) => x.serviceId).sort()).toEqual(["a", "b"]);
  });
});

describe("susunTagihan", () => {
  it("paket menjadi satu item; sesi dalam paket TIDAK jadi item sendiri", () => {
    const t = susunTagihan({
      paket: [{ id: "p1", nama: "Sankalpa Prima", jumlahSesi: 8, statusBayar: "lunas" }],
      sesi: [
        s({ id: "a", clientPackageId: "p1", statusBayar: "belum" }),
        s({ id: "b", clientPackageId: "p1", statusBayar: "belum" }),
      ],
    });
    // Seed nyata memang kontradiktif (paket lunas, sesi anggotanya belum) —
    // menampilkan sesi berpaket akan melahirkan "tagihan hantu".
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ jenis: "paket", status: "lunas" });
  });

  it("sesi lepas menjadi item tersendiri", () => {
    const t = susunTagihan({
      paket: [],
      sesi: [s({ id: "x", clientPackageId: null, statusBayar: "belum", namaLayanan: "Konsultasi", tanggal: "2026-09-05" })],
    });
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ jenis: "sesi", id: "x", status: "belum" });
    expect(t[0].label).toContain("Konsultasi");
  });

  it("sesi batal tidak ditagih", () => {
    const t = susunTagihan({
      paket: [],
      sesi: [s({ id: "x", clientPackageId: null, status: "batal", statusBayar: "belum" })],
    });
    expect(t).toHaveLength(0);
  });

  // Ruling 13: label sesi yang dibaca KLIEN sempat tidak menyebut varian sama
  // sekali, padahal label admin sudah menyebutnya sejak Task 7 — dua sesi
  // layanan sama, tanggal sama, tapi varian (dan harga) beda, tidak bisa
  // dibedakan klien lewat WhatsApp. Dikunci di sini, bukan cuma di komentar.
  it("label sesi lepas menyertakan label varian ketika variannya bernama (Ruling 13)", () => {
    const t = susunTagihan({
      paket: [],
      sesi: [
        s({
          id: "x",
          clientPackageId: null,
          namaLayanan: "Garbha Relief",
          tanggal: "2026-09-05",
          varian: { label: "VIP", durasiMenit: 90, format: "private" },
        }),
      ],
    });
    expect(t[0].label).toContain("VIP");
    expect(t[0].label).toMatch(/90 menit/);
    expect(t[0].label).toMatch(/Private/);
  });

  it("varian BAKU (tanpa nama) tidak menambah apa pun ke label — perilaku lama dipertahankan", () => {
    const t = susunTagihan({
      paket: [],
      sesi: [
        s({
          id: "x",
          clientPackageId: null,
          namaLayanan: "Konsultasi",
          tanggal: "2026-09-05",
          varian: { label: "", durasiMenit: null, format: null },
        }),
      ],
    });
    expect((t[0].label.match(/ · /g) ?? []).length).toBe(1);
  });

  // ---------------------------------------------------------------------
  // Rincian TRANSPORT (Task 9, Ruling 16 — fix round 1). SENGAJA sebuah
  // MEDAN pada item sesi yang sudah ada, BUKAN item kedua ber-id sama: draf
  // pertama menambahkan item kedua, dan itu bug — lihat komentar
  // `ItemTagihan.rincianTransport` untuk kronologinya. Teksnya IDENTIK huruf
  // demi huruf dengan `daftarTagihanAdmin()` (@/lib/admin/tagihan); dikunci
  // lewat uji parity di tests/admin-bayar.test.ts. Di sini hanya bentuknya
  // sendiri.
  // ---------------------------------------------------------------------

  it("sesi lepas berjenjang menghasilkan SATU item dengan rincianTransport terisi", () => {
    const t = susunTagihan({
      paket: [],
      sesi: [s({ id: "x", clientPackageId: null, jenjang: "5_10" })],
    });
    expect(t).toHaveLength(1);
    expect(t[0].rincianTransport).toContain("Transport");
  });

  it("rincianTransport TIDAK bercampur dengan label sesi", () => {
    const t = susunTagihan({
      paket: [],
      sesi: [s({ id: "x", clientPackageId: null, namaLayanan: "Massage", jenjang: "5_10" })],
    });
    expect(t[0].label).not.toContain("Transport");
  });

  it("rincianTransport menyebut jenjang & tanggal, dan statusnya SAMA dengan item sesi (satu status_bayar)", () => {
    const t = susunTagihan({
      paket: [],
      sesi: [
        s({
          id: "x", clientPackageId: null, tanggal: "2026-09-05", jenjang: "0_5",
          statusBayar: "menunggu_verifikasi",
        }),
      ],
    });
    expect(t).toHaveLength(1);
    expect(t[0].rincianTransport).toContain("0–5 km");
    expect(t[0].rincianTransport).toContain(formatTanggalID("2026-09-05"));
    expect(t[0].status).toBe("menunggu_verifikasi");
  });

  it("sesi lepas TANPA jenjang (null): rincianTransport null", () => {
    const t = susunTagihan({
      paket: [],
      sesi: [s({ id: "x", clientPackageId: null, jenjang: null })],
    });
    expect(t).toHaveLength(1);
    expect(t[0].rincianTransport).toBeNull();
  });

  it("sesi berjenjang di_atas_20: rincianTransport TETAP null — klien tidak pernah tahu apakah tarif khususnya sudah ditetapkan (Ruling 17)", () => {
    const t = susunTagihan({
      paket: [],
      sesi: [s({ id: "x", clientPackageId: null, jenjang: "di_atas_20" })],
    });
    expect(t).toHaveLength(1);
    expect(t[0].rincianTransport).toBeNull();
  });

  it("item paket selalu rincianTransport null", () => {
    const t = susunTagihan({
      paket: [{ id: "p1", nama: "Sankalpa Prima", jumlahSesi: 8, statusBayar: "lunas" }],
      sesi: [],
    });
    expect(t[0].rincianTransport).toBeNull();
  });

  it("sesi BERPAKET berjenjang tidak menghasilkan item sendiri sama sekali", () => {
    // Sesi berpaket tidak menjadi item (ditelan item paket) — jadi
    // rincian transportnya pun tidak pernah muncul di sini (Ruling 18:
    // transport sesi berpaket menunggu spec paket, lihat hitungRekap()).
    const t = susunTagihan({
      paket: [{ id: "p1", nama: "Sankalpa Prima", jumlahSesi: 8, statusBayar: "lunas" }],
      sesi: [s({ id: "a", clientPackageId: "p1", jenjang: "5_10" })],
    });
    expect(t).toHaveLength(1);
    expect(t[0].jenis).toBe("paket");
  });

  it("sesi BATAL berjenjang tidak menghasilkan item sama sekali", () => {
    const t = susunTagihan({
      paket: [],
      sesi: [s({ id: "x", clientPackageId: null, status: "batal", jenjang: "5_10" })],
    });
    expect(t).toHaveLength(0);
  });
});
