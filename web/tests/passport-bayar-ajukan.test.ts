/**
 * Bayar & Ajukan Jadwal — SATU-SATUNYA jalur TULIS yang dimiliki klien.
 *
 * Klien sengaja tidak punya policy UPDATE pada `sessions`, `client_packages`,
 * maupun `booking_requests` (RLS tidak mengenal batas per-kolom untuk UPDATE:
 * satu policy langsung menyerahkan `status`, `catatan`, `client_id`, dan
 * `status_bayar` sekaligus). Karena itu seluruh perubahan lewat server action —
 * dan server action adalah ENDPOINT POST TERSENDIRI: penjaga di layout/page
 * tidak berlaku baginya. Tiga kelas kegagalan yang dijaga file ini semuanya
 * SENYAP:
 *
 *  1. Penjaga peran hilang dari dalam action. Halaman tetap benar, tetapi
 *     siapa pun yang punya sesi (mis. staf, atau akun tanpa baris `clients`)
 *     bisa memanggil endpoint action langsung.
 *  2. Status tujuan menjadi PARAMETER. Begitu nilai status datang dari browser,
 *     klien bisa menyetel `lunas` sendiri dan verifikasi manual admin runtuh.
 *     Karena itu nilai tujuan diuji lewat DB (service role), bukan lewat nilai
 *     kembalian action — action bisa saja melaporkan "ok" tanpa menulis apa pun.
 *  3. Kepemilikan hanya dijaga UI. Action memakai service role untuk MENULIS,
 *     jadi RLS tidak lagi menyaring: filter `client_id` di dalam action adalah
 *     satu-satunya pagar yang tersisa, dan kegagalannya tidak menghasilkan
 *     error apa pun — hanya baris milik orang lain yang ikut berubah.
 *
 * Pola PostgREST yang relevan: UPDATE yang tertahan dijawab 200 + [] (bukan
 * 403), jadi meng-assert nilai kembalian saja tidak membuktikan apa pun.
 * Setiap klaim di sini dibaca ulang dari basis data dengan service role.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";
import { querySql } from "./helpers/db";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const ANANDA = "44444444-4444-4444-4444-444444444401";
const SESI_LEPAS = "66666666-6666-6666-6666-666666666608";
const PAKET_ANANDA = "55555555-5555-5555-5555-555555555501";
const SVC_NUTRISI = "11111111-1111-1111-1111-111111111103";
const SVC_MASSAGE = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333302";
// Sengaja JAUH di masa depan. `ajukanJadwal` menolak tanggal lampau menurut
// kalender Jakarta, jadi tanggal uji yang "beberapa minggu lagi" akan berubah
// menjadi kegagalan palsu begitu hari itu lewat.
const TGL_UJI = "2030-11-17";

// Lapisan data & action memakai sesi pengguna (createServerSupabase). Di vitest
// tidak ada cookie, jadi klien ber-sesi sungguhan disuntikkan — RLS dan
// requireRole tetap berjalan apa adanya, persis seperti di produksi.
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

// redirect() milik Next melempar di dalam request; di test ia dijadikan error
// yang bisa dibaca supaya "penjaga peran hilang" menjadi MERAH, bukan senyap.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("notFound() terpanggil — resolusi klien gagal");
  },
}));

const { klaimSudahBayar, ajukanJadwal } = await import("@/lib/passport/aksi");

let sesiAnanda: SupabaseClient;
let rinaClientId: string;
const sesiUjiRina = "66666666-6666-6666-6666-6666666668a1";
const paketUjiRina = "55555555-5555-5555-5555-5555555558a1";

async function statusBayar(tabel: "sessions" | "client_packages", id: string) {
  const { data } = await admin.from(tabel).select("status_bayar").eq("id", id).single();
  return data!.status_bayar as string;
}

async function setStatusBayar(
  tabel: "sessions" | "client_packages",
  id: string,
  nilai: string,
) {
  await admin.from(tabel).update({ status_bayar: nilai }).eq("id", id);
}

function formulir(isi: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isi)) fd.set(k, v);
  return fd;
}

async function permintaanUji() {
  const { data } = await admin
    .from("booking_requests")
    .select("id, status, catatan, preferensi_waktu, service_id")
    .eq("client_id", ANANDA)
    .eq("tanggal", TGL_UJI);
  return data ?? [];
}

beforeAll(async () => {
  sesiAnanda = await signInAs("ananda@padma.test");
  ref.sesi = sesiAnanda;

  const { data: rina } = await admin
    .from("clients")
    .select("id")
    .eq("padma_id", "PAD-2608-0019")
    .single();
  rinaClientId = rina!.id as string;

  await admin.from("booking_requests").delete().eq("client_id", ANANDA).eq("tanggal", TGL_UJI);
  await admin.from("sessions").upsert(
    {
      id: sesiUjiRina,
      client_id: rinaClientId,
      service_id: SVC_MASSAGE,
      partner_id: MITRA,
      tanggal: "2026-11-20",
      status: "terjadwal",
      status_bayar: "belum",
    },
    { onConflict: "id" },
  );
  await admin.from("client_packages").upsert(
    {
      id: paketUjiRina,
      client_id: rinaClientId,
      package_id: "22222222-2222-2222-2222-222222222201",
      tanggal_mulai: "2026-11-01",
      status_bayar: "belum",
    },
    { onConflict: "id" },
  );
});

afterAll(async () => {
  // Kembalikan seed ke keadaan semula supaya berkas test lain (beranda, sesi,
  // bayar) tidak mewarisi status yang diubah di sini.
  await setStatusBayar("sessions", SESI_LEPAS, "belum");
  await setStatusBayar("client_packages", PAKET_ANANDA, "lunas");
  await admin.from("booking_requests").delete().eq("client_id", ANANDA).eq("tanggal", TGL_UJI);
  await admin.from("sessions").delete().eq("id", sesiUjiRina);
  await admin.from("client_packages").delete().eq("id", paketUjiRina);
});

describe("klaim bayar — jalur sah klien", () => {
  beforeEach(async () => {
    ref.sesi = sesiAnanda;
    await setStatusBayar("sessions", SESI_LEPAS, "belum");
    await setStatusBayar("client_packages", PAKET_ANANDA, "belum");
    jejak.revalidate.length = 0;
  });

  it("sesi lepas: 'belum' menjadi 'menunggu_verifikasi' — dibuktikan lewat DB", async () => {
    const r = await klaimSudahBayar("sesi", SESI_LEPAS);
    expect(r.ok).toBe(true);
    // Nilai kembalian action tidak membuktikan apa pun; nilai di basis data yang membuktikan.
    expect(await statusBayar("sessions", SESI_LEPAS)).toBe("menunggu_verifikasi");
  });

  it("paket: 'belum' menjadi 'menunggu_verifikasi'", async () => {
    const r = await klaimSudahBayar("paket", PAKET_ANANDA);
    expect(r.ok).toBe(true);
    expect(await statusBayar("client_packages", PAKET_ANANDA)).toBe("menunggu_verifikasi");
  });

  it("klaim TIDAK PERNAH menghasilkan 'lunas' — verifikasi tetap milik admin", async () => {
    await klaimSudahBayar("sesi", SESI_LEPAS);
    await klaimSudahBayar("paket", PAKET_ANANDA);
    expect(await statusBayar("sessions", SESI_LEPAS)).not.toBe("lunas");
    expect(await statusBayar("client_packages", PAKET_ANANDA)).not.toBe("lunas");
  });

  it("klaim kedua ditolak: syarat status asal 'belum' mengunci transisi", async () => {
    expect((await klaimSudahBayar("sesi", SESI_LEPAS)).ok).toBe(true);
    const kedua = await klaimSudahBayar("sesi", SESI_LEPAS);
    expect(kedua.ok).toBe(false);
    // Klaim yang gagal tidak boleh menggeser status yang sudah benar.
    expect(await statusBayar("sessions", SESI_LEPAS)).toBe("menunggu_verifikasi");
  });

  it("item yang sudah 'lunas' tidak bisa dikembalikan ke 'menunggu_verifikasi'", async () => {
    await setStatusBayar("client_packages", PAKET_ANANDA, "lunas");
    const r = await klaimSudahBayar("paket", PAKET_ANANDA);
    expect(r.ok).toBe(false);
    expect(await statusBayar("client_packages", PAKET_ANANDA)).toBe("lunas");
  });

  it("klaim yang berhasil menyegarkan halaman bayar", async () => {
    await klaimSudahBayar("sesi", SESI_LEPAS);
    expect(jejak.revalidate).toContain("/passport/bayar");
  });

  it("id yang tidak ada ditolak dengan pesan, bukan lemparan", async () => {
    const r = await klaimSudahBayar("sesi", "66666666-6666-6666-6666-6666666669ff");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.pesan.length).toBeGreaterThan(0);
  });
});

describe("klaim bayar — kepemilikan (service role menulis, RLS tidak menyaring)", () => {
  beforeEach(() => {
    ref.sesi = sesiAnanda;
  });

  it("klien TIDAK bisa mengklaim sesi milik klien lain", async () => {
    const r = await klaimSudahBayar("sesi", sesiUjiRina);
    expect(r.ok).toBe(false);
    expect(await statusBayar("sessions", sesiUjiRina)).toBe("belum");
  });

  it("klien TIDAK bisa mengklaim paket milik klien lain", async () => {
    const r = await klaimSudahBayar("paket", paketUjiRina);
    expect(r.ok).toBe(false);
    expect(await statusBayar("client_packages", paketUjiRina)).toBe("belum");
  });
});

/**
 * Jejak audit pembayaran ada untuk menjawab satu sengketa: "saya sudah
 * transfer" versus "belum masuk". Kalau jalur klaim klien menulis lewat
 * service role, setiap baris jejak berkata `aktor_id = NULL,
 * peran_aktor = 'service_role'` — barisnya ada, jumlahnya benar, dan tidak
 * membuktikan apa pun tentang siapa yang mengklaim. Karena itu yang diuji di
 * sini bukan "ada jejaknya", melainkan jejaknya menyebut MANUSIA-nya.
 */
