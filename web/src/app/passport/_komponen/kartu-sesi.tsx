import Link from "next/link";
import type { SesiRingkas } from "@/lib/passport/turunan";
import { formatTanggalPendek } from "@/lib/passport/waktu";
import { LABEL_SESI_KLIEN, PIL_SESI_KLIEN } from "./status-sesi";

// Satu kunjungan = satu "visa" di paspor: tanggal di tepi kiri, layanan dan
// bidan di tengah, status di kanan.
//
// KOMPONEN SERVER, dan sebuah TAUTAN — dua-duanya perubahan yang disengaja.
// Sebelumnya ini komponen klien dengan laci yang mengembang, dan catatan bidan
// SELURUH sesi ikut terkirim ke perangkat bersama halaman daftar (dokblok
// versi lama mengakuinya apa adanya). Passport sering dibuka di ruang bersama.
// Sejak catatan punya halamannya sendiri, kartu ini tidak lagi membawa satu
// pun kalimat perawatan: yang menyeberang hanyalah tanggal, layanan, bidan,
// dan status.
//
// `data-sesi-*` bukan hiasan: TANGGAL, STATUS, dan penanda "berikutnya" adalah
// kontrak yang diuji, sementara kelas Tailwind berubah tiap kali desain
// disetel.
export function KartuSesi({
  sesi,
  berikutnya,
}: {
  sesi: SesiRingkas;
  berikutnya: boolean;
}) {
  const t = formatTanggalPendek(sesi.tanggal);

  return (
    <Link
      href={`/passport/sesi/${sesi.id}`}
      data-sesi-tanggal={sesi.tanggal}
      data-sesi-status={sesi.status}
      data-sesi-berikutnya={berikutnya ? "ya" : undefined}
      className={`flex items-center gap-3.5 overflow-hidden rounded-xl bg-[#FFFEFA] p-4 ${
        berikutnya
          ? "border-[1.6px] border-dashed border-gold bg-[#FDFAF1]"
          : "border border-black/10"
      }`}
    >
      <span className="w-[52px] flex-none border-r border-black/10 pr-3 text-center font-mono text-[11px] leading-tight text-ink-soft">
        <b className="block text-[19px] font-medium text-night">{t.hari}</b>
        {t.bulan}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-sm text-ink">{sesi.namaLayanan}</b>
        <span className="text-xs text-ink-soft">{sesi.namaMitra}</span>
      </span>
      <span
        className={`flex-none rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${PIL_SESI_KLIEN[sesi.status]}`}
      >
        {LABEL_SESI_KLIEN[sesi.status]}
      </span>
      <svg width="8" viewBox="0 0 8 14" aria-hidden className="flex-none text-ink-soft">
        <path
          d="M1 1l6 6-6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </Link>
  );
}
