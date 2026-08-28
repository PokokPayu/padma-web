import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { POST } from "@/app/api/skrining/route";
import { resetPembatas } from "@/lib/skrining/pembatas";
import { daftarSoal } from "@/lib/skrining/bank-soal";

/**
 * Regression test temuan red team pada rute PUBLIK `POST /api/skrining`.
 *
 * Dua celah nyata yang saling menguatkan menjadi amplifikasi TULIS
 * tak-terautentikasi (baris ditulis dengan SERVICE ROLE):
 *
 *   1. rate limit di-key pada `x-forwarded-for` mentah -> diputar = bypass total
 *      (bukti asli: 12 request, "201=12 429=0");
 *   2. `jawaban` tidak dibatasi jumlah kunci maupun ukuran body, dan disimpan
 *      MENTAH ke kolom jsonb data kesehatan (bukti asli: 200.001 kunci /
 *      2,76 MB per baris tersimpan; 10.000 kunci id-palsu tersimpan verbatim).
 *
 * Berkas ini membuktikan ketiga lapisan penutupnya sekaligus: skema (jumlah
 * kunci), rute (batas byte body + whitelist id soal), dan DB (CHECK fail-closed).
 */

const admin = createAdminSupabase();
const dibuat: string[] = [];

const HOP_PROXY = "198.51.100.200";
let nomor = 0;

