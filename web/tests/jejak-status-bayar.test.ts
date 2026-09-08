/**
 * JEJAK AUDIT KEPUTUSAN PEMBAYARAN + PENJAGA TRANSISI.
 *
 * Sampai hari ini `status_bayar` hanyalah enum: tidak ada satu baris pun yang
 * mencatat SIAPA menyetel 'lunas', KAPAN, dan dari status apa. Saat klien
 * berkata "saya sudah transfer" dan admin berkata "belum masuk", tidak ada
 * bukti yang bisa dipakai membantah. Itu utang paling mahal secara bisnis di
 * aplikasi ini, dan ia hanya berguna bila jejaknya TIDAK BISA dikarang maupun
 * dihapus oleh admin yang sedang diaudit — karena itu invarian utamanya bukan
 * "jejak tercatat", melainkan "jejak tidak bisa disentuh peran API mana pun".
 *
 * Tiga kelas kegagalan yang dijaga berkas ini, semuanya SENYAP:
 *
 *  1. Jejak tercatat tanpa AKTOR. Panel admin memakai `createServerSupabase()`
 *     (sesi pengguna); begitu seseorang menggantinya dengan service role,
 *     `auth.uid()` menjadi NULL dan setiap baris jejak berkata 'service_role' —
 *     tetap ada barisnya, tetap hijau kalau yang diuji hanya jumlah baris,
 *     tetapi tak berguna sama sekali sebagai bukti.
 *  2. Jejak PALSU menumpuk. Trigger `after update of <kolom>` menyala saat
 *     kolom DISEBUT di SET, bukan saat nilainya berubah. Tanpa penjaga
 *     `is not distinct from`, upsert idempoten `scripts/seed-users.ts` — yang
 *     dijalankan `tests/global-setup.ts` SETIAP `npm test` — menambah satu
 *     baris jejak palsu per sesi per run.
 *  3. Pemutaran mundur diam-diam. 'lunas' -> 'belum' tidak meninggalkan bekas
 *     apa pun di UI; penjaganya harus di DB, dan harus MELEWATKAN service_role
 *     (kalau tidak, seed mati dan seluruh suite ikut mati).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";
import { varianBaku } from "./helpers/varian";

const admin = createAdminSupabase();

const SESI_UJI = "66666666-6666-6666-6666-6666666666f1";
const PAKET_UJI = "55555555-5555-5555-5555-5555555555f1";
const ANANDA = "44444444-4444-4444-4444-444444444401";
const SVC_NUTRISI = "11111111-1111-1111-1111-111111111103";
// Sejak Task 9 `variant_id` NOT NULL: dibaca dari basis data sekali di sini
// (id-nya lahir `gen_random_uuid()` saat migrasi/trigger berjalan) alih-alih
// ditulis literal — dipakai di seluruh berkas ini untuk SVC_NUTRISI.
let VARIAN_NUTRISI: string;

beforeAll(async () => {
  VARIAN_NUTRISI = await varianBaku(admin, SVC_NUTRISI);
  await admin.from("sessions").upsert(
    {
      id: SESI_UJI,
      client_id: ANANDA,
      service_id: SVC_NUTRISI,
      variant_id: VARIAN_NUTRISI,
      partner_id: "33333333-3333-3333-3333-333333333302",
      tanggal: "2026-12-28",
      status: "terjadwal",
      catatan: "",
      rekomendasi: "",
      status_bayar: "belum",
      jam_mulai: "09:00",
    },
    { onConflict: "id" },
  );
  await admin.from("client_packages").upsert(
    {
      id: PAKET_UJI,
      client_id: ANANDA,
      package_id: "22222222-2222-2222-2222-222222222201",
      tanggal_mulai: "2026-12-28",
      status_bayar: "belum",
    },
    { onConflict: "id" },
  );
  await admin.from("jejak_status_bayar").delete().eq("sesi_id", SESI_UJI);
  await admin.from("jejak_status_bayar").delete().eq("paket_klien_id", PAKET_UJI);
});

afterAll(async () => {
  await admin.from("jejak_status_bayar").delete().eq("sesi_id", SESI_UJI);
  await admin.from("jejak_status_bayar").delete().eq("paket_klien_id", PAKET_UJI);
  await admin.from("sessions").delete().eq("id", SESI_UJI);
  await admin.from("client_packages").delete().eq("id", PAKET_UJI);
});

describe("jejak audit keputusan pembayaran", () => {
  it("perubahan status_bayar oleh admin tercatat beserta aktornya", async () => {
    const a = await signInAs("admin@padma.test");
    // Identitas diambil dari sesi, BUKAN dari `profiles ... limit(1)`: admin
    // berhak membaca SELURUH profil (policy "profil: baca sendiri atau staf"),
    // jadi baris pertama sembarang belum tentu miliknya sendiri.
    const { data: sesiAuth } = await a.auth.getUser();
    const idAdmin = sesiAuth.user!.id;

    const { error } = await a
      .from("sessions")
      .update({ status_bayar: "lunas" })
      .eq("id", SESI_UJI);
    expect(error).toBeNull();

    const { data: jejak } = await admin
      .from("jejak_status_bayar")
      .select("*")
      .eq("sesi_id", SESI_UJI)
      .order("dicatat_pada", { ascending: false });

    expect(jejak!.length).toBeGreaterThanOrEqual(1);
    expect(jejak![0]).toMatchObject({
      status_lama: "belum",
      status_baru: "lunas",
      peran_aktor: "admin",
    });
    // Inti gunanya: BUKAN sekadar "ada barisnya", tetapi barisnya menyebut
    // manusia yang menekan tombol.
    expect(jejak![0].aktor_id).toBe(idAdmin);
    expect(jejak![0].paket_klien_id).toBeNull();
  });

  it("perubahan status_bayar pada paket klien juga tercatat", async () => {
    const a = await signInAs("admin@padma.test");
    const { error } = await a
      .from("client_packages")
      .update({ status_bayar: "menunggu_verifikasi" })
      .eq("id", PAKET_UJI);
    expect(error).toBeNull();

    const { data: jejak } = await admin
      .from("jejak_status_bayar")
      .select("*")
      .eq("paket_klien_id", PAKET_UJI)
      .order("dicatat_pada", { ascending: false });

    expect(jejak!.length).toBeGreaterThanOrEqual(1);
    expect(jejak![0]).toMatchObject({
      status_lama: "belum",
      status_baru: "menunggu_verifikasi",
      peran_aktor: "admin",
    });
    expect(jejak![0].sesi_id).toBeNull();
  });

  it("UPDATE yang menyebut status_bayar tanpa mengubah nilainya TIDAK mencatat jejak", async () => {
    const { count: sebelum } = await admin
      .from("jejak_status_bayar")
      .select("*", { count: "exact", head: true })
      .eq("sesi_id", SESI_UJI);

    // Persis yang dilakukan upsert idempoten seed setiap `npm test`:
    // kolom DISEBUT di SET, nilainya sama. Jangan menumpuk jejak palsu.
    await admin.from("sessions").update({ status_bayar: "lunas" }).eq("id", SESI_UJI);
    await admin.from("sessions").update({ status_bayar: "lunas" }).eq("id", SESI_UJI);

    const { count: sesudah } = await admin
      .from("jejak_status_bayar")
      .select("*", { count: "exact", head: true })
      .eq("sesi_id", SESI_UJI);
    expect(sesudah).toBe(sebelum);
  });

  it("jejak TIDAK bisa dihapus atau diubah admin", async () => {
    const a = await signInAs("admin@padma.test");
    const { data: jejak } = await admin
      .from("jejak_status_bayar")
      .select("id")
      .eq("sesi_id", SESI_UJI)
      .limit(1)
      .single();

    const { error: eHapus } = await a
      .from("jejak_status_bayar")
      .delete()
      .eq("id", jejak!.id);
    expect(eHapus?.code).toBe("42501");

    const { error: eUbah } = await a
      .from("jejak_status_bayar")
      .update({ status_baru: "belum" })
      .eq("id", jejak!.id);
    expect(eUbah?.code).toBe("42501");

    const { error: eSisip } = await a.from("jejak_status_bayar").insert({
      sesi_id: SESI_UJI,
      status_lama: "lunas",
      status_baru: "belum",
      peran_aktor: "hantu",
    });
    expect(eSisip?.code).toBe("42501");

    // Barisnya benar-benar masih utuh — 42501 tanpa pembacaan ulang tidak
    // membuktikan apa pun.
    const { data: utuh } = await admin
      .from("jejak_status_bayar")
      .select("status_baru")
      .eq("id", jejak!.id)
      .maybeSingle();
    expect(utuh?.status_baru).toBe("lunas");
  });

  it("owner pun tidak memegang hak tulis atas jejak (bukan sekadar RLS)", async () => {
    // Pagar tingkat HAK, bukan policy: policy bisa ditambahkan seseorang besok
    // tanpa membuat satu test pun merah kalau haknya masih ada.
    const hak = await querySql<{ privilege_type: string; grantee: string }>(
      `select privilege_type, grantee
         from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name = 'jejak_status_bayar'
          and grantee in ('anon','authenticated')
        order by grantee, privilege_type`,
    );
    expect(hak.map((h) => `${h.grantee}:${h.privilege_type}`)).toEqual([
      "authenticated:SELECT",
    ]);

    const o = await signInAs("owner@padma.test");
    const { error } = await o
      .from("jejak_status_bayar")
      .delete()
      .eq("sesi_id", SESI_UJI);
    expect(error?.code).toBe("42501");
  });

  it("admin & owner BISA membaca jejak; klien TIDAK", async () => {
    const a = await signInAs("admin@padma.test");
    const { data: adminLihat } = await a
      .from("jejak_status_bayar")
      .select("id")
      .eq("sesi_id", SESI_UJI);
    expect(adminLihat!.length).toBeGreaterThanOrEqual(1);

    const o = await signInAs("owner@padma.test");
    const { data: ownerLihat } = await o
      .from("jejak_status_bayar")
      .select("id")
      .eq("sesi_id", SESI_UJI);
    expect(ownerLihat!.length).toBeGreaterThanOrEqual(1);

    const k = await signInAs("ananda@padma.test");
    const { data: klienLihat, error: eKlien } = await k
      .from("jejak_status_bayar")
      .select("id");
    expect(eKlien).toBeNull(); // disaring RLS, bukan ditolak hak — 0 baris senyap
    expect(klienLihat ?? []).toHaveLength(0);
  });
});

describe("seed idempoten tidak menumpuk jejak palsu", () => {
  it("menjalankan ulang seedUsers() TIDAK menambah satu baris jejak pun", async () => {
    // Ini bukan kerapian, ini yang membuat jejaknya bisa dipercaya. Seed
    // meng-upsert 8 sesi + 1 paket dengan `status_bayar` DISEBUT eksplisit di
    // setiap baris (kolom itu NOT NULL, jadi ia memang harus disebut), dan
    // `tests/global-setup.ts` menjalankannya setiap `npm test`. Trigger
    // `after update of status_bayar` menyala pada penyebutan, bukan pada
    // perubahan — tanpa penjaga `is not distinct from`, tabel audit tumbuh 9
    // baris palsu per run dan dalam sebulan bukti aslinya tenggelam.
    const { seedUsers } = await import("../scripts/seed-users");

    const { count: sebelum } = await admin
      .from("jejak_status_bayar")
      .select("*", { count: "exact", head: true });

    await seedUsers();

    const { count: sesudah } = await admin
      .from("jejak_status_bayar")
      .select("*", { count: "exact", head: true });
    expect(sesudah).toBe(sebelum);
  });

  it("tidak ada satu pun baris jejak yang status lama & barunya sama", async () => {
    // Invarian menyeluruh atas SELURUH tabel, bukan hanya baris uji: satu baris
    // 'lunas' -> 'lunas' berarti penjaganya bocor di suatu jalur.
    const semu = await querySql<{ jumlah: string }>(
      `select count(*)::text as jumlah
         from public.jejak_status_bayar
        where status_lama is not distinct from status_baru`,
    );
    expect(semu[0].jumlah).toBe("0");
  });
});

describe("penjaga transisi status_bayar", () => {
  it("admin TIDAK bisa memutar lunas -> belum", async () => {
    const a = await signInAs("admin@padma.test");
    const { error } = await a
      .from("sessions")
      .update({ status_bayar: "belum" })
      .eq("id", SESI_UJI);
    expect(error?.code).toBe("42501");

    const { data } = await admin
      .from("sessions")
      .select("status_bayar")
      .eq("id", SESI_UJI)
      .single();
    expect(data!.status_bayar).toBe("lunas");
  });

  it("pemutaran mundur yang ditolak TIDAK meninggalkan jejak", async () => {
    const { count } = await admin
      .from("jejak_status_bayar")
      .select("*", { count: "exact", head: true })
      .eq("sesi_id", SESI_UJI)
      .eq("status_baru", "belum");
    expect(count).toBe(0);
  });

  it("admin TETAP bisa maju belum -> menunggu_verifikasi -> lunas", async () => {
    const a = await signInAs("admin@padma.test");
    const { error } = await a
      .from("client_packages")
      .update({ status_bayar: "lunas" })
      .eq("id", PAKET_UJI);
    expect(error).toBeNull();

    const { data } = await admin
      .from("client_packages")
      .select("status_bayar")
      .eq("id", PAKET_UJI)
      .single();
    expect(data!.status_bayar).toBe("lunas");
  });

  it("service role (seed) tetap bebas — kalau tidak, seluruh suite mati", async () => {
    const { error } = await admin
      .from("sessions")
      .update({ status_bayar: "belum" })
      .eq("id", SESI_UJI);
    expect(error).toBeNull();

    // Jalur service role tidak punya auth.uid(); jejaknya tetap dicatat, tetapi
    // jujur menyebut dirinya bukan manusia.
    const { data: jejak } = await admin
      .from("jejak_status_bayar")
      .select("aktor_id, peran_aktor, status_lama, status_baru")
      .eq("sesi_id", SESI_UJI)
      .order("dicatat_pada", { ascending: false })
      .limit(1);
    expect(jejak![0]).toMatchObject({
      status_lama: "lunas",
      status_baru: "belum",
      peran_aktor: "service_role",
      aktor_id: null,
    });
  });
});

// ---------------------------------------------------------------------------
// LUBANG INSERT (temuan red team #1)
// ---------------------------------------------------------------------------
/**
 * Jejak audit yang hanya menutup jalur UPDATE tidak menutup apa pun: admin
 * tidak perlu MENGHAPUS jejak, ia cukup TIDAK PERNAH MEMBUATNYA. Trigger
 * `after update of status_bayar` diam total saat baris LAHIR dengan
 * `status_bayar = 'lunas'` lewat POST /rest/v1/ — dan karena
 * `guard_transisi_status_bayar` melarang 'lunas' diputar mundur oleh peran
 * API, "lunas" palsu itu juga tidak bisa dicabut admin atau owner lain lewat
 * aplikasi.
 *
 * Dua pagar yang diuji di sini, keduanya wajib:
 *   1. peran API (klien/admin/owner — semuanya `authenticated`) TIDAK BOLEH
 *      melahirkan baris uang dengan status selain 'belum'. Keputusan
 *      pembayaran hanya boleh terjadi lewat UPDATE, jalur yang sudah terjaga
 *      penuh (jejak + penjaga transisi);
 *   2. bila baris non-'belum' tetap lahir lewat service role (seed,
 *      pembersihan test, migrasi data), ia TETAP mencatat jejak dengan
 *      `status_lama = null` — supaya tidak ada satu pun baris uang di sistem
 *      ini yang berstatus lunas tanpa asal-usul.
 */
