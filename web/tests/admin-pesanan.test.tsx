/**
 * LAYAR PESANAN STAF (/admin/pesanan) + EMPAT RUTE PEMULIHAN.
 *
 * ===== ASSERTION YANG KEBALIKAN DARI KONVENSI RUMAH =====
 * Setiap modul panel admin di repo ini diuji dengan
 * `expect(nominalDalam(markup)).toEqual([])` — "layar admin nol rupiah".
 * Berkas ini menuntut KEBALIKANNYA: `expect(nominalDalam(markup)).not.toEqual([])`.
 *
 * Itu bukan kelalaian, melainkan KEPUTUSAN PEMILIK REPO yang tercatat di spec
 * `docs/superpowers/specs/2026-09-26-padma-inti-pembayaran-design.md`, seksi
 * "Catatan: nominal di layar staf": admin harus bisa menjawab "berapa yang
 * klien ini bayar" dari dalam PADMA, bukan dari dashboard Midtrans. Untuk
 * baris `ditahan` — satu-satunya baris yang angkanya benar-benar jadi
 * keputusan manusia, karena artinya "uang masuk tapi jumlahnya tidak cocok" —
 * yang ditagih dan yang diterima harus terbaca BERDAMPINGAN, karena
 * selisihnyalah yang diputuskan.
 *
 * Kenapa keputusan itu butuh UJI, bukan cukup kode: konvensi "nol rupiah"
 * ditegakkan PER MODUL (`tests/admin-bayar.test.ts:880` merender `BayarPage`
 * lalu memindai kelima berkas sumber modul bayar saja). Artinya
 * `/admin/pesanan` yang dikirim tanpa satu rupiah pun akan hijau 100%, view
 * `pesanan_item_staf` yang bernominal menganggur tanpa pembaca, dan keputusan
 * pemilik repo gugur lewat pintu KETIADAAN. Uji ini yang menutup pintu itu.
 *
 * UTANG P3, dicatat sekarang supaya tidak jadi kejutan: begitu P3 memindahkan
 * tagihan sesi ke pesanan, layar ini akan membawa nominal SESI ke panel admin
 * yang hari ini diuji nol rupiah (`tests/admin-bayar.test.ts:880-883`). Batas
 * itu harus diputuskan ulang di P3.
 *
 * Selebihnya berkas ini menjaga empat lubang yang semuanya memakan uang orang:
 * pesanan `ditahan` yang hilang dari layar, pesanan `lunas` tanpa akses yang
 * tidak pernah muncul, "tutup tinjauan" yang diam-diam mengubur baris
 * `ditahan`, dan "terbitkan akses" atas pesanan yang belum dibayar.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { nominalDalam } from "./helpers/nominal";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

// `redirect()` melempar di dalam request Next. Di uji ia dijadikan error yang
// bisa dibaca supaya "penjaga peran hilang" menjadi MERAH, bukan senyap.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/admin/pesanan",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

// Midtrans dipalsukan seluruhnya — `tests/setup-fetch-guard.ts` adalah daftar
// izin dan `.midtrans.com` sengaja TIDAK ada di sana.
const midtrans = vi.hoisted(() => ({ jawaban: null as unknown, panggilan: [] as string[] }));
vi.mock("@/lib/midtrans/adapter", () => ({
  bacaStatusTransaksi: async (orderId: string) => {
    midtrans.panggilan.push(orderId);
    return midtrans.jawaban;
  },
  terbitkanTokenSnap: async () => ({ ok: false, pesan: "tidak dipakai di berkas ini" }),
}));

const { bacaPesananStaf } = await import("@/lib/admin/pesanan");
const { default: PesananPage } = await import("@/app/admin/pesanan/page");
const { TabelPesanan } = await import("@/app/admin/pesanan/tabel-pesanan");
const { POST: periksaUlang } = await import("@/app/api/pesanan/[id]/periksa-ulang/route");
const { POST: terbitkanAkses } = await import("@/app/api/pesanan/[id]/terbitkan-akses/route");
const { POST: putuskan } = await import("@/app/api/pesanan/[id]/putuskan/route");
const { POST: tutupTinjauan } = await import("@/app/api/pesanan/[id]/tutup-tinjauan/route");

const KLIEN_ANANDA = "44444444-4444-4444-4444-444444444401";
const PADMA_ANANDA = "PAD-2607-0012";
const KLIEN_RINA = "44444444-4444-4444-4444-444444444402";
const AWALAN_KODE = "PSN-260926-AD";
const SLUG = "uji-admin-pesanan";
const JUDUL = "Uji Layar Pesanan";

const K_TERBUKA_BARU = `${AWALAN_KODE}0001`;
const K_TERBUKA_LAMA = `${AWALAN_KODE}0002`;
const K_DITAHAN = `${AWALAN_KODE}0003`;
const K_LUNAS_TANPA_AKSES = `${AWALAN_KODE}0004`;
const K_LUNAS_BERAKSES = `${AWALAN_KODE}0005`;

let produkId: string;
let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;
const idPesanan = new Map<string, string>();

// ---------------------------------------------------------------------------
// Perkakas
// ---------------------------------------------------------------------------

async function semai(o: {
  kode: string;
  clientId: string;
  status: "menunggu_bayar" | "ditahan" | "lunas";
  harga: number;
  diperiksaMenitLalu?: number | null;
  butuhTinjauan?: string | null;
}): Promise<string> {
  const tutup = o.status === "menunggu_bayar" ? null : new Date().toISOString();
  const { data, error } = await admin
    .from("orders")
    .insert({
      kode: o.kode,
      percobaan: 1,
      client_id: o.clientId,
      status: o.status,
      jumlah_item: 1,
      kedaluwarsa_pada: new Date(Date.now() + 20 * 3_600_000).toISOString(),
      ditutup_pada: tutup,
      lunas_pada: o.status === "lunas" ? tutup : null,
      diperiksa_pada:
        o.diperiksaMenitLalu == null
          ? null
          : new Date(Date.now() - o.diperiksaMenitLalu * 60_000).toISOString(),
      butuh_tinjauan_pada: o.butuhTinjauan ? new Date().toISOString() : null,
      sebab_tinjauan: o.butuhTinjauan ?? null,
      kanal: o.status === "menunggu_bayar" ? null : "bank_transfer",
      transaksi_id: o.status === "menunggu_bayar" ? null : `trx-${o.kode}`,
      status_midtrans: o.status === "menunggu_bayar" ? null : "settlement",
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: galatItem } = await admin.from("order_items").insert({
    pesanan_id: data!.id,
    jenis: "produk_digital",
    product_id: produkId,
    judul_beku: JUDUL,
    harga_beku: o.harga,
    urutan: 1,
  });
  if (galatItem) throw galatItem;

  idPesanan.set(o.kode, data!.id as string);
  return data!.id as string;
}

async function statusPesanan(id: string): Promise<string> {
  const { data } = await admin.from("orders").select("status").eq("id", id).single();
  return data!.status as string;
}

function permintaan(jalur: string, badan?: unknown): Request {
  return new Request(`http://127.0.0.1/api/pesanan/x/${jalur}`, {
    method: "POST",
    headers: badan ? { "content-type": "application/json" } : {},
    body: badan ? JSON.stringify(badan) : undefined,
  });
}

const param = (id: string) => ({ params: Promise.resolve({ id }) });

async function bersihkan() {
  await admin.from("digital_entitlements").delete().eq("product_id", produkId);
  const { data } = await admin.from("orders").select("id").like("kode", `${AWALAN_KODE}%`);
  const ids = (data ?? []).map((b) => b.id as string);
  if (ids.length === 0) return;
  await admin.from("jejak_pesanan").delete().in("pesanan_id", ids);
  await admin.from("notifikasi_pesanan").delete().in("pesanan_id", ids);
  await admin.from("order_items").delete().in("pesanan_id", ids);
  await admin.from("orders").delete().in("id", ids);
  idPesanan.clear();
}

/**
 * Lima pesanan yang menutupi KEDUA klausa "Butuh perhatian" sekaligus kedua
 * urutan blok "Terbuka". Dua pesanan `menunggu_bayar` WAJIB milik dua klien
 * berbeda: `pesanan_terbuka_satu_per_klien` hanya mengizinkan satu per klien.
 *
 * DUA, bukan tiga: `bacaPesananStaf` menyaring dengan `butuhTinjauanPada !== null`
 * ATAU `PESANAN_BERUANG.includes(...) && belum ada akses`. Hitungan "tiga" adalah
 * sisa desain sebelum kedua klausa lama (`status === "ditahan"` tanpa syarat, dan
 * `status === "lunas" && belum ada akses`) dilebur jadi satu lewat himpunan Tugas 1.
 */
