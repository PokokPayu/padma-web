/**
 * HAK BACA SERTIFIKAT — satu-satunya bagian fitur ini yang salahnya tidak
 * terlihat mata. Tampilan badge dan kartu materi diverifikasi manual; yang
 * diuji di sini adalah siapa boleh membaca lembar milik siapa.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";

// Sesi klien sungguhan untuk uji rute di bawah — RLS yang menjadi penjaga
// lewat sesi pengguna yang di-mock ke `createServerSupabase`, sama seperti
// tests/materi-route-halaman.test.ts.
const ref = vi.hoisted(() => ({ klien: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.klien!,
}));

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// Layanan & mitra seed dipakai `tests/admin-agenda.test.ts` — Sankalpa
// Fertility Massage & Bidan Sri Wahyuni.
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333301";

// Klien PEMBANDING — bukan pemilik akun mana pun. Ia tidak perlu bisa login:
// yang diuji adalah apakah ananda bisa membaca sertifikat MILIK ORANG LAIN.
const KLIEN_LAIN = "00000000-0000-0000-0000-0000000000c1";
const SESI_LAIN = "00000000-0000-0000-0000-0000000005e1";

beforeAll(async () => {
  await admin.from("clients").upsert({
    id: KLIEN_LAIN,
    padma_id: "PAD-9909-9999",
    nama: "Klien Pembanding",
    email: "pembanding@padma.test",
    phase_id: "prekonsepsi",
  });

  await admin.from("sessions").upsert({
    id: SESI_LAIN,
    client_id: KLIEN_LAIN,
    service_id: SVC,
    variant_id: await varianBaku(admin, SVC),
    partner_id: MITRA,
    tanggal: "2026-08-01",
    jam_mulai: "09:00",
    status: "selesai",
  });

  await admin.from("certificates").upsert(
    {
      session_id: SESI_LAIN,
      // Keduanya sengaja diisi nol-UUID: trigger `guard_sertifikat` yang
      // menulis ulang dari baris sesi. Kalau baris tersimpan tetap nol-UUID,
      // uji pertama di bawah akan gagal — dan itu memang yang kita mau.
      client_id: "00000000-0000-0000-0000-000000000000",
      service_id: "00000000-0000-0000-0000-000000000000",
      objek: `${KLIEN_LAIN}/${SESI_LAIN}.pdf`,
      mime: "application/pdf",
    },
    { onConflict: "session_id" },
  );
});

describe("sertifikat — hak baca", () => {
  it("trigger menyalin pemilik & layanan dari baris sesi, bukan dari kiriman", async () => {
    const { data } = await admin
      .from("certificates")
      .select("client_id")
      .eq("session_id", SESI_LAIN)
      .single();

    expect(data!.client_id).toBe(KLIEN_LAIN);
  });

  it("klien tidak bisa membaca sertifikat klien lain", async () => {
    const ananda = await signInAs("ananda@padma.test");
    const { data } = await ananda
      .from("certificates")
      .select("id")
      .eq("session_id", SESI_LAIN);

    expect(data ?? []).toHaveLength(0);
  });

  it("klien tidak bisa menerbitkan sertifikat untuk dirinya sendiri", async () => {
    const ananda = await signInAs("ananda@padma.test");
    const { data: milikku } = await admin
      .from("sessions")
      .select("id")
      .neq("client_id", KLIEN_LAIN)
      .eq("status", "selesai")
      .limit(1)
      .single();

    const { error } = await ananda.from("certificates").insert({
      session_id: milikku!.id,
      client_id: KLIEN_LAIN,
      service_id: KLIEN_LAIN,
      objek: "karangan/karangan.pdf",
      mime: "application/pdf",
    });

    // Tidak ada policy INSERT untuk klien — ditolak, bukan diterima diam-diam.
    expect(error).not.toBeNull();
  });

  it("rute baca menolak sertifikat milik klien lain dengan 404", async () => {
    // Dipanggil LANGSUNG (bukan lewat HTTP): `createServerSupabase` di-mock
    // di atas berkas ini untuk memulangkan sesi Ananda — pemilik SESI_LAIN
    // adalah KLIEN_LAIN, bukan Ananda, jadi RLS memulangkan nol baris dan
    // rutenya menjawab 404. Pola meniru tests/materi-route-halaman.test.ts.
    ref.klien = await signInAs("ananda@padma.test");

    const { GET } = await import("@/app/api/sertifikat/[sesi]/route");
    const res = await GET(new Request("http://localhost/api/sertifikat/x"), {
      params: Promise.resolve({ sesi: SESI_LAIN }),
    });

    expect(res.status).toBe(404);
  });
});
