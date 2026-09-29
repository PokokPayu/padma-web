import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { bacaPengaturan } from "@/lib/settings";
import { CtaHijau, JudulSeksi, Label, SitusShell, Wadah, urutan } from "./_situs/shell";
import { TombolGaris, TombolWa } from "./_situs/tombol";
import { tautanWaSitus } from "./_situs/wa";
import {
  IkonCentang,
  IkonGlobe,
  IkonHati,
  IkonKeluarga,
  IkonLokasi,
  IkonTanya,
  IkonTunas,
} from "./_situs/ikon";

// Beranda situs publik — handoff landing v2 (docs/landingpage-v2/index.html).
// Aturan kontennya ada di README handoff dan dijaga `tests/landing.test.ts`:
// tanpa harga, satu CTA utama "Tanya Kelas & Pricelist", PADMA non-klinis.
//
// Nomor WA diganti admin lewat panel, jadi halaman tidak dibekukan selamanya
// di waktu build; revalidate membuatnya tetap murah tetapi menyusul nilai baru.
export const revalidate = 300;

const ALASAN = [
  { gambar: "/situs/alasan-1.png", judul: "Praktik & Koreksi Langsung", isi: "Bukan hanya menonton materi." },
  { gambar: "/situs/alasan-2.png", judul: "Keluarga Ikut Belajar", isi: "Peran pasangan dan caregiver dibuat lebih jelas." },
  { gambar: "/situs/alasan-3.png", judul: "Learn It Once, Own It", isi: "Keterampilan dapat dipraktikkan kembali di rumah." },
];

const PENDEKATAN = [
  { judul: "Parent-Led", isi: "Orang tua yang praktik, fasilitator memandu." },
  { judul: "Baby-Led", isi: "Mengikuti isyarat dan ritme bayi." },
  { judul: "Skill Transfer", isi: "Keterampilan berpindah ke tangan orang tua." },
  { judul: "Personalized Experience", isi: "Pendekatan tiap sesi menyesuaikan kondisi dan kebutuhan Anda." },
];

const FASE: { gambar: string; judul: string; isi: string | null }[] = [
  { gambar: "/situs/fase-1-preconception.png", judul: "Preconception", isi: null },
  { gambar: "/situs/fase-2-pregnancy.png", judul: "Pregnancy", isi: "Wellness dan persiapan keluarga" },
  { gambar: "/situs/fase-3-postpartum.png", judul: "Postpartum", isi: "Relaksasi nifas dan kesiapan merawat bayi" },
  { gambar: "/situs/fase-4-lactation.png", judul: "Lactation", isi: "Persiapan menyusui dan kembali bekerja" },
  { gambar: "/situs/fase-5-menopause.png", judul: "Menopause", isi: null },
];

const FORMAT = [
  { gambar: "/situs/format-learn.png", judul: "PADMA Learn", isi: "E-learning & online workshop" },
  { gambar: "/situs/format-live.png", judul: "PADMA Live", isi: "Video call interaktif" },
  {
    gambar: "/situs/format-home.png",
    judul: "PADMA Home",
    isi: "Kunjungan Malang Raya & Batu. Detail mitra dikirim setelah booking terkonfirmasi.",
  },
];

const ISI_PASSPORT = [
  "eBook & panduan PDF, dibaca langsung di web",
  "Printable sheet untuk latihan di rumah",
  "Video panduan sesuai sesi",
  "Riwayat sesi tercatat, seperti stempel di paspor",
];

const FAQ = [
  { t: "Apakah PADMA layanan medis?", j: "Bukan. PADMA adalah layanan wellness dan edukasi non-klinis." },
  {
    t: "Bagaimana mengetahui mitra yang datang?",
    j: "Nama, foto, peran, dan identitas mitra dikirim setelah booking terkonfirmasi.",
  },
  {
    t: "Apakah keluarga boleh ikut?",
    j: "Ya. PADMA Live dan Home tersedia dalam sesi Private (suami-istri), Circle (grup), atau Family Session (khusus satu keluarga).",
  },
];

// Seksi "Cerita Keluarga PADMA" di mockup sengaja belum dirender: README
// handoff melarangnya tayang sebelum ada kutipan asli yang berizin.
export default async function Home() {
  const pengaturan = await bacaPengaturan();
  return (
    <SitusShell aktif="beranda" pengaturan={pengaturan}>
      <Isi waHref={tautanWaSitus(pengaturan.nomorWaLink)} />
    </SitusShell>
  );
}

