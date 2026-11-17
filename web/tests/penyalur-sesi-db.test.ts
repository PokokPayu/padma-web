/**
 * Penyalur sesi (B3, spec §6.4): pesanan sesi yang LUNAS melahirkan sesinya
 * sendiri, tanpa klik "Konfirmasi jadwal".
 *
 * Yang dijaga di sini adalah kegagalan yang paling mahal di jalur ini:
 *
 *  - uang yang sudah masuk HILANG dari basis data karena penyalurnya melempar
 *    di tengah transaksi webhook (`terapkan_notifikasi_gateway` memanggil
 *    `salurkan_pesanan` di transaksi yang SAMA). Karena itu setiap jalan
 *    "tidak bisa melahirkan sesi" harus berakhir `sesi_tertahan` + tanda
 *    tinjauan, dan RPC-nya tetap `diterapkan`;
 *  - sesi yang lahir diam-diam padahal tidak boleh: bidan nonaktif, jam
 *    kunjungan sudah lewat, pengajuan sudah dibatalkan, pesanan belum lunas;
 *  - sesi yang lahir DUA kali untuk satu pengajuan (pesanan sesi membawa dua
 *    item, dan penyalurnya juga dipanggil ulang lewat tombol pemulihan);
 *  - pesanan lunas tanpa sesi yang hilang dari "Butuh perhatian".
 *
 * Semua fixture MILIK berkas ini (klien, layanan nonaktif, varian, tarif,
 * satu bidan bertitik): koordinat mitra seed dikosongkan berkas lain.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { dbUrl, querySql } from "./helpers/db";
import { skriningHijau } from "./helpers/skrining";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { geserHari } from "@/lib/owner/pekan";
import { rakitInvoice } from "@/lib/pesanan/order-id";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ref.sesi! }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
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

const { bacaPesananStaf } = await import("@/lib/admin/pesanan");
const { POST: terbitkanAkses } = await import("@/app/api/pesanan/[id]/terbitkan-akses/route");

const svc = createAdminSupabase();

const KLIEN = "44444444-4444-4444-4444-4444444443b3";
const PADMA_ID = "PAD-UJI-03B3";
const SVC_B3 = "11111111-1111-1111-1111-1111111113b3";
const VARIAN = "77777777-7777-7777-7777-7777777773b3";
const MITRA = "33333333-3333-3333-3333-3333333333b3";

// Titik bidan dan alamat berjarak 7,0 km (jenjang 5_10, tarif transport seed
// > 0), jadi pesanannya membawa DUA item untuk SATU pengajuan.
const TITIK_MITRA = { lat: -7.96662, lon: 112.632632 };
const ALAMAT = { teks: "Jl. Uji Penyalur Sesi No. 3", lat: -7.9666, lon: 112.6966 };
const HARGA_LAYANAN = 300_000;

const HARI_INI = hariIniJakarta();
const TGL_KUNJUNGAN = geserHari(HARI_INI, 3);

let sesiAdmin: SupabaseClient;

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

async function bersihkan(): Promise<void> {
  // Sesi DULU: `sessions.booking_request_id` (FK tanpa on delete) menahan
  // penghapusan pengajuan. Jejak audit sesi tanpa FK, jadi disapu sendiri
  // supaya tidak menjadi yatim (tests/jejak-yatim.test.ts).
  const { data: ss } = await svc.from("sessions").select("id").eq("client_id", KLIEN);
  const idSesi = (ss ?? []).map((s) => s.id as string);
  if (idSesi.length) {
    await svc.from("jejak_status_bayar").delete().in("sesi_id", idSesi);
    await svc.from("jejak_jadwal").delete().in("sesi_id", idSesi);
    const { error } = await svc.from("sessions").delete().in("id", idSesi);
    if (error) throw error;
  }
  const { data: ps } = await svc.from("orders").select("id").eq("client_id", KLIEN);
  const idPs = (ps ?? []).map((p) => p.id as string);
  if (idPs.length) {
    await svc.from("jejak_pesanan").delete().in("pesanan_id", idPs);
    await svc.from("notifikasi_pesanan").delete().in("pesanan_id", idPs);
    const { error } = await svc.from("orders").delete().in("id", idPs);
    if (error) throw error;
  }
  const { error: eb } = await svc.from("booking_requests").delete().eq("client_id", KLIEN);
  if (eb) throw eb;
  await svc.from("screenings").delete().eq("client_id", KLIEN);
}

async function wajib<T extends { error: unknown }>(p: PromiseLike<T>): Promise<T> {
  const hasil = await p;
  if (hasil.error) throw hasil.error;
  return hasil;
}

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  ref.sesi = sesiAdmin;

  await bersihkan();
  await svc.from("variant_rates").delete().eq("variant_id", VARIAN);
  await svc.from("service_variants").delete().eq("service_id", SVC_B3);
  await svc.from("services").delete().eq("id", SVC_B3);
  await svc.from("partners").delete().eq("id", MITRA);
  await svc.from("clients").delete().eq("id", KLIEN);

  await wajib(
    svc.from("clients").insert({
      id: KLIEN,
      padma_id: PADMA_ID,
      nama: "Klien Uji Penyalur Sesi",
      email: "uji-penyalur-sesi-b3@padma.test",
      phase_id: "prekonsepsi",
    }),
  );
  // Layanan NONAKTIF: tidak pernah muncul di katalog berkas lain.
  await wajib(
    svc.from("services").insert({
      id: SVC_B3,
      phase_id: "prekonsepsi",
      nama: "PAD-UJI Layanan Penyalur Sesi",
      deskripsi: "fixture",
      aktif: false,
    }),
  );
  await wajib(
    svc.from("service_variants").insert({ id: VARIAN, service_id: SVC_B3, label: "Uji B3", urutan: 90 }),
  );
  await wajib(
    svc.from("variant_rates").insert({
      variant_id: VARIAN,
      harga_klien: HARGA_LAYANAN,
      honor_mitra: 100_000,
      berlaku_sejak: "2026-01-01",
    }),
  );
  await wajib(
    svc.from("partners").insert({
      id: MITRA,
      nama: "PAD-UJI Bidan B3",
      no_hp: "0811-9300-0001",
      aktif: true,
      ...TITIK_MITRA,
    }),
  );
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  await bersihkan();
  // Dinonaktifkan oleh beberapa uji di bawah; setiap uji mulai dari bidan aktif.
  await wajib(svc.from("partners").update({ aktif: true }).eq("id", MITRA));
});

afterAll(async () => {
  await bersihkan();
  await svc.from("variant_rates").delete().eq("variant_id", VARIAN);
  await svc.from("service_variants").delete().eq("service_id", SVC_B3);
  await svc.from("services").delete().eq("id", SVC_B3);
  await svc.from("partners").delete().eq("id", MITRA);
  await svc.from("clients").delete().eq("id", KLIEN);
});

/**
 * Pengajuan `mitra_siap` lewat transisi SAH (diminta -> mencari_mitra ->
 * mitra_siap), lalu tagihannya diterbitkan sungguhan lewat
 * `terbitkan_tagihan_sesi` (B2) dengan sesi admin. Memulangkan id pengajuan
 * dan id pesanannya.
 */
