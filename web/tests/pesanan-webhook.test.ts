/**
 * WEBHOOK MIDTRANS — satu kasus per baris peta kode jawaban, plus empat urutan
 * notifikasi yang benar-benar terjadi di lapangan.
 *
 * Ini pintu masuk uang. Ia dipanggil SUNGGUHAN di sini, melawan basis data
 * lokal sungguhan, dengan pesanan yang dilahirkan lewat RPC `buat_pesanan`
 * memakai sesi klien sungguhan — bukan baris yang disisipkan langsung. Pesanan
 * yang tidak pernah lewat pintu depannya tidak membuktikan pintu depannya benar.
 *
 * ===== KENAPA `createClient` LANGSUNG, BUKAN `createAdminSupabase()` =====
 * Satu kasus (galat basis data -> 500) menuntut `@/lib/supabase/admin` di-mock.
 * Kalau fixture memakai modul yang sama, fixture-nya ikut rusak saat mock itu
 * menyala. Klien layanan di bawah karena itu dibuat langsung.
 *
 * ===== PEMBERSIHAN WAJIB =====
 * `jejak_pesanan` dan `notifikasi_pesanan` SENGAJA tanpa foreign key (jejak yang
 * ikut lenyap bersama yang diaudit tidak berguna), jadi menghapus pesanan tidak
 * menyapunya. Berkas ini menyapunya sendiri lewat service role — kalau tidak,
 * `tests/pesanan-jejak-yatim.test.ts` merah, dan merahnya di berkas ORANG LAIN.
 * Urutan penghapusan mengikat: entitlement dulu (ia menunjuk `orders` dengan
 * `on delete restrict`), baru pesanan, baru jejak, baru produknya
 * (`order_items.product_id` menahan penghapusan produk tanpa cascade).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { signInAs } from "./helpers/as-user";

// ===== Klien layanan, sengaja di luar modul yang di-mock (lihat dokblok) =====
const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// ===== Mock modul admin: hanya untuk kasus "galat basis data -> 500" =====
const ref = vi.hoisted(() => ({ paksaGalat: false }));
vi.mock("@/lib/supabase/admin", async (impor) => {
  const asli = await impor<typeof import("@/lib/supabase/admin")>();
  return {
    createAdminSupabase: () => {
      const klien = asli.createAdminSupabase();
      if (!ref.paksaGalat) return klien;
      // Hanya `.rpc` yang dipakai rute ini; menggantinya cukup untuk
      // memaksa cabang galat tanpa merusak apa pun yang lain.
      return {
        rpc: async () => ({ data: null, error: { message: "galat-uji", code: "XX000" } }),
      } as unknown as ReturnType<typeof asli.createAdminSupabase>;
    },
  };
});

const { POST } = await import("@/app/api/pembayaran/midtrans/route");
const { hitungTandaTangan, hitungSidik } = await import("@/lib/midtrans/tanda-tangan");
const { KODE_JAWABAN } = await import("@/lib/midtrans/kode-jawaban");
const { rakitOrderId, POLA_ORDER_ID } = await import("@/lib/pesanan/order-id");

const KUNCI = "kunci-uji-webhook";
const KLIEN = "ananda@padma.test";

/**
 * Setiap permintaan KELUAR yang bukan Supabase lokal dicatat DAN dilempar.
 * Webhook tidak boleh menelepon Midtrans sama sekali — ia sudah memegang
 * notifikasi yang bertanda tangan; menanyakan ulang berarti percaya pada dua
 * sumber kebenaran untuk satu fakta.
 */
const asliFetch = globalThis.fetch;
const keluar: string[] = [];

beforeAll(() => {
  process.env.MIDTRANS_SERVER_KEY = KUNCI;
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
  delete process.env.MIDTRANS_SERVER_KEY;
  await bersihkan();
});

// ===== Fixture =====
let productId = "";
let clientId = "";
const pesananDibuat: string[] = [];

