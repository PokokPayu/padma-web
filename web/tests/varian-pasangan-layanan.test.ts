import { describe, it, expect } from "vitest";
import { querySql, dalamTransaksiRollback } from "./helpers/db";

/**
 * V2 spec: BASIS DATA yang menjamin varian milik layanan yang benar.
 *
 * Kode aplikasi bisa memeriksanya, tetapi REST selalu jalur lain: satu POST
 * langsung ke /rest/v1/sessions dengan variant_id milik layanan lain akan
 * melewati setiap validator TypeScript. Yang diuji di sini karena itu bukan
 * server action melainkan constraint-nya sendiri.
 */
describe("FK gabungan (service_id, variant_id)", () => {
  it("menolak sesi dengan varian milik layanan lain", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [a] = (await jalankan(
        `select s.id as service_id, v.id as variant_id
           from public.services s
           join public.service_variants v on v.service_id = s.id
          order by s.nama limit 1`,
      )) as Array<{ service_id: string; variant_id: string }>;
      const [b] = (await jalankan(
        `select v.id as variant_id from public.service_variants v
          where v.service_id <> $1 limit 1`,
        [a.service_id],
      )) as Array<{ variant_id: string }>;

      const [klien] = (await jalankan(`select id from public.clients limit 1`)) as Array<{ id: string }>;
      const [mitra] = (await jalankan(`select id from public.partners limit 1`)) as Array<{ id: string }>;

      await expect(
        jalankan(
          `insert into public.sessions (client_id, service_id, variant_id, partner_id, tanggal)
           values ($1, $2, $3, $4, current_date)`,
          [klien.id, a.service_id, b.variant_id, mitra.id],
        ),
      ).rejects.toThrow();
    });
  });

  it("menerima sesi dengan varian milik layanannya sendiri", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [a] = (await jalankan(
        `select s.id as service_id, v.id as variant_id
           from public.services s
           join public.service_variants v on v.service_id = s.id
          order by s.nama limit 1`,
      )) as Array<{ service_id: string; variant_id: string }>;
      const [klien] = (await jalankan(`select id from public.clients limit 1`)) as Array<{ id: string }>;
      const [mitra] = (await jalankan(`select id from public.partners limit 1`)) as Array<{ id: string }>;

      const hasil = await jalankan(
        `insert into public.sessions (client_id, service_id, variant_id, partner_id, tanggal)
         values ($1, $2, $3, $4, current_date) returning id`,
        [klien.id, a.service_id, a.variant_id, mitra.id],
      );
      expect(hasil).toHaveLength(1);
    });
  });
});

describe("backfill varian", () => {
  it("tidak ada sesi lama yang variannya kosong atau salah layanan", async () => {
    const salah = await querySql<{ id: string }>(
      `select s.id from public.sessions s
        where s.variant_id is null
           or not exists (select 1 from public.service_variants v
                           where v.id = s.variant_id and v.service_id = s.service_id)`,
    );
    expect(salah).toEqual([]);
  });

  it("tidak ada permintaan jadwal lama yang variannya kosong atau salah layanan", async () => {
    const salah = await querySql<{ id: string }>(
      `select b.id from public.booking_requests b
        where b.variant_id is null
           or not exists (select 1 from public.service_variants v
                           where v.id = b.variant_id and v.service_id = b.service_id)`,
    );
    expect(salah).toEqual([]);
  });
});
