/**
 * `npm run seed:master` — mengisi data master DUMMY untuk lingkungan dev.
 *
 * Isinya (lihat `scripts/dummy-master/data.ts`):
 * - produk digital: berbayar, berbab, bermasa berlaku, gratis, dan satu draf.
 *   Masing-masing lengkap dengan harga, bab, materi PDF berhalaman `.webp`,
 *   dan sampul;
 * - mitra per jenjang jarak;
 * - testimoni draf;
 * - alamat berpin untuk klien seed Ananda.
 *
 * Jalankan SESUDAH `npm run seed:users`, karena alamat Ananda menulis ke baris
 * klien seed. Idempoten: id tetap, upsert, dan unggahan `upsert: true`.
 *
 * TARGET dijaga daftar putih (`dummy-master/target.ts`): instans lokal atau
 * proyek dev saja. Ke dev, kirim URL dan service role key dev sebagai env
 * proses, karena dotenv tidak menimpa env yang sudah terpasang:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://mdtzrzwapuaalmsxomkm.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role dev> npm run seed:master
 *
 * JANGAN jalankan ke instans yang dipakai `npm test`. Uji penjualan dan
 * produk menghitung baris dari keadaan seed, dan produk tambahan memerahkan
 * uji itu tanpa ada bug.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { namaObjekHalamanMateri, namaObjekSampul } from "../src/lib/produk/objek";
import { haversineKm, jenjangDariJarak, LABEL_JENJANG } from "../src/lib/transport/jarak";
import { ANANDA_CLIENT_ID } from "./seed-users";
import { targetSeedMasterSah } from "./dummy-master/target";
import {
  PRODUK_DUMMY,
  MITRA_DUMMY,
  TESTIMONI_DUMMY,
  ALAMAT_KLIEN_DUMMY,
  type ProdukDummy,
} from "./dummy-master/data";

config({ path: [".env.local", ".env"] });

// Nama bucket disalin dari modul unggah produk (`app/admin/produk/[id]/…`),
// yang menyimpannya sebagai konstanta lokal, bukan ekspor.
const BUCKET_HALAMAN = "produk-halaman";
const BUCKET_SAMPUL = "produk-sampul";

/** Rasio halaman sama dengan halaman e-book demo di `seed-users.ts`. */
const LEBAR_HALAMAN = 1600;
const TINGGI_HALAMAN = 2263;

