/**
 * WEBHOOK DOKU — pintu masuk uang. Dipanggil SUNGGUHAN melawan basis data
 * lokal (`web-doku`), dengan pesanan yang lahir lewat RPC `buat_pesanan`.
 *
 * Helper `kirim` menandatangani badan PERSIS seperti string yang dikirim,
 * dengan `Request-Target = PATH_WEBHOOK_DOKU`. Itulah yang dilakukan DOKU:
 * Digest dihitung atas byte mentah, bukan atas JSON yang diserialisasi ulang.
 *
 * Klien layanan dibuat langsung (bukan `createAdminSupabase`) karena satu kasus
 * me-mock modul admin untuk memaksa galat RPC; fixture tidak boleh ikut rusak.
 *
 * Pembersihan wajib manual: `jejak_pesanan` dan `notifikasi_pesanan` tanpa FK.
 * Id transaksi palsu sengaja bukan deret digit panjang agar
 * `pesanan-teks-tanpa-nominal` tidak curiga.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { signInAs } from "./helpers/as-user";

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const ref = vi.hoisted(() => ({ paksaGalat: false, nilaiAsing: false, rpcDipanggil: [] as string[] }));
vi.mock("@/lib/supabase/admin", async (impor) => {
  const asli = await impor<typeof import("@/lib/supabase/admin")>();
  return {
    createAdminSupabase: () => {
      const klien = asli.createAdminSupabase();
      if (!ref.paksaGalat && !ref.nilaiAsing) return klien;
      return {
        rpc: async () =>
          ref.nilaiAsing
            ? { data: "nilai_baru_di_sql", error: null }
            : { data: null, error: { message: "galat-uji", code: "XX000" } },
      } as unknown as ReturnType<typeof asli.createAdminSupabase>;
    },
  };
});

const { POST } = await import("@/app/api/pembayaran/doku/route");
const { KODE_JAWABAN } = await import("@/lib/doku/kode-jawaban");
const { PATH_WEBHOOK_DOKU } = await import("@/lib/doku/konfig");
const { hitungDigest, rakitKomponenTandaTangan, hitungTandaTangan } = await import(
  "@/lib/doku/tanda-tangan"
);
const { rakitInvoice } = await import("@/lib/pesanan/order-id");

const CLIENT_ID = "klien-uji-doku";
const SECRET = "kunci-uji-doku";
const KLIEN = "ananda@padma.test";

const asliFetch = globalThis.fetch;
const keluar: string[] = [];

beforeAll(() => {
  vi.stubEnv("DOKU_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("DOKU_SECRET_KEY", SECRET);
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/)/.test(url)) {
      keluar.push(url);
      throw new Error(`[uji] webhook menembak host luar: ${url}`);
    }
    return asliFetch(...args);
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await bersihkan();
});

let productId = "";
let clientId = "";
const pesananDibuat: string[] = [];

async function semaiProduk(harga: number): Promise<string> {
  const { data } = await svc
    .from("digital_products")
    .insert({ judul: "PAD-UJI Webhook DOKU", slug: "pad-uji-webhook-doku", aktif: true })
    .select("id")
    .single<{ id: string }>();
  await svc.from("digital_product_prices").insert({ product_id: data!.id, harga });
  return data!.id;
}

async function buatPesanan(): Promise<{ id: string; invoice: string }> {
  const klien = await signInAs(KLIEN);
  const { data, error } = await klien.rpc("buat_pesanan", { p_product_id: productId });
  if (error) throw new Error(`buat_pesanan gagal: ${error.message}`);
  const b = (data as Array<{ pesanan_id: string; kode: string; percobaan: number }>)[0];
  pesananDibuat.push(b.pesanan_id);
  return { id: b.pesanan_id, invoice: rakitInvoice(b.kode, b.percobaan) };
}

async function bersihkanPesanan(): Promise<void> {
  await svc.from("digital_entitlements").delete().eq("product_id", productId);
  if (pesananDibuat.length) {
    await svc.from("orders").delete().in("id", pesananDibuat);
    await svc.from("jejak_pesanan").delete().in("pesanan_id", pesananDibuat);
    await svc.from("notifikasi_pesanan").delete().in("pesanan_id", pesananDibuat);
    pesananDibuat.length = 0;
  }
}

async function bersihkan(): Promise<void> {
  await bersihkanPesanan();
  if (productId) await svc.from("digital_products").delete().eq("id", productId);
}

beforeAll(async () => {
  await svc.from("digital_products").delete().eq("slug", "pad-uji-webhook-doku");
  productId = await semaiProduk(150_000);
  const { data } = await svc.from("clients").select("id").eq("email", KLIEN).maybeSingle<{ id: string }>();
  clientId = data?.id ?? "";
});

beforeEach(async () => {
  ref.paksaGalat = false;
  ref.nilaiAsing = false;
  await bersihkanPesanan();
});

// ===== Perakit permintaan =====
type Header = {
  "client-id": string | null;
  "request-id": string | null;
  "request-timestamp": string | null;
  signature: string | null;
};

type Badan = {
  order: { invoice_number: string; amount: number | string };
  transaction: { status: string; original_request_id?: string; date?: string };
  channel?: { id: string };
  [k: string]: unknown;
};

function badanSah(invoice: string, ubah: Partial<{ amount: number | string; status: string }> = {}): Badan {
  return {
    order: { invoice_number: invoice, amount: ubah.amount ?? 150000 },
    transaction: { status: ubah.status ?? "SUCCESS", original_request_id: "req-uji-doku-a" },
    channel: { id: "VIRTUAL_ACCOUNT_BCA" },
  };
}

function tandatangani(teks: string): Header {
  const requestId = "rid-uji-1";
  const ts = "2026-11-13T10:00:00Z";
  const komponen = rakitKomponenTandaTangan({
    clientId: CLIENT_ID,
    requestId,
    requestTimestamp: ts,
    requestTarget: PATH_WEBHOOK_DOKU,
    digest: hitungDigest(teks),
  });
  return {
    "client-id": CLIENT_ID,
    "request-id": requestId,
    "request-timestamp": ts,
    signature: hitungTandaTangan(komponen, SECRET),
  };
}

function permintaan(teks: string, header: Header): Request {
  const h = new Headers({ "content-type": "application/json" });
  for (const [k, v] of Object.entries(header)) if (v !== null) h.set(k, v);
  return new Request(`http://127.0.0.1${PATH_WEBHOOK_DOKU}`, { method: "POST", headers: h, body: teks });
}

/** `badanMentah` ditandatangani PERSIS seperti string ini; `ubah` menimpa header sesudahnya. */
async function kirim(
  badanMentah: string,
  ubah: Partial<Header> = {},
): Promise<{ status: number; hasil: string }> {
  const jawab = await POST(permintaan(badanMentah, { ...tandatangani(badanMentah), ...ubah }));
  const isi = (await jawab.json().catch(() => ({}))) as { hasil?: string };
  return { status: jawab.status, hasil: isi.hasil ?? "" };
}

