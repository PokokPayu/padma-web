import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { nilaiSkrining } from "@/lib/skrining/evaluasi";
import { saringJawaban } from "@/lib/skrining/bank-soal";
import { buatKodeSkrining } from "@/lib/skrining/kode";
import { SkemaSkriningPublik } from "@/lib/skrining/skema";
import { kunciPembatas, terlaluSering } from "@/lib/skrining/pembatas";
import { terbitkanTokenKlaim, COOKIE_KLAIM, KLAIM_TTL_JAM } from "@/lib/skrining/klaim";

// Rute ini PUBLIK (tanpa auth) tetapi menulis dengan SERVICE ROLE. Karena itu
// urutan pemeriksaan penting: yang paling murah dan paling membatasi dulu.
//   1. rate limit (kunci yang tidak bisa dipilih penyerang — lihat pembatas.ts)
//   2. batas ukuran body (body raksasa tidak pernah sampai ke JSON.parse)
//   3. skema Zod (termasuk batas jumlah kunci `jawaban`)
//   4. penyaringan `jawaban` ke id soal yang dikenal sebelum insert
// Lapis kelima ada di DB: CHECK ukuran jawaban (fail-closed bila kode dilewati).

/**
 * Skrining terbesar = nama + no_hp + fase + 12 jawaban boolean (< 1 KB).
 * 16 KB sangat longgar; 2,76 MB — yang sebelumnya diterima — tidak pernah wajar.
 */
const MAKS_BYTE_BODY = 16 * 1024;

/**
 * Membaca body dengan pagar byte NYATA: `content-length` boleh bohong atau
 * tidak ada, jadi aliran dibaca bertahap dan dibatalkan begitu melewati batas.
 * Mengembalikan null bila body terlalu besar.
 */
async function bacaBodyTerbatas(request: Request, maks: number): Promise<string | null> {
  const dilaporkan = Number(request.headers.get("content-length"));
  if (Number.isFinite(dilaporkan) && dilaporkan > maks) return null;

  const aliran = request.body;
  if (!aliran) {
    const teks = await request.text();
    return new TextEncoder().encode(teks).byteLength > maks ? null : teks;
  }

  const pembaca = aliran.getReader();
  const pengurai = new TextDecoder("utf-8");
  let teks = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await pembaca.read();
      if (done) break;
      total += value.byteLength;
      if (total > maks) {
        await pembaca.cancel().catch(() => {});
        return null;
      }
      teks += pengurai.decode(value, { stream: true });
    }
  } finally {
    pembaca.releaseLock();
  }
  return teks + pengurai.decode();
}

export async function POST(request: Request) {
  if (terlaluSering(kunciPembatas(request))) {
    return NextResponse.json(
      { pesan: "Terlalu banyak percobaan. Coba lagi sebentar lagi." },
      { status: 429 },
    );
  }

  const teks = await bacaBodyTerbatas(request, MAKS_BYTE_BODY);
  if (teks === null) {
    return NextResponse.json({ pesan: "Data skrining terlalu besar." }, { status: 413 });
  }

  let mentah: unknown;
  try {
    mentah = JSON.parse(teks);
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
  // Hanya id soal yang dikenal untuk fase ini yang ikut tersimpan.
  const jawabanBersih = saringJawaban(fase, jawaban);
  const admin = createAdminSupabase();

  // `kode` UNIQUE — coba ulang bila bentrok, jangan crash.
  for (let percobaan = 0; percobaan < 5; percobaan++) {
    const kode = buatKodeSkrining();
    const { data: baris, error } = await admin
      .from("screenings")
      .insert({
        kode,
        nama,
        no_hp,
        fase,
        jawaban: { ...jawabanBersih, dihentikan_pada: penilaian.dihentikanPada },
        hasil: penilaian.hasil,
        flags: penilaian.flags,
      })
      .select("id")
      .single<{ id: string }>();

    if (!error) {
      const jawab = NextResponse.json({ kode }, { status: 201 });

      // TOKEN KLAIM (spec J4) — hanya untuk hasil HIJAU.
      //
      // Merah tidak menerbitkan token karena tidak ada yang perlu disambungkan:
      // yang dibutuhkan orang itu adalah bicara dengan tim, bukan membuat akun.
      // Menerbitkannya juga berarti menyimpan cookie berisi kunci menuju data
      // kesehatan untuk alur yang tidak akan memakainya.
      //
      // Kegagalan menerbitkan token TIDAK PERNAH menggagalkan corong (spec §8):
      // skriningnya sudah tersimpan, kodenya sudah dipulangkan, dan yang hilang
      // hanyalah kenyamanan menyambungkan otomatis. Klien masih bisa mendaftar
      // lalu skrining ulang dari dalam Passport.
      if (penilaian.hasil === "hijau") {
        try {
          const token = await terbitkanTokenKlaim(baris!.id);
          jawab.cookies.set(COOKIE_KLAIM, token, {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: KLAIM_TTL_JAM * 3600,
          });
        } catch {
          // Sengaja ditelan — lihat alasan di atas.
        }
      }

      return jawab;
    }
    if (error.code !== "23505") {
      return NextResponse.json({ pesan: "Gagal menyimpan." }, { status: 500 });
    }
  }
  return NextResponse.json({ pesan: "Gagal menyimpan." }, { status: 500 });
}
