import { describe, it, expect } from "vitest";
import { querySql, dalamTransaksiRollback } from "./helpers/db";

/**
 * >>> DIPERBAIKI dari draft brief (7 Sep 2026) <<<
 *
 * Draft brief menjalankan `set local role authenticated` polos, tanpa klaim
 * JWT apa pun. Itu memang membuat REST/psql "menjadi" authenticated, tetapi
 * policy "transport_rates: hanya owner" memakai `user_role() = 'owner'`, yang
 * membaca `auth.uid()` dari `request.jwt.claims` — tanpa klaim itu, fungsinya
 * bukan 'owner'. Efeknya berbeda untuk INSERT vs UPDATE:
 *   - INSERT: trigger BEFORE ROW (guard_tarif_transport_maju) tetap sempat
 *     melempar duluan sebelum WITH CHECK RLS dievaluasi, jadi uji retroaktif
 *     KEBETULAN tetap lolos — tetapi `reset role` di `finally` lalu ikut
 *     gagal ("current transaction is aborted"), karena error trigger sudah
 *     membubarkan transaksi dan `reset role` tidak dibungkus `.catch()`.
 *   - UPDATE: klausa USING RLS menyaring baris sebelum trigger sempat
 *     berjalan sama sekali — bukan error, tapi 0 baris cocok — sehingga uji
 *     "UPDATE ditolak seluruhnya" lulus untuk alasan yang salah (resolve ke
 *     array kosong, bukan reject).
 *
 * Pola di bawah — mengisi `request.jwt.claims` dengan uid owner sungguhan dan
 * membungkus `reset role` dengan `.catch()` — sudah dipakai & didokumentasikan
 * di tests/varian-tarif-pengerasan.test.ts untuk pagar `variant_rates` yang
 * identik; disalin verbatim ke sini dengan alasan yang sama.
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

describe("transport_rates — pagar uang", () => {
  it("honor BOLEH melebihi tarif klien — itulah subsidi PADMA", async () => {
    // Berbeda dari variant_rates, yang justru MENOLAK honor > harga. Pada
    // 0–5 km klien membayar Rp0 sementara mitra menerima Rp10.000; selisihnya
    // subsidi, bukan kekeliruan.
    await dalamTransaksiRollback(async (jalankan) => {
      const hasil = await jalankan(
        `insert into public.transport_rates (jenjang, tarif_klien, honor_mitra, berlaku_sejak)
         values ('0_5', 0, 10000, '2099-01-01') returning id`,
      );
      expect(hasil).toHaveLength(1);
    });
  });

  it("menolak nominal negatif", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      await expect(
        jalankan(
          `insert into public.transport_rates (jenjang, tarif_klien, honor_mitra, berlaku_sejak)
           values ('5_10', -1, 10000, '2099-01-01')`,
        ),
      ).rejects.toThrow(/transport_rates_nilai_wajar/);
    });
  });

  it("menolak tarif kembar pada jenjang & tanggal yang sama", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      await jalankan(
        `insert into public.transport_rates (jenjang, tarif_klien, honor_mitra, berlaku_sejak)
         values ('5_10', 10000, 10000, '2099-01-01')`,
      );
      await expect(
        jalankan(
          `insert into public.transport_rates (jenjang, tarif_klien, honor_mitra, berlaku_sejak)
           values ('5_10', 20000, 10000, '2099-01-01')`,
        ),
      ).rejects.toThrow(/transport_rates_unik_per_tanggal/);
    });
  });

  it("tarif retroaktif ditolak untuk peran API, dilewatkan untuk postgres", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const lolos = await jalankan(
        `insert into public.transport_rates (jenjang, tarif_klien, honor_mitra, berlaku_sejak)
         values ('10_15', 20000, 12000, '1999-01-01') returning id`,
      );
      expect(lolos).toHaveLength(1);

      await sebagaiAuthenticated(jalankan, async () => {
        await expect(
          jalankan(
            `insert into public.transport_rates (jenjang, tarif_klien, honor_mitra, berlaku_sejak)
             values ('10_15', 20000, 12000, '1998-01-01')`,
          ),
        ).rejects.toThrow(/harus berlaku sesudah/);
      });
    });
  });

  it("UPDATE ditolak seluruhnya untuk peran API", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      await sebagaiAuthenticated(jalankan, async () => {
        await expect(
          jalankan(`update public.transport_rates set tarif_klien = 1`),
        ).rejects.toThrow(/append-only/);
      });
    });
  });

  it("anon tidak memegang hak tabel maupun hak kolom", async () => {
    const tabel = await querySql<{ priv: string }>(
      `select p.priv from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as p(priv)
        where has_table_privilege('anon', 'public.transport_rates'::regclass, p.priv)`,
    );
    expect(tabel).toEqual([]);

    const kolom = await querySql<{ kolom: string }>(
      `select c.column_name as kolom from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = 'transport_rates'
          and has_column_privilege('anon', 'public.transport_rates'::regclass, c.column_name, 'SELECT')`,
    );
    expect(kolom).toEqual([]);
  });

  it("authenticated tidak memegang DELETE", async () => {
    const [row] = await querySql<{ boleh: boolean }>(
      `select has_table_privilege('authenticated', 'public.transport_rates'::regclass, 'DELETE') as boleh`,
    );
    expect(row.boleh).toBe(false);
  });

  it("di_atas_20 tidak pernah punya baris tarif — tarifnya per kasus", async () => {
    const baris = await querySql<{ n: string }>(
      `select count(*)::text as n from public.transport_rates where jenjang = 'di_atas_20'`,
    );
    expect(baris[0].n).toBe("0");
  });
});
