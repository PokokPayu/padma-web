/**
 * Bentuk minimal `document` yang dibutuhkan penutup drawer.
 *
 * Dituliskan sebagai tipe sendiri supaya perilakunya bisa diuji dengan
 * dokumen palsu: suite ini berjalan di `environment: "node"` tanpa jsdom, dan
 * menambah jsdom hanya demi satu tombol Escape bukan tukar yang setara.
 *
 * Listener dituliskan dengan SINTAKS METODE (`addEventListener(...)`, bukan
 * `addEventListener: (...) => void`) supaya parameternya diperiksa secara
 * bivarian — dengan sintaks properti, `Document` asli milik DOM tertolak
 * karena `addEventListener`-nya menerima `EventListener`/`(e: Event) => void`
 * yang lebih luas dari sekadar `(e: KeyboardEvent) => void`.
 */
export type DokumenMinimal = {
  addEventListener(jenis: string, fn: (e: Event) => void): void;
  removeEventListener(jenis: string, fn: (e: Event) => void): void;
};

/**
 * Memasang jalan keluar keyboard untuk drawer, mengembalikan pembersihnya.
 *
 * Escape adalah satu-satunya jalan keluar bagi pemakai keyboard: overlay hanya
 * bisa diklik, dan tanpa ini drawer yang terbuka mengunci layar sampai
 * halaman dimuat ulang.
 */
export function pasangPenutup(dok: DokumenMinimal, tutup: () => void): () => void {
  const padaTombol = (e: Event) => {
    // `Event` adalah tipe terluas yang diterima document.addEventListener;
    // penyempitan ke KeyboardEvent dilakukan di sini supaya pemanggilnya —
    // termasuk dokumen palsu di test — tidak perlu tahu tipe DOM apa pun.
    if ((e as KeyboardEvent).key === "Escape") tutup();
  };
  dok.addEventListener("keydown", padaTombol);
  return () => dok.removeEventListener("keydown", padaTombol);
}
