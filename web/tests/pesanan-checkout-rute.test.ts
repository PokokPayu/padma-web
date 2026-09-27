/**
 * CHECKOUT — dua rute tipis, dipanggil SUNGGUHAN dengan sesi sungguhan.
 *
 * Yang dijaga di sini bukan "rutenya mengembalikan 200", melainkan lima hal
 * yang masing-masing pernah menjadi cara alur pembayaran gagal diam-diam:
 *
 *   1. `order_id` yang dikirim ke Snap = `kode.percobaan`. Midtrans menolak
 *      `order_id` kembar SELAMANYA; salah merakitnya berarti percobaan kedua
 *      mustahil dan pembeli terkunci sampai tenggatnya lewat.
 *   2. `expiry` Snap memakai konstanta yang SAMA dengan `kedaluwarsa_pada`.
 *      Dua angka yang berbeda = dua kegagalan simetris (lihat spec).
 *   3. Rute tidak pernah memakai service role. Yang memilih `client_id` adalah
 *      `auth.uid()` DI DALAM RPC — pemeriksaan yang hanya hidup di TypeScript
 *      bisa dilewati dengan satu panggilan langsung ke PostgREST.
 *   4. Pemegang sesi lain tidak bisa membatalkan pesanan orang.
 *   5. GERBANG BELI ULANG YANG SUDAH DILEBARKAN menolak checkout kedua, dan
 *      penolakannya sampai ke pembeli sebagai 409 berkalimat — bukan 200.
 *      Lihat dokblok `describe`-nya di bawah: pelebaran itu perbaikan tagihan
 *      ganda yang nyata, dan sampai berkas ini lahir tidak satu pun uji
 *      menjalankannya LEWAT RUTE.
 *
 * Adapter Midtrans DI-MOCK. `tests/setup-fetch-guard.ts` tidak disunting: suite
 * ini tidak punya izin — dan tidak butuh — menembak Snap sungguhan.
 *
 * Pembersihan `jejak_pesanan`/`notifikasi_pesanan` WAJIB (keduanya sengaja tanpa
 * foreign key). Tanpa itu `tests/pesanan-jejak-yatim.test.ts` merah, di berkas
 * orang lain.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signInAs } from "./helpers/as-user";
// Klien KEDUA ber-akun auth, lahir di Tugas 4 (`tests/helpers/klien-kedua.ts`).
// Tanpa ia, "pemegang sesi lain tidak bisa membatalkan pesanan orang" hanya
// bisa ditulis dengan sesi admin — dan admin menabrak gerbang yang SAMA SEKALI
// BERBEDA (lihat kasusnya di bawah).
import {
  EMAIL_KLIEN_KEDUA,
  siapkanKlienKedua,
  bongkarKlienKedua,
} from "./helpers/klien-kedua";

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

type HasilSnap = { ok: true; token: string } | { ok: false; pesan: string };

const ref = vi.hoisted(() => ({
  sesi: null as SupabaseClient | null,
  snap: { ok: true, token: "snap-token-uji" } as { ok: true; token: string } | { ok: false; pesan: string },
  diterima: null as null | { orderId: string; nominal: number; judul: string; kedaluwarsaJam: number },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));
vi.mock("@/lib/midtrans/adapter", () => ({
  terbitkanTokenSnap: async (p: { orderId: string; nominal: number; judul: string; kedaluwarsaJam: number }): Promise<HasilSnap> => {
    ref.diterima = p;
    return ref.snap;
  },
  bacaStatusTransaksi: async () => ({ ok: false, kode: 0, pesan: "tidak dipakai di berkas ini" }),
}));

const { POST: checkout } = await import("@/app/api/pesanan/checkout/route");
const { POST: batal } = await import("@/app/api/pesanan/[id]/batal/route");
const { POLA_KODE_PESANAN, rakitOrderId } = await import("@/lib/pesanan/order-id");
const { JAM_TENGGAT_PESANAN } = await import("@/lib/pesanan/status");

const KLIEN = "ananda@padma.test";
/** Akun BERPROFIL tapi TANPA baris `clients` — gerbang identitas, bukan kepemilikan. */
const TANPA_REKAM_KLIEN = "admin@padma.test";

