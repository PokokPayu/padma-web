import { describe, it, expect } from "vitest";
import { querySql, dalamTransaksiRollback } from "./helpers/db";

/**
 * Pagar uang `service_rates` lahir dari temuan red team (30 Agu 2026) dengan
 * bukti tertulis di pengerasan_tabel_uang.sql. Memindahkan tarif ke tabel baru
 * tanpa memindahkan pagarnya berarti membayar ulang temuan yang sama.
 *
 * Ketiganya diuji sebagai peran API — bukan sebagai postgres — karena justru
 * gerbang peran itu yang membedakan jalur sah dari jalur terlarang.
 *
 * `set local role authenticated` SAJA tidak cukup: policy "variant_rates:
 * hanya owner" memakai `user_role() = 'owner'`, yang membaca `auth.uid()` dari
 * `request.jwt.claims`. Tanpa klaim itu RLS menolak duluan dengan "new row
 * violates row-level security policy" — pesan yang BUKAN milik trigger yang
 * sedang diuji. Klaimnya karena itu diisi uid owner sungguhan, persis pola
 * `sebagaiAuthenticated`-nya sendiri di tests/hak-hapus-berlebih.test.ts,
 * supaya permintaan lolos RLS dan trigger-nyalah yang akhirnya menjawab.
 *
 * `reset role` di `finally` dibungkus `.catch(() => {})`: begitu `fn()` sudah
 * membuktikan penolakannya, Postgres menandai TRANSAKSI (bukan cuma
 * pernyataannya) sebagai aborted sampai rollback — setiap perintah sesudahnya,
 * termasuk `reset role` yang tidak bersalah, ikut menjawab error generik itu.
 * `dalamTransaksiRollback` toh selalu me-rollback seluruh transaksi di
 * penutupnya, jadi state peran di dalamnya tidak pernah perlu benar-benar
 * pulih.
 */