describe("klaim klien meninggalkan jejak ber-AKTOR, bukan 'service_role'", () => {
  let idAnanda = "";

  beforeAll(async () => {
    const { data } = await sesiAnanda.auth.getUser();
    idAnanda = data.user!.id;
  });

  beforeEach(async () => {
    ref.sesi = sesiAnanda;
    await setStatusBayar("sessions", SESI_LEPAS, "belum");
    await setStatusBayar("client_packages", PAKET_ANANDA, "belum");
    await admin.from("jejak_status_bayar").delete().eq("sesi_id", SESI_LEPAS);
    await admin.from("jejak_status_bayar").delete().eq("paket_klien_id", PAKET_ANANDA);
  });

  afterAll(async () => {
    await admin.from("jejak_status_bayar").delete().eq("sesi_id", SESI_LEPAS);
    await admin.from("jejak_status_bayar").delete().eq("paket_klien_id", PAKET_ANANDA);
  });

  it("klaim sesi mencatat TEPAT SATU jejak atas nama klien yang menekannya", async () => {
    expect((await klaimSudahBayar("sesi", SESI_LEPAS)).ok).toBe(true);

    const { data: jejak } = await admin
      .from("jejak_status_bayar")
      .select("*")
      .eq("sesi_id", SESI_LEPAS);
    // PERSIS satu, bukan ">= 1": jejak ganda sama menyesatkannya dengan jejak
    // hilang saat sengketa dibaca.
    expect(jejak).toHaveLength(1);
    expect(jejak![0]).toMatchObject({
      status_lama: "belum",
      status_baru: "menunggu_verifikasi",
      peran_aktor: "klien",
      aktor_id: idAnanda,
      paket_klien_id: null,
    });
  });

  it("klaim paket juga tercatat atas nama klien", async () => {
    expect((await klaimSudahBayar("paket", PAKET_ANANDA)).ok).toBe(true);

    const { data: jejak } = await admin
      .from("jejak_status_bayar")
      .select("*")
      .eq("paket_klien_id", PAKET_ANANDA);
    expect(jejak).toHaveLength(1);
    expect(jejak![0]).toMatchObject({
      status_baru: "menunggu_verifikasi",
      peran_aktor: "klien",
      aktor_id: idAnanda,
      sesi_id: null,
    });
  });

  it("klaim yang GAGAL (milik klien lain) tidak menulis jejak apa pun", async () => {
    await admin.from("jejak_status_bayar").delete().eq("sesi_id", sesiUjiRina);
    const r = await klaimSudahBayar("sesi", sesiUjiRina);
    expect(r.ok).toBe(false);

    const { count } = await admin
      .from("jejak_status_bayar")
      .select("*", { count: "exact", head: true })
      .eq("sesi_id", sesiUjiRina);
    expect(count).toBe(0);
  });
});

