import { describe, it, expect } from "vitest";
import {
  tarifPadaTanggal,
  hitungRekap,
  type TarifRingkas,
  type SesiRekap,
  type TandaBayar,
  type RekapPekan,
  type TransportKhususRingkas,
} from "@/lib/owner/rekap";
import type { TarifTransportRingkas } from "@/lib/transport/tarif";

// ============================================================================
// Fungsi rekap adalah fungsi MURNI — tanpa I/O, tanpa DB, tanpa jam. Seluruh
// berkas ini berjalan tanpa Supabase. Itu disengaja: kalkulasi uang harus bisa
// diuji habis-habisan dengan puluhan kasus batas, dan itu mustahil bila setiap
// kasus menuntut perjalanan ke Postgres.
// ============================================================================

const tarif = (o: Partial<TarifRingkas>): TarifRingkas => ({
  id: "r1", variantId: "svc-massage", hargaKlien: 500_000, hargaCoret: null, honorMitra: 200_000,
  berlakuSejak: "2026-01-01", ...o,
});

// `serviceId` dan `variantId` sengaja berbagi string opaque yang sama di sini
// ("svc-massage" dst.): fungsi rekap adalah fungsi MURNI yang tidak tahu-menahu
// bentuk UUID sungguhan, dan pencocokan tarif kini lewat `variantId` — bukan
// `serviceId`, yang tetap dibawa tipe ini untuk pengelompokan tampilan.
// `jenjang: null` secara BAWAAN — Ruling 14: sesi TANPA jenjang berarti
// jaraknya belum pernah diketahui (data lama sebelum kolom ini lahir, atau
// mitra belum ditentukan saat sesi dicatat), BUKAN transport gratis. Seluruh
// test lama di berkas ini yang tidak menyebut `jenjang` sama sekali karena itu
// tetap lulus tanpa perlu disentuh — komponen transportnya nol, tetapi
// honor VARIAN-nya tetap utuh dan sesinya TIDAK jatuh sebagai tak-bertarif.
// Lihat komentar di `hitungRekap()` (lib/owner/rekap.ts) untuk alasan penuh.
const sesi = (o: Partial<SesiRekap>): SesiRekap => ({
  id: "s1", serviceId: "svc-massage", variantId: "svc-massage",
  namaLayanan: "Sankalpa Fertility Massage",
  partnerId: "p-ananda", namaMitra: "Bidan Ananda", tanggal: "2026-08-26",
  status: "selesai", clientPackageId: null, selesaiPada: null, jenjang: null, ...o,
});

const tarifTransport = (o: Partial<TarifTransportRingkas>): TarifTransportRingkas => ({
  id: "tt1", jenjang: "5_10", tarifKlien: 20_000, honorMitra: 30_000,
  berlakuSejak: "2026-01-01", ...o,
});

// Senin 2026-08-24 .. Minggu 2026-08-30
const SENIN = "2026-08-24";

describe("tarifPadaTanggal", () => {
  const daftar = [
    tarif({ id: "r-lama", berlakuSejak: "2026-01-01", hargaKlien: 500_000, honorMitra: 200_000 }),
    tarif({ id: "r-baru", berlakuSejak: "2026-08-01", hargaKlien: 600_000, honorMitra: 250_000 }),
    tarif({ id: "r-lain", variantId: "svc-yoga", berlakuSejak: "2026-01-01", hargaKlien: 300_000, honorMitra: 120_000 }),
  ];

  it("memilih berlaku_sejak TERBESAR yang <= tanggal sesi", () => {
    expect(tarifPadaTanggal(daftar, "svc-massage", "2026-08-26")?.id).toBe("r-baru");
    expect(tarifPadaTanggal(daftar, "svc-massage", "2026-07-31")?.id).toBe("r-lama");
  });

  it("kasus batas: sesi TEPAT pada berlaku_sejak memakai tarif BARU", () => {
    expect(tarifPadaTanggal(daftar, "svc-massage", "2026-08-01")?.id).toBe("r-baru");
    // sehari sebelumnya masih tarif lama — pembatasnya tajam, bukan kabur
    expect(tarifPadaTanggal(daftar, "svc-massage", "2026-07-31")?.id).toBe("r-lama");
  });

  it("tidak mencampur tarif antar varian", () => {
    expect(tarifPadaTanggal(daftar, "svc-yoga", "2026-08-26")?.hargaKlien).toBe(300_000);
  });

  it("sesi lebih tua dari tarif paling awal mengembalikan null, bukan nol", () => {
    expect(tarifPadaTanggal(daftar, "svc-massage", "2025-12-31")).toBeNull();
  });

  it("varian yang belum punya tarif sama sekali mengembalikan null", () => {
    expect(tarifPadaTanggal(daftar, "svc-belum-ada", "2026-08-26")).toBeNull();
  });

  it("daftar tarif kosong mengembalikan null", () => {
    expect(tarifPadaTanggal([], "svc-massage", "2026-08-26")).toBeNull();
  });

  it("hasilnya tidak bergantung pada URUTAN daftar masukan", () => {
    const terbalik = [...daftar].reverse();
    expect(tarifPadaTanggal(terbalik, "svc-massage", "2026-08-26")?.id).toBe("r-baru");
    expect(tarifPadaTanggal(terbalik, "svc-massage", "2026-07-31")?.id).toBe("r-lama");
  });

  // Constraint UNIQUE (service_id, berlaku_sejak) baru dipasang di Task 1 dan
  // tidak ada `created_at` pemecah seri. Selama data kembar masih mungkin ada,
  // fungsi ini WAJIB tetap deterministik — jangan sampai rekap yang sama
  // menghasilkan angka berbeda antar-render hanya karena PostgREST memulangkan
  // baris dengan urutan berbeda.
  it("tarif kembar pada tanggal sama dipecah deterministik (bukan bergantung urutan)", () => {
    const kembarA = tarif({ id: "aaa", berlakuSejak: "2026-08-01", honorMitra: 111_000 });
    const kembarB = tarif({ id: "bbb", berlakuSejak: "2026-08-01", honorMitra: 999_000 });
    const satu = tarifPadaTanggal([kembarA, kembarB], "svc-massage", "2026-08-26");
    const dua = tarifPadaTanggal([kembarB, kembarA], "svc-massage", "2026-08-26");
    expect(satu?.id).toBe(dua?.id);
    expect(satu?.honorMitra).toBe(dua?.honorMitra);
  });

  it("tidak memutasi daftar tarif yang diberikan (fungsi murni)", () => {
    const asli = [...daftar];
    tarifPadaTanggal(daftar, "svc-massage", "2026-08-26");
    expect(daftar).toEqual(asli);
  });
});