async function semaiProduk(harga: number): Promise<string> {
  const { data } = await svc
    .from("digital_products")
    .insert({ judul: "PAD-UJI Webhook Midtrans", slug: "pad-uji-webhook-midtrans", jenis: "pdf", aktif: true })
    .select("id")
    .single<{ id: string }>();
  await svc.from("digital_product_files").insert({
    product_id: data!.id,
    objek: `${data!.id}/isi.pdf`,
    mime: "application/pdf",
    byte: 1024,
  });
  await svc.from("digital_product_prices").insert({ product_id: data!.id, harga });
  return data!.id;
}

/** Pesanan dilahirkan lewat PINTU DEPANNYA: RPC dengan sesi klien sungguhan. */
async function buatPesanan(): Promise<{ id: string; orderId: string; nominal: number }> {
  const klien = await signInAs(KLIEN);
  const { data, error } = await klien.rpc("buat_pesanan", { p_product_id: productId });
  if (error) throw new Error(`buat_pesanan gagal: ${error.message}`);
  const baris = (data as Array<{ pesanan_id: string; kode: string; percobaan: number; nominal_tagih: number }>)[0];
  pesananDibuat.push(baris.pesanan_id);
  return {
    id: baris.pesanan_id,
    orderId: rakitOrderId(baris.kode, baris.percobaan),
    nominal: baris.nominal_tagih,
  };
}

async function bersihkanPesanan(): Promise<void> {
  // 1. Entitlement dulu: ia menunjuk `orders` dengan `on delete restrict`.
  await svc.from("digital_entitlements").delete().eq("product_id", productId);
  // 2. Pesanan (cascade ke `order_items`).
  if (pesananDibuat.length) {
    await svc.from("orders").delete().in("id", pesananDibuat);
    // 3. Jejak & notifikasi: TANPA foreign key, jadi tidak ada cascade.
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
  await svc.from("digital_products").delete().eq("slug", "pad-uji-webhook-midtrans");
  productId = await semaiProduk(150_000);
  const { data } = await svc
    .from("clients")
    .select("id")
    .eq("email", KLIEN)
    .maybeSingle<{ id: string }>();
  clientId = data?.id ?? "";
});

beforeEach(async () => {
  ref.paksaGalat = false;
  await bersihkanPesanan();
});

// ===== Perakit notifikasi =====
type Notifikasi = {
  order_id: string;
  status_code?: string;
  gross_amount?: string;
  transaction_status?: string;
  transaction_id?: string;
  fraud_status?: string;
  payment_type?: string;
  signature_key?: string;
};

function rakit(n: Notifikasi): Record<string, string> {
  const badan: Record<string, string> = {
    order_id: n.order_id,
    status_code: n.status_code ?? "200",
    gross_amount: n.gross_amount ?? "150000.00",
    transaction_status: n.transaction_status ?? "settlement",
    transaction_id: n.transaction_id ?? "trx-uji-1",
    payment_type: n.payment_type ?? "bank_transfer",
  };
  if (n.fraud_status !== undefined) badan.fraud_status = n.fraud_status;
  badan.signature_key =
    n.signature_key ??
    hitungTandaTangan(badan.order_id, badan.status_code, badan.gross_amount, KUNCI);
  return badan;
}

function permintaan(badan: unknown): Request {
  return new Request("http://127.0.0.1/api/pembayaran/midtrans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof badan === "string" ? badan : JSON.stringify(badan),
  });
}

async function kirim(badan: unknown): Promise<{ status: number; hasil: string }> {
  const jawab = await POST(permintaan(badan));
  const isi = (await jawab.json().catch(() => ({}))) as { hasil?: string };
  return { status: jawab.status, hasil: isi.hasil ?? "" };
}

// ===========================================================================

