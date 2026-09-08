/**
 * SIAPA YANG BOLEH MEMBACA APA SAAT TAGIHAN DIRAKIT (spec C2 P2).
 *
 * Berkas ini lahir dari cacat sungguhan yang lolos SELURUH uji unit C2 dan baru
 * tertangkap E2E: `ambilTagihanPengajuan` meng-embed `partners ( lat, lon )` ke
 * dalam query yang dijalankan dengan SESI KLIEN. `partners` berpolicy staf,
 * dan PostgREST memulangkan embed yang tidak berhak sebagai `null` — bukan
 * sebagai galat. Akibatnya jenjang transport selalu tak diketahui, total selalu
 * `null`, dan SETIAP klien melihat "Totalnya sedang dilengkapi tim PADMA".
 * Fiturnya mati sepenuhnya tanpa satu baris pun di log.
 *
 * Uji unit tidak bisa melihatnya karena semuanya membaca dengan service role —
 * yang justru menyembunyikan persis pagar yang sedang salah dipakai. Jadi yang
 * dikunci di sini dua hal yang berpasangan: FAKTA hak-nya di basis data, dan
 * BENTUK query-nya di sumber.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { skriningHijau } from "./helpers/skrining";

const admin = createAdminSupabase();

const ANANDA = "44444444-4444-4444-4444-444444444401";
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333301";
const TGL = "2027-08-21";

let sesiKlien: SupabaseClient;
let idPengajuan: string;

async function bersihkan() {
  await admin.from("booking_requests").delete().eq("tanggal", TGL);
  await admin.from("screenings").delete().like("kode", "UJI-%");
}

beforeAll(async () => {
  sesiKlien = await signInAs("ananda@padma.test");
  await bersihkan();

  const varian = await varianBaku(admin, SVC);
  const skrining = await skriningHijau(admin, ANANDA);
  const { data, error } = await admin
    .from("booking_requests")
    .insert({
      client_id: ANANDA,
      service_id: SVC,
      variant_id: varian,
      partner_id: MITRA,
      screening_id: skrining,
      tanggal: TGL,
      jam_mulai: "09:00",
      preferensi_waktu: "pagi",
      alamat: "Jl. Uji Hak Baca No. 3",
      alamat_lat: -7.9666,
      alamat_lon: 112.6966,
      status: "menunggu_bayar",
      status_bayar: "belum",
      tenggat: new Date(Date.now() + 3_600_000).toISOString(),
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw error;
  idPengajuan = data.id;
});

afterAll(bersihkan);

describe("klien memang tidak berhak atas `partners`", () => {
  it("membaca `partners` langsung memulangkan NOL baris, bukan galat", async () => {
    // Nol baris tanpa galat adalah bentuk kegagalan yang paling mudah dilewati:
    // kode pemanggil yang memeriksa `error` akan mengira semuanya baik-baik saja.
    const { data, error } = await sesiKlien.from("partners").select("id, lat, lon");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("embed `partners ( lat, lon )` pada pengajuan MILIKNYA SENDIRI juga null", async () => {
    // Barisnya terbaca — policy "booking: klien baca miliknya" bekerja. Yang
    // KOSONG hanya embed-nya, dan justru itu yang berbahaya: bentuk datanya
    // tampak lengkap, isinya tidak.
    const { data } = await sesiKlien
      .from("booking_requests")
      .select("id, partner_id, partners ( lat, lon )")
      .eq("id", idPengajuan)
      .single<{ id: string; partner_id: string; partners: unknown }>();

    expect(data?.id).toBe(idPengajuan);
    expect(data?.partner_id, "partner_id sendiri tetap terbaca").toBe(MITRA);
    expect(data?.partners, "embed partners TERNYATA berisi — pagar berubah").toBeNull();
  });
});

describe("pembaca tagihan tidak meng-embed tabel berpolicy staf ke query sesi klien", () => {
  const sumber = readFileSync(path.resolve(__dirname, "..", "src/lib/tagihan/baca.ts"), "utf8");

  it("query sesi klien tidak menyebut embed `partners (`", () => {
    // Pagar bentuk, bukan pagar perilaku — dan itu disengaja. Fungsinya membaca
    // lewat `createServerSupabase()` yang menuntut cookie permintaan, jadi ia
    // tidak bisa dipanggil dari vitest sama sekali. Yang bisa dijaga dari sini
    // adalah bentuk query-nya, dan bentuk itulah yang dulu salah.
    const tanpaKomentar = sumber
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(tanpaKomentar).not.toMatch(/partners\s*\(/);
  });

  it("koordinat mitra dibaca lewat klien service role", () => {
    expect(sumber).toMatch(/admin\s*\n?\s*\.from\("partners"\)/);
  });
});
