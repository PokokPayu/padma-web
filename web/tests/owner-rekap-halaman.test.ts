/**
 * Modul REKAP HONOR panel owner — `/owner/rekap`.
 *
 * Halaman inilah yang menjawab satu pertanyaan yang dibayar sungguhan setiap
 * Sabtu: berapa honor yang harus diterima setiap mitra untuk pekan ini. Tujuh
 * kelas regresi yang dijaga berkas ini — SEMUANYA berakhir dengan uang yang
 * salah dibayarkan tanpa satu pun error di layar:
 *
 *  1. PENJAGA PERAN HILANG DARI DALAM ACTION. Server action adalah endpoint
 *     POST tersendiri; `src/app/owner/layout.tsx` TIDAK pernah dilewati saat
 *     action dipanggil langsung — dibuktikan dengan mem-POST action panel admin
 *     dari rute lain sebagai admin, dan mutasinya berhasil. Penjaga di dalam
 *     action ini wajib `["owner"]`, BUKAN `["admin","owner"]`.
 *
 *  2. `ditandai_oleh` / `dibayar_pada` DARI PAYLOAD. Terbukti bisa dipalsukan:
 *     owner menandai honor ATAS NAMA ADMIN, bertanggal 1999. Keduanya wajib
 *     lahir dari identitas sesi dan jam basis data, tidak pernah dari argumen.
 *
 *  3. MENANDAI DUA KALI. `unique (partner_id, week_start)` melempar `23505` —
 *     BUKAN no-op. Tanpa `ignoreDuplicates`, klik kedua (atau dua tab terbuka)
 *     menampilkan kegagalan atas perbuatan yang sebenarnya sudah berhasil, dan
 *     pemiliknya akan membayar dua kali karena mengira yang pertama gagal.
 *     Idempoten juga berarti stempel pertama TIDAK BOLEH tertimpa: `dibayar_pada`
 *     adalah bukti kapan honor benar-benar dibayarkan.
 *
 *  4. TANDA YATIM. `honor_marks.week_start` hari ini masih menerima tanggal apa
 *     pun (tidak ada CHECK isodow di basis data). Satu tanda bertanggal Rabu
 *     tidak akan pernah cocok dengan bucket rekap mana pun — honornya terlihat
 *     "belum dibayar" selamanya, dan tandanya TIDAK BISA DIHAPUS karena DELETE
 *     sudah dicabut (owner pun 42501).
 *
 *  5. SESI SUSULAN DI BAWAH TANDA "SUDAH DIBAYAR". Sesi yang diselesaikan
 *     SESUDAH pekan itu ditandai dibayar menaikkan angka honor di baris yang
 *     sudah berlabel lunas. Itu tidak boleh terjadi diam-diam.
 *
 *  6. SESI TAK BERTARIF DITELAN. Sesi yang lebih tua dari tarif paling awal
 *     layanannya tidak boleh dihitung nol tanpa jejak — itu pekerjaan bidan
 *     yang hilang dari rekap.
 *
 *  7. TARIF PADA TANGGAL SESI. Menaikkan tarif hari ini tidak boleh menggeser
 *     satu angka pun di pekan yang sudah lewat, termasuk pekan yang honornya
 *     sudah dibayarkan.
 *
 * Data uji berprefiks `PAD-UJI` dan dibersihkan `afterAll`, termasuk baris
 * `jejak_status_bayar` (tabel SENGAJA tanpa foreign key, jadi tidak ikut
 * tersapu saat sesinya dihapus).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { awalPekan, geserHari } from "@/lib/owner/pekan";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { signInAs } from "./helpers/as-user";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const admin = createAdminSupabase();

// Lapisan data & action memakai sesi pengguna (`createServerSupabase`). Di
// vitest tidak ada cookie, jadi klien ber-SESI SUNGGUHAN disuntikkan: RLS dan
// requireRole tetap berjalan apa adanya, persis seperti di server.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const jejak = vi.hoisted(() => ({ revalidate: [] as string[] }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    jejak.revalidate.push(p);
  },
}));

// `redirect` sengaja MELEMPAR: bila penjaga peran memanggilnya, test harus
// gagal keras, bukan diam-diam melanjutkan mutasi uang.
vi.mock("next/navigation", () => ({
  redirect: (ke: string) => {
    throw new Error(`REDIRECT ${ke}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/owner/rekap",
}));

// --- Fixture -----------------------------------------------------------------

const LAYANAN_BERTARIF = "11111111-1111-1111-1111-1111111111a5";
const LAYANAN_TANPA_TARIF = "11111111-1111-1111-1111-1111111112a5";
// Harga menempel di VARIAN sejak Task 3 — setiap layanan fixture di atas
// memperoleh varian BAKU sendiri (label kosong, sama seperti backfill Task 1).
const VARIAN_BERTARIF = "11111111-1111-1111-1111-2111111111a5";
const VARIAN_TANPA_TARIF = "11111111-1111-1111-1111-2111111112a5";
const TARIF_LAMA_ID = "99999999-9999-9999-9999-9999999999a5";

const MITRA_A = "33333333-3333-3333-3333-3333333331a5"; // tidak pernah ditandai
const MITRA_B = "33333333-3333-3333-3333-3333333332a5"; // subjek tanda bayar
const MITRA_C = "33333333-3333-3333-3333-3333333333a5"; // subjek sesi susulan
const MITRA_HANTU = "33333333-3333-3333-3333-33333333ffa5"; // tidak pernah ada

// Nama mitra ini dipakai untuk menguji kotak cari `BilahDaftar` — MITRA_A
// tidak pernah ditandai dibayar di describe "halaman rekap honor" (describe
// itu berjalan SEBELUM describe "tandaiHonorDibayar"), jadi pekannya juga
// cocok untuk menguji saringan honor=tuntas/belum.
const NAMA_MITRA = "PAD-UJI Bidan Rekap Alfa";

const KLIEN = "44444444-4444-4444-4444-4444444444a5";
const PADMA_ID = "PAD-UJI-00A5";

const SESI = {
  a1: "66666666-6666-6666-6666-6666666661a5",
  a2: "66666666-6666-6666-6666-6666666662a5",
  a3: "66666666-6666-6666-6666-6666666663a5", // terjadwal — tidak berhonor
  a4: "66666666-6666-6666-6666-6666666664a5", // batal — tidak berhonor
  a5: "66666666-6666-6666-6666-6666666665a5", // tak bertarif
  b1: "66666666-6666-6666-6666-6666666666a5",
  c1: "66666666-6666-6666-6666-6666666667a5",
  c2: "66666666-6666-6666-6666-6666666668a5", // terjadwal, DISELESAIKAN sesudah tanda
};

// Tarif fixture: 400.000 / 150.000 -> margin 250.000 per sesi.
const HARGA = 400_000;
const HONOR = 150_000;

// Pekan uji sengaja jauh di masa lalu supaya tidak pernah bertabrakan dengan
// fixture berkas test lain (yang memakai pekan relatif terhadap hari ini) dan
// supaya `berlaku_sejak` seed — yang lahir bertanggal `supabase db reset` —
// tidak pernah ikut terpilih.
const BERLAKU_LAMA = "2020-01-06"; // Senin
const PEKAN_A = "2024-03-04"; // Senin
const PEKAN_B = "2024-03-11"; // Senin

const HARI_INI = hariIniJakarta();
const PEKAN_DEPAN = geserHari(awalPekan(HARI_INI), 7);

// Pekan A, sesi SELESAI: a1, a2 (bertarif, MITRA_A), a5 (tak bertarif, MITRA_A),
// b1 (bertarif, MITRA_B). Total 4 sesi selesai; 3 di antaranya bertarif.
const HONOR_A = 2 * HONOR;
const HONOR_B = 1 * HONOR;
const TOTAL_HONOR_A = HONOR_A + HONOR_B;
const TOTAL_HARGA_A = 3 * HARGA;
const MARGIN_A = TOTAL_HARGA_A - TOTAL_HONOR_A;

async function bersihkan() {
  for (const id of Object.values(SESI)) {
    await admin.from("sessions").delete().eq("id", id);
    // Tabel jejak SENGAJA tanpa foreign key — penghapusan sesi di atas tidak
    // menyapunya, dan tanpa baris ini `npm test` menumpuk yatim tiap run.
    await admin.from("jejak_status_bayar").delete().eq("sesi_id", id);
  }
  await admin.from("clients").delete().eq("id", KLIEN);
  for (const mitra of [MITRA_A, MITRA_B, MITRA_C]) {
    await admin.from("honor_marks").delete().eq("partner_id", mitra);
  }
  for (const v of [VARIAN_BERTARIF, VARIAN_TANPA_TARIF]) {
    await admin.from("variant_rates").delete().eq("variant_id", v);
  }
  for (const mitra of [MITRA_A, MITRA_B, MITRA_C]) {
    await admin.from("partners").delete().eq("id", mitra);
  }
  // `service_variants` dulu — FK-nya menunjuk `services`, urutan penghapusan
  // terbalik dari urutan penyisipan. Disapu per SERVICE_ID (bukan per id
  // varian yang kita catat sendiri): trigger `trg_terbitkan_varian_baku`
  // menerbitkan satu varian baku OTOMATIS begitu tiap layanan fixture
  // disisipkan, dengan id acak yang tidak pernah kita tahu — menyapu hanya
  // `VARIAN_BERTARIF` dkk. meninggalkan varian otomatis itu yatim, dan FK-nya
  // menahan penghapusan `services` di bawah.
  for (const svc of [LAYANAN_BERTARIF, LAYANAN_TANPA_TARIF]) {
    await admin.from("service_variants").delete().eq("service_id", svc);
  }
  for (const svc of [LAYANAN_BERTARIF, LAYANAN_TANPA_TARIF]) {
    await admin.from("services").delete().eq("id", svc);
  }
}

const { tandaiHonorDibayar } = await import("@/app/owner/rekap/aksi");
const { ambilRekap, ambilRiwayatTarifTransport, ambilTransportKhusus } = await import(
  "@/lib/owner/data"
);
const { default: RekapPage } = await import("@/app/owner/rekap/page");

const sumberAksi = baca("src/app/owner/rekap/aksi.ts");
const sumberHalaman = baca("src/app/owner/rekap/page.tsx");
const sumberTabel = baca("src/app/owner/rekap/tabel-rekap.tsx");
const sumberStatus = baca("src/app/owner/rekap/status.ts");
const sumberData = baca("src/lib/owner/data.ts");
const SEMUA_SUMBER = [sumberAksi, sumberHalaman, sumberTabel, sumberStatus, sumberData];

let sesiOwner: SupabaseClient;
let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;
let idOwner = "";
let idAdmin = "";

type BarisTanda = {
  id: string;
  partner_id: string;
  week_start: string;
  dibayar_pada: string;
  ditandai_oleh: string | null;
};

/** Seluruh tanda bayar satu mitra, dibaca lewat SERVICE ROLE (bukan RLS). */
async function tandaMitra(partnerId: string): Promise<BarisTanda[]> {
  const { data } = await admin
    .from("honor_marks")
    .select("id, partner_id, week_start, dibayar_pada, ditandai_oleh")
    .eq("partner_id", partnerId)
    .order("week_start")
    .returns<BarisTanda[]>();
  return data ?? [];
}

