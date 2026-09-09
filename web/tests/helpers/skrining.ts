import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Menerbitkan satu skrining HIJAU untuk klien uji, dan memulangkan id-nya.
 *
 * Ada karena `booking_requests.screening_id` NOT NULL sejak C1-b (spec J3):
 * setiap fixture yang menyisipkan pengajuan jadwal butuh skrining yang
 * menopangnya, dan menuliskan objek `screenings` lengkap di ~18 tempat berbeda
 * berarti 18 salinan yang harus disunting bersamaan setiap kali kolomnya
 * bertambah.
 *
 * `kode` dibuat unik per pemanggilan: kolomnya UNIQUE, dan fixture yang
 * memakai kode tetap akan bentrok begitu dua berkas uji berjalan berurutan
 * tanpa pembersihan di antaranya.
 *
 * Dipanggil dengan klien SERVICE ROLE — klien tidak punya hak INSERT atas
 * `screenings`, dan itu memang disengaja (hasil & flags selalu ditentukan
 * server).
 */
export async function skriningHijau(
  admin: SupabaseClient,
  clientId: string,
  opsi: {
    fase?: string;
    hasil?: "hijau" | "merah";
    /**
     * Bendera yang ikut disimpan. Bawaannya kosong karena hampir setiap
     * fixture hanya butuh skrining yang SAH, bukan isinya; yang menguji
     * penyajian jawaban mengisinya sendiri.
     */
    flags?: { id: string; level: string; teks: string }[];
  } = {},
): Promise<string> {
  const { fase = "prekonsepsi", hasil = "hijau", flags = [] } = opsi;

  const { data, error } = await admin
    .from("screenings")
    .insert({
      kode: `UJI-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
      nama: "Klien Uji",
      no_hp: "0800-0000-0000",
      fase,
      jawaban: {},
      hasil,
      flags,
      client_id: clientId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) throw error;
  return data.id;
}
