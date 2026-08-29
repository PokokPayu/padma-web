import { createHash, randomBytes } from "node:crypto";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { INVITE_TTL_DAYS, tautanAktivasi } from "@/lib/auth/pesan-undangan";

/**
 * PENAUTAN AKUN KLIEN — WAJIB TOKEN UNDANGAN SEKALI-PAKAI.
 *
 * Riwayat celah (dua kali, akar berbeda):
 *
 *  (1) `.ilike("email", …)` → PostgREST menerjemahkannya ke SQL LIKE, sehingga
 *      `%`/`_` pada email penyerang menjadi wildcard. Ditutup dengan `.eq()`
 *      atas email ternormalisasi (migration 20260828114500).
 *
 *  (2) Pencocokan email PERSIS pun tidak cukup. Seluruh model bersandar pada
 *      asumsi bahwa email yang dipakai login benar-benar milik orang itu.
 *      Asumsi itu salah: `[auth.email] enable_confirmations = false` membuat
 *      GoTrue meng-auto-confirm pendaftaran mandiri tanpa bukti kepemilikan,
 *      jadi penyerang cukup MENEBAK email klien (mis. `rina@padma.test`) untuk
 *      merebut rekamnya — terbukti sampai terbacanya catatan medis lewat RLS
 *      `clients.user_id = auth.uid()`. Menebak alamat email bukan otentikasi.
 *
 * Model sekarang: admin membuat data klien → server menerbitkan TOKEN UNDANGAN
 * (32 byte acak kriptografis) → admin mengirim tautan aktivasi lewat pesan
 * sambutan WhatsApp (kanal terpisah yang sudah ada di alur bisnis) → klien
 * membuka tautan, login, dan penautan terjadi hanya bila TOKEN dan EMAIL
 * sama-sama sepakat. Token berumur terbatas dan sekali pakai.
 *
 * Yang TIDAK ada lagi di modul ini: fungsi yang menautkan hanya berdasarkan
 * email (`linkClientByEmail`). Selama fungsi seperti itu masih ada, celahnya
 * bisa kambuh hanya dengan satu pemanggilan dari rute baru.
 */

/**
 * Masa berlaku default token undangan. Nilainya tinggal di
 * `@/lib/auth/pesan-undangan` (berkas murni tanpa impor) supaya kalimat "berlaku
 * N hari" pada pesan WhatsApp — yang disusun komponen sisi klien — memakai angka
 * yang sama persis dengan `expires_at` di sini. Diekspor ulang untuk pemanggil
 * yang sudah ada.
 */
export { INVITE_TTL_DAYS };

/** Nama cookie httpOnly tempat token dititipkan antara /aktivasi dan login. */
export const COOKIE_UNDANGAN = "padma_undangan";

/**
 * Email dinormalkan (trim + huruf kecil) sebelum dipakai membandingkan.
 * DB menyimpan clients.email dalam bentuk yang sama (trigger
 * `clients_normalize_email` + constraint `clients_email_lowercase`, migration
 * 20260828114500), jadi `email = normalizeEmail(input)` setara dengan
 * `lower(email) = lower(input)` — tetap buta kapitalisasi, tapi PERSIS.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Token undangan: 32 byte dari CSPRNG sistem, dikodekan base64url supaya aman
 * dipakai di URL tanpa escaping. Ruang tebakan 2^256 — tidak bisa dibrute-force
 * dan tidak bisa diturunkan dari data klien mana pun.
 */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Yang disimpan DB adalah SHA-256 token, bukan tokennya. Token asli hanya ada
 * satu kali: pada nilai balik `createClientInvite` (untuk dikirim admin).
 * Konsekuensinya dump/backup DB yang bocor tidak berisi kunci siap pakai.
 * Hash biasa (tanpa KDF) memadai karena tokennya sendiri sudah 256 bit acak —
 * tidak ada entropi rendah yang perlu diperlambat seperti pada kata sandi.
 */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

/**
 * Tautan aktivasi siap-tempel ke pesan sambutan WhatsApp.
 * Bentuknya dipegang satu tempat (`pesan-undangan.ts`) karena komponen sisi
 * klien menyusun tautan yang sama tanpa boleh mengimpor berkas ini.
 */
export function inviteLink(origin: string, token: string): string {
  return tautanAktivasi(origin, token);
}

export type OpsiUndangan = {
  /** Token yang sudah ditentukan (dipakai seed dev & test). */
  token?: string;
  ttlDays?: number;
  expiresAt?: Date;
  /**
   * Menerbitkan undangan WALAU baris kliennya sudah tertaut.
   *
   * HANYA untuk seed dev dan fixture test yang perlu memegang token sah milik
   * baris tertaut (mis. membuktikan bahwa `linkClientByInvite` tetap menolak
   * perebutan meski tokennya benar). TIDAK PERNAH diteruskan dari panel admin:
   * begitu ia bisa dicapai dari sana, penjaga di bawah tinggal satu parameter
   * untuk dilewati.
   */
  paksa?: boolean;
};

export type HasilUndangan =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; alasan: "klien-tidak-ditemukan" | "sudah-tertaut" };

