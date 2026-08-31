import { redirect } from "next/navigation";
import { penggunaSaatIni, profilSaatIni } from "./sesi";

export type AppRole = "klien" | "admin" | "owner";

/**
 * Gerbang otorisasi sungguhan — inilah yang memverifikasi JWT ke server Auth,
 * bukan proxy. Wajib dipanggil di dalam SETIAP server action, karena server
 * action adalah endpoint POST tersendiri yang tidak terlindungi guard layout.
 *
 * Identitas dan peran diambil lewat helper ber-cache di ./sesi, jadi memanggil
 * requireRole() beberapa kali dalam satu request hanya berbiaya sekali.
 */
export async function requireRole(allowed: AppRole[]) {
  const user = await penggunaSaatIni();
  if (!user) redirect("/masuk");

  const profile = await profilSaatIni();
  const role = (profile?.role ?? "klien") as AppRole;

  if (!allowed.includes(role)) redirect("/setelah-masuk");
  return { userId: user.id, role, nama: profile?.nama ?? "" };
}
