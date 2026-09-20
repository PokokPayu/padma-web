import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

/**
 * KETIGA rute penyaji isi produk DIPANGGIL SUNGGUHAN di sini, dengan sesi klien
 * sungguhan, melawan basis data dan storage sungguhan.
 *
 * Kenapa berkas ini ada (temuan review menyeluruh, Finding 10):
 * `tests/produk-gerbang-isi.test.ts` menjaga ketiga rute HANYA dengan memindai
 * TEKS SUMBERNYA, dan asersi terlemahnya menuntut kata `boleh_unduh` muncul di
 * berkas rute unduh — yang sudah dipenuhi oleh baris `.select(...)`-nya sendiri.
 * Hapus `if (!produk.boleh_unduh) return 404` dan seluruh suite tetap hijau
 * sementara setiap produk yang sengaja tidak boleh diunduh menjadi bisa diunduh
 * siapa pun yang memegang entitlement. Pemindaian sumber tetap berguna untuk
 * pagar yang tidak punya bentuk perilaku (mis. "tidak pernah 401/403"), tapi ia
 * tidak boleh menjadi SATU-SATUNYA yang menjaga sebuah gerbang.
 *
 * Sesi disuntikkan lewat mock `@/lib/supabase/server` — pola yang sudah dipakai
 * `tests/materi-route-halaman.test.ts` dan `tests/admin-produk-unggah.test.ts`:
 * RLS tetap yang menjadi hakim, tidak ada service role yang menembusnya di
 * jalur yang diuji.
 */
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { GET: getVideo } = await import("@/app/api/produk/[id]/video/route");
const { GET: getHalaman } = await import("@/app/api/produk/[id]/halaman/[n]/route");
const { GET: getUnduh } = await import("@/app/api/produk/[id]/unduh/route");
const { produkSaya } = await import("@/lib/passport/produk-saya");
const { terbitkanUrlUnggahPdfProduk, lepasIsiProduk } = await import(
  "@/app/admin/produk/[id]/unggah"
);

const BUCKET_HALAMAN = "produk-halaman";
const BUCKET_BERKAS = "produk-berkas";
const KLIEN = "ananda@padma.test";

/** Dua produk PDF dipakai bergantian; keduanya PUNYA berkas unduhan. */
let idVideo = "";
let idPdfTerkunci = ""; // boleh_unduh = false
let idPdfUnduh = ""; // boleh_unduh = true
let clientId = "";

const permintaan = () => new Request("http://uji.local/");

async function beriEntitlement(productId: string) {
  const svc = createAdminSupabase();
  await svc.from("digital_entitlements")
    .insert({ client_id: clientId, product_id: productId, sumber: "gratis" });
}

async function cabutEntitlement(productId: string) {
  const svc = createAdminSupabase();
  await svc.from("digital_entitlements").delete()
    .eq("client_id", clientId).eq("product_id", productId);
}

