import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";
import {
  POLA_KODE_PESANAN,
  POLA_ORDER_ID,
  rakitOrderId,
  uraiOrderId,
} from "@/lib/pesanan/order-id";

/**
 * CHECKOUT DIUJI LEWAT POSTGREST LANGSUNG, bukan lewat server action.
 *
 * Alasannya sama dengan yang sudah tertulis di
 * `supabase/migrations/20260921150000_ambil_produk_gratis.sql`: server action
 * bukan satu-satunya jalan menuju RPC ini — PostgREST mengekspos
 * `rpc/buat_pesanan` kepada siapa pun yang login. Uji yang hanya melewati
 * server action membuktikan server action-nya sopan, bukan bahwa pintunya
 * terkunci.
 *
 * Enam kasus di bawah adalah kasus yang MEMBAYAR ongkos berkas ini:
 *   1. dua panggilan paralel melahirkan TEPAT SATU pesanan (indeks unik
 *      parsial `pesanan_terbuka_satu_per_klien`, bukan kunci di TypeScript);
 *   2. harga yang sudah dibekukan TIDAK ikut naik walau harga etalase naik
 *      di antara dua panggilan;
 *   3. pesanan terbuka untuk produk LAIN ditolak dengan kalimat yang bisa
 *      dibaca manusia, bukan 23505 telanjang;
 *   4. klien yang SUDAH memiliki produknya ditolak — jalan "uang masuk tanpa
 *      barang baru keluar" yang tidak muncul di layar siapa pun;
 *   5. KLIEN LAIN (bukan sekadar akun tanpa rekam klien) tidak bisa menyentuh
 *      pesanan orang — satu-satunya uji yang menjaga klausa
 *      `and o.client_id = v_client_id`;
 *   6. setiap `P0001` diadu per KALIMAT, bukan per kode: satu fungsi di sini
 *      melempar P0001 untuk empat sebab berbeda, dan kode telanjang tidak bisa
 *      membedakan satu pun di antaranya.
 */

const KLIEN_EMAIL = "ananda@padma.test";
/** Klien seed yang SUDAH tertaut ke akun auth (scripts/seed-users.ts). */
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";

// Klien KEDUA ber-akun auth — lihat dokblok `tests/helpers/klien-kedua.ts`
// (Step 0). Tanpa ia, "orang lain tidak bisa menyentuh pesanan saya" hanya
// bisa ditulis dengan sesi admin, yang menabrak gerbang yang SAMA SEKALI
// BERBEDA.
import {
  EMAIL_KLIEN_KEDUA,
  siapkanKlienKedua,
  bongkarKlienKedua,
} from "./helpers/klien-kedua";

type BarisPesanan = {
  pesanan_id: string;
  kode: string;
  percobaan: number;
  nominal_tagih: number;
  judul: string;
};

const svc = createAdminSupabase();
const produkUji: string[] = [];

/** Hari ini menurut BASIS DATA, bukan menurut jam mesin penguji (vitest TZ=UTC). */
async function hariIniJakarta(): Promise<string> {
  const baris = await querySql<{ hari: string }>(
    "select (now() at time zone 'Asia/Jakarta')::date::text as hari",
  );
  return baris[0].hari;
}

async function semaiProduk(
  slug: string,
  harga: number,
  opsi: { aktif?: boolean; berlakuSejak?: string } = {},
): Promise<string> {
  const { data, error } = await svc
    .from("digital_products")
    .insert({ judul: `Uji ${slug}`, slug, jenis: "pdf", aktif: opsi.aktif ?? true })
    .select("id")
    .single();
  if (error) throw error;
  produkUji.push(data!.id);
  const { error: eHarga } = await svc.from("digital_product_prices").insert({
    product_id: data!.id,
    harga,
    // Sengaja LAMPAU: uji "harga beku" menyisipkan baris harga BERTANGGAL HARI
    // INI di tengah jalan, dan `unique (product_id, berlaku_sejak)` menolak dua
    // baris bertanggal sama.
    berlaku_sejak: opsi.berlakuSejak ?? "2026-09-01",
  });
  if (eHarga) throw eHarga;
  return data!.id;
}

/**
 * Pembersihan BERURUTAN, dan urutannya bukan selera (peta §13.2):
 *
 *   digital_entitlements → jejak_pesanan & notifikasi_pesanan → orders
 *   → digital_products
 *
 * `digital_entitlements.pesanan_id` ber-`on delete restrict`, jadi entitlement
 * yang menunjuk pesanan harus lenyap lebih dulu. Yang disemai berkas ini
 * ber-`pesanan_id` null, tapi urutannya ditulis benar sejak awal supaya ia
 * tidak jadi galat yang harus dicari sebabnya begitu Tugas 5 mendarat.
 *
 * `jejak_pesanan` dan `notifikasi_pesanan` sengaja TANPA foreign key (jejak
 * yang ikut lenyap bersama yang diaudit tidak berguna), jadi tidak ada cascade
 * yang menyapunya — `tests/pesanan-jejak-yatim.test.ts` akan merah bila
 * dilewatkan. `orders` dihapus SEBELUM `digital_products` karena
 * `order_items.product_id` menunjuk produk TANPA `on delete cascade`:
 * menghapus produknya lebih dulu gagal dengan 23503.
 */
