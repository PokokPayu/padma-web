/**
 * Agenda hari ini & aktivitas terbaru (`src/lib/admin/agenda.ts`).
 *
 * Yang dijaga:
 *  1. "Hari ini" menurut kalender JAKARTA, bukan jam server — Vercel berjalan
 *     UTC, sehingga agenda akan bergeser satu hari selama tujuh jam setiap
 *     hari bila tanggalnya diambil dari `new Date()` di server.
 *  2. Sesi BATAL tidak muncul di agenda. Bidan yang datang ke rumah klien
 *     karena membaca baris yang sudah dibatalkan adalah kerugian nyata.
 *  3. Sesi pengguna, bukan service role.
 *  4. Money firewall — tidak menyentuh tabel uang.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { signInAs } from "./helpers/as-user";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const admin = createAdminSupabase();

const KLIEN_UJI = "44444444-4444-4444-4444-4444444444f8";
const PADMA_ID_UJI = "PAD-UJI-0008";
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333301";
const SESI = {
  hariIni: "66666666-6666-6666-6666-6666666681f8",
  batalHariIni: "66666666-6666-6666-6666-6666666682f8",
  besok: "66666666-6666-6666-6666-6666666683f8",
};
const KODE_SKRINING = "PDM-UJI-AGENDA-0008";
const PERMINTAAN_UJI = "88888888-8888-8888-8888-8888888888f8";

const HARI_INI = hariIniJakarta();

async function bersihkan() {
  for (const id of Object.values(SESI)) {
    await admin.from("sessions").delete().eq("id", id);
    await admin.from("jejak_status_bayar").delete().eq("sesi_id", id);
  }
  await admin.from("booking_requests").delete().eq("id", PERMINTAAN_UJI);
  await admin.from("screenings").delete().eq("kode", KODE_SKRINING);
  await admin.from("clients").delete().eq("id", KLIEN_UJI);
}

const { agendaHariIni, aktivitasTerbaru } = await import("@/lib/admin/agenda");

beforeAll(async () => {
  await bersihkan();
  ref.sesi = await signInAs("admin@padma.test");

  await admin.from("clients").insert({
    id: KLIEN_UJI,
    padma_id: PADMA_ID_UJI,
    nama: "Uji Agenda",
    email: "uji-agenda@padma.test",
    phase_id: "prekonsepsi",
  });

  const dasarSesi = {
    client_id: KLIEN_UJI,
    service_id: SVC,
    partner_id: MITRA,
    status_bayar: "belum" as const,
    catatan: "",
    rekomendasi: "",
  };
  await admin.from("sessions").insert([
    { ...dasarSesi, id: SESI.hariIni, tanggal: HARI_INI, status: "terjadwal" },
    { ...dasarSesi, id: SESI.batalHariIni, tanggal: HARI_INI, status: "batal" },
    { ...dasarSesi, id: SESI.besok, tanggal: "2027-12-24", status: "terjadwal" },
  ]);
  await admin.from("screenings").insert({
    kode: KODE_SKRINING,
    nama: "Uji Agenda Skrining",
    no_hp: "0812-0000-8888",
    fase: "prekonsepsi",
    jawaban: {},
    hasil: "hijau",
    status_tindak_lanjut: "baru",
  });
  await admin.from("booking_requests").insert({
    id: PERMINTAAN_UJI,
    client_id: KLIEN_UJI,
    service_id: SVC,
    tanggal: "2027-12-24",
    preferensi_waktu: "pagi",
    status: "menunggu",
  });
});

afterAll(bersihkan);

describe("agendaHariIni", () => {
  it("memuat sesi hari ini, dengan nama klien, layanan, dan mitranya", async () => {
    const agenda = await agendaHariIni(HARI_INI);
    const baris = agenda.find((s) => s.id === SESI.hariIni);
    expect(baris).toBeDefined();
    expect(baris!.namaKlien).toBe("Uji Agenda");
    expect(baris!.padmaId).toBe(PADMA_ID_UJI);
    // Nama nyata dari supabase/seed.sql, bukan sekadar "tidak kosong" — string
    // fallback generik ("Layanan", "Mitra PADMA") juga lolos length > 0 walau
    // join clients/services/partners gagal total.
    expect(baris!.namaLayanan).toBe("Sankalpa Fertility Massage");
    expect(baris!.namaMitra).toBe("Bidan Sri Wahyuni");
  });

  it("sesi BATAL tidak muncul", async () => {
    const agenda = await agendaHariIni(HARI_INI);
    expect(agenda.some((s) => s.id === SESI.batalHariIni)).toBe(false);
  });

  it("sesi hari lain tidak muncul", async () => {
    const agenda = await agendaHariIni(HARI_INI);
    expect(agenda.some((s) => s.id === SESI.besok)).toBe(false);
  });

  it("tanggalnya datang sebagai argumen, tidak dibaca dari jam server", () => {
    // Vercel berjalan UTC; `new Date()` di dalam lapisan ini akan menggeser
    // agenda satu hari selama tujuh jam setiap hari.
    const sumber = baca("src/lib/admin/agenda.ts");
    expect(sumber).not.toContain("new Date()");
  });
});

describe("aktivitasTerbaru", () => {
  it("menggabungkan skrining masuk dan permintaan jadwal", async () => {
    const aktivitas = await aktivitasTerbaru(20);
    expect(aktivitas.some((a) => a.jenis === "skrining")).toBe(true);
    expect(aktivitas.some((a) => a.jenis === "permintaan")).toBe(true);
  });

  it("terbaru di atas", async () => {
    const aktivitas = await aktivitasTerbaru(20);
    for (let i = 1; i < aktivitas.length; i++) {
      expect(aktivitas[i - 1].pada >= aktivitas[i].pada).toBe(true);
    }
  });

  it("menghormati batas jumlah baris", async () => {
    expect((await aktivitasTerbaru(2)).length).toBeLessThanOrEqual(2);
  });

  it("setiap baris menautkan modul yang menanganinya", async () => {
    // Bukan sekadar berawalan "/admin/" — itu juga lolos bila skrining dan
    // permintaan tertukar arah tautannya. Skrining harus ke /admin/skrining,
    // permintaan harus ke /admin/sesi.
    for (const a of await aktivitasTerbaru(20)) {
      expect(a.href).toBe(a.jenis === "skrining" ? "/admin/skrining" : "/admin/sesi");
    }
  });
});

describe("pagar lapisan agenda", () => {
  it("sesi pengguna, tanpa service role, tanpa tabel uang", () => {
    const sumber = baca("src/lib/admin/agenda.ts");
    expect(sumber).toContain("createServerSupabase");
    expect(sumber).not.toContain("createAdminSupabase");
    expect(sumber).not.toContain("SERVICE_ROLE");
    expect(sumber).not.toContain("service_rates");
    expect(sumber).not.toContain("honor_marks");
    expect(sumber).not.toMatch(/Rp\s?\d|formatRupiah/);
  });

  it("klien tidak melihat agenda klinik", async () => {
    const sebelumnya = ref.sesi;
    ref.sesi = await signInAs("ananda@padma.test");
    const agenda = await agendaHariIni(HARI_INI);
    const aktivitas = await aktivitasTerbaru(20);
    ref.sesi = sebelumnya;
    expect(agenda.some((s) => s.id === SESI.hariIni)).toBe(false);
    // Skrining tidak pernah terbaca klien sama sekali.
    expect(aktivitas.some((a) => a.jenis === "skrining")).toBe(false);
  });
});
