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

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

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
}));

const { jadwalkanSesi, selesaikanSesi } = await import("@/app/admin/sesi/aksi");
const { default: SesiPage } = await import("@/app/admin/sesi/page");

const sumberAksi = baca("src/app/admin/sesi/aksi.ts");
const sumberHalaman = baca("src/app/admin/sesi/page.tsx");
const sumberFormSesi = baca("src/app/admin/sesi/form-sesi.tsx");
const sumberFormSelesai = baca("src/app/admin/sesi/form-selesai.tsx");
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
  status: "terjadwal" | "batal" | "selesai",
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

    await buatSesi("batal", { denganPaket: true });

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
    const id = await buatSesi("batal", { denganPaket: true });
    const r = await selesaikanSesi(id, fdSelesai("Coba hidupkan."));
    expect(r.ok).toBe(false);
    expect((await sesiDb(id))!.status).toBe("batal");
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
// Halaman /admin/sesi — daftar sesi
// ---------------------------------------------------------------------------

describe("daftar sesi di halaman /admin/sesi", () => {
  it("menampilkan sesi dengan nama klien, layanan, mitra, dan status", async () => {
    await buatSesi("terjadwal", { denganPaket: true });
    const markup = renderToStaticMarkup(await SesiPage());

    expect(markup).toContain("Ananda");
    expect(markup).toContain("Prenatal Gentle Yoga");
    expect(markup).toContain("Bidan Dewi Lestari");
    expect(markup).toContain("27 Desember 2026");
    expect(markup).toMatch(/Terjadwal/);
  });

  it("sesi terjadwal menawarkan 'Tandai selesai'", async () => {
    await buatSesi("terjadwal", { denganPaket: true });
    const markup = renderToStaticMarkup(await SesiPage());
    expect(markup).toContain("Tandai selesai");
  });

  it("catatan bidan pada sesi selesai bisa dibaca kembali di panel", async () => {
    await buatSesi("selesai", {
      denganPaket: true,
      catatan: "Catatan asli dari bidan.",
    });
    const markup = renderToStaticMarkup(await SesiPage());
    expect(markup).toContain("Catatan asli dari bidan.");
  });

  it("formulir jadwal baru tertutup sampai dibuka — daftar dulu, bukan formulir", async () => {
    const markup = renderToStaticMarkup(await SesiPage());
    expect(markup).toMatch(/Jadwalkan sesi/i);
    // UUID klien tidak pernah ikut ke markup: daftar pilihan baru dirakit
    // setelah admin membuka formulirnya.
    expect(markup).not.toContain(KLIEN);
  });

  it("TIDAK ada nominal uang di seluruh modul sesi (money firewall)", async () => {
    await buatSesi("selesai", { denganPaket: true, catatan: "Catatan." });
    const markup = renderToStaticMarkup(await SesiPage());
    expect(markup).not.toMatch(/Rp\s?\d/);
    for (const sumber of [sumberHalaman, sumberFormSesi, sumberFormSelesai, sumberAksi]) {
      expect(sumber).not.toMatch(/Rp\s?\d/);
      expect(sumber).not.toContain("service_rates");
      expect(sumber).not.toContain("variant_rates");
      expect(sumber).not.toContain("honor_marks");
    }
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
    expect(jumlahAction).toBe(4); // konfirmasi, tolak, jadwalkan, selesaikan
    expect(jumlahGuard).toBe(jumlahAction);
  });

  it("berkas 'use server' hanya mengekspor fungsi async", () => {
    const ekspor = [...sumberAksi.matchAll(/^export\s+(?!type\b)(\w+)/gm)].map((m) => m[1]);
    expect([...new Set(ekspor)]).toEqual(["async"]);
  });

  it("memakai sesi pengguna, bukan service role", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberFormSesi, sumberFormSelesai, sumberStatus]) {
      expect(sumber).not.toContain("createAdminSupabase");
      expect(sumber).not.toContain("SERVICE_ROLE");
    }
  });

  it("tanggal tidak pernah dihitung dengan aritmatika Date", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberFormSesi, sumberFormSelesai]) {
      expect(sumber).not.toContain("toISOString");
      expect(sumber).not.toContain("setDate(");
      expect(sumber).not.toContain("getDay(");
    }
  });

  it("tidak menuliskan data klien ke log", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberFormSesi, sumberFormSelesai]) {
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
