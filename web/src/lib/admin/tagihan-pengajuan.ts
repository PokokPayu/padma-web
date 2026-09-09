import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { hitungTagihanPengajuan } from "@/lib/tagihan/pengajuan";
import type { SebabTagihanTakLengkap } from "@/lib/tagihan/pengajuan";
import { labelSisaWaktu } from "@/lib/tagihan/tenggat";
import { formatRupiah } from "@/lib/rupiah-publik";
import { formatTanggalID } from "@/lib/passport/waktu";
import { PERMINTAAN_MENUNGGU_BAYAR } from "@/lib/jadwal/status";
import { LABEL_JENJANG } from "@/lib/transport/jarak";
import type { JenjangTransport } from "@/lib/transport/jarak";

/**
 * TAGIHAN PENGAJUAN UNTUK LAYAR ADMIN (spec C2 P3, P4).
 *
 * Barisnya dibaca dengan SESI PENGGUNA — policy "booking: staf" yang
 * memutuskan, jadi admin yang perannya dicabut kehilangan aksesnya seketika
 * tanpa satu baris kode pun berubah. Tarifnya dibaca service role karena
 * `transport_rates` berpolicy hanya-owner, dan admin memang bukan owner.
 */

export type BarisTagihanPengajuanAdmin = {
  permintaanId: string;
  namaKlien: string;
  namaLayanan: string;
  /** Sudah diformat untuk dibaca manusia. */
  tanggal: string;
  total: string | null;
  /**
   * Rincian, sudah diformat rupiah di server. Nominal memang lewat berkas ini
   * dan itu sudah begitu sejak C2 (pesan WhatsApp tagihan dirakit dari sini).
   * Yang TIDAK pernah lewat, dan tidak boleh mulai lewat: `honor_mitra`.
   */
  hargaLayanan: string | null;
  hargaTransport: string | null;
  /** Mis. ">10–15 km". Dari `LABEL_JENJANG`, satu-satunya sumber labelnya. */
  labelJenjang: string | null;
  /**
   * Terisi PERSIS ketika `total === null`. Inilah yang mengubah kegagalan
   * senyap menjadi kalimat yang bisa ditindak admin.
   */
  sebab: SebabTagihanTakLengkap | null;
  labelBayar: string;
  adaBukti: boolean;
  bisaDiverifikasi: boolean;
};

type BarisDb = {
  id: string;
  tanggal: string;
  variant_id: string;
  status_bayar: "belum" | "menunggu_verifikasi" | "lunas";
  tenggat: string | null;
  bukti_objek: string | null;
  alamat_lat: number | null;
  alamat_lon: number | null;
  updated_at?: string | null;
  clients: { nama: string } | null;
  services: { nama: string } | null;
  partners: { lat: number | null; lon: number | null } | null;
};

/**
 * @param buktiLama bila true, yang ditampilkan adalah tagihan LUNAS yang
 *   buktinya masih tersimpan lebih dari 90 hari. Bukti disimpan sampai dihapus
 *   manual (keputusan pemilik repo), dan tanpa saringan ini "manual" pada
 *   praktiknya berarti "tidak pernah" — yang menumpuk adalah tangkapan layar
 *   rekening orang.
 */
