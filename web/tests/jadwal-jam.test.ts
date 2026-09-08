import { describe, it, expect } from "vitest";
import {
  JAM_LAYANAN_BAWAAN,
  bentukJamSah,
  uraikanDaftarJam,
  formatJam,
  jamDariDb,
  instanSesi,
  jamSampaiSesi,
} from "@/lib/jadwal/jam";

describe("bentuk jam", () => {
  it("menerima HH:MM 24 jam dengan nol di depan", () => {
    expect(bentukJamSah("09:00")).toBe(true);
    expect(bentukJamSah("00:00")).toBe(true);
    expect(bentukJamSah("23:59")).toBe(true);
  });

  it("menolak yang bukan HH:MM", () => {
    for (const buruk of ["9:00", "09:0", "24:00", "09:60", "09.00", "", "pagi", "09:00:00"]) {
      expect(bentukJamSah(buruk), `"${buruk}" seharusnya ditolak`).toBe(false);
    }
  });
});

describe("daftar jam dari pengaturan", () => {
  it("memisah dengan koma, merapikan spasi, membuang ganda, mengurutkan", () => {
    expect(uraikanDaftarJam(" 13:00, 09:00 ,09:00, 11:00 ")).toEqual([
      "09:00",
      "11:00",
      "13:00",
    ]);
  });

  it("membuang entri yang bentuknya salah, bukan menggagalkan seluruh daftar", () => {
    // Setelan diketik manusia lewat panel. Satu salah ketik tidak boleh
    // membuat formulir pemesanan kehilangan SELURUH pilihan jamnya.
    expect(uraikanDaftarJam("09:00, jam sembilan, 11:00")).toEqual(["09:00", "11:00"]);
  });

  it("jatuh ke daftar bawaan bila kosong, null, atau seluruhnya tidak sah", () => {
    expect(uraikanDaftarJam(null)).toEqual([...JAM_LAYANAN_BAWAAN]);
    expect(uraikanDaftarJam("")).toEqual([...JAM_LAYANAN_BAWAAN]);
    expect(uraikanDaftarJam("   ")).toEqual([...JAM_LAYANAN_BAWAAN]);
    expect(uraikanDaftarJam("pagi, siang")).toEqual([...JAM_LAYANAN_BAWAAN]);
  });

  it("daftar bawaan sendiri sah", () => {
    for (const j of JAM_LAYANAN_BAWAAN) expect(bentukJamSah(j)).toBe(true);
  });
});

describe("format tampilan", () => {
  it("memakai titik dan menyebut zona — 09.00 WIB", () => {
    expect(formatJam("09:00")).toBe("09.00 WIB");
    expect(formatJam("13:30")).toBe("13.30 WIB");
  });

  it("nilai dari Postgres 'HH:MM:SS' dipendekkan lebih dulu, bukan dilonggarkan polanya", () => {
    // Melonggarkan `bentukJamSah` untuk menerima detik berarti '09:00:07' dari
    // FormData ikut lolos. Yang datang dari DB dan dari peramban dinilai dengan
    // aturan berbeda, sengaja.
    expect(jamDariDb("09:00:00")).toBe("09:00");
    expect(formatJam(jamDariDb("13:30:00"))).toBe("13.30 WIB");
    expect(() => formatJam("09:00:00")).toThrow();
  });
});

describe("aritmatika waktu sesi", () => {
  it("merakit instan dari kalender Jakarta, bukan kalender mesin", () => {
    // 2026-09-10 09:00 WIB = 2026-09-10T02:00:00Z. Nilai ini benar di mesin
    // mana pun; itulah maksud offset tetap.
    expect(instanSesi("2026-09-10", "09:00").toISOString()).toBe("2026-09-10T02:00:00.000Z");
  });

  it("selisih jam dihitung dari instan, bukan dari selisih tanggal", () => {
    const sekarang = new Date("2026-09-10T02:00:00.000Z"); // 09.00 WIB
    expect(jamSampaiSesi("2026-09-10", "14:00", sekarang)).toBe(5);
    expect(jamSampaiSesi("2026-09-11", "09:00", sekarang)).toBe(24);
  });

  it("sesi yang sudah lewat bernilai negatif, bukan nol", () => {
    const sekarang = new Date("2026-09-10T02:00:00.000Z");
    expect(jamSampaiSesi("2026-09-10", "07:00", sekarang)).toBe(-2);
  });

  it("PERGANTIAN HARI JAKARTA vs UTC — inilah kesalahan yang paling mahal", () => {
    // 2026-09-09T20:00:00Z. Menurut UTC masih 9 September; menurut Jakarta
    // sudah 10 September pukul 03.00. Sesi 10 September 09.00 WIB tinggal
    // 6 jam lagi — bukan 30 jam seperti yang dihitung kalender mesin UTC.
    const sekarang = new Date("2026-09-09T20:00:00.000Z");
    expect(jamSampaiSesi("2026-09-10", "09:00", sekarang)).toBe(6);
  });

  it("batas 24 jam dan 2 jam C3 bisa dijawab dengan fungsi ini", () => {
    const sekarang = new Date("2026-09-10T02:00:00.000Z"); // 09.00 WIB
    expect(jamSampaiSesi("2026-09-11", "09:00", sekarang) >= 24).toBe(true);
    expect(jamSampaiSesi("2026-09-11", "08:59", sekarang) >= 24).toBe(false);
    expect(jamSampaiSesi("2026-09-10", "10:30", sekarang) < 2).toBe(true);
  });

  it("melempar untuk masukan yang tidak sah, tidak memulangkan NaN diam-diam", () => {
    expect(() => instanSesi("2026-09-10", "9:00")).toThrow();
    expect(() => instanSesi("10-09-2026", "09:00")).toThrow();
  });
});
