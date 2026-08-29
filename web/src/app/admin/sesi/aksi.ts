"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Jalur tulis panel admin untuk antrean permintaan jadwal.
 *
 * Empat aturan yang mengikat berkas ini:
 *
 *  1. Server action adalah ENDPOINT POST TERSENDIRI. Penjaga di
 *     `src/app/admin/layout.tsx` tidak pernah dilewati saat action dipanggil
 *     langsung, jadi `requireRole(["admin","owner"])` ditulis DI DALAM setiap
 *     action. Tanpa itu, klien yang login bisa menyetujui permintaan jadwalnya
 *     sendiri — celah yang pernah nyata di proyek ini.
 *
 *  2. KEADAAN TUJUAN TIDAK PERNAH MENJADI PARAMETER. Karena itu ada dua action
 *     terpisah, `konfirmasiPermintaan` dan `tolakPermintaan`, masing-masing
 *     dengan status tertulis mati di dalamnya.
 *
 *  3. IDENTITAS KLIEN DIBACA DARI BARIS PERMINTAAN, bukan dari pemanggil. Bila
 *     `client_id`/`service_id` datang dari payload, satu POST yang dikarang
 *     bisa melahirkan sesi atas nama klien lain — dan sesi itu akan tampil di
 *     passport orang tersebut sebagai janji yang tidak pernah ia minta.
 *
 *  4. Sesi pengguna, bukan service role. Di bawah service role `user_role()`
 *     mengembalikan 'klien' dan `auth.uid()` NULL: policy `booking: staf` dan
 *     `sessions: staf` tidak pernah ikut diperiksa.
 *
 * Berkas `"use server"` hanya boleh mengekspor fungsi async — label dan daftar
 * putih tinggal di `status.ts`.
 */
type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };

// Tanggal divalidasi sebagai TEKS, bukan lewat `new Date(...)`: kolom `tanggal`
// bertipe `date` dan sudah berupa YYYY-MM-DD, sedangkan `new Date("2026-12-27")`
// adalah tengah malam UTC — di zona mana pun sebelah barat ia mundur sehari.
// Aturan yang sama berlaku di seluruh proyek (lihat `@/lib/passport/waktu`).
const POLA_TANGGAL = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// Catatan bidan masuk ke `sessions.catatan` yang bertipe `text` tanpa batas.
// Batas ditegakkan di sini supaya satu tempelan raksasa tidak menjadi payload
// yang harus dirender ulang pada setiap kunjungan passport klien.
const BATAS_CATATAN = 2000;

/**
 * Mengubah satu permintaan jadwal menjadi sesi terjadwal.
 *
 * Hanya DUA nilai yang boleh datang dari luar: permintaan mana, dan mitra siapa
 * yang ditugaskan. Tanggal, klien, dan layanan dibaca dari baris permintaannya.
 */