describe("cetakan tanda tangan & sidik — nilai emas, bukan tautologi", () => {
  it("tanda tangan = sha512(order_id + status_code + gross_amount + serverKey)", () => {
    // Nilai di kanan dihitung sekali di luar berkas ini dan ditulis harfiah.
    // Membandingkannya dengan hasil `hitungTandaTangan` sendiri akan hijau
    // bahkan bila urutan perangkaiannya tertukar.
    expect(hitungTandaTangan("PSN-260926-ABCDEF.1", "200", "150000.00", "kunci-uji")).toBe(
      "22f6793f7c0e45e56f8a20cff5569baa56aa8cb6160c8c05308d753b245ef75c" +
        "3bb8a3a8dbf06806449cd881444e47f8d9a07b2aca8f0249cbcbd96ad46d526f",
    );
  });

  it("sidik = sha256(orderId|statusCode|transactionStatus|fraudStatus|transactionId)", () => {
    expect(
      hitungSidik({
        orderId: "PSN-260926-ABCDEF.1",
        statusCode: "200",
        transactionStatus: "settlement",
        fraudStatus: "",
        transactionId: "abc-123",
      }),
    ).toBe("809196ac0055ce75a880c37a0927b8024f2ac1fcb484e6075b70d93da10651dd");
  });

  it("capture+challenge dan capture+accept atas transaksi yang SAMA punya sidik berbeda", () => {
    // Inilah SATU-SATUNYA alasan `fraud_status` ada di dalam sidik, dan sampai
    // kasus ini lahir alasan itu tidak dijaga apa pun. Kedua notifikasi datang
    // dengan `transaction_id` dan `status_code` yang sama; kalau sidiknya sama,
    // keputusan KEDUA Midtrans atas transaksi yang sama ditolak sebagai
    // duplikat — dan keputusan kedua itulah yang memindahkan uang dari
    // "ditahan Midtrans" ke "benar-benar masuk", atau sebaliknya.
    const dasar = {
      orderId: "PSN-260926-ABCDEF.1",
      statusCode: "200",
      transactionStatus: "capture",
      transactionId: "abc-123",
    };
    expect(hitungSidik({ ...dasar, fraudStatus: "challenge" })).not.toBe(
      hitungSidik({ ...dasar, fraudStatus: "accept" }),
    );
  });

  it("pending dan settlement atas transaksi yang sama punya sidik BERBEDA", () => {
    // Inilah alasan sidiknya bukan `order_id` saja. Kalau keduanya sama,
    // `settlement` ditolak sebagai duplikat dan pembelinya membayar untuk apa-apa.
    const dasar = { orderId: "PSN-260926-ABCDEF.1", fraudStatus: "", transactionId: "abc-123" };
    expect(hitungSidik({ ...dasar, statusCode: "201", transactionStatus: "pending" })).not.toBe(
      hitungSidik({ ...dasar, statusCode: "200", transactionStatus: "settlement" }),
    );
  });
});

