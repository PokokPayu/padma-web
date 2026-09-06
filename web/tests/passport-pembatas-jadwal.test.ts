/**
 * PEMBATAS & VALIDASI ISI `ajukanJadwal` — temuan red team.
 *
 * Empat invarian inti passport TERBUKTI pegang (data sendiri saja, gating
 * materi, tak pernah 'lunas', tak pernah 'dikonfirmasi'). Yang JEBOL adalah
 * abuse-control pada satu-satunya jalur tulis milik klien:
 *
 *   1. VOLUME. 50 permintaan dikirim serentak -> 50/50 tersimpan dalam 123ms.
 *      Statusnya memang tetap 'menunggu' (trigger memegang), tetapi antrean
 *      admin terkubur: verifikasi manual adalah SATU-SATUNYA gerbang menuju
 *      'dikonfirmasi'/'lunas', jadi membanjirinya = melumpuhkan gerbang itu.
 *   2. LAYANAN NONAKTIF. `services.aktif=false` tetap bisa dipesan — foreign
 *      key hanya menolak service_id yang TIDAK ADA, bukan yang dimatikan.
 *      Formulir menyaring dengan `.eq("aktif", true)`, tapi server action
 *      adalah endpoint POST tersendiri: penyaringan di UI tidak berlaku.
 *   3. TANGGAL LAMPAU. `2020-01-01` diterima — regex bentuk YYYY-MM-DD hanya
 *      memeriksa RUPA, bukan NILAI.
 *
 * Kenapa penegaknya harus di BASIS DATA, bukan hanya di action: klien memegang
 * policy INSERT pada `booking_requests`, jadi ia bisa memanggil PostgREST
 * langsung dengan anon key + JWT-nya sendiri tanpa pernah menyentuh server
 * action. Setiap kasus di bawah karena itu diuji DUA KALI — lewat action, dan
 * lewat REST mentah — dan hasilnya selalu dibaca ulang dengan service role
 * (PostgREST menjawab 200 + [] untuk tulisan yang tertahan, bukan 403).
 *
 * Pagar waktu: tanggal dibandingkan sebagai STRING (kolomnya date, hidup
 * sebagai 'YYYY-MM-DD'); tidak ada aritmatika Date di berkas ini.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { normalkanAlamat } from "@/lib/transport/alamat";
import { BATAS_PERMINTAAN_MENUNGGU as BATAS } from "@/lib/passport/batas";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";
import { varianBaku } from "./helpers/varian";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const ANANDA = "44444444-4444-4444-4444-444444444401";
const SVC_NUTRISI = "11111111-1111-1111-1111-111111111103";
const SVC_YOGA = "11111111-1111-1111-1111-111111111102";
/** Layanan yang dimatikan sementara di berkas ini, lalu dinyalakan lagi. */
const SVC_NONAKTIF = "11111111-1111-1111-1111-111111111110";

const TGL_DEPAN = "2027-03-15";
const TGL_LAMPAU = "2020-01-01";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

