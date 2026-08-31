import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { ringkasanPekanIni } from "@/lib/owner/data";
import { formatRupiah } from "@/lib/owner/rupiah";
import { formatTanggalID, hariIniJakarta } from "@/lib/passport/waktu";
import { TombolKeluar } from "@/app/_shell/tombol-keluar";

// Judul mengandalkan template `%s · PADMA` di root layout. Sebelum ini berkas
// inilah satu-satunya halaman yang memaksakan judul penuh sendiri — lengkap
// dengan nama aplikasi dan tanda pisah yang berbeda dari template — sehingga
// tab-nya sendirian keluar dari pola 21 halaman lain.
export const metadata = { title: "Panel Owner" };

function Kartu({
  label,
  nilai,
  keterangan,
  gelap = false,
}: {
  label: string;
  nilai: string;
  keterangan: string;
  /** Kartu gelap `stat.gold` prototipe — dipakai HANYA untuk margin PADMA. */
  gelap?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border px-5 py-5 ${
        gelap ? "border-gold/35" : "border-black/10 bg-white"
      }`}
      // Gradien `stat.gold` prototipe ditulis sebagai style inline, bukan
      // utilitas gradien Tailwind: nilainya persis angka yang sudah disetujui
      // di padma-prototype.html, dan menerjemahkannya ke sintaks utilitas
      // hanya menambah satu tempat lagi yang bisa bergeser diam-diam.
      style={gelap ? { backgroundImage: "linear-gradient(150deg,#12392A,#0A2B1F)" } : undefined}
    >
      <small
        className={`mb-2 block text-[11.5px] font-extrabold uppercase tracking-[0.06em] ${
          gelap ? "text-gold-bright" : "text-ink-soft"
        }`}
      >
        {label}
      </small>
      <span
        className={`block font-serif text-[29px] leading-none ${
          gelap ? "text-[#F5EEDC]" : "text-night"
        }`}
      >
        {nilai}
      </span>
      <span
        className={`mt-1.5 block text-[12px] ${gelap ? "text-[#A9BBAA]" : "text-ink-soft"}`}
      >
        {keterangan}
      </span>
    </div>
  );
}

export default async function OwnerPage() {
  const { nama } = await requireRole(["owner"]);

  // "Hari ini" menurut Jakarta, bukan menurut jam server (Vercel berjalan UTC).
  // Tanggalnya diteruskan sebagai argumen: lapisan data sengaja tidak membaca
  // jam sistem sendiri supaya pengelompokan pekan bisa diuji pada pekan mana pun.
  const hariIni = hariIniJakarta();
  const pekan = await ringkasanPekanIni(hariIni);

  return (
    <main>
      <header className="mb-5">
        <h1 className="font-serif text-2xl text-night">Panel Owner</h1>
        <p className="mt-1 text-[13px] text-ink-soft">
          Halo, {nama}. Ringkasan pekan berjalan · {formatTanggalID(hariIni)}
        </p>
      </header>

      <section
        aria-label={`Ringkasan pekan ${pekan.rentang}`}
        className="grid grid-cols-1 gap-3.5 sm:grid-cols-3"
      >
        <Kartu
          label="Sesi selesai pekan ini"
          nilai={String(pekan.jumlahSesi)}
          keterangan={
            pekan.jumlahSesi === 0
              ? "Selesaikan sesi di panel Admin — angka ini ikut bergerak."
              : `${pekan.jumlahMitra} mitra bekerja · ${pekan.rentang}`
          }
        />
        <Kartu
          label="Honor dibayar Sabtu ini"
          nilai={formatRupiah(pekan.totalHonor)}
          keterangan={`Dari sesi berstatus Selesai pekan ${pekan.rentang}`}
        />
        {/* Kartu gelap prototipe (`stat.gold`) sengaja dipakai HANYA di sini:
            margin adalah angka PADMA — per pekan, bukan per mitra
            (spec keputusan #6). */}
        <Kartu
          gelap
          label="Margin PADMA pekan ini"
          nilai={formatRupiah(pekan.margin)}
          keterangan="Harga klien − honor mitra"
        />
      </section>

      {/* Sesi yang lebih tua dari tarif paling awal layanannya TIDAK boleh
          dihitung nol diam-diam — itu uang yang hilang tanpa jejak. Ia muncul
          di sini sebagai peringatan yang menautkan langsung ke perbaikannya. */}
      {pekan.jumlahTakBertarif > 0 && (
        <p className="mt-4 rounded-2xl border border-clay/35 bg-white px-5 py-4 text-[12.5px] leading-relaxed text-ink">
          <b className="text-clay">
            {pekan.jumlahTakBertarif} sesi pekan ini belum bertarif.
          </b>{" "}
          Layanannya belum punya tarif yang berlaku pada tanggal sesi, jadi
          honornya belum ikut dihitung di angka mana pun di atas.{" "}
          <Link href="/owner/tarif" className="font-bold text-leaf underline underline-offset-4">
            Tetapkan tarifnya
          </Link>{" "}
          atau lihat rinciannya di{" "}
          <Link href="/owner/rekap" className="font-bold text-leaf underline underline-offset-4">
            Rekap &amp; Honor
          </Link>
          .
        </p>
      )}

      <p className="mt-4 text-[12px] leading-relaxed text-ink-soft">
        Honor dihitung dengan tarif yang berlaku <b>pada tanggal sesi</b>, jadi
        menaikkan tarif hari ini tidak menggeser satu angka pun di pekan yang
        sudah lewat.
      </p>

      <TombolKeluar />
    </main>
  );
}
