import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";

/**
 * Bentuk data produk berbab (spec 2026-10-16). Yang diuji di sini adalah
 * hal yang TIDAK terlihat saat admin mengeklik panel: konsistensi bab-materi
 * dijaga Postgres (bukan aplikasi), pagar kolom masa berlaku, dan apa yang
 * boleh dibaca anon.
 */
const svc = createAdminSupabase();
let produkAktif: string;
let produkNonaktif: string;
let babAktif: string;
let babNonaktif: string;
let materiAktif: string;

beforeAll(async () => {
  const { data: p1, error: e1 } = await svc.from("digital_products")
    .insert({ judul: "PAD-UJI Skema Bab Aktif", slug: "pad-uji-skema-bab-aktif", aktif: true })
    .select("id").single();
  if (e1) throw e1;
  produkAktif = p1!.id;
  const { data: p2, error: e2 } = await svc.from("digital_products")
    .insert({ judul: "PAD-UJI Skema Bab Nonaktif", slug: "pad-uji-skema-bab-nonaktif" })
    .select("id").single();
  if (e2) throw e2;
  produkNonaktif = p2!.id;

  const { data: b1 } = await svc.from("digital_product_sections")
    .insert({ product_id: produkAktif, judul: "Bab satu" }).select("id").single();
  babAktif = b1!.id;
  const { data: b2 } = await svc.from("digital_product_sections")
    .insert({ product_id: produkNonaktif, judul: "Bab rahasia" }).select("id").single();
  babNonaktif = b2!.id;

  const { data: m1, error: em } = await svc.from("digital_product_materials")
    .insert({ section_id: babAktif, product_id: produkAktif, judul: "Materi satu", jenis: "video" })
    .select("id").single();
  if (em) throw em;
  materiAktif = m1!.id;
  await svc.from("digital_product_materials")
    .insert({ section_id: babNonaktif, product_id: produkNonaktif, judul: "Materi rahasia", jenis: "pdf" });
  await svc.from("digital_product_files")
    .insert({ material_id: materiAktif, objek: `produk/${produkAktif}/${materiAktif}/isi.mp4`, mime: "video/mp4", byte: 10 });
});

afterAll(async () => {
  await svc.from("digital_products").delete().in("id", [produkAktif, produkNonaktif]);
});

describe("konsistensi bab-materi dijaga basis data", () => {
  it("materi yang product_id-nya berbeda dari babnya ditolak", async () => {
    const { error } = await svc.from("digital_product_materials")
      .insert({ section_id: babAktif, product_id: produkNonaktif, judul: "Nyasar", jenis: "pdf" });
    expect(error?.code).toBe("23503");
  });

  it("bab yang masih berisi tidak bisa dihapus lewat RPC", async () => {
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("hapus_bab_produk", { p_section_id: babAktif });
    expect(error?.message).toMatch(/masih berisi/);
  });

  it("hapus_materi_produk memulangkan objek isi sebelum menghapus", async () => {
    const { data: bab } = await svc.from("digital_product_sections")
      .insert({ product_id: produkAktif, judul: "Bab sementara" }).select("id").single();
    const { data: m } = await svc.from("digital_product_materials")
      .insert({ section_id: bab!.id, product_id: produkAktif, judul: "Sementara", jenis: "video", sampul_objek: "x/sampul.webp" })
      .select("id").single();
    await svc.from("digital_product_files")
      .insert({ material_id: m!.id, objek: "produk/x/y/isi.mp4", mime: "video/mp4", byte: 1 });

    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin.rpc("hapus_materi_produk", { p_material_id: m!.id });
    expect(error).toBeNull();
    expect(data).toEqual(expect.arrayContaining([
      { asal: "video", objek: "produk/x/y/isi.mp4" },
      { asal: "sampul", objek: "x/sampul.webp" },
    ]));
    const { data: sisa } = await svc.from("digital_product_materials").select("id").eq("id", m!.id);
    expect(sisa).toEqual([]);

    const { error: eBab } = await admin.rpc("hapus_bab_produk", { p_section_id: bab!.id });
    expect(eBab).toBeNull();
  });

  it("klien tidak bisa memanggil hapus_materi_produk", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { error } = await klien.rpc("hapus_materi_produk", { p_material_id: materiAktif });
    expect(error?.message).toMatch(/hanya admin\/owner/);
  });
});

