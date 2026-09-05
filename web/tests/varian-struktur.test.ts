import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";

/**
 * V3 spec: SETIAP layanan wajib punya minimal satu varian.
 *
 * Diuji langsung ke basis data, bukan lewat kode aplikasi: begitu "layanan
 * tanpa varian" boleh ada, setiap perhitungan harga bercabang dua selamanya —
 * dan cabang keduanya hanya muncul di produksi.
 */
describe("service_variants — struktur", () => {
  it("enum varian_format berisi tepat private & circle", async () => {
    const baris = await querySql<{ label: string }>(
      `select e.enumlabel as label
         from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'varian_format'
        order by e.enumsortorder`,
    );
    expect(baris.map((b) => b.label)).toEqual(["private", "circle"]);
  });

  it("setiap layanan punya minimal satu varian", async () => {
    const yatim = await querySql<{ id: string }>(
      `select s.id from public.services s
        where not exists (select 1 from public.service_variants v
                           where v.service_id = s.id)`,
    );
    expect(yatim).toEqual([]);
  });

  it("unique (service_id, id) ada — penopang FK gabungan Task 2", async () => {
    const baris = await querySql<{ conname: string }>(
      `select conname from pg_constraint
        where conrelid = 'public.service_variants'::regclass
          and contype = 'u'
          and conkey = array[
                (select attnum from pg_attribute
                  where attrelid = 'public.service_variants'::regclass
                    and attname = 'service_id'),
                (select attnum from pg_attribute
                  where attrelid = 'public.service_variants'::regclass
                    and attname = 'id')]::smallint[]`,
    );
    expect(baris).toHaveLength(1);
  });

  it("anon hanya boleh SELECT service_variants — tanpa hak tulis", async () => {
    const hak = await querySql<{ priv: string }>(
      `select p.priv from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as p(priv)
        where has_table_privilege('anon', 'public.service_variants'::regclass, p.priv)
        order by p.priv`,
    );
    expect(hak.map((h) => h.priv)).toEqual(["SELECT"]);
  });

  it("authenticated tidak memegang DELETE atas service_variants", async () => {
    const [row] = await querySql<{ boleh: boolean }>(
      `select has_table_privilege('authenticated', 'public.service_variants'::regclass, 'DELETE') as boleh`,
    );
    expect(row.boleh).toBe(false);
  });
});
