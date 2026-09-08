/**
 * MODUL PENGATURAN (/admin/pengaturan).
 *
 * Modul ini kecil dan justru karena itu berbahaya: satu medan teks yang isinya
 * mendarat di `href`, `src`, dan `window.open` di SELURUH kanal publik. Empat
 * kelas kegagalan yang dijaga berkas ini, semuanya SENYAP — tidak satu pun
 * melempar error:
 *
 *  1. FALLBACK YANG HANYA MENJAGA KEBERADAAN BARIS. `settings.ts` semula
 *     berbunyi `(data?.value ?? "6287778400200").replace(/\D/g,"")`. Operator
 *     `??` hanya menyala bila BARISNYA hilang; nilai `""` atau `"abc"` lolos
 *     apa adanya menjadi `nomorWaLink === ""`, dan seluruh kanal konversi
 *     menerbitkan `https://wa.me/` — tautan rusak, nol error, nol test merah.
 *     Karena itu yang diuji di sini adalah penjagaan NILAI, bukan baris.
 *
 *  2. BENTUK DATANG DARI BROWSER. Validator dipilih menurut kolom `bentuk` di
 *     registri, dan registri itu dibaca DI SERVER dari `app_setting_keys`.
 *     Bila `bentuk` boleh dikirim formulir, penyerang cukup menyebut kunci
 *     `nomor_wa` sebagai `teks_polos` dan seluruh sanitasi digit menguap.
 *
 *  3. KUNCI LIAR. `app_settings` adalah (key, value): money firewall memindai
 *     nama KOLOM dan tidak pernah melihatnya. FK ke registri sudah menutupnya
 *     di basis data (tests/pengaturan-kunci.test.ts); di sini yang dijaga
 *     adalah bahwa panel MENOLAKNYA LEBIH DULU dengan kalimat yang bisa dibaca
 *     manusia, bukan meneruskan 23503 mentah ke layar admin.
 *
 *  4. PROPAGASI SETENGAH. `/skrining` — kanal konversi utama — adalah halaman
 *     STATIS PENUH: nomor WA-nya dipanggang saat build (nilainya benar-benar
 *     ada di `.next/server/app/skrining.rsc`). Tanpa `revalidatePath("/skrining")`
 *     wizard tetap memakai nomor lama sampai deploy berikutnya, sementara
 *     panel dengan percaya diri menampilkan nomor baru.
 *
 * Higiene: berkas ini mengubah baris `nomor_wa` yang dipakai SELURUH aplikasi.
 * Nilainya dikembalikan ke nilai seed di `afterAll`, dan dua kunci lain yang
 * lahir di sini dihapus. Barisnya sendiri tidak pernah dihapus — ia berasal
 * dari seed dan dibutuhkan landing, skrining, serta passport.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";
import { nominalDalam } from "./helpers/nominal";

const svc = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

/** Nilai seed — dikembalikan di afterAll supaya berkas lain tidak terwarisi. */
const WA_SEED = "6287778400200";
/** Kunci terdaftar yang seed TIDAK isi; aman dilahirkan & dihapus di sini. */
const KUNCI_TEKS = "alamat_klinik";
const KUNCI_JAM = "jam_operasional";
/** Kunci karangan; tidak pernah terdaftar di app_setting_keys. */
const KUNCI_LIAR = "PAD-UJI-tarif-sesi";

// Lapisan data & action memakai sesi pengguna (`createServerSupabase`), yang
// membaca cookies() dan hanya bermakna di dalam request scope. Modulnya
// diganti klien Supabase ber-SESI NYATA: RLS dan requireRole tetap berjalan
// apa adanya, persis seperti di server.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const jejakCache = vi.hoisted(() => ({ revalidate: [] as string[] }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    jejakCache.revalidate.push(p);
  },
}));

// `redirect()` melempar di dalam request Next. Di test ia dijadikan error yang
// bisa dibaca supaya "penjaga peran hilang" menjadi MERAH, bukan senyap.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/admin/pengaturan",
}));

