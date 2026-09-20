import "server-only";
import { PDFDocument, PDFFont, StandardFonts, rgb, degrees } from "pdf-lib";

/**
 * Nama & email pembeli diketik manusia, jadi keduanya data tak tepercaya di
 * konteks dokumen yang akan dibakar.
 *
 * Karakter kontrol C0 mentah, KECUALI tab/LF/CR, DIBUANG — bukan di-escape.
 * Tidak ada bentuk escaped yang sah bagi mereka, dan satu nama yang memuat
 * salah satunya membuat pencapan throw untuk SETIAP unduhan pembeli itu,
 * permanen, tanpa satu pun jejak di layar yang menunjuk penyebabnya (nama
 * pembeli). Alasan yang sama persis sudah ditulis panjang di
 * `lib/materi/watermark.ts`.
 */
export function bersihkanNamaCap(teks: string): string {
  let hasil = "";
  for (const huruf of teks) {
    const kode = huruf.codePointAt(0)!;
    const kontrolTerlarang = kode < 0x20 && kode !== 0x09 && kode !== 0x0a && kode !== 0x0d;
    if (!kontrolTerlarang && kode !== 0x7f) hasil += huruf;
  }
  return hasil;
}

/**
 * Menjinakkan teks untuk font standar `Helvetica` (encoding WinAnsi), yang
 * cakupannya cuma Latin-1 — bukan Unicode penuh.
 *
 * Ditemukan lewat review (fix round 1, Task 10): `drawText` MELEMPAR untuk
 * karakter apa pun di luar WinAnsi — nama Vietnam ("Nguyễn"), Tionghoa
 * ("李"), Arab, Kiril, dst. Tanpa penjinakan ini, PEMBELI SAH yang namanya
 * memuat karakter semacam itu tidak akan PERNAH bisa mengunduh produk yang
 * ia MILIKI — kelas kegagalan permanen yang sama persis dengan yang dicegah
 * `bersihkanNamaCap` untuk karakter kontrol, kali ini soal encoding, bukan
 * soal karakter kontrol.
 *
 * Dua tahap, bukan satu:
 *   1. NFKD lalu buang tanda diakritik GABUNGAN (pola yang sama dengan
 *      `slugDariJudul` di `lib/produk/status.ts`). Ini mengubah "ễ" jadi
 *      dasarnya "e" — WinAnsi-encodable — sehingga nama Latin berdiakritik
 *      (Vietnam, sebagian besar Eropa) TETAP TERBACA sebagai transliterasi
 *      tanpa aksen, bukan hilang.
 *   2. Saring SATU PER SATU karakter yang tersisa dan masih tidak bisa
 *      di-encode WinAnsi sesudah tahap 1 — aksara yang TIDAK PUNYA padanan
 *      Latin sama sekali (Tionghoa, Arab, Kiril, …) dibuang di sini, per
 *      karakter, supaya SISA nama yang encodable tetap tampil alih-alih
 *      seluruh `drawText` gagal karena satu karakter.
 *
 * Bisa memulangkan STRING KOSONG (nama yang seluruhnya non-Latin, mis. nama
 * Tionghoa murni) — pemanggil (`capPdfPembeli`) yang memutuskan cadangannya,
 * fungsi ini tidak pernah throw untuk input apa pun.
 */
function amanWinAnsi(font: PDFFont, teks: string): string {
  const dilepasDiakritik = teks.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  let hasil = "";
  for (const huruf of dilepasDiakritik) {
    try {
      font.encodeText(huruf);
      hasil += huruf;
    } catch {
      // WinAnsi tidak punya representasi untuknya sama sekali — dibuang,
      // bukan diganti tanda tanya yang tidak menjelaskan apa pun.
    }
  }
  return hasil.trim();
}

/**
 * Satu berkas tercap per pembeli, bukan satu per unduhan.
 *
 * Mencap PDF tebal setiap kali tombol diklik adalah kerja CPU yang berulang
 * tanpa guna; menyimpannya membuat unduhan kedua dan seterusnya hanya
 * berbiaya satu tanda tangan.
 */
export function objekPdfPembeli(productId: string, clientId: string): string {
  return `${prefiksPdfPembeli(productId)}/${clientId}.pdf`;
}

