"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { buatPadmaId } from "@/lib/admin/padma-id";
import { createClientInvite, normalizeEmail } from "@/lib/auth/link-client";
import { geocodeAlamat } from "@/lib/transport/geocode";
import { koordinatDariFormData } from "@/lib/transport/koordinat-form";
import { bersihkanAlamat } from "./status";

/**
 * Jalur tulis panel admin untuk data klien.
 *
 * Tiga aturan yang mengikat berkas ini:
 *
 *  1. Server action adalah ENDPOINT POST TERSENDIRI. Penjaga di
 *     `src/app/admin/layout.tsx` tidak pernah dilewati saat action dipanggil
 *     langsung, jadi `requireRole(["admin","owner"])` ditulis DI DALAM setiap
 *     action — bukan sekali di puncak modul.
 *
 *  2. Sesi pengguna, bukan service role. Di bawah service role `user_role()`
 *     mengembalikan 'klien' dan `auth.uid()` NULL: policy `clients: staf`
 *     tidak pernah ikut diperiksa dan trigger penjaga tidak menyala. Yang
 *     mengizinkan tulis di sini adalah RLS staf, dan itu memang yang diuji.
 *
 *  3. Kolom penautan akun tidak pernah disentuh dari sini. Baris klien selalu
 *     lahir belum tertaut; yang berhak menautkannya hanyalah server lewat
 *     token undangan sekali pakai (lihat `@/lib/auth/link-client`). Trigger
 *     `guard_client_link` menolak peran API — admin & owner sekalipun.
 *
 * Berkas `"use server"` hanya boleh mengekspor fungsi async. Konstanta apa pun
 * yang perlu dibagi ke UI wajib tinggal di modul lain.
 */
type Gagal = { ok: false; pesan: string };
type Dibuat = { ok: true; id: string; padmaId: string };
type Diperbarui = { ok: true };
type Diterbitkan = { ok: true; token: string; nama: string; email: string };

// Rupa email diperiksa apa adanya — kepemilikan alamatnya dibuktikan kemudian
// oleh token undangan, bukan oleh regex ini.
const POLA_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Berapa kali nomor PADMA ID berikutnya dicoba saat dua admin menekan "simpan"
// pada detik yang sama. Bentroknya ditolak indeks unik `clients_padma_id_key`
// (23505) — bukan diam-diam menimpa klien lain.
const PERCOBAAN_ID = 5;

export async function buatKlien(formData: FormData): Promise<Dibuat | Gagal> {
  await requireRole(["admin", "owner"]);

  const nama = String(formData.get("nama") ?? "").trim();
  const alamatSurel = normalizeEmail(String(formData.get("email") ?? ""));
  const noHp = String(formData.get("no_hp") ?? "").trim();
  const faseId = String(formData.get("fase") ?? "").trim();
  const alamat = bersihkanAlamat(String(formData.get("alamat") ?? ""));

  if (nama.length < 2) return { ok: false, pesan: "Nama terlalu pendek." };
  if (!POLA_EMAIL.test(alamatSurel)) {
    return { ok: false, pesan: "Alamat email tidak sah." };
  }
  if (!faseId) return { ok: false, pesan: "Fase wajib dipilih." };

  const supabase = await createServerSupabase();

  // Geocoding TIDAK PERNAH menggagalkan penyimpanan klien (spec T6).
  // `geocodeAlamat` sudah menelan setiap galatnya dan memulangkan null; alamat
  // profil klien pun BOLEH kosong (terisi menyusul) — alamat kosong memulangkan
  // null lebih awal di dalam `geocodeAlamat` sendiri, tanpa perlu dicabang di sini.
  // PIN MENANG. Bila admin sudah menjatuhkan titik di peta, koordinat itu yang
  // dipakai dan Nominatim TIDAK ditanyai sama sekali — menanyakan alamat yang
  // jawabannya sudah pasti dibuang hanya membakar kuota gratis milik pihak
  // lain, dan pada volume nyata itulah yang memicu pemblokiran.
  //
  // Tanpa pin, jalur lama berlaku utuh: geocoding boleh gagal, dan kegagalannya
  // tidak pernah menggagalkan penyimpanan alamat (Ruling 9).
  const pin = koordinatDariFormData(formData);
  const koordinat = pin ?? (await geocodeAlamat(alamat));

  for (let percobaan = 0; percobaan < PERCOBAAN_ID; percobaan++) {
    const padmaId = await buatPadmaId(supabase);

    const { data, error } = await supabase
      .from("clients")
      .insert({
        padma_id: padmaId,
        nama,
        email: alamatSurel,
        no_hp: noHp,
        phase_id: faseId,
        alamat,
        alamat_lat: koordinat?.lat ?? null,
        alamat_lon: koordinat?.lon ?? null,
      })
      .select("id")
      .single();

    if (!error && data) {
      revalidatePath("/admin/klien");
      return { ok: true, id: data.id as string, padmaId };
    }

    if (error?.code === "23505") {
      // Dua sumber bentrok yang sangat berbeda artinya: alamat surel yang
      // sudah terpakai (kesalahan manusia — beri kalimat) versus nomor PADMA
      // yang direbut admin lain pada detik yang sama (coba nomor berikutnya).
      if (error.message.includes("email")) {
        return { ok: false, pesan: "Alamat itu sudah dipakai klien lain." };
      }
      continue;
    }

    // 23503 (fase tidak dikenal), 42501 (peran ditolak RLS), dan sisanya:
    // pesan generik — detail Postgres tidak pernah dilemparkan ke layar.
    return { ok: false, pesan: "Gagal menyimpan klien." };
  }

  return { ok: false, pesan: "Nomor PADMA ID sedang berebut. Coba simpan lagi." };
}