const bentuk = await import("@/lib/pengaturan/bentuk");
const { daftarSetelanAdmin, nomorWaKlinik } = await import("@/lib/admin/pengaturan");
const { simpanSetelan } = await import("@/app/admin/pengaturan/aksi");
const { KartuSetelan } = await import("@/app/admin/pengaturan/form-pengaturan");
const { default: PengaturanPage } = await import("@/app/admin/pengaturan/page");
const { bacaPengaturan } = await import("@/lib/settings");
// Landing dirender SUNGGUHAN di describe (D2): satu-satunya cara membuktikan
// bahwa nilai yang disimpan panel benar-benar sampai ke halaman pengunjung —
// membaca sumbernya saja tidak membuktikan apa pun tentang nilai DB.
const { default: Home } = await import("@/app/page");

const sumberAksi = baca("src/app/admin/pengaturan/aksi.ts");
const sumberHalaman = baca("src/app/admin/pengaturan/page.tsx");
const sumberForm = baca("src/app/admin/pengaturan/form-pengaturan.tsx");
const sumberBentuk = baca("src/lib/pengaturan/bentuk.ts");
const sumberSettings = baca("src/lib/settings.ts");

let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;

async function nilaiDb(key: string): Promise<string | null> {
  const { data } = await svc.from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as string | undefined) ?? null;
}

/** Menyetel nilai lewat service role — menembus panel, meniru data yang ada. */
async function paksaNilai(key: string, value: string) {
  await svc.from("app_settings").upsert({ key, value }, { onConflict: "key" });
}

function fd(nilai: string): FormData {
  const f = new FormData();
  f.set("nilai", nilai);
  return f;
}

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  jejakCache.revalidate.length = 0;
  await paksaNilai("nomor_wa", WA_SEED);
  await svc.from("app_settings").delete().in("key", [KUNCI_TEKS, KUNCI_JAM]);
});

afterAll(async () => {
  // Baris `nomor_wa` TIDAK dihapus — ia milik seed dan dibutuhkan seluruh
  // aplikasi; hanya nilainya yang dipulihkan.
  await paksaNilai("nomor_wa", WA_SEED);
  await svc.from("app_settings").delete().in("key", [KUNCI_TEKS, KUNCI_JAM, KUNCI_LIAR]);
});

// ---------------------------------------------------------------------------
// (A) BENTUK NILAI — modul murni, penjagaan NILAI bukan keberadaan baris
// ---------------------------------------------------------------------------

describe("bentuk nilai setelan", () => {
  it("nomor WA: hanya digit, 8–15 digit setelah normalisasi", () => {
    expect(bentuk.periksaNilai("nomor_wa", "+62 877-7840-0201")).toEqual({
      ok: true,
      nilai: "6287778400201",
    });
    // Nomor lokal yang ditempel admin dijadikan internasional — `wa.me/0877…`
    // adalah tautan yang selalu gagal, dan gagalnya tidak terlihat di panel.
    expect(bentuk.periksaNilai("nomor_wa", "0877-7840-0201")).toEqual({
      ok: true,
      nilai: "6287778400201",
    });
    for (const buruk of ["", "   ", "abc", "12345", "6".repeat(16)]) {
      const r = bentuk.periksaNilai("nomor_wa", buruk);
      expect(r.ok, `nilai ${JSON.stringify(buruk)} seharusnya ditolak`).toBe(false);
      expect(r.ok === false && r.pesan.length > 0).toBe(true);
    }
  });

  it("teks polos: menolak < > dan skema URL, menerima teks biasa", () => {
    expect(bentuk.periksaNilai("teks_polos", " Jabodetabek ")).toEqual({
      ok: true,
      nilai: "Jabodetabek",
    });
    for (const buruk of [
      "<script>alert(1)</script>",
      "Klinik <b>PADMA</b>",
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<h1>x</h1>",
      "",
    ]) {
      const r = bentuk.periksaNilai("teks_polos", buruk);
      expect(r.ok, `nilai ${JSON.stringify(buruk)} seharusnya ditolak`).toBe(false);
    }
  });

  it("nomorWaTerpakai menjaga NILAI, bukan sekadar keberadaan baris", () => {
    // Inilah cacat yang ditutup: `?? bawaan` tidak pernah menyala untuk "".
    expect(bentuk.nomorWaTerpakai("")).toBe(bentuk.NOMOR_WA_BAWAAN);
    expect(bentuk.nomorWaTerpakai("abc")).toBe(bentuk.NOMOR_WA_BAWAAN);
    expect(bentuk.nomorWaTerpakai("123")).toBe(bentuk.NOMOR_WA_BAWAAN);
    expect(bentuk.nomorWaTerpakai(null)).toBe(bentuk.NOMOR_WA_BAWAAN);
    expect(bentuk.nomorWaTerpakai(undefined)).toBe(bentuk.NOMOR_WA_BAWAAN);
    expect(bentuk.nomorWaTerpakai("6287778400201")).toBe("6287778400201");
  });

  it("modul bentuk MURNI — hanya boleh mengimpor modul murni lain, bukan Supabase/node:crypto (dipakai lintas batas server/klien)", () => {
    const barisImpor = sumberBentuk.match(/^\s*import\s.*$/gm) ?? [];
    expect(barisImpor.length).toBeGreaterThan(0);
    for (const baris of barisImpor) {
      expect(baris).toMatch(/@\/lib\/jadwal\/jam/);
    }
  });
});