beforeAll(async () => {
  const svc = createAdminSupabase();
  ref.sesi = await signInAs(KLIEN);

  const { data: user } = await ref.sesi.auth.getUser();
  const { data: barisKlien } = await svc.from("clients")
    .select("id").eq("user_id", user.user!.id).single();
  clientId = barisKlien!.id;

  // ===== Produk VIDEO =====
  const { data: pv } = await svc.from("digital_products")
    .insert({ judul: "Rute video", slug: "rute-uji-video", jenis: "video", aktif: true })
    .select("id").single();
  idVideo = pv!.id;
  await svc.from("digital_product_files").insert({
    product_id: idVideo,
    objek: `produk/${idVideo}/isi.mp4`,
    mime: "video/mp4",
    byte: 1024,
  });

  // ===== Dua produk PDF, keduanya berisi SUNGGUHAN =====
  const halamanWebp = await sharp({
    create: { width: 200, height: 200, channels: 3, background: { r: 250, g: 250, b: 245 } },
  }).webp().toBuffer();

  const dok = await PDFDocument.create();
  dok.addPage();
  const pdfAsli = Buffer.from(await dok.save());

  for (const [slug, bolehUnduh] of [
    ["rute-uji-pdf-terkunci", false],
    ["rute-uji-pdf-unduh", true],
  ] as Array<[string, boolean]>) {
    const { data } = await svc.from("digital_products")
      .insert({
        judul: `Rute ${slug}`, slug, jenis: "pdf", aktif: true, boleh_unduh: bolehUnduh,
      })
      .select("id").single();
    const id = data!.id;
    if (bolehUnduh) idPdfUnduh = id;
    else idPdfTerkunci = id;

    await svc.storage.from(BUCKET_HALAMAN)
      .upload(`${id}/1.webp`, halamanWebp, { contentType: "image/webp", upsert: true });
    await svc.from("digital_product_pages")
      .insert({ product_id: id, halaman: 1, objek: `${id}/1.webp` });

    // BERKAS UNDUHAN ADA untuk KEDUANYA — termasuk yang `boleh_unduh`-nya mati.
    // Inilah yang membuat uji "ditolak karena boleh_unduh" menagih pagar yang
    // benar: kalau berkasnya tidak ada, 404-nya bisa datang dari ketiadaan
    // berkas dan uji itu akan tetap hijau seandainya pagarnya dihapus.
    await svc.storage.from(BUCKET_BERKAS)
      .upload(`${id}/isi.pdf`, pdfAsli, { contentType: "application/pdf", upsert: true });
    await svc.from("digital_product_files").insert({
      product_id: id, objek: `${id}/isi.pdf`, mime: "application/pdf", byte: pdfAsli.length,
    });
  }
});

afterAll(async () => {
  const svc = createAdminSupabase();
  for (const id of [idVideo, idPdfTerkunci, idPdfUnduh]) {
    if (!id) continue;
    for (const bucket of [BUCKET_HALAMAN, BUCKET_BERKAS]) {
      for (const prefiks of [id, `${id}/pembeli`]) {
        const { data } = await svc.storage.from(bucket).list(prefiks, { limit: 1000 });
        if (data && data.length > 0) {
          await svc.storage.from(bucket).remove(data.map((o) => `${prefiks}/${o.name}`));
        }
      }
    }
    await svc.from("digital_products").delete().eq("id", id);
  }
});

describe("rute isi produk — tanpa entitlement", () => {
  it("rute video menjawab 404", async () => {
    const res = await getVideo(permintaan(), { params: Promise.resolve({ id: idVideo }) });
    expect(res.status).toBe(404);
  });

  it("rute halaman menjawab 404", async () => {
    const res = await getHalaman(permintaan(), {
      params: Promise.resolve({ id: idPdfUnduh, n: "1" }),
    });
    expect(res.status).toBe(404);
  });

  it("rute unduh menjawab 404", async () => {
    const res = await getUnduh(permintaan(), { params: Promise.resolve({ id: idPdfUnduh }) });
    expect(res.status).toBe(404);
  });
});

