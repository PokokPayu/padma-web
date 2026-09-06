import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Varian BAKU milik satu layanan — variant_id SAH pertama menurut urutan yang
 * sama dipakai backfill migrasi `sesi_menunjuk_varian` dan `petaVarianBaku()`
 * (`scripts/seed-users.ts`): `order by urutan, created_at, id limit 1`.
 *
 * Dipakai fixture uji yang menyisipkan `sessions`/`booking_requests` langsung
 * sejak Task 9 mengunci kedua kolom itu `not null`: id varian dibuat
 * `gen_random_uuid()` saat migrasi/trigger berjalan, jadi tidak ada nilai
 * tetap yang bisa ditulis literal di test — harus dibaca dari basis data.
 * Fixture yang butuh SATU variant_id yang sah untuk sebuah layanan, tanpa
 * peduli isinya, cukup memanggil ini alih-alih menulis query yang sama
 * berulang di setiap berkas.
 */
export async function varianBaku(admin: SupabaseClient, serviceId: string): Promise<string> {
  const { data, error } = await admin
    .from("service_variants")
    .select("id")
    .eq("service_id", serviceId)
    .order("urutan", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .single();
  if (error) throw error;
  return data.id as string;
}