let produkA = "";
let produkB = "";
let clientId = "";

async function semaiProduk(slug: string, harga: number): Promise<string> {
  const { data } = await svc
    .from("digital_products")
    .insert({ judul: `PAD-UJI ${slug}`, slug, jenis: "pdf", aktif: true })
    .select("id")
    .single<{ id: string }>();
  await svc.from("digital_product_files").insert({
    product_id: data!.id, objek: `${data!.id}/isi.pdf`, mime: "application/pdf", byte: 1024,
  });
  await svc.from("digital_product_prices").insert({ product_id: data!.id, harga });
  return data!.id;
}

async function sapuPesanan(): Promise<void> {
  const { data } = await svc.from("orders").select("id").eq("client_id", clientId);
  const id = (data ?? []).map((b) => (b as { id: string }).id);
  await svc.from("digital_entitlements").delete().in("product_id", [produkA, produkB]);
  if (id.length) {
    await svc.from("orders").delete().in("id", id);
    await svc.from("jejak_pesanan").delete().in("pesanan_id", id);
    await svc.from("notifikasi_pesanan").delete().in("pesanan_id", id);
  }
}

beforeAll(async () => {
  for (const slug of ["pad-uji-checkout-a", "pad-uji-checkout-b"]) {
    await svc.from("digital_products").delete().eq("slug", slug);
  }
  produkA = await semaiProduk("pad-uji-checkout-a", 150_000);
  produkB = await semaiProduk("pad-uji-checkout-b", 75_000);
  await siapkanKlienKedua();
  const { data } = await svc.from("clients").select("id").eq("email", KLIEN).maybeSingle<{ id: string }>();
  clientId = data!.id;
});

afterAll(async () => {
  await sapuPesanan();
  await bongkarKlienKedua();
  await svc.from("digital_products").delete().in("id", [produkA, produkB]);
});

beforeEach(async () => {
  ref.snap = { ok: true, token: "snap-token-uji" };
  ref.diterima = null;
  ref.sesi = await signInAs(KLIEN);
  await sapuPesanan();
});

function mintaCheckout(badan: unknown): Request {
  return new Request("http://127.0.0.1/api/pesanan/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof badan === "string" ? badan : JSON.stringify(badan),
  });
}

function mintaBatal(): Request {
  return new Request("http://127.0.0.1/api/pesanan/x/batal", { method: "POST" });
}