// ===========================================================================

describe("peta kode jawaban — satu kasus per baris", () => {
  it("badan > 16 KB dengan content-length jujur -> 400", async () => {
    const besar = JSON.stringify({ x: "x".repeat(17 * 1024) });
    const jawab = await POST(
      new Request(`http://127.0.0.1${PATH_WEBHOOK_DOKU}`, {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(new TextEncoder().encode(besar).byteLength) },
        body: besar,
      }),
    );
    const isi = (await jawab.json()) as { hasil?: string };
    expect(jawab.status).toBe(400);
    expect(isi.hasil).toBe("badan_terlalu_besar");
  });

  it("content-length melaporkan > 16 KB -> 400 SEBELUM satu byte pun dibaca (pagar header)", async () => {
    // Badannya kecil; hanya header yang menuduh. Tanpa cabang header, badan
    // kecil ini terbaca habis dan jatuh ke `skema_gagal`, bukan ini.
    const jawab = await POST(
      new Request(`http://127.0.0.1${PATH_WEBHOOK_DOKU}`, {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(17 * 1024) },
        body: "{}",
      }),
    );
    const isi = (await jawab.json()) as { hasil?: string };
    expect(jawab.status).toBe(400);
    expect(isi.hasil).toBe("badan_terlalu_besar");
  });

  it("batas 16 KB: tepat 16*1024 byte LOLOS lapis ukuran; 16*1024+1 ditolak — dengan dan tanpa content-length", async () => {
    const MAKS = 16 * 1024;
    // `{"x":"` (6) + isi + `"}` (2): panjang byte persis `n`.
    const badanBayt = (n: number) => `{"x":"${"x".repeat(n - 8)}"}`;
    const dariString = (teks: string, denganLength: boolean) => {
      const h: Record<string, string> = { "content-type": "application/json" };
      if (denganLength) h["content-length"] = String(new TextEncoder().encode(teks).byteLength);
      return new Request(`http://127.0.0.1${PATH_WEBHOOK_DOKU}`, { method: "POST", headers: h, body: teks });
    };
    const hasilDari = async (r: Request) => ((await (await POST(r)).json()) as { hasil?: string }).hasil;

    expect(new TextEncoder().encode(badanBayt(MAKS)).byteLength).toBe(MAKS);
    // Pagar header berdiri sendiri: badan kecil, tetapi content-length = MAKS+1
    // (aliran tidak akan menangkapnya, hanya cabang header).
    const dusta = new Request(`http://127.0.0.1${PATH_WEBHOOK_DOKU}`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(MAKS + 1) },
      body: "{}",
    });
    expect(await hasilDari(dusta)).toBe("badan_terlalu_besar");
    for (const denganLength of [true, false]) {
      // Tepat di batas: lolos lapis ukuran; badan bukan skema kita -> skema_gagal.
      expect(await hasilDari(dariString(badanBayt(MAKS), denganLength))).toBe("skema_gagal");
      // Satu byte lebih: ditolak.
      const r = await POST(dariString(badanBayt(MAKS + 1), denganLength));
      expect(r.status).toBe(400);
      expect(((await r.json()) as { hasil?: string }).hasil).toBe("badan_terlalu_besar");
    }
  });

  it("badan > 16 KB TANPA content-length (aliran) -> 400 — pagar BYTE", async () => {
    const potongan = "x".repeat(4 * 1024);
    const aliran = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        for (let i = 0; i < 5; i += 1) c.enqueue(enc.encode(potongan));
        c.close();
      },
    });
    const jawab = await POST(
      new Request(`http://127.0.0.1${PATH_WEBHOOK_DOKU}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: aliran,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
    );
    const isi = (await jawab.json()) as { hasil?: string };
    expect(jawab.status).toBe(400);
    expect(isi.hasil).toBe("badan_terlalu_besar");
  });

  it("kunci kosong (client id ATAU secret) -> 503, bukan 401 dan bukan 200", async () => {
    const p = await buatPesanan();
    const teks = JSON.stringify(badanSah(p.invoice));
    vi.stubEnv("DOKU_SECRET_KEY", "");
    try {
      expect(await kirim(teks)).toEqual({ status: 503, hasil: "kunci_kosong" });
    } finally {
      vi.stubEnv("DOKU_SECRET_KEY", SECRET);
    }
    vi.stubEnv("DOKU_CLIENT_ID", "");
    try {
      expect(await kirim(teks)).toEqual({ status: 503, hasil: "kunci_kosong" });
    } finally {
      vi.stubEnv("DOKU_CLIENT_ID", CLIENT_ID);
    }
  });

  it("JSON rusak -> 400", async () => {
    expect(await kirim("{bukan json")).toEqual({ status: 400, hasil: "skema_gagal" });
  });

  it("medan wajib hilang -> 400", async () => {
    const p = await buatPesanan();
    for (const b of [
      { order: { amount: 1 }, transaction: { status: "SUCCESS" } },
      { order: { invoice_number: p.invoice }, transaction: { status: "SUCCESS" } },
      { order: { invoice_number: p.invoice, amount: 150000 }, transaction: {} },
      { order: { invoice_number: p.invoice, amount: 150000 } },
    ]) {
      expect(await kirim(JSON.stringify(b))).toEqual({ status: 400, hasil: "skema_gagal" });
    }
  });

  it("setiap header wajib hilang -> 400", async () => {
    const p = await buatPesanan();
    const teks = JSON.stringify(badanSah(p.invoice));
    for (const nama of ["client-id", "request-id", "request-timestamp", "signature"] as const) {
      expect(await kirim(teks, { [nama]: null })).toEqual({ status: 400, hasil: "skema_gagal" });
    }
  });

  it("medan tambahan tak dikenal -> 200", async () => {
    const p = await buatPesanan();
    const { status } = await kirim(JSON.stringify({ ...badanSah(p.invoice), medan_baru: { a: 1 } }));
    expect(status).toBe(200);
  });

  it("medan opsional bernilai null -> 200 diterapkan, bukan 400", async () => {
    // 400 berarti "jangan kirim lagi". Notifikasi sah yang membawa `null` pada
    // medan opsional (bukan sekadar tidak ada) mengunci pesanan yang uangnya
    // sudah masuk bila skemanya hanya menerima `undefined`.
    const p = await buatPesanan();
    const b = {
      order: { invoice_number: p.invoice, amount: 150000 },
      transaction: { status: "SUCCESS", original_request_id: null, date: null },
      channel: null,
      service: null,
    };
    expect(await kirim(JSON.stringify(b))).toEqual({ status: 200, hasil: "diterapkan" });
  });

  it("channel.id / service.id bernilai null -> 200 diterapkan", async () => {
    const q = await buatPesanan();
    const c = {
      order: { invoice_number: q.invoice, amount: 150000 },
      transaction: { status: "SUCCESS" },
      channel: { id: null },
      service: { id: null },
    };
    expect(await kirim(JSON.stringify(c))).toEqual({ status: 200, hasil: "diterapkan" });
  });

  it("invoice berbentuk Midtrans -> 400, dan NOL sentuhan basis data", async () => {
    const sebelum = await jumlahDitolakHariIni();
    const sebelumTak = await jumlahTakDikenalHariIni();
    const { status, hasil } = await kirim(JSON.stringify(badanSah("PSN-260926-ABCDEF.1")));
    expect(status).toBe(400);
    expect(hasil).toBe("bentuk_invoice");
    expect(await jumlahDitolakHariIni()).toBe(sebelum);
    expect(await jumlahTakDikenalHariIni()).toBe(sebelumTak);
  });

  it("Client-Id berbeda -> 401", async () => {
    const p = await buatPesanan();
    expect(await kirim(JSON.stringify(badanSah(p.invoice)), { "client-id": "klien-lain" })).toEqual({
      status: 401,
      hasil: "tanda_tangan_salah",
    });
  });

  it("satu byte badan diubah sesudah ditandatangani -> 401", async () => {
    const p = await buatPesanan();
    const teks = JSON.stringify(badanSah(p.invoice));
    const header = tandatangani(teks);
    const diubah = teks.replace("SUCCESS", "SUCCESs");
    const jawab = await POST(permintaan(diubah, header));
    expect(jawab.status).toBe(401);
  });

  it("gagal mencatat penolakan -> tetap 401, dan penyebabnya tertulis di log server", async () => {
    // Kegagalan `catat_notifikasi_ditolak` tidak boleh mengubah jawaban (DOKU
    // harus tetap melihat 401), tetapi wajib terlihat: tanpa log, alarm banjir
    // notifikasi palsu gagal dalam senyap.
    const p = await buatPesanan();
    const teks = JSON.stringify(badanSah(p.invoice));
    const galat = vi.spyOn(console, "error").mockImplementation(() => {});
    ref.paksaGalat = true;
    try {
      const jawab = await POST(permintaan(teks, { ...tandatangani(teks), signature: "HMACSHA256=salah" }));
      expect(jawab.status).toBe(401);
      const baris = galat.mock.calls.map((c) => c.join(" "));
      expect(baris.some((b) => b.includes("gagal mencatat notifikasi ditolak") && b.includes("galat-uji"))).toBe(true);
    } finally {
      ref.paksaGalat = false;
      galat.mockRestore();
    }
  });

  it("Signature pendek, tanpa awalan, atau kosong -> 401, bukan 500", async () => {
    const p = await buatPesanan();
    const teks = JSON.stringify(badanSah(p.invoice));
    const benar = tandatangani(teks).signature!;
    for (const sig of ["pendek", benar.replace("HMACSHA256=", ""), "", "HMACSHA256=" + "A".repeat(44)]) {
      const { status } = await kirim(teks, { signature: sig });
      expect(status).toBe(401);
    }
  });

  it("tanda tangan salah -> penghitung ditolak NAIK satu, nol baris notifikasi", async () => {
    const p = await buatPesanan();
    const sebelum = await jumlahDitolakHariIni();
    const { status } = await kirim(JSON.stringify(badanSah(p.invoice)), { signature: "HMACSHA256=" + "A".repeat(44) });
    expect(status).toBe(401);
    expect(await jumlahDitolakHariIni()).toBe(sebelum + 1);
    const { data, error } = await svc.from("notifikasi_pesanan").select("id").eq("pesanan_id", p.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("invoice sah bentuknya tapi tak dikenal -> 200 pesanan_tidak_ada, penghitung tak_dikenal NAIK", async () => {
    const sebelumTak = await jumlahTakDikenalHariIni();
    const sebelumDitolak = await jumlahDitolakHariIni();
    const r = await kirim(JSON.stringify(badanSah("PSN990101FFFFFF9")));
    expect(r).toEqual({ status: 200, hasil: "pesanan_tidak_ada" });
    expect(await jumlahTakDikenalHariIni()).toBe(sebelumTak + 1);
    expect(await jumlahDitolakHariIni()).toBe(sebelumDitolak);
  });

  it("galat RPC -> 500", async () => {
    const p = await buatPesanan();
    const teks = JSON.stringify(badanSah(p.invoice));
    ref.paksaGalat = true;
    expect(await kirim(teks)).toEqual({ status: 500, hasil: "galat" });
  });

  it("RPC memulangkan nilai asing -> 500, bukan 200 diam-diam", async () => {
    const p = await buatPesanan();
    const teks = JSON.stringify(badanSah(p.invoice));
    ref.nilaiAsing = true;
    expect(await kirim(teks)).toEqual({ status: 500, hasil: "galat" });
  });

  it("KODE_JAWABAN memetakan KESEPULUH hasil, tanpa undefined", () => {
    const nilai = Object.values(KODE_JAWABAN);
    expect(Object.keys(KODE_JAWABAN).sort()).toEqual(
      [
        "badan_terlalu_besar", "kunci_kosong", "skema_gagal", "bentuk_invoice", "tanda_tangan_salah",
        "duplikat", "tanpa_efek", "diterapkan", "pesanan_tidak_ada", "galat",
      ].sort(),
    );
    expect(nilai.every((k) => Number.isInteger(k) && k >= 200 && k < 600)).toBe(true);
    expect(KODE_JAWABAN.bentuk_invoice).toBe(400);
    expect(KODE_JAWABAN.kunci_kosong).toBe(503);
    expect(KODE_JAWABAN.tanda_tangan_salah).toBe(401);
    expect(KODE_JAWABAN.galat).toBe(500);
  });
});

describe("jalur uang", () => {
  it.each([[150000], ["150000"], ["150000.00"]])("SUCCESS amount %j -> 200 diterapkan, LUNAS, entitlement terbit", async (amount) => {
    const p = await buatPesanan();
    const r = await kirim(JSON.stringify(badanSah(p.invoice, { amount })));
    expect(r).toEqual({ status: 200, hasil: "diterapkan" });
    const { data } = await svc.from("orders").select("status").eq("id", p.id).single<{ status: string }>();
    expect(data!.status).toBe("lunas");
    const { data: hak, error: galatHak } = await svc
      .from("digital_entitlements").select("id").eq("product_id", productId).eq("client_id", clientId);
    expect(galatHak).toBeNull();
    expect(hak).toHaveLength(1);
  });

  it("amount berdesimal bukan nol (\"150000.50\") -> ditahan + selisih_nominal, tidak dibulatkan", async () => {
    const p = await buatPesanan();
    const r = await kirim(JSON.stringify(badanSah(p.invoice, { amount: "150000.50" })));
    expect(r.status).toBe(200);
    const { data } = await svc
      .from("orders").select("status, sebab_tinjauan").eq("id", p.id)
      .single<{ status: string; sebab_tinjauan: string | null }>();
    expect(data!.status).toBe("ditahan");
    expect(data!.sebab_tinjauan).toBe("selisih_nominal");
    const { data: hak, error: galatHak } = await svc
      .from("digital_entitlements").select("id").eq("product_id", productId).eq("client_id", clientId);
    expect(galatHak).toBeNull();
    expect(hak).toEqual([]);
  });

  it("amount \"150000.40\" -> ditahan, BUKAN lunas (pembulatan ke bawah juga dilarang)", async () => {
    const p = await buatPesanan();
    await kirim(JSON.stringify(badanSah(p.invoice, { amount: "150000.40" })));
    const { data } = await svc.from("orders").select("status").eq("id", p.id).single<{ status: string }>();
    expect(data!.status).toBe("ditahan");
  });

  it("badan berindentasi dan berurutan kunci terbalik -> 200 diterapkan (Digest dari byte mentah)", async () => {
    const p = await buatPesanan();
    const b = badanSah(p.invoice);
    const terbalik = {
      channel: b.channel,
      transaction: b.transaction,
      order: { amount: b.order.amount, invoice_number: b.order.invoice_number },
    };
    const teks = JSON.stringify(terbalik, null, 2);
    expect(teks).not.toBe(JSON.stringify(JSON.parse(teks)));
    expect(await kirim(teks)).toEqual({ status: 200, hasil: "diterapkan" });
  });

  it("badan identik dikirim dua kali -> kedua kali 200, yang kedua duplikat, satu jejak lunas", async () => {
    const p = await buatPesanan();
    const teks = JSON.stringify(badanSah(p.invoice));
    expect(await kirim(teks)).toEqual({ status: 200, hasil: "diterapkan" });
    expect(await kirim(teks)).toEqual({ status: 200, hasil: "duplikat" });
    const { data } = await svc.from("jejak_pesanan").select("id").eq("pesanan_id", p.id).eq("kejadian", "lunas");
    expect((data ?? []).length).toBe(1);
  });

  it("FAILED -> 200 tanpa_efek, pesanan tetap menunggu", async () => {
    const p = await buatPesanan();
    const r = await kirim(JSON.stringify(badanSah(p.invoice, { status: "FAILED" })));
    expect(r).toEqual({ status: 200, hasil: "tanpa_efek" });
    const { data, error } = await svc
      .from("orders").select("status, butuh_tinjauan_pada, sebab_tinjauan").eq("id", p.id)
      .single<{ status: string; butuh_tinjauan_pada: string | null; sebab_tinjauan: string | null }>();
    expect(error).toBeNull();
    expect(data!.status).toBe("menunggu_bayar");
    expect(data!.butuh_tinjauan_pada).toBeNull();
    expect(data!.sebab_tinjauan).toBeNull();
  });

  it("sidik: status berbeda atas invoice sama = dua sidik; byte identik = satu sidik", async () => {
    const p = await buatPesanan();
    await kirim(JSON.stringify(badanSah(p.invoice, { status: "FAILED" })));
    await kirim(JSON.stringify(badanSah(p.invoice, { status: "SUCCESS" })));
    const { data } = await svc.from("notifikasi_pesanan").select("sidik").eq("pesanan_id", p.id);
    expect(new Set((data ?? []).map((d) => d.sidik)).size).toBe(2);
  });

  it("webhook tidak pernah menelepon host luar", () => {
    expect(keluar).toEqual([]);
  });
});

// ===== Pembantu baca =====
async function jumlahDitolakHariIni(): Promise<number> {
  const hariIni = new Date().toISOString().slice(0, 10);
  const { data } = await svc
    .from("notifikasi_ditolak_harian").select("jumlah").eq("tanggal", hariIni)
    .maybeSingle<{ jumlah: number }>();
  return data?.jumlah ?? 0;
}

async function jumlahTakDikenalHariIni(): Promise<number> {
  const hariIni = new Date().toISOString().slice(0, 10);
  const { data } = await svc
    .from("notifikasi_ditolak_harian").select("tak_dikenal").eq("tanggal", hariIni)
    .maybeSingle<{ tak_dikenal: number }>();
  return data?.tak_dikenal ?? 0;
}
