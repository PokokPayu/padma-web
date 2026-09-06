import { createServerSupabase } from "@/lib/supabase/server";
import { formatTanggalID } from "@/lib/passport/waktu";
import { labelVarian, type FormatVarian } from "@/lib/varian";
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
  variant_id: string | null;
  clients: { nama: string; padma_id: string } | null;
  services: { nama: string } | null;
};

type BarisVarian = {
  id: string;
  label: string;
  durasi_menit: number | null;
  format: FormatVarian | null;
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
 *
 * Label sesi menyertakan LABEL varian sejak layanan punya lebih dari satu
 * harga (Task 1-6): dua sesi layanan yang sama bisa berbeda harga bila
 * variannya berbeda (mis. 60 menit vs 90 menit), dan label yang hanya
 * menyebut nama layanan membuat admin — atau klien lewat WhatsApp — menagih
 * varian yang salah tanpa satu pun jalan untuk sadar. Dirangkai lewat
 * `labelVarian()` (`@/lib/varian`), SATU-SATUNYA perangkai label varian di
 * proyek ini; jangan menulis perangkai kedua di sini.
 */
export async function daftarTagihanAdmin(): Promise<ItemTagihanAdmin[]> {
  const supabase = await createServerSupabase();

  // Embed `clients`/`packages`/`services` aman: ketiganya foreign key sungguhan.
  // (Embed ke `jejak_status_bayar` atau `profiles` yang GAGAL — PGRST200 —
  // adalah embed ke tabel tanpa FK; keduanya sengaja tidak dipakai di sini.)
  //
  // `service_variants` TIDAK di-embed langsung dari `sessions`: FK-nya
  // gabungan (service_id, variant_id), dan PostgREST butuh hint constraint
  // untuk embed semacam itu. Pola yang sudah dipakai `ambilSesiRekap()`
  // (`@/lib/owner/data`) diikuti di sini — tarik `variant_id` mentah, lalu
  // cocokkan ke katalog varian yang ditarik terpisah.
  const [{ data: paket }, { data: sesi }, { data: varian }] = await Promise.all([
    supabase
      .from("client_packages")
      .select("id, status_bayar, clients(nama, padma_id), packages(nama, jumlah_sesi)")
      .eq("status", "aktif")
      .returns<BarisPaket[]>(),
    supabase
      .from("sessions")
      .select("id, status_bayar, tanggal, variant_id, clients(nama, padma_id), services(nama)")
      .is("client_package_id", null)
      .neq("status", "batal")
      // `tanggal` bertipe date dan sudah berupa YYYY-MM-DD: urutannya
      // diserahkan ke Postgres, tidak pernah ke aritmatika Date di JS.
      .order("tanggal", { ascending: false })
      .returns<BarisSesi[]>(),
    // Katalog varian saja (bukan tarifnya) — RLS "service_variants: baca
    // terautentikasi" menjawab TRUE untuk siapa pun yang login, jadi baris
    // ini tetap ada bagi admin.
    supabase
      .from("service_variants")
      .select("id, label, durasi_menit, format")
      .returns<BarisVarian[]>(),
  ]);

  const varianPerId = new Map((varian ?? []).map((v) => [v.id, v] as const));

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
    const namaLayanan = s.services?.nama ?? "Layanan";
    const v = s.variant_id ? varianPerId.get(s.variant_id) : undefined;
    // Varian baku (label kosong, durasi & format NULL) memulangkan string
    // kosong dari `labelVarian()` — label lama (hanya nama layanan) sengaja
    // dipertahankan apa adanya untuk kasus itu, bukan diberi akhiran kosong.
    const varLabel = v
      ? labelVarian({ label: v.label, durasiMenit: v.durasi_menit, format: v.format })
      : "";
    item.push({
      jenis: "sesi",
      id: s.id,
      namaKlien: s.clients?.nama ?? "—",
      padmaId: s.clients?.padma_id ?? "—",
      // Label ini IDENTIK huruf demi huruf dengan yang dibaca klien di
      // `susunTagihan()` (`@/lib/passport/turunan`) — sejak Ruling 13 (Task 9)
      // keduanya merangkai lewat `labelVarian()` yang SAMA persis, dari medan
      // varian yang sama, dengan komposisi "<layanan> · <varian?> · <tanggal>"
      // yang sama. Dikunci lewat uji parity di
      // `tests/admin-bayar.test.ts` ("label klien dan label admin IDENTIK
      // huruf demi huruf untuk sesi ber-varian yang sama") — bila salah satu
      // sisi berubah tanpa yang lain, uji itu yang harus merah duluan, bukan
      // komentar ini yang dibiarkan berbohong.
      label:
        varLabel === ""
          ? `${namaLayanan} · ${formatTanggalID(s.tanggal)}`
          : `${namaLayanan} · ${varLabel} · ${formatTanggalID(s.tanggal)}`,
      status: s.status_bayar,
    });
  }

  // Komparator mengembalikan 0 untuk peringkat kembar: komparator yang
  // mengembalikan 1 untuk elemen setara melanggar kontrak Array#sort.
  return item.sort((a, b) => URUT[a.status] - URUT[b.status]);
}
