import { createHash, randomBytes } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { buatPadmaId } from "@/lib/admin/padma-id";
import { INVITE_TTL_DAYS, tautanAktivasi } from "@/lib/auth/pesan-undangan";
import { normalizeEmail } from "@/lib/auth/normalisasi-email";
import { rapikanNama, rapikanNoHp } from "@/lib/auth/daftar";

/**
 * PENAUTAN AKUN KLIEN — DUA JALUR SAH, KEDUANYA MENUNTUT BUKTI.
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
 * MODEL SEKARANG (spec 8 September 2026, K1/K14) — DUA jalur, bukan satu:
 *
 *  (I) TOKEN UNDANGAN + EMAIL COCOK — `linkClientByInvite`, di paruh ATAS
 *      berkas ini. Admin membuat data klien → server menerbitkan token 32 byte
 *      acak kriptografis → admin mengirim tautan aktivasi lewat pesan sambutan
 *      WhatsApp (kanal terpisah yang sudah ada di alur bisnis) → klien membuka
 *      tautan dan login. Penautan terjadi hanya bila TOKEN dan EMAIL sama-sama
 *      sepakat; tokennya berumur terbatas dan sekali pakai. Jalur ini TIDAK
 *      berubah sedikit pun oleh (II).
 *
 * (II) EMAIL YANG SUDAH TERBUKTI — `tautkanKlienLewatEmailTerverifikasi` dan
 *      `terbitkanKlienMandiri`, di paruh BAWAH berkas ini, di balik banner
 *      "JALUR KEDUA: PENDAFTARAN MANDIRI". Klien mendaftar sendiri lewat
 *      `/daftar`, GoTrue mengirim tautan konfirmasi, dan barulah sesudah
 *      `email_confirmed_at` terisi ia ditautkan ke baris klien beremail sama —
 *      atau, bila belum ada barisnya, diberi baris baru yang bertuan sejak
 *      INSERT.
 *
 * KENAPA (II) BUKAN PENGULANGAN CELAH (2) DI ATAS. Bacalah keduanya
 * berdampingan: yang dulu ditolak adalah "email COCOK", yang sekarang
 * diizinkan adalah "email cocok DAN TERBUKTI". Bedanya bukan tingkat kehati-
 * hatian melainkan fakta di dunia — sejak 28 Agustus 2026
 * `[auth.email] enable_confirmations = true`, sehingga sebuah sesi
 * terkonfirmasi membuktikan penguasaan kotak surat. Konsekuensinya dipikul
 * terbuka: setelan itu naik pangkat dari lapis kedua menjadi PENOPANG UTAMA,
 * dan mematikannya menghidupkan celah (2) utuh seperti semula. Karena itu ia
 * dijaga pagar fail-closed tersendiri (`tests/konfirmasi-email-wajib.test.ts`).
 *
 * Yang TETAP tidak ada di modul ini: fungsi yang menautkan HANYA berdasarkan
 * email (`linkClientByEmail`). Kedua fungsi jalur (II) menerima objek `User`
 * utuh dan memeriksa `email_confirmed_at` di dalam dirinya sendiri — bukan
 * string email telanjang. Selama fungsi berbentuk begitu masih ada, celahnya
 * bisa kambuh hanya dengan satu pemanggilan dari rute baru.
 *
 * URUTAN kedua jalur dipegang satu tempat, `@/lib/auth/pastikan-klien`, dan
 * urutan itulah keamanannya. Jangan menyalin aturan mana pun dari sini ke
 * halaman atau rute: duplikasi aturan keamanan di dua tempat adalah cara celah
 * (2) lahir.
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
 * `normalizeEmail` tinggal di `@/lib/auth/normalisasi-email` (berkas murni
 * tanpa impor) — bukan di sini — supaya komponen `"use client"` yang cuma
 * butuh normalisasi (mis. `form-daftar.tsx`) tidak ikut menyeret
 * `node:crypto` dan klien service role di berkas ini ke bundel browser.
 * Diekspor ulang di sini untuk pemanggil lama, pola yang sama dengan
 * `INVITE_TTL_DAYS` di atas.
 */
export { normalizeEmail };

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

/* =========================================================================
 * JALUR KEDUA: PENDAFTARAN MANDIRI (spec 8 September 2026, K1–K3)
 *
 * Semua yang di ATAS baris ini adalah jalur undangan dan TIDAK berubah sedikit
 * pun. Dua fungsi di bawah berdiri DI SAMPINGNYA, bukan menggantikannya.
 * ========================================================================= */

