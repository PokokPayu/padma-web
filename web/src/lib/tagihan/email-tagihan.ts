/**
 * PERENDER EMAIL TAGIHAN.
 *
 * MURNI — tanpa satu pun impor, dengan alasan yang sama seperti
 * `pesan-tagihan.ts`: berkas ini diimpor dari `src/app/admin/sesi/**`, dan satu
 * impor bermodul Supabase di sini sudah cukup menyeret klien service role ke
 * bundel peramban.
 *
 * ===== KENAPA TENGGATNYA ABSOLUT, BUKAN "24 JAM LAGI" =====
 * Pesan WhatsApp dibaca dalam hitungan menit; email dibaca ulang berhari-hari
 * kemudian. "24 jam lagi" yang dibaca tiga hari sesudah dikirim adalah kalimat
 * yang berbohong kepada orang yang sedang mencari tahu apakah ia masih sempat.
 *
 * ===== KENAPA TEKS POLOS WAJIB =====
 * Klien email yang memblokir HTML menampilkan bagian teks. Tagihan yang tampil
 * kosong sama saja dengan tagihan yang tidak pernah terkirim — dan tenggatnya
 * tetap berjalan.
 *
 * Tidak ada honor mitra, tidak ada margin, tidak ada apa pun dari
 * `variant_rates` selain `harga_klien`.
 */

/**
 * Escape HTML LOKAL — bukan pertahanan XSS (email dikirim ke klien itu
 * sendiri, dan klien email tidak menjalankan skrip), melainkan pertahanan
 * TATA LETAK: nama klien atau nama layanan yang kebetulan mengandung `<` atau
 * `&` akan merusak markup di sekelilingnya kalau diinterpolasi mentah. Ditulis
 * di sini, bukan diimpor, supaya berkas ini tetap NOL IMPOR (lihat dokblok
 * atas berkas).
 */
function escapeHtml(nilai: string): string {
  return nilai
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function subjekTagihan(input: { namaLayanan: string; tanggal: string }): string {
  return `Tagihan sesi ${input.namaLayanan} — ${input.tanggal}`;
}

export function emailTagihan(input: {
  namaKlien: string;
  namaLayanan: string;
  /** Sudah diformat, mis. "20 Mei 2027". */
  tanggal: string;
  /** Sudah diformat, mis. "09.00 WIB". */
  jam: string;
  /** Sudah diformat, mis. "Rp 395.000". */
  hargaLayanan: string;
  hargaTransport: string;
  /** Mis. ">10–15 km". */
  labelJenjang: string;
  total: string;
  /** ABSOLUT, mis. "Rabu, 10 September 2026 pukul 14.30 WIB". */
  tenggatAbsolut: string;
  /** URL penuh ke halaman bayar, mis. "https://…/passport/bayar". */
  tautanBayar: string;
}): { html: string; teks: string } {
  const {
    namaKlien,
    namaLayanan,
    tanggal,
    jam,
    hargaLayanan,
    hargaTransport,
    labelJenjang,
    total,
    tenggatAbsolut,
    tautanBayar,
  } = input;

  const teks = [
    `Halo ${namaKlien},`,
    "",
    "Bidan untuk sesi Anda sudah siap. Berikut rincian tagihannya.",
    "",
    `Layanan : ${namaLayanan}`,
    `Jadwal  : ${tanggal}, ${jam}`,
    "",
    `Layanan            ${hargaLayanan}`,
    `Transport (${labelJenjang})  ${hargaTransport}`,
    `TOTAL              ${total}`,
    "",
    `Mohon selesaikan pembayaran paling lambat ${tenggatAbsolut}.`,
    `Bayar & unggah bukti transfer di: ${tautanBayar}`,
    "QRIS-nya ada di halaman yang sama — nominalnya diketik sendiri sesuai total di atas.",
    "",
    "Kalau lewat dari batas itu, jadwalnya kami lepas untuk klien lain — tapi Anda tetap bisa mengajukan ulang kapan saja.",
    "",
    "Terima kasih,",
    "Tim PADMA Wellness",
  ].join("\n");

  // Tabel + gaya sebaris: klien email mengabaikan <style> di <head> dan
  // sebagian besar aturan tata letak modern. Ini bukan HTML yang layak ditiru
  // di halaman web, dan memang tidak dipakai di sana.
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#22302A;line-height:1.6;max-width:520px">
  <p>Halo <b>${escapeHtml(namaKlien)}</b>,</p>
  <p>Bidan untuk sesi Anda sudah siap. Berikut rincian tagihannya.</p>
  <p style="margin:0 0 4px"><b>${escapeHtml(namaLayanan)}</b><br><span style="color:#5A6B62">${escapeHtml(tanggal)}, ${escapeHtml(jam)}</span></p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:6px 0;color:#5A6B62">Layanan</td><td style="padding:6px 0;text-align:right">${escapeHtml(hargaLayanan)}</td></tr>
    <tr><td style="padding:6px 0;color:#5A6B62">Transport · ${escapeHtml(labelJenjang)}</td><td style="padding:6px 0;text-align:right">${escapeHtml(hargaTransport)}</td></tr>
    <tr><td style="padding:10px 0;border-top:1px solid #E4E0D6"><b>Total</b></td><td style="padding:10px 0;border-top:1px solid #E4E0D6;text-align:right"><b>${escapeHtml(total)}</b></td></tr>
  </table>
  <p>Mohon selesaikan pembayaran paling lambat <b>${escapeHtml(tenggatAbsolut)}</b>.</p>
  <p><a href="${escapeHtml(tautanBayar)}" style="display:inline-block;background:#C9A227;color:#2A2013;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold">Bayar &amp; unggah bukti</a></p>
  <p style="color:#5A6B62;font-size:13px">QRIS-nya ada di halaman yang sama — nominalnya diketik sendiri sesuai total di atas. Kalau lewat dari batas itu, jadwalnya kami lepas untuk klien lain, tapi Anda tetap bisa mengajukan ulang kapan saja.</p>
  <p style="color:#5A6B62;font-size:13px">Terima kasih,<br>Tim PADMA Wellness</p>
</div>`;

  return { html, teks };
}
