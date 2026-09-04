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

/**
 * Pagar keras terhadap retensi yang salah arah — mis. jam skew MAJU lebih
 * dari `HARI_SIMPAN` hari, yang mendorong `batas` di `retensi.ts` melewati
 * SELURUH cap waktu tersimpan (lihat komentar di sana: fungsi itu sengaja
 * hanya menjaga skew mundur, bukan maju). Tanpa pagar ini, satu jalan dengan
 * jam yang kacau menghabiskan seluruh riwayat backup dalam sekali jalan.
 *
 * Operasi normal menghapus 0 atau 1 objek per hari (satu backup kedaluwarsa
 * per unggahan). Angka 5 memberi ruang untuk beberapa jalan yang terlewat
 * berturut-turut (libur, runner gagal, dll.) sebelum jumlah yang terpilih
 * dianggap mencurigakan. Melebihi ini berarti BERHENTI dan biarkan operator
 * menghapus manual — arah gagalnya tetap MEMPERTAHANKAN (spec, retensi.ts):
 * operator selalu bisa menghapus lebih, tidak pernah bisa mengembalikan yang
 * sudah terhapus.
 */
export const MAKS_HAPUS_PER_JALAN = 5;

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

  if (dihapus.length > MAKS_HAPUS_PER_JALAN) {
    // TIDAK menghapus SATU PUN dari daftar ini — unggahan di atas sudah
    // sukses dan tetap aman, hanya penghapusannya yang dibatalkan.
    throw new Error(
      `Retensi memilih ${dihapus.length} objek untuk dihapus dalam satu jalan, ` +
      `melebihi batas aman MAKS_HAPUS_PER_JALAN (${MAKS_HAPUS_PER_JALAN}). ` +
      `Dibatalkan, TIDAK ada yang dihapus — kemungkinan jam mesin kacau ` +
      `(skew maju) atau konfigurasi retensi salah. Periksa manual sebelum menghapus.`,
    );
  }

  for (const k of dihapus) await klien.hapus(k);

  return { kunciBaru, dihapus };
}