// ---------------------------------------------------------------------------
// (B) settings.ts — nilai rusak tidak pernah menjadi href rusak
// ---------------------------------------------------------------------------

describe("bacaPengaturan menolak nilai rusak, bukan hanya baris hilang", () => {
  it("nilai kosong di basis data tetap menghasilkan tautan wa.me yang sah", async () => {
    await paksaNilai("nomor_wa", "");
    const s = await bacaPengaturan();
    expect(s.nomorWaLink).toMatch(/^\d{8,15}$/);
    expect(`https://wa.me/${s.nomorWaLink}`).not.toBe("https://wa.me/");
  });

  it("nilai sampah di basis data tetap menghasilkan tautan wa.me yang sah", async () => {
    await paksaNilai("nomor_wa", "hubungi kami ya");
    const s = await bacaPengaturan();
    expect(s.nomorWaLink).toBe(bentuk.NOMOR_WA_BAWAAN);
    expect(s.nomorWaTampilan).toMatch(/^0[\d-]+$/);
  });

  it("nilai sah dipakai apa adanya (fallback tidak menelan data sungguhan)", async () => {
    await paksaNilai("nomor_wa", "6281234567890");
    const s = await bacaPengaturan();
    expect(s.nomorWaLink).toBe("6281234567890");
  });
});

// ---------------------------------------------------------------------------
// (C) Lapisan data
// ---------------------------------------------------------------------------

describe("daftarSetelanAdmin", () => {
  it("mengembalikan seluruh kunci TERDAFTAR beserta label & bentuknya", async () => {
    const daftar = await daftarSetelanAdmin();
    expect(daftar.map((s) => s.key).sort()).toEqual([
      "alamat_klinik",
      "jam_layanan",
      "jam_operasional",
      "nomor_wa",
    ]);
    for (const s of daftar) {
      expect(s.keterangan.length, `kunci ${s.key} tanpa keterangan`).toBeGreaterThan(0);
      expect(["nomor_wa", "teks_polos", "daftar_jam"]).toContain(s.bentuk);
    }
  });

  it("membawa nilai yang tersimpan, dan string kosong bila belum pernah diisi", async () => {
    const daftar = await daftarSetelanAdmin();
    expect(daftar.find((s) => s.key === "nomor_wa")!.nilai).toBe(WA_SEED);
    expect(daftar.find((s) => s.key === KUNCI_TEKS)!.nilai).toBe("");
  });

  it("nomor WA didahulukan — ia kanal konversi, bukan setelan urutan abjad", async () => {
    const daftar = await daftarSetelanAdmin();
    expect(daftar[0].key).toBe("nomor_wa");
  });

  it("nomorWaKlinik memakai sesi admin dan menjaga nilainya", async () => {
    await paksaNilai("nomor_wa", "");
    expect((await nomorWaKlinik()).link).toBe(bentuk.NOMOR_WA_BAWAAN);
    await paksaNilai("nomor_wa", "6281234567890");
    const n = await nomorWaKlinik();
    expect(n.link).toBe("6281234567890");
    expect(n.tampilan).toBe("0812-3456-7890");
  });
});

