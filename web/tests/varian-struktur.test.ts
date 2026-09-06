import { describe, it, expect } from "vitest";
import { querySql, dalamTransaksiRollback } from "./helpers/db";

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

/**
 * Temuan 1 (fix round 1, Task 4): backfill Task 1 hanya menerbitkan varian
 * baku SEKALI, saat migrasi itu dijalankan. Layanan yang lahir SESUDAHNYA —
 * lewat `simpanLayanan()`, lewat seed, atau lewat POST langsung ke
 * /rest/v1/services — tidak pernah disentuh backfill itu, dan V3 spec
 * ("setiap layanan wajib punya minimal satu varian") diam-diam berhenti
 * berlaku untuknya. `ambilRateCard()` mendaftar PER VARIAN sejak Task 4, jadi
 * layanan yatim itu menyumbang NOL baris — hilang dari rate card tanpa satu
 * pun error.
 *
 * Ruling 11 menutupnya dengan trigger `trg_terbitkan_varian_baku`
 * (migrasi 20260906130000), BUKAN dengan menyuruh setiap pemanggil INSERT
 * `services` ikut menyisipkan variannya sendiri — pagar yang cuma hidup di
 * kode aplikasi dilewati REST langsung maupun service role. Karena itu uji di
 * bawah menyisipkan lewat SQL MENTAH sebagai `postgres` (superuser, peran
 * yang PALING mudah melewati pagar aplikasi apa pun) — bukan lewat server
 * action — supaya pembuktiannya bukan "kode TypeScript ikut menyisipkan
 * varian", melainkan "basis data sendiri yang menerbitkannya, untuk peran
 * apa pun".
 */
describe("service_variants — varian baku diterbitkan OTOMATIS saat layanan lahir (Ruling 11)", () => {
  it("INSERT langsung ke services (peran apa pun, termasuk postgres) menerbitkan satu varian baku", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const LAYANAN_UJI = "11111111-1111-1111-1111-11111111ba01";
      await jalankan(
        `insert into public.services (id, phase_id, nama, aktif)
         values ($1, 'prekonsepsi', 'PAD-UJI Trigger Varian Baku', true)`,
        [LAYANAN_UJI],
      );

      const varian = await jalankan(
        `select label, durasi_menit, format, urutan
           from public.service_variants where service_id = $1`,
        [LAYANAN_UJI],
      );
      expect(varian).toEqual([
        { label: "", durasi_menit: null, format: null, urutan: 0 },
      ]);
    });
  });

  it("fungsi trigger BUKAN security definer dan hak eksekusinya sudah dicabut dari peran API", async () => {
    const [fn] = await querySql<{ definer: boolean }>(
      `select prosecdef as definer from pg_proc
        where proname = 'terbitkan_varian_baku' and pronamespace = 'public'::regnamespace`,
    );
    expect(fn.definer).toBe(false);

    const [hak] = await querySql<{ anon_bisa: boolean; authenticated_bisa: boolean }>(
      `select has_function_privilege('anon', 'public.terbitkan_varian_baku()'::regprocedure, 'EXECUTE') as anon_bisa,
              has_function_privilege('authenticated', 'public.terbitkan_varian_baku()'::regprocedure, 'EXECUTE') as authenticated_bisa`,
    );
    expect(hak.anon_bisa).toBe(false);
    expect(hak.authenticated_bisa).toBe(false);
  });
});