async function bersihkan(): Promise<void> {
  await svc.from("digital_entitlements").delete().eq("client_id", ANANDA_CLIENT_ID);

  const { data: pesanan } = await svc
    .from("orders")
    .select("id")
    .eq("client_id", ANANDA_CLIENT_ID);
  for (const p of pesanan ?? []) {
    await svc.from("jejak_pesanan").delete().eq("pesanan_id", p.id);
    await svc.from("notifikasi_pesanan").delete().eq("pesanan_id", p.id);
  }
  await svc.from("orders").delete().eq("client_id", ANANDA_CLIENT_ID);
  while (produkUji.length) {
    await svc.from("digital_products").delete().eq("id", produkUji.pop()!);
  }
}

afterEach(bersihkan);

beforeAll(async () => {
  // Sapu sisa run SEBELUMNYA, bukan hanya bersih-bersih sesudah (peta §13.2).
  // `pesanan_terbuka_satu_per_klien` adalah indeks unik GLOBAL: satu pesanan
  // `menunggu_bayar` yang tertinggal karena `testTimeout` memerahkan
  // penyemaian SETIAP berkas uji P1 pada run berikutnya, dengan 23505 yang
  // tidak menyebut berkas mana yang meninggalkannya.
  await bersihkan();
  await siapkanKlienKedua();
});

afterAll(bongkarKlienKedua);

async function pesananBaru(produkId: string): Promise<BarisPesanan> {
  const klien = await signInAs(KLIEN_EMAIL);
  const { data, error } = await klien.rpc("buat_pesanan", { p_product_id: produkId });
  if (error) throw new Error(`buat_pesanan gagal: ${error.code} ${error.message}`);
  return (data as BarisPesanan[])[0];
}

describe("bentuk kode & order_id — satu bentuk, dua bahasa", () => {
  it("rakitOrderId menyusun kode + percobaan dan MENOLAK percobaan di luar 1..9", () => {
    expect(rakitOrderId("PSN-260926-A1B2C3", 1)).toBe("PSN-260926-A1B2C3.1");
    expect(POLA_ORDER_ID.test(rakitOrderId("PSN-260926-A1B2C3", 9))).toBe(true);
    // Percobaan 10 akan melahirkan order_id yang TIDAK cocok POLA_ORDER_ID,
    // dan webhook menolaknya sebelum satu sha512 pun dihitung: uang masuk,
    // pesanan tidak bergerak. Karena itu ia melempar, bukan memulangkan string.
    expect(() => rakitOrderId("PSN-260926-A1B2C3", 10)).toThrow();
    expect(() => rakitOrderId("psn-260926-a1b2c3", 1)).toThrow();
  });

  it("kedua pola lahir TANPA flag `g` — dua panggilan berturut-turut sama jawabannya", () => {
    // `RegExp.test()` pada regex ber-`g` menyimpan `lastIndex` dan memulangkan
    // false BERGANTIAN. Di rute webhook (Tugas 8) itu berarti setiap notifikasi
    // sah KEDUA dijawab 400 — dan 400 memberi tahu Midtrans "sudah selesai,
    // jangan kirim lagi": pesanan terkunci mati dengan uang yang sudah masuk,
    // tanpa satu pun galat di mana pun. Dua baris identik berturut-turut adalah
    // satu-satunya bentuk yang membedakannya.
    expect(POLA_KODE_PESANAN.flags).not.toContain("g");
    expect(POLA_ORDER_ID.flags).not.toContain("g");
    expect(POLA_ORDER_ID.test("PSN-260926-A1B2C3.1")).toBe(true);
    expect(POLA_ORDER_ID.test("PSN-260926-A1B2C3.1")).toBe(true);
    expect(POLA_KODE_PESANAN.test("PSN-260926-A1B2C3")).toBe(true);
    expect(POLA_KODE_PESANAN.test("PSN-260926-A1B2C3")).toBe(true);
  });

  it("uraiOrderId memulangkan null untuk bentuk asing, bukan tebakan", () => {
    expect(uraiOrderId("PSN-260926-A1B2C3.2")).toEqual({
      kode: "PSN-260926-A1B2C3",
      percobaan: 2,
    });
    expect(uraiOrderId("PSN-260926-A1B2C3")).toBeNull();
    expect(uraiOrderId("PSN-260926-A1B2C3.0")).toBeNull();
    expect(uraiOrderId("PSN-260926-G1B2C3.1")).toBeNull();
    expect(uraiOrderId("../../etc/passwd")).toBeNull();
  });
});

