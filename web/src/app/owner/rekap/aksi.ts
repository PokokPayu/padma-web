"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { PESAN, periksaMitra, periksaPekan, pesanKodePostgres } from "./status";

/**
 * Jalur tulis TANDA BAYAR HONOR — satu-satunya tempat `honor_marks` lahir.
 *
 * Enam aturan yang mengikat berkas ini:
 *
 *  1. `requireRole(["owner"])` — BUKAN daftar peran gabungan milik panel
 *     operasional. Server action adalah ENDPOINT POST TERSENDIRI:
 *     `src/app/owner/layout.tsx` tidak pernah dilewati saat action dipanggil
 *     langsung. Itu bukan teori — action panel operasional sudah dibuktikan
 *     bisa di-POST dari rute lain oleh peran itu, dan mutasinya jadi.
 *
 *  2. IDENTITAS PENANDA LAHIR DARI SESI. `ditandai_oleh` diambil dari nilai
 *     kembalian penjaga peran di baris pertama, tidak pernah dari argumen —
 *     terbukti bisa dipalsukan: owner menandai honor ATAS NAMA ADMIN. Karena
 *     itu pula action ini hanya menerima DUA argumen; tidak ada tempat untuk
 *     menyelundupkan identitas maupun stempel waktu.
 *
 *  3. STEMPEL WAKTUNYA MILIK BASIS DATA. Kolomnya sengaja TIDAK ikut ditulis:
 *     nilainya jatuh ke `default now()` Postgres. Menuliskannya dari sini
 *     berarti memercayai jam proses pemanggil — dan payload bertanggal 1999
 *     sudah terbukti bisa masuk.
 *
 *  4. IDEMPOTEN, TIDAK MENIMPA. `unique (partner_id, week_start)` melempar
 *     `23505` — BUKAN no-op. Klik kedua (atau dua tab terbuka) yang dilaporkan
 *     gagal membuat pemiliknya membayar dua kali karena mengira yang pertama
 *     tidak jadi. `ignoreDuplicates` menjadikannya `ON CONFLICT DO NOTHING`,
 *     sehingga stempel pertama tetap berdiri sebagai bukti kapan honor
 *     benar-benar dibayarkan.
 *
 *  5. TULISAN YANG TERTAHAN RLS DIJAWAB 200 + `[]`, bukan error. Larik kosong
 *     di sini AMBIGU — `ON CONFLICT DO NOTHING` juga memulangkannya — jadi
 *     keberadaan barisnya dibuktikan ulang sebelum melaporkan keberhasilan.
 *
 *  6. TIDAK ADA JALUR BATAL. Hak DELETE atas `honor_marks` sudah dicabut dari
 *     peran aplikasi (owner pun dijawab 42501) dan itu keadaan yang BENAR:
 *     tanda bayar adalah bukti bahwa seorang mitra sudah menerima uangnya.
 *     Tidak ada satu pun penghapusan maupun pembaruan di berkas ini.
 *
 * Berkas `"use server"` hanya mengekspor fungsi async; kalimat dan validator
 * murni tinggal di `./status`.
 */
type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };

/**
 * Menandai honor satu mitra untuk satu pekan sebagai sudah dibayar.
 *
 * `senin` adalah Senin pekan itu — kunci bucket rekap. Basis data hari ini
 * menerima tanggal apa pun di kolom itu, jadi keseninannya ditegakkan di
 * `periksaPekan`: tanda bertanggal Rabu tidak akan pernah cocok dengan bucket
 * mana pun, dan ia tidak bisa dihapus lagi setelah terlanjur masuk.
 */
export async function tandaiHonorDibayar(
  partnerId: string,
  senin: string,
): Promise<Berhasil | Gagal> {
  const { userId } = await requireRole(["owner"]);

  const mitra = partnerId.trim();
  if (!mitra) return { ok: false, pesan: PESAN.mitraWajib };
  if (!periksaMitra(mitra)) return { ok: false, pesan: PESAN.mitraTakDikenal };

  // "Hari ini" menurut kalender JAKARTA, bukan menurut jam server (Vercel
  // berjalan UTC): di zona itu pekan berjalan bisa terbaca sebagai pekan depan
  // selama tujuh jam setiap Senin pagi.
  const pekan = periksaPekan(senin, hariIniJakarta());
  if (!pekan.ok) return { ok: false, pesan: pekan.pesan };

  const supabase = await createServerSupabase();

  // Foreign key memang menolak mitra yang tidak ada, tetapi pesannya adalah
  // kode Postgres — bukan kalimat yang boleh dibaca pemiliknya.
  const { data: adaMitra } = await supabase
    .from("partners")
    .select("id")
    .eq("id", mitra) // operator setara, tidak pernah pola
    .maybeSingle();
  if (!adaMitra) return { ok: false, pesan: PESAN.mitraTakDikenal };

  const { data, error } = await supabase
    .from("honor_marks")
    .upsert(
      { partner_id: mitra, week_start: pekan.nilai, ditandai_oleh: userId },
      { onConflict: "partner_id,week_start", ignoreDuplicates: true },
    )
    .select("id");

  if (error) return { ok: false, pesan: pesanKodePostgres(error.code) };

  if ((data ?? []).length === 0) {
    // Larik kosong punya DUA sebab yang berlawanan: tandanya sudah ada
    // (keberhasilan yang diinginkan) atau RLS menahan tulisannya (kegagalan
    // senyap). Yang membedakannya hanya keberadaan barisnya.
    const { data: sudahAda } = await supabase
      .from("honor_marks")
      .select("id")
      .eq("partner_id", mitra)
      .eq("week_start", pekan.nilai)
      .maybeSingle();
    if (!sudahAda) return { ok: false, pesan: PESAN.tidakTersimpan };
  }

  // Beranda owner membaca tanda yang sama untuk ringkasan pekan berjalan;
  // tanda yang tidak merambat ke sana adalah tanda yang belum terlihat di layar
  // pertama yang dibuka pemiliknya.
  revalidatePath("/owner/rekap");
  revalidatePath("/owner");
  return { ok: true };
}
