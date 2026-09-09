import { bentukJamSah } from "@/lib/jadwal/jam";

/**
 * BENTUK NILAI SETELAN — satu-satunya tempat yang memutuskan "nilai seperti apa
 * yang boleh hidup di `app_settings`", dan "nomor mana yang benar-benar dipakai
 * ketika yang tersimpan tidak masuk akal".
 *
 * Berkas ini MURNI dari sisi infrastruktur: satu-satunya impornya adalah modul
 * murni lain (`@/lib/jadwal/jam`), bukan Supabase maupun `node:crypto`. Yang
 * dijaga larangan di bawah adalah itu — bukan jumlah impornya. Ia dipakai dari tiga sisi
 * yang tidak boleh saling menyeret: `@/lib/settings` (service role, dipanggil
 * halaman publik), server action panel admin (sesi pengguna), dan komponen
 * `"use client"` yang menyusun pratinjau. Satu impor Supabase di sini sudah
 * cukup untuk menarik klien service role ke bundel browser.
 *
 * ===== KENAPA PENJAGAAN NILAI, BUKAN PENJAGAAN BARIS =====
 * `settings.ts` semula berbunyi:
 *
 *     const link = (data?.value ?? "6287778400200").replace(/\D/g, "");
 *
 * Operator `??` hanya menyala bila BARISNYA hilang. Nilai `""` — yang bisa lahir
 * dari satu klik "Simpan" pada medan kosong — lolos apa adanya, `replace`
 * mengembalikan `""`, dan seluruh kanal konversi menerbitkan `https://wa.me/`.
 * Tautan itu rusak untuk setiap pengunjung, tanpa satu pun error di log dan
 * tanpa satu pun test merah. Karena itu yang dijaga di sini adalah NILAI-nya.
 *
 * ===== KENAPA NORMALISASI, BUKAN SEKADAR PENOLAKAN =====
 * Admin klinik menyalin nomor dari kontak ponsel: `0877-7840-0200`. Formatnya
 * benar menurut manusia dan salah menurut `wa.me` — tautannya terbit, terlihat
 * wajar di panel, dan selalu gagal di sisi pengunjung. Nomor lokal karena itu
 * diterjemahkan ke bentuk internasional, bukan ditolak.
 */

/** Bentuk yang dikenal registri `app_setting_keys.bentuk` (CHECK di basis data). */
export type BentukSetelan = "nomor_wa" | "teks_polos" | "daftar_jam";

/**
 * Nomor cadangan. Ia bukan "nilai default yang boleh dilupakan": ia jaring
 * pengaman supaya halaman publik tidak pernah menerbitkan tautan rusak. Nilai
 * sungguhannya tinggal di `app_settings`, disunting lewat /admin/pengaturan.
 */
export const NOMOR_WA_BAWAAN = "6287778400200";

/**
 * Teks cadangan untuk dua setelan yang dipajang di footer landing.
 *
 * Sama seperti `NOMOR_WA_BAWAAN`, keduanya BUKAN "nilai default yang boleh
 * dilupakan" melainkan jaring pengaman: baris `alamat_klinik` /
 * `jam_operasional` boleh belum pernah diisi (registri melahirkannya lewat
 * migration, bukan seed), dan satu klik "Simpan" pada medan kosong bisa
 * menyimpan `""`. Tanpa jaring ini footer terbit dengan baris hilang —
 * kegagalan senyap yang persis sama bentuknya dengan `https://wa.me/`.
 *
 * `ALAMAT_BAWAAN` adalah kalimat yang SELAMA INI ditulis keras di
 * `src/app/_landing/footer.tsx`; ia dipindahkan ke sini, bukan dikarang.
 */
export const ALAMAT_BAWAAN = "Melayani area Jabodetabek";

/**
 * QRIS cadangan (spec J12). Sama seperti nomor WA: BUKAN "nilai default yang
 * boleh dilupakan", melainkan jaring supaya halaman Bayar tidak pernah terbit
 * tanpa kode yang bisa dipindai. Nilai sungguhannya ditanam migrasi dan
 * disunting lewat /admin/pengaturan.
 */
export const QRIS_GAMBAR_BAWAAN = "/qris-padma.jpeg";
export const QRIS_MERCHANT_BAWAAN = "PADMA WOMEN'S WELLNESS HOMEC, KESEHATAN & OLAHRAGA";
export const QRIS_NMID_BAWAAN = "ID1026557963836";
export const JAM_BAWAAN = "Jadwal kunjungan diatur lewat WhatsApp";

export const PANJANG_WA_MIN = 8;
export const PANJANG_WA_MAKS = 15; // E.164

