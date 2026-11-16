import Link from "next/link";
import { notFound } from "next/navigation";
import { ambilKlien } from "@/lib/passport/data";
import { periksaPesananMenggantung } from "@/lib/pesanan/periksa-menggantung";
import {
  ambilTagihanPengajuanSatu,
  kalimatSisaWaktu,
  keadaanTagihanKlien,
  KALIMAT_KEADAAN_KLIEN,
  type KeadaanTagihanKlien,
} from "@/lib/tagihan/baca";
import { formatTanggalID } from "@/lib/passport/waktu";
import { formatJam, jamDariDb } from "@/lib/jadwal/jam";
import { formatRupiah } from "@/lib/rupiah-publik";
import { TombolBayar } from "./tombol-bayar";

export const metadata = { title: "Bayar Tagihan" };

// Sama seperti rute passport lain: dilarang mengekspor pengaturan revalidasi
// Next.js (ditulis tanpa mengeja bentuknya, karena tests/passport-shell.test.ts
// memindai sumber berkas ini apa adanya).

/** Warna kalimat keadaan; kalimatnya sendiri dari `KALIMAT_KEADAAN_KLIEN`. */
const NADA: Record<KeadaanTagihanKlien, string> = {
  bayar: "text-night",
  diproses: "text-[#8A6A1B]",
  lunas_sesi: "text-leaf",
  lunas_tertahan: "text-leaf",
  diperiksa: "text-[#8A6A1B]",
  kedaluwarsa: "text-clay",
  warisan_dialihkan: "text-ink-soft",
  warisan_bukti: "text-[#8A6A1B]",
  warisan_lunas: "text-leaf",
};

/**
 * SATU tagihan sesi, satu layar (P3/B6, spec §6.3 dan §7).
 *
 * Tagihan pengajuan kini dibayar lewat DOKU: rincian dari angka BEKU pesanan,
 * sisa waktu, dan satu tombol Bayar yang meminta tautan ke rute server lalu
 * mengalihkan peramban. QRIS dan unggah bukti jalur lama tidak ada lagi di
 * sini (§6.8); QRIS jalur 2 (sesi yang dijadwalkan admin) tetap di daftar
 * `/passport/bayar`.
 *
 * Halaman ini juga `callback_url` DOKU. Ia TIDAK membaca parameter apa pun
 * dari URL kembali (K11): yang memutuskan "lunas" hanya notifikasi bertanda
 * tangan dan Check Status (Lapis 1b di bawah).
 */
export default async function HalamanBayarSatu({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  const { id } = await params; // Next 16: `params` adalah Promise

  // LAPIS 1b (spec "Rekonsiliasi"). Urutannya MENGIKAT: pemeriksaan dulu, baru
  // pembacaan. Klien yang baru kembali dari DOKU dan webhook-nya belum (atau
  // tidak pernah) mendarat harus melihat "Lunas" pada kunjungan ini juga,
  // bukan tombol Bayar untuk tagihan yang sudah dibayarnya. Pemeriksaannya
  // dibatasi lima menit per pesanan di basis data dan tidak pernah melempar.
  await periksaPesananMenggantung();

  const tagihan = await ambilTagihanPengajuanSatu(id);

  // Tidak ada, bukan miliknya, atau tidak lagi ditagihkan (termasuk pengajuan
  // yang dibatalkan) — semuanya berakhir sama, supaya keberadaan tagihan orang
  // lain tidak bocor.
  if (!tagihan) notFound();

  const keadaan = keadaanTagihanKlien(tagihan);
  const sisa = kalimatSisaWaktu(tagihan);

  return (
    <>
      <Link
        href="/passport/bayar"
        className="mb-4 inline-block rounded-xl border border-black/10 bg-white px-4 py-2 text-[13px] font-bold text-ink"
      >
        ← Kembali ke tagihan
      </Link>

      {/* `data-tagihan` adalah kontrak yang diuji E2E — id pengajuannya. */}
      <section
        data-tagihan={tagihan.permintaanId}
        className="mb-4 rounded-2xl border-[1.6px] border-dashed border-gold bg-[#FDFAF1] p-6"
      >
        <h1 className="font-serif text-xl text-night">{tagihan.namaLayanan}</h1>
        <span className="block text-[12.5px] text-ink-soft">
          {formatTanggalID(tagihan.tanggal)} · {formatJam(jamDariDb(tagihan.jamMulai))}
        </span>

        {/* RINCIAN dari angka BEKU — angka yang sama persis dengan yang
            ditagihkan DOKU. `data-total` dipertahankan untuk E2E. Baris warisan
            QRIS (tanpa pesanan) tidak punya angka beku, jadi tanpa rincian. */}
        {tagihan.total !== null && tagihan.items.length > 0 && (
          <dl className="mt-3 text-[13.5px]">
            {tagihan.items.map((item, i) => (
              <div key={i} className="mt-0.5 flex justify-between gap-3">
                <dt className="text-ink-soft">{item.judul}</dt>
                <dd className="text-night">{formatRupiah(item.harga)}</dd>
              </div>
            ))}
            <div className="mt-2 flex items-baseline justify-between border-t border-black/10 pt-2">
              <dt className="font-bold text-night">Total</dt>
              <dd className="text-[26px] font-bold leading-none text-night" data-total>
                {formatRupiah(tagihan.total)}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-6">
        <p className={`text-[14px] font-semibold ${NADA[keadaan]}`}>{KALIMAT_KEADAAN_KLIEN[keadaan]}</p>

        {keadaan === "bayar" && (
          <>
            {sisa && (
              <p className="mt-1 text-[12.5px] text-clay">
                {sisa}. Lewat dari itu tagihan ini kedaluwarsa, dan admin akan menghubungi Anda.
              </p>
            )}
            <div className="mt-4">
              <TombolBayar permintaanId={tagihan.permintaanId} label="Bayar sekarang" />
            </div>
            <p className="mt-2 text-[12.5px] text-ink-soft">
              Anda akan diarahkan ke halaman pembayaran DOKU. Sesudah membayar, Anda
              kembali ke halaman ini.
            </p>
          </>
        )}

        {keadaan === "diproses" && (
          <>
            <p className="mt-1 text-[13px] text-ink-soft">
              Bila Anda sudah membayar, status ini berubah sendiri dalam beberapa menit.
              Bila halaman pembayaran tertutup sebelum selesai, lanjutkan lewat tombol di
              bawah — tagihannya tetap sama, tidak ada tagihan kedua.
            </p>
            {sisa && <p className="mt-1 text-[12.5px] text-clay">{sisa}.</p>}
            <div className="mt-4">
              <TombolBayar permintaanId={tagihan.permintaanId} label="Lanjutkan pembayaran" />
            </div>
          </>
        )}

        {keadaan === "lunas_sesi" && tagihan.sesiId && (
          <Link
            href={`/passport/sesi/${tagihan.sesiId}`}
            className="mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-night/20 px-4 text-[13.5px] font-bold text-night"
          >
            Lihat jadwal Anda
          </Link>
        )}
      </section>
    </>
  );
}
