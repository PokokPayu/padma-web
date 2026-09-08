/**
 * Modul TRANSPORT panel owner — `/owner/transport`.
 *
 * Dua sumber kebenaran nominal hidup di sini, dan keduanya SEPENUHNYA milik
 * owner:
 *
 *  1. Rate card per JENJANG jarak (`transport_rates`) — INSERT-ONLY, sama
 *     persis pola `variant_rates`/`owner/tarif`: tarif baru = baris baru,
 *     tanggal berlaku tidak boleh mundur, dan jenjang `di_atas_20` DITOLAK
 *     sama sekali (CHECK `transport_rates_bukan_per_kasus`) — nominalnya
 *     bukan rate card, melainkan ketiadaan tarif.
 *
 *  2. Tarif KHUSUS per sesi >20 km (`transport_khusus`) — ditetapkan owner
 *     SEKALI per sesi, dan HANYA untuk sesi yang benar-benar berjenjang
 *     `di_atas_20`. Menetapkannya untuk sesi berjenjang biasa akan
 *     menciptakan sumber kebenaran KEDUA untuk nominal yang seharusnya
 *     datang dari `transport_rates`.
 *
 * Ditambah SATU pagar lintas-panel yang tidak dimiliki modul tarif varian:
 * `hitungMenungguTarifTransport()` di `lib/admin/antrean.ts` menghitung badge
 * admin dari saringan yang PERSIS SAMA dengan `ambilSesiMenungguTarif()` di
 * sini. Keduanya kini membaca VIEW `sesi_menunggu_tarif_transport` (migrasi
 * `20260907140000`, Ruling 12) yang melakukan anti-join-nya sendiri di SQL
 * dengan `security_invoker = off` — admin memperoleh ANGKA YANG BENAR tanpa
 * pernah butuh hak baca `transport_khusus`, bukan konstanta nol seperti draf
 * pertama modul ini (lihat describe "hitungMenungguTarifTransport" di bawah).
 *
 * Data uji berprefiks `PAD-UJI`/id akhiran `f4`, dibersihkan `afterAll`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { geserHari } from "@/lib/owner/pekan";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { tarifTransportPadaTanggal, type TarifTransportRingkas } from "@/lib/transport/tarif";
import { pesanKodePostgres, pesanKodePostgresKhusus } from "@/app/owner/transport/status";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const admin = createAdminSupabase();

// Lapisan data & action memakai sesi pengguna (`createServerSupabase`). Di
// vitest tidak ada cookie, jadi klien ber-SESI SUNGGUHAN disuntikkan: RLS dan
// requireRole tetap berjalan apa adanya, persis seperti di server.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const jejak = vi.hoisted(() => ({ revalidate: [] as string[] }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    jejak.revalidate.push(p);
  },
}));

// `redirect` sengaja MELEMPAR: bila penjaga peran memanggilnya, test harus
// gagal keras, bukan diam-diam melanjutkan mutasi uang.
vi.mock("next/navigation", () => ({
  redirect: (ke: string) => {
    throw new Error(`REDIRECT ${ke}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/owner/transport",
  // `PanelGeser` (Task 7) memakai `useRouter` untuk tombol Escape/overlay —
  // `renderToStaticMarkup` tidak menjalankan efeknya, tapi pemanggilan
  // `useRouter()` sendiri di badan komponen tetap butuh mock ini.
  useRouter: () => ({ push: () => {} }),
}));

// --- Fixture -----------------------------------------------------------------

const SERVICE = "11111111-1111-1111-1111-111111111101"; // layanan seed, tidak dirujuk test jenjang lain
const MITRA_UJI = "33333333-3333-3333-3333-3333333333f4";
const KLIEN_UJI = "44444444-4444-4444-4444-4444444444f4";
const PADMA_ID_UJI = "PAD-UJI-00F4";

const SESI = {
  jauh: "66666666-6666-6666-6666-6666666661f4", // di_atas_20, belum ditetapkan
  jauhSudah: "66666666-6666-6666-6666-6666666662f4", // di_atas_20, SUDAH ditetapkan
  jauhBatal: "66666666-6666-6666-6666-6666666663f4", // di_atas_20, tapi batal
  biasa: "66666666-6666-6666-6666-6666666664f4", // jenjang biasa (0_5)
};

const HARI_INI = hariIniJakarta();
// Jauh di masa depan supaya rate card insert-only di sini TIDAK PERNAH
// bentrok dengan tarif produksi/seed maupun tarif "berlaku sekarang" yang
// dibaca test/berkas lain pada HARI_INI.
const DEPAN_A = geserHari(HARI_INI, 500);
const DEPAN_B = geserHari(HARI_INI, 501);
const DEPAN_MUNDUR = geserHari(HARI_INI, 499);

function formOf(bidang: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(bidang)) fd.set(k, v);
  return fd;
}

/** Seluruh baris tarif satu JENJANG, dibaca lewat SERVICE ROLE (bukan RLS). */
async function tarifJenjang(jenjang: string): Promise<Array<{ id: string; berlaku_sejak: string }>> {
  const { data } = await admin
    .from("transport_rates")
    .select("id, berlaku_sejak")
    .eq("jenjang", jenjang);
  return data ?? [];
}

