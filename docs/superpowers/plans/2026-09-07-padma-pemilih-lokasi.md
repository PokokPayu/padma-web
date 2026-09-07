# Pemilih Lokasi di Peta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin menjatuhkan pin di peta saat mengisi alamat klien dan domisili mitra, sehingga koordinat yang menentukan jenjang transport dibenarkan manusia alih-alih ditebak Nominatim.

**Architecture:** Satu komponen peta klien dipakai bersama empat formulir panel staf. Koordinat masuk sebagai `input hidden` di formulir yang sudah ada dan tersimpan dalam submit yang sama. Server action memakai pin bila ada, dan hanya menggeocode bila tidak ada. Pencarian alamat tetap berjalan di server lewat satu route handler, sehingga `server-only`, cache, batas laju, dan `User-Agent` Nominatim tidak berubah sama sekali.

**Tech Stack:** Next.js 16 App Router, React 19, Leaflet 1.9, Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-07-padma-pemilih-lokasi-design.md`

## Global Constraints

- **Layar klien tidak berubah sama sekali.** Tidak ada peta, pin, atau medan baru di `src/app/passport/**`. Satu-satunya perubahan pada jalur klien adalah Task 5, yang tidak menyentuh UI.
- **Tidak ada tabel, kolom, enum, atau policy RLS baru.** Tidak ada migrasi dalam rencana ini.
- Koordinat tetap `null`-able. Tidak menjatuhkan pin **tidak boleh** menggagalkan penyimpanan alamat (Ruling 9).
- `geocodeAlamat()`, `normalkanAlamat()`, `geocode_cache`, dan batas 1 permintaan/detik: **tidak disunting**. Yang berubah hanya siapa yang memanggilnya dan kapan.
- Ubin peta: `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`, hidup sebagai SATU konstanta.
- Atribusi wajib: teks persis `© OpenStreetMap contributors`.
- `display_name` dari Nominatim tidak ditampilkan di mana pun.
- Nama berkas, fungsi, variabel, dan komentar dalam bahasa Indonesia, mengikuti seluruh repo.
- Setiap task berakhir dengan `npm test` hijau sebelum commit.

---

### Task 1: `koordinatDariFormData()` — pembaca pin sebagai fungsi murni

Memisahkan pembacaan koordinat dari empat server action yang akan memakainya, supaya perangkap yang sesungguhnya (lihat Step 1) diuji sekali di satu tempat, bukan empat kali setengah-setengah.

**Files:**
- Create: `web/src/lib/transport/koordinat-form.ts`
- Test: `web/tests/transport-koordinat-form.test.ts`

**Interfaces:**
- Consumes: `Koordinat` dari `@/lib/transport/jarak` (sudah ada: `{ lat: number; lon: number }`)
- Produces: `koordinatDariFormData(formData: FormData): Koordinat | null` — dipakai Task 2

- [ ] **Step 1: Tulis uji yang gagal**

Perangkapnya: `Number("")` adalah **0, bukan NaN**, dan `{lat: 0, lon: 0}` adalah titik yang sah di Teluk Guinea. Medan kosong yang lolos akan menyimpan koordinat palsu yang terlihat sengaja, lalu melahirkan jenjang `di_atas_20` untuk setiap klien Malang — persis kelas kesalahan senyap yang seluruh rencana ini coba hapus.

Buat `web/tests/transport-koordinat-form.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { koordinatDariFormData } from "@/lib/transport/koordinat-form";

function fd(isi: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, v);
  return f;
}

describe("koordinatDariFormData", () => {
  it("membaca pin yang sah", () => {
    expect(koordinatDariFormData(fd({ lat: "-7.9666", lon: "112.6326" }))).toEqual({
      lat: -7.9666,
      lon: 112.6326,
    });
  });

  it("MEDAN KOSONG memulangkan null, BUKAN {0,0}", () => {
    // Number("") === 0. Tanpa penjagaan eksplisit, formulir yang petanya tidak
    // pernah disentuh akan menyimpan Teluk Guinea sebagai lokasi klien.
    expect(koordinatDariFormData(fd({ lat: "", lon: "" }))).toBeNull();
    expect(koordinatDariFormData(fd({}))).toBeNull();
    expect(koordinatDariFormData(fd({ lat: "   ", lon: "   " }))).toBeNull();
  });

  it("nol yang DITULIS EKSPLISIT tetap diterima", () => {
    // Membuktikan bahwa penjagaan di atas memeriksa KEKOSONGAN, bukan sekadar
    // menolak nilai nol — kalau tidak, uji di atasnya bisa lulus karena alasan
    // yang salah.
    expect(koordinatDariFormData(fd({ lat: "0", lon: "0" }))).toEqual({ lat: 0, lon: 0 });
  });

  it("satu medan saja memulangkan null", () => {
    expect(koordinatDariFormData(fd({ lat: "-7.9666" }))).toBeNull();
    expect(koordinatDariFormData(fd({ lon: "112.6326" }))).toBeNull();
  });

  it("bukan angka memulangkan null", () => {
    expect(koordinatDariFormData(fd({ lat: "abc", lon: "112.6" }))).toBeNull();
    expect(koordinatDariFormData(fd({ lat: "NaN", lon: "112.6" }))).toBeNull();
    expect(koordinatDariFormData(fd({ lat: "Infinity", lon: "112.6" }))).toBeNull();
  });

  it("di luar rentang bumi memulangkan null", () => {
    expect(koordinatDariFormData(fd({ lat: "-91", lon: "112.6" }))).toBeNull();
    expect(koordinatDariFormData(fd({ lat: "-7.9", lon: "181" }))).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `cd web && npx vitest run tests/transport-koordinat-form.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/transport/koordinat-form"`

- [ ] **Step 3: Tulis implementasi minimal**

Buat `web/src/lib/transport/koordinat-form.ts`:

```ts
import type { Koordinat } from "./jarak";

/**
 * Koordinat yang DIJATUHKAN MANUSIA di peta, dibaca dari FormData.
 *
 * Terpisah dari `geocodeAlamat` dengan sengaja: yang ini tidak pernah
 * menyentuh jaringan, tidak pernah gagal, dan tidak pernah menebak. Ia hanya
 * menjawab satu pertanyaan — apakah orang yang mengisi formulir ini sudah
 * menunjuk sebuah titik, dan apakah titik itu masuk akal sebagai koordinat.
 *
 * `Number("")` adalah 0, BUKAN NaN, dan {0,0} adalah titik yang sah di Teluk
 * Guinea. Medan kosong karena itu ditolak SEBELUM dikonversi; menyerahkannya
 * pada pemeriksaan rentang di bawah akan meloloskan setiap formulir yang
 * petanya tidak pernah disentuh sebagai "pin di Teluk Guinea".
 */