export async function konfirmasiPermintaan(
  permintaanId: string,
  partnerId: string,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  // Mitra diperiksa SEBELUM permintaan diklaim. Dua alasan: (a) foreign key
  // hanya menolak partner_id yang TIDAK ADA, bukan mitra yang sudah pensiun,
  // sedangkan daftar pilihan di UI menyaring `aktif` — dan action ini tidak
  // pernah melewati UI itu; (b) memeriksanya belakangan berarti permintaan
  // sudah terlanjur keluar dari antrean untuk sesuatu yang pasti gagal.
  const { data: mitra } = await supabase
    .from("partners")
    .select("id")
    .eq("id", partnerId)
    .eq("aktif", true)
    .maybeSingle();

  if (!mitra) {
    return { ok: false, pesan: "Mitra tidak tersedia. Pilih mitra yang aktif." };
  }

  // KLAIM DULU, baru buat sesi. Urutan ini penting: bila sesi dibuat lebih dulu
  // lalu klaim gagal, tertinggal sesi yatim sementara permintaannya tetap di
  // antrean menunggu dikonfirmasi untuk kedua kalinya.
  //
  // `eq("status","menunggu")` bukan sekadar validasi: ia yang menyerialkan dua
  // konfirmasi paralel. Transaksi kedua menunggu kunci baris, lalu menilai
  // ulang syaratnya terhadap baris yang sudah berubah — dan tidak mengenai apa
  // pun. Index unik `sessions_booking_request_unik` adalah jaring keduanya.
  const { data: klaim } = await supabase
    .from("booking_requests")
    .update({ status: "dikonfirmasi" })
    .eq("id", permintaanId)
    .eq("status", "menunggu")
    .select("id, client_id, service_id, tanggal");

  // UPDATE yang tidak mengenai baris mana pun dijawab PostgREST dengan 200 + []
  // — melaporkan "berhasil" tanpa memeriksa jumlah barisnya adalah kebohongan
  // senyap, dan di sini kebohongannya berbentuk sesi yang tidak pernah lahir.
  if ((klaim ?? []).length === 0) {
    return { ok: false, pesan: "Permintaan sudah ditangani atau tidak ditemukan." };
  }
  const p = klaim![0];

  const { error } = await supabase.from("sessions").insert({
    client_id: p.client_id,
    service_id: p.service_id,
    partner_id: partnerId,
    tanggal: p.tanggal,
    status: "terjadwal",
    booking_request_id: p.id,
  });

  if (error) {
    // Kembalikan ke antrean supaya permintaan tidak hilang diam-diam. Syarat
    // `eq("status","dikonfirmasi")` menjaga agar pengembalian ini tidak pernah
    // menimpa keputusan orang lain yang sempat masuk di sela-selanya.
    await supabase
      .from("booking_requests")
      .update({ status: "menunggu" })
      .eq("id", p.id)
      .eq("status", "dikonfirmasi");
    return { ok: false, pesan: "Gagal membuat sesi. Coba lagi." };
  }

  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  // Sesi baru langsung tampil di passport klien sebagai jadwal berikutnya.
  revalidatePath("/passport");
  return { ok: true };
}

/**
 * Menolak permintaan jadwal — hanya dari antrean.
 *
 * Permintaan yang sudah dikonfirmasi TIDAK bisa dibatalkan lewat sini: sesinya
 * sudah lahir, dan memutar status permintaan hanya akan membuat sesi itu
 * kehilangan asal-usulnya tanpa membatalkan apa pun. Pembatalan sesi adalah
 * status `batal` pada sesinya sendiri.
 */
export async function tolakPermintaan(permintaanId: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("booking_requests")
    .update({ status: "ditolak" })
    .eq("id", permintaanId)
    .eq("status", "menunggu")
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Permintaan sudah ditangani atau tidak ditemukan." };
  }

  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  revalidatePath("/passport");
  return { ok: true };
}

/**
 * Menjadwalkan sesi LANGSUNG — tanpa melewati antrean permintaan.
 *
 * Jalur ini ada karena sebagian besar jadwal klinik lahir di telepon, bukan di
 * aplikasi. Bedanya dengan `konfirmasiPermintaan`: di sini memang admin yang
 * memilih kliennya, jadi `client_id` boleh datang dari formulir — yang
 * menjaganya adalah `requireRole` di atas, bukan asal-usul nilainya.
 *
 * Satu nilai yang TETAP tidak boleh datang dari formulir adalah
 * `client_package_id`. Paket dibaca dari klien yang dipilih: bila ia boleh
 * dikirim, satu POST yang dikarang bisa menempelkan sesi seorang klien pada
 * paket klien lain — progres orang itu bertambah tanpa ia pernah dikunjungi,
 * dan tidak ada foreign key yang keberatan karena paketnya memang ada.
 *
 * Status sesi tertulis mati: `terjadwal`. Sesi tidak pernah lahir "selesai" —
 * catatan bidannya belum ada, dan stempel passport akan terbit kosong.
 */
