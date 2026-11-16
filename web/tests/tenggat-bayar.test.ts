/**
 * TENGGAT BAYAR & SKRINING (spec C2 P5).
 *
 * Pembatal tenggat (`batalkan_lewat_tenggat`, `/api/cron/tenggat`) dipensiunkan
 * di P3/B7 dan pagarnya ada di `pensiun-qris-pengajuan.test.ts`. Yang tersisa:
 * fungsi murni tenggat, dan pembedaan bahwa batal-oleh-klien TIDAK melepas
 * skrining (kondisi kesehatan bisa berubah di antara dua percobaan memesan).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { skriningHijau } from "./helpers/skrining";
import { sisaJam, labelSisaWaktu } from "@/lib/tagihan/tenggat";
import { JAM_TENGGAT_PESANAN } from "@/lib/pesanan/status";

const admin = createAdminSupabase();

const ANANDA = "44444444-4444-4444-4444-444444444401";
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333301";
const TGL = "2027-07-10";

let VARIAN: string;
let sesiAnanda: SupabaseClient;

async function bersihkan() {
  await admin.from("booking_requests").delete().eq("tanggal", TGL);
  await admin.from("screenings").delete().like("kode", "UJI-%");
}

/** Pengajuan `menunggu_bayar` yang tenggatnya masih satu jam lagi. */
async function pengajuanMenungguBayar(): Promise<{ id: string; skriningId: string }> {
  const skriningId = await skriningHijau(admin, ANANDA);
  const tenggat = new Date(Date.now() + 3_600_000).toISOString();

  const { data, error } = await admin
    .from("booking_requests")
    .insert({
      client_id: ANANDA,
      service_id: SVC,
      variant_id: VARIAN,
      partner_id: MITRA,
      screening_id: skriningId,
      tanggal: TGL,
      jam_mulai: "09:00",
      preferensi_waktu: "pagi",
      alamat: "Jl. Uji Tenggat No. 9",
      status: "menunggu_bayar",
      status_bayar: "belum",
      tenggat,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw error;
  return { id: data.id, skriningId };
}

async function baca(id: string) {
  const { data } = await admin
    .from("booking_requests")
    .select("status, screening_id, status_bayar")
    .eq("id", id)
    .maybeSingle<{ status: string; screening_id: string | null; status_bayar: string }>();
  return data;
}

beforeAll(async () => {
  sesiAnanda = await signInAs("ananda@padma.test");
  VARIAN = await varianBaku(admin, SVC);
  await bersihkan();
});

beforeEach(bersihkan);
afterAll(bersihkan);

describe("fungsi murni tenggat", () => {
  it("tenggatnya 24 jam (satu konstanta untuk produk dan sesi sejak P3/B2)", () => {
    expect(JAM_TENGGAT_PESANAN).toBe(24);
  });

  it("sisa jam negatif berarti sudah lewat", () => {
    const sekarang = new Date("2026-09-10T10:00:00Z");
    expect(sisaJam("2026-09-10T15:00:00Z", sekarang)).toBe(5);
    expect(sisaJam("2026-09-10T08:00:00Z", sekarang)).toBe(-2);
  });

  it("label sisa waktu bisa dibaca manusia", () => {
    const sekarang = new Date("2026-09-10T10:00:00Z");
    expect(labelSisaWaktu("2026-09-10T15:00:00Z", sekarang)).toBe("5 jam lagi");
    expect(labelSisaWaktu("2026-09-10T10:30:00Z", sekarang)).toBe("30 menit lagi");
    expect(labelSisaWaktu("2026-09-10T09:00:00Z", sekarang)).toBe("sudah lewat");
  });
});

describe("pembatalan oleh klien tidak mengembalikan skrining", () => {
  it("BATAL-OLEH-KLIEN TIDAK mengembalikan skrining", async () => {
    // Inilah pembedaannya, dan ia disengaja. Membatalkan adalah KEPUTUSAN
    // orang; kondisi kesehatan bisa berubah di antara dua percobaan memesan,
    // jadi skriningnya memang harus diulang (spec C1 J3). Tenggat yang lewat
    // bukan keputusan.
    const { id, skriningId } = await pengajuanMenungguBayar();

    const { error } = await sesiAnanda
      .from("booking_requests")
      .update({ status: "dibatalkan_klien" })
      .eq("id", id)
      .select("id");
    expect(error).toBeNull();

    const baris = await baca(id);
    expect(baris?.status).toBe("dibatalkan_klien");
    expect(baris?.screening_id, "skrining ikut dilepas padahal klien yang membatalkan").toBe(
      skriningId,
    );
  });
});

describe("gerbang skrining tetap menahan sesudah kolomnya dilonggarkan", () => {
  it("klien tidak bisa menyisipkan pengajuan TANPA skrining", async () => {
    // Kolomnya kini nullable supaya bisa DILEPAS saat batal-tenggat. Yang
    // menjaga berpindah ke trigger — melonggarkan kolom tanpa memindahkan
    // gerbangnya adalah cara paling mudah membuka kembali lubang C1-b.
    const { error } = await sesiAnanda.from("booking_requests").insert({
      client_id: ANANDA,
      service_id: SVC,
      variant_id: VARIAN,
      tanggal: TGL,
      jam_mulai: "09:00",
      preferensi_waktu: "pagi",
      alamat: "Jl. Uji Tanpa Skrining",
      status: "diminta",
      screening_id: null,
    });
    expect(error).not.toBeNull();
  });
});
