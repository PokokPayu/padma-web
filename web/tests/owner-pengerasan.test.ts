/**
 * PENGERASAN TABEL UANG — `service_rates` & `honor_marks` di LAPISAN BASIS DATA.
 *
 * Kenapa berkas ini ada, dan kenapa ia menembak PostgREST langsung alih-alih
 * memanggil server action:
 *
 * Seluruh doktrin uang PADMA — "rate card INSERT-only, tarif lama TIDAK PERNAH
 * diubah", "ditandai_oleh & dibayar_pada tidak pernah dari payload", "week_start
 * selalu Senin" — sampai hari ini hanya hidup di TypeScript
 * (`src/app/owner/tarif/aksi.ts`, `src/app/owner/rekap/aksi.ts`). Owner memegang
 * JWT peran SQL `authenticated` yang sama, dan REST `/rest/v1/...` selalu
 * terbuka baginya: memanggilnya langsung MELEWATI seluruh validator TypeScript
 * itu. Red team membuktikannya sebagai owner sungguhan (owner@padma.test, anon
 * key + JWT owner), bukan membacanya dari policy — semuanya HTTP 201/200:
 *
 *   POST   service_rates {berlaku_sejak:"2020-01-01", harga:999999}  -> 201
 *   POST   service_rates {harga_klien:-500000, honor_mitra:-250000}  -> 201
 *   POST   service_rates {harga_klien:100000, honor_mitra:900000}    -> 201
 *   POST   service_rates {(service_id,berlaku_sejak) kembar}         -> 201
 *   PATCH  service_rates?id=eq.<baris seed lama> {harga_klien:1}     -> 200
 *   PATCH  service_rates?honor_mitra=gt.0 {honor_mitra:7}            -> 204, 13 baris tertimpa
 *   POST   honor_marks   {week_start:"2026-08-26" (RABU)}            -> 201
 *   POST   honor_marks   {ditandai_oleh:<uid ADMIN>, dibayar_pada:"1999-01-01"} -> 201
 *   PATCH  honor_marks?id=eq.<tanda lama> {dibayar_pada:"1999-01-01"} -> 200
 *
 * Baseline saat itu: `pg_constraint` atas kedua tabel hanya PK, FK, dan
 * `unique (partner_id, week_start)` — NOL check, NOL trigger. 1298 test hijau
 * di atas tabel telanjang, karena tidak ada satu pun yang menjaganya.
 *
 * Dampaknya bukan kebocoran nominal (money firewall terbukti rapat, dijaga
 * `rls-firewall`, `rls-hardening`, dan `money-firewall-struktural`) melainkan
 * INTEGRITAS & JEJAK AUDIT uang:
 *   (a) menimpa baris tarif lama menggeser rekap pekan yang honornya SUDAH
 *       dibayarkan — melanggar spec bagian 5 secara langsung;
 *   (b) `ditandai_oleh` palsu membuat owner menandai honor ATAS NAMA ADMIN
 *       bertanggal 1999, dan karena DELETE `honor_marks` sudah (benar) dicabut,
 *       catatan otorisasi palsu itu PERMANEN — non-repudiation runtuh.
 *
 * Yang dijaga berkas ini adalah lapisan yang tidak bisa dilewati siapa pun yang
 * bicara ke basis data: CHECK, UNIQUE, dan trigger. Setiap `it` di bawah
 * memakai klien REST bersesi (`signInAs`), tidak satu pun memanggil server
 * action — kalau pagarnya hanya ada di TypeScript, berkas ini merah.
 *
 * Data uji berprefiks `PAD-UJI` dan dibersihkan `afterAll`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { querySql } from "./helpers/db";
import { anonClient, signInAs } from "./helpers/as-user";

const admin = createAdminSupabase(); // service role — jalur seed & pembersihan

const LAYANAN_KERAS = "11111111-1111-1111-1111-1111111119c1";
const LAYANAN_KEDUA = "11111111-1111-1111-1111-1111111119c2";
const MITRA_KERAS = "33333333-3333-3333-3333-3333333339c1";

const TARIF_DASAR = "99999999-9999-9999-9999-9999999999c1";

/** Senin, jauh di masa lalu — tarif acuan yang seluruh serangan coba geser. */
const BERLAKU_DASAR = "2026-01-05";
const HARGA_DASAR = 500_000;
const HONOR_DASAR = 200_000;

/** Senin yang sudah lewat: pekan yang sah untuk ditandai dibayar. */
const PEKAN_LEWAT = "2026-01-05";
const PEKAN_LEWAT_2 = "2026-01-12";
/** Rabu — tanda yatim yang tidak pernah cocok dengan bucket rekap mana pun. */
const RABU = "2026-01-07";

