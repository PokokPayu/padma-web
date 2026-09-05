"use client";

import type { ReactNode } from "react";
import { KerangkaPanel } from "@/app/_shell/panel/kerangka";
import type { ItemMenu, Tautan } from "@/app/_shell/panel/sidebar";

const MENU: ItemMenu[] = [
  { href: "/owner", label: "Beranda", ikon: "lotus" },
  // Prototipe menamainya "Rekap & Honor" dan "Rate Card"; labelnya
  // dipendekkan agar sidebar tidak memaksa satu tujuan menjadi dua baris.
  // Judul halamannya tetap panjang.
  { href: "/owner/rekap", label: "Rekap", ikon: "rekap" },
  { href: "/owner/tarif", label: "Tarif", ikon: "tarif" },
];

// JALAN PULANG. Owner adalah SUPERSET admin — ia berhak membuka seluruh panel
// operasional — tetapi sebelum ini tidak ada satu pun tautan klik dari /owner
// ke /admin (terverifikasi: 0 tautan). Satu-satunya jalan adalah mengetik URL
// sendiri, yang berarti fitur itu praktis tidak ada bagi pemilik klinik.
//
// Sengaja BUKAN anggota MENU: ia bukan tujuan panel owner dan tidak pernah
// boleh ikut menyala sebagai `aria-current`. Ia jalan keluar, dan tampil
// berbeda supaya terbaca demikian.
const PULANG: Tautan = { href: "/admin", label: "Buka Panel Admin", ikon: "keluar" };

/**
 * Shell panel owner.
 *
 * Panel ini hanya punya tiga tujuan, jadi bar bawah layar kecil memuat
 * KETIGANYA — tidak ada yang perlu diringkas seperti di panel admin.
 *
 * Daftar menu SENGAJA tinggal di sini, terpisah dari daftar admin: kedua
 * tujuan di bawah (Rekap, Tarif) berisi seluruh nominal PADMA, dan satu
 * daftar bersama akan mengubah pemisahan fisik money firewall menjadi satu
 * kondisional peran.
 */
export function NavOwner({ nama, children }: { nama: string; children: ReactNode }) {
  return (
    <KerangkaPanel
      menu={MENU}
      menuRingkas={MENU}
      akar="/owner"
      namaPanel="Panel Owner"
      labelSidebar="Menu panel owner"
      labelBottomBar="Navigasi panel owner"
      nama={nama}
      peran="Owner"
      jalanKeluar={PULANG}
      catatan={
        <>
          {/* Kebalikan persis dari catatan di panel admin ("tidak ada angka
              uang di panel ini"). Keduanya menjelaskan sisi yang sama dari
              satu firewall, dan owner perlu tahu bahwa yang ia lihat di sini
              memang tidak pernah sampai ke layar siapa pun yang lain. */}
          <b className="text-panel-ink">Money firewall</b> — panel inilah
          satu-satunya tempat nominal uang hidup. Admin dan klien tidak pernah
          melihat angka di halaman ini, dan penolakannya ditegakkan di level
          basis data.
        </>
      }
    >
      {children}
    </KerangkaPanel>
  );
}
