/**
 * MODUL VERIFIKASI PEMBAYARAN (/admin/bayar).
 *
 * Inilah tempat siklus uang klinik ditutup: klien menekan "Saya sudah bayar"
 * di passport, admin mencocokkan bukti dengan mutasi, lalu menekan "Tandai
 * lunas". Karena keputusannya soal uang dan tidak ada nominal di layar, satu-
 * satunya hal yang membuat modul ini bisa dipertanggungjawabkan adalah JEJAK
 * AUDIT-nya — dan jejak itu hanya berguna bila menyebut MANUSIA yang menekan
 * tombol. Karena itu test pertama yang wajib hijau di sini bukan "status
 * berubah", melainkan "jejaknya menyebut peran_aktor 'admin' dengan aktor_id
 * yang benar, bukan service_role".
 *
 * Lima kelas kegagalan yang dijaga berkas ini, semuanya SENYAP:
 *
 *  1. TAGIHAN HANTU. Saringan daftar admin wajib IDENTIK dengan
 *     `susunTagihan()` di `@/lib/passport/turunan` — sesi berpaket dan sesi
 *     batal bukan tagihan. Saringan naif (`status_bayar <> 'lunas'`) memberi
 *     admin baris yang tidak pernah dilihat kliennya, dan karena `belum ->
 *     lunas` diizinkan DB, ia bisa benar-benar "melunasi" hantu itu berikut
 *     jejak audit palsunya.
 *  2. BADGE YANG TIDAK BISA DIBERSIHKAN. Badge `klaimMenunggu` wajib sama
 *     dengan jumlah baris menunggu verifikasi di daftar. Bila berbeda, admin
 *     membuka modulnya dan tidak menemukan apa pun untuk dipadamkan.
 *  3. KEADAAN TUJUAN SEBAGAI PARAMETER. Prototipe memakai
 *     `<select onchange="ubahStatusBayar(id, this.value)">` — status dikirim
 *     dari browser. Bentuk celah itu sudah pernah tembus di proyek ini, jadi
 *     di sini ada DUA action dengan status tertulis mati, dan tombolnya
 *     dirender bersyarat menurut status barisnya.
 *  4. SUKSES PALSU. UPDATE yang tertahan `WHERE status_bayar IN (...)` dijawab
 *     PostgREST 200 + [] — melaporkan "berhasil" tanpa memeriksa panjangnya
 *     berarti admin melihat "lunas" untuk baris yang tidak berubah sama sekali.
 *  5. PEMUTARAN MUNDUR. 'lunas' tidak boleh diputar lewat UI. DB pun
 *     menolaknya (42501), tetapi lapis aplikasi tidak boleh mengandalkan itu:
 *     yang sampai ke pengguna harus pesan yang bisa dibaca, bukan kode Postgres.
 *
 * Higiene: setiap perubahan `status_bayar` menulis satu baris
 * `jejak_status_bayar`, dan tabel jejak SENGAJA tanpa foreign key (cascade akan
 * menghapus tepat bukti yang menjelaskan penghapusan). Fixture di sini karena
 * itu menyapu jejaknya sendiri — lihat tests/jejak-yatim.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const KLIEN = "44444444-4444-4444-4444-444444444401"; // Ananda (tertaut)
const PADMA_ID = "PAD-2607-0012";
const PAKET_TIPE = "22222222-2222-2222-2222-222222222201";
const SVC_MASSAGE = "11111111-1111-1111-1111-111111111101";
const SVC_NUTRISI = "11111111-1111-1111-1111-111111111103";
const MITRA_A = "33333333-3333-3333-3333-333333333301";
const TGL = "2026-12-23";
const HANTU = "00000000-0000-0000-0000-000000000000";

const PAKET_UJI = "55555555-5555-5555-5555-5555555555c1";
const SESI_MENUNGGU = "66666666-6666-6666-6666-6666666666c1";
const SESI_BELUM = "66666666-6666-6666-6666-6666666666c2";
const SESI_LUNAS = "66666666-6666-6666-6666-6666666666c3";
const SESI_BATAL = "66666666-6666-6666-6666-6666666666c4";
const SESI_PAKET = "66666666-6666-6666-6666-6666666666c5";

const SESI_UJI = [SESI_MENUNGGU, SESI_BELUM, SESI_LUNAS, SESI_BATAL, SESI_PAKET];

// Lapisan data & action memakai sesi pengguna (`createServerSupabase`), yang
// membaca cookies() dan hanya bermakna di dalam request scope. Modulnya
// diganti klien Supabase ber-SESI NYATA: RLS dan requireRole tetap berjalan
// apa adanya, persis seperti di server.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const jejakCache = vi.hoisted(() => ({ revalidate: [] as string[] }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    jejakCache.revalidate.push(p);
  },
}));

// `redirect()` melempar di dalam request Next. Di test ia dijadikan error yang
// bisa dibaca supaya "penjaga peran hilang" menjadi MERAH, bukan senyap.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/admin/bayar",
}));

const { daftarTagihanAdmin } = await import("@/lib/admin/tagihan");
const { hitungKlaimMenunggu } = await import("@/lib/admin/antrean");
const { tandaiLunas, tolakKlaim } = await import("@/app/admin/bayar/aksi");
const { TabelBayar } = await import("@/app/admin/bayar/tabel-bayar");
const { default: BayarPage } = await import("@/app/admin/bayar/page");
const { ambilPaket, ambilSesi } = await import("@/lib/passport/data");
const { susunTagihan } = await import("@/lib/passport/turunan");

const sumberAksi = baca("src/app/admin/bayar/aksi.ts");
const sumberHalaman = baca("src/app/admin/bayar/page.tsx");
const sumberTabel = baca("src/app/admin/bayar/tabel-bayar.tsx");
const sumberStatus = baca("src/app/admin/bayar/status.ts");
const sumberData = baca("src/lib/admin/tagihan.ts");

let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;
let idAdmin: string;

// ---------------------------------------------------------------------------
// Perkakas
// ---------------------------------------------------------------------------

async function bersihkan() {
  // Jejak DULU: tabel jejak sengaja tanpa FK, jadi ia tidak ikut tersapu saat
  // barisnya dihapus. Tanpa baris ini `npm test` menumpuk jejak yatim per run.
  await admin.from("jejak_status_bayar").delete().in("sesi_id", SESI_UJI);
  await admin.from("jejak_status_bayar").delete().eq("paket_klien_id", PAKET_UJI);
  await admin.from("sessions").delete().in("id", SESI_UJI);
  await admin.from("client_packages").delete().eq("id", PAKET_UJI);
}

/**
 * Bahan uji ditulis lewat SERVICE ROLE, bukan lewat jalur yang diuji:
 * `guard_insert_status_bayar` melarang peran API melahirkan baris uang
 * berstatus selain 'belum', dan itu memang pagar yang ingin dipertahankan.
 */
