import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";
import { rakitOrderId } from "@/lib/pesanan/order-id";

/**
 * JANTUNG MESIN, DIUJI DI TEMPAT IA BERDIRI.
 *
 * Dua describe, dan keduanya sengaja ada di satu berkas:
 *
 *  1. KETIGA KEADAAN `terbitkan_akses_item`. Yang ketiga — entitlement yang
 *     sudah DICABUT lalu produknya dibayar — adalah keadaan yang paling mudah
 *     hilang dan paling mahal: tanpa keadaan (3), orang itu membayar dan tidak
 *     mendapat apa-apa DIAM-DIAM, pesanannya `lunas` tanpa `akses_terbit`, dan
 *     satu-satunya tombol yang relevan menulis "sudah ada" lagi selamanya.
 *
 *  2. CABANG-CABANG `terapkan_notifikasi_midtrans` yang TIDAK bisa dijangkau
 *     dari uji rute (Tugas 8) dengan ongkos wajar: `p_sumber = 'status_api'`,
 *     notifikasi pada pesanan yang sudah tertutup, dan nominal yang meleset.
 *     Uji rute membuktikan kode HTTP-nya; yang di sini membuktikan barisnya.
 *
 * Ditambah LIMA kelas masukan yang sebelumnya nol assertion, dan semuanya
 * jalan "uang masuk tanpa barang keluar":
 *   - seluruh cabang `capture` + `fraud_status` (yaitu SETIAP pembayaran
 *     kartu kredit), berikut `deny`;
 *   - klaim inti Lapis 0 "rollback melepas sidiknya" — dibuktikan dengan
 *     memicu 23505 sungguhan lewat `jejak_pesanan_lunas_sekali`, bukan dengan
 *     mem-mock RPC-nya;
 *   - notifikasi yang datang untuk `percobaan` LAMA (VA lama yang baru
 *     dibayar besoknya);
 *   - pengikat TIGA salinan bentuk `kode` (penerbit SQL, regex TS, regex di
 *     dalam RPC) dalam satu kasus, tanpa melahirkan salinan keempat;
 *   - verifikasi `count(*)` vs `jumlah_item`, dan `chargeback`.
 *
 * Tidak satu pun uji di berkas ini menyentuh jaringan: fungsi yang diuji
 * adalah fungsi BASIS DATA, dan Status API Midtrans tidak pernah dipanggil
 * dari sini. Karena itu berkas ini tidak perlu (dan tidak boleh) menyunting
 * `tests/setup-fetch-guard.ts`.
 */

const KLIEN_EMAIL = "ananda@padma.test";
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";

const svc = createAdminSupabase();
const produkUji: string[] = [];
let nomorKode = 0;

function kodeUji(): string {
  nomorKode += 1;
  return `PSN-260926-${nomorKode.toString().padStart(6, "0")}`;
}