export function koordinatDariFormData(formData: FormData): Koordinat | null {
  const latTeks = String(formData.get("lat") ?? "").trim();
  const lonTeks = String(formData.get("lon") ?? "").trim();
  if (latTeks === "" || lonTeks === "") return null;

  const lat = Number(latTeks);
  const lon = Number(lonTeks);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lon < -180 || lon > 180) return null;

  return { lat, lon };
}
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

Run: `cd web && npx vitest run tests/transport-koordinat-form.test.ts`
Expected: PASS, 6 test

- [ ] **Step 5: Commit**

```bash
cd web && git add src/lib/transport/koordinat-form.ts tests/transport-koordinat-form.test.ts
git commit -m "feat(transport): pembaca pin dari FormData sebagai fungsi murni"
```

---

### Task 2: "Pin menang" di empat server action klien & mitra

**Files:**
- Modify: `web/src/app/admin/klien/aksi.ts` (`buatKlien` ~baris 69, `perbaruiKlien` ~baris 129)
- Modify: `web/src/app/admin/mitra/aksi.ts` (`simpanMitra` ~baris 59, `perbaruiMitra` ~baris 92)
- Test: `web/tests/transport-pin-menang.test.ts`

**Interfaces:**
- Consumes: `koordinatDariFormData(formData)` dari Task 1
- Produces: keempat action menerima medan `lat`/`lon` opsional di FormData. Task 4 mengandalkan nama medan itu persis.

- [ ] **Step 1: Tulis uji yang gagal**

Yang dijaga bukan cuma "koordinatnya benar", tetapi bahwa Nominatim **tidak ditanyai sama sekali** ketika pin ada. Menanyakan alamat yang jawabannya sudah pasti dibuang adalah pembakaran kuota gratis milik pihak lain, dan pada volume nyata ia yang akan memicu pemblokiran.

Buat `web/tests/transport-pin-menang.test.ts`:

```ts
/**
 * Pin yang dijatuhkan manusia mengalahkan geocoding — dan menghapus
 * panggilannya, bukan sekadar mengabaikan hasilnya.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { normalkanAlamat } from "@/lib/transport/alamat";
import { signInAs } from "./helpers/as-user";

const admin = createAdminSupabase();

// Lapisan action memakai sesi pengguna; di vitest tidak ada cookie, jadi klien
// ber-sesi sungguhan disuntikkan — RLS dan requireRole tetap berjalan apa
// adanya. Pola ini disalin dari tests/admin-mitra.test.ts.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
}));

const { simpanMitra } = await import("@/app/admin/mitra/aksi");

const NAMA_PIN = "PAD-UJI Mitra Berpin";
const NAMA_TANPA_PIN = "PAD-UJI Mitra Tanpa Pin";
const ALAMAT = "PAD-UJI Jl. Pin Menang No. 1, Malang";

/**
 * Menghitung panggilan Nominatim TANPA membajak panggilan Supabase lokal.
 * Disalin dari tests/transport-geocode.test.ts — `vi.stubGlobal` menimpa
 * `globalThis.fetch` sepenuhnya, jadi mock yang menjawab apa saja akan ikut
 * membajak select/upsert `geocode_cache`.
 */
function stubNominatim() {
  const asli = globalThis.fetch;
  const palsu = vi.fn(
    async () =>
      new Response(JSON.stringify([{ lat: "-7.1111", lon: "112.1111" }]), {
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

let sesiAdmin: SupabaseClient;

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  // Cache yang terisi membuat geocoding TIDAK memanggil fetch — uji "tanpa
  // pin" akan lulus karena alasan yang salah. Dibersihkan setiap kali.
  await admin.from("geocode_cache").delete().eq("alamat_normal", normalkanAlamat(ALAMAT));
  await admin.from("partners").delete().in("nama", [NAMA_PIN, NAMA_TANPA_PIN]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await admin.from("partners").delete().in("nama", [NAMA_PIN, NAMA_TANPA_PIN]);
  await admin.from("geocode_cache").delete().eq("alamat_normal", normalkanAlamat(ALAMAT));
});

function formulir(isi: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, v);
  return f;
}

describe("pin menang atas geocoding", () => {
  it("pin di FormData tersimpan apa adanya, dan Nominatim TIDAK dipanggil", async () => {
    const nominatim = stubNominatim();

    const hasil = await simpanMitra(
      formulir({
        nama: NAMA_PIN,
        no_hp: "0812",
        alamat: ALAMAT,
        lat: "-7.9666",
        lon: "112.6326",
      }),
    );
    expect(hasil.ok).toBe(true);

    expect(nominatim).not.toHaveBeenCalled();

    const { data } = await admin
      .from("partners")
      .select("lat, lon")
      .eq("nama", NAMA_PIN)
      .single();
    // Nilai pin, BUKAN -7.1111/112.1111 yang dijawab Nominatim palsu di atas.
    expect(data!.lat).toBeCloseTo(-7.9666, 6);
    expect(data!.lon).toBeCloseTo(112.6326, 6);
  });

  it("tanpa pin, jalur geocoding lama tetap berjalan utuh", async () => {
    const nominatim = stubNominatim();

    const hasil = await simpanMitra(
      formulir({ nama: NAMA_TANPA_PIN, no_hp: "0812", alamat: ALAMAT }),
    );
    expect(hasil.ok).toBe(true);

    expect(nominatim).toHaveBeenCalledTimes(1);

    const { data } = await admin
      .from("partners")
      .select("lat, lon")
      .eq("nama", NAMA_TANPA_PIN)
      .single();
    expect(data!.lat).toBeCloseTo(-7.1111, 6);
    expect(data!.lon).toBeCloseTo(112.1111, 6);
  });

  it("pin kosong TIDAK menggagalkan penyimpanan alamat (Ruling 9 tetap hidup)", async () => {
    const nominatim = stubNominatim();
    // Nominatim menjawab "tidak ketemu" — alamat tetap harus tersimpan.
    nominatim.mockImplementation(
      async () =>
        new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    );

    const hasil = await simpanMitra(
      formulir({ nama: NAMA_TANPA_PIN, no_hp: "0812", alamat: ALAMAT, lat: "", lon: "" }),
    );
    expect(hasil.ok).toBe(true);

    const { data } = await admin
      .from("partners")
      .select("alamat, lat, lon")
      .eq("nama", NAMA_TANPA_PIN)
      .single();
    expect(data!.alamat).toBe(ALAMAT);
    expect(data!.lat).toBeNull();
    expect(data!.lon).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `cd web && npx vitest run tests/transport-pin-menang.test.ts`
Expected: FAIL pada test pertama — `expected "spy" to not be called` (hari ini `simpanMitra` selalu menggeocode).

Prasyarat: Supabase lokal berjalan (`npx supabase start`).

- [ ] **Step 3: Terapkan aturan "pin menang" di `simpanMitra`**

Di `web/src/app/admin/mitra/aksi.ts`, tambahkan impor:

```ts
import { koordinatDariFormData } from "@/lib/transport/koordinat-form";
```

Lalu ganti baris `const koordinat = await geocodeAlamat(alamat);` di dalam `simpanMitra` menjadi:

```ts
  // PIN MENANG. Bila admin sudah menjatuhkan titik di peta, koordinat itu yang
  // dipakai dan Nominatim TIDAK ditanyai sama sekali — menanyakan alamat yang
  // jawabannya sudah pasti dibuang hanya membakar kuota gratis milik pihak
  // lain, dan pada volume nyata itulah yang memicu pemblokiran.
  //
  // Tanpa pin, jalur lama berlaku utuh: geocoding boleh gagal, dan kegagalannya
  // tidak pernah menggagalkan penyimpanan alamat (Ruling 9).
  const pin = koordinatDariFormData(formData);
  const koordinat = pin ?? (await geocodeAlamat(alamat));
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

