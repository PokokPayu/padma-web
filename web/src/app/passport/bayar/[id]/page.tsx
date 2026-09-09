import Link from "next/link";
import { notFound } from "next/navigation";
import { ambilKlien } from "@/lib/passport/data";
import { ambilTagihanPengajuanSatu } from "@/lib/tagihan/baca";
import { bacaPengaturan } from "@/lib/settings";
import { formatTanggalID } from "@/lib/passport/waktu";
import { formatJam, jamDariDb } from "@/lib/jadwal/jam";
import { formatRupiah } from "@/lib/rupiah-publik";
import { KALIMAT_SEBAB_KLIEN } from "@/lib/tagihan/pengajuan";
import { LABEL_JENJANG } from "@/lib/transport/jarak";
import { labelSisaWaktu } from "@/lib/tagihan/tenggat";
import { CaraBayar, LangkahBayar } from "../cara-bayar";
import { UnggahBukti } from "./unggah-bukti";

export const metadata = { title: "Bayar Tagihan" };

// Sama seperti rute passport lain: dilarang mengekspor pengaturan revalidasi
// Next.js (ditulis tanpa mengeja bentuknya, karena tests/passport-shell.test.ts
// memindai sumber berkas ini apa adanya).

/**
 * SATU tagihan, satu layar.
 *
 * Sebelum halaman ini ada, ketiga hal yang dibutuhkan untuk membayar tersebar
 * di satu gulungan panjang: nominal di puncak, QRIS jauh di bawah, tombol
 * unggah kembali ke puncak. Di sini ketiganya berdampingan, berurutan seperti
 * yang dikerjakan klien.
 */
export default async function HalamanBayarSatu({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  const { id } = await params; // Next 16: `params` adalah Promise
  const [tagihan, { qrisGambar, qrisMerchant, qrisNmid }] = await Promise.all([
    ambilTagihanPengajuanSatu(klien.id, id),
    bacaPengaturan(),
  ]);

  // Tidak ada, sudah tidak menunggu bayar, ATAU bukan miliknya — ketiganya
  // berakhir sama. Membedakannya di layar akan membocorkan keberadaan tagihan
  // yang bukan haknya.
  if (!tagihan) notFound();

  const { rincian } = tagihan;

  return (
    <>
      <Link
        href="/passport/bayar"
        className="mb-4 inline-block rounded-xl border border-black/10 bg-white px-4 py-2 text-[13px] font-bold text-ink"
      >
        ← Kembali ke tagihan
      </Link>

      {/* `data-tagihan` adalah kontrak yang diuji E2E — id pengajuannya, bukan
          statusnya. Kelas Tailwind berubah tiap kali desain disetel. */}
      <section
        data-tagihan={tagihan.permintaanId}
        className="mb-4 rounded-2xl border-[1.6px] border-dashed border-gold bg-[#FDFAF1] p-6"
      >
        <b className="block text-sm text-night">{tagihan.namaLayanan}</b>
        <span className="block text-[12.5px] text-ink-soft">
          {formatTanggalID(tagihan.tanggal)} · {formatJam(jamDariDb(tagihan.jamMulai))}
        </span>

        {rincian.total === null ? (
          <p className="mt-3 text-[13px] text-[#77321F]">
            {rincian.sebab
              ? KALIMAT_SEBAB_KLIEN[rincian.sebab]
              : "Totalnya sedang dilengkapi tim PADMA."}
          </p>
        ) : (
          // RINCIAN, bukan satu angka: klien mengetik sendiri jumlahnya ke QRIS
          // statis, dan angka yang tidak bisa ditelusuri asalnya adalah angka
          // yang ditanyakan lewat WhatsApp satu per satu.
          //
          // `data-total` DIPERTAHANKAN pada elemen totalnya. E2E
          // `tests/e2e/bayar-pengajuan.e2e.ts` mencarinya, dan penanda itu
          // justru yang dulu menangkap cacat embed RLS yang membuat setiap
          // klien melihat "Totalnya sedang dilengkapi tim".
          <dl className="mt-3 text-[13.5px]">
            <div className="flex justify-between">
              <dt className="text-ink-soft">Layanan</dt>
              <dd className="text-night">
                {rincian.layanan === null ? "—" : formatRupiah(rincian.layanan)}
              </dd>
            </div>
            <div className="mt-0.5 flex justify-between">
              <dt className="text-ink-soft">
                Transport{rincian.jenjang ? ` · ${LABEL_JENJANG[rincian.jenjang]}` : ""}
              </dt>
              <dd className="text-night">
                {rincian.transport === null ? "—" : formatRupiah(rincian.transport)}
              </dd>
            </div>
            <div className="mt-2 flex items-baseline justify-between border-t border-black/10 pt-2">
              <dt className="font-bold text-night">Total</dt>
              <dd className="text-[26px] font-bold leading-none text-night" data-total>
                {formatRupiah(rincian.total)}
              </dd>
            </div>
          </dl>
        )}

        {tagihan.statusBayar === "lunas" ? (
          <p className="mt-3 text-[13px] font-semibold text-leaf">
            Pembayaran terverifikasi — jadwal Anda sedang dikunci tim.
          </p>
        ) : tagihan.statusBayar === "menunggu_verifikasi" ? (
          <p className="mt-3 text-[13px] text-[#8A6A1B]">
            Bukti diterima. Tim PADMA sedang mencocokkannya dengan mutasi rekening.
          </p>
        ) : (
          tagihan.tenggat && (
            <p className="mt-3 text-[12.5px] text-clay">
              Bayar dalam {labelSisaWaktu(tagihan.tenggat)} — lewat dari itu, pengajuan ini batal
              dan slotnya dilepas untuk klien lain.
            </p>
          )
        )}
      </section>

      <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
        <h1 className="mb-4 font-serif text-xl text-night">Cara membayar</h1>
        <CaraBayar qrisGambar={qrisGambar} qrisMerchant={qrisMerchant} qrisNmid={qrisNmid} />
      </section>

      {tagihan.statusBayar !== "lunas" && (
        <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
          <h2 className="mb-3 font-serif text-xl text-night">Kirim bukti</h2>
          {/* Tombolnya tetap ditawarkan pada status `menunggu_verifikasi`:
              bukti yang buram atau salah potret harus bisa diganti tanpa
              menunggu tim menolaknya lebih dulu. Server tetap memeriksa
              syaratnya sendiri — tampilan bukan pagar. */}
          <UnggahBukti permintaanId={tagihan.permintaanId} adaBukti={tagihan.adaBukti} />
        </section>
      )}

      <section className="rounded-2xl border border-black/10 bg-white p-6">
        <h2 className="mb-3 font-serif text-xl text-night">Langkah pembayaran</h2>
        <LangkahBayar unggahDiSini />
      </section>
    </>
  );
}