describe("buat_pesanan", () => {
  it("menerbitkan pesanan berkode yang cocok dengan regex TypeScript", async () => {
    const produk = await semaiProduk("checkout-kode", 120_000);
    const baris = await pesananBaru(produk);

    // Bentuk `kode` hidup di SQL; regex-nya hidup di TypeScript. Assertion ini
    // satu-satunya tempat keduanya dipaksa bertemu.
    expect(baris.kode).toMatch(POLA_KODE_PESANAN);
    expect(baris.percobaan).toBe(1);
    expect(baris.nominal_tagih).toBe(120_000);
    expect(baris.judul).toBe("Uji checkout-kode");

    const { data: pesanan } = await svc
      .from("orders")
      .select("status, jumlah_item, ditutup_pada, kedaluwarsa_pada, dibuat_pada")
      .eq("id", baris.pesanan_id)
      .single();
    expect(pesanan!.status).toBe("menunggu_bayar");
    expect(pesanan!.jumlah_item).toBe(1);
    expect(pesanan!.ditutup_pada).toBeNull();
    const jarakJam =
      (Date.parse(pesanan!.kedaluwarsa_pada) - Date.parse(pesanan!.dibuat_pada)) / 3_600_000;
    expect(Math.round(jarakJam)).toBe(24);

    const { data: item } = await svc
      .from("order_items")
      .select("jenis, product_id, judul_beku, harga_beku, urutan, booking_request_id")
      .eq("pesanan_id", baris.pesanan_id)
      .single();
    expect(item!.jenis).toBe("produk_digital");
    expect(item!.product_id).toBe(produk);
    expect(item!.harga_beku).toBe(120_000);
    expect(item!.urutan).toBe(1);
    expect(item!.booking_request_id).toBeNull();

    const { data: jejak } = await svc
      .from("jejak_pesanan")
      .select("kejadian, padma_id")
      .eq("pesanan_id", baris.pesanan_id);
    expect((jejak ?? []).map((j) => j.kejadian)).toEqual(["dibuat"]);
    expect(jejak![0].padma_id).toBe("PAD-2607-0012");
  });

  it("DUA panggilan paralel melahirkan TEPAT SATU pesanan", async () => {
    const produk = await semaiProduk("checkout-paralel", 150_000);
    const klien = await signInAs(KLIEN_EMAIL);

    const [a, b] = await Promise.all([
      klien.rpc("buat_pesanan", { p_product_id: produk }),
      klien.rpc("buat_pesanan", { p_product_id: produk }),
    ]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();

    const idA = (a.data as BarisPesanan[])[0].pesanan_id;
    const idB = (b.data as BarisPesanan[])[0].pesanan_id;
    // Yang kalah menerima 23505 dari `pesanan_terbuka_satu_per_klien`, membaca
    // ulang, dan memulangkan pesanan yang sudah ada — bukan galat, dan bukan
    // pesanan kedua.
    expect(idA).toBe(idB);

    const { data: pesanan } = await svc
      .from("orders")
      .select("id")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("status", "menunggu_bayar");
    expect((pesanan ?? []).length).toBe(1);

    const { data: item } = await svc.from("order_items").select("id").eq("pesanan_id", idA);
    expect((item ?? []).length).toBe(1);
  });

  it("harga BEKU: panggilan kedua memulangkan nominal yang sama walau harga etalase naik", async () => {
    const produk = await semaiProduk("checkout-harga-beku", 120_000);
    const pertama = await pesananBaru(produk);
    expect(pertama.nominal_tagih).toBe(120_000);

    const hari = await hariIniJakarta();
    const { error } = await svc
      .from("digital_product_prices")
      .insert({ product_id: produk, harga: 999_000, berlaku_sejak: hari });
    expect(error).toBeNull();

    // KONTROL: harga etalase memang sudah berubah. Tanpa baris ini, uji di
    // bawah bisa hijau hanya karena harganya tidak pernah naik.
    const { data: etalase } = await svc
      .from("harga_produk_publik")
      .select("harga")
      .eq("product_id", produk)
      .single();
    expect(etalase!.harga).toBe(999_000);

    const klien = await signInAs(KLIEN_EMAIL);
    const kedua = await klien.rpc("buat_pesanan", { p_product_id: produk });
    expect(kedua.error).toBeNull();
    const barisKedua = (kedua.data as BarisPesanan[])[0];
    expect(barisKedua.pesanan_id).toBe(pertama.pesanan_id);
    expect(barisKedua.nominal_tagih).toBe(120_000);

    const { data: item } = await svc
      .from("order_items")
      .select("harga_beku")
      .eq("pesanan_id", pertama.pesanan_id)
      .single();
    expect(item!.harga_beku).toBe(120_000);
  });

  it("pesanan terbuka untuk produk LAIN ditolak dengan kalimat yang bisa dibaca", async () => {
    const produkA = await semaiProduk("checkout-produk-a", 120_000);
    const produkB = await semaiProduk("checkout-produk-b", 90_000);
    const pertama = await pesananBaru(produkA);

    const klien = await signInAs(KLIEN_EMAIL);
    const { error } = await klien.rpc("buat_pesanan", { p_product_id: produkB });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("P0001");
    expect(error!.message).toContain("Selesaikan dulu pesanan");
    // Kodenya ikut disebut: tanpa itu klien tidak tahu pesanan mana yang harus
    // ia selesaikan atau batalkan.
    expect(error!.message).toContain(pertama.kode);

    const { data: pesanan } = await svc
      .from("orders")
      .select("id")
      .eq("client_id", ANANDA_CLIENT_ID);
    expect((pesanan ?? []).length).toBe(1);
  });

  it("produk GRATIS tidak lewat checkout — pagar harga nol tetap berdiri", async () => {
    const produk = await semaiProduk("checkout-gratis", 0);
    const klien = await signInAs(KLIEN_EMAIL);
    const { error } = await klien.rpc("buat_pesanan", { p_product_id: produk });
    expect(error?.code).toBe("P0001");
    expect(error!.message).toContain("gratis");
  });

  it("klien yang SUDAH memiliki produknya ditolak — dan NOL pesanan lahir", async () => {
    // Kelas masukan yang paling mahal di seluruh P1, dan sampai sekarang nol
    // assertion menyentuhnya: uang masuk tanpa barang baru keluar, DAN tanpa
    // satu tanda pun di layar mana pun. Jalurnya: entitlement lama (gratis,
    // beli, atau pemberian admin) -> tombol beli terender karena
    // `punyaProdukDiPeramban` fail-open -> bayar -> settlement -> `lunas` ->
    // `terbitkan_akses_item` keadaan (2) -> jejak `akses_sudah_ada` TANPA
    // penanda tinjauan -> `bacaPesananStaf` justru MENGELUARKAN baris itu dari
    // "Butuh perhatian" karena jejak aksesnya ada.
    //
    // Yang menutupnya harus SQL, bukan TypeScript: rpc/buat_pesanan terbuka
    // bagi setiap pengguna login lewat PostgREST.
    const produk = await semaiProduk("checkout-sudah-punya", 120_000);
    const { error: eEnt } = await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID,
      product_id: produk,
      sumber: "gratis",
    });
    expect(eEnt).toBeNull();

    const klien = await signInAs(KLIEN_EMAIL);
    const { error } = await klien.rpc("buat_pesanan", { p_product_id: produk });
    expect(error?.code).toBe("P0001");
    // Kalimat yang KHAS untuk sebab ini. `toBe("P0001")` telanjang tidak bisa
    // membedakan gerbang ini dari enam raise lain di fungsi yang sama, jadi
    // menghapus salah satunya tidak memerahkan apa pun.
    expect(error!.message).toContain("sudah memiliki produk ini");

    const { data: pesanan } = await svc
      .from("orders")
      .select("id")
      .eq("client_id", ANANDA_CLIENT_ID);
    expect(pesanan ?? []).toEqual([]);
  });

  it("entitlement yang sudah DICABUT tidak menghalangi pembelian ulang", async () => {
    // Arah kedua, dan tanpa ia gerbang di atas boleh ditulis terlalu lebar:
    // pencabutan adalah keputusan manusia, dan orang yang aksesnya dicabut
    // tetap boleh membeli lagi. Yang tidak boleh adalah pembayarannya
    // MENGHIDUPKAN akses lama diam-diam — itu urusan `terbitkan_akses_item`
    // keadaan (3), diuji di Tugas 5.
    const produk = await semaiProduk("checkout-pernah-dicabut", 120_000);
    const { error: eEnt } = await svc.from("digital_entitlements").insert({
      client_id: ANANDA_CLIENT_ID,
      product_id: produk,
      sumber: "beli",
      dicabut_pada: new Date("2026-09-01T00:00:00Z").toISOString(),
    });
    expect(eEnt).toBeNull();

    const klien = await signInAs(KLIEN_EMAIL);
    const { data, error } = await klien.rpc("buat_pesanan", { p_product_id: produk });
    expect(error).toBeNull();
    expect((data as BarisPesanan[])[0].nominal_tagih).toBe(120_000);
  });

  it("produk yang belum tayang tidak bisa dipesan lewat id yang bocor dari panel", async () => {
    const produk = await semaiProduk("checkout-belum-tayang", 120_000, { aktif: false });
    const klien = await signInAs(KLIEN_EMAIL);
    const { error } = await klien.rpc("buat_pesanan", { p_product_id: produk });
    expect(error?.code).toBe("P0002");
  });

  it("akun tanpa rekam klien ditolak 42501, bukan dibiarkan memesan", async () => {
    const produk = await semaiProduk("checkout-tanpa-klien", 120_000);
    // Admin seed punya profil, TIDAK punya baris `clients`.
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("buat_pesanan", { p_product_id: produk });
    expect(error?.code).toBe("42501");
  });

  it("p_ulang menaikkan percobaan pada pesanan yang SAMA dan mengosongkan token lama", async () => {
    const produk = await semaiProduk("checkout-ulang", 120_000);
    const pertama = await pesananBaru(produk);

    const klien = await signInAs(KLIEN_EMAIL);
    const token = await klien.rpc("catat_token_snap", {
      p_pesanan_id: pertama.pesanan_id,
      p_token: "token-snap-lama",
    });
    expect(token.error).toBeNull();

    const kedua = await klien.rpc("buat_pesanan", { p_product_id: produk, p_ulang: true });
    expect(kedua.error).toBeNull();
    const barisKedua = (kedua.data as BarisPesanan[])[0];
    expect(barisKedua.pesanan_id).toBe(pertama.pesanan_id);
    expect(barisKedua.percobaan).toBe(2);
    expect(barisKedua.nominal_tagih).toBe(120_000);

    const { data: pesanan } = await svc
      .from("orders")
      .select("percobaan, snap_token, snap_diterbitkan_pada")
      .eq("id", pertama.pesanan_id)
      .single();
    expect(pesanan!.percobaan).toBe(2);
    // Token percobaan lama tidak boleh tertinggal: order_id-nya sudah terbakar.
    expect(pesanan!.snap_token).toBeNull();
    expect(pesanan!.snap_diterbitkan_pada).toBeNull();

    // order_id percobaan kedua tetap berbentuk sah bagi TypeScript.
    expect(rakitOrderId(barisKedua.kode, barisKedua.percobaan)).toMatch(POLA_ORDER_ID);
  });

  it("percobaan KESEPULUH menutup pesanan lama dan melahirkan yang baru — bukan 23514", async () => {
    const produk = await semaiProduk("checkout-percobaan-habis", 120_000);
    const pertama = await pesananBaru(produk);
    await svc.from("orders").update({ percobaan: 9 }).eq("id", pertama.pesanan_id);

    const klien = await signInAs(KLIEN_EMAIL);
    const kesepuluh = await klien.rpc("buat_pesanan", { p_product_id: produk, p_ulang: true });
    expect(kesepuluh.error).toBeNull();
    const baru = (kesepuluh.data as BarisPesanan[])[0];
    expect(baru.pesanan_id).not.toBe(pertama.pesanan_id);
    expect(baru.percobaan).toBe(1);
    expect(baru.nominal_tagih).toBe(120_000);

    const { data: lama } = await svc
      .from("orders")
      .select("status, ditutup_pada")
      .eq("id", pertama.pesanan_id)
      .single();
    expect(lama!.status).toBe("dibatalkan");
    // CHECK `pesanan_tutup_bercap` menuntutnya; tanpa cap, UPDATE-nya 23514.
    expect(lama!.ditutup_pada).not.toBeNull();
  });
});