function Isi({ waHref }: { waHref: string }) {
  return (
    <>
      {/* HERO */}
      <section>
        <Wadah className="flex flex-col items-center gap-10 pt-10 pb-12 md:flex-row md:gap-12 md:pt-12 md:pb-11">
          <div className="flex flex-1 flex-col gap-[22px]">
            <Label className="situs-muncul">Premium Women&apos;s Wellness</Label>
            <h1 style={urutan(1)} className="situs-muncul font-garamond text-[42px] leading-[1.02] font-bold text-situs-judul md:text-[64px]">
              Ilmu Nyata untuk Perempuan dan Keluarga{" "}
              <span className="text-situs-emas">yang Lebih Siap.</span>
            </h1>
            <p style={urutan(2)} className="situs-muncul max-w-[540px] text-lg leading-normal md:text-xl">
              Kelas &amp; pijat kehamilan hingga setelah melahirkan. Online se-Indonesia, kunjungan ke rumah di
              Malang Raya &amp; Batu.
            </p>
            <div style={urutan(3)} className="situs-muncul flex flex-wrap gap-3.5">
              <TombolWa href={waHref} />
              <TombolGaris href="/layanan">Lihat Layanan</TombolGaris>
            </div>
            <ul style={urutan(4)} className="situs-muncul flex flex-wrap items-center gap-x-[22px] gap-y-2 text-sm text-situs-teks-soft">
              <li className="inline-flex items-center gap-2">
                <IkonTunas className="size-5 text-situs-emas" />
                Non-klinis
              </li>
              <li className="inline-flex items-center gap-2">
                <IkonHati className="size-5 text-situs-emas" />
                Berbasis bukti
              </li>
              <li className="inline-flex items-center gap-2">
                <IkonKeluarga className="size-5 text-situs-emas" />
                Family-centered
              </li>
            </ul>
          </div>
          <Image
            src="/situs/hero-ibu-bayi.png"
            alt="Ibu menggendong bayi baru lahir"
            width={520}
            height={446}
            loading="eager"
            fetchPriority="high"
            className="situs-lengkung aspect-[520/446] w-full max-w-[520px] shrink-0 rounded-t-[999px] rounded-b-3xl object-cover md:w-[440px] lg:w-[520px]"
          />
        </Wadah>
      </section>

      {/* TIGA ALASAN + PENDEKATAN */}
      <section className="bg-situs-hutan">
        <Wadah className="flex flex-col gap-7 py-12 md:py-[52px]">
          <JudulSeksi gelap>Tiga Alasan Memilih PADMA</JudulSeksi>
          <div className="grid gap-6 md:grid-cols-3">
            {ALASAN.map((a) => (
              <div key={a.judul} className="flex flex-col items-center overflow-hidden rounded-[14px] bg-situs-kartu pb-[26px] text-center">
                <Image src={a.gambar} alt="" width={370} height={150} className="h-[150px] w-full object-cover" />
                <h3 className="mt-3.5 mb-1.5 px-4 font-garamond text-[27px] leading-tight font-bold text-situs-judul">
                  {a.judul}
                </h3>
                <p className="px-6 text-base text-situs-redup">{a.isi}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3.5 pt-1">
            <Label gelap>Pendekatan PADMA</Label>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PENDEKATAN.map((p) => (
                <div key={p.judul} className="flex flex-col gap-1 rounded-xl border border-situs-hutan-garis px-[18px] py-4">
                  <span className="font-garamond text-[23px] font-bold text-situs-krem">{p.judul}</span>
                  <span className="text-sm text-situs-pudar">{p.isi}</span>
                </div>
              ))}
            </div>
          </div>
        </Wadah>
      </section>

      {/* PERJALANAN PEREMPUAN */}
      <section>
        <Wadah className="flex flex-col gap-9 py-12 md:py-[60px]">
          <div className="flex flex-col gap-2">
            <JudulSeksi>Perjalanan Perempuan</JudulSeksi>
            <p className="text-lg text-situs-teks-soft">
              PADMA hadir dalam perjalanan perempuan dari preconception hingga menopause.
            </p>
          </div>
          <div className="situs-perjalanan relative grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-5">
            <div aria-hidden="true" className="situs-garis-perjalanan absolute top-16 right-[10%] left-[10%] hidden h-0.5 bg-[#D8B98F] md:block" />
            {FASE.map((f, i) => {
              const isi = (
                <>
                  <Image
                    src={f.gambar}
                    alt=""
                    width={150}
                    height={128}
                    className="h-[128px] w-[150px] bg-situs-krem object-contain transition-transform duration-300 group-hover:-translate-y-1"
                  />
                  <h3
                    className={`font-garamond text-[25px] font-bold ${f.isi ? "text-situs-judul" : "text-situs-redup"}`}
                  >
                    {f.judul}
                  </h3>
                  {f.isi ? (
                    <span className="text-[15px] leading-[1.4] text-situs-teks-soft">{f.isi}</span>
                  ) : (
                    <span className="rounded-full bg-[#EFE8DC] px-3.5 py-1.5 text-[13px] text-situs-abu">
                      Segera hadir
                    </span>
                  )}
                </>
              );
              const kelas = "situs-fase relative flex flex-col items-center gap-2.5 text-center";
              return f.isi ? (
                <Link key={f.judul} href="/layanan" style={urutan(i)} className={`${kelas} group rounded-xl`}>
                  {isi}
                </Link>
              ) : (
                <div key={f.judul} style={urutan(i)} className={`${kelas} opacity-60`}>
                  {isi}
                </div>
              );
            })}
          </div>
        </Wadah>
      </section>

      {/* FORMAT */}
      <section className="border-y border-situs-garis bg-situs-kartu">
        <Wadah className="flex flex-col gap-7 py-12 md:py-14">
          <JudulSeksi>Belajar dengan Cara yang Paling Sesuai</JudulSeksi>
          <div className="grid gap-6 md:grid-cols-3">
            {FORMAT.map((f) => (
              <div key={f.judul} className="flex items-center gap-4 rounded-[14px] border border-situs-garis bg-situs-krem p-[18px]">
                <Image
                  src={f.gambar}
                  alt=""
                  width={110}
                  height={124}
                  className="h-[124px] w-[110px] shrink-0 rounded-[10px] object-cover"
                />
                <div className="flex flex-col gap-2">
                  <h3 className="font-garamond text-[26px] leading-tight font-bold text-situs-judul">{f.judul}</h3>
                  <p className="text-[15px] text-situs-teks-soft">{f.isi}</p>
                  <Link href="/layanan#format" className="text-sm font-medium text-situs-emas underline-offset-4 hover:text-situs-emas-tua hover:underline">
                    Lihat {f.judul} →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </Wadah>
      </section>

      {/* DIGITAL PASSPORT JOURNEY */}
      <section className="bg-situs-hutan">
        <Wadah className="flex flex-col items-center gap-12 py-12 md:flex-row md:gap-16 md:py-[60px]">
          <div className="flex flex-1 flex-col gap-[18px]">
            <Label gelap>Pembeda PADMA</Label>
            <JudulSeksi gelap className="md:text-[46px]">
              Digital Passport Journey
            </JudulSeksi>
            <p className="text-lg leading-normal text-situs-linen">
              Setelah sesi, materi tidak hilang. Semua tersimpan di akun Passport Anda, sesuai sesi yang diikuti:
            </p>
            <ul className="flex flex-col gap-3 text-base text-situs-krem">
              {ISI_PASSPORT.map((i) => (
                <li key={i} className="flex items-center gap-3">
                  <IkonCentang className="size-[22px] shrink-0 text-situs-emas-muda" />
                  {i}
                </li>
              ))}
            </ul>
            <p className="text-sm text-situs-pudar">Pusat materi, bukan monitoring kesehatan atau ruang konsultasi.</p>
            <div className="flex flex-wrap items-center gap-3.5">
              <Link
                href="/digital-passport"
                className="inline-flex items-center gap-2.5 rounded-[10px] bg-situs-emas-muda px-[22px] py-[13px] text-base font-semibold text-[#1D1A14] hover:bg-situs-emas-pucat"
              >
                Lihat Selengkapnya →
              </Link>
              <Link
                href="/masuk"
                className="inline-flex items-center gap-2.5 rounded-[10px] border-[1.5px] border-situs-linen px-[22px] py-[13px] text-base font-medium text-situs-krem hover:bg-white/10"
              >
                Masuk ke Passport
              </Link>
            </div>
          </div>
          <KartuPassportContoh />
        </Wadah>
      </section>

      {/* LOKASI + FAQ */}
      <section id="faq" className="scroll-mt-24">
        <Wadah className="grid gap-12 py-12 md:grid-cols-2 md:gap-14 md:py-14">
          <div className="flex flex-col gap-[22px]">
            <h2 className="font-garamond text-[32px] font-semibold text-situs-judul md:text-4xl">Lokasi Layanan PADMA</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <KartuLokasi ikon={<IkonLokasi className="size-9 shrink-0 text-situs-emas" />} judul="PADMA Home" isi="Malang Raya & Batu" />
              <KartuLokasi ikon={<IkonGlobe className="size-9 shrink-0 text-situs-emas" />} judul="PADMA Live & Learn" isi="Seluruh Indonesia" />
            </div>
          </div>
          <div className="flex flex-col gap-3.5">
            <h2 className="mb-2 font-garamond text-[32px] font-semibold text-situs-judul md:text-4xl">
              Pertanyaan yang Sering Diajukan
            </h2>
            {FAQ.map((f) => (
              <div key={f.t} className="flex items-start gap-3.5 rounded-xl border border-situs-garis bg-situs-kartu px-[18px] py-4">
                <IkonTanya className="mt-0.5 size-6 shrink-0 text-situs-emas" />
                <div className="flex flex-col gap-1">
                  <h3 className="font-semibold text-situs-judul">{f.t}</h3>
                  <p className="text-[15px] text-situs-teks-soft">{f.j}</p>
                </div>
              </div>
            ))}
          </div>
        </Wadah>
      </section>

      <CtaHijau judul="Ilmu Nyata, Keluarga Berdaya." waHref={waHref} />
    </>
  );
}

function KartuLokasi({ ikon, judul, isi }: { ikon: ReactNode; judul: string; isi: string }) {
  return (
    <div className="flex items-center gap-3.5 rounded-[14px] border border-situs-garis bg-situs-kartu p-[22px]">
      {ikon}
      <div className="flex flex-col gap-0.5">
        <span className="text-[17px] font-semibold text-situs-judul">{judul}</span>
        <span className="text-[15px] text-situs-teks-soft">{isi}</span>
      </div>
    </div>
  );
}

function KartuPassportContoh() {
  return (
    <figure className="situs-paspor flex w-full max-w-[440px] shrink-0 flex-col gap-2.5">
      <div className="flex flex-col gap-[18px] rounded-[18px] border border-situs-emas-pucat bg-situs-krem p-7">
        <div className="flex items-center justify-between">
          <span className="font-garamond text-2xl font-bold tracking-[3px] text-situs-judul">PADMA</span>
          <span className="text-xs font-semibold tracking-[2px] text-situs-emas">DIGITAL PASSPORT</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] text-situs-abu">Nama</span>
          <span className="font-garamond text-[28px] font-bold text-situs-judul">[Nama Klien]</span>
          <span className="text-[13px] text-situs-abu">PAD-XXXX-XXXX</span>
        </div>
        <div className="grid grid-cols-2 gap-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] text-situs-abu">Fase</span>
            <span className="font-semibold text-situs-judul">Kehamilan</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] text-situs-abu">Sesi berikutnya</span>
            <span className="font-semibold text-situs-judul">Garbha Flow</span>
          </div>
        </div>
        <div className="flex gap-2.5" aria-hidden="true">
          {["01", "02", "03"].map((n, i) => (
            <span
              key={n}
              style={urutan(i)}
              className="situs-stempel flex size-11 items-center justify-center rounded-full border-[1.5px] border-situs-emas text-xs font-semibold text-situs-emas"
            >
              {n}
            </span>
          ))}
          <span className="size-11 rounded-full border-[1.5px] border-dashed border-[#C9B89E]" />
        </div>
      </div>
      <figcaption className="text-center text-[13px] text-situs-pudar">Ilustrasi tampilan — data contoh</figcaption>
    </figure>
  );
}
