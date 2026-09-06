import { describe, it, expect } from "vitest";
import { signInAs, anonClient } from "./helpers/as-user";

describe("MONEY FIREWALL — tabel uang hanya untuk owner", () => {
  // Empat `it` yang dulu ada di sini (admin baca/tulis, klien baca, owner
  // baca — semuanya atas `service_rates`) DIPENSIUNKAN Task 5: tabelnya
  // dijatuhkan (migration `bubarkan_service_rates`), dan padanan yang sama
  // persis untuk `variant_rates` sudah hidup di tests/owner-pengerasan.test.ts
  // (describe "pengerasan tidak menggeser satu pun pagar kerahasiaan", yang
  // memeriksa admin/klien/anon/owner sekaligus) dan tests/owner-tarif.test.ts
  // ("admin TETAP dijawab 0 baris..." & "admin yang menyisipkan tarif
  // langsung lewat REST ditolak RLS"). Menduplikasinya di sini hanya menguji
  // policy yang sama dua kali dengan fixture berbeda.

  it("admin TIDAK bisa membaca honor_marks", async () => {
    const admin = await signInAs("admin@padma.test");
    const { data } = await admin.from("honor_marks").select("*");
    expect(data).toHaveLength(0);
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
