import Link from "next/link";
import { notFound } from "next/navigation";
import { ambilKlien, ambilPaket, ambilSesi } from "@/lib/passport/data";
import { susunTagihan, type PayStatus } from "@/lib/passport/turunan";
import { bacaPengaturan } from "@/lib/settings";
import { TombolKlaim } from "./tombol-klaim";
import { ambilTagihanPengajuan } from "@/lib/tagihan/baca";
import { formatTanggalID } from "@/lib/passport/waktu";
import { formatJam, jamDariDb } from "@/lib/jadwal/jam";
import { formatRupiah } from "@/lib/rupiah-publik";
import { labelSisaWaktu } from "@/lib/tagihan/tenggat";
import { CaraBayar, LangkahBayar } from "./cara-bayar";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Pembayaran" };

/**
 * DAFTAR tagihan — bukan lagi tempat membayar.
 *
 * Halaman ini dulu menumpuk empat seksi dalam satu gulungan: tagihan
 * pengajuan yang bertenggat, tagihan sesi, QRIS, dan tiga langkah pembayaran.
 * Dua yang terakhir statis dan panjang, sehingga yang paling mendesak justru
 * terdorong keluar dari layar pertama. Sejak `/passport/bayar/[id]` lahir,
 * membayar SATU tagihan punya layarnya sendiri dan halaman ini cukup menjawab
 * satu pertanyaan: apa saja yang belum beres.
 */
const LABEL: Record<PayStatus, { teks: string; kelas: string }> = {
  lunas: { teks: "Lunas", kelas: "bg-leaf-soft text-leaf border-leaf/25" },
  menunggu_verifikasi: {
    teks: "Menunggu verifikasi",
    kelas: "bg-[#F7EDD3] text-[#8A6A1B] border-[#E9D9A8]",
  },
  belum: { teks: "Belum dibayar", kelas: "bg-clay/10 text-clay border-clay/25" },
};

export default async function HalamanBayar() {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  const [paket, sesi, pengaturan, tagihanPengajuan] = await Promise.all([
    ambilPaket(klien.id),
    ambilSesi(klien.id),
    bacaPengaturan(),
    ambilTagihanPengajuan(klien.id),
  ]);
  const tagihan = susunTagihan({ paket, sesi });

  return (
    <>
      {/* TAGIHAN PENGAJUAN (spec C2) — di ATAS tagihan sesi, dan itu disengaja:
          hanya yang ini punya tenggat, dan hanya yang ini menahan jadwal. */}
      {tagihanPengajuan.length > 0 && (
        <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
          <h2 className="mb-1 font-serif text-xl text-night">Menunggu pembayaran</h2>
          <p className="mb-4 text-[12.5px] text-ink-soft">
            Jadwal terkunci setelah pembayaran diverifikasi tim. Ketuk satu tagihan untuk
            membayarnya.
          </p>
          <div className="grid gap-3">
            {tagihanPengajuan.map((t) => (
              <Link
                key={t.permintaanId}
                href={`/passport/bayar/${t.permintaanId}`}
                data-tagihan={t.permintaanId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-[1.6px] border-dashed border-gold bg-[#FDFAF1] p-4"
              >
                <span className="min-w-0">
                  <b className="block text-sm text-night">{t.namaLayanan}</b>
                  <span className="block text-[12px] text-ink-soft">
                    {formatTanggalID(t.tanggal)} · {formatJam(jamDariDb(t.jamMulai))}
                  </span>
                  {t.statusBayar === "belum" && t.tenggat && (
                    <span className="mt-1 block text-[12px] text-clay">
                      Bayar dalam {labelSisaWaktu(t.tenggat)}
                    </span>
                  )}
                  {t.statusBayar === "menunggu_verifikasi" && (
                    <span className="mt-1 block text-[12px] text-[#8A6A1B]">
                      Bukti diterima, menunggu verifikasi
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <b className="text-[15px] text-night">
                    {t.rincian.menungguTarifKhusus || t.rincian.total === null
                      ? "Menunggu total"
                      : formatRupiah(t.rincian.total)}
                  </b>
                  <svg width="8" viewBox="0 0 8 14" aria-hidden className="text-ink-soft">
                    <path
                      d="M1 1l6 6-6 6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
        <h1 className="mb-4 font-serif text-xl text-night">Tagihan Anda</h1>

        {tagihan.length === 0 ? (
          <p className="text-[13px] italic text-ink-soft">Belum ada tagihan.</p>
        ) : (
          tagihan.map((t) => (
            <div
              key={`${t.jenis}-${t.id}`}
              data-tagihan={t.status}
              className="border-b border-dashed border-black/10 py-3 last:border-0"
            >
              <div className="flex items-center justify-between gap-3">
                <b className="text-[13.5px]">{t.label}</b>
                <span
                  className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${LABEL[t.status].kelas}`}
                >
                  {LABEL[t.status].teks}
                </span>
              </div>

              {/* Rincian transport (Task 9) — SUB-BARIS pada item yang sama,
                  TANPA tombol sendiri dan TANPA id kembar: menekan "Saya
                  sudah bayar" di bawah sudah mencakup transportnya juga. */}
              {t.rincianTransport && (
                <p className="mt-1 text-[12px] text-ink-soft">{t.rincianTransport}</p>
              )}

              {/* Tombol klaim hanya untuk item yang benar-benar masih 'belum'.
                  Server action tetap memeriksa syarat itu sendiri: tampilan
                  bukan pagar. */}
              {t.status === "belum" && (
                <TombolKlaim
                  jenis={t.jenis}
                  id={t.id}
                  waLink={pengaturan.nomorWaLink}
                  label={t.label}
                />
              )}
              {t.status === "menunggu_verifikasi" && (
                <p className="mt-2 text-xs text-ink-soft">
                  Tim PADMA sedang memverifikasi bukti Anda.
                </p>
              )}
            </div>
          ))
        )}
      </section>

      {/* TERLIPAT, bukan dihapus. Tagihan sesi lepas di atas ditagih lewat
          WhatsApp dan tidak punya halaman sendiri, jadi kliennya tetap butuh
          kode untuk dipindai dari sini. Yang tidak boleh lagi terjadi adalah
          dua seksi statis sepanjang layar mendorong tagihan bertenggat keluar
          dari pandangan pertama. */}
      <details className="rounded-2xl border border-black/10 bg-white p-6">
        <summary className="cursor-pointer font-serif text-xl text-night">
          QRIS &amp; cara membayar
        </summary>
        <div className="mt-4">
          <CaraBayar
            qrisGambar={pengaturan.qrisGambar}
            qrisMerchant={pengaturan.qrisMerchant}
            qrisNmid={pengaturan.qrisNmid}
          />
        </div>
        <h2 className="mb-1 mt-6 font-serif text-lg text-night">Langkah pembayaran</h2>
        <LangkahBayar unggahDiSini={false} />
      </details>
    </>
  );
}
