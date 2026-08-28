import { describe, it, expect, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { POST } from "@/app/api/skrining/route";

const admin = createAdminSupabase();
const dibuat: string[] = [];

// Endpoint punya rate limit per-IP per-proses. Test-test di bawah menirukan
// PENGUNJUNG YANG BERBEDA, jadi tiap permintaan diberi IP sendiri — kalau tidak,
// permintaan keenam dalam berkas ini kena 429 sebelum sempat divalidasi dan
// hasil test jadi bergantung pada urutan, bukan pada perilaku endpoint.
// Rate limit itu sendiri diuji terpisah di bawah dengan satu IP tetap.
let nomorIp = 0;
function req(body: unknown, ip = `203.0.113.${++nomorIp}`) {
  return new Request("http://localhost/api/skrining", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

afterAll(async () => {
  if (dibuat.length) await admin.from("screenings").delete().in("kode", dibuat);
});

describe("POST /api/skrining", () => {
  it("menyimpan skrining hijau dan mengembalikan kode", async () => {
    const res = await POST(req({
      nama: "Uji Hijau", no_hp: "0812-0000-0001", fase: "prekonsepsi",
      jawaban: {
        cardioresp: false, severe_pain: false, fever: false, acute_infection: false,
        skin_wound: false, recent_procedure: false, restriction: false,
        pre_heavy_bleeding: false, pre_abnormal_bleeding: false, possible_pregnancy: false,
      },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.kode).toMatch(/^PDM-\d{6}-\d{4}-[A-Z0-9]{4}$/);
    dibuat.push(body.kode);

    const { data } = await admin.from("screenings").select("*").eq("kode", body.kode).single();
    expect(data!.hasil).toBe("hijau");
    expect(data!.status_tindak_lanjut).toBe("baru");
    expect(data!.fase).toBe("prekonsepsi");
  });

  it("SERVER yang menentukan hasil — `hasil` kiriman klien diabaikan", async () => {
    const res = await POST(req({
      nama: "Uji Palsu", no_hp: "0812-0000-0002", fase: "kehamilan",
      hasil: "hijau", // penyerang mencoba memaksa hijau
      jawaban: { cardioresp: true },
    }));
    expect(res.status).toBe(201);
    const { kode } = await res.json();
    dibuat.push(kode);

    const { data } = await admin.from("screenings").select("hasil, flags").eq("kode", kode).single();
    expect(data!.hasil).toBe("merah");
    expect((data!.flags as { id: string }[])[0].id).toBe("cardioresp");
  });

  it("flags menyimpan level untuk admin", async () => {
    const res = await POST(req({
      nama: "Uji Flag", no_hp: "0812-0000-0003", fase: "nifas",
      jawaban: {
        cardioresp: false, severe_pain: false, fever: true,
      },
    }));
    const { kode } = await res.json();
    dibuat.push(kode);
    const { data } = await admin.from("screenings").select("flags").eq("kode", kode).single();
    const flags = data!.flags as { id: string; level: string }[];
    // demam pada nifas = urgent (pagar keselamatan)
    expect(flags[0]).toMatchObject({ id: "fever", level: "urgent" });
  });

  it("menolak payload tidak valid", async () => {
    for (const bad of [
      { nama: "", no_hp: "08", fase: "prekonsepsi", jawaban: {} },
      { nama: "X", no_hp: "0812", fase: "newborn", jawaban: {} },   // fase tidak diskrining
      { nama: "X", no_hp: "0812", fase: "prekonsepsi" },             // jawaban hilang
    ]) {
      const res = await POST(req(bad));
      expect(res.status).toBe(400);
    }
  });

  it("membatasi banjir permintaan dari satu IP (429), bukan dari IP lain", async () => {
    const banjir = "198.51.100.7";
    const payload = { nama: "Uji Banjir", no_hp: "0812-0000-0009", fase: "menopause", jawaban: {} };

    const status: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await POST(req(payload, banjir));
      status.push(res.status);
      if (res.status === 201) dibuat.push((await res.json()).kode);
    }
    expect(status.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(status[5]).toBe(429);

    // Pengunjung lain tidak ikut terkena getahnya.
    const lain = await POST(req(payload, "198.51.100.8"));
    expect(lain.status).toBe(201);
    dibuat.push((await lain.json()).kode);
  });

  it("anon TIDAK bisa insert langsung ke tabel (harus lewat endpoint)", async () => {
    const { anonClient } = await import("./helpers/as-user");
    const { error } = await anonClient().from("screenings").insert({
      kode: "PDM-000000-0000-XXXX", nama: "X", no_hp: "0",
      fase: "prekonsepsi", jawaban: {}, hasil: "hijau",
    });
    expect(error?.code).toBe("42501");
  });
});