/**
 * Potongan markup satu kartu pekan. Setiap kartu membawa `data-pekan` berisi
 * Seninnya, jadi assertion nominal tidak pernah salah menempel pada kartu pekan
 * lain — termasuk kartu milik fixture berkas test yang berjalan paralel.
 */
function kartuPekan(markup: string, senin: string): string {
  const awal = markup.indexOf(`data-pekan="${senin}"`);
  expect(awal, `kartu pekan ${senin} tidak ada di halaman`).toBeGreaterThan(-1);
  const sisa = markup.slice(awal);
  const akhir = sisa.indexOf("</article>");
  expect(akhir, "kartu pekan tidak dibungkus <article>").toBeGreaterThan(-1);
  return sisa.slice(0, akhir);
}

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

async function renderHalaman(sp: Record<string, string> = {}): Promise<string> {
  ref.sesi = sesiOwner;
  return renderToStaticMarkup(await RekapPage({ searchParams: Promise.resolve(sp) }));
}

beforeAll(async () => {
  await bersihkan();
  sesiOwner = await signInAs("owner@padma.test");
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
  ref.sesi = sesiOwner;
  idOwner = (await sesiOwner.auth.getUser()).data.user!.id;
  idAdmin = (await sesiAdmin.auth.getUser()).data.user!.id;

  await admin.from("services").insert([
    {
      id: LAYANAN_BERTARIF,
      phase_id: "prekonsepsi",
      nama: "PAD-UJI Rekap Layanan Bertarif",
      aktif: true,
    },
    {
      id: LAYANAN_TANPA_TARIF,
      phase_id: "nifas",
      nama: "PAD-UJI Rekap Layanan Tanpa Tarif",
      aktif: true,
    },
  ]);
  // Setiap layanan wajib punya minimal satu varian (V3) — inilah yang dulu
  // menempel di `services`, sejak Task 1 hidup terpisah di sini.
  await admin.from("service_variants").insert([
    { id: VARIAN_BERTARIF, service_id: LAYANAN_BERTARIF, label: "" },
    { id: VARIAN_TANPA_TARIF, service_id: LAYANAN_TANPA_TARIF, label: "" },
  ]);
  await admin.from("partners").insert([
    { id: MITRA_A, nama: "PAD-UJI Bidan Rekap Alfa", no_hp: "0811-0000-9201" },
    { id: MITRA_B, nama: "PAD-UJI Bidan Rekap Beta", no_hp: "0811-0000-9202" },
    { id: MITRA_C, nama: "PAD-UJI Bidan Rekap Gama", no_hp: "0811-0000-9203" },
  ]);
  await admin.from("variant_rates").insert({
    id: TARIF_LAMA_ID,
    variant_id: VARIAN_BERTARIF,
    harga_klien: HARGA,
    honor_mitra: HONOR,
    berlaku_sejak: BERLAKU_LAMA,
  });
  await admin.from("clients").insert({
    id: KLIEN,
    padma_id: PADMA_ID,
    nama: "Uji Rekap Honor",
    email: "uji-rekap-honor@padma.test",
    phase_id: "nifas",
  });

  // `variant_id` diturunkan dari `layanan`: setiap layanan fixture di atas
  // punya tepat satu varian baku, jadi pemetaannya tidak ambigu.
  const variantDariLayanan = new Map([
    [LAYANAN_BERTARIF, VARIAN_BERTARIF],
    [LAYANAN_TANPA_TARIF, VARIAN_TANPA_TARIF],
  ]);
  const sesi = (
    id: string,
    partner: string,
    layanan: string,
    tanggal: string,
    status: string,
  ) => ({
    id,
    client_id: KLIEN,
    service_id: layanan,
    variant_id: variantDariLayanan.get(layanan),
    partner_id: partner,
    tanggal,
    status,
    status_bayar: "belum",
    catatan: "",
    rekomendasi: "",
    jam_mulai: "09:00",
  });

  await admin.from("sessions").insert([
    sesi(SESI.a1, MITRA_A, LAYANAN_BERTARIF, "2024-03-04", "selesai"),
    sesi(SESI.a2, MITRA_A, LAYANAN_BERTARIF, "2024-03-06", "selesai"),
    sesi(SESI.a3, MITRA_A, LAYANAN_BERTARIF, "2024-03-05", "terjadwal"),
    sesi(SESI.a4, MITRA_A, LAYANAN_BERTARIF, "2024-03-07", "dibatalkan_padma"),
    sesi(SESI.a5, MITRA_A, LAYANAN_TANPA_TARIF, "2024-03-08", "selesai"),
    sesi(SESI.b1, MITRA_B, LAYANAN_BERTARIF, "2024-03-09", "selesai"),
    sesi(SESI.c1, MITRA_C, LAYANAN_BERTARIF, "2024-03-11", "selesai"),
    sesi(SESI.c2, MITRA_C, LAYANAN_BERTARIF, "2024-03-13", "terjadwal"),
  ]);
});

