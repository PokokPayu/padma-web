// tests/materi-penugasan-lib.test.ts
//
// `daftarPenugasan` (src/lib/admin/penugasan.ts) memanggil createServerSupabase(),
// yang membaca cookies() dari next/headers — hanya bermakna di request scope
// Next.js, dan meledak kalau diimpor telanjang dari Vitest. Pola di bawah
// PERSIS seperti tests/passport-data.test.ts: modul penyedia klien diganti
// agar mengembalikan klien BER-SESI NYATA hasil signInAs, sehingga fungsi
// yang SUNGGUHAN tetap berjalan lewat RLS staf sungguhan — bukan
// reimplementasi query-nya di berkas test.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signInAs } from "./helpers/as-user";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const svc = () =>
  createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

const ref = vi.hoisted(() => ({ klien: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.klien!,
}));

describe("daftarPenugasan — otomatis mengikuti aturan yang sama dengan berhak_isi_materi", () => {
  let serviceId = "";
  let materiId = "";
  let klienId = "";

  beforeAll(async () => {
    const db = svc();
    const { data: k } = await db
      .from("clients")
      .select("id")
      .eq("email", "ananda@padma.test")
      .single();
    klienId = k!.id;

    const { data: layanan, error: eLayanan } = await db
      .from("services")
      .insert({ phase_id: "prekonsepsi", nama: "UJI-TASK9-FIX-AKTIF" })
      .select("id")
      .single();
    if (eLayanan) throw eLayanan;
    serviceId = layanan!.id;

    const { data: m, error: eMateri } = await db
      .from("materials")
      .insert({
        judul: "UJI-TASK9-FIX-AKTIF", tipe: "ebook", deskripsi: "", aktif: true,
        service_id: serviceId,
      })
      .select("id")
      .single();
    if (eMateri) throw eMateri;
    materiId = m!.id;

    const { error: eMs } = await db
      .from("material_services")
      .insert({ material_id: materiId, service_id: serviceId });
    if (eMs) throw eMs;

    // Ananda menyelesaikan sesi pada layanan yang tertaut materi ini — inilah
    // yang seharusnya membuatnya muncul di "otomatis" SELAMA materinya aktif.
    const { error: eSesi } = await db.from("sessions").insert({
      client_id: klienId, service_id: serviceId,
      partner_id: "33333333-3333-3333-3333-333333333301",
      tanggal: "2026-01-01", status: "selesai",
    });
    if (eSesi) throw eSesi;
  });

  afterAll(async () => {
    const db = svc();
    // Urutan wajib: sessions dulu (referensi service_id tanpa cascade), lalu
    // materials (cascade menyapu material_assignments & material_services),
    // baru services.
    await db.from("sessions").delete().eq("service_id", serviceId);
    await db.from("materials").delete().eq("id", materiId);
    await db.from("services").delete().eq("id", serviceId);
  });

  it("materi AKTIF: klien dengan sesi selesai muncul di otomatis", async () => {
    ref.klien = await signInAs("admin@padma.test");
    const { daftarPenugasan } = await import("@/lib/admin/penugasan");
    const hasil = await daftarPenugasan(materiId);
    expect(hasil.otomatis.map((p) => p.clientId)).toContain(klienId);
  });

  it("materi DINONAKTIFKAN: otomatis kosong walau sesi yang sama masih 'selesai'", async () => {
    const db = svc();
    const { error } = await db.from("materials").update({ aktif: false }).eq("id", materiId);
    expect(error).toBeNull();

    ref.klien = await signInAs("admin@padma.test");
    const { daftarPenugasan } = await import("@/lib/admin/penugasan");
    const hasil = await daftarPenugasan(materiId);
    // berhak_isi_materi() menyaratkan m.aktif = true SEBELUM kedua cabangnya
    // dievaluasi (migration 20260831110000_materi_penugasan.sql) — materi
    // nonaktif tidak membuka isinya untuk siapa pun, jadi panel ini tidak
    // boleh menyatakan sebaliknya.
    expect(hasil.otomatis).toEqual([]);

    await db.from("materials").update({ aktif: true }).eq("id", materiId);
  });
});
