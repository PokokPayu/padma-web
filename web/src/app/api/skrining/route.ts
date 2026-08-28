import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { nilaiSkrining } from "@/lib/skrining/evaluasi";
import { buatKodeSkrining } from "@/lib/skrining/kode";
import { SkemaSkriningPublik } from "@/lib/skrining/skema";

// Rate limit sederhana per proses. Bukan pertahanan sempurna (Vercel serverless
// punya banyak instance), tapi cukup menahan penyalahgunaan kasual dan tidak
// memerlukan infrastruktur tambahan di v1.
const JEJAK = new Map<string, number[]>();
const JENDELA_MS = 60_000;
const MAKS_PER_JENDELA = 5;

function terlaluSering(ip: string): boolean {
  const sekarang = Date.now();
  const riwayat = (JEJAK.get(ip) ?? []).filter((t) => sekarang - t < JENDELA_MS);
  riwayat.push(sekarang);
  JEJAK.set(ip, riwayat);
  return riwayat.length > MAKS_PER_JENDELA;
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "tak-dikenal";
  if (terlaluSering(ip)) {
    return NextResponse.json(
      { pesan: "Terlalu banyak percobaan. Coba lagi sebentar lagi." },
      { status: 429 },
    );
  }

  let mentah: unknown;
  try {
    mentah = await request.json();
  } catch {
    return NextResponse.json({ pesan: "Format tidak valid." }, { status: 400 });
  }

  const parsed = SkemaSkriningPublik.safeParse(mentah);
  if (!parsed.success) {
    // Jangan pernah mencatat isi `jawaban` (data kesehatan) ke log.
    return NextResponse.json({ pesan: "Data skrining tidak valid." }, { status: 400 });
  }

  const { nama, no_hp, fase, jawaban } = parsed.data;
  const penilaian = nilaiSkrining(fase, jawaban);
  const admin = createAdminSupabase();

  // `kode` UNIQUE — coba ulang bila bentrok, jangan crash.
  for (let percobaan = 0; percobaan < 5; percobaan++) {
    const kode = buatKodeSkrining();
    const { error } = await admin.from("screenings").insert({
      kode,
      nama,
      no_hp,
      fase,
      jawaban: { ...jawaban, dihentikan_pada: penilaian.dihentikanPada },
      hasil: penilaian.hasil,
      flags: penilaian.flags,
    });
    if (!error) return NextResponse.json({ kode }, { status: 201 });
    if (error.code !== "23505") {
      return NextResponse.json({ pesan: "Gagal menyimpan." }, { status: 500 });
    }
  }
  return NextResponse.json({ pesan: "Gagal menyimpan." }, { status: 500 });
}