describe("peta kode jawaban — satu kasus per baris", () => {
  it("badan > 16 KB dengan content-length jujur -> 400", async () => {
    const besar = JSON.stringify({ order_id: "x".repeat(17 * 1024) });

    // `content-length` DISETEL DI SINI, dan baris itu bukan hiasan: `new
    // Request(...)` yang dirakit di memori TIDAK pernah melahirkan header itu
    // sendiri — yang menyetelnya adalah lapisan jaringan, dan di sini tidak
    // ada lapisan jaringan (diukur, bukan diasumsikan: tanpa baris ini
    // `request.headers.get("content-length")` memulangkan null). Tanpanya
    // kasus ini diam-diam menempuh jalur ALIRAN, persis jalur yang sama dengan
    // kasus di bawahnya — dua uji untuk satu cabang, sementara cabang header
    // (saringan termurah, yang menolak sebelum satu byte pun dibaca) tidak
    // punya satu pun.
    const jawab = await POST(
      new Request("http://127.0.0.1/api/pembayaran/midtrans", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(new TextEncoder().encode(besar).byteLength),
        },
        body: besar,
      }),
    );
    const isi = (await jawab.json().catch(() => ({}))) as { hasil?: string };
    expect(jawab.status).toBe(400);
    expect(isi.hasil).toBe("badan_terlalu_besar");
  });

  it("badan > 16 KB TANPA content-length (aliran) -> 400 — pagar BYTE, bukan pagar header", async () => {
    // Spec menegaskan satu hal tentang langkah ini: "pagar byte nyata —
    // content-length boleh bohong". Kasus di atas TIDAK membuktikannya: ia
    // menyetel content-length dengan jujur, jadi cabang PERTAMA
    // `bacaBodyTerbatas` sudah memulangkan null dan seluruh jalur pembacaan
    // aliran bertahap tidak pernah dieksekusi. Seseorang boleh menyederhanakan
    // fungsi itu jadi pemeriksaan header saja ("alirannya rumit dan tidak
    // pernah kepakai") dan uji di atas tetap hijau — lalu satu permintaan
    // `transfer-encoding: chunked` 50 MB dibaca habis ke memori sebelum satu
    // pemeriksaan pun berjalan.
    //
    // Ini satu-satunya bentuk yang membedakan pagar byte dari pagar header.
    const potongan = "x".repeat(4 * 1024);
    const aliran = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (let i = 0; i < 5; i += 1) controller.enqueue(enc.encode(potongan));
        controller.close();
      },
    });

    const permintaanAliran = new Request("http://127.0.0.1/api/pembayaran/midtrans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: aliran,
      // Wajib di undici untuk badan ber-aliran; tanpanya `fetch`/`Request`
      // menolak sebelum rutenya sempat dipanggil.
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const jawab = await POST(permintaanAliran);
    const isi = (await jawab.json().catch(() => ({}))) as { hasil?: string };
    expect(jawab.status).toBe(400);
    expect(isi.hasil).toBe("badan_terlalu_besar");
  });

  it("MIDTRANS_SERVER_KEY kosong -> 503, bukan 401 dan bukan 200", async () => {
    // 2xx/4xx memberi tahu Midtrans "sudah selesai" dan notifikasi itu tidak
    // pernah datang lagi. 503 membuat env yang lupa dipasang berakhir sebagai
    // keterlambatan, bukan sebagai uang yang hilang.
    const p = await buatPesanan();
    const badan = rakit({ order_id: p.orderId });
    delete process.env.MIDTRANS_SERVER_KEY;
    try {
      const { status, hasil } = await kirim(badan);
      expect(status).toBe(503);
      expect(hasil).toBe("kunci_kosong");
    } finally {
      process.env.MIDTRANS_SERVER_KEY = KUNCI;
    }
  });

  it("JSON rusak -> 400", async () => {
    const { status, hasil } = await kirim("{bukan json");
    expect(status).toBe(400);
    expect(hasil).toBe("skema_gagal");
  });

  it("field wajib tidak lengkap -> 400", async () => {
    const { status, hasil } = await kirim({ order_id: "PSN-260926-ABCDEF.1" });
    expect(status).toBe(400);
    expect(hasil).toBe("skema_gagal");
  });

  it("field TAMBAHAN dari Midtrans TIDAK menolak notifikasi", async () => {
    // Skema sengaja tidak `.strict()`. 400 di sini akan mengunci pesanan mati
    // dengan uang yang sudah masuk, hanya karena Midtrans menambah satu field.
    const p = await buatPesanan();
    const badan = { ...rakit({ order_id: p.orderId }), settlement_time: "2026-09-26 10:00:00", currency: "IDR" };
    const { status } = await kirim(badan);
    expect(status).toBe(200);
  });

  it("bentuk order_id tidak cocok -> 400, dan NOL sentuhan basis data", async () => {
    const sebelum = await jumlahDitolakHariIni();
    const { status, hasil } = await kirim(rakit({ order_id: "bukan-order-id" }));
    expect(status).toBe(400);
    expect(hasil).toBe("bentuk_order_id");
    // Penghitung notifikasi ditolak TIDAK naik: bentuk yang salah disaring
    // sebelum satu sha512 pun dihitung, dan sebelum satu baris pun ditulis.
    expect(await jumlahDitolakHariIni()).toBe(sebelum);
  });

  it("tanda tangan salah -> 401, dan penghitung harian NAIK satu", async () => {
    const p = await buatPesanan();
    const sebelum = await jumlahDitolakHariIni();
    const { status, hasil } = await kirim(
      rakit({ order_id: p.orderId, signature_key: "a".repeat(128) }),
    );
    expect(status).toBe(401);
    expect(hasil).toBe("tanda_tangan_salah");
    expect(await jumlahDitolakHariIni()).toBe(sebelum + 1);

    // Nol teks penyerang tersimpan: yang bertambah hanya angkanya.
    const { data } = await svc.from("notifikasi_pesanan").select("id").eq("pesanan_id", p.id);
    expect(data ?? []).toEqual([]);
  });

  it("tanda tangan salah berpanjang BERBEDA -> 401, bukan 500", async () => {
    // `timingSafeEqual` MELEMPAR pada panjang berbeda. Tanpa penyamaan panjang
    // lebih dulu, notifikasi ini menjatuhkan rute ke 500 dan mengundang
    // Midtrans mengirim ulang selamanya.
    const p = await buatPesanan();
    const { status } = await kirim(rakit({ order_id: p.orderId, signature_key: "pendek" }));
    expect(status).toBe(401);
  });

  it("penghitung yang GAGAL dinaikkan tidak senyap: 401 tetap, dan SEBABNYA tercetak", async () => {
    // Pagar terhadap kegagalan yang bentuknya persis sama dengan yang pernah
    // hidup di rute ini, satu tingkat lebih tinggi. `supabase-js` `.rpc()`
    // TIDAK PERNAH melempar — ia memulangkan `{ error }` — jadi penghitung yang
    // gagal naik tidak menjatuhkan apa pun dan tidak meninggalkan jejak apa pun
    // kecuali ada yang membaca `error`-nya. Angka ini satu-satunya alarm untuk
    // banjir notifikasi palsu, dan alarm yang gagal dalam senyap terbaca
    // sebagai aman.
    //
    // Kenapa `ref.paksaGalat` dipakai ulang dan BUKAN nama RPC yang sengaja
    // disalahtulis: cabang tanda tangan salah pulang SEBELUM RPC mesin, jadi
    // satu-satunya `.rpc()` yang dilewatinya adalah penghitung itu sendiri.
    // Hasilnya nol string nama fungsi di dalam uji ini — mengganti nama RPC-nya
    // kelak tidak memerahkan uji ini dengan palsu.
    //
    // `order_id` ditulis harfiah, tanpa `buatPesanan()`: tanda tangannya gagal
    // jauh sebelum satu baris pun dicari, jadi fixture pesanan hanya akan
    // menambah biaya dan satu pesanan terbuka yang harus disapu (§0.11).
    const matamata = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      ref.paksaGalat = true;
      const { status, hasil } = await kirim(
        rakit({ order_id: "PSN-990101-FFFFFF.9", signature_key: "a".repeat(128) }),
      );

      // Separuh pertama kontraknya: jawabannya TIDAK berubah. Kegagalan
      // mencatat tidak boleh menahan 401-nya.
      expect(status).toBe(401);
      expect(hasil).toBe("tanda_tangan_salah");

      // Separuh keduanya: sebabnya terlihat. `galat-uji` adalah `message` dari
      // mock, jadi asersi kedua membedakan "membaca error lalu mencetaknya"
      // dari "mencetak kalimat tetap" — hanya yang pertama yang berguna saat
      // Postgres yang bicara.
      const dicetak = matamata.mock.calls.map((c) => c.join(" "));
      expect(dicetak.some((b) => b.includes("gagal mencatat notifikasi ditolak"))).toBe(true);
      expect(dicetak.some((b) => b.includes("galat-uji"))).toBe(true);
    } finally {
      matamata.mockRestore();
    }
  });

  it("order_id sah bentuknya tapi bukan milik pesanan mana pun -> 200, dan tak_dikenal NAIK satu", async () => {
    // 200 memang jawaban yang benar — tanda tangannya sah dan tidak ada apa pun
    // yang bisa disembuhkan dengan mengulang. Yang TIDAK boleh adalah 200 yang
    // tidak meninggalkan satu baris pun di mana pun: bukan `orders`, bukan
    // `jejak_pesanan`, bukan `notifikasi_pesanan` (RPC keluar sebelum insert
    // sidik), bukan penghitung tanda tangan salah. Tanda tangannya SAH,
    // artinya uang itu sungguhan milik kita, lalu kita membuangnya.
    //
    // Dua jalan masuk yang nyata dan sama-sama nol-galat: notifikasi untuk
    // `percobaan` lama yang kelak "dirapikan" jadi pencarian kode+percobaan,
    // dan pergeseran bentuk `kode` di penerbitnya. Assertion kedua di bawah
    // yang membuat keduanya punya alarm.
    const sebelumTak = await jumlahTakDikenalHariIni();
    const sebelumDitolak = await jumlahDitolakHariIni();

    const { status, hasil } = await kirim(rakit({ order_id: "PSN-990101-FFFFFF.9" }));
    expect(status).toBe(200);
    expect(hasil).toBe("pesanan_tidak_ada");
    expect(await jumlahTakDikenalHariIni()).toBe(sebelumTak + 1);
    // Dan penghitung tanda tangan SALAH tidak ikut bergerak: dua angka, dua
    // arti, dan menyatukannya membuat yang kedua tidak pernah bisa dibaca.
    expect(await jumlahDitolakHariIni()).toBe(sebelumDitolak);
  });

  it("galat basis data -> 500", async () => {
    const p = await buatPesanan();
    const badan = rakit({ order_id: p.orderId });
    ref.paksaGalat = true;
    const { status, hasil } = await kirim(badan);
    expect(status).toBe(500);
    expect(hasil).toBe("galat");
  });

  it("KODE_JAWABAN memetakan KESEPULUH hasil, tanpa undefined", () => {
    // `NextResponse.json(..., { status: undefined })` menjawab 200. Satu hasil
    // yang lupa dipetakan berarti kegagalan dilaporkan "selesai" ke Midtrans.
    const nilai = Object.values(KODE_JAWABAN);
    expect(nilai).toHaveLength(10);
    expect(nilai.every((k) => Number.isInteger(k) && k >= 200 && k < 600)).toBe(true);
  });
});