/**
 * ===== KENAPA `auth.getUser()` DIJAWAB SEKALI DI SINI =====
 * Bukan pelonggaran assertion — perbaikan KESETIAAN HARNESS. Tidak satu pun
 * `expect` di berkas ini berubah karenanya.
 *
 * Di produksi, 50 pengiriman serentak adalah 50 REQUEST TERPISAH: masing-masing
 * membawa cookie-nya sendiri dan `createServerSupabase()` melahirkan klien
 * sendiri, sehingga 50 pemeriksaan identitas berjalan benar-benar paralel. Di
 * test, `createServerSupabase` di-mock menjadi SATU klien supabase-js bersama —
 * dan supabase-js mengunci (process lock) seluruh panggilan auth pada satu
 * klien, sehingga 50 `getUser()` mengantre menjadi satu deret permintaan GoTrue.
 *
 * Diukur langsung pada stack lokal ini (29 Agu 2026), satu klien, n panggilan
 * `auth.getUser()` serentak:
 *      n=1  ->  947ms, 0 gagal
 *      n=2  -> 3876ms, 0 gagal
 *      n=4  -> 7450ms, 0 gagal
 *      n=8  -> 5472ms, 0 gagal
 *      n=12 -> 11774ms, 12 gagal — SEMUANYA
 *              AuthRetryableFetchError 504 "Processing this request timed out"
 *      n=50 -> 11471ms, 50 gagal — SEMUANYA 504
 *
 * Akibatnya `requireRole` melihat `user === null` lalu `redirect("/masuk")`,
 * dan test 50-serentak mati dengan "REDIRECT /masuk" SEBELUM satu pun INSERT
 * dikirim. Artinya test itu tidak pernah benar-benar menguji pembatasnya: ia
 * mengukur throughput GoTrue lokal. (Sebelum `testTimeout` dinaikkan, kegagalan
 * yang sama menyamar sebagai "Test timed out in 5000ms" — lalu 50 permintaannya
 * yang masih terbang mencemari test BERIKUTNYA, itulah sebabnya assertion yang
 * merah berpindah-pindah tiap run.)
 *
 * Identitas tetap diperiksa: `requireRole(["klien"])` DAN `klienSaatIni()`
 * berjalan apa adanya, hanya jawaban GoTrue-nya diambil sekali per klien —
 * persis seperti satu request produksi yang memeriksa identitasnya sendiri
 * sekali. Yang dibiarkan 50-serentak justru bagian yang sedang diuji: tulisan
 * ke `booking_requests`. Bahwa penjaga peran itu sungguh menolak diuji di
 * berkasnya sendiri (tests/passport-rls.test.ts, access-matrix E2E).
 */
async function sesiSiapSerentak(c: SupabaseClient): Promise<SupabaseClient> {
  const jawaban = await c.auth.getUser();
  if (!jawaban.data.user) {
    throw new Error(`Sesi test tidak sah: ${jawaban.error?.message ?? "tanpa user"}`);
  }
  (c.auth as unknown as { getUser: () => Promise<typeof jawaban> }).getUser = async () =>
    jawaban;
  return c;
}
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("notFound() terpanggil");
  },
}));

const { ajukanJadwal } = await import("@/lib/passport/aksi");

let sesiAnanda: SupabaseClient;

// Alamat WAJIB sejak Task 6 (spec T6) dan tidak relevan untuk skenario
// berkas ini (pembatas antrean, dedup, layanan nonaktif) — dibubuhkan sebagai
// DEFAULT di sini, bukan diulang di puluhan pemanggilan `formulir(...)`, dan
// tetap bisa ditimpa lewat `isi.alamat` oleh test yang justru menguji alamat.
function formulir(isi: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ alamat: "Jl. Uji Alamat Baku No. 1", ...isi })) {
    fd.set(k, v);
  }
  return fd;
}

/** Tanggal masa depan yang berbeda-beda, dirakit sebagai STRING (tanpa Date). */
function tanggalKe(i: number): string {
  const bulan = i < 25 ? "03" : "04";
  const hari = String((i % 25) + 1).padStart(2, "0");
  return `2027-${bulan}-${hari}`;
}

async function barisAnanda() {
  const { data } = await admin
    .from("booking_requests")
    .select("id, status, tanggal, service_id")
    .eq("client_id", ANANDA);
  return data ?? [];
}

async function barisAnandaAlamat() {
  const { data } = await admin
    .from("booking_requests")
    .select("id, alamat, alamat_lat, alamat_lon")
    .eq("client_id", ANANDA);
  return data ?? [];
}

async function menungguAnanda() {
  return (await barisAnanda()).filter((b) => b.status === "menunggu");
}

async function bersihkanAnanda() {
  await admin.from("booking_requests").delete().eq("client_id", ANANDA);
}

/** Mengisi antrean sampai penuh memakai service role (menembus trigger klien). */
async function isiAntrean(jumlah: number) {
  const baris = Array.from({ length: jumlah }, (_, i) => ({
    client_id: ANANDA,
    service_id: SVC_YOGA,
    variant_id: VARIAN_YOGA,
    tanggal: tanggalKe(i),
    preferensi_waktu: "pagi",
    status: "menunggu",
  }));
  const { error } = await admin.from("booking_requests").insert(baris);
  expect(error).toBeNull();
}

