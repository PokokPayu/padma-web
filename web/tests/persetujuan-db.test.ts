/**
 * persetujuan_akun + kolom persetujuan di screenings (spec 2026-10-06) — BER-DB.
 *
 * Yang dijaga: tabelnya APPEND-ONLY dan MILIK SENDIRI. Klien hanya bisa
 * menyisipkan dan membaca barisnya sendiri, tidak bisa mengubah atau menghapus,
 * tidak bisa memalsukan waktunya, dan anon tidak punya hak apa pun. Plus: TIDAK
 * ada trigger di screenings (spec revisi 1) — baris tanpa persetujuan tetap
 * bisa disisipkan service role, persis seperti fixture lama.
 *
 * Memakai versi lampau khusus uji (`VERSI_UJI`) supaya tidak menyentuh baris
 * versi berlaku milik Ananda yang disemai `seedUsers`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";
import { EMAIL_KLIEN_KEDUA, siapkanKlienKedua, bongkarKlienKedua } from "./helpers/klien-kedua";

const svc = createAdminSupabase();
const VERSI_UJI = "2000-01-01";
let uidAnanda = "";
let uidKedua = "";
const skriningUji: string[] = [];

async function uidDariEmail(email: string): Promise<string> {
  const { data, error } = await svc.from("clients").select("user_id").eq("email", email).single();
  if (error) throw error;
  return data!.user_id as string;
}

beforeAll(async () => {
  await siapkanKlienKedua();
  uidAnanda = await uidDariEmail("ananda@padma.test");
  uidKedua = await uidDariEmail(EMAIL_KLIEN_KEDUA);
  await svc.from("persetujuan_akun").delete().eq("versi", VERSI_UJI);
});

afterAll(async () => {
  await svc.from("persetujuan_akun").delete().eq("versi", VERSI_UJI);
  if (skriningUji.length) await svc.from("screenings").delete().in("kode", skriningUji);
  await bongkarKlienKedua();
});

describe("persetujuan_akun — append-only, milik sendiri", () => {
  it("klien mencatat lalu membaca persetujuannya sendiri", async () => {
    const ananda = await signInAs("ananda@padma.test");
    const { error } = await ananda
      .from("persetujuan_akun")
      .insert({ user_id: uidAnanda, versi: VERSI_UJI, jalur: "gerbang" });
    expect(error).toBeNull();

    const { data } = await ananda
      .from("persetujuan_akun")
      .select("versi, jalur, disetujui_pada")
      .eq("versi", VERSI_UJI);
    expect(data).toHaveLength(1);
    expect(data![0].jalur).toBe("gerbang");
    expect(data![0].disetujui_pada).toBeTruthy();
  });

  it("klien TIDAK bisa mencatat atas nama akun lain", async () => {
    const ananda = await signInAs("ananda@padma.test");
    const { error } = await ananda
      .from("persetujuan_akun")
      .insert({ user_id: uidKedua, versi: VERSI_UJI, jalur: "gerbang" });
    expect(error?.code).toBe("42501");
  });

  it("klien TIDAK bisa membaca persetujuan akun lain", async () => {
    const { error } = await svc
      .from("persetujuan_akun")
      .insert({ user_id: uidKedua, versi: VERSI_UJI, jalur: "daftar" });
    expect(error).toBeNull();

    const ananda = await signInAs("ananda@padma.test");
    const { data } = await ananda.from("persetujuan_akun").select("user_id").eq("user_id", uidKedua);
    expect(data).toEqual([]);
  });

  it("klien TIDAK bisa mengubah maupun menghapus catatannya", async () => {
    const ananda = await signInAs("ananda@padma.test");
    const ubah = await ananda
      .from("persetujuan_akun")
      .update({ jalur: "daftar" })
      .eq("user_id", uidAnanda)
      .eq("versi", VERSI_UJI);
    expect(ubah.error?.code).toBe("42501");

    const hapus = await ananda
      .from("persetujuan_akun")
      .delete()
      .eq("user_id", uidAnanda)
      .eq("versi", VERSI_UJI);
    expect(hapus.error?.code).toBe("42501");
  });

  it("klien TIDAK bisa memalsukan waktu persetujuan", async () => {
    const ananda = await signInAs("ananda@padma.test");
    const { error } = await ananda.from("persetujuan_akun").insert({
      user_id: uidAnanda,
      versi: "2000-01-02",
      jalur: "gerbang",
      disetujui_pada: "2000-01-02T00:00:00Z",
    });
    expect(error?.code).toBe("42501");
  });

  it("versi dan jalur yang salah bentuk ditolak CHECK", async () => {
    const versiSalah = await svc
      .from("persetujuan_akun")
      .insert({ user_id: uidKedua, versi: "v1", jalur: "gerbang" });
    expect(versiSalah.error?.code).toBe("23514");

    const jalurSalah = await svc
      .from("persetujuan_akun")
      .insert({ user_id: uidKedua, versi: "2000-01-03", jalur: "admin" });
    expect(jalurSalah.error?.code).toBe("23514");
  });

  it("anon tidak bisa membaca maupun mencatat", async () => {
    const anon = anonClient();
    const baca = await anon.from("persetujuan_akun").select("user_id");
    expect(baca.error?.code).toBe("42501");
    const tulis = await anon
      .from("persetujuan_akun")
      .insert({ user_id: uidAnanda, versi: VERSI_UJI, jalur: "gerbang" });
    expect(tulis.error?.code).toBe("42501");
  });
});

describe("screenings — kolom persetujuan, TANPA trigger", () => {
  function barisUji(tambahan: Record<string, unknown>) {
    const kode = `UJI-SETUJU-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    skriningUji.push(kode);
    return {
      kode,
      nama: "Uji Persetujuan",
      no_hp: "0800-0000-0000",
      fase: "prekonsepsi",
      jawaban: {},
      hasil: "hijau",
      flags: [],
      ...tambahan,
    };
  }

  it("baris tanpa persetujuan tetap bisa disisipkan (fixture lama tidak patah)", async () => {
    const { error } = await svc.from("screenings").insert(barisUji({}));
    expect(error).toBeNull();
  });

  it("baris bercap persetujuan menyimpan versi dan waktunya", async () => {
    const baris = barisUji({ persetujuan_versi: "2026-10-06", persetujuan_pada: "2026-10-06T03:00:00Z" });
    const { error } = await svc.from("screenings").insert(baris);
    expect(error).toBeNull();
    const { data } = await svc
      .from("screenings")
      .select("persetujuan_versi, persetujuan_pada")
      .eq("kode", baris.kode)
      .single();
    expect(data!.persetujuan_versi).toBe("2026-10-06");
    expect(data!.persetujuan_pada).toBeTruthy();
  });

  it("versi skrining yang salah bentuk ditolak CHECK", async () => {
    const { error } = await svc
      .from("screenings")
      .insert(barisUji({ persetujuan_versi: "kemarin", persetujuan_pada: "2026-10-06T03:00:00Z" }));
    expect(error?.code).toBe("23514");
  });
});
