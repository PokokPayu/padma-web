import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

/**
 * Reader `/passport/produk/[slug]` dirender SUNGGUHAN dengan sesi klien, bukan
 * dibaca sebagai teks: yang dijaga di sini adalah kapan tombol "Unduh berkas
 * asli" muncul, dan itu pertanyaan tentang HASIL render, bukan tentang kata
 * yang ada di berkas.
 */
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const ReaderProduk = (await import("@/app/passport/produk/[slug]/page")).default;

const SLUG_TANPA_BERKAS = "uji-reader-tanpa-berkas";
const SLUG_DENGAN_BERKAS = "uji-reader-dengan-berkas";
const dibuat: string[] = [];

async function semaiPdf(slug: string, adaBerkas: boolean): Promise<string> {
  const svc = createAdminSupabase();
  const { data } = await svc.from("digital_products")
    .insert({ judul: `Reader ${slug}`, slug, jenis: "pdf", aktif: true, boleh_unduh: true })
    .select("id").single();
  const id = data!.id;
  dibuat.push(id);

  await svc.from("digital_product_pages")
    .insert({ product_id: id, halaman: 1, objek: `${id}/1.webp` });
  if (adaBerkas) {
    await svc.from("digital_product_files").insert({
      product_id: id, objek: `${id}/isi.pdf`, mime: "application/pdf", byte: 2048,
    });
  }
  return id;
}

async function markup(slug: string): Promise<string> {
  const el = await ReaderProduk({ params: Promise.resolve({ slug }) });
  return renderToStaticMarkup(el);
}

beforeAll(async () => {
  const svc = createAdminSupabase();
  ref.sesi = await signInAs("ananda@padma.test");
  const { data: user } = await ref.sesi.auth.getUser();
  const { data: klien } = await svc.from("clients")
    .select("id").eq("user_id", user.user!.id).single();

  for (const [slug, adaBerkas] of [
    [SLUG_TANPA_BERKAS, false],
    [SLUG_DENGAN_BERKAS, true],
  ] as Array<[string, boolean]>) {
    const id = await semaiPdf(slug, adaBerkas);
    await svc.from("digital_entitlements")
      .insert({ client_id: klien!.id, product_id: id, sumber: "gratis" });
  }
});

afterAll(async () => {
  const svc = createAdminSupabase();
  while (dibuat.length) await svc.from("digital_products").delete().eq("id", dibuat.pop()!);
});

describe("tombol unduh reader produk", () => {
  /**
   * `boleh_unduh` bisa dinyalakan `perbaruiProduk` KAPAN SAJA, sementara baris
   * `digital_product_files` untuk produk PDF hanya lahir bila bendera itu sudah
   * menyala SAAT PDF utuhnya diunggah. Bendera yang menyala di atas produk
   * tanpa berkas melahirkan tombol yang selalu berakhir 404 di
   * `/api/produk/[id]/unduh` — janji yang tidak bisa ditepati.
   */
  it("TIDAK dirender untuk produk yang boleh_unduh-nya menyala tapi berkasnya tidak ada", async () => {
    const m = await markup(SLUG_TANPA_BERKAS);
    // Kontrol positif: halamannya memang terender (bukan kosong karena galat),
    // jadi ketiadaan tombol benar-benar berarti tombolnya tidak dirender.
    expect(m).toContain("Reader uji-reader-tanpa-berkas");
    expect(m).not.toContain("Unduh berkas asli");
  });

  it("dirender begitu berkas unduhannya sungguh ada", async () => {
    const m = await markup(SLUG_DENGAN_BERKAS);
    expect(m).toContain("Unduh berkas asli");
    expect(m).toContain("/unduh");
  });
});
