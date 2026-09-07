/**
 * ALAT UKUR SEKALI PAKAI — bukan bagian aplikasi, tidak dipanggil siapa pun.
 *
 * Menjawab satu pertanyaan yang tidak bisa dijawab uji otomatis mana pun:
 * seberapa jujur Nominatim menjawab ALAMAT SUNGGUHAN daerah operasi PADMA?
 *
 * Sengaja TIDAK memakai `lib/transport/geocode.ts`, walau query HTTP-nya
 * disalin persis dari sana. Alasannya bukan kemalasan:
 *   - `geocodeAlamat()` menulis hasilnya — termasuk KEGAGALAN — ke
 *     `geocode_cache` tanpa masa kedaluwarsa, dan `DELETE` dicabut dari
 *     `authenticated`. Mengukur dengan alat yang mengotori subjeknya berarti
 *     percobaan ini meninggalkan bekas permanen di basis data.
 *   - `geocodeAlamat()` memulangkan `Koordinat | null` saja. Yang perlu
 *     dilihat justru hal yang dibuangnya: OSM menjawab RUMAH atau menjawab
 *     TITIK TENGAH KELURAHAN? Keduanya pulang sebagai koordinat yang sah.
 *
 * `haversineKm` dan `jenjangDariJarak` DIIMPOR, tidak ditiru — yang diukur
 * harus fungsi yang sungguh dipakai produksi, bukan salinannya.
 *
 * Pakai:
 *   npx tsx scripts/probe-geocode.ts daftar-alamat.txt -8.6705,115.2126
 *
 * Argumen kedua = koordinat domisili mitra (titik acuan jarak). Berkas daftar:
 * satu alamat per baris; baris kosong dan baris berawalan # dilewati.
 */
import { readFileSync } from "node:fs";
import { haversineKm, jenjangDariJarak, LABEL_JENJANG, type Koordinat } from "../src/lib/transport/jarak";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const JEDA_MS = 1100; // kebijakan Nominatim: maksimal 1 permintaan per detik.

/**
 * `addresstype` yang berarti OSM menemukan BENDA, bukan wilayah. Sisanya —
 * village, suburb, city, administrative, postcode, dst — adalah TITIK TENGAH
 * sebuah poligon: koordinat yang sah, presisi yang bukan alamatnya.
 */
const TIPE_TITIK = new Set(["house", "building", "amenity", "shop", "office", "tourism", "leisure", "healthcare", "place_of_worship"]);
const TIPE_JALAN = new Set(["road", "residential", "street"]);

type Hasil = {
  alamat: string;
  koordinat: Koordinat | null;
  addresstype: string;
  namaOSM: string;
  kandidat: number;
  /** Jarak antara jawaban teratas dan kandidat kedua, km. OSM bimbang bila besar. */
  bimbangKm: number | null;
};

async function tanya(alamat: string): Promise<Hasil> {
  const kosong: Hasil = { alamat, koordinat: null, addresstype: "—", namaOSM: "—", kandidat: 0, bimbangKm: null };
  // `limit=5`, bukan 1: peringkat Nominatim stabil, jadi kandidat teratas dari
  // lima SAMA dengan satu-satunya kandidat yang dilihat aplikasi — sambil
  // memperlihatkan berapa tempat lain yang hampir sama layaknya. Alamat dengan
  // lima kandidat berjauhan berarti `limit=1` di produksi adalah lemparan koin.
  const url = `${NOMINATIM}?q=${encodeURIComponent(alamat)}&format=jsonv2&limit=5&countrycodes=id`;
  try {
    const jawaban = await fetch(url, { headers: { "User-Agent": "PADMA-Wellness/1.0 (probe; admin@padma.test)" } });
    if (!jawaban.ok) return kosong;
    const isi = (await jawaban.json()) as Array<{ lat: string; lon: string; display_name: string; addresstype?: string }>;
    if (isi.length === 0) return kosong;
    const k = { lat: Number(isi[0].lat), lon: Number(isi[0].lon) };
    if (!Number.isFinite(k.lat) || !Number.isFinite(k.lon)) return kosong;
    const kedua = isi[1] ? { lat: Number(isi[1].lat), lon: Number(isi[1].lon) } : null;
    return {
      alamat,
      koordinat: k,
      addresstype: isi[0].addresstype ?? "?",
      namaOSM: isi[0].display_name,
      kandidat: isi.length,
      bimbangKm: kedua ? haversineKm(k, kedua) : null,
    };
  } catch {
    return kosong;
  }
}

