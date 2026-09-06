import { describe, it, expect, beforeEach, vi } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { geocodeAlamat } from "@/lib/transport/geocode";
import { normalkanAlamat } from "@/lib/transport/alamat";

const svc = createAdminSupabase();
const ALAMAT = "PAD-UJI Jl. Geocode No. 1";
const ALAMAT_GAGAL = "PAD-UJI Alamat Yang Tidak Ada Di Peta Mana Pun";

async function bersihkan() {
  await svc.from("geocode_cache").delete().in("alamat_normal", [
    normalkanAlamat(ALAMAT),
    normalkanAlamat(ALAMAT_GAGAL),
  ]);
}

beforeEach(bersihkan);

describe("geocodeAlamat", () => {
  it("menyimpan hasil ke cache, dan tidak menanya dua kali", async () => {
    const palsu = vi.fn(async () =>
      new Response(JSON.stringify([{ lat: "-6.9175", lon: "107.6191" }]), { status: 200 }),
    );
    vi.stubGlobal("fetch", palsu);

    const pertama = await geocodeAlamat(ALAMAT);
    const kedua = await geocodeAlamat(ALAMAT);

    expect(pertama).toEqual({ lat: -6.9175, lon: 107.6191 });
    expect(kedua).toEqual(pertama);
    // Panggilan kedua dijawab cache — kalau tidak, batas laju Nominatim
    // dilanggar oleh pemakaian normal.
    expect(palsu).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("mengirim User-Agent yang mengidentifikasi PADMA", async () => {
    const palsu = vi.fn(async () =>
      new Response(JSON.stringify([{ lat: "-6.9", lon: "107.6" }]), { status: 200 }),
    );
    vi.stubGlobal("fetch", palsu);

    await geocodeAlamat(ALAMAT);

    const opsi = palsu.mock.calls[0][1] as RequestInit;
    const ua = new Headers(opsi.headers).get("User-Agent") ?? "";
    expect(ua).toMatch(/PADMA/i);

    vi.unstubAllGlobals();
  });

  it("kegagalan DICATAT, sehingga tidak ditanyakan ulang", async () => {
    const palsu = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", palsu);

    expect(await geocodeAlamat(ALAMAT_GAGAL)).toBeNull();
    expect(await geocodeAlamat(ALAMAT_GAGAL)).toBeNull();
    expect(palsu).toHaveBeenCalledTimes(1);

    const { data } = await svc
      .from("geocode_cache")
      .select("lat, lon")
      .eq("alamat_normal", normalkanAlamat(ALAMAT_GAGAL))
      .maybeSingle();
    expect(data).not.toBeNull();
    expect(data!.lat).toBeNull();

    vi.unstubAllGlobals();
  });

  it("galat jaringan memulangkan null, bukan melempar", async () => {
    // Pemanggilnya adalah jalur SIMPAN ALAMAT. Melempar di sini berarti klien
    // gagal menyimpan alamatnya karena OSM sedang bermasalah (spec T6).
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("jaringan mati"); }));
    expect(await geocodeAlamat(ALAMAT)).toBeNull();
    vi.unstubAllGlobals();
  });

  it("alamat kosong tidak pernah memanggil jaringan", async () => {
    const palsu = vi.fn();
    vi.stubGlobal("fetch", palsu);
    expect(await geocodeAlamat("   ")).toBeNull();
    expect(palsu).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