describe("catat_token_snap & batalkan_pesanan_saya", () => {
  it("token tercatat pada pesanan milik pemanggil, dan jejak token_terbit lahir", async () => {
    const produk = await semaiProduk("token-milik-sendiri", 120_000);
    const pesanan = await pesananBaru(produk);

    const klien = await signInAs(KLIEN_EMAIL);
    const { error } = await klien.rpc("catat_token_snap", {
      p_pesanan_id: pesanan.pesanan_id,
      p_token: "snap-token-abc",
    });
    expect(error).toBeNull();

    const { data: baris } = await svc
      .from("orders")
      .select("snap_token, snap_diterbitkan_pada")
      .eq("id", pesanan.pesanan_id)
      .single();
    expect(baris!.snap_token).toBe("snap-token-abc");
    expect(baris!.snap_diterbitkan_pada).not.toBeNull();

    const { data: jejak } = await svc
      .from("jejak_pesanan")
      .select("kejadian")
      .eq("pesanan_id", pesanan.pesanan_id);
    expect((jejak ?? []).map((j) => j.kejadian)).toContain("token_terbit");
  });

  it("akun tanpa rekam klien ditolak 42501 — gerbang IDENTITAS, bukan kepemilikan", async () => {
    // Judulnya sengaja menyebut sebab yang SEBENARNYA diuji. Versi sebelumnya
    // berbunyi "tidak bisa menimpa token pesanan orang", padahal yang ditabrak
    // sesi admin adalah gerbang PERTAMA fungsi ini (`v_client_id is null`),
    // bukan klausa `and o.client_id = v_client_id`. Judul yang menyebut sebab
    // yang salah membuat orang berikutnya mengira kepemilikan baris sudah
    // terjaga — kasus di bawah ini yang benar-benar menjaganya.
    const produk = await semaiProduk("token-tanpa-klien", 120_000);
    const pesanan = await pesananBaru(produk);

    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("catat_token_snap", {
      p_pesanan_id: pesanan.pesanan_id,
      p_token: "token-orang-lain",
    });
    expect(error?.code).toBe("42501");
    expect(error!.message).toContain("belum tertaut ke rekam klien");

    const { data: baris } = await svc
      .from("orders")
      .select("snap_token")
      .eq("id", pesanan.pesanan_id)
      .single();
    expect(baris!.snap_token).toBeNull();
  });

  it("KLIEN LAIN tidak bisa menimpa token pesanan orang — P0002, token utuh", async () => {
    // Inilah uji yang menjaga klausa `and o.client_id = v_client_id`. Tanpa
    // klien kedua ber-akun auth, klausa itu boleh dihapus hari ini dan seluruh
    // suite tetap hijau — karena satu-satunya "orang lain" yang tersedia
    // (admin) menabrak gerbang identitas lebih dulu.
    const produk = await semaiProduk("token-klien-lain", 120_000);
    const pesanan = await pesananBaru(produk);

    const lain = await signInAs(EMAIL_KLIEN_KEDUA);
    const { error } = await lain.rpc("catat_token_snap", {
      p_pesanan_id: pesanan.pesanan_id,
      p_token: "token-klien-lain",
    });
    // P0002, bukan 42501: ia PUNYA rekam klien, hanya bukan pemilik barisnya.
    // Dan pesanan orang lain tidak boleh bisa dibedakan dari pesanan yang
    // tidak ada sama sekali.
    expect(error?.code).toBe("P0002");

    const { data: baris } = await svc
      .from("orders")
      .select("snap_token")
      .eq("id", pesanan.pesanan_id)
      .single();
    expect(baris!.snap_token).toBeNull();
  });

  it("KLIEN LAIN membatalkan pesanan orang: false, dan pesanannya UTUH", async () => {
    const produk = await semaiProduk("batal-klien-lain", 120_000);
    const pesanan = await pesananBaru(produk);

    const lain = await signInAs(EMAIL_KLIEN_KEDUA);
    const { data, error } = await lain.rpc("batalkan_pesanan_saya", {
      p_pesanan_id: pesanan.pesanan_id,
    });
    // `false`, BUKAN galat: "tidak ada pesanan yang cocok dengan itu milik
    // Anda" adalah jawaban jujur, dan 404 justru memberi tahu pemanggil
    // pesanan siapa yang ada. Jalur inilah yang dipakai rute /batal (Tugas 9),
    // dan tanpa klien kedua ia TIDAK PERNAH dieksekusi satu kali pun.
    expect(error).toBeNull();
    expect(data).toBe(false);

    const { data: baris } = await svc
      .from("orders")
      .select("status")
      .eq("id", pesanan.pesanan_id)
      .single();
    expect(baris!.status).toBe("menunggu_bayar");
  });

  it("pesanan yang bukan milik pemanggil dijawab P0002, bukan diberi tahu apa sebabnya", async () => {
    // Pesanan milik orang lain dan pesanan yang tidak ada sama sekali harus
    // tidak bisa dibedakan dari luar: keduanya sama-sama bukan urusan
    // pemanggil. Dipakai uuid yang tidak menunjuk apa pun karena seed hanya
    // punya SATU klien tertaut.
    const klien = await signInAs(KLIEN_EMAIL);
    const { error } = await klien.rpc("catat_token_snap", {
      p_pesanan_id: "00000000-0000-0000-0000-0000000000bb",
      p_token: "token-hantu",
    });
    expect(error?.code).toBe("P0002");
  });

  it("pembatalan mandiri berhasil SEKALI, lalu memulangkan false", async () => {
    const produk = await semaiProduk("batal-mandiri", 120_000);
    const pesanan = await pesananBaru(produk);

    const klien = await signInAs(KLIEN_EMAIL);
    const pertama = await klien.rpc("batalkan_pesanan_saya", { p_pesanan_id: pesanan.pesanan_id });
    expect(pertama.error).toBeNull();
    expect(pertama.data).toBe(true);

    const kedua = await klien.rpc("batalkan_pesanan_saya", { p_pesanan_id: pesanan.pesanan_id });
    expect(kedua.error).toBeNull();
    expect(kedua.data).toBe(false);

    const { data: baris } = await svc
      .from("orders")
      .select("status, ditutup_pada")
      .eq("id", pesanan.pesanan_id)
      .single();
    expect(baris!.status).toBe("dibatalkan");
    expect(baris!.ditutup_pada).not.toBeNull();

    const { data: jejak } = await svc
      .from("jejak_pesanan")
      .select("kejadian")
      .eq("pesanan_id", pesanan.pesanan_id);
    // Sekali dibatalkan, sekali dicatat — panggilan kedua tidak menambah jejak.
    expect((jejak ?? []).filter((j) => j.kejadian === "dibatalkan").length).toBe(1);
  });

  it("sesudah dibatalkan, produk yang sama bisa di-checkout lagi", async () => {
    const produk = await semaiProduk("batal-lalu-checkout", 120_000);
    const pesanan = await pesananBaru(produk);
    const klien = await signInAs(KLIEN_EMAIL);
    await klien.rpc("batalkan_pesanan_saya", { p_pesanan_id: pesanan.pesanan_id });

    const lagi = await klien.rpc("buat_pesanan", { p_product_id: produk });
    expect(lagi.error).toBeNull();
    expect((lagi.data as BarisPesanan[])[0].pesanan_id).not.toBe(pesanan.pesanan_id);
  });
});

