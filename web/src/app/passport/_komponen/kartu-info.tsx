import { Lotus } from "@/app/_landing/lotus";

// Kartu pengumuman kecil di beranda: sesi berikutnya, ajakan mengajukan
// jadwal, dan permintaan yang masih menunggu konfirmasi. Ketiganya berbagi
// satu bentuk supaya beranda tidak berubah menjadi tumpukan kotak yang masing-
// masing punya gaya sendiri.
//
// `garis`: "putus" untuk hal yang sudah pasti terjadwal, "titik" untuk yang
// masih menunggu tim PADMA — perbedaan status dibaca dari bentuk, bukan hanya
// dari kata.
export function KartuInfo({
  judul,
  detail,
  berlambang = false,
  garis = "putus",
}: {
  judul: string;
  detail: string;
  berlambang?: boolean;
  garis?: "putus" | "titik";
}) {
  return (
    <div
      className={`mb-3.5 flex items-center gap-3.5 rounded-2xl border-[1.6px] bg-[#FDFAF1] p-4 text-[13px] ${
        garis === "putus" ? "border-dashed border-gold" : "border-dotted border-gold/70"
      }`}
    >
      {berlambang && (
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-night text-gold-bright">
          <Lotus className="w-5" />
        </span>
      )}
      <span className="min-w-0">
        <b className="block text-sm text-night">{judul}</b>
        <span className="text-ink-soft">{detail}</span>
      </span>
    </div>
  );
}