function sidikUji(): string {
  return randomUUID();
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

type Pesanan = { pesananId: string; kode: string; itemId: string; orderId: string };

/**
 * Pesanan disemai LANGSUNG dengan service role, bukan lewat `buat_pesanan`.
 *
 * Bukan karena RPC itu tidak dipercaya, melainkan karena berkas ini butuh
 * pesanan berstatus `kedaluwarsa` dan `lunas` — keadaan yang `buat_pesanan`
 * memang tidak bisa melahirkan, dan yang menjadi inti dua kasus di bawah.
 * CHECK berpasangan `pesanan_tutup_bercap`/`pesanan_terbuka_tanpa_cap`
 * menuntut `ditutup_pada` terisi untuk setiap status selain `menunggu_bayar`;
 * fixture yang lupa mengisinya gagal 23514, bukan lolos diam-diam.
 */
async function semaiPesanan(opsi: {
  produkId: string;
  harga: number;
  status?: string;
  judul?: string;
}): Promise<Pesanan> {
  const status = opsi.status ?? "menunggu_bayar";
  const { data, error } = await svc
    .from("orders")
    .insert({
      kode: kodeUji(),
      client_id: ANANDA_CLIENT_ID,
      jumlah_item: 1,
      status,
      ditutup_pada: status === "menunggu_bayar" ? null : new Date().toISOString(),
      lunas_pada: status === "lunas" ? new Date().toISOString() : null,
    })
    .select("id, kode, percobaan")
    .single();
  if (error) throw error;

  const { data: item, error: eItem } = await svc
    .from("order_items")
    .insert({
      pesanan_id: data!.id,
      jenis: "produk_digital",
      product_id: opsi.produkId,
      judul_beku: opsi.judul ?? "Uji produk digital",
      harga_beku: opsi.harga,
      urutan: 1,
    })
    .select("id")
    .single();
  if (eItem) throw eItem;

  return {
    pesananId: data!.id,
    kode: data!.kode,
    itemId: item!.id,
    orderId: rakitOrderId(data!.kode, data!.percobaan),
  };
}

/**
 * Urutan pembersihan MENGIKAT:
 *   jejak & notifikasi (tanpa FK) → entitlement (pesanan_id restrict)
 *   → orders (cascade ke order_items) → digital_products
 *
 * `digital_entitlements.pesanan_id` adalah `on delete restrict`: menghapus
 * pesanan lebih dulu gagal 23503. Itu konsekuensi yang dicatat di spec, bukan
 * galat yang perlu dicari sebabnya.
 */
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

async function kejadian(pesananId: string): Promise<string[]> {
  const { data } = await svc
    .from("jejak_pesanan")
    .select("kejadian")
    .eq("pesanan_id", pesananId);
  return (data ?? []).map((j) => j.kejadian as string);
}

describe("terbitkan_akses_item — tiga keadaan, semuanya harfiah", () => {
  it("(1) BELUM ADA barisnya: entitlement lahir sumber='beli' dan menunjuk pesanannya", async () => {
    const produk = await semaiProduk("akses-belum-ada", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000, status: "lunas" });

    const { data, error } = await svc.rpc("terbitkan_akses_item", { p_item_id: p.itemId });
    expect(error).toBeNull();
    expect(data).toBe("akses_terbit");

    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("sumber, dicabut_pada, pesanan_id")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk)
      .single();
    expect(ent!.sumber).toBe("beli");
    expect(ent!.dicabut_pada).toBeNull();
    // Tanpa kolom ini, invarian rekonsiliasi tidak punya kunci pasangan sama
    // sekali — dan "pesanan mana yang membayari akses ini" tak terjawab.
    expect(ent!.pesanan_id).toBe(p.pesananId);

    expect(await kejadian(p.pesananId)).toEqual(["akses_terbit"]);
  });

  it("(2) SUDAH ADA & belum dicabut: sumber TIDAK diubah, pesanan_id diisi bila kosong", async () => {
    const produk = await semaiProduk("akses-sudah-ada", 120_000);
    const { error: eEnt } = await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID,
      product_id: produk,
      sumber: "gratis",
    });
    expect(eEnt).toBeNull();

    const p = await semaiPesanan({ produkId: produk, harga: 120_000, status: "lunas" });
    const { data, error } = await svc.rpc("terbitkan_akses_item", { p_item_id: p.itemId });
    expect(error).toBeNull();
    expect(data).toBe("akses_sudah_ada");

    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("sumber, pesanan_id")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk)
      .single();
    // Yang mencatat pendapatan adalah `orders`, bukan kolom `sumber`.
    // Menaikkan 'gratis' menjadi 'beli' akan menulis ulang sejarah yang benar.
    expect(ent!.sumber).toBe("gratis");
    expect(ent!.pesanan_id).toBe(p.pesananId);

    expect(await kejadian(p.pesananId)).toEqual(["akses_sudah_ada"]);
  });

  it("(3) SUDAH ADA & DICABUT: akses TIDAK dihidupkan, dan tinjauan MENYALA", async () => {
    const produk = await semaiProduk("akses-tercabut", 120_000);
    const dicabut = new Date("2026-09-20T03:00:00Z").toISOString();
    const { error: eEnt } = await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID,
      product_id: produk,
      sumber: "beli",
      dicabut_pada: dicabut,
    });
    expect(eEnt).toBeNull();

    const p = await semaiPesanan({ produkId: produk, harga: 120_000, status: "lunas" });
    const { data, error } = await svc.rpc("terbitkan_akses_item", { p_item_id: p.itemId });
    expect(error).toBeNull();
    expect(data).toBe("akses_tertahan");

    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("dicabut_pada")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk)
      .single();
    // Pencabutan adalah keputusan MANUSIA; pembayaran tidak boleh
    // membatalkannya diam-diam. Dibandingkan lewat `Date`, bukan string
    // mentah: Postgres menyerialkan timestamptz dengan sufiks `+00:00`,
    // bukan `Z`, jadi perbandingan string apa adanya gagal walau nilainya
    // identik.
    expect(new Date(ent!.dicabut_pada).toISOString()).toBe(dicabut);

    const { data: pesanan } = await svc
      .from("orders")
      .select("butuh_tinjauan_pada, sebab_tinjauan")
      .eq("id", p.pesananId)
      .single();
    // Tapi "uang masuk, barang tidak keluar" juga tidak boleh ikut diam.
    expect(pesanan!.butuh_tinjauan_pada).not.toBeNull();
    expect(pesanan!.sebab_tinjauan).toBe("akses_tertahan");

    expect(await kejadian(p.pesananId)).toEqual(["akses_tertahan"]);
  });

  it("item yang tidak ada ditolak, bukan dianggap sudah tersalur", async () => {
    const { error } = await svc.rpc("terbitkan_akses_item", {
      p_item_id: "00000000-0000-0000-0000-0000000000aa",
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("P0002");
  });
});