Run: `cd web && npx vitest run tests/transport-pin-menang.test.ts`
Expected: PASS, 3 test

- [ ] **Step 5: Terapkan pola yang sama pada tiga action sisanya**

Di `web/src/app/admin/mitra/aksi.ts` → `perbaruiMitra`, dan di `web/src/app/admin/klien/aksi.ts` → `buatKlien` dan `perbaruiKlien`, lakukan penggantian yang sama:

```ts
  const pin = koordinatDariFormData(formData);
  const koordinat = pin ?? (await geocodeAlamat(alamat));
```

Pada `perbaruiMitra` dan `perbaruiKlien` cukup komentar singkat yang menunjuk balik: `// PIN MENANG — lihat alasan lengkapnya di simpanMitra/buatKlien.` Tambahkan impor `koordinatDariFormData` di `klien/aksi.ts`.

- [ ] **Step 6: Jalankan SELURUH suite**

Run: `cd web && npm test`
Expected: PASS. Suite penuh wajib — dua kali dalam rantai transport, yang menangkap cacat baru justru pagar berskop global (uji struktural seluruh view, pemindai jejak yatim), dan keduanya tidak pernah ikut dalam sapuan uji terarah.

- [ ] **Step 7: Commit**

```bash
cd web && git add src/app/admin/mitra/aksi.ts src/app/admin/klien/aksi.ts tests/transport-pin-menang.test.ts
git commit -m "feat(transport): pin manusia mengalahkan geocoding di empat action staf"
```

---

### Task 3: Route handler pencarian alamat

**Files:**
- Create: `web/src/app/api/geocode/route.ts`
- Test: `web/tests/geocode-route.test.ts`

**Interfaces:**
- Consumes: `geocodeAlamat` (`@/lib/transport/geocode`), `requireRole` (`@/lib/auth/require-role`)
- Produces: `POST /api/geocode`, body `{ alamat: string }`, jawaban `{ koordinat: { lat, lon } | null }`. Task 4 memanggilnya.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/geocode-route.test.ts`:

```ts
/**
 * Route pencarian alamat untuk pemilih lokasi.
 *
 * Ia membungkus layanan pihak ketiga di balik gerbang peran. Yang dijaga di
 * sini: bukan-staf tidak boleh memakainya sebagai proxy geocoding gratis atas
 * nama PADMA, dan alamat kosong tidak boleh menembak Nominatim sama sekali.
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
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `cd web && npx vitest run tests/geocode-route.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/geocode/route"`

- [ ] **Step 3: Tulis route handler**

Buat `web/src/app/api/geocode/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { geocodeAlamat } from "@/lib/transport/geocode";

/**
 * Pencarian alamat untuk pemilih lokasi di panel staf.
 *
 * Kenapa route handler, bukan `fetch` langsung ke Nominatim dari browser —
 * tiga alasan yang semuanya sudah tertulis di `lib/transport/geocode.ts`:
 *   1. `server-only` di berkas itu bukan hiasan. Dari browser, pemakaian kita
 *      terhadap layanan pihak ketiga menjadi tak terkendali.
 *   2. Browser tidak bisa menyetel `User-Agent`, yang dituntut kebijakan
 *      Nominatim. Permintaan tanpa itu berhak ditolak — dan penolakannya akan
 *      terlihat persis seperti "alamat tidak ditemukan".
 *   3. Cache `geocode_cache` dan jeda 1 permintaan/detik hidup di server.
 *      Memindahkan pemanggilannya ke browser membuang keduanya.
 *
 * Hasilnya HANYA menggeser peta. Tidak ada apa pun yang tersimpan dari sini —
 * koordinat baru tersimpan ketika formulirnya di-submit.
 */

