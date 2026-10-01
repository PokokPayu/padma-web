import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { bacaPengaturan } from "@/lib/settings";
import { CtaKrem, JudulSeksi, Label, SitusShell, Wadah, urutan } from "../_situs/shell";
import { TombolGaris } from "../_situs/tombol";
import { tautanWaSitus } from "../_situs/wa";
import {
  IkonBuku,
  IkonCentang,
  IkonDokumen,
  IkonInfo,
  IkonKalender,
  IkonKeluarga,
  IkonPanahBawah,
  IkonPanahPanjang,
  IkonPapanKlip,
  IkonPerisai,
  IkonTunas,
} from "../_situs/ikon";

export const metadata = { title: "Tentang Kami" };
export const revalidate = 300;

const FILOSOFI = [
  { ikon: IkonBuku, judul: "Edukasi yang Bisa Dipakai", isi: "Berbasis bukti, jadi langkah praktis sehari-hari." },
  { ikon: IkonKeluarga, judul: "Keluarga Ikut Belajar", isi: "Pasangan dan keluarga dilibatkan sesuai sesi." },
  { ikon: IkonPerisai, judul: "Tahu Batas Aman", isi: "Memahami kapan perlu mencari bantuan medis." },
  { ikon: IkonTunas, judul: "Belajar untuk Lebih Mandiri", isi: "Keterampilan dapat dipraktikkan kembali." },
];

const WELLNESS = [
  "Edukasi umum berbasis bukti",
  "Praktik keterampilan",
  "Pijat relaksasi",
  "Yoga & movement",
  "Family session",
];

