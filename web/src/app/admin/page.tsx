import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { hitungAntrean } from "@/lib/admin/antrean";
import { formatTanggalID, hariIniJakarta } from "@/lib/passport/waktu";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Panel Admin" };

function KartuAntrean({
  label,
  jumlah,
  keterangan,
  href,
}: {
  label: string;
  jumlah: number;
  keterangan: string;
  // WAJIB, bukan opsional: setiap angka di dashboard ini kini punya modul yang
  // bisa memadamkannya. Angka tanpa tujuan adalah alarm yang tidak bisa
  // dibersihkan — keadaan yang sempat nyata untuk "Klaim pembayaran" selama
  // modulnya belum ada, dan tidak boleh lahir lagi diam-diam.
  href: string;
}) {
  const isi = (
    <>
      <small className="mb-2 block text-[11.5px] font-extrabold uppercase tracking-[0.06em] text-ink-soft">
        {label}
      </small>
      <span
        className={`block font-serif text-[29px] leading-none ${
          jumlah > 0 ? "text-clay" : "text-night"
        }`}
      >
        {jumlah}
      </span>
      <span className="mt-1.5 block text-[12px] text-ink-soft">{keterangan}</span>
    </>
  );

  return (
    <Link
      href={href}
      className="block rounded-2xl border border-black/10 bg-white px-5 py-5 transition hover:border-gold hover:shadow-sm"
    >
      {isi}
    </Link>
  );
}

export default async function AdminPage() {
  const { nama } = await requireRole(["admin", "owner"]);
  const antrean = await hitungAntrean();

  // "Hari ini" menurut Jakarta, bukan menurut jam server (Vercel berjalan UTC).
  const hariIni = formatTanggalID(hariIniJakarta());

  return (
    <main>
      <header className="mb-5">
        <h1 className="font-serif text-2xl text-night">Panel Admin</h1>
        <p className="mt-1 text-[13px] text-ink-soft">
          Halo, {nama}. Inilah yang menunggu ditangani hari ini · {hariIni}
        </p>
      </header>

      <section
        aria-label="Antrean klinik"
        className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4"
      >
        <KartuAntrean
          label="Skrining baru"
          jumlah={antrean.skriningBaru}
          keterangan="Belum ditindaklanjuti"
          href="/admin/skrining"
        />
        <KartuAntrean
          label="Permintaan jadwal"
          jumlah={antrean.permintaanMenunggu}
          keterangan="Menunggu konfirmasi"
          href="/admin/sesi"
        />
        <KartuAntrean
          label="Klaim pembayaran"
          jumlah={antrean.klaimMenunggu}
          keterangan="Sesi & paket menunggu verifikasi"
          href="/admin/bayar"
        />
        <KartuAntrean
          label="Klien belum aktif"
          jumlah={antrean.klienBelumAktif}
          keterangan="Tautan aktivasi belum dipakai"
          href="/admin/klien"
        />
      </section>
    </main>
  );
}