/** Alamat terpanjang yang masuk akal; di atas ini pasti bukan alamat. */
const MAKS_PANJANG_ALAMAT = 300;

export async function POST(request: Request) {
  // Gerbang peran DI DALAM handler: route handler adalah endpoint tersendiri
  // yang tidak pernah melewati guard layout /admin.
  await requireRole(["admin", "owner"]);

  let mentah: unknown;
  try {
    mentah = await request.json();
  } catch {
    return NextResponse.json({ pesan: "Format tidak valid." }, { status: 400 });
  }

  const alamat = String((mentah as { alamat?: unknown } | null)?.alamat ?? "").trim();

  // Alamat kosong atau raksasa dijawab tanpa menyentuh Nominatim sama sekali:
  // jatah 1 permintaan/detik tidak boleh terbakar untuk sesuatu yang jawabannya
  // sudah diketahui.
  if (alamat === "" || alamat.length > MAKS_PANJANG_ALAMAT) {
    return NextResponse.json({ koordinat: null }, { status: 200 });
  }

  const koordinat = await geocodeAlamat(alamat);
  return NextResponse.json({ koordinat }, { status: 200 });
}
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

Run: `cd web && npx vitest run tests/geocode-route.test.ts`
Expected: PASS, 4 test

- [ ] **Step 5: Commit**

```bash
cd web && git add src/app/api/geocode/route.ts tests/geocode-route.test.ts
git commit -m "feat(transport): route pencarian alamat bergerbang peran staf"
```

---

### Task 4: Komponen peta & pemasangannya di empat formulir

**Files:**
- Modify: `web/package.json` (dependensi `leaflet`, `@types/leaflet`)
- Create: `web/src/app/_shell/panel/pemilih-lokasi.tsx`
- Modify: `web/src/app/admin/klien/form-klien.tsx` (`FormKlienBaru` ~baris 103-112, `FormEditKlien` ~baris 206-221)
- Modify: `web/src/app/admin/mitra/form-mitra.tsx` (`FormMitraBaru` ~baris 76-90, formulir edit di `AksiMitra`)
- Modify: `web/tests/transport-atribusi.test.ts`

**Interfaces:**
- Consumes: `POST /api/geocode` dari Task 3; medan `lat`/`lon` yang dibaca Task 2
- Produces: `<PemilihLokasi awal={…} />` — komponen klien yang merender dua `input hidden` bernama `lat` dan `lon`

- [ ] **Step 1: Pasang Leaflet**

```bash
cd web && npm install leaflet@1.9.4 && npm install --save-dev @types/leaflet
```

- [ ] **Step 2: Tulis uji atribusi yang gagal**

Atribusi peta datang dari opsi JavaScript Leaflet, bukan teks JSX. `atribusiDalamJsx()` yang sudah ada karena itu **akan tetap hijau** walau ada layar baru yang menampilkan hasil OSM tanpa atribusi apa pun — persis kelas kegagalan yang dicatat di runbook transport: jaminan hilang tanpa satu pun asersi berubah merah.

Jawabannya bukan melemahkan pemindainya, melainkan menuntut **dua** bukti dari komponen ini: baris atribusi kasatmata di JSX (sama seperti empat layar lain), DAN atribusi yang diteruskan ke lapisan ubin.

Di `web/tests/transport-atribusi.test.ts`, tambahkan `"src/app/_shell/panel/pemilih-lokasi.tsx"` ke array `it.each` yang sudah ada, tambahkan berkas yang sama ke daftar di test "money firewall", lalu tambahkan test baru ini di dalam `describe` yang sama:

```ts
  it("pemilih-lokasi.tsx — atribusi JUGA diteruskan ke lapisan ubin Leaflet", () => {
    // Bukti kedua, independen dari pemindaian JSX di atas. Kontrol atribusi
    // Leaflet adalah satu-satunya atribusi yang ikut bergerak bersama petanya
    // saat digeser dan diperbesar; baris JSX di bawah peta tidak.
    const bersih = tanpaKomentar(baca("src/app/_shell/panel/pemilih-lokasi.tsx"));
    expect(bersih).toMatch(/const ATRIBUSI_OSM = "© OpenStreetMap contributors"/);
    expect(bersih).toMatch(/attribution:\s*ATRIBUSI_OSM/);
  });

  it("pemilih-lokasi.tsx — URL ubin hidup sebagai SATU konstanta", () => {
    // Keputusan 4 di spec: sumber ubin harus bisa dipindahkan ke penyedia lain
    // dengan mengubah satu baris. URL yang ditulis harfiah di tengah pemanggilan
    // membuat "pindah penyedia" jadi perburuan teks.
    const bersih = tanpaKomentar(baca("src/app/_shell/panel/pemilih-lokasi.tsx"));
    const kemunculan = bersih.match(/tile\.openstreetmap\.org/g) ?? [];
    expect(kemunculan).toHaveLength(1);
    expect(bersih).toMatch(/const URL_UBIN =/);
  });
```

- [ ] **Step 3: Jalankan uji, pastikan MERAH**

Run: `cd web && npx vitest run tests/transport-atribusi.test.ts`
Expected: FAIL — `ENOENT: no such file or directory ... pemilih-lokasi.tsx`

- [ ] **Step 4: Tulis komponen peta**

