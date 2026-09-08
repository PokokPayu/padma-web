/**
 * Pola nominal uang untuk permukaan yang TIDAK BOLEH menampilkannya.
 *
 * Menggantikan `/Rp\s?\d/` yang dipakai seluruh suite sampai sekarang. Pola
 * lama menuntut literal "Rp" dengan huruf besar dan tanpa titik, sehingga TIGA
 * bentuk lolos begitu saja: "3.500.000" (tanpa satuan), "Rp. 500.000" (titik
 * sesudah Rp), dan "rp 500000" (huruf kecil).
 *
 * Yang SENGAJA tidak ditangkap, dan alasannya masing-masing:
 *
 *   • Angka polos tanpa pemisah ribuan ("500000"). Menangkapnya menuntut
 *     ambang jumlah digit, dan ambang itu akan menuduh timestamp, id numerik,
 *     dan ukuran piksel. Tidak ada jalur di repo ini yang merender rupiah
 *     tanpa pemisah — `formatRupiah()` memakai `Intl.NumberFormat('id-ID')`,
 *     yang selalu memberi titik ribuan.
 *
 *   • Nominal berpemisah SATU kelompok saja ("20.000"), bila tidak didahului
 *     "Rp". Ini gap yang DIPILIH, bukan yang terlewat: "3.500" (tiga ribu
 *     lima ratus) dan "1.005" (satu koma nol nol lima) tidak bisa dibedakan
 *     dari bentuknya, dan kelas Tailwind repo ini benar-benar memuat bentuk
 *     kedua — `opacity-[0.075]` di `src/app/passport/_komponen/watermark.tsx`
 *     dan `0.016` di `src/lib/materi/watermark.ts`. Menuntut DUA kelompok
 *     (`{2,}`) membuang seluruh kelas positif-palsu itu sekaligus, dan tetap
 *     menangkap ketiga bentuk yang menjadi alasan pagar ini ditulis. Nominal
 *     satu-kelompok yang muncul di layar admin hampir selalu ditemani "Rp",
 *     dan bentuk itu tertangkap pola pertama.
 *
 * Pola ribuan juga dibatasi `\b` di kedua ujung supaya KOORDINAT tidak
 * tertuduh: "112.6304" tidak cocok (ada digit keempat sesudah titik), dan
 * koordinat memang hidup di `src/app/_shell/pemilih-lokasi.tsx` yang ikut
 * dipindai beberapa uji.
 *
 * Diverifikasi sebelum ditulis: dengan `{2,}`, satu-satunya kecocokan di
 * SELURUH `src/` adalah `1.048.576` (2^20) di komentar `src/lib/skrining/
 * kode.ts` — berkas yang tidak dibaca satu pun pagar money firewall.
 */
const POLA: RegExp[] = [
  // "Rp 500.000", "Rp. 500.000", "rp500000" — apa pun sesudah satuan.
  /rp\.?\s*\d[\d.,]*/gi,
  // "3.500.000" — nominal telanjang, DUA kelompok ribuan atau lebih.
  /\b\d{1,3}(?:\.\d{3}){2,}\b/g,
];

/**
 * Setiap nominal yang ditemukan di `teks`, tanpa duplikat.
 *
 * Memulangkan DAFTAR, bukan boolean, supaya pesan kegagalannya menyebut apa
 * yang bocor. `expect(nominalDalam(m)).toEqual([])` yang merah langsung
 * memberi tahu nominal mana — `not.toMatch()` hanya berkata "cocok".
 */
export function nominalDalam(teks: string): string[] {
  const hasil = new Set<string>();
  for (const pola of POLA) {
    for (const cocok of teks.matchAll(pola)) hasil.add(cocok[0]);
  }
  return [...hasil];
}