let sesiOwner: SupabaseClient;
let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;
let idOwner = "";
let idAdmin = "";

type BarisTarif = {
  id: string;
  service_id: string;
  harga_klien: number;
  honor_mitra: number;
  berlaku_sejak: string;
};

type BarisTanda = {
  id: string;
  partner_id: string;
  week_start: string;
  dibayar_pada: string;
  ditandai_oleh: string | null;
};

/** Seluruh tarif satu layanan, dibaca lewat SERVICE ROLE (bukan lewat RLS). */
async function tarifLayanan(serviceId: string): Promise<BarisTarif[]> {
  const { data } = await admin
    .from("service_rates")
    .select("id, service_id, harga_klien, honor_mitra, berlaku_sejak")
    .eq("service_id", serviceId)
    .order("berlaku_sejak")
    .returns<BarisTarif[]>();
  return data ?? [];
}

async function tandaMitra(partnerId: string): Promise<BarisTanda[]> {
  const { data } = await admin
    .from("honor_marks")
    .select("id, partner_id, week_start, dibayar_pada, ditandai_oleh")
    .eq("partner_id", partnerId)
    .order("week_start")
    .returns<BarisTanda[]>();
  return data ?? [];
}

async function bersihkan() {
  await admin.from("honor_marks").delete().eq("partner_id", MITRA_KERAS);
  for (const s of [LAYANAN_KERAS, LAYANAN_KEDUA]) {
    await admin.from("service_rates").delete().eq("service_id", s);
  }
  await admin.from("partners").delete().eq("id", MITRA_KERAS);
  for (const s of [LAYANAN_KERAS, LAYANAN_KEDUA]) {
    await admin.from("services").delete().eq("id", s);
  }
}

beforeAll(async () => {
  await bersihkan();
  sesiOwner = await signInAs("owner@padma.test");
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
  idOwner = (await sesiOwner.auth.getUser()).data.user!.id;
  idAdmin = (await sesiAdmin.auth.getUser()).data.user!.id;
  expect(idOwner).not.toBe(idAdmin);

  const { error: eLayanan } = await admin.from("services").insert([
    { id: LAYANAN_KERAS, phase_id: "prekonsepsi", nama: "PAD-UJI Keras Satu", aktif: true },
    { id: LAYANAN_KEDUA, phase_id: "kehamilan", nama: "PAD-UJI Keras Dua", aktif: true },
  ]);
  if (eLayanan) throw new Error(`fixture layanan gagal: ${eLayanan.message}`);

  const { error: eMitra } = await admin
    .from("partners")
    .insert({ id: MITRA_KERAS, nama: "PAD-UJI Bidan Keras", no_hp: "0811-0000-9301" });
  if (eMitra) throw new Error(`fixture mitra gagal: ${eMitra.message}`);
});

/**
 * Setiap `it` berangkat dari keadaan yang SAMA PERSIS: satu tarif acuan pada
 * `LAYANAN_KERAS`, nol tarif pada `LAYANAN_KEDUA`, nol tanda bayar. Test yang
 * serangannya BERHASIL (yaitu: test yang merah) karena itu tidak bisa
 * mencemari test sesudahnya dan menyamarkan kegagalannya sebagai kegagalan
 * lain — pola yang sudah dibayar mahal di suite ini.
 */
beforeEach(async () => {
  await admin.from("honor_marks").delete().eq("partner_id", MITRA_KERAS);
  for (const s of [LAYANAN_KERAS, LAYANAN_KEDUA]) {
    await admin.from("service_rates").delete().eq("service_id", s);
  }
  const { error } = await admin.from("service_rates").insert({
    id: TARIF_DASAR,
    service_id: LAYANAN_KERAS,
    harga_klien: HARGA_DASAR,
    honor_mitra: HONOR_DASAR,
    berlaku_sejak: BERLAKU_DASAR,
  });
  if (error) throw new Error(`fixture tarif gagal: ${error.message}`);
});

afterAll(async () => {
  await bersihkan();
});

