import type { ReactElement } from "react";
import { Lotus } from "@/app/_landing/lotus";

/**
 * Satu peta ikon untuk kedua panel staf.
 *
 * Sebelum ini `nav-admin.tsx` dan `nav-owner.tsx` masing-masing punya fungsi
 * `Ikon` sendiri, dengan `Lotus` dibagi tetapi sisanya disalin. Dua salinan
 * ikon akan berpisah diam-diam: yang berubah cuma salah satu panel, dan tidak
 * ada yang merah.
 *
 * Setiap path di bawah membawa alasan bentuknya — sebagian besar dipindahkan
 * apa adanya dari kedua berkas nav lama, termasuk komentarnya.
 */
export const NAMA_IKON = [
  "lotus",
  "inbox",
  "user",
  "cal",
  "bayar",
  "mitra",
  "katalog",
  "materi",
  "setelan",
  "rekap",
  "tarif",
  "keluar",
  "menu",
] as const;

export type NamaIkon = (typeof NAMA_IKON)[number];

const PATH: Record<Exclude<NamaIkon, "lotus">, ReactElement> = {
  inbox: (
    <path
      d="M3.5 13.5h4.2l1.5 2.6h5.6l1.5-2.6h4.2M3.5 13.5 6 5.2h12L20.5 13.5v4.3a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"
      strokeLinejoin="round"
    />
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4" strokeLinecap="round" />
    </>
  ),
  cal: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 2.8v3.7M16 2.8v3.7" strokeLinecap="round" />
    </>
  ),
  // Kuitansi, bukan lambang mata uang: panel admin tidak pernah menampilkan
  // nominal, dan ikon "Rp" akan menjanjikan angka yang memang tidak ada.
  bayar: (
    <>
      <path
        d="M5.5 3.6h13v16.8l-2.2-1.5-2.2 1.5-2.1-1.5-2.2 1.5-2.2-1.5-2.1 1.5z"
        strokeLinejoin="round"
      />
      <path d="M9 8.4h6M9 12.2h6" strokeLinecap="round" />
    </>
  ),
  mitra: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.6 20c1-3.2 3.4-4.8 6.4-4.8s5.4 1.6 6.4 4.8" strokeLinecap="round" />
      <path d="M16.4 5.2a3.2 3.2 0 0 1 0 5.9M18.4 20c-.4-1.7-1.1-3-2.1-3.9" strokeLinecap="round" />
    </>
  ),
  // Lapisan kartu katalog, bukan tag harga: modul Layanan mengelola nama &
  // susunan paket, sementara angka tarifnya tidak pernah singgah di panel admin.
  katalog: (
    <>
      <rect x="3.2" y="6.4" width="17.6" height="13.4" rx="2.4" />
      <path d="M6.6 3.4h10.8M4.9 10.4h14.2" strokeLinecap="round" />
    </>
  ),
  // Buku terbuka, bukan berkas/unduhan: materi PADMA sengaja hanya bisa dibaca
  // di dalam aplikasi — ikon berkas akan menjanjikan unduhan yang tidak ada.
  materi: (
    <>
      <path
        d="M12 6.4C10.3 5.1 8.3 4.5 5.6 4.5H3.4v13.2h2.2c2.7 0 4.7.6 6.4 1.9 1.7-1.3 3.7-1.9 6.4-1.9h2.2V4.5h-2.2c-2.7 0-4.7.6-6.4 1.9z"
        strokeLinejoin="round"
      />
      <path d="M12 6.4v13.2" strokeLinecap="round" />
    </>
  ),
  // Sekrup penyetel, bukan roda gigi: modul ini menyetel teks & nomor yang
  // dilihat publik, bukan menyimpan preferensi teknis.
  setelan: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path
        d="M12 3.2v2.4M12 18.4v2.4M20.8 12h-2.4M5.6 12H3.2M18.2 5.8l-1.7 1.7M7.5 16.5l-1.7 1.7M18.2 18.2l-1.7-1.7M7.5 7.5 5.8 5.8"
        strokeLinecap="round"
      />
    </>
  ),
  // Batang grafik naik: rekap adalah angka yang dibandingkan antar pekan.
  rekap: (
    <>
      <path d="M3.6 20.4h16.8" strokeLinecap="round" />
      <rect x="5.4" y="12.4" width="3.6" height="6" rx="1.1" />
      <rect x="10.2" y="8.2" width="3.6" height="10.2" rx="1.1" />
      <rect x="15" y="4.4" width="3.6" height="14" rx="1.1" />
    </>
  ),
  // Kartu bertanda garis harga — "rate card", bukan lambang mata uang: nominal
  // rupiahnya ada di isi halaman, dan ikon "Rp" akan mengulanginya dua kali.
  tarif: (
    <>
      <rect x="3.2" y="5.4" width="17.6" height="13.2" rx="2.4" />
      <path d="M3.2 10.2h17.6M7 14.4h5.4M15.4 14.4h2.2" strokeLinecap="round" />
    </>
  ),
  // Panah keluar dari kotak: menegaskan tautannya MENINGGALKAN panel ini.
  keluar: (
    <>
      <path
        d="M13.4 4.6H5.6a1.6 1.6 0 0 0-1.6 1.6v12a1.6 1.6 0 0 0 1.6 1.6h12a1.6 1.6 0 0 0 1.6-1.6v-7.8"
        strokeLinecap="round"
      />
      <path d="M14.2 4.6h5.2v5.2M19.4 4.6 11 13" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  menu: (
    <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
  ),
};

export function Ikon({ nama, className }: { nama: NamaIkon; className?: string }) {
  // Lambang teratai dipakai ulang dari komponen bersama — path SVG-nya
  // sengaja tidak disalin ke berkas ini.
  if (nama === "lotus") return <Lotus className={className} />;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      {PATH[nama]}
    </svg>
  );
}
