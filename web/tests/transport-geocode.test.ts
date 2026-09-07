import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { geocodeAlamat } from "@/lib/transport/geocode";
import { normalkanAlamat, variasiAlamat } from "@/lib/transport/alamat";

const svc = createAdminSupabase();
const ALAMAT = "PAD-UJI Jl. Geocode No. 1";
const ALAMAT_GAGAL = "PAD-UJI Alamat Yang Tidak Ada Di Peta Mana Pun";
const ALAMAT_BERKOMA = "PAD-UJI Jl. Ladder No. 9, Klojen, Kota Malang";
const ALAMAT_WILAYAH = "PAD-UJI Jl. Wilayah No. 1, Kota Malang";

async function bersihkan() {
  await svc.from("geocode_cache").delete().in("alamat_normal", [
    normalkanAlamat(ALAMAT),
    normalkanAlamat(ALAMAT_GAGAL),
    ...variasiAlamat(ALAMAT_BERKOMA).map(normalkanAlamat),
    ...variasiAlamat(ALAMAT_WILAYAH).map(normalkanAlamat),
  ]);
}

beforeEach(bersihkan);

// vi.stubGlobal MENIMPA `globalThis.fetch` sepenuhnya. Kalau ditimpa dengan
// mock yang menjawab APA SAJA, panggilan `geocodeAlamat` ke Supabase lokal
// (select/upsert `geocode_cache`, lewat `createAdminSupabase()`) ikut
// terbajak — bukan cuma panggilan ke Nominatim yang MEMANG ingin dipalsukan.
// `stubNominatim` menutup celah itu: hanya URL yang menyentuh Nominatim yang
// dijawab `palsu`; sisanya diteruskan ke `fetch` asli (yang di suite ini
// adalah pagar tests/setup-fetch-guard.ts, meloloskan 127.0.0.1 — tempat
// Supabase lokal — dan menolak host lain).
function stubNominatim(jawab: () => Promise<Response> | Response) {
  const asli = globalThis.fetch;
  // `palsu` menerima argumen fetch APA ADANYA (url, init) — bukan supaya
  // dipakai `jawab` (yang mengabaikannya), tapi supaya `palsu.mock.calls`
  // merekam panggilan sungguhan geocode.ts, termasuk `init` (RequestInit)
  // yang diperiksa uji "User-Agent" lewat `palsu.mock.calls[0][1]`.
  const palsu = vi.fn((..._args: Parameters<typeof fetch>) => jawab());
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    return url.includes("nominatim") ? palsu(...args) : asli(...args);
  });
  return palsu;
}

afterEach(() => {
  // Di `afterEach`, bukan di akhir badan tiap `it`: kalau sebuah asersi di
  // atasnya gagal, badan `it` berhenti di situ dan baris unstub di bawahnya
  // TIDAK PERNAH jalan — stub lantas bocor ke test berikutnya.
  vi.unstubAllGlobals();
});