async function pengajuanBertagihan(): Promise<{ id: string; pesananId: string }> {
  const skrining = await skriningHijau(svc, KLIEN);
  const { data } = await wajib(
    svc
      .from("booking_requests")
      .insert({
        client_id: KLIEN,
        service_id: SVC_B3,
        variant_id: VARIAN,
        tanggal: TGL_KUNJUNGAN,
        jam_mulai: "09:00",
        preferensi_waktu: "pagi",
        alamat: ALAMAT.teks,
        alamat_lat: ALAMAT.lat,
        alamat_lon: ALAMAT.lon,
        status: "diminta",
        screening_id: skrining,
      })
      .select("id")
      .single<{ id: string }>(),
  );
  const id = data!.id;
  await wajib(svc.from("booking_requests").update({ status: "mencari_mitra" }).eq("id", id));
  await wajib(
    svc.from("booking_requests").update({ status: "mitra_siap", partner_id: MITRA }).eq("id", id),
  );
  const { data: pesananId, error } = await sesiAdmin.rpc("terbitkan_tagihan_sesi", {
    p_permintaan_id: id,
  });
  if (error) throw error;
  return { id, pesananId: pesananId as string };
}

/**
 * Jawaban SUCCESS DOKU lewat `terapkan_notifikasi_gateway` sungguhan, sebagai
 * service role (persis webhook). Nominal bawaan = Σ harga_beku.
 */