async function bersihkan() {
  for (const id of Object.values(SESI)) {
    await admin.from("transport_khusus").delete().eq("session_id", id);
    await admin.from("sessions").delete().eq("id", id);
    // Tabel jejak SENGAJA tanpa foreign key — penghapusan sesi tidak
    // menyapunya, dan tanpa baris ini `npm test` menumpuk yatim tiap run.
    await admin.from("jejak_status_bayar").delete().eq("sesi_id", id);
  }
  await admin.from("clients").delete().eq("id", KLIEN_UJI);
  await admin.from("partners").delete().eq("id", MITRA_UJI);
  // Baris rate card transport fixture: dibersihkan per JENJANG + tanggal
  // (bukan per id yang kita catat sendiri) — test di bawah menyisipkannya
  // lewat action sungguhan (`tetapkanTarifTransport`), bukan raw SQL, jadi
  // id-nya baru diketahui SESUDAH insert. Tanpa ini proses yang terhenti di
  // tengah jalan menumpuk baris fixture selamanya (append-only, DELETE
  // tercabut dari peran API — hanya service role yang bisa membersihkannya).
  for (const jenjang of ["10_15", "15_20"]) {
    await admin
      .from("transport_rates")
      .delete()
      .eq("jenjang", jenjang)
      .in("berlaku_sejak", [DEPAN_A, DEPAN_B, DEPAN_MUNDUR]);
  }
}

const { tetapkanTarifTransport, tetapkanTarifKhusus } = await import("@/app/owner/transport/aksi");
const { ambilTarifTransport, ambilSesiMenungguTarif } = await import("@/lib/owner/data");
const { hitungAntrean, hitungMenungguTarifTransport } = await import("@/lib/admin/antrean");
const { default: TransportPage } = await import("@/app/owner/transport/page");

const sumberAksi = baca("src/app/owner/transport/aksi.ts");
const sumberHalaman = baca("src/app/owner/transport/page.tsx");
const sumberForm = baca("src/app/owner/transport/form-tarif-transport.tsx");
const sumberStatus = baca("src/app/owner/transport/status.ts");
const sumberData = baca("src/lib/owner/data.ts");
const sumberAntrean = baca("src/lib/admin/antrean.ts");
const SEMUA_SUMBER = [sumberAksi, sumberHalaman, sumberForm, sumberStatus];

let sesiOwner: SupabaseClient;
let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;
let variantId: string;

beforeAll(async () => {
  await bersihkan();
  sesiOwner = await signInAs("owner@padma.test");
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
  ref.sesi = sesiOwner;

  variantId = await varianBaku(admin, SERVICE);

  await admin.from("partners").insert({
    id: MITRA_UJI,
    nama: "PAD-UJI Bidan Transport",
    no_hp: "0811-0000-9401",
  });
  await admin.from("clients").insert({
    id: KLIEN_UJI,
    padma_id: PADMA_ID_UJI,
    nama: "Uji Transport Owner",
    email: "uji-transport-owner@padma.test",
    phase_id: "prekonsepsi",
  });

  const dasarSesi = {
    client_id: KLIEN_UJI,
    service_id: SERVICE,
    variant_id: variantId,
    partner_id: MITRA_UJI,
    tanggal: HARI_INI,
    status_bayar: "belum" as const,
    catatan: "",
    rekomendasi: "",
    jam_mulai: "09:00",
  };
  await admin.from("sessions").insert([
    { ...dasarSesi, id: SESI.jauh, status: "terjadwal", jenjang: "di_atas_20" },
    { ...dasarSesi, id: SESI.jauhSudah, status: "terjadwal", jenjang: "di_atas_20" },
    { ...dasarSesi, id: SESI.jauhBatal, status: "dibatalkan_padma", jenjang: "di_atas_20" },
    { ...dasarSesi, id: SESI.biasa, status: "terjadwal", jenjang: "0_5" },
  ]);
  // SESI.jauhSudah SUDAH punya tarif khusus SEBELUM test apa pun berjalan —
  // dipakai membuktikan exclusion-nya dari daftar menunggu.
  await admin
    .from("transport_khusus")
    .insert({ session_id: SESI.jauhSudah, tarif_klien: 50000, honor_mitra: 40000 });
});

afterAll(bersihkan);

beforeEach(() => {
  ref.sesi = sesiOwner;
  jejak.revalidate.length = 0;
});

// ---------------------------------------------------------------------------
// tarifTransportPadaTanggal — fungsi murni, sejajar tarifPadaTanggal (varian)
// ---------------------------------------------------------------------------

