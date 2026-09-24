/**
 * JEJAK "SUDAH DIBUKA KLIEN" (butir 6, umpan balik klien 21 Sep 2026)
 * ---------------------------------------------------------------------------
 * "Cara tahu e book sdh diterima klien gimana?"
 *
 * Diukur di basis data produksi 22 Sep 2026: `material_assignments` mencatat
 * siapa DITUGASKAN materi apa (7 baris), tetapi TIDAK ADA satu pun tabel yang
 * mencatat apakah materinya pernah dibuka. Sistem memang tidak tahu — jadi ini
 * fitur baru, bukan kerusakan.
 *
 * Bentuknya RPC `security definer`, BUKAN hak tulis langsung ke tabel bagi
 * klien. Alasannya: "sudah diterima" adalah pernyataan yang dibaca pemilik
 * klinik untuk memutuskan apakah pekerjaannya selesai. Kalau klien memegang
 * INSERT/UPDATE atas tabelnya, stempel waktu dan hitungannya bisa dikarang
 * lewat REST tanpa menyentuh layar mana pun — dan yang dikarang tidak bisa
 * dibedakan dari yang sungguhan. RPC menutup seluruh kelas itu: klien tidak
 * punya hak apa pun atas tabelnya, dan satu-satunya jalan masuk memeriksa
 * `berhak_isi_materi()` lebih dulu.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const admin = createAdminSupabase();

// Lapisan panel admin memakai sesi pengguna (`createServerSupabase`). Di vitest
// tidak ada cookie, jadi klien ber-SESI SUNGGUHAN disuntikkan: RLS tetap
// berjalan apa adanya, persis seperti di server.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const KLIEN = "44444444-4444-4444-4444-444444444401"; // Ananda
const MATERI = "77777777-7777-7777-7777-77777777ab01";
const MATERI_TAK_BERHAK = "77777777-7777-7777-7777-77777777ab02";

let sesiKlien: SupabaseClient;
let sesiAdmin: SupabaseClient;

async function bersihkan() {
  await admin.from("material_opens").delete().in("material_id", [MATERI, MATERI_TAK_BERHAK]);
  await admin.from("material_assignments").delete().in("material_id", [MATERI, MATERI_TAK_BERHAK]);
  await admin.from("materials").delete().in("id", [MATERI, MATERI_TAK_BERHAK]);
}

beforeAll(async () => {
  sesiKlien = await signInAs("ananda@padma.test");
  sesiAdmin = await signInAs("admin@padma.test");
  await bersihkan();

  await admin.from("materials").insert([
    { id: MATERI, judul: "PAD-UJI Ebook Jejak", tipe: "ebook", deskripsi: "", aktif: true },
    { id: MATERI_TAK_BERHAK, judul: "PAD-UJI Ebook Tertutup", tipe: "ebook", deskripsi: "", aktif: true },
  ]);

  // Hanya MATERI yang ditugaskan, dan hanya kepada Ananda.
  const { data: profilAdmin } = await admin
    .from("profiles").select("id").eq("role", "admin").limit(1).single<{ id: string }>();
  await admin.from("material_assignments").insert({
    material_id: MATERI,
    client_id: KLIEN,
    ditugaskan_oleh: profilAdmin!.id,
  });
});

afterAll(bersihkan);

describe("catat_buka_materi — jalan masuk satu-satunya", () => {
  it("klien yang BERHAK melahirkan satu baris jejak", async () => {
    const { error } = await sesiKlien.rpc("catat_buka_materi", { p_material_id: MATERI });
    expect(error).toBeNull();

    const { data } = await admin
      .from("material_opens")
      .select("material_id, client_id, jumlah, dibuka_pertama, dibuka_terakhir")
      .eq("material_id", MATERI);
    expect(data).toHaveLength(1);
    expect(data![0].client_id).toBe(KLIEN);
    expect(data![0].jumlah).toBe(1);
    expect(data![0].dibuka_pertama).not.toBeNull();
  });

  it("membuka DUA KALI menaikkan hitungan, bukan melahirkan baris kedua", async () => {
    await sesiKlien.rpc("catat_buka_materi", { p_material_id: MATERI });
    const { data } = await admin
      .from("material_opens")
      .select("jumlah, dibuka_pertama, dibuka_terakhir")
      .eq("material_id", MATERI);
    expect(data).toHaveLength(1);
    expect(data![0].jumlah).toBeGreaterThanOrEqual(2);
    // `dibuka_pertama` adalah FAKTA yang tidak boleh ditulis ulang: ia jawaban
    // atas "kapan klien menerimanya". Hanya `dibuka_terakhir` yang bergerak.
    expect(Date.parse(data![0].dibuka_terakhir)).toBeGreaterThanOrEqual(
      Date.parse(data![0].dibuka_pertama),
    );
  });

  it("materi yang TIDAK berhak dibuka klien ini tidak melahirkan jejak apa pun", async () => {
    // Bukan sekadar "tidak sopan": jejak buka atas materi yang tidak pernah
    // bisa dilihat adalah bukti PALSU bahwa pekerjaan sudah sampai ke klien.
    // MATERI_TAK_BERHAK aktif, tetapi tidak ditugaskan kepada siapa pun dan
    // tidak tertaut layanan mana pun — `berhak_isi_materi()` menjawab tidak.
    await sesiKlien.rpc("catat_buka_materi", { p_material_id: MATERI_TAK_BERHAK });
    const { data: tertutup } = await admin
      .from("material_opens").select("material_id").eq("material_id", MATERI_TAK_BERHAK);
    expect(tertutup ?? []).toHaveLength(0);
  });
});

describe("material_opens — hak tabel", () => {
  it("klien TIDAK bisa membaca tabelnya sama sekali", async () => {
    const { data } = await sesiKlien.from("material_opens").select("material_id");
    expect(data ?? []).toHaveLength(0);
  });

  it("klien TIDAK bisa menulis langsung — stempelnya tidak boleh dikarang", async () => {
    const { error } = await sesiKlien.from("material_opens").insert({
      material_id: MATERI,
      client_id: KLIEN,
      jumlah: 999,
      dibuka_pertama: "1999-01-01T00:00:00Z",
    });
    expect(error).not.toBeNull();
    const { data } = await admin
      .from("material_opens").select("jumlah").eq("material_id", MATERI).single();
    expect(data!.jumlah).toBeLessThan(999);
  });

  it("staf BISA membacanya — tanpa itu jejak ini tidak menjawab siapa pun", async () => {
    const { data } = await sesiAdmin
      .from("material_opens").select("material_id").eq("material_id", MATERI);
    expect(data ?? []).toHaveLength(1);
  });
});

describe("angka jejak sampai ke panel admin", () => {
  it("baris materi membawa jumlah DITUGASKAN dan jumlah DIBUKA", async () => {
    // Inilah yang dibaca pemilik klinik untuk menjawab pertanyaannya sendiri:
    // "ditugaskan 1 · dibuka 1" berarti sampai; "ditugaskan 4 · dibuka 0"
    // berarti belum, dan itu pekerjaan — bukan kabar.
    const { ambilDaftarMateri } = await import("@/lib/admin/materi-admin");
    ref.sesi = sesiAdmin;
    const { baris } = await ambilDaftarMateri({ cari: "PAD-UJI Ebook Jejak", saring: {}, hal: 1 });
    const materi = baris.find((b) => b.id === MATERI);
    expect(materi, "materi fixture wajib muncul di daftar admin").toBeDefined();
    expect(materi!.jumlahDitugaskan).toBe(1);
    expect(materi!.jumlahDibuka).toBe(1);
  });

  it("materi tanpa penugasan & tanpa jejak membawa NOL, bukan undefined", async () => {
    // Nol dan "tidak ada datanya" terlihat sama di layar kalau yang kedua
    // dibiarkan undefined — dan yang pertama adalah pekerjaan yang belum
    // dilakukan, sementara yang kedua adalah kerusakan.
    const { ambilDaftarMateri } = await import("@/lib/admin/materi-admin");
    ref.sesi = sesiAdmin;
    const { baris } = await ambilDaftarMateri({ cari: "PAD-UJI Ebook Tertutup", saring: {}, hal: 1 });
    const materi = baris.find((b) => b.id === MATERI_TAK_BERHAK);
    expect(materi).toBeDefined();
    expect(materi!.jumlahDitugaskan).toBe(0);
    expect(materi!.jumlahDibuka).toBe(0);
  });
});
