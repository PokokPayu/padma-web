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
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";
import { TabelInbox, type BarisSkrining } from "@/app/admin/skrining/tabel-inbox";

const admin = createAdminSupabase();
const KODE = "PDM-260828-0000-TEST";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

beforeAll(async () => {
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
// Lapis render & sumber
// ---------------------------------------------------------------------------

const sumberHalaman = baca("src/app/admin/skrining/page.tsx");
const sumberTabel = baca("src/app/admin/skrining/tabel-inbox.tsx");
const sumberAksi = baca("src/app/admin/skrining/aksi.ts");
const sumberDashboard = baca("src/app/admin/page.tsx");

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
const markupKosong = renderToStaticMarkup(createElement(TabelInbox, { baris: [] }));

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
    for (const sumber of [sumberHalaman, sumberAksi, sumberTabel]) {
      expect(sumber).not.toContain("console.");
      expect(sumber).not.toContain("searchParams");
      expect(sumber).not.toContain("URLSearchParams");
    }
  });

  it("tidak ada nominal uang di inbox (money firewall)", () => {
    expect(markup).not.toMatch(/Rp\s?\d/);
    expect(sumberTabel).not.toMatch(/Rp\s?\d/);
  });

  it("judul mengandalkan template layout (tanpa menempel PADMA sendiri)", () => {
    expect(sumberHalaman).toMatch(/title:\s*"Inbox Skrining"/);
    expect(sumberHalaman).not.toMatch(/title:\s*"[^"]*PADMA/);
  });

  it("inbox kosong menjelaskan keadaannya, bukan tabel hampa", () => {
    expect(markupKosong).toContain("Belum ada hasil skrining masuk");
    expect(markupKosong).not.toContain("<table");
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
