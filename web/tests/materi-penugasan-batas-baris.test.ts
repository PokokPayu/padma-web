// tests/materi-penugasan-batas-baris.test.ts
//
// Bukti PERILAKU untuk Fix 2 (final review branch materi-ebook-pdf), bagian
// `daftarPenugasan` (src/lib/admin/penugasan.ts): query "otomatis" menarik
// SATU BARIS `sessions` PER SESI `selesai`, bukan satu baris per klien —
// dedup ke klien terjadi di JS SESUDAH baris terbaca. Tanpa `.range()`,
// PostgREST memotong jawaban di `max_rows` (1000, lihat supabase/config.toml
// & PGRST_DB_MAX_ROWS container ini): begitu total sesi `selesai` yang
// cocok melewati 1000, sebagian baris tidak pernah terbaca, dan klien yang
// baris satu-satunya jatuh di potongan yang terpotong lenyap dari panel
// "otomatis" — bukan lubang RLS (`berhak_isi_materi()` tetap benar), tapi
// panel yang berbohong ke admin.
//
// Test ini membuat pembuktiannya TIDAK bergantung pada urutan baris yang
// dikembalikan Postgres (yang tidak dijamin SQL): 1001 SESI, masing-masing
// milik SATU klien BERBEDA (1001 klien uji sekali pakai), untuk SATU layanan.
// Tanpa paginasi, PostgREST menjawab TEPAT 1000 baris (max_rows), berapa pun
// urutannya — jadi PANJANG hasil "otomatis" tidak mungkin 1001 lewat query
// lama, apa pun baris yang kebetulan lolos. Dengan paginasi (`.range()`
// dipanggil sampai habis), seluruh 1001 klien harus muncul.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const admin = createAdminSupabase();
const PARTNER_ID = "33333333-3333-3333-3333-333333333301"; // partner seed sungguhan

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const { daftarPenugasan } = await import("@/lib/admin/penugasan");

// 1001 dipilih: melewati max_rows (1000) dengan margin sekecil mungkin yang
// TETAP tidak bisa disalahkan sebagai off-by-one di batasnya (>1000, bukan
// =1000) — satu bulk insert, bukan 1001 panggilan API.
const JUMLAH_KLIEN = 1001;

describe("daftarPenugasan — 'otomatis' tidak terpotong PostgREST max_rows (Fix 2)", () => {
  let serviceId = "";
  let materiId = "";
  const klienIds: string[] = [];

  beforeAll(async () => {
    const { data: layanan, error: eLayanan } = await admin
      .from("services")
      .insert({ phase_id: "prekonsepsi", nama: "PAD-UJI-CAP-OTOMATIS" })
      .select("id")
      .single();
    if (eLayanan) throw eLayanan;
    serviceId = layanan!.id as string;

    const { data: m, error: eMateri } = await admin
      .from("materials")
      .insert({ judul: "PAD-UJI-CAP-OTOMATIS", tipe: "ebook", deskripsi: "", aktif: true })
      .select("id")
      .single();
    if (eMateri) throw eMateri;
    materiId = m!.id as string;

    const { error: eMs } = await admin
      .from("material_services")
      .insert({ material_id: materiId, service_id: serviceId });
    if (eMs) throw eMs;

    // 1001 klien SEKALI PAKAI, satu bulk insert — masing-masing menyumbang
    // TEPAT satu sesi 'selesai' di bawah, supaya panjang "otomatis" ADALAH
    // jumlah klien yang lolos, tidak disamarkan dedup.
    const { data: klien, error: eKlien } = await admin
      .from("clients")
      .insert(
        Array.from({ length: JUMLAH_KLIEN }, (_, i) => ({
          padma_id: `PAD-UJI-CAP-${i}`,
          nama: `PAD-UJI-CAP Klien ${i}`,
          email: `pad-uji-cap-${i}@padma.test`,
          phase_id: "prekonsepsi",
        })),
      )
      .select("id");
    if (eKlien) throw eKlien;
    klienIds.push(...(klien ?? []).map((k) => k.id as string));
    expect(klienIds).toHaveLength(JUMLAH_KLIEN);

    const { error: eSesi } = await admin.from("sessions").insert(
      klienIds.map((clientId) => ({
        client_id: clientId,
        service_id: serviceId,
        partner_id: PARTNER_ID,
        tanggal: "2026-01-01",
        status: "selesai" as const,
      })),
    );
    if (eSesi) throw eSesi;
  });

  afterAll(async () => {
    if (serviceId) await admin.from("sessions").delete().eq("service_id", serviceId);
    if (materiId) await admin.from("materials").delete().eq("id", materiId);
    if (serviceId) await admin.from("services").delete().eq("id", serviceId);
    if (klienIds.length > 0) await admin.from("clients").delete().in("id", klienIds);
  });

  it("seluruh 1001 klien dengan sesi selesai muncul di 'otomatis', bukan terpotong di 1000", async () => {
    ref.sesi = await signInAs("admin@padma.test");
    const hasil = await daftarPenugasan(materiId);
    expect(hasil.otomatis).toHaveLength(JUMLAH_KLIEN);
    for (const id of klienIds) {
      expect(hasil.otomatis.map((p) => p.clientId)).toContain(id);
    }
  });
});
