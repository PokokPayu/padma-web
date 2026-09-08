import Link from "next/link";
import { notFound } from "next/navigation";
import { Lotus } from "@/app/_landing/lotus";
import {
  ambilKlien,
  ambilPaket,
  ambilPermintaanJadwal,
  ambilSesi,
} from "@/lib/passport/data";
import {
  badgeDari,
  gridStempel,
  progresPaket,
  sesiBerikutnya,
} from "@/lib/passport/turunan";
import { formatTanggalID, hariIniJakarta } from "@/lib/passport/waktu";
import { GridStempel } from "./_komponen/grid-stempel";
import { KartuInfo } from "./_komponen/kartu-info";
import { SampulPassport } from "./_komponen/sampul";
import { formatJam, jamDariDb } from "@/lib/jadwal/jam";
import { LABEL_PERMINTAAN } from "@/lib/jadwal/status";
import { TombolBatal } from "./_komponen/tombol-batal";

// Judul mengandalkan template `%s · PADMA` di root layout — jangan mengulang
// nama aplikasi di sini.
export const metadata = { title: "Digital Care Passport" };

// Rute passport dilarang mengekspor pengaturan revalidasi Next.js (ditulis
// tanpa mengeja bentuknya, karena tests/passport-shell.test.ts memindai sumber
// berkas ini apa adanya): pengaturan itu menghapus `private` dari Cache-Control
// sehingga respons satu klien boleh disimpan CDN dan disajikan ke klien lain.

export default async function BerandaPassport() {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  const [sesi, paket, permintaan] = await Promise.all([
    ambilSesi(klien.id),
    ambilPaket(klien.id),
    ambilPermintaanJadwal(klien.id),
  ]);

  // "Hari ini" menurut Jakarta, bukan menurut jam server (Vercel berjalan UTC).
  const sekarang = hariIniJakarta();
  const paketAktif = paket[0] ?? null;
  const progres = progresPaket({ totalSesi: paketAktif?.jumlahSesi ?? null, sesi });
  const slot = paketAktif
    ? gridStempel({ totalSesi: paketAktif.jumlahSesi, sesi, sekarang })
    : [];
  const berikut = sesiBerikutnya(sesi, sekarang);
  const badge = badgeDari(sesi);

  // "Sejak" dari sesi terawal, bukan `clients.created_at` — tanggal itu berubah
  // setiap `db reset` sehingga sampul akan berbohong soal lama perjalanan.
  // Urutan tanggal = urutan string (kolom `tanggal` sudah YYYY-MM-DD).
  const terawal = [...sesi].sort((a, b) =>
    a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0,
  )[0];
  const sejak = terawal
    ? formatTanggalID(terawal.tanggal).split(" ").slice(1).join(" ")
    : "—";

  return (
    <>
      <SampulPassport
        nama={klien.nama}
        padmaId={klien.padmaId}
        faseId={klien.faseId}
        faseSanskrit={klien.faseSanskrit}
        faseNama={klien.faseNama}
        sejak={sejak}
        ringkasProgres={
          paketAktif && progres
            ? `${paketAktif.nama} · Sesi ${progres.selesai}/${progres.total}`
            : null
        }
      />

      {paketAktif && progres ? (
        <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
          <h2 className="mb-4 font-serif text-xl text-night">
            Paket Aktif{" "}
            <span className="font-sans text-xs font-semibold text-ink-soft">
              {paketAktif.nama} · {paketAktif.jumlahSesi} sesi
            </span>
          </h2>
          <GridStempel slot={slot} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-soft">
            <span>
              {progres.selesai} dari {progres.total} sesi selesai
              {berikut && ` · berikutnya ${formatTanggalID(berikut.tanggal)}`}
            </span>
            <b className="font-serif text-[15px] text-night">{progres.persen}%</b>
          </div>
        </section>
      ) : (
        // Model hybrid: klien yang mengambil layanan per sesi tidak punya paket,
        // dan itu bukan keadaan cacat — beranda tetap harus punya isi.
        <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
          <h2 className="font-serif text-xl text-night">Perjalanan Anda</h2>
          <p className="mt-1.5 text-[13.5px] text-ink-soft">
            Anda mengambil layanan per sesi. Riwayat lengkapnya ada di halaman Sesi.
          </p>
        </section>
      )}

      {berikut ? (
        <KartuInfo
          berlambang
          judul={`Sesi berikutnya: ${berikut.namaLayanan}`}
          detail={`${formatTanggalID(berikut.tanggal)} · ${formatJam(jamDariDb(berikut.jamMulai))} · ${berikut.namaMitra} · datang ke rumah Anda`}
        />
      ) : (
        <KartuInfo
          judul="Belum ada jadwal berikutnya"
          detail="Ajukan jadwal — tim PADMA mengonfirmasi via WhatsApp."
        />
      )}

      {permintaan.map((p) => (
        <KartuInfo
          key={p.id}
          garis="titik"
          judul={`Permintaan jadwal: ${p.namaLayanan}`}
          detail={`${formatTanggalID(p.tanggal)} · ${formatJam(jamDariDb(p.jamMulai))} · ${LABEL_PERMINTAAN[p.status]}`}
          // Hanya pengajuan yang masih di antrean yang bisa dibatalkan sendiri.
          // Yang sudah dikonfirmasi adalah SESI, dan pembatalan sesi menyangkut
          // uang serta tenggat waktu — seluruhnya milik C3.
          aksi={<TombolBatal permintaanId={p.id} />}
        />
      ))}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          href="/passport/ajukan"
          className="rounded-xl bg-gold py-3.5 text-center font-bold text-[#FFF8EA]"
        >
          + Ajukan Jadwal
        </Link>
        <Link
          href="/passport/materi"
          className="rounded-xl border-[1.5px] border-black/10 bg-white py-3.5 text-center font-bold text-night"
        >
          Materi Saya
        </Link>
      </div>

      <section className="rounded-2xl border border-black/10 bg-white p-6">
        <h2 className="mb-4 font-serif text-xl text-night">Pencapaian</h2>
        {badge.length === 0 ? (
          <p className="text-[13px] italic text-ink-soft">
            Badge pertama terbit saat sesi pertama Anda selesai.
          </p>
        ) : (
          <div className="flex flex-wrap gap-3.5">
            {badge.map((b) => (
              <div
                key={b.serviceId}
                data-badge={b.serviceId}
                className="w-[104px] text-center text-[11px] font-bold leading-tight text-[#6B5A2E]"
              >
                <span className="mx-auto mb-2 flex h-[72px] w-[72px] items-center justify-center rounded-full border-2 border-gold bg-[radial-gradient(circle_at_35%_30%,#FDF6E4,#F3E6C4)] text-gold shadow-[inset_0_0_0_3px_#fff,inset_0_0_0_4px_rgba(217,179,106,.28)]">
                  <Lotus className="w-[34px]" />
                </span>
                {b.nama}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