describe("lubang INSERT: status uang tidak boleh lahir tanpa jejak", () => {
  const SESI_LAHIR = "66666666-6666-6666-6666-6666666666f2";
  const PAKET_LAHIR = "55555555-5555-5555-5555-5555555555f2";
  const SESI_SAH = "66666666-6666-6666-6666-6666666666f3";
  const SVC = SVC_NUTRISI;
  const MITRA = "33333333-3333-3333-3333-333333333302";
  const PAKET = "22222222-2222-2222-2222-222222222201";

  async function jumlahJejak(): Promise<number> {
    const { count } = await admin
      .from("jejak_status_bayar")
      .select("*", { count: "exact", head: true });
    return count ?? 0;
  }

  afterAll(async () => {
    await admin.from("jejak_status_bayar").delete().eq("sesi_id", SESI_LAHIR);
    await admin.from("jejak_status_bayar").delete().eq("sesi_id", SESI_SAH);
    await admin.from("jejak_status_bayar").delete().eq("paket_klien_id", PAKET_LAHIR);
    await admin.from("sessions").delete().eq("id", SESI_LAHIR);
    await admin.from("sessions").delete().eq("id", SESI_SAH);
    await admin.from("client_packages").delete().eq("id", PAKET_LAHIR);
  });

  it("admin TIDAK bisa MELAHIRKAN sesi berstatus 'lunas' lewat INSERT", async () => {
    const a = await signInAs("admin@padma.test");
    const sebelum = await jumlahJejak();

    const { error } = await a
      .from("sessions")
      .insert({
        id: SESI_LAHIR,
        client_id: ANANDA,
        service_id: SVC,
        variant_id: VARIAN_NUTRISI,
        partner_id: MITRA,
        tanggal: "2026-12-28",
        jam_mulai: "09:00",
        status: "terjadwal",
        status_bayar: "lunas",
      })
      .select();
    expect(error?.code).toBe("42501");

    // 42501 tanpa pembacaan ulang tidak membuktikan apa pun.
    const { data } = await admin
      .from("sessions")
      .select("id")
      .eq("id", SESI_LAHIR)
      .maybeSingle();
    expect(data).toBeNull();
    // Jumlah dibandingkan PERSIS, bukan ">= 1": baris uang yang tertahan tidak
    // boleh meninggalkan jejak, dan jejak yang lahir tidak boleh terlewat.
    expect(await jumlahJejak()).toBe(sebelum);
  });

  it("admin TIDAK bisa MELAHIRKAN paket klien berstatus 'lunas' lewat INSERT", async () => {
    const a = await signInAs("admin@padma.test");
    const sebelum = await jumlahJejak();

    const { error } = await a
      .from("client_packages")
      .insert({
        id: PAKET_LAHIR,
        client_id: ANANDA,
        package_id: PAKET,
        tanggal_mulai: "2026-12-28",
        status_bayar: "lunas",
      })
      .select();
    expect(error?.code).toBe("42501");

    const { data } = await admin
      .from("client_packages")
      .select("id")
      .eq("id", PAKET_LAHIR)
      .maybeSingle();
    expect(data).toBeNull();
    expect(await jumlahJejak()).toBe(sebelum);
  });

  it("'menunggu_verifikasi' pun tidak boleh lahir dari peran API", async () => {
    // Bukan hanya 'lunas': status klaim yang lahir langsung membuat klien
    // tampak sudah mengklaim tanpa pernah menekan tombol apa pun.
    const a = await signInAs("admin@padma.test");
    const { error } = await a.from("sessions").insert({
      id: SESI_LAHIR,
      client_id: ANANDA,
      service_id: SVC,
      variant_id: VARIAN_NUTRISI,
      partner_id: MITRA,
      tanggal: "2026-12-28",
      jam_mulai: "09:00",
      status: "terjadwal",
      status_bayar: "menunggu_verifikasi",
    });
    expect(error?.code).toBe("42501");
  });

  it("admin TETAP bisa membuat sesi baru (alur sah tidak ikut mati)", async () => {
    const a = await signInAs("admin@padma.test");
    const sebelum = await jumlahJejak();

    // Tanpa menyebut status_bayar sama sekali (default 'belum') …
    const { data, error } = await a
      .from("sessions")
      .insert({
        id: SESI_SAH,
        client_id: ANANDA,
        service_id: SVC,
        variant_id: VARIAN_NUTRISI,
        partner_id: MITRA,
        tanggal: "2026-12-28",
        jam_mulai: "09:00",
        status: "terjadwal",
      })
      .select("status_bayar")
      .single();
    expect(error).toBeNull();
    expect(data!.status_bayar).toBe("belum");

    // … dan dengan menyebutnya 'belum' secara eksplisit (yang dilakukan seed).
    const { error: eEksplisit } = await a
      .from("sessions")
      .insert({
        client_id: ANANDA,
        service_id: SVC,
        variant_id: VARIAN_NUTRISI,
        partner_id: MITRA,
        tanggal: "2026-12-28",
        jam_mulai: "09:00",
        status: "terjadwal",
        status_bayar: "belum",
      })
      .select("id");
    expect(eEksplisit).toBeNull();

    // Kelahiran berstatus 'belum' bukan keputusan uang: tidak ada jejak.
    expect(await jumlahJejak()).toBe(sebelum);

    await admin
      .from("sessions")
      .delete()
      .eq("client_id", ANANDA)
      .eq("tanggal", "2026-12-28")
      .neq("id", SESI_SAH);
  });

  it("INSERT non-'belum' lewat service role TETAP melahirkan tepat satu jejak", async () => {
    // Jalur seed/migrasi data tidak tertutup (service role memang harus bisa
    // membuat baris apa pun), jadi pagar keduanya: barisnya tercatat, dengan
    // `status_lama = null` — "lahir langsung lunas", bukan transisi.
    const sebelum = await jumlahJejak();

    const { error } = await admin.from("client_packages").insert({
      id: PAKET_LAHIR,
      client_id: ANANDA,
      package_id: PAKET,
      tanggal_mulai: "2026-12-28",
      status_bayar: "lunas",
    });
    expect(error).toBeNull();
    expect(await jumlahJejak()).toBe(sebelum + 1);

    const { data: jejak } = await admin
      .from("jejak_status_bayar")
      .select("*")
      .eq("paket_klien_id", PAKET_LAHIR);
    expect(jejak).toHaveLength(1);
    expect(jejak![0]).toMatchObject({
      status_lama: null,
      status_baru: "lunas",
      peran_aktor: "service_role",
      aktor_id: null,
      sesi_id: null,
    });
  });
});