async function lunasi(
  pesananId: string,
  opsi: { selisih?: number } = {},
): Promise<{ data: unknown; error: { code?: string; message?: string } | null }> {
  const [p] = await querySql<{ kode: string; percobaan: number; total: number }>(
    `select o.kode, o.percobaan,
            (select coalesce(sum(i.harga_beku), 0)::int from public.order_items i where i.pesanan_id = o.id) as total
       from public.orders o where o.id = $1`,
    [pesananId],
  );
  const { data, error } = await svc.rpc("terapkan_notifikasi_gateway", {
    p_invoice: rakitInvoice(p.kode, p.percobaan),
    p_status: "SUCCESS",
    p_transaksi_id: `trx-uji-b3-${randomUUID()}`,
    p_kanal: "VIRTUAL_ACCOUNT_BCA",
    p_nominal: p.total + (opsi.selisih ?? 0),
    p_sidik: randomUUID(),
    p_sumber: "webhook",
  });
  return { data, error };
}

/**
 * Keadaan pengajuan yang TIDAK BISA dibangun lewat jalur sah sesudah tagihan
 * terbit (B4 menutup pesanan terbuka begitu bidan, tanggal, jam, atau status
 * pengajuannya berubah), padahal penyalur tetap harus tahan terhadapnya:
 * jam yang lewat karena WAKTU berjalan, pengajuan yang batal, bidan yang
 * hilang. Dibangun dengan trigger dimatikan untuk SATU pernyataan saja
 * (`session_replication_role = replica`, lokal transaksi).
 */
async function paksaPengajuan(id: string, set: string, nilai: unknown[] = []): Promise<void> {
  const k = new Client({ connectionString: dbUrl() });
  await k.connect();
  try {
    await k.query("begin");
    await k.query("set local session_replication_role = replica");
    const hasil = await k.query(`update public.booking_requests set ${set} where id = $1`, [
      id,
      ...nilai,
    ]);
    if (hasil.rowCount !== 1) throw new Error(`paksaPengajuan mengenai ${hasil.rowCount} baris`);
    await k.query("commit");
  } catch (e) {
    await k.query("rollback").catch(() => {});
    throw e;
  } finally {
    await k.end();
  }
}

type BarisSesi = {
  status: string;
  status_bayar: string;
  booking_request_id: string;
  client_id: string;
  service_id: string;
  variant_id: string;
  partner_id: string | null;
  tanggal: string;
  jam_mulai: string;
  alamat: string;
  alamat_lat: number | null;
  alamat_lon: number | null;
  jenjang: string | null;
  jenjang_sumber: string | null;
  jenjang_alasan: string;
  kabari_bidan_sejak: Date | null;
};

async function sesiUntuk(id: string): Promise<BarisSesi[]> {
  return querySql<BarisSesi>(
    `select status::text, status_bayar::text, booking_request_id, client_id, service_id,
            variant_id, partner_id, tanggal::text, jam_mulai::text, alamat, alamat_lat,
            alamat_lon, jenjang::text, jenjang_sumber::text, jenjang_alasan, kabari_bidan_sejak
       from public.sessions where booking_request_id = $1`,
    [id],
  );
}

async function pengajuan(id: string) {
  const [b] = await querySql<{ status: string; status_bayar: string }>(
    `select status::text, status_bayar::text from public.booking_requests where id = $1`,
    [id],
  );
  return b;
}

async function pesanan(pesananId: string) {
  const [o] = await querySql<{
    kode: string;
    status: string;
    lunas_pada: Date | null;
    butuh_tinjauan_pada: Date | null;
    sebab_tinjauan: string | null;
  }>(
    `select kode, status::text, lunas_pada, butuh_tinjauan_pada, sebab_tinjauan
       from public.orders where id = $1`,
    [pesananId],
  );
  return o;
}

/** Kejadian jejak, DIURUTKAN abjad: dalam satu transaksi `dibuat_pada` seri. */
async function kejadian(pesananId: string): Promise<string[]> {
  const baris = await querySql<{ kejadian: string }>(
    `select kejadian::text from public.jejak_pesanan where pesanan_id = $1`,
    [pesananId],
  );
  return baris.map((b) => b.kejadian).sort();
}

async function keteranganTertahan(pesananId: string): Promise<string[]> {
  const baris = await querySql<{ keterangan: string }>(
    `select keterangan from public.jejak_pesanan where pesanan_id = $1 and kejadian = 'sesi_tertahan'`,
    [pesananId],
  );
  return baris.map((b) => b.keterangan);
}

