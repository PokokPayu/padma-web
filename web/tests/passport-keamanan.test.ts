import { describe, it, expect, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

/**
 * PENJAGA PRA-PASSPORT.
 *
 * Celah yang ditutup file ini SUDAH TERREPRODUKSI: policy
 * "booking: klien ajukan" hanya memeriksa KEPEMILIKAN (client_id milik saya),
 * tidak NILAI. Klien menyisipkan barisnya sendiri dengan status='dikonfirmasi'
 * dan berhasil (HTTP 201) — permintaan itu lenyap dari antrean admin sambil
 * tampil "dikonfirmasi" di passport. Bentuk masalah yang sama dengan
 * profiles.role dan clients.user_id, jadi obatnya sama: trigger yang mengikat
 * NILAI, bukan hak tabel.
 *
 * Catatan PostgREST: UPDATE yang tertahan RLS dijawab HTTP 200 + [] (bukan
 * 403), jadi meng-assert "0 baris" saja tidak membuktikan apa pun — nilainya
 * WAJIB dibaca ulang dengan service role.
 */

const admin = createAdminSupabase();
const SVC = "11111111-1111-1111-1111-111111111101";
const bersihkan: string[] = [];

afterAll(async () => {
  if (bersihkan.length) await admin.from("booking_requests").delete().in("id", bersihkan);
  // Baris uji duplikat hanya lolos SEBELUM unique index ada (saat test ini
  // sengaja MERAH). Dibersihkan supaya tidak mencemari
  // tests/rls-firewall.test.ts yang meng-assert Ananda tepat 1 baris clients.
  await admin.from("clients").delete().eq("padma_id", "PAD-UJI-DUP1");
});

async function klienDanId() {
  const k = await signInAs("ananda@padma.test");
  const { data } = await k.from("clients").select("id").single();
  return { k, clientId: data!.id as string };
}

describe("penjaga booking_requests", () => {
  it("klien TIDAK bisa menyisipkan permintaan berstatus dikonfirmasi", async () => {
    const { k, clientId } = await klienDanId();
    const { data, error } = await k.from("booking_requests").insert({
      client_id: clientId, service_id: SVC, tanggal: "2026-09-10",
      preferensi_waktu: "pagi", status: "dikonfirmasi",
    }).select();
    if (data?.[0]) bersihkan.push(data[0].id);
    expect(error?.code).toBe("42501");
  });

  it("klien TIDAK bisa mengubah status permintaannya sendiri", async () => {
    const { k, clientId } = await klienDanId();
    const { data: baru } = await admin.from("booking_requests").insert({
      client_id: clientId, service_id: SVC, tanggal: "2026-09-11",
      preferensi_waktu: "sore", status: "menunggu",
    }).select("id").single();
    bersihkan.push(baru!.id);

    const { data: ubah } = await k.from("booking_requests")
      .update({ status: "dikonfirmasi" }).eq("id", baru!.id).select();
    expect(ubah ?? []).toHaveLength(0);

    // PostgREST menjawab 200 + [] untuk update yang tertahan — baca ulang nilainya.
    const { data: cek } = await admin.from("booking_requests")
      .select("status").eq("id", baru!.id).single();
    expect(cek!.status).toBe("menunggu");
  });

  it("klien BOLEH menyisipkan permintaan berstatus menunggu (alur sah)", async () => {
    const { k, clientId } = await klienDanId();
    const { data, error } = await k.from("booking_requests").insert({
      client_id: clientId, service_id: SVC, tanggal: "2026-09-12",
      preferensi_waktu: "pagi", status: "menunggu",
    }).select("id");
    expect(error).toBeNull();
    if (data?.[0]) bersihkan.push(data[0].id);
  });

  it("staf tetap bisa mengonfirmasi permintaan", async () => {
    const { clientId } = await klienDanId();
    const { data: baru } = await admin.from("booking_requests").insert({
      client_id: clientId, service_id: SVC, tanggal: "2026-09-13",
      preferensi_waktu: "siang", status: "menunggu",
    }).select("id").single();
    bersihkan.push(baru!.id);

    const a = await signInAs("admin@padma.test");
    const { data: ubah } = await a.from("booking_requests")
      .update({ status: "dikonfirmasi" }).eq("id", baru!.id).select();
    expect(ubah).toHaveLength(1);
  });
});

describe("nama mitra untuk klien", () => {
  it("klien TIDAK bisa membaca tabel partners langsung (no_hp tertutup)", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data } = await k.from("partners").select("nama, no_hp");
    expect(data ?? []).toHaveLength(0);
  });

  it("klien BISA membaca nama mitra lewat partner_publik, tanpa no_hp", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data, error } = await k.from("partner_publik").select("*");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(data![0])).toEqual(expect.arrayContaining(["id", "nama"]));
    expect(Object.keys(data![0])).not.toContain("no_hp");
  });
});

describe("invarian satu akun ↔ satu klien", () => {
  it("clients.user_id unik (mencegah satu user menempel ke dua klien)", async () => {
    const { data: ananda } = await admin.from("clients")
      .select("user_id").eq("padma_id", "PAD-2607-0012").single();
    const { error } = await admin.from("clients").insert({
      padma_id: "PAD-UJI-DUP1", nama: "Duplikat", email: "dup@padma.test",
      phase_id: "prekonsepsi", user_id: ananda!.user_id,
    });
    expect(error?.code).toBe("23505");
  });
});
