/**
 * RANTAI ADMIN: cari bidan -> tetapkan bidan -> konfirmasi (spec C1 J7).
 *
 * Tiga hal yang diuji di sini, dan ketiganya bisa hilang sendiri-sendiri:
 *   1. perpindahan status yang sah DAN yang tidak — termasuk lompatan yang
 *      ditembak langsung ke basis data, tanpa lewat server action;
 *   2. konfirmasi tetap melahirkan TEPAT SATU sesi saat dua panggilan berjalan
 *      bersamaan — pengerasan lama (migration `sesi_dari_permintaan`) tidak
 *      boleh hilang saat konfirmasi pindah ke dalam fungsi Postgres;
 *   3. pagar DI DALAM `konfirmasi_permintaan()` — ia `security definer`,
 *      sehingga RLS mati dan penjaganya harus hidup di badan fungsi.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { skriningHijau } from "./helpers/skrining";
import { querySql } from "./helpers/db";

const admin = createAdminSupabase();

const KLIEN = "44444444-4444-4444-4444-444444444401"; // Ananda
const SVC = "11111111-1111-1111-1111-111111111101"; // Fertility Massage
const MITRA = "33333333-3333-3333-3333-333333333301";
const MITRA_NONAKTIF = "33333333-3333-3333-3333-3333333333e1";
const TGL = "2026-12-27"; // tanggal khusus berkas ini, tidak dipakai berkas lain
const JAM = "09:00";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ref.sesi! }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/admin/sesi",
}));

const { cariMitra, pilihMitra, terbitkanTagihan, konfirmasiPermintaan } = await import(
  "@/app/admin/sesi/aksi"
);

let VARIAN: string;
let sesiAdmin: SupabaseClient;

async function bersihkan() {
  // Jejak audit DULU dari semuanya: `konfirmasi_permintaan()` (rantai C2)
  // melahirkan sesi LANGSUNG berstatus `status_bayar = 'lunas'`, dan trigger
  // `catat_status_bayar` mencatatnya SEJAK INSERT (bukan hanya UPDATE, sejak
  // migration 20260829180000). Tabel jejak SENGAJA tanpa foreign key — sesi
  // yang dihapus tanpa jejaknya ikut dihapus meninggalkan baris YATIM, yang
  // ditangkap tests/jejak-yatim.test.ts. `sesi_id` dibaca dulu, sebelum
  // sesinya sendiri lenyap.
  const { data: sesiTgl } = await admin.from("sessions").select("id").eq("tanggal", TGL);
  const idSesi = (sesiTgl ?? []).map((s) => s.id as string);
  if (idSesi.length) {
    await admin.from("jejak_status_bayar").delete().in("sesi_id", idSesi);
  }
  // Sesi DULU, baru permintaannya: `sessions.booking_request_id` menahan
  // penghapusan permintaan yang sudah menjadi sesi (FK tanpa on delete).
  await admin.from("sessions").delete().eq("tanggal", TGL);
  await admin.from("booking_requests").delete().eq("tanggal", TGL);
  // SESUDAH booking_requests: FK screening_id (RESTRICT) menahan penghapusan
  // selama masih ditunjuk baris permintaan.
  await admin.from("screenings").delete().like("kode", "UJI-%");
}

/** Membuat satu permintaan pada status tertentu, memakai service role. */
async function permintaanPada(
  status: string,
  partnerId: string | null = null,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const screeningId = await skriningHijau(admin, KLIEN);
  const { data, error } = await admin
    .from("booking_requests")
    .insert({
      client_id: KLIEN,
      service_id: SVC,
      variant_id: VARIAN,
      partner_id: partnerId,
      tanggal: TGL,
      jam_mulai: JAM,
      preferensi_waktu: "pagi",
      alamat: "Jl. Uji Rantai No. 7",
      status,
      screening_id: screeningId,
      ...extra,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw error;
  return data.id;
}

/** Tenggat 24 jam ke depan — bentuk yang sama dipakai `terbitkanTagihan`. */
function tenggatJauh(): string {
  return new Date(Date.now() + 24 * 3_600_000).toISOString();
}

/**
 * Permintaan pada 'menunggu_bayar', LUNAS, siap dikonfirmasi — jalur wajib
 * sejak C2 (`mitra_siap -> dikonfirmasi` langsung DITOLAK sekarang).
 */
async function permintaanSiapKonfirmasi(partnerId: string = MITRA): Promise<string> {
  return permintaanPada("menunggu_bayar", partnerId, {
    tenggat: tenggatJauh(),
    status_bayar: "lunas",
  });
}

async function statusPermintaan(id: string): Promise<string | null> {
  const { data } = await admin
    .from("booking_requests")
    .select("status")
    .eq("id", id)
    .maybeSingle<{ status: string }>();
  return data?.status ?? null;
}

async function sesiDari(id: string) {
  const { data } = await admin
    .from("sessions")
    .select("id, partner_id, jam_mulai, status, jenjang, jenjang_sumber")
    .eq("booking_request_id", id);
  return data ?? [];
}

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  ref.sesi = sesiAdmin;
  VARIAN = await varianBaku(admin, SVC);
  await bersihkan();
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  await bersihkan();
});