function xml(teks: string): string {
  return teks.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function gambarWebp(lebar: number, tinggi: number, baris: string[], latar: string) {
  const ukuran = [Math.round(lebar / 22), Math.round(lebar / 12)];
  const teks = baris
    .map(
      (b, i) =>
        `<text x="50%" y="${42 + i * 12}%" font-family="serif" font-size="${ukuran[Math.min(i, 1)]}" ` +
        `fill="#132518" text-anchor="middle" dominant-baseline="middle">${xml(b)}</text>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lebar}" height="${tinggi}">${teks}</svg>`;
  return sharp({ create: { width: lebar, height: tinggi, channels: 3, background: latar } })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .webp({ quality: 82 })
    .toBuffer();
}

async function wajib<T>(langkah: string, p: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await p;
  if (error) throw new Error(`${langkah}: ${error.message}`);
  return data;
}

async function tanamProduk(sb: SupabaseClient, p: ProdukDummy) {
  // Lahir NONAKTIF; `aktif` dipasang paling akhir, sesudah harga dan isi ada,
  // supaya etalase tidak pernah sempat melihat produk setengah jadi.
  const objekSampul = namaObjekSampul(p.id, null, "image/webp", p.idSampul);
  await wajib(
    `produk ${p.slug}`,
    sb.from("digital_products").upsert({
      id: p.id,
      judul: p.judul,
      slug: p.slug,
      deskripsi: p.deskripsi,
      aktif: false,
      urutan: p.urutan,
      masa_berlaku_bulan: p.masaBerlakuBulan,
      sampul_objek: objekSampul,
    }),
  );

  const sampul = await gambarWebp(1200, 800, ["Data contoh", p.judul], "#F0E3C3");
  await wajib(
    `sampul ${p.slug}`,
    sb.storage.from(BUCKET_SAMPUL).upload(objekSampul, sampul, { contentType: "image/webp", upsert: true }),
  );

  for (const [iBab, bab] of p.bab.entries()) {
    await wajib(
      `bab ${bab.judul}`,
      sb.from("digital_product_sections").upsert({ id: bab.id, product_id: p.id, judul: bab.judul, urutan: iBab + 1 }),
    );
    for (const [iMateri, m] of bab.materi.entries()) {
      await wajib(
        `materi ${m.judul}`,
        sb.from("digital_product_materials").upsert({
          id: m.id,
          section_id: bab.id,
          product_id: p.id,
          judul: m.judul,
          keterangan: m.keterangan,
          jenis: "pdf",
          pratinjau: m.pratinjau,
          boleh_unduh: false,
          urutan: iMateri + 1,
        }),
      );
      for (let n = 1; n <= m.jumlahHalaman; n++) {
        const objek = namaObjekHalamanMateri(p.id, m.id, n);
        const isi = await gambarWebp(
          LEBAR_HALAMAN,
          TINGGI_HALAMAN,
          [`Data contoh · ${m.judul}`, `Halaman ${n}`],
          "#EFEDE4",
        );
        await wajib(
          `halaman ${m.judul} ${n}`,
          sb.storage.from(BUCKET_HALAMAN).upload(objek, isi, { contentType: "image/webp", upsert: true }),
        );
        await wajib(
          `baris halaman ${m.judul} ${n}`,
          sb.from("digital_product_pages").upsert({ material_id: m.id, halaman: n, objek }, { onConflict: "material_id,halaman" }),
        );
      }
    }
  }

  // Tabel harga INSERT-only (riwayat). Diisi sekali saja; harga yang sudah
  // ada tidak ditimpa, karena owner mungkin sudah mengubahnya lewat panel.
  const harga = await wajib(
    `baca harga ${p.slug}`,
    sb.from("digital_product_prices").select("id").eq("product_id", p.id).limit(1),
  );
  if ((harga ?? []).length === 0) {
    await wajib(
      `harga ${p.slug}`,
      sb.from("digital_product_prices").insert({ product_id: p.id, harga: p.harga, harga_coret: p.hargaCoret }),
    );
  }

  await wajib(`tayang ${p.slug}`, sb.from("digital_products").update({ aktif: p.aktif }).eq("id", p.id));
}

export async function seedDevMaster() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const target = targetSeedMasterSah(url);
  if (!target.ok) throw new Error(target.alasan);
  const kunci = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!kunci) throw new Error("SUPABASE_SERVICE_ROLE_KEY kosong.");
  console.log(`Target: ${target.jenis} (${new URL(url).host})`);

  const sb = createClient(url, kunci, { auth: { autoRefreshToken: false, persistSession: false } });

  for (const p of PRODUK_DUMMY) {
    await tanamProduk(sb, p);
    const halaman = p.bab.flatMap((b) => b.materi).reduce((n, m) => n + m.jumlahHalaman, 0);
    console.log(
      `  produk  ${p.aktif ? "tayang" : "draf  "}  Rp${p.harga.toLocaleString("id-ID").padEnd(7)} ` +
        `/produk/${p.slug} (${p.bab.length} bab, ${halaman} halaman)`,
    );
  }

  await wajib(
    "mitra",
    sb.from("partners").upsert(
      MITRA_DUMMY.map((m) => ({ id: m.id, nama: m.nama, no_hp: m.noHp, alamat: m.alamat, lat: m.lat, lon: m.lon, aktif: true })),
    ),
  );
  for (const m of MITRA_DUMMY) {
    const km = haversineKm(ALAMAT_KLIEN_DUMMY, m);
    console.log(`  mitra   ${m.nama.padEnd(24)} ${km.toFixed(1)} km dari Ananda → ${LABEL_JENJANG[jenjangDariJarak(km)]}`);
  }

  await wajib(
    "testimoni",
    sb.from("testimonials").upsert(
      TESTIMONI_DUMMY.map((t) => ({ ...t, terbit: false, izin_dikonfirmasi: false })),
    ),
  );
  console.log(`  testimoni draf: ${TESTIMONI_DUMMY.length}`);

  const klien = await wajib(
    "alamat Ananda",
    sb
      .from("clients")
      .update({
        alamat: ALAMAT_KLIEN_DUMMY.alamat,
        alamat_lat: ALAMAT_KLIEN_DUMMY.lat,
        alamat_lon: ALAMAT_KLIEN_DUMMY.lon,
      })
      .eq("id", ANANDA_CLIENT_ID)
      .select("id"),
  );
  console.log(
    (klien ?? []).length === 1
      ? "  alamat berpin untuk Ananda terpasang"
      : "  PERINGATAN: klien Ananda tidak ditemukan; jalankan `npm run seed:users` dulu",
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  seedDevMaster()
    .then(() => console.log("Seed data master dummy selesai."))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
