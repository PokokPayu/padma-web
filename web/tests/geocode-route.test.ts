/**
 * Route pencarian alamat untuk pemilih lokasi.
 *
 * Ia membungkus layanan pihak ketiga di balik gerbang peran. Yang dijaga di
 * sini: bukan-staf tidak boleh memakainya sebagai proxy geocoding gratis atas
 * nama PADMA, dan alamat kosong tidak boleh menembak Nominatim sama sekali.
 *
 * `toHaveBeenCalledTimes(1)` di bawah berlaku untuk alamat yang KETEMU DI
 * PERCOBAAN PERTAMA, dan itu benar di bawah geocoding bertingkat mana pun —
 * tingkat berikutnya hanya dicoba ketika tingkat sebelumnya kosong. Melonggarkan
 * ini menjadi `toHaveBeenCalled()` membuang justru yang dijaganya.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { normalkanAlamat } from "@/lib/transport/alamat";
import { signInAs } from "./helpers/as-user";

const admin = createAdminSupabase();

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
}));

const { POST } = await import("@/app/api/geocode/route");

const ALAMAT = "PAD-UJI Jl. Route Geocode No. 1, Malang";

function stubNominatim() {
  const asli = globalThis.fetch;
  const palsu = vi.fn(
    async () =>
      new Response(JSON.stringify([{ lat: "-7.9666", lon: "112.6326" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    return url.includes("nominatim") ? palsu() : asli(...args);
  });
  return palsu;
}

function permintaan(body: unknown): Request {
  return new Request("http://127.0.0.1/api/geocode", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
});

beforeEach(async () => {
  await admin.from("geocode_cache").delete().eq("alamat_normal", normalkanAlamat(ALAMAT));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await admin.from("geocode_cache").delete().eq("alamat_normal", normalkanAlamat(ALAMAT));
});

describe("POST /api/geocode", () => {
  it("klien yang login DITOLAK", async () => {
    ref.sesi = sesiKlien;
    const nominatim = stubNominatim();
    await expect(POST(permintaan({ alamat: ALAMAT }))).rejects.toThrow(/REDIRECT/);
    // Ditolak SEBELUM menyentuh Nominatim, bukan sesudah.
    expect(nominatim).not.toHaveBeenCalled();
  });

  it("admin memperoleh koordinat", async () => {
    ref.sesi = sesiAdmin;
    const nominatim = stubNominatim();
    const jawaban = await POST(permintaan({ alamat: ALAMAT }));
    expect(jawaban.status).toBe(200);
    expect(await jawaban.json()).toEqual({ koordinat: { lat: -7.9666, lon: 112.6326 } });
    expect(nominatim).toHaveBeenCalledTimes(1);
  });

  it("alamat kosong dijawab null TANPA menembak Nominatim", async () => {
    ref.sesi = sesiAdmin;
    const nominatim = stubNominatim();
    const jawaban = await POST(permintaan({ alamat: "   " }));
    expect(jawaban.status).toBe(200);
    expect(await jawaban.json()).toEqual({ koordinat: null });
    expect(nominatim).not.toHaveBeenCalled();
  });

  it("body bukan JSON dijawab 400", async () => {
    ref.sesi = sesiAdmin;
    const rusak = new Request("http://127.0.0.1/api/geocode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bukan json",
    });
    const jawaban = await POST(rusak);
    expect(jawaban.status).toBe(400);
  });
});