export async function daftarTagihanPengajuanAdmin(
  opsi: { buktiLama?: boolean; permintaanId?: string } = {},
): Promise<BarisTagihanPengajuanAdmin[]> {
  const { buktiLama = false, permintaanId } = opsi;
  const supabase = await createServerSupabase();

  let q = supabase
    .from("booking_requests")
    .select(
      "id, tanggal, variant_id, status_bayar, tenggat, bukti_objek, alamat_lat, alamat_lon, " +
        "clients ( nama ), services ( nama ), partners ( lat, lon )",
    )
    .limit(100);

  if (permintaanId) {
    // SATU permintaan, APA PUN statusnya. Dipakai gerbang `terbitkanTagihan()`,
    // yang harus tahu totalnya SEBELUM status berpindah ke `menunggu_bayar` —
    // saringan status di cabang ketiga justru menyembunyikan baris yang sedang
    // hendak diperiksa, dan gerbang yang tidak pernah menemukan barisnya adalah
    // gerbang yang tidak pernah menutup.
    q = q.eq("id", permintaanId);
  } else if (buktiLama) {
    // Lunas, masih memegang bukti, dan tenggatnya sudah lewat 90 hari.
    // `tenggat` dipakai sebagai penanda waktu karena ia satu-satunya cap waktu
    // yang pasti ada pada tagihan yang pernah terbit.
    const batas = new Date(Date.now() - 90 * 86_400_000).toISOString();
    q = q
      .eq("status_bayar", "lunas")
      .not("bukti_objek", "is", null)
      .lt("tenggat", batas);
  } else {
    q = q.eq("status", PERMINTAAN_MENUNGGU_BAYAR).order("tenggat", { ascending: true });
  }

  // GALAT DIBACA, BUKAN DIBUANG — dan di sini akibatnya lebih berat daripada
  // layar kosong. Draf sebelumnya menulis `const { data } = await q...`, jadi
  // galat PostgREST (PGRST205 saat schema cache belum reload sesudah deploy,
  // 42703 kolom embed salah, timeout) memulangkan `data: null` yang jatuh ke
  // `[]`. Pemanggil terpentingnya bukan sebuah daftar, melainkan GERBANG
  // penerbitan tagihan di `terbitkanTagihan()` (`app/admin/sesi/aksi.ts`):
  // `[]` di sana terbaca sebagai `rincianAwal === null`, gerbangnya DILEWATI,
  // status berpindah ke `menunggu_bayar`, tenggat 24 jam mulai berjalan, dan
  // pesan WhatsApp-nya kembali berbunyi "Total: menyusul dari tim" — persis
  // gejala yang seluruh cabang ini dibangun untuk membunuh. Gerbang yang
  // gagal-TERBUKA bukan gerbang.
  //
  // Pola dan alasannya sama persis dengan `ambilDaftarPermintaan()`
  // (`lib/admin/permintaan.ts`, commit 885b86e): lempar, jangan menyamar jadi
  // hasil kosong. Pemanggil yang perlu bertahan hidup menangkapnya sendiri —
  // `terbitkanTagihan()` menerjemahkannya jadi penolakan yang bisa ditindak,
  // dan `kirimEmailTagihan()` sudah punya `try/catch` yang menjadikannya
  // "email tidak terkirim", bukan "tagihan tidak terbit".
  const { data, error } = await q.returns<BarisDb[]>();
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const admin = createAdminSupabase();
  const [{ data: tarif, error: galatTarif }, { data: tarifTransport, error: galatTransport }] =
    await Promise.all([
      admin.from("variant_rates").select("variant_id, harga_klien, berlaku_sejak"),
      admin.from("transport_rates").select("jenjang, tarif_klien, berlaku_sejak"),
    ]);
  // KEGAGALAN INFRASTRUKTUR TIDAK BOLEH MENYAMAR JADI DIAGNOSIS.
  //
  // `(tarif ?? [])` pada galat menghasilkan daftar tarif KOSONG, dan daftar
  // kosong bukan keadaan netral di sini: `hitungTagihanPengajuan()` akan
  // memulangkan `total: null` dengan sebab `tarif_varian_kosong`, yang
  // `KALIMAT_SEBAB_ADMIN` terjemahkan menjadi "Belum ada tarif varian yang
  // berlaku pada tanggal sesi ini. Owner menetapkannya di menu Tarif." Admin
  // lalu membuka menu Tarif, melihat tarifnya SUDAH ADA di sana, dan tidak
  // punya satu pun petunjuk bahwa yang rusak adalah bacaannya. Diagnosis yang
  // salah dan meyakinkan lebih mahal daripada galat yang jujur.
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

  const hasil: BarisTagihanPengajuanAdmin[] = [];
  for (const p of data) {
    let jenjang: JenjangTransport | null = null;
    if (
      p.partners?.lat != null &&
      p.partners?.lon != null &&
      p.alamat_lat != null &&
      p.alamat_lon != null
    ) {
      const { data: km } = await admin.rpc("jarak_km", {
        lat1: p.partners.lat,
        lon1: p.partners.lon,
        lat2: p.alamat_lat,
        lon2: p.alamat_lon,
      });
      const { data: j } = await admin.rpc("jenjang_dari_jarak", { km: km ?? 0 });
      jenjang = (j as JenjangTransport | null) ?? null;
    }

    const mitraBertitik = p.partners?.lat != null && p.partners?.lon != null;

    const rincian = hitungTagihanPengajuan({
      variantId: p.variant_id,
      tanggal: p.tanggal,
      jenjang,
      sebabJenjangNull: mitraBertitik ? "alamat_tanpa_pin" : "mitra_tanpa_titik",
      tarif: barisTarif,
      tarifTransport: barisTransport,
    });

    hasil.push({
      permintaanId: p.id,
      namaKlien: p.clients?.nama ?? "Klien",
      namaLayanan: p.services?.nama ?? "Layanan",
      tanggal: formatTanggalID(p.tanggal),
      total: rincian.total === null ? null : formatRupiah(rincian.total),
      hargaLayanan: rincian.layanan === null ? null : formatRupiah(rincian.layanan),
      hargaTransport: rincian.transport === null ? null : formatRupiah(rincian.transport),
      labelJenjang: rincian.jenjang === null ? null : LABEL_JENJANG[rincian.jenjang],
      sebab: rincian.sebab,
      labelBayar:
        p.status_bayar === "lunas"
          ? "lunas"
          : p.status_bayar === "menunggu_verifikasi"
            ? "bukti masuk — perlu dicocokkan dengan mutasi"
            : `belum dibayar · ${labelSisaWaktu(p.tenggat)}`,
      adaBukti: Boolean(p.bukti_objek),
      // Hanya yang buktinya sudah masuk. Menandai lunas sesuatu yang belum
      // pernah dibayar adalah satu klik yang menghapus seluruh gunanya rantai
      // ini.
      bisaDiverifikasi: p.status_bayar === "menunggu_verifikasi",
    });
  }

  return hasil;
}
