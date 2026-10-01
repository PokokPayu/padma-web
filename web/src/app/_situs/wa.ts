/**
 * Pesan pembuka WhatsApp dari situs publik (handoff landing v2, README
 * "Kode sumber WA"). Kata `WEBSITE` adalah KODE SUMBER: admin membaca kata
 * itu untuk tahu kanal asal calon klien. Kanal lain memakai pola yang sama
 * (INSTAGRAM, TIKTOK, POSTER, kode affiliate), jadi kata ini jangan diubah
 * tanpa memberi tahu admin yang membaca inbox WA.
 */
export const PESAN_WA_SITUS =
  "Halo PADMA, saya dari WEBSITE dan ingin tanya kelas serta pricelist.";

/** `nomorWaLink` berasal dari `bacaPengaturan()`, tidak pernah ditulis keras. */
export function tautanWaSitus(nomorWaLink: string): string {
  return `https://wa.me/${nomorWaLink}?text=${encodeURIComponent(PESAN_WA_SITUS)}`;
}

export const INSTAGRAM = "https://www.instagram.com/padmawellness.id";
export const TIKTOK = "https://www.tiktok.com/@padmawellness.id";