// Sejak Task 9 `booking_requests.variant_id` NOT NULL: id-nya lahir
// `gen_random_uuid()` saat migrasi/trigger berjalan, jadi tidak ada nilai
// tetap yang bisa ditulis literal di sini — dibaca dari basis data sekali di
// `beforeAll`. `VARIAN_LAIN` sengaja milik layanan LAIN (SVC_YOGA) dari
// `SVC_NUTRISI` yang dipakai skenario "menolak varian milik layanan lain".
let VARIAN_NUTRISI: string;
let VARIAN_YOGA: string;
let VARIAN_NONAKTIF: string;

beforeAll(async () => {
  sesiAnanda = await sesiSiapSerentak(await signInAs("ananda@padma.test"));
  ref.sesi = sesiAnanda;
  await bersihkanAnanda();
  VARIAN_NUTRISI = await varianBaku(admin, SVC_NUTRISI);
  VARIAN_YOGA = await varianBaku(admin, SVC_YOGA);
  VARIAN_NONAKTIF = await varianBaku(admin, SVC_NONAKTIF);
});

afterAll(async () => {
  await bersihkanAnanda();
  // Layanan dikembalikan aktif supaya berkas test lain (katalog, formulir
  // ajukan) tidak mewarisi katalog yang dipangkas di sini.
  await admin.from("services").update({ aktif: true }).eq("id", SVC_NONAKTIF);
});

beforeEach(async () => {
  ref.sesi = sesiAnanda;
  await bersihkanAnanda();
});

// `vi.stubGlobal` MENIMPA `globalThis.fetch` sepenuhnya — kalau ditimpa dengan
// mock yang menjawab APA SAJA, panggilan `geocodeAlamat` ke Supabase lokal
// (select/upsert `geocode_cache`) IKUT terbajak, bukan cuma panggilan ke
// Nominatim yang memang ingin dipalsukan. Dibuktikan langsung: men-stub penuh
// lalu memanggil Supabase lokal membuat query itu gagal (retry ~7 detik lalu
// {error}), yang berarti SELURUH query `ajukanJadwal` (cek layanan, varian,
// antrean, insert) ikut gagal — bukan cuma geocoding — dan `hasil.ok` akan
// `false` untuk alasan yang salah sama sekali. `stubNominatim` (pola yang sama
// dengan `tests/transport-geocode.test.ts`) menutup celah itu: hanya URL yang
// menyentuh Nominatim yang dijawab `palsu`; sisanya diteruskan ke `fetch` asli
// (di suite ini adalah pagar `tests/setup-fetch-guard.ts`, meloloskan
// 127.0.0.1 tempat Supabase lokal berada).
function stubNominatim(jawab: () => Promise<Response> | Response) {
  const asli = globalThis.fetch;
  const palsu = vi.fn(() => jawab());
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    return url.includes("nominatim") ? palsu() : asli(...args);
  });
  return palsu;
}

afterEach(() => {
  // Di `afterEach`, bukan di akhir badan tiap `it`: bila sebuah asersi gagal,
  // badan `it` berhenti di situ dan baris unstub di bawahnya tidak pernah
  // jalan — stub lantas bocor ke test berikutnya.
  vi.unstubAllGlobals();
});

