import { createServerSupabase } from "@/lib/supabase/server";
import type { SebabTagihanTakLengkap } from "@/lib/tagihan/pengajuan";
import { labelSisaWaktu } from "@/lib/tagihan/tenggat";
import { formatRupiah } from "@/lib/rupiah-publik";
import { formatTanggalID } from "@/lib/passport/waktu";
import { PERMINTAAN_MENUNGGU_BAYAR } from "@/lib/jadwal/status";
import { LABEL_JENJANG } from "@/lib/transport/jarak";
import type { JenjangTransport } from "@/lib/transport/jarak";

/**
 * TAGIHAN WARISAN QRIS UNTUK LAYAR ADMIN (spec C2 P3, P4; dibatasi di B7).
 *
 * Hanya pengajuan yang TIDAK punya pesanan: yang terbit sebelum DOKU dan masih
 * menunggu verifikasi bukti QRIS, atau yang lunas dan buktinya belum dibuang.
 * Pengajuan yang punya pesanan dibayar lewat DOKU dan dikelola di
 * `/admin/pesanan`.
 *
 * Seluruhnya dibaca dengan SESI PENGGUNA — policy "booking: staf" dan
 * "pesanan: staf baca" yang memutuskan, jadi admin yang perannya dicabut
 * kehilangan aksesnya seketika. Angkanya dari `rincian_tagihan_permintaan`,
 * satu-satunya tempat rumus harga hidup.
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
  status_bayar: "belum" | "menunggu_verifikasi" | "lunas";
  tenggat: string | null;
  bukti_objek: string | null;
  updated_at?: string | null;
  clients: { nama: string } | null;
  services: { nama: string } | null;
};

type RincianSql = {
  layanan: number | null;
  transport: number | null;
  jenjang: JenjangTransport | null;
  sebab: string | null;
};

/**
 * @param buktiLama bila true, yang ditampilkan adalah tagihan LUNAS yang
 *   buktinya masih tersimpan lebih dari 90 hari. Bukti disimpan sampai dihapus
 *   manual (keputusan pemilik repo), dan tanpa saringan ini "manual" pada
 *   praktiknya berarti "tidak pernah" — yang menumpuk adalah tangkapan layar
 *   rekening orang.
 */
export async function daftarTagihanPengajuanAdmin(
  opsi: { buktiLama?: boolean } = {},
): Promise<BarisTagihanPengajuanAdmin[]> {
  const { buktiLama = false } = opsi;
  const supabase = await createServerSupabase();

  let q = supabase
    .from("booking_requests")
    .select(
      "id, tanggal, status_bayar, tenggat, bukti_objek, " +
        "clients ( nama ), services ( nama ), orders ( id )",
    )
    // Anti-join: tanpa satu pun pesanan, apa pun statusnya. Disaring di basis
    // data, bukan sesudah `limit`, supaya pengajuan DOKU yang menumpuk tidak
    // mendesak baris warisan keluar dari 100 baris pertama.
    .is("orders", null)
    .limit(100);

  if (buktiLama) {
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

  // Galat dibaca, bukan dibuang: `data: null` yang jatuh ke `[]` terbaca
  // "tidak ada yang menunggu", padahal yang rusak bacaannya.
  const { data, error } = await q.returns<BarisDb[]>();
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const hasil: BarisTagihanPengajuanAdmin[] = [];
  for (const p of data) {
    // GALAT RPC DILEMPAR, bukan dijatuhkan ke rincian kosong: rincian kosong
    // terbaca "tarif belum ada", diagnosis yang salah dan meyakinkan, dan admin
    // akan mencari di menu Tarif sesuatu yang tidak rusak.
    const { data: rincianBaris, error: galatRincian } = await supabase.rpc(
      "rincian_tagihan_permintaan",
      { p_permintaan_id: p.id },
    );
    if (galatRincian) throw galatRincian;
    const rincian = (rincianBaris as RincianSql[] | null)?.[0];
    if (!rincian) throw new Error(`Rincian tagihan ${p.id} tidak dipulangkan.`);
    const total =
      rincian.layanan === null || rincian.transport === null
        ? null
        : rincian.layanan + rincian.transport;

    hasil.push({
      permintaanId: p.id,
      namaKlien: p.clients?.nama ?? "Klien",
      namaLayanan: p.services?.nama ?? "Layanan",
      tanggal: formatTanggalID(p.tanggal),
      total: total === null ? null : formatRupiah(total),
      hargaLayanan: rincian.layanan === null ? null : formatRupiah(rincian.layanan),
      hargaTransport: rincian.transport === null ? null : formatRupiah(rincian.transport),
      labelJenjang: rincian.jenjang === null ? null : LABEL_JENJANG[rincian.jenjang],
      sebab: rincian.sebab as SebabTagihanTakLengkap | null,
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
