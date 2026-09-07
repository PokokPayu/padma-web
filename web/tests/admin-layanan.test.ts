/**
 * Modul Layanan & Paket panel admin — katalog per fase, tambah/ubah, dan
 * pensiun lewat `aktif = false`.
 *
 * Modul ini kecil di layar dan besar akibatnya: isinya adalah SATU-SATUNYA
 * sumber nama layanan yang dibaca landing publik, wizard pengajuan jadwal
 * klien, dan riwayat sesi seluruh klien. Lima cacat senyap yang dijaga berkas
 * ini — semuanya sudah pernah nyata atau sudah dibayar mahal di modul tetangga:
 *
 *  1. TOMBOL HAPUS. Hak DELETE atas `services`/`packages`/`phases` sudah
 *     DICABUT dari `authenticated` (migration cabut_hak_hapus_berlebih):
 *     jawabannya 403/42501, bukan "0 baris". Tombol Hapus di modul ini karena
 *     itu bukan sekadar berbahaya — ia adalah tombol yang PASTI gagal, dan
 *     kegagalannya berupa kode Postgres di layar admin klinik. Pensiun yang
 *     benar adalah `aktif = false`.
 *
 *  2. NONAKTIF = HILANG DARI RIWAYAT. Ini persis bug `partner_publik` yang
 *     sudah dibayar: satu klik "nonaktifkan" mengubah nama di riwayat SELURUH
 *     klien menjadi teks cadangan, tanpa satu pun error. Untuk layanan,
 *     bentuknya adalah menambahkan `aktif` ke policy "services: baca" atau
 *     melahirkan view penyaring. Berkas ini membuktikan riwayat TETAP bernama.
 *
 *  3. Penjaga peran hilang dari dalam server action. Server action adalah
 *     ENDPOINT POST TERSENDIRI; `src/app/admin/layout.tsx` tidak pernah
 *     dilewati saat action dipanggil langsung.
 *
 *  4. Keadaan tujuan menjadi parameter. `aktif` ditulis HARDCODED di empat
 *     action terpisah; tidak ada satu pun action yang menerimanya dari luar.
 *
 *  5. `packages.jumlah_sesi` diubah tanpa disadari MENGGESER progres passport
 *     klien yang sedang berjalan — penyebutnya menyusut retroaktif. Kalkulasi
 *     turunan sudah punya cap 100%; yang diuji di sini adalah bahwa cap itu
 *     benar-benar menyala lewat jalur yang dipakai admin, dan bahwa formulir
 *     memperingatkannya.
 *
 * Data uji berprefiks `PAD-UJI` dan dibersihkan di `afterAll`. Baris seed yang
 * dipinjam (layanan 1101, paket Sankalpa Prima) DIKEMBALIKAN ke keadaan semula
 * — `passport-beranda.test.ts` dan `landing-katalog.test.ts` meng-assert
 * keduanya.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const ANANDA = "44444444-4444-4444-4444-444444444401";

// Baris seed yang dipinjam sebentar.
const SVC_SEED = "11111111-1111-1111-1111-111111111101";
const NAMA_SVC_SEED = "Sankalpa Fertility Massage";
const PAKET_SEED = "22222222-2222-2222-2222-222222222201";
const JUMLAH_SESI_SEED = 8;

// Fixture milik berkas ini.
const SVC_EDIT = "11111111-1111-1111-1111-1111111119a1";
const SVC_STATUS = "11111111-1111-1111-1111-1111111119a2";
// Layanan KHUSUS untuk pagar "varian aktif terakhir": SVC_EDIT juga jadi
// sasaran `buatVarian` di bawah, jadi jumlah variannya BERTAMBAH sepanjang
// berkas ini berjalan — tidak aman dijadikan sasaran "hanya satu varian
// aktif". Layanan ini sengaja tidak pernah disentuh action lain.
const SVC_VARIAN_TUNGGAL = "11111111-1111-1111-1111-1111111119a4";
const PAKET_EDIT = "22222222-2222-2222-2222-2222222229a1";
const PAKET_STATUS = "22222222-2222-2222-2222-2222222229a2";
const SESI_UJI = "66666666-6666-6666-6666-6666666669a1";
const KLIEN_UJI = "44444444-4444-4444-4444-4444444449a1";
const PADMA_ID_UJI = "PAD-UJI-9A01";
const PAKET_KLIEN_UJI = "55555555-5555-5555-5555-5555555559a1";
const TAK_ADA_SVC = "11111111-1111-1111-1111-1111111119ff";
const TAK_ADA_PAKET = "22222222-2222-2222-2222-2222222229ff";
const TAK_ADA_VARIAN = "77777777-7777-7777-7777-7777777779ff";
// Varian KEDUA milik SVC_STATUS — baris ini yang membuat SVC_STATUS punya DUA
// varian aktif, sehingga salah satunya bisa dinonaktifkan tanpa melanggar
// pagar "varian aktif terakhir". SVC_EDIT sengaja dibiarkan hanya dengan
// varian BAKU otomatisnya (satu-satunya), justru untuk membuktikan pagar itu
// menyala pada layanan yang belum punya varian kedua.
const VARIAN_KEDUA_STATUS = "77777777-7777-7777-7777-7777777779a1";

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

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/admin/layanan",
}));

const {
  simpanLayanan,
  perbaruiLayanan,
  aktifkanLayanan,
  nonaktifkanLayanan,
  simpanPaket,
  perbaruiPaket,
  aktifkanPaket,
  nonaktifkanPaket,
  buatVarian,
  perbaruiVarian,
  aktifkanVarian,
  nonaktifkanVarian,
} = await import("@/app/admin/layanan/aksi");
const { daftarKatalogAdmin, pilihanLayanan } = await import("@/lib/admin/katalog-admin");
const { ambilSesi } = await import("@/lib/passport/data");
const { progresPaket } = await import("@/lib/passport/turunan");
const { bacaKatalog } = await import("@/lib/katalog");
const { default: LayananPage } = await import("@/app/admin/layanan/page");

const sumberAksi = baca("src/app/admin/layanan/aksi.ts");
const sumberHalaman = baca("src/app/admin/layanan/page.tsx");
const sumberForm = baca("src/app/admin/layanan/form-layanan.tsx");
const sumberFormVarian = baca("src/app/admin/layanan/form-varian.tsx");
const sumberStatus = baca("src/app/admin/layanan/status.ts");
const sumberLib = baca("src/lib/admin/katalog-admin.ts");
const SEMUA_SUMBER = [sumberAksi, sumberHalaman, sumberForm, sumberFormVarian, sumberStatus, sumberLib];

let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;
// Id varian BAKU yang diterbitkan otomatis oleh trigger `trg_terbitkan_varian_baku`
// begitu SVC_EDIT/SVC_STATUS disisipkan di bawah — id-nya acak (`gen_random_uuid()`),
// jadi ditemukan lewat query sesudah insert, bukan ditulis sebagai konstanta.
let varianBakuEdit: string;
let varianBakuStatus: string;
let varianTunggal: string;

function formulir(isi: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isi)) fd.set(k, v);
  return fd;
}

async function barisLayanan(id: string) {
  const { data } = await admin
    .from("services")
    .select("id, phase_id, nama, deskripsi, aktif")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      phase_id: string;
      nama: string;
      deskripsi: string;
      aktif: boolean;
    }>();
  return data;
}

async function barisPaket(id: string) {
  const { data } = await admin
    .from("packages")
    .select("id, service_id, nama, jumlah_sesi, aktif")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      service_id: string;
      nama: string;
      jumlah_sesi: number;
      aktif: boolean;
    }>();
  return data;
}

async function barisVarian(id: string) {
  const { data } = await admin
    .from("service_variants")
    .select("id, service_id, label, durasi_menit, format, urutan, aktif")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      service_id: string;
      label: string;
      durasi_menit: number | null;
      format: string | null;
      urutan: number;
      aktif: boolean;
    }>();
  return data;
}

async function bersihkan() {
  // Jejak audit fixture disapu lebih dulu — tabelnya SENGAJA tanpa foreign key
  // (cascade akan menghapus tepat bukti yang menjelaskan penghapusan), jadi
  // penghapusan sesi di bawah TIDAK ikut menyapunya. Tanpa baris ini, `npm
  // test` menumpuk jejak yatim lintas run. Wajib lewat service role: peran
  // `authenticated` sengaja tidak memegang DELETE atas tabel jejak.
  await admin.from("jejak_status_bayar").delete().eq("sesi_id", SESI_UJI);
  await admin.from("jejak_status_bayar").delete().eq("paket_klien_id", PAKET_KLIEN_UJI);
  await admin.from("sessions").delete().eq("id", SESI_UJI);
  // clients -> client_packages berjenjang cascade; barisnya tetap disebut
  // eksplisit supaya urutan pembersihan terbaca tanpa mengandalkan cascade.
  await admin.from("client_packages").delete().eq("id", PAKET_KLIEN_UJI);
  await admin.from("clients").delete().eq("id", KLIEN_UJI);
  await admin.from("packages").delete().like("nama", "PAD-UJI%");
  // Trigger `trg_terbitkan_varian_baku` menerbitkan satu varian baku otomatis
  // untuk setiap layanan yang lahir di atas (termasuk lewat `simpanLayanan()`
  // sungguhan, yang id-nya tidak diketahui di sini) — FK-nya menahan
  // penghapusan `services` sampai variannya disapu duluan. Id layanan dicari
  // lewat pola nama yang sama, bukan disebut satu per satu.
  const { data: layananUji } = await admin.from("services").select("id").like("nama", "PAD-UJI%");
  if (layananUji && layananUji.length > 0) {
    await admin
      .from("service_variants")
      .delete()
      .in("service_id", layananUji.map((l) => l.id));
  }
  await admin.from("services").delete().like("nama", "PAD-UJI%");

  // Baris seed yang dipinjam dikembalikan utuh.
  await admin.from("services").update({ aktif: true }).eq("id", SVC_SEED);
  await admin
    .from("packages")
    .update({ jumlah_sesi: JUMLAH_SESI_SEED, aktif: true })
    .eq("id", PAKET_SEED);
}

beforeAll(async () => {
  await bersihkan();
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
  ref.sesi = sesiAdmin;

  await admin.from("services").insert([
    {
      id: SVC_EDIT,
      phase_id: "prekonsepsi",
      nama: "PAD-UJI Layanan Edit",
      deskripsi: "fixture",
    },
    {
      id: SVC_STATUS,
      phase_id: "menopause",
      nama: "PAD-UJI Layanan Status",
      deskripsi: "fixture",
    },
    {
      id: SVC_VARIAN_TUNGGAL,
      phase_id: "nifas",
      nama: "PAD-UJI Layanan Varian Tunggal",
      deskripsi: "fixture",
    },
  ]);
  await admin.from("packages").insert([
    { id: PAKET_EDIT, service_id: SVC_EDIT, nama: "PAD-UJI Paket Edit", jumlah_sesi: 4 },
    {
      id: PAKET_STATUS,
      service_id: SVC_STATUS,
      nama: "PAD-UJI Paket Status",
      jumlah_sesi: 2,
    },
  ]);

  // Trigger `trg_terbitkan_varian_baku` sudah menerbitkan satu varian BAKU
  // untuk SVC_EDIT & SVC_STATUS di atas — dicari di sini, bukan ditulis
  // sebagai konstanta, karena id-nya `gen_random_uuid()`.
  const { data: bakuEdit } = await admin
    .from("service_variants")
    .select("id")
    .eq("service_id", SVC_EDIT)
    .single();
  varianBakuEdit = bakuEdit!.id;
  const { data: bakuStatus } = await admin
    .from("service_variants")
    .select("id")
    .eq("service_id", SVC_STATUS)
    .single();
  varianBakuStatus = bakuStatus!.id;
  const { data: bakuTunggal } = await admin
    .from("service_variants")
    .select("id")
    .eq("service_id", SVC_VARIAN_TUNGGAL)
    .single();
  varianTunggal = bakuTunggal!.id;

  // SVC_STATUS memperoleh varian KEDUA di sini — SVC_EDIT sengaja dibiarkan
  // dengan satu varian saja (varian bakunya), supaya pagar "aktif terakhir"
  // punya sasaran yang jelas untuk masing-masing skenario.
  await admin.from("service_variants").insert({
    id: VARIAN_KEDUA_STATUS,
    service_id: SVC_STATUS,
    label: "PAD-UJI Varian Kedua",
    durasi_menit: 60,
    format: "private",
    urutan: 1,
  });

  // Klien KEDUA pada paket seed. Tanpa baris ini, hitungan `dipakai` untuk
  // admin dan untuk klien kebetulan sama (1) dan test RLS di bawah tidak
  // membuktikan apa pun. Klien uji sengaja BUKAN Ananda: beberapa berkas test
  // meng-assert jumlah baris Ananda secara persis.
  await admin.from("clients").insert({
    id: KLIEN_UJI,
    padma_id: PADMA_ID_UJI,
    nama: "PAD-UJI Klien Katalog",
    email: "uji-katalog@padma.test",
    phase_id: "prekonsepsi",
  });
  await admin.from("client_packages").insert({
    id: PAKET_KLIEN_UJI,
    client_id: KLIEN_UJI,
    package_id: PAKET_SEED,
    tanggal_mulai: "2027-04-05",
  });
});

afterAll(bersihkan);

beforeEach(() => {
  ref.sesi = sesiAdmin;
  jejak.revalidate.length = 0;
});

// ---------------------------------------------------------------------------
// Lapisan data
// ---------------------------------------------------------------------------

describe("daftarKatalogAdmin — katalog kelola, bukan katalog publik", () => {
  it("mengelompokkan layanan per fase menurut urutan fase", async () => {
    const katalog = await daftarKatalogAdmin();
    expect(katalog.map((f) => f.id)).toEqual([
      "prekonsepsi",
      "kehamilan",
      "nifas",
      "menopause",
      "newborn",
    ]);
    const prekonsepsi = katalog.find((f) => f.id === "prekonsepsi")!;
    expect(prekonsepsi.layanan.map((l) => l.id)).toContain(SVC_EDIT);
    expect(prekonsepsi.layanan.map((l) => l.id)).not.toContain(SVC_STATUS);
  });

  it("memuat layanan NONAKTIF juga (kelola ≠ pilih)", async () => {
    // Tanpa ini, satu klik salah menonaktifkan layanan selamanya dari panel:
    // tidak ada satu pun layar yang bisa menghidupkannya kembali.
    await admin.from("services").update({ aktif: false }).eq("id", SVC_STATUS);
    try {
      const katalog = await daftarKatalogAdmin();
      const layanan = katalog
        .flatMap((f) => f.layanan)
        .find((l) => l.id === SVC_STATUS);
      expect(layanan, "layanan nonaktif hilang dari halaman kelola").toBeDefined();
      expect(layanan!.aktif).toBe(false);
    } finally {
      await admin.from("services").update({ aktif: true }).eq("id", SVC_STATUS);
    }
  });

  it("menghitung sesi yang sudah tercatat pada tiap layanan", async () => {
    const { count } = await admin
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("service_id", SVC_SEED);
    expect(count).toBeGreaterThan(0);

    const katalog = await daftarKatalogAdmin();
    const layanan = katalog.flatMap((f) => f.layanan).find((l) => l.id === SVC_SEED)!;
    expect(layanan.sesiTercatat).toBe(count);
    expect(
      katalog.flatMap((f) => f.layanan).find((l) => l.id === SVC_EDIT)!.sesiTercatat,
    ).toBe(0);
  });
});

// GERBANG SAKLAR (K11, Task 2): `daftarKatalogAdmin()` memulangkan
// `paket: []` untuk SETIAP layanan begitu `PAKET_TAMPIL` mati — gerbangnya
// sendiri diuji tests/paket-tersembunyi.test.tsx. Ketiga uji di bawah bukan
// tentang tampilan, melainkan tentang PEMETAAN data paket per layanan
// (termasuk paket nonaktif), hitungan `dipakai`, dan isolasi RLS per klien —
// logika itu sengaja tidak dihapus, jadi saklarnya dinyalakan sementara di
// sini supaya pemetaannya tetap terbukti benar selama saklar produksi mati,
// pola yang sama dengan tests/passport-data.test.ts.
describe("daftarKatalogAdmin — data paket (saklar K11 dinyalakan sementara)", () => {
  let daftarKatalogAdminSementara: typeof daftarKatalogAdmin;

  beforeAll(async () => {
    vi.doMock("@/lib/paket-tampil", () => ({ PAKET_TAMPIL: true }));
    vi.resetModules();
    ({ daftarKatalogAdmin: daftarKatalogAdminSementara } = await import(
      "@/lib/admin/katalog-admin"
    ));
  });

  afterAll(() => {
    vi.doUnmock("@/lib/paket-tampil");
    vi.resetModules();
  });

  it("paket menempel pada layanannya, termasuk paket nonaktif", async () => {
    await admin.from("packages").update({ aktif: false }).eq("id", PAKET_STATUS);
    try {
      const katalog = await daftarKatalogAdminSementara();
      const layanan = katalog
        .flatMap((f) => f.layanan)
        .find((l) => l.id === SVC_STATUS)!;
      const paket = layanan.paket.find((p) => p.id === PAKET_STATUS);
      expect(paket).toBeDefined();
      expect(paket!.aktif).toBe(false);
      expect(paket!.jumlahSesi).toBe(2);
    } finally {
      await admin.from("packages").update({ aktif: true }).eq("id", PAKET_STATUS);
    }
  });

  it("menghitung berapa klien yang sedang memakai tiap paket", async () => {
    // Angka inilah yang membuat peringatan "mengubah jumlah sesi menggeser
    // progres" bukan sekadar kalimat: admin bisa melihat berapa passport yang
    // akan bergeser sebelum menekan simpan.
    const { count } = await admin
      .from("client_packages")
      .select("id", { count: "exact", head: true })
      .eq("package_id", PAKET_SEED);
    expect(count).toBeGreaterThan(1); // Ananda + klien uji

    const katalog = await daftarKatalogAdminSementara();
    const paket = katalog
      .flatMap((f) => f.layanan)
      .flatMap((l) => l.paket)
      .find((p) => p.id === PAKET_SEED)!;
    expect(paket.dipakai).toBe(count);

    const belumDipakai = katalog
      .flatMap((f) => f.layanan)
      .flatMap((l) => l.paket)
      .find((p) => p.id === PAKET_EDIT)!;
    expect(belumDipakai.dipakai).toBe(0);
  });

  it("dibaca lewat sesi pengguna: klien tidak melihat katalog kelola", async () => {
    // Bila lapisan ini memakai service role, angka & baris tetap keluar untuk
    // siapa pun dan RLS tidak pernah ikut diperiksa. `client_packages` adalah
    // pembeda paling tajam: dua klien memakai paket seed, tetapi seorang klien
    // hanya boleh melihat miliknya sendiri.
    ref.sesi = sesiAdmin;
    const untukAdmin = (await daftarKatalogAdminSementara())
      .flatMap((f) => f.layanan)
      .flatMap((l) => l.paket)
      .find((p) => p.id === PAKET_SEED)!;
    expect(untukAdmin.dipakai).toBeGreaterThanOrEqual(2);

    ref.sesi = sesiKlien;
    const untukKlien = (await daftarKatalogAdminSementara())
      .flatMap((f) => f.layanan)
      .flatMap((l) => l.paket)
      .find((p) => p.id === PAKET_SEED)!;
    expect(untukKlien.dipakai).toBe(1); // hanya paketnya sendiri
    ref.sesi = sesiAdmin;
  });
});

describe("daftarKatalogAdmin — varian menempel pada layanannya", () => {
  it("varian menempel pada layanannya, termasuk yang nonaktif", async () => {
    const katalog = await daftarKatalogAdmin();
    const layanan = katalog.flatMap((f) => f.layanan).find((l) => l.id === SVC_STATUS)!;
    const idVarian = layanan.varian.map((v) => v.id);
    expect(idVarian).toContain(varianBakuStatus);
    expect(idVarian).toContain(VARIAN_KEDUA_STATUS);
  });

  it("membawa label, durasi, format, urutan, dan status aktif apa adanya", async () => {
    const katalog = await daftarKatalogAdmin();
    const varian = katalog
      .flatMap((f) => f.layanan)
      .flatMap((l) => l.varian)
      .find((v) => v.id === VARIAN_KEDUA_STATUS)!;
    expect(varian).toMatchObject({
      label: "PAD-UJI Varian Kedua",
      durasiMenit: 60,
      format: "private",
      urutan: 1,
      aktif: true,
    });
  });

  it("menghitung berapa sesi yang memakai tiap varian", async () => {
    const { count } = await admin
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("variant_id", varianBakuEdit);
    // Varian baku SVC_EDIT belum pernah dipakai sesi mana pun.
    expect(count ?? 0).toBe(0);

    const katalog = await daftarKatalogAdmin();
    const varian = katalog
      .flatMap((f) => f.layanan)
      .flatMap((l) => l.varian)
      .find((v) => v.id === varianBakuEdit)!;
    expect(varian.sesiTercatat).toBe(count ?? 0);
  });
});

describe("pilihanLayanan — daftar PILIH menyaring aktif", () => {
  it("hanya memuat layanan aktif", async () => {
    await admin.from("services").update({ aktif: false }).eq("id", SVC_STATUS);
    try {
      const pilihan = await pilihanLayanan();
      expect(pilihan.map((l) => l.id)).not.toContain(SVC_STATUS);
      // Dan daftar yang aktif tetap ada — bukan daftar yang kebetulan kosong.
      expect(pilihan.map((l) => l.id)).toContain(SVC_EDIT);
    } finally {
      await admin.from("services").update({ aktif: true }).eq("id", SVC_STATUS);
    }
  });
});

// ---------------------------------------------------------------------------
// Server action: layanan
// ---------------------------------------------------------------------------

describe("simpanLayanan — mendaftarkan layanan baru", () => {
  it("membuat baris services baru yang langsung aktif", async () => {
    const hasil = await simpanLayanan(
      formulir({
        phase_id: "kehamilan",
        nama: "PAD-UJI Layanan Baru",
        deskripsi: "Deskripsi uji",
      }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;

    expect(await barisLayanan(hasil.id)).toMatchObject({
      phase_id: "kehamilan",
      nama: "PAD-UJI Layanan Baru",
      deskripsi: "Deskripsi uji",
      aktif: true,
    });
  });

  it("menolak fase yang tidak terdaftar tanpa menyentuh basis data", async () => {
    // Foreign key memang menolak `phase_id` yang tidak ada, tetapi pesannya
    // adalah kode Postgres — bukan kalimat yang boleh dibaca admin klinik.
    const { count: sebelum } = await admin
      .from("services")
      .select("id", { count: "exact", head: true });

    const hasil = await simpanLayanan(
      formulir({ phase_id: "fase-karangan", nama: "PAD-UJI Fase Palsu" }),
    );
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/fase/i);

    const { count: sesudah } = await admin
      .from("services")
      .select("id", { count: "exact", head: true });
    expect(sesudah).toBe(sebelum);
  });

  it("menolak nama terlalu pendek", async () => {
    const hasil = await simpanLayanan(formulir({ phase_id: "nifas", nama: "A" }));
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/nama/i);
  });

  it("nama & deskripsi dirapikan dari spasi berlebih", async () => {
    const hasil = await simpanLayanan(
      formulir({
        phase_id: "nifas",
        nama: "  PAD-UJI Layanan Spasi  ",
        deskripsi: "  rapi  ",
      }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    const baris = await barisLayanan(hasil.id);
    expect(baris!.nama).toBe("PAD-UJI Layanan Spasi");
    expect(baris!.deskripsi).toBe("rapi");
  });

  it("menyegarkan katalog publik & daftar pilihan sesudah berhasil", async () => {
    await simpanLayanan(
      formulir({ phase_id: "nifas", nama: "PAD-UJI Layanan Revalidate" }),
    );
    // Katalog landing dan wizard pengajuan klien membaca tabel yang sama —
    // layanan baru yang tidak merambat ke sana adalah layanan yang tidak ada.
    for (const p of ["/admin/layanan", "/", "/admin/sesi", "/passport/ajukan"]) {
      expect(jejak.revalidate, `lupa merevalidasi ${p}`).toContain(p);
    }
  });

  it("PENJAGA PERAN: klien yang login tidak bisa memanggil action ini", async () => {
    ref.sesi = sesiKlien;
    await expect(
      simpanLayanan(formulir({ phase_id: "nifas", nama: "PAD-UJI Dari Klien" })),
    ).rejects.toThrow(/REDIRECT/);

    const { data } = await admin
      .from("services")
      .select("id")
      .eq("nama", "PAD-UJI Dari Klien");
    expect(data ?? []).toHaveLength(0);
  });
});

describe("perbaruiLayanan — mengubah identitas, bukan keadaan", () => {
  it("mengubah nama, deskripsi, dan fase layanan", async () => {
    const hasil = await perbaruiLayanan(
      SVC_EDIT,
      formulir({
        phase_id: "kehamilan",
        nama: "PAD-UJI Layanan Edit Baru",
        deskripsi: "deskripsi baru",
      }),
    );
    expect(hasil.ok).toBe(true);
    expect(await barisLayanan(SVC_EDIT)).toMatchObject({
      phase_id: "kehamilan",
      nama: "PAD-UJI Layanan Edit Baru",
      deskripsi: "deskripsi baru",
    });

    // Dikembalikan supaya test pengelompokan fase di atas tetap bermakna.
    await admin.from("services").update({ phase_id: "prekonsepsi" }).eq("id", SVC_EDIT);
  });

  it("status aktif TIDAK ikut berubah walau diselundupkan di FormData", async () => {
    await perbaruiLayanan(
      SVC_EDIT,
      formulir({
        phase_id: "prekonsepsi",
        nama: "PAD-UJI Layanan Edit Baru",
        aktif: "false",
      }),
    );
    expect((await barisLayanan(SVC_EDIT))!.aktif).toBe(true);
  });

  it("id yang tidak ada menghasilkan penolakan, bukan 'ok' palsu", async () => {
    // UPDATE yang tidak mengenai baris mana pun dijawab PostgREST 200 + [].
    const hasil = await perbaruiLayanan(
      TAK_ADA_SVC,
      formulir({ phase_id: "prekonsepsi", nama: "PAD-UJI Hantu" }),
    );
    expect(hasil.ok).toBe(false);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa memanggil action ini", async () => {
    ref.sesi = sesiKlien;
    await expect(
      perbaruiLayanan(
        SVC_EDIT,
        formulir({ phase_id: "prekonsepsi", nama: "PAD-UJI Direbut Klien" }),
      ),
    ).rejects.toThrow(/REDIRECT/);
    expect((await barisLayanan(SVC_EDIT))!.nama).toBe("PAD-UJI Layanan Edit Baru");
  });
});

describe("aktifkanLayanan & nonaktifkanLayanan", () => {
  it("nonaktifkanLayanan menyetel aktif = false", async () => {
    expect((await nonaktifkanLayanan(SVC_STATUS)).ok).toBe(true);
    expect((await barisLayanan(SVC_STATUS))!.aktif).toBe(false);
    expect(jejak.revalidate).toContain("/admin/layanan");
  });

  it("aktifkanLayanan menyetel aktif = true kembali", async () => {
    expect((await aktifkanLayanan(SVC_STATUS)).ok).toBe(true);
    expect((await barisLayanan(SVC_STATUS))!.aktif).toBe(true);
  });

  it("id yang tidak ada ditolak, bukan 'ok' palsu", async () => {
    expect((await nonaktifkanLayanan(TAK_ADA_SVC)).ok).toBe(false);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa menonaktifkan layanan", async () => {
    ref.sesi = sesiKlien;
    await expect(nonaktifkanLayanan(SVC_STATUS)).rejects.toThrow(/REDIRECT/);
    expect((await barisLayanan(SVC_STATUS))!.aktif).toBe(true);
  });

  it("keadaan tujuan HARDCODED di dalam action, tidak pernah jadi parameter", () => {
    expect(sumberAksi).toMatch(/aktif:\s*true/);
    expect(sumberAksi).toMatch(/aktif:\s*false/);
    for (const pola of [
      /function\s+\w+\([^)]*aktif\s*:/,
      /function\s+\w+\([^)]*status\s*:/,
    ]) {
      expect(sumberAksi).not.toMatch(pola);
    }
  });
});

// ---------------------------------------------------------------------------
// PAGAR UTAMA: nonaktif ≠ hilang dari riwayat klien
// ---------------------------------------------------------------------------

describe("menonaktifkan layanan TIDAK menghapus namanya dari riwayat klien", () => {
  afterAll(async () => {
    await admin.from("services").update({ aktif: true }).eq("id", SVC_SEED);
  });

  it("riwayat sesi klien tetap menyebut nama layanan setelah dinonaktifkan", async () => {
    ref.sesi = sesiAdmin;
    expect((await nonaktifkanLayanan(SVC_SEED)).ok).toBe(true);
    expect((await barisLayanan(SVC_SEED))!.aktif).toBe(false);

    // Jalur yang benar-benar dipakai halaman passport klien.
    ref.sesi = sesiKlien;
    const sesi = await ambilSesi(ANANDA);
    const milikSeed = sesi.filter((s) => s.serviceId === SVC_SEED);
    expect(milikSeed.length).toBeGreaterThan(0);
    for (const s of milikSeed) {
      expect(s.namaLayanan).toBe(NAMA_SVC_SEED);
    }
    // "Layanan" adalah teks cadangan saat nama gagal terbaca — ia tidak boleh
    // muncul hanya karena layanannya sedang dipensiunkan.
    expect(sesi.map((s) => s.namaLayanan)).not.toContain("Layanan");
  });

  it("klien TETAP bisa membaca baris layanan nonaktif lewat REST", async () => {
    // Inilah pagar yang dilanggar bila seseorang menambahkan `aktif` ke policy
    // "services: baca" atau melahirkan view penyaring. Filter `aktif` hidup di
    // policy TERPISAH yang menyasar `anon` — dan hanya di sana.
    const { data, error } = await sesiKlien
      .from("services")
      .select("id, nama")
      .eq("id", SVC_SEED);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].nama).toBe(NAMA_SVC_SEED);
  });

  it("layanan nonaktif hilang dari katalog PUBLIK (anon)", async () => {
    const { data } = await anonClient().from("services").select("id");
    expect(data!.map((s) => s.id)).not.toContain(SVC_SEED);

    const katalog = await bacaKatalog();
    // `f.layanan` sejak Task 8 berisi OBJEK ({id, nama, varian}), bukan
    // string — `not.toContain(NAMA_SVC_SEED)` atas array objek tidak pernah
    // gagal (perbandingan referensi objek vs string selalu false), sehingga
    // assertion ini VAKUM tanpa `.map((l) => l.nama)` di bawah.
    expect(katalog.flatMap((f) => f.layanan).map((l) => l.nama)).not.toContain(NAMA_SVC_SEED);
  });

  it("layanan nonaktif TIDAK ditawarkan saat menjadwalkan sesi baru", async () => {
    ref.sesi = sesiAdmin;
    const pilihan = await pilihanLayanan();
    expect(pilihan.map((l) => l.id)).not.toContain(SVC_SEED);
  });

  it("setelah diaktifkan lagi, layanan kembali muncul di katalog publik", async () => {
    ref.sesi = sesiAdmin;
    expect((await aktifkanLayanan(SVC_SEED)).ok).toBe(true);
    const { data } = await anonClient().from("services").select("id");
    expect(data!.map((s) => s.id)).toContain(SVC_SEED);
  });
});

// ---------------------------------------------------------------------------
// Server action: paket
// ---------------------------------------------------------------------------

describe("simpanPaket — paket baru menempel pada layanannya", () => {
  it("membuat baris packages baru yang langsung aktif", async () => {
    const hasil = await simpanPaket(
      formulir({ service_id: SVC_EDIT, nama: "PAD-UJI Paket Baru", jumlah_sesi: "6" }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;

    expect(await barisPaket(hasil.id)).toMatchObject({
      service_id: SVC_EDIT,
      nama: "PAD-UJI Paket Baru",
      jumlah_sesi: 6,
      aktif: true,
    });
  });

  it("menolak jumlah sesi nol, negatif, dan bukan angka dengan pesan manusia", async () => {
    // `packages_jumlah_sesi_check` di basis data memang menolak <= 0, tetapi
    // yang sampai ke layar admin adalah kode 23514 — bukan kalimat.
    for (const nilai of ["0", "-3", "abc", "", "2.5"]) {
      const hasil = await simpanPaket(
        formulir({ service_id: SVC_EDIT, nama: "PAD-UJI Paket Salah", jumlah_sesi: nilai }),
      );
      expect(hasil.ok, `jumlah_sesi="${nilai}" seharusnya ditolak`).toBe(false);
      if (hasil.ok) continue;
      expect(hasil.pesan).toMatch(/sesi/i);
    }
    const { data } = await admin
      .from("packages")
      .select("id")
      .eq("nama", "PAD-UJI Paket Salah");
    expect(data ?? []).toHaveLength(0);
  });

  it("menolak layanan yang tidak ada", async () => {
    const hasil = await simpanPaket(
      formulir({ service_id: TAK_ADA_SVC, nama: "PAD-UJI Paket Yatim", jumlah_sesi: "3" }),
    );
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/layanan/i);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa memanggil action ini", async () => {
    ref.sesi = sesiKlien;
    await expect(
      simpanPaket(
        formulir({ service_id: SVC_EDIT, nama: "PAD-UJI Paket Klien", jumlah_sesi: "2" }),
      ),
    ).rejects.toThrow(/REDIRECT/);
  });
});

describe("perbaruiPaket — nama & jumlah sesi, tidak pernah pindah layanan", () => {
  it("mengubah nama dan jumlah sesi", async () => {
    const hasil = await perbaruiPaket(
      PAKET_EDIT,
      formulir({ nama: "PAD-UJI Paket Edit Baru", jumlah_sesi: "10" }),
    );
    expect(hasil.ok).toBe(true);
    expect(await barisPaket(PAKET_EDIT)).toMatchObject({
      nama: "PAD-UJI Paket Edit Baru",
      jumlah_sesi: 10,
    });
  });

  it("service_id yang diselundupkan di FormData DIABAIKAN", async () => {
    // Memindahkan paket ke layanan lain akan diam-diam mengubah arti setiap
    // baris `client_packages` yang sudah menunjuk paket ini — progres passport
    // orang lain berpindah layanan tanpa satu pun error.
    await perbaruiPaket(
      PAKET_EDIT,
      formulir({
        nama: "PAD-UJI Paket Edit Baru",
        jumlah_sesi: "10",
        service_id: SVC_STATUS,
      }),
    );
    expect((await barisPaket(PAKET_EDIT))!.service_id).toBe(SVC_EDIT);
  });

  it("menolak jumlah sesi tidak sah tanpa menimpa nilai lama", async () => {
    const hasil = await perbaruiPaket(
      PAKET_EDIT,
      formulir({ nama: "PAD-UJI Paket Edit Baru", jumlah_sesi: "0" }),
    );
    expect(hasil.ok).toBe(false);
    expect((await barisPaket(PAKET_EDIT))!.jumlah_sesi).toBe(10);
  });

  it("id yang tidak ada ditolak, bukan 'ok' palsu", async () => {
    const hasil = await perbaruiPaket(
      TAK_ADA_PAKET,
      formulir({ nama: "PAD-UJI Hantu", jumlah_sesi: "3" }),
    );
    expect(hasil.ok).toBe(false);
  });
});

describe("aktifkanPaket & nonaktifkanPaket", () => {
  it("nonaktifkanPaket menyetel aktif = false, aktifkanPaket mengembalikannya", async () => {
    expect((await nonaktifkanPaket(PAKET_STATUS)).ok).toBe(true);
    expect((await barisPaket(PAKET_STATUS))!.aktif).toBe(false);
    expect((await aktifkanPaket(PAKET_STATUS)).ok).toBe(true);
    expect((await barisPaket(PAKET_STATUS))!.aktif).toBe(true);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa menonaktifkan paket", async () => {
    ref.sesi = sesiKlien;
    await expect(nonaktifkanPaket(PAKET_STATUS)).rejects.toThrow(/REDIRECT/);
    expect((await barisPaket(PAKET_STATUS))!.aktif).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Server action: varian
// ---------------------------------------------------------------------------

describe("buatVarian — mendaftarkan varian baru pada sebuah layanan", () => {
  it("membuat baris service_variants baru yang langsung aktif", async () => {
    const hasil = await buatVarian(
      formulir({
        service_id: SVC_EDIT,
        label: "PAD-UJI Varian Baru",
        durasi_menit: "90",
        format: "private",
        urutan: "2",
      }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;

    expect(await barisVarian(hasil.id)).toMatchObject({
      service_id: SVC_EDIT,
      label: "PAD-UJI Varian Baru",
      durasi_menit: 90,
      format: "private",
      urutan: 2,
      aktif: true,
    });
  });

  it("label, durasi, dan format BOLEH dikosongkan (varian tanpa dimensi)", async () => {
    const hasil = await buatVarian(
      formulir({ service_id: SVC_EDIT, label: "", durasi_menit: "", format: "" }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    expect(await barisVarian(hasil.id)).toMatchObject({
      label: "",
      durasi_menit: null,
      format: null,
      urutan: 0, // urutan kosong jatuh ke 0, sama dengan default kolomnya
    });
  });

  it("menolak durasi yang bukan angka bulat positif", async () => {
    for (const nilai of ["0", "-5", "abc", "2.5"]) {
      const hasil = await buatVarian(
        formulir({ service_id: SVC_EDIT, label: "PAD-UJI Durasi Salah", durasi_menit: nilai }),
      );
      expect(hasil.ok, `durasi_menit="${nilai}" seharusnya ditolak`).toBe(false);
      if (hasil.ok) continue;
      expect(hasil.pesan).toMatch(/durasi/i);
    }
    const { data } = await admin
      .from("service_variants")
      .select("id")
      .eq("label", "PAD-UJI Durasi Salah");
    expect(data ?? []).toHaveLength(0);
  });

  it("menolak format selain private/circle", async () => {
    const hasil = await buatVarian(
      formulir({ service_id: SVC_EDIT, label: "PAD-UJI Format Salah", format: "grup" }),
    );
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/format/i);
  });

  it("menolak layanan yang tidak ada", async () => {
    const hasil = await buatVarian(formulir({ service_id: TAK_ADA_SVC, label: "PAD-UJI Yatim" }));
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/layanan/i);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa memanggil action ini", async () => {
    ref.sesi = sesiKlien;
    await expect(
      buatVarian(formulir({ service_id: SVC_EDIT, label: "PAD-UJI Dari Klien" })),
    ).rejects.toThrow(/REDIRECT/);
    const { data } = await admin
      .from("service_variants")
      .select("id")
      .eq("label", "PAD-UJI Dari Klien");
    expect(data ?? []).toHaveLength(0);
  });
});

describe("perbaruiVarian — label/durasi/format/urutan, tidak pernah pindah layanan", () => {
  it("mengubah label, durasi, format, dan urutan", async () => {
    const hasil = await perbaruiVarian(
      formulir({
        varian: VARIAN_KEDUA_STATUS,
        label: "PAD-UJI Varian Kedua Ubah",
        durasi_menit: "120",
        format: "circle",
        urutan: "3",
      }),
    );
    expect(hasil.ok).toBe(true);
    expect(await barisVarian(VARIAN_KEDUA_STATUS)).toMatchObject({
      label: "PAD-UJI Varian Kedua Ubah",
      durasi_menit: 120,
      format: "circle",
      urutan: 3,
    });

    // Dikembalikan supaya fixture tetap seperti semula untuk test lain.
    await admin
      .from("service_variants")
      .update({ label: "PAD-UJI Varian Kedua", durasi_menit: 60, format: "private", urutan: 1 })
      .eq("id", VARIAN_KEDUA_STATUS);
  });

  it("service_id yang diselundupkan di FormData DIABAIKAN — tidak pernah pindah layanan", async () => {
    // Setiap sesi yang menunjuk varian ini akan ikut berganti arti tanpa satu
    // pun error — pelajaran yang sama dengan perbaruiPaket.
    await perbaruiVarian(
      formulir({
        varian: varianBakuEdit,
        service_id: SVC_STATUS,
        label: "PAD-UJI Tidak Pindah",
      }),
    );
    const baris = await barisVarian(varianBakuEdit);
    expect(baris!.service_id).toBe(SVC_EDIT);
    expect(baris!.label).toBe("PAD-UJI Tidak Pindah");

    // Dikembalikan ke label baku supaya test lain yang bergantung padanya
    // (mis. pagar "varian aktif terakhir") tidak ikut terpengaruh nama.
    await admin
      .from("service_variants")
      .update({ label: "" })
      .eq("id", varianBakuEdit);
  });

  it("menolak durasi/format tidak sah tanpa menimpa nilai lama", async () => {
    const hasil = await perbaruiVarian(
      formulir({ varian: VARIAN_KEDUA_STATUS, label: "PAD-UJI Varian Kedua", format: "grup" }),
    );
    expect(hasil.ok).toBe(false);
    expect((await barisVarian(VARIAN_KEDUA_STATUS))!.format).toBe("private");
  });

  it("id yang tidak ada ditolak, bukan 'ok' palsu", async () => {
    const hasil = await perbaruiVarian(
      formulir({ varian: TAK_ADA_VARIAN, label: "PAD-UJI Hantu" }),
    );
    expect(hasil.ok).toBe(false);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa memanggil action ini", async () => {
    ref.sesi = sesiKlien;
    await expect(
      perbaruiVarian(formulir({ varian: VARIAN_KEDUA_STATUS, label: "PAD-UJI Direbut Klien" })),
    ).rejects.toThrow(/REDIRECT/);
    ref.sesi = sesiAdmin;
    expect((await barisVarian(VARIAN_KEDUA_STATUS))!.label).toBe("PAD-UJI Varian Kedua");
  });
});

// ---------------------------------------------------------------------------
// PAGAR: layanan tidak boleh kehilangan varian AKTIF TERAKHIRnya
// ---------------------------------------------------------------------------

describe("aktifkanVarian & nonaktifkanVarian — pagar varian aktif terakhir", () => {
  it("menolak menonaktifkan varian aktif TERAKHIR sebuah layanan", async () => {
    // SVC_VARIAN_TUNGGAL hanya punya SATU varian (bakunya sendiri): layanan
    // tanpa varian aktif membuat setiap perhitungan harga bercabang dua
    // selamanya, dan cabang keduanya hanya muncul di produksi.
    const hasil = await nonaktifkanVarian(formulir({ varian: varianTunggal }));
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/varian terakhir/i);
    expect((await barisVarian(varianTunggal))!.aktif).toBe(true);
  });

  it("membolehkan menonaktifkan varian bila masih ada varian aktif lain", async () => {
    // SVC_STATUS punya DUA varian aktif (baku + VARIAN_KEDUA_STATUS):
    // menonaktifkan salah satunya menyisakan yang lain tetap aktif.
    const hasil = await nonaktifkanVarian(formulir({ varian: VARIAN_KEDUA_STATUS }));
    expect(hasil.ok).toBe(true);
    expect((await barisVarian(VARIAN_KEDUA_STATUS))!.aktif).toBe(false);
    expect((await barisVarian(varianBakuStatus))!.aktif).toBe(true);
    expect(jejak.revalidate).toContain("/admin/layanan");
  });

  it("aktifkanVarian menyalakannya kembali", async () => {
    expect((await aktifkanVarian(formulir({ varian: VARIAN_KEDUA_STATUS }))).ok).toBe(true);
    expect((await barisVarian(VARIAN_KEDUA_STATUS))!.aktif).toBe(true);
  });

  it("id yang tidak ada ditolak, bukan 'ok' palsu", async () => {
    expect((await nonaktifkanVarian(formulir({ varian: TAK_ADA_VARIAN }))).ok).toBe(false);
    expect((await aktifkanVarian(formulir({ varian: TAK_ADA_VARIAN }))).ok).toBe(false);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa mengubah status varian", async () => {
    ref.sesi = sesiKlien;
    await expect(
      nonaktifkanVarian(formulir({ varian: VARIAN_KEDUA_STATUS })),
    ).rejects.toThrow(/REDIRECT/);
    await expect(
      aktifkanVarian(formulir({ varian: VARIAN_KEDUA_STATUS })),
    ).rejects.toThrow(/REDIRECT/);
    ref.sesi = sesiAdmin;
    expect((await barisVarian(VARIAN_KEDUA_STATUS))!.aktif).toBe(true);
  });

  it("keadaan tujuan HARDCODED di dalam action, tidak pernah jadi parameter", () => {
    for (const pola of [
      /function\s+\w*[Vv]arian\w*\([^)]*aktif\s*:/,
      /function\s+\w*[Vv]arian\w*\([^)]*status\s*:/,
    ]) {
      expect(sumberAksi).not.toMatch(pola);
    }
  });
});

// ---------------------------------------------------------------------------
// PAGAR: jumlah_sesi menggeser progres passport yang sedang berjalan
// ---------------------------------------------------------------------------

describe("mengubah jumlah_sesi menggeser progres passport klien yang berjalan", () => {
  // Saklar K11 (PAKET_TAMPIL, Task 1) membuat `ambilPaket()` top-level di
  // berkas ini (baris 125) memulangkan [] — gerbangnya sendiri sudah diuji di
  // tests/paket-tersembunyi.test.tsx. Test di bawah bukan tentang TAMPILAN,
  // melainkan tentang PENYUSUTAN PENYEBUT (`progresPaket`) yang menggeser
  // progres berjalan begitu admin memperkecil `jumlah_sesi` — logika itu
  // sengaja tidak dihapus, jadi saklarnya dinyalakan sementara di sini
  // supaya `ambilPaket()` betul-betul membaca baris yang diubah
  // `perbaruiPaket()`, pola yang sama dengan tests/passport-data.test.ts.
  let ambilPaketSementara: typeof import("@/lib/passport/data").ambilPaket;

  beforeAll(async () => {
    vi.doMock("@/lib/paket-tampil", () => ({ PAKET_TAMPIL: true }));
    vi.resetModules();
    ({ ambilPaket: ambilPaketSementara } = await import("@/lib/passport/data"));
  });

  afterAll(async () => {
    vi.doUnmock("@/lib/paket-tampil");
    vi.resetModules();
    await admin
      .from("packages")
      .update({ jumlah_sesi: JUMLAH_SESI_SEED })
      .eq("id", PAKET_SEED);
  });

  it("penyebut progres klien ikut berubah — dan persen tetap dicap 100", async () => {
    ref.sesi = sesiKlien;
    const sesi = await ambilSesi(ANANDA);
    const paketAwal = (await ambilPaketSementara(ANANDA)).find((p) => p.jumlahSesi > 0)!;
    expect(paketAwal.jumlahSesi).toBe(JUMLAH_SESI_SEED);

    const awal = progresPaket({ totalSesi: paketAwal.jumlahSesi, sesi })!;
    expect(awal.total).toBe(JUMLAH_SESI_SEED);
    expect(awal.selesai).toBeGreaterThan(3);
    expect(awal.persen).toBeLessThan(100);

    // Admin memperkecil paket lewat jalur yang sungguh dipakai panel.
    ref.sesi = sesiAdmin;
    expect(
      (await perbaruiPaket(
        PAKET_SEED,
        formulir({ nama: "Sankalpa Prima", jumlah_sesi: "3" }),
      )).ok,
    ).toBe(true);

    ref.sesi = sesiKlien;
    const paketBaru = (await ambilPaketSementara(ANANDA))[0];
    expect(paketBaru.jumlahSesi).toBe(3);

    const sesudah = progresPaket({ totalSesi: paketBaru.jumlahSesi, sesi })!;
    // Penyebut menyusut retroaktif: sesi selesai lebih banyak dari total.
    expect(sesudah.selesai).toBeGreaterThan(sesudah.total);
    // Cap 100% adalah yang menjaga angka tetap jujur — tanpa itu passport
    // klien menampilkan "200%".
    expect(sesudah.persen).toBe(100);
  });

  it("merevalidasi passport klien, bukan hanya halaman admin", async () => {
    ref.sesi = sesiAdmin;
    jejak.revalidate.length = 0;
    await perbaruiPaket(
      PAKET_SEED,
      formulir({ nama: "Sankalpa Prima", jumlah_sesi: "8" }),
    );
    for (const p of ["/admin/layanan", "/passport", "/passport/bayar", "/admin/bayar"]) {
      expect(jejak.revalidate, `lupa merevalidasi ${p}`).toContain(p);
    }
  });
});

// ---------------------------------------------------------------------------
// PAGAR: tidak ada penghapusan
// ---------------------------------------------------------------------------

describe("penghapusan tidak tersedia — dan modul ini tidak menawarkannya", () => {
  it("admin yang login TETAP ditolak 42501 saat menghapus layanan & paket", async () => {
    // Inilah alasan tombol Hapus tidak boleh lahir: jawabannya bukan
    // "0 baris", melainkan kode Postgres di layar admin klinik.
    const { error: ePaket } = await sesiAdmin
      .from("packages")
      .delete()
      .eq("id", PAKET_EDIT);
    expect(ePaket?.code).toBe("42501");
    expect(await barisPaket(PAKET_EDIT)).not.toBeNull();

    const { error: eLayanan } = await sesiAdmin
      .from("services")
      .delete()
      .eq("id", SVC_EDIT);
    expect(eLayanan?.code).toBe("42501");
    expect(await barisLayanan(SVC_EDIT)).not.toBeNull();

    const { error: eVarian } = await sesiAdmin
      .from("service_variants")
      .delete()
      .eq("id", varianBakuEdit);
    expect(eVarian?.code).toBe("42501");
    expect(await barisVarian(varianBakuEdit)).not.toBeNull();
  });

  it("tidak ada satu pun .delete() di seluruh berkas modul", () => {
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toContain(".delete(");
    }
  });

  it("tidak ada tombol/label Hapus di UI modul", () => {
    for (const sumber of [sumberHalaman, sumberForm, sumberFormVarian]) {
      expect(sumber).not.toMatch(/>\s*Hapus/);
    }
  });

  it("modul TIDAK melahirkan view penyaring aktif untuk layanan", () => {
    // Bug `partner_publik` yang sudah dibayar: view yang menyaring `aktif`
    // menghapus nama dari riwayat SELURUH klien. Nama view apa pun yang
    // berbau "layanan publik" adalah tanda bug itu sedang diulang.
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toContain("layanan_publik");
      expect(sumber).not.toContain("service_publik");
    }
  });
});

// ---------------------------------------------------------------------------
// Halaman /admin/layanan
// ---------------------------------------------------------------------------

describe("halaman katalog layanan (/admin/layanan)", () => {
  let markup = "";

  beforeAll(async () => {
    ref.sesi = sesiAdmin;
    await admin.from("services").update({ aktif: false }).eq("id", SVC_STATUS);
    markup = renderToStaticMarkup(await LayananPage());
  });

  afterAll(async () => {
    await admin.from("services").update({ aktif: true }).eq("id", SVC_STATUS);
  });

  it("mengelompokkan layanan di bawah judul fasenya (seperti prototipe)", () => {
    for (const fase of ["Prekonsepsi", "Kehamilan", "Nifas", "Menopause", "Newborn"]) {
      expect(markup).toContain(fase);
    }
  });

  it("menampilkan layanan aktif maupun nonaktif", () => {
    expect(markup).toContain("PAD-UJI Layanan Edit Baru");
    expect(markup).toContain("PAD-UJI Layanan Status");
    expect(markup).toMatch(/>Aktif</);
    expect(markup).toMatch(/>Nonaktif</);
  });

  it("menawarkan jalan MENGAKTIFKAN kembali layanan yang nonaktif", () => {
    expect(markup).toContain("Aktifkan");
  });

  it("tidak lagi menampilkan sublist paket — gerbang K11 (Task 2)", () => {
    // Sebelum gerbang: baris ini menegaskan "PAD-UJI Paket Edit Baru" dan
    // "10 sesi" tampil di bawah layanannya. Dengan `PAKET_TAMPIL = false`,
    // `daftarKatalogAdmin()` memulangkan `layanan.paket: []` untuk SETIAP
    // layanan (lihat tests/paket-tersembunyi.test.tsx), jadi apa pun bentuk
    // markup-nya, nama & jumlah sesi paket itu sendiri sudah tidak bisa lagi
    // muncul di layar.
    expect(markup).not.toContain("PAD-UJI Paket Edit Baru");
  });

  it("menampilkan varian di bawah layanannya, termasuk yang nonaktif", () => {
    expect(markup).toContain("PAD-UJI Varian Kedua");
    // Varian baku (label kosong) jatuh ke teks penjelas, bukan string kosong
    // yang membuat baris terlihat rusak.
    expect(markup).toMatch(/Varian baku/i);
  });

  it("menawarkan jalan menambah varian baru per layanan", () => {
    expect(markup).toContain("+ Varian");
    expect(sumberFormVarian).toContain('name="label"');
    expect(sumberFormVarian).toContain('name="durasi_menit"');
    expect(sumberFormVarian).toContain('name="format"');
    expect(sumberFormVarian).toContain('name="urutan"');
  });

  it("memperingatkan bahwa mengubah jumlah sesi menggeser progres berjalan", () => {
    const teks = markup + sumberForm;
    expect(teks).toMatch(/progres/i);
    expect(teks).toMatch(/jumlah sesi/i);
  });

  it("menyediakan jalan menambah layanan & paket baru", () => {
    expect(markup).toContain("Layanan baru");
    expect(sumberForm).toContain('name="phase_id"');
    expect(sumberForm).toContain('name="nama"');
    expect(sumberForm).toContain('name="jumlah_sesi"');
  });

  it("menjelaskan bahwa pensiun berarti nonaktif, bukan hapus", () => {
    expect(markup).toMatch(/nonaktif/i);
    expect(markup).toMatch(/riwayat/i);
  });

  it("dijaga requireRole admin+owner di halamannya sendiri", () => {
    expect(sumberHalaman).toMatch(
      /await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/,
    );
  });

  it("judul mengandalkan template layout (tanpa menempel PADMA sendiri)", () => {
    // Sejak Task 3 (saklar K11), judulnya BUKAN string tunggal lagi — ia
    // bergantung pada `PAKET_TAMPIL` ("Layanan & Paket" saat menyala,
    // "Layanan" saat mati, lihat src/lib/paket-tampil.ts) — jadi asersi ini
    // dilonggarkan dari kecocokan string PERSIS ke baris `metadata`
    // seutuhnya: apa pun cabang yang aktif, judulnya wajib memuat "Layanan"
    // dan TIDAK PERNAH menempelkan "PADMA" sendiri (itu tugas template layout).
    const baris = sumberHalaman.match(/export const metadata = \{[^}]*\};/)?.[0] ?? "";
    expect(baris).toContain("Layanan");
    expect(baris).not.toContain("PADMA");
  });

  it("TIDAK ada nominal uang di modul layanan (money firewall)", () => {
    // Harga layanan hidup di `variant_rates` (dulu `service_rates`, dijatuhkan
    // Task 5), wilayah owner. Modul ini mengelola katalognya, bukan angkanya.
    expect(markup).not.toMatch(/Rp\s?\d/);
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toMatch(/Rp\s?\d/);
      expect(sumber).not.toContain("service_rates");
      expect(sumber).not.toContain("variant_rates");
      expect(sumber).not.toContain("honor_marks");
      expect(sumber).not.toContain("honor_mitra");
    }
  });
});

// ---------------------------------------------------------------------------
// Bentuk berkas server action
// ---------------------------------------------------------------------------

describe("berkas server action layanan", () => {
  it('diawali "use server"', () => {
    expect(sumberAksi.trimStart().startsWith('"use server"')).toBe(true);
  });

  it("hanya mengekspor fungsi async (syarat Next)", () => {
    const ekspor = [...sumberAksi.matchAll(/^export\s+(?!type\b)(\w+)/gm)].map((m) => m[1]);
    expect(ekspor.length).toBeGreaterThan(0);
    expect([...new Set(ekspor)]).toEqual(["async"]);
  });

  it("SETIAP action memanggil requireRole(['admin','owner']) di dalam dirinya", () => {
    const jumlahAction = [
      ...sumberAksi.matchAll(/^export\s+async\s+function\s+\w+/gm),
    ].length;
    const jumlahGuard = [
      ...sumberAksi.matchAll(/await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/g),
    ].length;
    // simpan/perbarui/aktifkan/nonaktifkan × (layanan, paket) = 8, ditambah
    // buat/perbarui/aktifkan/nonaktifkan × varian = 4 → 12.
    expect(jumlahAction).toBe(12);
    expect(jumlahGuard).toBe(jumlahAction);
  });

  it("memakai sesi pengguna, bukan service role", () => {
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toContain("createAdminSupabase");
      expect(sumber).not.toContain("SERVICE_ROLE");
    }
    expect(sumberAksi).toContain("createServerSupabase");
    expect(sumberLib).toContain("createServerSupabase");
  });

  it("pencocokan identitas memakai operator setara, tidak pernah pola", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberLib]) {
      expect(sumber).not.toContain(".ilike(");
      expect(sumber).not.toContain(".like(");
    }
  });

  it("tidak menuliskan data katalog ke log", () => {
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toContain("console.");
    }
  });

  it("daftar putih & batas tinggal di status.ts, bukan di berkas action", () => {
    expect(sumberStatus).not.toContain('"use server"');
    expect(sumberAksi).toMatch(/from\s+["']\.\/status["']/);
  });

  it("layout admin TIDAK ikut diubah (matriks peran tetap satu panggilan)", () => {
    const layout = baca("src/app/admin/layout.tsx");
    expect([...layout.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(baca("src/app/admin/page.tsx")).toContain('href="/admin/skrining"');
  });

  it("navigasi admin menautkan modul ini", () => {
    expect(baca("src/app/admin/_shell/nav-admin.tsx")).toContain('href: "/admin/layanan"');
  });
});