describe("hitungRekap — pengelompokan pekan", () => {
  it("mengelompokkan sesi Senin s.d. Minggu menurut kalender Jakarta", () => {
    const r = hitungRekap({
      tarif: [tarif({})],
      sesi: [
        sesi({ id: "a", tanggal: "2026-08-24" }), // Senin
        sesi({ id: "b", tanggal: "2026-08-30" }), // Minggu, pekan yang SAMA
        sesi({ id: "c", tanggal: "2026-08-31" }), // Senin, pekan BERIKUTNYA
      ],
      tanda: [],
    });
    expect(r.map((p) => p.senin)).toEqual(["2026-08-31", "2026-08-24"]);
    expect(r.find((p) => p.senin === SENIN)!.jumlahSesi).toBe(2);
    expect(r.find((p) => p.senin === "2026-08-31")!.jumlahSesi).toBe(1);
  });

  it("pekan terbaru berada di ATAS", () => {
    const r = hitungRekap({
      tarif: [tarif({})],
      sesi: [
        sesi({ id: "a", tanggal: "2026-07-06" }),
        sesi({ id: "b", tanggal: "2026-08-24" }),
        sesi({ id: "c", tanggal: "2026-08-03" }),
      ],
      tanda: [],
    });
    expect(r.map((p) => p.senin)).toEqual(["2026-08-24", "2026-08-03", "2026-07-06"]);
  });

  it("menyertakan label rentang pekan", () => {
    const r = hitungRekap({ tarif: [tarif({})], sesi: [sesi({})], tanda: [] });
    expect(r[0].rentang).toBe("24 – 30 Agu 2026");
  });

  it("pekan tanpa sesi tidak muncul", () => {
    const r = hitungRekap({
      tarif: [tarif({})],
      sesi: [sesi({ id: "a", tanggal: "2026-07-06" }), sesi({ id: "b", tanggal: "2026-08-24" })],
      tanda: [],
    });
    // ada tujuh pekan di antaranya; tidak satu pun boleh muncul sebagai baris kosong
    expect(r).toHaveLength(2);
  });

  it("tanpa sesi sama sekali menghasilkan daftar kosong, bukan lempar", () => {
    expect(hitungRekap({ tarif: [tarif({})], sesi: [], tanda: [] })).toEqual([]);
  });
});

describe("hitungRekap — hanya sesi selesai", () => {
  it("sesi terjadwal & batal TIDAK masuk rekap", () => {
    const r = hitungRekap({
      tarif: [tarif({})],
      sesi: [
        sesi({ id: "a", status: "selesai" }),
        sesi({ id: "b", status: "terjadwal" }),
        sesi({ id: "c", status: "dibatalkan_padma" }),
      ],
      tanda: [],
    });
    expect(r).toHaveLength(1);
    expect(r[0].jumlahSesi).toBe(1);
    expect(r[0].totalHonor).toBe(200_000);
  });

  it("pekan yang HANYA berisi sesi belum selesai tidak muncul sama sekali", () => {
    const r = hitungRekap({
      tarif: [tarif({})],
      sesi: [sesi({ id: "a", status: "terjadwal" }), sesi({ id: "b", status: "dibatalkan_padma" })],
      tanda: [],
    });
    expect(r).toEqual([]);
  });
});

