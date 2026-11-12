import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import {
  EMAIL_KLIEN_KEDUA,
  siapkanKlienKedua,
  bongkarKlienKedua,
} from "./helpers/klien-kedua";
import { terbitkanTautanBayar } from "@/lib/doku/tautan";
import { rakitInvoice } from "@/lib/pesanan/order-id";

const svc = createAdminSupabase();
const KLIEN_EMAIL = "ananda@padma.test";
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";
const asliFetch = globalThis.fetch;
const panggilanDoku: { url: string; body: string }[] = [];
let jawabDoku: () => Response = () => dokuOk();
const produkUji: string[] = [];

const dokuOk = () =>
  new Response(
    JSON.stringify({ response: { payment: { url: "https://sandbox.doku.test/bayar/abc", token_id: "t" } } }),
    { status: 200 },
  );

beforeEach(() => {
  panggilanDoku.length = 0;
  jawabDoku = () => dokuOk();
  vi.stubEnv("DOKU_CLIENT_ID", "klien-uji-doku");
  vi.stubEnv("DOKU_SECRET_KEY", "kunci-uji-doku");
  vi.stubEnv("DOKU_PRODUKSI", "false");
  vi.stubEnv("NEXT_PUBLIC_BASIS_URL", "https://padma.test");
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/)/.test(url)) return asliFetch(...args);
    if (url.startsWith("https://api-sandbox.doku.com")) {
      panggilanDoku.push({ url, body: String((args[1] as RequestInit)?.body ?? "") });
      return Promise.resolve(jawabDoku());
    }
    throw new Error(`[uji] host luar tak terduga: ${url}`);
  });
});

async function bersihkan() {
  const { data: p } = await svc.from("orders").select("id").eq("client_id", ANANDA_CLIENT_ID);
  for (const o of p ?? []) {
    await svc.from("jejak_pesanan").delete().eq("pesanan_id", o.id);
    await svc.from("notifikasi_pesanan").delete().eq("pesanan_id", o.id);
  }
  await svc.from("orders").delete().eq("client_id", ANANDA_CLIENT_ID);
  while (produkUji.length) await svc.from("digital_products").delete().eq("id", produkUji.pop()!);
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await bersihkan();
});
beforeAll(async () => {
  await bersihkan();
  await siapkanKlienKedua();
});
afterAll(bongkarKlienKedua);

async function pesananBaru() {
  const slug = `tautan-${Date.now()}`;
  const { data, error } = await svc
    .from("digital_products")
    .insert({ judul: `Uji ${slug}`, slug, aktif: true })
    .select("id")
    .single();
  if (error) throw error;
  produkUji.push(data!.id);
  await svc.from("digital_product_prices").insert({ product_id: data!.id, harga: 150_000, berlaku_sejak: "2026-09-01" });
  const sesi = await signInAs(KLIEN_EMAIL);
  const { data: b, error: e } = await sesi.rpc("buat_pesanan", { p_product_id: data!.id });
  if (e) throw new Error(`buat_pesanan: ${e.message}`);
  return { sesi, id: (b as { pesanan_id: string }[])[0].pesanan_id };
}

async function setKedaluwarsa(id: string, detik: number) {
  const { error } = await svc
    .from("orders")
    .update({ kedaluwarsa_pada: new Date(Date.now() + detik * 1000).toISOString() })
    .eq("id", id);
  if (error) throw error;
}

