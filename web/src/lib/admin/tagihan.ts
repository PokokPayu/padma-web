import { createServerSupabase } from "@/lib/supabase/server";
import { formatTanggalID } from "@/lib/passport/waktu";
import type { PayStatus } from "@/lib/passport/turunan";

export type ItemTagihanAdmin = {
  jenis: "paket" | "sesi";
  id: string;
  namaKlien: string;
  padmaId: string;
  label: string;
  status: PayStatus;
};

type BarisPaket = {
  id: string;
  status_bayar: PayStatus;
  clients: { nama: string; padma_id: string } | null;
  packages: { nama: string; jumlah_sesi: number } | null;
};

type BarisSesi = {
  id: string;
  status_bayar: PayStatus;
  tanggal: string;
  clients: { nama: string; padma_id: string } | null;
  services: { nama: string } | null;
};

// Yang menunggu verifikasi naik ke atas — itulah pekerjaan admin hari ini.
const URUT: Record<PayStatus, number> = {
  menunggu_verifikasi: 0,
  belum: 1,
  lunas: 2,
};

/**
 * Seluruh tagihan klinik yang bisa diputuskan admin, satu daftar untuk semua
 * klien.
 *
 * SARINGANNYA WAJIB IDENTIK dengan `susunTagihan()` di `@/lib/passport/turunan`
 * + `ambilPaket()` di `@/lib/passport/data` — yaitu daftar yang benar-benar
 * dilihat KLIEN:
 *   - paket: hanya yang berstatus 'aktif';
 *   - sesi: hanya yang LEPAS (`client_package_id is null`) dan tidak batal.
 *
 * Saringan naif (`status_bayar <> 'lunas'`) mengembalikan tujuh baris tambahan
 * pada data seed, semuanya sesi anggota paket yang SUDAH lunas. Karena
 * transisi `belum -> lunas` diizinkan basis data, admin benar-benar bisa
 * "melunasi" tujuh tagihan hantu itu — dan menulis tujuh baris jejak audit
 * untuk keputusan yang tidak pernah ada uangnya. Sesi di dalam paket mengikuti
 * status paketnya; `sessions.status_bayar` hanya relevan untuk sesi lepas, dan
 * sejak `sessions_bayar_hanya_lepas` itu ditegakkan constraint.
 *
 * Sesi pengguna, bukan service role: RLS staf yang mengizinkan bacaan ini, dan
 * di bawah service role `user_role()` justru mengembalikan 'klien'.
 *
 * Nominal tidak pernah ikut: tabel tarif & honor mengembalikan [] untuk admin
 * (HTTP 200, kosong senyap), dan besaran uang disampaikan tim PADMA lewat
 * WhatsApp (keputusan #10). Berkas ini karena itu tidak pernah menyebut satu
 * pun tabel uang — dan itu diuji.
 */
export async function daftarTagihanAdmin(): Promise<ItemTagihanAdmin[]> {
  const supabase = await createServerSupabase();

  // Embed `clients`/`packages`/`services` aman: ketiganya foreign key sungguhan.
  // (Embed ke `jejak_status_bayar` atau `profiles` yang GAGAL — PGRST200 —
  // adalah embed ke tabel tanpa FK; keduanya sengaja tidak dipakai di sini.)
  const [{ data: paket }, { data: sesi }] = await Promise.all([
    supabase
      .from("client_packages")
      .select("id, status_bayar, clients(nama, padma_id), packages(nama, jumlah_sesi)")
      .eq("status", "aktif")
      .returns<BarisPaket[]>(),
    supabase
      .from("sessions")
      .select("id, status_bayar, tanggal, clients(nama, padma_id), services(nama)")
      .is("client_package_id", null)
      .neq("status", "batal")
      // `tanggal` bertipe date dan sudah berupa YYYY-MM-DD: urutannya
      // diserahkan ke Postgres, tidak pernah ke aritmatika Date di JS.
      .order("tanggal", { ascending: false })
      .returns<BarisSesi[]>(),
  ]);

  const item: ItemTagihanAdmin[] = [];

  for (const p of paket ?? []) {
    item.push({
      jenis: "paket",
      id: p.id,
      namaKlien: p.clients?.nama ?? "—",
      padmaId: p.clients?.padma_id ?? "—",
      label: `${p.packages?.nama ?? "Paket"} · ${p.packages?.jumlah_sesi ?? 0} sesi`,
      status: p.status_bayar,
    });
  }

  for (const s of sesi ?? []) {
    item.push({
      jenis: "sesi",
      id: s.id,
      namaKlien: s.clients?.nama ?? "—",
      padmaId: s.clients?.padma_id ?? "—",
      // Label sama persis dengan yang dibaca klien di passport-nya, supaya
      // percakapan WhatsApp "yang mana?" tidak pernah perlu terjadi.
      label: `${s.services?.nama ?? "Layanan"} · ${formatTanggalID(s.tanggal)}`,
      status: s.status_bayar,
    });
  }

  // Komparator mengembalikan 0 untuk peringkat kembar: komparator yang
  // mengembalikan 1 untuk elemen setara melanggar kontrak Array#sort.
  return item.sort((a, b) => URUT[a.status] - URUT[b.status]);
}
