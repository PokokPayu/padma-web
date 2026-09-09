/**
 * Modul Sesi — antrean permintaan jadwal & konfirmasinya.
 *
 * Ini titik tempat DUA tulisan harus berlaku sebagai satu keputusan:
 * `booking_requests.status` menjadi 'dikonfirmasi', dan satu baris `sessions`
 * lahir. Empat cara keputusan itu pernah — atau gampang sekali — pecah:
 *
 *  1. KONFIRMASI GANDA. Dua admin menekan tombol yang sama dalam detik yang
 *     sama: tanpa klaim status yang menyerialkan dan tanpa index unik pada
 *     `sessions.booking_request_id`, lahir DUA sesi untuk satu permintaan.
 *     Klien kedatangan bidan dua kali dan tidak ada error apa pun. Test
 *     balapan di bawah adalah alasan utama berkas ini ada.
 *
 *  2. IDENTITAS KLIEN DATANG DARI FORM. `client_id`/`service_id` sesi HARUS
 *     dibaca dari baris permintaan, bukan dari payload pemanggil — server
 *     action adalah endpoint POST tersendiri yang bisa dipanggil tanpa UI.
 *
 *  3. STATUS TUJUAN MENJADI PARAMETER. Bentuk celah "klien menyetujui
 *     permintaan jadwalnya sendiri" tembus persis karena itu. Karena itu ada
 *     DUA action terpisah dengan status tertulis mati di dalamnya, dan tanda
 *     tangannya diuji.
 *
 *  4. SESI YATIM. Bila sesi dibuat lebih dulu lalu klaim gagal, tertinggal sesi
 *     yang tidak berasal dari permintaan mana pun — dan permintaannya tetap di
 *     antrean, menunggu dikonfirmasi untuk kedua kalinya.
 *
 * Data uji memakai tanggal khusus (2026-12-26) + mitra ber-prefix `PAD-UJI` dan
 * dibersihkan di `afterAll`: `passport-beranda.test.ts` meng-assert jumlah
 * stempel Ananda PERSIS, jadi tidak boleh ada sesi sisa yang menempel padanya.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { skriningHijau } from "./helpers/skrining";
import { nominalDalam } from "./helpers/nominal";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const KLIEN = "44444444-4444-4444-4444-444444444401"; // Ananda
const SVC = "11111111-1111-1111-1111-111111111101"; // Fertility Massage
const MITRA = "33333333-3333-3333-3333-333333333301"; // Bidan Sri Wahyuni
const MITRA_NONAKTIF = "33333333-3333-3333-3333-3333333333e1";
const TGL = "2026-12-26";
const HANTU = "00000000-0000-0000-0000-000000000000";

let permintaanId = "";

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

// `redirect()` melempar di dalam request Next. Di test ia dijadikan error yang
// bisa dibaca supaya "penjaga peran hilang" menjadi MERAH, bukan senyap.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/admin/sesi",
}));

const { konfirmasiPermintaan, tolakPermintaan } = await import("@/app/admin/sesi/aksi");
const { LABEL_WAKTU, LABEL_STATUS_PERMINTAAN } = await import("@/app/admin/sesi/status");
const { default: SesiPage } = await import("@/app/admin/sesi/page");

const sumberAksi = baca("src/app/admin/sesi/aksi.ts");
const sumberStatus = baca("src/app/admin/sesi/status.ts");
const sumberHalaman = baca("src/app/admin/sesi/page.tsx");
// Sejak /admin/sesi menjadi dua tab, penyajian permintaan dirender
// `panel-permintaan.tsx` (komponen server) dan tombolnya `aksi-permintaan.tsx`
// (komponen klien); komponen antrean blok emas yang dulu menampung keduanya
// sudah dihapus. KEDUANYA diperiksa, bukan salah satu — pagar sumber di bawah
// menjaga SELURUH kode yang menyentuh permintaan, dan memeriksa satu berkas
// saja berarti separuh layar tidak terjaga.
const sumberPanelPermintaan = baca("src/app/admin/sesi/panel-permintaan.tsx");
const sumberAksiPermintaan = baca("src/app/admin/sesi/aksi-permintaan.tsx");
const migrasi = baca("supabase/migrations/20260829170000_sesi_dari_permintaan.sql");
const migrasiKonfirmasiAtomik = baca("supabase/migrations/20260909135000_konfirmasi_atomik.sql");

/**
 * Badan SATU server action, dipotong dari sumbernya.
 *
 * Berkas `aksi.ts` menampung lebih dari satu action, dan aturannya berbeda per
 * action: `konfirmasiPermintaan` tidak boleh membaca identitas klien dari
 * payload (sumber kebenarannya adalah baris permintaan), sedangkan
 * `jadwalkanSesi` justru harus — di jalur itu memang admin yang memilih klien
 * dan tidak ada baris lain untuk dibaca. Pemeriksaan berbasis seluruh isi
 * berkas akan mencampur keduanya, jadi ia dipersempit ke fungsi yang dimaksud.
 */
