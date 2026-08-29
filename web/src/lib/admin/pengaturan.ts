import { createServerSupabase } from "@/lib/supabase/server";
import {
  keFormatLokal,
  nomorWaTerpakai,
  type BentukSetelan,
} from "@/lib/pengaturan/bentuk";

/**
 * Lapisan baca setelan untuk PANEL ADMIN.
 *
 * Terpisah dari `@/lib/settings` dengan sengaja. `settings.ts` memakai service
 * role karena halaman publiknya dibuka anon, sementara di panel admin service
 * role justru merusak: `user_role()` mengembalikan 'klien', `auth.uid()` NULL,
 * dan policy `"settings: staf"` tidak pernah ikut diperiksa — panel akan
 * "berhasil" bahkan untuk sesi yang tidak berhak. Modul ini karena itu memakai
 * sesi penggunanya sendiri.
 */
export type SetelanAdmin = {
  key: string;
  keterangan: string;
  bentuk: BentukSetelan;
  /** Nilai tersimpan; string kosong bila kunci itu belum pernah diisi. */
  nilai: string;
};

type BarisRegistri = { key: string; keterangan: string; bentuk: BentukSetelan };
type BarisNilai = { key: string; value: string };

/**
 * Seluruh kunci TERDAFTAR beserta nilainya.
 *
 * Sumber daftarnya adalah registri, bukan `app_settings`: kunci yang belum
 * pernah diisi tetap wajib muncul di panel dengan medan kosong. Bila daftarnya
 * dirakit dari `app_settings`, kunci baru yang lahir lewat migration tidak akan
 * pernah bisa diisi manusia — dan tak seorang pun akan tahu sebabnya.
 *
 * Dua query, digabung di JS. Embed PostgREST sebenarnya mungkin di sini (FK-nya
 * ada), tetapi arah embed-nya menjadikan `app_settings` induk daftar — persis
 * kesalahan yang membuat kunci kosong menghilang.
 */
export async function daftarSetelanAdmin(): Promise<SetelanAdmin[]> {
  const supabase = await createServerSupabase();

  const [{ data: registri }, { data: isi }] = await Promise.all([
    supabase
      .from("app_setting_keys")
      .select("key, keterangan, bentuk")
      .order("key")
      .returns<BarisRegistri[]>(),
    supabase.from("app_settings").select("key, value").returns<BarisNilai[]>(),
  ]);

  const nilai = new Map((isi ?? []).map((b) => [b.key, b.value]));

  return (registri ?? [])
    .map((r) => ({
      key: r.key,
      keterangan: r.keterangan,
      bentuk: r.bentuk,
      nilai: nilai.get(r.key) ?? "",
    }))
    // Nomor WhatsApp naik ke atas: ia kanal konversi utama klinik, bukan
    // setelan yang kebetulan berhuruf awal 'n'. Sisanya menurut abjad supaya
    // urutannya tidak bergeser tiap kali kunci baru lahir.
    .sort((a, b) => {
      if (a.bentuk === "nomor_wa" && b.bentuk !== "nomor_wa") return -1;
      if (b.bentuk === "nomor_wa" && a.bentuk !== "nomor_wa") return 1;
      return a.key.localeCompare(b.key);
    });
}

/**
 * Nomor WhatsApp klinik sebagaimana dibaca DARI SESI ADMIN.
 *
 * Dipakai halaman yang berada di dalam panel (mis. teks undangan aktivasi) agar
 * kalimat yang disalin admin selalu menyebut nomor yang sedang berlaku, tanpa
 * menyeret klien service role ke dalam `src/app/admin/**`.
 */
export async function nomorWaKlinik(): Promise<{ link: string; tampilan: string }> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "nomor_wa")
    .maybeSingle();

  const link = nomorWaTerpakai(data?.value as string | undefined);
  return { link, tampilan: keFormatLokal(link) };
}
