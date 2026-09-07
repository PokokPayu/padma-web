/**
 * Halaman profil passport (`src/app/passport/profil/page.tsx`).
 *
 * Profil adalah halaman paling sepi di passport, dan justru karena itu ia jadi
 * tempat tiga kesalahan menetap tanpa pernah terlihat:
 *
 *  1. Identitas salah orang. Halaman ini memuat PII lengkap (nama, email,
 *     nomor WhatsApp) — kalau resolusi kliennya meleset, kebocorannya utuh dan
 *     senyap. Karena itu isinya dibaca lewat RENDER NYATA di atas sesi klien
 *     sungguhan, bukan lewat query tandingan.
 *  2. Janji yang tidak ditegakkan. Halaman menulis "perubahan data dilakukan
 *     oleh admin". Kalimat itu hanya jujur bila basis data memang menolak
 *     klien menulis barisnya sendiri — diuji di bawah lewat UPDATE sungguhan.
 *     Ingat: PostgREST menjawab 200 + [] untuk update yang tertahan RLS, jadi
 *     nilainya wajib dibaca ulang dengan service role.
 *  3. Formulir yang melebar diam-diam. Halaman ini kini MEMANG punya jalur
 *     tulis — klien boleh memperbaiki nama, nomor WhatsApp, dan alamatnya
 *     sendiri lewat RPC `perbarui_profil_klien`. Yang berbahaya bukan adanya
 *     formulir, melainkan formulir yang suatu hari ikut memuat email, PADMA
 *     ID, atau fase: ketiganya keputusan identitas (email adalah dasar
 *     penautan akun, fase menentukan materi yang terbuka), bukan data
 *     operasional. Karena itu di bawah diuji dua arah — medan yang HARUS ada,
 *     dan medan yang TIDAK BOLEH ada.
 *
 * Perhatikan juga apa yang TIDAK berubah: policy `clients: milik sendiri`
 * tetap `for select` saja, sehingga UPDATE langsung lewat PostgREST tetap
 * ditolak. Pembuktiannya ada di describe terakhir berkas ini, dan itu yang
 * membedakan "satu pintu sempit bernama" dari "pintu dibuka".
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const ANANDA = "44444444-4444-4444-4444-444444444401";

// Lapisan data passport memakai sesi pengguna (createServerSupabase). Di vitest
// tidak ada cookie, jadi klien ber-sesi sungguhan disuntikkan — RLS tetap yang
// menjadi penjaga, persis seperti di produksi.
const ref = vi.hoisted(() => ({ klien: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.klien!,
}));

// `notFound()` hanya penjaga tipe di halaman; kalau ia sampai terpanggil,
// itu regresi resolusi klien dan test harus meledak, bukan diam.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() terpanggil — resolusi klien gagal");
  },
}));

beforeAll(async () => {
  ref.klien = await signInAs("ananda@padma.test");
});

async function markupProfil(): Promise<string> {
  const { default: HalamanProfil } = await import("@/app/passport/profil/page");
  // Server Component async: dipanggil sebagai fungsi, hasilnya pohon elemen
  // yang seluruh anaknya sinkron sehingga bisa dirender ke markup statis.
  return renderToStaticMarkup(await HalamanProfil());
}

describe("profil passport — isi", () => {
  it("menampilkan identitas klien yang sedang masuk", async () => {
    const m = await markupProfil();
    expect(m).toContain("Ananda Putri");
    expect(m).toContain("PAD-2607-0012");
    expect(m).toContain("ananda@padma.test");
    expect(m).toContain("0812-3456-7890");
  });

  it("menampilkan fase perjalanan lengkap dengan nama sanskritnya", async () => {
    const m = await markupProfil();
    expect(m).toContain("Sankalpa");
    expect(m).toContain("Prekonsepsi / Promil");
  });

  it("memberi label berbahasa Indonesia untuk tiap baris", async () => {
    const m = await markupProfil();
    for (const label of [
      "Nama lengkap",
      "PADMA ID",
      "Email",
      "No. WhatsApp",
      "Fase perjalanan",
    ]) {
      expect(m).toContain(label);
    }
  });

  it("tidak pernah menampilkan nominal uang (money firewall di layar klien)", async () => {
    const m = await markupProfil();
    expect(m).not.toMatch(/Rp\s?\d/);
  });
});

describe("profil passport — apa yang boleh disunting sendiri", () => {
  const sumber = baca("src/app/passport/profil/page.tsx");

  it("menyediakan medan untuk nama, no. WhatsApp, dan alamat", async () => {
    const m = await markupProfil();
    expect(m).toMatch(/<input[^>]*name="nama"/);
    expect(m).toMatch(/<input[^>]*name="no_hp"/);
    expect(m).toMatch(/<textarea[^>]*name="alamat"/);
  });

  it("mengisi medan dengan nilai klien yang sedang masuk", async () => {
    const m = await markupProfil();
    expect(m).toMatch(/<input[^>]*name="nama"[^>]*value="Ananda Putri"/);
    expect(m).toMatch(/<input[^>]*name="no_hp"[^>]*value="0812-3456-7890"/);
  });

  it("mengisi medan alamat dari baris klien, bukan dari string kosong tetap", async () => {
    // Alamat Ananda kosong di seed, jadi medan yang kebetulan selalu kosong
    // akan lolos tanpa membuktikan apa pun. Nilainya diisi lebih dulu, lalu
    // modul di-reset supaya `cache()` di `ambilKlien` tidak menyodorkan hasil
    // render sebelumnya.
    const admin = createAdminSupabase();
    const alamat = "Jl. Bukti Nyata No. 12, Kota Malang";
    await admin.from("clients").update({ alamat }).eq("id", ANANDA);
    try {
      vi.resetModules();
      const m = await markupProfil();
      expect(m).toContain(alamat);
    } finally {
      await admin.from("clients").update({ alamat: "" }).eq("id", ANANDA);
      vi.resetModules();
    }
  });

  it("TIDAK menyediakan medan untuk email, PADMA ID, maupun fase", async () => {
    const m = await markupProfil();
    // Ketiganya keputusan identitas, bukan data operasional. Kalau suatu hari
    // salah satunya muncul sebagai input, uji ini yang menahannya.
    for (const nama of ["email", "padma_id", "fase", "phase_id"]) {
      expect(m).not.toMatch(new RegExp(`<(input|select|textarea)[^>]*name="${nama}"`));
    }
    // Nilainya tetap TAMPIL sebagai bacaan — klien berhak melihatnya.
    expect(m).toContain("ananda@padma.test");
    expect(m).toContain("PAD-2607-0012");
  });

  it("form logout tetap <form method=\"post\"> yang terpisah", async () => {
    const m = await markupProfil();
    // Navigasi dokumen penuh yang menghapus Client Cache — jangan diganti
    // navigasi sisi klien, sisa data passport pemakai sebelumnya bisa tertinggal.
    expect(m).toMatch(/<form[^>]*action="\/auth\/keluar"[^>]*method="post"/);
    expect(sumber).not.toContain("router.push");
  });

  it("mengambil identitas lewat ambilKlien(), bukan query sendiri", () => {
    expect(sumber).toMatch(
      /import\s*\{[^}]*\bambilKlien\b[^}]*\}\s*from\s*["']@\/lib\/passport\/data["']/,
    );
    expect(sumber).toContain("await ambilKlien()");
  });
});

describe("profil passport — janji 'perubahan data oleh admin' ditegakkan DB", () => {
  it("klien TIDAK bisa mengubah barisnya sendiri di clients", async () => {
    const k = ref.klien!;
    const { data: ubah } = await k
      .from("clients")
      .update({ nama: "Nama Palsu", no_hp: "0800-0000-0000" })
      .eq("id", ANANDA)
      .select();
    expect(ubah ?? []).toHaveLength(0);

    // PostgREST menjawab 200 + [] untuk update yang tertahan RLS — nilainya
    // wajib dibaca ulang dengan service role, bukan disimpulkan dari respons.
    const admin = createAdminSupabase();
    const { data: cek } = await admin
      .from("clients")
      .select("nama, no_hp")
      .eq("id", ANANDA)
      .single();
    expect(cek!.nama).toBe("Ananda Putri");
    expect(cek!.no_hp).toBe("0812-3456-7890");
  });
});
