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
   * Uji "seluruh baris service_rates tersalin" ala brief MUSTAHIL hijau:
   * pada `db reset` bersih, migrasi berjalan SEBELUM `seed.sql`, jadi saat
   * pernyataan salinan migrasi dijalankan `service_rates` MASIH KOSONG — ia
   * menyalin nol baris — sementara seed sesudahnya mengisi `service_rates`
   * dengan 10 baris dan `variant_rates` tetap kosong. Membandingkan cacahnya
   * sesudah `db reset` + seed karena itu selalu membandingkan 10 dengan 0.
   *
   * Gantinya (Ruling 3, direvisi Ruling 10): pernyataan salin yang DIUJI harus
   * IDENTIK — bukan cuma "identik dalam semangat" — dengan yang ada di migrasi
   * `20260906120000_tarif_per_varian.sql`, tanpa satu klausa pun ditambahkan
   * demi kenyamanan uji. Draft pertama uji ini menambahkan `where r.service_id
   * = $1` supaya pernyataan tak berfilter tidak bentrok dengan 10 baris seed
   * yang sudah dicerminkan blok CERMIN `seed.sql` ke `variant_rates` — tetapi
   * itu berarti yang diuji adalah STRING LAIN yang kebetulan mirip, bukan kode
   * produksi: bila migrasi kelak menambah filter atau mengganti kolom sumber,
   * uji berfilter itu tidak dijamin ikut merah.
   *
   * Diperbaiki dengan mengosongkan `variant_rates` lebih dulu (`delete` —
   * berjalan sebagai `postgres` di dalam transaksi yang di-rollback, jadi
   * pencabutan DELETE untuk `authenticated` tidak menghalanginya, dan seluruh
   * baris seed kembali begitu transaksi ini dibatalkan), lalu menyemai satu
   * baris fixture sendiri, lalu menjalankan pernyataan migrasi TANPA
   * perubahan apa pun. Karena tabelnya kosong sebelum pernyataan berjalan,
   * pernyataan tak berfilter itu tidak bentrok dengan siapa pun — dan hasilnya
   * dites dua arah: baris fixture sendiri (tanggal 2021, memastikan
   * berlaku_sejak tidak dibulatkan ke hari migrasi) DAN kesepuluh baris seed
   * asli (memastikan seluruh rate card ikut tersalin dengan tanggalnya
   * masing-masing utuh — persis niat uji "seluruh baris tersalin" ala brief,
   * kini terwujud tanpa perbandingan yang mustahil hijau).
   *
   * Pola dasarnya (semai dalam rollback, jalankan pernyataan migrasi apa
   * adanya) sama dengan tests/varian-pasangan-layanan.test.ts untuk backfill
   * Task 2.
   */
  it("pernyataan salinan migrasi memindahkan baris service_rates apa adanya (rollback)", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const LAYANAN_UJI = "11111111-1111-1111-1111-11111111ab01";
      const VARIAN_UJI = "11111111-1111-1111-1111-11111111ab02";

      // Kosongkan dulu: pernyataan migrasi TIDAK berfilter, jadi ia menyalin
      // SELURUH service_rates yang ada. Tanpa ini ia bentrok dengan 10 baris
      // seed yang sudah dicerminkan blok CERMIN seed.sql lewat
      // variant_rates_unik_per_tanggal.
      await jalankan(`delete from public.variant_rates`);

      await jalankan(
        `insert into public.services (id, phase_id, nama, deskripsi, aktif)
         values ($1, 'prekonsepsi', 'PAD-UJI Layanan Salin Tarif', 'fixture', true)`,
        [LAYANAN_UJI],
      );
      await jalankan(
        `insert into public.service_variants (id, service_id, label)
         values ($1, $2, '')`,
        [VARIAN_UJI, LAYANAN_UJI],
      );
      await jalankan(
        `insert into public.service_rates (service_id, harga_klien, honor_mitra, berlaku_sejak)
         values ($1, 275000, 120000, '2021-06-15')`,
        [LAYANAN_UJI],
      );

      // Verbatim — identik dengan migrasi 20260906120000_tarif_per_varian.sql,
      // tanpa satu klausa tambahan pun. Bila baris ini berbeda dari migrasi,
      // uji ini menjaga sesuatu yang bukan kode produksi.
      await jalankan(
        `insert into public.variant_rates (variant_id, harga_klien, honor_mitra, berlaku_sejak)
           select v.id, r.harga_klien, r.honor_mitra, r.berlaku_sejak
             from public.service_rates r
             join public.service_variants v on v.service_id = r.service_id`,
      );

      // (a) Baris fixture sendiri: berlaku_sejak 2021 tidak dibulatkan ke hari
      // migrasi.
      const fixture = await jalankan(
        `select harga_klien, honor_mitra, berlaku_sejak::text as berlaku_sejak
           from public.variant_rates where variant_id = $1`,
        [VARIAN_UJI],
      );
      expect(fixture).toEqual([
        { harga_klien: 275000, honor_mitra: 120000, berlaku_sejak: "2021-06-15" },
      ]);

      // (b) Kesepuluh baris seed asli ikut tersalin, tanggalnya masing-masing
      // utuh — bukan hanya baris fixture yang diperiksa. Ini bonus nyata dari
      // pengosongan (1): pernyataan yang sama persis kini bisa diuji atas
      // SELURUH service_rates yang berjalan, bukan cuma satu baris karangan.
      const beda = await jalankan(
        `select count(*)::int as n
           from public.service_rates r
           join public.service_variants v on v.service_id = r.service_id
          where not exists (
            select 1 from public.variant_rates vr
             where vr.variant_id = v.id
               and vr.harga_klien = r.harga_klien
               and vr.honor_mitra = r.honor_mitra
               and vr.berlaku_sejak = r.berlaku_sejak)`,
      );
      expect(beda[0].n).toBe(0);

      const cacah = await jalankan(
        `select (select count(*)::int from public.service_rates) as lama,
                (select count(*)::int from public.variant_rates) as baru`,
      );
      expect(cacah[0].baru).toBe(cacah[0].lama);
      expect(cacah[0].lama).toBeGreaterThanOrEqual(11); // 10 seed + 1 fixture
    });
  });

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