async function siapkan() {
  await bersihkan();

  // Paket uji SENDIRI, bukan paket seed: mengubah status bayar paket seed akan
  // diwarisi berkas test lain (beranda, bayar passport) yang membacanya apa adanya.
  await admin.from("client_packages").insert({
    id: PAKET_UJI,
    client_id: KLIEN,
    package_id: PAKET_TIPE,
    tanggal_mulai: TGL,
    status_bayar: "menunggu_verifikasi",
  });

  await admin.from("sessions").insert([
    baris(SESI_MENUNGGU, { status_bayar: "menunggu_verifikasi", service_id: SVC_NUTRISI }),
    baris(SESI_BELUM, { status_bayar: "belum" }),
    baris(SESI_LUNAS, { status_bayar: "lunas" }),
    // Sesi batal yang terlanjur mengklaim: bukan tagihan, tidak pernah masuk
    // daftar maupun badge.
    baris(SESI_BATAL, { status: "batal", status_bayar: "menunggu_verifikasi" }),
    // Sesi di dalam paket. `sessions_bayar_hanya_lepas` memaksa 'belum' —
    // status bayarnya mengikuti paketnya, dan ia tidak boleh muncul sendiri.
    baris(SESI_PAKET, { client_package_id: PAKET_UJI, status_bayar: "belum" }),
  ]);
}