describe("penjaga peran di dalam server action (bukan hanya di layout)", () => {
  afterAll(() => {
    ref.sesi = sesiAnanda;
  });

  it("staf yang memanggil action klaim dialihkan requireRole, dan tidak menulis apa pun", async () => {
    await setStatusBayar("sessions", SESI_LEPAS, "belum");
    ref.sesi = await signInAs("admin@padma.test");
    await expect(klaimSudahBayar("sesi", SESI_LEPAS)).rejects.toThrow(
      /REDIRECT \/setelah-masuk/,
    );
    expect(await statusBayar("sessions", SESI_LEPAS)).toBe("belum");
  });

  it("staf yang memanggil action ajukan jadwal dialihkan requireRole", async () => {
    ref.sesi = await signInAs("admin@padma.test");
    await expect(
      ajukanJadwal(formulir({ layanan: SVC_NUTRISI, tanggal: TGL_UJI, waktu: "pagi" })),
    ).rejects.toThrow(/REDIRECT \/setelah-masuk/);
    expect(await permintaanUji()).toHaveLength(0);
  });

  it("pemanggil tanpa sesi diarahkan ke /masuk", async () => {
    ref.sesi = anonClient();
    await expect(klaimSudahBayar("sesi", SESI_LEPAS)).rejects.toThrow(/REDIRECT \/masuk/);
  });
});