async function uangTercatat(pesananId: string): Promise<boolean> {
  const [b] = await querySql<{ n: number }>(
    `select count(*)::int as n from public.notifikasi_pesanan where pesanan_id = $1 and status_gateway = 'SUCCESS'`,
    [pesananId],
  );
  return b.n === 1;
}

const salurkanSesi = (pesananId: string) => svc.rpc("salurkan_sesi", { p_pesanan_id: pesananId });

function permintaanRute(): Request {
  return new Request("http://127.0.0.1/api/pesanan/x/terbitkan-akses", { method: "POST" });
}
const param = (id: string) => ({ params: Promise.resolve({ id }) });

type JawabanRute = {
  terbit: string[];
  belumAdaPenangan: number[];
  sesi: string | null;
  pesan: string;
};

async function rute(pesananId: string): Promise<{ status: number; isi: JawabanRute }> {
  const r = await terbitkanAkses(permintaanRute(), param(pesananId));
  return { status: r.status, isi: (await r.json()) as JawabanRute };
}

/** Pesanan lunas yang sesinya tertahan karena bidannya nonaktif saat uang masuk. */
async function pesananTertahan(): Promise<{ id: string; pesananId: string }> {
  const t = await pengajuanBertagihan();
  await wajib(svc.from("partners").update({ aktif: false }).eq("id", MITRA));
  const { data, error } = await lunasi(t.pesananId);
  expect(error).toBeNull();
  expect(data).toBe("diterapkan");
  expect(await sesiUntuk(t.id)).toEqual([]);
  return t;
}

// ---------------------------------------------------------------------------
// Lunas -> sesi lahir
// ---------------------------------------------------------------------------

