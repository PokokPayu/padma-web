import { daftarSoal, levelSoal, type FaseSkrining, type Level } from "./bank-soal";

export type Flag = { id: string; level: Level; teks: string };

export type HasilSkrining = {
  hasil: "hijau" | "merah";
  urgent: boolean;
  flags: Flag[];
  dihentikanPada: string | null;
};

// Otoritatif: hasil SELALU dihitung di server dari bank soal server-side.
// Klien hanya mengirim jawaban ya/tidak; `hasil` kiriman klien tidak dipercaya.
export function nilaiSkrining(
  fase: FaseSkrining,
  jawaban: Record<string, boolean>,
): HasilSkrining {
  const flags: Flag[] = [];
  let dihentikanPada: string | null = null;

  for (const soal of daftarSoal(fase)) {
    const dijawab = jawaban[soal.id];
    if (dijawab === undefined) continue; // tidak sempat ditanyakan
    if (!dijawab) continue;

    const level = levelSoal(soal, fase);
    flags.push({ id: soal.id, level, teks: soal.teks });

    if (level === "urgent") {
      // Berhenti seketika: pertanyaan sesudahnya memang tidak pernah ditanyakan
      // dan TIDAK boleh dicatat sebagai "tidak".
      dihentikanPada = soal.id;
      break;
    }
  }

  const urgent = flags.some((f) => f.level === "urgent");
  return {
    hasil: flags.length > 0 ? "merah" : "hijau",
    urgent,
    flags,
    dihentikanPada,
  };
}
