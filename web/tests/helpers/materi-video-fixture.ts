/**
 * Id & nilai `objek` dari fixture video demo yang disemai
 * `tests/global-setup.ts` (SEKALI, sebelum berkas test mana pun berjalan) —
 * lihat komentar lengkap di sana untuk kenapa fixture ini perlu ada sama
 * sekali.
 *
 * Konstanta murni (bukan fungsi/koneksi DB), sengaja dipisah dari
 * `global-setup.ts` supaya berkas test biasa mengimpornya dari lokasi yang
 * jelas maksudnya "helper test", bukan dari berkas globalSetup vitest yang
 * konvensinya untuk konfigurasi run, bukan untuk diimpor balik.
 */
export const MATERI_VIDEO_TERBUKA = "77777777-7777-7777-7777-777777777701";
export const MATERI_VIDEO_TERKUNCI = "77777777-7777-7777-7777-777777777703";
export const OBJEK_VIDEO_TERBUKA = `${MATERI_VIDEO_TERBUKA}/fixture-demo.mp4`;
export const OBJEK_VIDEO_TERKUNCI = `${MATERI_VIDEO_TERKUNCI}/fixture-rahasia.mp4`;
