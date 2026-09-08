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
  partners: { lat: number | null; lon: number | null } | null;
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

  const { data: pengajuan } = await supabase
    .from("booking_requests")
    .select(
      "id, tanggal, jam_mulai, variant_id, status_bayar, tenggat, bukti_objek, " +
        "alamat_lat, alamat_lon, services ( nama ), partners ( lat, lon )",
    )
    .eq("client_id", clientId)
    .eq("status", PERMINTAAN_MENUNGGU_BAYAR)
    .order("tenggat", { ascending: true })
    .returns<BarisPengajuan[]>();

  if (!pengajuan || pengajuan.length === 0) return [];

  const admin = createAdminSupabase();
  const [{ data: tarif }, { data: tarifTransport }] = await Promise.all([
    admin.from("variant_rates").select("variant_id, harga_klien, berlaku_sejak"),
    admin.from("transport_rates").select("jenjang, tarif_klien, berlaku_sejak"),
  ]);

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

  const hasil: TagihanPengajuan[] = [];
  for (const p of pengajuan) {
    let jenjang: JenjangTransport | null = null;
    if (
      p.partners?.lat != null &&
      p.partners?.lon != null &&
      p.alamat_lat != null &&
      p.alamat_lon != null
    ) {
      const { data } = await admin.rpc("jenjang_dari_jarak", {
        km: await jarak(admin, p.partners.lat, p.partners.lon, p.alamat_lat, p.alamat_lon),
      });
      jenjang = (data as JenjangTransport | null) ?? null;
    }

    const { data: khusus } = await admin
      .from("transport_khusus")
      .select("tarif_klien")
      .eq("session_id", p.id)
      .maybeSingle<{ tarif_klien: number }>();

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
        transportKhusus: khusus?.tarif_klien ?? null,
        tarif: barisTarif,
        tarifTransport: barisTransport,
      }),
    });
  }

  return hasil;
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