// ---------------------------------------------------------------------------
// (D) simpanSetelan
// ---------------------------------------------------------------------------

describe("simpanSetelan", () => {
  it("nomor WA baru tersimpan DAN langsung terbaca bacaPengaturan()", async () => {
    const r = await simpanSetelan("nomor_wa", fd("+62 812-3456-7890"));
    expect(r.ok).toBe(true);
    expect(await nilaiDb("nomor_wa")).toBe("6281234567890"); // dinormalkan
    expect((await bacaPengaturan()).nomorWaLink).toBe("6281234567890");
  });

  it("melahirkan kunci terdaftar yang belum pernah diisi", async () => {
    const r = await simpanSetelan(KUNCI_TEKS, fd("Homecare Jabodetabek"));
    expect(r.ok).toBe(true);
    expect(await nilaiDb(KUNCI_TEKS)).toBe("Homecare Jabodetabek");
  });

  it("nilai tidak sah ditolak dengan kalimat manusia — dan DB tidak bergeser", async () => {
    const r = await simpanSetelan("nomor_wa", fd("hubungi kami"));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.pesan).toMatch(/[a-z]{4}/i);
    expect(r.ok === false && r.pesan).not.toMatch(/\b\d{5}\b/); // bukan kode Postgres
    expect(await nilaiDb("nomor_wa")).toBe(WA_SEED);
  });

  it("teks berisi < > ditolak sebelum menyentuh basis data", async () => {
    const r = await simpanSetelan(KUNCI_TEKS, fd("<img src=x onerror=alert(1)>"));
    expect(r.ok).toBe(false);
    expect(await nilaiDb(KUNCI_TEKS)).toBeNull();
  });

  it("skema URL berbahaya ditolak — nilai ini mendarat di href", async () => {
    const r = await simpanSetelan(KUNCI_TEKS, fd("javascript:alert(document.cookie)"));
    expect(r.ok).toBe(false);
    expect(await nilaiDb(KUNCI_TEKS)).toBeNull();
  });

  it("kunci TIDAK TERDAFTAR ditolak panel lebih dulu, bukan 23503 mentah ke layar", async () => {
    const r = await simpanSetelan(KUNCI_LIAR, fd("425000"));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.pesan).not.toMatch(/23503|foreign key|violates/i);
    expect(await nilaiDb(KUNCI_LIAR)).toBeNull();
  });

  it("nominal uang tidak bisa diselundupkan lewat kunci terdaftar bertipe teks", async () => {
    // Pagar sesungguhnya adalah registri (FK). Yang dijaga di sini: panel tidak
    // menyediakan jalan pintas apa pun menuju kunci di luar registri.
    const r = await simpanSetelan("tarif_sesi", fd("425000"));
    expect(r.ok).toBe(false);
    const { data } = await svc.from("app_settings").select("key").eq("key", "tarif_sesi");
    expect(data ?? []).toHaveLength(0);
  });

  it("PROPAGASI: menyegarkan landing, SKRINING, passport, dan halamannya sendiri", async () => {
    // `/skrining` adalah halaman STATIS PENUH — nomor WA-nya dipanggang saat
    // build (`.next/server/app/skrining.rsc` benar-benar memuat nilainya).
    // Tanpa baris ini kanal konversi utama memakai nomor lama sampai deploy
    // berikutnya, tanpa satu pun error.
    await simpanSetelan("nomor_wa", fd("6281234567890"));
    for (const p of ["/", "/skrining", "/passport/bayar", "/admin/pengaturan"]) {
      expect(jejakCache.revalidate, `lupa revalidatePath("${p}")`).toContain(p);
    }
  });

  it("tidak menyegarkan apa pun ketika penyimpanan GAGAL", async () => {
    await simpanSetelan("nomor_wa", fd("abc"));
    expect(jejakCache.revalidate).toHaveLength(0);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa mengubah nomor WA klinik", async () => {
    ref.sesi = sesiKlien;
    await expect(simpanSetelan("nomor_wa", fd("6280000000000"))).rejects.toThrow(/REDIRECT/);
    ref.sesi = sesiAdmin;
    expect(await nilaiDb("nomor_wa")).toBe(WA_SEED);
  });
});

