/**
 * Bentuk kanonik sebuah alamat, dipakai sebagai KUNCI CACHE geocoding.
 *
 * Sengaja konservatif: hanya huruf kecil dan perataan spasi. Normalisasi yang
 * lebih agresif — membuang "Jl.", menyeragamkan "No." — menggabungkan alamat
 * yang MIRIP menjadi satu kunci, dan dua rumah berbeda yang berbagi koordinat
 * adalah salah tagih yang tidak akan pernah terlihat.
 */
export function normalkanAlamat(teks: string): string {
  return teks.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Bentuk-bentuk pertanyaan yang dicoba berurutan ke Nominatim, dari yang
 * paling spesifik ke yang paling longgar.
 *
 * Kenapa perlu: Nominatim menuntut SELURUH kata cocok, dan gagal TOTAL — bukan
 * mundur ke jalannya — begitu ada satu kata yang tak dikenal. Akibatnya
 * semakin lengkap alamat ditulis, semakin besar kemungkinannya gagal:
 * kebalikan dari naluri siapa pun yang merancang formulir alamat. Diukur pada
 * 32 alamat berbentuk Malang, 7 September 2026: alamat apa adanya berhasil 6
 * kali, bentuk "jalan + kota" berhasil 23 kali (19% -> 72%).
 *
 * Tiga tingkat, sesuai rancangan yang disepakati:
 *   1. alamat apa adanya       — yang paling spesifik selalu dicoba lebih dulu
 *   2. tanpa nomor rumah       — OSM Malang tidak punya data setingkat rumah
 *   3. jalan + kota            — ruas pertama (bersih) digabung ruas terakhir
 *
 * VARIAN KEMBAR DIBUANG. Alamat tanpa bagian untuk dikupas menghasilkan satu
 * varian saja, sehingga tetap berbiaya satu permintaan — bukan tiga. Tanpa ini
 * ladder membakar jatah 1 permintaan/detik untuk menanyakan hal yang sama
 * berulang kali, dan yang paling dirugikan justru alamat yang paling sederhana.
 *
 * Fungsi MURNI: tidak menyentuh jaringan, tidak membaca env, tidak melempar.
 */
export function variasiAlamat(teks: string): string[] {
  const penuh = teks.trim().replace(/\s+/g, " ");
  if (penuh === "") return [];

  const varian = [penuh];
  const tambah = (v: string) => {
    const bersih = v.trim().replace(/\s+/g, " ").replace(/\s+,/g, ",");
    // Perbandingan lewat bentuk kanonik: "Jl. Kawi" dan "jl. kawi " adalah
    // pertanyaan yang sama bagi Nominatim, dan menanyakan keduanya sia-sia.
    if (bersih !== "" && !varian.some((a) => normalkanAlamat(a) === normalkanAlamat(bersih))) {
      varian.push(bersih);
    }
  };

  tambah(tanpaNomorRumah(penuh));

  // Ruas PERTAMA (nama jalan) digabung ruas TERAKHIR (biasanya kota). Yang di
  // tengah — kelurahan, kecamatan — justru kata-kata yang paling sering tidak
  // dikenal OSM untuk alamat Indonesia.
  const ruas = penuh.split(",").map((r) => r.trim()).filter((r) => r !== "");
  if (ruas.length >= 2) {
    const jalan = bersihkanRuasJalan(ruas[0]);
    if (jalan !== "") tambah(`${jalan}, ${ruas[ruas.length - 1]}`);
  }

  return varian;
}

/** "Jl. Kawi No. 24" -> "Jl. Kawi". Mengenali "No.", "no", dan "Nomor". */
function tanpaNomorRumah(teks: string): string {
  return teks.replace(/\s*\b(?:no\.?|nomor)\s*\d+[A-Za-z]?\b/gi, "");
}

/**
 * Membersihkan ruas nama jalan dari penanda yang mematikan pencarian: nomor
 * rumah, gang, blok, dan RT/RW. Keempatnya lazim di alamat Indonesia dan
 * hampir tidak pernah ada di data OSM.
 */
function bersihkanRuasJalan(ruas: string): string {
  return tanpaNomorRumah(ruas)
    .replace(/\s*\b(?:gang|gg\.?)\s*[IVXLC\d]+[A-Za-z]?\b/gi, "")
    .replace(/\s*\bblok\s*[A-Za-z0-9]+\b/gi, "")
    .replace(/\s*\brt\.?\s*\d+\b/gi, "")
    .replace(/\s*\brw\.?\s*\d+\b/gi, "")
    .trim()
    .replace(/\s+/g, " ");
}