describe("hitungRekap — honor memakai tarif pada TANGGAL SESI", () => {
  const daftar = [
    tarif({ id: "r-lama", berlakuSejak: "2026-01-01", hargaKlien: 500_000, honorMitra: 200_000 }),
    tarif({ id: "r-baru", berlakuSejak: "2026-08-24", hargaKlien: 600_000, honorMitra: 250_000 }),
  ];

  it("pekan lama memakai tarif lama, pekan baru memakai tarif baru", () => {
    const r = hitungRekap({
      tarif: daftar,
      sesi: [
        sesi({ id: "lama", tanggal: "2026-08-17" }), // pekan 17–23 Agu
        sesi({ id: "baru", tanggal: "2026-08-26" }), // pekan 24–30 Agu
      ],
      tanda: [],
    });
    const pekanLama = r.find((p) => p.senin === "2026-08-17")!;
    const pekanBaru = r.find((p) => p.senin === "2026-08-24")!;
    expect(pekanLama.totalHonor).toBe(200_000);
    expect(pekanLama.totalHarga).toBe(500_000);
    expect(pekanBaru.totalHonor).toBe(250_000);
    expect(pekanBaru.totalHarga).toBe(600_000);
  });

  // Ini jantung spec bagian 5: menaikkan tarif TIDAK BOLEH menggeser rekap
  // pekan yang sudah lewat (dan mungkin sudah dibayar).
  it("menambahkan tarif baru tidak mengubah satu angka pun di pekan lama", () => {
    const masukan = {
      sesi: [sesi({ id: "lama", tanggal: "2026-08-17" })],
      tanda: [] as TandaBayar[],
    };
    const sebelum = hitungRekap({ ...masukan, tarif: [daftar[0]] });
    const sesudah = hitungRekap({ ...masukan, tarif: daftar });
    expect(sesudah).toEqual(sebelum);
    expect(sesudah[0].totalHonor).toBe(200_000);
  });

  it("kasus batas: sesi TEPAT pada tanggal berlaku memakai tarif baru", () => {
    const r = hitungRekap({
      tarif: daftar,
      sesi: [sesi({ id: "tepat", tanggal: "2026-08-24" })],
      tanda: [],
    });
    expect(r[0].totalHonor).toBe(250_000);
  });

  it("sehari sebelum tanggal berlaku masih memakai tarif lama", () => {
    const r = hitungRekap({
      tarif: daftar,
      sesi: [sesi({ id: "sehari", tanggal: "2026-08-23" })],
      tanda: [],
    });
    expect(r[0].totalHonor).toBe(200_000);
  });
});

describe("hitungRekap — sesi tak-bertarif DILAPORKAN, bukan dihitung nol diam-diam", () => {
  const daftar = [tarif({ id: "r1", berlakuSejak: "2026-08-01" })];

  it("sesi lebih tua dari tarif paling awal masuk daftar sesiTakBertarif", () => {
    const r = hitungRekap({
      tarif: daftar,
      sesi: [sesi({ id: "yatim", tanggal: "2026-07-15" })],
      tanda: [],
    });
    expect(r).toHaveLength(1);
    expect(r[0].sesiTakBertarif).toHaveLength(1);
    expect(r[0].sesiTakBertarif[0]).toMatchObject({
      id: "yatim",
      tanggal: "2026-07-15",
      namaLayanan: "Sankalpa Fertility Massage",
      namaMitra: "Bidan Ananda",
    });
  });

  it("sesi tak-bertarif tidak menyumbang nol ke honor — ia tidak menyumbang APA PUN", () => {
    const r = hitungRekap({
      tarif: daftar,
      sesi: [sesi({ id: "yatim", tanggal: "2026-07-15" })],
      tanda: [],
    });
    expect(r[0].totalHonor).toBe(0);
    expect(r[0].totalHarga).toBe(0);
    expect(r[0].margin).toBe(0);
    // …tetapi pekannya TETAP muncul dan sesinya TETAP terhitung. Menghilangkan
    // pekan ini adalah persis "uang hilang tanpa jejak" yang dilarang spec.
    expect(r[0].jumlahSesi).toBe(1);
  });

  it("mitra dengan sesi tak-bertarif tetap muncul di perMitra dengan hitungan jujur", () => {
    const r = hitungRekap({
      tarif: daftar,
      sesi: [
        sesi({ id: "bertarif", tanggal: "2026-08-05" }),
        sesi({ id: "yatim", variantId: "svc-belum-ada", tanggal: "2026-08-06" }),
      ],
      tanda: [],
    });
    const baris = r[0].perMitra[0];
    expect(baris.jumlahSesi).toBe(2);          // dua sesi memang dikerjakan
    expect(baris.jumlahTakBertarif).toBe(1);   // satu di antaranya tak bisa dihargai
    expect(baris.totalHonor).toBe(200_000);    // honor hanya dari yang bertarif
  });

  it("mitra yang SELURUH sesinya tak-bertarif tidak boleh lenyap dari perMitra", () => {
    const r = hitungRekap({
      tarif: daftar,
      sesi: [
        sesi({ id: "a", partnerId: "p-ananda", namaMitra: "Bidan Ananda", tanggal: "2026-08-05" }),
        sesi({ id: "b", partnerId: "p-sari", namaMitra: "Bidan Sari", variantId: "svc-belum-ada", tanggal: "2026-08-06" }),
      ],
      tanda: [],
    });
    expect(r[0].perMitra.map((m) => m.nama)).toEqual(["Bidan Ananda", "Bidan Sari"]);
    const sari = r[0].perMitra.find((m) => m.nama === "Bidan Sari")!;
    expect(sari.totalHonor).toBe(0);
    expect(sari.jumlahSesi).toBe(1);
    expect(sari.jumlahTakBertarif).toBe(1);
  });

  it("tanpa sesi yatim, sesiTakBertarif berupa array kosong", () => {
    const r = hitungRekap({
      tarif: daftar,
      sesi: [sesi({ id: "ok", tanggal: "2026-08-05" })],
      tanda: [],
    });
    expect(r[0].sesiTakBertarif).toEqual([]);
    expect(r[0].perMitra[0].jumlahTakBertarif).toBe(0);
  });
});