describe("punya_pesanan_menunggu", () => {
  it("true untuk menunggu_bayar DAN untuk ditahan — uangnya sudah masuk", async () => {
    const produk = await semaiProduk("menunggu-atau-ditahan", 120_000);
    const klien = await signInAs(KLIEN_EMAIL);

    const sebelum = await klien.rpc("punya_pesanan_menunggu", { p_product_id: produk });
    expect(sebelum.data).toBe(false);

    const pesanan = await pesananBaru(produk);
    const terbuka = await klien.rpc("punya_pesanan_menunggu", { p_product_id: produk });
    expect(terbuka.data).toBe(true);

    await svc
      .from("orders")
      .update({ status: "ditahan", ditutup_pada: new Date().toISOString() })
      .eq("id", pesanan.pesanan_id);
    const ditahan = await klien.rpc("punya_pesanan_menunggu", { p_product_id: produk });
    // Menghitung `ditahan` sebagai "tidak ada pesanan" mengembalikan tombol
    // beli kepada orang yang sudah menyetor.
    expect(ditahan.data).toBe(true);

    await svc
      .from("orders")
      .update({ status: "dibatalkan" })
      .eq("id", pesanan.pesanan_id);
    const mati = await klien.rpc("punya_pesanan_menunggu", { p_product_id: produk });
    expect(mati.data).toBe(false);
  });
});

