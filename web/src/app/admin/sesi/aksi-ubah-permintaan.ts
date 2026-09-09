"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { koordinatDariFormData } from "@/lib/transport/koordinat-form";
import { geocodeAlamat } from "@/lib/transport/geocode";
import { normalkanAlamat } from "@/lib/transport/alamat";
import { STATUS_UBAH_PERMINTAAN } from "@/lib/jadwal/status";
import { bacaPengaturan } from "@/lib/settings";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { POLA_TANGGAL } from "@/lib/jadwal/jam";

/**
 * Mengubah alamat, tanggal, dan jam sebuah PERMINTAAN — satu aksi, satu
 * formulir (spec K3).
 *
 * Menggantikan `tetapkanKoordinatPermintaan`. Dilebur karena dua tempat yang
 * sama-sama menulis `alamat_lat` dengan aturan berbeda adalah bentuk yang
 * melahirkan dua baris bercerita beda tentang tempat yang sama.
 *
 * Berkas `"use server"` hanya boleh mengekspor fungsi async.
 */
type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };

type BarisSebelum = {
  alamat: string;
  alamat_lat: number | null;
  alamat_lon: number | null;
  tanggal: string;
};

export async function perbaruiPermintaan(
  permintaanId: string,
  formData: FormData,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const alamat = String(formData.get("alamat") ?? "").trim();
  const tanggal = String(formData.get("tanggal") ?? "").trim();
  const jam = String(formData.get("jam") ?? "").trim();

  if (alamat === "") {
    return { ok: false, pesan: "Alamat kunjungan tidak boleh kosong." };
  }

  // ===== TANGGAL & JAM DIPERIKSA DI SINI, DAN HANYA DI SINI (spec K8/L2) =====
  // `guard_booking_pembatas` memeriksa keduanya untuk KLIEN saja — badannya
  // dibuka `if user_role() = 'klien'`. Untuk admin, basis data TIDAK MEMERIKSA
  // APA PUN: tidak ada trigger, constraint, maupun policy yang menahan tanggal
  // di masa lalu atau jam di luar jam layanan. Kalau kedua pemeriksaan di bawah
  // dihapus atau dilewati jalur tulis lain, tidak ada jaring apa pun di
  // bawahnya, dan kegagalannya SENYAP.
  if (!POLA_TANGGAL.test(tanggal)) {
    return { ok: false, pesan: "Tanggal tidak sah." };
  }

  const { jamLayanan } = await bacaPengaturan();
  if (!jamLayanan.includes(jam)) {
    return { ok: false, pesan: "Jam itu tidak termasuk jam layanan klinik." };
  }

  const supabase = await createServerSupabase();

  // Baris dibaca lebih dulu, dan disaring status di sini juga: alamat LAMA yang
  // memutuskan apakah koordinat perlu dicari ulang. Tanpa pembacaan ini,
  // pilihannya tinggal selalu menggeocode ulang — membakar kuota Nominatim
  // untuk alamat yang tidak berubah — atau tidak pernah, yang meninggalkan
  // koordinat menunjuk tempat lain.
  //
  // `error` ikut didestruktur (bukan dibuang) supaya kegagalan PostgREST/jaringan
  // yang transien tidak jatuh ke cabang "tidak bisa diubah lagi" di bawah —
  // itu diagnosis untuk baris yang GENUINE tidak ditemukan/berstatus lain,
  // bukan untuk permintaan yang gagal dibaca dan berhak dicoba ulang.
  const { data: sebelum, error: errorBaca } = await supabase
    .from("booking_requests")
    .select("alamat, alamat_lat, alamat_lon, tanggal")
    .eq("id", permintaanId)
    .in("status", [...STATUS_UBAH_PERMINTAAN])
    .maybeSingle<BarisSebelum>();

  if (errorBaca) {
    return { ok: false, pesan: "Gagal memuat data permintaan. Coba lagi." };
  }

  if (!sebelum) {
    return {
      ok: false,
      pesan:
        "Permintaan ini tidak bisa diubah lagi — tagihannya mungkin sudah terbit, atau sudah ditangani.",
    };
  }

  // Kalender ASIA/JAKARTA, bukan jam server: Vercel berjalan UTC, dan antara
  // 17:00–24:00 UTC tanggal Jakarta sudah besok.
  //
  // Ditolak HANYA bila tanggal yang diminta BERBEDA dari tanggal tersimpan.
  // Permintaan `diminta` dari kemarin yang belum ditangani tidak boleh
  // terkunci total — admin masih berhak membetulkan alamatnya (Finding 5)
  // tanpa dipaksa sekaligus menggeser tanggalnya ke masa depan. Tanggal masa
  // lalu yang BARU dipilih tetap ditolak; hanya tanggal lama yang dibiarkan
  // lewat apa adanya.
  if (tanggal < hariIniJakarta() && tanggal !== sebelum.tanggal) {
    return { ok: false, pesan: "Tanggal tidak boleh di masa lalu." };
  }

  // ===== PIN MENANG (konvensi yang sama dengan form mitra) =====
  // Bila admin menjatuhkan pin, koordinat itu yang dipakai dan Nominatim TIDAK
  // ditanya sama sekali — menanyakan alamat yang jawabannya sudah pasti dibuang
  // hanya membakar kuota gratis milik pihak lain, dan pada volume nyata itulah
  // yang memicu pemblokiran.
  //
  // Tanpa pin, alamat yang BERUBAH membuang koordinat lama lalu menggeocode
  // sekali: koordinat lama menandai TEMPAT LAIN, dan mempertahankannya berarti
  // jenjang transport dihitung untuk lokasi yang bukan alamat kunjungan —
  // hasilnya keluar rapi, tanpa satu pun galat.
  //
  // Alamat yang SAMA mempertahankan koordinat lama apa adanya; tidak ada yang
  // perlu ditanyakan ulang.
  // Pin hanya dianggap "dijatuhkan manusia" bila petanya benar-benar disentuh.
  // `PemilihLokasi` menyemai medan lat/lon dari koordinat tersimpan sejak cat
  // pertama, jadi tanpa bendera ini SETIAP simpan terlihat seperti membawa pin —
  // dan cabang "alamat berubah → geocode ulang" tidak pernah tercapai, sehingga
  // alamat baru tersimpan bersama koordinat lama tanpa satu pun galat.
  const pin = formData.get("pin_disentuh") ? koordinatDariFormData(formData) : null;
  const alamatBerubah = normalkanAlamat(alamat) !== normalkanAlamat(sebelum.alamat);
  const koordinatLama =
    sebelum.alamat_lat !== null && sebelum.alamat_lon !== null
      ? { lat: sebelum.alamat_lat, lon: sebelum.alamat_lon }
      : null;

  const koordinat = pin ?? (alamatBerubah ? await geocodeAlamat(alamat) : koordinatLama);

  const { data, error } = await supabase
    .from("booking_requests")
    .update({
      alamat,
      tanggal,
      jam_mulai: jam,
      alamat_lat: koordinat?.lat ?? null,
      alamat_lon: koordinat?.lon ?? null,
    })
    .eq("id", permintaanId)
    .in("status", [...STATUS_UBAH_PERMINTAAN])
    .select("id");

  // 23505 = indeks `booking_requests_antrean_unik`
  // (client_id, service_id, tanggal, preferensi_waktu) untuk status
  // pra-konfirmasi. Tanpa terjemahan ini admin membaca kode Postgres dan
  // menyimpulkan sistemnya rusak, padahal yang terjadi punya nama.
  if (error?.code === "23505") {
    return {
      ok: false,
      pesan: "Klien ini sudah punya permintaan lain untuk layanan dan tanggal yang sama.",
    };
  }

  // UPDATE yang tertahan RLS dijawab PostgREST dengan 200 + [] — melaporkan
  // "berhasil" tanpa memeriksa jumlah barisnya adalah kebohongan senyap.
  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Gagal menyimpan perubahan. Coba lagi." };
  }

  revalidatePath("/admin/sesi");
  return { ok: true };
}
