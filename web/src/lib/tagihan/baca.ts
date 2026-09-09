import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { hitungTagihanPengajuan, type RincianTagihan } from "@/lib/tagihan/pengajuan";
import { PERMINTAAN_MENUNGGU_BAYAR } from "@/lib/jadwal/status";
import type { JenjangTransport } from "@/lib/transport/jarak";

/**
 * MEMBACA TAGIHAN PENGAJUAN (spec C2 P2).
 *
 * ===== KENAPA DUA KLIEN SUPABASE DALAM SATU FUNGSI =====
 * Barisnya dibaca dengan SESI PENGGUNA — policy "booking: klien baca miliknya"
 * yang memutuskan pengajuan siapa yang terlihat, bukan perbandingan yang
 * ditulis di sini. TARIFNYA dibaca dengan service role, karena
 * `transport_rates` berpolicy "hanya owner" dan klien memang tidak boleh
 * meng-query tabel uang.
 *
 * Alternatif yang DITOLAK: membuat view `transport_publik` seperti
 * `harga_publik`. Ia akan menambah satu permukaan yang bisa di-query siapa pun
 * yang login, dan memaksa money firewall dilonggarkan untuk kolom nominal baru
 * — sementara dokblok firewall itu sendiri memperingatkan agar daftarnya tidak
 * diperlebar. Menghitung di server lalu merender ANGKANYA sebagai teks tidak
 * menambah permukaan apa pun.
 *
 * Angka memang sampai ke layar klien, dan itu tidak terhindarkan: QRIS PADMA
 * statis, jadi klien mengetik sendiri jumlahnya. Keputusan #10 lama ("nominal
 * tidak pernah sampai ke layar klien, disampaikan lewat WhatsApp") sudah
 * digantikan spec V4 yang memutuskan harga klien memang tampil publik. Yang
 * TIDAK PERNAH berubah: honor mitra tidak pernah keluar dari `variant_rates`.
 */

export type TagihanPengajuan = {
  permintaanId: string;
  namaLayanan: string;
  tanggal: string;
  jamMulai: string;
  statusBayar: "belum" | "menunggu_verifikasi" | "lunas";
  tenggat: string | null;
  adaBukti: boolean;
  rincian: RincianTagihan;
};

type BarisPengajuan = {
  id: string;
  tanggal: string;
  jam_mulai: string;
  variant_id: string;
  status_bayar: "belum" | "menunggu_verifikasi" | "lunas";
  tenggat: string | null;
  bukti_objek: string | null;
  services: { nama: string } | null;
  partner_id: string | null;
  alamat_lat: number | null;
  alamat_lon: number | null;
};

/**
 * Seluruh tagihan pengajuan milik satu klien yang sedang menunggu pembayaran.
 *
 * Jenjang transport dihitung ulang di sini dari koordinat yang sudah tersimpan,
 * memakai fungsi basis data yang SAMA dengan yang dipakai konfirmasi — bukan
 * disalin ke TypeScript. Dua rumus jarak yang harus sepakat sudah cukup satu
 * pasang (`jarak_km` vs `haversineKm`, dijaga `tests/jarak-sql-vs-ts.test.ts`);
 * pasangan ketiga tidak perlu ada.
 */
