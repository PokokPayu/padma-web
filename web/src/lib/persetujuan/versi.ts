/**
 * Versi Syarat & Ketentuan + Kebijakan Privasi — SATU nomor untuk keduanya.
 *
 * Klien menyetujui kedua dokumen sekaligus, jadi revisi salah satunya berarti
 * semua klien setuju ulang. Dua nomor versi bisa saling tertinggal diam-diam;
 * satu tidak bisa.
 *
 * Formatnya tanggal berlaku `YYYY-MM-DD` (dipaksa CHECK di
 * `persetujuan_akun.versi`). Nilainya diisi ulang dengan tanggal final saat
 * rilis — lihat "Prasyarat rilis" di spec 2026-10-06. MENAIKKAN nilai ini
 * membuat setiap klien bertemu gerbang `/persetujuan` sekali lagi.
 *
 * Versi SELALU dicap server dari konstanta ini. Peramban tidak pernah
 * mengirim nomor versi yang dipercaya.
 */
export const VERSI_DOKUMEN = "2026-11-19";
