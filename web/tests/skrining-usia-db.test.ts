/**
 * Usia kehamilan sampai ke lapisan data.
 *
 * Dua hal yang tidak bisa dijaga unit test murni:
 *  1. Rute BENAR-BENAR menyimpan kolomnya (kedua rute — corong publik dan
 *     Passport — karena wizard-nya satu dan keduanya harus setara).
 *  2. CHECK di DB memagari apa yang lolos bila kode aplikasi kelak dilewati.
 *
 * Batas trimester ada di DUA tempat yang tidak bisa saling memanggil: modul
 * TypeScript dan CHECK Postgres. Test terakhir di berkas ini membandingkan
 * keduanya minggu demi minggu — itulah satu-satunya yang menahan keduanya
 * menyimpang diam-diam.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { POST } from "@/app/api/skrining/route";
import { MINGGU_MAKS, trimesterDari } from "@/lib/skrining/usia-kehamilan";

const admin = createAdminSupabase();
const dibuat: string[] = [];

let nomorIp = 0;
function req(body: unknown) {
  return new Request("http://localhost/api/skrining", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${++nomorIp}` },
    body: JSON.stringify(body),
  });
}

const JAWABAN_AMAN = {
  cardioresp: false, severe_pain: false, fever: false, acute_infection: false,
  skin_wound: false, recent_procedure: false, restriction: false,
  preg_bleeding_fluid: false, preg_headache_vision: false, preg_contractions: false,
  preg_fetal_movement: false, preg_highrisk: false,
};

function barisUji(tambahan: Record<string, unknown>) {
  return {
    kode: `UJI-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
    nama: "Klien Uji Usia",
    no_hp: "0800-0000-0000",
    fase: "kehamilan",
    jawaban: {},
    hasil: "hijau",
    flags: [],
    ...tambahan,
  };
}

afterAll(async () => {
  if (dibuat.length) await admin.from("screenings").delete().in("kode", dibuat);
  await admin.from("screenings").delete().eq("nama", "Klien Uji Usia");
});

describe("POST /api/skrining — usia kehamilan tersimpan", () => {
  it("minggu yang diketik tersimpan berikut trimester turunannya", async () => {
    const res = await POST(req({
      nama: "Uji Usia 24", no_hp: "0812-0000-0101", fase: "kehamilan",
      jawaban: JAWABAN_AMAN, usia_kehamilan_minggu: 24,
    }));
    expect(res.status).toBe(201);
    const { kode } = await res.json();
    dibuat.push(kode);

    const { data } = await admin
      .from("screenings")
      .select("usia_kehamilan_minggu, trimester")
      .eq("kode", kode)
      .single();
    expect(data).toMatchObject({ usia_kehamilan_minggu: 24, trimester: 2 });
  });

  it("trimester tanpa minggu tersimpan apa adanya", async () => {
    const res = await POST(req({
      nama: "Uji Trimester", no_hp: "0812-0000-0102", fase: "kehamilan",
      jawaban: JAWABAN_AMAN, trimester: 3,
    }));
    expect(res.status).toBe(201);
    const { kode } = await res.json();
    dibuat.push(kode);

    const { data } = await admin
      .from("screenings")
      .select("usia_kehamilan_minggu, trimester")
      .eq("kode", kode)
      .single();
    expect(data).toMatchObject({ usia_kehamilan_minggu: null, trimester: 3 });
  });

  it("skrining tanpa usia kehamilan tetap tersimpan dengan kolom kosong", async () => {
    const res = await POST(req({
      nama: "Uji Tanpa Usia", no_hp: "0812-0000-0103", fase: "kehamilan",
      jawaban: JAWABAN_AMAN,
    }));
    expect(res.status).toBe(201);
    const { kode } = await res.json();
    dibuat.push(kode);

    const { data } = await admin
      .from("screenings")
      .select("usia_kehamilan_minggu, trimester")
      .eq("kode", kode)
      .single();
    expect(data).toMatchObject({ usia_kehamilan_minggu: null, trimester: null });
  });

  it("usia kehamilan pada fase non-kehamilan ditolak rute, bukan disimpan diam-diam", async () => {
    const res = await POST(req({
      nama: "Uji Salah Fase", no_hp: "0812-0000-0104", fase: "menopause",
      jawaban: { cardioresp: false }, trimester: 2,
    }));
    expect(res.status).toBe(400);
  });

  it("usia kehamilan TIDAK mengubah hasil — trimester 3 tetap hijau", async () => {
    const res = await POST(req({
      nama: "Uji Hijau T3", no_hp: "0812-0000-0105", fase: "kehamilan",
      jawaban: JAWABAN_AMAN, usia_kehamilan_minggu: 38,
    }));
    const { kode } = await res.json();
    dibuat.push(kode);

    const { data } = await admin
      .from("screenings").select("hasil, trimester").eq("kode", kode).single();
    expect(data).toMatchObject({ hasil: "hijau", trimester: 3 });
  });
});

describe("CHECK di DB — pagar kedua bila kode aplikasi dilewati", () => {
  it("menolak usia kehamilan pada fase non-kehamilan", async () => {
    const { error } = await admin
      .from("screenings")
      .insert(barisUji({ fase: "nifas", trimester: 2 }));
    expect(error?.message ?? "").toContain("screenings_usia_hanya_kehamilan");
  });

  it("menolak minggu di luar 0..42", async () => {
    const { error } = await admin
      .from("screenings")
      .insert(barisUji({ usia_kehamilan_minggu: 60, trimester: 3 }));
    expect(error?.message ?? "").toContain("screenings_usia_kehamilan_wajar");
  });

  it("menolak trimester di luar 1..3", async () => {
    const { error } = await admin
      .from("screenings")
      .insert(barisUji({ trimester: 5 }));
    expect(error?.message ?? "").toContain("screenings_trimester_wajar");
  });

  it("menolak trimester yang tidak cocok dengan minggunya", async () => {
    const { error } = await admin
      .from("screenings")
      .insert(barisUji({ usia_kehamilan_minggu: 30, trimester: 1 }));
    expect(error?.message ?? "").toContain("screenings_trimester_cocok_minggu");
  });

  it("batas trimester di Postgres sama persis dengan modul TypeScript", async () => {
    // Dua salinan angka yang tidak bisa saling memanggil. Bila salah satunya
    // digeser, di sinilah ketahuannya — bukan di catatan keselamatan seorang ibu.
    const baris = [];
    for (let m = 0; m <= MINGGU_MAKS; m++) {
      baris.push(barisUji({ usia_kehamilan_minggu: m, trimester: trimesterDari(m) }));
    }
    const { error } = await admin.from("screenings").insert(baris);
    expect(error).toBeNull();

    const salah = await admin
      .from("screenings")
      .insert(barisUji({ usia_kehamilan_minggu: 13, trimester: 2 }));
    expect(salah.error).not.toBeNull();
  });
});