describe("hitungRekap — agregasi per mitra & margin per pekan", () => {
  const daftar = [
    tarif({ id: "r-massage", variantId: "svc-massage", hargaKlien: 500_000, honorMitra: 200_000 }),
    tarif({ id: "r-yoga", variantId: "svc-yoga", hargaKlien: 300_000, honorMitra: 120_000 }),
  ];

  const dua = hitungRekap({
    tarif: daftar,
    sesi: [
      sesi({ id: "a1", partnerId: "p-ananda", namaMitra: "Bidan Ananda", variantId: "svc-massage", tanggal: "2026-08-24" }),
      sesi({ id: "a2", partnerId: "p-ananda", namaMitra: "Bidan Ananda", variantId: "svc-yoga", tanggal: "2026-08-26" }),
      sesi({ id: "b1", partnerId: "p-sari", namaMitra: "Bidan Sari", variantId: "svc-massage", tanggal: "2026-08-27" }),
    ],
    tanda: [],
  });

  it("honor dijumlahkan PER MITRA per pekan", () => {
    const ananda = dua[0].perMitra.find((m) => m.partnerId === "p-ananda")!;
    const sari = dua[0].perMitra.find((m) => m.partnerId === "p-sari")!;
    expect(ananda.jumlahSesi).toBe(2);
    expect(ananda.totalHonor).toBe(320_000); // 200.000 + 120.000
    expect(sari.jumlahSesi).toBe(1);
    expect(sari.totalHonor).toBe(200_000);
  });

  it("total pekan adalah jumlah seluruh mitra", () => {
    expect(dua[0].totalHonor).toBe(520_000);
    expect(dua[0].totalHarga).toBe(1_300_000); // 500k + 300k + 500k
  });

  // Spec keputusan #6: margin adalah angka PADMA — per PEKAN, bukan per mitra.
  it("margin = Σharga − Σhonor per PEKAN, dan tidak ada margin per mitra", () => {
    expect(dua[0].margin).toBe(780_000);
    expect(dua[0].margin).toBe(dua[0].totalHarga - dua[0].totalHonor);
    for (const m of dua[0].perMitra) {
      expect(m).not.toHaveProperty("margin");
      expect(m).not.toHaveProperty("totalHarga");
    }
  });

  it("perMitra terurut menurut nama supaya rekap tidak berubah-ubah antar render", () => {
    const acak = hitungRekap({
      tarif: daftar,
      sesi: [
        sesi({ id: "z", partnerId: "p-z", namaMitra: "Bidan Zahra", tanggal: "2026-08-24" }),
        sesi({ id: "a", partnerId: "p-a", namaMitra: "Bidan Ayu", tanggal: "2026-08-25" }),
        sesi({ id: "m", partnerId: "p-m", namaMitra: "Bidan Maya", tanggal: "2026-08-26" }),
      ],
      tanda: [],
    });
    expect(acak[0].perMitra.map((m) => m.nama)).toEqual([
      "Bidan Ayu", "Bidan Maya", "Bidan Zahra",
    ]);
  });

  it("dua mitra bernama sama tetap terpisah karena dikelompokkan menurut id", () => {
    const r = hitungRekap({
      tarif: daftar,
      sesi: [
        sesi({ id: "x", partnerId: "p-1", namaMitra: "Bidan Sari", tanggal: "2026-08-24" }),
        sesi({ id: "y", partnerId: "p-2", namaMitra: "Bidan Sari", tanggal: "2026-08-25" }),
      ],
      tanda: [],
    });
    expect(r[0].perMitra).toHaveLength(2);
    expect(r[0].perMitra.map((m) => m.partnerId).sort()).toEqual(["p-1", "p-2"]);
  });
});