/**
 * Menautkan akun ke baris klien yang emailnya sama — HANYA bila email itu
 * sudah TERBUKTI milik penggunanya.
 *
 * Ini pembalikan sadar atas catatan di kepala berkas ini, dan alasannya harus
 * ikut terbaca: dulu "email cocok" ditolak karena email TIDAK PERNAH
 * dibuktikan — `enable_confirmations = false` membuat GoTrue meng-auto-confirm
 * setiap pendaftaran mandiri, sehingga menebak alamat email klien sudah cukup
 * untuk dianggap pemiliknya. Sejak 28 Agustus 2026 setelan itu menyala. Yang
 * berubah bukan pendapat, melainkan fakta.
 *
 * Konsekuensinya dipikul terbuka: konfirmasi email naik pangkat dari lapis
 * kedua menjadi PENOPANG UTAMA. Bila `enable_confirmations` di
 * `supabase/config.toml` dimatikan, celah lama hidup kembali persis seperti
 * semula — karena itu spec K7 menuntut setelan itu dijaga pagar fail-closed
 * tersendiri. Setelan yang menopang keputusan keamanan tetapi tidak dijaga
 * test adalah setelan yang suatu hari mati diam-diam.
 *
 * Catatan di kepala berkas tetap berlaku apa adanya. Yang tidak ada di sini
 * adalah fungsi yang menautkan HANYA berdasarkan email; fungsi ini menuntut
 * email DAN buktinya.
 *
 * Fungsi ini menerima objek User utuh dan memeriksa `email_confirmed_at`
 * sendiri. Ia TIDAK boleh diubah menjadi menerima string email: bentuk itu
 * adalah `linkClientByEmail` yang dulu dihapus, dan selama fungsi seperti itu
 * ada, celahnya bisa kambuh hanya dengan satu pemanggilan dari rute baru.
 * Pemeriksaan yang hidup di pemanggil terlihat setara, tetapi tidak: pemanggil
 * BERIKUTNYA belum ditulis siapa pun, dan satu-satunya cara memastikan ia ikut
 * memeriksa adalah dengan tidak memberinya pilihan.
 */
export async function tautkanKlienLewatEmailTerverifikasi(
  user: User,
): Promise<boolean> {
  // `email_confirmed_at` diperiksa DI SINI, bukan dipercayakan ke pemanggil.
  if (!user?.id || !user.email || !user.email_confirmed_at) return false;

  const emailNormal = normalizeEmail(user.email);
  if (!emailNormal) return false;

  const admin = createAdminSupabase();

  // Satu pernyataan, bukan SELECT lalu UPDATE. `is("user_id", null)` ikut di
  // dalam pernyataan tulisnya sehingga tidak ada celah antara pemeriksaan dan
  // penulisan: dua permintaan bersamaan hanya menghasilkan satu pemenang, yang
  // kalah mendapat 0 baris. Baris klien yang SUDAH tertaut karena itu tidak
  // pernah bisa direbut lewat jalur ini — sama seperti pada jalur undangan.
  //
  // `.eq()` atas email ternormalisasi, TIDAK PERNAH `.ilike()`: PostgREST
  // menerjemahkan `ilike` ke SQL LIKE, dan `%`/`_` pada email penyerang menjadi
  // wildcard (celah pertama di kepala berkas ini).
  const { data, error } = await admin
    .from("clients")
    .update({ user_id: user.id, linked_at: new Date().toISOString() })
    .eq("email", emailNormal)
    .is("user_id", null)
    .select("id");
  if (error) throw error;
  return (data ?? []).length === 1;
}

/**
 * Berapa kali nomor PADMA ID berikutnya dicoba saat dua pendaftaran mendarat
 * pada detik yang sama. Sama alasannya dengan `PERCOBAAN_ID` di
 * `src/app/admin/klien/aksi.ts`: nomor urut TIDAK datang dari sequence Postgres
 * (dilarang migration `fail_closed_sequence_fungsi`), jadi bentroknya ditolak
 * indeks unik `clients_padma_id_key` — bukan diam-diam menimpa klien lain.
 * Angkanya dinyatakan tersendiri di sini karena `aksi.ts` bertanda `"use
 * server"` dan berkas seperti itu hanya boleh mengekspor fungsi async.
 */
const PERCOBAAN_ID_MANDIRI = 5;