describe("terbitkanTautanBayar", () => {
  it("panggilan pertama: satu panggilan DOKU, tautan dan jejak tercatat; kedua: pakai ulang", async () => {
    const { sesi, id } = await pesananBaru();
    const sebelum = Date.now();
    const r1 = await terbitkanTautanBayar(sesi, id, "/passport/pesanan");
    const sesudah = Date.now();
    expect(r1).toEqual({ ok: true, url: "https://sandbox.doku.test/bayar/abc" });
    expect(panggilanDoku).toHaveLength(1);

    const b = JSON.parse(panggilanDoku[0].body);
    const { data: o } = await svc
      .from("orders")
      .select("tautan_gateway, tautan_terbit_pada, kedaluwarsa_pada, kode, percobaan")
      .eq("id", id)
      .single();
    expect(o!.tautan_gateway).toBe("https://sandbox.doku.test/bayar/abc");
    expect(o!.tautan_terbit_pada).not.toBeNull();
    expect(b.order.invoice_number).toMatch(/^PSN\d{6}[0-9A-F]{6}[1-9]$/);
    expect(b.order.invoice_number).toBe(rakitInvoice(o!.kode, o!.percobaan));
    expect(b.order.amount).toBe(150_000);
    expect(b.order.callback_url).toBe("https://padma.test/passport/pesanan");
    // Dihitung dari `kedaluwarsa_pada` hasil baca-ulang dan jam sekitar
    // panggilan, bukan angka mati: jam VM Docker (yang mengisi kolom lewat
    // now()) boleh miring terhadap jam mesin uji. Rentangnya dibulatkan ke
    // bawah seperti kode.
    const kedaluwarsa = Date.parse(o!.kedaluwarsa_pada);
    expect(b.payment.payment_due_date).toBeGreaterThanOrEqual(
      Math.floor((kedaluwarsa - sesudah) / 60_000),
    );
    expect(b.payment.payment_due_date).toBeLessThanOrEqual(
      Math.floor((kedaluwarsa - sebelum) / 60_000),
    );

    const { data: jejak } = await svc
      .from("jejak_pesanan")
      .select("kejadian")
      .eq("pesanan_id", id)
      .eq("kejadian", "token_terbit");
    expect(jejak).toHaveLength(1);

    const r2 = await terbitkanTautanBayar(sesi, id, "/passport/pesanan");
    expect(r2).toEqual({ ok: true, url: "https://sandbox.doku.test/bayar/abc" });
    expect(panggilanDoku).toHaveLength(1);
  });

  it("sisa 30 detik: 409, nol panggilan", async () => {
    const { sesi, id } = await pesananBaru();
    await setKedaluwarsa(id, 30);
    const r = await terbitkanTautanBayar(sesi, id, "/passport/pesanan");
    // Pesan persis, bukan hanya 409: jalur 409 lain (bukan milik/ sudah
    // tidak terbuka) memakai kalimat berbeda.
    expect(r).toEqual({ ok: false, status: 409, pesan: "Tagihan lewat tenggat." });
    expect(panggilanDoku).toHaveLength(0);
  });

  it("sisa 90 detik: menitBerlaku 1 (dibulatkan ke bawah)", async () => {
    const { sesi, id } = await pesananBaru();
    await setKedaluwarsa(id, 90);
    const r = await terbitkanTautanBayar(sesi, id, "/passport/pesanan");
    expect(r.ok).toBe(true);
    expect(JSON.parse(panggilanDoku[0].body).payment.payment_due_date).toBe(1);
  });

  it("pesanan klien lain: 409, nol panggilan", async () => {
    const { id } = await pesananBaru();
    const lain = await signInAs(EMAIL_KLIEN_KEDUA);
    const r = await terbitkanTautanBayar(lain, id, "/passport/pesanan");
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(panggilanDoku).toHaveLength(0);
  });

  it("kunci kosong atau basis URL kosong: 503, nol panggilan", async () => {
    const { sesi, id } = await pesananBaru();
    vi.stubEnv("DOKU_SECRET_KEY", "");
    expect(await terbitkanTautanBayar(sesi, id, "/p")).toEqual({
      ok: false,
      status: 503,
      pesan: "Pembayaran belum aktif. Hubungi tim PADMA.",
    });
    vi.stubEnv("DOKU_SECRET_KEY", "kunci-uji-doku");
    vi.stubEnv("NEXT_PUBLIC_BASIS_URL", "");
    expect(await terbitkanTautanBayar(sesi, id, "/p")).toMatchObject({ ok: false, status: 503 });
    expect(panggilanDoku).toHaveLength(0);
  });

  it("DOKU 400: 502 dan tautan_gateway tetap null", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sesi, id } = await pesananBaru();
    jawabDoku = () => new Response(JSON.stringify({ error_messages: ["x"] }), { status: 400 });
    expect(await terbitkanTautanBayar(sesi, id, "/p")).toMatchObject({ ok: false, status: 502 });
    const { data: o } = await svc.from("orders").select("tautan_gateway").eq("id", id).single();
    expect(o!.tautan_gateway).toBeNull();
  });
});
