/**
 * Modul Sesi — menjadwalkan langsung & menyelesaikan dengan catatan bidan.
 *
 * Ini INTI NILAI PRODUK, dan karena itu test di berkas ini sengaja tidak
 * berhenti pada "baris berubah". Yang dibuktikan adalah rantai penuhnya:
 * admin menekan "Tandai selesai" → catatan bidan terbaca KLIEN di passport,
 * progres paketnya bertambah, badge layanan itu terbit, dan materi layanan itu
 * ikut terbuka. Bila salah satu mata rantainya putus, aplikasi ini kehilangan
 * alasan keberadaannya — bukan sekadar satu fitur.
 *
 * Empat cara rantai itu pernah — atau gampang sekali — putus:
 *
 *  1. STATUS TUJUAN MENJADI PARAMETER. Bentuk celah "klien menyetujui
 *     permintaan jadwalnya sendiri" tembus persis karena nilai status datang
 *     dari luar. Karena itu `selesaikanSesi` tidak menerima status, dan tanda
 *     tangannya diuji.
 *
 *  2. PAKET MILIK ORANG LAIN. `client_package_id` yang datang dari formulir
 *     bisa menempelkan sesi seorang klien pada paket klien lain — progres
 *     orang itu bertambah tanpa ia pernah dikunjungi. Paket karena itu DIBACA
 *     dari klien yang dipilih, bukan dari payload.
 *
 *  3. SESI BATAL DIHIDUPKAN. `update ... eq(id)` tanpa syarat status membuat
 *     sesi yang sudah dibatalkan — atau yang sudah selesai berikut catatannya —
 *     bisa ditimpa diam-diam.
 *
 *  4. UANG MENYELINAP. `selesaikanSesi` tidak boleh menyentuh `status_bayar`:
 *     ada jejak audit (`jejak_status_bayar`) yang justru kehilangan artinya
 *     bila status bayar ikut berubah sebagai efek samping "tandai selesai".
 *
 * Data uji memakai tanggal khusus (2026-12-27) dan dibersihkan di `afterEach`:
 * `passport-beranda.test.ts` meng-assert jumlah stempel Ananda PERSIS, jadi
 * tidak boleh ada sesi sisa yang menempel padanya.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { badgeDari, progresPaket, type SesiRingkas } from "@/lib/passport/turunan";
import { nominalDalam } from "./helpers/nominal";

const admin = createAdminSupabase();
// Alias mengikuti pola singkat yang dipakai berkas uji lain (mis.
// `admin-mitra.test.ts`) untuk baca/tulis lewat service role sebagai "bahan
// uji, bukan jalur yang diuji".
const svc = admin;
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

/** FormData dari pasangan medan — perkakas kecil untuk uji server action. */
function formOf(bidang: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(bidang)) fd.set(k, v);
  return fd;
}

const KLIEN = "44444444-4444-4444-4444-444444444401"; // Ananda (punya paket aktif)
const KLIEN_LAIN = "44444444-4444-4444-4444-444444444402"; // Rina (tanpa paket)
const PAKET = "55555555-5555-5555-5555-555555555501"; // Sankalpa Prima, 8 sesi
const SVC_BARU = "11111111-1111-1111-1111-111111111105"; // Prenatal Gentle Yoga
const SVC_MATERI = "11111111-1111-1111-1111-111111111106"; // Lactation Hero (punya materi)
const MATERI_TERKUNCI = "77777777-7777-7777-7777-777777777704"; // Panduan ASI Perah
const MITRA = "33333333-3333-3333-3333-333333333302"; // Bidan Dewi Lestari
const MITRA_NONAKTIF = "33333333-3333-3333-3333-3333333333e2";
const TGL = "2026-12-27";
const HANTU = "00000000-0000-0000-0000-000000000000";

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

// `redirect()` melempar di dalam request Next. Di test ia dijadikan error yang
// bisa dibaca supaya "penjaga peran hilang" menjadi MERAH, bukan senyap.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/admin/sesi",
  // `PanelGeser` (Task 3) dan `FormJadwalSesi` memakai `useRouter` — untuk
  // tombol Escape/overlay dan untuk `router.push(hrefTutup)` sesudah submit
  // berhasil. `renderToStaticMarkup` tidak menjalankan efeknya, tapi
  // pemanggilan `useRouter()` sendiri di badan komponen tetap butuh mock ini
  // (pola sama persis dengan `tests/admin-mitra.test.ts`).
  useRouter: () => ({ push: () => {} }),
}));

const { jadwalkanSesi, selesaikanSesi, tetapkanJenjang } = await import("@/app/admin/sesi/aksi");
const sesiMod = await import("@/lib/admin/sesi");
const { default: SesiPage } = await import("@/app/admin/sesi/page");

const sumberAksi = baca("src/app/admin/sesi/aksi.ts");
const sumberHalaman = baca("src/app/admin/sesi/page.tsx");
const sumberFormSesi = baca("src/app/admin/sesi/form-sesi.tsx");
// `form-selesai.tsx` (dua laci di dalam sel tabel) dihapus di Task 3 — isinya
// pindah ke `panel-sesi.tsx`, dirender di panel geser. Setiap asersi yang
// dulu memeriksa `sumberFormSelesai` sekarang memeriksa berkas ini.
const sumberPanelSesi = baca("src/app/admin/sesi/panel-sesi.tsx");
const sumberStatus = baca("src/app/admin/sesi/status.ts");

let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;
// Sejak Task 9 `sessions.variant_id` NOT NULL: id-nya lahir
// `gen_random_uuid()` saat migrasi/trigger berjalan, jadi tidak ada nilai
// tetap yang bisa ditulis literal di sini — dibaca dari basis data sekali di
// `beforeAll`. `VARIAN_MATERI` sengaja milik layanan LAIN (SVC_MATERI) dari
// `SVC_BARU` yang dipakai skenario "menolak varian milik layanan lain".
let VARIAN_BARU: string;
let VARIAN_MATERI: string;

// ---------------------------------------------------------------------------
// Perkakas
// ---------------------------------------------------------------------------