afterAll(bersihkan);

describe("rantai admin: cari bidan", () => {
  it("memindahkan diminta -> mencari_mitra", async () => {
    const id = await permintaanPada("diminta");
    expect(await cariMitra(id)).toEqual({ ok: true });
    expect(await statusPermintaan(id)).toBe("mencari_mitra");
  });

  it("GANTI BIDAN: mitra_siap -> mencari_mitra, dan partner_id DILEPAS", async () => {
    // Jalan mundur ini ada karena bidan bisa berhalangan atau dinonaktifkan
    // sesudah ditetapkan. Tanpa itu permintaannya tersangkut permanen:
    // konfirmasi menolaknya, dan sejak J8 admin tidak lagi punya tombol tolak.
    const id = await permintaanPada("mitra_siap", MITRA);
    expect(await cariMitra(id)).toEqual({ ok: true });

    const { data } = await admin
      .from("booking_requests")
      .select("status, partner_id")
      .eq("id", id)
      .maybeSingle<{ status: string; partner_id: string | null }>();
    expect(data?.status).toBe("mencari_mitra");
    // Membiarkannya menempel akan membuat layar menampilkan nama bidan yang
    // sudah tidak jadi datang, dan CHECK mitra_siap tidak menahannya.
    expect(data?.partner_id).toBeNull();
  });

  it("menolak dari keadaan yang sudah dikonfirmasi", async () => {
    const id = await permintaanPada("dikonfirmasi", MITRA);
    const hasil = await cariMitra(id);
    expect(hasil.ok).toBe(false);
    expect(await statusPermintaan(id)).toBe("dikonfirmasi");
  });
});

describe("rantai admin: tetapkan bidan", () => {
  it("memindahkan mencari_mitra -> mitra_siap DAN mengisi partner_id", async () => {
    const id = await permintaanPada("mencari_mitra");
    expect(await pilihMitra(id, MITRA)).toEqual({ ok: true });

    const { data } = await admin
      .from("booking_requests")
      .select("status, partner_id")
      .eq("id", id)
      .maybeSingle<{ status: string; partner_id: string | null }>();
    expect(data?.status).toBe("mitra_siap");
    expect(data?.partner_id).toBe(MITRA);
  });

  it("menolak mitra NONAKTIF dengan kalimat, bukan kode Postgres", async () => {
    // FK hanya menolak partner_id yang TIDAK ADA, bukan mitra yang sudah
    // pensiun — dan daftar pilihan di UI menyaring `aktif`, sementara server
    // action tidak pernah melewati UI itu.
    const id = await permintaanPada("mencari_mitra");
    const hasil = await pilihMitra(id, MITRA_NONAKTIF);
    expect(hasil.ok).toBe(false);
    expect(hasil.ok === false && hasil.pesan).toMatch(/mitra/i);
    expect(await statusPermintaan(id)).toBe("mencari_mitra");
  });
});

