import type { ReactNode } from "react";
import { Lotus } from "@/app/_landing/lotus";
import { IkonBuku, IkonKalender, IkonKartu, IkonOrang, IkonVideo } from "./ikon";
import { urutan } from "./shell";

// Tiruan layar aplikasi Passport (/passport) untuk situs publik. Bentuknya
// SENGAJA menyalin komponen aslinya — `passport/_komponen/sampul.tsx`,
// `baris-agenda.tsx`, blok Pencapaian di `passport/page.tsx`, dan halaman
// /passport/materi — memakai token & font aplikasi (night, gold, paper,
// font-serif Marcellus), bukan bahasa visual situs. Calon klien harus melihat
// apa yang benar-benar akan mereka buka setelah masuk.
//
// Semua isinya data contoh. Bila tampilan aplikasi berubah, tiruan ini ikut
// disunting — ia tidak membaca komponen aslinya karena komponen itu menuntut
// data sesi sungguhan.

function Bingkai({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`overflow-hidden bg-paper font-sans text-ink shadow-[0_24px_48px_-24px_rgba(0,0,0,0.55)] ${className}`}
    >
      {children}
    </div>
  );
}

/** Beranda Passport versi HP — dipajang di blok "Digital Passport Journey" Beranda. */
export function LayarPassportContoh() {
  const lencana = ["Garbha Relief", "Garbha Flow", "Garbha Partner Lab"];
  return (
    <figure className="situs-paspor flex w-full max-w-[340px] shrink-0 flex-col gap-3 self-center">
      <Bingkai className="rounded-[28px] border-[6px] border-[#0B3A2F]">
        {/* header-mobile.tsx */}
        <div className="flex items-center gap-2.5 border-b border-gold/20 px-4 py-2.5">
          <Lotus className="w-6 flex-none text-gold" />
          <span className="min-w-0 flex-1">
            <b className="block font-serif text-[15px] leading-none font-normal tracking-[0.16em] text-night">PADMA</b>
            <span className="mt-1 block text-[9px] font-semibold tracking-[0.18em] text-ink-soft uppercase">
              Digital Passport Journey
            </span>
          </span>
          <span className="flex size-8 items-center justify-center rounded-full bg-night text-[12px] font-bold text-gold-pale">
            N
          </span>
        </div>

        <div className="p-3.5">
          {/* sampul.tsx */}
          <div className="relative overflow-hidden rounded-2xl border border-gold/30 px-4 pt-5 pb-4 text-[#EFE6CE] [background:radial-gradient(360px_200px_at_80%_-10%,rgba(47,106,72,.5),transparent_60%),linear-gradient(150deg,#12392A,#0A2B1F_70%)]">
            <div className="pointer-events-none absolute inset-1.5 rounded-xl border border-gold/20" />
            <Lotus className="mx-auto mb-2 block w-9 text-gold-bright" />
            <p className="text-center text-[8px] font-bold tracking-[0.35em] text-gold-bright uppercase">
              Digital Passport Journey
            </p>
            <p className="mt-1.5 text-center font-serif text-[22px] leading-tight text-[#F8F1DE]">[Nama Klien]</p>
            <div className="mt-1.5 flex flex-col items-center gap-0.5 text-[9.5px] text-[#B9C6B4]">
              <span>
                PADMA ID <b className="font-mono font-medium text-gold-pale">PAD-XXXX-XXXX</b>
              </span>
              <span>
                Fase <b className="font-mono font-medium text-gold-pale uppercase">Garbha · Kehamilan</b>
              </span>
            </div>
            <p className="mt-3 rounded-lg bg-black/25 px-2 py-1.5 text-center font-mono text-[8.5px] tracking-[0.18em] text-[#C9BE9A]">
              PAD-XXXX-XXXX
            </p>
          </div>

          {/* baris-agenda.tsx */}
          <Tajuk>Agenda</Tajuk>
          <div className="flex items-center gap-2.5 rounded-xl border border-gold/45 bg-white p-2.5">
            <span className="flex h-11 w-10 flex-none flex-col items-center justify-center rounded-lg bg-night leading-none text-paper">
              <b className="font-serif text-[16px] font-normal">12</b>
              <span className="mt-0.5 text-[8px] font-semibold tracking-[0.12em] text-gold-bright">OKT</span>
            </span>
            <span className="min-w-0">
              <b className="block text-[11.5px] leading-snug font-semibold text-night">
                Sesi berikutnya: Garbha Flow
              </b>
              <span className="block text-[10px] text-ink-soft">09.00 WIB · datang ke rumah Anda</span>
            </span>
          </div>

          {/* Pencapaian — passport/page.tsx */}
          <Tajuk>Pencapaian</Tajuk>
          <div className="flex justify-around gap-2 rounded-xl border border-black/10 bg-white px-2 py-3">
            {lencana.map((l, i) => (
              <span key={l} className="w-[76px] text-center text-[9px] leading-tight font-bold text-[#6B5A2E]">
                <span
                  style={urutan(i)}
                  className="situs-stempel mx-auto mb-1.5 flex size-12 items-center justify-center rounded-full border-2 border-gold bg-[radial-gradient(circle_at_35%_30%,#FDF6E4,#F3E6C4)] text-gold shadow-[inset_0_0_0_3px_#fff,inset_0_0_0_4px_rgba(217,179,106,.28)]"
                >
                  <Lotus className="w-6" />
                </span>
                {l}
              </span>
            ))}
          </div>
        </div>
      </Bingkai>
      <figcaption className="text-center text-[13px] text-situs-pudar">Tampilan aplikasi Passport — data contoh</figcaption>
    </figure>
  );
}