Buat `web/src/app/_shell/panel/pemilih-lokasi.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as PetaLeaflet, Marker as MarkerLeaflet } from "leaflet";

/**
 * Pemilih koordinat di peta, untuk formulir alamat panel staf.
 *
 * Kenapa ini ada: pengukuran 7 September 2026 menunjukkan 26 dari 32 alamat
 * berbentuk Malang GAGAL digeocoding, dan yang berhasil pun membuang nomor
 * rumahnya — `Jl. Veteran No. 8` dan `Jl. Veteran` memulangkan koordinat yang
 * identik. Angka yang menentukan uang karena itu tidak boleh berasal dari
 * tebakan Nominatim. Di sini ada manusia yang melihat titiknya dan
 * membenarkannya.
 *
 * Geocoding TIDAK dihapus — ia turun pangkat menjadi penggeser peta. Gagal pun
 * tidak apa-apa: orangnya tinggal menggeser sendiri.
 *
 * Komponen ini TIDAK PERNAH dipakai di layar klien. Tombol "gunakan lokasi
 * saat ini" aman di tangan staf yang sedang di lokasi, tetapi ditekan klien
 * yang sedang tidak di rumah ia menyimpan lokasi yang salah TANPA penanda apa
 * pun — dan terlihat disengaja. Kegagalan geocoding setidaknya berisik; itu
 * diam.
 */

/** Satu-satunya tempat sumber ubin ditulis (spec Keputusan 4). */
const URL_UBIN = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Kewajiban lisensi ODbL, bukan pilihan desain. */
const ATRIBUSI_OSM = "© OpenStreetMap contributors";

/** Alun-Alun Malang — titik awal peta ketika belum ada apa pun untuk dituju. */
const PUSAT_AWAL: [number, number] = [-7.9825, 112.6304];
const ZOOM_KOTA = 13;
const ZOOM_TITIK = 17;

/** Penanda pin: `divIcon`, bukan ikon bawaan Leaflet — ikon bawaan memuat PNG
 *  lewat URL relatif yang pecah di bawah bundler mana pun, dan pecahnya SENYAP
 *  (penanda menjadi tak terlihat, bukan error). */
const HTML_PIN =
  '<span style="display:block;width:18px;height:18px;border-radius:9999px;background:#B08D57;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>';

type Props = {
  /** Koordinat tersimpan, bila baris ini sudah punya. */
  awal?: { lat: number; lon: number } | null;
};

export function PemilihLokasi({ awal = null }: Props) {
  const wadah = useRef<HTMLDivElement | null>(null);
  const peta = useRef<PetaLeaflet | null>(null);
  const penanda = useRef<MarkerLeaflet | null>(null);
  const medanLat = useRef<HTMLInputElement | null>(null);

  const [koordinat, setKoordinat] = useState<{ lat: number; lon: number } | null>(awal);
  const [status, setStatus] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    if (!wadah.current || peta.current) return;
    let dibatalkan = false;

    // Leaflet menyentuh `window` saat dimuat, jadi ia diimpor DI DALAM efek —
    // bukan di puncak berkas — supaya render server tidak pernah menjalankannya.
    void import("leaflet").then((L) => {
      if (dibatalkan || !wadah.current || peta.current) return;

      const p = L.map(wadah.current).setView(
        awal ? [awal.lat, awal.lon] : PUSAT_AWAL,
        awal ? ZOOM_TITIK : ZOOM_KOTA,
      );
      L.tileLayer(URL_UBIN, { maxZoom: 19, attribution: ATRIBUSI_OSM }).addTo(p);

      const ikon = L.divIcon({
        className: "",
        html: HTML_PIN,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });

      const pasangPenanda = (lat: number, lon: number) => {
        if (!penanda.current) {
          penanda.current = L.marker([lat, lon], { draggable: true, icon: ikon }).addTo(p);
          penanda.current.on("dragend", (e) => {
            const t = (e.target as MarkerLeaflet).getLatLng();
            setKoordinat({ lat: t.lat, lon: t.lng });
            setStatus("Pin dipindahkan.");
          });
        } else {
          penanda.current.setLatLng([lat, lon]);
        }
      };

      if (awal) pasangPenanda(awal.lat, awal.lon);

      p.on("click", (e) => {
        pasangPenanda(e.latlng.lat, e.latlng.lng);
        setKoordinat({ lat: e.latlng.lat, lon: e.latlng.lng });
        setStatus("Pin dijatuhkan. Geser untuk menyesuaikan.");
      });

      // Disimpan TERAKHIR: `peta.current` adalah penjaga "sudah dibangun" di
      // puncak efek ini, jadi mengisinya lebih awal membuat efek yang berjalan
      // dua kali (StrictMode dev) melihat peta yang belum berpenanda.
      peta.current = p;
    });

    return () => {
      dibatalkan = true;
      peta.current?.remove();
      peta.current = null;
      penanda.current = null;
    };
  }, [awal]);

  /** Menggeser peta & pin ke koordinat baru, tanpa membuat ulang petanya. */
  async function pindahkan(lat: number, lon: number) {
    setKoordinat({ lat, lon });
    const p = peta.current;
    if (!p) return;
    p.setView([lat, lon], ZOOM_TITIK);

    if (penanda.current) {
      penanda.current.setLatLng([lat, lon]);
      return;
    }
    const L = await import("leaflet");
    const ikon = L.divIcon({ className: "", html: HTML_PIN, iconSize: [18, 18], iconAnchor: [9, 9] });
    penanda.current = L.marker([lat, lon], { draggable: true, icon: ikon }).addTo(p);
    penanda.current.on("dragend", (e) => {
      const t = (e.target as MarkerLeaflet).getLatLng();
      setKoordinat({ lat: t.lat, lon: t.lng });
      setStatus("Pin dipindahkan.");
    });
  }

  /**
   * Membaca medan `alamat` dari FORMULIR YANG SAMA lewat DOM.
   *
   * Seluruh formulir panel ini tak terkendali (uncontrolled, `name=`), jadi
   * mengangkat nilai alamat menjadi state React hanya demi tombol ini akan
   * menular ke empat formulir sekaligus. `input.form` memberi jalan langsung.
   */
  function alamatSaatIni(): string {
    const formulir = medanLat.current?.form;
    const medan = formulir?.elements.namedItem("alamat");
    return medan && "value" in medan ? String((medan as HTMLInputElement).value).trim() : "";
  }

  async function cariAlamat() {
    const alamat = alamatSaatIni();
    if (alamat === "") {
      setStatus("Isi alamatnya lebih dulu.");
      return;
    }
    setSibuk(true);
    setStatus("Mencari…");
    try {
      const jawaban = await fetch("/api/geocode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alamat }),
      });
      const isi = (await jawaban.json()) as { koordinat: { lat: number; lon: number } | null };
      if (!isi.koordinat) {
        // Bukan kegagalan yang menghentikan apa pun: alamat Malang memang
        // sering tidak dikenal OSM. Petanya tetap bisa diklik.
        setStatus("Tidak ketemu di peta. Klik langsung di peta untuk menandai lokasinya.");
        return;
      }
      await pindahkan(isi.koordinat.lat, isi.koordinat.lon);
      setStatus("Ketemu. PERIKSA posisi pin — nomor rumah sering diabaikan peta.");
    } catch {
      setStatus("Gagal mencari. Klik langsung di peta untuk menandai lokasinya.");
    } finally {
      setSibuk(false);
    }
  }

  function lokasiSaatIni() {
    if (!navigator.geolocation) {
      setStatus("Peramban ini tidak mendukung deteksi lokasi.");
      return;
    }
    setSibuk(true);
    setStatus("Mengambil lokasi…");
    navigator.geolocation.getCurrentPosition(
      (posisi) => {
        void pindahkan(posisi.coords.latitude, posisi.coords.longitude);
        setStatus("Lokasi perangkat ini dipakai. Pastikan Anda memang sedang di lokasinya.");
        setSibuk(false);
      },
      () => {
        setStatus("Gagal mengambil lokasi. Klik langsung di peta.");
        setSibuk(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={cariAlamat}
          disabled={sibuk}
          className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-[12px] font-bold text-ink disabled:opacity-60"
        >
          Cari alamat di peta
        </button>
        <button
          type="button"
          onClick={lokasiSaatIni}
          disabled={sibuk}
          className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-[12px] font-bold text-ink disabled:opacity-60"
        >
          Gunakan lokasi saat ini
        </button>
      </div>

      <div
        ref={wadah}
        className="mt-2 h-[300px] w-full overflow-hidden rounded-xl border border-black/10"
      />

      {/* Nilai yang benar-benar tersimpan. Kosong bila belum ada pin —
          `koordinatDariFormData` menolak medan kosong, sehingga formulir yang
          petanya tidak disentuh jatuh ke jalur geocoding lama. */}
      <input ref={medanLat} type="hidden" name="lat" value={koordinat?.lat ?? ""} readOnly />
      <input type="hidden" name="lon" value={koordinat?.lon ?? ""} readOnly />

      <p className="mt-1 text-[11px] text-ink-soft/70">
        {koordinat
          ? `Pin: ${koordinat.lat.toFixed(6)}, ${koordinat.lon.toFixed(6)}`
          : "Belum ada pin. Tanpa pin, lokasi diperkirakan otomatis dari teks alamat."}
      </p>
      {status && <p className="mt-1 text-[11px] text-ink-soft">{status}</p>}
      <p className="mt-1 block text-[11px] text-ink-soft/70">
        Peta &amp; lokasi dari data © OpenStreetMap contributors.
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Pasang di empat formulir**

Di `web/src/app/admin/klien/form-klien.tsx`, tambahkan impor:

```ts
import { PemilihLokasi } from "@/app/_shell/panel/pemilih-lokasi";
```

Di `FormKlienBaru`, tepat SESUDAH `<span>` atribusi di dalam `<label>` alamat, sisipkan:

```tsx
          <PemilihLokasi />
