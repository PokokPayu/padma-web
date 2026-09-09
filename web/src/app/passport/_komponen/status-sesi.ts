import type { StatusSesi } from "@/lib/passport/turunan";

// Berkas sendiri sejak `/passport/sesi/[id]` lahir: kartu daftar DAN halaman
// detail menampilkan status yang sama, dan dua salinan label yang harus
// identik selamanya adalah kembaran yang akhirnya menyimpang. Komentar di
// bawah menjelaskan justru pilihan kata yang tidak boleh hilang.

// Label yang dilihat KLIEN. Sengaja tidak memakai `LABEL_SESI` dari
// `lib/jadwal/status.ts`: yang di sana ditulis untuk staf ("Dibatalkan PADMA"
// / "Dibatalkan klien" — laporan tentang SIAPA), dan klien tidak perlu membaca
// nama penyelenggaranya, atau dirinya sendiri disebut orang ketiga, di
// paspornya sendiri.
// Daftarnya tetap `Record<StatusSesi, …>` sehingga status baru mana pun
// menggagalkan build sampai kalimatnya diputuskan manusia.
export const LABEL_SESI_KLIEN: Record<StatusSesi, string> = {
  selesai: "Selesai",
  terjadwal: "Terjadwal",
  berjalan: "Berlangsung",
  tidak_hadir: "Tidak hadir",
  dibatalkan_padma: "Dibatalkan",
  // Klien di sini adalah PEMILIK kartu ini, sedang membaca sesinya sendiri:
  // "Dibatalkan klien" hanya masuk akal ditulis oleh pihak ketiga (staf yang
  // membicarakan klien). "Anda batalkan" berbicara langsung kepadanya, dan
  // tetap mengabari fakta yang sama: ia yang memutuskan batal, bukan PADMA.
  dibatalkan_klien: "Anda batalkan",
};

export const PIL_SESI_KLIEN: Record<StatusSesi, string> = {
  selesai: "border-leaf/25 bg-leaf-soft text-leaf",
  terjadwal: "border-[#E9D9A8] bg-[#F7EDD3] text-[#8A6A1B]",
  berjalan: "border-leaf/25 bg-leaf/10 text-leaf",
  tidak_hadir: "border-black/10 bg-black/5 text-ink-soft",
  dibatalkan_padma: "border-black/10 bg-black/5 text-ink-soft",
  // Warna sama dengan `dibatalkan_padma`, sengaja: bagi klien keduanya sama-
  // sama "kunjungan ini tidak jadi", dan pembedaan uangnya (refund/hak/hangus)
  // sudah tersampaikan lewat saluran lain (WA/email), bukan lewat warna pil di
  // paspor. Pembedaan warna yang staf perlukan (lihat admin/sesi/page.tsx)
  // menjawab pertanyaan berbeda: siapa yang masih harus mengurus, bukan apa
  // yang dialami klien.
  dibatalkan_klien: "border-black/10 bg-black/5 text-ink-soft",
};

