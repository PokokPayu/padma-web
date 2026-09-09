import Link from "next/link";
import { notFound } from "next/navigation";
import { ambilKlien, ambilSertifikatLayanan, ambilSesi } from "@/lib/passport/data";
import { badgeDari } from "@/lib/passport/turunan";
import { formatTanggalID } from "@/lib/passport/waktu";

export const metadata = { title: "Sertifikat" };

// Rute passport dilarang mengekspor pengaturan revalidasi Next.js (ditulis
// tanpa mengeja bentuknya, karena tests/passport-shell.test.ts memindai sumber
// berkas ini apa adanya): pengaturan itu menghapus `private` dari Cache-Control
// sehingga respons satu klien boleh disimpan CDN dan disajikan ke klien lain.
export const dynamic = "force-dynamic";

export default async function HalamanSertifikat({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  const { serviceId } = await params;
  const [sesi, sertifikat] = await Promise.all([
    ambilSesi(klien.id),
    ambilSertifikatLayanan(klien.id, serviceId),
  ]);

  const badge = badgeDari(sesi).find((b) => b.serviceId === serviceId);
  if (!badge) notFound(); // layanan yang belum pernah ia jalani

  const gambar = sertifikat?.mime.startsWith("image/") ?? false;
  const tautan = sertifikat ? `/api/sertifikat/${sertifikat.sessionId}` : "";

  return (
    <>
      <Link
        href="/passport"
        className="mb-4 inline-block rounded-xl border border-black/10 bg-white px-4 py-2 text-[13px] font-bold text-ink"
      >
        ← Kembali ke Beranda
      </Link>

      <section className="rounded-2xl border border-black/10 bg-white p-6">
        <h1 className="font-serif text-xl text-night">{badge.nama}</h1>
        <p className="mt-1 text-[13px] text-ink-soft">
          {badge.jumlah > 1
            ? `Anda sudah menjalani layanan ini ${badge.jumlah} kali.`
            : "Anda sudah menjalani layanan ini satu kali."}
        </p>

        {sertifikat ? (
          <div className="mt-5">
            {sertifikat.tanggal !== "" && (
              <p className="mb-3 text-[12.5px] text-ink-soft">
                Kunjungan {formatTanggalID(sertifikat.tanggal)}
              </p>
            )}

            {gambar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tautan}
                alt={`Sertifikat ${badge.nama}`}
                className="w-full rounded-xl border border-black/10"
              />
            ) : (
              <object
                data={tautan}
                type="application/pdf"
                className="h-[70vh] w-full rounded-xl border border-black/10"
              >
                {/* Penampil PDF bawaan peramban tidak ada di sebagian ponsel.
                    Tautan di bawah bukan cadangan basa-basi — di perangkat itu
                    ia satu-satunya cara membuka lembarnya. */}
                <p className="p-4 text-[13px] text-ink-soft">
                  Peramban ini tidak bisa menampilkan PDF di halaman. Buka lewat tautan di
                  bawah.
                </p>
              </object>
            )}

            <a
              href={tautan}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block min-h-[44px] rounded-xl bg-gold px-5 py-3 text-sm font-bold text-[#FFF8EA]"
            >
              Buka & unduh sertifikat
            </a>
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-gold/60 bg-[#FDFAF1] p-4">
            <b className="block text-sm text-night">Sertifikat belum terbit</b>
            <span className="text-[13px] text-ink-soft">
              Tim PADMA menerbitkannya setelah kunjungan Anda dirapikan. Badge ini tetap
              menjadi catatan perjalanan Anda sementara itu.
            </span>
          </div>
        )}
      </section>
    </>
  );
}