describe("hitungRekap — sesi berpaket DAN sesi lepas sama-sama menghasilkan honor", () => {
  // Bidan bekerja pada keduanya. Memakai `client_package_id` sebagai penyaring
  // akan menghapus honor yang sudah benar-benar dikerjakan.
  it("sesi dalam paket ikut dihitung", () => {
    const r = hitungRekap({
      tarif: [tarif({})],
      sesi: [
        sesi({ id: "paket", clientPackageId: "pkg-1", tanggal: "2026-08-24" }),
        sesi({ id: "lepas", clientPackageId: null, tanggal: "2026-08-25" }),
      ],
      tanda: [],
    });
    expect(r[0].jumlahSesi).toBe(2);
    expect(r[0].perMitra[0].totalHonor).toBe(400_000);
    expect(r[0].totalHarga).toBe(1_000_000);
  });

  it("pekan yang HANYA berisi sesi berpaket tetap menghasilkan honor", () => {
    const r = hitungRekap({
      tarif: [tarif({})],
      sesi: [sesi({ id: "paket", clientPackageId: "pkg-1" })],
      tanda: [],
    });
    expect(r[0].totalHonor).toBe(200_000);
  });
});

// ---------------------------------------------------------------------------
// hitungRekap — komponen TRANSPORT (Task 9)
// ---------------------------------------------------------------------------
// Tarif transport (Task 8) hidup di `transport_rates` (per jenjang, sejajar
// `variant_rates`) dan `transport_khusus` (per SESI, hanya untuk `di_atas_20`).
// Honor mitra & harga klien wajib memuat KEDUANYA — honor varian SENDIRIAN
// bukan lagi honor penuh sesi sejak sesi punya jarak.
describe("hitungRekap — honor memuat komponen transport (Task 9)", () => {
  it("honor mitra memuat komponen transport menurut TANGGAL SESI", () => {
    const r = hitungRekap({
      sesi: [sesi({ jenjang: "5_10" })],
      tarif: [tarif({})],
      tarifTransport: [tarifTransport({})],
      tanda: [],
    });
    // tarif({}) = harga 500.000 / honor 200.000; tarifTransport({}) = tarif
    // klien 20.000 / honor mitra 30.000.
    expect(r[0].perMitra[0].totalHonor).toBe(200_000 + 30_000);
    expect(r[0].totalHarga).toBe(500_000 + 20_000);
  });

  it("menaikkan tarif transport TIDAK menggeser rekap pekan lalu", () => {
    const lama = tarifTransport({ id: "tt-lama", berlakuSejak: "2020-01-01" });
    const baru = tarifTransport({
      id: "tt-baru", tarifKlien: 99_000, honorMitra: 99_000, berlakuSejak: "2026-09-01",
    });
    const sesiLama = sesi({ jenjang: "5_10", tanggal: "2026-08-26" }); // < 2026-09-01
    const dasar = { sesi: [sesiLama], tarif: [tarif({})], tanda: [] };

    const sebelum = hitungRekap({ ...dasar, tarifTransport: [lama] });
    const sesudah = hitungRekap({ ...dasar, tarifTransport: [lama, baru] });

    expect(sebelum[0].perMitra[0].totalHonor).toBe(sesudah[0].perMitra[0].totalHonor);
    expect(sesudah[0].perMitra[0].totalHonor).toBe(200_000 + 30_000); // tarif lama, bukan 99.000
  });

  it("subsidi 0–5 km muncul sebagai selisih, bukan kolom", () => {
    const r = hitungRekap({
      sesi: [sesi({ jenjang: "0_5" })],
      tarif: [tarif({})],
      tarifTransport: [tarifTransport({ jenjang: "0_5", tarifKlien: 0, honorMitra: 10_000 })],
      tanda: [],
    });
    // Klien membayar Rp0 untuk transport, mitra menerima Rp10.000 → margin
    // pekan berkurang 10.000 dari yang tanpa transport. Tidak ada medan
    // "subsidi" tersendiri mana pun di BarisMitra — ia HANYA selisih ini.
    expect(r[0].margin).toBe(500_000 - 200_000 - 10_000);
  });

  it("sesi di_atas_20 tanpa tarif khusus TIDAK dihitung sebagai transport nol (Ruling 14)", () => {
    // Nol yang salah lebih berbahaya daripada nol yang jujur: ia terlihat
    // benar. Karena itu SELURUH honor sesi ini — termasuk honor varian yang
    // sebenarnya valid — jatuh sebagai tak-bertarif, sejajar persis perlakuan
    // tarif varian yang hilang.
    const r = hitungRekap({
      sesi: [sesi({ jenjang: "di_atas_20" })],
      tarif: [tarif({})],
      tarifTransport: [],
      transportKhusus: [],
      tanda: [],
    });
    expect(r[0].sesiTakBertarif).toHaveLength(1);
    expect(r[0].sesiTakBertarif[0].sebab).toBe("transport");
    expect(r[0].perMitra[0].jumlahTakBertarif).toBe(1);
    expect(r[0].perMitra[0].totalHonor).toBe(0);
    // Sejajar PERSIS perlakuan tarif varian yang hilang: honor VARIAN yang
    // sebenarnya valid pun ikut tidak disumkan — bukan hanya baris per mitra,
    // total pekan juga tetap nol.
    expect(r[0].totalHonor).toBe(0);
    expect(r[0].totalHarga).toBe(0);
  });

  it("sesi di_atas_20 DENGAN tarif khusus dihitung dari transport_khusus, bukan rate card", () => {
    const khusus: TransportKhususRingkas = { sessionId: "s1", tarifKlien: 80_000, honorMitra: 120_000 };
    const r = hitungRekap({
      sesi: [sesi({ id: "s1", jenjang: "di_atas_20" })],
      tarif: [tarif({})],
      tarifTransport: [],
      transportKhusus: [khusus],
      tanda: [],
    });
    expect(r[0].sesiTakBertarif).toHaveLength(0);
    expect(r[0].perMitra[0].totalHonor).toBe(200_000 + 120_000);
    expect(r[0].totalHarga).toBe(500_000 + 80_000);
  });

  it("jenjang yang tarifnya belum mencakup tanggal sesi jatuh tak-bertarif (sebab transport)", () => {
    const r = hitungRekap({
      sesi: [sesi({ jenjang: "5_10", tanggal: "2019-01-01" })],
      tarif: [tarif({ berlakuSejak: "2010-01-01" })], // tarif varian SUDAH mencakup tanggal sesi
      tarifTransport: [tarifTransport({ berlakuSejak: "2026-01-01" })], // tarif transport BELUM
      tanda: [],
    });
    expect(r[0].sesiTakBertarif[0].sebab).toBe("transport");
    expect(r[0].perMitra[0].totalHonor).toBe(0);
  });

  it("sesi TANPA jenjang (null): transport nol, TAPI honor varian tetap utuh — bukan tertunda", () => {
    // Keputusan didokumentasikan di `hitungRekap()`: `jenjang === null` berarti
    // JARAK BELUM DIKETAHUI (sesi lama, sebelum kolom ini ada), bukan transport
    // gratis. Menandainya tak-bertarif akan membuat SETIAP sesi lama yang
    // memang tidak pernah diisi retroaktif kehilangan honor variannya yang
    // sudah sah.
    const r = hitungRekap({
      sesi: [sesi({ jenjang: null })],
      tarif: [tarif({})],
      tarifTransport: [tarifTransport({})],
      tanda: [],
    });
    expect(r[0].perMitra[0].totalHonor).toBe(200_000);
    expect(r[0].sesiTakBertarif).toHaveLength(0);
  });

  it("tarif varian DAN tarif transport sama-sama hilang: sebab bertuding 'varian' (yang paling mendasar)", () => {
    const r = hitungRekap({
      sesi: [sesi({ jenjang: "5_10", tanggal: "2019-01-01" })],
      tarif: [tarif({ berlakuSejak: "2026-01-01" })], // lebih baru dari sesi
      tarifTransport: [],
      tanda: [],
    });
    expect(r[0].sesiTakBertarif[0].sebab).toBe("varian");
  });

  // --- Ruling 18 (fix round 1): tarifKlien transport sesi BERPAKET tidak
  // pernah masuk totalHarga — paket dibayar klien lewat harga PAKET yang
  // tetap, bukan per sesi, dan struktur itu belum punya spec "transport
  // tambahan di atas harga paket". Honor mitra (yang benar-benar menempuh
  // jaraknya) TETAP dibayar penuh baik sesi lepas maupun berpaket.
  it("sesi BERPAKET berjenjang: honor transport tetap dibayar, tapi tarifKlien-nya TIDAK masuk totalHarga (Ruling 18)", () => {
    const r = hitungRekap({
      sesi: [sesi({ jenjang: "5_10", clientPackageId: "pkg-1" })],
      tarif: [tarif({})],
      tarifTransport: [tarifTransport({})], // tarifKlien 20.000, honorMitra 30.000
      tanda: [],
    });
    // Honor mitra: honor varian + honor transport, PERSIS sama seperti sesi
    // lepas — bidan menempuh jarak yang sama nyatanya.
    expect(r[0].perMitra[0].totalHonor).toBe(200_000 + 30_000);
    expect(r[0].totalHonor).toBe(200_000 + 30_000);
    // Harga klien: HANYA harga varian. tarifKlien transport (20.000) TIDAK
    // ikut — paket tidak menagih transport tambahan per sesi.
    expect(r[0].totalHarga).toBe(500_000);
  });

  it("sesi LEPAS berjenjang (kontrol): tarifKlien transport TETAP masuk totalHarga", () => {
    const r = hitungRekap({
      sesi: [sesi({ jenjang: "5_10", clientPackageId: null })],
      tarif: [tarif({})],
      tarifTransport: [tarifTransport({})],
      tanda: [],
    });
    expect(r[0].totalHarga).toBe(500_000 + 20_000);
  });
});