/**
 * Folder tempat seluruh salinan tercap satu produk tinggal.
 *
 * Ada sebagai fungsi tersendiri karena salinan tercap punya SATU sifat yang
 * mudah terlupa: ia adalah TURUNAN dari PDF sumber, bukan berkas mandiri.
 * Begitu sumbernya diganti atau dilepas, seluruh isi folder ini menjadi
 * jawaban lama atas pertanyaan yang sudah berubah — dan rute unduh
 * (`/api/produk/[id]/unduh`) memakai ulang salinan yang ada tanpa pernah
 * membandingkannya dengan sumber. Yang mengganti sumber karena itu WAJIB
 * mengosongkan folder ini; lihat `admin/produk/[id]/unggah.ts`.
 */
export function prefiksPdfPembeli(productId: string): string {
  return `${productId}/pembeli`;
}

/**
 * Membakar identitas pembeli KE DALAM setiap halaman PDF.
 *
 * Dibakar, bukan dilapiskan: lapisan CSS hilang begitu berkasnya disimpan,
 * dan kebocoran yang tidak menunjuk sumbernya sama saja dengan tidak ada
 * proteksi sama sekali.
 *
 * DUA syarat berlaku SEKALIGUS, dan yang kedua sama pentingnya dengan yang
 * pertama (fix round 1, Task 10):
 *   1. Fungsi ini TIDAK PERNAH throw, untuk nama/email apa pun.
 *   2. Stempelnya TETAP MENGENALI pembelinya. Nama yang diganti tanda tanya
 *      atau dihilangkan begitu saja mengalahkan seluruh maksud stempel —
 *      kebocoran yang tidak menunjuk sumbernya bukan proteksi sama sekali,
 *      persis alasan yang sama di komentar di atas soal "dibakar, bukan
 *      dilapiskan".
 *
 * `idCadangan` (PADMA ID pembeli — sudah dipakai sebagai identitas tampil di
 * `bakarWatermark`/`lib/materi/watermark.ts`) adalah GARIS PERTAHANAN
 * TERAKHIR: nama diutamakan, lalu email bila nama sama sekali tidak
 * ber-representasi WinAnsi (mis. nama Tionghoa murni), lalu ID ini bila
 * KEDUANYA gagal. Stempelnya secara eksplisit MENYEBUT bila ia jatuh ke
 * cadangan — lihat komentar di bawah — supaya siapa pun yang membaca
 * stempelnya tahu nama sesungguhnya tidak termuat di sini, bukan diam-diam
 * menampilkan sesuatu yang terlihat seperti nama padahal bukan.
 */
export async function capPdfPembeli(
  pdf: Uint8Array,
  nama: string,
  email: string,
  idCadangan: string,
): Promise<Uint8Array> {
  const dok = await PDFDocument.load(pdf);
  const font = await dok.embedFont(StandardFonts.Helvetica);

  const namaAman = amanWinAnsi(font, bersihkanNamaCap(nama));
  const emailAman = amanWinAnsi(font, bersihkanNamaCap(email));

  const bagian: string[] = [];
  if (namaAman !== "") {
    bagian.push(namaAman);
    if (emailAman !== "") bagian.push(emailAman);
  } else if (emailAman !== "") {
    // Nama sama sekali tak ber-representasi WinAnsi — email menggantikannya
    // sebagai identitas UTAMA, dan stempelnya bilang begitu.
    bagian.push(`${emailAman} (nama tak dapat ditampilkan)`);
  } else {
    // Nama DAN email sama-sama tak ber-representasi WinAnsi — kejadian yang
    // sangat jarang (email pada dasarnya ASCII), tapi ID PADMA selalu
    // ber-representasi WinAnsi sehingga stempelnya tidak pernah kosong.
    bagian.push(`${idCadangan} (nama & email tak dapat ditampilkan)`);
  }
  const teks = `${bagian.join(" - ")} - PADMA`;

  for (const halaman of dok.getPages()) {
    const { width, height } = halaman.getSize();
    halaman.drawText(teks, {
      x: width * 0.1,
      y: height * 0.35,
      size: 16,
      font,
      color: rgb(0.42, 0.47, 0.44),
      opacity: 0.18,
      rotate: degrees(30),
    });
  }
  return dok.save();
}
