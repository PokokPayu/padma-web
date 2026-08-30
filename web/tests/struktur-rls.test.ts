import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";

// Tabel baru lahir TANPA RLS dan `authenticated` mendapat SELECT/INSERT/UPDATE
// secara default. Kelalaian itu lolos 1109 test karena tidak ada satu pun yang
// menjaganya. Pagar ini menutup kelas bug itu untuk selamanya.
describe("invarian struktural: tidak ada tabel tanpa RLS", () => {
  it("setiap tabel di schema public mengaktifkan row level security", async () => {
    const tanpaRls = await querySql<{ relname: string }>(`
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
       order by c.relname`);
    expect(tanpaRls.map((t) => t.relname)).toEqual([]);
  });

  // Tabel yang SENGAJA terkunci mati: RLS aktif tanpa policy sama sekali,
  // sehingga tidak ada peran API yang bisa menyentuhnya — hanya service role.
  // Ini keputusan desain, bukan kelalaian. Daftar ini harus tetap PENDEK;
  // menambahkan nama ke sini wajib disertai alasan.
  const SENGAJA_TERKUNCI = [
    // Token undangan disimpan sebagai SHA-256 dan tidak boleh terbaca peran
    // API mana pun, termasuk admin. Penerbitannya lewat server action
    // service-role yang mengembalikan token mentah sekali saja.
    "client_invites",
  ];

  it("tabel ber-RLS tanpa policy hanya yang sengaja terkunci", async () => {
    const tanpaPolicy = await querySql<{ relname: string }>(`
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = true
         and not exists (select 1 from pg_policies p
                          where p.schemaname = 'public' and p.tablename = c.relname)
       order by c.relname`);
    expect(tanpaPolicy.map((t) => t.relname)).toEqual(SENGAJA_TERKUNCI);
  });
});
