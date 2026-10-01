// Status konten situs publik (artikel, testimoni).
export function PillTerbit({ terbit }: { terbit: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
        terbit ? "bg-leaf-soft text-leaf" : "bg-clay/10 text-clay"
      }`}
    >
      {terbit ? "Terbit" : "Draf"}
    </span>
  );
}