function badanAction(nama: string): string {
  const mulai = sumberAksi.indexOf(`export async function ${nama}(`);
  expect(mulai).toBeGreaterThanOrEqual(0);
  const sisa = sumberAksi.slice(mulai + 1);
  const akhir = sisa.indexOf("\nexport async function ");
  return akhir === -1 ? sisa : sisa.slice(0, akhir);
}

let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;

async function bersihkan() {
  // Jejak audit DULU dari semuanya: `konfirmasi_permintaan()` (rantai C2)
  // melahirkan sesi LANGSUNG berstatus `status_bayar = 'lunas'`, dan trigger
  // `catat_status_bayar` mencatatnya SEJAK INSERT (bukan hanya UPDATE, sejak
  // migration 20260829180000). Tabel jejak SENGAJA tanpa foreign key — sesi
  // yang dihapus tanpa jejaknya ikut dihapus meninggalkan baris YATIM, yang
  // ditangkap tests/jejak-yatim.test.ts. `sesi_id` dibaca dulu, sebelum
  // sesinya sendiri lenyap.
  const { data: sesiTgl } = await admin.from("sessions").select("id").eq("tanggal", TGL);
  const idSesi = (sesiTgl ?? []).map((s) => s.id as string);
  if (idSesi.length) {
    await admin.from("jejak_status_bayar").delete().in("sesi_id", idSesi);
  }
  // Sesi DULU, baru permintaannya: `sessions.booking_request_id` menahan
  // penghapusan permintaan yang sudah menjadi sesi (FK tanpa on delete).
  await admin.from("sessions").delete().eq("tanggal", TGL);
  await admin.from("booking_requests").delete().eq("tanggal", TGL);
  // SESUDAH booking_requests: FK screening_id (RESTRICT) menahan penghapusan
  // selama masih ditunjuk baris permintaan.
  await admin.from("screenings").delete().like("kode", "UJI-%");
}

async function baris(id: string) {
  const { data } = await admin
    .from("booking_requests")
    .select("id, status")
    .eq("id", id)
    .maybeSingle<{ id: string; status: string }>();
  return data;
}

async function sesiPadaTanggal() {
  const { data } = await admin
    .from("sessions")
    .select(
      "id, client_id, service_id, variant_id, partner_id, status, booking_request_id, alamat, alamat_lat, alamat_lon",
    )
    .eq("tanggal", TGL);
  return data ?? [];
}

let VARIAN_SVC: string;

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
  ref.sesi = sesiAdmin;
  // Sejak Task 9 `booking_requests.variant_id`/`sessions.variant_id` NOT
  // NULL: id-nya lahir `gen_random_uuid()` saat migrasi/trigger berjalan,
  // jadi dibaca dari basis data sekali di sini alih-alih ditulis literal.
  VARIAN_SVC = await varianBaku(admin, SVC);

  await admin.from("partners").upsert(
    {
      id: MITRA_NONAKTIF,
      nama: "PAD-UJI Bidan Pensiun",
      no_hp: "0811-9100-0001",
      aktif: false,
    },
    { onConflict: "id" },
  );
});

afterAll(async () => {
  await bersihkan();
  await admin.from("partners").delete().eq("id", MITRA_NONAKTIF);
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  jejak.revalidate.length = 0;

  await bersihkan();
  const screeningId = await skriningHijau(admin, KLIEN);
  const { data, error } = await admin
    .from("booking_requests")
    .insert({
      client_id: KLIEN,
      service_id: SVC,
      variant_id: VARIAN_SVC,
      partner_id: MITRA,
      tanggal: TGL,
      jam_mulai: "09:00",
      preferensi_waktu: "pagi",
      catatan: "Kalau bisa sebelum pukul 9.",
      // Rantai C1: mitra sudah ditetapkan lewat cariMitra/pilihMitra — diuji
      // tersendiri di tests/admin-rantai-mitra.test.ts. Fixture ditulis
      // LANGSUNG pada status tujuan lewat INSERT (tidak dibatasi trigger
      // perpindahan, yang hanya menahan UPDATE) supaya berkas ini tetap fokus
      // pada konfirmasi itu sendiri.
      //
      // Berhenti di 'mitra_siap', BUKAN 'menunggu_bayar' (rantai C2): halaman
      // /admin/sesi (`aksi-permintaan.tsx`) masih menggambar tombol
      // "Konfirmasi" hanya untuk keadaan ini — memindahkan dasar fixture ke
      // 'menunggu_bayar' akan mengosongkan render describe "halaman antrean
      // permintaan" di bawah. Describe yang sungguh memanggil
      // `konfirmasiPermintaan` dan mengharapkannya BERHASIL menaikkan fixture
      // ini sendiri lewat `beforeEach` tersarangnya (lihat "konfirmasi
      // permintaan jadwal" & "konfirmasiPermintaan menghitung & menyimpan
      // jenjang transport").
      status: "mitra_siap",
      screening_id: screeningId,
    })
    .select("id")
    .single();
  if (error) throw error;
  permintaanId = data!.id as string;
});