describe("jalur sukses — uang masuk, akses terbit, satu transaksi", () => {
  it("settlement -> 200 diterapkan, pesanan LUNAS, entitlement terbit", async () => {
    const p = await buatPesanan();
    const { status, hasil } = await kirim(rakit({ order_id: p.orderId }));
    expect(status).toBe(200);
    expect(hasil).toBe("diterapkan");

    const { data: pesanan } = await svc
      .from("orders")
      .select("status, lunas_pada, ditutup_pada, kanal, transaksi_id")
      .eq("id", p.id)
      .single<{ status: string; lunas_pada: string | null; ditutup_pada: string | null; kanal: string | null; transaksi_id: string | null }>();
    expect(pesanan!.status).toBe("lunas");
    expect(pesanan!.lunas_pada).not.toBeNull();
    expect(pesanan!.ditutup_pada).not.toBeNull();
    expect(pesanan!.kanal).toBe("bank_transfer");
    expect(pesanan!.transaksi_id).toBe("trx-uji-1");

    // Kepemilikan adalah SATU-SATUNYA sumber kebenaran akses — bukan status
    // pesanan. Kalau entitlement tidak terbit, pembeli membayar dan tidak
    // mendapat apa-apa meski pesanannya berkata "lunas".
    const { data: hak } = await svc
      .from("digital_entitlements")
      .select("sumber, pesanan_id")
      .eq("product_id", productId)
      .eq("client_id", clientId)
      .single<{ sumber: string; pesanan_id: string | null }>();
    expect(hak!.sumber).toBe("beli");
    expect(hak!.pesanan_id).toBe(p.id);

    // Nominal yang benar-benar diterima Midtrans DISIMPAN, apa pun hasilnya.
    const { data: notif } = await svc
      .from("notifikasi_pesanan")
      .select("nominal_diterima")
      .eq("pesanan_id", p.id)
      .single<{ nominal_diterima: string | number | null }>();
    expect(Number(notif!.nominal_diterima)).toBe(150_000);

    // Janji tunggal ke proyek WhatsApp: jejak `lunas` lahir TEPAT SEKALI.
    expect(await jumlahJejak(p.id, "lunas")).toBe(1);
  });

  it("nominal MELESET -> ditahan + selisih_nominal + penanda tinjauan, bukan lunas", async () => {
    const p = await buatPesanan();
    const { status } = await kirim(rakit({ order_id: p.orderId, gross_amount: "100000.00" }));
    expect(status).toBe(200);

    const { data } = await svc
      .from("orders")
      .select("status, butuh_tinjauan_pada, sebab_tinjauan")
      .eq("id", p.id)
      .single<{ status: string; butuh_tinjauan_pada: string | null; sebab_tinjauan: string | null }>();
    expect(data!.status).toBe("ditahan");
    expect(data!.butuh_tinjauan_pada).not.toBeNull();
    expect(data!.sebab_tinjauan).toBe("selisih_nominal");
    expect(await jumlahJejak(p.id, "selisih_nominal")).toBe(1);

    // Akses TIDAK terbit: uang masuk tapi jumlahnya tidak cocok.
    const { data: hak } = await svc
      .from("digital_entitlements")
      .select("id")
      .eq("product_id", productId)
      .eq("client_id", clientId);
    expect(hak ?? []).toEqual([]);
  });
});