// ---------------------------------------------------------------------------
// STEMPEL WAKTU client_packages (temuan red team #1b)
// ---------------------------------------------------------------------------
/**
 * `client_packages` adalah satu-satunya objek uang tanpa stempel waktu apa pun.
 * Baris "lunas" yang dikarang di sana benar-benar nol forensik: tanpa aktor
 * (lubang INSERT di atas) DAN tanpa waktu. Nama kolomnya sengaja netral
 * terhadap regex money firewall struktural.
 */
describe("client_packages punya stempel waktu", () => {
  const PAKET_WAKTU = "55555555-5555-5555-5555-5555555555f3";

  afterAll(async () => {
    await admin.from("jejak_status_bayar").delete().eq("paket_klien_id", PAKET_WAKTU);
    await admin.from("client_packages").delete().eq("id", PAKET_WAKTU);
  });

  it("kolom created_at & updated_at ada dan NOT NULL", async () => {
    const kolom = await querySql<{ column_name: string; is_nullable: string; data_type: string }>(
      `select column_name, is_nullable, data_type
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'client_packages'
          and column_name in ('created_at','updated_at')
        order by column_name`,
    );
    expect(kolom.map((k) => `${k.column_name}:${k.is_nullable}:${k.data_type}`)).toEqual([
      "created_at:NO:timestamp with time zone",
      "updated_at:NO:timestamp with time zone",
    ]);
  });

  it("updated_at BERGERAK saat baris diperbarui (kolom yang berbohong tidak berguna)", async () => {
    await admin.from("client_packages").insert({
      id: PAKET_WAKTU,
      client_id: ANANDA,
      package_id: "22222222-2222-2222-2222-222222222201",
      tanggal_mulai: "2026-12-28",
      status_bayar: "belum",
    });

    const { data: awal } = await admin
      .from("client_packages")
      .select("created_at, updated_at")
      .eq("id", PAKET_WAKTU)
      .single();
    expect(awal!.created_at).not.toBeNull();

    const a = await signInAs("admin@padma.test");
    await a
      .from("client_packages")
      .update({ status_bayar: "menunggu_verifikasi" })
      .eq("id", PAKET_WAKTU);

    const { data: sesudah } = await admin
      .from("client_packages")
      .select("created_at, updated_at")
      .eq("id", PAKET_WAKTU)
      .single();
    expect(new Date(sesudah!.updated_at as string).getTime()).toBeGreaterThan(
      new Date(awal!.updated_at as string).getTime(),
    );
    // created_at tidak boleh ikut bergeser — ia yang menjawab "sejak kapan".
    expect(sesudah!.created_at).toBe(awal!.created_at);
  });
});
