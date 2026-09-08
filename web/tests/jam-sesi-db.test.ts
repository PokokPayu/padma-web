import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";

async function kolom(tabel: string, nama: string) {
  const baris = await querySql<{ tipe: string; nullable: string; bawaan: string | null }>(
    `select data_type as tipe, is_nullable as nullable, column_default as bawaan
       from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [tabel, nama],
  );
  return baris[0];
}

describe("jam mulai (spec J2)", () => {
  it("booking_requests.jam_mulai bertipe time dan WAJIB", async () => {
    const k = await kolom("booking_requests", "jam_mulai");
    expect(k?.tipe).toBe("time without time zone");
    expect(k?.nullable).toBe("NO");
  });

  it("sessions.jam_mulai bertipe time dan WAJIB", async () => {
    const k = await kolom("sessions", "jam_mulai");
    expect(k?.tipe).toBe("time without time zone");
    expect(k?.nullable).toBe("NO");
  });

  it("TANPA nilai bawaan — jam adalah pilihan klien, bukan angka yang muncul sendiri", async () => {
    // Bawaan yang tertinggal membuat setiap insert yang LUPA menyebut jam
    // tersimpan diam-diam dengan jam yang tidak pernah dipilih siapa pun, dan
    // klien menemukannya saat bidan datang di jam yang salah.
    expect((await kolom("booking_requests", "jam_mulai"))?.bawaan).toBeNull();
    expect((await kolom("sessions", "jam_mulai"))?.bawaan).toBeNull();
  });

  it("preferensi_waktu TIDAK dihapus — ia kini berarti alternatif (spec J2)", async () => {
    expect((await kolom("booking_requests", "preferensi_waktu"))?.nullable).toBe("NO");
  });

  it("jam hanya boleh pada menit bulat :00 atau :30", async () => {
    for (const [tabel, nama] of [
      ["booking_requests", "booking_requests_jam_bulat"],
      ["sessions", "sessions_jam_bulat"],
    ]) {
      const baris = await querySql<{ nama: string }>(
        `select conname as nama from pg_constraint
          where conrelid = ('public.' || $1)::regclass and conname = $2`,
        [tabel, nama],
      );
      expect(baris.length, `${nama} tidak ada`).toBe(1);
    }
  });
});
