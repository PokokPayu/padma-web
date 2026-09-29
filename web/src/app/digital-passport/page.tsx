import Image from "next/image";
import type { ComponentType, ReactNode } from "react";
import { bacaPengaturan } from "@/lib/settings";
import { CtaKrem, JudulSeksi, Label, SitusShell, Wadah } from "../_situs/shell";
import { TombolGaris, TombolWa } from "../_situs/tombol";
import { tautanWaSitus } from "../_situs/wa";
import {
  IkonBuku,
  IkonCentang,
  IkonDokumen,
  IkonHati,
  IkonPonsel,
  IkonSilang,
  IkonTunas,
  IkonVideo,
} from "../_situs/ikon";

// Halaman penjelasan untuk calon klien. Aplikasi Passport-nya sendiri tetap
// di /passport (lewat /masuk); rute ini publik dan tidak menyentuh sesi.
export const metadata = { title: "Digital Passport Journey" };
export const revalidate = 300;

const KEUNGGULAN = [
  { ikon: IkonHati, judul: "Praktis & Personal", isi: "Sesuai sesi yang Anda ikuti." },
  { ikon: IkonPonsel, judul: "Mudah Diakses", isi: "Cukup buka dari HP." },
  { ikon: IkonTunas, judul: "Lebih Terarah", isi: "Berlatih lagi di rumah." },
];

const ISI: { ikon: ComponentType<{ className?: string }>; judul: string; isi: string }[] = [
  { ikon: IkonBuku, judul: "eBook & Panduan", isi: "PDF sesuai sesi, dibaca langsung di web." },
  { ikon: IkonVideo, judul: "Video", isi: "Video panduan sesuai sesi yang diikuti." },
  { ikon: IkonDokumen, judul: "Printable Sheet", isi: "Lembar praktis sesuai sesi, bisa dicetak." },
  { ikon: IkonPonsel, judul: "Akses Mudah", isi: "Materi rapi dalam satu tempat." },
];

