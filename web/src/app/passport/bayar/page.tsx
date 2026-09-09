import { notFound } from "next/navigation";
import { ambilKlien, ambilPaket, ambilSesi } from "@/lib/passport/data";
import { susunTagihan, type PayStatus } from "@/lib/passport/turunan";
import { bacaPengaturan } from "@/lib/settings";
import { TombolKlaim } from "./tombol-klaim";
import { ambilTagihanPengajuan } from "@/lib/tagihan/baca";
import { KartuTagihan } from "./kartu-tagihan";
import { formatTanggalID } from "@/lib/passport/waktu";
import { formatJam, jamDariDb } from "@/lib/jadwal/jam";
import { formatRupiah } from "@/lib/rupiah-publik";
import { KALIMAT_SEBAB_KLIEN } from "@/lib/tagihan/pengajuan";
import { LABEL_JENJANG } from "@/lib/transport/jarak";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Pembayaran" };

// Halaman ini menampilkan STATUS, bukan angka: nominal uang hidup di
// `variant_rates`/`honor_marks` dan tidak pernah sampai ke layar klien —
// besarannya disampaikan tim PADMA lewat WhatsApp (keputusan #10).
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
  const { qrisGambar, qrisMerchant, qrisNmid } = pengaturan;

  return (
    <>
      {/* TAGIHAN PENGAJUAN (spec C2) — di ATAS tagihan sesi, dan itu disengaja:
          hanya yang ini punya tenggat, dan hanya yang ini menahan jadwal.
          Menaruhnya di bawah daftar lain berarti hal paling mendesak di halaman
          ini adalah hal yang terakhir terlihat. */}
      {tagihanPengajuan.length > 0 && (
        <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
          <h2 className="mb-1 font-serif text-xl text-night">Menunggu pembayaran</h2>
          <p className="mb-4 text-[12.5px] text-ink-soft">
            Jadwal terkunci setelah pembayaran diverifikasi tim.
          </p>
          {tagihanPengajuan.map((t) => (
            <KartuTagihan
              key={t.permintaanId}
              permintaanId={t.permintaanId}
              namaLayanan={t.namaLayanan}
              tanggal={formatTanggalID(t.tanggal)}
              jam={formatJam(jamDariDb(t.jamMulai))}
              hargaLayanan={t.rincian.layanan === null ? null : formatRupiah(t.rincian.layanan)}
              hargaTransport={
                t.rincian.transport === null ? null : formatRupiah(t.rincian.transport)
              }
              labelJenjang={t.rincian.jenjang === null ? null : LABEL_JENJANG[t.rincian.jenjang]}
              total={t.rincian.total === null ? null : formatRupiah(t.rincian.total)}
              kalimatBelumLengkap={t.rincian.sebab ? KALIMAT_SEBAB_KLIEN[t.rincian.sebab] : null}
              statusBayar={t.statusBayar}
              tenggat={t.tenggat}
              adaBukti={t.adaBukti}
            />
          ))}
        </section>
      )}

      <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
        <h1 className="mb-4 font-serif text-xl text-night">
          Tagihan Anda{" "}
          <span className="font-sans text-xs font-semibold text-ink-soft">
            nominal disampaikan tim PADMA via WhatsApp
          </span>
        </h1>

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

      <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
        <h2 className="mb-4 font-serif text-xl text-night">Cara Pembayaran</h2>
        <div className="flex flex-wrap items-center gap-5">
          {/* QRIS SUNGGUHAN (spec J12) — bukan lagi pola dekoratif.
              Alamat gambarnya dibaca dari `app_settings`: kode QRIS bisa
              berganti, dan penggantiannya tidak boleh menuntut deploy. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrisGambar}
            alt={`Kode QRIS ${qrisMerchant}`}
            width={220}
            height={220}
            className="h-[220px] w-[220px] rounded-xl border border-black/10 bg-white object-contain p-2"
          />
          <div className="min-w-[220px] flex-1 text-[13.5px] text-[#3C4C42]">
            <b className="mb-1 block text-[15px] text-ink">Scan QRIS di samping</b>
            Bisa dengan aplikasi bank atau e-wallet apa pun. Setelah membayar, kirim bukti ke
            WhatsApp admin — tim kami memverifikasi secara manual.
            {/* NAMA MERCHANT & NMID ditampilkan, dan itu bukan hiasan: QRIS
                statis tidak menyebut nominal, jadi satu-satunya yang bisa
                diperiksa mata sebelum mengirim uang adalah nama penerimanya. */}
            <span className="mt-3 block rounded-xl border border-black/10 bg-paper p-3 text-[12px] leading-relaxed">
              <span className="block text-ink-soft">Pastikan nama penerima cocok:</span>
              <b className="block text-ink">{qrisMerchant}</b>
              <span className="block text-ink-soft">NMID {qrisNmid}</span>
            </span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-6">
        <h2 className="mb-3 font-serif text-xl text-night">Langkah pembayaran</h2>
        {[
          ["01", "Scan QRIS di atas, atau transfer sesuai arahan admin"],
          ["02", "Kirim bukti pembayaran ke WhatsApp PADMA"],
          ["03", "Tim memverifikasi & jadwal Anda terkunci"],
        ].map(([no, teks]) => (
          <p
            key={no}
            className="flex items-center gap-3 border-b border-dashed border-black/10 py-3 text-[13.5px] text-[#3C4C42] last:border-0"
          >
            <span className="w-6 flex-none font-mono text-[11px] text-gold">{no}</span>
            {teks}
          </p>
        ))}
      </section>
    </>
  );
}
