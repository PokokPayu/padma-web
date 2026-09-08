/**
 * TENGGAT BAYAR & SKRINING YANG DIKEMBALIKAN (spec C2 P5, P6).
 *
 * Uji terpenting di berkas ini adalah dua yang BERDAMPINGAN di bagian terakhir:
 * batal-karena-tenggat mengembalikan skrining, batal-oleh-klien tidak. Itu
 * pembedaan yang paling mudah hilang saat kode dirapikan — keduanya "batal",
 * dan siapa pun yang menyatukannya akan merasa sedang menyederhanakan.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { skriningHijau } from "./helpers/skrining";
import { querySql } from "./helpers/db";
import { sisaJam, sudahLewatTenggat, labelSisaWaktu, JAM_TENGGAT_BAYAR } from "@/lib/tagihan/tenggat";

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

/** Pengajuan `menunggu_bayar` dengan tenggat yang bisa diatur. */
async function pengajuanMenungguBayar(opsi: {
  lewat?: boolean;
  lunas?: boolean;
}): Promise<{ id: string; skriningId: string }> {
  const skriningId = await skriningHijau(admin, ANANDA);
  const tenggat = new Date(Date.now() + (opsi.lewat ? -60_000 : 3_600_000)).toISOString();

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
      status_bayar: opsi.lunas ? "lunas" : "belum",
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
  it("tenggatnya 24 jam", () => {
    expect(JAM_TENGGAT_BAYAR).toBe(24);
  });

  it("sisa jam negatif berarti sudah lewat", () => {
    const sekarang = new Date("2026-09-10T10:00:00Z");
    expect(sisaJam("2026-09-10T15:00:00Z", sekarang)).toBe(5);
    expect(sisaJam("2026-09-10T08:00:00Z", sekarang)).toBe(-2);
  });

  it("tenggat NULL tidak pernah dianggap lewat", () => {
    // Tagihan yang belum terbit tidak punya tenggat, dan yang belum terbit
    // tidak bisa lewat. Memperlakukan NULL sebagai lewat akan membatalkan
    // setiap pengajuan yang baru masuk antrean.
    expect(sudahLewatTenggat(null)).toBe(false);
    expect(sudahLewatTenggat(undefined)).toBe(false);
  });

  it("label sisa waktu bisa dibaca manusia", () => {
    const sekarang = new Date("2026-09-10T10:00:00Z");
    expect(labelSisaWaktu("2026-09-10T15:00:00Z", sekarang)).toBe("5 jam lagi");
    expect(labelSisaWaktu("2026-09-10T10:30:00Z", sekarang)).toBe("30 menit lagi");
    expect(labelSisaWaktu("2026-09-10T09:00:00Z", sekarang)).toBe("sudah lewat");
  });
});

describe("pembatal terjadwal", () => {
  it("membatalkan yang lewat tenggat, dan MENGEMBALIKAN skriningnya", async () => {
    const { id, skriningId } = await pengajuanMenungguBayar({ lewat: true });

    await querySql("select public.batalkan_lewat_tenggat()");

    const baris = await baca(id);
    expect(baris?.status).toBe("dibatalkan_tenggat");
    expect(baris?.screening_id, "skrining tidak dikembalikan").toBeNull();

    // Dan skriningnya benar-benar bebas dipakai lagi: indeks uniknya parsial,
    // jadi tidak ada baris lain yang masih memegangnya.
    const pemegang = await querySql<{ jml: string }>(
      "select count(*) as jml from public.booking_requests where screening_id = $1",
      [skriningId],
    );
    expect(Number(pemegang[0].jml)).toBe(0);
  });

  it("TIDAK menyentuh yang belum lewat tenggat", async () => {
    const { id } = await pengajuanMenungguBayar({ lewat: false });
    await querySql("select public.batalkan_lewat_tenggat()");
    expect((await baca(id))?.status).toBe("menunggu_bayar");
  });

  it("TIDAK PERNAH membatalkan yang sudah LUNAS, walau tenggatnya lewat", async () => {
    // Uangnya sudah masuk, admin hanya belum sempat mengonfirmasi. Yang hilang
    // di sini bukan slot, melainkan uang orang.
    const { id } = await pengajuanMenungguBayar({ lewat: true, lunas: true });
    await querySql("select public.batalkan_lewat_tenggat()");
    expect((await baca(id))?.status).toBe("menunggu_bayar");
  });

  it("IDEMPOTEN — dijalankan dua kali tidak membatalkan dua kali", async () => {
    await pengajuanMenungguBayar({ lewat: true });

    const pertama = await querySql<{ batalkan_lewat_tenggat: number }>(
      "select public.batalkan_lewat_tenggat()",
    );
    const kedua = await querySql<{ batalkan_lewat_tenggat: number }>(
      "select public.batalkan_lewat_tenggat()",
    );

    expect(Number(pertama[0].batalkan_lewat_tenggat)).toBe(1);
    expect(Number(kedua[0].batalkan_lewat_tenggat)).toBe(0);
  });

  it("tidak bisa dipanggil peran API mana pun", async () => {
    const baris = await querySql<{ ada: boolean }>(
      `select has_function_privilege('authenticated',
         'public.batalkan_lewat_tenggat()', 'execute') as ada`,
    );
    expect(baris[0].ada).toBe(false);
  });
});

describe("DUA jenis pembatalan, DUA akibat berbeda", () => {
  it("BATAL-TENGGAT mengembalikan skrining", async () => {
    const { id } = await pengajuanMenungguBayar({ lewat: true });
    await querySql("select public.batalkan_lewat_tenggat()");

    const baris = await baca(id);
    expect(baris?.status).toBe("dibatalkan_tenggat");
    expect(baris?.screening_id).toBeNull();
  });

  it("BATAL-OLEH-KLIEN TIDAK mengembalikan skrining", async () => {
    // Inilah pembedaannya, dan ia disengaja. Membatalkan adalah KEPUTUSAN
    // orang; kondisi kesehatan bisa berubah di antara dua percobaan memesan,
    // jadi skriningnya memang harus diulang (spec C1 J3). Tenggat yang lewat
    // bukan keputusan.
    const { id, skriningId } = await pengajuanMenungguBayar({ lewat: false });

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
