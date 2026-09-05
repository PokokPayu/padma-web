/**
 * Deteksi posisi atom `moov` pada MP4. MURNI: Uint8Array masuk, jawaban keluar.
 *
 * Kenapa ini ada: design menolak transkode, jadi ini SATU-SATUNYA kesempatan
 * menangkap video yang `moov`-nya di belakang. Berkas semacam itu memaksa
 * peramban mengunduh seluruhnya sebelum frame pertama muncul — dan gejalanya
 * bagi pasien bukan galat, melainkan pemutar yang menggantung tanpa sebab.
 *
 * Admin DIPERINGATKAN, bukan diblokir (spec §6): videonya tetap bisa ditonton,
 * hanya lambat mulai, dan memblokirnya berarti menolak materi yang sah.
 */

/** Jawaban `null` berarti "tidak tahu" — bukan "tidak faststart". */
export function moovDiDepan(kepala: Uint8Array): boolean | null {
  if (kepala.length < 8) return null;
  const dv = new DataView(kepala.buffer, kepala.byteOffset, kepala.byteLength);

  let p = 0;
  while (p + 8 <= kepala.length) {
    const ukuran32 = dv.getUint32(p, false);
    const tipe = String.fromCharCode(
      kepala[p + 4], kepala[p + 5], kepala[p + 6], kepala[p + 7],
    );

    if (tipe === "moov") return true;
    if (tipe === "mdat") return false;

    let lompat: number;
    if (ukuran32 === 1) {
      // Largesize 64-bit. Kita hanya membaca 32 bit rendahnya: box yang lebih
      // besar dari 4 GB tidak mungkin muat di batas 200 MB kita, dan membaca
      // 32 bit tingginya hanya menambah jalur yang tak pernah terpakai.
      if (p + 16 > kepala.length) return null;
      lompat = dv.getUint32(p + 12, false);
      if (lompat < 16) return null;
    } else if (ukuran32 === 0) {
      // "Sampai akhir berkas" — tidak ada box lain sesudahnya yang bisa kita
      // periksa, jadi jawabannya tidak diketahui.
      return null;
    } else if (ukuran32 < 8) {
      // Ukuran mustahil — box valid minimal 8 byte (4 byte ukuran + 4 byte
      // tipe). Nilai yang sampai di sini (2..7) BUKAN mundur atau diam:
      // membiarkannya lolos ke cabang `else` di bawah akan melangkah MAJU
      // sejauh 2..7 byte, offset yang tidak sejalan dengan batas box
      // sungguhan mana pun — deteksi berikutnya membaca tipe box dari tengah
      // data acak. Berhenti (jawab "tidak tahu") daripada menyesatkan diri.
      return null;
    } else {
      lompat = ukuran32;
    }
    p += lompat;
  }
  return null;
}
