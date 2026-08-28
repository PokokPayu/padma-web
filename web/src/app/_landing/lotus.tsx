// Lambang teratai PADMA (padma = teratai). Satu komponen dipakai ulang di
// nav, hero, kutipan, dan footer — path-nya persis mengikuti prototipe yang
// sudah disetujui klien. `currentColor` supaya warnanya ikut konteks.
export function Lotus({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 46"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    >
      <path d="M32 6 C37.5 13 37.5 23 32 32 C26.5 23 26.5 13 32 6Z" />
      <path d="M19 12 C27 15.5 30.5 23.5 32 32 C24 30.5 17.5 22.5 19 12Z" />
      <path d="M45 12 C37 15.5 33.5 23.5 32 32 C40 30.5 46.5 22.5 45 12Z" />
      <path d="M7 21 C16.5 21.5 26.5 26.5 32 32 C22.5 34.5 11.5 30 7 21Z" />
      <path d="M57 21 C47.5 21.5 37.5 26.5 32 32 C41.5 34.5 52.5 30 57 21Z" />
      <path
        d="M14 36 C20 39.5 26 40.5 32 40.5 C38 40.5 44 39.5 50 36"
        strokeLinecap="round"
      />
    </svg>
  );
}