export async function jadwalkanSesi(formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const clientId = String(formData.get("client_id") ?? "").trim();
  const serviceId = String(formData.get("service_id") ?? "").trim();
  const partnerId = String(formData.get("partner_id") ?? "").trim();
  const tanggal = String(formData.get("tanggal") ?? "").trim();
  const pakaiPaket = formData.get("pakai_paket") !== null;

  if (!clientId || !serviceId || !partnerId) {
    return { ok: false, pesan: "Klien, layanan, dan mitra wajib dipilih." };
  }
  if (!POLA_TANGGAL.test(tanggal)) {
    return { ok: false, pesan: "Tanggal harus berformat YYYY-MM-DD." };
  }

  const supabase = await createServerSupabase();

  // Ketiganya diperiksa SEBELUM menulis. Foreign key memang menolak id yang
  // tidak ada, tetapi pesannya adalah kode Postgres — dan untuk mitra ia sama
  // sekali tidak menolong: mitra yang sudah pensiun tetap ada barisnya.
  const [{ data: klien }, { data: layanan }, { data: mitra }] = await Promise.all([
    supabase.from("clients").select("id").eq("id", clientId).maybeSingle(),
    supabase.from("services").select("id").eq("id", serviceId).maybeSingle(),
    supabase
      .from("partners")
      .select("id")
      .eq("id", partnerId)
      .eq("aktif", true)
      .maybeSingle(),
  ]);

  if (!klien) return { ok: false, pesan: "Klien tidak ditemukan." };
  if (!layanan) return { ok: false, pesan: "Layanan tidak ditemukan." };
  if (!mitra) return { ok: false, pesan: "Mitra tidak tersedia. Pilih mitra yang aktif." };

  // Paket dibaca dari klien yang dipilih — tidak pernah dari formulir.
  let paketId: string | null = null;
  if (pakaiPaket) {
    const { data: paket } = await supabase
      .from("client_packages")
      .select("id")
      .eq("client_id", clientId)
      .eq("status", "aktif")
      .order("tanggal_mulai", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    paketId = paket?.id ?? null;
  }

  const { error } = await supabase.from("sessions").insert({
    client_id: clientId,
    service_id: serviceId,
    partner_id: partnerId,
    tanggal,
    status: "terjadwal",
    catatan: "",
    rekomendasi: "",
    client_package_id: paketId,
  });

  if (error) return { ok: false, pesan: "Gagal menyimpan jadwal sesi." };

  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  // Sesi baru langsung tampil di passport klien sebagai jadwal berikutnya.
  revalidatePath("/passport");
  return { ok: true };
}

/**
 * Menandai sesi SELESAI beserta catatan bidan.
 *
 * Inilah satu-satunya tempat catatan bidan masuk ke passport klien, dan karena
 * itu tiga hal dijaga ketat:
 *
 *  1. `eq("status","terjadwal")` bukan sekadar validasi. Tanpanya, sesi yang
 *     sudah dibatalkan bisa dihidupkan kembali, dan catatan sesi yang sudah
 *     selesai bisa ditimpa diam-diam oleh klik kedua — rekam medis kehilangan
 *     versi aslinya tanpa satu pun error.
 *
 *  2. Catatan wajib berisi. Sesi "selesai" tanpa catatan adalah stempel kosong
 *     di passport: klien melihat kunjungannya bertambah tetapi tidak menerima
 *     apa pun dari kunjungan itu.
 *
 *  3. Keadaan pembayaran TIDAK ikut disentuh — namanya pun tidak disebut di
 *     berkas ini. Keputusan uang punya tabel jejak audit tersendiri (lihat
 *     migration jejak keputusan pembayaran); membuatnya bergerak sebagai efek
 *     samping "tandai selesai" berarti jejak itu mencatat aktor yang benar
 *     untuk keputusan yang tidak pernah diambil siapa pun.
 */
export async function selesaikanSesi(
  sesiId: string,
  formData: FormData,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const catatan = String(formData.get("catatan") ?? "").trim();
  const rekomendasi = String(formData.get("rekomendasi") ?? "").trim();

  if (catatan.length === 0) {
    return { ok: false, pesan: "Catatan wajib diisi — inilah yang dibaca klien." };
  }
  if (catatan.length > BATAS_CATATAN || rekomendasi.length > BATAS_CATATAN) {
    return {
      ok: false,
      pesan: `Catatan dan rekomendasi maksimal ${BATAS_CATATAN} karakter.`,
    };
  }

  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("sessions")
    .update({ status: "selesai", catatan, rekomendasi })
    .eq("id", sesiId)
    .eq("status", "terjadwal")
    .select("id");

  // UPDATE yang tidak mengenai baris mana pun dijawab PostgREST 200 + [] —
  // sesi batal, sesi yang sudah selesai, dan sesi yang tidak ada semuanya
  // mendarat di sini, dan ketiganya bukan keberhasilan.
  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Sesi tidak ditemukan atau sudah ditangani." };
  }

  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  // Catatan bidan baru terbit di riwayat sesi klien.
  revalidatePath("/passport");
  return { ok: true };
}
