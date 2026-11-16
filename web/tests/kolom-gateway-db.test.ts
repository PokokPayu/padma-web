/**
 * KOLOM NETRAL-GATEWAY & `catat_tautan_gateway` (tugas A3).
 *
 * Nama kolom Midtrans diganti nama yang tidak terikat gateway, dan RPC
 * pencatat tautan kini menuntut `p_percobaan` yang sama dengan percobaan
 * pesanan: tautan dari percobaan lama tidak boleh menimpa percobaan baru.
 * Pesanan dilahirkan lewat `buat_pesanan` dengan sesi klien sungguhan.
 * `jejak_pesanan` tanpa foreign key, jadi disapu sendiri di sini.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";
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

const KLIEN = "ananda@padma.test";
const SLUG = "pad-uji-kolom-gateway";
let productId = "";
const dibuat: string[] = [];

async function kolom(tabel: string): Promise<string[]> {
  const baris = await querySql<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1`,
    [tabel],
  );
  return baris.map((b) => b.column_name);
}

async function pesananBaru(): Promise<{ id: string; percobaan: number }> {
  const klien = await signInAs(KLIEN);
  const { data, error } = await klien.rpc("buat_pesanan", { p_product_id: productId });
  if (error) throw new Error(`buat_pesanan gagal: ${error.message}`);
  const b = (data as Array<{ pesanan_id: string; percobaan: number }>)[0];
  dibuat.push(b.pesanan_id);
  return { id: b.pesanan_id, percobaan: b.percobaan };
}

async function barisPesanan(id: string) {
  const { data } = await svc
    .from("orders")
    .select("tautan_gateway, tautan_terbit_pada")
    .eq("id", id)
    .single<{ tautan_gateway: string | null; tautan_terbit_pada: string | null }>();
  return data!;
}

async function bersihkan() {
  if (dibuat.length) {
    await svc.from("digital_entitlements").delete().eq("product_id", productId);
    await svc.from("orders").delete().in("id", dibuat);
    await svc.from("jejak_pesanan").delete().in("pesanan_id", dibuat);
    dibuat.length = 0;
  }
}

beforeAll(async () => {
  await svc.from("digital_products").delete().eq("slug", SLUG);
  const { data } = await svc
    .from("digital_products")
    .insert({ judul: "PAD-UJI Kolom Gateway", slug: SLUG, aktif: true })
    .select("id")
    .single<{ id: string }>();
  productId = data!.id;
  await svc.from("digital_product_prices").insert({ product_id: productId, harga: 120_000 });
  await siapkanKlienKedua();
});

beforeEach(bersihkan);

afterAll(async () => {
  await bersihkan();
  if (productId) await svc.from("digital_products").delete().eq("id", productId);
  await bongkarKlienKedua();
});

describe("skema netral-gateway", () => {
  it("orders punya kolom baru dan tidak lagi punya kolom lama", async () => {
    const k = await kolom("orders");
    expect(k).toEqual(expect.arrayContaining(["tautan_gateway", "tautan_terbit_pada", "status_gateway"]));
    for (const lama of ["snap_token", "snap_diterbitkan_pada", "status_midtrans"]) {
      expect(k).not.toContain(lama);
    }
  });

  it("notifikasi_pesanan memakai status_gateway", async () => {
    const k = await kolom("notifikasi_pesanan");
    expect(k).toContain("status_gateway");
    expect(k).not.toContain("status_midtrans");
  });

  it("catat_token_snap sudah tidak ada", async () => {
    const baris = await querySql(
      `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'catat_token_snap'`,
    );
    expect(baris).toHaveLength(0);
  });
});

describe("catat_tautan_gateway", () => {
  it("pemilik dengan percobaan sama: tautan terisi, waktu terbit terisi, jejak token_terbit lahir", async () => {
    const p = await pesananBaru();
    const klien = await signInAs(KLIEN);
    const { error } = await klien.rpc("catat_tautan_gateway", {
      p_pesanan_id: p.id,
      p_percobaan: p.percobaan,
      p_tautan: "https://gateway.example.test/bayar/abc",
    });
    expect(error).toBeNull();
    const b = await barisPesanan(p.id);
    expect(b.tautan_gateway).toBe("https://gateway.example.test/bayar/abc");
    expect(b.tautan_terbit_pada).not.toBeNull();
    const { data: jejak } = await svc
      .from("jejak_pesanan")
      .select("kejadian, keterangan")
      .eq("pesanan_id", p.id)
      .eq("kejadian", "token_terbit");
    expect(jejak).toHaveLength(1);
    expect(jejak![0].keterangan).toBe("tautan gateway dicatat");
  });

  it("percobaan berbeda dijawab P0002 dan kolom tetap null", async () => {
    const p = await pesananBaru();
    const klien = await signInAs(KLIEN);
    const { error } = await klien.rpc("catat_tautan_gateway", {
      p_pesanan_id: p.id,
      p_percobaan: p.percobaan + 1,
      p_tautan: "https://gateway.example.test/basi",
    });
    expect(error?.code).toBe("P0002");
    const b = await barisPesanan(p.id);
    expect(b.tautan_gateway).toBeNull();
    expect(b.tautan_terbit_pada).toBeNull();
  });

  it("klien lain dijawab P0002 dan kolom tetap null", async () => {
    const p = await pesananBaru();
    const lain = await signInAs(EMAIL_KLIEN_KEDUA);
    const { error } = await lain.rpc("catat_tautan_gateway", {
      p_pesanan_id: p.id,
      p_percobaan: p.percobaan,
      p_tautan: "https://gateway.example.test/curian",
    });
    expect(error?.code).toBe("P0002");
    expect((await barisPesanan(p.id)).tautan_gateway).toBeNull();
  });

  it.each([
    ["http biasa", "http://gateway.example.test/bayar/abc"],
    ["javascript:", "javascript:alert(1)"],
    ["teks bebas", "token-snap-lama"],
    ["HTTPS tanpa garis miring", "https:gateway.example.test"],
    ["kosong", ""],
  ])("tautan yang tidak diawali https:// ditolak P0001 (%s), kolom tetap null", async (_n, tautan) => {
    // Tautan ini dikirim ke peramban pembeli lewat `window.location.assign`
    // (jalur pakai-ulang `terbitkanTautanBayar`). Apa pun selain halaman
    // https bukan halaman bayar DOKU.
    const p = await pesananBaru();
    const klien = await signInAs(KLIEN);
    const { error } = await klien.rpc("catat_tautan_gateway", {
      p_pesanan_id: p.id,
      p_percobaan: p.percobaan,
      p_tautan: tautan,
    });
    expect(error?.code).toBe("P0001");
    expect(error!.message).toContain("https://");
    const b = await barisPesanan(p.id);
    expect(b.tautan_gateway).toBeNull();
    expect(b.tautan_terbit_pada).toBeNull();
  });

  it("pesanan yang tidak lagi menunggu_bayar dijawab P0002", async () => {
    const p = await pesananBaru();
    const klien = await signInAs(KLIEN);
    const batal = await klien.rpc("batalkan_pesanan_saya", { p_pesanan_id: p.id });
    expect(batal.error).toBeNull();
    const { error } = await klien.rpc("catat_tautan_gateway", {
      p_pesanan_id: p.id,
      p_percobaan: p.percobaan,
      p_tautan: "https://gateway.example.test/tutup",
    });
    expect(error?.code).toBe("P0002");
    expect((await barisPesanan(p.id)).tautan_gateway).toBeNull();
  });
});
