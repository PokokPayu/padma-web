import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";
import { POLA_INVOICE_DOKU, rakitInvoice } from "@/lib/pesanan/order-id";
import {
  STATUS_DOKU_ASING_DIKENAL,
  STATUS_DOKU_KEDALUWARSA,
  STATUS_DOKU_LUNAS,
  STATUS_DOKU_MENUNGGU,
  STATUS_DOKU_REFUND,
} from "@/lib/doku/status";

/**
 * `terapkan_notifikasi_gateway` — TABEL §5.5 SPEC DOKU, SEL DEMI SEL.
 *
 * Setiap sel tabel adalah keputusan ke mana uang orang pergi, jadi setiap sel
 * punya kasusnya sendiri: lima keadaan pesanan × setiap status DOKU yang
 * dikenal, ditambah dua status yang tidak dikenal (`STATUS_ANEH` dan string
 * kosong). Status-statusnya DITURUNKAN dari himpunan TS (`STATUS_DOKU_*`),
 * sedangkan harapannya ditulis harfiah per baris tabel. Supaya status yang
 * diam-diam hilang dari himpunan TS tidak ikut menghilangkan kasusnya, isi
 * himpunan itu dikunci tersendiri (describe "kesepakatan himpunan").
 *
 * ===== KENAPA PESANAN DILAHIRKAN LEWAT PINTU DEPAN =====
 * Fixture memakai `buat_pesanan` dengan sesi klien sungguhan, lalu membawa
 * pesanan ke keadaannya lewat fungsi yang sedang diuji (`lunas`, `ditahan`,
 * `kedaluwarsa`) atau lewat `batalkan_pesanan_saya` (`dibatalkan`). Baris yang
 * disisipkan langsung bisa berada dalam keadaan yang tidak pernah bisa dicapai
 * mesin ini, dan uji atas keadaan mustahil tidak membuktikan apa pun.
 *
 * ===== PEMBERSIHAN SEBELUM SETIAP KASUS =====
 * `pesanan_terbuka_satu_per_klien` hanya mengizinkan SATU pesanan
 * `menunggu_bayar` per klien, dan produk yang sudah dibeli (entitlement aktif)
 * atau sedang ditahan menolak checkout berikutnya. Karena itu setiap kasus
 * mulai dari klien yang bersih: jejak & notifikasi (tanpa foreign key, tidak
 * ikut cascade) → entitlement (`pesanan_id` restrict) → pesanan.
 */

const KLIEN_EMAIL = "ananda@padma.test";
/** Klien seed yang sudah tertaut ke akun auth (scripts/seed-users.ts). */
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";
const SLUG = "pad-uji-notifikasi-gateway";
const HARGA = 150_000;

const svc = createAdminSupabase();
let klien: SupabaseClient;
let produkId = "";

type Keadaan = "menunggu_bayar" | "lunas" | "ditahan" | "kedaluwarsa" | "dibatalkan";
const KEADAAN: readonly Keadaan[] = ["menunggu_bayar", "kedaluwarsa", "dibatalkan", "ditahan", "lunas"];

type Pesanan = { id: string; kode: string; percobaan: number; nominal: number };

async function bersihkan(): Promise<void> {
  const { data: pesanan } = await svc.from("orders").select("id").eq("client_id", ANANDA_CLIENT_ID);
  for (const p of pesanan ?? []) {
    await svc.from("jejak_pesanan").delete().eq("pesanan_id", p.id);
    await svc.from("notifikasi_pesanan").delete().eq("pesanan_id", p.id);
  }
  await svc.from("digital_entitlements").delete().eq("client_id", ANANDA_CLIENT_ID);
  await svc.from("orders").delete().eq("client_id", ANANDA_CLIENT_ID);
}

beforeAll(async () => {
  await bersihkan();
  await svc.from("digital_products").delete().eq("slug", SLUG);
  const { data, error } = await svc
    .from("digital_products")
    .insert({ judul: "Uji notifikasi gateway", slug: SLUG, aktif: true })
    .select("id")
    .single<{ id: string }>();
  if (error) throw error;
  produkId = data!.id;
  const { error: eHarga } = await svc
    .from("digital_product_prices")
    .insert({ product_id: produkId, harga: HARGA, berlaku_sejak: "2026-09-01" });
  if (eHarga) throw eHarga;
  klien = await signInAs(KLIEN_EMAIL);
});

