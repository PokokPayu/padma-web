import { describe, it, expect } from "vitest";
import { signInAs, anonClient } from "./helpers/as-user";

describe("MONEY FIREWALL — tabel uang hanya untuk owner", () => {
  it("admin TIDAK bisa membaca service_rates (0 baris)", async () => {
    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin.from("service_rates").select("*");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("admin TIDAK bisa menulis service_rates (error 42501)", async () => {
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.from("service_rates").insert({
      service_id: "11111111-1111-1111-1111-111111111101",
      harga_klien: 1,
      honor_mitra: 1,
    });
    expect(error?.code).toBe("42501");
  });

  it("admin TIDAK bisa membaca honor_marks", async () => {
    const admin = await signInAs("admin@padma.test");
    const { data } = await admin.from("honor_marks").select("*");
    expect(data).toHaveLength(0);
  });

  it("klien TIDAK bisa membaca service_rates", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data } = await klien.from("service_rates").select("*");
    expect(data).toHaveLength(0);
  });

  it("owner BISA membaca service_rates (seed 10 baris)", async () => {
    const owner = await signInAs("owner@padma.test");
    const { data, error } = await owner.from("service_rates").select("*");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(10);
  });
});

describe("Isolasi data klien", () => {
  it("klien hanya melihat baris clients miliknya", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data } = await klien.from("clients").select("padma_id");
    expect(data).toHaveLength(1);
    expect(data![0].padma_id).toBe("PAD-2607-0012");
  });

  it("klien hanya melihat sesi miliknya", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data } = await klien.from("sessions").select("id");
    expect(data!.length).toBeGreaterThanOrEqual(2);
  });

  it("klien TIDAK bisa mengubah sesi", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data } = await klien
      .from("sessions")
      .update({ status: "selesai" })
      .eq("id", "66666666-6666-6666-6666-666666666602")
      .select();
    expect(data).toHaveLength(0); // update tersaring RLS: 0 baris berubah
  });

  it("admin bisa membaca semua clients", async () => {
    const admin = await signInAs("admin@padma.test");
    const { data } = await admin.from("clients").select("id");
    expect(data!.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Anonim", () => {
  it("anon tidak melihat clients — ditolak di lapis hak tabel, bukan sekadar 0 baris", async () => {
    const { data, error } = await anonClient().from("clients").select("*");
    // Tidak ada satu pun baris pasien yang bocor.
    expect(data ?? []).toHaveLength(0);
    // Sejak migration cabut_grant_anon_berlebih, anon tidak punya hak tabel
    // sama sekali sehingga ditolak SEBELUM RLS dievaluasi. Ini jaminan yang
    // lebih kuat daripada "RLS memfilter habis": bocor butuh dua kesalahan.
    expect(error?.code).toBe("42501");
  });

  it("anon TIDAK bisa insert screenings langsung", async () => {
    const { error } = await anonClient().from("screenings").insert({
      kode: "PDM-TEST-0001",
      nama: "X",
      no_hp: "0",
      fase: "prekonsepsi",
      jawaban: {},
      hasil: "hijau",
    });
    expect(error?.code).toBe("42501");
  });
});