```

Di `FormEditKlien`, di posisi yang sama, sisipkan dengan koordinat tersimpan:

```tsx
          <PemilihLokasi
            awal={awal.lat !== null && awal.lon !== null ? { lat: awal.lat, lon: awal.lon } : null}
          />
```

`FormEditKlien` karena itu perlu menerima `lat`/`lon` di prop `awal`. Tambahkan keduanya ke tipe `awal` (`lat: number | null; lon: number | null`), lalu teruskan dari pemanggilnya di `src/app/admin/klien/page.tsx` dan `src/app/admin/klien/[id]/page.tsx` — pastikan `alamat_lat, alamat_lon` ikut di `select` pada query yang memberi makan komponen itu.

Lakukan hal setara di `web/src/app/admin/mitra/form-mitra.tsx` untuk `FormMitraBaru` (tanpa `awal`) dan formulir edit di `AksiMitra` (dengan `awal`, dari kolom `lat`/`lon` tabel `partners`).

Catatan: `tests/transport-atribusi.test.ts` merender `FormEditKlien` lewat `renderToStaticMarkup` dengan prop `awal` harfiah. Prop baru itu WAJIB ikut ditambahkan di berkas uji tersebut, atau TypeScript menolaknya.

- [ ] **Step 6: Jalankan uji atribusi & suite penuh**

Run: `cd web && npx vitest run tests/transport-atribusi.test.ts && npm test && npm run lint`
Expected: PASS, lint 0 error

- [ ] **Step 7: Periksa di browser sungguhan**

Uji otomatis tidak bisa membuktikan peta tergambar. Jalankan `npm run dev`, masuk sebagai admin, buka `/admin/mitra` → "Mitra baru":

1. Peta tergambar dan ubinnya termuat (bukan kotak abu-abu).
2. Kontrol atribusi Leaflet terbaca di pojok kanan bawah peta.
3. Klik peta → pin muncul, baris "Pin: …" terisi.
4. Geser pin → angkanya ikut berubah.
5. Isi alamat, klik "Cari alamat di peta" → peta bergeser; alamat Malang yang tidak dikenal memberi pesan "tidak ketemu", bukan layar rusak.
6. Simpan → periksa `partners.lat/lon` di Supabase Studio berisi angka pin, bukan hasil geocoding.
7. Buka formulir edit mitra itu → peta terbuka dengan pin di posisi tersimpan.

- [ ] **Step 8: Commit**

```bash
cd web && git add package.json package-lock.json src/app/_shell/panel/pemilih-lokasi.tsx src/app/admin/klien src/app/admin/mitra tests/transport-atribusi.test.ts
git commit -m "feat(transport): pemilih lokasi di peta pada formulir klien & mitra"
```

---

### Task 5: Pengajuan klien mewarisi koordinat yang sudah dipin admin

Tanpa task ini, peta tidak menyentuh jalur yang kemungkinan besar paling ramai: sesi yang lahir dari pengajuan klien mengambil koordinatnya dari geocoding teks yang klien ketik, dan `konfirmasiPermintaan` menyalinnya apa adanya ke sesi.

**Files:**
- Modify: `web/src/lib/passport/aksi.ts` (`ajukanJadwal`, di sekitar baris 175-181)
- Test: `web/tests/transport-warisan-koordinat.test.ts`

**Interfaces:**
- Consumes: `normalkanAlamat` (`@/lib/transport/alamat`), `geocodeAlamat`
- Produces: tidak ada antarmuka baru

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/transport-warisan-koordinat.test.ts`:

