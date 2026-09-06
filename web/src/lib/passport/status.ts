// Fungsi murni modul pengajuan jadwal (passport).
//
// Berkas terpisah karena `aksi.ts` bertanda "use server": setiap ekspornya
// wajib berupa fungsi async, jadi fungsi validasi SINKRON tidak boleh tinggal
// di sana. Preseden yang diikuti: `admin/sesi/status.ts`, `admin/skrining/status.ts`.

/**
 * Alamat pengajuan jadwal (spec T6): WAJIB diisi, berbeda dari alamat profil
 * klien/domisili mitra yang boleh kosong (terisi menyusul). Mitra harus bisa
 * datang ke sana — alamat sependek "rumah" bukan alamat yang bisa dituju.
 *
 * Fungsi ini TIDAK menyentuh geocoding sama sekali: ia hanya menilai RUPA teks
 * yang diketik klien. Berhasil-tidaknya `geocodeAlamat()` mencari koordinat
 * adalah urusan lain sepenuhnya, dan kegagalannya tidak pernah menggagalkan
 * penyimpanan alamat ini.
 */
export function periksaAlamat(
  mentah: string,
): { ok: true; nilai: string } | { ok: false; pesan: string } {
  const teks = mentah.trim();
  if (teks.length < 10) {
    return { ok: false, pesan: "Alamat terlalu pendek — tuliskan alamat yang bisa dituju mitra." };
  }
  return { ok: true, nilai: teks };
}