describe("terapkan_notifikasi_midtrans — jantung mesin", () => {
  it("settlement bernominal cocok: LUNAS dan aksesnya terbit di transaksi yang sama", async () => {
    const produk = await semaiProduk("mesin-lunas", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const { data, error } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-lunas-1",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(error).toBeNull();
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders")
      .select("status, lunas_pada, ditutup_pada, kanal, transaksi_id, status_midtrans, notifikasi_pada")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.status).toBe("lunas");
    expect(baris!.lunas_pada).not.toBeNull();
    expect(baris!.ditutup_pada).not.toBeNull();
    expect(baris!.kanal).toBe("bank_transfer");
    expect(baris!.transaksi_id).toBe("trx-lunas-1");
    expect(baris!.status_midtrans).toBe("settlement");
    expect(baris!.notifikasi_pada).not.toBeNull();

    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("sumber, pesanan_id")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk)
      .single();
    expect(ent!.sumber).toBe("beli");
    expect(ent!.pesanan_id).toBe(p.pesananId);

    const jejak = await kejadian(p.pesananId);
    expect(jejak).toEqual(expect.arrayContaining(["notifikasi", "lunas", "akses_terbit"]));
    // Janji tunggal ke proyek WhatsApp: jejak 'lunas' lahir TEPAT SEKALI.
    expect(jejak.filter((k) => k === "lunas").length).toBe(1);
  });

  it("sidik yang SAMA dua kali: yang kedua 'duplikat', tanpa baris notifikasi kedua", async () => {
    const produk = await semaiProduk("mesin-duplikat", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });
    const sidik = sidikUji();
    const muatan = {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-dup",
      p_payment_type: "qris",
      p_gross_amount: 120000,
      p_sidik: sidik,
    };

    const pertama = await svc.rpc("terapkan_notifikasi_midtrans", muatan);
    expect(pertama.data).toBe("diterapkan");
    const kedua = await svc.rpc("terapkan_notifikasi_midtrans", muatan);
    expect(kedua.error).toBeNull();
    expect(kedua.data).toBe("duplikat");

    const { data: notif } = await svc
      .from("notifikasi_pesanan")
      .select("id")
      .eq("pesanan_id", p.pesananId);
    expect((notif ?? []).length).toBe(1);

    const jejak = await kejadian(p.pesananId);
    expect(jejak.filter((k) => k === "lunas").length).toBe(1);
  });

  it("pending lalu settlement (sidik BERBEDA): keduanya diproses", async () => {
    const produk = await semaiProduk("mesin-pending-settle", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const pending = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "pending",
      p_fraud_status: "",
      p_transaction_id: "trx-a",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(pending.data).toBe("tanpa_efek");

    const { data: masihTerbuka } = await svc
      .from("orders")
      .select("status")
      .eq("id", p.pesananId)
      .single();
    expect(masihTerbuka!.status).toBe("menunggu_bayar");

    const settle = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-a",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    // Sidik sepesanan akan mengunci baris ini di 'pending' SELAMANYA. Inilah
    // uji yang membuat pilihan sidik berbutir-notifikasi tidak bisa diubah
    // diam-diam.
    expect(settle.data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders")
      .select("status")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.status).toBe("lunas");
  });

  it("nominal MELESET: pesanan DITAHAN, dan nominal yang diterima tetap disimpan", async () => {
    const produk = await semaiProduk("mesin-selisih", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const { data } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-kurang",
      p_payment_type: "bank_transfer",
      p_gross_amount: 70000,
      p_sidik: sidikUji(),
    });
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders")
      .select("status, ditutup_pada, butuh_tinjauan_pada, sebab_tinjauan, lunas_pada")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.status).toBe("ditahan");
    expect(baris!.ditutup_pada).not.toBeNull();
    expect(baris!.lunas_pada).toBeNull();
    expect(baris!.butuh_tinjauan_pada).not.toBeNull();
    expect(baris!.sebab_tinjauan).toBe("selisih_nominal");

    const { data: notif } = await svc
      .from("notifikasi_pesanan")
      .select("nominal_diterima")
      .eq("pesanan_id", p.pesananId)
      .single();
    // Untuk baris `ditahan` inilah satu-satunya tempat angka yang BENAR-BENAR
    // diterima tersimpan; tanpa kolom ini staf harus membuka dashboard
    // Midtrans untuk tahu selisihnya.
    expect(Number(notif!.nominal_diterima)).toBe(70000);

    const jejak = await kejadian(p.pesananId);
    expect(jejak).toEqual(expect.arrayContaining(["ditahan", "selisih_nominal"]));

    // Akses TIDAK terbit: yang ditahan belum diputuskan siapa pun.
    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("id")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk);
    expect(ent ?? []).toEqual([]);
  });

  it("settlement pada pesanan yang sudah KEDALUWARSA: status tetap, tinjauan menyala", async () => {
    const produk = await semaiProduk("mesin-setelah-tutup", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000, status: "kedaluwarsa" });

    const { data } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-telat",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(data).toBe("tanpa_efek");

    const { data: baris } = await svc
      .from("orders")
      .select("status, butuh_tinjauan_pada, sebab_tinjauan")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.status).toBe("kedaluwarsa");
    // Tanpa penanda ini, barisnya tidak muncul di blok mana pun di
    // /admin/pesanan meski uangnya sudah masuk.
    expect(baris!.butuh_tinjauan_pada).not.toBeNull();
    expect(baris!.sebab_tinjauan).toBe("lunas_setelah_tutup");
    expect(await kejadian(p.pesananId)).toEqual(
      expect.arrayContaining(["notifikasi", "lunas_setelah_tutup"]),
    );
  });

  it("expire memindahkan pesanan ke kedaluwarsa; expire kedua tanpa efek", async () => {
    const produk = await semaiProduk("mesin-expire", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const pertama = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "expire",
      p_fraud_status: "",
      p_transaction_id: "",
      p_payment_type: "",
      p_gross_amount: 0,
      p_sidik: sidikUji(),
    });
    expect(pertama.data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders")
      .select("status, ditutup_pada")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.status).toBe("kedaluwarsa");
    expect(baris!.ditutup_pada).not.toBeNull();

    const kedua = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "expire",
      p_fraud_status: "",
      p_transaction_id: "",
      p_payment_type: "",
      p_gross_amount: 0,
      p_sidik: sidikUji(),
    });
    // Keadaan akhir sudah tercapai — dan cabang yang tidak mengenai baris
    // tidak boleh berubah jadi 500 abadi sepanjang jendela retry Midtrans.
    expect(kedua.error).toBeNull();
    expect(kedua.data).toBe("tanpa_efek");
  });

  it("refund: status tetap lunas, akses TIDAK dicabut, tapi manusia dipanggil", async () => {
    const produk = await semaiProduk("mesin-refund", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });
    await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-refund",
      p_payment_type: "credit_card",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });

    const { data } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "refund",
      p_fraud_status: "",
      p_transaction_id: "trx-refund",
      p_payment_type: "credit_card",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders")
      .select("status, sebab_tinjauan, butuh_tinjauan_pada")
      .eq("id", p.pesananId)
      .single();
    // Repo ini tidak punya mekanisme pengembalian uang di mana pun; status
    // yang tidak punya kebijakan adalah keadaan mati.
    expect(baris!.status).toBe("lunas");
    expect(baris!.sebab_tinjauan).toBe("refund");
    expect(baris!.butuh_tinjauan_pada).not.toBeNull();

    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("dicabut_pada")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk)
      .single();
    expect(ent!.dicabut_pada).toBeNull();
    expect(await kejadian(p.pesananId)).toEqual(expect.arrayContaining(["selisih_status"]));
  });

  it("capture + fraud_status='accept': LUNAS dan aksesnya terbit", async () => {
    // KARTU KREDIT. Permintaan klien yang melahirkan P1 berbunyi "pilihan
    // lebih luas ga hanya qris aja", dan kartu adalah SATU-SATUNYA metode yang
    // mengirim `capture` + `fraud_status`. Sampai kasus ini lahir, seluruh
    // cabang itu nol assertion — settlement, expire, refund, duplikat, dan
    // urutan terbalik semuanya diuji, dan jalur kartu tidak satu pun.
    const produk = await semaiProduk("mesin-capture-accept", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const { data, error } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "capture",
      p_fraud_status: "accept",
      p_transaction_id: "trx-capture-accept",
      p_payment_type: "credit_card",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(error).toBeNull();
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders").select("status").eq("id", p.pesananId).single();
    expect(baris!.status).toBe("lunas");
    expect(await kejadian(p.pesananId)).toEqual(expect.arrayContaining(["lunas", "akses_terbit"]));
  });

  it("capture TANPA fraud_status dibaca 'accept' — default coalesce dikunci", async () => {
    // `coalesce(nullif(p_fraud_status,''),'accept')` adalah satu baris yang
    // bisa dibalik ke 'challenge' oleh siapa pun yang mengira itu lebih aman.
    // Dua arah gagalnya sama-sama mahal: dibalik -> SETIAP pembayaran kartu
    // mendarat di `ditahan` dan menuntut putusan manusia satu per satu,
    // sementara `punya_pesanan_menunggu` menahan tombol belinya. Kasus ini
    // yang membuat pembalikan itu merah.
    const produk = await semaiProduk("mesin-capture-kosong", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const { data } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "capture",
      p_fraud_status: "",
      p_transaction_id: "trx-capture-kosong",
      p_payment_type: "credit_card",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders").select("status").eq("id", p.pesananId).single();
    expect(baris!.status).toBe("lunas");
  });

  it("capture + fraud_status='challenge': DITAHAN, nol entitlement", async () => {
    // Arah sebaliknya, dan ini yang paling mahal: uangnya masih DITAHAN
    // Midtrans dan bisa dibalikkan. Memperlakukannya `accept` berarti barang
    // keluar atas uang yang belum benar-benar masuk.
    const produk = await semaiProduk("mesin-capture-challenge", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const { data } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "capture",
      p_fraud_status: "challenge",
      p_transaction_id: "trx-capture-challenge",
      p_payment_type: "credit_card",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders")
      .select("status, sebab_tinjauan, butuh_tinjauan_pada")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.status).toBe("ditahan");
    expect(baris!.sebab_tinjauan).toBe("selisih_status");
    expect(baris!.butuh_tinjauan_pada).not.toBeNull();

    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("id")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk);
    expect(ent ?? []).toEqual([]);
  });

  it("deny: pesanan DIBATALKAN, bukan dibiarkan menggantung", async () => {
    const produk = await semaiProduk("mesin-deny", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const { data } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "deny",
      p_fraud_status: "deny",
      p_transaction_id: "trx-deny",
      p_payment_type: "credit_card",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders").select("status, ditutup_pada").eq("id", p.pesananId).single();
    expect(baris!.status).toBe("dibatalkan");
    expect(baris!.ditutup_pada).not.toBeNull();
  });

  it("ROLLBACK MELEPAS SIDIKNYA — dan retry sesudahnya benar-benar menyembuhkan", async () => {
    // KLAIM INTI LAPIS 0, dan sampai kasus ini lahir ia nol assertion.
    // Satu-satunya uji kelas 500 di seluruh rencana (Tugas 8, "galat basis
    // data -> 500") mem-MOCK `createAdminSupabase().rpc`, sehingga RPC-nya
    // TIDAK PERNAH dijalankan: tidak ada transaksi, tidak ada sidik, tidak ada
    // rollback untuk dibuktikan.
    //
    // Pemicunya murah dan nyata: `jejak_pesanan_lunas_sekali` adalah indeks
    // unik PARSIAL, jadi satu baris jejak `lunas` yang sudah ada membuat insert
    // jejak di akhir RPC gagal 23505 -> RPC melempar -> rute 500 -> Midtrans
    // mengirim ulang. Bila kelak seseorang memindahkan insert sidik ke
    // panggilan supabase-js terpisah ("biar rutenya yang tahu duplikat"), atau
    // membungkusnya `exception when others then null`, SETIAP uji lain tetap
    // hijau — sementara retry kedua dijawab `duplikat` -> 200, pesanan tinggal
    // `menunggu_bayar` selamanya, dan uangnya sudah di Midtrans.
    const produk = await semaiProduk("mesin-rollback-sidik", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const { data: palsu, error: ePalsu } = await svc
      .from("jejak_pesanan")
      .insert({ pesanan_id: p.pesananId, kejadian: "lunas", keterangan: "penghalang uji" })
      .select("id")
      .single();
    expect(ePalsu).toBeNull();

    const sidik = sidikUji();
    const muatan = {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-rollback",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidik,
    };

    const gagal = await svc.rpc("terapkan_notifikasi_midtrans", muatan);
    expect(gagal.error?.code).toBe("23505");

    // Inilah rollbacknya: sidiknya TIDAK tertinggal, dan barisnya tidak bergerak.
    const { data: notif } = await svc
      .from("notifikasi_pesanan").select("id").eq("sidik", sidik);
    expect(notif ?? []).toEqual([]);
    const { data: masih } = await svc
      .from("orders").select("status").eq("id", p.pesananId).single();
    expect(masih!.status).toBe("menunggu_bayar");

    // Dan inilah seluruh isi janji Lapis 0: sesudah penghalangnya hilang,
    // notifikasi dengan sidik yang SAMA masih bisa menyembuhkan.
    await svc.from("jejak_pesanan").delete().eq("id", palsu!.id);
    const ulang = await svc.rpc("terapkan_notifikasi_midtrans", muatan);
    expect(ulang.error).toBeNull();
    expect(ulang.data).toBe("diterapkan");

    const { data: sesudah } = await svc
      .from("orders").select("status").eq("id", p.pesananId).single();
    expect(sesudah!.status).toBe("lunas");
  });

  it("notifikasi untuk PERCOBAAN LAMA tetap diterapkan, dan selisihnya dicatat", async () => {
    // RPC sengaja mencari pesanan lewat `kode` SAJA. Skenarionya nyata:
    // pembeli membuka Snap percobaan 1, mendapat nomor VA, menekan "coba
    // lagi" sehingga barisnya naik ke percobaan 2, lalu besoknya transfer ke
    // VA LAMA. Uang yang mendarat lewat percobaan lama tetap uang yang
    // mendarat.
    //
    // Tanpa kasus ini, seseorang "merapikan" pencariannya jadi
    // `where kode = v_kode and percobaan = v_percobaan` — pembacaan yang
    // terdengar LEBIH benar — dan pembayaran itu dijawab 200 lalu lenyap tanpa
    // bekas, dengan seluruh suite tetap hijau.
    const produk = await semaiProduk("mesin-percobaan-lama", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });
    await svc.from("orders").update({ percobaan: 3 }).eq("id", p.pesananId);

    const { data, error } = await svc.rpc("terapkan_notifikasi_midtrans", {
      // p.orderId dirakit saat percobaan masih 1 — persis VA lama.
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-va-lama",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(error).toBeNull();
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders").select("status").eq("id", p.pesananId).single();
    expect(baris!.status).toBe("lunas");

    const { data: jejak } = await svc
      .from("jejak_pesanan")
      .select("keterangan")
      .eq("pesanan_id", p.pesananId)
      .eq("kejadian", "notifikasi");
    expect((jejak ?? []).some((j) => (j.keterangan ?? "").includes("percobaan"))).toBe(true);
  });

  it("kode HASIL buat_pesanan lolos regex DI DALAM RPC — pengikat tiga salinan", async () => {
    // Bentuk `kode` punya TIGA salinan: penerbit SQL di `buat_pesanan`,
    // `POLA_KODE_PESANAN`/`POLA_ORDER_ID` di TypeScript, dan regex di dalam
    // fungsi ini. Uji Tugas 4 mengikat dua yang pertama; kasus ini yang
    // mengikat ketiganya sekaligus, tanpa melahirkan salinan keempat.
    //
    // Bentuk kegagalan yang dijaganya: satu orang menurunkan `upper(...)` di
    // penerbit, dan sejak saat itu SETIAP notifikasi dijawab
    // `pesanan_tidak_ada` -> 200 -> dibuang, tanpa galat di mana pun.
    const produk = await semaiProduk("mesin-bentuk-kode", 120_000);
    const klien = await signInAs(KLIEN_EMAIL);
    const { data: dibuat, error: eBuat } = await klien.rpc("buat_pesanan", {
      p_product_id: produk,
    });
    expect(eBuat).toBeNull();
    const baris = (dibuat as Array<{ kode: string; percobaan: number }>)[0];

    const { data, error } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: rakitOrderId(baris.kode, baris.percobaan),
      p_transaction_status: "pending",
      p_fraud_status: "",
      p_transaction_id: "trx-bentuk",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(error).toBeNull();
    expect(data).not.toBe("pesanan_tidak_ada");
  });

  it("jumlah_item yang tidak cocok dengan cacah item nyata: DITAHAN", async () => {
    // Spec menuntut verifikasi `count(*)` di samping verifikasi nominal, dan
    // kodenya ada (`v_cacah <> v_jumlah_item`) — tapi di P1 keduanya selalu 1,
    // jadi cabang ini akan mendarat di P2 (keranjang) tanpa pernah dibuktikan
    // bekerja. Di sanalah ia jadi satu-satunya yang menangkap item yang hilang
    // antara checkout dan settlement.
    const produk = await semaiProduk("mesin-cacah-item", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });
    await svc.from("orders").update({ jumlah_item: 2 }).eq("id", p.pesananId);

    const { data } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-cacah",
      p_payment_type: "bank_transfer",
      // Nominalnya COCOK — jadi yang memerahkan hanya cacah itemnya.
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders")
      .select("status, sebab_tinjauan")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.status).toBe("ditahan");
    expect(baris!.sebab_tinjauan).toBe("selisih_nominal");
  });

  it("chargeback: status tetap lunas, akses tidak dicabut, manusia dipanggil", async () => {
    // Spec menyebut "refund, chargeback dan variannya"; hanya `refund` yang
    // diuji sebelumnya. Keduanya jatuh ke cabang yang sama, tapi `v_sebab`-nya
    // berbeda — dan `sebab_tinjauan` itulah yang dibaca staf.
    const produk = await semaiProduk("mesin-chargeback", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });
    await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-cb",
      p_payment_type: "credit_card",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });

    const { data } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "chargeback",
      p_fraud_status: "",
      p_transaction_id: "trx-cb",
      p_payment_type: "credit_card",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(data).toBe("diterapkan");

    const { data: baris } = await svc
      .from("orders")
      .select("status, sebab_tinjauan, butuh_tinjauan_pada")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.status).toBe("lunas");
    expect(baris!.sebab_tinjauan).toBe("chargeback");
    expect(baris!.butuh_tinjauan_pada).not.toBeNull();

    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("dicabut_pada")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk)
      .single();
    expect(ent!.dicabut_pada).toBeNull();
  });

  it("order_id yang tidak menunjuk pesanan mana pun: 'pesanan_tidak_ada', NOL tulisan", async () => {
    const asing = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: "PSN-260926-FFFFFF.1",
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-hantu",
      p_payment_type: "qris",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(asing.error).toBeNull();
    expect(asing.data).toBe("pesanan_tidak_ada");

    const cacat = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: "bukan-order-id",
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-hantu",
      p_payment_type: "qris",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
    });
    expect(cacat.error).toBeNull();
    expect(cacat.data).toBe("pesanan_tidak_ada");

    // Sidiknya TIDAK boleh ikut tersimpan: baris notifikasi yatim akan
    // menolak notifikasi sah yang kelak membawa sidik yang sama.
    const { data: notif } = await svc
      .from("notifikasi_pesanan")
      .select("id")
      .is("pesanan_id", null);
    expect(notif ?? []).toEqual([]);
  });

  it("p_sumber='status_api' menyetel diperiksa_pada dan melahirkan jejak diperiksa_ulang", async () => {
    const produk = await semaiProduk("mesin-status-api", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });

    const { data, error } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "pending",
      p_fraud_status: "",
      p_transaction_id: "trx-periksa",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
      p_sumber: "status_api",
    });
    expect(error).toBeNull();
    expect(data).toBe("tanpa_efek");

    const { data: baris } = await svc
      .from("orders")
      .select("diperiksa_pada, notifikasi_pada")
      .eq("id", p.pesananId)
      .single();
    // Pembatas "sekali per pesanan per lima menit" (Lapis 1b) bersandar pada
    // kolom ini. Bila ia hanya disetel pada jalur yang TIDAK duplikat, satu
    // halaman yang di-refresh berkali-kali menjadi banjir permintaan.
    expect(baris!.diperiksa_pada).not.toBeNull();
    expect(baris!.notifikasi_pada).toBeNull();
    expect(await kejadian(p.pesananId)).toEqual(
      expect.arrayContaining(["diperiksa_ulang", "notifikasi"]),
    );
  });

  it("pemeriksaan ulang yang BERULANG tetap menyetel diperiksa_pada walau sidiknya duplikat", async () => {
    const produk = await semaiProduk("mesin-periksa-dua-kali", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });
    const sidik = sidikUji();
    const muatan = {
      p_order_id: p.orderId,
      p_transaction_status: "pending",
      p_fraud_status: "",
      p_transaction_id: "trx-ulang",
      p_payment_type: "bank_transfer",
      p_gross_amount: 120000,
      p_sidik: sidik,
      p_sumber: "status_api",
    };
    await svc.rpc("terapkan_notifikasi_midtrans", muatan);
    await svc.from("orders").update({ diperiksa_pada: null }).eq("id", p.pesananId);

    const kedua = await svc.rpc("terapkan_notifikasi_midtrans", muatan);
    expect(kedua.data).toBe("duplikat");

    const { data: baris } = await svc
      .from("orders")
      .select("diperiksa_pada")
      .eq("id", p.pesananId)
      .single();
    expect(baris!.diperiksa_pada).not.toBeNull();
  });

  it("sumber yang tidak dikenal ditolak — bukan diam-diam dianggap webhook", async () => {
    const produk = await semaiProduk("mesin-sumber-asing", 120_000);
    const p = await semaiPesanan({ produkId: produk, harga: 120_000 });
    const { error } = await svc.rpc("terapkan_notifikasi_midtrans", {
      p_order_id: p.orderId,
      p_transaction_status: "settlement",
      p_fraud_status: "",
      p_transaction_id: "trx-x",
      p_payment_type: "qris",
      p_gross_amount: 120000,
      p_sidik: sidikUji(),
      p_sumber: "tombol_admin",
    });
    expect(error?.code).toBe("P0001");
  });
});

