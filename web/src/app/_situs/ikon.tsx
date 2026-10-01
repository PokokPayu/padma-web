// Ikon garis situs publik, path-nya persis dari mockup handoff
// (docs/landingpage-v2). Semua memakai `currentColor` supaya warnanya ikut
// kelas teks pemanggil.
import type { ReactNode } from "react";

type Props = { className?: string };

function Garis({ className, children, lebar = 1.6 }: Props & { children: ReactNode; lebar?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={lebar}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function LogoTeratai({ className }: Props) {
  return (
    <svg
      viewBox="0 0 40 34"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 3c-4 5-4 14 0 22 4-8 4-17 0-22z" />
      <path d="M20 25c-3-7-9-11-15-11 0 7 6 12 15 11z" />
      <path d="M20 25c3-7 9-11 15-11 0 7-6 12-15 11z" />
      <path d="M20 25c-6-2-12-2-17 1 5 4 12 4 17-1z" />
      <path d="M20 25c6-2 12-2 17 1-5 4-12 4-17-1z" />
    </svg>
  );
}

export function IkonCentang({ className }: Props) {
  return (
    <svg viewBox="0 0 26 26" className={className} aria-hidden="true">
      <circle cx="13" cy="13" r="12" fill="currentColor" />
      <path
        d="M8 13.5l3.2 3.2L18 10"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const IkonWa = ({ className }: Props) => (
  <Garis className={className} lebar={1.8}>
    <path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.3z" />
    <path d="M9.2 8.6c.4 2.7 2.6 5 5.3 5.4l1-1.1 1.9 1-.4 1.5c-4.1.2-8.3-3.9-8.2-8.2l1.5-.5 1 1.9z" />
  </Garis>
);

export const IkonPanah = ({ className }: Props) => (
  <Garis className={className} lebar={1.8}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Garis>
);

export const IkonPanahBawah = ({ className }: Props) => (
  <Garis className={className} lebar={1.8}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Garis>
);

export const IkonPanahPanjang = ({ className }: Props) => (
  <Garis className={className} lebar={1.4}>
    <path d="M3 12h18M14 5l7 7-7 7" />
  </Garis>
);

export const IkonInstagram = ({ className }: Props) => (
  <Garis className={className}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <path d="M17.2 6.8h.01" />
  </Garis>
);

export const IkonTiktok = ({ className }: Props) => (
  <Garis className={className}>
    <path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5M14 4c.5 2.5 2.5 4.5 5 4.8" />
  </Garis>
);

export const IkonKalender = ({ className }: Props) => (
  <Garis className={className}>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path d="M4 10h16M9 3v4M15 3v4" />
  </Garis>
);

export const IkonDokumen = ({ className }: Props) => (
  <Garis className={className}>
    <path d="M7 3h7l4 4v14H7z" />
    <path d="M14 3v4h4M10 12h5M10 16h5" />
  </Garis>
);

export const IkonBuku = ({ className }: Props) => (
  <Garis className={className}>
    <path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5zM12 6v13.5" />
  </Garis>
);

export const IkonTunas = ({ className }: Props) => (
  <Garis className={className}>
    <path d="M12 20v-8M12 12c0-4 3-7 7-7 0 4-3 7-7 7zM12 14c0-3-2.5-5.5-6-5.5 0 3.5 2.5 5.5 6 5.5z" />
  </Garis>
);

export const IkonKeluarga = ({ className }: Props) => (
  <Garis className={className}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
    <circle cx="17" cy="9" r="2.3" />
    <path d="M16 13.6c2.8 0 5 1.9 5 4.9" />
  </Garis>
);

export const IkonTanya = ({ className }: Props) => (
  <Garis className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.4M12 17h.01" />
  </Garis>
);

export const IkonPonsel = ({ className }: Props) => (
  <Garis className={className}>
    <rect x="7" y="3" width="10" height="18" rx="2" />
    <path d="M11 18h2" />
  </Garis>
);

export const IkonPapanKlip = ({ className }: Props) => (
  <Garis className={className}>
    <rect x="6" y="4" width="12" height="17" rx="2" />
    <path d="M9 4h6v3H9zM9 11h6M9 15h4" />
  </Garis>
);

export const IkonPapanCentang = ({ className }: Props) => (
  <Garis className={className}>
    <rect x="6" y="4" width="12" height="17" rx="2" />
    <path d="M9 4h6v3H9zM9 12l2 2 4-4" />
  </Garis>
);

export const IkonKartu = ({ className }: Props) => (
  <Garis className={className}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M3 10h18M7 15h4" />
  </Garis>
);

export const IkonVideo = ({ className }: Props) => (
  <Garis className={className}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M10 9.5v5l4.5-2.5z" />
  </Garis>
);

export const IkonRumah = ({ className }: Props) => (
  <Garis className={className}>
    <path d="M4 11l8-7 8 7v9H4z" />
    <path d="M10 20v-5h4v5" />
  </Garis>
);

export const IkonHati = ({ className }: Props) => (
  <Garis className={className}>
    <path d="M12 20s-8-4.8-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.2 12 20 12 20z" />
  </Garis>
);

export const IkonSilang = ({ className }: Props) => (
  <Garis className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </Garis>
);

export const IkonGlobe = ({ className }: Props) => (
  <Garis className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
  </Garis>
);

export const IkonDaftar = ({ className }: Props) => (
  <Garis className={className}>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </Garis>
);

export const IkonPerisai = ({ className }: Props) => (
  <Garis className={className}>
    <path d="M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z" />
    <path d="M9 12l2 2 4-4" />
  </Garis>
);

export const IkonLokasi = ({ className }: Props) => (
  <Garis className={className}>
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Garis>
);

export const IkonOrang = ({ className }: Props) => (
  <Garis className={className}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5" />
  </Garis>
);

export const IkonInfo = ({ className }: Props) => (
  <Garis className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Garis>
);

export const IkonMenu = ({ className }: Props) => (
  <Garis className={className} lebar={1.8}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Garis>
);
