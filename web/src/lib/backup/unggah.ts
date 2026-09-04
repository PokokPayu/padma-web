import { kunciObjekBackup, PREFIKS_BACKUP } from "./nama-objek";
import { pilihObjekKedaluwarsa } from "./retensi";

/**
 * Antarmuka penyimpanan objek seminimal yang dibutuhkan rantai backup.
 *
 * Sengaja BUKAN tipe dari @aws-sdk: dengan begini seluruh urutan berbahaya
 * (unggah dulu, hapus kemudian, jangan hapus yang baru) diuji tanpa jaringan,
 * dan `scripts/backup/unggah-r2.ts` tinggal menyediakan tiga metode ini.
 */
export interface KlienObjek {
  daftar(prefiks: string): Promise<string[]>;
  unggah(kunci: string, isi: Uint8Array): Promise<void>;
  hapus(kunci: string): Promise<void>;
}

export type HasilUnggah = { kunciBaru: string; dihapus: string[] };

export async function unggahDanTerapkanRetensi(
  klien: KlienObjek,
  opsi: {
    capWaktu: string;
    isi: Uint8Array;
    sekarangEpochMs: number;
    hariSimpan?: number;
  },
): Promise<HasilUnggah> {
  const kunciBaru = kunciObjekBackup(opsi.capWaktu);

  // Unggah DULU. Bila langkah ini melempar, tidak satu pun objek lama tersentuh.
  await klien.unggah(kunciBaru, opsi.isi);

  const semua = await klien.daftar(`${PREFIKS_BACKUP}/`);
  const dihapus = pilihObjekKedaluwarsa(semua, opsi.sekarangEpochMs, opsi.hariSimpan)
    // Pagar terakhir: apa pun yang terjadi pada jam mesin, hasil kerja hari ini
    // tidak boleh menjadi korban pembersihannya sendiri.
    .filter((k) => k !== kunciBaru);

  for (const k of dihapus) await klien.hapus(k);

  return { kunciBaru, dihapus };
}
