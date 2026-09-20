import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const AKAR = path.resolve(__dirname, "..");
const UNGGAH = readFileSync(path.join(AKAR, "src/app/admin/produk/[id]/unggah.ts"), "utf8");

// `lepasIsiProduk` memakai sesi pengguna (`createServerSupabase`). Di vitest
// tidak ada cookie, jadi klien ber-SESI SUNGGUHAN disuntikkan — RLS dan
// `requireRole` di dalamnya tetap berjalan apa adanya, persis pola
// `tests/admin-produk.test.ts` / `tests/admin-materi.test.ts`.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { lepasIsiProduk } = await import("@/app/admin/produk/[id]/unggah");

/**
 * Unggahan adalah satu-satunya titik di modul ini yang boleh memegang service
 * role, dan justru karena itu pagarnya diperiksa sebagai TEKS SUMBER: pagar
 * perilaku ("klien tidak bisa mengunggah") tidak bisa melihat requireRole yang
 * terhapus dari satu action di antara empat.
 */
describe("pagar unggahan produk", () => {
  it("setiap server action dibuka requireRole", () => {
    const jumlahAction = (UNGGAH.match(/^export async function /gm) ?? []).length;
    const jumlahGerbang = (UNGGAH.match(/requireRole\(\[/g) ?? []).length;
    expect(jumlahAction).toBeGreaterThan(0);
    expect(jumlahGerbang).toBe(jumlahAction);
  });

  it("path objek diturunkan dari helper, tidak pernah dari parameter berkas", () => {
    expect(UNGGAH).toContain("namaObjekVideoProduk");
    expect(UNGGAH).toContain("namaObjekHalamanProduk");
    // Tidak ada satu pun path yang dirakit dari nama berkas kiriman browser.
    expect(UNGGAH).not.toMatch(/formData\.get\(["']nama/);
  });

  it("keberadaan produk diperiksa lewat SESI pengguna, bukan service role — PER ACTION", () => {
    // Perbandingan GLOBAL (indexOf pertama-pertama di seluruh berkas) tidak
    // cukup: action KEDELAPAN yang kelak memanggil createAdminSupabase()
    // sebelum createServerSupabase()-nya SENDIRI tetap lolos selama order
    // di action-action LAIN yang lebih awal di berkas ini masih benar — pagar
    // itu tidak pernah bisa merah untuk kasus yang justru ingin dicegahnya.
    // Dipecah PER BLOK `export async function` supaya setiap action diperiksa
    // sendiri-sendiri, urutannya mengikat DI DALAM blok itu saja: kunci objek
    // storage baru boleh disentuh (`createAdminSupabase`) sesudah action yang
    // sama membaca haknya lewat sesi pengguna (`createServerSupabase`).
    const blok = UNGGAH.split(/(?=^export async function )/m).filter((b) =>
      b.startsWith("export async function"),
    );
    // Uji yang diam-diam memeriksa larik kosong selalu "lulus" tanpa menjaga
    // apa pun — pola guard yang sama seperti
    // `expect(berkasPanel().length).toBeGreaterThan(0)` di
    // tests/panel-primitif.test.ts.
    expect(blok.length).toBeGreaterThan(0);

    const blokDenganService = blok.filter((b) => b.includes("createAdminSupabase"));
    // Sama alasannya: bila TIDAK ADA action yang memegang service role sama
    // sekali, loop di bawah tidak pernah jalan dan pagarnya diam-diam tidak
    // menjaga apa pun.
    expect(blokDenganService.length).toBeGreaterThan(0);

    for (const b of blokDenganService) {
      const posisiSesi = b.indexOf("createServerSupabase");
      const posisiService = b.indexOf("createAdminSupabase");
      expect(posisiSesi).toBeGreaterThan(-1);
      expect(posisiService).toBeGreaterThan(posisiSesi);
    }
  });

  it("batas ukuran dipakai ulang dari modul materi, bukan ditulis ulang", () => {
    // `periksaBerkasVideo` sudah memagari MIME DAN ukuran sekaligus. Menulis
    // ulang batasnya di sini melahirkan angka kedua yang bisa berbeda dari
    // yang dipakai pengunggah materi tanpa satu pun uji berubah merah.
    expect(UNGGAH).toContain("periksaBerkasVideo");
    expect(UNGGAH).toContain("MAKS_HALAMAN");
  });
});

const BUCKET_HALAMAN = "produk-halaman";
const bersihkan: string[] = [];

afterEach(async () => {
  const svc = createAdminSupabase();
  while (bersihkan.length) {
    const id = bersihkan.pop()!;
    await svc.from("digital_products").delete().eq("id", id);
    // Cadangan: sapu sisa objek storage kalau uji gagal di tengah (cascade
    // Postgres tidak menyentuh bucket — bukan baris) — pola yang sama dengan
    // `tests/materi-unggah-lib.test.ts`.
    const { data: sisa } = await svc.storage.from(BUCKET_HALAMAN).list(id, { limit: 1000 });
    if (sisa && sisa.length > 0) {
      await svc.storage.from(BUCKET_HALAMAN).remove(sisa.map((o) => `${id}/${o.name}`));
    }
  }
});

/**
 * Sesi admin sungguhan, tetapi RPC `lepas_berkas_produk` dipaksa gagal
 * SECARA SINTETIS — mensimulasikan blip PostgREST pada delete KEDUA milik
 * `lepasIsiProduk`, tanpa mengubah satu baris pun di tabel lain. `unggah.ts`
 * tidak lagi memanggil `.from("digital_product_files").delete()` langsung
 * (migration `produk_hapus_isi`, review round 2) — jalur tulisnya sekarang
 * RPC, jadi yang perlu dipalsukan adalah `.rpc()`, bukan `.from()`.
 *
 * `Object.create(asli)` + shadow `.rpc` SENGAJA dipilih ketimbang Proxy:
 * `sesiPalsu` mewarisi SELURUH state `asli` (auth, storage, `.from`, RPC
 * lain) apa adanya lewat rantai prototype, dan hanya `.rpc` yang di-shadow —
 * jadi tidak ada `this`-binding builder PostgREST yang perlu dipalsukan
 * ulang lewat trap Proxy yang rawan pecah diam-diam.
 */
function sesiDenganLepasBerkasGagal(asli: SupabaseClient): SupabaseClient {
  const rpcAsli = asli.rpc.bind(asli);
  const sesiPalsu = Object.create(asli) as SupabaseClient;
  (sesiPalsu as unknown as { rpc: typeof asli.rpc }).rpc = ((nama: string, params?: unknown) => {
    if (nama === "lepas_berkas_produk") {
      return Promise.resolve({
        data: null,
        error: { code: "FAKE", message: "dipaksa gagal untuk uji" },
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (rpcAsli as any)(nama, params);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  return sesiPalsu;
}

/**
 * Finding 1 (review Task 6): `lepasIsiProduk` menyentuh DUA tabel untuk PDF
 * (`digital_product_pages` lalu `digital_product_files`) dan sempat membuat
 * pembersihan objek halaman di storage MENUNGGU suksesnya penghapusan baris
 * `digital_product_files` — begitu delete kedua itu gagal, fungsi berhenti
 * SEBELUM blok pembersihan storage, walau nama objeknya sudah di tangan.
 * Baris halaman sudah kosong, jadi percobaan ULANG membaca NOL baris dan
 * tidak pernah lagi menyentuh objek-objek itu: yatim PERMANEN, senyap, dan
 * `objekTersisa` tidak pernah sempat dilaporkan. Uji ini merah persis pada
 * kasus itu bila kopling itu kembali.
 */
describe("lepasIsiProduk — pembersihan objek halaman TIDAK disandera baris digital_product_files", () => {
  it("delete digital_product_files gagal, objek halaman tetap terhapus dari storage", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc
      .from("digital_products")
      .insert({ judul: "Uji Lepas Isi Coupling", slug: "uji-lepas-isi-coupling", jenis: "pdf" })
      .select("id")
      .single();
    const id = produk!.id;
    bersihkan.push(id);

    const objekHalaman = [`${id}/1.webp`, `${id}/2.webp`];
    for (const objek of objekHalaman) {
      const { error } = await svc.storage
        .from(BUCKET_HALAMAN)
        .upload(objek, Buffer.from("uji"), { contentType: "image/webp" });
      expect(error).toBeNull();
    }
    await svc.from("digital_product_pages").insert(
      objekHalaman.map((objek, i) => ({ product_id: id, halaman: i + 1, objek })),
    );
    await svc.from("digital_product_files").insert({
      product_id: id, objek: `${id}/isi.pdf`, mime: "application/pdf", byte: 100,
    });

    const sesiAsli = await signInAs("admin@padma.test");
    ref.sesi = sesiDenganLepasBerkasGagal(sesiAsli);

    const hasil = await lepasIsiProduk(id);
    // Delete KEDUA (`digital_product_files`) dipaksa gagal, jadi fungsi ini
    // sungguh melaporkan gagal — itu benar dan bukan yang diuji di sini.
    expect(hasil.ok).toBe(false);

    // Baris halaman sungguh sudah kosong: delete PERTAMA, terhadap tabel
    // yang tidak dipalsukan, tetap benar-benar berhasil.
    const { data: halamanSisa } = await svc
      .from("digital_product_pages").select("halaman").eq("product_id", id);
    expect(halamanSisa ?? []).toEqual([]);

    // INTINYA finding ini: objek halaman ikut lenyap dari storage WALAU
    // delete kedua gagal. Sebelum perbaikan, baris kosong + objek yang masih
    // ada di titik ini adalah PERSIS keadaan bug-nya.
    const { data: sisaStorage } = await svc.storage.from(BUCKET_HALAMAN).list(id);
    expect(sisaStorage ?? []).toEqual([]);

    // Baris `digital_product_files` memang TIDAK ikut terhapus — delete-nya
    // sengaja dipaksa gagal, dan itu bukan bagian yang diuji fix ini.
    const { data: berkasSisa } = await svc
      .from("digital_product_files").select("id").eq("product_id", id);
    expect((berkasSisa ?? []).length).toBe(1);
  });
});
