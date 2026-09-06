import { describe, it, expect } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql, dalamTransaksiRollback } from "./helpers/db";

const svc = createAdminSupabase();

describe("transport_khusus", () => {
  /**
   * >>> UJI INI DITULIS ULANG (7 Sep 2026) — versi asli LULUS UNTUK ALASAN
   * YANG SALAH <<<
   *
   * Draft brief menjalankan `set local role authenticated` polos (tanpa JWT)
   * lalu mengharapkan insert-nya MELEMPAR. Itu memang melempar — tetapi
   * karena RLS (`user_role()` tanpa klaim JWT bukan 'owner'), bukan karena
   * trigger `jaga_transport_khusus` yang sedang diuji. Trigger itu sendiri
   * TIDAK MENOLAK apa pun; ia MENIMPA `ditetapkan_oleh` dengan `auth.uid()`.
   * Uji versi lama akan tetap hijau seandainya trigger itu dihapus total dari
   * migrasi — kelas kegagalan paling mahal di proyek ini (bandingkan
   * `honor_marks`: identitas yang bisa dikarang, dan pemalsuannya permanen
   * karena DELETE dicabut).
   *
   * Satu-satunya jalur di mana trigger benar-benar berjalan adalah lewat REST
   * sebagai OWNER yang benar-benar login (peran SQL `authenticated` + JWT
   * owner yang membuat `user_role() = 'owner'`, sehingga RLS meloloskan
   * insert-nya dan trigger sungguh sempat dieksekusi). Uji di bawah menyisipkan
   * `ditetapkan_oleh` KARANGAN (uid admin) dan mengasersikan baris yang
   * TERSIMPAN memuat uid OWNER, bukan uid karangan itu.
   */
  it("identitas penetap DIREBUT dari payload — dibuktikan lewat owner sungguhan, bukan RLS polos", async () => {
    const { data: pengguna } = await svc.auth.admin.listUsers();
    const uidOwner = pengguna.users.find((u) => u.email === "owner@padma.test")!.id;
    const uidAdmin = pengguna.users.find((u) => u.email === "admin@padma.test")!.id;
    expect(uidOwner).toBeTruthy();
    expect(uidAdmin).toBeTruthy();

    const { data: sesi, error: eSesi } = await svc
      .from("sessions")
      .select("id")
      .limit(1)
      .single();
    expect(eSesi).toBeNull();

    const owner = await signInAs("owner@padma.test");
    try {
      const { data: baris, error } = await owner
        .from("transport_khusus")
        .insert({
          session_id: sesi!.id,
          tarif_klien: 50000,
          honor_mitra: 40000,
          ditetapkan_oleh: uidAdmin, // identitas KARANGAN — ini yang harus direbut
        })
        .select("ditetapkan_oleh")
        .single();

      expect(error).toBeNull();
      expect(baris).not.toBeNull();
      expect(baris!.ditetapkan_oleh).toBe(uidOwner);
      expect(baris!.ditetapkan_oleh).not.toBe(uidAdmin);
    } finally {
      await svc.from("transport_khusus").delete().eq("session_id", sesi!.id);
    }
  });

  it("menolak nominal negatif", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [s] = (await jalankan(`select id from public.sessions limit 1`)) as Array<{ id: string }>;
      await expect(
        jalankan(
          `insert into public.transport_khusus (session_id, tarif_klien, honor_mitra)
           values ($1, -1, 40000)`,
          [s.id],
        ),
      ).rejects.toThrow(/transport_khusus_nilai_wajar/);
    });
  });

  it("satu sesi hanya boleh punya satu tarif khusus", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [s] = (await jalankan(`select id from public.sessions limit 1`)) as Array<{ id: string }>;
      await jalankan(
        `insert into public.transport_khusus (session_id, tarif_klien, honor_mitra)
         values ($1, 50000, 40000)`,
        [s.id],
      );
      await expect(
        jalankan(
          `insert into public.transport_khusus (session_id, tarif_klien, honor_mitra)
           values ($1, 60000, 45000)`,
          [s.id],
        ),
      ).rejects.toThrow();
    });
  });

  it("anon tidak memegang hak apa pun", async () => {
    const tabel = await querySql<{ priv: string }>(
      `select p.priv from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as p(priv)
        where has_table_privilege('anon', 'public.transport_khusus'::regclass, p.priv)`,
    );
    expect(tabel).toEqual([]);
  });
});