/**
 * Dua RPC tulis-isi per materi adalah SECURITY DEFINER dan dipanggil dari
 * server action ber-sesi staf. Guard `user_role() in ('admin','owner')` di
 * dalamnya adalah SATU-SATUNYA pagar bila klien memanggil PostgREST langsung:
 * grant `authenticated` tidak membedakan peran. Dulu teruji di
 * produk-rpc-hapus-isi.test.ts; ikut terhapus bersama RPC lamanya.
 */
describe("klien tidak bisa memanggil RPC tulis-isi materi", () => {
  let materiIsi: string;
  let babIsi: string;

  beforeAll(async () => {
    const { data: bab } = await svc.from("digital_product_sections")
      .insert({ product_id: produkAktif, judul: "Bab RPC klien" }).select("id").single();
    babIsi = bab!.id;
    const { data: m } = await svc.from("digital_product_materials")
      .insert({ section_id: babIsi, product_id: produkAktif, judul: "Materi RPC klien", jenis: "pdf" })
      .select("id").single();
    materiIsi = m!.id;
    await svc.from("digital_product_pages")
      .insert({ material_id: materiIsi, halaman: 1, objek: "rpc-klien/1.webp" });
    await svc.from("digital_product_files")
      .insert({ material_id: materiIsi, objek: "rpc-klien/isi.pdf", mime: "application/pdf", byte: 1 });
  });

  it("ganti_halaman_materi_produk ditolak dan halaman TETAP ada", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { error } = await klien.rpc("ganti_halaman_materi_produk", {
      p_material_id: materiIsi, p_halaman: [],
    });
    expect(error?.message).toMatch(/hanya admin\/owner/);
    const { data } = await svc.from("digital_product_pages").select("objek").eq("material_id", materiIsi);
    expect(data).toEqual([{ objek: "rpc-klien/1.webp" }]);
  });

  it("lepas_berkas_materi ditolak dan berkas TETAP ada", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { error } = await klien.rpc("lepas_berkas_materi", { p_material_id: materiIsi });
    expect(error?.message).toMatch(/hanya admin\/owner/);
    const { data } = await svc.from("digital_product_files").select("objek").eq("material_id", materiIsi);
    expect(data).toEqual([{ objek: "rpc-klien/isi.pdf" }]);
  });
});

describe("masa berlaku hanya ditulis owner", () => {
  it("admin ditolak", async () => {
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.from("digital_products")
      .update({ masa_berlaku_bulan: 9 }).eq("id", produkAktif);
    expect(error?.code).toBe("42501");
  });

  it("owner diterima", async () => {
    const owner = await signInAs("owner@padma.test");
    const { data, error } = await owner.from("digital_products")
      .update({ masa_berlaku_bulan: 9 }).eq("id", produkAktif).select("masa_berlaku_bulan");
    expect(error).toBeNull();
    expect(data).toEqual([{ masa_berlaku_bulan: 9 }]);
  });

  it("admin tetap bisa menyunting kolom lain", async () => {
    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin.from("digital_products")
      .update({ deskripsi: "disunting admin" }).eq("id", produkAktif).select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

describe("yang boleh dibaca anon", () => {
  it("bab dan materi produk TAYANG terbaca", async () => {
    const anon = anonClient();
    const { data: bab } = await anon.from("digital_product_sections").select("id").eq("product_id", produkAktif);
    const { data: materi } = await anon.from("digital_product_materials").select("id").eq("product_id", produkAktif);
    expect(bab?.length).toBeGreaterThan(0);
    expect(materi?.length).toBeGreaterThan(0);
  });

  it("bab dan materi produk NONAKTIF tidak terbaca", async () => {
    const anon = anonClient();
    const { data: bab } = await anon.from("digital_product_sections").select("id").eq("product_id", produkNonaktif);
    const { data: materi } = await anon.from("digital_product_materials").select("id").eq("product_id", produkNonaktif);
    expect(bab).toEqual([]);
    expect(materi).toEqual([]);
  });

  it("isi (files/pages) tidak pernah terbaca anon", async () => {
    const anon = anonClient();
    const { data: berkas, error } = await anon.from("digital_product_files").select("objek").eq("material_id", materiAktif);
    expect(berkas ?? []).toEqual([]);
    expect(error === null || error.code === "42501").toBe(true);
  });
});
