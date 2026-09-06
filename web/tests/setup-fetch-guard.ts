/**
 * Pagar struktural — TIDAK ADA permintaan `fetch` KELUAR sungguhan yang
 * lolos ke internet dari dalam suite uji.
 *
 * Kenapa perlu (bukan cuma disiplin penulis uji): `tests/transport-geocode.test.ts`
 * memalsukan Nominatim lewat `vi.stubGlobal("fetch", ...)`, dan hari ini urutan
 * stub/unstub di berkas itu SUDAH benar. Tapi itu jaminan yang hidup di kepala
 * penulis uji, bukan di kode. Task berikutnya menambah pemanggil
 * `geocodeAlamat` lain; satu uji baru yang lupa men-stub akan menembak
 * `nominatim.openstreetmap.org` sungguhan dari suite — diam-diam, lambat, dan
 * memakai kuota gratis milik pihak lain (kebijakan Nominatim: 1 req/detik,
 * dan penyalahgunaan bisa berujung IP kita diblokir).
 *
 * Pagar ini membuat kelas kesalahan itu MUSTAHIL lolos diam-diam: `fetch` ke
 * host mana pun selain Supabase/Postgres lokal (127.0.0.1 / localhost / ::1)
 * MELEMPAR dengan pesan yang menjelaskan kenapa, kecuali test itu sendiri
 * sudah men-stub `fetch` (vi.stubGlobal MENIMPA `globalThis.fetch`
 * sepenuhnya, jadi begitu sebuah test men-stub, pagar ini otomatis tidak lagi
 * ada di jalur permintaan itu — itulah yang membuat stub Nominatim di
 * transport-geocode.test.ts tetap berfungsi seperti biasa).
 *
 * Dipasang lewat `setupFiles`, BUKAN `globalSetup`: `globalSetup`
 * (tests/global-setup.ts) berjalan SEKALI di proses terpisah dari worker
 * tempat berkas test sungguhan dieksekusi (lihat komentar di berkas itu:
 * "setupFiles hanya berlaku di dalam worker test — globalSetup butuh env-nya
 * sendiri") — mem-patch `globalThis.fetch` di sana tidak akan pernah terlihat
 * oleh kode yang benar-benar diuji. `setupFiles` berjalan DI DALAM worker,
 * tempat yang sama dengan `fetch` yang sebenarnya dipanggil kode aplikasi.
 *
 * Klien admin Supabase (`src/lib/supabase/admin.ts`) SENGAJA tidak dikunci
 * terhadap `globalThis.fetch` (lihat riwayat commit) — ia harus tetap
 * memakai `fetch` global apa pun yang aktif, termasuk pagar ini, supaya
 * MSW/OTel/log `next dev` dan uji-uji lain yang menstub `fetch` untuk
 * mensimulasikan "Supabase mati" tetap bekerja. Karena klien admin selalu
 * bicara ke 127.0.0.1 (Supabase lokal), pagar ini meloloskannya seperti
 * biasa — pagar ini HANYA menahan permintaan ke host pihak ketiga sungguhan.
 */
const fetchAsli = globalThis.fetch;

const HOST_DIIZINKAN = new Set(["127.0.0.1", "localhost", "::1"]);

function namaHost(masukan: RequestInfo | URL): string {
  const url = masukan instanceof Request ? masukan.url : String(masukan);
  try {
    return new URL(url, "http://127.0.0.1").hostname;
  } catch {
    return "";
  }
}

// Async (bukan melempar sinkron): `fetch` asli selalu memulangkan Promise dan
// menolaknya pada galat jaringan, tidak pernah melempar sinkron saat
// dipanggil. Pagar ini menjaga kontrak yang sama supaya pemanggil yang
// menulis `fetch(...).catch(...)` atau `await fetch(...)` di dalam try/catch
// tetap berperilaku wajar — konsisten dengan API sungguhan, bukan kejutan
// baru.
async function fetchTerpagar(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
  const host = namaHost(args[0]);
  if (!HOST_DIIZINKAN.has(host)) {
    throw new Error(
      `[pagar-fetch-uji] Permintaan fetch KELUAR ke "${String(args[0])}" ditolak. ` +
        "Layanan pihak ketiga (mis. Nominatim) HARUS dipalsukan lewat " +
        'vi.stubGlobal("fetch", ...) di dalam test itu sendiri — biaya, kuota, dan ' +
        "lambatnya permintaan sungguhan tidak boleh bocor ke suite uji. Bila test ini " +
        "memang perlu memanggil Supabase/Postgres lokal, pastikan URL-nya menunjuk " +
        "127.0.0.1/localhost, bukan host lain.",
    );
  }
  return fetchAsli(...args);
}

globalThis.fetch = fetchTerpagar as typeof fetch;
