import type { User } from "@supabase/supabase-js";
import {
  isClientLinked,
  linkClientByInvite,
  tautkanKlienLewatEmailTerverifikasi,
  terbitkanKlienMandiri,
} from "@/lib/auth/link-client";

/**
 * GERBANG TUNGGAL PENAUTAN AKUN KLIEN (spec 8 September 2026, K2).
 *
 * Semua jalur masuk — email+sandi, Google, tautan undangan WhatsApp — bermuara
 * di sini lewat `/setelah-masuk`. Satu gerbang, bukan logika per halaman:
 * DUPLIKASI ATURAN KEAMANAN DI DUA TEMPAT adalah cara kedua celah terdahulu
 * lahir (lihat riwayatnya di `@/lib/auth/link-client`). Trigger basis data
 * ditolak sebagai alternatif karena ia tidak bisa membedakan "datang dengan
 * undangan" dari "daftar mandiri" — padahal justru pembedaan itu intinya.
 *
 * Berkas ini SENGAJA tipis. Ia tidak menyentuh basis data sendiri; seluruh
 * tulisannya terjadi di dalam fungsi-fungsi `link-client.ts` yang masing-masing
 * membawa penjaganya sendiri. Yang dipegang berkas ini hanyalah URUTAN — dan
 * urutan itulah keamanannya.
 */

/**
 * Ke mana pengguna diarahkan sesudah gerbang menilai keadaannya.
 * Ketiganya rute yang benar-benar ada; ditulis sebagai union supaya salah ketik
 * tertangkap kompilator, bukan oleh pengguna yang mendarat di 404.
 */
export type TujuanKlien = "/passport" | "/akun-belum-terhubung" | "/periksa-email";

/**
 * Menentukan tujuan seorang klien sesudah login, sambil menautkan akunnya bila
 * memang berhak.
 *
 * URUTAN DI BAWAH TIDAK BOLEH DITUKAR. Ia bukan susunan `if` yang kebetulan
 * berurutan begitu:
 *
 *   1. Sudah tertaut → selesai. Dicari lewat `user_id` (identitas yang sudah
 *      dibuktikan), tidak pernah lewat email.
 *   2. Token undangan, bila ada. Jalur lama, tidak disentuh sama sekali.
 *   3. EMAIL BELUM TERBUKTI → berhenti di sini.
 *   4. Tautkan ke baris klien beremail sama.
 *   5. Terbitkan baris klien baru — KECUALI ia datang membawa token undangan
 *      yang gagal ditukarkan.
 *
 * Langkah 3 dinaikkan ke atas 4 dan 5 karena IA YANG MENJAGA KEDUANYA. Kalau ia
 * turun ke bawah — atau hilang — maka "email cocok" kembali menjadi cukup, dan
 * itu persis celah yang pernah terbukti sampai terbacanya catatan medis seorang
 * klien oleh orang yang hanya menebak alamat emailnya. Keduanya memang memeriksa
 * `email_confirmed_at` lagi di dalam dirinya sendiri (pertahanan berlapis), tapi
 * lapis itu ada untuk pemanggil yang belum ditulis — bukan alasan untuk
 * melonggarkan lapis di sini.
 *
 * Perhatikan juga apa yang TIDAK ada di langkah 3: ia tidak menanyakan apakah
 * ada baris klien beremail sama sebelum memutuskan. Menanyakannya akan membuat
 * halaman `/periksa-email` bisa membedakan "email Anda terdaftar sebagai klien
 * PADMA" dari "tidak" — dan PADMA melayani perempuan yang sedang hamil, nifas,
 * atau menjalani program kehamilan.
 */
export async function pastikanKlien(
  user: User,
  tokenUndangan: string,
): Promise<TujuanKlien> {
  // 1. Login kedua dan seterusnya: tidak ada token yang dibawa, dan tidak perlu.
  if (await isClientLinked(user.id)) return "/passport";

  // 2. Jalur undangan — kode lama, apa adanya. Undangan didahulukan atas email
  //    terverifikasi karena ia bukti yang LEBIH kuat: ia membuktikan bahwa tim
  //    PADMA memang bermaksud menautkan akun ini ke baris klien itu, bukan
  //    sekadar bahwa alamat emailnya benar milik pemakainya.
  //
  //    Kegagalannya DIINGAT (bukan sekadar dilewati) — lihat langkah 5.
  let undanganGagal = false;
  if (tokenUndangan) {
    if (await linkClientByInvite(user.id, user.email ?? "", tokenUndangan)) {
      return "/passport";
    }
    undanganGagal = true;
  }

  // 3. PENJAGA LANGKAH 4 & 5 — jangan pindahkan ke bawah keduanya.
  if (!user.email_confirmed_at) return "/periksa-email";

  // 4. Baris klien beremail sama yang belum tertaut (mis. dibuat admin lebih
  //    dulu, lalu kliennya mendaftar sendiri tanpa membuka tautan WhatsApp).
  //
  //    SENGAJA TIDAK digerbangi `undanganGagal`. Token kedaluwarsa ditambah
  //    email terkonfirmasi yang cocok adalah persis cadangan yang diminta K14:
  //    tautan WhatsApp basi, kliennya toh pemilik alamat itu, dan barisnya
  //    memang menunggunya. Menutup langkah ini akan membuat undangan yang
  //    lewat masa berlakunya berubah menjadi jalan buntu.
  if (await tautkanKlienLewatEmailTerverifikasi(user)) return "/passport";

  // 5. Belum ada baris klien sama sekali: terbitkan, sudah bertuan sejak INSERT.
  //
  //    KECUALI ia datang membawa token undangan yang GAGAL. Token yang ada di
  //    tangannya berarti PADMA sudah punya baris untuk orang ini — sinyal
  //    terkuat yang mungkin bahwa baris BARU adalah jawaban yang salah. Kalau
  //    langkah 4 pun tidak menemukan barisnya, yang terjadi hampir pasti
  //    emailnya meleset dari yang diketik admin (`rina@` vs `rina.hapsari@`),
  //    dan menerbitkan baris kedua di sini berarti ia mendapat Passport kosong
  //    sementara rekam medisnya yang sebenarnya tetap tak terlihat olehnya —
  //    tanpa seorang pun diberi tahu. Lebih baik ia mendarat di halaman yang
  //    menyuruhnya menghubungi PADMA.
  if (!undanganGagal && (await terbitkanKlienMandiri(user))) return "/passport";

  // Kalah balapan: baris klien lahir atau tertaut oleh permintaan lain
  // sepersekian detik lalu (langkah 5 memulangkan `false` justru untuk itu —
  // ia tidak menautkan sendiri, karena menautkan dari sana berarti melewati
  // pemeriksaan langkah 4). Periksa sekali lagi sebelum menyerah; kalau memang
  // bukan miliknya, jawabannya tetap "belum terhubung" — gagal tertutup.
  return (await isClientLinked(user.id)) ? "/passport" : "/akun-belum-terhubung";
}