// ---------------------------------------------------------------------------
// (1) NILAI TARIF — angka mustahil ditolak basis data, bukan hanya TypeScript
// ---------------------------------------------------------------------------
describe("service_rates: nilai wajar ditegakkan CHECK, bukan server action", () => {
  it("harga & honor NEGATIF ditolak 23514", async () => {
    // Red team: {harga_klien:-500000, honor_mitra:-250000} -> HTTP 201.
    const { error } = await sesiOwner.from("service_rates").insert({
      service_id: LAYANAN_KEDUA,
      harga_klien: -500_000,
      honor_mitra: -250_000,
      berlaku_sejak: "2030-01-07",
    });
    expect(error?.code).toBe("23514");
    expect(await tarifLayanan(LAYANAN_KEDUA)).toHaveLength(0);
  });

  it("harga negatif saja — dan honor negatif saja — sama-sama ditolak 23514", async () => {
    for (const nilai of [
      { harga_klien: -1, honor_mitra: 0 },
      { harga_klien: 100_000, honor_mitra: -1 },
    ]) {
      const { error } = await sesiOwner.from("service_rates").insert({
        service_id: LAYANAN_KEDUA,
        berlaku_sejak: "2030-01-07",
        ...nilai,
      });
      expect(error?.code, JSON.stringify(nilai)).toBe("23514");
    }
    expect(await tarifLayanan(LAYANAN_KEDUA)).toHaveLength(0);
  });

  it("honor MELEBIHI harga (margin negatif) ditolak 23514", async () => {
    // Red team: {harga_klien:1000, honor_mitra:999999} -> HTTP 201. Rekap
    // menampilkan margin negatif sebagai angka mustahil, tanpa peringatan.
    const { error } = await sesiOwner.from("service_rates").insert({
      service_id: LAYANAN_KEDUA,
      harga_klien: 1_000,
      honor_mitra: 999_999,
      berlaku_sejak: "2030-01-07",
    });
    expect(error?.code).toBe("23514");
    expect(await tarifLayanan(LAYANAN_KEDUA)).toHaveLength(0);
  });

  it("KONTROL: honor SAMA DENGAN harga (margin nol) tetap diterima", async () => {
    // Batas constraint harus `<=`, bukan `<`: layanan bermargin nol adalah
    // keputusan bisnis yang sah (mis. layanan sosial), bukan data rusak.
    const { data, error } = await sesiOwner
      .from("service_rates")
      .insert({
        service_id: LAYANAN_KEDUA,
        harga_klien: 300_000,
        honor_mitra: 300_000,
        berlaku_sejak: "2030-01-07",
      })
      .select("id");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  });

  it("KONTROL: harga & honor NOL diterima (layanan gratis bukan data rusak)", async () => {
    const { error } = await sesiOwner.from("service_rates").insert({
      service_id: LAYANAN_KEDUA,
      harga_klien: 0,
      honor_mitra: 0,
      berlaku_sejak: "2030-01-07",
    });
    expect(error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (2) TARIF KEMBAR — pemilihan "berlaku_sejak terbesar" harus deterministik
// ---------------------------------------------------------------------------
describe("service_rates: satu layanan tidak punya dua tarif pada tanggal sama", () => {
  it("SERVICE ROLE pun ditolak 23505 — inilah yang benar-benar diadili UNIQUE", async () => {
    // Jalur seed/pemulihan sengaja dilewatkan kedua trigger (lihat gerbang
    // `current_user`), jadi di sanalah index keunikan menjadi satu-satunya
    // pagar — dan justru di sanalah tarif kembar paling mungkin lahir tanpa
    // sadar: `supabase/seed.sql` dan fixture test menulis langsung.
    const { error: ePertama } = await admin.from("service_rates").insert({
      service_id: LAYANAN_KEDUA,
      harga_klien: 100_000,
      honor_mitra: 10_000,
      berlaku_sejak: "2030-02-04",
    });
    expect(ePertama).toBeNull();

    const { error } = await admin.from("service_rates").insert({
      service_id: LAYANAN_KEDUA,
      harga_klien: 200_000,
      honor_mitra: 20_000,
      berlaku_sejak: "2030-02-04",
    });
    expect(error?.code).toBe("23505");
    expect(await tarifLayanan(LAYANAN_KEDUA)).toHaveLength(1);
  });

  it("owner: dua baris kembar dalam SATU pernyataan pun tidak lahir", async () => {
    // Kodenya `42501`, bukan `23505`: trigger BEFORE INSERT berjalan PER BARIS,
    // jadi baris kedua sudah melihat baris pertama sebagai "tarif terakhir"
    // sebelum index keunikan sempat diperiksa. Kelasnya tetap tertutup — dan
    // keduanya dibuktikan, bukan salah satunya.
    const { error } = await sesiOwner.from("service_rates").insert([
      {
        service_id: LAYANAN_KEDUA,
        harga_klien: 100_000,
        honor_mitra: 10_000,
        berlaku_sejak: "2030-02-04",
      },
      {
        service_id: LAYANAN_KEDUA,
        harga_klien: 200_000,
        honor_mitra: 20_000,
        berlaku_sejak: "2030-02-04",
      },
    ]);
    expect(error?.code).toBe("42501");
    expect(await tarifLayanan(LAYANAN_KEDUA)).toHaveLength(0);
  });

  it("tarif kembar dengan baris yang SUDAH ADA ditolak (tanggalnya tidak maju)", async () => {
    // Red team: (service_id, berlaku_sejak) kembar dengan baris seed -> 201.
    // Kodenya `42501` dan BUKAN `23505` — dan itu bukan kelonggaran: trigger
    // BEFORE INSERT berjalan SEBELUM index keunikan diperiksa, dan tanggal yang
    // kembar menurut definisinya tidak lebih maju dari tarif terakhir. Dua
    // pagar berbeda menutup pintu yang sama; yang penting barisnya tidak lahir.
    const { error } = await sesiOwner.from("service_rates").insert({
      service_id: LAYANAN_KERAS,
      harga_klien: 999_999,
      honor_mitra: 1,
      berlaku_sejak: BERLAKU_DASAR,
    });
    expect(error?.code).toBe("42501");
    expect(await tarifLayanan(LAYANAN_KERAS)).toHaveLength(1);
  });

  it("STRUKTURAL: index keunikan (service_id, berlaku_sejak) memang terpasang", async () => {
    // Perilaku di atas dijawab trigger, jadi keberadaan UNIQUE-nya sendiri
    // harus dibuktikan di katalog — kalau tidak, mencabut trigger diam-diam
    // membuka kembali tarif kembar tanpa satu pun test merah.
    const baris = await querySql<{ conname: string }>(`
      select conname from pg_constraint
       where conrelid = 'public.service_rates'::regclass and contype = 'u'
       order by conname`);
    expect(baris.map((b) => b.conname)).toContain("service_rates_unik_per_tanggal");
  });
});

// ---------------------------------------------------------------------------
// (3) TARIF RETROAKTIF — sama persis dengan menimpa baris lama
// ---------------------------------------------------------------------------
describe("service_rates: tarif hanya boleh berlaku MAJU", () => {
  it("berlaku_sejak retroaktif ditolak 42501", async () => {
    // Red team: berlaku_sejak 2019-05-05 & 2020-01-01 -> HTTP 201, dan rekap
    // pekan yang honornya sudah ditandai dibayar ikut bergeser (honor 100.000
    // -> 999.000, margin 150.000 -> -699.000). Spec bagian 5 melarangnya.
    for (const mundur of ["2019-05-05", "2020-01-01", "2026-01-04"]) {
      const { error } = await sesiOwner.from("service_rates").insert({
        service_id: LAYANAN_KERAS,
        harga_klien: 1,
        honor_mitra: 1,
        berlaku_sejak: mundur,
      });
      expect(error?.code, `berlaku_sejak=${mundur}`).toBe("42501");
    }
    expect(await tarifLayanan(LAYANAN_KERAS)).toHaveLength(1);
  });

  it("KONTROL: tanggal MAJU tetap diterima — alur sah tidak ikut mati", async () => {
    const { data, error } = await sesiOwner
      .from("service_rates")
      .insert({
        service_id: LAYANAN_KERAS,
        harga_klien: 600_000,
        honor_mitra: 250_000,
        berlaku_sejak: "2026-01-06",
      })
      .select("id");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
    expect(await tarifLayanan(LAYANAN_KERAS)).toHaveLength(2);
  });

  it("KONTROL: tarif PERTAMA sebuah layanan boleh bertanggal kapan pun", async () => {
    // Tidak ada riwayat yang bisa digeser bila belum ada satu baris pun.
    const { error } = await sesiOwner.from("service_rates").insert({
      service_id: LAYANAN_KEDUA,
      harga_klien: 100_000,
      honor_mitra: 40_000,
      berlaku_sejak: "2001-01-01",
    });
    expect(error).toBeNull();
  });

  it("KONTROL: service role TETAP bebas — seed & pembersihan test hidup di sana", async () => {
    // Gerbang `current_user in (anon, authenticated, authenticator)` bukan
    // hiasan: tanpa itu `supabase/seed.sql`, `scripts/seed-users.ts`, dan
    // seluruh `beforeAll`/`afterAll` suite ini mati.
    const { error } = await admin.from("service_rates").insert({
      service_id: LAYANAN_KERAS,
      harga_klien: 123_000,
      honor_mitra: 45_000,
      berlaku_sejak: "2000-01-03",
    });
    expect(error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (4) BARIS TARIF LAMA TIDAK BISA DITULIS ULANG DI TEMPAT
// ---------------------------------------------------------------------------
describe("service_rates: INSERT-only ditegakkan basis data, bukan hanya doktrin", () => {
  it("owner mem-PATCH harga & honor baris lama ditolak 42501, nilainya utuh", async () => {
    // Red team temuan A5: PATCH service_rates?id=eq.<seed> {harga:1,honor:1}
    // -> HTTP 200. Rekap pekan lama bergeser TANPA satu pun insert, jadi
    // trigger tarif-maju yang hanya menjaga TANGGAL tidak menutupnya.
    for (const tambalan of [
      { harga_klien: 1 },
      { honor_mitra: 7 },
      { harga_klien: 1, honor_mitra: 1 },
    ]) {
      const { error } = await sesiOwner
        .from("service_rates")
        .update(tambalan)
        .eq("id", TARIF_DASAR)
        .select("id");
      expect(error?.code, JSON.stringify(tambalan)).toBe("42501");
    }

    const [baris] = await tarifLayanan(LAYANAN_KERAS);
    expect(baris.harga_klien).toBe(HARGA_DASAR);
    expect(baris.honor_mitra).toBe(HONOR_DASAR);
  });

  it("owner memundurkan berlaku_sejak baris lama ditolak 42501", async () => {
    const { error } = await sesiOwner
      .from("service_rates")
      .update({ berlaku_sejak: "2019-05-05" })
      .eq("id", TARIF_DASAR)
      .select("id");
    expect(error?.code).toBe("42501");
    expect((await tarifLayanan(LAYANAN_KERAS))[0].berlaku_sejak).toBe(BERLAKU_DASAR);
  });

  it("owner memindahkan tarif ke layanan lain ditolak 42501", async () => {
    const { error } = await sesiOwner
      .from("service_rates")
      .update({ service_id: LAYANAN_KEDUA })
      .eq("id", TARIF_DASAR)
      .select("id");
    expect(error?.code).toBe("42501");
    expect(await tarifLayanan(LAYANAN_KEDUA)).toHaveLength(0);
  });

  it("PATCH MASSAL seluruh rate card dalam SATU permintaan ditolak — nol baris berubah", async () => {
    // Red team temuan A6: PATCH service_rates?honor_mitra=gt.0 {honor_mitra:7}
    // -> HTTP 204, 13 baris tertimpa. Filter pada URL adalah PILIHAN PEMANGGIL,
    // bukan pembatas baris — pelajaran yang sudah dibayar sekali di
    // material_chapters?urutan=gte.0.
    const sebelum = await querySql<{ id: string; harga_klien: number; honor_mitra: number }>(
      `select id::text, harga_klien, honor_mitra from public.service_rates order by id`,
    );
    expect(sebelum.length).toBeGreaterThanOrEqual(10);

    const { error } = await sesiOwner
      .from("service_rates")
      .update({ honor_mitra: 7 })
      .gt("honor_mitra", 0)
      .select("id");
    expect(error?.code).toBe("42501");

    const sesudah = await querySql<{ id: string; harga_klien: number; honor_mitra: number }>(
      `select id::text, harga_klien, honor_mitra from public.service_rates order by id`,
    );
    expect(sesudah).toEqual(sebelum);
  });

  it("KONTROL: service role tetap bisa memperbaiki baris (jalur pemulihan data)", async () => {
    const { data, error } = await admin
      .from("service_rates")
      .update({ harga_klien: 550_000 })
      .eq("id", TARIF_DASAR)
      .select("harga_klien");
    expect(error).toBeNull();
    expect(data?.[0].harga_klien).toBe(550_000);
  });
});

// ---------------------------------------------------------------------------
// (5) TANDA BAYAR — week_start selalu Senin
// ---------------------------------------------------------------------------
describe("honor_marks: week_start wajib hari Senin", () => {
  it("week_start RABU ditolak 23514 — tanda yatim tidak bisa dihapus lagi", async () => {
    // Red team temuan B2: week_start Rabu -> HTTP 201. Tanda itu tidak pernah
    // cocok dengan bucket rekap mana pun (honornya terlihat "belum dibayar"
    // selamanya) DAN tidak bisa dibersihkan, karena DELETE sudah dicabut.
    const { error } = await sesiOwner
      .from("honor_marks")
      .insert({ partner_id: MITRA_KERAS, week_start: RABU });
    expect(error?.code).toBe("23514");
    expect(await tandaMitra(MITRA_KERAS)).toHaveLength(0);
  });

  it("keenam hari selain Senin semuanya ditolak 23514", async () => {
    // 2026-01-05 adalah Senin; enam hari sesudahnya bukan.
    for (const bukanSenin of [
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
      "2026-01-09",
      "2026-01-10",
      "2026-01-11",
    ]) {
      const { error } = await sesiOwner
        .from("honor_marks")
        .insert({ partner_id: MITRA_KERAS, week_start: bukanSenin });
      expect(error?.code, bukanSenin).toBe("23514");
    }
    expect(await tandaMitra(MITRA_KERAS)).toHaveLength(0);
  });

  it("service role pun ditolak — CHECK berlaku untuk SEMUA peran", async () => {
    // Berbeda dari trigger bergerbang peran: bentuk `week_start` bukan soal
    // kewenangan melainkan soal data yang tidak punya arti. Tanda bertanggal
    // Rabu yang disemai service role sama yatimnya.
    const { error } = await admin
      .from("honor_marks")
      .insert({ partner_id: MITRA_KERAS, week_start: RABU });
    expect(error?.code).toBe("23514");
  });
});

// ---------------------------------------------------------------------------
// (6) TANDA BAYAR — identitas & stempel waktu direbut dari payload
// ---------------------------------------------------------------------------
describe("honor_marks: ditandai_oleh & dibayar_pada tidak pernah dari payload", () => {
  it("payload ber-uid ADMIN & bertanggal 1999 tetap lahir sebagai uid OWNER, jam sekarang", async () => {
    // Red team temuan B1: owner menandai honor ATAS NAMA ADMIN bertanggal
    // 1999 -> HTTP 201. Karena DELETE honor_marks sudah dicabut, catatan
    // otorisasi palsu itu PERMANEN: non-repudiation runtuh.
    const { error } = await sesiOwner.from("honor_marks").insert({
      partner_id: MITRA_KERAS,
      week_start: PEKAN_LEWAT,
      ditandai_oleh: idAdmin,
      dibayar_pada: "1999-01-01T00:00:00Z",
    });
    expect(error).toBeNull();

    const [tanda] = await tandaMitra(MITRA_KERAS);
    expect(tanda.ditandai_oleh).toBe(idOwner);
    expect(tanda.ditandai_oleh).not.toBe(idAdmin);
    expect(tanda.dibayar_pada.slice(0, 4)).not.toBe("1999");
    expect(Date.parse(tanda.dibayar_pada)).toBeGreaterThan(Date.now() - 5 * 60_000);
  });

  it("tanpa payload identitas pun `ditandai_oleh` terisi — bukan null", async () => {
    // Jalur sah server action mengirim `ditandai_oleh: userId`; jalur REST
    // telanjang tidak mengirim apa-apa. Keduanya harus berakhir sama.
    const { error } = await sesiOwner
      .from("honor_marks")
      .insert({ partner_id: MITRA_KERAS, week_start: PEKAN_LEWAT });
    expect(error).toBeNull();
    expect((await tandaMitra(MITRA_KERAS))[0].ditandai_oleh).toBe(idOwner);
  });

  it("KONTROL: service role TETAP menentukan sendiri penanda & stempelnya", async () => {
    // Gerbang peran menjaga jalur seed/pemulihan tetap hidup: memindahkan
    // riwayat pembayaran lama ke tabel ini tidak boleh mustahil.
    const { error } = await admin.from("honor_marks").insert({
      partner_id: MITRA_KERAS,
      week_start: PEKAN_LEWAT,
      ditandai_oleh: idAdmin,
      dibayar_pada: "1999-01-01T00:00:00Z",
    });
    expect(error).toBeNull();

    const [tanda] = await tandaMitra(MITRA_KERAS);
    expect(tanda.ditandai_oleh).toBe(idAdmin);
    expect(tanda.dibayar_pada.slice(0, 4)).toBe("1999");
  });
});

// ---------------------------------------------------------------------------
// (7) TANDA BAYAR — bukti pembayaran tidak bisa ditulis ulang di tempat
// ---------------------------------------------------------------------------
describe("honor_marks: baris yang sudah ada tidak bisa dipalsukan lewat UPDATE", () => {
  beforeEach(async () => {
    const { error } = await sesiOwner
      .from("honor_marks")
      .insert({ partner_id: MITRA_KERAS, week_start: PEKAN_LEWAT });
    expect(error).toBeNull();
  });

  it("mem-PATCH dibayar_pada & ditandai_oleh ditolak 42501, barisnya utuh", async () => {
    // Red team temuan B5b: PATCH honor_marks?...{dibayar_pada:"1999-01-01",
    // ditandai_oleh:<uid ADMIN>} -> HTTP 200. "Bukti pembayaran" yang bisa
    // ditulis ulang bukan bukti.
    const sebelum = (await tandaMitra(MITRA_KERAS))[0];

    for (const tambalan of [
      { dibayar_pada: "1999-01-01T00:00:00Z" },
      { ditandai_oleh: idAdmin },
      { dibayar_pada: "1999-01-01T00:00:00Z", ditandai_oleh: idAdmin },
    ]) {
      const { error } = await sesiOwner
        .from("honor_marks")
        .update(tambalan)
        .eq("id", sebelum.id)
        .select("id");
      expect(error?.code, JSON.stringify(tambalan)).toBe("42501");
    }

    expect((await tandaMitra(MITRA_KERAS))[0]).toEqual(sebelum);
  });

  it("memindahkan tanda ke pekan atau mitra lain ditolak 42501", async () => {
    const sebelum = (await tandaMitra(MITRA_KERAS))[0];
    for (const tambalan of [{ week_start: PEKAN_LEWAT_2 }, { partner_id: MITRA_KERAS }]) {
      const { error } = await sesiOwner
        .from("honor_marks")
        .update(tambalan)
        .eq("id", sebelum.id)
        .select("id");
      // `partner_id` bernilai SAMA sengaja ikut diuji: yang diikat trigger ini
      // adalah kolomnya, bukan perubahan nilainya — tabel ini append-only,
      // jadi tidak ada satu pun payload UPDATE yang sah.
      expect(error?.code, JSON.stringify(tambalan)).toBe("42501");
    }
    expect((await tandaMitra(MITRA_KERAS))[0]).toEqual(sebelum);
  });

  it("owner tetap ditolak 42501 saat MENGHAPUS tanda — itu keadaan yang BENAR", async () => {
    const sebelum = await tandaMitra(MITRA_KERAS);
    const { error } = await sesiOwner
      .from("honor_marks")
      .delete()
      .eq("partner_id", MITRA_KERAS);
    expect(error?.code).toBe("42501");
    expect(await tandaMitra(MITRA_KERAS)).toEqual(sebelum);
  });

  it("KONTROL: menandai ulang lewat ON CONFLICT DO NOTHING tetap idempoten", async () => {
    // Jalur sah server action: upsert ber-`ignoreDuplicates`. Ia TIDAK butuh
    // verba UPDATE dan tidak menyentuh baris lama — stempel pertama berdiri.
    const sebelum = (await tandaMitra(MITRA_KERAS))[0];
    const { error } = await sesiOwner.from("honor_marks").upsert(
      { partner_id: MITRA_KERAS, week_start: PEKAN_LEWAT, ditandai_oleh: idOwner },
      { onConflict: "partner_id,week_start", ignoreDuplicates: true },
    );
    expect(error).toBeNull();

    const sesudah = await tandaMitra(MITRA_KERAS);
    expect(sesudah).toHaveLength(1);
    expect(sesudah[0]).toEqual(sebelum);
  });
});

// ---------------------------------------------------------------------------
// (8) TANDA BAYAR — pekan yang belum berjalan
// ---------------------------------------------------------------------------
describe("honor_marks: pekan yang BELUM berjalan tidak bisa ditandai", () => {
  it("pekan masa depan ditolak 42501", async () => {
    // Red team temuan B3: week_start 2027-06-07 tanpa satu pun sesi -> HTTP
    // 201. Menyatakan honor yang belum dikerjakan sudah dibayar, secara
    // permanen (DELETE sudah dicabut). Validator TypeScript `periksaPekan`
    // sudah menolaknya — REST melewatinya seluruhnya.
    const { error } = await sesiOwner
      .from("honor_marks")
      .insert({ partner_id: MITRA_KERAS, week_start: "2027-06-07" });
    expect(error?.code).toBe("42501");
    expect(await tandaMitra(MITRA_KERAS)).toHaveLength(0);
  });

  it("KONTROL: service role tetap bisa menyemai pekan mana pun (fixture test)", async () => {
    const { error } = await admin
      .from("honor_marks")
      .insert({ partner_id: MITRA_KERAS, week_start: "2027-06-07" });
    expect(error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (9) MONEY FIREWALL TIDAK IKUT BERGESER
// ---------------------------------------------------------------------------
describe("pengerasan tidak menggeser satu pun pagar kerahasiaan", () => {
  it("admin & klien tetap dijawab NOL baris; anon tetap 42501", async () => {
    for (const [nama, sesi] of [
      ["admin", sesiAdmin],
      ["klien", sesiKlien],
    ] as const) {
      const { data: tarif } = await sesi.from("service_rates").select("harga_klien");
      expect(tarif ?? [], nama).toHaveLength(0);
      const { data: tanda } = await sesi.from("honor_marks").select("id");
      expect(tanda ?? [], nama).toHaveLength(0);
    }

    const anon = anonClient();
    const { error: eTarif } = await anon.from("service_rates").select("harga_klien");
    expect(eTarif?.code).toBe("42501");
    const { error: eTanda } = await anon.from("honor_marks").select("id");
    expect(eTanda?.code).toBe("42501");
  });

  it("admin menulis tabel uang tetap 42501 — bukan 23514/23505 dari constraint baru", async () => {
    // Kalau constraint baru menjawab lebih dulu, admin belajar bentuk data
    // uang dari pesan errornya. RLS harus tetap yang bicara pertama.
    const { error } = await sesiAdmin.from("service_rates").insert({
      service_id: LAYANAN_KERAS,
      harga_klien: 1,
      honor_mitra: 1,
      berlaku_sejak: "2030-06-03",
    });
    expect(error?.code).toBe("42501");
  });

  it("owner TETAP membaca seluruh rate card — pagar tidak melumpuhkan pemiliknya", async () => {
    const { data, error } = await sesiOwner
      .from("service_rates")
      .select("id, harga_klien, honor_mitra");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// (10) STRUKTURAL — pagarnya benar-benar ada di katalog, bukan hanya di layar
// ---------------------------------------------------------------------------
describe("STRUKTURAL: constraint & trigger tabel uang terpasang", () => {
  it("service_rates & honor_marks punya CHECK + UNIQUE bernama", async () => {
    // Red team menemukan pg_constraint hanya berisi PK/FK/unique(partner_id,
    // week_start) — NOL check. Daftar ini menguncinya.
    const baris = await querySql<{ tabel: string; conname: string; contype: string }>(`
      select c.relname as tabel, k.conname, k.contype::text
        from pg_constraint k
        join pg_class c on c.oid = k.conrelid
       where c.relname in ('service_rates','honor_marks')
         and k.contype in ('c','u')
       order by 1, 2`);
    expect(baris.map((b) => `${b.tabel}.${b.conname}`)).toEqual([
      "honor_marks.honor_marks_awal_pekan_senin",
      "honor_marks.honor_marks_partner_id_week_start_key",
      "service_rates.service_rates_nilai_wajar",
      "service_rates.service_rates_unik_per_tanggal",
    ]);
  });

  it("triggernya terpasang di kedua tabel (red team menemukan pg_trigger kosong)", async () => {
    const baris = await querySql<{ tabel: string; trigger: string }>(`
      select c.relname as tabel, t.tgname as trigger
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and not t.tgisinternal
         and c.relname in ('service_rates','honor_marks')
       order by 1, 2`);
    expect(baris.map((b) => `${b.tabel}.${b.trigger}`)).toEqual([
      "honor_marks.trg_jaga_tanda_honor",
      "honor_marks.trg_kunci_tanda_honor",
      "service_rates.trg_guard_tarif_maju",
      "service_rates.trg_kunci_riwayat_tarif",
    ]);
  });

  it("fungsi barunya tidak bisa dieksekusi public maupun anon", async () => {
    // Aturan [F] migration `fail_closed_sequence_fungsi`: hak fungsi baru
    // dinyatakan EKSPLISIT. Fungsi trigger tetap menyala tanpa EXECUTE —
    // Postgres memeriksa haknya saat CREATE TRIGGER, bukan saat trigger jalan.
    const baris = await querySql<{ nama: string; publik: boolean; anon: boolean }>(`
      select p.proname as nama,
             has_function_privilege('public', p.oid, 'EXECUTE') as publik,
             has_function_privilege('anon',   p.oid, 'EXECUTE') as anon
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('guard_tarif_maju','kunci_riwayat_tarif',
                           'jaga_tanda_honor','kunci_tanda_honor')
       order by 1`);
    expect(baris.map((b) => b.nama)).toEqual([
      "guard_tarif_maju",
      "jaga_tanda_honor",
      "kunci_riwayat_tarif",
      "kunci_tanda_honor",
    ]);
    for (const b of baris) {
      expect(b.publik, `${b.nama} bisa dieksekusi PUBLIC`).toBe(false);
      expect(b.anon, `${b.nama} bisa dieksekusi anon`).toBe(false);
    }
  });

  it("hak tabel `authenticated` TIDAK ikut tercabut — owner login sebagai peran itu", async () => {
    // Saran "cabut UPDATE dari authenticated" sengaja TIDAK dijalankan:
    // pencabutan hak tabel melumpuhkan satu-satunya peran yang berhak melihat
    // tabel uang (dibuktikan permanen di tests/hak-hapus-berlebih.test.ts).
    // Yang menutup UPDATE adalah TRIGGER — mengikat perubahan NILAI, bukan
    // kehadiran verba — sehingga upsert `ON CONFLICT DO NOTHING` jalur sah
    // tetap hidup.
    const baris = await querySql<{ hak: string }>(`
      select table_name || ':' || privilege_type as hak
        from information_schema.role_table_grants
       where grantee = 'authenticated' and table_schema = 'public'
         and table_name in ('service_rates','honor_marks')
         and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
       order by 1`);
    expect(baris.map((b) => b.hak)).toEqual([
      "honor_marks:INSERT",
      "honor_marks:SELECT",
      "honor_marks:UPDATE",
      "service_rates:INSERT",
      "service_rates:SELECT",
      "service_rates:UPDATE",
    ]);
  });
});
