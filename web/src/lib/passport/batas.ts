/**
 * Batas antrean permintaan jadwal.
 *
 * Dipisahkan dari `aksi.ts` karena berkas itu bertanda "use server": setiap
 * ekspornya wajib berupa fungsi async, jadi konstanta tidak boleh tinggal di
 * sana. Nilai yang sama dipakai server action (pesan ramah) DAN trigger basis
 * data (penegak sebenarnya) — bila keduanya berbeda, test regresi merah.
 */
export const BATAS_PERMINTAAN_MENUNGGU = 5;