describe("view pesanan_item_staf", () => {
  it("staf melihat enam kolom BERNOMINAL; klien tidak melihat baris apa pun", async () => {
    const produk = await semaiProduk("view-staf", 120_000);
    const p = await semaiPesanan({
      produkId: produk,
      harga: 120_000,
      status: "lunas",
      judul: "Kelas Menyusui",
    });

    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin
      .from("pesanan_item_staf")
      .select("*")
      .eq("pesanan_id", p.pesananId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
    expect(Object.keys(data![0]).sort()).toEqual([
      "harga_beku",
      "jenis",
      "judul_beku",
      "kode",
      "pesanan_id",
      "urutan",
    ]);
    expect(data![0].harga_beku).toBe(120_000);
    expect(data![0].kode).toBe(p.kode);
    expect(data![0].judul_beku).toBe("Kelas Menyusui");

    const klien = await signInAs(KLIEN_EMAIL);
    const { data: lewatKlien, error: eKlien } = await klien
      .from("pesanan_item_staf")
      .select("pesanan_id")
      .eq("pesanan_id", p.pesananId);
    // Predikat `user_role()` hidup DI DALAM badan view: klien mendapat nol
    // baris, bukan galat — dan bukan harga orang lain.
    expect(eKlien).toBeNull();
    expect(lewatKlien ?? []).toEqual([]);
  });

  it("anon ditolak di pintu HAK, bukan sekadar dipulangkan nol baris", async () => {
    const { error } = await anonClient().from("pesanan_item_staf").select("pesanan_id").limit(1);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });
});
