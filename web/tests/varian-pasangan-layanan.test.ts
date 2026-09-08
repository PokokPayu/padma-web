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
        `insert into public.sessions (client_id, service_id, variant_id, partner_id, tanggal, jam_mulai)
         values ($1, $2, $3, $4, current_date, '09:00') returning id`,
        [klien.id, a.service_id, a.variant_id, mitra.id],
      );
      expect(hasil).toHaveLength(1);
    });
  });
});

describe("backfill varian", () => {
  // Menjaga KEADAAN AKHIR sesudah seluruh migrasi + seed jalan — bukan
  // logika `update` backfill itu sendiri. `sessions` seed lahir dengan
  // `variant_id` sudah terisi lewat `seed-users.ts` (Ruling 1), jadi baris
  // di sini tidak pernah benar-benar NULL saat migrasi menjalankan
  // backfill-nya; uji ini hanya membuktikan tidak ada yang tertinggal salah.
  it("tidak ada sesi lama yang variannya kosong atau salah layanan", async () => {
    const salah = await querySql<{ id: string }>(
      `select s.id from public.sessions s
        where s.variant_id is null
           or not exists (select 1 from public.service_variants v
                           where v.id = s.variant_id and v.service_id = s.service_id)`,
    );
    expect(salah).toEqual([]);
  });

  // TIDAK ADA jalur seed (seed.sql, seed-users.ts, maupun global-setup.ts)
  // yang pernah membuat baris `booking_requests` permanen — jadi query di
  // bawah selalu memulangkan array kosong dan lulus HAMPA: ia tidak bisa
  // membuktikan backfill `booking_requests` benar, hanya bahwa tidak ada
  // baris yang salah (karena tidak ada baris sama sekali). Pernyataan
  // `update` migrasi untuk `booking_requests` justru divalidasi oleh uji
  // rollback pada describe di bawah, yang menyemai baris NULL sungguhan.
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

/**
 * `db reset` bersih menjalankan migrasi SAAT `sessions` & `booking_requests`
 * masih kosong (migrasi berjalan sebelum seed apa pun) — jadi pernyataan
 * `update ... where variant_id is null` di migrasi tidak pernah tersentuh
 * baris NULL sungguhan lewat `db reset` + `npm test` biasa: uji `sessions` di
 * atas hijau karena `seed-users.ts` menulis `variant_id` eksplisit saat
 * INSERT (Ruling 1), dan `booking_requests` tidak punya baris sama sekali.
 * Satu-satunya cara memvalidasi LOGIKA backfill-nya sendiri adalah menyemai
 * baris ber-`variant_id` NULL di sini, di dalam transaksi yang di-rollback,
 * lalu menjalankan pernyataan `update` yang SAMA PERSIS dengan migrasi
 * `20260906110000_sesi_menunjuk_varian.sql` — disalin apa adanya, sengaja,
 * supaya uji ini menjaga kode produksi itu sendiri, bukan versi lain yang
 * kebetulan terlihat mirip.
 *
 * Sejak Task 9 (`20260906160000_varian_wajib.sql`) kolomnya `not null`, jadi
 * baris ber-`variant_id` NULL tidak lagi bisa disemai lewat INSERT biasa —
 * bahkan di dalam transaksi yang di-rollback. Setiap test di bawah karena itu
 * melonggarkan constraint-nya DI DALAM transaksi yang sama sebelum menyemai
 * (`alter table ... drop not null`), lalu menjalankan pernyataan `update`
 * backfill yang sama persis dengan migrasi `20260906160000_varian_wajib.sql`
 * (jaring pengaman migrasi itu, disalin sengaja) sebelum diverifikasi.
 * Transaksinya di-rollback sesudahnya — constraint aslinya tidak pernah
 * benar-benar terlepas.
 */
describe("backfill varian (pernyataan migrasi, divalidasi lewat rollback)", () => {
  it("mengisi variant_id sessions yang NULL dengan varian baku layanannya", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [a] = (await jalankan(
        `select s.id as service_id, v.id as variant_id
           from public.services s
           join public.service_variants v on v.service_id = s.id
          order by s.nama limit 1`,
      )) as Array<{ service_id: string; variant_id: string }>;
      const [klien] = (await jalankan(`select id from public.clients limit 1`)) as Array<{ id: string }>;
      const [mitra] = (await jalankan(`select id from public.partners limit 1`)) as Array<{ id: string }>;

      // Sejak Task 9 kolomnya `not null` — dilonggarkan di dalam transaksi
      // ini saja supaya baris ber-variant_id NULL bisa disemai, meniru data
      // yang lahir SEBELUM constraint itu ada. Rollback di akhir mengembalikan
      // constraint aslinya utuh.
      await jalankan(`alter table public.sessions alter column variant_id drop not null`);

      const [sesi] = (await jalankan(
        `insert into public.sessions (client_id, service_id, variant_id, partner_id, tanggal, jam_mulai)
         values ($1, $2, null, $3, current_date, '09:00') returning id`,
        [klien.id, a.service_id, mitra.id],
      )) as Array<{ id: string }>;

      // Identik dengan jaring pengaman migrasi 20260906160000_varian_wajib.sql
      // (disalin dari migrasi backfill 20260906110000_sesi_menunjuk_varian.sql).
      await jalankan(
        `update public.sessions s
            set variant_id = (select v.id from public.service_variants v
                               where v.service_id = s.service_id
                               order by v.urutan, v.created_at, v.id limit 1)
          where s.variant_id is null`,
      );

      const [hasil] = (await jalankan(
        `select variant_id from public.sessions where id = $1`,
        [sesi.id],
      )) as Array<{ variant_id: string }>;
      expect(hasil.variant_id).toBe(a.variant_id);
    });
  });

  it("mengisi variant_id booking_requests yang NULL dengan varian baku layanannya", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [a] = (await jalankan(
        `select s.id as service_id, v.id as variant_id
           from public.services s
           join public.service_variants v on v.service_id = s.id
          order by s.nama limit 1`,
      )) as Array<{ service_id: string; variant_id: string }>;
      const [klien] = (await jalankan(`select id from public.clients limit 1`)) as Array<{ id: string }>;

      // Sejak Task 9 kolomnya `not null` — dilonggarkan di dalam transaksi
      // ini saja, lihat komentar pada test sessions di atas.
      await jalankan(`alter table public.booking_requests alter column variant_id drop not null`);

      // Sejak C1-b `booking_requests.screening_id` juga `not null` (indeks
      // UNIK, satu skrining hijau menopang tepat satu pengajuan) — fixture ini
      // menyemai skriningnya sendiri lewat SQL mentah, sama seperti seluruh
      // baris lain di test ini, karena berjalan di dalam transaksi rollback
      // milik `dalamTransaksiRollback` (bukan lewat klien Supabase).
      const [skrining] = (await jalankan(
        `insert into public.screenings (kode, nama, no_hp, fase, jawaban, hasil, flags, client_id)
         values ($1, 'Fixture Varian', '0800-0000-0000', 'prekonsepsi', '{}'::jsonb, 'hijau', '[]'::jsonb, $2)
         returning id`,
        [`UJI-VARIAN-${Date.now().toString(36)}`, klien.id],
      )) as Array<{ id: string }>;

      const [permintaan] = (await jalankan(
        `insert into public.booking_requests
           (client_id, service_id, variant_id, tanggal, jam_mulai, preferensi_waktu, screening_id)
         values ($1, $2, null, current_date, '09:00', 'pagi', $3) returning id`,
        [klien.id, a.service_id, skrining.id],
      )) as Array<{ id: string }>;

      // Identik dengan jaring pengaman migrasi 20260906160000_varian_wajib.sql
      // (disalin dari migrasi backfill 20260906110000_sesi_menunjuk_varian.sql).
      await jalankan(
        `update public.booking_requests b
            set variant_id = (select v.id from public.service_variants v
                               where v.service_id = b.service_id
                               order by v.urutan, v.created_at, v.id limit 1)
          where b.variant_id is null`,
      );

      const [hasil] = (await jalankan(
        `select variant_id from public.booking_requests where id = $1`,
        [permintaan.id],
      )) as Array<{ variant_id: string }>;
      expect(hasil.variant_id).toBe(a.variant_id);
    });
  });
});