function baris(id: string, ubah: Record<string, unknown>) {
  return {
    id,
    client_id: KLIEN,
    client_package_id: null,
    service_id: SVC_MASSAGE,
    partner_id: MITRA_A,
    tanggal: TGL,
    status: "terjadwal",
    catatan: "",
    rekomendasi: "",
    ...ubah,
  };
}

async function statusSesi(id: string): Promise<string> {
  const { data } = await admin.from("sessions").select("status_bayar").eq("id", id).single();
  return data!.status_bayar as string;
}

async function statusPaket(id: string): Promise<string> {
  const { data } = await admin
    .from("client_packages")
    .select("status_bayar")
    .eq("id", id)
    .single();
  return data!.status_bayar as string;
}

async function jejakSesi(id: string) {
  const { data } = await admin
    .from("jejak_status_bayar")
    .select("*")
    .eq("sesi_id", id)
    .order("dicatat_pada", { ascending: false });
  return data ?? [];
}

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
  // Identitas diambil dari sesi, BUKAN dari `profiles ... limit(1)`: admin
  // berhak membaca SELURUH profil, jadi baris pertama sembarang belum tentu
  // miliknya sendiri.
  const { data } = await sesiAdmin.auth.getUser();
  idAdmin = data.user!.id;
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  jejakCache.revalidate.length = 0;
  await siapkan();
});

afterAll(bersihkan);

// ---------------------------------------------------------------------------
// Daftar tagihan admin
// ---------------------------------------------------------------------------

