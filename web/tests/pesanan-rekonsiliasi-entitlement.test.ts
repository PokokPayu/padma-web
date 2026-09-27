import { describe, it, expect, afterEach } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";

/**
 * REKONSILIASI: setiap klaim pendapatan punya pesanan yang membayarinya.
 *
 * Lubang yang ditambal migrasi keenam MENDAHULUI P1, tapi P1 yang mengubah
 * artinya. Sebelum P1, entitlement tidak punya harga. Sesudah P1,
 * `sumber='beli'` adalah KLAIM PENDAPATAN yang — selama policy staf masih
 * `for all` dan hak tulis `authenticated` masih menempel — bisa dikarang
 * setiap akun staf tanpa satu baris `orders` maupun `jejak_pesanan`. Cerita
 * rekonsiliasi yang P1 janjikan buta sepenuhnya terhadapnya, karena ia hanya
 * melihat dari sisi pesanan.
 *
 * Dua kemampuan staf yang ikut dicabut, DITERIMA SADAR dan ditulis terang:
 *   1. menulis `dicabut_pada` — satu-satunya tuas rem yang bisa ditarik tanpa
 *      akses basis data;
 *   2. menerbitkan entitlement `sumber='pemberian_admin'` — kategori yang
 *      sejak sekarang TIDAK BISA LAGI LAHIR; labelnya tetap dirender untuk
 *      baris lama (`src/app/admin/produk/[id]/page.tsx:35`) dan tidak akan
 *      pernah bertambah.
 * Keduanya praktis keadaan hari ini juga: tidak ada satu pun tombol di panel
 * untuk keduanya, jadi yang dicabut adalah kemampuan yang sudah menuntut orang
 * mengetik `curl` atau membuka SQL editor.
 *
 * Invariannya ditulis HARFIAH seperti di spec: tidak ada entitlement
 * `sumber='beli'` dengan `pesanan_id is null`, dan setiap `pesanan_id` yang
 * ditunjuk berstatus `lunas`.
 */

const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";
const svc = createAdminSupabase();
const produkUji: string[] = [];
let nomorKode = 0;

type Pelanggar = {
  id: string;
  client_id: string;
  product_id: string;
  pesanan_id: string | null;
  status_pesanan: string | null;
};

/**
 * `left join` + `is null`, bukan `not exists`: bentuk ini ikut menangkap
 * `pesanan_id` yang menunjuk pesanan yang sudah tidak ada sama sekali, bukan
 * hanya yang statusnya salah.
 */
async function entitlementBeliYatim(): Promise<Pelanggar[]> {
  return querySql<Pelanggar>(
    `select e.id,
            e.client_id,
            e.product_id,
            e.pesanan_id,
            o.status::text as status_pesanan
       from public.digital_entitlements e
       left join public.orders o on o.id = e.pesanan_id
      where e.sumber = 'beli'
        and (e.pesanan_id is null or o.id is null or o.status <> 'lunas')
      order by e.diberikan_pada`,
  );
}

function ringkas(baris: Pelanggar[]): string {
  return baris
    .map(
      (b) =>
        `  - entitlement ${b.id} (klien ${b.client_id}, produk ${b.product_id})` +
        ` -> pesanan ${b.pesanan_id ?? "(kosong)"} berstatus ${b.status_pesanan ?? "(tidak ada)"}`,
    )
    .join("\n");
}

function kodeUji(): string {
  nomorKode += 1;
  return `PSN-260927-${nomorKode.toString().padStart(6, "0")}`;
}

async function semaiProduk(slug: string, harga: number): Promise<string> {
  const { data, error } = await svc
    .from("digital_products")
    .insert({ judul: `Uji ${slug}`, slug, jenis: "pdf", aktif: true })
    .select("id")
    .single();
  if (error) throw error;
  produkUji.push(data!.id);
  const { error: eHarga } = await svc
    .from("digital_product_prices")
    .insert({ product_id: data!.id, harga, berlaku_sejak: "2026-09-01" });
  if (eHarga) throw eHarga;
  return data!.id;
}