describe("hitungRekap — tanda bayar", () => {
  const dasar = {
    tarif: [tarif({})],
    sesi: [
      sesi({ id: "a", partnerId: "p-ananda", namaMitra: "Bidan Ananda", tanggal: "2026-08-24" }),
      sesi({ id: "b", partnerId: "p-sari", namaMitra: "Bidan Sari", tanggal: "2026-08-25" }),
    ],
  };

  it("tanpa tanda, seluruh baris belum dibayar", () => {
    const r = hitungRekap({ ...dasar, tanda: [] });
    for (const m of r[0].perMitra) {
      expect(m.sudahDibayar).toBe(false);
      expect(m.dibayarPada).toBeNull();
    }
  });

  it("tanda hanya menyentuh mitra & pekan yang tepat", () => {
    const r = hitungRekap({
      ...dasar,
      tanda: [{ partnerId: "p-ananda", senin: SENIN, dibayarPada: "2026-08-29T03:00:00.000Z" }],
    });
    const ananda = r[0].perMitra.find((m) => m.partnerId === "p-ananda")!;
    const sari = r[0].perMitra.find((m) => m.partnerId === "p-sari")!;
    expect(ananda.sudahDibayar).toBe(true);
    expect(ananda.dibayarPada).toBe("2026-08-29T03:00:00.000Z");
    expect(sari.sudahDibayar).toBe(false);
  });

  // week_start bukan-Senin baru ditolak constraint di Task 1; baris lama yang
  // terlanjur yatim tidak boleh diam-diam mewarnai pekan mana pun.
  it("tanda dengan pekan yang tidak cocok tidak menandai apa pun", () => {
    const r = hitungRekap({
      ...dasar,
      tanda: [{ partnerId: "p-ananda", senin: "2026-08-17", dibayarPada: "2026-08-20T03:00:00.000Z" }],
    });
    expect(r[0].perMitra.every((m) => m.sudahDibayar === false)).toBe(true);
  });

  it("tanda untuk mitra yang tidak punya sesi di pekan itu tidak melahirkan baris hantu", () => {
    const r = hitungRekap({
      ...dasar,
      tanda: [{ partnerId: "p-entah", senin: SENIN, dibayarPada: "2026-08-29T03:00:00.000Z" }],
    });
    expect(r[0].perMitra).toHaveLength(2);
    expect(r[0].perMitra.map((m) => m.partnerId).sort()).toEqual(["p-ananda", "p-sari"]);
  });

  // Kasus nyata: sesi diselesaikan SESUDAH pekan itu ditandai dibayar. Honornya
  // bertambah sementara tandanya sudah ada — angka tidak boleh diam-diam naik
  // di bawah label "sudah dibayar".
  it("menandai sesi yang selesai SESUDAH tanda bayar dipasang", () => {
    const r = hitungRekap({
      tarif: [tarif({})],
      sesi: [
        sesi({ id: "a", tanggal: "2026-08-24", selesaiPada: "2026-08-28T02:00:00.000Z" }),
        sesi({ id: "b", tanggal: "2026-08-25", selesaiPada: "2026-08-31T02:00:00.000Z" }),
      ],
      tanda: [{ partnerId: "p-ananda", senin: SENIN, dibayarPada: "2026-08-29T03:00:00.000Z" }],
    });
    const m = r[0].perMitra[0];
    expect(m.sudahDibayar).toBe(true);
    expect(m.adaSesiSesudahDitandai).toBe(true);
  });

  it("tidak menandai bila seluruh sesi selesai SEBELUM tanda bayar", () => {
    const r = hitungRekap({
      tarif: [tarif({})],
      sesi: [sesi({ id: "a", tanggal: "2026-08-24", selesaiPada: "2026-08-28T02:00:00.000Z" })],
      tanda: [{ partnerId: "p-ananda", senin: SENIN, dibayarPada: "2026-08-29T03:00:00.000Z" }],
    });
    expect(r[0].perMitra[0].adaSesiSesudahDitandai).toBe(false);
  });

  it("baris yang belum ditandai tidak pernah berbendera sesi-susulan", () => {
    const r = hitungRekap({
      tarif: [tarif({})],
      sesi: [sesi({ id: "a", tanggal: "2026-08-24", selesaiPada: "2026-08-31T02:00:00.000Z" })],
      tanda: [],
    });
    expect(r[0].perMitra[0].adaSesiSesudahDitandai).toBe(false);
  });
});

