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

    // MINOR 1 (coordinator): bersihkan SEBELUM insert juga, bukan hanya di
    // `finally`. Bila proses terhenti di tengah (crash, timeout), baris sisa
    // dari jalan sebelumnya akan bentrok primary key di jalan ini dan
    // membuatnya merah — pola "fixture yang meracuni jalan berikutnya" sudah
    // dua kali memakan waktu di proyek ini.
    await svc.from("transport_khusus").delete().eq("session_id", sesi!.id);

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

  /**
   * >>> Ruling 5 (coordinator, 7 Sep 2026) <<<
   *
   * Ditemukan lewat self-review empiris: `transport_khusus` memberi UPDATE
   * kepada `authenticated` tapi hanya punya trigger perebut identitas saat
   * INSERT — tanpa pengunci gaya `kunci_tanda_honor`, owner bisa menulis
   * ulang `ditetapkan_oleh` (atau nominal) sesudah baris berdiri. Ini PERSIS
   * temuan B5b (lihat 20260830150000_pengerasan_tabel_uang.sql bagian 7):
   * "Merebut kolom pada INSERT tidak ada gunanya bila baris yang sudah
   * berdiri masih bisa ditimpa sesudahnya."
   *
   * Pola uji ini SAMA dengan kontrol A5/A6 di tests/hak-hapus-berlebih.test.ts
   * ("KONTROL: owner TETAP bisa membaca & menandai honor; MENIMPA tanda
   * ditolak"): dua asersi, bukan satu — UPDATE ditolak 42501 LEWAT REST
   * SEBAGAI OWNER SUNGGUHAN, DAN baris yang tersimpan tidak berubah sesudahnya
   * (dibaca lewat service role, yang tidak tersentuh trigger kunci).
   */
  it("UPDATE ditolak untuk peran API, dan barisnya tidak berubah — menutup temuan B5b", async () => {
    const { data: sesi, error: eSesi } = await svc
      .from("sessions")
      .select("id")
      .limit(1)
      .single();
    expect(eSesi).toBeNull();

    // MINOR 1 (coordinator): sama seperti uji identitas di atas — bersihkan
    // SEBELUM insert juga, bukan hanya di `finally`.
    await svc.from("transport_khusus").delete().eq("session_id", sesi!.id);

    const owner = await signInAs("owner@padma.test");

    const { data: baris, error: eIns } = await owner
      .from("transport_khusus")
      .insert({ session_id: sesi!.id, tarif_klien: 50000, honor_mitra: 40000 })
      .select("tarif_klien, honor_mitra, ditetapkan_oleh")
      .single();
    expect(eIns).toBeNull();

    try {
      const { error: eUbah } = await owner
        .from("transport_khusus")
        .update({ tarif_klien: 999999 })
        .eq("session_id", sesi!.id)
        .select("tarif_klien");
      expect(eUbah?.code).toBe("42501");

      const { data: sesudah, error: eBaca } = await svc
        .from("transport_khusus")
        .select("tarif_klien, honor_mitra, ditetapkan_oleh")
        .eq("session_id", sesi!.id)
        .single();
      expect(eBaca).toBeNull();
      expect(sesudah!.tarif_klien).toBe(50000);
      expect(sesudah!.honor_mitra).toBe(40000);
      expect(sesudah!.ditetapkan_oleh).toBe(baris!.ditetapkan_oleh);
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
