import { Cormorant_Garamond, Jost, Parisienne } from "next/font/google";

// Font handoff landing v2. Dimuat di sini, bukan di root layout, supaya
// /skrining, /passport, dan panel staf tidak ikut mengunduh tiga font yang
// tidak mereka pakai.
const cormorant = Cormorant_Garamond({
  variable: "--nf-cormorant",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

const jost = Jost({
  variable: "--nf-jost",
  subsets: ["latin"],
  display: "swap",
});

const parisienne = Parisienne({
  variable: "--nf-parisienne",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

export const kelasFontSitus = `${cormorant.variable} ${jost.variable} ${parisienne.variable}`;