describe("hitungRekap — kemurnian & ketahanan", () => {
  it("tidak memutasi satu pun masukan", () => {
    const masukanTarif = [tarif({})];
    const masukanSesi = [sesi({ id: "b", tanggal: "2026-08-26" }), sesi({ id: "a", tanggal: "2026-08-24" })];
    const masukanTanda: TandaBayar[] = [{ partnerId: "p-ananda", senin: SENIN, dibayarPada: "2026-08-29T03:00:00.000Z" }];
    const salinanTarif = JSON.parse(JSON.stringify(masukanTarif));
    const salinanSesi = JSON.parse(JSON.stringify(masukanSesi));
    const salinanTanda = JSON.parse(JSON.stringify(masukanTanda));

    hitungRekap({ tarif: masukanTarif, sesi: masukanSesi, tanda: masukanTanda });

    expect(masukanTarif).toEqual(salinanTarif);
    expect(masukanSesi).toEqual(salinanSesi);
    expect(masukanTanda).toEqual(salinanTanda);
  });

  it("memanggil dua kali dengan masukan sama menghasilkan hasil identik", () => {
    const arg = {
      tarif: [tarif({})],
      sesi: [sesi({ id: "a", tanggal: "2026-08-24" }), sesi({ id: "b", tanggal: "2026-08-26" })],
      tanda: [] as TandaBayar[],
    };
    expect(hitungRekap(arg)).toEqual(hitungRekap(arg));
  });

  // Fungsi ini MURNI: tidak menyentuh jam, jaringan, maupun DB. Bila suatu saat
  // seseorang menambahkan Date.now() di dalamnya, test ini yang memerahkannya.
  it("tidak membaca jam sistem", () => {
    const arg = {
      tarif: [tarif({})],
      sesi: [sesi({ id: "a", tanggal: "2026-08-24" })],
      tanda: [] as TandaBayar[],
    };
    const asli = Date.now;
    Date.now = () => {
      throw new Error("hitungRekap tidak boleh membaca jam sistem");
    };
    try {
      expect(() => hitungRekap(arg)).not.toThrow();
    } finally {
      Date.now = asli;
    }
  });

  it("tanggal sesi tak sah dilempar, bukan dikelompokkan ke bucket hantu", () => {
    expect(() =>
      hitungRekap({ tarif: [tarif({})], sesi: [sesi({ tanggal: "30-08-2026" })], tanda: [] }),
    ).toThrow();
  });
});

