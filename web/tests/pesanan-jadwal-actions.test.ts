/**
 * LAPIS 3 — PENYAPU TERJADWAL (spec "Rekonsiliasi — empat lapis").
 *
 * Dua hal dijaga berkas ini, dan keduanya adalah kelas kegagalan yang TIDAK
 * menghasilkan galat di mana pun:
 *
 *  1. BERKAS JADWAL YANG MENYAPU HAL YANG SALAH. Selama tidak ada satu pun
 *     berkas workflow, "`/api/cron/tenggat` tidak dijadwalkan" adalah
 *     non-tindakan yang gratis. Begitu berkasnya lahir, ia berubah jadi baris
 *     yang harus SENGAJA TIDAK diketik — dan keputusan yang bergantung pada
 *     seseorang mengingat untuk tidak mengetik sesuatu bukan keputusan yang
 *     terjaga. Menghidupkan tenggat akan membatalkan sekaligus seluruh
 *     pengajuan yang menumpuk sejak September: pembatalan massal ke klien
 *     nyata, di hari yang sama dengan go-live pembayaran.
 *  2. RAHASIA HARFIAH DI BERKAS PUBLIK. Repo `PokokPayu/padma-web` PUBLIK.
 *     `CRON_SECRET` yang tertulis harfiah di workflow adalah rahasia yang
 *     terbit ke seluruh internet dalam satu commit, dan rute yang dijaganya
 *     menembakkan permintaan ke Midtrans.
 *
 * Ditambah gerbang rutenya sendiri, yang punya satu cara gagal khas: terbuka
 * lebar ketika konfigurasinya lupa dipasang. Kelimanya meniru
 * `tests/cron-tenggat.test.ts`.
 *
 * Midtrans TIDAK PERNAH ditembak dari suite. Berkas ini mengimpor rute cron,
 * jadi ia WAJIB menstub `globalThis.fetch` — dan stubnya dibuat MELEMPAR untuk
 * host selain 127.0.0.1, supaya "adapternya berhenti di-mock" jadi merah,
 * bukan jadi permintaan sungguhan yang lambat dan senyap.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createAdminSupabase } from "@/lib/supabase/admin";

const admin = createAdminSupabase();

// Adapter Midtrans dipalsukan seluruhnya; `jawabPer` dikunci PER order_id
// supaya pesanan menggantung milik berkas uji lain — rute ini memilih barisnya
// dengan service role, jadi lintas klien — tidak ikut tergerakkan.
const midtrans = vi.hoisted(() => ({
  jawabPer: new Map<string, unknown>(),
  panggilan: [] as string[],
}));
vi.mock("@/lib/midtrans/adapter", () => ({
  bacaStatusTransaksi: async (orderId: string) => {
    midtrans.panggilan.push(orderId);
    return (
      midtrans.jawabPer.get(orderId) ?? {
        ok: false,
        kode: 500,
        pesan: "bukan pesanan milik berkas uji ini",
      }
    );
  },
  terbitkanTokenSnap: async () => ({ ok: false, pesan: "tidak dipakai di berkas ini" }),
}));

const { POST } = await import("@/app/api/cron/pesanan/route");
const modulRute = await import("@/app/api/cron/pesanan/route");

// ---------------------------------------------------------------------------
// Berkas workflow — di AKAR REPO, bukan di web/
// ---------------------------------------------------------------------------

const BERKAS_YML = path.resolve(
  __dirname,
  "..",
  "..",
  ".github",
  "workflows",
  "rekonsiliasi-pesanan.yml",
);

describe(".github/workflows/rekonsiliasi-pesanan.yml", () => {
  it("ada di akar repo", () => {
    // Dua tingkat naik dari web/tests/, bukan satu: `web/.github` tidak ada,
    // dan berkas workflow yang salah taruh tidak pernah dijalankan siapa pun —
    // gagal dalam diam, bentuk kegagalan termahal untuk sebuah penjadwal.
    expect(existsSync(BERKAS_YML), `tidak ada di ${BERKAS_YML}`).toBe(true);
  });

  const yml = () => readFileSync(BERKAS_YML, "utf8");

  it("menembak /api/cron/pesanan", () => {
    expect(yml()).toContain("/api/cron/pesanan");
  });

  it("mengambil rahasianya dari GitHub Secret", () => {
    expect(yml()).toContain("secrets.CRON_SECRET");
  });

  it("TIDAK menyebut /api/cron/tenggat sama sekali", () => {
    // Bukan basa-basi: menghidupkannya membatalkan sekaligus seluruh pengajuan
    // yang lewat tenggat sejak September, ke klien nyata. Sebelum diputuskan,
    // jumlah barisnya harus dihitung dulu — dan kueri itu menyentuh produksi.
    expect(yml()).not.toContain("/api/cron/tenggat");
  });

  it("memakai curl --fail, supaya jawaban non-2xx MEMERAHKAN job", () => {
    // Tanpa `--fail`, curl pulang dengan kode 0 untuk 401 — dan penjadwal yang
    // ditolak setiap 15 menit terlihat hijau selamanya.
    expect(yml()).toMatch(/curl[^\n]*--fail/);
  });

  it("nol rahasia yang ditulis harfiah", () => {
    // Repo ini PUBLIK.
    const POLA: Array<[RegExp, string]> = [
      [/Bearer\s+(?!\$)[^\s"']{8,}/, "header Bearer diikuti nilai harfiah"],
      [/(SB-)?Mid-(server|client)-[A-Za-z0-9_-]{4,}/, "kunci Midtrans harfiah"],
      [/eyJ[A-Za-z0-9_-]{20,}/, "JWT harfiah (kunci Supabase)"],
      [/CRON_SECRET\s*[:=]\s*(?!\$)["']?[A-Za-z0-9_-]{8,}/, "CRON_SECRET diberi nilai harfiah"],
    ];
    const isi = yml();
    for (const [pola, sebab] of POLA) {
      expect(pola.test(isi), `${sebab}: ${isi.match(pola)?.[0]}`).toBe(false);
    }
  });

  it("MENGURAI jawabannya, bukan sekadar menggemakannya", () => {
    // `--fail` hanya menyaring kode status. Jawaban 2xx ber-badan BUKAN JSON
    // (halaman galat Vercel, HTML pengalihan, badan kosong dari proksi) lolos
    // utuh, dan langkah yang cuma `echo` menuliskannya ke ringkasan sebagai
    // sesuatu yang terlihat seperti laporan. Itu hijau selamanya untuk rute
    // yang sudah tidak menjawab apa pun.
    const isi = yml();
    expect(isi, "tidak ada jq yang mengurai badan jawaban").toMatch(/jq\s+-[a-z]*e/);
    expect(isi).toContain(".diperiksa");
    expect(isi).toContain(".dilewati");
  });

  it("curl menunggu LEBIH LAMA daripada maxDuration rutenya", () => {
    // Pagar lintas-berkas, dan satu-satunya yang memeriksanya. Bila
    // `--max-time` turun di bawah `maxDuration`, curl menyerah sementara
    // fungsinya terus berjalan: jobnya merah tanpa sebab yang terbaca, dan
    // barisnya tetap tersapu di server. Keduanya hidup di berkas berbeda,
    // jadi tidak ada satu pun pembaca yang melihat keduanya sekaligus.
    const cocok = yml().match(/--max-time\s+(\d+)/);
    expect(cocok, "tidak ada --max-time di workflow").not.toBeNull();
    const maksCurl = Number(cocok![1]);
    const maksFungsi = (modulRute as Record<string, unknown>).maxDuration;
    expect(typeof maksFungsi, "rute tidak mengekspor maxDuration").toBe("number");
    expect(maksCurl).toBeGreaterThan(maksFungsi as number);
  });

  it("blok schedule LAHIR DIKOMENTARI", () => {
    // Mengikuti backup-db.yml. Jadwal yang aktif sebelum sasarannya ada gagal
    // setiap kali jalan, dan alarm yang berbunyi terus adalah alarm yang
    // berhenti dibaca.
    //
    // KETIKA JADWALNYA DIHIDUPKAN di langkah terakhir go-live: HAPUS `it` ini,
    // jangan dilonggarkan. Ia ada supaya blok jadwal tidak menyala tanpa
    // sengaja ikut commit lain — menghapusnya adalah satu baris yang sadar dan
    // tercatat di git, yang memang bentuk keputusan yang diinginkan.
    const isi = yml();
    expect(isi).toMatch(/^\s*#\s*schedule:/m);
    expect(isi).toMatch(/^\s*#\s*-\s*cron:\s*"\*\/15 \* \* \* \*"/m);
    expect(isi, "blok schedule sudah aktif").not.toMatch(/^\s{2}schedule:/m);
  });
});

// ---------------------------------------------------------------------------
// Rute cron
// ---------------------------------------------------------------------------

const AWALAN_KODE = "PSN-260926-C0";
const KLIEN_ANANDA = "44444444-4444-4444-4444-444444444401";
const SLUG = "uji-cron-pesanan";
const JUDUL = "Uji Cron Pesanan";
const HARGA = 88_000;

let produkId: string;
const rahasiaAsli = process.env.CRON_SECRET;

function permintaan(header?: string): Request {
  return new Request("http://127.0.0.1/api/cron/pesanan", {
    method: "POST",
    headers: header ? { authorization: header } : {},
  });
}

async function semaiMenggantung(kode: string): Promise<string> {
  const { data, error } = await admin
    .from("orders")
    .insert({
      kode,
      percobaan: 1,
      client_id: KLIEN_ANANDA,
      status: "menunggu_bayar",
      jumlah_item: 1,
      // Lebih tua dari MENIT_JEDA_PERIKSA, atau penyapu memang tidak akan
      // menyentuhnya.
      dibuat_pada: new Date(Date.now() - 60 * 60_000).toISOString(),
      kedaluwarsa_pada: new Date(Date.now() + 12 * 3_600_000).toISOString(),
      diperiksa_pada: null,
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: galatItem } = await admin.from("order_items").insert({
    pesanan_id: data!.id,
    jenis: "produk_digital",
    product_id: produkId,
    judul_beku: JUDUL,
    harga_beku: HARGA,
    urutan: 1,
  });
  if (galatItem) throw galatItem;
  return data!.id as string;
}

async function statusPesanan(id: string): Promise<string> {
  const { data } = await admin.from("orders").select("status").eq("id", id).single();
  return data!.status as string;
}

async function bersihkan() {
  await admin.from("digital_entitlements").delete().eq("product_id", produkId);
  const { data } = await admin.from("orders").select("id").like("kode", `${AWALAN_KODE}%`);
  const ids = (data ?? []).map((b) => b.id as string);
  if (ids.length === 0) return;
  await admin.from("jejak_pesanan").delete().in("pesanan_id", ids);
  await admin.from("notifikasi_pesanan").delete().in("pesanan_id", ids);
  await admin.from("order_items").delete().in("pesanan_id", ids);
  await admin.from("orders").delete().in("id", ids);
}

beforeAll(async () => {
  await admin.from("digital_products").delete().eq("slug", SLUG);
  const { data, error } = await admin
    .from("digital_products")
    .insert({ judul: JUDUL, slug: SLUG, jenis: "pdf", aktif: true })
    .select("id")
    .single();
  if (error) throw error;
  produkId = data!.id as string;
  await admin.from("digital_product_prices").insert({ product_id: produkId, harga: HARGA });
});

beforeEach(async () => {
  // Pagar fetch: 127.0.0.1 (Supabase lokal) lewat, sisanya MELEMPAR. Ini bukan
  // salinan setup-fetch-guard.ts yang malas — ia menjaga hal yang berbeda:
  // bahwa berkas INI tidak pernah menembakkan satu pun permintaan keluar
  // seandainya mock adapternya kelak terlepas.
  const asli = globalThis.fetch;
  vi.stubGlobal("fetch", (...arg: Parameters<typeof fetch>) => {
    const url = arg[0] instanceof Request ? arg[0].url : String(arg[0]);
    if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(url)) {
      throw new Error(`uji ini tidak boleh menembak ${url}`);
    }
    return asli(...arg);
  });

  midtrans.panggilan.length = 0;
  midtrans.jawabPer.clear();
  await bersihkan();
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (rahasiaAsli === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = rahasiaAsli;
});

afterAll(async () => {
  await bersihkan();
  await admin.from("digital_products").delete().eq("id", produkId);
});

describe("gerbang rahasia /api/cron/pesanan", () => {
  it("MENOLAK semua orang ketika CRON_SECRET tidak terpasang", async () => {
    // Fail-closed, persis seperti rute tenggat. Rute yang terbuka karena
    // konfigurasinya lupa dipasang adalah rute publik yang menembakkan
    // permintaan ke Midtrans sebanyak yang diminta siapa pun.
    delete process.env.CRON_SECRET;
    const r = await POST(permintaan("Bearer apa pun"));
    expect(r.status).toBe(401);
    expect(midtrans.panggilan).toEqual([]);
  });

  it("menolak tanpa header", async () => {
    process.env.CRON_SECRET = "rahasia-uji";
    expect((await POST(permintaan())).status).toBe(401);
  });

  it("menolak rahasia yang salah", async () => {
    process.env.CRON_SECRET = "rahasia-uji";
    expect((await POST(permintaan("Bearer salah"))).status).toBe(401);
  });

  it("menolak rahasia yang benar TANPA skema Bearer", async () => {
    process.env.CRON_SECRET = "rahasia-uji";
    expect((await POST(permintaan("rahasia-uji"))).status).toBe(401);
  });

  it("membatasi durasi fungsinya, dan muat di paket Hobby", async () => {
    // Batas yang MENGIKAT bukan `timeout-minutes` job Actions melainkan durasi
    // fungsi Vercel: Hobby + fluid compute memberi 300 detik dan TIDAK BISA
    // dinaikkan tanpa pindah paket (docs "Duration limits"). Tanpa ekspor ini
    // sapuan yang menggantung dipotong pada bawaannya dengan barisnya sudah
    // tercap; dengan angka di atas 300 ia ditolak diam-diam oleh platform.
    const maks = (modulRute as Record<string, unknown>).maxDuration;
    expect(typeof maks).toBe("number");
    expect(maks as number).toBeGreaterThan(0);
    expect(maks as number, "di atas batas Hobby (300 s)").toBeLessThanOrEqual(300);
  });

  it("NOL ekspor GET", async () => {
    // Keharusan mengekspor GET lahir dari Vercel Cron yang memanggil GET.
    // Penjadwalnya kini GitHub Actions dengan `curl`, jadi kitalah yang
    // memilih verbanya — dan permukaan yang tidak perlu ada sebaiknya tidak
    // ada, apalagi permukaan yang bisa ditembak dari bilah alamat peramban.
    expect((modulRute as Record<string, unknown>).GET).toBeUndefined();
  });
});

describe("sapuan /api/cron/pesanan", () => {
  it("menyembuhkan pesanan menggantung dan melaporkan jumlahnya", async () => {
    process.env.CRON_SECRET = "rahasia-uji";
    const kode = `${AWALAN_KODE}0001`;
    const id = await semaiMenggantung(kode);
    midtrans.jawabPer.set(`${kode}.1`, {
      ok: true,
      status: {
        order_id: `${kode}.1`,
        status_code: "200",
        transaction_status: "settlement",
        transaction_id: `trx-${kode}`,
        gross_amount: `${HARGA}.00`,
        fraud_status: null,
        payment_type: "qris",
      },
    });

    const r = await POST(permintaan("Bearer rahasia-uji"));
    expect(r.status).toBe(200);

    const isi = (await r.json()) as { diperiksa: number };
    // Jumlahnya penting: rute yang selalu menjawab "ok" tidak bisa dibedakan
    // dari rute yang tidak pernah menemukan apa pun, dan penjadwal tidak punya
    // apa pun untuk dicatat.
    expect(typeof isi.diperiksa).toBe("number");
    expect(isi.diperiksa).toBeGreaterThanOrEqual(1);

    expect(midtrans.panggilan).toContain(`${kode}.1`);
    expect(await statusPesanan(id)).toBe("lunas");
  });

  it("menyapu LINTAS KLIEN — bukan hanya pesanan pemanggil", async () => {
    // Inilah bedanya dengan Lapis 1b: penyapu memilih barisnya dengan service
    // role, jadi ia menangkap pesanan milik orang yang tidak pernah membuka
    // halamannya lagi. Tidak ada sesi sama sekali di rute ini.
    process.env.CRON_SECRET = "rahasia-uji";
    const kode = `${AWALAN_KODE}0002`;
    const id = await semaiMenggantung(kode);
    midtrans.jawabPer.set(`${kode}.1`, {
      ok: false,
      kode: 404,
      pesan: "Transaction doesn't exist",
    });
    // Tenggat sudah lewat lebih dari satu jam -> 404 boleh dibaca kedaluwarsa.
    await admin
      .from("orders")
      .update({ kedaluwarsa_pada: new Date(Date.now() - 3 * 3_600_000).toISOString() })
      .eq("id", id);

    const r = await POST(permintaan("Bearer rahasia-uji"));
    expect(r.status).toBe(200);
    expect(midtrans.panggilan).toContain(`${kode}.1`);
    expect(await statusPesanan(id)).toBe("kedaluwarsa");
  });

  it("pesanan yang baru diperiksa TIDAK ditanyakan lagi", async () => {
    process.env.CRON_SECRET = "rahasia-uji";
    const kode = `${AWALAN_KODE}0003`;
    const id = await semaiMenggantung(kode);
    await admin
      .from("orders")
      .update({ diperiksa_pada: new Date().toISOString() })
      .eq("id", id);

    await POST(permintaan("Bearer rahasia-uji"));

    expect(midtrans.panggilan).not.toContain(`${kode}.1`);
    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });

  it("kunci server yang belum terpasang melaporkan diperiksa: 0, BUKAN jumlah barisnya", async () => {
    // Kegagalan termahal yang bisa lolos dari berkas ini, dan satu-satunya
    // yang tidak menghasilkan galat di mana pun: server tanpa
    // `MIDTRANS_SERVER_KEY` melaporkan "diperiksa: 20" tiap lima belas menit
    // tanpa satu permintaan pun pernah keluar. Penjadwal yang sakit terbaca
    // PERSIS seperti penjadwal yang sehat, dan angka di badan jawaban inilah
    // satu-satunya hal yang pernah dicatat siapa pun — `curl --fail` tidak
    // menolongnya, karena 200 memang jawaban yang benar.
    //
    // Lewat rute, bukan memanggil `sapuPesananMenggantung` langsung: yang
    // dibaca penjadwal adalah angka yang keluar dari rute, dan rute yang
    // meneruskannya apa adanya itulah yang dijanjikan.
    //
    // `toBe(0)` boleh EKSAK di sini sementara uji penyembuhan di atas terpaksa
    // menulis `toBeGreaterThanOrEqual(1)`: penyapu memilih barisnya LINTAS
    // KLIEN, jadi pesanan menggantung milik berkas lain ikut terbawa — tapi
    // semuanya jatuh ke jawaban bawaan `kode: 500`, yang juga tidak dihitung.
    // Nol karena itu berarti nol, bukan "kebetulan sedang sepi".
    process.env.CRON_SECRET = "rahasia-uji";
    const kode = `${AWALAN_KODE}0004`;
    const id = await semaiMenggantung(kode);
    midtrans.jawabPer.set(`${kode}.1`, {
      ok: false,
      kode: -1,
      pesan: "Kunci Midtrans belum dipasang.",
    });

    const r = await POST(permintaan("Bearer rahasia-uji"));
    expect(r.status).toBe(200);

    // Barisnya BENAR-BENAR terpilih dan diproses. Tanpa baris ini `0` juga
    // dipulangkan oleh sapuan yang tidak menemukan apa-apa, dan ujinya hijau
    // untuk alasan yang salah — persis bentuk kegagalan yang sedang dijaga.
    expect(midtrans.panggilan).toContain(`${kode}.1`);

    const isi = (await r.json()) as { diperiksa: number; dilewati: number };
    expect(isi.diperiksa).toBe(0);
    // Dan barisnya TERHITUNG sebagai dilewati. Inilah pasangan dari assertion
    // di atas: `diperiksa: 0` sendirian juga dipulangkan sapuan yang tidak
    // menemukan apa-apa, dan penjadwal tidak bisa membedakan keduanya.
    expect(isi.dilewati).toBeGreaterThanOrEqual(1);
    // Dan tidak ada vonis yang dibuat dari ketiadaan jawaban.
    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });

  it("sapuan SEPI dan sapuan MATI TOTAL tidak terbaca sama", async () => {
    // Kegagalan yang ditutup di sini: `{diperiksa: 0}` berarti DUA hal yang
    // berlawanan. Yang satu sehat (tidak ada yang perlu disapu), yang lain
    // adalah mesin pembayaran yang tidak bisa bertanya sama sekali — dan
    // sampai `dilewati` ada, keduanya menulis angka yang identik ke
    // satu-satunya tempat yang pernah dibaca siapa pun.
    //
    // Keduanya dijalankan DI SATU `it` supaya yang dipaku adalah PERBEDAANNYA.
    // Dipecah dua, keduanya bisa hijau sambil tetap memulangkan angka yang sama.
    process.env.CRON_SECRET = "rahasia-uji";

    async function sapu(): Promise<{ diperiksa: number; dilewati: number }> {
      const r = await POST(permintaan("Bearer rahasia-uji"));
      expect(r.status).toBe(200);
      return (await r.json()) as { diperiksa: number; dilewati: number };
    }

    // ===== PEMANASAN: MENGURAS, BUKAN BERHARAP =====
    // Sapuan ini LINTAS KLIEN, jadi pesanan menggantung milik berkas uji lain
    // — atau milik sesi lain di Supabase lokal yang dipakai bersama — ikut
    // terbawa, dan angka "sepi" jadi bergantung pada kebetulan. Sapuan
    // berulang mencap semuanya; cap itu menahan mereka selama
    // MENIT_JEDA_PERIKSA (5 menit), jauh lebih lama daripada sisa `it` ini.
    // Sesudah terkuras, NOL benar-benar berarti nol.
    let sepi = await sapu();
    for (let i = 0; i < 5 && (sepi.diperiksa > 0 || sepi.dilewati > 0); i += 1) {
      sepi = await sapu();
    }
    // (a) SEPI — tidak ada satu pun baris yang layak ditanyakan.
    expect(sepi, "populasi tidak terkuras; angka di bawah tidak bisa dipercaya").toEqual({
      diperiksa: 0,
      dilewati: 0,
    });

    // (b) MATI TOTAL — satu baris, dan Midtrans tidak menjawabnya.
    const kode = `${AWALAN_KODE}0005`;
    await semaiMenggantung(kode);
    midtrans.jawabPer.set(`${kode}.1`, { ok: false, kode: 503, pesan: "Service unavailable" });
    const mati = await sapu();

    expect(midtrans.panggilan).toContain(`${kode}.1`);
    // Kedua keadaan memulangkan `diperiksa` yang SAMA — itulah sebab
    // `dilewati` harus ada...
    expect(mati.diperiksa).toBe(sepi.diperiksa);
    // ...dan inilah yang membedakannya.
    expect(mati).toEqual({ diperiksa: 0, dilewati: 1 });
  });
});
