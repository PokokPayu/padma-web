/**
 * SAPAAN BERNAMA SESUDAH SKRINING TERSAMBUNG (spec C1 J4, K7).
 *
 * Sapaan ini bukan hiasan: ia lapis kedua di belakang umur token 2 jam, dan
 * satu-satunya yang tidak bergantung pada waktu. Satu HP di ruang tunggu bisa
 * dipakai dua orang dalam sepuluh menit; menyebut nama membuat salah sambung
 * TERLIHAT oleh satu-satunya pihak yang pasti mengenalinya.
 *
 * Yang dijaga berkas ini ada dua, dan yang kedua lebih penting:
 *   1. sapaannya memang terbit, menyebut nama pada skrining;
 *   2. namanya datang dari BASIS DATA lewat sesi pengguna — bukan dari URL.
 *      Bila nama boleh dioper lewat query, siapa pun bisa membuat Passport
 *      orang lain menyapa nama karangan, dan URL bocor ke riwayat peramban,
 *      header Referer, serta log proxy.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { skriningHijau } from "./helpers/skrining";

const admin = createAdminSupabase();

const ANANDA = "44444444-4444-4444-4444-444444444401";
const RINA = "44444444-4444-4444-4444-444444444402";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ref.sesi! }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  usePathname: () => "/passport",
}));

const { default: BerandaPassport } = await import("@/app/passport/page");

async function markup(sp: Record<string, string>): Promise<string> {
  const el = await BerandaPassport({ searchParams: Promise.resolve(sp) });
  return renderToStaticMarkup(el);
}

async function bersihkan() {
  await admin.from("screenings").delete().like("kode", "UJI-%");
}

beforeAll(async () => {
  ref.sesi = await signInAs("ananda@padma.test");
  await bersihkan();
});

beforeEach(bersihkan);
afterAll(bersihkan);

describe("sapaan sesudah skrining tersambung", () => {
  it("menyebut NAMA pada skrining, dibaca dari basis data", async () => {
    const id = await skriningHijau(admin, ANANDA);
    await admin.from("screenings").update({ nama: "Sari Wulandari" }).eq("id", id);

    const html = await markup({ skrining: id });
    expect(html).toContain("Sari Wulandari");
    expect(html).toContain("telah disambungkan");
  });

  it("mengajak memeriksa bila namanya BUKAN dia", async () => {
    // Sapaan yang hanya memberi kabar baik tidak menolong siapa pun. Yang
    // membuatnya berguna adalah kalimat berikutnya: apa yang harus dilakukan
    // kalau nama itu asing.
    const id = await skriningHijau(admin, ANANDA);
    const html = await markup({ skrining: id });
    expect(html).toMatch(/bukan Anda/i);
  });

  it("TIDAK terbit untuk skrining milik ORANG LAIN", async () => {
    // Dibaca lewat sesi pengguna, jadi policy "screenings: klien baca miliknya"
    // yang memutuskan. Id orang lain memulangkan nol baris.
    const id = await skriningHijau(admin, RINA);
    await admin.from("screenings").update({ nama: "Nama Orang Lain" }).eq("id", id);

    const html = await markup({ skrining: id });
    expect(html).not.toContain("Nama Orang Lain");
    expect(html).not.toContain("telah disambungkan");
  });

  it("TIDAK terbit untuk id karangan, dan TIDAK melempar", async () => {
    // Ini kabar baik yang gagal tampil, bukan pintu yang tertutup — halaman
    // harus tetap berdiri.
    const html = await markup({ skrining: "00000000-0000-0000-0000-000000000000" });
    expect(html).not.toContain("telah disambungkan");
    expect(html.length).toBeGreaterThan(100);
  });

  it("tanpa parameter sama sekali, beranda tampil seperti biasa", async () => {
    const html = await markup({});
    expect(html).not.toContain("telah disambungkan");
  });

  it("NAMA tidak pernah diambil dari URL", async () => {
    // Pagar sumber: bila kelak seseorang menambah `?nama=` demi kemudahan,
    // uji ini yang menahannya. Nama adalah data pribadi; URL bocor ke riwayat
    // peramban, Referer, dan log proxy.
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const sumber = readFileSync(
      path.resolve(__dirname, "..", "src/app/passport/page.tsx"),
      "utf8",
    );
    const kode = sumber.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(kode).not.toMatch(/sp\.nama|searchParams.*nama/);
  });
});
