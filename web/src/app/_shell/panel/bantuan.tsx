import type { ReactNode } from "react";

/**
 * Penjelasan halaman yang bisa dibuka saat dibutuhkan.
 *
 * Sebelumnya tiap halaman panel membuka diri dengan paragraf empat baris.
 * Berguna di hari pertama, kebisingan di hari ketiga puluh — dan panel ini
 * dibuka setiap hari.
 *
 * Teksnya TIDAK dibuang, hanya dilipat: sebagian memuat pembedaan yang pernah
 * hilang dan mahal (mis. "nonaktif" tidak berarti nama mitra lenyap dari
 * riwayat klien). `<details>` dipilih karena ia melipat tanpa JavaScript sama
 * sekali, dan isinya tetap terbaca pencarian halaman browser.
 */
export function Bantuan({ judul, children }: { judul: string; children: ReactNode }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-[12px] font-bold text-panel-muted">
        {judul}
      </summary>
      <div className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-panel-muted">
        {children}
      </div>
    </details>
  );
}