export default async function DigitalPassportPage() {
  const pengaturan = await bacaPengaturan();
  const waHref = tautanWaSitus(pengaturan.nomorWaLink);
  return (
    <SitusShell aktif="digital-passport" pengaturan={pengaturan}>
      {/* HERO */}
      <section>
        <Wadah className="flex flex-col items-center gap-10 pt-10 pb-12 lg:flex-row lg:gap-12 lg:pt-12">
          <div className="flex flex-1 flex-col gap-4">
            <Label>Pembeda PADMA</Label>
            <h1 className="font-garamond text-[42px] leading-[1.02] font-bold text-situs-judul md:text-[62px]">
              Digital Passport Journey
            </h1>
            <p className="font-garamond text-2xl leading-[1.15] font-semibold text-situs-emas md:text-[30px]">
              Materi dan Perjalanan Belajar dalam Satu Tempat
            </p>
            <p className="max-w-[520px] text-lg leading-normal">
              Setiap sesi PADMA dilengkapi materi yang relevan. Semuanya tersimpan rapi dan bisa dibuka lagi di rumah.
            </p>
            <div className="grid gap-5 py-2 sm:grid-cols-3">
              {KEUNGGULAN.map((k) => (
                <div key={k.judul} className="flex flex-col gap-1">
                  <k.ikon className="mb-1 size-7 text-situs-emas" />
                  <span className="font-garamond text-[22px] font-bold text-situs-judul">{k.judul}</span>
                  <span className="text-sm text-situs-teks-soft">{k.isi}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3.5">
              <TombolWa href={waHref} />
              <TombolGaris href="/masuk">Masuk ke Passport</TombolGaris>
            </div>
          </div>
          <IlustrasiAplikasi />
        </Wadah>
      </section>

      {/* ISI PASSPORT */}
      <section className="border-t border-situs-garis bg-situs-kartu">
        <Wadah className="flex flex-col gap-8 py-12 md:py-16">
          <div className="flex flex-col gap-2">
            <Label>Isi Passport</Label>
            <JudulSeksi className="md:text-[46px]">Semua Materi Sesi Tersimpan Lebih Terarah</JudulSeksi>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {ISI.map((i) => (
              <div key={i.judul} className="flex items-center gap-4 rounded-[14px] border border-situs-garis bg-situs-krem px-5 py-6">
                <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-situs-pasir text-situs-emas">
                  <i.ikon className="size-6" />
                </span>
                <div className="flex flex-col gap-1">
                  <h3 className="font-garamond text-2xl font-bold text-situs-judul">{i.judul}</h3>
                  <p className="text-[15px] text-situs-teks-soft">{i.isi}</p>
                </div>
              </div>
            ))}
          </div>
        </Wadah>
      </section>

      {/* TANPA vs DENGAN */}
      <section className="bg-situs-hutan">
        <Wadah className="flex flex-col gap-8 py-12 md:py-16">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
            <JudulSeksi gelap className="md:text-[46px]">
              Materi Tidak Hilang Setelah Sesi
            </JudulSeksi>
            <p className="max-w-[460px] text-[15px] leading-relaxed text-situs-linen">
              Digital Passport Journey adalah pusat materi dari sesi yang Anda ikuti — bukan monitoring kesehatan,
              ruang konsultasi, atau grup pendampingan.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <Banding
              gambar="/situs/passport-tanpa.png"
              judul="Tanpa Passport"
              butir={["Materi tersebar dan mudah hilang", "Belajar berhenti setelah sesi"]}
              ikon={<IkonSilang className="size-5 shrink-0 text-situs-abu" />}
              kelas="bg-situs-kartu"
            />
            <Banding
              gambar="/situs/passport-dengan.png"
              judul="Dengan Passport"
              butir={["Materi rapi, sesuai sesi yang diikuti", "Mudah dibuka lagi untuk latihan mandiri"]}
              ikon={<IkonCentang className="size-5 shrink-0 text-[#B07A45]" />}
              kelas="bg-situs-krem ring-2 ring-situs-emas-pucat"
            />
          </div>
        </Wadah>
      </section>

      <CtaKrem waHref={waHref} />
    </SitusShell>
  );
}

function Banding({
  gambar,
  judul,
  butir,
  ikon,
  kelas,
}: {
  gambar: string;
  judul: string;
  butir: string[];
  ikon: ReactNode;
  kelas: string;
}) {
  return (
    <div className={`flex overflow-hidden rounded-[14px] ${kelas}`}>
      <Image src={gambar} alt="" width={200} height={150} className="hidden w-[200px] shrink-0 object-cover sm:block" />
      <div className="flex flex-col justify-center gap-3 p-6">
        <h3 className="font-garamond text-[26px] font-bold text-situs-judul">{judul}</h3>
        <ul className="flex flex-col gap-2">
          {butir.map((b) => (
            <li key={b} className="flex items-center gap-2.5 text-[15px] text-situs-teks">
              {ikon}
              {b}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Tiruan layar Passport di mockup — berlabel "data contoh", bukan tangkapan
// layar aplikasi sungguhan.
function IlustrasiAplikasi() {
  const menu = ["Beranda", "Materi Saya", "eBook & Panduan", "Video", "Printable Sheet", "Jadwal Sesi"];
  const kartu = [
    { ikon: IkonBuku, label: "eBook & Panduan" },
    { ikon: IkonDokumen, label: "Printable Sheet" },
    { ikon: IkonVideo, label: "Video" },
  ];
  return (
    <figure className="flex w-full max-w-[560px] shrink-0 flex-col gap-2.5">
      <Image
        src="/situs/passport-hero.png"
        alt="Perempuan membuka materi di tablet"
        width={560}
        height={260}
        loading="eager"
        fetchPriority="high"
        className="aspect-[560/260] w-full rounded-t-[200px] object-cover"
      />
      <div aria-hidden="true" className="-mt-2.5 flex overflow-hidden rounded-b-[14px] border border-situs-garis bg-situs-kartu">
        <div className="hidden w-40 shrink-0 flex-col gap-3.5 bg-situs-hutan p-4 sm:flex">
          <span className="font-garamond text-xl font-bold tracking-[3px] text-situs-krem">PADMA</span>
          {menu.map((m) => (
            <span
              key={m}
              className={
                m === "Materi Saya"
                  ? "rounded-md bg-situs-emas-muda px-2 py-1 text-xs font-semibold text-[#1D1A14]"
                  : "text-xs text-situs-krem"
              }
            >
              {m}
            </span>
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-3 p-5">
          <div className="flex flex-col">
            <span className="text-xs text-situs-teks-soft">Selamat datang,</span>
            <span className="font-garamond text-2xl font-bold text-situs-judul">[Nama Klien]</span>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {kartu.map((k) => (
              <div key={k.label} className="flex flex-col gap-2 rounded-lg border border-situs-garis bg-situs-krem p-3">
                <k.ikon className="size-4 text-situs-emas" />
                <span className="text-xs font-semibold text-situs-judul">{k.label}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-situs-teks-soft">Sesi tercatat</span>
            {["01", "02"].map((n) => (
              <span
                key={n}
                className="flex size-8 items-center justify-center rounded-full border-[1.5px] border-situs-emas text-[11px] font-semibold text-situs-emas"
              >
                {n}
              </span>
            ))}
            <span className="size-8 rounded-full border-[1.5px] border-dashed border-[#C9B89E]" />
          </div>
        </div>
      </div>
      <figcaption className="text-center text-[13px] text-situs-teks-soft">Ilustrasi tampilan — data contoh</figcaption>
    </figure>
  );
}