/**
 * Menerbitkan (atau menerbitkan ulang) undangan untuk satu baris klien.
 * Dipanggil dari server saat admin membuat/mengundang klien. Satu klien punya
 * paling banyak satu undangan hidup: menerbitkan ulang membatalkan yang lama
 * (upsert pada primary key `client_id`).
 *
 * PENJAGA "SUDAH TERTAUT". Upsert di bawah mengosongkan `used_at`/`used_by` —
 * dan itulah satu-satunya catatan tentang siapa menukarkan undangan sebuah akun
 * dan kapan. Sebelum penjaga ini ada, satu klik "kirim ulang undangan" pada
 * klien yang sudah aktif menghapus jejak itu tanpa jejak lain: persis bukti yang
 * dibutuhkan saat kepemilikan sebuah akun dipersengketakan. Penautan ulangnya
 * sendiri memang sudah ditolak `linkClientByInvite` (baris tertaut tidak bisa
 * direbut), jadi undangan baru itu tidak pernah berguna — ia hanya merusak.
 */
export async function createClientInvite(
  clientId: string,
  opsi: OpsiUndangan = {},
): Promise<HasilUndangan> {
  const token = opsi.token ?? generateInviteToken();
  const expiresAt =
    opsi.expiresAt ??
    new Date(Date.now() + (opsi.ttlDays ?? INVITE_TTL_DAYS) * 86_400_000);

  const admin = createAdminSupabase();

  const { data: klien, error: klienErr } = await admin
    .from("clients")
    .select("id, user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (klienErr) throw klienErr;
  if (!klien) return { ok: false, alasan: "klien-tidak-ditemukan" };
  if (klien.user_id && !opsi.paksa) return { ok: false, alasan: "sudah-tertaut" };

  const { error } = await admin.from("client_invites").upsert(
    {
      client_id: clientId,
      token_hash: hashInviteToken(token),
      expires_at: expiresAt.toISOString(),
      used_at: null,
      used_by: null,
    },
    { onConflict: "client_id" },
  );
  if (error) throw error;
  return { ok: true, token, expiresAt };
}

/**
 * Menautkan auth user ke baris klien — HANYA dengan token undangan yang sah.
 *
 * Penautan terjadi bila SEMUA syarat ini terpenuhi:
 *   - tokennya ada di `client_invites` (dicari lewat SHA-256-nya),
 *   - belum kedaluwarsa,
 *   - belum dipakai,
 *   - baris kliennya belum tertaut,
 *   - email user yang login cocok PERSIS (setelah normalisasi) dengan email
 *     klien pada baris token itu.
 *
 * Gagal di syarat mana pun mengembalikan `false` yang sama — pemanggil (dan
 * karenanya penyerang) tidak bisa membedakan "token tidak ada", "kedaluwarsa",
 * "sudah dipakai", atau "email tidak cocok".
 *
 * Memakai service role karena klien tidak punya (dan tidak boleh punya) hak
 * tulis pada `clients` maupun hak apa pun pada `client_invites`.
 */
export async function linkClientByInvite(
  userId: string,
  email: string,
  token: string,
): Promise<boolean> {
  const emailNormal = normalizeEmail(email ?? "");
  const tokenNormal = (token ?? "").trim();
  if (!userId || !emailNormal || !tokenNormal) return false;

  const admin = createAdminSupabase();
  const hash = hashInviteToken(tokenNormal);

  const { data: undangan, error } = await admin
    .from("client_invites")
    .select("client_id, expires_at, used_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error) throw error;
  if (!undangan) return false;
  if (undangan.used_at) return false;
  if (new Date(undangan.expires_at).getTime() <= Date.now()) return false;

  const { data: klien, error: klienErr } = await admin
    .from("clients")
    .select("id, email, user_id")
    .eq("id", undangan.client_id)
    .maybeSingle();
  if (klienErr) throw klienErr;
  if (!klien) return false;
  if (klien.user_id) return false; // sudah tertaut → tidak bisa direbut
  if (normalizeEmail(klien.email) !== emailNormal) return false;

  // KLAIM ATOMIK — satu-satunya pintu "sekali pakai". Filter `used_at is null`
  // membuat dua permintaan bersamaan hanya menghasilkan satu pemenang; yang
  // kalah mendapat 0 baris. `token_hash` dikosongkan sehingga token yang sama
  // tidak bisa dicocokkan lagi, sementara barisnya tetap ada sebagai audit
  // (kapan & oleh siapa dipakai).
  const { data: klaim, error: klaimErr } = await admin
    .from("client_invites")
    .update({
      token_hash: null,
      used_at: new Date().toISOString(),
      used_by: userId,
    })
    .eq("token_hash", hash)
    .is("used_at", null)
    .select("client_id");
  if (klaimErr) throw klaimErr;
  if ((klaim ?? []).length !== 1) return false;

  // `is("user_id", null)` mengulang syarat "belum tertaut" di dalam UPDATE
  // supaya tidak ada celah antara pemeriksaan dan penulisan. Bila kalah balapan
  // di sini, token sudah hangus dan penautan gagal — admin cukup menerbitkan
  // undangan baru. Lebih baik gagal tertutup daripada dua akun berebut satu
  // rekam medis.
  const { data: tertaut, error: tautErr } = await admin
    .from("clients")
    .update({ user_id: userId, linked_at: new Date().toISOString() })
    .eq("id", klien.id)
    .is("user_id", null)
    .select("id");
  if (tautErr) throw tautErr;
  return (tertaut ?? []).length === 1;
}

/**
 * Apakah user ini sudah tertaut ke sebuah baris klien?
 *
 * Dipakai rute /setelah-masuk untuk login KEDUA dan seterusnya, ketika tidak
 * ada lagi token yang dibawa. Sengaja dicari lewat `user_id` — identitas yang
 * sudah dibuktikan token pada aktivasi — BUKAN lewat email. Mencari lewat email
 * di sini akan menghidupkan kembali celah yang sedang ditutup.
 */
export async function isClientLinked(userId: string): Promise<boolean> {
  if (!userId) return false;
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("clients")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}
