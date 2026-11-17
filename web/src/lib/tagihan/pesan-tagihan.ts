/**
 * PESAN TAGIHAN SIAP-SALIN UNTUK WHATSAPP (spec C2 P7, diubah P3/B5 D3).
 *
 * Berkas ini sengaja MURNI — tanpa satu pun impor. Kartu antrean di panel admin
 * adalah komponen `"use client"`, dan modul yang menyentuh Supabase memuat
 * klien service role; satu impor dari sisi klien sudah cukup untuk menyeret
 * keduanya ke bundel peramban. Pola yang sama persis dengan
 * `lib/auth/pesan-undangan.ts`, dan alasannya juga sama: ia sudah pernah
 * menjatuhkan Tahap B.
 *
 * ===== TANPA ANGKA (D3) =====
 * `/admin/sesi` nol rupiah, dan pesan ini dirakit di sana. Rinciannya milik
 * Digital Passport klien dan email tagihan; WhatsApp hanya mengantar klien ke
 * sana. Tidak ada angka, tidak ada QRIS: pembayaran lewat DOKU di Passport.
 *
 * ===== KENAPA SIAP-SALIN, BUKAN TERKIRIM OTOMATIS =====
 * PADMA belum punya jalur kirim WhatsApp otomatis, dan menambahkannya berarti
 * satu penyedia baru beserta jalur kegagalannya. Admin menekan tombol, pesannya
 * tersalin, ia menempelkannya di percakapan yang sudah berjalan dengan klien
 * itu. Cara ini juga membuat nada pesannya tetap milik manusia.
 *
 * Unsur WAJIB, dan itu diuji: nama, layanan, kapan, tautan bayar, dan sampai
 * kapan. Pesan tagihan tanpa batas waktu adalah pesan yang membuat orang
 * kehilangan slotnya tanpa pernah tahu ada tenggatnya.
 */

export function pesanTagihan(input: {
  namaKlien: string;
  namaLayanan: string;
  /** Sudah diformat untuk manusia, mis. "20 Mei 2027". */
  tanggal: string;
  /** Sudah diformat, mis. "09.00 WIB". */
  jam: string;
  /** URL penuh, mis. "https://…/passport/bayar/<id pengajuan>". */
  tautanPassport: string;
  /** Sudah diformat, mis. "24 jam lagi". */
  sisaWaktu: string;
}): string {
  const { namaKlien, namaLayanan, tanggal, jam, tautanPassport, sisaWaktu } = input;

  return [
    `Halo ${namaKlien}, bidan untuk sesi Anda sudah siap 🌸`,
    "",
    `Layanan: ${namaLayanan}`,
    `Jadwal: ${tanggal}, ${jam}`,
    "",
    `Tagihan Anda sudah terbit. Bayar di Digital Passport: ${tautanPassport}`,
    `Mohon selesaikan pembayaran dalam ${sisaWaktu}.`,
    "",
    "Bila lewat dari batas itu, tim PADMA akan menghubungi Anda untuk menerbitkan ulang atau membatalkan.",
  ].join("\n");
}

/** Tautan WhatsApp siap tempel. Nomor sudah dalam bentuk internasional tanpa `+`. */
export function tautanWaTagihan(nomorWa: string, pesan: string): string {
  return `https://wa.me/${nomorWa}?text=${encodeURIComponent(pesan)}`;
}

/**
 * Percakapan WhatsApp KOSONG — tanpa `?text=` sama sekali.
 *
 * Sengaja tanpa template (spec K6). Repo ini sudah dua kali salah menuliskan
 * kebijakan pembatalan dari ingatan, dan pesan siap-tempel yang menyebut aturan
 * adalah cara tercepat mengulanginya. Tagihan tetap bertemplat karena nominal
 * dan sisa waktunya DIHITUNG SERVER, bukan diingat manusia.
 */
export function tautanWaPercakapan(nomorWa: string): string {
  return `https://wa.me/${nomorWa}`;
}
