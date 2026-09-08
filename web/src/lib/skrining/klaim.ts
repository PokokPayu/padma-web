import { createHash, randomBytes } from "node:crypto";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * PENYAMBUNG SKRINING ANONIM KE AKUN (spec C1 J4).
 *
 * Skrining di landing diisi anonim — nama + no. HP, tanpa email. Akun berdiri
 * di atas email. Sesuatu harus menghubungkan keduanya, dan pilihan yang SALAH
 * di sini berbentuk jawaban kesehatan orang lain muncul di Passport seseorang.
 *
 * ===== KENAPA BUKAN KODENYA =====
 * `src/lib/skrining/kode.ts` sengaja membuat kode yang mudah dibacakan lewat
 * telepon: prefiks semenit + sufiks 4 karakter, sekitar satu juta kemungkinan
 * per menit. Itu tiket layanan pelanggan, dan memang harus mudah dieja. Yang
 * mudah dieja juga mudah ditebak — dan menjadikannya kunci berarti seseorang
 * bisa menebak kode orang lain lalu menyedot jawaban kesehatannya ke akunnya
 * sendiri.
 *
 * Yang dipakai: token 32 byte dari CSPRNG, hash SHA-256-nya yang disimpan,
 * tokennya dititipkan di cookie `httpOnly`. Pola yang sama persis dengan token
 * undangan (`lib/auth/link-client.ts`), termasuk sekali-pakai dan klaim atomik.
 *
 * ===== KENAPA UMURNYA HANYA 2 JAM =====
 * Bukan soal kriptografi — 32 byte acak tidak menjadi lebih lemah seiring
 * waktu. Ini soal PERANGKAT BERSAMA: satu HP di ruang tunggu klinik. Tanpa
 * batas umur, orang kedua yang mendaftar di HP itu mewarisi skrining orang
 * pertama lengkap dengan jawaban kesehatannya, dan tidak ada satu pun tanda
 * bahwa itu terjadi.
 *
 * Lapis kedua untuk bahaya yang sama, dan yang tidak bergantung pada waktu:
 * `klaimSkrining()` memulangkan NAMA pada skrining itu supaya Passport bisa
 * menyebutkannya terbuka ("Skrining atas nama X telah disambungkan"). Salah
 * sambung menjadi terlihat, bukan tersembunyi.
 */

/** Umur token klaim. Lihat dokblok di atas — ini keputusan produk, bukan angka acak. */
export const KLAIM_TTL_JAM = 2;

/** Nama cookie `httpOnly` tempat token dititipkan sampai akun berdiri. */
export const COOKIE_KLAIM = "padma_klaim_skrining";

export function buatTokenKlaim(): string {
  return randomBytes(32).toString("base64url");
}

export function hashTokenKlaim(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Menerbitkan token klaim untuk satu skrining yang BARU tersimpan.
 *
 * Memulangkan tokennya SEKALI — sesudah ini yang ada di basis data hanya
 * hash-nya, dan tidak ada cara memulihkan token dari sana.
 */
export async function terbitkanTokenKlaim(screeningId: string): Promise<string> {
  const token = buatTokenKlaim();
  const admin = createAdminSupabase();

  const { error } = await admin.from("screening_claims").insert({
    screening_id: screeningId,
    token_hash: hashTokenKlaim(token),
    expires_at: new Date(Date.now() + KLAIM_TTL_JAM * 3_600_000).toISOString(),
  });
  if (error) throw error;

  return token;
}

export type HasilKlaim =
  | { ok: true; screeningId: string; nama: string; fase: string | null }
  | { ok: false };

/**
 * Menyambungkan skrining anonim ke satu klien, sekali pakai dan atomik.
 *
 * Yang berpindah HANYA `client_id`, dan `phase_id` klien bila masih kosong
 * (spec J11). Nama dan no. HP pada skrining sengaja TIDAK menimpa data akun:
 * keduanya diisi anonim di landing dan bisa saja ditulis orang lain — suami
 * yang mengisikan untuk istrinya, atau resepsionis yang membantu. Menimpakannya
 * ke akun berarti membiarkan corong publik menulis ulang identitas seseorang.
 *
 * TIDAK PERNAH melempar untuk token yang salah/kedaluwarsa/terpakai — ia
 * memulangkan `{ ok: false }`. Pemanggilnya adalah jalur pendaftaran, dan
 * pendaftaran tidak boleh gagal hanya karena cookie basi.
 */
export async function klaimSkrining(token: string, clientId: string): Promise<HasilKlaim> {
  const bersih = (token ?? "").trim();
  if (!bersih || !clientId) return { ok: false };

  const admin = createAdminSupabase();
  const hash = hashTokenKlaim(bersih);

  // KLAIM ATOMIK — satu-satunya pintu "sekali pakai". Filter `used_at is null`
  // membuat dua permintaan bersamaan hanya menghasilkan satu pemenang; yang
  // kalah mendapat 0 baris. `token_hash` dikosongkan sehingga token yang sama
  // tidak bisa dicocokkan lagi, sementara barisnya tetap ada sebagai jejak.
  //
  // Kedaluwarsa ikut dalam filter KLAIM, bukan diperiksa lebih dulu lalu
  // ditulis: memeriksanya terpisah membuka jendela di antara keduanya.
  const { data: klaim, error } = await admin
    .from("screening_claims")
    .update({ token_hash: null, used_at: new Date().toISOString() })
    .eq("token_hash", hash)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("screening_id");

  if (error || (klaim ?? []).length === 0) return { ok: false };
  const screeningId = klaim![0].screening_id as string;

  // Skrining yang SUDAH bertuan tidak bisa direbut. Tokennya sudah terpakai di
  // atas, jadi keadaan ini hanya bisa lahir dari data yang dikarang tangan —
  // tetapi memeriksanya murah, dan akibat melewatkannya adalah data kesehatan
  // berpindah pemilik.
  const { data: skrining } = await admin
    .from("screenings")
    .select("id, nama, fase, client_id")
    .eq("id", screeningId)
    .maybeSingle<{ id: string; nama: string; fase: string; client_id: string | null }>();

  if (!skrining || skrining.client_id) return { ok: false };

  const { error: eSambung } = await admin
    .from("screenings")
    .update({ client_id: clientId })
    .eq("id", screeningId)
    .is("client_id", null);
  if (eSambung) return { ok: false };

  // FASE (spec J11) — hanya bila masih kosong. Keempat fase pada skrining
  // (`prekonsepsi`, `kehamilan`, `nifas`, `menopause`) memang id `phases` yang
  // sah; `newborn` sengaja tidak diskrining karena yang diskrining ibunya.
  // `is("phase_id", null)` bukan sekadar syarat: ia yang menjamin skrining
  // KEDUA tidak menggeser fase yang sudah ditetapkan admin.
  const { data: faseTerisi } = await admin
    .from("clients")
    .update({ phase_id: skrining.fase })
    .eq("id", clientId)
    .is("phase_id", null)
    .select("id");

  return {
    ok: true,
    screeningId,
    nama: skrining.nama,
    fase: (faseTerisi ?? []).length > 0 ? skrining.fase : null,
  };
}
