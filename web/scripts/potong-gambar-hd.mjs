// Memotong ilustrasi dari gambar HD kiriman klien (docs/landingpage-v2/gambar-hd)
// menjadi aset situs di public/situs.
//
// Gambar HD klien berupa kartu utuh dengan teks tertanam; README handoff
// melarang teks di dalam gambar, jadi yang diambil hanya lingkaran
// ilustrasinya — teksnya tetap HTML. Latar dibuang menjadi transparan agar
// ikon menyatu dengan kartu putih maupun krem, dan agar garis penghubung
// fase tidak tembus ke dalam lingkaran.
//
// Pusat & diameter lingkaran diukur dari tepi luar garis emasnya. Bila klien
// mengirim revisi dengan tata letak lain, ukur ulang lalu jalankan:
//   node scripts/potong-gambar-hd.mjs   (dari folder web/)
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const AKAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SUMBER = path.join(AKAR, "docs/landingpage-v2/gambar-hd");
const TUJUAN = path.join(AKAR, "web/public/situs");

const LINGKARAN = [
  // [berkas HD, pusat x, pusat y, lebar, tinggi, berkas situs, sisi keluaran]
  // Lingkaran gambar AI tidak bulat sempurna; tinggi yang terlalu besar
  // ikut menangkap ujung garis penghubung fase di atas & bawahnya.
  ["1001271075.png", 613.5, 480.5, 828, 822, "alasan-1.png", 480],
  ["1001271076.png", 613, 481, 831, 825, "alasan-2.png", 480],
  ["1001271077.png", 613, 480.5, 827, 822, "alasan-3.png", 480],
  // Kolom fase tidak diperbesar: lingkaran aslinya hanya ~237 px.
  ["1001271132.png", 231.5, 351, 237, 232, "fase-1-preconception.png", 240],
  ["1001271132.png", 231.5, 611.7, 237, 230.5, "fase-2-pregnancy.png", 240],
  ["1001271132.png", 231.5, 867.8, 237, 229.5, "fase-3-postpartum.png", 240],
  ["1001271132.png", 231.5, 1124.8, 237, 231.5, "fase-4-lactation.png", 240],
  ["1001271132.png", 231.5, 1375.5, 236, 229, "fase-5-menopause.png", 240],
  ["1001271135.png", 252.5, 286.5, 318, 318, "format-learn.png", 300],
  ["1001271135.png", 252, 771, 317, 317, "format-live.png", 300],
  ["1001271135.png", 251.5, 1240, 316, 313, "format-home.png", 300],
  ["1001271138.png", 357, 407.5, 457, 456, "passport-tanpa.png", 400],
  ["1001271138.png", 356.5, 1097.5, 458, 454, "passport-dengan.png", 400],
];

// Emblem empat fase berlatar hitam → hero Beranda. Tidak bulat sempurna
// (1475 × 1450 px), jadi dipotong persegi dari sisi terpanjangnya.
const EMBLEM = { berkas: "1001270802.png", cx: 767.5, cy: 759, sisi: 1491, keluaran: "hero-beranda.png", ukuran: 1040 };
const HIJAU_EMBLEM = [16, 49, 40];
const EMAS_EMBLEM = [177, 138, 77];

const LANTAI_ALFA = 0.03; // derau latar kertas di bawah ini dianggap latar