describe("ajukan jadwal", () => {
  beforeEach(async () => {
    ref.sesi = sesiAnanda;
    await admin.from("booking_requests").delete().eq("client_id", ANANDA).eq("tanggal", TGL_UJI);
    jejak.revalidate.length = 0;
  });

  it("permintaan sah tersimpan berstatus 'menunggu', BUKAN 'dikonfirmasi'", async () => {
    const r = await ajukanJadwal(
      formulir({ layanan: SVC_NUTRISI, tanggal: TGL_UJI, waktu: "sore", catatan: "tolong sore" }),
    );
    expect(r.ok).toBe(true);

    const baris = await permintaanUji();
    expect(baris).toHaveLength(1);
    expect(baris[0].status).toBe("menunggu");
    expect(baris[0].preferensi_waktu).toBe("sore");
    expect(baris[0].service_id).toBe(SVC_NUTRISI);
    expect(jejak.revalidate).toContain("/passport");
  });

  it("status tujuan TIDAK bisa diselundupkan lewat FormData", async () => {
    // Bentuk serangan yang sudah terbukti tembus sebelum Task 1: permintaan
    // berstatus 'dikonfirmasi' lenyap dari antrean admin sambil tampil
    // "dikonfirmasi" di passport.
    const r = await ajukanJadwal(
      formulir({
        layanan: SVC_NUTRISI,
        tanggal: TGL_UJI,
        waktu: "pagi",
        status: "dikonfirmasi",
      }),
    );
    expect(r.ok).toBe(true);
    const baris = await permintaanUji();
    expect(baris).toHaveLength(1);
    expect(baris[0].status).toBe("menunggu");
  });

  it("tanggal wajib berbentuk YYYY-MM-DD (kolom `tanggal` dibandingkan sebagai string)", async () => {
    const r = await ajukanJadwal(
      formulir({ layanan: SVC_NUTRISI, tanggal: "17 November 2026", waktu: "pagi" }),
    );
    expect(r.ok).toBe(false);
    expect(await permintaanUji()).toHaveLength(0);
  });

  it("layanan kosong ditolak sebelum menyentuh basis data", async () => {
    const r = await ajukanJadwal(formulir({ layanan: "", tanggal: TGL_UJI, waktu: "pagi" }));
    expect(r.ok).toBe(false);
    expect(await permintaanUji()).toHaveLength(0);
  });

  it("preferensi waktu di luar daftar ditolak", async () => {
    const r = await ajukanJadwal(
      formulir({ layanan: SVC_NUTRISI, tanggal: TGL_UJI, waktu: "tengah malam" }),
    );
    expect(r.ok).toBe(false);
    expect(await permintaanUji()).toHaveLength(0);
  });

  it("catatan dipotong pada 300 karakter (data kesehatan tidak dibiarkan tak terbatas)", async () => {
    const r = await ajukanJadwal(
      formulir({
        layanan: SVC_NUTRISI,
        tanggal: TGL_UJI,
        waktu: "siang",
        catatan: "x".repeat(500),
      }),
    );
    expect(r.ok).toBe(true);
    const baris = await permintaanUji();
    expect((baris[0].catatan as string).length).toBe(300);
  });

  it("layanan yang tidak ada ditolak basis data, dilaporkan sebagai pesan", async () => {
    const r = await ajukanJadwal(
      formulir({
        layanan: "11111111-1111-1111-1111-1111111119ff",
        tanggal: TGL_UJI,
        waktu: "pagi",
      }),
    );
    expect(r.ok).toBe(false);
    expect(await permintaanUji()).toHaveLength(0);
  });
});