/**
 * Menerbitkan baris klien untuk akun yang mendaftar sendiri — sudah BERTUAN
 * sejak INSERT.
 *
 * `user_id` dan `linked_at` ikut di dalam INSERT-nya, bukan diisi UPDATE
 * sesudahnya. Bedanya bukan gaya: baris klien yang lahir menganggur, walau
 * hanya sepersekian detik, adalah baris yang bisa diperebutkan permintaan lain
 * yang kebetulan lewat pada jendela itu. Tidak ada jendela seperti itu di sini.
 *
 * Seperti `tautkanKlienLewatEmailTerverifikasi`, fungsi ini menerima User utuh
 * dan memeriksa `email_confirmed_at` sendiri. Menerbitkan baris klien untuk
 * email yang belum dibuktikan sama saja dengan memberi penebak alamat sebuah
 * rekam medis kosong yang kelak diisi PADMA atas namanya.
 *
 * `nama` dan `no_hp` datang dari `user_metadata` — data yang SEPENUHNYA
 * dikendalikan pengguna, jadi keduanya dirapikan di server dengan `rapikanNama`
 * dan `rapikanNoHp` dari `@/lib/auth/daftar`: aturan yang sama persis dengan
 * yang dipakai formulir `/daftar`, supaya nama klien tidak berbentuk beda
 * tergantung jalur mana yang menuliskannya. Efek metadata di sini hanya pada
 * baris miliknya sendiri — tidak ada hak yang bisa diraih dari sana (peran
 * selalu `klien` lewat `handle_new_user`, dan `trg_guard_profile_role` menolak
 * peran non-klien dari jalur non-service-role).
 *
 * `phase_id` sengaja NULL: fase datang dari skrining pertama yang tersambung,
 * dan menanyakannya juga saat mendaftar berarti menyimpan dua jawaban yang bisa
 * berbeda (migration `fase_klien_boleh_kosong`).
 */
export async function terbitkanKlienMandiri(user: User): Promise<boolean> {
  // Penjaga yang sama, ditulis ulang di sini dengan sengaja: gerbang memang
  // sudah memeriksanya lebih dulu, tetapi fungsi ini bisa dipanggil dari rute
  // yang belum ditulis siapa pun.
  if (!user?.id || !user.email || !user.email_confirmed_at) return false;

  const email = normalizeEmail(user.email);
  if (!email) return false;

  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  // `full_name` adalah kunci yang diisi formulir `/daftar` DAN yang dikirim
  // Google OAuth; `name` hanya cadangan untuk penyedia yang memakai nama itu.
  const namaMentah = String(metadata.full_name ?? metadata.name ?? "");
  // Cadangan terakhir: bagian sebelum `@`. Bukan menambah informasi apa pun —
  // emailnya sudah tersimpan di baris yang sama — tetapi baris klien bernama
  // kosong terbaca sebagai data rusak di panel admin, dan admin tidak punya
  // apa pun untuk mengenalinya sampai kliennya menghubungi mereka.
  const nama = rapikanNama(namaMentah) || rapikanNama(email.split("@")[0]);
  const noHp = rapikanNoHp(String(metadata.no_hp ?? ""));

  const admin = createAdminSupabase();

  for (let percobaan = 0; percobaan < PERCOBAAN_ID_MANDIRI; percobaan++) {
    const padmaId = await buatPadmaId(admin);

    const { error } = await admin.from("clients").insert({
      padma_id: padmaId,
      nama,
      email,
      no_hp: noHp,
      phase_id: null,
      user_id: user.id,
      linked_at: new Date().toISOString(),
    });

    if (!error) return true;

    if (error.code === "23505") {
      // Dibedakan lewat NAMA CONSTRAINT, bukan lewat substring pada kalimat
      // galatnya. Mencocokkan kata "email" pada `error.message` kebetulan benar
      // hari ini, tetapi kalimat itu milik Postgres dan boleh berubah
      // antarversi — sementara nama constraint milik skema kita sendiri dan
      // berubah hanya lewat migration. `details` ikut dibaca karena di sanalah
      // PostgREST menaruh kolom yang bentrok.
      //
      // Tabel ini punya TIGA sumber 23505, dan hanya satu yang boleh diulang:
      //
      //  - `clients_padma_id_key`: nomornya direbut permintaan lain pada detik
      //    yang sama (nomor urut tidak datang dari sequence — lihat
      //    `PERCOBAAN_ID_MANDIRI`) → coba nomor berikutnya.
      //  - `clients_email_key`: ADA YANG MENDAHULUI. Baris klien beremail ini
      //    sudah ada — entah baru lahir dari permintaan kembar, entah dibuat
      //    admin sedetik lalu.
      //  - `clients_user_id_unik` (indeks unik, migration 20260829130000):
      //    user ini SUDAH punya baris klien — permintaan kembarnya menang
      //    sepersekian detik lalu.
      //
      // Dua yang terakhir sama-sama berarti "keadaannya sudah berubah sejak
      // langkah 1", dan jawabannya bukan mengulang di sini melainkan menyerah
      // supaya PEMANGGIL menilai ulang dari langkah 1. Menautkan atau mengulang
      // dari sini akan melewati pemeriksaan yang ada di sana.
      const bentrok = `${error.message} ${error.details ?? ""}`;
      if (bentrok.includes("clients_padma_id_key")) continue;
      return false;
    }

    // Sisanya (mis. 23503 fase tidak dikenal) dilempar: jalur ini berjalan di
    // server tanpa formulir untuk menampilkan pesan, dan kegagalan tak terduga
    // yang ditelan diam-diam akan terbaca sebagai "akun belum terhubung" —
    // gejala yang sama persis dengan kegagalan yang memang wajar, sehingga
    // bug sungguhan tidak pernah terlihat.
    throw error;
  }

  return false;
}