async function semaiPesananLunas(produkId: string, harga: number) {
  const { data, error } = await svc
    .from("orders")
    .insert({
      kode: kodeUji(),
      client_id: ANANDA_CLIENT_ID,
      jumlah_item: 1,
      status: "lunas",
      ditutup_pada: new Date().toISOString(),
      lunas_pada: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  const { data: item, error: eItem } = await svc
    .from("order_items")
    .insert({
      pesanan_id: data!.id,
      jenis: "produk_digital",
      product_id: produkId,
      judul_beku: "Uji rekonsiliasi",
      harga_beku: harga,
      urutan: 1,
    })
    .select("id")
    .single();
  if (eItem) throw eItem;
  return { pesananId: data!.id, itemId: item!.id };
}

/** Entitlement DULU, pesanan SESUDAHNYA — `pesanan_id` adalah `on delete restrict`. */
async function bersihkan(): Promise<void> {
  const { data: pesanan } = await svc
    .from("orders")
    .select("id")
    .eq("client_id", ANANDA_CLIENT_ID);
  for (const p of pesanan ?? []) {
    await svc.from("jejak_pesanan").delete().eq("pesanan_id", p.id);
    await svc.from("notifikasi_pesanan").delete().eq("pesanan_id", p.id);
  }
  await svc.from("digital_entitlements").delete().eq("client_id", ANANDA_CLIENT_ID);
  await svc.from("orders").delete().eq("client_id", ANANDA_CLIENT_ID);
  while (produkUji.length) {
    await svc.from("digital_products").delete().eq("id", produkUji.pop()!);
  }
}

afterEach(bersihkan);

describe("hak tulis digital_entitlements sesudah penambalan", () => {
  it("admin TIDAK bisa lagi menerbitkan entitlement lewat PostgREST", async () => {
    const produk = await semaiProduk("tambal-admin-sisip", 120_000);
    const admin = await signInAs("admin@padma.test");

    const { error } = await admin
      .from("digital_entitlements")
      .insert({ client_id: ANANDA_CLIENT_ID, product_id: produk, sumber: "pemberian_admin" })
      .select("id");
    // 42501 di tingkat HAK TABEL, bukan sekadar nol baris dari RLS: policy
    // bisa ditambahkan seseorang besok tanpa satu uji pun merah selama haknya
    // masih menempel.
    expect(error?.code).toBe("42501");

    const { data } = await svc
      .from("digital_entitlements")
      .select("id")
      .eq("product_id", produk);
    expect(data ?? []).toEqual([]);
  });

  it("admin TIDAK bisa lagi menulis dicabut_pada lewat PostgREST", async () => {
    const produk = await semaiProduk("tambal-admin-cabut", 120_000);
    const { error: eSemai } = await svc
      .from("digital_entitlements")
      .insert({ client_id: ANANDA_CLIENT_ID, product_id: produk, sumber: "gratis" });
    expect(eSemai).toBeNull();

    const admin = await signInAs("admin@padma.test");
    const { error } = await admin
      .from("digital_entitlements")
      .update({ dicabut_pada: new Date().toISOString() })
      .eq("product_id", produk)
      .select("id");
    expect(error?.code).toBe("42501");

    const { data } = await svc
      .from("digital_entitlements")
      .select("dicabut_pada")
      .eq("product_id", produk)
      .single();
    expect(data!.dicabut_pada).toBeNull();
  });

  it("admin TETAP bisa MEMBACA seluruh entitlement — panel produk hidup dari ini", async () => {
    const produk = await semaiProduk("tambal-admin-baca", 120_000);
    await svc
      .from("digital_entitlements")
      .insert({ client_id: ANANDA_CLIENT_ID, product_id: produk, sumber: "gratis" });

    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin
      .from("digital_entitlements")
      .select("id, sumber")
      .eq("product_id", produk);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
  });

  it("policy staf tidak lagi menyediakan verba TULIS apa pun", async () => {
    const policy = await querySql<{ policyname: string; cmd: string }>(
      `select policyname, cmd
         from pg_policies
        where schemaname = 'public'
          and tablename = 'digital_entitlements'
        order by policyname`,
    );
    const staf = policy.find((p) => p.policyname === "entitlement: staf");
    expect(staf).toBeDefined();
    // `for all` mencakup INSERT/UPDATE/DELETE. Penyempitan ini adalah separuh
    // penambalan; separuh lainnya adalah pencabutan hak tabel di atas.
    expect(staf!.cmd).toBe("SELECT");
    expect(policy.every((p) => p.cmd === "SELECT")).toBe(true);
  });

  it("DELETE tetap mustahil bagi staf — dijaga ketiadaan HAK TABEL, dan itu dibuktikan di sini", async () => {
    // KOREKSI terhadap brief: `digital_entitlements` lahir (20260921120000)
    // SESUDAH `20260829190000_cabut_hak_hapus_berlebih.sql` mengubah default
    // privileges skema public agar tabel BARU tidak lagi mewarisi DELETE
    // untuk `authenticated` — dan tabel ini tidak pernah menyatakan niat
    // sebaliknya lewat `grant delete ... to authenticated`. Diverifikasi
    // langsung lewat katalog (`information_schema.role_table_grants`):
    // `authenticated` memang tidak pernah punya DELETE di tabel ini, dengan
    // atau tanpa migrasi ini. Jadi gerbangnya BUKAN "ketiadaan policy" (nol
    // baris senyap) seperti tertulis semula di brief — Postgres menolak
    // verba DELETE di lapis HAK TABEL sebelum RLS sempat dievaluasi, dan itu
    // memulangkan 42501, bukan nol baris. Migrasi ini tidak menyentuh hak
    // DELETE sama sekali; uji ini menagih bahwa penyempitan policy staf tidak
    // diam-diam membutuhkan (atau bergantung pada) hak yang sebetulnya sudah
    // tak ada sejak tabel ini lahir.
    const produk = await semaiProduk("tambal-admin-hapus", 120_000);
    await svc
      .from("digital_entitlements")
      .insert({ client_id: ANANDA_CLIENT_ID, product_id: produk, sumber: "gratis" });

    const admin = await signInAs("admin@padma.test");
    const { error } = await admin
      .from("digital_entitlements")
      .delete()
      .eq("product_id", produk)
      .select("id");
    expect(error?.code).toBe("42501");

    const { data } = await svc
      .from("digital_entitlements")
      .select("id")
      .eq("product_id", produk);
    expect((data ?? []).length).toBe(1);
  });
});

describe("invarian rekonsiliasi entitlement <-> pesanan", () => {
  it("nol entitlement sumber='beli' yang tidak berpasangan dengan pesanan LUNAS", async () => {
    const yatim = await entitlementBeliYatim();
    expect(
      yatim.length,
      yatim.length === 0
        ? ""
        : `${yatim.length} entitlement mengklaim 'beli' tanpa pesanan lunas yang membayarinya.\n` +
          `Sesudah penambalan, satu-satunya penulis sumber='beli' adalah\n` +
          `terbitkan_akses_item — jadi baris seperti ini berarti ada jalur tulis lain\n` +
          `yang terbuka, ATAU sebuah berkas uji menyemai entitlement 'beli' dengan\n` +
          `service role tanpa pesanannya.\n` +
          `Pelanggar:\n${ringkas(yatim)}`,
    ).toBe(0);
  });

  it("kuerinya benar-benar bisa MERAH — dibuktikan dengan pelanggar yang disengaja", async () => {
    // Uji invarian yang tidak pernah dibuktikan bisa merah adalah uji yang
    // hijau karena kueri-nya salah, dan tidak ada yang bisa membedakannya.
    const produk = await semaiProduk("rekonsiliasi-pelanggar", 120_000);
    const { data: karangan, error } = await svc
      .from("digital_entitlements")
      .insert({ client_id: ANANDA_CLIENT_ID, product_id: produk, sumber: "beli" })
      .select("id")
      .single();
    expect(error).toBeNull();

    const dengan = await entitlementBeliYatim();
    expect(dengan.map((p) => p.id)).toContain(karangan!.id);

    await svc.from("digital_entitlements").delete().eq("id", karangan!.id);
    const sesudah = await entitlementBeliYatim();
    expect(sesudah.map((p) => p.id)).not.toContain(karangan!.id);
  });

  it("pesanan yang BELUM lunas juga dihitung pelanggar", async () => {
    const produk = await semaiProduk("rekonsiliasi-belum-lunas", 120_000);
    const { data: pesanan } = await svc
      .from("orders")
      .insert({ kode: kodeUji(), client_id: ANANDA_CLIENT_ID, jumlah_item: 1 })
      .select("id")
      .single();
    const { data: karangan } = await svc
      .from("digital_entitlements")
      .insert({
        client_id: ANANDA_CLIENT_ID,
        product_id: produk,
        sumber: "beli",
        pesanan_id: pesanan!.id,
      })
      .select("id")
      .single();

    const yatim = await entitlementBeliYatim();
    expect(yatim.map((p) => p.id)).toContain(karangan!.id);
  });

  it("akses yang diterbitkan MESIN memenuhi invarian tanpa perbaikan apa pun", async () => {
    const produk = await semaiProduk("rekonsiliasi-mesin", 120_000);
    const { pesananId } = await semaiPesananLunas(produk, 120_000);

    const { error } = await svc.rpc("salurkan_pesanan", { p_pesanan_id: pesananId });
    expect(error).toBeNull();

    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("sumber, pesanan_id")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk)
      .single();
    expect(ent!.sumber).toBe("beli");
    expect(ent!.pesanan_id).toBe(pesananId);

    const yatim = await entitlementBeliYatim();
    expect(yatim.length, ringkas(yatim)).toBe(0);
  });

  it("pesanan yang entitlement-nya masih berdiri TIDAK bisa dihapus (on delete restrict)", async () => {
    const produk = await semaiProduk("rekonsiliasi-restrict", 120_000);
    const { pesananId } = await semaiPesananLunas(produk, 120_000);
    await svc.rpc("salurkan_pesanan", { p_pesanan_id: pesananId });

    // Nota yang bisa lenyap bukan nota. Konsekuensinya: pembersihan fixture
    // menghapus entitlement SEBELUM pesanan — dicatat, bukan ditemukan sebagai
    // galat di tengah run yang merah.
    const { error } = await svc.from("orders").delete().eq("id", pesananId).select("id");
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23503");
  });
});