/** Halaman Materi Passport versi desktop — dipajang di hero /digital-passport. */
export function LayarMateriContoh() {
  const menu = [
    { label: "Beranda", ikon: <Lotus className="w-3.5" /> },
    { label: "Sesi", ikon: <IkonKalender className="size-3.5" /> },
    { label: "Materi", ikon: <IkonBuku className="size-3.5" /> },
    { label: "Bayar", ikon: <IkonKartu className="size-3.5" /> },
    { label: "Profil", ikon: <IkonOrang className="size-3.5" /> },
  ];
  const materi = [
    { judul: "Panduan Garbha Flow", ket: "E-Book · baca di aplikasi", ikon: <IkonBuku className="size-4" />, terbuka: true },
    { judul: "Latihan Napas Kehamilan", ket: "Video · tonton di aplikasi", ikon: <IkonVideo className="size-4" />, terbuka: true },
    { judul: "Persiapan Menyusui", ket: "Terbuka setelah layanan terkait selesai", ikon: null, terbuka: false },
  ];
  return (
    <Bingkai className="-mt-2.5 rounded-b-[14px] border border-black/10 p-3">
      {/* nav.tsx (desktop) */}
      <div className="flex gap-1 rounded-xl border border-black/10 bg-white p-1">
        {menu.map((m) => (
          <span
            key={m.label}
            className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[10px] font-bold ${
              m.label === "Materi" ? "bg-night text-paper" : "text-ink-soft"
            }`}
          >
            <span className="max-[400px]:hidden">{m.ikon}</span>
            {m.label}
          </span>
        ))}
      </div>

      {/* passport/materi */}
      <div className="mt-2.5 rounded-xl border border-black/10 bg-white p-3">
        <p className="font-serif text-[15px] text-night">
          Materi Panduan Anda{" "}
          <span className="font-sans text-[9.5px] text-ink-soft">terbuka sesuai layanan yang Anda jalani</span>
        </p>
        <div className="mt-2 grid gap-1.5">
          {materi.map((m) => (
            <div
              key={m.judul}
              className={`flex items-center gap-2.5 rounded-lg border p-2 ${
                m.terbuka ? "border-black/10 bg-white" : "border-black/5 bg-paper-warm/60 opacity-70"
              }`}
            >
              <span
                className={`flex size-7 flex-none items-center justify-center rounded-md ${
                  m.terbuka ? "bg-leaf-soft text-leaf" : "bg-paper-warm text-gold"
                }`}
              >
                {m.ikon ?? <IkonGembok />}
              </span>
              <span className="min-w-0">
                <b className={`block text-[11px] font-semibold ${m.terbuka ? "text-night" : "text-ink-soft"}`}>
                  {m.judul}
                </b>
                <span className="block text-[9.5px] text-ink-soft">{m.ket}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 rounded-md border border-dashed border-gold/30 bg-paper-warm/60 px-2 py-1.5 text-[9px] leading-snug text-ink-soft">
          Semua materi hanya bisa dibaca &amp; ditonton di dalam aplikasi, tanpa unduhan.
        </p>
      </div>
    </Bingkai>
  );
}

function Tajuk({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3.5 mb-1.5 flex items-center gap-2 font-serif text-[13px] text-night">
      {children}
      <span className="h-px flex-1 bg-gold/35" />
    </p>
  );
}

function IkonGembok() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
