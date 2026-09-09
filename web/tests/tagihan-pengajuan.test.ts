/**
 * TAGIHAN PENGAJUAN — DITURUNKAN, TIDAK DISIMPAN (spec C2 P2).
 *
 * Fungsi murni, jadi seluruh berkas ini berjalan tanpa basis data. Yang dijaga:
 * tagihan mengikuti tarif pada TANGGAL SESI, dan ketidaktahuan tidak pernah
 * diam-diam menjadi nol.
 */
import { describe, it, expect } from "vitest";
import { hitungTagihanPengajuan } from "@/lib/tagihan/pengajuan";

const VARIAN = "v1";

const TARIF = [
  { variantId: VARIAN, hargaKlien: 179_000, berlakuSejak: "2026-01-01" },
  // Kenaikan yang berlaku BELAKANGAN — inilah yang tidak boleh menggeser
  // tagihan sesi yang tanggalnya lebih awal.
  { variantId: VARIAN, hargaKlien: 199_000, berlakuSejak: "2026-10-01" },
];

const TARIF_TRANSPORT = [
  { jenjang: "0_5" as const, tarifKlien: 0, berlakuSejak: "2026-01-01" },
  { jenjang: "5_10" as const, tarifKlien: 15_000, berlakuSejak: "2026-01-01" },
];

describe("tarif dikunci pada TANGGAL SESI", () => {
  it("sesi September memakai tarif September, bukan tarif Oktober", () => {
    const r = hitungTagihanPengajuan({
      variantId: VARIAN,
      tanggal: "2026-09-20",
      jenjang: "0_5",
      tarif: TARIF,
      tarifTransport: TARIF_TRANSPORT,
    });
    expect(r.layanan).toBe(179_000);
    expect(r.total).toBe(179_000);
  });

  it("sesi Oktober memakai tarif yang sudah naik", () => {
    const r = hitungTagihanPengajuan({
      variantId: VARIAN,
      tanggal: "2026-10-05",
      jenjang: "0_5",
      tarif: TARIF,
      tarifTransport: TARIF_TRANSPORT,
    });
    expect(r.layanan).toBe(199_000);
  });

  it("tarif yang BELUM berlaku pada tanggal sesi diabaikan sepenuhnya", () => {
    const r = hitungTagihanPengajuan({
      variantId: VARIAN,
      tanggal: "2025-12-31",
      jenjang: "0_5",
      tarif: TARIF,
      tarifTransport: TARIF_TRANSPORT,
    });
    expect(r.layanan).toBeNull();
    expect(r.total).toBeNull();
  });
});

describe("transport ikut ditagihkan", () => {
  it("jenjang berbayar dijumlahkan ke total", () => {
    const r = hitungTagihanPengajuan({
      variantId: VARIAN,
      tanggal: "2026-09-20",
      jenjang: "5_10",
      tarif: TARIF,
      tarifTransport: TARIF_TRANSPORT,
    });
    expect(r.transport).toBe(15_000);
    expect(r.total).toBe(194_000);
  });

  it("jenjang 0–5 km bertarif NOL tetap menghasilkan total yang lengkap", () => {
    // Nol yang SAH berbeda dari nol yang berarti "tidak tahu". Subsidi soft
    // launch membuat jenjang terdekat benar-benar gratis bagi klien, dan
    // memperlakukannya sebagai "belum diketahui" akan menahan tagihan yang
    // sebenarnya sudah lengkap.
    const r = hitungTagihanPengajuan({
      variantId: VARIAN,
      tanggal: "2026-09-20",
      jenjang: "0_5",
      tarif: TARIF,
      tarifTransport: TARIF_TRANSPORT,
    });
    expect(r.transport).toBe(0);
    expect(r.total).toBe(179_000);
  });
});

describe("ketidaktahuan TIDAK PERNAH menjadi nol", () => {
  it("jenjang belum diketahui: total null, bukan harga layanan saja", () => {
    // Koordinat mitra atau alamat klien belum lengkap. Menagihkan harga
    // layanan saja berarti klien membayar kurang lalu ditagih lagi — dan
    // tagihan susulan adalah cara tercepat kehilangan kepercayaan orang.
    const r = hitungTagihanPengajuan({
      variantId: VARIAN,
      tanggal: "2026-09-20",
      jenjang: null,
      tarif: TARIF,
      tarifTransport: TARIF_TRANSPORT,
    });
    expect(r.layanan).toBe(179_000);
    expect(r.transport).toBeNull();
    expect(r.total).toBeNull();
  });

  it("jenjang tanpa baris tarif: total null", () => {
    const r = hitungTagihanPengajuan({
      variantId: VARIAN,
      tanggal: "2026-09-20",
      jenjang: "10_15",
      tarif: TARIF,
      tarifTransport: TARIF_TRANSPORT,
    });
    expect(r.transport).toBeNull();
    expect(r.total).toBeNull();
  });

  it(">20 km tanpa tarif khusus: MENUNGGU owner, bukan Rp0", () => {
    // `di_atas_20` PUNYA tarif dasar sejak migrasi `tarif_dasar_di_atas_20`.
    // Uji ini lulus bukan karena strukturnya melarang baris `di_atas_20`,
    // melainkan semata karena fixture `TARIF_TRANSPORT` di atas kebetulan
    // tidak memuatnya — jadi hasilnya tetap `null` seperti tarif dasar mana
    // pun yang belum ditetapkan owner.
    const r = hitungTagihanPengajuan({
      variantId: VARIAN,
      tanggal: "2026-09-20",
      jenjang: "di_atas_20",
      tarif: TARIF,
      tarifTransport: TARIF_TRANSPORT,
    });
    expect(r.menungguTarifKhusus).toBe(true);
    expect(r.total).toBeNull();
  });

  it(">20 km DENGAN tarif khusus yang sudah ditetapkan owner: masuk total", () => {
    const r = hitungTagihanPengajuan({
      variantId: VARIAN,
      tanggal: "2026-09-20",
      jenjang: "di_atas_20",
      transportKhusus: 75_000,
      tarif: TARIF,
      tarifTransport: TARIF_TRANSPORT,
    });
    expect(r.menungguTarifKhusus).toBe(false);
    expect(r.total).toBe(254_000);
  });
});

describe("honor mitra tidak pernah lewat lapisan ini", () => {
  it("rincian tagihan tidak punya medan honor sama sekali", () => {
    // Yang dilihat klien tidak boleh memuat honor mitra, dan cara paling kuat
    // menjaminnya adalah bentuk datanya sendiri: tidak ada medannya.
    const r = hitungTagihanPengajuan({
      variantId: VARIAN,
      tanggal: "2026-09-20",
      jenjang: "0_5",
      tarif: TARIF,
      tarifTransport: TARIF_TRANSPORT,
    });
    expect(Object.keys(r).sort()).toEqual(
      ["jenjang", "layanan", "menungguTarifKhusus", "sebab", "total", "transport"].sort(),
    );
  });
});
