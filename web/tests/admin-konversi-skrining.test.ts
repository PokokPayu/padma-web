/**
 * Konversi Skrining → Klien (`/admin/skrining`).
 *
 * Sampai hari ini `screenings.client_id` ada di skema tetapi TIDAK PERNAH diisi
 * kode mana pun: inbox dan daftar klien adalah dua dunia yang tidak bersentuhan,
 * dan satu-satunya penghubungnya adalah ingatan admin. Berkas ini menjaga jalur
 * yang menyambungkan keduanya, beserta empat kelas kegagalan senyapnya:
 *
 *  1. Penjaga peran hilang dari dalam server action. Server action adalah
 *     ENDPOINT POST TERSENDIRI — penjaga di `src/app/admin/layout.tsx` tidak
 *     pernah dilewati saat action dipanggil langsung. Tanpa
 *     `requireRole(["admin","owner"])` di dalamnya, seorang klien yang login
 *     bisa membuat baris `clients` untuk siapa pun lewat pintu ini.
 *
 *  2. Fase datang dari formulir. `screenings.fase` hanya mengenal empat nilai —
 *     `newborn` (Shishu) TIDAK pernah lahir dari skrining karena yang diskrining
 *     adalah ibunya. Bila fase boleh dikirim penyerang (atau salah diklik
 *     admin), bayi baru lahir mendapat rencana promil dan materi yang salah,
 *     tanpa satu pun error: `phases.id` itu memang ada.
 *
 *  3. Konversi ganda. Dua klik menghasilkan dua baris klien untuk satu orang —
 *     dua PADMA ID, dua passport, riwayat terbelah. Yang menjaganya adalah
 *     `screenings.client_id` yang sudah terisi, ditegakkan lewat UPDATE
 *     bersyarat, bukan sekadar tombol yang disembunyikan UI.
 *
 *  4. Skrining tertaut kehilangan jejaknya di layar. Bila baris yang sudah
 *     dikonversi tetap menawarkan tombol "Jadikan klien", satu-satunya kabar
 *     bahwa orang ini sudah terdaftar hilang dari inbox.
 *
 * Catatan data uji: skrining memakai prefix kode `PDM-UJI-` dan klien hasil
 * konversi memakai email `pad-uji-…`; keduanya dibersihkan di `afterAll`.
 * SKRINING DIHAPUS LEBIH DULU — `screenings.client_id` adalah foreign key TANPA
 * `on delete`, jadi urutan terbalik akan gagal 23503. Klien uji SENGAJA bukan
 * Ananda: `rls-firewall.test.ts` dan `passport-beranda.test.ts` meng-assert
 * jumlah baris miliknya secara PERSIS.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { TabelInbox, type BarisSkrining } from "@/app/admin/skrining/tabel-inbox";
import { nominalDalam } from "./helpers/nominal";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const SKR_KEHAMILAN = "9b000000-0000-4000-8000-000000000001";
const SKR_NEWBORN = "9b000000-0000-4000-8000-000000000002";
const SKR_KEDUA = "9b000000-0000-4000-8000-000000000003";
const EMAIL_KONVERSI = "pad-uji-konversi@padma.test";
const EMAIL_KEDUA = "pad-uji-konversi-dua@padma.test";

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
  usePathname: () => "/admin/skrining",
}));

const { jadikanKlien } = await import("@/app/admin/skrining/aksi");

const sumberAksi = baca("src/app/admin/skrining/aksi.ts");
const sumberHalaman = baca("src/app/admin/skrining/page.tsx");
const sumberTabel = baca("src/app/admin/skrining/tabel-inbox.tsx");
const sumberDialog = baca("src/app/admin/skrining/jadikan-klien.tsx");
const sumberStatus = baca("src/app/admin/skrining/status.ts");

let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;

function formulir(isi: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isi)) fd.set(k, v);
  return fd;
}

async function barisSkrining(id: string) {
  const { data } = await admin
    .from("screenings")
    .select("id, kode, nama, no_hp, fase, client_id, status_tindak_lanjut")
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function klienBerEmail(email: string) {
  const { data } = await admin
    .from("clients")
    .select("id, padma_id, nama, email, no_hp, phase_id, user_id, linked_at")
    .eq("email", email);
  return data ?? [];
}

async function bersihkan() {
  // Skrining lebih dulu: `screenings.client_id` adalah foreign key TANPA
  // `on delete`, jadi menghapus kliennya lebih dulu gagal 23503.
  await admin.from("screenings").delete().like("kode", "PDM-UJI-%");
  await admin.from("clients").delete().like("email", "pad-uji-%");
}

async function pasangFixture() {
  await bersihkan();
  await admin.from("screenings").insert([
    {
      id: SKR_KEHAMILAN,
      kode: "PDM-UJI-KONV-1",
      nama: "Uji Konversi Hamil",
      no_hp: "0812-0000-1001",
      fase: "kehamilan",
      jawaban: { fever: false },
      hasil: "hijau",
      flags: [],
    },
    {
      // Fase yang TIDAK pernah lahir dari skrining. `newborn` sengaja dipilih
      // karena ia id `phases` yang SAH: pemetaan yang malas (identitas) akan
      // lolos foreign key dan test ini adalah satu-satunya yang menangkapnya.
      id: SKR_NEWBORN,
      kode: "PDM-UJI-KONV-2",
      nama: "Uji Konversi Bayi",
      no_hp: "0812-0000-1002",
      fase: "newborn",
      jawaban: {},
      hasil: "hijau",
      flags: [],
    },
    {
      id: SKR_KEDUA,
      kode: "PDM-UJI-KONV-3",
      nama: "Uji Konversi Menopause",
      no_hp: "0812-0000-1003",
      fase: "menopause",
      jawaban: {},
      hasil: "merah",
      flags: [{ id: "meno_lump", level: "review", teks: "benjolan" }],
    },
  ]);
}

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
  ref.sesi = sesiAdmin;
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  jejak.revalidate.length = 0;
  await pasangFixture();
});

afterAll(bersihkan);

// ---------------------------------------------------------------------------
// Server action: jadikanKlien
// ---------------------------------------------------------------------------

describe("jadikanKlien — konversi skrining menjadi klien", () => {
  it("membuat klien ber-PADMA ID dengan nama, no_hp & fase tersalin dari skrining", async () => {
    const hasil = await jadikanKlien(
      SKR_KEHAMILAN,
      formulir({ email: EMAIL_KONVERSI }),
    );

    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return; // penyempit tipe; assertion di atas yang menjaga
    expect(hasil.padmaId).toMatch(/^PAD-\d{4}-\d{4}$/);

    const klien = await klienBerEmail(EMAIL_KONVERSI);
    expect(klien).toHaveLength(1);
    expect(klien[0]).toMatchObject({
      id: hasil.clientId,
      nama: "Uji Konversi Hamil",
      no_hp: "0812-0000-1001",
      phase_id: "kehamilan",
    });
  });

  it("mengisi screenings.client_id — kolom yang sebelumnya tidak pernah terisi", async () => {
    const hasil = await jadikanKlien(
      SKR_KEHAMILAN,
      formulir({ email: EMAIL_KONVERSI }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;

    const skrining = await barisSkrining(SKR_KEHAMILAN);
    expect(skrining!.client_id).toBe(hasil.clientId);
  });

  it("menyetel tindak lanjut menjadi jadi_klien tanpa menunggu admin memutarnya", async () => {
    await jadikanKlien(SKR_KEHAMILAN, formulir({ email: EMAIL_KONVERSI }));
    const skrining = await barisSkrining(SKR_KEHAMILAN);
    expect(skrining!.status_tindak_lanjut).toBe("jadi_klien");
  });

  it("klien hasil konversi lahir BELUM tertaut (aktivasi tetap lewat undangan)", async () => {
    await jadikanKlien(SKR_KEHAMILAN, formulir({ email: EMAIL_KONVERSI }));
    const klien = await klienBerEmail(EMAIL_KONVERSI);
    expect(klien[0].user_id).toBeNull();
    expect(klien[0].linked_at).toBeNull();
  });

  it("nama & no_hp boleh dikoreksi admin di formulir konversi", async () => {
    // Nama di skrining diketik calon klien sendiri lewat ponsel; salah ketik
    // wajar. Yang dikoreksi di sini adalah data klien, bukan baris skriningnya.
    const hasil = await jadikanKlien(
      SKR_KEHAMILAN,
      formulir({
        email: EMAIL_KONVERSI,
        nama: "Uji Konversi Hamil Terkoreksi",
        no_hp: "0899-0000-1001",
      }),
    );
    expect(hasil.ok).toBe(true);

    const klien = await klienBerEmail(EMAIL_KONVERSI);
    expect(klien[0]).toMatchObject({
      nama: "Uji Konversi Hamil Terkoreksi",
      no_hp: "0899-0000-1001",
    });

    // Baris skrining adalah rekaman jawaban asli — tidak ikut ditulis ulang.
    const skrining = await barisSkrining(SKR_KEHAMILAN);
    expect(skrining!.nama).toBe("Uji Konversi Hamil");
    expect(skrining!.no_hp).toBe("0812-0000-1001");
  });

  it("FASE TIDAK PERNAH DATANG DARI FORMULIR — ia dibaca dari baris skrining", async () => {
    const hasil = await jadikanKlien(
      SKR_KEHAMILAN,
      formulir({ email: EMAIL_KONVERSI, fase: "newborn" }),
    );
    expect(hasil.ok).toBe(true);

    const klien = await klienBerEmail(EMAIL_KONVERSI);
    expect(klien[0].phase_id).toBe("kehamilan");
    // Dan pagarnya ada di sumber, bukan sekadar kebetulan urutan argumen.
    expect(sumberAksi).not.toContain('formData.get("fase")');
  });

  it("fase yang tidak pernah lahir dari skrining ditolak tanpa membuat klien", async () => {
    const hasil = await jadikanKlien(
      SKR_NEWBORN,
      formulir({ email: "pad-uji-bayi@padma.test" }),
    );
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/fase/i);

    expect(await klienBerEmail("pad-uji-bayi@padma.test")).toHaveLength(0);
    expect((await barisSkrining(SKR_NEWBORN))!.client_id).toBeNull();
  });

  it("KONVERSI GANDA ditolak dan tidak melahirkan klien kedua", async () => {
    const pertama = await jadikanKlien(
      SKR_KEHAMILAN,
      formulir({ email: EMAIL_KONVERSI }),
    );
    expect(pertama.ok).toBe(true);

    const kedua = await jadikanKlien(
      SKR_KEHAMILAN,
      formulir({ email: EMAIL_KEDUA }),
    );
    expect(kedua.ok).toBe(false);
    if (kedua.ok) return;
    expect(kedua.pesan).toMatch(/sudah/i);

    // Tidak ada baris klien kedua, dan tautan lama tidak tergeser.
    expect(await klienBerEmail(EMAIL_KEDUA)).toHaveLength(0);
    if (!pertama.ok) return;
    expect((await barisSkrining(SKR_KEHAMILAN))!.client_id).toBe(pertama.clientId);
  });

  it("email yang sudah dipakai klien lain ditolak; skrining tetap belum tertaut", async () => {
    await jadikanKlien(SKR_KEHAMILAN, formulir({ email: EMAIL_KONVERSI }));

    const kedua = await jadikanKlien(SKR_KEDUA, formulir({ email: EMAIL_KONVERSI }));
    expect(kedua.ok).toBe(false);
    if (kedua.ok) return;
    expect(kedua.pesan).toMatch(/sudah dipakai/i);

    expect(await klienBerEmail(EMAIL_KONVERSI)).toHaveLength(1);
    expect((await barisSkrining(SKR_KEDUA))!.client_id).toBeNull();
    expect((await barisSkrining(SKR_KEDUA))!.status_tindak_lanjut).not.toBe("jadi_klien");
  });

  it("email tidak sah ditolak sebelum basis data disentuh", async () => {
    const hasil = await jadikanKlien(SKR_KEHAMILAN, formulir({ email: "bukan-email" }));
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/email/i);
    expect((await barisSkrining(SKR_KEHAMILAN))!.client_id).toBeNull();
  });

  it("id skrining yang tidak ada ditolak, bukan 'ok' palsu", async () => {
    const hasil = await jadikanKlien(
      "9b000000-0000-4000-8000-0000000000ff",
      formulir({ email: "pad-uji-hantu@padma.test" }),
    );
    expect(hasil.ok).toBe(false);
    expect(await klienBerEmail("pad-uji-hantu@padma.test")).toHaveLength(0);
  });

  it("menyegarkan cache inbox, daftar klien, dan dashboard antrean", async () => {
    await jadikanKlien(SKR_KEHAMILAN, formulir({ email: EMAIL_KONVERSI }));
    for (const rute of ["/admin/skrining", "/admin/klien", "/admin"]) {
      expect(jejak.revalidate).toContain(rute);
    }
  });

  it("PENJAGA PERAN: klien yang login tidak bisa memanggil action ini", async () => {
    ref.sesi = sesiKlien;
    await expect(
      jadikanKlien(SKR_KEHAMILAN, formulir({ email: "pad-uji-dariklien@padma.test" })),
    ).rejects.toThrow(/REDIRECT/);

    expect(await klienBerEmail("pad-uji-dariklien@padma.test")).toHaveLength(0);
    expect((await barisSkrining(SKR_KEHAMILAN))!.client_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pagar basis data
// ---------------------------------------------------------------------------

describe("pagar basis data yang menopang konversi", () => {
  it("screenings.client_id yang terisi MENGUNCI penghapusan klien", async () => {
    const hasil = await jadikanKlien(
      SKR_KEHAMILAN,
      formulir({ email: EMAIL_KONVERSI }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;

    // Admin sudah dilarang menghapus klien sejak pengerasan Task 1 …
    const { error: eAdmin } = await sesiAdmin
      .from("clients")
      .delete()
      .eq("id", hasil.clientId);
    expect(eAdmin?.code).toBe("42501");

    // … dan service role pun tertahan foreign key skrining: rekaman jawaban
    // asli tidak boleh kehilangan orang yang menjawabnya.
    const { error: eService } = await admin
      .from("clients")
      .delete()
      .eq("id", hasil.clientId);
    expect(eService?.code).toBe("23503");

    const { data } = await admin
      .from("clients")
      .select("id")
      .eq("id", hasil.clientId)
      .maybeSingle();
    expect(data).not.toBeNull();
  });

  it("klien tidak bisa membaca skrining siapa pun, termasuk yang sudah tertaut", async () => {
    await jadikanKlien(SKR_KEHAMILAN, formulir({ email: EMAIL_KONVERSI }));
    const { data } = await sesiKlien.from("screenings").select("id, client_id");
    expect(data ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lapis render
// ---------------------------------------------------------------------------

const BARIS_BELUM: BarisSkrining = {
  id: "9b000000-0000-4000-8000-00000000000a",
  kode: "PDM-UJI-RENDER-1",
  nama: "Render Belum Tertaut",
  no_hp: "0812-0000-2001",
  fase: "prekonsepsi",
  hasil: "hijau",
  status_tindak_lanjut: "baru",
  created_at: "2026-08-29T02:00:00.000Z",
  flags: [],
  client_id: null,
};

const BARIS_TERTAUT: BarisSkrining = {
  id: "9b000000-0000-4000-8000-00000000000b",
  kode: "PDM-UJI-RENDER-2",
  nama: "Render Sudah Tertaut",
  no_hp: "0812-0000-2002",
  fase: "menopause",
  hasil: "hijau",
  status_tindak_lanjut: "jadi_klien",
  created_at: "2026-08-29T03:00:00.000Z",
  flags: [],
  client_id: "44444444-4444-4444-4444-4444444444e1",
};

describe("inbox menampilkan jembatan ke modul klien", () => {
  const markup = renderToStaticMarkup(
    createElement(TabelInbox, { baris: [BARIS_BELUM, BARIS_TERTAUT] }),
  );
  const markupBelum = renderToStaticMarkup(
    createElement(TabelInbox, { baris: [BARIS_BELUM] }),
  );
  const markupTertaut = renderToStaticMarkup(
    createElement(TabelInbox, { baris: [BARIS_TERTAUT] }),
  );

  it("skrining yang BELUM tertaut menawarkan jalan menjadikannya klien", () => {
    expect(markupBelum).toContain("Jadikan klien");
  });

  it("skrining yang SUDAH tertaut menampilkan tautan ke halaman kliennya", () => {
    expect(markupTertaut).toContain(
      `href="/admin/klien/${BARIS_TERTAUT.client_id}"`,
    );
  });

  it("skrining yang sudah tertaut TIDAK menawarkan konversi kedua", () => {
    expect(markupTertaut).not.toContain("Jadikan klien");
  });

  it("keduanya berdampingan tanpa saling menghapus", () => {
    expect(markup.split("Jadikan klien").length - 1).toBe(1);
    expect(markup).toContain(`href="/admin/klien/${BARIS_TERTAUT.client_id}"`);
  });

  it("penanda merah-urgent tidak ikut bergeser oleh kolom baru", () => {
    // Dua baris hijau: tidak boleh ada satu pun penanda merah yang muncul
    // sebagai efek samping kolom konversi.
    expect(markup).not.toContain("MERAH");
  });

  it("tidak ada nominal uang di jalur konversi (money firewall)", () => {
    expect(nominalDalam(markup), "nominal bocor").toEqual([]);
    for (const sumber of [sumberTabel, sumberDialog, sumberAksi, sumberHalaman]) {
      expect(nominalDalam(sumber), "nominal bocor").toEqual([]);
      expect(sumber).not.toContain("service_rates");
      expect(sumber).not.toContain("variant_rates");
    }
  });
});

// ---------------------------------------------------------------------------
// Bentuk berkas
// ---------------------------------------------------------------------------

describe("berkas jalur konversi", () => {
  it("halaman inbox ikut membaca client_id (tanpa itu jembatannya tak terlihat)", () => {
    expect(sumberHalaman).toContain("client_id");
  });

  it("SETIAP action di modul skrining memanggil requireRole(['admin','owner'])", () => {
    const jumlahAction = [
      ...sumberAksi.matchAll(/^export\s+async\s+function\s+\w+/gm),
    ].length;
    const jumlahGuard = [
      ...sumberAksi.matchAll(
        /await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/g,
      ),
    ].length;
    expect(jumlahAction).toBe(2); // ubahTindakLanjut, jadikanKlien
    expect(jumlahGuard).toBe(jumlahAction);
  });

  it("UPDATE konversi hanya menyentuh client_id & status_tindak_lanjut", () => {
    const semua = [...sumberAksi.matchAll(/\.update\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    expect(semua).toHaveLength(2);
    // Yang kedua adalah UPDATE konversi; yang pertama milik ubahTindakLanjut
    // dan sudah dikunci `tests/admin-inbox.test.ts`.
    expect(semua[1]).toContain("client_id");
    expect(semua[1]).toContain("status_tindak_lanjut");
    for (const terlarang of ["hasil", "flags", "jawaban", "kode", "nama", "no_hp"]) {
      expect(semua[1]).not.toContain(terlarang);
    }
  });

  it("daftar putih fase tinggal di modul terpisah, bukan di berkas 'use server'", () => {
    // Berkas `"use server"` hanya boleh mengekspor fungsi async — konstanta di
    // sana menggagalkan `next build`.
    expect(sumberStatus).toContain("FASE_SKRINING");
    expect(sumberAksi).toContain("./status");
    expect(sumberStatus.trimStart().startsWith('"use server"')).toBe(false);
  });

  it("fase newborn TIDAK ada di daftar putih konversi", async () => {
    const { FASE_SKRINING_KE_PHASE } = await import("@/app/admin/skrining/status");
    expect(Object.keys(FASE_SKRINING_KE_PHASE)).toEqual([
      "prekonsepsi",
      "kehamilan",
      "nifas",
      "menopause",
    ]);
    expect(Object.keys(FASE_SKRINING_KE_PHASE)).not.toContain("newborn");
  });

  it("memakai sesi pengguna, bukan service role", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberTabel, sumberDialog]) {
      expect(sumber).not.toContain("createAdminSupabase");
      expect(sumber).not.toContain("SERVICE_ROLE");
    }
    expect(sumberAksi).toContain("createServerSupabase");
  });

  it("pencocokan identitas memakai operator setara, tidak pernah pola", () => {
    for (const sumber of [sumberAksi, sumberHalaman]) {
      expect(sumber).not.toContain(".ilike(");
      expect(sumber).not.toContain(".like(");
    }
  });

  it("data kesehatan tidak bocor ke URL maupun log", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberTabel, sumberDialog]) {
      expect(sumber).not.toContain("console.");
      expect(sumber).not.toContain("searchParams");
      expect(sumber).not.toContain("URLSearchParams");
    }
  });

  it("layout admin TIDAK ikut diubah (matriks peran tetap satu panggilan)", () => {
    const layout = baca("src/app/admin/layout.tsx");
    expect([...layout.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(baca("src/app/admin/page.tsx")).toContain('href="/admin/skrining"');
  });
});