describe("putuskan_pesanan_ditahan", () => {
  async function pesananDitahan(produk: string, denganNominal: boolean) {
    const pesanan = await pesananBaru(produk);
    await svc
      .from("orders")
      .update({
        status: "ditahan",
        ditutup_pada: new Date().toISOString(),
        butuh_tinjauan_pada: new Date().toISOString(),
        sebab_tinjauan: "selisih_nominal",
      })
      .eq("id", pesanan.pesanan_id);
    if (denganNominal) {
      const { error } = await svc.from("notifikasi_pesanan").insert({
        pesanan_id: pesanan.pesanan_id,
        sidik: randomUUID(),
        transaksi_id: "trx-uji",
        status_midtrans: "settlement",
        kanal: "bank_transfer",
        nominal_diterima: 100_000,
      });
      if (error) throw error;
    }
    return pesanan;
  }

  it("klien biasa ditolak 42501 — putusan atas uang bukan miliknya", async () => {
    const produk = await semaiProduk("putusan-klien", 120_000);
    const pesanan = await pesananDitahan(produk, true);
    const klien = await signInAs(KLIEN_EMAIL);
    const { error } = await klien.rpc("putuskan_pesanan_ditahan", {
      p_pesanan_id: pesanan.pesanan_id,
      p_putusan: "lunas",
    });
    expect(error?.code).toBe("42501");
  });

  it("putusan di luar lunas/dibatalkan ditolak dengan kalimat, bukan 22P02 telanjang", async () => {
    const produk = await semaiProduk("putusan-asing", 120_000);
    const pesanan = await pesananDitahan(produk, true);
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("putuskan_pesanan_ditahan", {
      p_pesanan_id: pesanan.pesanan_id,
      p_putusan: "kedaluwarsa",
    });
    expect(error?.code).toBe("P0001");
    // Kalimat RPC — berbeda dari kalimat RUTE ("Putusan hanya boleh ..."),
    // dan perbedaan itulah yang membuat "dua pagar untuk satu lubang" bisa
    // dibuktikan satu per satu di Tugas 11.
    expect(error!.message).toContain("Putusan harus");
    expect(error!.message).toContain("lunas");
    expect(error!.message).toContain("dibatalkan");
  });

  it("pesanan ditahan TANPA nominal_diterima tercatat ditolak", async () => {
    const produk = await semaiProduk("putusan-tanpa-nominal", 120_000);
    const pesanan = await pesananDitahan(produk, false);
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("putuskan_pesanan_ditahan", {
      p_pesanan_id: pesanan.pesanan_id,
      p_putusan: "lunas",
    });
    // Uangnya harus pernah TERCATAT masuk, bukan sekadar diklaim admin.
    expect(error?.code).toBe("P0001");
    // Dan KALIMATNYA diadu, bukan hanya kodenya. `putuskan_pesanan_ditahan`
    // melempar P0001 untuk EMPAT sebab berbeda (putusan asing, perpindahan
    // ditolak mesin status, nominal belum tercatat, baris bukan `ditahan`):
    // `toBe("P0001")` telanjang tidak bisa membedakan satu pun di antaranya,
    // jadi menghapus salah satu pagar tidak memerahkan apa pun. Repo ini sudah
    // memakai pola yang benar di tempat lain ("gratis", "Selesaikan dulu
    // pesanan"); ketidak-konsistenannya yang jadi lubang.
    expect(error!.message).toContain("belum punya catatan nominal");
  });

  it("memindahkan ditahan -> lunas, mencatat pemutusnya, dan TIDAK menyalurkan akses", async () => {
    const produk = await semaiProduk("putusan-lunas", 120_000);
    const pesanan = await pesananDitahan(produk, true);
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("putuskan_pesanan_ditahan", {
      p_pesanan_id: pesanan.pesanan_id,
      p_putusan: "lunas",
    });
    expect(error).toBeNull();

    const { data: baris } = await svc
      .from("orders")
      .select("status, lunas_pada, ditutup_pada, butuh_tinjauan_pada")
      .eq("id", pesanan.pesanan_id)
      .single();
    expect(baris!.status).toBe("lunas");
    expect(baris!.lunas_pada).not.toBeNull();
    expect(baris!.ditutup_pada).not.toBeNull();
    // Penandanya SENGAJA tidak ikut dikosongkan: barisnya tetap terlihat di
    // "Butuh perhatian" sampai aksesnya diterbitkan dan tinjauannya ditutup.
    expect(baris!.butuh_tinjauan_pada).not.toBeNull();

    const { data: jejak } = await svc
      .from("jejak_pesanan")
      .select("kejadian, keterangan")
      .eq("pesanan_id", pesanan.pesanan_id);
    const lunas = (jejak ?? []).filter((j) => j.kejadian === "lunas");
    expect(lunas.length).toBe(1);
    expect(lunas[0].keterangan).toContain("Admin PADMA");

    // Penyalur ada di MESIN_TERTUTUP dan dipanggil lewat rute "Terbitkan
    // akses" (Tugas 11), bukan dari RPC yang terbuka bagi `authenticated`.
    const { data: ent } = await svc
      .from("digital_entitlements")
      .select("id")
      .eq("client_id", ANANDA_CLIENT_ID)
      .eq("product_id", produk);
    expect(ent ?? []).toEqual([]);
  });

  it("pesanan yang BUKAN ditahan ditolak, dengan kalimatnya sendiri", async () => {
    const produk = await semaiProduk("putusan-bukan-ditahan", 120_000);
    const pesanan = await pesananBaru(produk);
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("putuskan_pesanan_ditahan", {
      p_pesanan_id: pesanan.pesanan_id,
      p_putusan: "dibatalkan",
    });
    expect(error?.code).toBe("P0001");
    // Kalimat yang KHAS: ia memisahkan sebab ini dari ketiga P0001 lain di
    // fungsi yang sama, DAN ia yang diadu uji rute /putuskan (Tugas 11) untuk
    // membuktikan pagar RPC-nya benar-benar yang menolak, bukan daftar putih
    // di rutenya.
    expect(error!.message).toContain("tidak sedang ditahan");
  });
});

