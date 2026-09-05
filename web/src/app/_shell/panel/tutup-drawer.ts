/**
 * Bentuk minimal `document` yang dibutuhkan penutup drawer.
 *
 * Dituliskan sebagai tipe sendiri supaya perilakunya bisa diuji dengan
 * dokumen palsu: suite ini berjalan di `environment: "node"` tanpa jsdom, dan
 * menambah jsdom hanya demi satu tombol Escape bukan tukar yang setara.
 */
export type DokumenMinimal = {
  addEventListener: (jenis: string, fn: (e: never) => void) => void;
  removeEventListener: (jenis: string, fn: (e: never) => void) => void;
};

/**
 * Memasang jalan keluar keyboard untuk drawer, mengembalikan pembersihnya.
 *
 * Escape adalah satu-satunya jalan keluar bagi pemakai keyboard: overlay hanya
 * bisa diklik, dan tanpa ini drawer yang terbuka mengunci layar sampai
 * halaman dimuat ulang.
 */
export function pasangPenutup(dok: DokumenMinimal, tutup: () => void): () => void {
  const padaTombol = (e: { key: string }) => {
    if (e.key === "Escape") tutup();
  };
  dok.addEventListener("keydown", padaTombol as (e: never) => void);
  return () => dok.removeEventListener("keydown", padaTombol as (e: never) => void);
}
