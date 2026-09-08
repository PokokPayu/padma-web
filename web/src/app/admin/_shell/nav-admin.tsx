"use client";

import type { ReactNode } from "react";
import { KerangkaPanel } from "@/app/_shell/panel/kerangka";
import type { ItemMenu } from "@/app/_shell/panel/sidebar";
import type { Antrean } from "@/lib/admin/antrean";

// `badge` menunjuk medan Antrean yang dipakai, bukan angkanya — supaya satu
// sumber angka (server) tidak pernah tersalin ulang sebagai literal di UI.
const MENU: Array<Omit<ItemMenu, "jumlah"> & { badge?: keyof Antrean }> = [
  { href: "/admin", label: "Beranda", ikon: "lotus" },
  { href: "/admin/skrining", label: "Inbox", ikon: "inbox", badge: "skriningBaru" },
  { href: "/admin/klien", label: "Klien", ikon: "user", badge: "klienBelumAktif" },
  { href: "/admin/sesi", label: "Sesi", ikon: "cal", badge: "permintaanMenunggu" },
  // Label sengaja "Bayar", bukan "Pembayaran": bar bawah layar kecil memuat
  // empat tujuan berdampingan dan label panjang akan terpotong justru di
  // tujuan yang paling perlu dikenali. Judul halamannya tetap "Pembayaran".
  { href: "/admin/bayar", label: "Bayar", ikon: "bayar", badge: "klaimMenunggu" },
  { href: "/admin/mitra", label: "Mitra", ikon: "mitra" },
  // Judul halamannya "Layanan" (atau "Layanan & Paket" bila `PAKET_TAMPIL`
  // dinyalakan kembali, lihat src/lib/paket-tampil.ts); labelnya dipendekkan
  // agar sidebar tidak memaksa satu tujuan menjadi dua baris — beda alasan
  // dari saklar itu, jadi tidak ikut berubah bersamanya.
  { href: "/admin/layanan", label: "Layanan", ikon: "katalog" },
  // Judul halamannya "Materi Panduan".
  { href: "/admin/materi", label: "Materi", ikon: "materi" },
  // Judul halamannya "Pengaturan".
  { href: "/admin/pengaturan", label: "Setelan", ikon: "setelan" },
];

// Empat tujuan tersibuk klinik — dan tepat keempatnya yang punya antrean.
// Sisanya tetap terjangkau lewat drawer.
const RINGKAS = ["/admin/skrining", "/admin/klien", "/admin/sesi", "/admin/bayar"];

/**
 * Shell panel admin: daftar menu + perakitnya.
 *
 * Daftar menu SENGAJA tinggal di sini, bukan di primitif bersama. Menu owner
 * memuat tujuan yang seluruhnya berisi nominal (Rekap, Tarif); menyatukan
 * kedua daftar akan mengubah pemisahan fisik money firewall menjadi satu
 * kondisional peran yang bisa salah tulis dalam satu karakter.
 *
 * Angka antrean datang sebagai prop dari layout — komponen ini tidak pernah
 * mengambil datanya sendiri.
 */
export function NavAdmin({
  antrean,
  nama,
  peran,
  children,
}: {
  antrean: Antrean;
  nama: string;
  peran: string;
  children: ReactNode;
}) {
  const menu: ItemMenu[] = MENU.map((m) => ({
    href: m.href,
    label: m.label,
    ikon: m.ikon,
    jumlah: m.badge ? antrean[m.badge] : 0,
  }));

  return (
    <KerangkaPanel
      menu={menu}
      menuRingkas={menu.filter((m) => RINGKAS.includes(m.href))}
      akar="/admin"
      namaPanel="Panel Admin"
      labelSidebar="Menu panel admin"
      labelBottomBar="Navigasi panel admin"
      nama={nama}
      peran={peran}
      catatan={
        <>
          <b className="text-panel-ink">Money firewall</b> — tidak ada angka
          uang di panel ini. Nominal hanya hidup di panel Owner, dan
          penolakannya ditegakkan di level basis data.
        </>
      }
    >
      {children}
    </KerangkaPanel>
  );
}