describe("daftar tagihan admin", () => {
  it("memuat sesi lepas dan paket klien yang menunggu verifikasi", async () => {
    const daftar = await daftarTagihanAdmin();
    const kunci = daftar.map((t) => `${t.jenis}:${t.id}`);
    expect(kunci).toContain(`sesi:${SESI_MENUNGGU}`);
    expect(kunci).toContain(`paket:${PAKET_UJI}`);
  });

  it("membawa nama klien dan PADMA ID — antrean ini dibaca manusia", async () => {
    const item = (await daftarTagihanAdmin()).find((t) => t.id === SESI_MENUNGGU);
    expect(item).toBeDefined();
    expect(item!.namaKlien).toContain("Ananda");
    expect(item!.padmaId).toBe(PADMA_ID);
    expect(item!.label.length).toBeGreaterThan(0);
  });

  it("TIDAK memuat sesi yang sudah tercakup paket (tagihan hantu)", async () => {
    const daftar = await daftarTagihanAdmin();
    expect(daftar.map((t) => t.id)).not.toContain(SESI_PAKET);
  });

  it("TIDAK memuat sesi batal", async () => {
    const daftar = await daftarTagihanAdmin();
    expect(daftar.map((t) => t.id)).not.toContain(SESI_BATAL);
  });

  it("invarian menyeluruh: TIAP baris sesi di daftar benar-benar lepas & tidak batal", async () => {
    // Bukan hanya baris uji — seluruh daftar. Satu sesi berpaket yang lolos
    // berarti admin bisa "melunasi" sesuatu yang kliennya tidak pernah lihat.
    const idSesi = (await daftarTagihanAdmin())
      .filter((t) => t.jenis === "sesi")
      .map((t) => t.id);
    if (idSesi.length > 0) {
      const { data } = await admin
        .from("sessions")
        .select("id, status, client_package_id")
        .in("id", idSesi);
      for (const s of data ?? []) {
        expect(s.client_package_id, `sesi ${s.id} berpaket`).toBeNull();
        expect(s.status, `sesi ${s.id} batal`).not.toBe("batal");
      }
      expect((data ?? []).length).toBe(idSesi.length);
    }
  });

  it("saringan IDENTIK dengan susunTagihan() yang dilihat klien", async () => {
    // Bukti terkuat bahwa admin dan klien melihat daftar yang sama: item milik
    // Ananda di daftar admin harus persis sama dengan tagihan yang tersusun
    // dari sisi Ananda sendiri.
    const milikAdmin = (await daftarTagihanAdmin())
      .filter((t) => t.padmaId === PADMA_ID)
      .map((t) => `${t.jenis}:${t.id}`)
      .sort();

    ref.sesi = sesiKlien;
    const [paket, sesi] = await Promise.all([ambilPaket(KLIEN), ambilSesi(KLIEN)]);
    ref.sesi = sesiAdmin;
    const milikKlien = susunTagihan({ paket, sesi })
      .map((t) => `${t.jenis}:${t.id}`)
      .sort();

    expect(milikAdmin).toEqual(milikKlien);
  });

  it("terurut menurut kemendesakan: menunggu verifikasi, belum, lunas", async () => {
    // Yang menunggu verifikasi naik ke atas — itulah pekerjaan admin hari ini.
    const urut = { menunggu_verifikasi: 0, belum: 1, lunas: 2 } as const;
    const peringkat = (await daftarTagihanAdmin()).map((t) => urut[t.status]);
    expect(peringkat.length).toBeGreaterThan(1);
    for (let i = 1; i < peringkat.length; i++) {
      expect(peringkat[i]).toBeGreaterThanOrEqual(peringkat[i - 1]);
    }
    expect(peringkat[0]).toBe(0); // ada yang menunggu, dan ia yang pertama
  });

  it("BADGE = jumlah baris menunggu verifikasi di daftar", async () => {
    // Badge yang berbeda dari daftarnya adalah alarm yang tidak bisa
    // dipadamkan: angkanya naik, admin membuka modulnya, tidak ada yang bisa
    // dikerjakan.
    const daftar = await daftarTagihanAdmin();
    const menunggu = daftar.filter((t) => t.status === "menunggu_verifikasi").length;
    expect(await hitungKlaimMenunggu()).toBe(menunggu);
  });

  it("badge turun tepat satu setelah satu klaim diverifikasi", async () => {
    const sebelum = await hitungKlaimMenunggu();
    const r = await tandaiLunas("sesi", SESI_MENUNGGU);
    expect(r.ok).toBe(true);
    expect(await hitungKlaimMenunggu()).toBe(sebelum - 1);

    const daftar = await daftarTagihanAdmin();
    expect(daftar.filter((t) => t.status === "menunggu_verifikasi").length).toBe(
      sebelum - 1,
    );
  });
});

// ---------------------------------------------------------------------------
// Label tagihan menyertakan varian (Task 7)
// ---------------------------------------------------------------------------