function fdJadwal(ubah: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("client_id", KLIEN);
  fd.set("service_id", SVC_BARU);
  fd.set("variant_id", VARIAN_BARU);
  fd.set("partner_id", MITRA);
  fd.set("tanggal", TGL);
  // `sessions.jam_mulai` NOT NULL sejak C1 (spec J2), dan `jadwalkanSesi`
  // memvalidasinya terhadap `app_settings.jam_layanan`. '09:00' ada di daftar
  // bawaan, jadi fixture ini tidak bergantung pada setelan yang disunting uji lain.
  fd.set("jam", "09:00");
  for (const [k, v] of Object.entries(ubah)) {
    if (v === "") fd.delete(k);
    else fd.set(k, v);
  }
  return fd;
}

function fdSelesai(catatan: string, rekomendasi = "") {
  const fd = new FormData();
  fd.set("catatan", catatan);
  fd.set("rekomendasi", rekomendasi);
  return fd;
}

/** Sesi langsung lewat service role — bahan uji, bukan jalur yang diuji. */
async function buatSesi(
  status: "terjadwal" | "dibatalkan_padma" | "selesai",
  opsi: { denganPaket?: boolean; serviceId?: string; catatan?: string } = {},
) {
  const serviceId = opsi.serviceId ?? SVC_BARU;
  const { data, error } = await admin
    .from("sessions")
    .insert({
      client_id: KLIEN,
      service_id: serviceId,
      variant_id: await varianBaku(admin, serviceId),
      partner_id: MITRA,
      tanggal: TGL,
      status,
      catatan: opsi.catatan ?? "",
      rekomendasi: "",
      client_package_id: opsi.denganPaket ? PAKET : null,
      jam_mulai: "09:00",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

/** Yang benar-benar TERBACA klien lewat RLS — bukan bacaan service role. */
async function sesiKlienBaca() {
  const { data } = await sesiKlien
    .from("sessions")
    .select("id, service_id, status, catatan, rekomendasi, client_package_id")
    .returns<
      {
        id: string;
        service_id: string;
        status: string;
        catatan: string | null;
        rekomendasi: string | null;
        client_package_id: string | null;
      }[]
    >();
  return data ?? [];
}

/** Pemetaan baris DB -> bentuk yang dipakai kalkulasi turunan passport. */
function petakan(r: {
  id: string;
  service_id: string;
  status: string;
  catatan: string | null;
  rekomendasi: string | null;
  client_package_id: string | null;
}): SesiRingkas {
  return {
    id: r.id,
    serviceId: r.service_id,
    namaLayanan: "",
    namaMitra: "",
    tanggal: "2026-01-01",
    status: r.status as SesiRingkas["status"],
    clientPackageId: r.client_package_id,
    catatan: r.catatan ?? "",
    rekomendasi: r.rekomendasi ?? "",
    statusBayar: "belum",
    jenjang: null,
    varian: { label: "", durasiMenit: null, format: null },
  };
}

async function sesiDb(id: string) {
  const { data } = await admin
    .from("sessions")
    .select("id, client_id, service_id, partner_id, tanggal, status, catatan, rekomendasi, client_package_id, status_bayar")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      client_id: string;
      service_id: string;
      partner_id: string;
      tanggal: string;
      status: string;
      catatan: string;
      rekomendasi: string;
      client_package_id: string | null;
      status_bayar: string;
    }>();
  return data;
}

async function bersihkan() {
  await admin.from("sessions").delete().eq("tanggal", TGL);
}

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
  ref.sesi = sesiAdmin;
  VARIAN_BARU = await varianBaku(admin, SVC_BARU);
  VARIAN_MATERI = await varianBaku(admin, SVC_MATERI);

  await admin.from("partners").upsert(
    {
      id: MITRA_NONAKTIF,
      nama: "PAD-UJI Bidan Purna",
      no_hp: "0811-9200-0001",
      aktif: false,
    },
    { onConflict: "id" },
  );
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  jejak.revalidate.length = 0;
  await bersihkan();
});

afterEach(bersihkan);

afterAll(async () => {
  await bersihkan();
  await admin.from("partners").delete().eq("id", MITRA_NONAKTIF);
});

// ---------------------------------------------------------------------------
// Rantai nilai: catatan bidan sampai ke passport klien
// ---------------------------------------------------------------------------

describe("menyelesaikan sesi mengalir ke passport klien", () => {
  it("catatan & rekomendasi benar-benar terbaca klien lewat RLS-nya sendiri", async () => {
    const id = await buatSesi("terjadwal", { denganPaket: true });

    const r = await selesaikanSesi(
      id,
      fdSelesai(
        "Respons tubuh sangat baik pada sesi ini.",
        "Lanjutkan latihan napas 3x sepekan.",
      ),
    );
    expect(r.ok).toBe(true);

    // Dibaca sebagai ANANDA, bukan service role: yang diuji adalah apa yang
    // sampai ke passport, bukan apa yang tersimpan.
    const milikKlien = (await sesiKlienBaca()).find((s) => s.id === id);
    expect(milikKlien).toBeDefined();
    expect(milikKlien!.status).toBe("selesai");
    expect(milikKlien!.catatan).toContain("Respons tubuh sangat baik");
    expect(milikKlien!.rekomendasi).toContain("latihan napas");
  });

  it("progres paket bertambah tepat satu setelah sesi diselesaikan", async () => {
    const sebelum = progresPaket({
      totalSesi: 8,
      sesi: (await sesiKlienBaca()).map(petakan),
    });

    const id = await buatSesi("terjadwal", { denganPaket: true });
    await selesaikanSesi(id, fdSelesai("Sesi berjalan lancar."));

    const sesudah = progresPaket({
      totalSesi: 8,
      sesi: (await sesiKlienBaca()).map(petakan),
    });
    expect(sesudah!.selesai).toBe(sebelum!.selesai + 1);
  });

  it("badge baru terbit untuk layanan yang pertama kali selesai", async () => {
    const sebelum = badgeDari((await sesiKlienBaca()).map(petakan)).map((b) => b.serviceId);
    expect(sebelum).not.toContain(SVC_BARU);

    const id = await buatSesi("terjadwal", { denganPaket: true });
    await selesaikanSesi(id, fdSelesai("Sesi perdana Prenatal Yoga."));

    const sesudah = badgeDari((await sesiKlienBaca()).map(petakan)).map((b) => b.serviceId);
    expect(sesudah).toContain(SVC_BARU);
  });

  it("materi layanan itu ikut TERBUKA untuk klien — sebelumnya terkunci", async () => {
    // Lactation Hero sengaja tidak pernah dijalani Ananda di seed, dan
    // materinya punya halaman (lihat supabase/seed.sql). Ini membuat gating
    // benar-benar berpindah keadaan, bukan sekadar "0 sebelum, 0 sesudah".
    const bacaHalaman = async () => {
      const { data } = await sesiKlien
        .from("material_pages")
        .select("halaman")
        .eq("material_id", MATERI_TERKUNCI);
      return (data ?? []).length;
    };

    expect(await bacaHalaman()).toBe(0); // terkunci

    const id = await buatSesi("terjadwal", { denganPaket: true, serviceId: SVC_MATERI });
    await selesaikanSesi(id, fdSelesai("Sesi laktasi pertama."));

    expect(await bacaHalaman()).toBeGreaterThan(0); // terbuka
  });

  it("sesi BATAL tidak menambah progres maupun badge", async () => {
    const sebelum = progresPaket({
      totalSesi: 8,
      sesi: (await sesiKlienBaca()).map(petakan),
    });

    await buatSesi("dibatalkan_padma", { denganPaket: true });

    const sesudah = progresPaket({
      totalSesi: 8,
      sesi: (await sesiKlienBaca()).map(petakan),
    });
    expect(sesudah!.selesai).toBe(sebelum!.selesai);
    expect(badgeDari((await sesiKlienBaca()).map(petakan)).map((b) => b.serviceId))
      .not.toContain(SVC_BARU);
  });

  it("menyegarkan cache passport klien, bukan hanya panel admin", async () => {
    const id = await buatSesi("terjadwal", { denganPaket: true });
    await selesaikanSesi(id, fdSelesai("Sesi berjalan lancar."));
    expect(jejak.revalidate).toContain("/admin/sesi");
    expect(jejak.revalidate).toContain("/passport");
  });
});

