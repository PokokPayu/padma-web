import Link from "next/link";
import { notFound } from "next/navigation";
import { ambilKlien, ambilSesi } from "@/lib/passport/data";
import { sesiBerikutnya } from "@/lib/passport/turunan";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { KartuSesi } from "../_komponen/kartu-sesi";

// Judul mengandalkan template `%s · PADMA` di root layout — jangan mengulang
// nama aplikasi di sini.
export const metadata = { title: "Riwayat Sesi" };

// Sama seperti beranda: rute passport dilarang mengekspor pengaturan revalidasi
// Next.js (ditulis tanpa mengeja bentuknya, karena tests/passport-shell.test.ts
// memindai sumber berkas ini apa adanya) — pengaturan itu menghapus `private`
// dari Cache-Control sehingga riwayat perawatan satu klien boleh disimpan CDN
// dan disajikan ke klien lain.

export default async function HalamanSesi() {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  // Urutan menurun datang dari Postgres (`ambilSesi`) — jangan diurut ulang di
  // sini: aritmatika tanggal di JS adalah sumber bug zona waktu, dan urutan
  // ganda hanya menambah tempat untuk salah.
  const sesi = await ambilSesi(klien.id);
  const berikut = sesiBerikutnya(sesi, hariIniJakarta());

  return (
    <>
      <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
        <h1 className="mb-4 font-serif text-xl text-night">
          Riwayat Sesi{" "}
          <span className="font-sans text-xs font-semibold text-ink-soft">
            ketuk untuk membaca catatan bidan
          </span>
        </h1>
        {sesi.length === 0 ? (
          // Klien yang baru tertaut belum punya kunjungan; halaman kosong tanpa
          // kalimat apa pun terbaca seperti kegagalan memuat.
          <p className="text-[13px] italic text-ink-soft">
            Riwayat sesi Anda akan muncul di sini setelah kunjungan pertama.
          </p>
        ) : (
          <div className="grid gap-3">
            {sesi.map((s) => (
              <KartuSesi key={s.id} sesi={s} berikutnya={s.id === berikut?.id} />
            ))}
          </div>
        )}
      </section>

      <Link
        href="/passport/ajukan"
        className="block rounded-xl bg-gold py-3.5 text-center font-bold text-[#FFF8EA]"
      >
        + Ajukan Jadwal Baru
      </Link>
    </>
  );
}