beforeEach(bersihkan);

afterAll(async () => {
  await bersihkan();
  if (produkId) await svc.from("digital_products").delete().eq("id", produkId);
});

async function pesananBaru(): Promise<Pesanan> {
  const { data, error } = await klien.rpc("buat_pesanan", { p_product_id: produkId });
  if (error) throw new Error(`buat_pesanan gagal: ${error.code} ${error.message}`);
  const b = (data as Array<{ pesanan_id: string; kode: string; percobaan: number; nominal_tagih: number }>)[0];
  return { id: b.pesanan_id, kode: b.kode, percobaan: b.percobaan, nominal: b.nominal_tagih };
}

type Opsi = {
  sidik?: string;
  invoice?: string;
  sumber?: string;
  keterangan?: string;
  transaksiId?: string;
  kanal?: string;
};

/** Memanggil RPC dengan service role, persis seperti webhook dan rekonsiliasi kelak. */
async function terapkan(p: Pesanan, status: string, nominal: number | null, opsi: Opsi = {}) {
  const muatan: Record<string, unknown> = {
    p_invoice: opsi.invoice ?? rakitInvoice(p.kode, p.percobaan),
    p_status: status,
    p_transaksi_id: opsi.transaksiId ?? `trx-uji-${randomUUID()}`,
    p_kanal: opsi.kanal ?? "VIRTUAL_ACCOUNT_BCA",
    p_nominal: nominal,
    p_sidik: opsi.sidik ?? randomUUID(),
  };
  if (opsi.sumber !== undefined) muatan.p_sumber = opsi.sumber;
  if (opsi.keterangan !== undefined) muatan.p_keterangan = opsi.keterangan;
  return svc.rpc("terapkan_notifikasi_gateway", muatan);
}

async function terapkanPasti(p: Pesanan, status: string, nominal: number | null, harapan: string) {
  const { data, error } = await terapkan(p, status, nominal);
  if (error) throw new Error(`fixture ${status}: ${error.code} ${error.message}`);
  if (data !== harapan) throw new Error(`fixture ${status}: memulangkan ${String(data)}, bukan ${harapan}`);
}

type BarisPesanan = {
  status: Keadaan;
  sebab_tinjauan: string | null;
  butuh_tinjauan_pada: string | null;
  diperiksa_pada: string | null;
  notifikasi_pada: string | null;
  status_gateway: string | null;
  transaksi_id: string | null;
  kanal: string | null;
};

async function bacaPesanan(id: string): Promise<BarisPesanan> {
  const { data, error } = await svc
    .from("orders")
    .select("status, sebab_tinjauan, butuh_tinjauan_pada, diperiksa_pada, notifikasi_pada, status_gateway, transaksi_id, kanal")
    .eq("id", id)
    .single<BarisPesanan>();
  if (error) throw error;
  return data!;
}

type Jejak = { id: string; kejadian: string; keterangan: string | null };

async function jejak(id: string): Promise<Jejak[]> {
  const { data, error } = await svc
    .from("jejak_pesanan")
    .select("id, kejadian, keterangan")
    .eq("pesanan_id", id);
  if (error) throw error;
  return (data ?? []) as Jejak[];
}

