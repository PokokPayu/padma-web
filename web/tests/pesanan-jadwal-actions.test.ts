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
 *     menembakkan permintaan ke DOKU.
 *
 * Ditambah gerbang rutenya sendiri, yang punya satu cara gagal khas: terbuka
 * lebar ketika konfigurasinya lupa dipasang. Kelimanya meniru
 * `tests/cron-tenggat.test.ts`.
 *
 * DOKU TIDAK PERNAH ditembak dari suite. Berkas ini mengimpor rute cron,
 * jadi ia WAJIB menstub `globalThis.fetch` — dan stubnya dibuat MELEMPAR untuk
 * host selain 127.0.0.1, supaya "adapternya berhenti di-mock" jadi merah,
 * bukan jadi permintaan sungguhan yang lambat dan senyap.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createAdminSupabase } from "@/lib/supabase/admin";

const admin = createAdminSupabase();

/** Invoice DOKU dari `kode`: tanpa tanda hubung + digit percobaan 1. */
const inv = (kode: string) => `${kode.replaceAll("-", "")}1`;

// Adapter DOKU dipalsukan seluruhnya; `jawabPer` dikunci PER order_id
// supaya pesanan menggantung milik berkas uji lain — rute ini memilih barisnya
// dengan service role, jadi lintas klien — tidak ikut tergerakkan.
const doku = vi.hoisted(() => ({
  jawabPer: new Map<string, unknown>(),
  panggilan: [] as string[],
}));
vi.mock("@/lib/doku/adapter", () => ({
  bacaStatusDoku: async (invoice: string) => {
    doku.panggilan.push(invoice);
    return (
      doku.jawabPer.get(invoice) ?? {
        ok: false,
        kode: 500,
        pesan: "bukan pesanan milik berkas uji ini",
      }
    );
  },
  buatPembayaranDoku: async () => ({ ok: false, pesan: "tidak dipakai di berkas ini" }),
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
    .insert({ judul: JUDUL, slug: SLUG, aktif: true })
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

  doku.panggilan.length = 0;
  doku.jawabPer.clear();
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
    // permintaan ke DOKU sebanyak yang diminta siapa pun.
    delete process.env.CRON_SECRET;
    const r = await POST(permintaan("Bearer apa pun"));
    expect(r.status).toBe(401);
    expect(doku.panggilan).toEqual([]);
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
    doku.jawabPer.set(inv(kode), {
      ok: true,
      status: {
        invoice: inv(kode),
        status: "SUCCESS",
        nominal: HARGA,
        transaksiId: `trx-${kode}`,
        kanal: "QRIS",
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

    expect(doku.panggilan).toContain(inv(kode));
    expect(await statusPesanan(id)).toBe("lunas");
  });

  it("menyapu LINTAS KLIEN — bukan hanya pesanan pemanggil", async () => {
    // Inilah bedanya dengan Lapis 1b: penyapu memilih barisnya dengan service
    // role, jadi ia menangkap pesanan milik orang yang tidak pernah membuka
    // halamannya lagi. Tidak ada sesi sama sekali di rute ini.
    process.env.CRON_SECRET = "rahasia-uji";
    const kode = `${AWALAN_KODE}0002`;
    const id = await semaiMenggantung(kode);
    doku.jawabPer.set(inv(kode), {
      ok: false,
      kode: 404,
      pesan: "Invoice tidak dikenal DOKU.",
    });
    // Tenggat sudah lewat lebih dari satu jam -> 404 boleh dibaca kedaluwarsa.
    await admin
      .from("orders")
      .update({ kedaluwarsa_pada: new Date(Date.now() - 3 * 3_600_000).toISOString() })
      .eq("id", id);

    const r = await POST(permintaan("Bearer rahasia-uji"));
    expect(r.status).toBe(200);
    expect(doku.panggilan).toContain(inv(kode));
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

    expect(doku.panggilan).not.toContain(inv(kode));
    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });

  it("kunci server yang belum terpasang melaporkan diperiksa: 0, BUKAN jumlah barisnya", async () => {
    // Kegagalan termahal yang bisa lolos dari berkas ini, dan satu-satunya
    // yang tidak menghasilkan galat di mana pun: server tanpa
    // `DOKU_SECRET_KEY` melaporkan "diperiksa: 20" tiap lima belas menit
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
    doku.jawabPer.set(inv(kode), {
      ok: false,
      kode: -1,
      pesan: "Kunci DOKU belum dipasang.",
    });

    const r = await POST(permintaan("Bearer rahasia-uji"));
    expect(r.status).toBe(200);

    // Barisnya BENAR-BENAR terpilih dan diproses. Tanpa baris ini `0` juga
    // dipulangkan oleh sapuan yang tidak menemukan apa-apa, dan ujinya hijau
    // untuk alasan yang salah — persis bentuk kegagalan yang sedang dijaga.
    expect(doku.panggilan).toContain(inv(kode));

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

    // (b) MATI TOTAL — satu baris, dan DOKU tidak menjawabnya.
    const kode = `${AWALAN_KODE}0005`;
    await semaiMenggantung(kode);
    doku.jawabPer.set(inv(kode), { ok: false, kode: 503, pesan: "Service unavailable" });
    const mati = await sapu();

    expect(doku.panggilan).toContain(inv(kode));
    // Kedua keadaan memulangkan `diperiksa` yang SAMA — itulah sebab
    // `dilewati` harus ada...
    expect(mati.diperiksa).toBe(sepi.diperiksa);
    // ...dan inilah yang membedakannya.
    expect(mati).toEqual({ diperiksa: 0, dilewati: 1 });
  });
});

// ---------------------------------------------------------------------------
// Sapuan pesanan TERTUTUP (F2b, perbaikan akhir 17 Nov)
// ---------------------------------------------------------------------------
//
// Pesanan yang KITA tutup (`dibatalkan`: klien membatalkan, staf menerbitkan
// ulang, harga berubah, percobaan kesepuluh) sementara tautan DOKU-nya masih
// bisa dibayar. Bila webhook-nya hilang, satu-satunya yang bisa melihat uang
// itu adalah bertanya. Lapis 3 menanyakan setiap percobaannya sampai tautan
// pasti mati (`kedaluwarsa_pada` + tenggang), lalu menandainya selesai.

const invK = (kode: string, k: number) => `${kode.replaceAll("-", "")}${k}`;

const SUKSES = (invoice: string) => ({
  ok: true,
  status: { invoice, status: "SUCCESS", nominal: HARGA, transaksiId: `trx-${invoice}`, kanal: "QRIS" },
});
const MENUNGGU = (invoice: string) => ({
  ok: true,
  status: { invoice, status: "PENDING", nominal: HARGA, transaksiId: "", kanal: "" },
});
const TAK_DIKENAL = { ok: false, kode: 404, pesan: "Invoice tidak dikenal DOKU." };

async function semaiTertutup(
  kode: string,
  o: {
    kedaluwarsaJam: number;
    percobaan?: number;
    tautan?: boolean;
    percobaanLunas?: number | null;
    status?: "dibatalkan" | "kedaluwarsa";
  },
): Promise<string> {
  const jamLalu = (j: number) => new Date(Date.now() - j * 3_600_000).toISOString();
  const { data, error } = await admin
    .from("orders")
    .insert({
      kode,
      percobaan: o.percobaan ?? 1,
      client_id: KLIEN_ANANDA,
      status: o.status ?? "dibatalkan",
      jumlah_item: 1,
      dibuat_pada: jamLalu(30),
      ditutup_pada: jamLalu(0.5),
      kedaluwarsa_pada: new Date(Date.now() + o.kedaluwarsaJam * 3_600_000).toISOString(),
      tautan_gateway: o.tautan === false ? null : "https://checkout-uji.doku.test/tertutup",
      tautan_terbit_pada: o.tautan === false ? null : jamLalu(1),
      percobaan_lunas: o.percobaanLunas ?? null,
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

type BarisTertutup = {
  status: string;
  sebab_tinjauan: string | null;
  butuh_tinjauan_pada: string | null;
  rekonsiliasi_tutup_pada: string | null;
};

async function bacaTertutup(id: string): Promise<BarisTertutup> {
  const { data, error } = await admin
    .from("orders")
    .select("status, sebab_tinjauan, butuh_tinjauan_pada, rekonsiliasi_tutup_pada")
    .eq("id", id)
    .single<BarisTertutup>();
  if (error) throw error;
  return data!;
}

/**
 * Menyapu sampai tidak ada lagi baris yang layak. Sapuan ini LINTAS KLIEN dan
 * berbatas sepuluh baris per jenis; baris berkas lain (atau sesi lain di
 * Supabase lokal yang sama) bisa mendahului baris uji. Setiap putaran mencap
 * barisnya, jadi pengurasan berhenti.
 */
async function sapuSampaiSepi(): Promise<void> {
  process.env.CRON_SECRET = "rahasia-uji";
  for (let i = 0; i < 8; i += 1) {
    const r = await POST(permintaan("Bearer rahasia-uji"));
    expect(r.status).toBe(200);
    const isi = (await r.json()) as { diperiksa: number; dilewati: number };
    if (isi.diperiksa === 0 && isi.dilewati === 0) return;
  }
  throw new Error("sapuan tidak pernah sepi; populasi tidak terkuras");
}

describe("F2b: Lapis 3 menyapu pesanan dibatalkan yang pernah bertautan DOKU", () => {
  it("SUCCESS yang ditemukan pada pesanan dibatalkan → lunas_setelah_tutup + tanda tinjauan, lalu ditandai", async () => {
    // Contoh brief: klien membayar VA pukul 13.58, admin menekan "Terbitkan
    // ulang" pukul 14.05, webhook hilang. Tanpa sapuan ini uangnya senyap.
    const kode = `${AWALAN_KODE}0101`;
    const id = await semaiTertutup(kode, { kedaluwarsaJam: -3 });
    doku.jawabPer.set(invK(kode, 1), SUKSES(invK(kode, 1)));

    await sapuSampaiSepi();

    expect(doku.panggilan).toContain(invK(kode, 1));
    const b = await bacaTertutup(id);
    expect(b.status).toBe("dibatalkan");
    expect(b.sebab_tinjauan).toBe("lunas_setelah_tutup");
    expect(b.butuh_tinjauan_pada).not.toBeNull();
    expect(b.rekonsiliasi_tutup_pada).not.toBeNull();
    const { data: jejak } = await admin
      .from("jejak_pesanan").select("kejadian").eq("pesanan_id", id);
    expect((jejak ?? []).map((j) => j.kejadian)).toContain("lunas_setelah_tutup");
  });

  it("selama tautan masih hidup: uang ditemukan LEBIH AWAL, tetapi pesanan belum ditandai selesai", async () => {
    const kode = `${AWALAN_KODE}0102`;
    const id = await semaiTertutup(kode, { kedaluwarsaJam: 5 });
    doku.jawabPer.set(invK(kode, 1), SUKSES(invK(kode, 1)));

    await sapuSampaiSepi();

    expect(doku.panggilan).toContain(invK(kode, 1));
    const b = await bacaTertutup(id);
    expect(b.sebab_tinjauan).toBe("lunas_setelah_tutup");
    // Tautannya masih bisa dibayar LAGI sampai tenggat: belum selesai.
    expect(b.rekonsiliasi_tutup_pada).toBeNull();
  });

  it("sesudah jendela lewat: SETIAP percobaan ditanyakan, ditandai, lalu tidak pernah ditanyakan lagi", async () => {
    // Percobaan 2 dengan `tautan_terbit_pada` NULL: `p_ulang` mengosongkan
    // tautan percobaan sebelumnya, padahal tautan percobaan 1 bisa sudah di
    // tangan pembeli. `percobaan > 1` karena itu ikut menandai "pernah
    // bertautan".
    const kode = `${AWALAN_KODE}0103`;
    const id = await semaiTertutup(kode, { kedaluwarsaJam: -3, percobaan: 2, tautan: false });
    doku.jawabPer.set(invK(kode, 1), TAK_DIKENAL);
    doku.jawabPer.set(invK(kode, 2), MENUNGGU(invK(kode, 2)));

    await sapuSampaiSepi();

    const milikIni = doku.panggilan.filter((i) => i.startsWith(kode.replaceAll("-", "")));
    // Serial, urut percobaan.
    expect(milikIni).toEqual([invK(kode, 1), invK(kode, 2)]);
    const b = await bacaTertutup(id);
    expect(b.rekonsiliasi_tutup_pada).not.toBeNull();
    expect(b.butuh_tinjauan_pada).toBeNull();

    // Pagar lima menit dicabut: yang menahan kini HANYA penandanya.
    await admin.from("orders").update({ diperiksa_pada: null }).eq("id", id);
    doku.panggilan.length = 0;
    await sapuSampaiSepi();
    expect(doku.panggilan.filter((i) => i.startsWith(kode.replaceAll("-", "")))).toEqual([]);
  });

  it("DOKU tak terjawab: TIDAK ditandai, dan ditanyakan lagi pada putaran berikutnya", async () => {
    const kode = `${AWALAN_KODE}0104`;
    const id = await semaiTertutup(kode, { kedaluwarsaJam: -3 });
    doku.jawabPer.set(invK(kode, 1), { ok: false, kode: 503, pesan: "Service unavailable" });

    await sapuSampaiSepi();
    expect(doku.panggilan).toContain(invK(kode, 1));
    expect((await bacaTertutup(id)).rekonsiliasi_tutup_pada).toBeNull();

    await admin.from("orders").update({ diperiksa_pada: null }).eq("id", id);
    doku.panggilan.length = 0;
    doku.jawabPer.set(invK(kode, 1), TAK_DIKENAL);
    await sapuSampaiSepi();
    expect(doku.panggilan).toContain(invK(kode, 1));
    expect((await bacaTertutup(id)).rekonsiliasi_tutup_pada).not.toBeNull();
  });

  it("dibatalkan TANPA tautan, dan pesanan kedaluwarsa, TIDAK PERNAH ditanyakan", async () => {
    const tanpa = `${AWALAN_KODE}0105`;
    const kedaluwarsa = `${AWALAN_KODE}0106`;
    await semaiTertutup(tanpa, { kedaluwarsaJam: -3, tautan: false });
    await semaiTertutup(kedaluwarsa, { kedaluwarsaJam: -3, status: "kedaluwarsa" });
    doku.jawabPer.set(invK(tanpa, 1), SUKSES(invK(tanpa, 1)));
    doku.jawabPer.set(invK(kedaluwarsa, 1), SUKSES(invK(kedaluwarsa, 1)));

    await sapuSampaiSepi();

    expect(doku.panggilan).not.toContain(invK(tanpa, 1));
    expect(doku.panggilan).not.toContain(invK(kedaluwarsa, 1));
  });

  it("percobaan PELUNAS (uang yang sudah tercatat) tidak ditanyakan ulang — tidak ada tuduhan palsu", async () => {
    // ditahan -> putusan staf "dibatalkan": uang percobaan 1 SUDAH tercatat
    // dan diputuskan manusia. Menanyakannya lagi melahirkan
    // lunas_setelah_tutup atas uang yang sama.
    const satu = `${AWALAN_KODE}0107`;
    const dua = `${AWALAN_KODE}0108`;
    const idSatu = await semaiTertutup(satu, { kedaluwarsaJam: -3, percobaanLunas: 1 });
    const idDua = await semaiTertutup(dua, { kedaluwarsaJam: -3, percobaan: 2, percobaanLunas: 1 });
    doku.jawabPer.set(invK(satu, 1), SUKSES(invK(satu, 1)));
    doku.jawabPer.set(invK(dua, 1), SUKSES(invK(dua, 1)));
    doku.jawabPer.set(invK(dua, 2), TAK_DIKENAL);

    await sapuSampaiSepi();

    expect(doku.panggilan).not.toContain(invK(satu, 1));
    expect(doku.panggilan).not.toContain(invK(dua, 1));
    expect(doku.panggilan).toContain(invK(dua, 2));
    expect((await bacaTertutup(idSatu)).sebab_tinjauan).toBeNull();
    expect((await bacaTertutup(idDua)).sebab_tinjauan).toBeNull();
    expect((await bacaTertutup(idDua)).rekonsiliasi_tutup_pada).not.toBeNull();
  });
});