export default async function TentangPage() {
  const pengaturan = await bacaPengaturan();
  const waHref = tautanWaSitus(pengaturan.nomorWaLink);
  return (
    <SitusShell aktif="tentang" pengaturan={pengaturan}>
      {/* HERO FOUNDER */}
      <section>
        {/* HP: foto founder naik ke bawah judul (lewat `contents` + `order`),
            supaya wajah di balik cerita terlihat sebelum tiga paragrafnya. */}
        <Wadah className="flex flex-col gap-4 pt-8 pb-12 lg:flex-row lg:items-center lg:gap-12 lg:pt-12">
          <div className="contents lg:flex lg:flex-1 lg:flex-col lg:gap-4">
            <Label className="situs-muncul">Tentang PADMA</Label>
            <h1 style={urutan(1)} className="situs-muncul font-garamond text-[40px] leading-[1.04] font-bold text-situs-judul sm:text-[52px] lg:text-[56px]">
              Kenapa PADMA Ada
            </h1>
            <p style={urutan(2)} className="situs-muncul font-garamond text-2xl font-semibold text-situs-emas md:text-[30px]">
              Nurturing in Every Stage of Life
            </p>
            <div style={urutan(3)} className="situs-muncul order-2 flex flex-col gap-4 text-[17px] leading-relaxed lg:order-none">
              <p>
                Selama 13 tahun sebagai dokter spesialis kebidanan dan kandungan, saya melihat banyak ibu pulang
                dari ruang praktik dengan pertanyaan yang belum sempat terjawab.
              </p>
              <p>
                Sebagai ibu dari dua anak, saya memahami bahwa perjalanan ini berat dan tidak bisa dijalani sendiri.{" "}
                <strong className="font-semibold text-situs-judul">Support system adalah kuncinya.</strong>
              </p>
              <p>
                Itulah kenapa PADMA ada: ekosistem belajar yang personal bagi perempuan dan keluarga, berkelanjutan
                dari persiapan kehamilan hingga menopause.
              </p>
            </div>
            <div style={urutan(4)} className="situs-muncul order-2 mt-1 flex flex-col gap-0.5 border-t lg:order-none border-situs-garis pt-4">
              <span className="font-garamond text-2xl font-bold text-situs-judul">dr. Fatmasari Perdana Menur, SpOG</span>
              <span className="text-sm font-medium text-situs-emas">Founder PADMA · Ibu dari dua anak</span>
            </div>
            <div style={urutan(5)} className="situs-muncul order-2 mt-2 lg:order-none">
              <TombolGaris href="#cara-kerja" ikon={<IkonPanahBawah className="size-[18px]" />}>
                Kenali Cara Kerja PADMA
              </TombolGaris>
            </div>
          </div>
          <Image
            src="/situs/founder.jpg"
            alt="dr. Fatmasari Perdana Menur, SpOG, Founder PADMA"
            width={480}
            height={600}
            loading="eager"
            fetchPriority="high"
            className="situs-lengkung order-1 my-2 aspect-[4/3] w-full shrink-0 rounded-3xl object-cover object-[50%_22%] sm:aspect-[16/10] lg:order-none lg:my-0 lg:aspect-[4/5] lg:w-[400px] lg:object-center xl:w-[480px]"
          />
        </Wadah>
      </section>

      {/* FILOSOFI */}
      <section className="border-t border-situs-garis bg-situs-kartu">
        <Wadah className="grid items-center gap-10 py-12 md:py-14 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <Label>Filosofi Kami</Label>
            <JudulSeksi className="md:text-[40px]">Melengkapi, Bukan Menggantikan, Layanan Medis</JudulSeksi>
            <p className="text-[17px] text-situs-teks-soft">
              PADMA membawa ilmu keluar dari ruang praktik melalui edukasi dan wellness non-klinis.
            </p>
          </div>
          <div className="grid gap-7 sm:grid-cols-2">
            {FILOSOFI.map((f) => (
              <div key={f.judul} className="flex gap-4">
                <Lingkaran>
                  <f.ikon className="size-5" />
                </Lingkaran>
                <div className="flex flex-col gap-1">
                  <h3 className="font-garamond text-[22px] leading-tight font-bold text-situs-judul">{f.judul}</h3>
                  <p className="text-sm text-situs-teks-soft">{f.isi}</p>
                </div>
              </div>
            ))}
          </div>
        </Wadah>
      </section>

      {/* BATAS LAYANAN */}
      <section className="bg-situs-hutan">
        <Wadah className="flex flex-col gap-7 py-12 md:py-14">
          <div className="flex flex-col gap-2">
            <Label gelap>Batas Layanan Kami</Label>
            <JudulSeksi gelap>Batas Layanan yang Jelas</JudulSeksi>
          </div>
          <div className="flex flex-col items-stretch gap-5 lg:flex-row lg:items-center lg:gap-6">
            <div className="flex-1 rounded-[14px] bg-situs-kartu p-6 md:p-7">
              <h3 className="mb-4 font-garamond text-[26px] font-bold text-situs-judul">PADMA Wellness</h3>
              <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {WELLNESS.map((w) => (
                  <li key={w} className="flex items-start gap-2.5 text-[15px]">
                    <IkonCentang className="mt-0.5 size-5 shrink-0 text-[#B07A45]" />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
            <IkonPanahPanjang className="hidden size-12 shrink-0 text-situs-emas-muda lg:block" />
            <div className="flex flex-1 gap-4 rounded-[14px] border border-dashed border-situs-emas-pucat bg-situs-pasir p-6 md:p-7">
              <IkonInfo className="size-7 shrink-0 text-situs-emas" />
              <div className="flex flex-col gap-2">
                <h3 className="font-garamond text-[26px] leading-tight font-bold text-situs-judul">Di luar layanan PADMA</h3>
                <p className="text-[15px] text-situs-teks-soft">
                  Jika diperlukan asesmen individual, diagnosis, terapi medis, atau penanganan kondisi gawat, kami
                  mengarahkan klien ke tenaga medis yang sesuai.
                </p>
              </div>
            </div>
          </div>
        </Wadah>
      </section>

      {/* MITRA — profil sengaja tidak ditampilkan (README handoff). */}
      <section>
        <Wadah className="flex flex-col gap-3 py-12 md:py-14">
          <Label>Mitra PADMA</Label>
          <JudulSeksi>Mitra Fasilitator &amp; Terapis PADMA</JudulSeksi>
          <p className="max-w-[760px] text-[17px] leading-relaxed text-situs-teks-soft">
            Setiap sesi dipandu mitra dengan pelatihan dan pengalaman yang relevan sesuai jenis layanan. Nama, foto,
            peran, dan identitas mitra dikirim setelah booking terkonfirmasi.
          </p>
        </Wadah>
      </section>

      {/* CARA KERJA */}
      <section id="cara-kerja" className="scroll-mt-20 border-t border-situs-garis bg-situs-kartu">
        <Wadah className="flex flex-col gap-6 py-12">
          <Label>Cara Kerja PADMA</Label>
          <ol className="grid gap-4 sm:grid-cols-2 sm:gap-8 lg:grid-cols-4">
            <LangkahKerja ikon={<IkonPapanKlip className="size-5" />}>01 · Pilih Layanan &amp; Format</LangkahKerja>
            <LangkahKerja ikon={<IkonKalender className="size-5" />}>02 · Konfirmasi Jadwal</LangkahKerja>
            <LangkahKerja ikon={<IkonKeluarga className="size-5" />}>03 · Ikuti Sesi</LangkahKerja>
            <LangkahKerja ikon={<IkonDokumen className="size-5" />}>
              <Link href="/digital-passport" className="-my-2 inline-block py-2 underline underline-offset-4 transition-colors hover:text-situs-emas">
                04 · Bawa Pulang Materi
              </Link>
            </LangkahKerja>
          </ol>
        </Wadah>
      </section>

      <CtaKrem waHref={waHref} />
    </SitusShell>
  );
}

function Lingkaran({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-situs-pasir text-situs-emas">
      {children}
    </span>
  );
}

function LangkahKerja({ ikon, children }: { ikon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-4 sm:flex-col sm:items-start sm:gap-3">
      <Lingkaran>{ikon}</Lingkaran>
      <span className="font-garamond text-[22px] leading-tight font-bold text-situs-judul sm:text-2xl">{children}</span>
    </li>
  );
}