/** Panjang wajar untuk setelan teks yang dipajang di footer/kartu. */
export const PANJANG_TEKS_MAKS = 200;

/**
 * Skema URL yang tidak boleh muncul di setelan teks.
 *
 * Nilai `app_settings` mendarat di `href`, `src`, dan `window.open`. `\b`
 * mendahului daftar supaya kata biasa yang KEBETULAN berakhiran salah satunya
 * ("profile:", "metadata:") tidak ikut tertolak — pagar yang menolak kalimat
 * sah akan dilepas orang berikutnya.
 */
const SKEMA_BERBAHAYA = /\b(javascript|data|vbscript|file|blob)\s*:/i;

export function digitSaja(mentah: string): string {
  return mentah.replace(/\D/g, "");
}

/**
 * Bentuk internasional tanpa `+`, sebagaimana dituntut `wa.me`.
 * `0877…` → `62877…`; nomor yang sudah internasional dibiarkan apa adanya.
 */
export function keInternasional(mentah: string): string {
  const digit = digitSaja(mentah);
  if (digit.startsWith("0")) return `62${digit.slice(1)}`;
  return digit;
}

export function nomorWaSah(mentah: string): boolean {
  const digit = keInternasional(mentah);
  return digit.length >= PANJANG_WA_MIN && digit.length <= PANJANG_WA_MAKS;
}

/**
 * Nomor yang BENAR-BENAR dipakai halaman publik.
 *
 * Menerima apa pun yang tersimpan (termasuk `null`, `""`, dan teks) dan selalu
 * mengembalikan nomor yang bisa dipasang di `wa.me`. Inilah pengganti
 * `?? bawaan`: yang diperiksa nilainya, bukan keberadaan barisnya.
 */
export function nomorWaTerpakai(tersimpan: string | null | undefined): string {
  const digit = keInternasional(tersimpan ?? "");
  return nomorWaSah(digit) ? digit : NOMOR_WA_BAWAAN;
}

/**
 * Nomor WhatsApp SEORANG KLIEN — kembarannya `nomorWaTerpakai`, dan
 * PERBEDAANNYA ADALAH INTINYA: ketiadaan nomor cadangan.
 *
 * `nomorWaTerpakai` menjaga halaman publik, dan di sana nomor cadangan memang
 * jawaban yang benar: yang dituju selalu PADMA sendiri, jadi nomor klinik yang
 * agak basi tetap lebih baik daripada `https://wa.me/` yang rusak.
 *
 * Di sini yang dituju ORANG LAIN, dan cadangan berubah dari jaring pengaman
 * menjadi cacat. Itu bukan kekhawatiran teoretis: tautan "Kirim tagihan via WA"
 * di antrean admin pernah dirakit dengan `nomorWaTerpakai` atas setelan klinik,
 * sehingga setiap tagihan terbuka sebagai percakapan PADMA dengan dirinya
 * sendiri — berisi nama klien, jadwalnya, dan nominalnya. Admin yang tidak
 * memperhatikan mengira tagihan sudah terkirim, kliennya tidak pernah menerima
 * apa pun, dan tenggat 24 jam tetap berjalan sampai jadwalnya lepas.
 *
 * Karena itu nomor yang tidak sah memulangkan `""`, dan pemanggilnya WAJIB
 * memperlakukan itu sebagai "tidak ada tautan" — bukan sebagai tautan kosong
 * yang tetap dipasang.
 */
export function nomorWaKlien(tersimpan: string | null | undefined): string {
  const digit = keInternasional(tersimpan ?? "");
  return nomorWaSah(digit) ? digit : "";
}

/**
 * Teks setelan yang BENAR-BENAR dipajang halaman publik.
 *
 * Pasangan `nomorWaTerpakai` untuk kunci bertipe `teks_polos`, dan dijaga
 * dengan aturan yang SAMA — bukan aturan kedua yang bisa berselisih dengannya.
 * Yang diperiksa NILAI-nya, bukan keberadaan barisnya: `null` (belum pernah
 * diisi), `""`, `"   "`, dan nilai yang tidak lolos `periksaNilai` (mis. yang
 * mendarat lewat service role tanpa melewati panel) semuanya jatuh ke teks
 * bawaan. Nilai yang lolos dikembalikan TERNORMALISASI, sehingga apa yang
 * dipajang halaman publik persis sama dengan apa yang disimpan panel.
 */
export function teksTerpakai(
  tersimpan: string | null | undefined,
  bawaan: string,
): string {
  const hasil = periksaNilai("teks_polos", tersimpan ?? "");
  return hasil.ok ? hasil.nilai : bawaan;
}

