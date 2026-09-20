/**
 * Sumber kebenaran tunggal batas trimester.
 *
 * Kenapa test ini ada: batas trimester dipakai DUA sisi — wizard menyalakan
 * tombol trimester dari angka minggu yang diketik, dan server menurunkan ulang
 * trimester sebelum menyimpan. Bila keduanya kelak memakai angka sendiri-sendiri,
 * seorang klien bisa melihat "Trimester 2" di layar sementara yang tersimpan
 * untuk terapis adalah "Trimester 1", dan tidak satu pun test lain akan merah.
 *
 * Angkanya konvensi obstetri baku, BUKAN angka bertumpuk (0-14, 14-28) yang
 * beredar di percakapan: 14 dan 28 tidak boleh menjadi milik dua trimester.
 */
import { describe, it, expect } from "vitest";
import {
  MINGGU_MAKS,
  RENTANG_TRIMESTER,
  trimesterDari,
  type Trimester,
} from "@/lib/skrining/usia-kehamilan";
import { SkemaSkriningPublik } from "@/lib/skrining/skema";

describe("usia kehamilan — batas trimester", () => {
  it("tiga trimester, berurutan, dengan label siap tampil", () => {
    expect(RENTANG_TRIMESTER.map((r) => r.nomor)).toEqual([1, 2, 3]);
    expect(RENTANG_TRIMESTER.map((r) => r.label)).toEqual([
      "Trimester 1",
      "Trimester 2",
      "Trimester 3",
    ]);
  });

  it("rentangnya bersambung tanpa celah dan tanpa tumpang tindih", () => {
    expect(RENTANG_TRIMESTER[0]).toMatchObject({ mulai: 0, selesai: 13 });
    expect(RENTANG_TRIMESTER[1]).toMatchObject({ mulai: 14, selesai: 27 });
    expect(RENTANG_TRIMESTER[2]).toMatchObject({ mulai: 28, selesai: MINGGU_MAKS });
    for (let i = 1; i < RENTANG_TRIMESTER.length; i++) {
      expect(RENTANG_TRIMESTER[i].mulai).toBe(RENTANG_TRIMESTER[i - 1].selesai + 1);
    }
  });

  it("batas atas 42 minggu — kehamilan lewat waktu tidak ditolak formulir", () => {
    expect(MINGGU_MAKS).toBe(42);
    expect(trimesterDari(42)).toBe(3);
  });

  it("minggu tepat di perbatasan jatuh ke trimester yang benar", () => {
    const perbatasan: [number, Trimester][] = [
      [0, 1], [13, 1], [14, 2], [27, 2], [28, 3],
    ];
    for (const [minggu, trimester] of perbatasan) {
      expect(trimesterDari(minggu)).toBe(trimester);
    }
  });

  it("minggu di luar rentang wajar mengembalikan null, bukan menebak", () => {
    expect(trimesterDari(-1)).toBeNull();
    expect(trimesterDari(43)).toBeNull();
    expect(trimesterDari(1000)).toBeNull();
  });

  it("minggu pecahan dan NaN ditolak — usia kehamilan dihitung minggu bulat", () => {
    expect(trimesterDari(13.5)).toBeNull();
    expect(trimesterDari(Number.NaN)).toBeNull();
    expect(trimesterDari(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("setiap minggu 0..42 punya tepat satu trimester", () => {
    for (let m = 0; m <= MINGGU_MAKS; m++) {
      const cocok = RENTANG_TRIMESTER.filter((r) => m >= r.mulai && m <= r.selesai);
      expect(cocok).toHaveLength(1);
      expect(trimesterDari(m)).toBe(cocok[0].nomor);
    }
  });
});

describe("skema skrining — usia kehamilan", () => {
  const dasar = { nama: "Sinta", no_hp: "081234567890", jawaban: { fever: false } };
  const hamil = { ...dasar, fase: "kehamilan" as const };

  it("skrining tanpa usia kehamilan tetap sah — medannya opsional", () => {
    const hasil = SkemaSkriningPublik.safeParse(hamil);
    expect(hasil.success).toBe(true);
    if (hasil.success) {
      expect(hasil.data.usia_kehamilan_minggu).toBeNull();
      expect(hasil.data.trimester).toBeNull();
    }
  });

  it("minggu saja diterima, dan trimester DITURUNKAN server dari minggu itu", () => {
    const hasil = SkemaSkriningPublik.safeParse({ ...hamil, usia_kehamilan_minggu: 24 });
    expect(hasil.success).toBe(true);
    if (hasil.success) {
      expect(hasil.data.usia_kehamilan_minggu).toBe(24);
      expect(hasil.data.trimester).toBe(2);
    }
  });

  it("trimester saja diterima — untuk klien yang tidak hafal minggunya", () => {
    const hasil = SkemaSkriningPublik.safeParse({ ...hamil, trimester: 3 });
    expect(hasil.success).toBe(true);
    if (hasil.success) {
      expect(hasil.data.trimester).toBe(3);
      expect(hasil.data.usia_kehamilan_minggu).toBeNull();
    }
  });

  it("trimester kiriman klien TIDAK dipercaya bila minggu ada — server menurunkan ulang", () => {
    // Layar tidak bisa menghasilkan kombinasi ini, tapi rute publik menerima
    // JSON apa pun. Yang tersimpan harus tetap satu fakta yang konsisten.
    const hasil = SkemaSkriningPublik.safeParse({
      ...hamil, usia_kehamilan_minggu: 30, trimester: 1,
    });
    expect(hasil.success).toBe(true);
    if (hasil.success) expect(hasil.data.trimester).toBe(3);
  });

  it("minggu di luar 0..42 ditolak, bukan dibulatkan diam-diam", () => {
    for (const minggu of [-1, 43, 999, 13.5]) {
      expect(SkemaSkriningPublik.safeParse({ ...hamil, usia_kehamilan_minggu: minggu }).success)
        .toBe(false);
    }
  });

  it("trimester di luar 1..3 ditolak", () => {
    for (const t of [0, 4, 2.5]) {
      expect(SkemaSkriningPublik.safeParse({ ...hamil, trimester: t }).success).toBe(false);
    }
  });

  it("usia kehamilan pada fase NON-kehamilan ditolak", () => {
    // Fail-closed: 'nifas dengan trimester 2' bukan sekadar data janggal di
    // inbox — ia catatan keselamatan yang membingungkan terapis di rumah klien.
    for (const fase of ["prekonsepsi", "nifas", "menopause"] as const) {
      expect(SkemaSkriningPublik.safeParse({ ...dasar, fase, usia_kehamilan_minggu: 20 }).success)
        .toBe(false);
      expect(SkemaSkriningPublik.safeParse({ ...dasar, fase, trimester: 2 }).success)
        .toBe(false);
    }
  });

  it("fase non-kehamilan tanpa usia kehamilan tetap sah seperti sebelumnya", () => {
    const hasil = SkemaSkriningPublik.safeParse({ ...dasar, fase: "menopause" });
    expect(hasil.success).toBe(true);
  });
});
