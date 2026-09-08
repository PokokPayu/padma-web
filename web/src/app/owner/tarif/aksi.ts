"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { PESAN, periksaHargaCoret, periksaNominal, periksaTanggal, pesanKodePostgres } from "./status";

/**
 * Jalur tulis RATE CARD — satu-satunya tempat harga klien & honor mitra lahir.
 *
 * Lima aturan yang mengikat berkas ini:
 *
 *  1. `requireRole(["owner"])` — BUKAN daftar peran gabungan milik panel
 *     operasional. Server action adalah ENDPOINT POST TERSENDIRI:
 *     `src/app/owner/layout.tsx` tidak pernah dilewati saat action dipanggil
 *     langsung. Itu bukan teori — action panel operasional sudah dibuktikan
 *     bisa di-POST dari rute lain oleh peran itu, dan mutasinya jadi. Satu kata
 *     kelebihan di daftar peran menyerahkan penetapan harga PADMA kepada staf
 *     operasional.
 *
 *  2. INSERT-ONLY. Tarif lama TIDAK PERNAH diubah (spec bagian 5: "Edit rate
 *     card = insert baris baru, tidak update baris lama"). Rekap honor membaca
 *     tarif yang berlaku PADA TANGGAL SESI, jadi menimpa baris lama menggeser
 *     rekap pekan yang honornya sudah dibayarkan — retroaktif, tanpa satu pun
 *     error. Tidak ada satu pun pembaruan maupun penghapusan baris di berkas ini.
 *
 *  3. TANGGAL BERLAKU TIDAK BOLEH MUNDUR. Insert-only saja tidak cukup:
 *     menyisipkan baris ber-`berlaku_sejak` 2020 berefek PERSIS sama dengan
 *     menimpa baris lama. Ditolak di sini supaya jawabannya berupa KALIMAT.
 *
 *  4. INSERT yang tertahan RLS dijawab PostgREST 200 + `[]`, bukan error.
 *     Melaporkan "berhasil" tanpa memeriksa panjang `.select("id")` adalah
 *     kebohongan senyap — dan di modul ini kebohongan itu tentang uang.
 *
 *  5. Sesi pengguna, bukan service role. Di bawah service role `user_role()`
 *     mengembalikan 'klien' dan policy `"variant_rates: hanya owner"` tidak
 *     pernah ikut diperiksa — tulisannya tetap berhasil, untuk siapa pun yang
 *     memanggil.
 *
 * Berkas `"use server"` hanya mengekspor fungsi async; kalimat, batas, dan
 * validator murni tinggal di `./status`.
 */
type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };

type BarisTarif = { berlaku_sejak: string };

/**
 * Menetapkan tarif baru untuk satu VARIAN.
 *
 * Kanal yang ikut disegarkan bukan hiasan: rekap honor dan beranda owner
 * membaca tabel yang sama, dan tarif yang tidak merambat ke sana adalah tarif
 * yang belum berlaku bagi satu-satunya layar yang membayarkan honor.
 */
export async function tetapkanTarif(formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["owner"]);

  const variantId = String(formData.get("varian") ?? "").trim();
  const harga = periksaNominal(String(formData.get("harga") ?? ""), "Harga klien");
  const honor = periksaNominal(String(formData.get("honor") ?? ""), "Honor mitra");
  // Medan tanggal kosong berarti "berlaku mulai hari ini" — hari ini menurut
  // kalender JAKARTA, bukan menurut jam server (Vercel berjalan UTC).
  const mentahMulai = String(formData.get("mulai") ?? "").trim();
  const mulai = periksaTanggal(mentahMulai || hariIniJakarta());

  if (!variantId) return { ok: false, pesan: PESAN.varianWajib };
  if (!harga.ok) return { ok: false, pesan: harga.pesan };
  if (!honor.ok) return { ok: false, pesan: honor.pesan };
  if (!mulai.ok) return { ok: false, pesan: mulai.pesan };
  // Honor melebihi harga berarti margin negatif: PADMA membayar mitra lebih
  // banyak daripada yang diterimanya dari klien. Rekap menampilkannya sebagai
  // angka mustahil tanpa satu pun peringatan.
  if (honor.nilai > harga.nilai) return { ok: false, pesan: PESAN.honorMelebihiHarga };

  // Dibaca SESUDAH harga tervalidasi: batasnya relatif terhadap harga klien.
  const coret = periksaHargaCoret(String(formData.get("harga_coret") ?? ""), harga.nilai);
  if (!coret.ok) return { ok: false, pesan: coret.pesan };

  const supabase = await createServerSupabase();

  // Foreign key memang menolak `variant_id` yang tidak ada, tetapi pesannya
  // adalah kode Postgres — bukan kalimat yang boleh dibaca pemiliknya.
  // Nilai bukan-UUID pun mendarat di sini: PostgREST menjawabnya 22P02, dan
  // `data` tetap null.
  const { data: varian } = await supabase
    .from("service_variants")
    .select("id")
    .eq("id", variantId) // operator setara, tidak pernah pola
    .maybeSingle();
  if (!varian) return { ok: false, pesan: PESAN.varianTakDikenal };

  // Riwayat tarif varian ini, dibaca lewat RLS owner. Perbandingan tanggal =
  // perbandingan STRING; keduanya YYYY-MM-DD sehingga urutan leksikografisnya
  // sudah kronologis, dan tidak ada satu pun objek Date yang bisa menggesernya.
  const { data: riwayat } = await supabase
    .from("variant_rates")
    .select("berlaku_sejak")
    .eq("variant_id", variantId)
    .returns<BarisTarif[]>();

  const tanggalTerpakai = (riwayat ?? []).map((r) => r.berlaku_sejak);
  if (tanggalTerpakai.includes(mulai.nilai)) {
    return { ok: false, pesan: PESAN.kembar };
  }
  const terakhir = tanggalTerpakai.reduce<string | null>(
    (maks, t) => (maks === null || t > maks ? t : maks),
    null,
  );
  if (terakhir !== null && mulai.nilai < terakhir) {
    return { ok: false, pesan: `${PESAN.mundur} (${terakhir}).` };
  }

  // BARIS BARU, selalu. Tarif lama tetap berdiri sebagai bukti berapa honor
  // yang seharusnya dibayarkan pada pekan-pekan yang sudah lewat.
  const { data, error } = await supabase
    .from("variant_rates")
    .insert({
      variant_id: variantId,
      harga_klien: harga.nilai,
      harga_coret: coret.nilai,
      honor_mitra: honor.nilai,
      berlaku_sejak: mulai.nilai,
    })
    .select("id");

  if (error) return { ok: false, pesan: pesanKodePostgres(error.code) };
  // 200 + [] berarti RLS menahan barisnya tanpa melempar error apa pun.
  if ((data ?? []).length === 0) return { ok: false, pesan: PESAN.tidakTersimpan };

  revalidatePath("/owner/tarif");
  revalidatePath(`/owner/tarif/${variantId}`);
  revalidatePath("/owner/rekap");
  revalidatePath("/owner");
  return { ok: true };
}