describe("geocodeAlamat", () => {
  it("menyimpan hasil ke cache, dan tidak menanya dua kali", async () => {
    const palsu = stubNominatim(() =>
      new Response(JSON.stringify([{ lat: "-6.9175", lon: "107.6191" }]), { status: 200 }),
    );

    const pertama = await geocodeAlamat(ALAMAT);
    const kedua = await geocodeAlamat(ALAMAT);

    expect(pertama).toEqual({ lat: -6.9175, lon: 107.6191 });
    expect(kedua).toEqual(pertama);
    // Panggilan kedua dijawab cache — kalau tidak, batas laju Nominatim
    // dilanggar oleh pemakaian normal.
    expect(palsu).toHaveBeenCalledTimes(1);
  });

  it("mengirim User-Agent yang mengidentifikasi PADMA", async () => {
    const palsu = stubNominatim(() =>
      new Response(JSON.stringify([{ lat: "-6.9", lon: "107.6" }]), { status: 200 }),
    );

    await geocodeAlamat(ALAMAT);

    const opsi = palsu.mock.calls[0][1] as RequestInit;
    const ua = new Headers(opsi.headers).get("User-Agent") ?? "";
    expect(ua).toMatch(/PADMA/i);
  });

  it("kegagalan DICATAT, sehingga tidak ditanyakan ulang", async () => {
    // ALAMAT_GAGAL tidak punya nomor rumah maupun koma, jadi ketiga tingkat
    // ladder memulangkan pertanyaan yang SAMA dan varian kembarnya dibuang —
    // satu tembakan, bukan tiga. Bukan kebetulan: itu yang dijaga uji
    // "varian kembar dibuang" di tests/transport-variasi-alamat.test.ts.
    const palsu = stubNominatim(() => new Response("[]", { status: 200 }));

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
  });


  // ===== LADDER: pengupasan bertingkat =====

  it("alamat berkoma yang gagal di tingkat pertama DICOBA ULANG lebih longgar", async () => {
    const dicoba: string[] = [];
    const palsu = stubNominatim(function (this: void) {
      return new Response("[]", { status: 200 });
    });
    // Merekam URL tiap tembakan supaya urutan tingkatnya bisa dibuktikan,
    // bukan cuma jumlahnya.
    const asli = globalThis.fetch;
    vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
      const url = args[0] instanceof Request ? args[0].url : String(args[0]);
      if (url.includes("nominatim")) {
        dicoba.push(decodeURIComponent(new URL(url).searchParams.get("q") ?? ""));
        return palsu(...args);
      }
      return asli(...args);
    });

    expect(await geocodeAlamat(ALAMAT_BERKOMA)).toBeNull();
    expect(dicoba).toEqual([
      "PAD-UJI Jl. Ladder No. 9, Klojen, Kota Malang",
      "PAD-UJI Jl. Ladder, Klojen, Kota Malang",
      "PAD-UJI Jl. Ladder, Kota Malang",
    ]);
  });

  it("BERHENTI pada tingkat yang ketemu — tidak menembak sisanya", async () => {
    let n = 0;
    const palsu = stubNominatim(() => {
      n += 1;
      // Tingkat pertama kosong, tingkat kedua ketemu.
      return n === 1
        ? new Response("[]", { status: 200 })
        : new Response(
            JSON.stringify([{ lat: "-7.98", lon: "112.63", addresstype: "road" }]),
            { status: 200 },
          );
    });
    expect(await geocodeAlamat(ALAMAT_BERKOMA)).toEqual({ lat: -7.98, lon: 112.63 });
    expect(palsu).toHaveBeenCalledTimes(2);
  });

  it("hasil setingkat WILAYAH ditolak jadi null, walau koordinatnya sah", async () => {
    // Titik tengah kelurahan adalah koordinat yang sah dan MASUK AKAL — ia
    // tidak terlihat seperti tebakan. Justru itu bahayanya: ia bisa meleset
    // kilometer sambil tampak pasti, dan jenjang tarif punya batas keras di
    // 5/10/15/20 km.
    stubNominatim(() =>
      new Response(
        JSON.stringify([{ lat: "-7.97", lon: "112.62", addresstype: "village" }]),
        { status: 200 },
      ),
    );
    expect(await geocodeAlamat(ALAMAT_WILAYAH)).toBeNull();
  });

  it("hasil setingkat jalan atau benda DITERIMA", async () => {
    for (const tipe of ["road", "building", "amenity"]) {
      await svc.from("geocode_cache").delete().eq("alamat_normal", normalkanAlamat(ALAMAT));
      stubNominatim(() =>
        new Response(
          JSON.stringify([{ lat: "-7.96", lon: "112.61", addresstype: tipe }]),
          { status: 200 },
        ),
      );
      expect(await geocodeAlamat(ALAMAT), tipe).toEqual({ lat: -7.96, lon: 112.61 });
      vi.unstubAllGlobals();
    }
  });

  it("galat jaringan memulangkan null, bukan melempar", async () => {
    // Pemanggilnya adalah jalur SIMPAN ALAMAT. Melempar di sini berarti klien
    // gagal menyimpan alamatnya karena OSM sedang bermasalah (spec T6).
    stubNominatim(async () => {
      throw new Error("jaringan mati");
    });
    expect(await geocodeAlamat(ALAMAT)).toBeNull();
  });

  it("alamat kosong tidak pernah memanggil jaringan", async () => {
    const palsu = vi.fn();
    vi.stubGlobal("fetch", palsu);
    expect(await geocodeAlamat("   ")).toBeNull();
    expect(palsu).not.toHaveBeenCalled();
  });
});
