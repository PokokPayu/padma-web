/**
 * Penjagaan Inbox Skrining admin (`/admin/skrining`).
 *
 * Dua lapis, seperti `skrining-wizard.test.ts` & `landing.test.ts`:
 *  1. Lapis basis data — RLS `screenings: staf` yang menjadi penjaga sebenarnya:
 *     staf boleh baca/ubah, klien dapat 0 baris, anon ditolak di lapis hak tabel.
 *  2. Lapis render & sumber — inbox adalah SATU-SATUNYA tempat staf melihat
 *     beda antara merah biasa dan merah-urgent. Bila penanda itu dihitung dari
 *     `hasil` (bukan dari level di `flags`), demam pada ibu hamil tampil sama
 *     seperti benjolan menopause: eskalasi keselamatan hilang tanpa error.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";
import { TabelInbox, type BarisSkrining } from "@/app/admin/skrining/tabel-inbox";
import { nominalDalam } from "./helpers/nominal";
import { SARING_SKRINING, ambilDaftarSkrining } from "@/lib/admin/skrining";
import { STATUS_SAH } from "@/app/admin/skrining/status";

const admin = createAdminSupabase();
const KODE = "PDM-260828-0000-TEST";

// Pegangan modul (bukan hanya nama yang didestrukturisasi) supaya
// `ambilDaftarSkrining` bisa di-spy di satu uji tanpa mengosongkan basis data
// lokal yang dipakai bersama — lihat uji "kalimat hari-pertama" di bawah.
const skriningMod = await import("@/lib/admin/skrining");

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

// `ambilDaftarSkrining()` memakai SESI PENGGUNA (`createServerSupabase`), yang
// membaca cookies() dan hanya bermakna di dalam request scope. Pola yang sama
// dengan tests/admin-bayar.test.ts: modulnya diganti klien Supabase ber-SESI
// NYATA, sehingga RLS "screenings: staf" tetap berjalan apa adanya.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

beforeAll(async () => {
  ref.sesi = await signInAs("admin@padma.test");
  await admin.from("screenings").delete().eq("kode", KODE);
  await admin.from("screenings").insert({
    kode: KODE, nama: "Uji Inbox", no_hp: "0812-0000-9999", fase: "kehamilan",
    jawaban: { cardioresp: false, fever: true },
    hasil: "merah",
    flags: [{ id: "fever", level: "urgent", teks: "Apakah suhu tubuh Anda 38°C atau lebih…" }],
  });
});
afterAll(async () => {
  await admin.from("screenings").delete().eq("kode", KODE);
});

describe("inbox skrining", () => {
  it("admin bisa membaca daftar skrining", async () => {
    const a = await signInAs("admin@padma.test");
    const { data, error } = await a.from("screenings").select("kode, hasil, flags");
    expect(error).toBeNull();
    expect(data!.some((r) => r.kode === KODE)).toBe(true);
  });

  it("flags menyimpan level sehingga admin bisa bedakan urgent", async () => {
    const a = await signInAs("admin@padma.test");
    const { data } = await a.from("screenings").select("flags").eq("kode", KODE).single();
    expect((data!.flags as { level: string }[])[0].level).toBe("urgent");
  });

  it("admin bisa mengubah status tindak lanjut", async () => {
    const a = await signInAs("admin@padma.test");
    const { data } = await a.from("screenings")
      .update({ status_tindak_lanjut: "dihubungi" }).eq("kode", KODE).select();
    expect(data).toHaveLength(1);
  });

  it("KLIEN tidak bisa membaca skrining siapa pun", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data } = await k.from("screenings").select("kode");
    expect(data).toHaveLength(0);
  });

  it("anon tetap ditolak di lapis hak tabel", async () => {
    const { error } = await anonClient().from("screenings").select("kode");
    expect(error?.code).toBe("42501");
  });

  // Pencarian kode belum ada fiturnya di Plan 2, tetapi aturannya dikunci
  // sekarang: `.eq` mengembalikan 0 baris untuk input "%", sedangkan `.ilike`
  // akan mengembalikan SELURUH inbox. Test ini adalah pagar untuk saat
  // fitur pencarian ditambahkan nanti.
  it("operator setara: '%' sebagai kode tidak cocok dengan baris mana pun", async () => {
    const a = await signInAs("admin@padma.test");
    const { data: eq } = await a.from("screenings").select("kode").eq("kode", "%");
    expect(eq).toHaveLength(0);

    // Kontrol pembanding: membuktikan test ini benar-benar membedakan
    // (bila kelak seseorang memakai .ilike, kebocorannya akan seperti ini).
    const { data: pola } = await a.from("screenings").select("kode").ilike("kode", "%");
    expect(pola!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Lapisan data: ambilDaftarSkrining (Task 6)
// ---------------------------------------------------------------------------

describe("ambilDaftarSkrining", () => {
  // Fixture SENDIRI, status 'baru' dijamin sendiri — BUKAN mengandalkan
  // `KODE` di atas: describe "inbox skrining" MENGUBAH status baris itu
  // menjadi 'dihubungi' di salah satu uji-nya ("admin bisa mengubah status
  // tindak lanjut"), dan describe itu berjalan LEBIH DULU di berkas yang
  // sama. Menyaring `tindak: "baru"` tanpa baris sendiri berarti uji ini
  // bergantung pada basis data lokal yang kebetulan masih punya skrining
  // 'baru' dari sumber lain — dan itu pernah kosong (0 baris) persis di sini.
  const KODE_BARU = "PDM-260828-0000-BARU";

  beforeAll(async () => {
    await admin.from("screenings").delete().eq("kode", KODE_BARU);
    await admin.from("screenings").insert({
      kode: KODE_BARU, nama: "Uji Saringan Tindak Lanjut", no_hp: "0812-0000-9998",
      fase: "kehamilan", jawaban: { cardioresp: false, fever: false },
      hasil: "hijau", status_tindak_lanjut: "baru", flags: [],
    });
  });
  afterAll(async () => {
    await admin.from("screenings").delete().eq("kode", KODE_BARU);
  });

  it("nilai saringan tindak lanjut diturunkan dari STATUS_SAH, tidak ditulis dua kali", () => {
    expect([...SARING_SKRINING.tindak]).toEqual([...STATUS_SAH]);
  });

  it("menyaring menurut tindak lanjut", async () => {
    const { baris } = await ambilDaftarSkrining({
      cari: "", saring: { tindak: "baru" }, hal: 1,
    });
    expect(baris.length).toBeGreaterThan(0);
    expect(baris.every((r) => r.status_tindak_lanjut === "baru")).toBe(true);
  });

  it("menyaring menurut hasil", async () => {
    const { baris } = await ambilDaftarSkrining({
      cari: "", saring: { hasil: "merah" }, hal: 1,
    });
    // Tanpa ini, `.every()` atas daftar KOSONG lolos diam-diam (vacuously
    // true) — pagar yang seharusnya menangkap `.eq()` yang salah kolom atau
    // yang tidak pernah mencocokkan apa pun lolos tanpa satu asersi pun
    // benar-benar berjalan.
    expect(baris.length).toBeGreaterThan(0);
    expect(baris.every((r) => r.hasil === "merah")).toBe(true);
  });

  it("mencari menurut kode DAN nama", async () => {
    const semua = await ambilDaftarSkrining({ cari: "", saring: {}, hal: 1 });
    expect(semua.baris.length).toBeGreaterThan(0);
    const sasaran = semua.baris[0];

    const perKode = await ambilDaftarSkrining({ cari: sasaran.kode, saring: {}, hal: 1 });
    expect(perKode.baris.some((r) => r.id === sasaran.id)).toBe(true);

    const perNama = await ambilDaftarSkrining({
      cari: sasaran.nama.slice(0, 4), saring: {}, hal: 1,
    });
    expect(perNama.baris.some((r) => r.id === sasaran.id)).toBe(true);
  });

  it("membawa flags — tanpa itu penanda URGENT hilang diam-diam", async () => {
    // `flags` adalah kolom jsonb; hilangnya tidak melempar galat, penanda
    // "MERAH · URGENT" hanya berhenti muncul dan setiap baris merah terlihat
    // sama mendesaknya.
    const { baris } = await ambilDaftarSkrining({ cari: "", saring: {}, hal: 1 });
    // Sama seperti "menyaring menurut hasil" di atas: tanpa ini, `.every()`
    // atas daftar kosong lolos diam-diam.
    expect(baris.length).toBeGreaterThan(0);
    expect(baris.every((r) => Array.isArray(r.flags))).toBe(true);
  });

  it("kata cari diperlakukan sebagai HURUF, bukan wildcard SQL", async () => {
    const { baris } = await ambilDaftarSkrining({ cari: "%", saring: {}, hal: 1 });
    expect(baris).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lapis render & sumber
// ---------------------------------------------------------------------------

const sumberHalaman = baca("src/app/admin/skrining/page.tsx");
const sumberTabel = baca("src/app/admin/skrining/tabel-inbox.tsx");
const sumberAksi = baca("src/app/admin/skrining/aksi.ts");
const sumberDashboard = baca("src/app/admin/page.tsx");

const { default: InboxSkriningPage } = await import("@/app/admin/skrining/page");

const BARIS: BarisSkrining[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    kode: "PDM-260828-0000-URGN",
    nama: "Ibu Urgent",
    no_hp: "0812-0000-0001",
    fase: "kehamilan",
    hasil: "merah",
    status_tindak_lanjut: "baru",
    created_at: "2026-08-28T02:00:00.000Z",
    flags: [
      { id: "fever", level: "urgent", teks: "Apakah suhu tubuh Anda 38°C atau lebih…" },
    ],
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    kode: "PDM-260828-0000-RVEW",
    nama: "Ibu Review",
    no_hp: "0812-0000-0002",
    fase: "menopause",
    hasil: "merah",
    status_tindak_lanjut: "dihubungi",
    created_at: "2026-08-28T03:00:00.000Z",
    flags: [
      { id: "meno_lump", level: "review", teks: "Apakah Anda menemukan benjolan baru…" },
    ],
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    kode: "PDM-260828-0000-HIJA",
    nama: "Ibu Hijau",
    no_hp: "0812-0000-0003",
    fase: "prekonsepsi",
    hasil: "hijau",
    status_tindak_lanjut: "jadi_klien",
    created_at: "2026-08-28T04:00:00.000Z",
    flags: [],
  },
];

const markup = renderToStaticMarkup(createElement(TabelInbox, { baris: BARIS }));

describe("PAGAR KESELAMATAN: penanda merah-urgent di inbox", () => {
  it("skrining dengan flag ber-level urgent ditandai MERAH · URGENT", () => {
    expect(markup).toContain("MERAH · URGENT");
  });

  it("merah tanpa flag urgent tetap MERAH biasa (alarm tidak dinormalkan)", () => {
    // Persis satu penanda urgent untuk tiga baris di atas: baris review tidak
    // ikut naik pangkat, baris hijau tidak ikut merah.
    expect(markup.split("MERAH · URGENT").length - 1).toBe(1);
    expect(markup).toContain("HIJAU");
    // Dua baris merah: satu urgent, satu biasa.
    expect(markup.split(">MERAH<").length - 1).toBe(1);
  });

  it("urgent dihitung dari level di flags, bukan dari kolom hasil", () => {
    expect(sumberTabel).toMatch(
      /flags\.some\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.level\s*===\s*"urgent"\s*\)/,
    );
    // Bila penanda hanya bergantung pada `hasil`, seluruh merah tampak sama.
    expect(sumberTabel).not.toMatch(/urgent\s*=\s*[^;]*hasil\s*===/);
  });

  it("detail jawaban 'Ya' memberi lencana URGENT per bendera", () => {
    expect(sumberTabel).toMatch(/f\.level\s*===\s*"urgent"/);
    expect(sumberTabel).toContain("URGENT");
  });

  it("teks bendera dirender dari data, tidak disalin ulang sebagai literal", () => {
    expect(sumberTabel).not.toContain("Apakah suhu tubuh Anda");
    expect(sumberTabel).not.toContain("nyeri dada");
  });
});

describe("inbox admin — halaman & data", () => {
  it("halaman dijaga requireRole admin+owner", () => {
    expect(sumberHalaman).toMatch(/await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/);
  });

  it("membaca lewat sesi pengguna (RLS ikut diperiksa), bukan service role", () => {
    for (const sumber of [sumberHalaman, sumberAksi, sumberTabel]) {
      expect(sumber).not.toContain("createAdminSupabase");
      expect(sumber).not.toContain("SERVICE_ROLE");
    }
    expect(sumberHalaman).toContain("createServerSupabase");
    expect(sumberAksi).toContain("createServerSupabase");
  });

  it("pencocokan identitas memakai operator setara, tidak pernah pola", () => {
    for (const sumber of [sumberHalaman, sumberAksi]) {
      expect(sumber).not.toContain(".ilike(");
      expect(sumber).not.toContain(".like(");
    }
    expect(sumberAksi).toMatch(/\.eq\(\s*"id"\s*,\s*id\s*\)/);
  });

  it("data kesehatan tidak bocor ke URL maupun log", () => {
    // `searchParams` DIKECUALIKAN hanya untuk `sumberHalaman`: sejak bilah
    // daftar hidup di URL untuk SETIAP daftar panel (Global Constraint 2,
    // spec K2, pola yang sama dengan /admin/bayar & /admin/sesi), tanda
    // tangan `page.tsx` WAJIB menerima `searchParams` dan meneruskan
    // `cari`/`tindak`/`hasil` — tiga parameter NAVIGASI, bukan jawaban
    // kuesioner. Tapi `hasil` bukan navigasi netral seperti dua yang lain:
    // nilainya (`merah`/`hijau`) adalah KLASIFIKASI KLINIS, bukan sekadar id
    // atau status alur kerja — `?cari=<nama>&hasil=merah` menaruh nama
    // seseorang bersebelahan dengan hasil skrining merahnya di riwayat
    // peramban dan access log. Ini melebihi spec K3 (Skrining seharusnya
    // hanya punya satu saringan: sudah/belum ditindaklanjuti) — rencana
    // menyetujuinya secara eksplisit (lihat deviasi di runbook), dan
    // halamannya sudah di belakang `requireRole`, jadi ini keputusan yang
    // disadari, bukan pelanggaran. Dicatat di sini supaya pembaca berikutnya
    // tidak salah baca `hasil` sebagai parameter navigasi biasa.
    //
    // `sumberAksi` (`"use server"`, endpoint POST tersendiri) dan
    // `sumberTabel` (komponen murni props-masuk) TIDAK PERNAH punya alasan
    // membaca state URL sama sekali — keduanya menerima datanya lewat
    // argumen/props, bukan lewat request. Skrining adalah DATA KESEHATAN;
    // satu-satunya alasan pagar ini ada adalah mencegah salah satu dari
    // keduanya diam-diam mulai menyalin sesuatu (jawaban, kode, nama) ke
    // query string atau log — jadi keduanya TETAP dijaga penuh di sini,
    // sama seperti sebelum Task 6.
    for (const sumber of [sumberHalaman, sumberAksi, sumberTabel]) {
      expect(sumber).not.toContain("console.");
    }
    for (const sumber of [sumberAksi, sumberTabel]) {
      expect(sumber).not.toContain("searchParams");
      expect(sumber).not.toContain("URLSearchParams");
    }
  });

  it("tidak ada nominal uang di inbox (money firewall)", () => {
    expect(nominalDalam(markup), "nominal bocor").toEqual([]);
    expect(nominalDalam(sumberTabel), "nominal bocor").toEqual([]);
  });

  it("judul mengandalkan template layout (tanpa menempel PADMA sendiri)", () => {
    expect(sumberHalaman).toMatch(/title:\s*"Inbox Skrining"/);
    expect(sumberHalaman).not.toMatch(/title:\s*"[^"]*PADMA/);
  });

  it("TabelInbox TIDAK LAGI memutuskan kosongnya sendiri (Task 6 — pindah ke page.tsx)", () => {
    // Sebelumnya komponen ini menjawab `baris: []` dengan pesannya sendiri.
    // Sejak bilah cari & saring ada, kalimat yang benar berbeda menurut
    // sebabnya — "belum ada skrining sama sekali" vs "tidak cocok dengan
    // pencarian ini" — dan hanya `page.tsx` yang tahu bedanya (lihat uji
    // halaman inbox untuk pencarian yang tidak cocok).
    const markupKosong = renderToStaticMarkup(createElement(TabelInbox, { baris: [] }));
    expect(markupKosong).toContain("<table");
    expect(markupKosong).not.toContain("Belum ada hasil skrining masuk");
  });

  it("tiap baris menampilkan kode, calon klien, dan kontrol tindak lanjut", () => {
    for (const r of BARIS) {
      expect(markup).toContain(r.kode);
      expect(markup).toContain(r.nama);
      expect(markup).toContain(r.no_hp);
    }
    expect(markup).toContain("<select");
    for (const label of ["Baru", "Dihubungi", "Jadi klien", "Ditolak"]) {
      expect(markup).toContain(label);
    }
  });

  it("pencarian yang tidak cocok menampilkan pesan pencarian, bukan tabel kosong", async () => {
    const halaman = renderToStaticMarkup(
      await InboxSkriningPage({
        searchParams: Promise.resolve({ cari: "zzz-tidak-ada-skrining-bernama-ini" }),
      }),
    );
    expect(halaman).toContain("Tidak ada hasil skrining yang cocok dengan pencarian ini");
    expect(halaman).not.toContain("<table");
  });

  it("daftar kosong TANPA pencarian/saringan aktif menampilkan kalimat hari-pertama, bukan kalimat pencarian", async () => {
    // BLOCKING 3 (review sapuan panel): page.tsx sebelumnya merender "tidak
    // cocok dengan pencarian ini" untuk SEMUA kekosongan, termasuk klinik
    // yang belum pernah menerima satu pengisi skrining pun. `ambilDaftarSkrining`
    // di-spy supaya baris kosong bisa diuji tanpa mengosongkan basis data.
    const spy = vi
      .spyOn(skriningMod, "ambilDaftarSkrining")
      .mockResolvedValue({ baris: [], total: 0 });
    try {
      const halaman = renderToStaticMarkup(
        await InboxSkriningPage({ searchParams: Promise.resolve({}) }),
      );
      expect(halaman).toContain("Belum ada hasil skrining masuk");
      expect(halaman).not.toContain("cocok dengan pencarian ini");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("server action tindak lanjut", () => {
  it("adalah server action ber-guard peran", () => {
    expect(sumberAksi.trimStart().startsWith('"use server"')).toBe(true);
    expect(sumberAksi).toMatch(/await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/);
  });

  it("hanya menerima status dari daftar putih", async () => {
    // Daftar putih tinggal di modul sendiri: berkas `"use server"` hanya boleh
    // mengekspor fungsi async, jadi konstanta di sana akan menggagalkan build.
    const { STATUS_SAH, LABEL_STATUS } = await import("@/app/admin/skrining/status");
    expect([...STATUS_SAH]).toEqual(["baru", "dihubungi", "jadi_klien", "ditolak"]);
    expect(sumberAksi).toContain("STATUS_SAH.includes");
    // Satu sumber: pilihan di UI persis status yang diterima server.
    expect(Object.keys(LABEL_STATUS)).toEqual([...STATUS_SAH]);
    expect(sumberTabel).toContain("LABEL_STATUS");
    expect(sumberTabel).not.toMatch(/LABEL_STATUS\s*[:=]/);
  });

  it("modul server action hanya mengekspor fungsi async (syarat Next)", () => {
    const ekspor = [...sumberAksi.matchAll(/^export\s+(?!type\b)(\w+)/gm)].map(
      (m) => m[1],
    );
    // Modul ini bertambah action (konversi skrining → klien), jadi jumlahnya
    // tidak lagi tetap satu. Yang dikunci adalah aturannya: SETIAP ekspor wajib
    // `async` — satu saja yang bukan, `next build` gagal.
    expect(ekspor.length).toBeGreaterThan(0);
    expect([...new Set(ekspor)]).toEqual(["async"]);
  });

  it("SETIAP action membawa penjaga perannya sendiri", () => {
    // Server action adalah endpoint POST tersendiri: action yang lahir tanpa
    // requireRole adalah pintu terbuka, dan tidak ada layout yang menutupnya.
    const jumlahAction = [
      ...sumberAksi.matchAll(/^export\s+async\s+function\s+\w+/gm),
    ].length;
    const jumlahGuard = [
      ...sumberAksi.matchAll(
        /await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/g,
      ),
    ].length;
    expect(jumlahAction).toBeGreaterThan(0);
    expect(jumlahGuard).toBe(jumlahAction);
  });

  it("hanya mengubah status_tindak_lanjut — bukan hasil/flags/jawaban", () => {
    const update = sumberAksi.match(/\.update\(\{([^}]*)\}\)/);
    expect(update, "server action harus memakai .update({...}) literal").not.toBeNull();
    expect(update![1]).toContain("status_tindak_lanjut");
    for (const terlarang of ["hasil", "flags", "jawaban", "kode"]) {
      expect(update![1]).not.toContain(terlarang);
    }
  });

  it("menyegarkan cache inbox setelah perubahan", () => {
    expect(sumberAksi).toContain('revalidatePath("/admin/skrining")');
  });
});

describe("dashboard admin", () => {
  it("menautkan ke inbox skrining", () => {
    expect(sumberDashboard).toContain('href="/admin/skrining"');
  });

  it("layout admin TIDAK ikut diubah (matriks peran tetap satu panggilan)", () => {
    const layout = baca("src/app/admin/layout.tsx");
    expect([...layout.matchAll(/requireRole\(/g)]).toHaveLength(1);
  });
});
