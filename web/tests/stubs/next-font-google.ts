/**
 * `next/font/google` hanya bisa berjalan di dalam kompiler Next.js (SWC
 * mengganti pemanggilannya saat build); di Vitest fungsi-fungsinya tidak
 * ada, dan halaman situs publik yang memuat `_situs/font.ts` gagal di-import.
 * Stub ini mengembalikan bentuk yang sama — `className`, `variable`,
 * `style` — untuk font apa pun yang diminta.
 */
type OpsiFont = { variable?: string };

const fontPalsu = (opsi: OpsiFont = {}) => ({
  className: "font-uji",
  variable: opsi.variable ?? "",
  style: { fontFamily: "uji" },
});

export const Cormorant_Garamond = fontPalsu;
export const Jost = fontPalsu;
export const Parisienne = fontPalsu;
export const Marcellus = fontPalsu;
export const Plus_Jakarta_Sans = fontPalsu;
export const IBM_Plex_Mono = fontPalsu;
