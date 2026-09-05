/**
 * Badge antrean. Sengaja HILANG saat nol: badge "0" yang selalu tampil
 * membuat panel terlihat selalu punya pekerjaan, dan alarm yang dinormalkan
 * berhenti dipercaya — termasuk saat ia benar.
 *
 * Angkanya SELALU datang sebagai prop dari server. Badge tidak pernah
 * menghitung apa pun sendiri.
 */
export function Badge({ jumlah }: { jumlah: number }) {
  if (jumlah <= 0) return null;
  return (
    <span
      aria-label={`${jumlah} menunggu`}
      className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-clay px-1.5 text-[10px] font-extrabold tabular-nums text-white"
    >
      {jumlah}
    </span>
  );
}