describe("banjir antrean admin — batas permintaan 'menunggu' per klien", () => {
  it(`50 pengiriman SERENTAK lewat server action hanya menyisakan ${BATAS} baris`, async () => {
    const hasil = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        ajukanJadwal(
          formulir({ layanan: SVC_NUTRISI, varian: VARIAN_NUTRISI, tanggal: tanggalKe(i), waktu: "pagi" }),
        ),
      ),
    );

    // Basis data yang membuktikan, bukan nilai kembalian action.
    const baris = await barisAnanda();
    expect(baris).toHaveLength(BATAS);
    expect(hasil.filter((r) => r.ok)).toHaveLength(BATAS);
    // Invarian inti tetap: tak satu pun baris lolos dengan status istimewa.
    expect(baris.every((b) => b.status === "menunggu")).toBe(true);
  });

  it("permintaan ke-(BATAS+1) lewat action ditolak dengan pesan, bukan lemparan", async () => {
    await isiAntrean(BATAS);
    const r = await ajukanJadwal(
      formulir({ layanan: SVC_NUTRISI, varian: VARIAN_NUTRISI, tanggal: TGL_DEPAN, waktu: "sore" }),
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.pesan.length).toBeGreaterThan(0);
    expect(await barisAnanda()).toHaveLength(BATAS);
  });

  it("REST LANGSUNG (tanpa server action) juga ditolak basis data", async () => {
    // Klien memegang policy INSERT: ia bisa memanggil PostgREST dengan anon key
    // + JWT-nya sendiri. Pembatas yang hanya hidup di action tidak menutup ini.
    await isiAntrean(BATAS);
    const { error } = await sesiAnanda.from("booking_requests").insert({
      client_id: ANANDA,
      service_id: SVC_NUTRISI,
      variant_id: VARIAN_NUTRISI,
      tanggal: TGL_DEPAN,
      preferensi_waktu: "sore",
      status: "menunggu",
    });
    expect(error?.code).toBe("42501");
    expect(await barisAnanda()).toHaveLength(BATAS);
  });

  it(`50 insert REST SERENTAK (tanpa action sama sekali) tetap berhenti di ${BATAS}`, async () => {
    // Bentuk serangan asli red team, dijalankan pada lapis yang benar-benar
    // terbuka: klien memegang policy INSERT, jadi ia tidak wajib lewat server
    // action. Pemeriksaan pra-insert di TypeScript tidak ikut menolong di sini
    // — yang menahan hanyalah trigger + kunci advisory per klien.
    const hasil = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        sesiAnanda.from("booking_requests").insert({
          client_id: ANANDA,
          service_id: SVC_NUTRISI,
          variant_id: VARIAN_NUTRISI,
          tanggal: tanggalKe(i),
          preferensi_waktu: "pagi",
          status: "menunggu",
        }),
      ),
    );

    const baris = await barisAnanda();
    expect(baris).toHaveLength(BATAS);
    expect(hasil.filter((r) => r.error === null)).toHaveLength(BATAS);
    // Yang gagal harus gagal karena PENJAGA, bukan karena kebetulan.
    for (const r of hasil.filter((x) => x.error !== null)) {
      expect(r.error!.code).toBe("42501");
    }
    expect(baris.every((b) => b.status === "menunggu")).toBe(true);
  });

  it("permintaan yang sudah ditangani staf membebaskan kuota", async () => {
    // Batas menghitung ANTREAN, bukan riwayat: begitu staf menutup permintaan,
    // klien boleh mengajukan lagi. Kalau tidak, klien terkunci selamanya.
    await isiAntrean(BATAS);
    const semua = await barisAnanda();
    await admin
      .from("booking_requests")
      .update({ status: "ditolak" })
      .eq("id", semua[0].id);

    const r = await ajukanJadwal(
      formulir({ layanan: SVC_NUTRISI, varian: VARIAN_NUTRISI, tanggal: TGL_DEPAN, waktu: "sore" }),
    );
    expect(r.ok).toBe(true);
    expect(await menungguAnanda()).toHaveLength(BATAS);
  });

  it("staf TIDAK ikut terkunci pembatas klien", async () => {
    await isiAntrean(BATAS);
    const a = await signInAs("admin@padma.test");
    const { error } = await a.from("booking_requests").insert({
      client_id: ANANDA,
      service_id: SVC_NUTRISI,
      variant_id: VARIAN_NUTRISI,
      tanggal: TGL_DEPAN,
      preferensi_waktu: "sore",
      status: "menunggu",
    });
    expect(error).toBeNull();
    expect(await barisAnanda()).toHaveLength(BATAS + 1);
  });
});