// ---------------------------------------------------------------------------
// (D2) KENDALI MATI — kunci terdaftar yang tidak dibaca halaman mana pun
// ---------------------------------------------------------------------------
// Temuan red team (29 Agu 2026). Dua dari tiga kartu di /admin/pengaturan
// adalah KENDALI MATI: `alamat_klinik` & `jam_operasional` terdaftar di
// registri, dirender sebagai kartu, disimpan ke basis data — lalu tidak dibaca
// SATU pun halaman. Diuji dengan nilai bertanda pada server dev yang hidup:
//     upsert alamat_klinik   = "PAD-UJI-ALAMAT-Kemang Jakarta Selatan"
//     upsert jam_operasional = "PAD-UJI-JAM 08.00-20.00 WIB"
//     kemunculan "PAD-UJI" di HTML: / -> 0   /skrining -> 0   /masuk -> 0
//     footer tetap "Melayani area Jabodetabek" (ditulis keras di footer.tsx:27)
// Sementara formulir menjawab "Tersimpan. Halaman publik sudah memakai nilai
// baru." — kalimat yang tidak benar untuk dua dari tiga kartu. Itu bentuk yang
// sama dengan "tombol yang berbohong sejak hari pertama" yang migration
// `gating_materi_hormati_aktif` sendiri larang untuk modul materi.
describe("setiap kunci terdaftar BENAR-BENAR dibaca halaman publik", () => {
  it("alamat & jam yang disimpan admin muncul di footer landing", async () => {
    const ALAMAT = "PAD-UJI Kemang Jakarta Selatan";
    const JAM = "PAD-UJI Senin-Sabtu 08.00-20.00 WIB";
    expect((await simpanSetelan(KUNCI_TEKS, fd(ALAMAT))).ok).toBe(true);
    expect((await simpanSetelan(KUNCI_JAM, fd(JAM))).ok).toBe(true);

    const s = await bacaPengaturan();
    expect(s.alamatTampilan).toBe(ALAMAT);
    expect(s.jamTampilan).toBe(JAM);

    const m = renderToStaticMarkup(await Home());
    expect(m, "alamat_klinik tidak sampai ke landing").toContain(ALAMAT);
    expect(m, "jam_operasional tidak sampai ke landing").toContain(JAM);
  });

  it("nilai KOSONG jatuh ke teks bawaan — bukan footer berlubang", async () => {
    // Penjagaan NILAI yang sama seperti `nomorWaTerpakai`: satu klik "Simpan"
    // pada medan kosong, atau baris yang belum pernah diisi, tidak boleh
    // menerbitkan footer dengan baris hilang.
    await paksaNilai(KUNCI_TEKS, "");
    await paksaNilai(KUNCI_JAM, "   ");
    const s = await bacaPengaturan();
    expect(s.alamatTampilan).toBe(bentuk.ALAMAT_BAWAAN);
    expect(s.jamTampilan).toBe(bentuk.JAM_BAWAAN);

    const m = renderToStaticMarkup(await Home());
    expect(m).toContain(bentuk.ALAMAT_BAWAAN);
    expect(m).toContain(bentuk.JAM_BAWAAN);
  });

  it("baris yang BELUM PERNAH ADA pun jatuh ke teks bawaan", async () => {
    await svc.from("app_settings").delete().in("key", [KUNCI_TEKS, KUNCI_JAM]);
    const s = await bacaPengaturan();
    expect(s.alamatTampilan).toBe(bentuk.ALAMAT_BAWAAN);
    expect(s.jamTampilan).toBe(bentuk.JAM_BAWAAN);
  });

  it("nilai sampah di basis data tidak diterbitkan apa adanya", async () => {
    // Nilai bisa mendarat lewat service role tanpa melewati `periksaNilai`.
    await paksaNilai(KUNCI_TEKS, "<script>alert(1)</script>");
    await paksaNilai(KUNCI_JAM, "javascript:alert(1)");
    const s = await bacaPengaturan();
    expect(s.alamatTampilan).toBe(bentuk.ALAMAT_BAWAAN);
    expect(s.jamTampilan).toBe(bentuk.JAM_BAWAAN);
  });

  it("footer tidak lagi menulis keras alamat & jam", () => {
    const footer = baca("src/app/_landing/footer.tsx");
    expect(footer, "alamat masih ditulis keras di komponen").not.toContain(
      "Jabodetabek",
    );
  });

  it("TIDAK ADA kunci terdaftar tanpa pembaca (kendali mati)", async () => {
    // Inilah assertion yang seharusnya sudah merah sejak hari pertama:
    // registri berjanji "ditampilkan di footer" / "ditampilkan ke pengunjung",
    // sementara `grep -rn alamat_klinik src/` tidak menemukan apa pun di luar
    // registri. Kunci baru yang lahir lewat migration tanpa pembaca akan
    // langsung merah di sini, bukan ditemukan red team berikutnya.
    const { data: registri } = await svc.from("app_setting_keys").select("key");
    expect((registri ?? []).length).toBeGreaterThanOrEqual(3);

    const berkasSrc: string[] = [];
    const telusuri = (dir: string) => {
      for (const e of readdirSync(path.join(AKAR, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) telusuri(rel);
        else if (/\.(ts|tsx)$/.test(e.name)) berkasSrc.push(baca(rel));
      }
    };
    telusuri("src");
    const semuaSumber = berkasSrc.join("\n");

    for (const r of registri ?? []) {
      expect(
        semuaSumber.includes(r.key as string),
        `kunci "${r.key}" terdaftar tetapi tidak dibaca satu berkas pun di src/`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// (E) Jalur langsung — panel bukan satu-satunya pintu
// ---------------------------------------------------------------------------

describe("jalur REST langsung tetap tertutup untuk yang tidak berhak", () => {
  it("klien tidak bisa menulis app_settings", async () => {
    const { data, error } = await sesiKlien
      .from("app_settings")
      .update({ value: "6280000000000" })
      .eq("key", "nomor_wa")
      .select("key");
    expect(data ?? []).toHaveLength(0);
    if (error) expect(error.code).toBeDefined();
    expect(await nilaiDb("nomor_wa")).toBe(WA_SEED);
  });

  it("anon tidak bisa membaca maupun menulis app_settings", async () => {
    const anon = anonClient();
    const { error: eBaca } = await anon.from("app_settings").select("*");
    expect(eBaca?.code).toBe("42501");
    const { error: eTulis } = await anon
      .from("app_settings")
      .update({ value: "6280000000000" })
      .eq("key", "nomor_wa");
    expect(eTulis).not.toBeNull();
    expect(await nilaiDb("nomor_wa")).toBe(WA_SEED);
  });
});

// ---------------------------------------------------------------------------
// (F) Halaman & kartu
// ---------------------------------------------------------------------------

describe("halaman /admin/pengaturan", () => {
  it("merender satu kartu per kunci terdaftar, berlabel keterangannya", async () => {
    const m = renderToStaticMarkup(await PengaturanPage());
    expect(m).toContain("WhatsApp");
    expect(m).toContain("Alamat/area layanan");
    expect(m).toContain("Jam operasional");
    expect(m).toContain(WA_SEED);
  });

  it("menjelaskan bahwa kunci baru lahir lewat migration, bukan lewat panel", async () => {
    const m = renderToStaticMarkup(await PengaturanPage());
    expect(m).toMatch(/migration/i);
  });

  it("memperingatkan bahwa nomor WA merambat ke seluruh kanal publik", async () => {
    const m = renderToStaticMarkup(await PengaturanPage());
    expect(m).toMatch(/skrining/i);
  });

  it("TIDAK ada nominal uang di seluruh modul (money firewall lewat baris)", async () => {
    const m = renderToStaticMarkup(await PengaturanPage());
    expect(nominalDalam(m), "nominal bocor").toEqual([]);
    for (const sumber of [sumberHalaman, sumberForm, sumberAksi]) {
      expect(nominalDalam(sumber), "nominal bocor").toEqual([]);
      expect(sumber).not.toContain("service_rates");
      expect(sumber).not.toContain("variant_rates");
      expect(sumber).not.toContain("honor_marks");
    }
  });

  it("kartu menampilkan pratinjau tautan wa.me untuk kunci bernomor", () => {
    const m = renderToStaticMarkup(
      createElement(KartuSetelan, {
        setelan: {
          key: "nomor_wa",
          keterangan: "Nomor WhatsApp resmi PADMA",
          bentuk: "nomor_wa" as const,
          nilai: WA_SEED,
        },
      }),
    );
    expect(m).toContain(`https://wa.me/${WA_SEED}`);
    expect(m).toContain("Simpan");
  });
});

// ---------------------------------------------------------------------------
// (G) Bentuk berkas
// ---------------------------------------------------------------------------

describe("bentuk berkas modul pengaturan", () => {
  it("BENTUK TIDAK PERNAH DATANG DARI BROWSER — dibaca dari registri di server", () => {
    expect(sumberAksi).toContain("app_setting_keys");
    expect(sumberAksi).not.toMatch(/get\(\s*["']bentuk["']\s*\)/);
    expect(sumberForm).not.toMatch(/name=["']bentuk["']/);
    // Kuncinya pun tidak pernah diambil dari FormData: ia argumen terikat di
    // server component, bukan medan yang bisa ditulis ulang di DevTools.
    expect(sumberAksi).not.toMatch(/get\(\s*["']key["']\s*\)/);
  });

  it("SETIAP action memanggil requireRole(['admin','owner']) di dalam dirinya", () => {
    const jumlahAction = [...sumberAksi.matchAll(/^export\s+async\s+function\s+\w+/gm)].length;
    const jumlahGuard = [
      ...sumberAksi.matchAll(/await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/g),
    ].length;
    expect(jumlahAction).toBeGreaterThanOrEqual(1);
    expect(jumlahGuard).toBe(jumlahAction);
  });

  it("berkas 'use server' hanya mengekspor fungsi async", () => {
    const ekspor = [...sumberAksi.matchAll(/^export\s+(?!type\b)(\w+)/gm)].map((m) => m[1]);
    expect([...new Set(ekspor)]).toEqual(["async"]);
  });

  it("UPDATE/UPSERT diperiksa panjangnya — 200 + [] bukan sukses", () => {
    expect(sumberAksi).toMatch(/\.select\(["']key["']\)/);
    expect(sumberAksi).toMatch(/length\s*===\s*0/);
  });

  it("memakai sesi pengguna, bukan service role", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberForm]) {
      expect(sumber).not.toContain("createAdminSupabase");
      expect(sumber).not.toContain("SERVICE_ROLE");
    }
    expect(sumberAksi).toContain("createServerSupabase");
    expect(baca("src/lib/admin/pengaturan.ts")).toContain("createServerSupabase");
  });

  it("settings.ts memakai penjaga NILAI bersama, bukan `?? bawaan` sendiri", () => {
    // Dua tempat yang memutuskan "nomor mana yang dipakai" adalah dua tempat
    // yang bisa berselisih. Penjaganya satu: @/lib/pengaturan/bentuk.
    expect(sumberSettings).toMatch(/from\s+["']@\/lib\/pengaturan\/bentuk["']/);
    expect(sumberSettings).not.toMatch(/\?\?\s*["']\d/);
  });

  it("modul murni pesan undangan TETAP tanpa impor (teks konfigurabel jadi prop)", () => {
    // Kartu aktivasi adalah komponen "use client"; satu impor di berkas ini
    // menyeret node:crypto + klien service role ke bundel browser.
    expect(baca("src/lib/auth/pesan-undangan.ts")).not.toMatch(/^\s*import\s/m);
  });

  it("navigasi admin menautkan modul pengaturan", () => {
    expect(baca("src/app/admin/_shell/nav-admin.tsx")).toContain('href: "/admin/pengaturan"');
  });
});