describe("daftarTagihanAdmin — label sesi menyertakan varian", () => {
  // Fixture SENDIRI, bukan SVC_MASSAGE/SVC_NUTRISI seed: dua sesi layanan
  // yang sama bisa berbeda harga bila variannya berbeda, dan label yang tidak
  // menyebut variannya membuat klien ditagih untuk hal yang salah.
  const SVC_VARIAN = "11111111-1111-1111-1111-111111111c01";
  const VARIAN_NAMED = "77777777-7777-7777-7777-777777777c01";
  const SESI_VARIAN = "66666666-6666-6666-6666-666666666c01";

  beforeAll(async () => {
    await admin.from("services").insert({
      id: SVC_VARIAN,
      phase_id: "prekonsepsi",
      nama: "PAD-UJI Layanan Varian Tagihan",
      deskripsi: "fixture",
    });
    // Trigger `trg_terbitkan_varian_baku` sudah menerbitkan varian baku untuk
    // layanan di atas; baris di bawah adalah varian BERNAMA yang dipesan sesi
    // uji ini — beda varian, beda harga, karena itu labelnya wajib beda juga.
    await admin.from("service_variants").insert({
      id: VARIAN_NAMED,
      service_id: SVC_VARIAN,
      label: "VIP",
      durasi_menit: 90,
      format: "private",
      urutan: 1,
    });
    await admin.from("sessions").insert(
      baris(SESI_VARIAN, {
        service_id: SVC_VARIAN,
        variant_id: VARIAN_NAMED,
        status_bayar: "belum",
      }),
    );
  });

  afterAll(async () => {
    await admin.from("sessions").delete().eq("id", SESI_VARIAN);
    // `service_variants` dulu — FK menahan penghapusan `services` di bawah.
    // Dihapus per SERVICE_ID (bukan hanya VARIAN_NAMED): trigger
    // `trg_terbitkan_varian_baku` menerbitkan satu varian baku otomatis
    // dengan id acak yang tidak kita catat.
    await admin.from("service_variants").delete().eq("service_id", SVC_VARIAN);
    await admin.from("services").delete().eq("id", SVC_VARIAN);
  });

  it("label menyertakan nama layanan DAN label varian", async () => {
    const item = (await daftarTagihanAdmin()).find((t) => t.id === SESI_VARIAN);
    expect(item).toBeDefined();
    expect(item!.label).toContain("PAD-UJI Layanan Varian Tagihan");
    expect(item!.label).toContain("VIP");
    expect(item!.label).toMatch(/90 menit/);
  });

  it("varian BAKU (tanpa nama) tidak menambah apa pun ke label — perilaku lama dipertahankan", async () => {
    // SESI_MENUNGGU (fixture modul ini) tidak pernah menyetel `variant_id`,
    // jadi baris ini membuktikan sesi TANPA varian bernama tetap berlabel
    // persis seperti sebelum Task 7: "<nama layanan> · <tanggal>" — satu
    // pemisah " · " saja.
    const item = (await daftarTagihanAdmin()).find((t) => t.id === SESI_MENUNGGU);
    expect(item).toBeDefined();
    expect((item!.label.match(/ · /g) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// tandaiLunas
// ---------------------------------------------------------------------------

describe("tandaiLunas", () => {
  it("dari 'menunggu_verifikasi' berhasil — DAN jejaknya menyebut admin yang menekan", async () => {
    const r = await tandaiLunas("sesi", SESI_MENUNGGU);
    expect(r.ok).toBe(true);
    expect(await statusSesi(SESI_MENUNGGU)).toBe("lunas");

    const jejak = await jejakSesi(SESI_MENUNGGU);
    expect(jejak.length).toBeGreaterThanOrEqual(1);
    expect(jejak[0]).toMatchObject({
      status_lama: "menunggu_verifikasi",
      status_baru: "lunas",
      peran_aktor: "admin",
    });
    // INTI GUNANYA MODUL INI: bukan "ada barisnya", tetapi barisnya menyebut
    // MANUSIA. Di bawah service role nilainya akan null / 'service_role'.
    expect(jejak[0].aktor_id).toBe(idAdmin);
    expect(jejak[0].peran_aktor).not.toBe("service_role");
    expect(jejak[0].paket_klien_id).toBeNull();
  });

  it("dari 'belum' juga berhasil — klien yang transfer & lapor langsung", async () => {
    const r = await tandaiLunas("sesi", SESI_BELUM);
    expect(r.ok).toBe(true);
    expect(await statusSesi(SESI_BELUM)).toBe("lunas");
    const jejak = await jejakSesi(SESI_BELUM);
    expect(jejak[0]).toMatchObject({ status_lama: "belum", status_baru: "lunas" });
  });

  it("paket klien: jejaknya menempel pada paket, bukan pada sesi", async () => {
    const r = await tandaiLunas("paket", PAKET_UJI);
    expect(r.ok).toBe(true);
    expect(await statusPaket(PAKET_UJI)).toBe("lunas");

    const { data: jejak } = await admin
      .from("jejak_status_bayar")
      .select("*")
      .eq("paket_klien_id", PAKET_UJI)
      .order("dicatat_pada", { ascending: false });
    expect(jejak![0]).toMatchObject({
      status_lama: "menunggu_verifikasi",
      status_baru: "lunas",
      peran_aktor: "admin",
      sesi_id: null,
    });
    expect(jejak![0].aktor_id).toBe(idAdmin);
  });

  it("baris yang SUDAH lunas ditolak — tanpa mengubah apa pun, tanpa jejak baru", async () => {
    const sebelum = (await jejakSesi(SESI_LUNAS)).length;
    const r = await tandaiLunas("sesi", SESI_LUNAS);
    expect(r.ok).toBe(false);
    expect(await statusSesi(SESI_LUNAS)).toBe("lunas");
    expect((await jejakSesi(SESI_LUNAS)).length).toBe(sebelum);
  });

  it("baris yang tidak ada ditolak, bukan 'ok' palsu", async () => {
    // UPDATE yang tidak mengenai baris mana pun dijawab PostgREST 200 + [].
    const r = await tandaiLunas("sesi", HANTU);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.pesan.length > 0).toBe(true);
  });

  it("sesi BERPAKET tidak bisa dilunasi lewat modul ini", async () => {
    // Ia tidak pernah muncul di daftar; kalau id-nya tetap di-POST, jawabannya
    // tetap penolakan — tampilan bukan pagar.
    const r = await tandaiLunas("sesi", SESI_PAKET);
    expect(r.ok).toBe(false);
    expect(await statusSesi(SESI_PAKET)).toBe("belum");
  });

  it("menyegarkan cache admin DAN halaman bayar klien", async () => {
    await tandaiLunas("sesi", SESI_MENUNGGU);
    expect(jejakCache.revalidate).toContain("/admin/bayar");
    expect(jejakCache.revalidate).toContain("/admin");
    expect(jejakCache.revalidate).toContain("/passport/bayar");
  });

  it("PENJAGA PERAN: klien yang login tidak bisa melunasi tagihannya sendiri", async () => {
    ref.sesi = sesiKlien;
    await expect(tandaiLunas("sesi", SESI_MENUNGGU)).rejects.toThrow(/REDIRECT/);
    ref.sesi = sesiAdmin;
    expect(await statusSesi(SESI_MENUNGGU)).toBe("menunggu_verifikasi");
  });
});

// ---------------------------------------------------------------------------
// tolakKlaim
// ---------------------------------------------------------------------------

describe("tolakKlaim", () => {
  it("hanya dari 'menunggu_verifikasi' — klaim yang buktinya tidak cocok", async () => {
    const r = await tolakKlaim("sesi", SESI_MENUNGGU);
    expect(r.ok).toBe(true);
    expect(await statusSesi(SESI_MENUNGGU)).toBe("belum");

    const jejak = await jejakSesi(SESI_MENUNGGU);
    expect(jejak[0]).toMatchObject({
      status_lama: "menunggu_verifikasi",
      status_baru: "belum",
      peran_aktor: "admin",
    });
    expect(jejak[0].aktor_id).toBe(idAdmin);
  });

  it("baris 'belum' ditolak — tidak ada klaim yang bisa ditolak di sana", async () => {
    const sebelum = (await jejakSesi(SESI_BELUM)).length;
    const r = await tolakKlaim("sesi", SESI_BELUM);
    expect(r.ok).toBe(false);
    expect(await statusSesi(SESI_BELUM)).toBe("belum");
    expect((await jejakSesi(SESI_BELUM)).length).toBe(sebelum);
  });

  it("baris 'lunas' TIDAK bisa diputar mundur lewat UI", async () => {
    // Membalik status sesudah rekap pekan berjalan adalah rekonsiliasi, bukan
    // toggle. DB pun menolaknya (42501) — tetapi yang sampai ke admin harus
    // pesan yang bisa dibaca, bukan kode Postgres.
    const sebelum = (await jejakSesi(SESI_LUNAS)).length;
    const r = await tolakKlaim("sesi", SESI_LUNAS);
    expect(r.ok).toBe(false);
    expect(await statusSesi(SESI_LUNAS)).toBe("lunas");
    expect((await jejakSesi(SESI_LUNAS)).length).toBe(sebelum);
  });

  it("paket klien juga bisa ditolak klaimnya", async () => {
    const r = await tolakKlaim("paket", PAKET_UJI);
    expect(r.ok).toBe(true);
    expect(await statusPaket(PAKET_UJI)).toBe("belum");
  });

  it("PENJAGA PERAN: klien yang login tidak bisa menolak klaimnya sendiri", async () => {
    ref.sesi = sesiKlien;
    await expect(tolakKlaim("sesi", SESI_MENUNGGU)).rejects.toThrow(/REDIRECT/);
    ref.sesi = sesiAdmin;
    expect(await statusSesi(SESI_MENUNGGU)).toBe("menunggu_verifikasi");
  });
});

// ---------------------------------------------------------------------------
// Halaman & tabel
// ---------------------------------------------------------------------------

describe("halaman /admin/bayar", () => {
  it("menampilkan klien, PADMA ID, item, dan status", async () => {
    const markup = renderToStaticMarkup(await BayarPage());
    expect(markup).toContain("Ananda");
    expect(markup).toContain(PADMA_ID);
    expect(markup).toContain("Menunggu verifikasi");
  });

  it("menjelaskan alurnya dan bahwa nominal disampaikan lewat WhatsApp", async () => {
    const markup = renderToStaticMarkup(await BayarPage());
    expect(markup).toMatch(/WhatsApp/);
    expect(markup).toMatch(/Menunggu verifikasi/);
  });

  it("TIDAK ada <select> pengubah status — status tidak pernah datang dari browser", async () => {
    const markup = renderToStaticMarkup(await BayarPage());
    expect(markup).not.toContain("<select");
    expect(sumberTabel).not.toContain("onChange");
  });

  it("TIDAK ada nominal uang di seluruh modul (money firewall)", async () => {
    const markup = renderToStaticMarkup(await BayarPage());
    expect(markup).not.toMatch(/Rp\s?\d/);
    for (const sumber of [sumberHalaman, sumberTabel, sumberAksi, sumberStatus, sumberData]) {
      expect(sumber).not.toMatch(/Rp\s?\d/);
      expect(sumber).not.toContain("service_rates");
      expect(sumber).not.toContain("variant_rates");
      expect(sumber).not.toContain("honor_marks");
    }
  });
});

describe("tombol dirender BERSYARAT menurut status barisnya", () => {
  const contoh = [
    {
      jenis: "sesi" as const,
      id: SESI_MENUNGGU,
      namaKlien: "Ananda Putri",
      padmaId: PADMA_ID,
      label: "Nutrisi · 23 Desember 2026",
      status: "menunggu_verifikasi" as const,
    },
    {
      jenis: "sesi" as const,
      id: SESI_BELUM,
      namaKlien: "Ananda Putri",
      padmaId: PADMA_ID,
      label: "Massage · 23 Desember 2026",
      status: "belum" as const,
    },
    {
      jenis: "sesi" as const,
      id: SESI_LUNAS,
      namaKlien: "Ananda Putri",
      padmaId: PADMA_ID,
      label: "Massage · 23 Desember 2026",
      status: "lunas" as const,
    },
  ];

  /** Potongan markup satu baris, dipisah lewat penanda data-item. */
  function potongBaris(markup: string, id: string): string {
    const bagian = markup.split('data-item="');
    const cocok = bagian.find((b) => b.startsWith(`sesi:${id}"`));
    expect(cocok, `baris ${id} tidak dirender`).toBeDefined();
    return cocok!;
  }

  const markup = () =>
    renderToStaticMarkup(createElement(TabelBayar, { item: contoh }));

  it("baris 'menunggu_verifikasi' mendapat DUA aksi", () => {
    const b = potongBaris(markup(), SESI_MENUNGGU);
    expect(b).toContain("Tandai lunas");
    expect(b).toContain("Tolak klaim");
  });

  it("baris 'belum' hanya mendapat 'Tandai lunas'", () => {
    const b = potongBaris(markup(), SESI_BELUM);
    expect(b).toContain("Tandai lunas");
    expect(b).not.toContain("Tolak klaim");
  });

  it("baris 'lunas' TIDAK mendapat aksi apa pun", () => {
    const b = potongBaris(markup(), SESI_LUNAS);
    expect(b).not.toContain("Tandai lunas");
    expect(b).not.toContain("Tolak klaim");
  });

  it("daftar kosong menjelaskan dirinya, bukan tabel kosong", () => {
    const m = renderToStaticMarkup(createElement(TabelBayar, { item: [] }));
    expect(m).toMatch(/tagihan/i);
  });
});

// ---------------------------------------------------------------------------
// Bentuk berkas
// ---------------------------------------------------------------------------

describe("bentuk berkas modul bayar", () => {
  it("KEADAAN TUJUAN BUKAN PARAMETER: dua action, status tertulis mati", () => {
    expect(tandaiLunas.length).toBe(2); // (jenis, id) saja
    expect(tolakKlaim.length).toBe(2);
    for (const pola of [
      /function\s+tandaiLunas\([^)]*status\s*:/,
      /function\s+tolakKlaim\([^)]*status\s*:/,
      /function\s+tandaiLunas\([^)]*tujuan\s*:/,
      /function\s+tolakKlaim\([^)]*tujuan\s*:/,
    ]) {
      expect(sumberAksi).not.toMatch(pola);
    }
    expect(sumberAksi).toMatch(/"lunas"/);
    // Tabel tidak boleh mengirim status apa pun ke server.
    expect(sumberTabel).not.toMatch(/tandaiLunas\([^)]*status/);
  });

  it("SETIAP action memanggil requireRole(['admin','owner']) di dalam dirinya", () => {
    const jumlahAction = [...sumberAksi.matchAll(/^export\s+async\s+function\s+\w+/gm)].length;
    const jumlahGuard = [
      ...sumberAksi.matchAll(/await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/g),
    ].length;
    expect(jumlahAction).toBe(2);
    expect(jumlahGuard).toBeGreaterThanOrEqual(1);
  });

  it("UPDATE selalu .select('id') lalu diperiksa panjangnya", () => {
    // 200 + [] adalah jawaban UPDATE yang tertahan; melaporkan sukses tanpa
    // memeriksa panjangnya adalah kebohongan senyap.
    expect(sumberAksi).toContain('.select("id")');
    expect(sumberAksi).toMatch(/length\s*===\s*0/);
  });

  it("berkas 'use server' hanya mengekspor fungsi async", () => {
    const ekspor = [...sumberAksi.matchAll(/^export\s+(?!type\b)(\w+)/gm)].map((m) => m[1]);
    expect([...new Set(ekspor)]).toEqual(["async"]);
  });

  it("memakai sesi pengguna, bukan service role", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberTabel, sumberStatus, sumberData]) {
      expect(sumber).not.toContain("createAdminSupabase");
      expect(sumber).not.toContain("SERVICE_ROLE");
    }
    expect(sumberData).toContain("createServerSupabase");
  });

  it("tanggal tidak pernah dihitung dengan aritmatika Date", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberTabel, sumberData]) {
      expect(sumber).not.toContain("toISOString");
      expect(sumber).not.toContain("setDate(");
      expect(sumber).not.toContain("getDay(");
    }
  });

  it("tidak menuliskan data klien ke log", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberTabel, sumberData]) {
      expect(sumber).not.toContain("console.");
    }
  });

  it("layout admin TIDAK ikut diubah (matriks peran tetap satu panggilan)", () => {
    const layout = baca("src/app/admin/layout.tsx");
    expect([...layout.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(layout).toMatch(/requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/);
    expect(baca("src/app/admin/page.tsx")).toContain('href="/admin/skrining"');
  });

  it("navigasi & dashboard menautkan modulnya", () => {
    expect(baca("src/app/admin/_shell/nav-admin.tsx")).toContain('href: "/admin/bayar"');
    expect(baca("src/app/admin/page.tsx")).toContain('href="/admin/bayar"');
  });
});