describe("dedup — permintaan kembar tidak menggandakan antrean", () => {
  it("pengiriman identik kedua lewat action ditolak, hanya satu baris tersimpan", async () => {
    const pertama = await ajukanJadwal(
      formulir({ layanan: SVC_NUTRISI, varian: VARIAN_NUTRISI, tanggal: TGL_DEPAN, waktu: "pagi" }),
    );
    expect(pertama.ok).toBe(true);
    const kedua = await ajukanJadwal(
      formulir({ layanan: SVC_NUTRISI, varian: VARIAN_NUTRISI, tanggal: TGL_DEPAN, waktu: "pagi" }),
    );
    expect(kedua.ok).toBe(false);
    expect(await barisAnanda()).toHaveLength(1);
  });

  it("REST LANGSUNG: baris kembar ditolak unique index (23505)", async () => {
    const baris = {
      client_id: ANANDA,
      service_id: SVC_NUTRISI,
      variant_id: VARIAN_NUTRISI,
      tanggal: TGL_DEPAN,
      preferensi_waktu: "pagi",
      status: "menunggu",
    };
    const { error: pertama } = await sesiAnanda.from("booking_requests").insert(baris);
    expect(pertama).toBeNull();
    const { error: kedua } = await sesiAnanda.from("booking_requests").insert(baris);
    expect(kedua?.code).toBe("23505");
    expect(await barisAnanda()).toHaveLength(1);
  });

  it("index dedup hanya mengikat antrean, bukan riwayat", async () => {
    // Permintaan lama yang sudah ditolak tidak boleh menghalangi klien
    // mengajukan hal yang sama lagi.
    await admin.from("booking_requests").insert({
      client_id: ANANDA,
      service_id: SVC_NUTRISI,
      variant_id: VARIAN_NUTRISI,
      tanggal: TGL_DEPAN,
      preferensi_waktu: "pagi",
      status: "ditolak",
    });
    const r = await ajukanJadwal(
      formulir({ layanan: SVC_NUTRISI, varian: VARIAN_NUTRISI, tanggal: TGL_DEPAN, waktu: "pagi" }),
    );
    expect(r.ok).toBe(true);
    expect(await menungguAnanda()).toHaveLength(1);
  });

  it("unique index parsial memang ada di basis data", async () => {
    const baris = await querySql<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where schemaname = 'public' and tablename = 'booking_requests'
          and indexdef ilike '%unique%'`,
    );
    const def = baris.map((b) => b.indexdef).join("\n");
    for (const kolom of ["client_id", "service_id", "tanggal", "preferensi_waktu"]) {
      expect(def, `unique index dedup menyebut ${kolom}`).toContain(kolom);
    }
    expect(def).toMatch(/where\s+\(?status/i);
  });
});

describe("layanan nonaktif tidak bisa dipesan", () => {
  beforeEach(async () => {
    await admin.from("services").update({ aktif: false }).eq("id", SVC_NONAKTIF);
  });

  it("server action menolak service_id yang aktif=false", async () => {
    const r = await ajukanJadwal(
      formulir({ layanan: SVC_NONAKTIF, varian: VARIAN_NONAKTIF, tanggal: TGL_DEPAN, waktu: "pagi" }),
    );
    expect(r.ok).toBe(false);
    expect(await barisAnanda()).toHaveLength(0);
  });

  it("REST LANGSUNG juga ditolak basis data (FK hanya menolak yang tak ada)", async () => {
    const { error } = await sesiAnanda.from("booking_requests").insert({
      client_id: ANANDA,
      service_id: SVC_NONAKTIF,
      variant_id: VARIAN_NONAKTIF,
      tanggal: TGL_DEPAN,
      preferensi_waktu: "pagi",
      status: "menunggu",
    });
    expect(error?.code).toBe("42501");
    expect(await barisAnanda()).toHaveLength(0);
  });

  it("layanan yang kembali aktif bisa dipesan lagi", async () => {
    await admin.from("services").update({ aktif: true }).eq("id", SVC_NONAKTIF);
    const r = await ajukanJadwal(
      formulir({ layanan: SVC_NONAKTIF, varian: VARIAN_NONAKTIF, tanggal: TGL_DEPAN, waktu: "pagi" }),
    );
    expect(r.ok).toBe(true);
    expect(await barisAnanda()).toHaveLength(1);
  });
});

describe("tanggal lampau ditolak (bentuk YYYY-MM-DD saja tidak cukup)", () => {
  it("server action menolak 2020-01-01", async () => {
    const r = await ajukanJadwal(
      formulir({ layanan: SVC_NUTRISI, varian: VARIAN_NUTRISI, tanggal: TGL_LAMPAU, waktu: "pagi" }),
    );
    expect(r.ok).toBe(false);
    expect(await barisAnanda()).toHaveLength(0);
  });

  it("REST LANGSUNG juga ditolak basis data", async () => {
    const { error } = await sesiAnanda.from("booking_requests").insert({
      client_id: ANANDA,
      service_id: SVC_NUTRISI,
      variant_id: VARIAN_NUTRISI,
      tanggal: TGL_LAMPAU,
      preferensi_waktu: "pagi",
      status: "menunggu",
    });
    expect(error?.code).toBe("42501");
    expect(await barisAnanda()).toHaveLength(0);
  });

  it("HARI INI menurut kalender Jakarta masih diterima (batasnya >=, bukan >)", async () => {
    const hariIni = hariIniJakarta();
    const r = await ajukanJadwal(
      formulir({ layanan: SVC_NUTRISI, varian: VARIAN_NUTRISI, tanggal: hariIni, waktu: "pagi" }),
    );
    expect(r.ok).toBe(true);
    const baris = await barisAnanda();
    expect(baris).toHaveLength(1);
    expect(baris[0].tanggal).toBe(hariIni);
  });

  it("penjaga DB memakai kalender Asia/Jakarta, bukan jam server UTC", async () => {
    // Vercel berjalan UTC. Antara 17:00–24:00 UTC, tanggal Jakarta sudah
    // BESOK — kalau trigger memakai `current_date` server, permintaan untuk
    // "hari ini menurut klien" akan ditolak sebagai masa lalu.
    const [baris] = await querySql<{ jakarta: string }>(
      `select (now() at time zone 'Asia/Jakarta')::date::text as jakarta`,
    );
    expect(baris.jakarta).toBe(hariIniJakarta());
  });
});

// ---------------------------------------------------------------------------
// Task 9: jalur tulis wajib memilih varian
// ---------------------------------------------------------------------------
describe("varian wajib — pengajuan tanpa varian sah ditolak", () => {
  it("menolak pengajuan tanpa varian", async () => {
    const hasil = await ajukanJadwal(
      formulir({ layanan: SVC_NUTRISI, tanggal: TGL_DEPAN, waktu: "pagi" }),
    );
    expect(hasil.ok).toBe(false);
    expect(await barisAnanda()).toHaveLength(0);
  });

  it("menolak varian milik layanan lain", async () => {
    // VARIAN_YOGA milik SVC_YOGA, dipasangkan sengaja dengan SVC_NUTRISI —
    // FK gabungan `booking_requests_varian_milik_layanan` tetap lapisan
    // terakhir, tapi query di action ini yang wajib menolaknya lebih dulu
    // dengan KALIMAT, bukan kode Postgres.
    const hasil = await ajukanJadwal(
      formulir({
        layanan: SVC_NUTRISI,
        varian: VARIAN_YOGA,
        tanggal: TGL_DEPAN,
        waktu: "pagi",
      }),
    );
    expect(hasil.ok).toBe(false);
    // Bukti bahwa penolakan ini berasal dari QUERY PRA-INSERT (kalimat yang
    // bisa dibaca), bukan dari kegagalan FK gabungan yang jatuh sampai ke
    // pesan generik "Gagal mengirim permintaan." — bila query itu dihapus,
    // insert tetap gagal (FK tetap menahan) tetapi PESANNYA berubah, dan
    // hanya asersi pesan yang bisa menangkap itu.
    expect(hasil.ok === false && hasil.pesan).toBe("Varian tidak tersedia untuk layanan ini.");
    expect(await barisAnanda()).toHaveLength(0);
  });

  it("menyimpan variant_id yang dipilih", async () => {
    const hasil = await ajukanJadwal(
      formulir({
        layanan: SVC_NUTRISI,
        varian: VARIAN_NUTRISI,
        tanggal: TGL_DEPAN,
        waktu: "pagi",
      }),
    );
    expect(hasil.ok).toBe(true);
    const { data } = await admin
      .from("booking_requests")
      .select("variant_id")
      .eq("client_id", ANANDA)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(data!.variant_id).toBe(VARIAN_NUTRISI);
  });

  it("menolak varian yang sudah dinonaktifkan admin, walau tetap milik layanan yang benar", async () => {
    // Pasangan uji dari "layanan nonaktif tidak bisa dipesan" di bawah, untuk
    // VARIAN alih-alih layanan: menghapus `.eq("aktif", true)` dari query
    // varian akan meloloskan uji "menolak varian milik layanan lain" (varian
    // itu tetap TIDAK aktif) tapi tidak akan tertangkap sama sekali kalau
    // hanya diuji lewat pasangan layanan yang salah — kombinasi service_id +
    // variant_id di sini SAH, hanya `aktif`-nya yang dimatikan.
    await admin.from("service_variants").update({ aktif: false }).eq("id", VARIAN_NUTRISI);
    try {
      const hasil = await ajukanJadwal(
        formulir({
          layanan: SVC_NUTRISI,
          varian: VARIAN_NUTRISI,
          tanggal: TGL_DEPAN,
          waktu: "pagi",
        }),
      );
      expect(hasil.ok).toBe(false);
      expect(hasil.ok === false && hasil.pesan).toBe("Varian tidak tersedia untuk layanan ini.");
      expect(await barisAnanda()).toHaveLength(0);
    } finally {
      // Dikembalikan aktif: VARIAN_NUTRISI dipakai berkas ini di banyak test
      // lain, dan test-test itu tidak boleh mewarisi keadaan nonaktif.
      await admin.from("service_variants").update({ aktif: true }).eq("id", VARIAN_NUTRISI);
    }
  });
});

// ---------------------------------------------------------------------------
// Task 6: alamat pengajuan — WAJIB diisi, geocoding tidak pernah menggagalkan
// penyimpanan.
// ---------------------------------------------------------------------------
describe("alamat pengajuan jadwal (spec T6)", () => {
  // `geocode_cache` bertahan lintas run test lokal (bukan dibersihkan
  // `bersihkanAnanda`, yang hanya menyapu `booking_requests`). Tanpa
  // pembersihan ini, sisa cache dari run sebelumnya bisa menjawab lebih dulu
  // dan membuat asersi koordinat di bawah lulus/gagal karena alasan yang
  // sama sekali tidak berhubungan dengan stub Nominatim di test ini.
  beforeAll(async () => {
    await admin.from("geocode_cache").delete().in("alamat_normal", [
      normalkanAlamat("Jl. Uji Transport No. 7"),
      normalkanAlamat("Jl. Gang Sempit Tanpa Nama"),
    ]);
  });

  it("menolak pengajuan tanpa alamat", async () => {
    const hasil = await ajukanJadwal(
      formulir({ layanan: SVC_NUTRISI, varian: VARIAN_NUTRISI, tanggal: TGL_DEPAN, waktu: "pagi", alamat: "" }),
    );
    expect(hasil.ok).toBe(false);
    expect(await barisAnanda()).toHaveLength(0);
  });

  it("menolak alamat yang terlalu pendek untuk dituju mitra", async () => {
    const hasil = await ajukanJadwal(
      formulir({ layanan: SVC_NUTRISI, varian: VARIAN_NUTRISI, tanggal: TGL_DEPAN, waktu: "pagi", alamat: "rumah" }),
    );
    expect(hasil.ok).toBe(false);
    expect(await barisAnanda()).toHaveLength(0);
  });

  it("menyimpan alamat sesi beserta koordinatnya", async () => {
    const palsu = stubNominatim(() =>
      new Response(JSON.stringify([{ lat: "-6.9175", lon: "107.6191" }]), { status: 200 }),
    );

    const hasil = await ajukanJadwal(
      formulir({
        layanan: SVC_NUTRISI,
        varian: VARIAN_NUTRISI,
        tanggal: TGL_DEPAN,
        waktu: "pagi",
        alamat: "Jl. Uji Transport No. 7",
      }),
    );
    expect(hasil.ok).toBe(true);
    expect(palsu).toHaveBeenCalled();

    const baris = await admin
      .from("booking_requests")
      .select("alamat, alamat_lat, alamat_lon")
      .eq("client_id", ANANDA)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(baris.data!.alamat).toBe("Jl. Uji Transport No. 7");
    expect(baris.data!.alamat_lat).toBe(-6.9175);
    expect(baris.data!.alamat_lon).toBe(107.6191);
  });

  it("alamat TETAP tersimpan meski geocoding gagal (katup pengaman T6)", async () => {
    // Katup pengaman spec T6. Tanpa uji ini ia hanya niat di komentar kode.
    // Nominatim dipalsukan agar GAGAL — bukan `globalThis.fetch` PENUH (lihat
    // komentar `stubNominatim` di atas): stub penuh akan ikut menjatuhkan
    // panggilan Supabase lokal yang dipakai `ajukanJadwal` sendiri (cek
    // layanan, varian, antrean, insert), membuat `hasil.ok` bernilai `false`
    // untuk alasan yang SALAH SAMA SEKALI — bukan karena geocoding gagal.
    stubNominatim(async () => {
      throw new Error("jaringan mati");
    });

    const hasil = await ajukanJadwal(
      formulir({
        layanan: SVC_NUTRISI,
        varian: VARIAN_NUTRISI,
        tanggal: TGL_DEPAN,
        waktu: "pagi",
        alamat: "Jl. Gang Sempit Tanpa Nama",
      }),
    );
    expect(hasil.ok).toBe(true);

    const baris = await barisAnandaAlamat();
    expect(baris).toHaveLength(1);
    expect(baris[0].alamat).toBe("Jl. Gang Sempit Tanpa Nama");
    expect(baris[0].alamat_lat).toBeNull();
    expect(baris[0].alamat_lon).toBeNull();
  });
});

describe("pagar sumber — pembatas hidup di action DAN di basis data", () => {
  const sumber = baca("src/lib/passport/aksi.ts");

  it("action menyaring layanan dengan .eq(\"aktif\", true)", () => {
    expect(sumber).toContain('.eq("aktif", true)');
  });

  it("action membandingkan tanggal dengan hariIniJakarta(), tanpa aritmatika Date", () => {
    expect(sumber).toContain("hariIniJakarta");
    expect(sumber).not.toContain("toISOString");
    expect(sumber).not.toContain("setDate(");
    expect(sumber).not.toContain("getTime(");
  });

  it("batas antrean memakai konstanta bersama, bukan angka tercecer", () => {
    expect(sumber).toContain("BATAS_PERMINTAAN_MENUNGGU");
  });

  it("nilai status istimewa tetap tidak punya jalan masuk lewat berkas action", () => {
    // Assertion ini juga hidup di passport-bayar-ajukan.test.ts; diulang di
    // sini supaya penambahan pembatas tidak diam-diam membuka pintunya.
    expect(sumber).not.toContain("lunas");
    expect(sumber).not.toContain("dikonfirmasi");
    expect(sumber).toContain('status: "menunggu"');
  });

  it("fungsi trigger baru tidak bisa dieksekusi anon maupun PUBLIC", async () => {
    const bocor = await querySql<{ fungsi: string }>(
      `select p.proname as fungsi
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname like 'guard_booking%'
          and has_function_privilege('anon', p.oid, 'EXECUTE')`,
    );
    expect(bocor).toEqual([]);
  });
});