describe("terbitkanTagihan: mitra_siap -> menunggu_bayar", () => {
  // Sejak gerbang Task 4, kedua uji di bawah BUTUH titik mitra yang nyata —
  // bukan hanya alamat permintaannya. `MITRA` adalah baris SEED bersama
  // seluruh suite (`33333333-…301`), dan berkas lain (mis.
  // `admin-sesi-konfirmasi.test.ts`) sengaja me-NULL-kannya di `afterEach`
  // masing-masing untuk menguji jalur "belum berpin". Saat `npm test` PENUH
  // menjalankan berkas-berkas itu lebih dulu, titiknya bisa tiba di sini
  // sudah kosong — bukan karena kode gerbangnya salah, tapi karena baris
  // SEED yang dipakai bersama dibiarkan tercemar. Dipulihkan di sini supaya
  // dua uji ini deterministik terlepas dari urutan berkas.
  beforeEach(async () => {
    await admin
      .from("partners")
      .update({ lat: -7.96662, lon: 112.632632 })
      .eq("id", MITRA);
  });

  it("memindahkan mitra_siap -> menunggu_bayar DAN mengisi tenggat", async () => {
    // Koordinat WAJIB disertakan sejak Task 4: gerbang di `terbitkanTagihan()`
    // menolak tagihan yang totalnya belum bisa dihitung, dan tanpa titik
    // alamat jenjangnya tidak pernah diketahui. Pasangan koordinat ini sama
    // dengan yang dipakai `tests/tagihan-baca-hak.test.ts` — sudah terbukti
    // menghasilkan jenjang berjarak yang tarifnya ada di seed.
    const id = await permintaanPada("mitra_siap", MITRA, {
      alamat_lat: -7.9666,
      alamat_lon: 112.6966,
    });
    const sebelum = Date.now();
    expect(await terbitkanTagihan(id)).toEqual({ ok: true });

    const { data } = await admin
      .from("booking_requests")
      .select("status, tenggat")
      .eq("id", id)
      .maybeSingle<{ status: string; tenggat: string | null }>();
    expect(data?.status).toBe("menunggu_bayar");
    expect(data?.tenggat).not.toBeNull();
    // ~24 jam sejak sekarang (spec C2 P1) — batas longgar, cukup untuk
    // membuktikan tenggatnya diisi SERVER, bukan disodorkan kosong.
    const tenggatMs = Date.parse(data!.tenggat!);
    expect(tenggatMs).toBeGreaterThan(sebelum + 23 * 3_600_000);
    expect(tenggatMs).toBeLessThan(Date.now() + 25 * 3_600_000);
  });

  it("dipanggil DUA KALI tidak memperpanjang tenggat — yang kedua ditolak", async () => {
    // Lihat catatan pada uji sebelumnya: koordinat ini WAJIB supaya gerbang
    // Task 4 tidak menolak penerbitan yang pertama.
    const id = await permintaanPada("mitra_siap", MITRA, {
      alamat_lat: -7.9666,
      alamat_lon: 112.6966,
    });
    expect(await terbitkanTagihan(id)).toEqual({ ok: true });

    const { data: pertama } = await admin
      .from("booking_requests")
      .select("tenggat")
      .eq("id", id)
      .single<{ tenggat: string }>();

    const kedua = await terbitkanTagihan(id);
    expect(kedua.ok).toBe(false);

    const { data: sesudah } = await admin
      .from("booking_requests")
      .select("status, tenggat")
      .eq("id", id)
      .single<{ status: string; tenggat: string }>();
    expect(sesudah!.status).toBe("menunggu_bayar");
    expect(sesudah!.tenggat).toBe(pertama!.tenggat);
  });
});