describe("urutan notifikasi — empat yang benar-benar terjadi", () => {
  it("notifikasi KEMBAR PERSIS: yang kedua 200 duplikat, tanpa efek kedua", async () => {
    const p = await buatPesanan();
    const badan = rakit({ order_id: p.orderId });

    expect((await kirim(badan)).hasil).toBe("diterapkan");
    const kedua = await kirim(badan);
    expect(kedua.status).toBe(200);
    expect(kedua.hasil).toBe("duplikat");

    // Satu baris notifikasi, satu jejak lunas, satu entitlement.
    const { data: notif } = await svc.from("notifikasi_pesanan").select("id").eq("pesanan_id", p.id);
    expect((notif ?? []).length).toBe(1);
    expect(await jumlahJejak(p.id, "lunas")).toBe(1);
  });

  it("pending lalu settlement: sidik BERBEDA, keduanya diproses", async () => {
    const p = await buatPesanan();
    const pending = await kirim(
      rakit({ order_id: p.orderId, status_code: "201", transaction_status: "pending", transaction_id: "trx-uji-1" }),
    );
    expect(pending.status).toBe(200);

    const settle = await kirim(rakit({ order_id: p.orderId, transaction_id: "trx-uji-1" }));
    expect(settle.hasil).toBe("diterapkan");

    const { data } = await svc.from("orders").select("status").eq("id", p.id).single<{ status: string }>();
    expect(data!.status).toBe("lunas");

    const { data: notif } = await svc.from("notifikasi_pesanan").select("id").eq("pesanan_id", p.id);
    expect((notif ?? []).length).toBe(2);
  });

  it("URUTAN TERBALIK: settlement lalu pending — status tidak mundur", async () => {
    // Midtrans tidak menjamin urutan kedatangan. `pending` yang mendarat
    // sesudah `settlement` tidak boleh mengembalikan pesanan ke menunggu_bayar:
    // setiap UPDATE membawa `status = any(<array positif>)` di klausa where-nya,
    // jadi cabang yang tidak mengenai baris tidak mengubah apa pun.
    const p = await buatPesanan();
    expect((await kirim(rakit({ order_id: p.orderId }))).hasil).toBe("diterapkan");

    const pending = await kirim(
      rakit({ order_id: p.orderId, status_code: "201", transaction_status: "pending" }),
    );
    expect(pending.status).toBe(200);
    expect(pending.hasil).toBe("tanpa_efek");

    const { data } = await svc.from("orders").select("status").eq("id", p.id).single<{ status: string }>();
    expect(data!.status).toBe("lunas");
    expect(await jumlahJejak(p.id, "lunas")).toBe(1);
  });

  it("settlement pada pesanan yang SUDAH TERTUTUP -> lunas_setelah_tutup + tinjauan", async () => {
    // Uang mendarat pada pesanan yang sudah kita batalkan. Tidak ada transisi,
    // penyalur tidak berjalan, akses tidak terbit — dan statusnya bukan
    // `ditahan` maupun `lunas`, jadi tanpa penanda tinjauan ia tidak muncul di
    // blok mana pun meski uangnya sudah masuk.
    const p = await buatPesanan();
    const klien = await signInAs(KLIEN);
    await klien.rpc("batalkan_pesanan_saya", { p_pesanan_id: p.id });

    const { status } = await kirim(rakit({ order_id: p.orderId }));
    expect(status).toBe(200);

    const { data } = await svc
      .from("orders")
      .select("status, butuh_tinjauan_pada, sebab_tinjauan")
      .eq("id", p.id)
      .single<{ status: string; butuh_tinjauan_pada: string | null; sebab_tinjauan: string | null }>();
    expect(data!.status).toBe("dibatalkan");
    expect(data!.butuh_tinjauan_pada).not.toBeNull();
    expect(data!.sebab_tinjauan).toBe("lunas_setelah_tutup");
    expect(await jumlahJejak(p.id, "lunas_setelah_tutup")).toBe(1);
  });

  it("dua order_id sah berturut-turut sama-sama lolos saringan bentuk", async () => {
    // Pagar terhadap `POLA_ORDER_ID` yang lahir ber-flag `g`: `RegExp.test()`
    // pada regex ber-`g` menyimpan `lastIndex` dan memulangkan false
    // bergantian, sehingga notifikasi kedua ditolak 400 tanpa sebab yang
    // terlihat. Diuji di dua lapis: cetakannya sendiri, dan lewat rutenya.
    expect(POLA_ORDER_ID.test("PSN-260926-ABCDEF.1")).toBe(true);
    expect(POLA_ORDER_ID.test("PSN-260926-ABCDEF.1")).toBe(true);

    const a = await buatPesanan();
    expect((await kirim(rakit({ order_id: a.orderId }))).status).toBe(200);
    await bersihkanPesanan();
    const b = await buatPesanan();
    expect((await kirim(rakit({ order_id: b.orderId }))).hasil).toBe("diterapkan");
  });
});

