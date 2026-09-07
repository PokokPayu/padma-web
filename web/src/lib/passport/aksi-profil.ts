"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { geocodeAlamat } from "@/lib/transport/geocode";
import { periksaAlamat } from "./status";

/**
 * Swasunting profil klien.
 *
 * Berkas TERPISAH dari `lib/passport/aksi.ts` bukan karena berbeda jenis,
 * melainkan karena berkas itu sedang disunting pekerjaan lain (pewarisan
 * koordinat ke pengajuan jadwal). Memisahkannya menghapus satu titik bentrok
 * tanpa mengubah apa pun yang penting; kalau kelak keduanya tenang, menyatukan
 * mereka adalah pekerjaan satu menit.
 */
type Hasil = { ok: true } | { ok: false; pesan: string };

export async function perbaruiProfil(formData: FormData): Promise<Hasil> {
  const nama = String(formData.get("nama") ?? "").trim();
  const noHp = String(formData.get("no_hp") ?? "").trim();
  const alamat = String(formData.get("alamat") ?? "").trim();

  if (nama.length < 2) return { ok: false, pesan: "Nama terlalu pendek." };

  // Alamat BOLEH kosong — sama seperti alamat profil di panel admin, data ini
  // boleh terisi menyusul. Tetapi begitu diisi, ia harus cukup untuk dituju
  // mitra, jadi ambangnya sama dengan alamat pengajuan jadwal.
  if (alamat !== "") {
    const cek = periksaAlamat(alamat);
    if (!cek.ok) return { ok: false, pesan: cek.pesan };
  }

  const supabase = await createServerSupabase();

  // Alamat LAMA dibaca lebih dulu karena ia yang memutuskan perlu-tidaknya
  // geocoding. RPC di bawah membuat keputusan yang sama untuk koordinat, dan
  // keduanya memakai nilai ter-`trim` supaya tidak pernah berselisih.
  const { data: sebelum } = await supabase
    .from("clients")
    .select("id, alamat")
    .maybeSingle<{ id: string; alamat: string }>();

  if (!sebelum) {
    return { ok: false, pesan: "Akun ini belum terhubung ke data klien PADMA." };
  }

  const { error } = await supabase.rpc("perbarui_profil_klien", {
    p_nama: nama,
    p_no_hp: noHp,
    p_alamat: alamat,
  });
  if (error) {
    return { ok: false, pesan: "Gagal menyimpan perubahan. Coba lagi sebentar." };
  }

  // Geocoding hanya untuk alamat yang BENAR-BENAR berubah. Dua alasan, dan yang
  // kedua jauh lebih penting daripada penghematan kuota:
  //   1. Nominatim dibatasi 1 permintaan/detik;
  //   2. koordinat yang sudah ada bisa merupakan hasil koreksi MANUSIA (pin
  //      admin di peta). Menggeocode ulang alamat yang sama akan menimpanya
  //      dengan tebakan OSM — menukar jawaban yang benar dengan yang kira-kira.
  if (alamat !== "" && alamat !== sebelum.alamat.trim()) {
    const koordinat = await geocodeAlamat(alamat);
    if (koordinat) {
      // Service role, bukan sesi klien. Koordinat menentukan jenjang jarak, dan
      // jenjang menentukan uang — karena itu ia sengaja bukan parameter RPC
      // (klien akan bisa memilih tarifnya sendiri) dan hanya boleh ditulis dari
      // sisi server sesudah geocoding.
      await createAdminSupabase()
        .from("clients")
        .update({ alamat_lat: koordinat.lat, alamat_lon: koordinat.lon })
        .eq("id", sebelum.id);
    }
    // Geocoding gagal TIDAK menggagalkan simpan (spec T6): koordinat tetap
    // kosong, yang artinya satu hal saja — jenjangnya tidak disarankan, admin
    // memilih sendiri. Alamatnya sendiri sudah tersimpan oleh RPC di atas.
  }

  revalidatePath("/passport/profil");
  // Formulir pengajuan jadwal mengisi medan alamatnya dari profil ini; tanpa
  // revalidasi, klien yang baru memperbarui alamat masih disodori alamat lama.
  revalidatePath("/passport/ajukan");
  return { ok: true };
}