/** Permintaan seolah-olah datang lewat proxy tepercaya (hop terluar = HOP_PROXY). */
function req(body: unknown, hopKlien = `203.0.113.${++nomor}`, hopProxy = HOP_PROXY) {
  return new Request("http://localhost/api/skrining", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${hopKlien}, ${hopProxy}` },
    body: JSON.stringify(body),
  });
}

async function jumlahBaris(): Promise<number> {
  const { count, error } = await admin
    .from("screenings")
    .select("kode", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

beforeEach(() => {
  resetPembatas();
});

afterAll(async () => {
  if (dibuat.length) await admin.from("screenings").delete().in("kode", dibuat);
});

describe("batas jumlah kunci `jawaban` (anti penggelembungan jsonb)", () => {
  it("menolak jawaban dengan kunci berlebih — dan TIDAK menyimpan apa pun", async () => {
    const jawaban: Record<string, boolean> = {};
    for (let i = 0; i < 40; i++) jawaban[`kunci_palsu_${i}`] = true;

    const sebelum = await jumlahBaris();
    const res = await POST(req({
      nama: "Uji Kunci Berlebih", no_hp: "0812-0000-1001", fase: "nifas", jawaban,
    }));
    expect(res.status).toBe(400);
    expect(await jumlahBaris()).toBe(sebelum);
  });

  it("menolak payload 10.000 kunci (bukti asli red team) tanpa menyimpan baris", async () => {
    const jawaban: Record<string, boolean> = {};
    for (let i = 0; i < 10_000; i++) jawaban[`k${i}`] = true;

    const sebelum = await jumlahBaris();
    const res = await POST(req({
      nama: "Uji 10rb Kunci", no_hp: "0812-0000-1002", fase: "kehamilan", jawaban,
    }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await jumlahBaris()).toBe(sebelum);
  });
});

describe("jawaban disimpan TERSARING ke id soal yang dikenal", () => {
  it("kunci id-palsu tidak pernah sampai ke kolom jsonb", async () => {
    const res = await POST(req({
      nama: "Uji Saring", no_hp: "0812-0000-1003", fase: "menopause",
      jawaban: {
        fever: false,
        meno_lump: true,
        // kunci asing (jumlah total tetap di bawah batas) — harus disaring
        admin_is_owner: true,
        harga_klien: true,
        "../../etc/passwd": true,
      },
    }));
    expect(res.status).toBe(201);
    const { kode } = await res.json();
    dibuat.push(kode);

    const { data } = await admin.from("screenings").select("jawaban").eq("kode", kode).single();
    const tersimpan = data!.jawaban as Record<string, unknown>;
    const idDikenal = new Set(daftarSoal("menopause").map((s) => s.id));

    for (const kunci of Object.keys(tersimpan)) {
      if (kunci === "dihentikan_pada") continue;
      expect(idDikenal.has(kunci)).toBe(true);
    }
    expect(tersimpan).not.toHaveProperty("admin_is_owner");
    expect(tersimpan).not.toHaveProperty("harga_klien");
    expect(tersimpan).not.toHaveProperty("../../etc/passwd");
    // jawaban yang sah tetap utuh — penyaringan tidak boleh memakan data nyata
    expect(tersimpan.meno_lump).toBe(true);
    expect(tersimpan.fever).toBe(false);
  });
});

describe("batas ukuran body (16 KB)", () => {
  it("menolak body 2,76 MB dengan 413 dan tidak menyimpan baris", async () => {
    const jawaban: Record<string, boolean> = {};
    for (let i = 0; i < 200_001; i++) jawaban[`k${i}`] = true;
    const body = JSON.stringify({
      nama: "Uji Body Raksasa", no_hp: "0812-0000-1004", fase: "nifas", jawaban,
    });
    expect(body.length).toBeGreaterThan(2_000_000);

    const sebelum = await jumlahBaris();
    const res = await POST(new Request("http://localhost/api/skrining", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.1, ${HOP_PROXY}` },
      body,
    }));
    expect(res.status).toBe(413);
    expect(await jumlahBaris()).toBe(sebelum);
  });

  it("menolak body besar walau content-length TIDAK dikirim (dibaca sebagai aliran)", async () => {
    const potongan = "x".repeat(64 * 1024);
    const aliran = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(`{"nama":"Uji Aliran","no_hp":"0812","fase":"nifas","pad":"`));
        for (let i = 0; i < 8; i++) controller.enqueue(enc.encode(potongan));
        controller.enqueue(enc.encode(`"}`));
        controller.close();
      },
    });

    const sebelum = await jumlahBaris();
    const res = await POST(new Request("http://localhost/api/skrining", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.2, ${HOP_PROXY}` },
      body: aliran,
      duplex: "half",
    } as RequestInit));
    expect(res.status).toBe(413);
    expect(await jumlahBaris()).toBe(sebelum);
  });
});

describe("rate limit tidak bisa dilewati dengan memutar X-Forwarded-For", () => {
  it("12 permintaan dengan XFF berputar tetap tertahan 429 sesudah batas", async () => {
    const payload = { nama: "Uji Putar XFF", no_hp: "0812-0000-1005", fase: "menopause", jawaban: {} };
    const status: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await POST(req(payload, `10.0.0.${i}`));
      status.push(res.status);
      if (res.status === 201) dibuat.push((await res.json()).kode);
    }
    const lolos = status.filter((s) => s === 201).length;
    const tertahan = status.filter((s) => s === 429).length;
    expect(lolos).toBeLessThanOrEqual(5);
    expect(tertahan).toBeGreaterThanOrEqual(7);
  });
});

describe("charset `nama` (pertahanan-mendalam untuk ekspor/render non-React)", () => {
  it("menolak nama yang memuat < atau >", async () => {
    for (const nama of [
      "Robert');DROP TABLE screenings;-- <script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
    ]) {
      const res = await POST(req({
        nama, no_hp: "0812-0000-1006", fase: "prekonsepsi", jawaban: {},
      }));
      expect(res.status).toBe(400);
    }
  });

  it("nama normal dengan tanda kutip/aksen tetap diterima", async () => {
    const res = await POST(req({
      nama: "Ni Luh Ayu O'Brien-Wijaya", no_hp: "0812-0000-1007", fase: "prekonsepsi", jawaban: {},
    }));
    expect(res.status).toBe(201);
    dibuat.push((await res.json()).kode);
  });
});

describe("lapis kedua di DB — CHECK fail-closed walau kode aplikasi dilewati", () => {
  it("service role pun tidak bisa menyimpan jawaban jsonb raksasa", async () => {
    const jawaban: Record<string, boolean> = {};
    for (let i = 0; i < 500; i++) jawaban[`k${i}`] = true;

    const { error } = await admin.from("screenings").insert({
      kode: "PDM-000000-0000-BLOB", nama: "Uji Blob", no_hp: "0812",
      fase: "nifas", jawaban, hasil: "hijau",
    });
    expect(error?.code).toBe("23514"); // check_violation
  });

  it("baris skrining normal tetap lolos CHECK", async () => {
    const kode = "PDM-000000-0000-OKAY";
    const { error } = await admin.from("screenings").insert({
      kode, nama: "Uji Normal", no_hp: "0812", fase: "nifas",
      jawaban: { fever: true, dihentikan_pada: "fever" }, hasil: "merah",
    });
    expect(error).toBeNull();
    dibuat.push(kode);
  });
});
