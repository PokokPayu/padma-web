export type FormatVarian = "private" | "circle";

/**
 * Nama tampilan sebuah varian, dirangkai dari bagian yang terisi saja.
 *
 * SATU-SATUNYA perangkai label varian di proyek ini — dipakai bersama oleh
 * rate card owner, tagihan admin, dan katalog landing. Dua perangkai akan
 * berpisah diam-diam, dan perpisahannya berbentuk varian yang bernama berbeda
 * di dua layar sekaligus.
 *
 * Urutannya tetap: label dulu (program bernama seperti "Basic"/"2 modul"),
 * lalu durasi, lalu format. Varian baku memulangkan string kosong; layar yang
 * memanggilnya menampilkan nama layanan sebagai gantinya.
 */
export function labelVarian(v: {
  label: string;
  durasiMenit: number | null;
  format: FormatVarian | null;
}): string {
  const bagian = [
    v.label.trim(),
    v.durasiMenit === null ? "" : `${v.durasiMenit} menit`,
    v.format === null ? "" : v.format === "private" ? "Private" : "Circle",
  ].filter((b) => b !== "");
  return bagian.join(" · ");
}