async function aksesAktif(): Promise<boolean> {
  const { data, error } = await svc
    .from("digital_entitlements")
    .select("id")
    .eq("client_id", ANANDA_CLIENT_ID)
    .eq("product_id", produkId)
    .is("dicabut_pada", null);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Membawa pesanan baru ke `keadaan` lewat pintu depannya masing-masing. */
async function bentukPesanan(keadaan: Keadaan): Promise<Pesanan> {
  const p = await pesananBaru();
  expect(p.nominal).toBe(HARGA);
  switch (keadaan) {
    case "menunggu_bayar":
      break;
    case "lunas":
      await terapkanPasti(p, STATUS_DOKU_LUNAS[0], p.nominal, "diterapkan");
      break;
    case "ditahan":
      await terapkanPasti(p, STATUS_DOKU_LUNAS[0], p.nominal + 1, "diterapkan");
      break;
    case "kedaluwarsa":
      await terapkanPasti(p, STATUS_DOKU_KEDALUWARSA[0], p.nominal, "diterapkan");
      break;
    case "dibatalkan": {
      const { data, error } = await klien.rpc("batalkan_pesanan_saya", { p_pesanan_id: p.id });
      if (error || data !== true) throw new Error(`batalkan_pesanan_saya gagal: ${error?.message}`);
      break;
    }
  }
  const awal = await bacaPesanan(p.id);
  expect(awal.status, `fixture ${keadaan}`).toBe(keadaan);
  expect(awal.sebab_tinjauan, `fixture ${keadaan}`).toBe(keadaan === "ditahan" ? "selisih_nominal" : null);
  return p;
}

// ===========================================================================
// TABEL §5.5
// ===========================================================================

type Nominal = "cocok" | "meleset" | "kosong";
type BarisTabel = "lunas_cocok" | "lunas_meleset" | "menunggu" | "kedaluwarsa" | "refund" | "asing";
type Kasus = { status: string; nominal: Nominal; baris: BarisTabel };

function nominalUntuk(p: Pesanan, n: Nominal): number | null {
  if (n === "cocok") return p.nominal;
  if (n === "meleset") return p.nominal + 1;
  return null;
}

const KASUS: Kasus[] = [
  ...STATUS_DOKU_LUNAS.flatMap((status): Kasus[] => [
    { status, nominal: "cocok", baris: "lunas_cocok" },
    { status, nominal: "meleset", baris: "lunas_meleset" },
    { status, nominal: "kosong", baris: "lunas_meleset" },
  ]),
  ...STATUS_DOKU_MENUNGGU.map((status): Kasus => ({ status, nominal: "cocok", baris: "menunggu" })),
  ...STATUS_DOKU_KEDALUWARSA.map((status): Kasus => ({ status, nominal: "cocok", baris: "kedaluwarsa" })),
  ...STATUS_DOKU_REFUND.map((status): Kasus => ({ status, nominal: "cocok", baris: "refund" })),
  ...[...STATUS_DOKU_ASING_DIKENAL, "STATUS_ANEH", ""].map(
    (status): Kasus => ({ status, nominal: "cocok", baris: "asing" }),
  ),
];

type Harapan = {
  hasil: "diterapkan" | "tanpa_efek";
  status: Keadaan;
  sebab: string | null;
  /** Kejadian jejak BARU dari panggilan ini, urut abjad. */
  jejak: string[];
};

function h(hasil: Harapan["hasil"], status: Keadaan, sebab: string | null, jejakBaru: string[]): Harapan {
  return { hasil, status, sebab, jejak: [...jejakBaru].sort() };
}

/**
 * Tabel brief A4 / spec §5.5, ditulis HARFIAH. `ditahan` selalu membawa sebab
 * awal `selisih_nominal` dari fixture-nya, dan sebab itu harus bertahan
 * (`coalesce` lestari) di setiap sel kolomnya.
 */
const HARAPAN: Record<BarisTabel, Record<Keadaan, Harapan>> = {
  lunas_cocok: {
    menunggu_bayar: h("diterapkan", "lunas", null, ["notifikasi", "lunas", "akses_terbit"]),
    kedaluwarsa: h("tanpa_efek", "kedaluwarsa", "lunas_setelah_tutup", ["notifikasi", "lunas_setelah_tutup"]),
    dibatalkan: h("tanpa_efek", "dibatalkan", "lunas_setelah_tutup", ["notifikasi", "lunas_setelah_tutup"]),
    ditahan: h("tanpa_efek", "ditahan", "selisih_nominal", ["notifikasi", "selisih_status"]),
    lunas: h("tanpa_efek", "lunas", null, ["notifikasi"]),
  },
  lunas_meleset: {
    menunggu_bayar: h("diterapkan", "ditahan", "selisih_nominal", ["notifikasi", "ditahan", "selisih_nominal"]),
    // Sel cacat P1: nominal meleset pada pesanan tertutup tetap
    // `lunas_setelah_tutup`, bukan `tanpa_efek` tanpa tanda tinjauan.
    kedaluwarsa: h("tanpa_efek", "kedaluwarsa", "lunas_setelah_tutup", ["notifikasi", "lunas_setelah_tutup"]),
    dibatalkan: h("tanpa_efek", "dibatalkan", "lunas_setelah_tutup", ["notifikasi", "lunas_setelah_tutup"]),
    ditahan: h("tanpa_efek", "ditahan", "selisih_nominal", ["notifikasi", "selisih_status"]),
    lunas: h("tanpa_efek", "lunas", "selisih_nominal", ["notifikasi", "selisih_nominal"]),
  },
  menunggu: {
    menunggu_bayar: h("tanpa_efek", "menunggu_bayar", null, ["notifikasi"]),
    kedaluwarsa: h("tanpa_efek", "kedaluwarsa", null, ["notifikasi"]),
    dibatalkan: h("tanpa_efek", "dibatalkan", null, ["notifikasi"]),
    ditahan: h("tanpa_efek", "ditahan", "selisih_nominal", ["notifikasi"]),
    lunas: h("tanpa_efek", "lunas", null, ["notifikasi"]),
  },
  kedaluwarsa: {
    menunggu_bayar: h("diterapkan", "kedaluwarsa", null, ["notifikasi", "kedaluwarsa"]),
    kedaluwarsa: h("tanpa_efek", "kedaluwarsa", null, ["notifikasi"]),
    dibatalkan: h("tanpa_efek", "dibatalkan", null, ["notifikasi"]),
    ditahan: h("tanpa_efek", "ditahan", "selisih_nominal", ["notifikasi"]),
    lunas: h("tanpa_efek", "lunas", null, ["notifikasi"]),
  },
  refund: {
    menunggu_bayar: h("diterapkan", "menunggu_bayar", "refund", ["notifikasi", "selisih_status"]),
    kedaluwarsa: h("diterapkan", "kedaluwarsa", "refund", ["notifikasi", "selisih_status"]),
    dibatalkan: h("diterapkan", "dibatalkan", "refund", ["notifikasi", "selisih_status"]),
    ditahan: h("diterapkan", "ditahan", "selisih_nominal", ["notifikasi", "selisih_status"]),
    lunas: h("diterapkan", "lunas", "refund", ["notifikasi", "selisih_status"]),
  },
  asing: {
    menunggu_bayar: h("diterapkan", "menunggu_bayar", "selisih_status", ["notifikasi", "selisih_status"]),
    kedaluwarsa: h("diterapkan", "kedaluwarsa", "selisih_status", ["notifikasi", "selisih_status"]),
    dibatalkan: h("diterapkan", "dibatalkan", "selisih_status", ["notifikasi", "selisih_status"]),
    ditahan: h("diterapkan", "ditahan", "selisih_nominal", ["notifikasi", "selisih_status"]),
    lunas: h("diterapkan", "lunas", "selisih_status", ["notifikasi", "selisih_status"]),
  },
};

const SEL = KEADAAN.flatMap((keadaan) =>
  KASUS.map((k) => ({
    keadaan,
    ...k,
    label: `${k.status === "" ? '""' : k.status} (${k.nominal}) × ${keadaan}`,
  })),
);

describe("tabel §5.5 — setiap status × setiap keadaan pesanan", () => {
  it("cacah sel sesuai tabel: 13 jawaban × 5 keadaan", () => {
    // Anti-hampa: himpunan TS yang kosong melahirkan nol kasus, dan nol kasus
    // hijau tanpa memeriksa apa pun.
    expect(KASUS).toHaveLength(13);
    expect(SEL).toHaveLength(65);
  });

  it.each(SEL)("$label", async ({ keadaan, status, nominal, baris }) => {
    const harapan = HARAPAN[baris][keadaan];
    const p = await bentukPesanan(keadaan);
    const jejakAwal = new Set((await jejak(p.id)).map((j) => j.id));

    const { data, error } = await terapkan(p, status, nominalUntuk(p, nominal));
    expect(error).toBeNull();
    expect(data).toBe(harapan.hasil);

    const akhir = await bacaPesanan(p.id);
    expect(akhir.status).toBe(harapan.status);
    expect(akhir.sebab_tinjauan).toBe(harapan.sebab);
    // Aturan KEJADIAN_BUTUH_TINJAUAN: cap waktu dan sebab hidup berpasangan.
    expect(akhir.butuh_tinjauan_pada !== null).toBe(harapan.sebab !== null);

    const baru = (await jejak(p.id))
      .filter((j) => !jejakAwal.has(j.id))
      .map((j) => j.kejadian)
      .sort();
    expect(baru).toEqual(harapan.jejak);

    // Akses hanya terbit lewat transisi ke `lunas`, dan refund/status asing
    // pada pesanan `lunas` TIDAK mencabutnya.
    expect(await aksesAktif()).toBe(harapan.status === "lunas");
  });
});

// ===========================================================================
// KESEPAKATAN TS–SQL
// ===========================================================================

describe("kesepakatan himpunan status TS dan daftar SQL", () => {
  it("isi setiap himpunan STATUS_DOKU_* dikunci harfiah", () => {
    // Uji tabel di atas MENURUNKAN kasusnya dari himpunan ini. Status yang
    // dibuang dari himpunan ikut membuang kasusnya, jadi isinya dikunci di sini.
    expect(STATUS_DOKU_LUNAS).toEqual(["SUCCESS"]);
    expect(STATUS_DOKU_MENUNGGU).toEqual(["PENDING", "REDIRECT", "TIMEOUT", "FAILED"]);
    expect(STATUS_DOKU_KEDALUWARSA).toEqual(["EXPIRED"]);
    expect(STATUS_DOKU_REFUND).toEqual(["REFUNDED", "PARTIAL_REFUNDED"]);
    expect(STATUS_DOKU_ASING_DIKENAL).toEqual(["VOIDED"]);
  });

  it("literal status di badan fungsi SQL = gabungan himpunan TS yang dipetakan", async () => {
    // Arah sebaliknya: status yang ditambahkan ke daftar SQL tanpa masuk
    // himpunan TS tidak akan punya kasus tabel. Literal huruf besar utuh di
    // badan fungsi (komentar dibuang) hanyalah daftar status vonis.
    // `VOIDED` sengaja TIDAK disebut di SQL: ia jatuh ke `asing` bersama
    // status tak dikenal lainnya.
    const [f] = await querySql<{ badan: string }>(
      `select regexp_replace(p.prosrc, '--[^\\n]*', '', 'g') as badan
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'terapkan_notifikasi_gateway'`,
    );
    expect(f, "fungsi terapkan_notifikasi_gateway tidak ada").toBeDefined();
    const literal = [...new Set([...f.badan.matchAll(/'([A-Z][A-Z_]*)'/g)].map((m) => m[1]))].sort();
    expect(literal).toEqual(
      [...STATUS_DOKU_LUNAS, ...STATUS_DOKU_MENUNGGU, ...STATUS_DOKU_KEDALUWARSA, ...STATUS_DOKU_REFUND].sort(),
    );
  });

  it("invoice dari rakitInvoice atas hasil buat_pesanan cocok pola TS DAN dikenali RPC", async () => {
    const p = await pesananBaru();
    const invoice = rakitInvoice(p.kode, p.percobaan);
    expect(invoice).toMatch(POLA_INVOICE_DOKU);

    const sidik = randomUUID();
    const { data, error } = await terapkan(p, STATUS_DOKU_MENUNGGU[0], p.nominal, { sidik, invoice });
    expect(error).toBeNull();
    expect(data).toBe("tanpa_efek");

    const [n] = await querySql<{ pesanan_id: string }>(
      "select pesanan_id from public.notifikasi_pesanan where sidik = $1",
      [sidik],
    );
    expect(n?.pesanan_id).toBe(p.id);

    // Percobaan sama dan tanpa keterangan: jejak `notifikasi` = status saja.
    const notif = (await jejak(p.id)).filter((j) => j.kejadian === "notifikasi");
    expect(notif.map((j) => j.keterangan)).toEqual([STATUS_DOKU_MENUNGGU[0]]);
  });
});

// ===========================================================================
// UJI TAMBAHAN
// ===========================================================================

describe("idempotensi dan invoice yang tidak dikenal", () => {
  it("sidik yang sama dua kali: duplikat, tepat satu jejak notifikasi", async () => {
    const p = await pesananBaru();
    const sidik = randomUUID();
    const pertama = await terapkan(p, STATUS_DOKU_LUNAS[0], p.nominal, { sidik });
    expect(pertama.error).toBeNull();
    expect(pertama.data).toBe("diterapkan");

    const kedua = await terapkan(p, STATUS_DOKU_LUNAS[0], p.nominal, { sidik });
    expect(kedua.error).toBeNull();
    expect(kedua.data).toBe("duplikat");

    const kejadian = (await jejak(p.id)).map((j) => j.kejadian);
    expect(kejadian.filter((k) => k === "notifikasi")).toHaveLength(1);
    expect(kejadian.filter((k) => k === "lunas")).toHaveLength(1);
    const n = await querySql("select 1 from public.notifikasi_pesanan where sidik = $1", [sidik]);
    expect(n).toHaveLength(1);
  });

  it.each([
    ["bentuk order_id Midtrans", () => "PSN-261112-A1B2C3.1"],
    ["invoice sah yang tidak dikenal", () => "PSN000000ABCDEF1"],
  ])("%s: pesanan_tidak_ada, nol baris notifikasi", async (_nama, invoice) => {
    const p = await pesananBaru();
    const sidik = randomUUID();
    const { data, error } = await terapkan(p, STATUS_DOKU_LUNAS[0], p.nominal, { sidik, invoice: invoice() });
    expect(error).toBeNull();
    expect(data).toBe("pesanan_tidak_ada");
    expect(await querySql("select 1 from public.notifikasi_pesanan where sidik = $1", [sidik])).toHaveLength(0);
    expect((await bacaPesanan(p.id)).status).toBe("menunggu_bayar");
  });

  it("kode yang ADA tetapi percobaan 0: pesanan_tidak_ada, pesanan tidak disentuh", async () => {
    // Pola SQL harus menolak bentuk yang ditolak pola TS, walau kodenya nyata.
    const p = await pesananBaru();
    const invoice = `${rakitInvoice(p.kode, 1).slice(0, -1)}0`;
    expect(invoice).not.toMatch(POLA_INVOICE_DOKU);
    const sidik = randomUUID();
    const { data, error } = await terapkan(p, STATUS_DOKU_LUNAS[0], p.nominal, { sidik, invoice });
    expect(error).toBeNull();
    expect(data).toBe("pesanan_tidak_ada");
    expect(await querySql("select 1 from public.notifikasi_pesanan where sidik = $1", [sidik])).toHaveLength(0);
    expect((await bacaPesanan(p.id)).status).toBe("menunggu_bayar");
  });
});

describe("percobaan, sumber, dan cermin kolom", () => {
  it("invoice percobaan basi tetap diterapkan, dan jejak notifikasi menyebut percobaannya", async () => {
    const p = await pesananBaru();
    expect(p.percobaan).toBe(1);
    const { data, error } = await klien.rpc("buat_pesanan_keranjang", {
      p_product_ids: [produkId],
      p_ulang: true,
    });
    expect(error).toBeNull();
    expect((data as Array<{ percobaan: number }>)[0].percobaan).toBe(2);

    const hasil = await terapkan(p, STATUS_DOKU_LUNAS[0], p.nominal, { invoice: rakitInvoice(p.kode, 1) });
    expect(hasil.error).toBeNull();
    expect(hasil.data).toBe("diterapkan");
    expect((await bacaPesanan(p.id)).status).toBe("lunas");

    const notif = (await jejak(p.id)).filter((j) => j.kejadian === "notifikasi");
    expect(notif).toHaveLength(1);
    expect(notif[0].keterangan).toContain("percobaan 1");
    expect(notif[0].keterangan).toContain("percobaan 2");
  });

  it("p_sumber = 'status_api': diperiksa_pada terisi, jejak diperiksa_ulang, keterangan menempel", async () => {
    const p = await pesananBaru();
    const keterangan = "DOKU menjawab PENDING sesudah tenggat (uji)";
    const sidik = randomUUID();
    const { data, error } = await terapkan(p, STATUS_DOKU_MENUNGGU[0], p.nominal, {
      sidik,
      sumber: "status_api",
      keterangan,
    });
    expect(error).toBeNull();
    expect(data).toBe("tanpa_efek");

    const baris = await bacaPesanan(p.id);
    expect(baris.diperiksa_pada).not.toBeNull();
    // `notifikasi_pada` milik webhook saja.
    expect(baris.notifikasi_pada).toBeNull();

    const semua = await jejak(p.id);
    expect(semua.filter((j) => j.kejadian === "diperiksa_ulang")).toHaveLength(1);
    const notif = semua.filter((j) => j.kejadian === "notifikasi");
    expect(notif).toHaveLength(1);
    expect(notif[0].keterangan).toContain(keterangan);

    // Pemeriksaan ulang dicatat SEBELUM pintu sidik: jawaban yang sama
    // (duplikat) tetap menggerakkan pembatas Lapis 1b.
    const ulang = await terapkan(p, STATUS_DOKU_MENUNGGU[0], p.nominal, { sidik, sumber: "status_api" });
    expect(ulang.data).toBe("duplikat");
    expect((await jejak(p.id)).filter((j) => j.kejadian === "diperiksa_ulang")).toHaveLength(2);
  });

  it("p_sumber bawaan (webhook): notifikasi_pada terisi, diperiksa_pada tetap kosong", async () => {
    const p = await pesananBaru();
    const { data, error } = await terapkan(p, STATUS_DOKU_MENUNGGU[0], p.nominal);
    expect(error).toBeNull();
    expect(data).toBe("tanpa_efek");
    const baris = await bacaPesanan(p.id);
    expect(baris.notifikasi_pada).not.toBeNull();
    expect(baris.diperiksa_pada).toBeNull();
    expect((await jejak(p.id)).some((j) => j.kejadian === "diperiksa_ulang")).toBe(false);
  });

  it("p_sumber = 'lain' melempar dan tidak mencatat apa pun", async () => {
    const p = await pesananBaru();
    const sidik = randomUUID();
    const { data, error } = await terapkan(p, STATUS_DOKU_LUNAS[0], p.nominal, { sidik, sumber: "lain" });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code).toBe("P0001");
    expect(await querySql("select 1 from public.notifikasi_pesanan where sidik = $1", [sidik])).toHaveLength(0);
    expect((await bacaPesanan(p.id)).status).toBe("menunggu_bayar");
  });

  it("notifikasi_pesanan dan orders mencerminkan jawaban DOKU apa adanya", async () => {
    const p = await pesananBaru();
    const sidik = randomUUID();
    const transaksiId = `trx-uji-${randomUUID()}`;
    const { error } = await terapkan(p, STATUS_DOKU_LUNAS[0], p.nominal + 1, {
      sidik,
      transaksiId,
      kanal: "VIRTUAL_ACCOUNT_MANDIRI",
    });
    expect(error).toBeNull();

    const [n] = await querySql<{
      status_gateway: string;
      nominal_diterima: string | null;
      transaksi_id: string;
      kanal: string;
    }>(
      "select status_gateway, nominal_diterima::text, transaksi_id, kanal from public.notifikasi_pesanan where sidik = $1",
      [sidik],
    );
    expect(n.status_gateway).toBe(STATUS_DOKU_LUNAS[0]);
    expect(Number(n.nominal_diterima)).toBe(p.nominal + 1);
    expect(n.transaksi_id).toBe(transaksiId);
    expect(n.kanal).toBe("VIRTUAL_ACCOUNT_MANDIRI");

    const baris = await bacaPesanan(p.id);
    expect(baris.status_gateway).toBe(STATUS_DOKU_LUNAS[0]);
    expect(baris.transaksi_id).toBe(transaksiId);
    expect(baris.kanal).toBe("VIRTUAL_ACCOUNT_MANDIRI");

    // Nominal yang tidak bisa dinormalisasi disimpan sebagai null, bukan 0.
    const sidikKosong = randomUUID();
    await terapkan(p, "STATUS_ANEH", null, { sidik: sidikKosong });
    const [k] = await querySql<{ status_gateway: string; nominal_diterima: string | null }>(
      "select status_gateway, nominal_diterima::text from public.notifikasi_pesanan where sidik = $1",
      [sidikKosong],
    );
    expect(k.status_gateway).toBe("STATUS_ANEH");
    expect(k.nominal_diterima).toBeNull();
    expect((await bacaPesanan(p.id)).status_gateway).toBe("STATUS_ANEH");
  });
});