describe("tutup_tinjauan", () => {
  it("MENOLAK baris ditahan dan menyuruh memakai putusan (kalimatnya diadu)", async () => {
    const produk = await semaiProduk("tinjauan-ditahan", 120_000);
    const pesanan = await pesananBaru(produk);
    await svc
      .from("orders")
      .update({
        status: "ditahan",
        ditutup_pada: new Date().toISOString(),
        butuh_tinjauan_pada: new Date().toISOString(),
        sebab_tinjauan: "selisih_nominal",
      })
      .eq("id", pesanan.pesanan_id);

    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("tutup_tinjauan", { p_pesanan_id: pesanan.pesanan_id });
    expect(error?.code).toBe("P0001");
    expect(error!.message).toContain("putuskan");

    const { data: baris } = await svc
      .from("orders")
      .select("butuh_tinjauan_pada")
      .eq("id", pesanan.pesanan_id)
      .single();
    expect(baris!.butuh_tinjauan_pada).not.toBeNull();
  });

  it("mengosongkan kedua kolom penanda TANPA menyentuh status", async () => {
    const produk = await semaiProduk("tinjauan-lunas", 120_000);
    const pesanan = await pesananBaru(produk);
    await svc
      .from("orders")
      .update({
        status: "lunas",
        ditutup_pada: new Date().toISOString(),
        lunas_pada: new Date().toISOString(),
        butuh_tinjauan_pada: new Date().toISOString(),
        sebab_tinjauan: "akses_tertahan",
      })
      .eq("id", pesanan.pesanan_id);

    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("tutup_tinjauan", { p_pesanan_id: pesanan.pesanan_id });
    expect(error).toBeNull();

    const { data: baris } = await svc
      .from("orders")
      .select("status, butuh_tinjauan_pada, sebab_tinjauan")
      .eq("id", pesanan.pesanan_id)
      .single();
    expect(baris!.status).toBe("lunas");
    expect(baris!.butuh_tinjauan_pada).toBeNull();
    expect(baris!.sebab_tinjauan).toBeNull();

    const { data: jejak } = await svc
      .from("jejak_pesanan")
      .select("kejadian")
      .eq("pesanan_id", pesanan.pesanan_id);
    expect((jejak ?? []).map((j) => j.kejadian)).toContain("tinjauan_ditutup");
  });

  it("klien biasa ditolak 42501", async () => {
    const produk = await semaiProduk("tinjauan-klien", 120_000);
    const pesanan = await pesananBaru(produk);
    const klien = await signInAs(KLIEN_EMAIL);
    const { error } = await klien.rpc("tutup_tinjauan", { p_pesanan_id: pesanan.pesanan_id });
    expect(error?.code).toBe("42501");
  });
});