describe("rute isi produk — dengan entitlement", () => {
  beforeAll(async () => {
    await beriEntitlement(idVideo);
    await beriEntitlement(idPdfTerkunci);
    await beriEntitlement(idPdfUnduh);
  });

  afterAll(async () => {
    await cabutEntitlement(idVideo);
    await cabutEntitlement(idPdfTerkunci);
    await cabutEntitlement(idPdfUnduh);
  });

  it("rute video mengalihkan ke presigned R2", async () => {
    const res = await getVideo(permintaan(), { params: Promise.resolve({ id: idVideo }) });
    // Objeknya sendiri tidak perlu ada di R2: yang diuji adalah gerbangnya,
    // dan tanda tangan diterbitkan tanpa menyentuh jaringan.
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain(`produk/${idVideo}/isi.mp4`);
  });

  it("rute halaman menyajikan gambar ber-watermark, bukan 404", async () => {
    const res = await getHalaman(permintaan(), {
      params: Promise.resolve({ id: idPdfUnduh, n: "1" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");

    const byte = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(byte.slice(0, 4)).toString("ascii")).toBe("RIFF");
    expect(Buffer.from(byte.slice(8, 12)).toString("ascii")).toBe("WEBP");
  });

  it("rute unduh menerbitkan tanda tangan DAN menyimpan salinan tercap pembeli", async () => {
    const res = await getUnduh(permintaan(), { params: Promise.resolve({ id: idPdfUnduh }) });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBeTruthy();

    const svc = createAdminSupabase();
    const { data } = await svc.storage.from(BUCKET_BERKAS).list(`${idPdfUnduh}/pembeli`);
    expect((data ?? []).map((o) => o.name)).toContain(`${clientId}.pdf`);
  });

  it("rute unduh MENOLAK produk yang boleh_unduh-nya mati, walau berkasnya ada", async () => {
    const res = await getUnduh(permintaan(), { params: Promise.resolve({ id: idPdfTerkunci }) });
    expect(res.status).toBe(404);

    // Dan tidak ada salinan tercap yang terlanjur dibuat untuknya.
    const svc = createAdminSupabase();
    const { data } = await svc.storage.from(BUCKET_BERKAS).list(`${idPdfTerkunci}/pembeli`);
    expect(data ?? []).toEqual([]);
  });

  it("rute video MENOLAK produk PDF, walau pemiliknya berhak atas berkasnya", async () => {
    // Tanpa pemeriksaan `jenis`, rute ini menandatangani kunci objek PDF
    // terhadap bucket VIDEO dan memulangkan 302 ke tautan yang tidak akan
    // pernah hidup.
    const res = await getVideo(permintaan(), { params: Promise.resolve({ id: idPdfUnduh }) });
    expect(res.status).toBe(404);
  });
});

describe("rute isi produk — entitlement yang DICABUT menutup kembali ketiganya", () => {
  beforeAll(async () => {
    await beriEntitlement(idPdfUnduh);
    await createAdminSupabase().from("digital_entitlements")
      .update({ dicabut_pada: new Date().toISOString() })
      .eq("client_id", clientId).eq("product_id", idPdfUnduh);
  });

  afterAll(async () => {
    await cabutEntitlement(idPdfUnduh);
  });

  it("halaman dan unduh sama-sama 404", async () => {
    const halaman = await getHalaman(permintaan(), {
      params: Promise.resolve({ id: idPdfUnduh, n: "1" }),
    });
    expect(halaman.status).toBe(404);

    const unduh = await getUnduh(permintaan(), { params: Promise.resolve({ id: idPdfUnduh }) });
    expect(unduh.status).toBe(404);
  });
});

/**
 * `aktif = false` berarti BERHENTI DIJUAL, bukan mencabut akses (spec: masa
 * akses "Selamanya; admin tetap bisa mencabut", dan pencabutan punya
 * `dicabut_pada` sendiri). Sebelum perbaikan ini, menonaktifkan produk membuat
 * kartunya hilang dari "Pembelian saya" dan rute unduh menjawab 404, sementara
 * rute video & halaman tetap menyajikan isinya — lima permukaan, tiga
 * perilaku.
 */
describe("produk yang DINONAKTIFKAN tetap terbuka bagi pemegang entitlement", () => {
  beforeAll(async () => {
    const svc = createAdminSupabase();
    await beriEntitlement(idVideo);
    await beriEntitlement(idPdfUnduh);
    // `idPdfTerkunci` ikut dinonaktifkan TANPA entitlement — kontrol negatif
    // di bawah bersandar padanya.
    await svc.from("digital_products").update({ aktif: false })
      .in("id", [idVideo, idPdfUnduh, idPdfTerkunci]);
  });

  afterAll(async () => {
    const svc = createAdminSupabase();
    await svc.from("digital_products").update({ aktif: true })
      .in("id", [idVideo, idPdfUnduh, idPdfTerkunci]);
    await cabutEntitlement(idVideo);
    await cabutEntitlement(idPdfUnduh);
  });

  it("KONTROL: produk nonaktif yang TIDAK dimiliki tetap tak terbaca klien", async () => {
    // Tanpa asersi ini, policy yang ditulis terlalu lebar ("authenticated boleh
    // membaca produk apa pun") akan menghijaukan seluruh describe ini sambil
    // membuka katalog yang belum tayang kepada setiap akun yang login.
    const { data } = await ref.sesi!.from("digital_products")
      .select("id").eq("id", idPdfTerkunci);
    expect(data ?? []).toEqual([]);
  });

  it("rute video tetap mengalihkan", async () => {
    const res = await getVideo(permintaan(), { params: Promise.resolve({ id: idVideo }) });
    expect(res.status).toBe(302);
  });

  it("rute halaman tetap menyajikan halamannya", async () => {
    const res = await getHalaman(permintaan(), {
      params: Promise.resolve({ id: idPdfUnduh, n: "1" }),
    });
    expect(res.status).toBe(200);
  });

  it("rute unduh tetap menerbitkan tanda tangan", async () => {
    const res = await getUnduh(permintaan(), { params: Promise.resolve({ id: idPdfUnduh }) });
    expect(res.status).toBe(302);
  });

  it('kartunya tetap berdiri di "Pembelian saya"', async () => {
    const daftar = await produkSaya(clientId);
    expect(daftar.map((p) => p.id)).toContain(idVideo);
    expect(daftar.map((p) => p.id)).toContain(idPdfUnduh);
  });

  it("etalase publik TETAP menyembunyikannya — yang berubah cuma penjualannya", async () => {
    const { bacaProdukPerSlug } = await import("@/lib/produk/katalog");
    expect(await bacaProdukPerSlug("rute-uji-pdf-unduh")).toBeNull();
  });
});

/**
 * Salinan tercap pembeli (`<produk>/pembeli/<klien>.pdf`) adalah TURUNAN dari
 * PDF sumber, dan rute unduh memakainya ulang tanpa pernah membandingkannya
 * dengan sumbernya. Sebelum perbaikan ini, admin yang mengunggah PDF perbaikan
 * tidak akan PERNAH bisa mengirimkannya kepada siapa pun yang sudah pernah
 * mengunduh — permanen, tanpa satu pun galat di layar.
 */
describe("salinan tercap pembeli dikosongkan saat sumbernya diganti atau dilepas", () => {
  async function buatSalinanTercap(productId: string) {
    ref.sesi = await signInAs(KLIEN);
    await beriEntitlement(productId);
    const res = await getUnduh(permintaan(), { params: Promise.resolve({ id: productId }) });
    expect(res.status).toBe(302);

    const svc = createAdminSupabase();
    const { data } = await svc.storage.from(BUCKET_BERKAS).list(`${productId}/pembeli`);
    expect((data ?? []).length).toBe(1);
  }

  it("mengunggah PDF baru menghapus salinan tercap yang lama", async () => {
    await buatSalinanTercap(idPdfUnduh);

    ref.sesi = await signInAs("admin@padma.test");
    const hasil = await terbitkanUrlUnggahPdfProduk(idPdfUnduh, 2048);
    expect(hasil.ok).toBe(true);

    const svc = createAdminSupabase();
    const { data } = await svc.storage.from(BUCKET_BERKAS).list(`${idPdfUnduh}/pembeli`);
    expect(data ?? []).toEqual([]);

    ref.sesi = await signInAs(KLIEN);
    await cabutEntitlement(idPdfUnduh);
  });

  it("melepas isi produk menghapus salinan tercap juga, bukan meninggalkannya yatim", async () => {
    await buatSalinanTercap(idPdfUnduh);

    const svc = createAdminSupabase();
    // "Lepas isi" menolak produk yang masih tayang — itu pagar lain, bukan
    // yang diuji di sini.
    await svc.from("digital_products").update({ aktif: false }).eq("id", idPdfUnduh);

    ref.sesi = await signInAs("admin@padma.test");
    const hasil = await lepasIsiProduk(idPdfUnduh);
    expect(hasil.ok).toBe(true);

    const { data } = await svc.storage.from(BUCKET_BERKAS).list(`${idPdfUnduh}/pembeli`);
    expect(data ?? []).toEqual([]);

    ref.sesi = await signInAs(KLIEN);
    await cabutEntitlement(idPdfUnduh);
  });
});