describe("SUCCESS DOKU melahirkan sesi lewat penyalur", () => {
  it("satu sesi terjadwal & lunas, disalin dari pengajuan, bertanda kabari bidan; pengajuan dikonfirmasi; jejak sesi_terkonfirmasi; tanpa tinjauan", async () => {
    const { id, pesananId } = await pengajuanBertagihan();
    // Dua item (layanan + transport) untuk SATU pengajuan: sesi tetap satu.
    const [item] = await querySql<{ n: number }>(
      `select count(*)::int as n from public.order_items where pesanan_id = $1 and jenis = 'sesi'`,
      [pesananId],
    );
    expect(item.n).toBe(2);

    const { data, error } = await lunasi(pesananId);
    expect(error).toBeNull();
    expect(data).toBe("diterapkan");

    const sesi = await sesiUntuk(id);
    expect(sesi).toHaveLength(1);
    const { kabari_bidan_sejak, ...isi } = sesi[0];
    expect(isi).toEqual({
      status: "terjadwal",
      status_bayar: "lunas",
      booking_request_id: id,
      client_id: KLIEN,
      service_id: SVC_B3,
      variant_id: VARIAN,
      partner_id: MITRA,
      tanggal: TGL_KUNJUNGAN,
      jam_mulai: "09:00:00",
      alamat: ALAMAT.teks,
      alamat_lat: ALAMAT.lat,
      alamat_lon: ALAMAT.lon,
      jenjang: "5_10",
      jenjang_sumber: "otomatis",
      jenjang_alasan: "",
    });
    // Penanda lahir di transaksi YANG SAMA dengan pelunasan: now() keduanya sama.
    expect(kabari_bidan_sejak).not.toBeNull();
    const o = await pesanan(pesananId);
    expect(kabari_bidan_sejak!.getTime()).toBe(o.lunas_pada!.getTime());

    expect(await pengajuan(id)).toEqual({ status: "dikonfirmasi", status_bayar: "lunas" });
    expect(o.status).toBe("lunas");
    expect(o.butuh_tinjauan_pada).toBeNull();
    expect(o.sebab_tinjauan).toBeNull();
    // `penangan_belum_ada` tidak lagi ditulis untuk item sesi.
    expect(await kejadian(pesananId)).toEqual(
      ["dibuat", "lunas", "notifikasi", "sesi_terkonfirmasi"].sort(),
    );
  });

  it("pesanan sesi yang sesinya sudah lahir TIDAK muncul di Butuh perhatian", async () => {
    const { pesananId } = await pengajuanBertagihan();
    expect((await lunasi(pesananId)).data).toBe("diterapkan");
    const { kode } = await pesanan(pesananId);
    const { butuhPerhatian } = await bacaPesananStaf();
    expect(butuhPerhatian.map((p) => p.kode)).not.toContain(kode);
  });

  it("penyalur MENGUNCI baris pengajuan (for update) sesudah pesanan: pemegang kunci menahan pelunasan", async () => {
    // FOR KEY SHARE hanya bertabrakan dengan FOR UPDATE. UPDATE status
    // pengajuan (FOR NO KEY UPDATE) dan FK sisipan sesi (FOR KEY SHARE) TIDAK
    // tertahan olehnya, jadi satu-satunya yang bisa membuat pelunasan
    // menunggu di sini adalah `select … for update` penyalur.
    const { id, pesananId } = await pengajuanBertagihan();
    const pemegang = new Client({ connectionString: dbUrl() });
    await pemegang.connect();
    let selesai = false;
    let janji: ReturnType<typeof lunasi> | null = null;
    try {
      await pemegang.query("begin");
      await pemegang.query(`select 1 from public.booking_requests where id = $1 for key share`, [id]);
      janji = lunasi(pesananId).then((r) => {
        selesai = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 750));
      expect(selesai).toBe(false);
    } finally {
      await pemegang.query("rollback").catch(() => {});
      await pemegang.end();
    }
    const hasil = await janji!;
    expect(hasil.error).toBeNull();
    expect(hasil.data).toBe("diterapkan");
    expect(await sesiUntuk(id)).toHaveLength(1);
  });

  it("URUTAN KUNCI pesanan -> pengajuan: penyalur yang menunggu baris pengajuan SUDAH memegang pesanannya", async () => {
    // Ruling 4: `terbitkan_tagihan_sesi` memegang pesanan-pesanan pengajuan
    // lalu menunggu baris pengajuannya. Penyalur yang mengunci pengajuan
    // LEBIH DULU lalu pesanan membalik urutan itu: deadlock. Uji kunci di atas
    // hanya membuktikan pengajuan dikunci FOR UPDATE; yang ini membuktikan
    // URUTANNYA. A memegang baris pengajuan (seperti `terbitkan_tagihan_sesi`
    // di tengah jalan), B menjalankan penyalur dan harus tertahan di sana —
    // dan saat tertahan, pesanannya sudah ia kunci.
    const { id, pesananId } = await pengajuanBertagihan();
    const a = new Client({ connectionString: dbUrl() });
    const b = new Client({ connectionString: dbUrl() });
    await a.connect();
    await b.connect();
    let janjiB: Promise<unknown> | null = null;
    try {
      await a.query("begin");
      await a.query(`select 1 from public.booking_requests where id = $1 for update`, [id]);

      const pidB = (await b.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      await b.query("begin");
      janjiB = b.query(`select public.salurkan_sesi($1) as hasil`, [pesananId]);
      janjiB.catch(() => {});

      // B benar-benar MENUNGGU kunci (bukan sekadar belum sempat berjalan).
      // Dibaca lewat koneksi baru: pg_stat_activity dibekukan per transaksi.
      let menunggu = false;
      for (let i = 0; i < 100 && !menunggu; i++) {
        const [s] = await querySql<{ w: string | null }>(
          `select wait_event_type as w from pg_stat_activity where pid = $1`,
          [pidB],
        );
        menunggu = s?.w === "Lock";
        if (!menunggu) await new Promise((r) => setTimeout(r, 50));
      }
      expect(menunggu).toBe(true);

      await a.query("savepoint coba");
      const galat = await a
        .query(`select 1 from public.orders where id = $1 for update nowait`, [pesananId])
        .then(
          () => null,
          (e: { code?: string }) => e,
        );
      // 55P03 lock_not_available: baris pesanan dipegang B, yang sedang
      // menunggu pengajuan — pesanan dikunci lebih dulu.
      expect(galat?.code).toBe("55P03");
      await a.query("rollback to savepoint coba");
    } finally {
      await a.query("rollback").catch(() => {});
      await a.end();
      if (janjiB) await janjiB.catch(() => {});
      await b.query("rollback").catch(() => {});
      await b.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Syarat gagal -> sesi_tertahan, uang TETAP tercatat
// ---------------------------------------------------------------------------

describe("syarat §6.4 gagal: sesi_tertahan + tinjauan, RPC tetap diterapkan", () => {
  it("bidan dinonaktifkan sebelum notifikasi: lunas tercatat, nol sesi, pengajuan tetap menunggu_bayar", async () => {
    const { id, pesananId } = await pesananTertahan();

    const o = await pesanan(pesananId);
    expect(o.status).toBe("lunas");
    expect(await uangTercatat(pesananId)).toBe(true);
    expect(o.butuh_tinjauan_pada).not.toBeNull();
    expect(o.sebab_tinjauan).toBe("sesi_tertahan");
    expect(await kejadian(pesananId)).toContain("sesi_tertahan");
    expect(await keteranganTertahan(pesananId)).toEqual([expect.stringMatching(/bidan .*nonaktif/)]);
    expect(await pengajuan(id)).toEqual({ status: "menunggu_bayar", status_bayar: "belum" });
  });

  it("galat tak terduga di dalam penyalur (bidan dilepas dari pengajuan lewat service role): RPC TETAP diterapkan, uangnya tidak hilang", async () => {
    // Pengajuan menunggu_bayar tanpa bidan adalah keadaan mustahil; penyalur
    // melemparnya, dan blok `exception when others` yang menangkapnya. Tanpa
    // blok itu RPC webhook melempar, transaksinya digulung, dan pelunasan yang
    // sudah dibayar klien lenyap dari basis data.
    const { id, pesananId } = await pengajuanBertagihan();
    await paksaPengajuan(id, "partner_id = null");

    const { data, error } = await lunasi(pesananId);
    expect(error).toBeNull();
    expect(data).toBe("diterapkan");

    const o = await pesanan(pesananId);
    expect(o.status).toBe("lunas");
    expect(await uangTercatat(pesananId)).toBe(true);
    expect(o.sebab_tinjauan).toBe("sesi_tertahan");
    expect(await keteranganTertahan(pesananId)).toEqual([expect.stringMatching(/^galat: .*tanpa mitra/)]);
    expect(await sesiUntuk(id)).toEqual([]);
    // Subtransaksi digulung utuh: tidak ada setengah konfirmasi yang tertinggal.
    expect(await pengajuan(id)).toEqual({ status: "menunggu_bayar", status_bayar: "belum" });
  });

  it("galat SESUDAH pengajuan diperbarui (sisipan sesi ditolak FK varian): pembaruan pengajuan ikut digulung, uang tetap tercatat", async () => {
    // Uji di atas gagal SEBELUM satu tulisan pun, jadi ia tidak bisa
    // membuktikan penggulungan. Di sini keempat syarat lolos, pengajuan sudah
    // dipindah ke `dikonfirmasi`/`lunas`, lalu sisipan `sessions` ditolak FK
    // `sessions_varian_milik_layanan` (varian pengajuan dibuat tidak ada;
    // FK pengajuan sendiri dilewati mode replika). Yang tidak boleh tertinggal:
    // pengajuan `dikonfirmasi` tanpa sesi — keadaan yang membuat penyalur
    // berikutnya menolak dengan "tidak lagi menunggu pembayaran".
    const { id, pesananId } = await pengajuanBertagihan();
    await paksaPengajuan(id, "variant_id = $2", [randomUUID()]);

    const { data, error } = await lunasi(pesananId);
    expect(error).toBeNull();
    expect(data).toBe("diterapkan");

    const o = await pesanan(pesananId);
    expect(o.status).toBe("lunas");
    expect(await uangTercatat(pesananId)).toBe(true);
    expect(o.butuh_tinjauan_pada).not.toBeNull();
    expect(o.sebab_tinjauan).toBe("sesi_tertahan");
    // Galatnya dari SISIPAN, bukan dari pemeriksaan syarat.
    expect(await keteranganTertahan(pesananId)).toEqual([
      expect.stringMatching(/^galat: .*sessions_varian_milik_layanan/),
    ]);
    expect(await sesiUntuk(id)).toEqual([]);
    expect(await pengajuan(id)).toEqual({ status: "menunggu_bayar", status_bayar: "belum" });
  });

  it("jam kunjungan sudah lewat saat uang mendarat -> tertahan, tidak ada sesi di masa lalu", async () => {
    const { id, pesananId } = await pengajuanBertagihan();
    await paksaPengajuan(id, "tanggal = $2", [geserHari(HARI_INI, -1)]);

    const { data, error } = await lunasi(pesananId);
    expect(error).toBeNull();
    expect(data).toBe("diterapkan");
    expect(await sesiUntuk(id)).toEqual([]);
    expect((await pesanan(pesananId)).sebab_tinjauan).toBe("sesi_tertahan");
    expect(await keteranganTertahan(pesananId)).toEqual([expect.stringMatching(/jam kunjungan .*sudah lewat/)]);
    expect(await pengajuan(id)).toEqual({ status: "menunggu_bayar", status_bayar: "belum" });
  });

  it("jam kunjungan dibaca sebagai jam dinding JAKARTA: kunjungan 1–1,5 jam lalu (WIB) sudah lewat", async () => {
    // Dibaca UTC, jam dinding yang sama baru tiba ~6 jam lagi, dan sesi di
    // masa lalu lahir tanpa satu galat pun. Basis data dan Vercel berjalan UTC.
    const SETENGAH_JAM = 30 * 60_000;
    const instan = Math.floor((Date.now() - 60 * 60_000) / SETENGAH_JAM) * SETENGAH_JAM;
    const iso = new Date(instan + 7 * 3_600_000).toISOString();
    const tanggal = iso.slice(0, 10);
    const jam = iso.slice(11, 16);
    expect(Date.parse(`${tanggal}T${jam}:00+07:00`)).toBe(instan);

    const { id, pesananId } = await pengajuanBertagihan();
    await paksaPengajuan(id, "tanggal = $2, jam_mulai = $3", [tanggal, jam]);

    expect((await lunasi(pesananId)).data).toBe("diterapkan");
    expect(await sesiUntuk(id)).toEqual([]);
    expect(await keteranganTertahan(pesananId)).toEqual([expect.stringMatching(/jam kunjungan .*sudah lewat/)]);
  });

  it("pengajuan sudah tidak menunggu_bayar (dibatalkan) -> tertahan dengan alasannya sendiri", async () => {
    const { id, pesananId } = await pengajuanBertagihan();
    await paksaPengajuan(id, "status = 'dibatalkan_tenggat'");

    expect((await lunasi(pesananId)).data).toBe("diterapkan");
    expect(await sesiUntuk(id)).toEqual([]);
    // Alasan SPESIFIK, bukan `galat: …` dari penjaga perpindahan status yang
    // kebetulan juga menolak dibatalkan_tenggat -> dikonfirmasi.
    expect(await keteranganTertahan(pesananId)).toEqual([
      expect.stringMatching(/^pengajuan tidak lagi menunggu pembayaran/),
    ]);
    expect((await pengajuan(id)).status).toBe("dibatalkan_tenggat");
  });

  it("pesanan belum lunas (penyalur dipanggil langsung) -> tertahan, nol sesi", async () => {
    const { id, pesananId } = await pengajuanBertagihan();
    const { data, error } = await salurkanSesi(pesananId);
    expect(error).toBeNull();
    expect(data).toBe("tertahan");
    expect(await sesiUntuk(id)).toEqual([]);
    expect(await keteranganTertahan(pesananId)).toEqual([expect.stringMatching(/pesanan .*bukan lunas/)]);
    expect(await pengajuan(id)).toEqual({ status: "menunggu_bayar", status_bayar: "belum" });
  });

  it("tinjauan yang sudah menyala dengan sebab lain TIDAK ditimpa (coalesce lestari)", async () => {
    const { pesananId } = await pengajuanBertagihan();
    await querySql(
      `update public.orders set sebab_tinjauan = 'selisih_status', butuh_tinjauan_pada = now() where id = $1`,
      [pesananId],
    );
    await wajib(svc.from("partners").update({ aktif: false }).eq("id", MITRA));
    expect((await lunasi(pesananId)).data).toBe("diterapkan");
    expect(await kejadian(pesananId)).toContain("sesi_tertahan");
    expect((await pesanan(pesananId)).sebab_tinjauan).toBe("selisih_status");
  });

  it("pesanan yang tidak ada: tidak melempar, tidak meninggalkan jejak yatim", async () => {
    const hantu = randomUUID();
    const { data, error } = await salurkanSesi(hantu);
    expect(error).toBeNull();
    expect(data).toBe("tertahan");
    expect(await kejadian(hantu)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pemulihan oleh staf
// ---------------------------------------------------------------------------

describe("pemulihan: penyalur dijalankan ulang", () => {
  it("bidan diaktifkan lagi -> terkonfirmasi; panggilan kedua -> sudah_ada, tetap satu sesi", async () => {
    const { id, pesananId } = await pesananTertahan();
    await wajib(svc.from("partners").update({ aktif: true }).eq("id", MITRA));

    const pertama = await salurkanSesi(pesananId);
    expect(pertama.error).toBeNull();
    expect(pertama.data).toBe("terkonfirmasi");
    expect(await sesiUntuk(id)).toHaveLength(1);
    expect((await sesiUntuk(id))[0].kabari_bidan_sejak).not.toBeNull();
    expect(await pengajuan(id)).toEqual({ status: "dikonfirmasi", status_bayar: "lunas" });

    const kedua = await salurkanSesi(pesananId);
    expect(kedua.error).toBeNull();
    expect(kedua.data).toBe("sudah_ada");
    expect(await sesiUntuk(id)).toHaveLength(1);
  });

  it("rute terbitkan-akses sebagai admin: sesi terkonfirmasi, lalu sudah_ada; item sesi tidak lagi 'belum punya penangan'", async () => {
    const { id, pesananId } = await pesananTertahan();
    await wajib(svc.from("partners").update({ aktif: true }).eq("id", MITRA));

    const satu = await rute(pesananId);
    expect(satu.status).toBe(200);
    expect(satu.isi.sesi).toBe("terkonfirmasi");
    expect(satu.isi.terbit).toEqual([]);
    expect(satu.isi.belumAdaPenangan).toEqual([]);
    expect(satu.isi.pesan).toMatch(/sesi/i);
    expect(await sesiUntuk(id)).toHaveLength(1);

    const dua = await rute(pesananId);
    expect(dua.status).toBe(200);
    expect(dua.isi.sesi).toBe("sudah_ada");
    expect(await sesiUntuk(id)).toHaveLength(1);
  });

  it('putusan staf "lunas" atas pesanan sesi ditahan TIDAK menyalurkan; pesanannya tetap di Butuh perhatian sampai rute membuat sesinya', async () => {
    const { id, pesananId } = await pengajuanBertagihan();
    // Nominal meleset -> ditahan (selisih_nominal), penyalur tidak berjalan.
    expect((await lunasi(pesananId, { selisih: 1 })).data).toBe("diterapkan");
    expect((await pesanan(pesananId)).status).toBe("ditahan");

    const putus = await sesiAdmin.rpc("putuskan_pesanan_ditahan", {
      p_pesanan_id: pesananId,
      p_putusan: "lunas",
    });
    expect(putus.error).toBeNull();
    expect((await pesanan(pesananId)).status).toBe("lunas");
    expect(await sesiUntuk(id)).toEqual([]);

    // Tanda tinjauan ditutup: yang menahan barisnya di layar kini HANYA
    // klausa "uang masuk, sesi belum ada".
    expect((await sesiAdmin.rpc("tutup_tinjauan", { p_pesanan_id: pesananId })).error).toBeNull();
    const { kode } = await pesanan(pesananId);
    expect((await bacaPesananStaf()).butuhPerhatian.map((p) => p.kode)).toContain(kode);

    const r = await rute(pesananId);
    expect(r.status).toBe(200);
    expect(r.isi.sesi).toBe("terkonfirmasi");
    expect(await sesiUntuk(id)).toHaveLength(1);
    expect((await bacaPesananStaf()).butuhPerhatian.map((p) => p.kode)).not.toContain(kode);
  });
});

// ---------------------------------------------------------------------------
// Hak akses
// ---------------------------------------------------------------------------

describe("penyalur dan sisipannya tertutup bagi pemegang sesi", () => {
  it.each([
    "public.salurkan_sesi(uuid)",
    "public.sisipkan_sesi_dari_permintaan(uuid, boolean)",
  ])("%s tidak bisa dieksekusi anon maupun authenticated", async (fungsi) => {
    const [hak] = await querySql<{ anon: boolean; authenticated: boolean }>(
      `select has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as authenticated`,
      [fungsi],
    );
    expect(hak).toEqual({ anon: false, authenticated: false });
  });

  it("admin pun tidak bisa memanggil salurkan_sesi lewat RPC", async () => {
    const { pesananId } = await pengajuanBertagihan();
    const { error } = await sesiAdmin.rpc("salurkan_sesi", { p_pesanan_id: pesananId });
    expect(error).not.toBeNull();
    expect(await kejadian(pesananId)).not.toContain("sesi_tertahan");
  });
});