/** 6287778400200 → 0877-7840-0200 */
export function keFormatLokal(internasional: string): string {
  const lokal = internasional.startsWith("62")
    ? "0" + internasional.slice(2)
    : internasional;
  return lokal.replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3");
}

export type HasilPeriksa =
  | { ok: true; nilai: string }
  | { ok: false; pesan: string };

/**
 * Gerbang tulis setelan.
 *
 * `bentuk` datang dari registri `app_setting_keys` yang dibaca DI SERVER —
 * tidak pernah dari formulir. Bila browser boleh memilih validatornya sendiri,
 * penyerang cukup menyebut `nomor_wa` sebagai `teks_polos` dan seluruh sanitasi
 * digit di bawah ini menguap.
 *
 * Nilai yang lolos dikembalikan dalam bentuk TERNORMALISASI, dan bentuk itulah
 * yang disimpan — supaya basis data tidak pernah menyimpan dua ejaan untuk satu
 * nomor yang sama.
 */
export function periksaNilai(bentuk: BentukSetelan, mentah: string): HasilPeriksa {
  const nilai = mentah.trim();

  if (bentuk === "daftar_jam") {
    // Jalur TULIS sengaja LEBIH KETAT daripada jalur BACA.
    // `uraikanDaftarJam()` (lib/jadwal/jam.ts) membuang entri yang salah bentuk
    // dan jatuh ke daftar bawaan bila tidak ada yang tersisa — itu benar untuk
    // MEMBACA, karena formulir pemesanan tidak boleh pernah terbit tanpa satu
    // pun pilihan jam. Untuk MENULIS, sikap yang sama akan berbohong: admin
    // mengetik "8 pagi", panel menjawab "Tersimpan", dan yang tersimpan adalah
    // sesuatu yang lain. Di sini setiap entri yang tidak sah DITOLAK dengan
    // menyebut entrinya.
    const entri = nilai
      .split(",")
      .map((bagian) => bagian.trim())
      .filter((bagian) => bagian.length > 0);

    if (entri.length === 0) {
      return { ok: false, pesan: "Isi minimal satu jam, misalnya 08:00, 09:00, 13:00." };
    }
    const salah = entri.filter((jam) => !bentukJamSah(jam));
    if (salah.length > 0) {
      return {
        ok: false,
        pesan: `Jam harus ditulis 24 jam dengan format HH:MM — perbaiki: ${salah.join(", ")}.`,
      };
    }
    // Menit ganjil ditolak di sini juga, bukan hanya oleh CHECK basis data pada
    // `booking_requests.jam_mulai`: jam seperti 09:07 akan lolos sampai ke
    // formulir pemesanan, lalu gagal saat klien menekan kirim — kegagalan yang
    // muncul di tangan orang yang tidak melakukan kesalahan apa pun.
    const menitGanjil = entri.filter((jam) => !["00", "30"].includes(jam.slice(3)));
    if (menitGanjil.length > 0) {
      return {
        ok: false,
        pesan: `Jam mulai hanya boleh pada menit :00 atau :30 — perbaiki: ${menitGanjil.join(", ")}.`,
      };
    }

    // Ternormalisasi: unik dan terurut, supaya basis data tidak pernah
    // menyimpan dua ejaan untuk daftar yang sama.
    return { ok: true, nilai: [...new Set(entri)].sort().join(", ") };
  }

  if (bentuk === "nomor_wa") {
    if (nilai.length === 0) {
      return { ok: false, pesan: "Nomor WhatsApp wajib diisi." };
    }
    const digit = keInternasional(nilai);
    if (digit.length === 0) {
      return { ok: false, pesan: "Nomor WhatsApp hanya boleh berisi angka." };
    }
    if (!nomorWaSah(digit)) {
      return {
        ok: false,
        pesan: `Nomor WhatsApp harus ${PANJANG_WA_MIN}–${PANJANG_WA_MAKS} angka, misalnya 0877-7840-0200 atau 6287778400200.`,
      };
    }
    return { ok: true, nilai: digit };
  }

  if (nilai.length === 0) {
    return { ok: false, pesan: "Isian ini wajib diisi." };
  }
  if (nilai.length > PANJANG_TEKS_MAKS) {
    return {
      ok: false,
      pesan: `Teks terlalu panjang — maksimal ${PANJANG_TEKS_MAKS} karakter.`,
    };
  }
  if (/[<>]/.test(nilai)) {
    return { ok: false, pesan: "Tanda < dan > tidak boleh dipakai di sini." };
  }
  if (SKEMA_BERBAHAYA.test(nilai)) {
    return {
      ok: false,
      pesan: "Teks tidak boleh memuat alamat tautan. Isi keterangannya saja.",
    };
  }
  return { ok: true, nilai };
}