describe("konfirmasi hanya dari menunggu_bayar DAN lunas (spec C2 — inti)", () => {
  it("MENOLAK permintaan yang masih diminta — lompatan tidak boleh", async () => {
    const id = await permintaanPada("diminta");
    const hasil = await konfirmasiPermintaan(id);
    expect(hasil.ok).toBe(false);
    expect(await sesiDari(id)).toEqual([]);
  });

  it("MENOLAK permintaan menunggu_bayar yang status_bayar BELUM lunas", async () => {
    // Inti C2: `mitra_siap -> dikonfirmasi` langsung sudah dihapus dari peta
    // perpindahan, tapi itu saja tidak cukup — seseorang yang menembak
    // `status='menunggu_bayar'` tanpa pernah membayar tidak boleh lolos lewat
    // sini juga. Syaratnya hidup DI DALAM `konfirmasi_permintaan()` sendiri
    // (security definer), bukan di server action.
    const id = await permintaanPada("menunggu_bayar", MITRA, { tenggat: tenggatJauh() });
    // status_bayar default 'belum' (migration status_bayar_pagar) — tidak
    // ditulis eksplisit supaya test ini juga membuktikan defaultnya benar.
    const hasil = await konfirmasiPermintaan(id);
    expect(hasil.ok).toBe(false);
    expect(await statusPermintaan(id)).toBe("menunggu_bayar");
    expect(await sesiDari(id)).toEqual([]);
  });

  it("sesi mewarisi mitra dan JAM dari baris permintaan", async () => {
    const id = await permintaanSiapKonfirmasi();
    expect(await konfirmasiPermintaan(id)).toEqual({ ok: true });

    const sesi = await sesiDari(id);
    expect(sesi.length).toBe(1);
    expect(sesi[0].partner_id).toBe(MITRA);
    expect(sesi[0].jam_mulai).toBe("09:00:00");
    expect(sesi[0].status).toBe("terjadwal");
  });

  it("DUA konfirmasi bersamaan tetap melahirkan TEPAT SATU sesi", async () => {
    // Pengerasan lama tidak boleh hilang saat rantai diperpanjang MAUPUN saat
    // konfirmasi pindah ke dalam fungsi Postgres. Kegagalannya berbentuk klien
    // kedatangan bidan dua kali, tanpa satu pun error.
    const id = await permintaanSiapKonfirmasi();
    const hasil = await Promise.all([konfirmasiPermintaan(id), konfirmasiPermintaan(id)]);
    expect(hasil.filter((h) => h.ok).length).toBe(1);
    expect((await sesiDari(id)).length).toBe(1);
  });
});