/**
 * Menaikkan fixture dari 'mitra_siap' ke 'menunggu_bayar' + lunas — jalur
 * wajib sejak C2 (`mitra_siap -> dikonfirmasi` langsung DITOLAK sekarang).
 * Dipakai sebagai `beforeEach` tersarang oleh describe yang benar-benar
 * memanggil `konfirmasiPermintaan` dan mengharapkannya berhasil.
 */
async function naikkanKeMenungguBayarLunas() {
  const { error } = await admin
    .from("booking_requests")
    .update({
      status: "menunggu_bayar",
      tenggat: new Date(Date.now() + 24 * 3_600_000).toISOString(),
      status_bayar: "lunas",
    })
    .eq("id", permintaanId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// konfirmasiPermintaan
// ---------------------------------------------------------------------------

describe("konfirmasi permintaan jadwal", () => {
  beforeEach(naikkanKeMenungguBayarLunas);

  it("mengubah permintaan menjadi dikonfirmasi DAN membuat satu sesi terjadwal", async () => {
    const r = await konfirmasiPermintaan(permintaanId);
    expect(r.ok).toBe(true);

    expect((await baris(permintaanId))!.status).toBe("dikonfirmasi");

    const sesi = await sesiPadaTanggal();
    expect(sesi).toHaveLength(1);
    expect(sesi[0]).toMatchObject({
      client_id: KLIEN,
      service_id: SVC,
      variant_id: VARIAN_SVC, // varian ikut dari permintaan asalnya (Task 9)
      partner_id: MITRA,
      status: "terjadwal",
      booking_request_id: permintaanId,
    });
  });

  it("menyalin alamat & koordinat DARI BARIS PERMINTAAN, bukan dari profil klien (spec T6)", async () => {
    // Klien boleh memesan untuk alamat lain — profilnya (`clients.alamat`)
    // sengaja dibiarkan KOSONG di sini (nilai default seed), berbeda dari
    // alamat permintaan ini. Bila `konfirmasiPermintaan` diam-diam mengambil
    // ulang dari `clients` alih-alih menyalin dari baris permintaan, sesi
    // akan berakhir dengan alamat kosong — bukan alamat yang sebenarnya
    // dipesan klien untuk kunjungan ini.
    await admin
      .from("booking_requests")
      .update({ alamat: "Jl. Alamat Permintaan Ini No. 9", alamat_lat: -6.9, alamat_lon: 107.6 })
      .eq("id", permintaanId);

    const r = await konfirmasiPermintaan(permintaanId);
    expect(r.ok).toBe(true);

    const sesi = await sesiPadaTanggal();
    expect(sesi).toHaveLength(1);
    expect(sesi[0]).toMatchObject({
      alamat: "Jl. Alamat Permintaan Ini No. 9",
      alamat_lat: -6.9,
      alamat_lon: 107.6,
    });

    // Bukti tambahan bahwa nilainya BUKAN kebetulan sama dengan profil klien:
    // profilnya memang kosong.
    const { data: klien } = await admin
      .from("clients")
      .select("alamat")
      .eq("id", KLIEN)
      .single();
    expect(klien!.alamat).not.toBe(sesi[0].alamat);
  });

  it("identitas klien & layanan diambil dari baris permintaan, bukan dari pemanggil", async () => {
    // Hanya SATU nilai boleh datang dari luar sejak rantai C1: permintaan
    // mana. Mitra sudah tertaut lebih dulu lewat `pilihMitra`. Sisanya dibaca
    // dari barisnya sendiri — kalau tidak, satu request POST yang dikarang
    // bisa membuat sesi atas nama klien lain.
    const badan = badanAction("konfirmasiPermintaan");
    // Tidak ada FormData sama sekali di jalur ini.
    expect(badan).not.toContain("formData");
    // Sejak `konfirmasi_atomik`, penyalinan client_id/service_id/variant_id
    // pindah ke DALAM fungsi Postgres `konfirmasi_permintaan()` — satu
    // transaksi, bukan dua round-trip dari TypeScript (lihat dokblok migration
    // `20260909135000_konfirmasi_atomik.sql`). Yang dijaga di sini karena itu
    // adalah RPC-nya, bukan lagi badan action.
    expect(badan).toMatch(/supabase\.rpc\(\s*"konfirmasi_permintaan"/);
    expect(migrasiKonfirmasiAtomik).toMatch(/client_id,\s*service_id,\s*variant_id,\s*partner_id/);
    expect(migrasiKonfirmasiAtomik).toMatch(
      /p\.client_id,\s*p\.service_id,\s*p\.variant_id,\s*p\.partner_id/,
    );
  });

  it("menyegarkan cache antrean admin dan passport klien", async () => {
    await konfirmasiPermintaan(permintaanId);
    expect(jejak.revalidate).toContain("/admin/sesi");
    expect(jejak.revalidate).toContain("/passport");
  });

  it("konfirmasi KEDUA pada permintaan yang sama tidak melahirkan sesi kedua", async () => {
    const pertama = await konfirmasiPermintaan(permintaanId);
    expect(pertama.ok).toBe(true);

    const kedua = await konfirmasiPermintaan(permintaanId);
    expect(kedua.ok).toBe(false);

    expect(await sesiPadaTanggal()).toHaveLength(1); // tetap satu
  });

  it("dua konfirmasi PARALEL hanya menghasilkan satu sesi (balapan)", async () => {
    const [a, b] = await Promise.all([
      konfirmasiPermintaan(permintaanId),
      konfirmasiPermintaan(permintaanId),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1); // tepat satu pemenang

    expect(await sesiPadaTanggal()).toHaveLength(1);
    expect((await baris(permintaanId))!.status).toBe("dikonfirmasi");
  });

  it("basis data ikut menjaga: dua sesi tidak bisa menaut satu permintaan", async () => {
    // Jaring kedua, tidak bergantung pada urutan pernyataan di TypeScript.
    // Bahkan service role — yang menembus seluruh RLS — tertahan di sini.
    await konfirmasiPermintaan(permintaanId);
    const { error } = await admin.from("sessions").insert({
      client_id: KLIEN,
      service_id: SVC,
      variant_id: VARIAN_SVC,
      partner_id: MITRA,
      tanggal: TGL,
      jam_mulai: "09:00",
      status: "terjadwal",
      booking_request_id: permintaanId,
    });
    expect(error?.code).toBe("23505");
    expect(await sesiPadaTanggal()).toHaveLength(1);
  });

  it("permintaan yang sudah dikonfirmasi tidak bisa dikonfirmasi ulang", async () => {
    await admin
      .from("booking_requests")
      .update({ status: "dikonfirmasi" })
      .eq("id", permintaanId);

    const r = await konfirmasiPermintaan(permintaanId);
    expect(r.ok).toBe(false);
    expect(await sesiPadaTanggal()).toHaveLength(0);
  });

  it("permintaan yang sudah dibatalkan klien tidak bisa dihidupkan lewat konfirmasi", async () => {
    // `ditolak` sudah tidak lagi keadaan yang bisa dituju perpindahan mana pun
    // (spec J8 — nilainya dipertahankan untuk riwayat lama, tapi tidak
    // terjangkau dari layar mana pun; lihat dokblok `PERPINDAHAN_PERMINTAAN`
    // di `src/lib/jadwal/status.ts`). `dibatalkan_klien` adalah keadaan akhir
    // yang sungguh dituju sekarang, dan `menunggu_bayar -> dibatalkan_klien`
    // sah (fixture describe ini sudah dinaikkan ke 'menunggu_bayar' + lunas).
    await admin
      .from("booking_requests")
      .update({ status: "dibatalkan_klien" })
      .eq("id", permintaanId);

    const r = await konfirmasiPermintaan(permintaanId);
    expect(r.ok).toBe(false);
    expect((await baris(permintaanId))!.status).toBe("dibatalkan_klien");
    expect(await sesiPadaTanggal()).toHaveLength(0);
  });

  it("permintaan yang tidak ada ditolak tanpa membuat sesi yatim", async () => {
    const r = await konfirmasiPermintaan(HANTU);
    expect(r.ok).toBe(false);
    expect(await sesiPadaTanggal()).toHaveLength(0);
  });

  // "mitra yang tidak ada ditolak" dan "mitra NONAKTIF tidak bisa
  // ditugaskan" pindah ke `pilihMitra` sejak rantai C1 (spec C1 J7):
  // `konfirmasiPermintaan` tidak lagi menerima id mitra sebagai argumen —
  // mitra sudah harus tertaut lebih dulu, dan itu diuji tuntas di
  // `tests/admin-rantai-mitra.test.ts` ("menolak mitra NONAKTIF dengan
  // kalimat, bukan kode Postgres").

  it("tanda tangan action TIDAK menerima status dari pemanggil", () => {
    // Bentuk celah "klien menyetujui permintaannya sendiri" pernah tembus di
    // proyek ini justru karena nilai status datang dari luar. Satu parameter
    // saja sejak rantai C1: id permintaan (mitra sudah tertaut lebih dulu
    // lewat `pilihMitra`).
    expect(konfirmasiPermintaan.length).toBe(1);
    expect(tolakPermintaan.length).toBe(1);
    for (const pola of [
      /function\s+\w+\([^)]*status\s*:/,
      /function\s+\w+\([^)]*statusBaru\s*:/,
    ]) {
      expect(sumberAksi).not.toMatch(pola);
    }
    // Keduanya tertulis mati di dalam action, masing-masing sekali.
    expect(sumberAksi).toMatch(/status:\s*"dikonfirmasi"/);
    expect(sumberAksi).toMatch(/status:\s*"ditolak"/);
    expect(sumberAksi).toMatch(/status:\s*"terjadwal"/);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa mengonfirmasi permintaannya sendiri", async () => {
    ref.sesi = sesiKlien;
    await expect(konfirmasiPermintaan(permintaanId)).rejects.toThrow(/REDIRECT/);

    // Fixture describe ini sudah dinaikkan ke 'menunggu_bayar' + lunas oleh
    // beforeEach tersarang di atas.
    expect((await baris(permintaanId))!.status).toBe("menunggu_bayar");
    expect(await sesiPadaTanggal()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// konfirmasiPermintaan — jenjang transport (Ruling 11): jalur KEDUA yang
// menugaskan mitra, dan booking_requests SUDAH punya koordinatnya sendiri
// sejak Task 6 — tidak perlu proksi alamat default klien seperti jadwalkanSesi.
// ---------------------------------------------------------------------------

describe("konfirmasiPermintaan menghitung & menyimpan jenjang transport", () => {
  const KOORD_SAMA = { lat: -6.9175, lon: 107.6191 }; // jarak 0 km -> "0_5"

  beforeEach(naikkanKeMenungguBayarLunas);

  // MITRA di berkas ini (Bidan Sri Wahyuni) dipakai di banyak `it()` lain yang
  // tidak peduli koordinat sama sekali — dikembalikan ke NULL supaya tidak
  // membocorkan saran jenjang ke test lain.
  afterEach(async () => {
    await admin.from("partners").update({ lat: null, lon: null }).eq("id", MITRA);
  });

  it("menyimpan jenjang OTOMATIS dari koordinat permintaan & mitra", async () => {
    await admin
      .from("booking_requests")
      .update({ alamat_lat: KOORD_SAMA.lat, alamat_lon: KOORD_SAMA.lon })
      .eq("id", permintaanId);
    await admin.from("partners").update({ lat: KOORD_SAMA.lat, lon: KOORD_SAMA.lon }).eq("id", MITRA);

    const r = await konfirmasiPermintaan(permintaanId);
    expect(r.ok).toBe(true);

    const { data } = await admin
      .from("sessions")
      .select("jenjang, jenjang_sumber, jenjang_alasan")
      .eq("tanggal", TGL)
      .single();
    expect(data!.jenjang).toBe("0_5");
    expect(data!.jenjang_sumber).toBe("otomatis");
    expect(data!.jenjang_alasan).toBe("");
  });

  it("jenjang tetap NULL bila koordinat mitra belum ada — bukan galat", async () => {
    await admin
      .from("booking_requests")
      .update({ alamat_lat: KOORD_SAMA.lat, alamat_lon: KOORD_SAMA.lon })
      .eq("id", permintaanId);
    // MITRA sengaja TIDAK diberi koordinat (default seed: NULL).

    const r = await konfirmasiPermintaan(permintaanId);
    expect(r.ok).toBe(true);

    const { data } = await admin
      .from("sessions")
      .select("jenjang, jenjang_sumber")
      .eq("tanggal", TGL)
      .single();
    expect(data!.jenjang).toBeNull();
    expect(data!.jenjang_sumber).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// tolakPermintaan
// ---------------------------------------------------------------------------

describe("menolak permintaan jadwal", () => {
  it("TIDAK LAGI TERJANGKAU (spec C1 J8): tolakPermintaan gagal, trigger perpindahan menahannya", async () => {
    // `ditolak` bukan tujuan yang sah dari status mana pun di
    // `PERPINDAHAN_PERMINTAAN` (src/lib/jadwal/status.ts) — klien sekarang
    // membatalkan sendiri lewat `batalkanPengajuan` (Passport), diuji tuntas
    // di tests/pembatalan-klien.test.ts. Fungsi & tombolnya sengaja belum
    // dihapus (pola saklar `lib/paket-tampil.ts`), tetapi jalurnya sudah mati:
    // UPDATE-nya ditahan trigger, dan action ini melaporkannya sebagai
    // kegagalan biasa — bukan galat yang lolos ke pemanggil.
    const r = await tolakPermintaan(permintaanId);
    expect(r.ok).toBe(false);
    expect((await baris(permintaanId))!.status).toBe("mitra_siap");
    expect(await sesiPadaTanggal()).toHaveLength(0);
  });

  it("permintaan yang sudah dikonfirmasi TIDAK bisa dibatalkan lewat tolak", async () => {
    // Sesi sudah lahir; memutar status permintaan kembali ke 'ditolak' hanya
    // membuat sesi itu kehilangan asal-usulnya tanpa membatalkan apa pun.
    // Fixture describe ini berhenti di 'mitra_siap' (lihat komentar beforeEach
    // di atas) — dinaikkan ke jalur wajib C2 di sini, khusus test ini, supaya
    // konfirmasinya sungguh berhasil sebelum tolakPermintaan dicoba.
    await naikkanKeMenungguBayarLunas();
    await konfirmasiPermintaan(permintaanId);
    const r = await tolakPermintaan(permintaanId);
    expect(r.ok).toBe(false);
    expect((await baris(permintaanId))!.status).toBe("dikonfirmasi");
    expect(await sesiPadaTanggal()).toHaveLength(1);
  });

  it("permintaan yang tidak ada ditolak, bukan 'ok' palsu", async () => {
    // UPDATE yang tidak mengenai baris mana pun dijawab PostgREST 200 + [].
    const r = await tolakPermintaan(HANTU);
    expect(r.ok).toBe(false);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa menolak permintaan", async () => {
    ref.sesi = sesiKlien;
    await expect(tolakPermintaan(permintaanId)).rejects.toThrow(/REDIRECT/);
    expect((await baris(permintaanId))!.status).toBe("mitra_siap");
  });
});

// ---------------------------------------------------------------------------
// Pagar basis data
// ---------------------------------------------------------------------------

describe("pagar basis data yang menopang modul ini", () => {
  it("klien TIDAK bisa mengubah status permintaannya sendiri lewat REST", async () => {
    // Tidak ada policy UPDATE untuk klien: PostgREST menjawab 200 + [] tanpa
    // error, jadi nilainya WAJIB dibaca ulang — bukan disimpulkan dari error.
    const { data: ubah } = await sesiKlien
      .from("booking_requests")
      .update({ status: "dikonfirmasi" })
      .eq("id", permintaanId)
      .select("id");
    expect(ubah ?? []).toHaveLength(0);
    expect((await baris(permintaanId))!.status).toBe("mitra_siap");
  });

  it("klien TIDAK bisa menyisipkan sesi untuk dirinya sendiri", async () => {
    const { error } = await sesiKlien.from("sessions").insert({
      client_id: KLIEN,
      service_id: SVC,
      variant_id: VARIAN_SVC,
      partner_id: MITRA,
      tanggal: TGL,
      status: "terjadwal",
    });
    expect(error).not.toBeNull();
    expect(await sesiPadaTanggal()).toHaveLength(0);
  });

  it("permintaan yang sudah menjadi sesi tidak bisa dihapus begitu saja", async () => {
    // Asal-usul sesi tidak boleh lenyap tanpa sesinya ikut dibereskan lebih
    // dulu — sekaligus yang membuat index unik di atas tidak bisa dilepas
    // dengan satu DELETE.
    // Fixture berkas ini berhenti di 'mitra_siap' (lihat komentar beforeEach
    // global) — dinaikkan ke jalur wajib C2 supaya konfirmasinya sungguh
    // melahirkan sesi sebelum penghapusan dicoba.
    await naikkanKeMenungguBayarLunas();
    await konfirmasiPermintaan(permintaanId);
    const { error } = await admin
      .from("booking_requests")
      .delete()
      .eq("id", permintaanId);
    expect(error?.code).toBe("23503");
  });

  it("kolom penaut & index uniknya benar-benar ada di migration", () => {
    expect(migrasi).toMatch(/add column booking_request_id uuid references public\.booking_requests\(id\)/);
    expect(migrasi).toMatch(/create unique index sessions_booking_request_unik/);
    // Nama kolom sengaja tidak menyentuh regex money firewall.
    expect(migrasi).not.toMatch(/(^|_)(bayar|harga|tarif|biaya|nominal|total)(_|$)/m);
  });
});

// ---------------------------------------------------------------------------
// Halaman /admin/sesi
// ---------------------------------------------------------------------------

describe("halaman antrean permintaan (/admin/sesi)", () => {
  it("menampilkan permintaan yang menunggu beserta konteksnya", async () => {
    const markup = renderToStaticMarkup(await SesiPage({ searchParams: Promise.resolve({}) }));

    expect(markup).toContain("Ananda"); // nama klien, bukan sekadar UUID
    expect(markup).not.toContain(KLIEN);
    expect(markup).toContain("Fertility Massage"); // nama layanan
    expect(markup).toContain("26 Desember 2026"); // tanggal terbaca manusia
    expect(markup).toContain(LABEL_WAKTU.pagi);
    expect(markup).toContain("Kalau bisa sebelum pukul 9."); // catatan klien
  });

  it("menawarkan mitra AKTIF untuk ditugaskan, bukan yang sudah pensiun", async () => {
    const markup = renderToStaticMarkup(await SesiPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain("Bidan Sri Wahyuni");
    expect(markup).not.toContain("PAD-UJI Bidan Pensiun");
  });

  it("menyediakan tombol Konfirmasi — Tolak sudah dilepas dari layar (spec C1 J8)", async () => {
    const markup = renderToStaticMarkup(await SesiPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain("Konfirmasi");
    expect(markup).not.toContain("Tolak");
  });

  it("menjelaskan akibat konfirmasi kepada admin", async () => {
    const markup = renderToStaticMarkup(await SesiPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toMatch(/sesi\s+Terjadwal/i);
    expect(markup).toMatch(/whatsapp/i);
  });

  it("permintaan yang sudah ditangani TIDAK muncul lagi di antrean", async () => {
    // Idem: dinaikkan ke 'menunggu_bayar' + lunas supaya konfirmasi ini
    // sungguh berhasil (lihat komentar beforeEach global soal fixture dasar).
    await naikkanKeMenungguBayarLunas();
    await konfirmasiPermintaan(permintaanId);
    const markup = renderToStaticMarkup(await SesiPage({ searchParams: Promise.resolve({}) }));
    expect(markup).not.toContain("Kalau bisa sebelum pukul 9.");
    expect(markup).toMatch(/tidak ada permintaan/i);
  });

  it("dijaga requireRole admin+owner di halamannya sendiri", () => {
    expect(sumberHalaman).toMatch(
      /await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/,
    );
  });

  it("judul mengandalkan template layout (tanpa menempel PADMA sendiri)", () => {
    expect(sumberHalaman).toMatch(/title:\s*"Sesi"/);
    expect(sumberHalaman).not.toMatch(/title:\s*"[^"]*PADMA/);
  });

  it("TIDAK ada nominal uang di modul sesi (money firewall)", async () => {
    const markup = renderToStaticMarkup(await SesiPage({ searchParams: Promise.resolve({}) }));
    expect(nominalDalam(markup), "nominal bocor").toEqual([]);
    for (const sumber of [sumberHalaman, sumberPanelPermintaan, sumberAksiPermintaan, sumberAksi, sumberStatus]) {
      expect(nominalDalam(sumber), "nominal bocor").toEqual([]);
      expect(sumber).not.toContain("service_rates");
      expect(sumber).not.toContain("variant_rates");
      expect(sumber).not.toContain("honor_marks");
    }
  });
});

// ---------------------------------------------------------------------------
// Bentuk berkas
// ---------------------------------------------------------------------------

describe("berkas server action sesi", () => {
  it('diawali "use server"', () => {
    expect(sumberAksi.trimStart().startsWith('"use server"')).toBe(true);
  });

  it("hanya mengekspor fungsi async (syarat Next)", () => {
    const ekspor = [...sumberAksi.matchAll(/^export\s+(?!type\b)(\w+)/gm)].map((m) => m[1]);
    expect(ekspor.length).toBeGreaterThan(0);
    expect([...new Set(ekspor)]).toEqual(["async"]);
  });

  it("SETIAP action memanggil requireRole(['admin','owner']) di dalam dirinya", () => {
    const jumlahAction = [...sumberAksi.matchAll(/^export\s+async\s+function\s+\w+/gm)].length;
    const jumlahGuard = [
      ...sumberAksi.matchAll(/await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/g),
    ].length;
    // cariMitra, pilihMitra (rantai C1), terbitkanTagihan (rantai C2),
    // konfirmasiPermintaan, tolakPermintaan, jadwalkanSesi, selesaikanSesi,
    // tetapkanJenjang (Task 7). Angkanya sengaja tepat, bukan
    // `toBeGreaterThan`: action baru yang lupa memasang penjaganya harus
    // memerahkan berkas ini, bukan lewat diam-diam.
    expect(jumlahAction).toBe(8);
    expect(jumlahGuard).toBe(jumlahAction);
  });

  it("label & daftar putih hidup di status.ts, bukan di berkas 'use server'", () => {
    // Modul "use server" yang mengekspor konstanta menggagalkan `next build`.
    expect(sumberStatus.trimStart().startsWith('"use server"')).toBe(false);
    expect(LABEL_WAKTU).toMatchObject({ pagi: expect.any(String) });
    expect(Object.keys(LABEL_WAKTU).sort()).toEqual(["pagi", "siang", "sore"]);
    // Rantai C2: 'menunggu_bayar' dan 'dibatalkan_tenggat' bertambah.
    expect(Object.keys(LABEL_STATUS_PERMINTAAN).sort()).toEqual([
      "dibatalkan_klien",
      "dibatalkan_tenggat",
      "dikonfirmasi",
      "diminta",
      "ditolak",
      "mencari_mitra",
      "menunggu_bayar",
      "mitra_siap",
    ]);
  });

  it("memakai sesi pengguna, bukan service role", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberPanelPermintaan, sumberAksiPermintaan, sumberStatus]) {
      expect(sumber).not.toContain("createAdminSupabase");
      expect(sumber).not.toContain("SERVICE_ROLE");
    }
    expect(sumberAksi).toContain("createServerSupabase");
  });

  it("tanggal (kolom date) tidak pernah dihitung dengan aritmatika Date", () => {
    // Larangan aslinya menyapu SELURUH pemakaian `toISOString`/`setDate(`/
    // `getDay(` di berkas ini karena satu-satunya pemakaiannya dulu adalah
    // kolom `tanggal` (tipe `date`) — dan `new Date("2026-12-27").toISOString()`
    // adalah tengah malam UTC, yang mundur sehari di zona mana pun sebelah
    // barat (spec T6, lihat POLA_TANGGAL di atas berkas aksi.ts).
    //
    // C2 menambahkan pemakaian YANG SAH: `terbitkanTagihan` menghitung
    // `tenggat`, kolom `timestamptz` (bukan `date`) — "24 jam dari sekarang"
    // bukan tanggal kalender, dan tidak punya masalah zona waktu yang sama.
    // Larangannya TIDAK dilonggarkan begitu saja; ia dipersempit supaya
    // pemakaian sah yang satu ini tidak diam-diam membuka jalan bagi
    // `toISOString` lain yang menyelinap pada kolom `tanggal`/`date`.
    for (const sumber of [sumberHalaman, sumberPanelPermintaan, sumberAksiPermintaan, sumberStatus]) {
      expect(sumber).not.toContain("toISOString");
      expect(sumber).not.toContain("setDate(");
      expect(sumber).not.toContain("getDay(");
    }
    expect(sumberAksi).not.toContain("setDate(");
    expect(sumberAksi).not.toContain("getDay(");
    // TEPAT satu pemakaian, dan itu WAJIB `tenggat` di `terbitkanTagihan` —
    // bukan `toBeGreaterThan`: pemakaian toISOString baru yang lupa menyebut
    // `tenggat` harus memerahkan berkas ini.
    expect([...sumberAksi.matchAll(/toISOString/g)]).toHaveLength(1);
    expect(sumberAksi).toMatch(/const tenggat = new Date\(.*\)\.toISOString\(\);/);
  });

  it("tidak menuliskan data klien ke log", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberPanelPermintaan, sumberAksiPermintaan, sumberStatus]) {
      expect(sumber).not.toContain("console.");
    }
  });

  it("layout admin TIDAK ikut diubah (matriks peran tetap satu panggilan)", () => {
    const layout = baca("src/app/admin/layout.tsx");
    expect([...layout.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(layout).toMatch(/requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/);
    expect(baca("src/app/admin/page.tsx")).toContain('href="/admin/skrining"');
  });
});