describe("POST /api/pesanan/checkout", () => {
  it("tanpa sesi -> 401, dan NOL pesanan lahir", async () => {
    ref.sesi = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const jawab = await checkout(mintaCheckout({ productId: produkA }));
    expect(jawab.status).toBe(401);

    const { data } = await svc.from("orders").select("id").eq("client_id", clientId);
    expect(data ?? []).toEqual([]);
  });

  it("badan tanpa productId -> 400", async () => {
    expect((await checkout(mintaCheckout({}))).status).toBe(400);
    expect((await checkout(mintaCheckout("{bukan json"))).status).toBe(400);
  });

  it("produk berbayar -> 200 dengan token, kode, pesananId, produksi", async () => {
    const jawab = await checkout(mintaCheckout({ productId: produkA }));
    expect(jawab.status).toBe(200);
    const isi = (await jawab.json()) as { token: string; kode: string; pesananId: string; produksi: boolean };

    expect(isi.token).toBe("snap-token-uji");
    expect(isi.kode).toMatch(POLA_KODE_PESANAN);
    expect(isi.produksi).toBe(false);

    const { data } = await svc
      .from("orders")
      .select("id, status, client_id, snap_token, jumlah_item")
      .eq("id", isi.pesananId)
      .single<{ id: string; status: string; client_id: string; snap_token: string | null; jumlah_item: number }>();
    expect(data!.status).toBe("menunggu_bayar");
    // `client_id` dipilih RPC dari auth.uid(), bukan dikirim rute.
    expect(data!.client_id).toBe(clientId);
    expect(data!.snap_token).toBe("snap-token-uji");
    expect(data!.jumlah_item).toBe(1);
  });

  it("order_id yang dikirim ke Snap = kode.percobaan, dan expiry = JAM_TENGGAT_PESANAN", async () => {
    // Dua invarian yang tidak punya bentuk lain untuk diperiksa: keduanya hidup
    // di ARGUMEN yang dioper ke Midtrans, bukan di baris basis data mana pun.
    const jawab = await checkout(mintaCheckout({ productId: produkA }));
    const isi = (await jawab.json()) as { kode: string };

    expect(ref.diterima).not.toBeNull();
    expect(ref.diterima!.orderId).toBe(rakitOrderId(isi.kode, 1));
    expect(ref.diterima!.kedaluwarsaJam).toBe(JAM_TENGGAT_PESANAN);
    expect(ref.diterima!.nominal).toBe(150_000);
  });

  it("Snap menolak -> 502 dengan pesan, dan pesanannya TETAP ada untuk diulang", async () => {
    ref.snap = { ok: false, pesan: "Pembayaran belum bisa dimulai." };
    const jawab = await checkout(mintaCheckout({ productId: produkA }));
    expect(jawab.status).toBe(502);
    expect((await jawab.json()) as { pesan: string }).toHaveProperty("pesan");

    // Pesanannya tidak dihapus: `ulang: true` yang menaikkan percobaan dan
    // melahirkan order_id baru, karena order_id lama sudah terbakar di Midtrans.
    const { data } = await svc.from("orders").select("id, percobaan").eq("client_id", clientId);
    expect((data ?? []).length).toBe(1);
  });

  it("ulang: true menaikkan percobaan, dan order_id ikut berubah", async () => {
    ref.snap = { ok: false, pesan: "gagal" };
    await checkout(mintaCheckout({ productId: produkA }));

    ref.snap = { ok: true, token: "snap-token-uji-2" };
    const jawab = await checkout(mintaCheckout({ productId: produkA, ulang: true }));
    expect(jawab.status).toBe(200);
    const isi = (await jawab.json()) as { kode: string };
    expect(ref.diterima!.orderId).toBe(rakitOrderId(isi.kode, 2));
  });

  it("pesanan terbuka untuk produk LAIN -> 409 dengan kalimat yang bisa dibaca", async () => {
    expect((await checkout(mintaCheckout({ productId: produkA }))).status).toBe(200);

    const jawab = await checkout(mintaCheckout({ productId: produkB }));
    expect(jawab.status).toBe(409);
    const isi = (await jawab.json()) as { pesan: string };
    // Bukan "23505" telanjang. Yang membacanya adalah pembeli.
    expect(isi.pesan.length).toBeGreaterThan(10);
    expect(isi.pesan).not.toMatch(/23505|duplicate key|constraint/i);

    // Tepat SATU pesanan, tetap milik produk pertama.
    const { data } = await svc.from("orders").select("id").eq("client_id", clientId);
    expect((data ?? []).length).toBe(1);
  });

  it("checkout ULANG produk yang SAMA memulangkan pesanan terbuka yang ada, bukan yang kedua", async () => {
    const a = (await (await checkout(mintaCheckout({ productId: produkA }))).json()) as { pesananId: string };
    const b = (await (await checkout(mintaCheckout({ productId: produkA }))).json()) as { pesananId: string };
    expect(b.pesananId).toBe(a.pesananId);

    const { data } = await svc.from("orders").select("id").eq("client_id", clientId);
    expect((data ?? []).length).toBe(1);
  });
});

