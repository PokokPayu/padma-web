"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { penggunaSaatIni } from "@/lib/auth/sesi";
import { createServerSupabase } from "@/lib/supabase/server";
import { geocodeAlamat } from "@/lib/transport/geocode";
import { normalkanAlamat } from "@/lib/transport/alamat";
import { BATAS_PERMINTAAN_MENUNGGU } from "./batas";
import { periksaAlamat } from "./status";
import { hariIniJakarta } from "./waktu";

/**
 * SATU-SATUNYA jalur tulis milik klien.
 *
 * Server action adalah endpoint POST tersendiri: ia dapat dipanggil tanpa
 * melewati UI, sehingga penjaga di `src/app/passport/layout.tsx` TIDAK berlaku
 * di sini. `requireRole(["klien"])` karena itu ditulis di dalam action.
 *
 * Parameter action sengaja TIDAK memuat status tujuan. Begitu status datang
 * dari browser, seluruh rancangan runtuh: verifikasi manual admin bisa
 * dilompati klien sendiri. Nilai tujuan selalu hardcoded di berkas ini.
 */
type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };

async function klienSaatIni(): Promise<string | null> {
  await requireRole(["klien"]);

  const user = await penggunaSaatIni();
  if (!user) return null;

  const supabase = await createServerSupabase();

  // Identitas klien selalu diturunkan dari SESI, tidak pernah dari parameter —
  // itulah yang membuat filter kepemilikan di bawah bermakna.
  const { data } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function klaimSudahBayar(
  jenis: "paket" | "sesi",
  id: string,
): Promise<Berhasil | Gagal> {
  const clientId = await klienSaatIni();
  if (!clientId) return { ok: false, pesan: "Akun belum terhubung." };

  // SESI PENGGUNA, bukan service role. Di bawah service role `auth.uid()`
  // NULL dan `user_role()` jatuh ke 'klien', sehingga trigger jejak audit
  // mencatat `peran_aktor='service_role'` tanpa aktor — tepat kebalikan dari
  // alasan tabel jejak itu dibuat (sengketa "saya sudah transfer" vs "belum
  // masuk"). Karena klien memang tidak punya policy UPDATE atas dua tabel itu,
  // tulisannya lewat fungsi `security definer` yang JWT-nya ikut terbawa:
  // kepemilikan (auth.uid() -> clients) dan syarat status asal dijaga DI DALAM
  // fungsi, dan tujuannya hardcoded di sana — tidak ada argumen status di sini
  // maupun di sana.
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("klaim_sudah_bayar", {
    jenis,
    sasaran_id: id,
  });

  if (error) return { ok: false, pesan: "Gagal memproses." };
  // UPDATE yang tertahan menghasilkan 0 baris TANPA error — jangan melaporkan
  // "berhasil" tanpa memeriksa jumlah barisnya.
  const terpengaruh = (data ?? []) as string[];
  if (terpengaruh.length === 0) {
    return { ok: false, pesan: "Item tidak ditemukan atau statusnya sudah berubah." };
  }

  revalidatePath("/passport/bayar");
  return { ok: true };
}

const WAKTU_SAH = ["pagi", "siang", "sore"];

export async function ajukanJadwal(formData: FormData): Promise<Berhasil | Gagal> {
  const clientId = await klienSaatIni();
  if (!clientId) return { ok: false, pesan: "Akun belum terhubung." };

  const serviceId = String(formData.get("layanan") ?? "");
  const variantId = String(formData.get("varian") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "");
  const waktu = String(formData.get("waktu") ?? "");
  const catatan = String(formData.get("catatan") ?? "").slice(0, 300);

  // Kolom `tanggal` bertipe date dan hidup sebagai string YYYY-MM-DD di
  // seluruh aplikasi — bentuknya diperiksa apa adanya, tanpa aritmatika Date
  // (server berjalan UTC, mesin dev WIB).
  if (!serviceId || !variantId || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    return { ok: false, pesan: "Lengkapi layanan, varian, dan tanggal." };
  }
  if (!WAKTU_SAH.includes(waktu)) {
    return { ok: false, pesan: "Preferensi waktu tidak sah." };
  }

  // Alamat WAJIB di sini (spec T6) — beda dari profil klien/domisili mitra
  // yang boleh kosong. Mitra harus tahu ke mana ia datang; format diperiksa
  // sebagai fungsi murni di `./status`, terpisah dari geocoding di bawah.
  const cekAlamat = periksaAlamat(String(formData.get("alamat") ?? ""));
  if (!cekAlamat.ok) return { ok: false, pesan: cekAlamat.pesan };

  // Perbandingan STRING, bukan aritmatika Date: kolom `tanggal` bertipe date
  // dan hidup sebagai 'YYYY-MM-DD'. "Hari ini" diambil dari kalender Jakarta —
  // server berjalan UTC, jadi jam mesin akan salah hari selama 7 jam setiap
  // hari. Regex di atas hanya memeriksa RUPA tanggal; ini yang memeriksa NILAI
  // (red team meloloskan 2020-01-01 lewat celah itu).
  if (tanggal < hariIniJakarta()) {
    return { ok: false, pesan: "Tanggal sudah lewat. Pilih tanggal mulai hari ini." };
  }

  const supabase = await createServerSupabase();

  // Layanan harus AKTIF. Foreign key hanya menolak service_id yang TIDAK ADA,
  // sedangkan formulir menyaring `aktif` di UI — dan server action adalah
  // endpoint POST tersendiri yang tidak pernah melewati UI itu.
  const { data: layanan } = await supabase
    .from("services")
    .select("id")
    .eq("id", serviceId)
    .eq("aktif", true)
    .maybeSingle();
  if (!layanan) {
    return { ok: false, pesan: "Layanan tidak tersedia untuk saat ini." };
  }

  // Varian harus AKTIF dan milik LAYANAN yang sama — keduanya disaring dalam
  // satu query, bukan hanya `id`, supaya "varian milik layanan lain" ditolak
  // dengan kalimat yang bisa dibaca, bukan sekadar kode Postgres dari FK
  // gabungan (yang tetap menjadi lapisan terakhir, tidak dilepas di sini).
  const { data: varian } = await supabase
    .from("service_variants")
    .select("id")
    .eq("id", variantId)
    .eq("service_id", serviceId)
    .eq("aktif", true)
    .maybeSingle();
  if (!varian) {
    return { ok: false, pesan: "Varian tidak tersedia untuk layanan ini." };
  }

  // Pembatas antrean. Penegak sebenarnya ada di basis data (trigger
  // guard_booking_pembatas + unique index booking_requests_antrean_unik),
  // karena klien memegang policy INSERT dan bisa memanggil PostgREST langsung.
  // Dua pemeriksaan di bawah ada untuk PESAN yang bisa dibaca manusia, bukan
  // sebagai pagar — pagarnya sudah dipasang sebelum lapisan ini.
  const { count } = await supabase
    .from("booking_requests")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("status", "menunggu");
  if ((count ?? 0) >= BATAS_PERMINTAAN_MENUNGGU) {
    return {
      ok: false,
      pesan: `Masih ada ${BATAS_PERMINTAAN_MENUNGGU} permintaan yang menunggu jawaban tim PADMA. Tunggu kabarnya dulu, ya.`,
    };
  }

  const { data: kembar } = await supabase
    .from("booking_requests")
    .select("id")
    .eq("client_id", clientId)
    .eq("service_id", serviceId)
    .eq("tanggal", tanggal)
    .eq("preferensi_waktu", waktu)
    .eq("status", "menunggu")
    .limit(1);
  if ((kembar ?? []).length > 0) {
    return { ok: false, pesan: "Permintaan yang sama sudah terkirim dan sedang diproses." };
  }

  // Geocoding TIDAK PERNAH menggagalkan penyimpanan (spec T6). `geocodeAlamat`
  // sudah menelan setiap galatnya dan memulangkan null; yang tersisa di sini
  // hanyalah menyimpan apa adanya, termasuk ketika koordinatnya tidak ada.
  // Dipanggil SESUDAH seluruh pemeriksaan lain lolos — supaya permintaan yang
  // pasti ditolak (layanan mati, tanggal lampau, dst.) tidak ikut membakar
  // jatah 1 permintaan/detik Nominatim untuk sesuatu yang tidak akan tersimpan.
  // Alamat yang TIDAK diubah klien mewarisi koordinat profilnya — titik yang
  // sudah dijatuhkan dan dibenarkan admin di peta. Formulir ini terisi otomatis
  // dari profil, jadi mayoritas pengajuan lewat jalur ini, dan mewarisi jawaban
  // manusia jelas lebih baik daripada menanyakan ulang kepada OSM yang untuk
  // alamat Malang sebagian besar tidak tahu (26 dari 32 gagal; lihat §1 spec
  // pemilih-lokasi).
  //
  // Ini TIDAK melanggar spec T6 ("jangan ambil ulang alamat dari profil"). Yang
  // T6 cegah adalah berubahnya ALAMAT tujuan mitra ketika klien memesan untuk
  // tempat lain. Di sini perbandingannya menuntut teks yang IDENTIK, sehingga
  // tidak ada alamat yang berubah — yang diwarisi hanyalah jawaban atas
  // pertanyaan yang sudah pernah dijawab manusia. MELONGGARKAN perbandingan ini
  // (mis. mencocokkan sebagian, atau mengabaikan nomor rumah) mengembalikan
  // persis bahaya yang T6 cegah.
  const { data: profil } = await supabase
    .from("clients")
    .select("alamat, alamat_lat, alamat_lon")
    .eq("id", clientId)
    .maybeSingle();

  const warisan =
    profil &&
    profil.alamat_lat !== null &&
    profil.alamat_lon !== null &&
    normalkanAlamat(String(profil.alamat ?? "")) === normalkanAlamat(cekAlamat.nilai)
      ? { lat: profil.alamat_lat as number, lon: profil.alamat_lon as number }
      : null;

  const koordinat = warisan ?? (await geocodeAlamat(cekAlamat.nilai));

  // Insert memakai SESI PENGGUNA, bukan service role: RLS + trigger
  // guard_booking_status menjadi lapis kedua di belakang nilai hardcoded ini.
  // Nilai apa pun yang ikut dikirim browser di FormData diabaikan — hanya
  // medan di bawah yang pernah menyentuh basis data.
  const { error } = await supabase.from("booking_requests").insert({
    client_id: clientId,
    service_id: serviceId,
    variant_id: variantId,
    tanggal,
    preferensi_waktu: waktu,
    catatan,
    alamat: cekAlamat.nilai,
    alamat_lat: koordinat?.lat ?? null,
    alamat_lon: koordinat?.lon ?? null,
    status: "menunggu", // hardcoded; trigger DB menolak nilai lain dari klien
  });
  if (error) return { ok: false, pesan: "Gagal mengirim permintaan." };

  revalidatePath("/passport");
  return { ok: true };
}