export async function perbaruiKlien(
  id: string,
  formData: FormData,
): Promise<Diperbarui | Gagal> {
  await requireRole(["admin", "owner"]);

  const nama = String(formData.get("nama") ?? "").trim();
  const noHp = String(formData.get("no_hp") ?? "").trim();
  const faseId = String(formData.get("fase") ?? "").trim();
  const alamat = bersihkanAlamat(String(formData.get("alamat") ?? ""));

  if (nama.length < 2) return { ok: false, pesan: "Nama terlalu pendek." };
  // Fase BOLEH kosong di sini — dan hanya di sini, bukan di `buatKlien`.
  // Klien yang mendaftar sendiri tiba dengan `phase_id` NULL karena fasenya
  // datang dari skrining, bukan dari pendaftaran (migration
  // `fase_klien_boleh_kosong`). Menolak simpanan hanya karena medan itu kosong
  // akan memaksa admin MENEBAK fase seseorang supaya bisa membetulkan
  // alamatnya — tepat kesalahan yang penjaga ini seharusnya cegah.
  // "" menjadi NULL, bukan string kosong: `phase_id` menunjuk `phases(id)`.
  const faseBaru = faseId === "" ? null : faseId;

  const supabase = await createServerSupabase();

  // Geocoding TIDAK PERNAH menggagalkan penyimpanan (spec T6) — lihat `buatKlien`.
  // PIN MENANG — lihat alasan lengkapnya di buatKlien.
  const pin = koordinatDariFormData(formData);
  const koordinat = pin ?? (await geocodeAlamat(alamat));

  // Hanya kolom operasional yang pernah menyentuh basis data. Medan lain yang
  // ikut dikirim browser diabaikan tanpa pernah masuk payload — termasuk
  // alamat surel (kunci pencocokan saat aktivasi) dan kolom penautan akun.
  const { data, error } = await supabase
    .from("clients")
    .update({
      nama,
      no_hp: noHp,
      phase_id: faseBaru,
      alamat,
      alamat_lat: koordinat?.lat ?? null,
      alamat_lon: koordinat?.lon ?? null,
    })
    .eq("id", id)
    .select("id");

  // UPDATE yang tertahan RLS dijawab PostgREST dengan 200 + [] — melaporkan
  // "berhasil" tanpa memeriksa jumlah barisnya adalah kebohongan senyap.
  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Gagal memperbarui klien." };
  }

  revalidatePath("/admin/klien");
  revalidatePath(`/admin/klien/${id}`);
  return { ok: true };
}

/**
 * Menerbitkan tautan aktivasi sekali-pakai untuk satu klien.
 *
 * SATU-SATUNYA tempat service role dipakai di panel admin, dan itu terjadi di
 * dalam `createClientInvite` — bukan lewat klien service role yang dibuat di
 * berkas ini dan bisa dipakai query lain. Alasannya: `client_invites` sengaja
 * tertutup untuk SELURUH peran API termasuk admin, sehingga membacanya lewat
 * sesi pengguna menghasilkan 403, bukan array kosong. Tidak ada jalan lain
 * selain menerbitkan token baru dan mengembalikan nilainya sekali di sini.
 *
 * Yang tersimpan di basis data hanyalah SHA-256 token. Nilai mentahnya hidup
 * satu kali — pada nilai balik ini — lalu hanya ada di pesan WhatsApp yang
 * disalin admin. Karena itu tidak ada halaman mana pun yang bisa menampilkannya
 * ulang, dan menerbitkan tautan baru selalu membatalkan yang lama.
 *
 * Jalan pintas seed/fixture yang melewati penjaga "klien sudah tertaut" SENGAJA
 * tidak pernah diteruskan dari sini — penjaga itu ada justru untuk melindungi
 * catatan siapa mengaktifkan akun ini dari terhapus oleh satu klik "kirim
 * ulang". Dijaga `tests/admin-aktivasi.test.ts` sebagai pemindaian berkas.
 */
export async function terbitkanUndangan(
  clientId: string,
): Promise<Diterbitkan | Gagal> {
  await requireRole(["admin", "owner"]);

  // Dibaca lewat SESI PENGGUNA lebih dulu: RLS yang memutuskan apakah pemanggil
  // memang boleh melihat baris ini, sebelum service role menyentuh apa pun.
  const supabase = await createServerSupabase();
  const { data: klien } = await supabase
    .from("clients")
    .select("nama, email")
    .eq("id", clientId)
    .maybeSingle<{ nama: string; email: string }>();

  if (!klien) return { ok: false, pesan: "Klien tidak ditemukan." };

  const hasil = await createClientInvite(clientId);
  if (!hasil.ok) {
    return {
      ok: false,
      pesan:
        hasil.alasan === "sudah-tertaut"
          ? "Akun klien ini sudah aktif. Tautan baru tidak diterbitkan agar catatan aktivasinya tidak terhapus."
          : "Klien tidak ditemukan.",
    };
  }

  revalidatePath("/admin/klien");
  revalidatePath(`/admin/klien/${clientId}`);
  return { ok: true, token: hasil.token, nama: klien.nama, email: klien.email };
}