describe("webhook tidak menelepon siapa pun", () => {
  it("nol permintaan keluar ke host mana pun selain Supabase lokal", () => {
    // Berjalan paling akhir di berkas ini (vitest menjalankan `it` berurutan),
    // jadi ia melihat SELURUH permintaan yang dilakukan kasus-kasus di atas.
    expect(keluar).toEqual([]);
  });
});

// ===== Pembantu baca =====
async function jumlahJejak(pesananId: string, kejadian: string): Promise<number> {
  const { data } = await svc
    .from("jejak_pesanan")
    .select("id")
    .eq("pesanan_id", pesananId)
    .eq("kejadian", kejadian);
  return (data ?? []).length;
}

async function jumlahDitolakHariIni(): Promise<number> {
  const hariIni = new Date().toISOString().slice(0, 10);
  const { data } = await svc
    .from("notifikasi_ditolak_harian")
    .select("jumlah")
    .eq("tanggal", hariIni)
    .maybeSingle<{ jumlah: number }>();
  return data?.jumlah ?? 0;
}

async function jumlahTakDikenalHariIni(): Promise<number> {
  const hariIni = new Date().toISOString().slice(0, 10);
  const { data } = await svc
    .from("notifikasi_ditolak_harian")
    .select("tak_dikenal")
    .eq("tanggal", hariIni)
    .maybeSingle<{ tak_dikenal: number }>();
  return data?.tak_dikenal ?? 0;
}