describe("pagar sumber server action", () => {
  const sumber = baca("src/lib/passport/aksi.ts");

  it("berkas action ditandai \"use server\"", () => {
    expect(sumber.trimStart().startsWith('"use server"')).toBe(true);
  });

  it("requireRole([\"klien\"]) ditulis di dalam action, bukan diwarisi dari layout", () => {
    expect(sumber).toMatch(/await\s+requireRole\(\s*\[\s*["']klien["']\s*\]\s*\)/);
  });

  it("parameter action TIDAK memuat status tujuan", () => {
    const tandaTangan = [...sumber.matchAll(/export\s+async\s+function\s+\w+\(([^)]*)\)/g)];
    expect(tandaTangan.length).toBeGreaterThanOrEqual(2);
    for (const t of tandaTangan) {
      expect(t[1].toLowerCase(), `parameter "${t[1]}" memuat status`).not.toContain("status");
    }
  });

  it("nilai tujuan hardcoded, dan nilai istimewa admin tidak pernah disebut", () => {
    // Transisi klaim ('belum' -> 'menunggu_verifikasi') PINDAH ke fungsi DB
    // `klaim_sudah_bayar` supaya jejak auditnya menyebut klien, bukan
    // 'service_role'. Nilai tujuannya tetap hardcoded — sekarang di SQL —
    // dan diuji pada OBJEK NYATA di describe "RPC klaim_sudah_bayar" di bawah.
    expect(sumber).toContain('status: "menunggu"');
    // 'lunas' & 'dikonfirmasi' adalah keputusan staf; keduanya tidak boleh
    // punya jalan masuk lewat berkas ini.
    expect(sumber).not.toContain("lunas");
    expect(sumber).not.toContain("dikonfirmasi");
  });

  it("jalur klaim TIDAK memakai service role sama sekali", () => {
    // Pagar ini MENGGANTIKAN "tulisan service role dibatasi kepemilikan dan
    // status asal", dan lebih keras darinya: di bawah service role
    // `auth.uid()` NULL dan `user_role()` jatuh ke 'klien', sehingga trigger
    // jejak audit kehilangan aktornya — persis sengketa yang tabel jejak
    // dibuat untuk menyelesaikannya. Kepemilikan & status asal sekarang
    // dijaga DI DALAM fungsi DB, yang diuji pada objek nyata di bawah.
    expect(sumber).not.toContain("createAdminSupabase");
    expect(sumber).not.toContain("SERVICE_ROLE");
    expect(sumber).toMatch(/\.rpc\(\s*["']klaim_sudah_bayar["']/);
  });

  it("jumlah baris terpengaruh diperiksa (UPDATE tertahan menghasilkan 0 baris tanpa error)", () => {
    expect(sumber).toMatch(/\.select\(/);
    expect(sumber).toMatch(/length\s*===\s*0/);
  });

  it("komponen klien tidak mengirim nilai status apa pun ke action", () => {
    const tombol = baca("src/app/passport/bayar/tombol-klaim.tsx");
    expect(tombol).not.toContain("status_bayar");
    expect(tombol).not.toContain("lunas");
    expect(tombol).not.toContain("menunggu_verifikasi");
    // Kata "dikonfirmasi" boleh muncul sebagai PROSA ("dikonfirmasi tim
    // PADMA"); yang dilarang adalah medan/nilai status yang bisa terkirim.
    const form = baca("src/app/passport/ajukan/form.tsx");
    expect(form).not.toMatch(/name=["']status["']/);
    expect(form).not.toMatch(/["']dikonfirmasi["']/);
  });
});

/**
 * RPC adalah PERMUKAAN SERANGAN BARU: PostgREST mengekspos setiap fungsi
 * `public` sebagai endpoint POST /rest/v1/rpc/<nama>, dan fungsi ini
 * `security definer` — ia berjalan dengan hak postgres dan menembus RLS.
 * Karena itu ia harus (a) tertutup untuk anon, (b) menurunkan identitas dari
 * `auth.uid()` dan bukan dari argumen, dan (c) tidak punya satu pun argumen
 * berupa status tujuan.
 */
describe("RPC klaim_sudah_bayar sebagai permukaan baru", () => {
  it("tanda tangannya TIDAK memuat status tujuan", async () => {
    const f = await querySql<{ args: string; secdef: boolean }>(
      `select pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as secdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'klaim_sudah_bayar'`,
    );
    expect(f).toHaveLength(1);
    expect(f[0].secdef).toBe(true);
    expect(f[0].args.toLowerCase()).not.toContain("status");
  });

  it("nilai tujuan & status asal hardcoded di dalam fungsi, bukan argumen", async () => {
    const def = await querySql<{ def: string }>(
      `select pg_get_functiondef(p.oid) as def
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'klaim_sudah_bayar'`,
    );
    const isi = def[0].def;
    expect(isi).toContain("'menunggu_verifikasi'");
    expect(isi).toContain("'belum'");
    // Kepemilikan diturunkan dari SESI, bukan dari argumen.
    expect(isi).toContain("auth.uid()");
    // 'lunas' tidak boleh punya jalan masuk lewat jalur klien mana pun.
    expect(isi).not.toContain("lunas");
  });

  it("anon TIDAK bisa memanggilnya", async () => {
    const { error } = await anonClient().rpc("klaim_sudah_bayar", {
      jenis: "sesi",
      sasaran_id: SESI_LEPAS,
    });
    expect(`${error?.code} ${error?.message}`).toMatch(/42501|permission denied|PGRST202/i);

    // Dan benar-benar tidak menulis apa pun.
    expect(await statusBayar("sessions", SESI_LEPAS)).not.toBe("menunggu_verifikasi");
  });

  it("klien TIDAK bisa mengklaim milik klien lain lewat RPC langsung", async () => {
    await setStatusBayar("sessions", sesiUjiRina, "belum");
    const { data, error } = await sesiAnanda.rpc("klaim_sudah_bayar", {
      jenis: "sesi",
      sasaran_id: sesiUjiRina,
    });
    expect(error).toBeNull(); // ditahan oleh filter kepemilikan, bukan lemparan
    expect(data ?? []).toHaveLength(0);
    expect(await statusBayar("sessions", sesiUjiRina)).toBe("belum");
  });

  it("staf yang memanggil RPC langsung tidak bisa memakainya menyetel lunas", async () => {
    // Fungsi ini hanya mengenal satu transisi; peran apa pun yang memanggilnya
    // tetap tidak punya cara menyebut 'lunas'.
    const a = await signInAs("admin@padma.test");
    await setStatusBayar("sessions", SESI_LEPAS, "belum");
    const { data } = await a.rpc("klaim_sudah_bayar", {
      jenis: "sesi",
      sasaran_id: SESI_LEPAS,
    });
    expect(data ?? []).toHaveLength(0); // admin bukan pemilik baris klien mana pun
    expect(await statusBayar("sessions", SESI_LEPAS)).toBe("belum");
  });

  it("jenis di luar 'paket'/'sesi' ditolak, bukan diam-diam diterjemahkan", async () => {
    const { error } = await sesiAnanda.rpc("klaim_sudah_bayar", {
      jenis: "profiles",
      sasaran_id: SESI_LEPAS,
    });
    expect(error).not.toBeNull();
  });
});

describe("halaman bayar — status tanpa nominal", () => {
  async function markup(): Promise<string> {
    const { default: HalamanBayar } = await import("@/app/passport/bayar/page");
    return renderToStaticMarkup(await HalamanBayar());
  }

  beforeEach(() => {
    ref.sesi = sesiAnanda;
  });

  it("menampilkan tagihan paket dan sesi lepas dengan statusnya", async () => {
    await setStatusBayar("client_packages", PAKET_ANANDA, "lunas");
    await setStatusBayar("sessions", SESI_LEPAS, "belum");
    const m = await markup();
    expect(m).toContain("Sankalpa Prima");
    expect(m).toContain("Lunas");
    expect(m).toContain("Belum dibayar");
    expect(m).toContain("Saya sudah bayar");
  });

  it("item berstatus menunggu verifikasi kehilangan tombol klaimnya", async () => {
    await setStatusBayar("sessions", SESI_LEPAS, "menunggu_verifikasi");
    const m = await markup();
    expect(m).toContain("Menunggu verifikasi");
    expect(m).not.toContain("Saya sudah bayar");
    await setStatusBayar("sessions", SESI_LEPAS, "belum");
  });

  it("TIDAK ada nominal uang di halaman klien (money firewall)", async () => {
    const m = await markup();
    expect(m).not.toMatch(/Rp\s*\d/);
    expect(m).not.toContain("harga");
    expect(m).not.toContain("Harga");
  });

  it("QRIS ditandai jujur sebagai contoh, bukan kode yang bisa dipindai", async () => {
    const m = await markup();
    expect(m).toContain("Contoh QR");
    expect(m).toContain("QRIS a.n. PADMA Wellness");
  });

  it("sesi berpaket tidak melahirkan tagihan hantu", async () => {
    // Seed sengaja kontradiktif (paket lunas, sesi anggotanya 'belum'),
    // jadi tagihan hanya boleh berisi paket + sesi lepas.
    const { ambilPaket, ambilSesi } = await import("@/lib/passport/data");
    const { susunTagihan } = await import("@/lib/passport/turunan");
    const tagihan = susunTagihan({
      paket: await ambilPaket(ANANDA),
      sesi: await ambilSesi(ANANDA),
    });
    expect(tagihan).toHaveLength(2);
  });
});

describe("halaman ajukan jadwal — bentuk formulir", () => {
  async function markup(): Promise<string> {
    const { default: HalamanAjukan } = await import("@/app/passport/ajukan/page");
    return renderToStaticMarkup(await HalamanAjukan());
  }

  beforeEach(() => {
    ref.sesi = sesiAnanda;
  });

  it("menawarkan layanan aktif, tanggal, dan tiga preferensi waktu", async () => {
    const m = await markup();
    expect(m).toContain("Sankalpa Fertility Massage");
    expect(m).toContain('name="tanggal"');
    expect(m).toContain('name="layanan"');
    for (const w of ["pagi", "siang", "sore"]) expect(m).toContain(w);
  });

  it("berkata jujur bahwa ini permintaan, bukan booking final", async () => {
    const m = await markup();
    expect(m).toContain("Ini permintaan, bukan booking final");
  });

  it("tidak ada kendali status di formulir klien", async () => {
    const m = await markup();
    expect(m).not.toContain('name="status"');
    // Nilai status tidak boleh hadir sebagai medan tersembunyi mana pun.
    expect(m).not.toMatch(/value="(menunggu|dikonfirmasi|selesai|batal)"/);
    expect(m).not.toMatch(/type="hidden"/);
  });
});
