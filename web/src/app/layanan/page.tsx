import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { bacaPengaturan } from "@/lib/settings";
import { CtaHijau, JudulSeksi, Label, SitusShell, Wadah, urutan } from "../_situs/shell";
import { TombolGaris, TombolWa } from "../_situs/tombol";
import { tautanWaSitus } from "../_situs/wa";
import {
  IkonCentang,
  IkonDaftar,
  IkonGlobe,
  IkonKalender,
  IkonKartu,
  IkonOrang,
  IkonPanahBawah,
  IkonPapanCentang,
  IkonPapanKlip,
  IkonRumah,
} from "../_situs/ikon";

export const metadata = { title: "Layanan" };
export const revalidate = 300;

type Baris = { nama: string; isi: string; learn: boolean; live: boolean; home: boolean };

// Matriks layanan × format disalin dari mockup klien (docs/landingpage-v2/
// layanan.html), BUKAN dibaca dari katalog DB: ketersediaan format
// Learn/Live/Home tidak dicatat di tabel `services`, dan halaman ini sengaja
// tanpa harga (README handoff: harga hanya lewat WhatsApp/Highlight IG).
// Menambah atau menonaktifkan layanan di /admin/layanan TIDAK mengubah tabel ini.
const DAFTAR: { kelompok: string; baris: Baris[] }[] = [
  {
    kelompok: "Sedang Hamil",
    baris: [
      { nama: "Garbha Relief", isi: "Pijat relaksasi selama hamil", learn: false, live: false, home: true },
      { nama: "Garbha Flow", isi: "Yoga & gerak untuk ibu hamil", learn: false, live: true, home: true },
      { nama: "Garbha Partner Lab", isi: "Kelas pijat oleh pasangan", learn: false, live: true, home: true },
    ],
  },
  {
    kelompok: "Setelah Melahirkan",
    baris: [
      { nama: "Purnama Rest", isi: "Pijat relaksasi setelah melahirkan", learn: false, live: false, home: true },
      { nama: "Lactation Hero", isi: "Persiapan & praktik menyusui", learn: true, live: true, home: true },
      { nama: "Shishu Nurturing Academy", isi: "Belajar merawat bayi baru lahir", learn: true, live: true, home: true },
      { nama: "Shishu Parents Touch", isi: "Sentuhan orang tua untuk bayi", learn: false, live: true, home: true },
    ],
  },
  {
    kelompok: "Kembali Bekerja",
    baris: [
      { nama: "Return to Work", isi: "Persiapan menyusui saat kembali kerja", learn: true, live: true, home: true },
    ],
  },
];

const FORMAT = [
  { gambar: "/situs/format-learn.png", judul: "PADMA Learn", isi: "E-learning, eBook, dan online workshop. Dapat langsung dipilih." },
  {
    gambar: "/situs/format-live.png",
    judul: "PADMA Live",
    isi: "Video call interaktif dengan praktik dan koreksi langsung. Dapat langsung dipilih.",
  },
  {
    gambar: "/situs/format-home.png",
    judul: "PADMA Home",
    isi: "Kunjungan ke rumah di Malang Raya & Batu. Diawali cek kesiapan sesi 2 menit.",
  },
];

const ALUR_ONLINE = [
  { ikon: IkonPapanKlip, label: "1. Pilih Layanan" },
  { ikon: IkonKalender, label: "2. Atur Jadwal" },
  { ikon: IkonKartu, label: "3. Pembayaran" },
  { ikon: IkonOrang, label: "4. Ikuti Sesi" },
];

// Langkah pertama PADMA Home satu-satunya yang bisa diklik: ia membuka
// /skrining (README handoff "Cek Kesiapan Sesi → /skrining").
const ALUR_HOME = [
  { ikon: IkonDaftar, label: "2. Pilih Sesi" },
  { ikon: IkonKalender, label: "3. Jadwal via WhatsApp" },
  { ikon: IkonKartu, label: "4. Pembayaran" },
  { ikon: IkonRumah, label: "5. Kunjungan" },
];

