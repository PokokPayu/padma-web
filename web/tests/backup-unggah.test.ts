import { describe, it, expect } from "vitest";
import { unggahDanTerapkanRetensi, type KlienObjek } from "@/lib/backup/unggah";
import { kunciObjekBackup, epochDariCapWaktu } from "@/lib/backup/nama-objek";

const SEKARANG = epochDariCapWaktu("20260904-200000Z")!;
const ISI = new Uint8Array([1, 2, 3]);
const CAP_BARU = "20260904-200000Z";

function klienPalsu(awal: string[] = []) {
  const isi = new Set(awal);
  const jejak: string[] = [];
  // prefiksTerekam menangkap argumen `daftar()` apa adanya (termasuk undefined
  // bila dipanggil tanpa argumen) — klien palsu sengaja TIDAK mengabaikannya,
  // supaya tes bisa menuntut prefiks yang benar-benar dipakai pemanggil.
  let prefiksTerekam: string | undefined;
  const klien: KlienObjek = {
    async daftar(prefiks) {
      prefiksTerekam = prefiks;
      jejak.push("daftar");
      return [...isi];
    },
    async unggah(k) { jejak.push(`unggah:${k}`); isi.add(k); },
    async hapus(k) { jejak.push(`hapus:${k}`); isi.delete(k); },
  };
  return { klien, isi, jejak, get prefiksTerekam() { return prefiksTerekam; } };
}

describe("unggah + retensi", () => {
  it("mengunggah lalu menghapus yang kedaluwarsa", async () => {
    const tua = kunciObjekBackup("20260101-200000Z");
    const { klien, isi } = klienPalsu([tua]);
    const hasil = await unggahDanTerapkanRetensi(klien, {
      capWaktu: CAP_BARU, isi: ISI, sekarangEpochMs: SEKARANG,
    });
    expect(hasil.kunciBaru).toBe("db/2026/09/padma-20260904-200000Z.dump.age");
    expect(hasil.dihapus).toEqual([tua]);
    expect(isi.has(tua)).toBe(false);
    expect(isi.has(hasil.kunciBaru)).toBe(true);
  });

  it("mengunggah SEBELUM menghapus apa pun", async () => {
    // Membaliknya berarti ada jendela waktu ketika salinan lama sudah hilang
    // sementara yang baru belum tentu ada.
    const tua = kunciObjekBackup("20260101-200000Z");
    const { klien, jejak } = klienPalsu([tua]);
    await unggahDanTerapkanRetensi(klien, {
      capWaktu: CAP_BARU, isi: ISI, sekarangEpochMs: SEKARANG,
    });
    const iUnggah = jejak.findIndex((j) => j.startsWith("unggah:"));
    const iHapus = jejak.findIndex((j) => j.startsWith("hapus:"));
    expect(iUnggah).toBeGreaterThanOrEqual(0);
    expect(iHapus).toBeGreaterThan(iUnggah);
  });

  it("tidak menghapus apa pun bila unggahan gagal", async () => {
    const tua = kunciObjekBackup("20260101-200000Z");
    const { klien, isi } = klienPalsu([tua]);
    klien.unggah = async () => { throw new Error("R2 menolak"); };
    await expect(unggahDanTerapkanRetensi(klien, {
      capWaktu: CAP_BARU, isi: ISI, sekarangEpochMs: SEKARANG,
    })).rejects.toThrow("R2 menolak");
    expect(isi.has(tua)).toBe(true);
  });

  it("TIDAK PERNAH menghapus objek yang baru saja diunggah", async () => {
    // Jam runner yang meleset setahun ke depan membuat objek baru tampak kuno.
    // Tanpa pagar ini, satu-satunya hasil kerja job itu terhapus olehnya sendiri.
    const { klien, isi } = klienPalsu();
    const jauhDiDepan = SEKARANG + 400 * 24 * 60 * 60 * 1000;
    const hasil = await unggahDanTerapkanRetensi(klien, {
      capWaktu: CAP_BARU, isi: ISI, sekarangEpochMs: jauhDiDepan,
    });
    expect(hasil.dihapus).toEqual([]);
    expect(isi.has(hasil.kunciBaru)).toBe(true);
  });

  it("mendaftar objek dengan prefiks backup", async () => {
    // KOREKSI: brief asli hanya menuntut jejak memuat "daftar" — itu tetap
    // hijau meski dipanggil dengan prefiks salah atau tanpa argumen sama
    // sekali. Di sini prefiks yang benar-benar diterima klien.daftar()
    // direkam dan dituntut persis "db/", supaya tes ini benar-benar
    // menjaga kontrak pemanggilan, bukan cuma keberadaan panggilan.
    const palsu = klienPalsu();
    await unggahDanTerapkanRetensi(palsu.klien, {
      capWaktu: CAP_BARU, isi: ISI, sekarangEpochMs: SEKARANG,
    });
    expect(palsu.prefiksTerekam).toBe("db/");
  });
});
