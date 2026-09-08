import { describe, it, expect } from "vitest";
import { querySql, dalamTransaksiRollback } from "./helpers/db";

describe("enum jenjang transport", () => {
  it("berisi lima jenjang, urut dari terdekat", async () => {
    const baris = await querySql<{ label: string }>(
      `select e.enumlabel as label from pg_enum e
         join pg_type t on t.oid = e.enumtypid
        where t.typname = 'jenjang_transport' order by e.enumsortorder`,
    );
    expect(baris.map((b) => b.label)).toEqual(["0_5", "5_10", "10_15", "15_20", "di_atas_20"]);
  });

  it("sumber_jenjang membedakan saran sistem dari penimpaan admin", async () => {
    const baris = await querySql<{ label: string }>(
      `select e.enumlabel as label from pg_enum e
         join pg_type t on t.oid = e.enumtypid
        where t.typname = 'sumber_jenjang' order by e.enumsortorder`,
    );
    expect(baris.map((b) => b.label)).toEqual(["otomatis", "admin"]);
  });
});

describe("kolom alamat & koordinat", () => {
  it.each(["clients", "partners", "booking_requests", "sessions"])(
    "%s punya alamat beserta koordinat yang BOLEH kosong",
    async (tabel) => {
      // KOREKSI brief: `OR` mengikat lebih longgar daripada `AND`, jadi kedua
      // cabang saringan kolom WAJIB dibungkus tanda kurung eksplisit —
      // kalau tidak, cabang `lat`/`lon` lepas dari `table_schema = 'public'`
      // dan bisa memulangkan baris dari skema lain.
      const kolom = await querySql<{ column_name: string; is_nullable: string }>(
        `select c.column_name, c.is_nullable from information_schema.columns c
          where c.table_schema = 'public'
            and c.table_name = $1
            and (c.column_name like 'alamat%' or c.column_name in ('lat','lon'))
          order by c.column_name`,
        [tabel],
      );
      const nama = kolom.map((k) => k.column_name);
      expect(nama.some((n) => n.startsWith("alamat"))).toBe(true);
      // Koordinat WAJIB nullable: geocoding yang gagal tidak boleh menggagalkan
      // penyimpanan alamat (spec T6).
      const koordinat = kolom.filter((k) => /lat$|lon$/.test(k.column_name));
      expect(koordinat.length).toBe(2);
      for (const k of koordinat) expect(k.is_nullable).toBe("YES");
    },
  );
});

describe("penimpaan jenjang menuntut alasan", () => {
  it("menolak jenjang_sumber = 'admin' tanpa alasan", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [k] = (await jalankan(`select id from public.clients limit 1`)) as Array<{ id: string }>;
      const [m] = (await jalankan(`select id from public.partners limit 1`)) as Array<{ id: string }>;
      const [v] = (await jalankan(
        `select service_id, id as variant_id from public.service_variants limit 1`,
      )) as Array<{ service_id: string; variant_id: string }>;

      await expect(
        jalankan(
          `insert into public.sessions
             (client_id, service_id, variant_id, partner_id, tanggal, jam_mulai, jenjang, jenjang_sumber)
           values ($1,$2,$3,$4, current_date, '09:00', '5_10', 'admin')`,
          [k.id, v.service_id, v.variant_id, m.id],
        ),
      ).rejects.toThrow(/sessions_alasan_penimpaan/);
    });
  });

  it("menerima penimpaan yang beralasan", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [k] = (await jalankan(`select id from public.clients limit 1`)) as Array<{ id: string }>;
      const [m] = (await jalankan(`select id from public.partners limit 1`)) as Array<{ id: string }>;
      const [v] = (await jalankan(
        `select service_id, id as variant_id from public.service_variants limit 1`,
      )) as Array<{ service_id: string; variant_id: string }>;

      const hasil = await jalankan(
        `insert into public.sessions
           (client_id, service_id, variant_id, partner_id, tanggal, jam_mulai, jenjang, jenjang_sumber, jenjang_alasan)
         values ($1,$2,$3,$4, current_date, '09:00', '5_10', 'admin', 'Alamat di seberang sungai, memutar lewat jembatan.')
         returning id`,
        [k.id, v.service_id, v.variant_id, m.id],
      );
      expect(hasil).toHaveLength(1);
    });
  });
});