describe("konfirmasi_permintaan() sebagai RPC — pagar di dalam fungsinya", () => {
  it("KLIEN yang login tidak bisa memanggilnya langsung", async () => {
    // `security definer` mematikan RLS, jadi penjaga perannya harus hidup DI
    // DALAM fungsi. Tanpa itu, klien mana pun bisa mengonfirmasi permintaan
    // jadwalnya sendiri lewat satu panggilan RPC.
    const id = await permintaanPada("mitra_siap", MITRA);
    const sesiKlien = await signInAs("ananda@padma.test");
    const { error } = await sesiKlien.rpc("konfirmasi_permintaan", { permintaan_id: id });
    expect(error).not.toBeNull();
    expect(await statusPermintaan(id)).toBe("mitra_siap");
    expect(await sesiDari(id)).toEqual([]);
  });

  it("anon tidak punya hak EXECUTE atasnya", async () => {
    const baris = await querySql<{ ada: boolean }>(
      `select has_function_privilege('anon',
         'public.konfirmasi_permintaan(uuid)', 'execute') as ada`,
    );
    expect(baris[0].ada).toBe(false);
  });

  it("TIDAK menerima nilai turunan apa pun sebagai argumen — hanya id permintaan", async () => {
    // Pagar STRUKTURAL. Versi pertama uji ini hanya memeriksa bahwa
    // `jenjang_sumber` bukan argumen — dan hijau untuk lubang yang masih
    // terbuka: `jenjang` SENDIRI tetap dioper pemanggil, lalu dicap 'otomatis'
    // oleh fungsi. Admin yang memanggil RPC langsung bisa menyodorkan jenjang
    // karangan dan mendapatkannya tercatat sebagai hasil hitungan mesin.
    //
    // Sekarang yang dijaga adalah SELURUH daftar argumennya: satu id, titik.
    // Setiap nilai turunan yang kelak ingin dioper masuk harus mengalahkan uji
    // ini lebih dulu, dan itulah maksudnya.
    const baris = await querySql<{ args: string }>(
      `select pg_get_function_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'konfirmasi_permintaan'`,
    );
    expect(baris.length).toBe(1);
    expect(baris[0].args.trim()).toBe("permintaan_id uuid");
  });

  it("menuliskan jenjang_sumber='otomatis' sendiri ketika ada saran", async () => {
    const id = await permintaanSiapKonfirmasi();
    await konfirmasiPermintaan(id);
    const sesi = await sesiDari(id);
    // Bila koordinat fixture menghasilkan saran, sumbernya wajib 'otomatis';
    // bila tidak ada saran, keduanya NULL. Yang dilarang adalah kombinasi
    // "ada jenjang tapi sumbernya bukan otomatis" dari jalur ini.
    if (sesi[0].jenjang !== null) expect(sesi[0].jenjang_sumber).toBe("otomatis");
    else expect(sesi[0].jenjang_sumber).toBeNull();
  });

  it("memulangkan NULL — bukan galat — ketika permintaannya sudah tidak menunggu_bayar", async () => {
    const id = await permintaanPada("diminta");
    const { data, error } = await sesiAdmin.rpc("konfirmasi_permintaan", {
      permintaan_id: id,
    });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

describe("trigger perpindahan menahan tembakan langsung ke DB", () => {
  it("update diminta -> dikonfirmasi ditolak, bahkan tanpa lewat action", async () => {
    // Pola tests/money-firewall-struktural.test.ts: pagar yang hanya diuji
    // lewat action adalah pagar yang belum dibuktikan ada.
    const id = await permintaanPada("diminta");
    await expect(
      querySql("update public.booking_requests set status = 'dikonfirmasi' where id = $1", [id]),
    ).rejects.toThrow(/perpindahan status permintaan tidak sah/);
    expect(await statusPermintaan(id)).toBe("diminta");
  });

  it("mitra_siap tanpa partner_id ditolak CHECK", async () => {
    const id = await permintaanPada("mencari_mitra");
    await expect(
      querySql("update public.booking_requests set status = 'mitra_siap' where id = $1", [id]),
    ).rejects.toThrow(/booking_requests_mitra_siap_bermitra/);
  });

  it("update mitra_siap -> dikonfirmasi ditolak — jalan wajib lewat menunggu_bayar", async () => {
    // Seluruh inti C2: `mitra_siap -> dikonfirmasi` langsung DIHAPUS dari peta
    // perpindahan (migration `status_bayar_pagar`). Dulu ini panah SAH — tes
    // ini dulu membuktikan sebaliknya untuk `diminta`; sekarang ia membuktikan
    // panah yang tadinya sah pun sudah ditutup.
    const id = await permintaanPada("mitra_siap", MITRA);
    await expect(
      querySql("update public.booking_requests set status = 'dikonfirmasi' where id = $1", [id]),
    ).rejects.toThrow(/perpindahan status permintaan tidak sah/);
    expect(await statusPermintaan(id)).toBe("mitra_siap");
  });
});
