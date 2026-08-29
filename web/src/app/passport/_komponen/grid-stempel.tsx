import { Lotus } from "@/app/_landing/lotus";
import { formatTanggalPendek } from "@/lib/passport/waktu";

export type SlotStempel = {
  jenis: "terisi" | "berikutnya" | "kosong";
  tanggal?: string;
};

// Grid stempel = inti visual paspor. Empat kolom di mobile, delapan di layar
// lebar: memaksa delapan kolom di 390px membuat lingkaran menyusut sampai
// tanggalnya tidak terbaca dan barisnya menonjol ke samping.
//
// `data-stempel` bukan hiasan: JENIS slot adalah kontrak yang diuji, sementara
// kelas Tailwind berubah setiap kali desain disetel.
export function GridStempel({ slot }: { slot: SlotStempel[] }) {
  return (
    <div className="mb-3.5 grid grid-cols-4 gap-2.5 sm:grid-cols-8">
      {slot.map((s, i) => {
        const t = s.tanggal ? formatTanggalPendek(s.tanggal) : null;

        if (s.jenis === "terisi" && t) {
          // Rotasi ringan dan berulang-pola: stempel yang dicap tangan tidak
          // pernah lurus sempurna, dan sudut yang deterministik menjaga markup
          // tetap sama antara server dan klien.
          const rot = ((i % 3) - 1) * 4 - 2;
          return (
            <div
              key={i}
              data-stempel="terisi"
              style={{ transform: `rotate(${rot}deg)` }}
              className="flex aspect-square flex-col items-center justify-center gap-0.5 overflow-hidden rounded-full border-[1.8px] border-gold bg-[#FDF9EE] text-gold shadow-[inset_0_0_0_3px_#FDF9EE,inset_0_0_0_4px_rgba(217,179,106,.28)]"
            >
              <Lotus className="w-[44%]" />
              <span className="font-mono text-[8.5px] text-[#8D6E33]">
                {t.hari} {t.bulan}
              </span>
            </div>
          );
        }

        if (s.jenis === "berikutnya" && t) {
          return (
            <div
              key={i}
              data-stempel="berikutnya"
              className="flex aspect-square flex-col items-center justify-center gap-0.5 overflow-hidden rounded-full border-[1.6px] border-dashed border-gold text-gold"
            >
              <span className="font-mono text-[8.5px]">
                {t.hari} {t.bulan}
              </span>
              <span className="text-[9px]">terjadwal</span>
            </div>
          );
        }

        return (
          <div
            key={i}
            data-stempel="kosong"
            className="flex aspect-square items-center justify-center rounded-full border-[1.6px] border-dashed border-black/10 text-[10px] text-[#C6C0AC]"
          >
            •
          </div>
        );
      })}
    </div>
  );
}