async function sebagaiAuthenticated<T>(
  jalankan: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>,
  fn: () => Promise<T>,
): Promise<T> {
  const [owner] = (await jalankan(
    `select id from auth.users where email = 'owner@padma.test'`,
  )) as Array<{ id: string }>;
  await jalankan("set local role authenticated");
  await jalankan(
    `select set_config('request.jwt.claims',
       json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
    [owner.id],
  );
  try {
    return await fn();
  } finally {
    await jalankan("reset role").catch(() => {});
  }
}

describe("variant_rates — pagar uang dipindah apa adanya", () => {
  /**
   * >>> DIPENSIUNKAN (Task 5) — bukan dihapus diam-diam <<<
   *
   * Uji ini dulu bernama "pernyataan salinan migrasi memindahkan baris
   * service_rates apa adanya (rollback)". Yang dijaganya: pernyataan
   * `insert into variant_rates ... select ... from service_rates join
   * service_variants ...` di migrasi `tarif_per_varian` menyalin SETIAP baris
   * `service_rates` verbatim ke `variant_rates` — nominalnya utuh DAN
   * `berlaku_sejak`-nya tidak dibulatkan ke hari migrasi berjalan — dengan
   * cara menjalankan pernyataan migrasi itu VERBATIM di dalam transaksi yang
   * di-rollback, di atas satu baris fixture bertanggal 2021 plus kesepuluh
   * baris seed asli.
   *
   * Ia tidak lagi bisa dijaga: migration `bubarkan_service_rates` (Task 5)
   * menjatuhkan `public.service_rates` sepenuhnya. Pernyataan yang diuji
   * verbatim di sini menjadi SQL yang menyebut tabel yang tidak ada lagi —
   * bahkan di dalam transaksi yang di-rollback, `service_rates` sudah tidak
   * ada untuk DISEBUT, bukan cuma kosong. Ini bukan pagar yang jebol; ini satu
   * pernyataan migrasi yang sudah berjalan SEKALI (saat Task 3 diterapkan ke
   * riwayat migrasi) dan tidak akan pernah berjalan lagi — migrasi tidak
   * pernah dijalankan ulang di basis data yang sama. Menjaga string SQL-nya
   * pasca tabelnya jatuh berarti menjaga sesuatu yang bukan kode produksi lagi.
   *
   * Jaminan yang SEBENARNYA dibutuhkan pembaca berikutnya — "variant_rates
   * berisi tarif yang benar, dengan berlaku_sejak riwayat yang utuh" — tetap
   * hidup dan diuji lewat jalur lain yang TIDAK bergantung pada service_rates:
   * `tests/owner-tarif.test.ts` (rate card dibaca & ditampilkan dengan nominal
   * & tanggal yang benar) dan `supabase/seed.sql` sendiri (satu insert
   * langsung ke `variant_rates`, diverifikasi lewat `npm run db:recover`).
   */

  it("CHECK menolak honor melebihi harga", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [v] = (await jalankan(`select id from public.service_variants limit 1`)) as Array<{ id: string }>;
      await expect(
        jalankan(
          `insert into public.variant_rates (variant_id, harga_klien, honor_mitra, berlaku_sejak)
           values ($1, 100000, 900000, '2099-01-01')`,
          [v.id],
        ),
      ).rejects.toThrow(/variant_rates_nilai_wajar/);
    });
  });

  it("CHECK menolak harga coret lebih murah dari harga klien", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [v] = (await jalankan(`select id from public.service_variants limit 1`)) as Array<{ id: string }>;
      await expect(
        jalankan(
          `insert into public.variant_rates (variant_id, harga_klien, harga_coret, honor_mitra, berlaku_sejak)
           values ($1, 200000, 150000, 100000, '2099-01-01')`,
          [v.id],
        ),
      ).rejects.toThrow(/variant_rates_nilai_wajar/);
    });
  });

  it("unique per (variant_id, berlaku_sejak) menolak tarif kembar", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [v] = (await jalankan(`select id from public.service_variants limit 1`)) as Array<{ id: string }>;
      await jalankan(
        `insert into public.variant_rates (variant_id, harga_klien, honor_mitra, berlaku_sejak)
         values ($1, 200000, 100000, '2099-01-01')`,
        [v.id],
      );
      await expect(
        jalankan(
          `insert into public.variant_rates (variant_id, harga_klien, honor_mitra, berlaku_sejak)
           values ($1, 300000, 100000, '2099-01-01')`,
          [v.id],
        ),
      ).rejects.toThrow(/variant_rates_unik_per_tanggal/);
    });
  });

  it("tarif retroaktif ditolak untuk peran API, dilewatkan untuk postgres", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [v] = (await jalankan(
        `select id from public.service_variants limit 1`,
      )) as Array<{ id: string }>;

      // postgres: dilewatkan — seed & fixture memang menyemai tanggal lampau.
      const lolos = await jalankan(
        `insert into public.variant_rates (variant_id, harga_klien, honor_mitra, berlaku_sejak)
         values ($1, 200000, 100000, '1999-01-01') returning id`,
        [v.id],
      );
      expect(lolos).toHaveLength(1);

      await sebagaiAuthenticated(jalankan, async () => {
        await expect(
          jalankan(
            `insert into public.variant_rates (variant_id, harga_klien, honor_mitra, berlaku_sejak)
             values ($1, 200000, 100000, '1998-01-01')`,
            [v.id],
          ),
        ).rejects.toThrow(/harus berlaku sesudah/);
      });
    });
  });

  it("UPDATE ditolak seluruhnya untuk peran API", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      await sebagaiAuthenticated(jalankan, async () => {
        await expect(
          jalankan(`update public.variant_rates set harga_klien = 1`),
        ).rejects.toThrow(/append-only/);
      });
    });
  });

  it("anon tidak memegang hak tabel maupun hak kolom atas variant_rates", async () => {
    const tabel = await querySql<{ priv: string }>(
      `select p.priv from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as p(priv)
        where has_table_privilege('anon', 'public.variant_rates'::regclass, p.priv)`,
    );
    expect(tabel).toEqual([]);

    const kolom = await querySql<{ kolom: string }>(
      `select c.column_name as kolom
         from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = 'variant_rates'
          and has_column_privilege('anon', 'public.variant_rates'::regclass, c.column_name, 'SELECT')`,
    );
    expect(kolom).toEqual([]);
  });

  it("authenticated tidak memegang DELETE atas variant_rates", async () => {
    const [row] = await querySql<{ boleh: boolean }>(
      `select has_table_privilege('authenticated', 'public.variant_rates'::regclass, 'DELETE') as boleh`,
    );
    expect(row.boleh).toBe(false);
  });
});