describe("deretPekanTerakhir — sumbu waktu tanpa lubang", async () => {
  const { deretPekanTerakhir } = await import("@/lib/owner/rekap");
  const { awalPekan, geserHari } = await import("@/lib/owner/pekan");

  const HARI = "2026-09-06";
  const SENIN = awalPekan(HARI); // 2026-08-31

  /** Satu RekapPekan minimal — hanya medan yang dipakai grafik yang diisi. */
  function pekan(senin: string, harga: number, honor: number): RekapPekan {
    return {
      senin,
      rentang: senin,
      jumlahSesi: 1,
      perMitra: [],
      totalHonor: honor,
      totalHarga: harga,
      margin: harga - honor,
      sesiTakBertarif: [],
    };
  }

  it("memulangkan tepat `pekan` titik, terlama di kiri", () => {
    const hasil = deretPekanTerakhir([pekan(SENIN, 100, 40)], HARI, 4);
    expect(hasil).toHaveLength(4);
    expect(hasil[hasil.length - 1].senin).toBe(SENIN);
    for (let i = 1; i < hasil.length; i++) {
      expect(hasil[i].senin).toBe(geserHari(hasil[i - 1].senin, 7));
    }
  });

  it("pekan tanpa data menjadi NOL, bukan lompatan", () => {
    // Melompatinya membuat tiga pekan tampil sebagai dua titik dan sumbu
    // waktunya berbohong tanpa satu angka pun yang salah.
    const hasil = deretPekanTerakhir([pekan(SENIN, 100, 40)], HARI, 3);
    expect(hasil.slice(0, 2).every((p) => p.totalHarga === 0)).toBe(true);
    expect(hasil.slice(0, 2).every((p) => p.margin === 0)).toBe(true);
    expect(hasil.slice(0, 2).every((p) => p.jumlahSesi === 0)).toBe(true);
    expect(hasil.slice(0, 2).every((p) => p.totalHonor === 0)).toBe(true);
    expect(hasil.slice(0, 2).every((p) => p.sesiTakBertarif.length === 0)).toBe(true);
    expect(hasil.slice(0, 2).every((p) => p.perMitra.length === 0)).toBe(true);
  });

  it("pekan yang ada dipakai apa adanya, tidak dihitung ulang", () => {
    const asli = pekan(SENIN, 900, 350);
    const hasil = deretPekanTerakhir([asli], HARI, 2);
    expect(hasil[1]).toBe(asli);
  });

  it("pekan di luar jendela diabaikan", () => {
    const jauh = pekan(geserHari(SENIN, -70), 5000, 1000);
    const hasil = deretPekanTerakhir([jauh, pekan(SENIN, 100, 40)], HARI, 3);
    expect(hasil.some((p) => p.totalHarga === 5000)).toBe(false);
  });

  it("rekap kosong tetap memulangkan deret penuh berisi nol", () => {
    const hasil = deretPekanTerakhir([], HARI, 8);
    expect(hasil).toHaveLength(8);
    expect(hasil.every((p) => p.totalHarga === 0)).toBe(true);
  });
});
