import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import {
  urlUnggahVideo, urlTontonVideo, hapusObjekVideo, UMUR_TONTON_DETIK,
} from "@/lib/r2";
import { namaObjekVideo } from "@/lib/materi/video";

// Spec §11: video dipisahkan ke berkas yang MELEWATKAN DIRINYA bila kredensial
// R2 tidak ada, supaya suite tetap jalan di mesin tanpa akun Cloudflare.
const punyaKredensial =
  Boolean(process.env.R2_ACCOUNT_ID) &&
  Boolean(process.env.R2_ACCESS_KEY_ID) &&
  Boolean(process.env.R2_SECRET_ACCESS_KEY) &&
  Boolean(process.env.R2_BUCKET_VIDEO);

const jalankan = punyaKredensial ? describe : describe.skip;

const ID = randomUUID();
const OBJEK = namaObjekVideo(ID, "video/mp4", randomUUID());
const ISI = new Uint8Array(2048).fill(7);

jalankan("presigned URL R2", () => {
  afterAll(async () => {
    if (punyaKredensial) await hapusObjekVideo(OBJEK).catch(() => {});
  });

  it("PUT presigned menerima MIME & ukuran yang benar", async () => {
    const url = await urlUnggahVideo(OBJEK, "video/mp4", ISI.length);
    const r = await fetch(url, {
      method: "PUT", body: ISI, headers: { "content-type": "video/mp4" },
    });
    expect(r.status).toBe(200);
  });

  it("MENOLAK MIME yang berbeda dari yang ditandatangani", async () => {
    // Tanpa signableHeaders, R2 menerima ini dengan HTTP 200 — terbukti di
    // spike. MIME inilah yang masuk material_videos.mime lalu dipakai <video>.
    const url = await urlUnggahVideo(OBJEK, "video/mp4", ISI.length);
    const r = await fetch(url, {
      method: "PUT", body: ISI, headers: { "content-type": "text/html" },
    });
    expect(r.ok).toBe(false);
  });

  it("MENOLAK ukuran yang berbeda dari yang ditandatangani", async () => {
    const url = await urlUnggahVideo(OBJEK, "video/mp4", ISI.length);
    const r = await fetch(url, {
      method: "PUT", body: new Uint8Array(ISI.length + 1),
      headers: { "content-type": "video/mp4" },
    });
    expect(r.ok).toBe(false);
  });

  it("MENOLAK penulisan ke path lain dengan tanda tangan yang sama", async () => {
    const url = await urlUnggahVideo(OBJEK, "video/mp4", ISI.length);
    const curian = new URL(url);
    curian.pathname = curian.pathname.replace(/[^/]+$/, "curian.mp4");
    const r = await fetch(curian, {
      method: "PUT", body: ISI, headers: { "content-type": "video/mp4" },
    });
    expect(r.ok).toBe(false);
  });

  it("GET presigned mengembalikan byte yang sama dan menghormati Range", async () => {
    await fetch(await urlUnggahVideo(OBJEK, "video/mp4", ISI.length), {
      method: "PUT", body: ISI, headers: { "content-type": "video/mp4" },
    });
    const url = await urlTontonVideo(OBJEK);
    const penuh = await fetch(url);
    expect(penuh.status).toBe(200);
    expect((await penuh.arrayBuffer()).byteLength).toBe(ISI.length);

    // Seek video bergantung pada Range; tanpa 206 pemutar hanya bisa memutar
    // dari awal.
    const sebagian = await fetch(url, { headers: { range: "bytes=10-109" } });
    expect(sebagian.status).toBe(206);
    expect((await sebagian.arrayBuffer()).byteLength).toBe(100);
  });

  it("objek TIDAK bisa diambil tanpa tanda tangan", async () => {
    const url = new URL(await urlTontonVideo(OBJEK));
    const telanjang = `${url.origin}${url.pathname}`;
    const r = await fetch(telanjang);
    expect(r.ok).toBe(false);
  });

  it("umur URL tonton 2 jam, sesuai spec §7", () => {
    expect(UMUR_TONTON_DETIK).toBe(2 * 60 * 60);
  });
});