```ts
/**
 * Pengajuan klien mewarisi koordinat profil BILA alamatnya identik.
 *
 * Batas ketegangannya dengan spec T6 diuji di sini secara langsung: begitu
 * teks alamatnya BERBEDA, pewarisan harus berhenti — karena klien boleh
 * memesan untuk alamat lain, dan mengirim mitra ke rumahnya adalah persis
 * bahaya yang T6 cegah.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { normalkanAlamat } from "@/lib/transport/alamat";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { signInAs } from "./helpers/as-user";

const admin = createAdminSupabase();

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
}));

const { ajukanJadwal } = await import("@/lib/passport/aksi");

const ANANDA = "44444444-4444-4444-4444-444444444401";
const ALAMAT_PROFIL = "PAD-UJI Jl. Warisan No. 7, Malang";
const ALAMAT_LAIN = "PAD-UJI Jl. Bukan Rumahnya No. 9, Malang";
const LAT_PIN = -7.9666;
const LON_PIN = 112.6326;

function stubNominatim() {
  const asli = globalThis.fetch;
  const palsu = vi.fn(
    async () =>
      new Response(JSON.stringify([{ lat: "-7.1111", lon: "112.1111" }]), {
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

let sesiKlien: SupabaseClient;
let serviceId: string;
let variantId: string;
let profilAsli: { alamat: string; lat: number | null; lon: number | null };

beforeAll(async () => {
  sesiKlien = await signInAs("ananda@padma.test");

  const { data: layanan } = await admin
    .from("services")
    .select("id")
    .eq("aktif", true)
    .limit(1)
    .single();
  serviceId = layanan!.id as string;

  const { data: varian } = await admin
    .from("service_variants")
    .select("id")
    .eq("service_id", serviceId)
    .eq("aktif", true)
    .limit(1)
    .single();
  variantId = varian!.id as string;

  const { data: klien } = await admin
    .from("clients")
    .select("alamat, alamat_lat, alamat_lon")
    .eq("id", ANANDA)
    .single();
  profilAsli = {
    alamat: (klien!.alamat as string) ?? "",
    lat: klien!.alamat_lat as number | null,
    lon: klien!.alamat_lon as number | null,
  };
});

beforeEach(async () => {
  ref.sesi = sesiKlien;
  // Profil Ananda diberi alamat + pin yang sudah "dibenarkan admin".
  await admin
    .from("clients")
    .update({ alamat: ALAMAT_PROFIL, alamat_lat: LAT_PIN, alamat_lon: LON_PIN })
    .eq("id", ANANDA);
  await admin.from("booking_requests").delete().eq("client_id", ANANDA).eq("status", "menunggu");
  await admin
    .from("geocode_cache")
    .delete()
    .in("alamat_normal", [normalkanAlamat(ALAMAT_PROFIL), normalkanAlamat(ALAMAT_LAIN)]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await admin.from("booking_requests").delete().eq("client_id", ANANDA).eq("status", "menunggu");
  await admin
    .from("clients")
    .update({ alamat: profilAsli.alamat, alamat_lat: profilAsli.lat, alamat_lon: profilAsli.lon })
    .eq("id", ANANDA);
  await admin
    .from("geocode_cache")
    .delete()
    .in("alamat_normal", [normalkanAlamat(ALAMAT_PROFIL), normalkanAlamat(ALAMAT_LAIN)]);
});

function pengajuan(alamat: string): FormData {
  const f = new FormData();
  f.set("layanan", serviceId);
  f.set("varian", variantId);
  f.set("tanggal", hariIniJakarta());
  f.set("waktu", "pagi");
  f.set("alamat", alamat);
  return f;
}

describe("pewarisan koordinat pada pengajuan klien", () => {
  it("alamat IDENTIK dengan profil mewarisi pin, tanpa menembak Nominatim", async () => {
    const nominatim = stubNominatim();

    const hasil = await ajukanJadwal(pengajuan(ALAMAT_PROFIL));
    expect(hasil.ok).toBe(true);
    expect(nominatim).not.toHaveBeenCalled();

    const { data } = await admin
      .from("booking_requests")
      .select("alamat_lat, alamat_lon")
      .eq("client_id", ANANDA)
      .eq("status", "menunggu")
      .single();
    expect(data!.alamat_lat).toBeCloseTo(LAT_PIN, 6);
    expect(data!.alamat_lon).toBeCloseTo(LON_PIN, 6);
  });

  it("beda huruf besar & spasi TETAP mewarisi", async () => {
    const nominatim = stubNominatim();
    const hasil = await ajukanJadwal(pengajuan(`  ${ALAMAT_PROFIL.toUpperCase()}  `));
    expect(hasil.ok).toBe(true);
    expect(nominatim).not.toHaveBeenCalled();
  });

  it("alamat BERBEDA jatuh kembali ke geocoding — batas spec T6", async () => {
    const nominatim = stubNominatim();

    const hasil = await ajukanJadwal(pengajuan(ALAMAT_LAIN));
    expect(hasil.ok).toBe(true);
    expect(nominatim).toHaveBeenCalledTimes(1);

    const { data } = await admin
      .from("booking_requests")
      .select("alamat_lat, alamat_lon")
      .eq("client_id", ANANDA)
      .eq("status", "menunggu")
      .single();
    // Hasil geocoding, BUKAN pin profil — mitra tidak boleh dikirim ke rumahnya
    // untuk sesi yang dipesan di alamat lain.
    expect(data!.alamat_lat).toBeCloseTo(-7.1111, 6);
    expect(data!.alamat_lon).toBeCloseTo(112.1111, 6);
  });

  it("profil TANPA pin tetap menggeocode walau alamatnya identik", async () => {
    await admin.from("clients").update({ alamat_lat: null, alamat_lon: null }).eq("id", ANANDA);
    const nominatim = stubNominatim();

    const hasil = await ajukanJadwal(pengajuan(ALAMAT_PROFIL));
    expect(hasil.ok).toBe(true);
    expect(nominatim).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `cd web && npx vitest run tests/transport-warisan-koordinat.test.ts`
Expected: FAIL pada test pertama — `expected "spy" to not be called` (hari ini `ajukanJadwal` selalu menggeocode).

- [ ] **Step 3: Terapkan pewarisan**

Di `web/src/lib/passport/aksi.ts`, tambahkan impor:

```ts
import { normalkanAlamat } from "@/lib/transport/alamat";
```

Ganti blok `const koordinat = await geocodeAlamat(cekAlamat.nilai);` menjadi:

```ts
  // Alamat yang TIDAK diubah klien mewarisi koordinat profilnya — titik yang
  // sudah dijatuhkan dan dibenarkan admin di peta. Formulir ini terisi otomatis
  // dari profil, jadi mayoritas pengajuan lewat jalur ini, dan mewarisi jawaban
  // manusia jelas lebih baik daripada menanyakan ulang kepada OSM yang untuk
  // alamat Malang sebagian besar tidak tahu.
  //
  // Ini TIDAK melanggar spec T6 ("jangan ambil ulang alamat dari profil"). Yang
  // T6 cegah adalah berubahnya ALAMAT tujuan mitra ketika klien memesan untuk
  // tempat lain. Di sini perbandingannya menuntut teks yang IDENTIK, sehingga
  // tidak ada alamat yang berubah — yang diwarisi hanyalah jawaban atas
  // pertanyaan yang sudah pernah dijawab manusia. MELONGGARKAN perbandingan ini
  // (mis. mencocokkan sebagian, atau mengabaikan nomor rumah) mengembalikan
  // persis bahaya yang T6 cegah.
  const { data: profil } = await supabase
    .from("clients")
    .select("alamat, alamat_lat, alamat_lon")
    .eq("id", clientId)
    .maybeSingle();

  const warisan =
    profil &&
    profil.alamat_lat !== null &&
    profil.alamat_lon !== null &&
    normalkanAlamat(String(profil.alamat ?? "")) === normalkanAlamat(cekAlamat.nilai)
      ? { lat: profil.alamat_lat as number, lon: profil.alamat_lon as number }
      : null;

  // Geocoding TIDAK PERNAH menggagalkan penyimpanan (spec T6) — komentar lama
  // di bawah tetap berlaku; yang berubah hanya bahwa ia dilewati saat ada warisan.
  const koordinat = warisan ?? (await geocodeAlamat(cekAlamat.nilai));
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