afterAll(bersihkan);

beforeEach(() => {
  ref.sesi = sesiOwner;
  jejak.revalidate.length = 0;
});

// ---------------------------------------------------------------------------
// Agregasi: pekan Senin–Minggu, tarif pada tanggal sesi
// ---------------------------------------------------------------------------

describe("rekap mengelompokkan honor per pekan Senin–Minggu", () => {
  it("hanya sesi SELESAI yang berhonor — terjadwal & batal tidak ikut", async () => {
    const pekan = (await ambilRekap()).find((p) => p.senin === PEKAN_A);
    expect(pekan, "pekan uji tidak muncul di rekap — fixture gagal").toBeDefined();
    // a1, a2, a5, b1 selesai; a3 terjadwal & a4 batal wajib tertinggal.
    expect(pekan!.jumlahSesi).toBe(4);
    expect(pekan!.totalHonor).toBe(TOTAL_HONOR_A);
    expect(pekan!.totalHarga).toBe(TOTAL_HARGA_A);
    expect(pekan!.margin).toBe(MARGIN_A);
  });

  it("honor dijumlahkan PER MITRA, margin dihitung per PEKAN", async () => {
    const pekan = (await ambilRekap()).find((p) => p.senin === PEKAN_A)!;
    const a = pekan.perMitra.find((m) => m.partnerId === MITRA_A)!;
    const b = pekan.perMitra.find((m) => m.partnerId === MITRA_B)!;
    expect(a.jumlahSesi).toBe(3); // termasuk satu sesi tak bertarif
    expect(a.totalHonor).toBe(HONOR_A);
    expect(b.jumlahSesi).toBe(1);
    expect(b.totalHonor).toBe(HONOR_B);
    // Margin adalah angka PADMA — spec keputusan #6. Tidak ada margin per mitra.
    expect(a).not.toHaveProperty("margin");
  });

  it("sesi Sabtu & Minggu masuk ke pekan Senin yang sama, bukan pekan berikutnya", async () => {
    // b1 bertanggal Sabtu 2024-03-09; c1 bertanggal Senin 2024-03-11.
    const rekap = await ambilRekap();
    const a = rekap.find((p) => p.senin === PEKAN_A)!;
    const b = rekap.find((p) => p.senin === PEKAN_B)!;
    expect(a.perMitra.map((m) => m.partnerId)).toContain(MITRA_B);
    expect(b.perMitra.map((m) => m.partnerId)).toContain(MITRA_C);
  });

  it("sesi tak bertarif DILAPORKAN, bukan dihitung nol diam-diam", async () => {
    const pekan = (await ambilRekap()).find((p) => p.senin === PEKAN_A)!;
    const tak = pekan.sesiTakBertarif.filter((s) => s.id === SESI.a5);
    expect(tak, "sesi tak bertarif hilang dari rekap").toHaveLength(1);
    expect(tak[0].namaLayanan).toBe("PAD-UJI Rekap Layanan Tanpa Tarif");
    expect(tak[0].namaMitra).toBe("PAD-UJI Bidan Rekap Alfa");
    // Mitra-nya tetap muncul di daftar honor: pekerjaannya nyata.
    const a = pekan.perMitra.find((m) => m.partnerId === MITRA_A)!;
    expect(a.jumlahTakBertarif).toBe(1);
  });

  it("ADMIN yang membaca rekap tidak memperoleh satu nominal pun", async () => {
    // Sesi memang terbaca staf operasional; yang WAJIB kosong adalah uangnya.
    // Itu RLS `variant_rates` yang menjawab, bukan penyaringan di TypeScript.
    ref.sesi = sesiAdmin;
    const pekan = (await ambilRekap()).find((p) => p.senin === PEKAN_A);
    expect(pekan, "sesi hilang seluruhnya — assertion di bawah jadi hampa").toBeDefined();
    expect(pekan!.totalHonor).toBe(0);
    expect(pekan!.totalHarga).toBe(0);
    expect(pekan!.margin).toBe(0);
    // Tanpa tarif, SETIAP sesi jatuh sebagai tak-bertarif — bukan nol senyap.
    expect(pekan!.sesiTakBertarif.length).toBe(pekan!.jumlahSesi);
    for (const m of pekan!.perMitra) expect(m.totalHonor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ambilRekap() — komponen TRANSPORT terintegrasi lewat DB sungguhan (Task 9)
// ---------------------------------------------------------------------------
// Pekan TERPISAH dari PEKAN_A/PEKAN_B di atas — fixture ini menguji jalur
// baca `transport_rates`/`transport_khusus` (RLS "hanya owner") dan kolom
// `sessions.jenjang`, bukan mengulang logika `hitungRekap()` yang sudah
// diuji habis sebagai fungsi murni di tests/owner-rekap.test.ts.
describe("ambilRekap() — transport (Task 9)", () => {
  const PEKAN_T9 = "2024-03-25"; // Senin, tidak tumpang tindih PEKAN_A/PEKAN_B
  const SESI_DEKAT = "66666666-6666-6666-6666-666666667a5a"; // jenjang 5_10, bertarif
  const SESI_JAUH = "66666666-6666-6666-6666-666666667a5b"; // di_atas_20, TANPA transport_khusus
  const TARIF_TRANSPORT_ID = "88888888-8888-8888-8888-888888887a5a";
  const TARIF_TRANSPORT_KLIEN = 20_000;
  const TARIF_TRANSPORT_HONOR = 30_000;

  async function bersihkanT9() {
    await admin.from("transport_khusus").delete().in("session_id", [SESI_DEKAT, SESI_JAUH]);
    await admin.from("sessions").delete().in("id", [SESI_DEKAT, SESI_JAUH]);
    // Rate card transport ditolak UPDATE oleh trigger, tetapi service role
    // tetap boleh DELETE — dipakai di sini supaya `npm test` tidak menumpuk
    // baris fixture antar run, sama seperti pola `bersihkan()` di atas.
    await admin.from("transport_rates").delete().eq("id", TARIF_TRANSPORT_ID);
  }

  beforeAll(async () => {
    await bersihkanT9();
    await admin.from("transport_rates").insert({
      id: TARIF_TRANSPORT_ID,
      jenjang: "5_10",
      tarif_klien: TARIF_TRANSPORT_KLIEN,
      honor_mitra: TARIF_TRANSPORT_HONOR,
      berlaku_sejak: BERLAKU_LAMA,
    });
    await admin.from("sessions").insert([
      {
        id: SESI_DEKAT,
        client_id: KLIEN,
        service_id: LAYANAN_BERTARIF,
        variant_id: VARIAN_BERTARIF,
        partner_id: MITRA_A,
        tanggal: PEKAN_T9,
        status: "selesai",
        status_bayar: "belum",
        catatan: "",
        rekomendasi: "",
        jenjang: "5_10",
        jam_mulai: "09:00",
      },
      {
        id: SESI_JAUH,
        client_id: KLIEN,
        service_id: LAYANAN_BERTARIF,
        variant_id: VARIAN_BERTARIF,
        partner_id: MITRA_A,
        tanggal: PEKAN_T9,
        status: "selesai",
        status_bayar: "belum",
        catatan: "",
        rekomendasi: "",
        jenjang: "di_atas_20",
        jam_mulai: "09:00",
      },
    ]);
  });

  afterAll(bersihkanT9);

  it("honor mitra memuat komponen transport dari transport_rates, sesuai TANGGAL SESI", async () => {
    const pekan = (await ambilRekap()).find((p) => p.senin === PEKAN_T9)!;
    expect(pekan, "pekan transport uji tidak muncul — fixture gagal").toBeDefined();
    const a = pekan.perMitra.find((m) => m.partnerId === MITRA_A)!;
    // SESI_DEKAT bertarif (honor varian HONOR + transport 30.000); SESI_JAUH
    // tak-bertarif (di_atas_20 tanpa transport_khusus) dan TIDAK menyumbang
    // apa pun — lihat test berikutnya.
    expect(a.totalHonor).toBe(HONOR + TARIF_TRANSPORT_HONOR);
  });

  // (Ruling 26) Fixture ini TETAP sah sesudah `di_atas_20` punya tarif dasar,
  // dan alasannya harus tertulis supaya tidak dikira kebetulan: PEKAN_T9
  // bertanggal 2024, jauh lebih tua daripada baris tarif dasar `di_atas_20`
  // mana pun (`seed.sql` menulisnya ber-`berlaku_sejak = current_date`, dan
  // `guard_tarif_transport_maju` menolak `berlaku_sejak` yang mundur). Jadi
  // SESI_JAUH benar-benar tidak punya nominal di mana pun — bukan sekadar
  // tidak punya penimpa — dan itulah satu-satunya keadaan yang masih
  // tak-bertarif sejak gelombang perbaikan akhir.
  it("sesi di_atas_20 tanpa nominal MANA PUN jatuh ke sesiTakBertarif dengan sebab 'transport'", async () => {
    const pekan = (await ambilRekap()).find((p) => p.senin === PEKAN_T9)!;
    const tak = pekan.sesiTakBertarif.find((s) => s.id === SESI_JAUH);
    expect(tak, "sesi >20 km tanpa tarif khusus seharusnya tak-bertarif").toBeDefined();
    expect(tak!.sebab).toBe("transport");
  });

  // (Important 7, Task 9 fix round 1) Uji "ADMIN tidak memperoleh nominal
  // transport" LEWAT `ambilRekap()` tetap HIJAU bila `ambilRiwayatTarifTransport()`
  // atau `ambilTransportKhusus()` diam-diam memakai service role — kebocoran
  // firewall total — karena bagi admin `variant_rates` SUDAH memulangkan []
  // lebih dulu (RLS yang sama), `t === null` untuk SETIAP sesi, dan cabang
  // transport di `hitungRekap()` tidak pernah tereksekusi sama sekali. Uji
  // seperti itu mengulang firewall `variant_rates` yang sudah dijaga test
  // lain di berkas ini (~371-383) dan tidak membuktikan apa pun tentang
  // transport. Diganti dengan menguji KEDUA fungsi transport LANGSUNG.
  it("ambilRiwayatTarifTransport() & ambilTransportKhusus() memulangkan [] untuk ADMIN — RLS yang menjawab", async () => {
    ref.sesi = sesiAdmin;
    const [tarifTransport, transportKhusus] = await Promise.all([
      ambilRiwayatTarifTransport(),
      ambilTransportKhusus(),
    ]);
    ref.sesi = sesiOwner;
    expect(tarifTransport).toEqual([]);
    expect(transportKhusus).toEqual([]);
  });

  it("kontrol positif: OWNER yang sama memperoleh baris tarif transport yang sesungguhnya", async () => {
    // Tanpa kontrol ini, test di atas bisa hijau semata karena fixture-nya
    // gagal ditulis — [] yang benar tidak bisa dibedakan dari [] yang salah.
    const tarifTransport = await ambilRiwayatTarifTransport();
    expect(tarifTransport.some((t) => t.id === TARIF_TRANSPORT_ID)).toBe(true);
  });

  // (Critical 2, Task 9 fix round 1) `sebab: "transport"` juga wajib punya
  // konsumen — SESI_JAUH di sini tak-bertarif karena tarif TRANSPORTnya
  // hilang (di_atas_20 tanpa transport_khusus), jadi sarannya harus mengarah
  // ke rate card transport (/owner/transport), bukan ke /owner/tarif.
  it("sesi tak-bertarif sebab TRANSPORT menyarankan owner membuka /owner/transport", async () => {
    const kartu = kartuPekan(await renderHalaman(), PEKAN_T9);
    expect(kartu).toContain("/owner/transport");
    expect(kartu).not.toContain("/owner/tarif");
  });
});

// ---------------------------------------------------------------------------
// Halaman /owner/rekap
// ---------------------------------------------------------------------------

describe("halaman rekap honor (/owner/rekap)", () => {
  let markup = "";
  let kartuA = "";

  beforeAll(async () => {
    markup = await renderHalaman();
    kartuA = kartuPekan(markup, PEKAN_A);
  });

  it("menampilkan rentang pekan dan jumlah sesi selesai", () => {
    expect(kartuA).toContain("4 – 10 Mar 2024");
    expect(kartuA).toMatch(/4\s*sesi/);
  });

  it("menampilkan honor per mitra beserta namanya", () => {
    expect(kartuA).toContain("PAD-UJI Bidan Rekap Alfa");
    expect(kartuA).toContain("PAD-UJI Bidan Rekap Beta");
    expect(kartuA).toContain(rp(HONOR_A));
    expect(kartuA).toContain(rp(HONOR_B));
  });

  it("menampilkan garis margin PADMA di kartu pekan", () => {
    expect(kartuA).toMatch(/Margin PADMA/i);
    expect(kartuA).toContain(rp(MARGIN_A));
  });

  it("menyebut jadwal gajian Sabtu, seperti prototipe", () => {
    expect(markup).toMatch(/Sabtu/);
  });

  it("menampilkan sesi TAK BERTARIF di kartunya, lengkap dengan layanannya", () => {
    // Sesi yang lebih tua dari tarif paling awal tidak boleh hilang diam-diam.
    expect(kartuA).toMatch(/tak bertarif|belum bertarif/i);
    expect(kartuA).toContain("PAD-UJI Rekap Layanan Tanpa Tarif");
  });

  // (Critical 2, Task 9 fix round 1) `sebab: "varian"` wajib punya konsumen —
  // owner harus tahu LAYAR MANA yang menuntaskan sesi ini. SESI.a5 di sini
  // tak-bertarif karena tarif VARIANnya hilang (LAYANAN_TANPA_TARIF tidak
  // pernah diberi baris `variant_rates`), jadi sarannya harus mengarah ke
  // rate card layanan (/owner/tarif), bukan ke /owner/transport.
  it("sesi tak-bertarif sebab VARIAN menyarankan owner membuka /owner/tarif", () => {
    expect(kartuA).toContain("/owner/tarif");
    expect(kartuA).not.toContain("/owner/transport");
  });

  it("menyediakan tombol 'Tandai dibayar' untuk mitra yang belum ditandai", () => {
    expect(kartuA).toMatch(/Tandai dibayar/i);
  });

  it("pekan TERBARU di atas", () => {
    const a = markup.indexOf(`data-pekan="${PEKAN_A}"`);
    const b = markup.indexOf(`data-pekan="${PEKAN_B}"`);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(-1);
    expect(b, "pekan yang lebih baru justru berada di bawah").toBeLessThan(a);
  });

  it("TIDAK menawarkan jalur membatalkan tanda bayar", () => {
    // DELETE atas honor_marks sudah dicabut — owner pun 42501. Tombol yang
    // dirancang untuk itu hanya akan gagal, dan kegagalannya menyesatkan.
    for (const sumber of [sumberHalaman, sumberTabel]) {
      expect(sumber).not.toMatch(/>\s*(Hapus|Batalkan)/);
      expect(sumber).not.toMatch(/batal(kan)?\s*(tanda|bayar)/i);
    }
    expect(markup).not.toMatch(/>\s*(Hapus|Batalkan)/);
  });

  it("judul mengandalkan template `%s · PADMA`", () => {
    expect(sumberHalaman).toMatch(/metadata\s*=\s*\{\s*title:\s*"[^"]+"\s*\}/);
    expect(sumberHalaman).not.toMatch(/title:\s*"[^"]*PADMA/);
  });

  it("halaman menjaga perannya sendiri dengan requireRole(['owner'])", () => {
    expect(sumberHalaman).toMatch(/await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/);
    expect(sumberHalaman).not.toContain('"admin"');
  });

  it("bilah daftar menyediakan kotak cari dan chip saring honor", async () => {
    const markup = await renderHalaman();
    expect(markup).toContain('name="cari"');
    expect(markup).toContain('href="/owner/rekap?honor=belum"');
    expect(markup).toContain('href="/owner/rekap?honor=tuntas"');
  });

  it("kartu pekan TETAP kartu — rekap laporan, bukan daftar berformulir", async () => {
    const markup = await renderHalaman();
    // `data-pekan` membawa Senin pekannya, dan tanpa penanda itu sebuah
    // assertion (atau seorang pembaca) bisa membaca angka pekan lain sebagai
    // angka pekan yang sedang dilihatnya.
    expect(markup).toContain("data-pekan=");
    // Tidak ada tabel daftar dan tidak ada panel geser di halaman ini.
    expect(sumberHalaman).not.toContain("PanelGeser");
    expect(sumberHalaman).not.toContain("@/app/_shell/panel/tabel");
  });

  it("cari menyaring PEKAN dan meninggalkan kartunya utuh", async () => {
    const markup = await renderHalaman({ cari: NAMA_MITRA });
    expect(markup).toContain(NAMA_MITRA);
    expect(markup).toMatch(/Menampilkan \d+ dari \d+/);
  });

  it("saring honor=tuntas menyembunyikan pekan yang masih punya honor belum ditandai", async () => {
    const markup = await renderHalaman({ honor: "tuntas" });
    // Pekan uji belum ditandai dibayar, jadi ia tidak boleh muncul.
    expect(markup).not.toContain(NAMA_MITRA);
  });

  it("paginasi memakai delapan kartu per halaman, bukan dua puluh lima", () => {
    expect(sumberHalaman).toContain("PER_HAL_REKAP");
    expect(sumberHalaman).toMatch(/perHal=\{PER_HAL_REKAP\}/);
  });

  it("tidak ada satu pun token palet lama tersisa di kedua berkas", () => {
    for (const sumber of [sumberHalaman, sumberTabel]) {
      expect(sumber).not.toMatch(/\b(?:text|bg|border|hover:text|hover:bg)-(?:night|paper|gold-pale)\b/);
      expect(sumber).not.toContain("bg-white");
      expect(sumber).not.toContain("font-serif");
    }
  });
});

// ---------------------------------------------------------------------------
// Tanda bayar — identitas & stempel waktu tidak pernah dari payload
// ---------------------------------------------------------------------------

describe("tandaiHonorDibayar — menandai honor satu mitra untuk satu pekan", () => {
  it("melahirkan satu baris honor_marks ber-week_start Senin pekan itu", async () => {
    expect(await tandaMitra(MITRA_B)).toHaveLength(0);

    const hasil = await tandaiHonorDibayar(MITRA_B, PEKAN_A);
    expect(hasil.ok, hasil.ok ? "" : hasil.pesan).toBe(true);

    const tanda = await tandaMitra(MITRA_B);
    expect(tanda).toHaveLength(1);
    expect(tanda[0].week_start).toBe(PEKAN_A);
  });

  it("`ditandai_oleh` adalah id OWNER yang login — tidak pernah dari argumen", async () => {
    // Terbukti bisa dipalsukan: owner menandai honor ATAS NAMA ADMIN,
    // bertanggal 1999. Identitasnya wajib lahir dari sesi, dan action ini
    // hanya menerima dua argumen sehingga tidak ada tempat memasukkannya.
    const tanda = await tandaMitra(MITRA_B);
    expect(tanda[0].ditandai_oleh).toBe(idOwner);
    expect(tanda[0].ditandai_oleh).not.toBe(idAdmin);
    expect(tandaiHonorDibayar.length).toBe(2);
  });

  it("`dibayar_pada` distempel BASIS DATA, bukan jam pemanggil", async () => {
    const tanda = await tandaMitra(MITRA_B);
    // Tidak ada tanggal 1999 yang bisa diselundupkan: stempelnya jam sekarang.
    expect(tanda[0].dibayar_pada.slice(0, 4)).toBe(HARI_INI.slice(0, 4));
    // Dan action-nya memang tidak pernah menuliskan kolom itu sendiri.
    expect(sumberAksi).not.toContain("dibayar_pada");
  });

  it("menandai DUA KALI tidak error dan tidak menimpa stempel pertama", async () => {
    // `unique (partner_id, week_start)` melempar 23505, bukan no-op. Klik kedua
    // yang dilaporkan gagal membuat pemiliknya membayar dua kali.
    const sebelum = await tandaMitra(MITRA_B);
    expect(sebelum).toHaveLength(1);

    const hasil = await tandaiHonorDibayar(MITRA_B, PEKAN_A);
    expect(hasil.ok, hasil.ok ? "" : hasil.pesan).toBe(true);

    const sesudah = await tandaMitra(MITRA_B);
    expect(sesudah).toHaveLength(1);
    // Stempel pertama adalah bukti kapan honor benar-benar dibayarkan.
    expect(sesudah[0].dibayar_pada).toBe(sebelum[0].dibayar_pada);
    expect(sesudah[0].id).toBe(sebelum[0].id);
  });

  it("menyegarkan rekap DAN beranda owner", async () => {
    await tandaiHonorDibayar(MITRA_B, PEKAN_A);
    for (const p of ["/owner/rekap", "/owner"]) {
      expect(jejak.revalidate, `lupa merevalidasi ${p}`).toContain(p);
    }
  });

  it("halaman menampilkan '✓ Dibayar' + tanggal, dan tombolnya lenyap", async () => {
    const markup = await renderHalaman();
    const kartuA = kartuPekan(markup, PEKAN_A);
    expect(kartuA).toMatch(/Dibayar/);
    // Mitra A pada pekan yang sama BELUM ditandai — tombolnya wajib tetap ada,
    // jadi hilangnya tombol harus terbukti melekat pada barisnya sendiri.
    const barisB = kartuA.slice(kartuA.indexOf("PAD-UJI Bidan Rekap Beta"));
    expect(barisB).not.toMatch(/Tandai dibayar/i);
    expect(kartuA).toMatch(/Tandai dibayar/i);
  });
});

// ---------------------------------------------------------------------------
// Penolakan — dengan KALIMAT, bukan kode Postgres
// ---------------------------------------------------------------------------

describe("tandaiHonorDibayar — penolakan yang bisa dibaca pemilik klinik", () => {
  function pesanManusiawi(pesan: string) {
    expect(pesan).not.toMatch(/\b(23505|23514|42501|23503|22P02)\b/);
    expect(pesan.length).toBeGreaterThan(10);
  }

  it("pekan yang BUKAN hari Senin ditolak — tanda yatim tidak bisa dihapus", async () => {
    // `honor_marks.week_start` hari ini masih menerima tanggal apa pun. Tanda
    // bertanggal Rabu tidak akan pernah cocok dengan bucket rekap mana pun,
    // dan DELETE sudah dicabut sehingga ia tidak bisa dibersihkan.
    const sebelum = await tandaMitra(MITRA_A);
    for (const bukanSenin of ["2024-03-05", "2024-03-09", "2024-03-10"]) {
      const hasil = await tandaiHonorDibayar(MITRA_A, bukanSenin);
      expect(hasil.ok, `${bukanSenin} seharusnya ditolak`).toBe(false);
      if (hasil.ok) continue;
      expect(hasil.pesan).toMatch(/senin/i);
      pesanManusiawi(hasil.pesan);
    }
    expect(await tandaMitra(MITRA_A)).toEqual(sebelum);
  });

  it("tanggal tidak sah — termasuk yang tidak ada di kalender", async () => {
    const sebelum = await tandaMitra(MITRA_A);
    for (const tgl of ["", "05-03-2024", "2024-3-4", "besok", "2024-02-31", "2024-13-01"]) {
      const hasil = await tandaiHonorDibayar(MITRA_A, tgl);
      expect(hasil.ok, `senin="${tgl}" seharusnya ditolak`).toBe(false);
      if (hasil.ok) continue;
      expect(hasil.pesan).toMatch(/pekan|tanggal/i);
      pesanManusiawi(hasil.pesan);
    }
    expect(await tandaMitra(MITRA_A)).toEqual(sebelum);
  });

  it("pekan yang BELUM berjalan ditolak — tandanya tidak bisa dibatalkan", async () => {
    // Honor pekan depan belum dikerjakan. Tanda "sudah dibayar" atasnya adalah
    // kebohongan permanen: DELETE honor_marks sudah dicabut, bahkan untuk owner.
    const sebelum = await tandaMitra(MITRA_A);
    const hasil = await tandaiHonorDibayar(MITRA_A, PEKAN_DEPAN);
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) {
      expect(hasil.pesan).toMatch(/belum/i);
      pesanManusiawi(hasil.pesan);
    }
    expect(await tandaMitra(MITRA_A)).toEqual(sebelum);
  });

  it("mitra kosong, bukan-UUID, dan mitra yang tidak ada ditolak dengan kalimat", async () => {
    for (const id of ["", "bukan-uuid", MITRA_HANTU]) {
      const hasil = await tandaiHonorDibayar(id, PEKAN_A);
      expect(hasil.ok, `mitra="${id}" seharusnya ditolak`).toBe(false);
      if (hasil.ok) continue;
      expect(hasil.pesan).toMatch(/mitra/i);
      pesanManusiawi(hasil.pesan);
    }
  });
});

// ---------------------------------------------------------------------------
// PENJAGA PERAN: layout TIDAK menjaga server action
// ---------------------------------------------------------------------------

describe("penjaga peran di DALAM action — layout tidak menjaga server action", () => {
  it("ADMIN yang login DITOLAK, dan tidak satu tanda pun tersisip", async () => {
    const sebelum = await tandaMitra(MITRA_A);

    ref.sesi = sesiAdmin;
    await expect(tandaiHonorDibayar(MITRA_A, PEKAN_A)).rejects.toThrow(/REDIRECT/);

    expect(await tandaMitra(MITRA_A)).toEqual(sebelum);
  });

  it("KLIEN yang login DITOLAK", async () => {
    ref.sesi = sesiKlien;
    await expect(tandaiHonorDibayar(MITRA_A, PEKAN_A)).rejects.toThrow(/REDIRECT/);
  });

  it("admin TETAP dijawab 0 baris oleh RLS bahkan lewat REST langsung", async () => {
    const { data, error } = await sesiAdmin.from("honor_marks").select("id, week_start");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("admin yang menyisipkan tanda langsung lewat REST ditolak RLS", async () => {
    const { error } = await sesiAdmin.from("honor_marks").insert({
      partner_id: MITRA_A,
      week_start: PEKAN_A,
    });
    expect(error?.code).toBe("42501");
  });

  it("owner pun ditolak 42501 saat MENGHAPUS tanda — itu keadaan yang BENAR", async () => {
    const sebelum = await tandaMitra(MITRA_B);
    expect(sebelum.length).toBeGreaterThan(0);
    const { error } = await sesiOwner.from("honor_marks").delete().eq("partner_id", MITRA_B);
    expect(error?.code).toBe("42501");
    expect(await tandaMitra(MITRA_B)).toEqual(sebelum);
  });
});

// ---------------------------------------------------------------------------
// KASUS NYATA: sesi diselesaikan SESUDAH pekan itu ditandai dibayar
// ---------------------------------------------------------------------------

describe("sesi susulan di bawah tanda 'sudah dibayar'", () => {
  let kartuB = "";

  beforeAll(async () => {
    ref.sesi = sesiOwner;
    // 1. Pekan B ditandai dibayar saat baru satu sesi selesai.
    const hasil = await tandaiHonorDibayar(MITRA_C, PEKAN_B);
    expect(hasil.ok, hasil.ok ? "" : hasil.pesan).toBe(true);

    // 2. SESUDAH itu, sesi yang tadinya terjadwal diselesaikan admin. Trigger
    //    `trg_sessions_updated_at` menggeser updated_at melewati stempel tanda.
    //    `terjadwal -> selesai` (bukan `dibatalkan_padma -> selesai`, yang
    //    sejak trigger perpindahan sesi — migration `rantai_status_pagar` —
    //    bukan lagi panah yang sah: `dibatalkan_padma` tidak punya panah
    //    keluar sama sekali) — niat aslinya, "sesi yang belum selesai saat
    //    tanda dipasang, lalu diselesaikan admin", tetap teruji lewat UPDATE
    //    yang sungguhan (bukan DELETE+INSERT), supaya `updated_at` betul-betul
    //    tercatat.
    await new Promise((r) => setTimeout(r, 1100));
    await admin.from("sessions").update({ status: "selesai" }).eq("id", SESI.c2);

    kartuB = kartuPekan(await renderHalaman(), PEKAN_B);
  });

  it("honornya memang bertambah — angka itu tidak boleh disembunyikan", async () => {
    const pekan = (await ambilRekap()).find((p) => p.senin === PEKAN_B)!;
    const c = pekan.perMitra.find((m) => m.partnerId === MITRA_C)!;
    expect(c.jumlahSesi).toBe(2);
    expect(c.totalHonor).toBe(2 * HONOR);
    expect(c.sudahDibayar).toBe(true);
    expect(c.adaSesiSesudahDitandai).toBe(true);
  });

  it("halaman memberi PENANDA JELAS, bukan diam-diam menaikkan angka", () => {
    // Tanpa penanda ini, baris berlabel "✓ Dibayar" menampilkan nominal yang
    // lebih besar daripada yang benar-benar ditransfer — dan tidak ada satu pun
    // petunjuk bahwa selisihnya masih terutang.
    expect(kartuB).toMatch(/sesudah|setelah/i);
    expect(kartuB).toMatch(/ditandai dibayar/i);
    expect(kartuB).toContain(rp(2 * HONOR));
  });

  it("mitra yang tandanya bersih TIDAK ikut berbendera", async () => {
    const kartuA = kartuPekan(await renderHalaman(), PEKAN_A);
    const barisB = kartuA.slice(
      kartuA.indexOf("PAD-UJI Bidan Rekap Beta"),
      kartuA.indexOf("Margin PADMA"),
    );
    expect(barisB).not.toMatch(/ditandai dibayar/i);
  });
});

// ---------------------------------------------------------------------------
// PAGAR: menaikkan tarif tidak menggeser pekan yang sudah dibayar
// ---------------------------------------------------------------------------

describe("menaikkan tarif TIDAK menggeser rekap pekan yang sudah ditandai dibayar", () => {
  it("total honor & margin pekan 2024 persis sama sesudah tarif naik hari ini", async () => {
    const sebelum = (await ambilRekap()).find((p) => p.senin === PEKAN_A)!;

    // Tarif baru berlaku hari ini — jauh sesudah seluruh sesi fixture.
    const { error } = await admin.from("variant_rates").insert({
      variant_id: VARIAN_BERTARIF,
      harga_klien: HARGA * 3,
      honor_mitra: HONOR * 3,
      berlaku_sejak: HARI_INI,
    });
    expect(error).toBeNull();

    const sesudah = (await ambilRekap()).find((p) => p.senin === PEKAN_A)!;
    expect(sesudah.totalHonor, "honor pekan lama bergeser").toBe(sebelum.totalHonor);
    expect(sesudah.totalHarga, "harga pekan lama bergeser").toBe(sebelum.totalHarga);
    expect(sesudah.margin, "margin pekan lama bergeser").toBe(sebelum.margin);
    expect(sesudah.perMitra.find((m) => m.partnerId === MITRA_A)!.totalHonor).toBe(HONOR_A);
  });
});

// ---------------------------------------------------------------------------
// Bentuk berkas server action
// ---------------------------------------------------------------------------

describe("berkas server action rekap honor", () => {
  it('diawali "use server"', () => {
    expect(sumberAksi.trimStart().startsWith('"use server"')).toBe(true);
  });

  it("hanya mengekspor fungsi async (syarat Next)", () => {
    const ekspor = [...sumberAksi.matchAll(/^export\s+(?!type\b)(\w+)/gm)].map((m) => m[1]);
    expect(ekspor.length).toBeGreaterThan(0);
    expect([...new Set(ekspor)]).toEqual(["async"]);
  });

  it("SETIAP action memanggil requireRole(['owner']) — BUKAN admin+owner", () => {
    const jumlahAction = [
      ...sumberAksi.matchAll(/^export\s+async\s+function\s+\w+/gm),
    ].length;
    const jumlahGuard = [
      ...sumberAksi.matchAll(/await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/g),
    ].length;
    expect(jumlahAction).toBeGreaterThan(0);
    expect(jumlahGuard).toBe(jumlahAction);
    expect(sumberAksi).not.toContain('"admin"');
  });

  it("penjaga peran adalah pernyataan PERTAMA setiap action", () => {
    const badan = [
      ...sumberAksi.matchAll(/export\s+async\s+function\s+\w+\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g),
    ];
    expect(badan.length).toBeGreaterThan(0);
    for (const m of badan) {
      const pernyataanPertama = m[1]
        .split("\n")
        .map((b) => b.trim())
        .filter((b) => b.length > 0 && !b.startsWith("//") && !b.startsWith("*") && !b.startsWith("/*"))[0];
      // Identitas penanda diambil dari nilai kembalian panggilan yang SAMA —
      // memanggil auth.getUser() lagi hanya menambah bulat perjalanan tanpa
      // menambah satu pun jaminan.
      expect(pernyataanPertama).toMatch(
        /^(const\s*\{[^}]*\}\s*=\s*)?await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/,
      );
    }
  });

  it("memeriksa hasil tulisan — 200 + [] bukan keberhasilan", () => {
    // Tanda yang tertahan RLS dijawab PostgREST 200 + [], bukan error. Karena
    // penulisannya idempoten (ON CONFLICT DO NOTHING) larik kosong TIDAK cukup
    // untuk menyimpulkan kegagalan: keberadaan barisnya wajib dibuktikan ulang.
    expect(sumberAksi).toContain('.select("id")');
    expect(sumberAksi).toMatch(/\.length\s*===\s*0/);
    expect(sumberAksi).toMatch(/maybeSingle\(\)|\.limit\(1\)/);
  });

  it("menulis dengan upsert ignoreDuplicates, bukan insert telanjang", () => {
    expect(sumberAksi).toMatch(/ignoreDuplicates:\s*true/);
    expect(sumberAksi).toMatch(/onConflict:\s*"partner_id,week_start"/);
  });

  it("memakai sesi pengguna, bukan service role", () => {
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toContain("createAdminSupabase");
      expect(sumber).not.toContain("SERVICE_ROLE");
    }
    expect(sumberAksi).toContain("createServerSupabase");
  });

  it("tidak ada satu pun .delete() maupun .update() di seluruh berkas modul", () => {
    // Tanda bayar hanya lahir, tidak pernah diubah atau dicabut.
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toContain(".delete(");
    }
    expect(sumberAksi).not.toContain(".update(");
  });

  it("tidak melahirkan VIEW berkolom uang (view melewati RLS)", () => {
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toMatch(/create\s+(or\s+replace\s+)?view/i);
    }
    for (const sumber of [sumberAksi, sumberHalaman, sumberTabel, sumberStatus]) {
      expect(sumber).not.toContain("rekap_honor");
      expect(sumber).not.toContain("rate_card");
    }
  });

  it("pencocokan identitas memakai operator setara, tidak pernah pola", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberTabel]) {
      expect(sumber).not.toContain(".ilike(");
      expect(sumber).not.toContain(".like(");
    }
  });

  it("tidak menuliskan nominal ke log", () => {
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toContain("console.");
    }
  });

  it("daftar putih & label tinggal di status.ts, bukan di berkas action", () => {
    expect(sumberStatus).not.toContain('"use server"');
    expect(sumberAksi).toMatch(/from\s+["']\.\/status["']/);
  });

  it("tanggal dihitung tanpa toISOString/setDate/getDay", () => {
    // mondayOf prototipe TERBUKTI salah di zona barat justru karena ketiganya.
    for (const sumber of SEMUA_SUMBER) {
      for (const terlarang of ["toISOString", "setDate(", "getDay(", "getMonth("]) {
        expect(sumber, `${terlarang} dipakai untuk logika tanggal`).not.toContain(terlarang);
      }
    }
  });

  it("layout owner TIDAK ikut berubah (matriks peran tetap satu panggilan)", () => {
    const layout = baca("src/app/owner/layout.tsx");
    expect([...layout.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(layout).toMatch(/await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/);
  });

  it("navigasi owner menautkan modul ini", () => {
    expect(baca("src/app/owner/_shell/nav-owner.tsx")).toContain('href: "/owner/rekap"');
  });
});
