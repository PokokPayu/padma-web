import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { normalkanAlamat } from "./alamat";
import type { Koordinat } from "./jarak";

/**
 * Alamat → koordinat, lewat Nominatim (OpenStreetMap), dengan cache.
 *
 * `import "server-only"` bukan hiasan: dari browser panggilan ini tak
 * terkendali, dan ia mengungkap pemakaian kita kepada pihak ketiga tanpa
 * perlu. Direktif itu membuat impor dari komponen klien GAGAL DI BUILD, bukan
 * gagal diam-diam di produksi.
 *
 * Fungsi ini TIDAK PERNAH melempar. Pemanggilnya adalah jalur simpan alamat,
 * dan alamat adalah data operasional yang mitra butuhkan untuk datang ke
 * tempat yang benar; menolak menyimpannya karena OSM sedang bermasalah
 * menukar masalah kecil dengan masalah besar (spec T6). Kegagalan apa pun
 * berakhir sebagai `null`, yang artinya satu hal saja: jenjangnya tidak
 * disarankan, dan admin memilih sendiri.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

/**
 * Kebijakan Nominatim: maksimal 1 permintaan per detik.
 *
 * Dibaca dari env (bukan konstanta tetap) SEMATA agar uji bisa menyetelnya ke
 * 0 lewat `vitest.config.ts` — tanpa itu setiap uji yang memanggil
 * `geocodeAlamat` dua kali membayar ~1,1 detik tidur sungguhan. Di produksi
 * env ini tidak pernah diset, jadi jeda sungguhan tetap berlaku.
 */
const JEDA_MINIMAL_MS = Number(process.env.NOMINATIM_JEDA_MINIMAL_MS ?? 1100);
let terakhirDipanggil = 0;

function userAgent(): string {
  // Kebijakan Nominatim menuntut User-Agent yang mengidentifikasi aplikasi
  // BESERTA cara menghubungi pemiliknya. Tanpa itu permintaan kita berhak
  // ditolak, dan penolakannya akan terlihat seperti "alamat tidak ditemukan".
  return process.env.NOMINATIM_USER_AGENT ?? "PADMA-Wellness/1.0 (admin@padma.test)";
}

async function tungguGiliran(): Promise<void> {
  const sejak = Date.now() - terakhirDipanggil;
  if (sejak < JEDA_MINIMAL_MS) {
    await new Promise((r) => setTimeout(r, JEDA_MINIMAL_MS - sejak));
  }
  terakhirDipanggil = Date.now();
}

export async function geocodeAlamat(alamat: string): Promise<Koordinat | null> {
  const kunci = normalkanAlamat(alamat);
  if (kunci === "") return null;

  // Seluruh sisa fungsi dibungkus SATU try/catch — bukan cuma pemanggilan
  // Nominatim. `createAdminSupabase()` MELEMPAR bila env Supabase kosong, dan
  // `select`/`upsert` postgrest-js bisa melempar pada kegagalan tak terduga
  // (mis. koneksi DB putus). Membiarkan salah satunya lolos akan membocorkan
  // janji "tidak pernah melempar" di dokblok atas pada jalur salah-pasang-env,
  // bukan cuma jalur jaringan Nominatim — dan pemanggilnya (jalur simpan
  // alamat) tidak boleh gagal karena itu.
  try {
    const supabase = createAdminSupabase();

    const { data: tersimpan } = await supabase
      .from("geocode_cache")
      .select("lat, lon")
      .eq("alamat_normal", kunci)
      .maybeSingle();

    // Baris yang ADA sudah menjawab, termasuk bila jawabannya "gagal" (lat NULL).
    if (tersimpan) {
      return tersimpan.lat === null || tersimpan.lon === null
        ? null
        : { lat: tersimpan.lat as number, lon: tersimpan.lon as number };
    }

    let hasil: Koordinat | null = null;
    try {
      await tungguGiliran();
      const url = `${NOMINATIM}?q=${encodeURIComponent(alamat)}&format=jsonv2&limit=1&countrycodes=id`;
      const jawaban = await fetch(url, { headers: { "User-Agent": userAgent() } });
      if (jawaban.ok) {
        const isi = (await jawaban.json()) as Array<{ lat: string; lon: string }>;
        if (isi.length > 0) {
          const lat = Number(isi[0].lat);
          const lon = Number(isi[0].lon);
          if (Number.isFinite(lat) && Number.isFinite(lon)) hasil = { lat, lon };
        }
      }
    } catch {
      // Sengaja ditelan (lapis dalam). Kegagalan jaringan Nominatim harus
      // tetap lanjut ke pencatatan cache di bawah, bukan lompat langsung ke
      // catch terluar dan MELEWATKAN pencatatan kegagalannya.
      hasil = null;
    }

    // Kegagalan pun disimpan — itulah yang mencegah alamat tak dikenal
    // ditanyakan ulang setiap kali formulirnya dibuka.
    await supabase.from("geocode_cache").upsert({
      alamat_normal: kunci,
      lat: hasil?.lat ?? null,
      lon: hasil?.lon ?? null,
      dicoba_pada: new Date().toISOString(),
    });

    return hasil;
  } catch {
    // Lapis TERLUAR: env Supabase kosong, atau kegagalan tak terduga lain di
    // luar panggilan Nominatim itu sendiri. Lihat dokblok di atas — fungsi
    // ini TIDAK PERNAH melempar, bahkan pada salah-pasang env sekalipun.
    return null;
  }
}
