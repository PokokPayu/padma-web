/**
 * PESAN TAGIHAN SIAP-SALIN UNTUK WHATSAPP (spec C2 P7).
 *
 * Berkas ini sengaja MURNI — tanpa satu pun impor. Kartu antrean di panel admin
 * adalah komponen `"use client"`, dan modul yang menyentuh Supabase memuat
 * klien service role; satu impor dari sisi klien sudah cukup untuk menyeret
 * keduanya ke bundel peramban. Pola yang sama persis dengan
 * `lib/auth/pesan-undangan.ts`, dan alasannya juga sama: ia sudah pernah
 * menjatuhkan Tahap B.
 *
 * ===== KENAPA SIAP-SALIN, BUKAN TERKIRIM OTOMATIS =====
 * PADMA belum punya jalur kirim WhatsApp otomatis, dan menambahkannya berarti
 * satu penyedia baru beserta jalur kegagalannya. Admin menekan tombol, pesannya
 * tersalin, ia menempelkannya di percakapan yang sudah berjalan dengan klien
 * itu. Cara ini juga membuat nada pesannya tetap milik manusia.
 *
 * Lima unsur WAJIB ada, dan itu diuji: nama, layanan, kapan, berapa, dan sampai
 * kapan. Pesan tagihan tanpa batas waktu adalah pesan yang membuat orang
 * kehilangan slotnya tanpa pernah tahu ada tenggatnya.
 *
 * "Berapa" sekarang berarti RINCIAN, bukan satu angka. Klien yang hanya
 * menerima total tidak punya cara memeriksa apa pun, dan pertanyaan "kok
 * segini?" berakhir sebagai percakapan WhatsApp yang dijawab admin satu per
 * satu — jadi layanan dan transport ditulis sebagai baris terpisah, dengan
 * label jenjang menyertai transport supaya klien tahu itu berubah menurut
 * jarak bidan ke alamatnya, bukan harga layanan yang naik.
 */

export function pesanTagihan(input: {
  namaKlien: string;
  namaLayanan: string;
  /** Sudah diformat untuk manusia, mis. "20 Mei 2027". */
  tanggal: string;
  /** Sudah diformat, mis. "09.00 WIB". */
  jam: string;
  /** Sudah diformat, mis. "Rp 395.000". `null` bila tarifnya belum ada. */
  hargaLayanan: string | null;
  /** Sudah diformat, mis. "Rp 25.000". `null` bila jenjangnya belum diketahui. */
  hargaTransport: string | null;
  /** Mis. ">10–15 km". `null` bila jenjangnya belum diketahui. */
  labelJenjang: string | null;
  /** Sudah diformat, mis. "Rp 420.000". `null` bila totalnya belum lengkap. */
  total: string | null;
  /** Sudah diformat, mis. "24 jam lagi". */
  sisaWaktu: string;
}): string {
  const {
    namaKlien,
    namaLayanan,
    tanggal,
    jam,
    hargaLayanan,
    hargaTransport,
    labelJenjang,
    total,
    sisaWaktu,
  } = input;

  // RINCIAN, bukan satu angka. Klien yang hanya menerima total tidak punya
  // cara memeriksa apa pun, dan pertanyaan "kok segini?" berakhir sebagai
  // percakapan WhatsApp yang dijawab admin satu per satu. Transport khususnya
  // WAJIB terlihat terpisah: ia berubah menurut jarak bidan ke alamat, dan
  // klien yang tidak tahu itu membacanya sebagai harga layanan yang naik.
  const baris: string[] = [];
  if (hargaLayanan) baris.push(`• Layanan: ${hargaLayanan}`);
  if (hargaTransport) {
    baris.push(`• Transport${labelJenjang ? ` (${labelJenjang})` : ""}: ${hargaTransport}`);
  }

  return [
    `Halo ${namaKlien}, bidan untuk sesi Anda sudah siap 🌸`,
    "",
    `Layanan: ${namaLayanan}`,
    `Jadwal: ${tanggal}, ${jam}`,
    ...(baris.length > 0 ? ["", ...baris] : []),
    total ? `Total: ${total}` : "Total: menyusul dari tim",
    "",
    `Mohon selesaikan pembayaran dalam ${sisaWaktu}, lalu unggah bukti transfernya di menu Bayar pada Passport Anda.`,
    "QRIS-nya ada di halaman yang sama — nominalnya diketik sendiri sesuai total di atas.",
    "",
    "Kalau lewat dari batas itu, jadwalnya kami lepas untuk klien lain — tapi Anda tetap bisa mengajukan ulang kapan saja.",
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
