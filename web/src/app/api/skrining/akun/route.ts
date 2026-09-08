import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { nilaiSkrining } from "@/lib/skrining/evaluasi";
import { saringJawaban } from "@/lib/skrining/bank-soal";
import { buatKodeSkrining } from "@/lib/skrining/kode";
import { SkemaSkriningPublik } from "@/lib/skrining/skema";
import { terlaluSeringKlien } from "@/lib/skrining/pembatas";

/**
 * SKRINING DARI DALAM PASSPORT (spec C1 J6).
 *
 * Ada karena siapa pun yang mendaftar lewat `/daftar` tanpa pernah melewati
 * corong landing akan terkunci dari pemesanan: `guard_booking_skrining`
 * menuntut skrining hijau miliknya, dan ia belum punya satu pun.
 *
 * ===== KENAPA RUTE, BUKAN POLICY INSERT UNTUK KLIEN =====
 * Klien sengaja TIDAK diberi hak menulis `screenings`. `hasil`, `flags`, dan
 * `kode` seluruhnya ditentukan SERVER dari jawaban mentah; bila peramban boleh
 * mengirimnya, seluruh gerbang skrining runtuh menjadi satu baris JSON —
 * seseorang cukup menyisipkan skrining 'hijau' untuk dirinya sendiri lalu
 * memesan. Karena itu rute ini menulis dengan service role, sama seperti rute
 * publik, dan `client_id` diambil dari SESI — tidak pernah dari body.
 *
 * ===== PEMBATAS =====
 * Ember terpisah berkunci `client_id`, bukan ember anonim: langit-langit global
 * 30/menit milik corong publik akan menjadi batas seluruh klinik begitu
 * skrining menjadi langkah wajib setiap pemesanan. Lihat dokblok di
 * `lib/skrining/pembatas.ts`.
 */
const MAKS_BYTE_BODY = 16 * 1024;

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ pesan: "Silakan masuk dulu." }, { status: 401 });
  }

  // Identitas klien diturunkan dari SESI. Body tidak pernah menyebut siapa.
  const { data: klien } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle<{ id: string }>();
  if (!klien) {
    return NextResponse.json({ pesan: "Akun belum terhubung." }, { status: 403 });
  }

  if (terlaluSeringKlien(klien.id)) {
    return NextResponse.json(
      { pesan: "Terlalu banyak percobaan. Coba lagi sebentar lagi." },
      { status: 429 },
    );
  }

  const teks = await request.text();
  if (new TextEncoder().encode(teks).byteLength > MAKS_BYTE_BODY) {
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
  const jawabanBersih = saringJawaban(fase, jawaban);
  const admin = createAdminSupabase();

  for (let percobaan = 0; percobaan < 5; percobaan++) {
    const kode = buatKodeSkrining();
    const { error } = await admin.from("screenings").insert({
      kode,
      nama,
      no_hp,
      fase,
      jawaban: { ...jawabanBersih, dihentikan_pada: penilaian.dihentikanPada },
      hasil: penilaian.hasil,
      flags: penilaian.flags,
      // Terisi SEJAK AWAL — tidak ada token klaim di jalur ini, karena tidak
      // ada yang perlu disambungkan belakangan.
      client_id: klien.id,
    });
    if (!error) {
      return NextResponse.json({ kode, hasil: penilaian.hasil }, { status: 201 });
    }
    if (error.code !== "23505") {
      return NextResponse.json({ pesan: "Gagal menyimpan." }, { status: 500 });
    }
  }
  return NextResponse.json({ pesan: "Gagal menyimpan." }, { status: 500 });
}