/** Berapa km lagi sebelum jarak ini pindah jenjang — ke bawah maupun ke atas. */
function jarakKeBatas(km: number): number {
  const batas = [5, 10, 15, 20];
  return Math.min(...batas.map((b) => Math.abs(km - b)));
}

async function main() {
  const [berkas, acuanTeks] = process.argv.slice(2);
  if (!berkas || !acuanTeks) {
    console.error("Pakai: npx tsx scripts/probe-geocode.ts <berkas-alamat> <lat,lon-mitra>");
    process.exit(1);
  }
  const [lat, lon] = acuanTeks.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    console.error(`Koordinat acuan tidak sah: ${acuanTeks}`);
    process.exit(1);
  }
  const acuan: Koordinat = { lat, lon };

  const alamat = readFileSync(berkas, "utf8")
    .split("\n")
    .map((b) => b.trim())
    .filter((b) => b !== "" && !b.startsWith("#"));

  console.log(`${alamat.length} alamat · acuan ${lat},${lon} · ~${Math.ceil((alamat.length * JEDA_MS) / 1000)} detik\n`);

  const hasil: Array<Hasil & { km: number | null; jenjang: string; kelas: string }> = [];
  for (const [i, a] of alamat.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, JEDA_MS));
    const h = await tanya(a);
    const km = h.koordinat ? haversineKm(acuan, h.koordinat) : null;
    const kelas = !h.koordinat
      ? "GAGAL"
      : TIPE_TITIK.has(h.addresstype)
        ? "TITIK"
        : TIPE_JALAN.has(h.addresstype)
          ? "JALAN"
          : "AREA";
    const jenjang = km === null ? "null" : LABEL_JENJANG[jenjangDariJarak(km)];
    hasil.push({ ...h, km, jenjang, kelas });

    const kolomKm = km === null ? "     —" : `${km.toFixed(2).padStart(6)} km`;
    const batas = km === null ? "" : ` · ${jarakKeBatas(km).toFixed(2)} km dari batas jenjang`;
    const bimbang = h.bimbangKm !== null && h.bimbangKm > 2 ? ` · ⚠ kandidat #2 berjarak ${h.bimbangKm.toFixed(1)} km` : "";
    console.log(`${kelas.padEnd(5)} ${kolomKm}  ${jenjang.padEnd(9)} ${a}`);
    console.log(`      ${h.addresstype} · ${h.namaOSM}${batas}${bimbang}\n`);
  }

  const hitung = (k: string) => hasil.filter((h) => h.kelas === k).length;
  console.log("──────────────────────────────────────────────");
  console.log(`TITIK (alamat sungguhan)     : ${hitung("TITIK")}`);
  console.log(`JALAN (ruas, bukan nomornya) : ${hitung("JALAN")}`);
  console.log(`AREA  (titik tengah wilayah) : ${hitung("AREA")}   ← jenjangnya tebakan yang tampak pasti`);
  console.log(`GAGAL (jenjang null)         : ${hitung("GAGAL")}   ← ini yang AMAN: muncul di penghitung /admin`);

  const rawan = hasil.filter((h) => h.kelas === "AREA" && h.km !== null && jarakKeBatas(h.km) < 1);
  if (rawan.length > 0) {
    console.log(`\n⚠ ${rawan.length} alamat berkoordinat wilayah DAN kurang dari 1 km dari batas jenjang.`);
    console.log("  Di sinilah salah tagih lahir tanpa satu pun tanda:");
    for (const h of rawan) console.log(`  · ${h.alamat} → ${h.km!.toFixed(2)} km (${h.jenjang})`);
  }
}

main();
