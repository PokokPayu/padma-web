import { describe, it, expect } from "vitest";
import {
  PER_HAL, uraikanParamDaftar, hitungRentang, bangunQuery, jumlahHalaman, ParamDaftar,
} from "@/app/_shell/panel/daftar";

const SAH = { status: ["terjadwal", "selesai", "batal"] } as const;

describe("uraikanParamDaftar", () => {
  it("mengambil cari, saringan sah, dan halaman", () => {
    const p = uraikanParamDaftar({ cari: " ananda ", status: "selesai", hal: "3" }, SAH);
    expect(p).toEqual({ cari: "ananda", saring: { status: "selesai" }, hal: 3 });
  });

  it("MEMBUANG nilai saringan yang tidak ada di daftar sah", () => {
    // URL diketik manusia dan ditempel dari mana saja. Nilai asing yang lolos
    // ke `.eq()` bukan sekadar hasil kosong: ia hasil kosong yang TERLIHAT
    // seperti "memang tidak ada datanya".
    const p = uraikanParamDaftar({ status: "; drop table" }, SAH);
    expect(p.saring).toEqual({});
  });

  it("MEMBUANG nama saringan yang tidak dikenal", () => {
    const p = uraikanParamDaftar({ peran: "owner" }, SAH);
    expect(p.saring).toEqual({});
  });

  it("halaman jatuh ke 1 untuk nol, negatif, pecahan, dan bukan angka", () => {
    for (const hal of ["0", "-2", "1.5", "abc", ""]) {
      expect(uraikanParamDaftar({ hal }, SAH).hal).toBe(1);
    }
  });

  it("mengambil nilai PERTAMA bila parameter muncul berkali-kali", () => {
    // `?status=a&status=b` memberi array. Tanpa penanganan, `.eq()` menerima
    // array dan PostgREST menolaknya dengan galat yang tidak menyebut sebabnya.
    expect(uraikanParamDaftar({ status: ["selesai", "batal"] }, SAH).saring)
      .toEqual({ status: "selesai" });
  });

  it("cari yang hanya spasi dianggap kosong", () => {
    expect(uraikanParamDaftar({ cari: "   " }, SAH).cari).toBe("");
  });
});

describe("hitungRentang", () => {
  it("halaman 1 mulai dari 0", () => {
    expect(hitungRentang(1)).toEqual({ dari: 0, sampai: PER_HAL - 1 });
  });
  it("halaman 3 melompat dua halaman penuh", () => {
    expect(hitungRentang(3)).toEqual({ dari: 2 * PER_HAL, sampai: 3 * PER_HAL - 1 });
  });
  it("hitungRentang menghormati ukuran halaman yang diberikan", () => {
    // Bawaan tidak berubah — 25 baris per halaman.
    expect(hitungRentang(1)).toEqual({ dari: 0, sampai: 24 });
    expect(hitungRentang(3)).toEqual({ dari: 50, sampai: 74 });
    // Ukuran lain: kartu pekan rekap, 8 per halaman.
    expect(hitungRentang(1, 8)).toEqual({ dari: 0, sampai: 7 });
    expect(hitungRentang(3, 8)).toEqual({ dari: 16, sampai: 23 });
  });
});

describe("bangunQuery", () => {
  const param: ParamDaftar = { cari: "sri", saring: { status: "selesai" }, hal: 4 };

  it("mengubah satu saringan MENGEMBALIKAN halaman ke 1", () => {
    // Tanpa ini, menyaring dari halaman 4 mendarat di halaman 4 daftar baru —
    // yang hampir selalu kosong, dan terbaca sebagai "tidak ada datanya".
    expect(bangunQuery(param, { status: "batal" })).toBe("?cari=sri&status=batal");
  });

  it("berpindah halaman MEMPERTAHANKAN cari dan saringan", () => {
    expect(bangunQuery(param, { hal: 5 })).toBe("?cari=sri&status=selesai&hal=5");
  });

  it("nilai null MENGHAPUS parameternya", () => {
    expect(bangunQuery(param, { status: null })).toBe("?cari=sri");
  });

  it("halaman 1 tidak pernah muncul di URL", () => {
    expect(bangunQuery(param, { hal: 1 })).toBe("?cari=sri&status=selesai");
  });

  it("membuka panel geser MEMPERTAHANKAN halaman — `ubah` bukan saringan", () => {
    // Membuka baris di halaman 4 lalu menutupnya harus mengembalikan admin ke
    // halaman 4. Kalau `ubah` diperlakukan sebagai saringan, halamannya
    // di-reset ke 1 dan baris yang barusan diubah lenyap dari layar.
    expect(bangunQuery(param, { ubah: "abc" })).toBe("?cari=sri&status=selesai&hal=4&ubah=abc");
  });

  it("menutup panel geser MEMPERTAHANKAN halaman juga", () => {
    const terbuka: ParamDaftar = { cari: "sri", saring: {}, hal: 4 };
    expect(bangunQuery(terbuka, { ubah: null })).toBe("?cari=sri&hal=4");
  });

  it("memulangkan string kosong bila tidak ada parameter tersisa", () => {
    // Bukan "?" telanjang: href berakhiran "?" membuat Next memuat ulang rute
    // yang sama sebagai navigasi baru.
    expect(bangunQuery({ cari: "", saring: {}, hal: 1 }, {})).toBe("");
  });

  it("meng-encode spasi dan tanda baca pada kata cari", () => {
    expect(bangunQuery({ cari: "bidan sri&ratna", saring: {}, hal: 1 }, {}))
      .toBe("?cari=bidan+sri%26ratna");
  });
});

describe("jumlahHalaman", () => {
  it("nol baris tetap satu halaman", () => {
    expect(jumlahHalaman(0)).toBe(1);
  });
  it("tepat sepenuh halaman tidak melahirkan halaman kosong berikutnya", () => {
    expect(jumlahHalaman(PER_HAL)).toBe(1);
    expect(jumlahHalaman(PER_HAL + 1)).toBe(2);
  });
  it("jumlahHalaman menghormati ukuran halaman yang diberikan", () => {
    expect(jumlahHalaman(0)).toBe(1);
    expect(jumlahHalaman(26)).toBe(2);
    expect(jumlahHalaman(0, 8)).toBe(1);
    expect(jumlahHalaman(8, 8)).toBe(1);
    expect(jumlahHalaman(9, 8)).toBe(2);
    expect(jumlahHalaman(24, 8)).toBe(3);
  });
});
