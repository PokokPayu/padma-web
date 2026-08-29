"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { periksaNilai, type BentukSetelan } from "@/lib/pengaturan/bentuk";

/**
 * Jalur tulis setelan aplikasi.
 *
 * Lima aturan yang mengikat berkas ini:
 *
 *  1. Server action adalah ENDPOINT POST TERSENDIRI. Penjaga di
 *     `src/app/admin/layout.tsx` tidak pernah dilewati saat action dipanggil
 *     langsung, jadi `requireRole(["admin","owner"])` ditulis DI DALAM action.
 *     Tanpa itu, klien mana pun yang login bisa menukar nomor WhatsApp klinik
 *     dengan nomornya sendiri dan memanen seluruh calon klien.
 *
 *  2. BENTUK VALIDATOR TIDAK PERNAH DATANG DARI BROWSER. Ia dibaca dari
 *     registri `app_setting_keys` di server. Bila formulir boleh memilih
 *     validatornya, penyerang cukup menyebut `nomor_wa` sebagai `teks_polos`
 *     dan seluruh sanitasi digit menguap.
 *
 *  3. KUNCI DIPERIKSA KE REGISTRI LEBIH DULU. FK di basis data sudah menutup
 *     kunci liar (23503), tetapi kode Postgres bukan kalimat yang boleh dibaca
 *     admin klinik. Panel menolaknya sendiri dengan bahasa manusia; FK tetap
 *     berdiri sebagai lapis di bawahnya, untuk jalur yang tidak lewat sini.
 *
 *  4. UPSERT YANG TERTAHAN DIJAWAB 200 + []. Melaporkan "tersimpan" tanpa
 *     memeriksa panjangnya berarti admin melihat nomor baru di layar sementara
 *     basis data masih memegang yang lama.
 *
 *  5. PROPAGASI IKUT KE HALAMAN STATIS. `/skrining` — kanal konversi utama —
 *     dipanggang saat build; nomor WA-nya benar-benar tertulis di
 *     `.next/server/app/skrining.rsc`. Tanpa `revalidatePath("/skrining")`
 *     wizardnya memakai nomor lama sampai deploy berikutnya, dan tidak ada satu
 *     pun error yang memberi tahu.
 *
 * Berkas `"use server"` hanya boleh mengekspor fungsi async; bentuk & aturan
 * nilainya tinggal di `@/lib/pengaturan/bentuk`.
 */
type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true; nilai: string };

/**
 * Menyimpan satu setelan.
 *
 * `key` adalah argumen TERIKAT dari server component — bukan medan FormData —
 * supaya daftar kunci yang bisa disentuh formulir selalu berasal dari registri
 * yang dirender server, bukan dari medan tersembunyi yang bisa ditulis ulang di
 * DevTools. Lapis berikutnya tetap memeriksanya ke registri, karena argumen
 * server action pun pada akhirnya adalah masukan jaringan.
 */
export async function simpanSetelan(
  key: string,
  formData: FormData,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const supabase = await createServerSupabase();

  const { data: registri } = await supabase
    .from("app_setting_keys")
    .select("key, bentuk")
    .eq("key", key)
    .maybeSingle<{ key: string; bentuk: BentukSetelan }>();

  if (!registri) {
    return {
      ok: false,
      pesan:
        "Pengaturan ini tidak dikenal. Kunci baru hanya bisa ditambahkan lewat migration.",
    };
  }

  const periksa = periksaNilai(registri.bentuk, String(formData.get("nilai") ?? ""));
  if (!periksa.ok) return { ok: false, pesan: periksa.pesan };

  // Kunci yang ditulis adalah kunci dari REGISTRI, bukan yang diketik pemanggil:
  // nilai yang lolos pemeriksaan dan nilai yang disimpan wajib berasal dari
  // baris yang sama.
  const { data, error } = await supabase
    .from("app_settings")
    .upsert({ key: registri.key, value: periksa.nilai }, { onConflict: "key" })
    .select("key");

  if (error) {
    return { ok: false, pesan: "Gagal menyimpan pengaturan. Coba lagi." };
  }
  if ((data ?? []).length === 0) {
    return {
      ok: false,
      pesan: "Perubahan tidak tersimpan. Muat ulang halaman lalu coba lagi.",
    };
  }

  // Empat kanal, empat baris. Landing & passport dirender ulang per permintaan,
  // tetapi cache rutenya tetap memegang nilai lama sampai diberi tahu.
  revalidatePath("/");
  revalidatePath("/skrining"); // WAJIB — halaman statis penuh, nomornya dipanggang saat build
  revalidatePath("/passport/bayar");
  revalidatePath("/admin/pengaturan");

  return { ok: true, nilai: periksa.nilai };
}