async function siapkan() {
  await bersihkan();

  await semai({
    kode: K_TERBUKA_BARU, clientId: KLIEN_ANANDA,
    status: "menunggu_bayar", harga: 75_000, diperiksaMenitLalu: null,
  });
  await semai({
    kode: K_TERBUKA_LAMA, clientId: KLIEN_RINA,
    status: "menunggu_bayar", harga: 60_000, diperiksaMenitLalu: 30,
  });

  const idDitahan = await semai({
    kode: K_DITAHAN, clientId: KLIEN_ANANDA,
    status: "ditahan", harga: 120_000, butuhTinjauan: "selisih_nominal",
  });
  // Uang memang pernah tercatat masuk — syarat `putuskan_pesanan_ditahan`.
  await admin.from("notifikasi_pesanan").insert({
    pesanan_id: idDitahan,
    sidik: `sidik-${K_DITAHAN}`,
    transaksi_id: `trx-${K_DITAHAN}`,
    status_midtrans: "settlement",
    kanal: "bank_transfer",
    nominal_diterima: 95_000,
  });

  await semai({
    kode: K_LUNAS_TANPA_AKSES, clientId: KLIEN_ANANDA,
    status: "lunas", harga: 250_000,
  });

  const idBerakses = await semai({
    kode: K_LUNAS_BERAKSES, clientId: KLIEN_RINA,
    status: "lunas", harga: 310_000,
  });
  await admin.from("jejak_pesanan").insert({
    pesanan_id: idBerakses,
    padma_id: "PAD-2608-0019",
    kejadian: "akses_terbit",
    keterangan: "fixture",
  });
}

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");

  await admin.from("digital_products").delete().eq("slug", SLUG);
  const { data, error } = await admin
    .from("digital_products")
    .insert({ judul: JUDUL, slug: SLUG, jenis: "pdf", aktif: true })
    .select("id")
    .single();
  if (error) throw error;
  produkId = data!.id as string;
  await admin.from("digital_product_prices").insert({ product_id: produkId, harga: 120_000 });
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  midtrans.panggilan.length = 0;
  midtrans.jawaban = null;
  await siapkan();
});