Run: `cd web && npx vitest run tests/transport-warisan-koordinat.test.ts`
Expected: PASS, 4 test

Bila test pertama tetap merah dengan `profil` bernilai `null`: RLS `clients` mungkin tidak mengizinkan klien membaca barisnya sendiri lewat kolom-kolom ini. Periksa policy `clients` di `web/supabase/migrations/`; bila memang tertutup, **jangan longgarkan RLS** — baca profilnya lewat helper data passport yang sudah ada dan sudah terbukti boleh (`src/lib/passport/data.ts`).

- [ ] **Step 5: Jalankan SELURUH suite**

Run: `cd web && npm test && npm run lint`
Expected: PASS, lint 0 error

- [ ] **Step 6: Commit**

```bash
cd web && git add src/lib/passport/aksi.ts tests/transport-warisan-koordinat.test.ts
git commit -m "feat(transport): pengajuan mewarisi koordinat profil bila alamatnya identik"
```

---

### Task 6: Perbarui runbook transport

**Files:**
- Modify: `docs/superpowers/2026-09-07-transport-tindak-lanjut.md`

- [ ] **Step 1: Perbarui §3**

`§3` saat ini ditutup kalimat: "Jalan keluarnya dirancang di `docs/superpowers/specs/2026-09-07-padma-pemilih-lokasi-design.md`, yang belum diimplementasikan saat baris ini ditulis." Ganti dengan keadaan sebenarnya: pemilih lokasi sudah terpasang di formulir klien & mitra, dan pengajuan klien mewarisi pin bila alamatnya tidak diubah — sehingga geocoding hanya menentukan koordinat ketika admin tidak menjatuhkan pin.

- [ ] **Step 2: Turunkan prioritas utang #1 dan #2**

Pada tabel utang, tandai #1 (daftar "sesi tanpa jenjang") dan #2 (coba-ulang geocoding) sebagai turun prioritas, dengan alasan yang sama seperti §8 spec: keduanya kembali menjadi jalur pengecualian.

- [ ] **Step 3: Tambahkan butir verifikasi manual**

Pada bagian "Verifikasi yang tersisa di tangan pemilik produk", tambahkan: buka formulir mitra & klien, pastikan peta tergambar dan atribusinya terbaca, dan pastikan koordinat tersimpan sama dengan pin yang dijatuhkan.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/2026-09-07-transport-tindak-lanjut.md
git commit -m "docs(transport): runbook menyesuaikan pemilih lokasi yang sudah terpasang"
```