export async function ambilTagihanPengajuan(clientId: string): Promise<TagihanPengajuan[]> {
  const supabase = await createServerSupabase();

  // GALAT DIBACA, BUKAN DIBUANG (Ruling 26). `data ?? []` mengubah kegagalan
  // PostgREST menjadi "klien ini tidak punya tagihan menunggu" — kalimat yang
  // tidak bisa dibedakan dari keadaan sehat, dan yang justru paling meyakinkan
  // saat ia salah: klien yang tenggatnya sedang berjalan membuka
  // `/passport/bayar`, melihat halaman bersih, dan menyimpulkan tidak ada yang
  // harus dibayar. Layar galat yang berisik lebih jujur daripada halaman
  // kosong yang berbohong (pola commit 885b86e, `ambilDaftarPermintaan`).
  const { data: pengajuan, error: galatPengajuan } = await supabase
    .from("booking_requests")
    .select(
      "id, tanggal, jam_mulai, variant_id, status_bayar, tenggat, bukti_objek, " +
        "alamat_lat, alamat_lon, partner_id, services ( nama )",
    )
    .eq("client_id", clientId)
    .eq("status", PERMINTAAN_MENUNGGU_BAYAR)
    .order("tenggat", { ascending: true })
    .returns<BarisPengajuan[]>();

  if (galatPengajuan) throw galatPengajuan;
  if (!pengajuan || pengajuan.length === 0) return [];

  const admin = createAdminSupabase();
  const [{ data: tarif, error: galatTarif }, { data: tarifTransport, error: galatTransport }] =
    await Promise.all([
      admin.from("variant_rates").select("variant_id, harga_klien, berlaku_sejak"),
      admin.from("transport_rates").select("jenjang, tarif_klien, berlaku_sejak"),
    ]);
  // Sejajar persis dengan `daftarTagihanPengajuanAdmin()`
  // (`lib/admin/tagihan-pengajuan.ts`): daftar tarif KOSONG bukan keadaan
  // netral. `hitungTagihanPengajuan()` akan memulangkan `total: null` bersebab
  // `tarif_varian_kosong`, dan di sisi klien kalimatnya berbunyi "Totalnya
  // sedang dilengkapi tim PADMA" — kalimat yang menenangkan, salah, dan tidak
  // meninggalkan satu pun jejak bahwa yang rusak sebenarnya adalah bacaan.
  // Klien menunggu telepon yang tidak akan datang sementara tenggatnya
  // berjalan.
  if (galatTarif) throw galatTarif;
  if (galatTransport) throw galatTransport;

  const barisTarif = (tarif ?? []).map((t) => ({
    variantId: t.variant_id as string,
    hargaKlien: t.harga_klien as number,
    berlakuSejak: t.berlaku_sejak as string,
  }));
  const barisTransport = (tarifTransport ?? []).map((t) => ({
    jenjang: t.jenjang as JenjangTransport,
    tarifKlien: t.tarif_klien as number,
    berlakuSejak: t.berlaku_sejak as string,
  }));

  // KOORDINAT MITRA dibaca service role, BUKAN di-embed pada query sesi klien.
  //
  // `partners` berpolicy staf: klien yang login membacanya sebagai NOL BARIS —
  // bukan sebagai galat. Embed `partners ( lat, lon )` karena itu selalu
  // memulangkan `null` di halaman klien, jenjangnya selalu tak diketahui, dan
  // SETIAP tagihan tampil sebagai "totalnya sedang dilengkapi tim". Fiturnya
  // mati sepenuhnya, tanpa satu pun galat di log — dan tidak ada uji unit yang
  // bisa melihatnya, karena semuanya membaca dengan service role.
  //
  // Yang menentukan pengajuan SIAPA yang terlihat tetap policy pada query di
  // atas. Yang dibaca di sini hanya dua angka domisili mitra, dan dari keduanya
  // tidak ada satu pun nilai yang sampai ke layar — hanya jenjang jaraknya.
  // Pemisahan yang sama sudah dipakai untuk `transport_rates` di fungsi ini.
  const idMitra = [...new Set((pengajuan.map((p) => p.partner_id).filter(Boolean) as string[]))];
  const { data: mitra } = idMitra.length
    ? await admin.from("partners").select("id, lat, lon").in("id", idMitra)
    : { data: [] as { id: string; lat: number | null; lon: number | null }[] };
  const titikMitra = new Map(
    (mitra ?? []).map((m) => [m.id as string, { lat: m.lat as number | null, lon: m.lon as number | null }]),
  );

  const hasil: TagihanPengajuan[] = [];
  for (const p of pengajuan) {
    const titik = p.partner_id ? titikMitra.get(p.partner_id) : undefined;
    let jenjang: JenjangTransport | null = null;
    if (
      titik?.lat != null &&
      titik?.lon != null &&
      p.alamat_lat != null &&
      p.alamat_lon != null
    ) {
      const { data } = await admin.rpc("jenjang_dari_jarak", {
        km: await jarak(admin, titik.lat, titik.lon, p.alamat_lat, p.alamat_lon),
      });
      jenjang = (data as JenjangTransport | null) ?? null;
    }

    // TIDAK ADA bacaan `transport_khusus` di sini, dan itu perbaikan cacat —
    // bukan kelalaian. Tabel itu ber-primary-key `session_id references
    // sessions(id)`, sementara `p.id` adalah id BOOKING REQUEST. Id itu tidak
    // akan pernah ada di `sessions`, jadi bacaan lamanya selalu memulangkan nol
    // baris — sebagai `null` yang terbaca wajar, bukan sebagai galat.
    //
    // Penimpa per kasus tetap berlaku untuk SESI (rekap owner membacanya).
    // Untuk PENGAJUAN, yang berlaku adalah tarif dasar `di_atas_20` dari
    // `transport_rates` yang sudah ikut terbaca di atas.

    hasil.push({
      permintaanId: p.id,
      namaLayanan: p.services?.nama ?? "Layanan",
      tanggal: p.tanggal,
      jamMulai: p.jam_mulai,
      statusBayar: p.status_bayar,
      tenggat: p.tenggat,
      adaBukti: Boolean(p.bukti_objek),
      rincian: hitungTagihanPengajuan({
        variantId: p.variant_id,
        tanggal: p.tanggal,
        jenjang,
        sebabJenjangNull:
          titik?.lat == null || titik?.lon == null ? "mitra_tanpa_titik" : "alamat_tanpa_pin",
        tarif: barisTarif,
        tarifTransport: barisTransport,
      }),
    });
  }

  return hasil;
}

/**
 * SATU tagihan pengajuan milik klien ini — untuk `/passport/bayar/[id]`.
 *
 * Sengaja menyaring hasil `ambilTagihanPengajuan` alih-alih menulis query
 * kedua. Fungsi di atas bukan sekadar SELECT: ia menghitung jenjang transport
 * lewat RPC, membaca tarif khusus, dan merangkai rincian. Salinan kedua yang
 * harus sepakat selamanya dengan yang pertama adalah persis cara nominal di
 * halaman daftar dan nominal di halaman tagihan mulai berbeda — dan klien
 * yang membaca dua angka untuk satu tagihan tidak punya alasan mempercayai
 * satu pun. Daftarnya pendek: hanya pengajuan MILIK SATU KLIEN yang sedang
 * menunggu bayar.
 *
 * `null` berarti tidak ada, sudah tidak menunggu bayar, ATAU bukan miliknya —
 * ketiganya berakhir `notFound()` di halaman.
 */
export async function ambilTagihanPengajuanSatu(
  clientId: string,
  permintaanId: string,
): Promise<TagihanPengajuan | null> {
  const semua = await ambilTagihanPengajuan(clientId);
  return semua.find((t) => t.permintaanId === permintaanId) ?? null;
}

async function jarak(
  admin: ReturnType<typeof createAdminSupabase>,
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): Promise<number> {
  const { data } = await admin.rpc("jarak_km", { lat1, lon1, lat2, lon2 });
  return (data as number) ?? 0;
}
