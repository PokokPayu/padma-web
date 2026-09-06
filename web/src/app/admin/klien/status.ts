// Fungsi murni modul Klien.
//
// Berkas terpisah karena `aksi.ts` bertanda "use server": setiap ekspornya
// wajib berupa fungsi async, jadi fungsi sinkron tidak boleh tinggal di sana.
// Preseden yang diikuti: `admin/sesi/status.ts`.

/**
 * Merapikan alamat profil klien sebelum disimpan.
 *
 * Beda dengan alamat PENGAJUAN JADWAL (`lib/passport/status.ts`, wajib diisi
 * karena mitra harus datang ke sana), alamat profil klien BOLEH kosong — data
 * ini boleh terisi menyusul. Karena itu fungsi ini hanya merapikan spasi,
 * tidak pernah menolak apa pun.
 */
export function bersihkanAlamat(mentah: string): string {
  return mentah.trim();
}
