import { describe, it, expect } from "vitest";
import { keadaanTagihan, tombolUntuk, type PesananRingkas } from "@/lib/tagihan/keadaan";

const SEKARANG = new Date("2026-11-20T03:00:00Z");
const MASA_DEPAN = "2026-11-21T03:00:00Z";
const MASA_LALU = "2026-11-19T03:00:00Z";

function pesanan(sisip: Partial<PesananRingkas> = {}): PesananRingkas {
  return {
    id: "o1",
    kode: "PSN-261120-AAAAAA",
    status: "menunggu_bayar",
    dibuatPada: "2026-11-19T00:00:00Z",
    kedaluwarsaPada: MASA_DEPAN,
    butuhTinjauanPada: null,
    ...sisip,
  };
}

const DASAR = {
  status: "menunggu_bayar" as const,
  statusBayar: "belum" as const,
  tenggat: null,
  pesanan: [] as PesananRingkas[],
  adaSesi: false,
};

describe("keadaanTagihan: kata keadaan nol rupiah", () => {
  it("pesanan terbuka -> Menunggu pembayaran, tenggat ...", () => {
    const k = keadaanTagihan({ ...DASAR, pesanan: [pesanan()] }, SEKARANG);
    expect(k.kode).toBe("terbuka");
    expect(k.kalimat).toMatch(/^Menunggu pembayaran, tenggat /);
    expect(k.uangMasuk).toBe(false);
  });

  it("pesanan terbuka yang tenggatnya lewat -> Tenggat lewat", () => {
    const k = keadaanTagihan({ ...DASAR, pesanan: [pesanan({ kedaluwarsaPada: MASA_LALU })] }, SEKARANG);
    expect(k.kalimat).toBe("Tenggat lewat");
  });

  it("pesanan kedaluwarsa -> Tenggat lewat", () => {
    const k = keadaanTagihan({ ...DASAR, pesanan: [pesanan({ status: "kedaluwarsa" })] }, SEKARANG);
    expect(k.kalimat).toBe("Tenggat lewat");
  });

  it("menunggu_bayar, pesanan dibatalkan, tanpa uang -> Tagihan ditutup — terbitkan ulang", () => {
    const k = keadaanTagihan({ ...DASAR, pesanan: [pesanan({ status: "dibatalkan" })] }, SEKARANG);
    expect(k.kode).toBe("ditutup");
    expect(k.kalimat).toBe("Tagihan ditutup — terbitkan ulang");
    expect(k.uangMasuk).toBe(false);
  });

  it("pesanan terbaru yang menentukan: lama dibatalkan + baru terbuka -> terbuka", () => {
    const k = keadaanTagihan(
      {
        ...DASAR,
        pesanan: [
          pesanan({ id: "lama", status: "dibatalkan", dibuatPada: "2026-11-18T00:00:00Z" }),
          pesanan({ id: "baru" }),
        ],
      },
      SEKARANG,
    );
    expect(k.kode).toBe("terbuka");
  });

  it("tanda tinjauan -> Pembayaran perlu ditinjau, uang dianggap masuk", () => {
    const k = keadaanTagihan(
      { ...DASAR, pesanan: [pesanan({ status: "kedaluwarsa", butuhTinjauanPada: MASA_LALU })] },
      SEKARANG,
    );
    expect(k.kalimat).toBe("Pembayaran perlu ditinjau");
    expect(k.uangMasuk).toBe(true);
  });

  it("lunas tanpa sesi -> Pembayaran diterima — sesi tertahan; dengan sesi -> diterima", () => {
    const lunas = pesanan({ status: "lunas" });
    expect(keadaanTagihan({ ...DASAR, pesanan: [lunas] }, SEKARANG).kalimat).toBe(
      "Pembayaran diterima — sesi tertahan",
    );
    expect(keadaanTagihan({ ...DASAR, pesanan: [lunas], adaSesi: true }, SEKARANG).kode).toBe("diterima");
  });

  it("tanpa pesanan = baris warisan, bukan 'ditutup'", () => {
    expect(keadaanTagihan({ ...DASAR, statusBayar: "lunas" }, SEKARANG).kode).toBe("warisan_lunas");
    expect(keadaanTagihan({ ...DASAR, statusBayar: "menunggu_verifikasi" }, SEKARANG).kode).toBe(
      "warisan_verifikasi",
    );
    expect(keadaanTagihan({ ...DASAR }, SEKARANG).kode).toBe("warisan_belum");
  });

  it("tidak satu pun kalimat memuat angka rupiah", () => {
    const semua = [
      keadaanTagihan({ ...DASAR, pesanan: [pesanan()] }, SEKARANG),
      keadaanTagihan({ ...DASAR, pesanan: [pesanan({ status: "dibatalkan" })] }, SEKARANG),
      keadaanTagihan({ ...DASAR, pesanan: [pesanan({ status: "lunas" })] }, SEKARANG),
    ];
    for (const k of semua) expect(k.kalimat).not.toMatch(/rp|\d{1,3}(\.\d{3})+/i);
  });
});

describe("tombolUntuk: tombol per keadaan", () => {
  it("Konfirmasi jadwal HANYA untuk baris warisan lunas", () => {
    expect(tombolUntuk("warisan_lunas").konfirmasi).toBe(true);
    for (const k of ["terbuka", "tenggat_lewat", "ditutup", "tertahan", "perlu_ditinjau", "diterima", "warisan_belum"] as const) {
      expect(tombolUntuk(k).konfirmasi, k).toBe(false);
    }
  });

  it("Terbitkan ulang + Batalkan saat tenggat lewat, ditutup, atau terbuka; tidak saat uang masuk", () => {
    for (const k of ["terbuka", "tenggat_lewat", "ditutup"] as const) {
      expect(tombolUntuk(k).terbitUlang, k).toBe(true);
      expect(tombolUntuk(k).batalkan, k).toBe(true);
    }
    for (const k of ["tertahan", "perlu_ditinjau", "diterima", "warisan_lunas", "warisan_verifikasi"] as const) {
      expect(tombolUntuk(k).terbitUlang, k).toBe(false);
      expect(tombolUntuk(k).batalkan, k).toBe(false);
    }
  });

  it("Ganti bidan juga untuk pengajuan tertahan; WA & email hanya saat tagihan terbuka", () => {
    expect(tombolUntuk("tertahan").gantiBidan).toBe(true);
    expect(tombolUntuk("terbuka").email).toBe(true);
    expect(tombolUntuk("ditutup").wa).toBe(false);
    expect(tombolUntuk("tenggat_lewat").email).toBe(false);
  });
});
