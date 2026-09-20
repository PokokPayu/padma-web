// tests/produk-rpc-hapus-isi.test.ts
import { describe, it, expect } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";

/**
 * `ganti_halaman_produk` & `lepas_berkas_produk` (migration
 * `produk_hapus_isi`, review round 2 Task 6) — RPC `security definer`
 * berparameter tunggal, menggantikan `grant delete ... to authenticated`
 * yang sempat ditulis draf pertama migration itu.
 *
 * Pola dan alasan pengujiannya SAMA PERSIS dengan `tests/materi-halaman.test.ts`
 * dan describe "radius satu permintaan" di `tests/hak-hapus-berlebih.test.ts`
 * (untuk `ganti_halaman_materi`/`lepas_video_materi`): radius harus terkunci
 * PARAMETER (satu produk, tidak pernah lebih), dan otorisasinya harus benar-
 * benar diperiksa DI DALAM fungsi — bukan diasumsikan dari RLS, yang tidak
 * pernah dievaluasi untuk fungsi `security definer`.
 */

const svc = createAdminSupabase();

async function buatProdukPdf(judul: string, slug: string): Promise<string> {
  const { data, error } = await svc
    .from("digital_products")
    .insert({ judul, slug, jenis: "pdf" })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function buatProdukVideo(judul: string, slug: string): Promise<string> {
  const { data, error } = await svc
    .from("digital_products")
    .insert({ judul, slug, jenis: "video" })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

describe("ganti_halaman_produk — radius & otorisasi", () => {
  it("radiusnya SATU produk: mengosongkan produk A tidak menyentuh halaman produk B", async () => {
    const a = await buatProdukPdf("PAD-UJI Radius Halaman A", "pad-uji-radius-halaman-a");
    const b = await buatProdukPdf("PAD-UJI Radius Halaman B", "pad-uji-radius-halaman-b");
    try {
      const admin = await signInAs("admin@padma.test");
      await admin.rpc("ganti_halaman_produk", {
        p_product_id: a,
        p_halaman: [{ halaman: 1, objek: `${a}/1.webp` }],
      });
      await admin.rpc("ganti_halaman_produk", {
        p_product_id: b,
        p_halaman: [
          { halaman: 1, objek: `${b}/1.webp` },
          { halaman: 2, objek: `${b}/2.webp` },
        ],
      });

      // Mengosongkan A, lewat sesi admin yang SAMA yang barusan menulis B —
      // radiusnya terkunci parameter `p_product_id`, bukan policy "staf"
      // yang `for all` dan tidak pernah menyempit ke satu produk.
      await admin.rpc("ganti_halaman_produk", { p_product_id: a, p_halaman: [] });

      const { data: sisaB } = await svc
        .from("digital_product_pages").select("halaman").eq("product_id", b);
      expect(sisaB).toHaveLength(2);

      const { data: sisaA } = await svc
        .from("digital_product_pages").select("halaman").eq("product_id", a);
      expect(sisaA).toHaveLength(0);
    } finally {
      await svc.from("digital_products").delete().in("id", [a, b]);
    }
  });

  it("klien tidak bisa memanggil RPC ini", async () => {
    const id = await buatProdukPdf("PAD-UJI Klien Ganti Halaman", "pad-uji-klien-ganti-halaman");
    try {
      await svc.rpc("ganti_halaman_produk", {
        p_product_id: id,
        p_halaman: [{ halaman: 1, objek: `${id}/1.webp` }],
      });

      const klien = await signInAs("ananda@padma.test");
      const { error } = await klien.rpc("ganti_halaman_produk", {
        p_product_id: id,
        p_halaman: [{ halaman: 1, objek: `${id}/BAJAK.webp` }],
      });
      expect(error).not.toBeNull();

      // Guard di dalam fungsi me-raise SEBELUM delete/insert apa pun
      // berjalan — baris lama harus utuh dengan objek SEMULA, bukan sekadar
      // "RPC menolak".
      const { data: sisa } = await svc
        .from("digital_product_pages").select("objek").eq("product_id", id);
      expect(sisa).toHaveLength(1);
      expect(sisa![0].objek).toBe(`${id}/1.webp`);
    } finally {
      await svc.from("digital_products").delete().eq("id", id);
    }
  });

  it("staf (admin) TETAP bisa memanggil lewat SESI ASLI, bukan cuma service role", async () => {
    // Krusial, bukan sekadar kelengkapan: memanggil lewat service role tidak
    // pernah membuktikan guard `user_role() in ('admin','owner')` di DALAM
    // fungsi benar-benar berjalan — service role menembus semuanya terlepas
    // guard itu ada atau tidak. Hanya sesi JWT asli yang membuktikan cabang
    // IZIN-nya, bukan hanya cabang radius.
    const id = await buatProdukPdf("PAD-UJI Admin Ganti Halaman", "pad-uji-admin-ganti-halaman");
    try {
      const admin = await signInAs("admin@padma.test");
      const { data, error } = await admin.rpc("ganti_halaman_produk", {
        p_product_id: id,
        p_halaman: [
          { halaman: 1, objek: `${id}/1.webp` },
          { halaman: 2, objek: `${id}/2.webp` },
        ],
      });
      expect(error).toBeNull();
      expect(data).toEqual([]); // baris lama kosong, jadi tidak ada yang dipulangkan

      const { data: sisa } = await svc
        .from("digital_product_pages").select("halaman").eq("product_id", id);
      expect(sisa).toHaveLength(2);
    } finally {
      await svc.from("digital_products").delete().eq("id", id);
    }
  });
});

describe("lepas_berkas_produk — radius & otorisasi", () => {
  it("radiusnya SATU produk, dan memulangkan objek baris yang dihapus", async () => {
    const a = await buatProdukVideo("PAD-UJI Radius Berkas A", "pad-uji-radius-berkas-a");
    const b = await buatProdukVideo("PAD-UJI Radius Berkas B", "pad-uji-radius-berkas-b");
    try {
      await svc.from("digital_product_files").insert([
        { product_id: a, objek: `produk/${a}/isi.mp4`, mime: "video/mp4", byte: 10 },
        { product_id: b, objek: `produk/${b}/isi.mp4`, mime: "video/mp4", byte: 10 },
      ]);

      const admin = await signInAs("admin@padma.test");
      const { data: lepas, error } = await admin.rpc("lepas_berkas_produk", { p_product_id: a });
      expect(error).toBeNull();
      expect(lepas).toEqual([{ objek: `produk/${a}/isi.mp4` }]);

      const { data: sisaA } = await svc
        .from("digital_product_files").select("id").eq("product_id", a);
      expect(sisaA).toHaveLength(0);

      const { data: sisaB } = await svc
        .from("digital_product_files").select("id").eq("product_id", b);
      expect(sisaB).toHaveLength(1);
    } finally {
      await svc.from("digital_products").delete().in("id", [a, b]);
    }
  });

  it("klien tidak bisa memanggil RPC ini", async () => {
    const id = await buatProdukVideo("PAD-UJI Klien Lepas Berkas", "pad-uji-klien-lepas-berkas");
    try {
      await svc.from("digital_product_files").insert({
        product_id: id, objek: `produk/${id}/isi.mp4`, mime: "video/mp4", byte: 10,
      });

      const klien = await signInAs("ananda@padma.test");
      const { error } = await klien.rpc("lepas_berkas_produk", { p_product_id: id });
      expect(error).not.toBeNull();

      const { data: sisa } = await svc
        .from("digital_product_files").select("objek").eq("product_id", id);
      expect(sisa).toHaveLength(1);
    } finally {
      await svc.from("digital_products").delete().eq("id", id);
    }
  });

  it("staf (admin) TETAP bisa memanggil lewat SESI ASLI, bukan cuma service role", async () => {
    const id = await buatProdukVideo("PAD-UJI Admin Lepas Berkas", "pad-uji-admin-lepas-berkas");
    try {
      await svc.from("digital_product_files").insert({
        product_id: id, objek: `produk/${id}/isi.mp4`, mime: "video/mp4", byte: 10,
      });

      const admin = await signInAs("admin@padma.test");
      const { data, error } = await admin.rpc("lepas_berkas_produk", { p_product_id: id });
      expect(error).toBeNull();
      expect(data).toEqual([{ objek: `produk/${id}/isi.mp4` }]);
    } finally {
      await svc.from("digital_products").delete().eq("id", id);
    }
  });
});

it("anon tidak memegang EXECUTE atas kedua RPC", async () => {
  const baris = await querySql<{ n: string }>(`
    select count(*)::text as n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('ganti_halaman_produk','lepas_berkas_produk')
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
            or has_function_privilege('public', p.oid, 'EXECUTE'))`);
  expect(Number(baris[0].n)).toBe(0);
});