// ---------------------------------------------------------------------------
// selesaikanSesi — pagar
// ---------------------------------------------------------------------------

describe("pagar selesaikanSesi", () => {
  it("tanda tangan action TIDAK menerima status dari pemanggil", () => {
    expect(selesaikanSesi.length).toBe(2); // (sesiId, formData) saja
    for (const pola of [
      /function\s+selesaikanSesi\([^)]*status\s*:/,
      /function\s+selesaikanSesi\([^)]*statusBaru\s*:/,
    ]) {
      expect(sumberAksi).not.toMatch(pola);
    }
    expect(sumberAksi).toMatch(/status:\s*"selesai"/);
  });

  it("catatan kosong ditolak — sesi tetap terjadwal", async () => {
    // Catatan adalah satu-satunya hal yang klien terima dari sesi ini. Sesi
    // "selesai" tanpa catatan adalah stempel kosong di passport.
    const id = await buatSesi("terjadwal", { denganPaket: true });
    const r = await selesaikanSesi(id, fdSelesai("   "));
    expect(r.ok).toBe(false);
    expect((await sesiDb(id))!.status).toBe("terjadwal");
  });

  it("sesi BATAL tidak bisa dihidupkan menjadi selesai", async () => {
    const id = await buatSesi("dibatalkan_padma", { denganPaket: true });
    const r = await selesaikanSesi(id, fdSelesai("Coba hidupkan."));
    expect(r.ok).toBe(false);
    expect((await sesiDb(id))!.status).toBe("dibatalkan_padma");
    expect((await sesiDb(id))!.catatan).toBe("");
  });

  it("sesi yang sudah selesai tidak bisa ditimpa catatannya", async () => {
    const id = await buatSesi("selesai", {
      denganPaket: true,
      catatan: "Catatan asli dari bidan.",
    });
    const r = await selesaikanSesi(id, fdSelesai("Catatan pengganti."));
    expect(r.ok).toBe(false);
    expect((await sesiDb(id))!.catatan).toBe("Catatan asli dari bidan.");
  });

  it("sesi yang tidak ada ditolak, bukan 'ok' palsu", async () => {
    // UPDATE yang tidak mengenai baris mana pun dijawab PostgREST 200 + [].
    const r = await selesaikanSesi(HANTU, fdSelesai("Sesi hantu."));
    expect(r.ok).toBe(false);
  });

  it("catatan sangat panjang ditolak, tidak diam-diam dipotong", async () => {
    const id = await buatSesi("terjadwal", { denganPaket: true });
    const r = await selesaikanSesi(id, fdSelesai("x".repeat(5000)));
    expect(r.ok).toBe(false);
    expect((await sesiDb(id))!.status).toBe("terjadwal");
  });

  it("TIDAK menyentuh status_bayar (jejak audit tetap berarti)", async () => {
    const id = await buatSesi("terjadwal", { denganPaket: true });

    const { count: jejakSebelum } = await admin
      .from("jejak_status_bayar")
      .select("*", { count: "exact", head: true })
      .eq("sesi_id", id);

    await selesaikanSesi(id, fdSelesai("Sesi berjalan lancar."));

    expect((await sesiDb(id))!.status_bayar).toBe("belum");
    const { count: jejakSesudah } = await admin
      .from("jejak_status_bayar")
      .select("*", { count: "exact", head: true })
      .eq("sesi_id", id);
    expect(jejakSesudah ?? 0).toBe(jejakSebelum ?? 0);

    expect(sumberAksi).not.toContain("status_bayar");
  });

  it("PENJAGA PERAN: klien yang login tidak bisa menyelesaikan sesinya sendiri", async () => {
    const id = await buatSesi("terjadwal", { denganPaket: true });
    ref.sesi = sesiKlien;
    await expect(selesaikanSesi(id, fdSelesai("Saya nyatakan selesai."))).rejects.toThrow(
      /REDIRECT/,
    );
    expect((await sesiDb(id))!.status).toBe("terjadwal");
  });

  it("PAGAR DB: klien tidak bisa menulis catatannya sendiri lewat REST", async () => {
    // Tidak ada policy UPDATE untuk klien: PostgREST menjawab 200 + [] tanpa
    // error, jadi nilainya WAJIB dibaca ulang.
    const id = await buatSesi("terjadwal", { denganPaket: true });
    const { data: ubah } = await sesiKlien
      .from("sessions")
      .update({ status: "selesai", catatan: "Ditulis sendiri." })
      .eq("id", id)
      .select("id");
    expect(ubah ?? []).toHaveLength(0);
    expect((await sesiDb(id))!.status).toBe("terjadwal");
  });
});

// ---------------------------------------------------------------------------
// jadwalkanSesi
// ---------------------------------------------------------------------------