async function piksel(berkas, kiri, atas, sisi) {
  const { data } = await sharp(path.join(SUMBER, berkas))
    .removeAlpha()
    .extract({ left: kiri, top: atas, width: sisi, height: sisi })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

async function simpan(rgba, sisi, ukuran, keluaran) {
  await sharp(rgba, { raw: { width: sisi, height: sisi, channels: 4 } })
    .resize(ukuran, ukuran, { kernel: "lanczos3" })
    .png({ compressionLevel: 9 })
    .toFile(path.join(TUJUAN, keluaran));
  console.log(`${keluaran} ${ukuran}×${ukuran}`);
}

const median = (nilai) => nilai.sort((a, b) => a - b)[nilai.length >> 1];

// Latar terang → transparan (algoritme color-to-alpha GIMP, hanya arah
// menggelap). Hasilnya identik dengan aslinya bila ditaruh di atas warna
// latar yang sama, dan nyaris identik di atas krem situs lain.
async function potongLingkaran([berkas, cx, cy, lebar, tinggi, keluaran, ukuran]) {
  const r = lebar / 2;
  const sisi = Math.ceil(Math.max(lebar, tinggi) + 8);
  const kiri = Math.round(cx - sisi / 2);
  const atas = Math.round(cy - sisi / 2);
  const rgb = await piksel(berkas, kiri, atas, sisi);
  // Jarak dari pusat dalam satuan jari-jari horizontal (elips dipipihkan jadi lingkaran).
  const jarak = (i) =>
    Math.hypot(kiri + (i % sisi) + 0.5 - cx, ((atas + Math.floor(i / sisi) + 0.5 - cy) * lebar) / tinggi);

  // Warna latar: median sudut potongan di luar lingkaran.
  const sudut = [[], [], []];
  for (let i = 0; i < sisi * sisi; i++) {
    if (jarak(i) > r + 3) for (let c = 0; c < 3; c++) sudut[c].push(rgb[i * 3 + c]);
  }
  const latar = sudut.map(median);

  const rgba = Buffer.alloc(sisi * sisi * 4);
  for (let i = 0; i < sisi * sisi; i++) {
    const p = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]].map((v, c) => Math.min(v, latar[c]));
    let alfa = Math.max(...p.map((v, c) => (latar[c] - v) / latar[c]));
    if (alfa < LANTAI_ALFA) alfa = 0;
    for (let c = 0; c < 3; c++) {
      rgba[i * 4 + c] = alfa ? Math.max(0, Math.round((p[c] - latar[c]) / alfa + latar[c])) : latar[c];
    }
    // Di luar garis emas (sisa garis penghubung, tepi kartu) dibuang;
    // piksel tepi dipudarkan supaya tidak bergerigi. Topeng hanya menyentuh
    // alfa — warna di atas sudah dihitung dari alfa aslinya.
    const topeng = Math.min(1, Math.max(0, r + 1 - jarak(i)));
    rgba[i * 4 + 3] = Math.round(alfa * topeng * 255);
  }
  await simpan(rgba, sisi, ukuran, keluaran);
}

// Latar hitam → transparan. Color-to-alpha biasa akan membuat hijau tua
// emblem nyaris transparan (warnanya dekat hitam), jadi tiap piksel
// dianggap campuran hitam dengan salah satu dari dua tinta emblem: alfanya
// proyeksi piksel ke tinta yang arahnya paling mirip.
async function potongEmblem({ berkas, cx, cy, sisi, keluaran, ukuran }) {
  const rgb = await piksel(berkas, Math.round(cx - sisi / 2), Math.round(cy - sisi / 2), sisi);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const rgba = Buffer.alloc(sisi * sisi * 4);
  for (let i = 0; i < sisi * sisi; i++) {
    const p = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
    const panjang = Math.sqrt(dot(p, p));
    let alfa = 0;
    let warna = p;
    if (panjang > 6) {
      const mirip = (t) => dot(p, t) / (panjang * Math.sqrt(dot(t, t)));
      const tinta = mirip(HIJAU_EMBLEM) >= mirip(EMAS_EMBLEM) ? HIJAU_EMBLEM : EMAS_EMBLEM;
      const t = dot(p, tinta) / dot(tinta, tinta);
      alfa = Math.min(1, t);
      if (t < 1) warna = p.map((v) => Math.min(255, Math.round(v / t)));
    }
    if (alfa < LANTAI_ALFA) alfa = 0;
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = alfa ? warna[c] : 0;
    rgba[i * 4 + 3] = Math.round(alfa * 255);
  }
  await simpan(rgba, sisi, ukuran, keluaran);
}

for (const l of LINGKARAN) await potongLingkaran(l);
await potongEmblem(EMBLEM);