export default async function LayananPage() {
  const pengaturan = await bacaPengaturan();
  const waHref = tautanWaSitus(pengaturan.nomorWaLink);
  return (
    <SitusShell aktif="layanan" pengaturan={pengaturan}>
      {/* HERO */}
      <section>
        <Wadah className="flex flex-col items-center gap-10 pt-10 pb-12 md:flex-row md:gap-12 md:pt-11 md:pb-10">
          <div className="flex flex-1 flex-col gap-5">
            <Label className="situs-muncul">Layanan PADMA</Label>
            <h1 style={urutan(1)} className="situs-muncul font-garamond text-[42px] leading-[1.02] font-bold text-situs-judul md:text-[62px]">
              Layanan yang Jelas. <span className="text-situs-emas">Format yang Fleksibel.</span>
            </h1>
            <p style={urutan(2)} className="situs-muncul max-w-[520px] text-lg leading-normal md:text-xl">
              Pilih sesi sesuai fase, cara belajar, dan kebutuhan keluarga Anda.
            </p>
            <div style={urutan(3)} className="situs-muncul flex flex-wrap gap-3.5">
              <Cakupan ikon={<IkonGlobe className="size-6 text-situs-emas" />} judul="PADMA Learn & Live" isi="Seluruh Indonesia" />
              <Cakupan ikon={<IkonRumah className="size-6 text-situs-emas" />} judul="PADMA Home" isi="Malang Raya & Batu" />
            </div>
            <div style={urutan(4)} className="situs-muncul flex flex-wrap gap-3.5">
              <TombolGaris href="#daftar" ikon={<IkonPanahBawah className="size-[18px]" />}>
                Lihat Layanan
              </TombolGaris>
              <TombolWa href={waHref} />
            </div>
          </div>
          <Image
            src="/situs/hero-ibu-bayi.png"
            alt="Ibu menggendong bayi baru lahir"
            width={480}
            height={400}
            loading="eager"
            fetchPriority="high"
            className="situs-lengkung aspect-[480/400] w-full max-w-[480px] shrink-0 rounded-t-[999px] rounded-b-3xl object-cover md:w-[400px] lg:w-[480px]"
          />
        </Wadah>
      </section>

      {/* DAFTAR LAYANAN & FORMAT */}
      <section id="daftar" className="scroll-mt-20 border-t border-situs-garis bg-situs-kartu">
        <Wadah className="flex flex-col items-center gap-[22px] py-12 md:py-[52px]">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <Label>Daftar Layanan &amp; Format</Label>
            <JudulSeksi>Pilih Layanan dan Format yang Sesuai</JudulSeksi>
          </div>
          <div className="w-full overflow-hidden rounded-[14px] border border-situs-garis">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Ketersediaan format Learn, Live, dan Home untuk tiap layanan</caption>
              <thead className="bg-situs-hutan text-[15px] font-medium text-situs-krem md:text-[17px]">
                <tr>
                  <th scope="col" className="w-[46%] px-4 py-4 font-medium md:px-6">Layanan</th>
                  <th scope="col" className="px-1 py-4 text-center font-medium">Learn</th>
                  <th scope="col" className="px-1 py-4 text-center font-medium">Live</th>
                  <th scope="col" className="px-1 py-4 text-center font-medium">Home</th>
                </tr>
              </thead>
              {DAFTAR.map((k) => (
                <tbody key={k.kelompok}>
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={4}
                      className="border-t border-situs-linen bg-situs-pasir px-4 py-2.5 text-[13px] font-semibold tracking-[3px] text-situs-emas-tua uppercase md:px-6"
                    >
                      {k.kelompok}
                    </th>
                  </tr>
                  {k.baris.map((b) => (
                    <tr key={b.nama} className="border-t border-situs-linen transition-colors hover:bg-situs-krem">
                      <th scope="row" className="px-4 py-3 text-left font-normal md:px-6">
                        <span className="block font-garamond text-xl leading-tight font-bold text-situs-judul md:text-[23px]">
                          {b.nama}
                        </span>
                        <span className="block text-sm text-situs-redup">{b.isi}</span>
                      </th>
                      <Sel ada={b.learn} />
                      <Sel ada={b.live} />
                      <Sel ada={b.home} />
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          <p className="text-center text-[15px] text-situs-redup">
            Harga, jadwal, dan promo: tanya via WhatsApp atau lihat{" "}
            <a
              href="https://www.instagram.com/padmawellness.id"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-situs-emas hover:text-situs-emas-tua"
            >
              Highlight Instagram @padmawellness.id
            </a>
            .
          </p>
        </Wadah>
      </section>

      {/* TENTANG FORMAT */}
      <section id="format" className="scroll-mt-20">
        <Wadah className="flex flex-col gap-6 py-12 md:py-[52px]">
          <JudulSeksi className="md:text-[38px]">Tentang Format Layanan</JudulSeksi>
          <div className="grid gap-6 md:grid-cols-3">
            {FORMAT.map((f) => (
              <div key={f.judul} className="flex items-center gap-4 rounded-[14px] border border-situs-garis bg-situs-kartu p-5">
                <Image
                  src={f.gambar}
                  alt=""
                  width={100}
                  height={112}
                  className="h-[112px] w-[100px] shrink-0 rounded-[10px] object-cover"
                />
                <div className="flex flex-col gap-1.5">
                  <h3 className="font-garamond text-[26px] leading-tight font-bold text-situs-judul">{f.judul}</h3>
                  <p className="text-[15px] text-situs-teks-soft">{f.isi}</p>
                </div>
              </div>
            ))}
          </div>
        </Wadah>
      </section>

      {/* ALUR BOOKING */}
      <section className="border-t border-situs-garis bg-situs-kartu">
        <Wadah className="flex flex-col gap-6 pt-12 pb-14">
          <Label className="text-center">Alur Booking</Label>
          <div className="grid gap-10 lg:grid-cols-2">
            <div className="flex flex-col gap-[18px]">
              <h3 className="font-garamond text-[28px] font-bold text-situs-judul">PADMA Learn &amp; Live</h3>
              <ol className="grid grid-cols-2 gap-y-5 sm:grid-cols-4">
                {ALUR_ONLINE.map((l) => (
                  <Langkah key={l.label} ikon={<l.ikon className="size-6" />} label={l.label} />
                ))}
              </ol>
            </div>
            <div className="flex flex-col gap-[18px]">
              <h3 className="font-garamond text-[28px] font-bold text-situs-judul">PADMA Home</h3>
              <ol className="grid grid-cols-2 gap-y-5 sm:grid-cols-5">
                <li>
                  <Link
                    href="/skrining"
                    className="group flex flex-col items-center gap-2 text-center"
                  >
                    <span className="flex size-[52px] items-center justify-center rounded-full bg-situs-emas text-white transition-transform duration-200 group-hover:scale-105">
                      <IkonPapanCentang className="size-6" />
                    </span>
                    <span className="text-[15px] font-semibold text-situs-judul underline">1. Cek Kesiapan Sesi</span>
                  </Link>
                </li>
                {ALUR_HOME.map((l) => (
                  <Langkah key={l.label} ikon={<l.ikon className="size-6" />} label={l.label} />
                ))}
              </ol>
            </div>
          </div>
        </Wadah>
      </section>

      <CtaHijau judul="Sudah Tahu Layanan yang Dibutuhkan?" waHref={waHref} denganLayanan={false} />
    </SitusShell>
  );
}

function Cakupan({ ikon, judul, isi }: { ikon: ReactNode; judul: string; isi: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-situs-pasir px-[18px] py-3">
      {ikon}
      <div className="flex flex-col">
        <span className="font-semibold text-situs-judul">{judul}</span>
        <span className="text-sm text-situs-teks-soft">{isi}</span>
      </div>
    </div>
  );
}

function Sel({ ada }: { ada: boolean }) {
  return (
    <td className="px-1 text-center">
      {ada ? (
        <>
          <IkonCentang className="mx-auto size-[22px] text-[#B07A45]" />
          <span className="sr-only">Tersedia</span>
        </>
      ) : (
        <>
          <span aria-hidden="true" className="text-[#B9AE9C]">—</span>
          <span className="sr-only">Tidak tersedia</span>
        </>
      )}
    </td>
  );
}

function Langkah({ ikon, label }: { ikon: ReactNode; label: string }) {
  return (
    <li className="flex flex-col items-center gap-2 px-1 text-center">
      <span className="flex size-[52px] items-center justify-center rounded-full bg-situs-pasir text-situs-emas">{ikon}</span>
      <span className="text-[15px] text-situs-judul">{label}</span>
    </li>
  );
}