describe("menjadwalkan sesi langsung", () => {
  it("membuat satu sesi terjadwal dari medan formulir", async () => {
    const r = await jadwalkanSesi(fdJadwal());
    expect(r.ok).toBe(true);

    const { data } = await admin
      .from("sessions")
      .select(
        "client_id, service_id, variant_id, partner_id, tanggal, status, catatan, client_package_id",
      )
      .eq("tanggal", TGL);
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({
      client_id: KLIEN,
      service_id: SVC_BARU,
      variant_id: VARIAN_BARU,
      partner_id: MITRA,
      tanggal: TGL,
      status: "terjadwal",
      catatan: "",
      client_package_id: null, // tanpa centang paket
    });
    expect(jejak.revalidate).toContain("/passport");
  });

  it("tanda tangan action hanya menerima formulir — tanpa status", () => {
    expect(jadwalkanSesi.length).toBe(1);
    for (const pola of [
      /function\s+jadwalkanSesi\([^)]*status\s*:/,
      /function\s+jadwalkanSesi\([^)]*statusBaru\s*:/,
    ]) {
      expect(sumberAksi).not.toMatch(pola);
    }
    expect(sumberAksi).not.toMatch(/formData\.get\(\s*"status"/);
  });

  it("centang paket memakai paket AKTIF milik klien itu sendiri", async () => {
    const r = await jadwalkanSesi(fdJadwal({ pakai_paket: "on" }));
    expect(r.ok).toBe(true);

    const { data } = await admin
      .from("sessions")
      .select("client_package_id")
      .eq("tanggal", TGL);
    expect(data![0].client_package_id).toBe(PAKET);
  });

  it("paket TIDAK PERNAH datang dari formulir — paket klien lain tidak bisa disuntikkan", async () => {
    // Bila `client_package_id` dibaca dari payload, satu POST yang dikarang
    // menambah progres paket orang lain tanpa ia pernah dikunjungi.
    const r = await jadwalkanSesi(
      fdJadwal({ client_id: KLIEN_LAIN, client_package_id: PAKET, pakai_paket: "on" }),
    );
    expect(r.ok).toBe(true);

    const { data } = await admin
      .from("sessions")
      .select("client_id, client_package_id")
      .eq("tanggal", TGL);
    expect(data![0].client_id).toBe(KLIEN_LAIN);
    expect(data![0].client_package_id).toBeNull(); // Rina tidak punya paket aktif
    expect(sumberAksi).not.toMatch(/formData\.get\(\s*"client_package_id"/);
  });

  it("mitra NONAKTIF ditolak, walau daftar pilihan UI sudah menyaringnya", async () => {
    // Server action adalah endpoint POST tersendiri yang tidak pernah melewati
    // UI itu; foreign key hanya menolak mitra yang TIDAK ADA.
    const r = await jadwalkanSesi(fdJadwal({ partner_id: MITRA_NONAKTIF }));
    expect(r.ok).toBe(false);
    const { data } = await admin.from("sessions").select("id").eq("tanggal", TGL);
    expect(data ?? []).toHaveLength(0);
  });

  it("klien, layanan, varian, dan mitra yang tidak ada ditolak tanpa sesi yatim", async () => {
    for (const medan of ["client_id", "service_id", "variant_id", "partner_id"]) {
      const r = await jadwalkanSesi(fdJadwal({ [medan]: HANTU }));
      expect(r.ok).toBe(false);
    }
    const { data } = await admin.from("sessions").select("id").eq("tanggal", TGL);
    expect(data ?? []).toHaveLength(0);
  });

  it("menolak sesi tanpa varian", async () => {
    const r = await jadwalkanSesi(fdJadwal({ variant_id: "" }));
    expect(r.ok).toBe(false);
    const { data } = await admin.from("sessions").select("id").eq("tanggal", TGL);
    expect(data ?? []).toHaveLength(0);
  });

  it("menolak varian milik layanan lain", async () => {
    // VARIAN_MATERI milik SVC_MATERI, dipasangkan sengaja dengan SVC_BARU —
    // FK gabungan `sessions_varian_milik_layanan` tetap lapisan terakhir,
    // tapi query di action ini wajib menolaknya lebih dulu dengan KALIMAT.
    const r = await jadwalkanSesi(fdJadwal({ variant_id: VARIAN_MATERI }));
    expect(r.ok).toBe(false);
    // Bukti bahwa penolakan berasal dari QUERY PRA-INSERT (kalimat), bukan
    // dari FK gabungan yang jatuh sampai ke pesan generik "Gagal menyimpan
    // jadwal sesi." — bila query itu dihapus, FK tetap menahan insert-nya
    // tapi PESANNYA berubah, dan hanya asersi pesan yang menangkap itu.
    expect(r.ok === false && r.pesan).toBe("Varian tidak tersedia untuk layanan ini.");
    const { data } = await admin.from("sessions").select("id").eq("tanggal", TGL);
    expect(data ?? []).toHaveLength(0);
  });

  it("menyimpan variant_id yang dipilih", async () => {
    const r = await jadwalkanSesi(fdJadwal());
    expect(r.ok).toBe(true);
    const { data } = await admin
      .from("sessions")
      .select("variant_id")
      .eq("tanggal", TGL)
      .single();
    expect(data!.variant_id).toBe(VARIAN_BARU);
  });

  it("menolak varian yang sudah dinonaktifkan admin, walau tetap milik layanan yang benar", async () => {
    // Pasangan uji "mitra NONAKTIF ditolak" & "layanan tidak tersedia" di
    // atas, untuk VARIAN: kombinasi service_id + variant_id di sini SAH,
    // hanya `aktif`-nya yang dimatikan — menghapus `.eq("aktif", true)` dari
    // query varian akan meloloskan ini walau "menolak varian milik layanan
    // lain" (pasangan yang salah) tetap tertangkap.
    await admin.from("service_variants").update({ aktif: false }).eq("id", VARIAN_BARU);
    try {
      const r = await jadwalkanSesi(fdJadwal());
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.pesan).toBe("Varian tidak tersedia untuk layanan ini.");
      const { data } = await admin.from("sessions").select("id").eq("tanggal", TGL);
      expect(data ?? []).toHaveLength(0);
    } finally {
      // Dikembalikan aktif: VARIAN_BARU dipakai berkas ini di banyak test
      // lain, dan test-test itu tidak boleh mewarisi keadaan nonaktif.
      await admin.from("service_variants").update({ aktif: true }).eq("id", VARIAN_BARU);
    }
  });

  it("tanggal yang bukan YYYY-MM-DD ditolak sebelum menyentuh basis data", async () => {
    for (const tgl of ["", "27/12/2026", "2026-13-40", "besok"]) {
      const r = await jadwalkanSesi(fdJadwal({ tanggal: tgl || "" }));
      expect(r.ok).toBe(false);
    }
    const { data } = await admin.from("sessions").select("id").eq("tanggal", TGL);
    expect(data ?? []).toHaveLength(0);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa menjadwalkan sesi", async () => {
    ref.sesi = sesiKlien;
    await expect(jadwalkanSesi(fdJadwal())).rejects.toThrow(/REDIRECT/);
    const { data } = await admin.from("sessions").select("id").eq("tanggal", TGL);
    expect(data ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// jadwalkanSesi — jenjang transport (Ruling 11: dihitung & disimpan di sini,
// bukan lewat aksi terpisah, karena inilah layar tempat mitra DITUGASKAN dan
// kedua koordinat sudah diketahui).
// ---------------------------------------------------------------------------

describe("jadwalkanSesi menghitung & menyimpan jenjang transport", () => {
  // Titik yang sama persis -> jarak 0 km -> "0_5" (lihat transport-saran.test.ts).
  const KOORD_SAMA = { lat: -6.9175, lon: 107.6191 };

  // Koordinat KLIEN & MITRA milik baris SEED yang dipakai berkas ini secara
  // luas — ditimpa sementara per test, dan SELALU dikembalikan ke NULL (bukan
  // "keadaan sebelumnya", yang mungkin sendiri tidak pasti) di afterEach.
  // Tanpa ini, koordinat palsu akan bocor ke berkas uji LAIN yang memakai baris
  // seed yang sama (mis. saran jenjang tiba-tiba muncul di test yang tidak
  // memintanya).
  afterEach(async () => {
    await admin.from("clients").update({ alamat_lat: null, alamat_lon: null }).eq("id", KLIEN);
    await admin.from("partners").update({ lat: null, lon: null }).eq("id", MITRA);
  });

  async function pasangKoordinat(mitra: { lat: number; lon: number } | null, klienKoord: { lat: number; lon: number } | null) {
    await admin
      .from("clients")
      .update({ alamat_lat: klienKoord?.lat ?? null, alamat_lon: klienKoord?.lon ?? null })
      .eq("id", KLIEN);
    await admin
      .from("partners")
      .update({ lat: mitra?.lat ?? null, lon: mitra?.lon ?? null })
      .eq("id", MITRA);
  }

  it("menyimpan jenjang OTOMATIS saat koordinat mitra & klien lengkap", async () => {
    await pasangKoordinat(KOORD_SAMA, KOORD_SAMA);

    const r = await jadwalkanSesi(fdJadwal());
    expect(r.ok).toBe(true);

    const { data } = await svc
      .from("sessions")
      .select("jenjang, jenjang_sumber, jenjang_alasan")
      .eq("tanggal", TGL)
      .single();
    expect(data!.jenjang).toBe("0_5");
    expect(data!.jenjang_sumber).toBe("otomatis");
    expect(data!.jenjang_alasan).toBe("");
  });

  it("jenjang tetap NULL bila salah satu koordinat kosong — bukan galat", async () => {
    // Hanya mitra yang punya koordinat; alamat default klien kosong.
    await pasangKoordinat(KOORD_SAMA, null);

    const r = await jadwalkanSesi(fdJadwal());
    expect(r.ok).toBe(true);

    const { data } = await svc
      .from("sessions")
      .select("jenjang, jenjang_sumber")
      .eq("tanggal", TGL)
      .single();
    expect(data!.jenjang).toBeNull();
    expect(data!.jenjang_sumber).toBeNull();
  });

  it("admin bisa menimpa saran SAAT membuat sesi, dengan alasan", async () => {
    await pasangKoordinat(KOORD_SAMA, KOORD_SAMA); // saran = "0_5"

    const r = await jadwalkanSesi(
      fdJadwal({ jenjang: "10_15", alasan: "Alamat sebenarnya di seberang, memutar jauh." }),
    );
    expect(r.ok).toBe(true);

    const { data } = await svc
      .from("sessions")
      .select("jenjang, jenjang_sumber, jenjang_alasan")
      .eq("tanggal", TGL)
      .single();
    expect(data!.jenjang).toBe("10_15");
    expect(data!.jenjang_sumber).toBe("admin");
    expect(data!.jenjang_alasan).toMatch(/memutar/);
  });

  it("menolak penimpaan tanpa alasan SAAT membuat sesi — sesi TIDAK jadi tersimpan", async () => {
    await pasangKoordinat(KOORD_SAMA, KOORD_SAMA); // saran = "0_5"

    const r = await jadwalkanSesi(fdJadwal({ jenjang: "10_15", alasan: "  " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pesan).toMatch(/alasan/i);

    // Bukan cuma jenjangnya yang batal — SELURUH sesi batal, supaya admin
    // tidak kaget menemukan sesi lain sudah terjadwal tanpa jenjang yang benar.
    const { data } = await admin.from("sessions").select("id").eq("tanggal", TGL);
    expect(data ?? []).toHaveLength(0);
  });

  it("menolak jenjang penimpaan yang bukan anggota enum, sebelum menulis apa pun", async () => {
    await pasangKoordinat(KOORD_SAMA, KOORD_SAMA);

    const r = await jadwalkanSesi(
      fdJadwal({ jenjang: "seberang_galaksi", alasan: "Alasan yang sah." }),
    );
    expect(r.ok).toBe(false);
    const { data } = await admin.from("sessions").select("id").eq("tanggal", TGL);
    expect(data ?? []).toHaveLength(0);
  });

  it("jenjang_sumber TIDAK BISA disuntik 'admin' lewat FormData saat mengikuti saran", async () => {
    // Keadaan tujuan tidak pernah datang dari FormData (pola berkas ini):
    // mengirim jenjang_sumber sebagai medan formulir tidak boleh mengubah apa
    // pun — server sendiri yang menyimpulkan 'otomatis' vs 'admin' dari
    // perbandingan dengan saran, bukan membaca klaim pemanggil.
    await pasangKoordinat(KOORD_SAMA, KOORD_SAMA); // saran = "0_5"

    const r = await jadwalkanSesi(fdJadwal({ jenjang_sumber: "admin" }));
    expect(r.ok).toBe(true);

    const { data } = await svc
      .from("sessions")
      .select("jenjang, jenjang_sumber")
      .eq("tanggal", TGL)
      .single();
    expect(data!.jenjang).toBe("0_5");
    expect(data!.jenjang_sumber).toBe("otomatis"); // bukan 'admin' yang disuntikkan
  });
});

// ---------------------------------------------------------------------------
// tetapkanJenjang — penimpaan admin
// ---------------------------------------------------------------------------

describe("tetapkanJenjang — penimpaan admin", () => {
  let sesiId: string;

  beforeEach(async () => {
    sesiId = await buatSesi("terjadwal", { denganPaket: true });
  });

  it("menyimpan jenjang beserta sumbernya saat admin menimpa saran", async () => {
    const r = await tetapkanJenjang(
      formOf({ sesi: sesiId, jenjang: "10_15", alasan: "Alamat di seberang sungai, memutar." }),
    );
    expect(r.ok).toBe(true);

    const { data } = await svc
      .from("sessions")
      .select("jenjang, jenjang_sumber, jenjang_alasan")
      .eq("id", sesiId)
      .single();
    expect(data!.jenjang).toBe("10_15");
    expect(data!.jenjang_sumber).toBe("admin");
    expect(data!.jenjang_alasan).toMatch(/sungai/);
  });

  it("menolak penimpaan tanpa alasan, dengan KALIMAT", async () => {
    const r = await tetapkanJenjang(formOf({ sesi: sesiId, jenjang: "10_15", alasan: "  " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pesan).toMatch(/alasan/i);

    // Bukti bahwa penolakan adalah KALIMAT dari server action, bukan kode
    // Postgres dari CHECK `sessions_alasan_penimpaan` — baris di basis data
    // TIDAK berubah sama sekali, jadi CHECK itu tidak pernah sempat diuji.
    const { data } = await svc
      .from("sessions")
      .select("jenjang, jenjang_sumber")
      .eq("id", sesiId)
      .single();
    expect(data!.jenjang).toBeNull();
    expect(data!.jenjang_sumber).toBeNull();
  });

  it("menolak jenjang yang bukan anggota enum jenjang_transport", async () => {
    const r = await tetapkanJenjang(
      formOf({ sesi: sesiId, jenjang: "seberang_galaksi", alasan: "Alasan yang sah." }),
    );
    expect(r.ok).toBe(false);
    const { data } = await svc.from("sessions").select("jenjang").eq("id", sesiId).single();
    expect(data!.jenjang).toBeNull();
  });

  it("sesi yang tidak ada ditolak, bukan 'ok' palsu", async () => {
    const r = await tetapkanJenjang(
      formOf({ sesi: HANTU, jenjang: "10_15", alasan: "Alasan yang sah." }),
    );
    expect(r.ok).toBe(false);
  });

  it("jenjang_sumber SELALU 'admin' di jalur ini — tidak pernah dari FormData", async () => {
    // Keadaan tujuan tidak pernah datang dari FormData (pola yang sama dengan
    // `selesaikanSesi`/`konfirmasiPermintaan`): mengirim `jenjang_sumber`
    // sebagai medan formulir tidak boleh mengubah apa pun.
    const r = await tetapkanJenjang(
      formOf({
        sesi: sesiId,
        jenjang: "5_10",
        alasan: "Alasan yang sah.",
        jenjang_sumber: "otomatis",
      }),
    );
    expect(r.ok).toBe(true);
    const { data } = await svc
      .from("sessions")
      .select("jenjang_sumber")
      .eq("id", sesiId)
      .single();
    expect(data!.jenjang_sumber).toBe("admin");
  });

  it("PENJAGA PERAN: klien yang login tidak bisa menimpa jenjang sesi", async () => {
    ref.sesi = sesiKlien;
    await expect(
      tetapkanJenjang(formOf({ sesi: sesiId, jenjang: "10_15", alasan: "Alasan yang sah." })),
    ).rejects.toThrow(/REDIRECT/);
    const { data } = await svc.from("sessions").select("jenjang").eq("id", sesiId).single();
    expect(data!.jenjang).toBeNull();
  });

  it("tidak memuat satu nominal pun di sumber modulnya", async () => {
    // Money firewall: admin menetapkan JENJANG, tidak pernah rupiah.
    const sumber = await baca("src/app/admin/sesi/form-sesi.tsx");
    expect(sumber).not.toContain("transport_rates");
    expect(sumber).not.toContain("tarif_klien");
  });
});

// ---------------------------------------------------------------------------
// Halaman /admin/sesi — daftar sesi
// ---------------------------------------------------------------------------

describe("daftar sesi di halaman /admin/sesi", () => {
  it("menampilkan sesi dengan nama klien, layanan, mitra, dan status", async () => {
    await buatSesi("terjadwal", { denganPaket: true });
    const markup = renderToStaticMarkup(await SesiPage({ searchParams: Promise.resolve({}) }));

    expect(markup).toContain("Ananda");
    expect(markup).toContain("Prenatal Gentle Yoga");
    expect(markup).toContain("Bidan Dewi Lestari");
    expect(markup).toContain("27 Desember 2026");
    expect(markup).toMatch(/Terjadwal/);
  });

  // Sejak Task 3, formulir "selesaikan sesi" hidup DI DALAM panel geser
  // (`panel-sesi.tsx`), bukan lagi di baris tabel — dibuka lewat
  // `?ubah=<id sesi>`. Tombol laci "Tandai selesai" (`form-selesai.tsx` lama)
  // dibuang: panelnya sendiri sudah menjadi gerbang, jadi formulirnya tampil
  // langsung begitu sesi berstatus terjadwal — tanpa toggle kedua.
  it("sesi terjadwal menawarkan formulir 'selesaikan sesi' di panel geser", async () => {
    const id = await buatSesi("terjadwal", { denganPaket: true });
    const markup = renderToStaticMarkup(
      await SesiPage({ searchParams: Promise.resolve({ ubah: id }) }),
    );
    expect(markup).toContain("Selesaikan sesi");
    expect(markup).toContain("Simpan · sesi selesai");
  });

  it("catatan bidan pada sesi selesai bisa dibaca kembali di panel", async () => {
    const id = await buatSesi("selesai", {
      denganPaket: true,
      catatan: "Catatan asli dari bidan.",
    });
    const markup = renderToStaticMarkup(
      await SesiPage({ searchParams: Promise.resolve({ ubah: id }) }),
    );
    expect(markup).toContain("Catatan asli dari bidan.");
  });

  it("tombol jadwal baru tidak memuat daftar klien sampai panel dibuka", async () => {
    // Sejak Task 3, `FormJadwalSesi` kehilangan gerbang buka/tutupnya sendiri:
    // yang tampil tertutup hanyalah tombol "+ Sesi baru" (`page.tsx`), dan
    // daftar pilihan klien/layanan/varian baru ditarik saat `?ubah=baru`
    // (lihat Ruling di brief Task 3). UUID klien karena itu tidak boleh
    // pernah ikut ke markup pada keadaan tertutup.
    const markup = renderToStaticMarkup(await SesiPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain("+ Sesi baru");
    expect(markup).not.toContain(KLIEN);
  });

  it("TIDAK ada nominal uang di seluruh modul sesi (money firewall)", async () => {
    await buatSesi("selesai", { denganPaket: true, catatan: "Catatan." });
    const markup = renderToStaticMarkup(await SesiPage({ searchParams: Promise.resolve({}) }));
    expect(nominalDalam(markup), "nominal bocor").toEqual([]);
    for (const sumber of [sumberHalaman, sumberFormSesi, sumberPanelSesi, sumberAksi]) {
      expect(nominalDalam(sumber), "nominal bocor").toEqual([]);
      expect(sumber).not.toContain("service_rates");
      expect(sumber).not.toContain("variant_rates");
      expect(sumber).not.toContain("honor_marks");
    }
  });

  it("sesi tanpa jenjang menawarkan koreksinya lewat 'ubah jenjang' di panel (Ruling 11)", async () => {
    // `buatSesi` menulis lewat service role tanpa jenjang — persis sesi yang
    // lahir dari `jadwalkanSesi` saat koordinatnya kosong. Label & formulir
    // koreksi sejak Task 3 hidup di panel geser, dibuka lewat `?ubah=<id>`.
    const id = await buatSesi("terjadwal", { denganPaket: true });
    const markup = renderToStaticMarkup(
      await SesiPage({ searchParams: Promise.resolve({ ubah: id }) }),
    );
    expect(markup).toContain("Jenjang: belum ditetapkan");
    expect(markup).toMatch(/ubah jenjang/i);
  });

  it("sesi dengan jenjang OTOMATIS menampilkan label jenjangnya di panel", async () => {
    const id = await buatSesi("terjadwal", { denganPaket: true });
    await admin
      .from("sessions")
      .update({ jenjang: "5_10", jenjang_sumber: "otomatis" })
      .eq("id", id);

    const markup = renderToStaticMarkup(
      await SesiPage({ searchParams: Promise.resolve({ ubah: id }) }),
    );
    // `renderToStaticMarkup` meng-escape "&gt;" pada teks — LABEL_JENJANG
    // sendiri tetap ">5–10 km" (lihat status.ts), hanya markupnya yang beda.
    expect(markup).toContain("Jenjang: &gt;5–10 km · otomatis");
  });

  it("koreksi jenjang benar-benar tersambung ke tetapkanJenjang, bukan dekoratif", () => {
    // form-sesi.tsx (T7 ronde 1) sempat punya pemilih tanpa `name` yang tidak
    // pernah sampai ke FormData — inilah pagar supaya laci koreksi baris sesi
    // tidak jatuh ke cacat yang sama.
    expect(sumberPanelSesi).toContain("tetapkanJenjang(fd)");
    expect(sumberPanelSesi).toMatch(/name="sesi"/);
    expect(sumberPanelSesi).toMatch(/name="jenjang"/);
    expect(sumberPanelSesi).toMatch(/name="alasan"/);
  });
});

// ---------------------------------------------------------------------------
// Halaman /admin/sesi — bilah daftar, paginasi, panel geser (Task 3)
// ---------------------------------------------------------------------------

/**
 * Halaman ini kini menerima `searchParams` — Next 16 mengopernya sebagai
 * Promise. Dipanggil LANGSUNG dan di-`await` (bukan lewat `createElement`):
 * `SesiPage` adalah komponen server ASYNC, dan `renderToStaticMarkup` sendiri
 * tidak tahu cara menunggu Promise — memanggilnya lewat `createElement` lalu
 * merender elemennya lewat `renderToStaticMarkup` tanpa `await` melempar
 * "Objects are not valid as a React child", bukan markup. Pola yang sama
 * (panggil sebagai fungsi biasa, `await` hasilnya, BARU render) sudah dipakai
 * seluruh test lain di berkas ini dan di `admin-mitra.test.ts`.
 */
async function markupSesi(sp: Record<string, string> = {}) {
  return renderToStaticMarkup(await SesiPage({ searchParams: Promise.resolve(sp) }));
}

describe("halaman sesi — bilah daftar & panel geser", () => {
  it("punya kotak cari sebagai form GET, bukan komponen klien", async () => {
    const m = await markupSesi();
    expect(m).toContain('method="get"');
    expect(m).toContain('action="/admin/sesi"');
    expect(m).toContain('name="cari"');
  });

  it("chip saringan menaut, bukan menekan tombol", async () => {
    const m = await markupSesi();
    for (const href of [
      "/admin/sesi?status=terjadwal",
      "/admin/sesi?status=selesai",
      "/admin/sesi?jenjang=kosong",
      "/admin/sesi?waktu=pekan_ini",
    ]) {
      expect(m, `chip ${href} hilang`).toContain(`href="${href}"`);
    }
  });

  it("tombol baru membuka panel, BUKAN kartu yang mendorong isi halaman", async () => {
    const m = await markupSesi();
    expect(m).toContain('href="/admin/sesi?ubah=baru"');
    // Kartu putus-putus lama tidak boleh tersisa di keadaan tertutup.
    expect(m).not.toContain("border-dashed");
  });

  it("?ubah=baru membuka panel geser berisi formulir jadwal", async () => {
    const m = await markupSesi({ ubah: "baru" });
    expect(m).toContain('role="dialog"');
    expect(m).toContain('aria-modal="true"');
    expect(m).toContain('name="client_id"');
    expect(m).toContain('name="jenjang"');
  });

  it("id yang tidak ada di halaman ini TIDAK membuka panel kosong", async () => {
    const m = await markupSesi({ ubah: HANTU });
    expect(m).not.toContain('role="dialog"');
  });

  it("menutup panel mempertahankan cari, saringan, dan halaman", async () => {
    const m = await markupSesi({ cari: "ananda", status: "selesai", hal: "2", ubah: "baru" });
    expect(m).toContain('href="/admin/sesi?cari=ananda&amp;status=selesai&amp;hal=2"');
  });

  it("penjelasan halaman pindah ke tombol bantuan yang terlipat", async () => {
    const m = await markupSesi();
    expect(m).toContain("<details");
    expect(m).toContain("<summary");
  });

  it("atribusi OpenStreetMap tetap tampak tanpa membuka apa pun", async () => {
    // Kewajiban lisensi ODbL: atribusi harus tampak di LAYAR yang menampilkan
    // hasil geocoding. Kolom "Jenjang" tampil begitu halaman dimuat, jadi
    // atribusinya tidak boleh ikut pindah ke dalam panel yang mulai tertutup.
    const m = await markupSesi();
    expect(m).toContain("OpenStreetMap");
  });

  it("nol rupiah", async () => {
    expect(nominalDalam(await markupSesi())).toEqual([]);
    expect(nominalDalam(await markupSesi({ ubah: "baru" }))).toEqual([]);
  });

  it("pencarian yang tidak cocok menampilkan pesan pencarian, bukan tabel kosong", async () => {
    const m = await markupSesi({ cari: "zzz-tidak-ada-sesi-bernama-ini" });
    expect(m).toContain("Tidak ada sesi yang cocok dengan pencarian ini.");
  });

  it("daftar kosong TANPA pencarian/saringan aktif menampilkan kalimat hari-pertama, bukan kalimat pencarian", async () => {
    // BLOCKING 3 (review sapuan panel): "tidak cocok dengan pencarian ini"
    // pernah dirender untuk SETIAP daftar sesi kosong, termasuk klinik yang
    // belum pernah menjadwalkan satu sesi pun. `ambilDaftarSesi` di-spy
    // supaya baris kosong bisa diuji tanpa mengosongkan tabel `sessions`
    // yang dipakai bersama seluruh suite.
    const spy = vi
      .spyOn(sesiMod, "ambilDaftarSesi")
      .mockResolvedValue({ baris: [], total: 0 });
    try {
      const m = await markupSesi();
      expect(m).toContain("Belum ada sesi.");
      expect(m).not.toContain("cocok dengan pencarian ini");
    } finally {
      spy.mockRestore();
    }
  });

  // RULING (menggantikan draf Langkah 5 di brief Task 3): `BlokPermintaan`
  // (antrean permintaan, tampil DI ATAS bilah daftar) menerima prop `mitra`
  // yang sama dengan panel "Sesi baru", dan punya cabang sendiri yang
  // menampilkan "Belum ada mitra aktif —
  // daftarkan mitra dulu di menu Mitra" bila `mitra.length === 0`. Draf awal
  // brief menarik `pilihanMitra()` HANYA saat `ubah === "baru"`, yang berarti
  // kalimat itu muncul setiap kali panel tertutup — walau mitra aktif
  // sungguhan ada — karena `page.tsx` mengirim array kosong ke antreannya
  // sendiri. Tanpa pagar ini, koreksi tersebut bisa lenyap lagi di edit
  // berikutnya tanpa satu test pun menjadi merah.
  describe("mitra tetap tersedia untuk antrean permintaan walau panel tertutup", () => {
    const TGL_ANTREAN = "2026-12-29";
    let idPermintaanAntre = "";

    beforeAll(async () => {
      const { data, error } = await admin
        .from("booking_requests")
        .insert({
          client_id: KLIEN,
          service_id: SVC_BARU,
          variant_id: VARIAN_BARU,
          tanggal: TGL_ANTREAN,
          preferensi_waktu: "pagi",
          catatan: "Uji ruling mitra saat panel tertutup.",
          status: "diminta",
          jam_mulai: "09:00",
        })
        .select("id")
        .single();
      if (error) throw error;
      idPermintaanAntre = data!.id as string;
    });

    afterAll(async () => {
      await admin.from("booking_requests").delete().eq("id", idPermintaanAntre);
    });

    it("TIDAK menampilkan 'Belum ada mitra aktif' walau panel tertutup", async () => {
      const m = await markupSesi();
      // Bukti bahwa antreannya sungguh dirender pada test ini — tanpa baris
      // ini, test bisa hijau palsu karena blok antreannya sendiri gagal tampil.
      expect(m).toContain("Permintaan jadwal");
      expect(m).not.toContain("Belum ada mitra aktif");
    });
  });
});

// ---------------------------------------------------------------------------
// Bentuk berkas
// ---------------------------------------------------------------------------

describe("bentuk berkas modul sesi setelah ditambah dua action", () => {
  it("SETIAP action tetap memanggil requireRole(['admin','owner']) di dalam dirinya", () => {
    const jumlahAction = [...sumberAksi.matchAll(/^export\s+async\s+function\s+\w+/gm)].length;
    const jumlahGuard = [
      ...sumberAksi.matchAll(/await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/g),
    ].length;
    expect(jumlahAction).toBe(7); // cariMitra, pilihMitra, konfirmasi, tolak, jadwalkan, selesaikan, tetapkanJenjang
    expect(jumlahGuard).toBe(jumlahAction);
  });

  it("berkas 'use server' hanya mengekspor fungsi async", () => {
    const ekspor = [...sumberAksi.matchAll(/^export\s+(?!type\b)(\w+)/gm)].map((m) => m[1]);
    expect([...new Set(ekspor)]).toEqual(["async"]);
  });

  it("memakai sesi pengguna, bukan service role", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberFormSesi, sumberPanelSesi, sumberStatus]) {
      expect(sumber).not.toContain("createAdminSupabase");
      expect(sumber).not.toContain("SERVICE_ROLE");
    }
  });

  it("tanggal tidak pernah dihitung dengan aritmatika Date", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberFormSesi, sumberPanelSesi]) {
      expect(sumber).not.toContain("toISOString");
      expect(sumber).not.toContain("setDate(");
      expect(sumber).not.toContain("getDay(");
    }
  });

  it("tidak menuliskan data klien ke log", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberFormSesi, sumberPanelSesi]) {
      expect(sumber).not.toContain("console.");
    }
  });

  it("layout admin TIDAK ikut diubah (matriks peran tetap satu panggilan)", () => {
    const layout = baca("src/app/admin/layout.tsx");
    expect([...layout.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(layout).toMatch(/requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/);
    expect(baca("src/app/admin/page.tsx")).toContain('href="/admin/skrining"');
  });
});
