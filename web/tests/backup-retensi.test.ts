import { describe, it, expect } from "vitest";
import { HARI_SIMPAN, pilihObjekKedaluwarsa } from "@/lib/backup/retensi";
import { kunciObjekBackup, epochDariCapWaktu } from "@/lib/backup/nama-objek";

const SEKARANG = epochDariCapWaktu("20260904-200000Z")!;
const HARI = 24 * 60 * 60 * 1000;

/** Membuat kunci untuk objek berumur `hari` (+ `detik`) sebelum SEKARANG. */
const kunciBerumur = (hari: number, detik = 0) => {
  const d = new Date(SEKARANG - hari * HARI - detik * 1000);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return kunciObjekBackup(
    `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`,
  );
};

describe("retensi", () => {
  it("menyimpan 30 hari", () => {
    expect(HARI_SIMPAN).toBe(30);
  });

  it("menghapus yang lebih tua dari batas dan menyimpan yang lebih muda", () => {
    const tua = kunciBerumur(31);
    const muda = kunciBerumur(29);
    expect(pilihObjekKedaluwarsa([tua, muda], SEKARANG)).toEqual([tua]);
  });

  it("MEMPERTAHANKAN yang berumur persis batas", () => {
    // Batasnya "lebih tua dari 30 hari", bukan "30 hari atau lebih". Objek yang
    // persis berumur 30 hari masih salinan sah dan tidak boleh ikut hilang.
    expect(pilihObjekKedaluwarsa([kunciBerumur(30)], SEKARANG)).toEqual([]);
    const lewatSedetik = kunciBerumur(30, 1);
    expect(pilihObjekKedaluwarsa([lewatSedetik], SEKARANG)).toEqual([lewatSedetik]);
  });

  it("TIDAK PERNAH menghapus kunci yang tidak bisa dibaca", () => {
    // Objek asing di bucket bukan milik kita untuk dihapus, dan kunci tak
    // terbaca bisa berarti bentuk penamaan berubah — bukan izin membersihkan.
    const asing = ["db/2026/01/catatan.txt", "sesuatu.dump.age", "db/", ""];
    expect(pilihObjekKedaluwarsa(asing, SEKARANG)).toEqual([]);
  });

  it("TIDAK PERNAH menghapus objek bercap waktu mustahil (tanggal tidak pernah ada)", () => {
    // Kunci bentuknya sah (cocok POLA_KUNCI) tapi tanggalnya mustahil — bulan 13,
    // hari 32, menit 60, dll. epochDariCapWaktu mengembalikan null, dan guard
    // `if (ms === null) return false;` adalah satu-satunya yang mencegah null
    // dikoersi menjadi 0 dalam perbandingan numerik. Tanpa guard itu, 0 < batas
    // (batas negatif untuk epoch 2020-an) bernilai true, dan objek rusak itu
    // dipilih untuk dihapus permanen — persis arah bencana yang kita hindari.
    const mustahil = "db/2026/13/padma-20261332-999999Z.dump.age";
    expect(pilihObjekKedaluwarsa([mustahil], SEKARANG)).toEqual([]);
  });

  it("TIDAK PERNAH menghapus objek bercap waktu masa depan", () => {
    // Cap waktu di masa depan berarti jam runner atau jam pembuatnya kacau.
    // Menghapus berdasar jam yang kacau adalah cara kehilangan backup tersehat.
    expect(pilihObjekKedaluwarsa([kunciBerumur(-5)], SEKARANG)).toEqual([]);
  });

  it("mengembalikan daftar kosong bila jam sekarang tidak masuk akal", () => {
    expect(pilihObjekKedaluwarsa([kunciBerumur(999)], Number.NaN)).toEqual([]);
    expect(pilihObjekKedaluwarsa([kunciBerumur(999)], Number.POSITIVE_INFINITY))
      .toEqual([]);
  });

  it("mengembalikan daftar kosong bila hariSimpan tidak masuk akal", () => {
    // hariSimpan 0 atau negatif berarti "hapus semuanya" — hampir pasti salah
    // konfigurasi, bukan permintaan sungguhan.
    for (const h of [0, -1, Number.NaN]) {
      expect(pilihObjekKedaluwarsa([kunciBerumur(999)], SEKARANG, h)).toEqual([]);
    }
  });

  it("menghormati hariSimpan yang diberikan", () => {
    const k = kunciBerumur(10);
    expect(pilihObjekKedaluwarsa([k], SEKARANG, 7)).toEqual([k]);
    expect(pilihObjekKedaluwarsa([k], SEKARANG, 14)).toEqual([]);
  });

  it("daftar kosong menghasilkan daftar kosong", () => {
    expect(pilihObjekKedaluwarsa([], SEKARANG)).toEqual([]);
  });
});