describe("tarifTransportPadaTanggal — fungsi murni", () => {
  const contoh: TarifTransportRingkas[] = [
    { id: "a", jenjang: "0_5", tarifKlien: 0, honorMitra: 10000, berlakuSejak: "2020-01-01" },
    { id: "b", jenjang: "0_5", tarifKlien: 0, honorMitra: 12000, berlakuSejak: "2024-01-01" },
    { id: "c", jenjang: "5_10", tarifKlien: 10000, honorMitra: 10000, berlakuSejak: "2020-01-01" },
  ];

  it("memilih berlaku_sejak terbesar yang masih <= tanggal", () => {
    expect(tarifTransportPadaTanggal(contoh, "0_5", "2025-01-01")?.id).toBe("b");
    expect(tarifTransportPadaTanggal(contoh, "0_5", "2021-01-01")?.id).toBe("a");
  });

  it("null bila tanggal lebih tua dari tarif paling awal jenjang itu", () => {
    expect(tarifTransportPadaTanggal(contoh, "0_5", "2019-01-01")).toBeNull();
  });

  it("tidak bocor antar jenjang", () => {
    expect(tarifTransportPadaTanggal(contoh, "5_10", "2025-01-01")?.id).toBe("c");
    expect(tarifTransportPadaTanggal(contoh, "10_15", "2025-01-01")).toBeNull();
  });

  it("seri tanggal dipecah dengan id terkecil, deterministik", () => {
    const seri: TarifTransportRingkas[] = [
      { id: "z", jenjang: "0_5", tarifKlien: 1, honorMitra: 1, berlakuSejak: "2025-01-01" },
      { id: "a", jenjang: "0_5", tarifKlien: 2, honorMitra: 2, berlakuSejak: "2025-01-01" },
    ];
    expect(tarifTransportPadaTanggal(seri, "0_5", "2025-06-01")?.id).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// tetapkanTarifTransport — insert-only, sama persis pola tetapkanTarif
// ---------------------------------------------------------------------------

describe("tetapkanTarifTransport — rate card per jenjang", () => {
  it("tarif transport baru lahir sebagai BARIS BARU, bukan menimpa", async () => {
    const sebelum = await tarifJenjang("10_15");
    const hasil = await tetapkanTarifTransport(
      formOf({ jenjang: "10_15", tarif: "25000", honor: "18000", mulai: DEPAN_A }),
    );
    expect(hasil.ok).toBe(true);
    const sesudah = await tarifJenjang("10_15");
    expect(sesudah.length).toBe(sebelum.length + 1);
  });

  it("menolak tarif bertanggal mundur, dengan KALIMAT", async () => {
    const r = await tetapkanTarifTransport(
      formOf({ jenjang: "10_15", tarif: "1000", honor: "1000", mulai: DEPAN_MUNDUR }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pesan).toMatch(/setelah tarif terakhir/i);
  });

  it("honor BOLEH melebihi tarif klien — subsidi PADMA, bukan ditolak", async () => {
    // Beda dari tetapkanTarif varian, yang justru menolak honor > harga.
    const r = await tetapkanTarifTransport(
      formOf({ jenjang: "15_20", tarif: "0", honor: "50000", mulai: DEPAN_A }),
    );
    expect(r.ok).toBe(true);
  });

  it("menolak jenjang di_atas_20 dengan kalimat — bukan tarif rate card", async () => {
    const r = await tetapkanTarifTransport(
      formOf({ jenjang: "di_atas_20", tarif: "1000", honor: "1000", mulai: DEPAN_B }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pesan).toMatch(/per kasus/i);
  });

  it("menolak jenjang kosong & jenjang tak dikenal", async () => {
    for (const jenjang of ["", "999_km", "0-5"]) {
      const r = await tetapkanTarifTransport(
        formOf({ jenjang, tarif: "1000", honor: "1000", mulai: DEPAN_B }),
      );
      expect(r.ok, `jenjang="${jenjang}" seharusnya ditolak`).toBe(false);
    }
  });

  it("nominal kosong, negatif, dan bukan angka ditolak", async () => {
    for (const nilai of ["", "-1", "12.5", "abc"]) {
      const r = await tetapkanTarifTransport(
        formOf({ jenjang: "15_20", tarif: nilai, honor: "1000", mulai: DEPAN_B }),
      );
      expect(r.ok, `tarif="${nilai}" seharusnya ditolak`).toBe(false);
    }
  });

  it("tanggal tidak sah ditolak", async () => {
    for (const tgl of ["30-08-2026", "besok", "2026-02-31"]) {
      const r = await tetapkanTarifTransport(
        formOf({ jenjang: "15_20", tarif: "1000", honor: "1000", mulai: tgl }),
      );
      expect(r.ok, `mulai="${tgl}" seharusnya ditolak`).toBe(false);
    }
  });

  it("menyegarkan halaman transport, rekap, dan beranda owner", async () => {
    await tetapkanTarifTransport(
      formOf({ jenjang: "15_20", tarif: "1000", honor: "1000", mulai: DEPAN_B }),
    );
    for (const p of ["/owner/transport", "/owner/rekap", "/owner"]) {
      expect(jejak.revalidate, `lupa merevalidasi ${p}`).toContain(p);
    }
  });

  it("ADMIN yang login DITOLAK, tidak satu baris pun tersisip", async () => {
    const sebelum = await tarifJenjang("15_20");
    ref.sesi = sesiAdmin;
    await expect(
      tetapkanTarifTransport(
        formOf({ jenjang: "15_20", tarif: "1", honor: "1", mulai: geserHari(HARI_INI, 502) }),
      ),
    ).rejects.toThrow(/REDIRECT/);
    ref.sesi = sesiOwner;
    expect(await tarifJenjang("15_20")).toEqual(sebelum);
  });

  it("KLIEN yang login DITOLAK", async () => {
    ref.sesi = sesiKlien;
    await expect(
      tetapkanTarifTransport(
        formOf({ jenjang: "15_20", tarif: "1", honor: "1", mulai: geserHari(HARI_INI, 503) }),
      ),
    ).rejects.toThrow(/REDIRECT/);
    ref.sesi = sesiOwner;
  });

  it("admin ditolak RLS bahkan lewat REST langsung", async () => {
    const { error } = await sesiAdmin.from("transport_rates").insert({
      jenjang: "15_20",
      tarif_klien: 1,
      honor_mitra: 1,
      berlaku_sejak: geserHari(HARI_INI, 504),
    });
    expect(error?.code).toBe("42501");
  });
});

// ---------------------------------------------------------------------------
// ambilTarifTransport — subsidi TERHITUNG, tanpa jenjang di_atas_20
// ---------------------------------------------------------------------------

describe("ambilTarifTransport", () => {
  it("subsidi dihitung sebagai selisih, bukan dibaca dari kolom", async () => {
    const baris = (await ambilTarifTransport(HARI_INI)).find((b) => b.jenjang === "0_5")!;
    expect(baris, "jenjang 0_5 hilang dari rate card — fixture seed berubah?").toBeDefined();
    expect(baris.subsidi).toBe(baris.honorMitra - baris.tarifKlien);
    // Seed: 0-5 km klien Rp0, mitra Rp10.000 — subsidi PADMA murni.
    expect(baris.subsidi).toBe(10000);
  });

  it("jenjang di_atas_20 TIDAK PERNAH muncul di rate card", async () => {
    const jenjangMuncul = (await ambilTarifTransport(HARI_INI)).map((b) => b.jenjang);
    expect(jenjangMuncul).not.toContain("di_atas_20");
  });

  it("dibaca pada tanggal MASA DEPAN, tarif yang baru ditetapkan pun muncul", async () => {
    const jauh = await ambilTarifTransport(DEPAN_A);
    const baris = jauh.find((b) => b.jenjang === "10_15");
    expect(baris?.berlakuSejak).toBe(DEPAN_A);
    expect(baris?.tarifKlien).toBe(25000);
    expect(baris?.honorMitra).toBe(18000);
  });

  it("dibaca lewat sesi pengguna: admin & klien tidak memperoleh satu nominal pun", async () => {
    for (const sesi of [sesiAdmin, sesiKlien]) {
      ref.sesi = sesi;
      expect(await ambilTarifTransport(HARI_INI)).toEqual([]);
    }
    ref.sesi = sesiOwner;
  });
});

// ---------------------------------------------------------------------------
// ambilSesiMenungguTarif — money firewall & saringan
// ---------------------------------------------------------------------------

describe("ambilSesiMenungguTarif", () => {
  it("sesi di_atas_20 tanpa tarif khusus muncul di daftar menunggu", async () => {
    const menunggu = await ambilSesiMenungguTarif();
    expect(menunggu.map((s) => s.id)).toContain(SESI.jauh);
  });

  it("sesi yang SUDAH punya transport_khusus tidak muncul lagi", async () => {
    const menunggu = await ambilSesiMenungguTarif();
    expect(menunggu.map((s) => s.id)).not.toContain(SESI.jauhSudah);
  });

  it("sesi BATAL tidak pernah muncul, walau berjenjang di_atas_20", async () => {
    const menunggu = await ambilSesiMenungguTarif();
    expect(menunggu.map((s) => s.id)).not.toContain(SESI.jauhBatal);
  });

  it("sesi berjenjang BIASA tidak ikut muncul", async () => {
    const menunggu = await ambilSesiMenungguTarif();
    expect(menunggu.map((s) => s.id)).not.toContain(SESI.biasa);
  });

  it("baris hasil TIDAK membawa satu pun kunci nominal — money firewall", async () => {
    const menunggu = await ambilSesiMenungguTarif();
    expect(menunggu.length).toBeGreaterThan(0);
    for (const s of menunggu) {
      expect(Object.keys(s).sort()).toEqual(["id", "namaKlien", "tanggal"]);
    }
  });

  it("error query TIDAK dibungkam — kegagalan tidak boleh terbaca sebagai 'tidak ada yang menunggu'", async () => {
    // Sebelumnya `const { data } = await ...; return (data ?? []).map(...)`
    // membuat kegagalan RLS/jaringan pulang sebagai array kosong — TIDAK BISA
    // dibedakan dari keadaan bersih, padahal keduanya menuntut respons yang
    // sama sekali berbeda dari owner/admin.
    const rusak = Promise.resolve({ data: null, error: { message: "koneksi database putus" } });
    const pembangun: Record<string, unknown> = {};
    pembangun.from = () => pembangun;
    pembangun.select = () => pembangun;
    pembangun.order = () => pembangun;
    pembangun.range = () => pembangun;
    pembangun.returns = () => rusak;

    ref.sesi = pembangun as unknown as SupabaseClient;
    await expect(ambilSesiMenungguTarif()).rejects.toThrow(/koneksi database putus/);
    ref.sesi = sesiOwner;
  });

  it("admin membaca daftar yang BENAR — sesi yang sudah ditetapkan TIDAK muncul (Ruling 12)", async () => {
    // Sebelum Ruling 12, fungsi ini membaca `sessions` lalu `transport_khusus`
    // sebagai DUA bacaan terpisah lewat TypeScript: bacaan kedua itu ditolak
    // RLS "transport_khusus: hanya owner" untuk admin, dan admin SALAH
    // menganggap SETIAP sesi di_atas_20 masih menunggu — termasuk yang sudah
    // ditetapkan. Sesudah Ruling 12, fungsi ini membaca VIEW
    // `sesi_menunggu_tarif_transport` yang melakukan anti-join-nya sendiri
    // dengan hak PEMILIK (`security_invoker = off`), jadi admin memperoleh
    // daftar yang BENAR tanpa pernah butuh hak baca `transport_khusus`.
    ref.sesi = sesiAdmin;
    const menunggu = await ambilSesiMenungguTarif();
    ref.sesi = sesiOwner;
    expect(menunggu.map((s) => s.id)).toContain(SESI.jauh);
    expect(menunggu.map((s) => s.id)).not.toContain(SESI.jauhSudah);
  });

  it("klien SELALU kosong — predikat peran hidup di VIEW (user_role()), bukan gerbang TypeScript", async () => {
    ref.sesi = sesiKlien;
    const menunggu = await ambilSesiMenungguTarif();
    ref.sesi = sesiOwner;
    expect(menunggu).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// hitungMenungguTarifTransport / hitungAntrean — saringan identik lewat SATU
// view SQL (Ruling 12) — TIDAK ADA lagi gerbang peran di TypeScript
// ---------------------------------------------------------------------------

describe("hitungMenungguTarifTransport", () => {
  it("owner: angkanya PERSIS panjang ambilSesiMenungguTarif() — saringan identik", async () => {
    ref.sesi = sesiOwner;
    const [angka, daftar] = await Promise.all([
      hitungMenungguTarifTransport(),
      ambilSesiMenungguTarif(),
    ]);
    expect(angka).toBe(daftar.length);
    expect(angka).toBeGreaterThan(0);
  });

  it("admin memperoleh angka yang SAMA dengan owner — bukan konstanta nol (Ruling 12)", async () => {
    // Draf pertama menggerbangi angka ini dengan pemeriksaan peran di
    // TypeScript (`profilSaatIni().role !== "owner"` -> 0), yang MEMINDAHKAN
    // masalah alih-alih menutupnya: admin selalu melihat nol, padahal admin
    // yang sehari-hari mengerjakan antrean klinik. Ruling 12 menutup akar
    // masalahnya di SQL (view `sesi_menunggu_tarif_transport`,
    // security_invoker = off), sehingga admin memperoleh ANGKA YANG BENAR.
    ref.sesi = sesiOwner;
    const angkaOwner = await hitungMenungguTarifTransport();
    ref.sesi = sesiAdmin;
    const angkaAdmin = await hitungMenungguTarifTransport();
    ref.sesi = sesiOwner;
    expect(angkaAdmin).toBe(angkaOwner);
    expect(angkaAdmin).toBeGreaterThan(0);
  });

  it("klien SELALU 0 — predikat peran hidup di VIEW, bukan gerbang TypeScript", async () => {
    ref.sesi = sesiKlien;
    const angka = await hitungMenungguTarifTransport();
    ref.sesi = sesiOwner;
    expect(angka).toBe(0);
  });

  it("hitungAntrean() memuat medan ini juga, dan sepakat dengan pemanggilan langsung", async () => {
    ref.sesi = sesiOwner;
    const [antrean, langsung] = await Promise.all([hitungAntrean(), hitungMenungguTarifTransport()]);
    expect(antrean.menungguTarifTransport).toBe(langsung);
    expect(antrean.menungguTarifTransport).toBeGreaterThan(0);
  });

  it("dipanggil dengan MEMANGGIL ambilSesiMenungguTarif(), bukan menulis ulang saringannya", () => {
    // Cek struktural: sumber lib/admin/antrean.ts wajib memanggil fungsi
    // owner/data.ts yang sama, bukan menyalin predikat "jenjang di_atas_20 +
    // belum punya transport_khusus" versi keduanya sendiri.
    expect(sumberAntrean).toContain("ambilSesiMenungguTarif");
    expect(sumberAntrean).not.toContain('.eq("jenjang"');
  });

  it("TIDAK ADA gerbang peran di TypeScript — batasnya hidup di SQL (Ruling 12)", () => {
    // Diperiksa lewat ketiadaan IMPOR-nya, bukan `not.toContain` polos atas
    // seluruh berkas: komentar JSDoc di atas SENGAJA menyebut nama fungsi itu
    // untuk menjelaskan pendekatan LAMA yang sudah ditinggalkan, dan
    // `not.toContain` naif akan ikut memerahkan penjelasan yang justru benar.
    expect(sumberAntrean).not.toMatch(/from\s+["']@\/lib\/auth\/sesi["']/);
    expect(sumberAntrean).not.toMatch(/role\s*!==\s*["']owner["']\s*\)\s*return\s*0/);
  });
});

// ---------------------------------------------------------------------------
// tetapkanTarifKhusus — nominal PER KASUS, hanya untuk sesi di_atas_20
// ---------------------------------------------------------------------------

describe("tetapkanTarifKhusus", () => {
  it("menetapkan tarif khusus untuk sesi di_atas_20 yang belum punya", async () => {
    const r = await tetapkanTarifKhusus(formOf({ sesi: SESI.jauh, tarif: "60000", honor: "45000" }));
    expect(r.ok).toBe(true);
    const { data } = await admin
      .from("transport_khusus")
      .select("tarif_klien, honor_mitra")
      .eq("session_id", SESI.jauh)
      .single();
    expect(data).toMatchObject({ tarif_klien: 60000, honor_mitra: 45000 });
    await admin.from("transport_khusus").delete().eq("session_id", SESI.jauh);
  });

  it("menolak sesi yang bukan di_atas_20, dengan kalimat", async () => {
    const r = await tetapkanTarifKhusus(formOf({ sesi: SESI.biasa, tarif: "1", honor: "1" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pesan).toMatch(/di atas 20/i);
    const { data } = await admin
      .from("transport_khusus")
      .select("session_id")
      .eq("session_id", SESI.biasa)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it("menolak sesi yang tidak ada", async () => {
    const r = await tetapkanTarifKhusus(
      formOf({ sesi: "00000000-0000-0000-0000-000000000000", tarif: "1", honor: "1" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pesan).toMatch(/tidak dikenal/i);
  });

  it("sesi kosong ditolak", async () => {
    const r = await tetapkanTarifKhusus(formOf({ sesi: "", tarif: "1", honor: "1" }));
    expect(r.ok).toBe(false);
  });

  it("menolak sesi yang SUDAH punya tarif khusus, dengan kalimat — bukan menimpa", async () => {
    const r = await tetapkanTarifKhusus(formOf({ sesi: SESI.jauhSudah, tarif: "1", honor: "1" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pesan).toMatch(/sudah/i);
    const { data } = await admin
      .from("transport_khusus")
      .select("tarif_klien")
      .eq("session_id", SESI.jauhSudah)
      .single();
    expect(data!.tarif_klien).toBe(50000); // baris fixture asli, tidak berubah
  });

  it("nominal kosong/negatif/bukan angka ditolak", async () => {
    for (const nilai of ["", "-1", "abc"]) {
      const r = await tetapkanTarifKhusus(formOf({ sesi: SESI.jauh, tarif: nilai, honor: "1000" }));
      expect(r.ok, `tarif="${nilai}" seharusnya ditolak`).toBe(false);
    }
  });

  it("ADMIN yang login DITOLAK", async () => {
    ref.sesi = sesiAdmin;
    await expect(
      tetapkanTarifKhusus(formOf({ sesi: SESI.jauh, tarif: "1", honor: "1" })),
    ).rejects.toThrow(/REDIRECT/);
    ref.sesi = sesiOwner;
  });

  it("KLIEN yang login DITOLAK", async () => {
    ref.sesi = sesiKlien;
    await expect(
      tetapkanTarifKhusus(formOf({ sesi: SESI.jauh, tarif: "1", honor: "1" })),
    ).rejects.toThrow(/REDIRECT/);
    ref.sesi = sesiOwner;
  });

  it("identitas penetap DIREBUT dari payload (trigger) — dibuktikan lewat action sungguhan", async () => {
    const r = await tetapkanTarifKhusus(formOf({ sesi: SESI.jauh, tarif: "70000", honor: "50000" }));
    expect(r.ok).toBe(true);

    const { data: pengguna } = await admin.auth.admin.listUsers();
    const uidOwner = pengguna.users.find((u) => u.email === "owner@padma.test")!.id;
    const { data } = await admin
      .from("transport_khusus")
      .select("ditetapkan_oleh")
      .eq("session_id", SESI.jauh)
      .single();
    expect(data!.ditetapkan_oleh).toBe(uidOwner);

    await admin.from("transport_khusus").delete().eq("session_id", SESI.jauh);
  });

  it("insert transport_khusus TIDAK PERNAH mengirim ditetapkan_oleh/ditetapkan_pada — trigger yang merebutnya", () => {
    // Diperiksa pada BLOK INSERT itu sendiri, bukan pada seluruh sumber
    // berkas: komentar di atasnya SENGAJA menyebut kedua nama kolom itu untuk
    // menjelaskan kenapa keduanya tidak dikirim — `not.toContain` polos atas
    // seluruh berkas akan memerahkan penjelasan yang justru benar.
    const blokInsert = sumberAksi.match(
      /\.from\("transport_khusus"\)\s*\.insert\(\{([\s\S]*?)\}\)/,
    );
    expect(blokInsert, "blok insert transport_khusus tidak ditemukan").not.toBeNull();
    expect(blokInsert![1]).not.toContain("ditetapkan_oleh");
    expect(blokInsert![1]).not.toContain("ditetapkan_pada");
  });
});

// ---------------------------------------------------------------------------
// pesanKodePostgresKhusus — TERPISAH dari pesanKodePostgres milik rate card
// ---------------------------------------------------------------------------

describe("pesanKodePostgresKhusus — kalimat tersendiri, bukan pinjaman rate card", () => {
  it("42501 TIDAK diterjemahkan sebagai kalimat 'berlaku setelah tarif terakhir' milik rate card", () => {
    // transport_khusus tidak punya kolom berlaku_sejak sama sekali — kalimat
    // itu tidak bermakna apa pun untuk tarif PER SESI ini.
    expect(pesanKodePostgresKhusus("42501")).not.toMatch(/berlaku setelah tarif terakhir/i);
    // Kontrol positif: fungsi rate card-nya SENDIRI memang masih memakai
    // kalimat itu untuk 42501 — pemisahannya bukan menghapus perilaku lama,
    // hanya memastikan ia tidak lagi dipinjam untuk konteks yang salah.
    expect(pesanKodePostgres("42501")).toMatch(/berlaku setelah tarif terakhir/i);
  });

  it("23505 tetap diterjemahkan sebagai 'sudah ditetapkan', bukan 'tarif kembar' rate card", () => {
    expect(pesanKodePostgresKhusus("23505")).toMatch(/sudah punya tarif khusus/i);
    expect(pesanKodePostgres("23505")).toMatch(/sudah ada tarif/i);
  });
});

// ---------------------------------------------------------------------------
// Halaman /owner/transport
// ---------------------------------------------------------------------------
describe("halaman transport (/owner/transport)", () => {
  const halaman = (sp: Record<string, string> = {}) => {
    ref.sesi = sesiOwner;
    return TransportPage({ searchParams: Promise.resolve(sp) });
  };

  it("menampilkan label jenjang, nominal, dan daftar sesi menunggu", async () => {
    const markup = renderToStaticMarkup(await halaman());
    expect(markup).toContain("0–5 km");
    expect(markup).toContain("Rp 10.000");
    expect(markup).not.toContain(">20 km</b>"); // di_atas_20 bukan baris rate card
    expect(markup).toContain("Uji Transport Owner"); // SESI.jauh menunggu
  });

  it("TIDAK ada formulir di dalam sel tabel — hanya tautan pembuka panel", async () => {
    const markup = renderToStaticMarkup(await halaman());
    // Inilah keluhan klien yang ditutup rencana ini. Medan formulir hanya
    // boleh muncul saat panelnya memang diminta lewat URL.
    expect(markup).not.toContain('name="tarif"');
    expect(markup).toContain('href="/owner/transport?ubah=0_5"');
  });

  it("?ubah=<jenjang> membuka panel geser berisi formulir jenjang itu", async () => {
    const markup = renderToStaticMarkup(await halaman({ ubah: "0_5" }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('name="jenjang"');
    expect(markup).toContain('name="tarif"');
    expect(markup).toContain('name="mulai"');
    // Panel tertutup kembali ke halaman TANPA `?ubah`.
    expect(markup).toContain('href="/owner/transport"');
  });

  it("?ubah=sesi-<id> membuka panel geser berisi formulir tarif khusus", async () => {
    const markup = renderToStaticMarkup(await halaman({ ubah: `sesi-${SESI.jauh}` }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('name="sesi"');
    expect(markup).toContain("Uji Transport Owner");
  });

  it("?ubah asing TIDAK membuka panel apa pun", async () => {
    // Daftar putih, bukan daftar hitam: `ubah` datang dari URL, dan panel yang
    // terbuka atas nilai asing akan merender formulir yang menunjuk jenjang
    // atau sesi yang tidak ada.
    for (const nilai of ["di_atas_20", "sesi-00000000-0000-0000-0000-000000000000", "../admin"]) {
      const markup = renderToStaticMarkup(await halaman({ ubah: nilai }));
      expect(markup, `?ubah=${nilai}`).not.toContain('role="dialog"');
    }
  });

  it("daftar sesi menunggu tarif dipaginasi", async () => {
    const markup = renderToStaticMarkup(await halaman());
    expect(sumberHalaman).toContain("Paginasi");
    expect(markup).toMatch(/Menampilkan \d+ dari \d+/);
  });

  it("tidak ada satu pun token palet lama tersisa di kedua berkas", () => {
    for (const sumber of [sumberHalaman, sumberForm]) {
      expect(sumber).not.toMatch(/\b(?:text|bg|border|hover:text|hover:bg)-(?:night|paper|gold-pale)\b/);
      expect(sumber).not.toContain("bg-white");
      expect(sumber).not.toContain("font-serif");
    }
  });

  it("judul mengandalkan template `%s · PADMA`", () => {
    expect(sumberHalaman).toMatch(/metadata\s*=\s*\{\s*title:\s*"[^"]+"\s*\}/);
    expect(sumberHalaman).not.toMatch(/title:\s*"[^"]*PADMA/);
  });

  it("halaman menjaga perannya sendiri dengan requireRole(['owner'])", () => {
    expect(sumberHalaman).toMatch(/await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/);
    expect(sumberHalaman).not.toContain('"admin"');
  });

  it("navigasi owner menautkan modul ini", () => {
    expect(baca("src/app/owner/_shell/nav-owner.tsx")).toContain('href: "/owner/transport"');
  });

  it("TIDAK ada tombol/label Hapus — DELETE memang sudah dicabut", () => {
    for (const sumber of [sumberHalaman, sumberForm]) {
      expect(sumber).not.toMatch(/>\s*Hapus/);
    }
  });

  // Temuan I1 (review menyeluruh cabang panel-owner): Tugas 7 membuang state
  // `terbuka` yang dulu jadi sinyal sukses `FormTarifTransport` (formulir
  // mengatup jadi tombol). Panel geser sekarang TETAP terbuka sesudah simpan,
  // dan sampai temuan ini ditutup cabang suksesnya cuma `setPesan(null)` —
  // owner menekan "Simpan tarif" dan tidak ada satu kata pun di layar yang
  // bilang tarifnya tersimpan. `renderToStaticMarkup` selalu memakai state
  // AWAL (`useState` belum pernah `set`), jadi pemeriksaan ini tidak bisa
  // memicu suksesnya lewat render — ia memeriksa BENTUK sumbernya, sama
  // seperti pemeriksaan struktur lain di describe ini.
  it("FormTarifTransport punya sinyal sukses, dan tidak dirender sebelum ada yang tersimpan", async () => {
    expect(sumberForm).toMatch(/\[sukses,\s*setSukses\]\s*=\s*useState/);
    expect(sumberForm).toMatch(/setSukses\(true\)/);
    // Teks suksesnya harus menyebut kenyataan INSERT-only: baris baru
    // bertanggal berlaku, bukan penimpaan tarif lama.
    expect(sumberForm).toMatch(/sukses\s*&&[\s\S]{0,200}tersimpan sebagai baris baru/);
    // `renderToStaticMarkup` dari halaman biasa (belum ada aksi yang
    // dijalankan) tidak boleh pernah memuat teks itu — sinyal sukses harus
    // lahir dari `sukses === true`, bukan tampil bawaan.
    const markupBelumSimpan = renderToStaticMarkup(await halaman({ ubah: "0_5" }));
    expect(markupBelumSimpan).not.toContain("tersimpan sebagai baris baru");
  });
});

// ---------------------------------------------------------------------------
// Bentuk berkas server action
// ---------------------------------------------------------------------------

describe("berkas server action transport", () => {
  it('diawali "use server"', () => {
    expect(sumberAksi.trimStart().startsWith('"use server"')).toBe(true);
  });

  it("hanya mengekspor fungsi async (syarat Next)", () => {
    const ekspor = [...sumberAksi.matchAll(/^export\s+(?!type\b)(\w+)/gm)].map((m) => m[1]);
    expect(ekspor.length).toBeGreaterThan(0);
    expect([...new Set(ekspor)]).toEqual(["async"]);
  });

  it("SETIAP action memanggil requireRole(['owner']) — BUKAN admin+owner", () => {
    const jumlahAction = [
      ...sumberAksi.matchAll(/^export\s+async\s+function\s+\w+/gm),
    ].length;
    const jumlahGuard = [
      ...sumberAksi.matchAll(/await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/g),
    ].length;
    expect(jumlahAction).toBeGreaterThan(0);
    expect(jumlahGuard).toBe(jumlahAction);
    expect(sumberAksi).not.toContain('"admin"');
  });

  it("penjaga peran adalah baris PERTAMA setiap action", () => {
    const badan = [
      ...sumberAksi.matchAll(/export\s+async\s+function\s+\w+\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g),
    ];
    expect(badan.length).toBeGreaterThan(0);
    for (const m of badan) {
      const pernyataanPertama = m[1]
        .split("\n")
        .map((b) => b.trim())
        .filter((b) => b.length > 0 && !b.startsWith("//") && !b.startsWith("*") && !b.startsWith("/*"))[0];
      expect(pernyataanPertama).toMatch(/^await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/);
    }
  });

  it("memeriksa panjang hasil .select() — 200 + [] bukan keberhasilan", () => {
    expect(sumberAksi).toMatch(/\.length\s*===\s*0/);
  });

  it("memakai sesi pengguna, bukan service role", () => {
    for (const sumber of [...SEMUA_SUMBER, sumberData, sumberAntrean]) {
      expect(sumber).not.toContain("createAdminSupabase");
      expect(sumber).not.toContain("SERVICE_ROLE");
    }
    expect(sumberAksi).toContain("createServerSupabase");
  });

  it("tidak ada satu pun .delete() di seluruh berkas modul", () => {
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toContain(".delete(");
    }
  });

  it("tidak ada .update() ke transport_rates/transport_khusus — modul ini INSERT-only", () => {
    expect(sumberAksi).not.toContain(".update(");
  });

  it("daftar putih & label tinggal di status.ts, bukan di berkas action", () => {
    expect(sumberStatus).not.toContain('"use server"');
    expect(sumberAksi).toMatch(/from\s+["']\.\/status["']/);
  });

  it("layout owner TIDAK ikut berubah (matriks peran tetap satu panggilan)", () => {
    const layout = baca("src/app/owner/layout.tsx");
    expect([...layout.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(layout).toMatch(/await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/);
  });
});