afterAll(async () => {
  await bersihkan();
  await admin.from("digital_products").delete().eq("id", produkId);
});

// ---------------------------------------------------------------------------
// Pembaca
// ---------------------------------------------------------------------------

describe("bacaPesananStaf", () => {
  it("Butuh perhatian memuat kedua klausa, dan lunas yang aksesnya sudah terbit TIDAK ikut", async () => {
    const { butuhPerhatian } = await bacaPesananStaf();
    const kode = butuhPerhatian.map((p) => p.kode);

    expect(kode).toContain(K_DITAHAN); // uang masuk, barang belum keluar
    expect(kode).toContain(K_LUNAS_TANPA_AKSES); // jaring yang tidak menunggu siapa pun ingat
    // Klausa kedua TIDAK boleh menangkap pesanan yang sudah beres: layar yang
    // selalu penuh adalah layar yang berhenti dibaca.
    expect(kode).not.toContain(K_LUNAS_BERAKSES);
  });

  it("Terbuka memuat yang menunggu bayar, urut diperiksa_pada nulls first", async () => {
    const { terbuka } = await bacaPesananStaf();
    const kode = terbuka.map((p) => p.kode);
    expect(kode).toContain(K_TERBUKA_BARU);
    expect(kode).toContain(K_TERBUKA_LAMA);
    // Yang BELUM PERNAH diperiksa duduk paling atas — dialah yang paling
    // mungkin menggantung tanpa ada yang tahu.
    expect(kode.indexOf(K_TERBUKA_BARU)).toBeLessThan(kode.indexOf(K_TERBUKA_LAMA));
  });

  it("nominal tagih dijumlahkan dari harga beku item, dan yang diterima dibaca dari notifikasi", async () => {
    const { butuhPerhatian } = await bacaPesananStaf();
    const ditahan = butuhPerhatian.find((p) => p.kode === K_DITAHAN)!;
    expect(ditahan.nominalTagih).toBe(120_000);
    expect(ditahan.nominalDiterima).toBe(95_000);
    expect(ditahan.items.map((i) => i.hargaBeku)).toEqual([120_000]);
    expect(ditahan.padmaId).toBe(PADMA_ANANDA);
  });

  it("pesanan tanpa notifikasi bernominal memulangkan nominalDiterima null, bukan nol", async () => {
    // Nol dan "belum ada angkanya" adalah dua kalimat berbeda, dan yang kedua
    // tidak boleh dirender sebagai "Rp 0" di sebelah yang ditagih.
    const { terbuka } = await bacaPesananStaf();
    expect(terbuka.find((p) => p.kode === K_TERBUKA_BARU)!.nominalDiterima).toBeNull();
  });

  it("pesanan yang itemnya TIDAK TERBACA memulangkan nominalTagih null, bukan nol", async () => {
    // Pelajaran repo yang sama dengan `padmaId`: pembacaan yang ditolak
    // memulangkan KOSONG, bukan galat. `pesanan_item_staf` bergerbang
    // `user_role()` di dalam badannya, jadi bentuk ketidakterbacaannya adalah
    // NOL BARIS — persis yang disemai di sini.
    //
    // `reduce(…, 0)` atas daftar kosong memulangkan 0, dan "Rp 0 ditagih" yang
    // diucapkan dengan yakin di sebelah "Rp 40.000 diterima" tidak terbaca
    // sebagai data yang hilang melainkan sebagai SELISIH — kesimpulan yang
    // persis terbalik, di kolom yang seluruh keberadaannya dibenarkan sebagai
    // "angka yang jadi keputusan manusia".
    //
    // Nol yang SAH tetap harus lewat: produk gratis berharga 0 punya itemnya,
    // jadi yang membedakan bukan jumlahnya melainkan ADA/TIDAKNYA item.
    const kode = `${AWALAN_KODE}0008`;
    const { data, error } = await admin
      .from("orders")
      .insert({
        kode,
        percobaan: 1,
        client_id: KLIEN_RINA,
        status: "lunas",
        jumlah_item: 1,
        kedaluwarsa_pada: new Date(Date.now() + 20 * 3_600_000).toISOString(),
        ditutup_pada: new Date().toISOString(),
        lunas_pada: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    idPesanan.set(kode, data!.id as string);

    const { butuhPerhatian } = await bacaPesananStaf();
    const baris = butuhPerhatian.find((p) => p.kode === kode)!;
    expect(baris.items).toEqual([]);
    expect(baris.nominalTagih).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Halaman
// ---------------------------------------------------------------------------

describe("halaman /admin/pesanan", () => {
  const markup = async () => renderToStaticMarkup(await PesananPage());

  it("MEMUAT nominal — kebalikan konvensi rumah, atas keputusan pemilik repo", async () => {
    const m = await markup();
    expect(nominalDalam(m), "nominal justru HARUS ada di layar ini").not.toEqual([]);
    expect(m).toContain("Rp 120.000");
    expect(m).toContain("Rp 250.000");
  });

  it("baris ditahan menampilkan yang DITAGIH dan yang DITERIMA berdampingan", async () => {
    const m = await markup();
    expect(m).toContain("Rp 120.000");
    expect(m).toContain("Rp 95.000");
    expect(m).toMatch(/Diterima/);
  });

  it("menampilkan kedua blok beserta sebab tinjauannya", async () => {
    const m = await markup();
    expect(m).toContain("Butuh perhatian");
    expect(m).toContain("Terbuka");
    expect(m).toContain("selisih_nominal");
    expect(m).toContain(PADMA_ANANDA);
  });

  it("menolak sesi klien", async () => {
    ref.sesi = sesiKlien;
    await expect(markup()).rejects.toThrow("REDIRECT /setelah-masuk");
  });

  it("nol service role di seluruh modul layar", async () => {
    // Ditegaskan ulang di sini meski `tests/admin-shell.test.ts:643` sudah
    // menyapu `src/app/admin/**`: sapuan itu punya daftar pengecualian, dan
    // daftar yang bertambah adalah cara paling sunyi sebuah modul kehilangan
    // pagarnya. Modul INI tidak pernah boleh masuk ke sana.
    for (const berkas of [
      "src/app/admin/pesanan/page.tsx",
      "src/app/admin/pesanan/tabel-pesanan.tsx",
      "src/app/admin/pesanan/tombol-pesanan.tsx",
      "src/lib/admin/pesanan.ts",
    ]) {
      const isi = baca(berkas);
      expect(isi, `${berkas} memakai service role`).not.toContain("createAdminSupabase");
      expect(isi, `${berkas} memakai service role`).not.toContain("SERVICE_ROLE");
    }
  });
});

// ---------------------------------------------------------------------------
// Tabel — dirender sendiri, tanpa basis data
// ---------------------------------------------------------------------------

describe("TabelPesanan", () => {
  const dasar = {
    id: "11111111-1111-1111-1111-111111111111",
    kode: "PSN-260926-AD9999",
    status: "ditahan" as const,
    percobaan: 1,
    padmaId: PADMA_ANANDA,
    jumlahItem: 1,
    dibuatPada: "2026-09-26T01:00:00Z",
    kedaluwarsaPada: "2026-09-27T01:00:00Z",
    lunasPada: null,
    diperiksaPada: null,
    butuhTinjauanPada: "2026-09-26T02:00:00Z",
    sebabTinjauan: "selisih_nominal",
    kanal: "bank_transfer",
    transaksiId: "trx-9999",
    statusMidtrans: "settlement",
    items: [
      {
        pesananId: "11111111-1111-1111-1111-111111111111",
        kode: "PSN-260926-AD9999",
        jenis: "produk_digital" as const,
        judulBeku: "Panduan Uji",
        hargaBeku: 120_000,
        urutan: 1,
      },
    ],
    nominalTagih: 120_000,
    nominalDiterima: 95_000,
  };

  it("PADMA ID yang tidak terbaca dirender sebagai KEGAGALAN, bukan sebagai teks kosong", () => {
    // Pelajaran repo: embed PostgREST yang ditolak RLS memulangkan NULL, bukan
    // galat. Baris yang PADMA ID-nya kosong karena itu bukan "klien tanpa
    // PADMA ID" melainkan "kita tidak berhasil membacanya" — dan dua hal itu
    // menuntut tindakan berbeda dari staf yang melihatnya.
    const m = renderToStaticMarkup(<TabelPesanan baris={[{ ...dasar, padmaId: "" }]} />);
    expect(m).toContain("PADMA ID tidak terbaca");
  });

  it("TIDAK menawarkan Tutup tinjauan pada baris ditahan", () => {
    // `tutup_tinjauan` menolak baris `ditahan` dengan P0001. Menawarkan tombol
    // yang pasti ditolak adalah janji yang tidak akan ditepati — dan di sini
    // janji itu berbunyi "beres" untuk pesanan yang uangnya sudah di tangan
    // Midtrans dan barangnya belum keluar.
    const m = renderToStaticMarkup(<TabelPesanan baris={[dasar]} />);
    expect(m).not.toContain("Tutup tinjauan");
    expect(m).toContain("Putuskan lunas");
    expect(m).toContain("Putuskan batal");
  });

  it("menawarkan Tutup tinjauan pada baris bertanda tinjauan yang BUKAN ditahan", () => {
    const m = renderToStaticMarkup(
      <TabelPesanan baris={[{ ...dasar, status: "lunas" as const, nominalDiterima: null }]} />,
    );
    expect(m).toContain("Tutup tinjauan");
    expect(m).toContain("Terbitkan akses");
  });

  it("nominal yang tidak terbaca dirender sebagai KEGAGALAN, bukan sebagai Rp 0", () => {
    // Pasangan sel `padmaId` di atas, dan alasannya sama persis: dua sel yang
    // berselisih membuat pembacanya memilih, dan sel ANGKA selalu terlihat
    // lebih berwibawa daripada sel yang berkata "tidak terbaca".
    const m = renderToStaticMarkup(
      <TabelPesanan
        baris={[{ ...dasar, items: [], nominalTagih: null, nominalDiterima: null }]}
      />,
    );
    expect(m).toContain("Nominal tidak terbaca");
    // Tidak satu rupiah pun boleh dicetak untuk baris yang angkanya tidak
    // diketahui — `nominalDalam` adalah pemindai yang sama yang dipakai
    // KEBALIKANNYA di uji halaman.
    expect(nominalDalam(m), "nominal dikarang untuk baris yang tidak terbaca").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Empat rute pemulihan
// ---------------------------------------------------------------------------

describe("gerbang peran keempat rute", () => {
  it("menolak sesi klien", async () => {
    ref.sesi = sesiKlien;
    const id = idPesanan.get(K_DITAHAN)!;
    await expect(periksaUlang(permintaan("periksa-ulang"), param(id))).rejects.toThrow(
      "REDIRECT /setelah-masuk",
    );
    await expect(terbitkanAkses(permintaan("terbitkan-akses"), param(id))).rejects.toThrow(
      "REDIRECT /setelah-masuk",
    );
    await expect(
      putuskan(permintaan("putuskan", { putusan: "lunas" }), param(id)),
    ).rejects.toThrow("REDIRECT /setelah-masuk");
    await expect(tutupTinjauan(permintaan("tutup-tinjauan"), param(id))).rejects.toThrow(
      "REDIRECT /setelah-masuk",
    );
  });
});

describe("POST /api/pesanan/[id]/putuskan", () => {
  it("menolak putusan asing di RUTE — kalimatnya, bukan hanya kodenya", async () => {
    // Dokblok rute ini menyatakan "dua pagar untuk satu lubang, karena lubang
    // ini memakan uang orang". Klaim itu tidak bisa dibuktikan oleh dua uji
    // yang sama-sama cuma membaca `r.status`: rute menjawab 400 untuk daftar
    // putih lokalnya DAN untuk setiap galat RPC.
    //
    // Skenario konkret yang lolos tanpa assertion kalimat: seseorang menghapus
    // `PUTUSAN_SAH` dari rute ("RPC-nya sudah memeriksa, ini duplikat").
    // Nilai "kedaluwarsa" kini berjalan sampai ke basis data, RPC menolaknya
    // dengan P0001, rute tetap 400, uji tetap hijau — dan pagar kedua yang
    // diklaim dokblok hilang tanpa bekas. Kebalikannya juga tidak terjaga.
    //
    // Yang memisahkan keduanya hanya KALIMATNYA — jadi kedua kalimat itu
    // sengaja TIDAK berbagi satu frasa pun. Versi sebelumnya berbunyi
    // 'Putusan hanya boleh "lunas" atau "dibatalkan".' sementara RPC berbunyi
    // 'Putusan harus "lunas" atau "dibatalkan", bukan "%"' — keduanya memuat
    // substring yang di-assert, jadi menghapus PUTUSAN_SAH dari rute membuat
    // permintaan jatuh ke RPC, tetap 400, dan uji ini TETAP HIJAU. Pagar kedua
    // boleh hilang tanpa bekas. "tidak dikenal" hanya ada di kalimat RUTE.
    const id = idPesanan.get(K_DITAHAN)!;
    const r = await putuskan(permintaan("putuskan", { putusan: "kedaluwarsa" }), param(id));
    expect(r.status).toBe(400);
    const isi = (await r.json()) as { pesan: string };
    expect(isi.pesan).toContain("tidak dikenal");
    // Bukti negatifnya: kalau pagar rute dihapus dan permintaan jatuh ke RPC,
    // pesannya memuat "bukan" dan uji ini merah — bukan lolos diam-diam.
    expect(isi.pesan).not.toContain("bukan");
    expect(await statusPesanan(id)).toBe("ditahan");
  });

  it('menggerakkan pesanan ditahan ke "lunas" dan mencatat siapa yang memutuskan', async () => {
    const id = idPesanan.get(K_DITAHAN)!;
    const r = await putuskan(permintaan("putuskan", { putusan: "lunas" }), param(id));
    expect(r.status).toBe(200);
    expect(await statusPesanan(id)).toBe("lunas");

    const { data: jejak } = await admin
      .from("jejak_pesanan")
      .select("kejadian, padma_id")
      .eq("pesanan_id", id)
      .eq("kejadian", "lunas");
    expect((jejak ?? []).length).toBe(1);
  });

  it("menolak pesanan yang BUKAN ditahan — dan kalimatnya datang dari RPC", async () => {
    // Pasangan uji di atas. Putusannya SAH, jadi daftar putih rute
    // meloloskannya; yang menolak adalah `putuskan_pesanan_ditahan`. Kalimat
    // RPC-nya berbeda dari kalimat rute, dan perbedaan itulah yang membuat
    // kedua pagar bisa merah SENDIRI-SENDIRI.
    const id = idPesanan.get(K_TERBUKA_BARU)!;
    const r = await putuskan(permintaan("putuskan", { putusan: "lunas" }), param(id));
    expect(r.status).toBe(400);
    const isi = (await r.json()) as { pesan: string };
    expect(isi.pesan).toContain("tidak sedang ditahan");
    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });
});

describe("POST /api/pesanan/[id]/tutup-tinjauan", () => {
  it("MENOLAK baris ditahan dengan kalimat yang menyuruh memakai putusan", async () => {
    const id = idPesanan.get(K_DITAHAN)!;
    const r = await tutupTinjauan(permintaan("tutup-tinjauan"), param(id));
    expect(r.status).toBe(400);
    const isi = (await r.json()) as { pesan: string };
    expect(isi.pesan.toLowerCase()).toContain("putuskan");
    // Dan penandanya TIDAK ikut hilang: baris ini harus tetap terlihat.
    const { data } = await admin
      .from("orders")
      .select("butuh_tinjauan_pada")
      .eq("id", id)
      .single();
    expect(data!.butuh_tinjauan_pada).not.toBeNull();
  });

  it("mengosongkan penanda pada baris lunas bertanda tinjauan, tanpa menyentuh status", async () => {
    const id = idPesanan.get(K_LUNAS_TANPA_AKSES)!;
    await admin
      .from("orders")
      .update({ butuh_tinjauan_pada: new Date().toISOString(), sebab_tinjauan: "akses_tertahan" })
      .eq("id", id);

    const r = await tutupTinjauan(permintaan("tutup-tinjauan"), param(id));
    expect(r.status).toBe(200);

    const { data } = await admin
      .from("orders")
      .select("status, butuh_tinjauan_pada, sebab_tinjauan")
      .eq("id", id)
      .single();
    expect(data!.status).toBe("lunas");
    expect(data!.butuh_tinjauan_pada).toBeNull();
    expect(data!.sebab_tinjauan).toBeNull();
  });
});

describe("POST /api/pesanan/[id]/terbitkan-akses", () => {
  it("menerbitkan entitlement untuk pesanan lunas yang aksesnya belum terbit", async () => {
    const id = idPesanan.get(K_LUNAS_TANPA_AKSES)!;
    const r = await terbitkanAkses(permintaan("terbitkan-akses"), param(id));
    expect(r.status).toBe(200);
    const isi = (await r.json()) as { terbit: string[] };
    expect(isi.terbit).toEqual(["akses_terbit"]);

    const { data } = await admin
      .from("digital_entitlements")
      .select("sumber, pesanan_id")
      .eq("product_id", produkId)
      .eq("client_id", KLIEN_ANANDA);
    expect((data ?? []).length).toBe(1);
    expect(data![0].sumber).toBe("beli");
    expect(data![0].pesanan_id).toBe(id);
  });

  it("MENOLAK pesanan yang belum lunas — tombol bukan pagar", async () => {
    // Tombolnya memang hanya dirender untuk baris `lunas`, tapi rute adalah
    // endpoint MANDIRI: satu curl sudah cukup memberikan barang yang belum
    // dibayar.
    const id = idPesanan.get(K_TERBUKA_BARU)!;
    const r = await terbitkanAkses(permintaan("terbitkan-akses"), param(id));
    expect(r.status).toBe(409);

    const { data } = await admin
      .from("digital_entitlements")
      .select("id")
      .eq("product_id", produkId);
    expect(data ?? []).toEqual([]);
  });
});

describe("POST /api/pesanan/[id]/periksa-ulang", () => {
  it("menanyai Status API lalu menjalankan jawabannya lewat mesin", async () => {
    const id = idPesanan.get(K_TERBUKA_BARU)!;
    midtrans.jawaban = {
      ok: true as const,
      status: {
        order_id: `${K_TERBUKA_BARU}.1`,
        status_code: "200",
        transaction_status: "settlement",
        transaction_id: "trx-periksa-ulang",
        gross_amount: "75000.00",
        fraud_status: null,
        payment_type: "gopay",
      },
    };

    const r = await periksaUlang(permintaan("periksa-ulang"), param(id));
    expect(r.status).toBe(200);
    expect(midtrans.panggilan).toEqual([`${K_TERBUKA_BARU}.1`]);
    expect(await statusPesanan(id)).toBe("lunas");
  });

  it("Midtrans yang tidak menjawab memulangkan 502, bukan 200 palsu", async () => {
    // 200 di sini berarti staf melihat "selesai" untuk pemeriksaan yang tidak
    // pernah terjadi, lalu berhenti memeriksanya.
    const id = idPesanan.get(K_TERBUKA_BARU)!;
    midtrans.jawaban = { ok: false as const, kode: 500, pesan: "gangguan" };

    const r = await periksaUlang(permintaan("periksa-ulang"), param(id));
    expect(r.status).toBe(502);
    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });

  it("kunci Midtrans belum terpasang memulangkan 503, BUKAN 502 yang menyuruh coba lagi", async () => {
    // Beda kode, beda kalimat, beda tindakan: 502 (uji di atas) menyuruh staf
    // coba lagi karena Midtrans MUNGKIN sembuh sendiri; kunci yang belum
    // dipasang tidak pernah sembuh dengan menekan tombol yang sama — hanya
    // orang yang bisa memasang env yang menolong. Menyatukan keduanya berarti
    // staf menekan tombol "Periksa ulang" selamanya untuk kegagalan yang
    // menunggu manusia lain.
    const id = idPesanan.get(K_TERBUKA_BARU)!;
    midtrans.jawaban = { ok: false as const, kode: -1, pesan: "Kunci Midtrans belum dipasang." };

    const r = await periksaUlang(permintaan("periksa-ulang"), param(id));
    expect(r.status).toBe(503);
    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });

  it("pesanan yang tidak ada memulangkan 404", async () => {
    const r = await periksaUlang(
      permintaan("periksa-ulang"),
      param("00000000-0000-0000-0000-000000000000"),
    );
    expect(r.status).toBe(404);
    expect(midtrans.panggilan).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sebab_tinjauan lestari (migrasi 20260927100000)
// ---------------------------------------------------------------------------

describe("sebab_tinjauan tidak tertimpa notifikasi berikutnya", () => {
  it("refund yang mendarat pada pesanan bertanda lunas_setelah_tutup TIDAK menimpa alasannya", async () => {
    // Jalur yang terjangkau HARI INI, tanpa satu baris kode baru — dan yang
    // hilang adalah satu-satunya petunjuk bahwa uang pernah masuk pada pesanan
    // yang sudah kami tutup. `butuh_tinjauan_pada` sudah ber-`coalesce` sejak
    // awal, jadi sebelum migrasi ini cap waktunya menyebut kejadian PERTAMA
    // sementara alasannya menyebut kejadian TERAKHIR.
    const kode = `${AWALAN_KODE}0006`;
    const id = await semai({
      kode, clientId: KLIEN_RINA, status: "lunas", harga: 50_000,
      butuhTinjauan: "lunas_setelah_tutup",
    });

    const { error } = await admin.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: `${kode}.1`,
      p_transaction_status: "refund",
      p_fraud_status: "",
      p_transaction_id: `trx-${kode}-refund`,
      p_payment_type: "bank_transfer",
      p_gross_amount: 50_000,
      p_sidik: `sidik-${kode}-refund`,
      p_sumber: "webhook",
    });
    expect(error).toBeNull();

    const { data } = await admin
      .from("orders")
      .select("sebab_tinjauan, butuh_tinjauan_pada")
      .eq("id", id)
      .single();
    expect(data!.sebab_tinjauan).toBe("lunas_setelah_tutup");
    expect(data!.butuh_tinjauan_pada).not.toBeNull();
  });

  it("pesanan yang BELUM bertanda tetap mendapat sebabnya", async () => {
    // Kontrol positif, dan ia wajib: `coalesce` hanya boleh mempertahankan yang
    // sudah ada, bukan berhenti menulis. Tanpa pasangan ini, migrasi yang
    // keliru membuang assignment-nya sama sekali tetap hijau — dan pesanan
    // yang di-refund berhenti muncul di "Butuh perhatian" dengan alasan apa pun.
    const kode = `${AWALAN_KODE}0007`;
    const id = await semai({ kode, clientId: KLIEN_RINA, status: "lunas", harga: 40_000 });

    await admin.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: `${kode}.1`,
      p_transaction_status: "chargeback",
      p_fraud_status: "",
      p_transaction_id: `trx-${kode}-cb`,
      p_payment_type: "credit_card",
      p_gross_amount: 40_000,
      p_sidik: `sidik-${kode}-cb`,
      p_sumber: "webhook",
    });

    const { data } = await admin
      .from("orders")
      .select("sebab_tinjauan, butuh_tinjauan_pada")
      .eq("id", id)
      .single();
    expect(data!.sebab_tinjauan).toBe("chargeback");
    expect(data!.butuh_tinjauan_pada).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Basis data yang GAGAL tidak boleh menyamar jadi "pesanan tidak ditemukan"
// ---------------------------------------------------------------------------

/**
 * Sesi admin ASLI, kecuali pembacaan `orders` yang selalu gagal.
 *
 * Proxy, bukan klien palsu utuh: `requireRole` memakai
 * `createServerSupabase()` yang SAMA (lewat `penggunaSaatIni` dan
 * `profilSaatIni`), jadi klien palsu sepenuhnya akan memerahkan gerbang
 * perannya lebih dulu dan uji ini tidak akan pernah sampai ke baris yang
 * hendak diuji.
 */
function sesiOrdersGagal(asli: SupabaseClient): SupabaseClient {
  const galat = {
    code: "57014",
    message: "canceling statement due to statement timeout",
    details: "",
    hint: "",
  };
  return new Proxy(asli, {
    get(target, prop) {
      if (prop === "from") {
        return (tabel: string) =>
          tabel === "orders"
            ? {
                select: () => ({
                  eq: () => ({ maybeSingle: async () => ({ data: null, error: galat }) }),
                }),
              }
            : (Reflect.get(target, "from") as (t: string) => unknown).call(target, tabel);
      }
      const nilai = Reflect.get(target, prop);
      return typeof nilai === "function" ? nilai.bind(target) : nilai;
    },
  }) as SupabaseClient;
}

describe("galat basis data TIDAK dilaporkan sebagai 404", () => {
  /**
   * `const { data } = await sb…` membuang `error`, dan PostgREST yang gagal
   * memulangkan `data: null` — bentuk yang sama persis dengan "barisnya
   * memang tidak ada". Dilaporkan 404, staf pergi mencari pesanan yang
   * dikiranya terhapus sementara yang rusak adalah basis datanya.
   *
   * Temuan yang sama sudah diputuskan dua kali di cabang ini (pencacah Tugas 8
   * dan `kirimKeMesin` Tugas 10), dan `bacaPesananStaf` di modul ini sendiri
   * sudah berargumen begitu lalu MELEMPAR. Ketiga rute harus sepakat.
   */
  it("periksa-ulang: 500 dengan kalimatnya sendiri, dan Midtrans tidak pernah ditanyai", async () => {
    ref.sesi = sesiOrdersGagal(sesiAdmin);
    const r = await periksaUlang(permintaan("periksa-ulang"), param(idPesanan.get(K_TERBUKA_BARU)!));
    expect(r.status).toBe(500);
    const isi = (await r.json()) as { pesan: string };
    expect(isi.pesan).not.toContain("tidak ditemukan");
    // Barisnya tidak pernah terbaca, jadi tidak ada yang bisa ditanyakan —
    // bertanya tetap berarti membakar satu order_id percobaan tanpa alasan.
    expect(midtrans.panggilan).toEqual([]);
  });

  it("terbitkan-akses: 500 dengan kalimatnya sendiri, bukan 404", async () => {
    ref.sesi = sesiOrdersGagal(sesiAdmin);
    const r = await terbitkanAkses(
      permintaan("terbitkan-akses"),
      param(idPesanan.get(K_LUNAS_TANPA_AKSES)!),
    );
    expect(r.status).toBe(500);
    const isi = (await r.json()) as { pesan: string };
    expect(isi.pesan).not.toContain("tidak ditemukan");
  });
});