/**
 * GERBANG BELI ULANG — dijalankan LEWAT RUTE, bukan lewat RPC saja.
 *
 * Gerbang ini DILEBARKAN oleh review akhir P1-A sesudah rencana P1-B ditulis
 * (lihat dokblok `buat_pesanan`, `20260926130000_pesanan_rpc.sql`), dan
 * pelebarannya menutup tagihan ganda yang nyata: `expire` Midtrans yang
 * disusul `settlement` TERLAMBAT meninggalkan pesanan `kedaluwarsa` dengan
 * uang sudah masuk dan NOL entitlement — statusnya bukan `ditahan` dan bukan
 * `lunas`, jadi gerbang lama diam dan gerbang entitlement pun diam. Klien
 * membayar produk yang sama untuk kedua kalinya.
 *
 * Kenapa ia diuji DI SINI, bukan hanya di `tests/pesanan-checkout-db.test.ts`:
 * yang dibeli pembeli bukan RPC melainkan RUTE, dan rute inilah yang memilih
 * apakah `raise exception` itu sampai kepadanya sebagai 409 berkalimat atau
 * tertelan menjadi 200. Rute yang memulangkan 200 tanpa token membuat tombol
 * beli berputar tanpa sebab; rute yang memulangkan 500 membuat pembeli mencoba
 * lagi selamanya. Keduanya lolos dari uji basis data mana pun.
 */
describe("POST /api/pesanan/checkout — gerbang beli ulang (pelebaran review akhir P1-A)", () => {
  it("sudah MEMILIKI produknya -> 409 berkalimat, dan NOL pesanan lahir", async () => {
    // Entitlement dari hadiah admin: satu-satunya jalan seseorang memiliki
    // produk berbayar tanpa pernah punya pesanan atas namanya.
    const { error } = await svc.from("digital_entitlements").insert({
      client_id: clientId,
      product_id: produkA,
      sumber: "pemberian_admin",
    });
    expect(error).toBeNull();

    const jawab = await checkout(mintaCheckout({ productId: produkA }));
    expect(jawab.status).toBe(409);
    const isi = (await jawab.json()) as { pesan: string };
    expect(isi.pesan.length).toBeGreaterThan(10);
    expect(isi.pesan).not.toMatch(/23505|duplicate key|constraint|P0001/i);

    // Pagar terhadap 409 yang lahir SESUDAH pesanannya terlanjur ada.
    const { data } = await svc.from("orders").select("id").eq("client_id", clientId);
    expect(data ?? []).toEqual([]);
    // Dan Snap tidak pernah disentuh: token yang terbit untuk pesanan yang
    // tidak ada adalah popup yang bisa dibayar.
    expect(ref.diterima).toBeNull();
  });

  it("pesanan kedaluwarsa ber-`lunas_setelah_tutup` -> 409, pesanan kedua TIDAK lahir", async () => {
    // Bentuk persis yang dijelaskan dokblok `buat_pesanan`: uang sudah masuk,
    // pesanannya sudah tertutup, dan satu-satunya jejaknya adalah penanda
    // tinjauan. Gerbang lama (`status = 'ditahan'` saja) meloloskan ini.
    const isi = (await (await checkout(mintaCheckout({ productId: produkA }))).json()) as {
      pesananId: string;
    };

    const { error } = await svc
      .from("orders")
      .update({
        status: "kedaluwarsa",
        // `pesanan_tutup_bercap` menuntut cap ini ada bersama status tertutup.
        ditutup_pada: new Date().toISOString(),
        butuh_tinjauan_pada: new Date().toISOString(),
        sebab_tinjauan: "lunas_setelah_tutup",
      })
      .eq("id", isi.pesananId);
    expect(error).toBeNull();

    ref.diterima = null;
    const jawab = await checkout(mintaCheckout({ productId: produkA }));
    expect(jawab.status).toBe(409);
    expect(((await jawab.json()) as { pesan: string }).pesan.length).toBeGreaterThan(10);
    expect(ref.diterima).toBeNull();

    // Tetap SATU baris — yang lama, masih kedaluwarsa. Tidak ada pesanan kedua.
    const { data } = await svc
      .from("orders")
      .select("id, status")
      .eq("client_id", clientId);
    expect(data ?? []).toEqual([{ id: isi.pesananId, status: "kedaluwarsa" }]);
  });
});

