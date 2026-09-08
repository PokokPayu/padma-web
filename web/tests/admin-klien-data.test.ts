/**
 * Lapisan data daftar klien (`ambilDaftarKlien`) — dipisah dari
 * `admin-klien.test.ts` yang menguji halaman & server action, supaya
 * saringan dan paginasi bisa diuji tanpa merender markup.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { jumlahHalaman } from "@/app/_shell/panel/daftar";
import { signInAs } from "./helpers/as-user";
import { nominalDalam } from "./helpers/nominal";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ref.sesi! }));

const { ambilDaftarKlien } = await import("@/lib/admin/klien");
const admin = createAdminSupabase();

// Klien seed lain (`scripts/seed-users.ts`) — dipakai sebagai bukti EKSKLUSI
// pada uji pencarian: nama & PADMA ID-nya tidak mengandung "ananda", jadi ia
// tidak boleh pernah muncul di hasil cari "ananda". Lihat Fix Round 1 Temuan
// 2: tanpa baris negatif ini, uji hanya membuktikan INKLUSI — dan `cari`
// yang diabaikan sama sekali (mengembalikan SEMUA klien) tetap lolos, karena
// baris positifnya kebetulan ikut dalam himpunan "semua klien".
const RINA = "44444444-4444-4444-4444-444444444402";

beforeAll(async () => { ref.sesi = await signInAs("admin@padma.test"); });

describe("ambilDaftarKlien", () => {
  it("mencari menurut nama DAN PADMA ID", async () => {
    // PADMA ID adalah yang dibacakan klien lewat telepon; nama adalah yang
    // diingat admin. Keduanya harus menemukan baris yang sama.
    const lewatNama = await ambilDaftarKlien({ cari: "ananda", saring: {}, hal: 1 });
    expect(lewatNama.baris.length).toBeGreaterThan(0);
    const target = lewatNama.baris[0];
    // EKSKLUSI: Rina tidak cocok "ananda" sama sekali — bila `cari` diam-diam
    // diabaikan (SEMUA klien dikembalikan), baris ini yang merah.
    expect(lewatNama.baris.map((k) => k.id)).not.toContain(RINA);

    const lewatId = await ambilDaftarKlien({ cari: target.padmaId, saring: {}, hal: 1 });
    expect(lewatId.baris.map((k) => k.id)).toContain(target.id);
    // EKSKLUSI yang sama pada jalur PADMA ID: PADMA ID Ananda tidak cocok
    // PADMA ID Rina, jadi Rina tidak boleh ikut terjaring.
    expect(lewatId.baris.map((k) => k.id)).not.toContain(RINA);
  });

  it("menyaring klien yang BELUM aktivasi", async () => {
    const { baris } = await ambilDaftarKlien({ cari: "", saring: { aktivasi: "belum" }, hal: 1 });
    expect(baris.every((k) => !k.aktif)).toBe(true);
  });

  it("total tidak ikut terpotong halaman", async () => {
    const { baris, total } = await ambilDaftarKlien({ cari: "", saring: {}, hal: 1 });
    expect(total).toBeGreaterThanOrEqual(baris.length);
  });

});

// GERBANG SAKLAR (K11, Task 2): `ambilDaftarKlien()` memaksa `paketAktif`
// menjadi `null` untuk SETIAP baris begitu `PAKET_TAMPIL` mati (gerbangnya
// sendiri diuji tests/paket-tersembunyi.test.tsx). Kedua uji di bawah bukan
// tentang tampilan — mereka menjaga properti KUERI (`.eq("status", "aktif")`
// di klien.ts) yang tidak punya penjaga lain di repo ini begitu `paketAktif`
// selalu null: badan `for`/asersi Rp-nya akan berjalan atas himpunan kosong
// tanpa saklar dinyalakan sementara, hijau tanpa membuktikan apa pun. Pola
// sama dengan tests/klaim-sesi-lepas.test.ts (describe "badge antrean —
// paket klien").
describe("ambilDaftarKlien — data paket (saklar K11 dinyalakan sementara)", () => {
  let ambilDaftarKlienSementara: typeof ambilDaftarKlien;

  beforeAll(async () => {
    vi.doMock("@/lib/paket-tampil", () => ({ PAKET_TAMPIL: true }));
    vi.resetModules();
    ({ ambilDaftarKlien: ambilDaftarKlienSementara } = await import("@/lib/admin/klien"));
  });

  afterAll(() => {
    vi.doUnmock("@/lib/paket-tampil");
    vi.resetModules();
  });

  it("hanya paket BERSTATUS AKTIF yang menjadi identitas baris", async () => {
    // Paket lama tidak menggantikan gambaran "sedang menjalani apa".
    const { baris } = await ambilDaftarKlienSementara({ cari: "", saring: {}, hal: 1 });
    for (const k of baris.filter((b) => b.paketAktif !== null)) {
      const { data } = await admin
        .from("client_packages")
        .select("status")
        .eq("client_id", k.id)
        .eq("status", "aktif");
      expect((data ?? []).length).toBeGreaterThan(0);
    }
  });

  it("TIDAK memulangkan satu pun nominal rupiah", async () => {
    // Money firewall: /admin tidak melihat angka uang. Paket dipulangkan
    // sebagai NAMA, bukan harganya. Mengunci pada EJAAN kata seperti
    // "harga"/"nominal"/"honor" gagal dua arah: sebuah paket bernama "Paket
    // Harga Hemat" akan memerahkan uji ini tanpa satu rupiah pun bocor, dan
    // `paketAktif` yang diperkaya jadi "Sankalpa Prima · 3.500.000" akan
    // lolos hijau karena tidak satu kata terlarang pun disebut. Menguji pola
    // ANGKA RUPIAH (samakan dengan `admin-klien-halaman.test.tsx`) menjaga
    // NILAI yang dilarang, bukan ejaan namanya.
    //
    // Dua sisi digabung saat merge: PENEMPATAN dari cabang saklar (dipanggil
    // lewat `ambilDaftarKlienSementara`, yaitu dengan saklar K11 dinyalakan
    // sementara — tanpa itu `paketAktif` selalu null dan uji ini hijau atas
    // himpunan kosong, tidak membuktikan apa pun), dan ASERSI dari sapuan
    // panel (`nominalDalam`, yang menangkap pola angka rupiah lebih luas
    // daripada `/Rp\s?\d/` — mis. "3.500.000" tanpa awalan "Rp").
    const { baris } = await ambilDaftarKlienSementara({ cari: "", saring: {}, hal: 1 });
    expect(nominalDalam(JSON.stringify(baris)), "nominal bocor").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fix Round 1, Temuan 1: cabang `saring.paket === "ada"` TIDAK teruji sama
// sekali di draf awal. Membalik kondisinya menjadi `!== "ada"` — klien TANPA
// paket yang justru tampil saat saringan "punya paket" dinyalakan — akan
// lolos hijau tanpa fixture di bawah ini. Hooks DILINGKUPI ke describe ini
// (bukan puncak berkas) supaya fixturenya tidak ikut menyentuh uji lain.
// ---------------------------------------------------------------------------

const KLIEN_PAKET_UJI = "44444444-4444-4444-4444-4444444444d1";
const KLIEN_KOSONG_UJI = "44444444-4444-4444-4444-4444444444d2";
// "Sankalpa Prima" — satu-satunya paket seed (`supabase/seed.sql`).
const PAKET_SEED = "22222222-2222-2222-2222-222222222201";

describe("ambilDaftarKlien — saring.paket = 'ada' (dua arah)", () => {
  beforeAll(async () => {
    // Jaga-jaga sisa run yang terhenti di tengah jalan sebelum insert.
    await admin.from("clients").delete().in("id", [KLIEN_PAKET_UJI, KLIEN_KOSONG_UJI]);
    await admin.from("clients").insert([
      {
        id: KLIEN_PAKET_UJI,
        padma_id: "ZZ-UJI-DATA-PAKET",
        nama: "ZZ Uji Data Berpaket",
        email: "zz-uji-data-paket@padma.test",
        phase_id: "prekonsepsi",
      },
      {
        id: KLIEN_KOSONG_UJI,
        padma_id: "ZZ-UJI-DATA-KOSONG",
        nama: "ZZ Uji Data Tanpa Paket",
        email: "zz-uji-data-kosong@padma.test",
        phase_id: "prekonsepsi",
      },
    ]);
    // Hanya KLIEN_PAKET_UJI yang mendapat baris `client_packages`;
    // KLIEN_KOSONG_UJI sengaja dibiarkan tanpa satu pun.
    await admin.from("client_packages").insert({
      client_id: KLIEN_PAKET_UJI,
      package_id: PAKET_SEED,
      status: "aktif",
    });
  });

  afterAll(async () => {
    // Sesi & client_packages ikut tersapu lewat cascade `clients` (service
    // role, tidak terikat pencabutan DELETE milik `authenticated`).
    await admin.from("clients").delete().in("id", [KLIEN_PAKET_UJI, KLIEN_KOSONG_UJI]);
  });

  it("baseline: keduanya muncul TANPA saring.paket (fixture benar-benar ada)", async () => {
    // Tanpa baris ini, fixture yang gagal lahir tidak akan pernah kelihatan —
    // dua `expect` di uji dua-arah di bawah bisa lolos hampa bila keduanya
    // sama-sama tidak ada.
    const { baris } = await ambilDaftarKlien({ cari: "ZZ Uji Data", saring: {}, hal: 1 });
    const id = baris.map((k) => k.id);
    expect(id).toContain(KLIEN_PAKET_UJI);
    expect(id).toContain(KLIEN_KOSONG_UJI);
  });

  it("saring.paket = 'ada': klien BERPAKET AKTIF ikut, klien TANPA paket TIDAK", async () => {
    // Dua arah dalam SATU uji, sengaja: kondisi yang terbalik
    // (`!== "ada"` alih-alih `=== "ada"`) memulangkan HIMPUNAN YANG PERSIS
    // TERBALIK — KLIEN_KOSONG_UJI muncul dan KLIEN_PAKET_UJI hilang. Menguji
    // satu arah saja tidak membedakan saringan yang bekerja dari saringan
    // yang terbalik atau yang mati total.
    const { baris } = await ambilDaftarKlien({
      cari: "ZZ Uji Data",
      saring: { paket: "ada" },
      hal: 1,
    });
    const id = baris.map((k) => k.id);
    expect(id).toContain(KLIEN_PAKET_UJI);
    expect(id).not.toContain(KLIEN_KOSONG_UJI);
  });

  // -------------------------------------------------------------------------
  // Fix Round 2, Temuan 1: saringan "punya paket" dikerjakan di JS SESUDAH
  // paginasi (lihat komentar `ambilDaftarKlien`), jadi ia menyaring HALAMAN,
  // bukan seluruh daftar. Sebelum perbaikan ini, `total` tetap dipulangkan
  // dari `count` mentah — jumlah SELURUH klien SEBELUM saringan paket
  // diterapkan — sehingga `BilahDaftar` menulis total yang tidak pernah bisa
  // dilihat dan `Paginasi` menawarkan halaman berikutnya yang bisa tampil
  // kosong tanpa penjelasan. Uji ini memerah pada regresi PERSIS itu: `total`
  // harus konsisten dengan `baris` yang SUNGGUHAN dipulangkan saat saringan
  // menyala, bukan dengan jumlah klien sebelum saringan.
  // -------------------------------------------------------------------------
  it("saring.paket = 'ada': total TIDAK BOHONG — ia mengikuti baris yang benar-benar tersaring", async () => {
    const disaring = await ambilDaftarKlien({ cari: "", saring: { paket: "ada" }, hal: 1 });
    const takDisaring = await ambilDaftarKlien({ cari: "", saring: {}, hal: 1 });

    // Fixture berkas ini menjamin setidaknya ada klien TANPA paket
    // (KLIEN_KOSONG_UJI) yang ikut di himpunan tak tersaring tapi bukan di
    // himpunan tersaring — jadi dua himpunan ini benar-benar berbeda ukuran,
    // dan `total` yang jujur WAJIB ikut berbeda, bukan kebetulan sama.
    expect(disaring.baris.length).toBeLessThan(takDisaring.baris.length);

    // Jaminan inti: `total` tidak boleh melebihi apa yang benar-benar bisa
    // ditampilkan pemanggil pada halaman ini. `total` mentah dari `count`
    // (jumlah SEMUA klien sebelum saringan) akan lolos syarat
    // "total >= baris.length" tapi tetap BOHONG — maka baris di bawah ini
    // menuntut KESETARAAN, bukan sekadar batas bawah: satu-satunya angka
    // jujur yang bisa dipulangkan tanpa menghitung ulang seluruh daftar
    // berpaket di database adalah jumlah baris pada halaman ini sendiri.
    expect(disaring.total).toBe(disaring.baris.length);

    // Regresi konkret yang harus tertangkap: `total` warisan dari `count`
    // mentah akan sebesar himpunan TAK TERSARING — jelas berbeda di sini
    // karena KLIEN_KOSONG_UJI ikut serta di sana.
    expect(disaring.total).not.toBe(takDisaring.total);

    // Konsekuensi yang dituntut spek: paginasi tidak boleh menawarkan halaman
    // yang tidak ada. `total` yang jujur dan tidak melebihi `PER_HAL` di sini
    // harus selalu jatuh ke tepat 1 halaman.
    expect(jumlahHalaman(disaring.total)).toBe(1);
  });
});
