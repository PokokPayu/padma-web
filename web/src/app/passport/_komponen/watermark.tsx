// Deterrent, bukan proteksi mutlak: teks bab tetap terbaca di View Source dan
// DevTools karena ia memang ikut terkirim bersama halaman, dan tidak ada
// platform mana pun yang bisa mencegah tangkapan layar. Guna watermark adalah
// melacak SUMBER bila satu tangkapan layar tersebar — bukan mengunci apa pun.
// Spec sudah jujur soal ini; komponen ini tidak boleh dijual lebih dari itu.
export function Watermark({ nama, padmaId }: { nama: string; padmaId: string }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -inset-10 z-0 flex rotate-[-24deg] flex-wrap items-center justify-center gap-x-12 gap-y-16 font-mono text-[12.5px] uppercase text-night opacity-[0.075]"
    >
      {Array.from({ length: 14 }, (_, i) => (
        <span key={i} className="whitespace-nowrap">
          {nama} · {padmaId}
        </span>
      ))}
    </div>
  );
}