describe("POST /api/pesanan/[id]/batal", () => {
  async function buat(): Promise<string> {
    const jawab = await checkout(mintaCheckout({ productId: produkA }));
    return ((await jawab.json()) as { pesananId: string }).pesananId;
  }

  it("tanpa sesi -> 401", async () => {
    const id = await buat();
    ref.sesi = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const jawab = await batal(mintaBatal(), { params: Promise.resolve({ id }) });
    expect(jawab.status).toBe(401);
  });

  it("pesanan sendiri yang menunggu_bayar -> 200 dibatalkan, dan checkout produk lain jadi bisa", async () => {
    // Pembatalan mandiri bukan hiasan: satu klien hanya boleh punya satu
    // pesanan terbuka, jadi tanpa tombol ini orang yang berubah pikiran soal
    // produk harus menunggu 24 jam.
    const id = await buat();
    const jawab = await batal(mintaBatal(), { params: Promise.resolve({ id }) });
    expect(jawab.status).toBe(200);
    expect((await jawab.json()) as { dibatalkan: boolean }).toEqual({ dibatalkan: true });

    const { data } = await svc
      .from("orders")
      .select("status, ditutup_pada")
      .eq("id", id)
      .single<{ status: string; ditutup_pada: string | null }>();
    expect(data!.status).toBe("dibatalkan");
    expect(data!.ditutup_pada).not.toBeNull();

    expect((await checkout(mintaCheckout({ productId: produkB }))).status).toBe(200);
  });

  it("KLIEN LAIN tidak bisa membatalkan pesanan orang: 200 { dibatalkan: false }, pesanan UTUH", async () => {
    // DUA SEBAB, DUA UJI — dan versi pertama rencana ini menggabungkannya jadi
    // satu yang justru akan GAGAL apa adanya. Dengan sesi admin,
    // `batalkan_pesanan_saya` menabrak gerbang PERTAMA-nya
    // (`v_client_id is null -> 42501`), rute memetakan kode non-P0001 ke 409,
    // sementara ujinya meng-assert 200 `{ dibatalkan: false }`. Akibat yang
    // lebih halus: jalur `dibatalkan: false` — SATU-SATUNYA jalur yang menguji
    // kepemilikan baris — tidak pernah dieksekusi sama sekali, dan klausa
    // `and o.client_id = v_client_id` boleh dihapus hari ini tanpa satu pun
    // uji merah.
    const id = await buat();
    ref.sesi = await signInAs(EMAIL_KLIEN_KEDUA);
    const jawab = await batal(mintaBatal(), { params: Promise.resolve({ id }) });
    expect(jawab.status).toBe(200);
    expect((await jawab.json()) as { dibatalkan: boolean }).toEqual({ dibatalkan: false });

    // Yang penting bukan kodenya, melainkan ini: pesanannya UTUH.
    const { data } = await svc.from("orders").select("status").eq("id", id).single<{ status: string }>();
    expect(data!.status).toBe("menunggu_bayar");
  });

  it("akun TANPA rekam klien ditolak 409 — gerbang identitas, bukan kepemilikan", async () => {
    // Judulnya menyebut sebab yang SEBENARNYA diuji. Ia tetap dipertahankan
    // karena gerbang identitas memang harus berdiri; yang tidak boleh adalah
    // mengira ia membuktikan kepemilikan baris.
    const id = await buat();
    ref.sesi = await signInAs(TANPA_REKAM_KLIEN);
    const jawab = await batal(mintaBatal(), { params: Promise.resolve({ id }) });
    expect(jawab.status).toBe(409);

    const { data } = await svc.from("orders").select("status").eq("id", id).single<{ status: string }>();
    expect(data!.status).toBe("menunggu_bayar");
  });

  it("id yang bukan UUID -> 409, tanpa menyentuh apa pun", async () => {
    const jawab = await batal(mintaBatal(), { params: Promise.resolve({ id: "bukan-uuid" }) });
    expect(jawab.status).toBe(409);
  });
});
