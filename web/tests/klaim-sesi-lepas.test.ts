/**
 * KLAIM PEMBAYARAN HANYA UNTUK SESI LEPAS — dan badge yang sinkron dengannya.
 *
 * Dua cacat yang ditutup berkas ini hidup berdampingan dan saling menutupi:
 *
 *  1. RPC `klaim_sudah_bayar` (warisan Plan 4) hanya menyaring `client_id` dan
 *     `status_bayar = 'belum'`. Ia TIDAK menyaring `client_package_id`,
 *     sedangkan spec berkata `sessions.status_bayar` hanya relevan untuk sesi
 *     LEPAS — sesi di dalam paket mengikuti status paketnya. Data seed sendiri
 *     kontradiktif (paket sudah dilunasi, tujuh sesi anggotanya tetap 'belum'),
 *     jadi klien bisa mengklaim tujuh "tagihan hantu" yang tidak pernah ia
 *     lihat di halaman Bayar — `susunTagihan()` memang membuang sesi berpaket.
 *
 *  2. `hitungAntrean().klaimMenunggu` menghitung SELURUH baris
 *     `status_bayar = 'menunggu_verifikasi'` tanpa saringan paket maupun batal.
 *     Begitu satu tagihan hantu terklaim, badge naik menjadi 1 sementara daftar
 *     yang benar tetap kosong. Itu badge yang TIDAK BISA DIBERSIHKAN admin:
 *     tidak ada baris yang bisa ia sentuh untuk memadamkannya. Karena itu
 *     saringan badge wajib IDENTIK dengan `susunTagihan()` di
 *     `@/lib/passport/turunan` — dan pagarnya ditulis di berkas yang sama
 *     dengan perbaikan RPC-nya, bukan menyusul.
 *
 * Higiene: setiap perubahan `status_bayar` menulis satu baris
 * `jejak_status_bayar`, dan tabel jejak SENGAJA tanpa foreign key (cascade akan
 * menghapus tepat bukti yang menjelaskan penghapusan). Fixture di sini karena
 * itu menyapu jejaknya sendiri — lihat tests/jejak-yatim.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const admin = createAdminSupabase();

const KLIEN = "44444444-4444-4444-4444-444444444401"; // Ananda (tertaut)
const PAKET_SEED = "55555555-5555-5555-5555-555555555501"; // paket Ananda (seed)
const PAKET_UJI = "55555555-5555-5555-5555-5555555555b1";
const SESI_PAKET = "66666666-6666-6666-6666-6666666666b1";
const SESI_LEPAS = "66666666-6666-6666-6666-6666666666b2";
const SVC_MASSAGE = "11111111-1111-1111-1111-111111111101";
const SVC_NUTRISI = "11111111-1111-1111-1111-111111111103";
const MITRA_A = "33333333-3333-3333-3333-333333333301";
const MITRA_B = "33333333-3333-3333-3333-333333333302";

// `hitungKlaimMenunggu()` memakai sesi pengguna (createServerSupabase), yang
// membaca cookies() dan hanya bermakna di dalam request scope. Seperti
// tests/admin-shell.test.ts, modulnya diganti klien Supabase ber-SESI NYATA
// sehingga hitungannya tetap melewati RLS sebagai admin yang login.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const { hitungKlaimMenunggu, hitungAntrean } = await import("@/lib/admin/antrean");

async function bersihkan() {
  await admin.from("jejak_status_bayar").delete().in("sesi_id", [SESI_PAKET, SESI_LEPAS]);
  await admin.from("jejak_status_bayar").delete().eq("paket_klien_id", PAKET_UJI);
  await admin.from("sessions").delete().in("id", [SESI_PAKET, SESI_LEPAS]);
  await admin.from("client_packages").delete().eq("id", PAKET_UJI);
}

beforeAll(async () => {
  ref.sesi = await signInAs("admin@padma.test");
});

beforeEach(async () => {
  await bersihkan();
  // Paket uji SENDIRI, bukan paket seed: mengubah status bayar paket seed akan
  // diwarisi berkas test lain (beranda, bayar) yang membacanya apa adanya.
  // Lahir berstatus 'belum' (default kolom) — trigger jejak tidak menyala.
  await admin.from("client_packages").insert({
    id: PAKET_UJI,
    client_id: KLIEN,
    package_id: "22222222-2222-2222-2222-222222222201",
    tanggal_mulai: "2026-12-01",
  });
  await admin.from("sessions").insert([
    {
      id: SESI_PAKET,
      client_id: KLIEN,
      client_package_id: PAKET_SEED,
      service_id: SVC_MASSAGE,
      partner_id: MITRA_A,
      tanggal: "2026-12-20",
      status: "terjadwal",
      status_bayar: "belum",
      catatan: "",
      rekomendasi: "",
    },
    {
      id: SESI_LEPAS,
      client_id: KLIEN,
      client_package_id: null,
      service_id: SVC_NUTRISI,
      partner_id: MITRA_B,
      tanggal: "2026-12-21",
      status: "terjadwal",
      status_bayar: "belum",
      catatan: "",
      rekomendasi: "",
    },
  ]);
});

afterAll(bersihkan);

async function statusBayarSesi(id: string): Promise<string> {
  const { data } = await admin.from("sessions").select("status_bayar").eq("id", id).single();
  return data!.status_bayar as string;
}

describe("klaim pembayaran hanya untuk sesi lepas", () => {
  it("klien TIDAK bisa mengklaim sesi yang sudah tercakup paket", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data, error } = await k.rpc("klaim_sudah_bayar", {
      jenis: "sesi",
      sasaran_id: SESI_PAKET,
    });
    // Ditahan oleh filter di dalam fungsi, bukan lemparan: "tidak ada yang
    // cocok" adalah jawaban yang benar, bukan kegagalan sistem.
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
    expect(await statusBayarSesi(SESI_PAKET)).toBe("belum");
  });

  it("klaim sesi berpaket tidak menulis jejak audit apa pun", async () => {
    const k = await signInAs("ananda@padma.test");
    await k.rpc("klaim_sudah_bayar", { jenis: "sesi", sasaran_id: SESI_PAKET });
    const { count } = await admin
      .from("jejak_status_bayar")
      .select("*", { count: "exact", head: true })
      .eq("sesi_id", SESI_PAKET);
    expect(count).toBe(0);
  });

  it("klien BISA mengklaim sesi lepas (alur sah tidak rusak)", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data, error } = await k.rpc("klaim_sudah_bayar", {
      jenis: "sesi",
      sasaran_id: SESI_LEPAS,
    });
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
    expect(await statusBayarSesi(SESI_LEPAS)).toBe("menunggu_verifikasi");
  });

  it("sesi lepas yang sudah BATAL tidak bisa diklaim", async () => {
    await admin.from("sessions").update({ status: "batal" }).eq("id", SESI_LEPAS);
    const k = await signInAs("ananda@padma.test");
    const { data } = await k.rpc("klaim_sudah_bayar", {
      jenis: "sesi",
      sasaran_id: SESI_LEPAS,
    });
    expect(data ?? []).toHaveLength(0);
    expect(await statusBayarSesi(SESI_LEPAS)).toBe("belum");
  });

  it("klien BISA mengklaim paket aktif", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data, error } = await k.rpc("klaim_sudah_bayar", {
      jenis: "paket",
      sasaran_id: PAKET_UJI,
    });
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
    const { data: cek } = await admin
      .from("client_packages")
      .select("status_bayar")
      .eq("id", PAKET_UJI)
      .single();
    expect(cek!.status_bayar).toBe("menunggu_verifikasi");
  });

  it("paket yang tidak lagi aktif tidak bisa diklaim (tidak pernah tampil di daftar klien)", async () => {
    // `ambilPaket()` menyaring `status = 'aktif'`, jadi paket selesai tidak
    // pernah muncul di halaman Bayar. Bila RPC tetap menerimanya, klaimnya
    // melahirkan badge yang tidak punya baris untuk dibersihkan.
    await admin.from("client_packages").update({ status: "selesai" }).eq("id", PAKET_UJI);
    const k = await signInAs("ananda@padma.test");
    const { data } = await k.rpc("klaim_sudah_bayar", {
      jenis: "paket",
      sasaran_id: PAKET_UJI,
    });
    expect(data ?? []).toHaveLength(0);
    const { data: cek } = await admin
      .from("client_packages")
      .select("status_bayar")
      .eq("id", PAKET_UJI)
      .single();
    expect(cek!.status_bayar).toBe("belum");
  });
});

describe("badge antrean sinkron dengan daftar", () => {
  it("mengklaim sesi berpaket TIDAK menaikkan badge klaimMenunggu", async () => {
    const sebelum = await hitungKlaimMenunggu();

    // Dipaksa lewat service role (menembus RPC) untuk meniru data lama yang
    // terlanjur ada sebelum perbaikan — badge yang tidak bisa dibersihkan.
    await admin
      .from("sessions")
      .update({ status_bayar: "menunggu_verifikasi" })
      .eq("id", SESI_PAKET);

    expect(await hitungKlaimMenunggu()).toBe(sebelum); // sesi berpaket bukan tagihan
  });

  it("mengklaim sesi lepas menaikkan badge tepat satu", async () => {
    const sebelum = await hitungKlaimMenunggu();
    await admin
      .from("sessions")
      .update({ status_bayar: "menunggu_verifikasi" })
      .eq("id", SESI_LEPAS);
    expect(await hitungKlaimMenunggu()).toBe(sebelum + 1);
  });

  it("sesi BATAL tidak pernah masuk hitungan", async () => {
    const sebelum = await hitungKlaimMenunggu();
    await admin
      .from("sessions")
      .update({ status: "batal", status_bayar: "menunggu_verifikasi" })
      .eq("id", SESI_LEPAS);
    expect(await hitungKlaimMenunggu()).toBe(sebelum);
  });

  it("paket yang tidak lagi aktif tidak masuk hitungan", async () => {
    const sebelum = await hitungKlaimMenunggu();
    await admin
      .from("client_packages")
      .update({ status: "selesai", status_bayar: "menunggu_verifikasi" })
      .eq("id", PAKET_UJI);
    expect(await hitungKlaimMenunggu()).toBe(sebelum);
  });

  it("paket aktif yang menunggu verifikasi masuk hitungan", async () => {
    const sebelum = await hitungKlaimMenunggu();
    await admin
      .from("client_packages")
      .update({ status_bayar: "menunggu_verifikasi" })
      .eq("id", PAKET_UJI);
    expect(await hitungKlaimMenunggu()).toBe(sebelum + 1);
  });

  it("hitungAntrean().klaimMenunggu memakai hitungan yang sama, bukan salinannya", async () => {
    // Bila dashboard dan badge menghitung sendiri-sendiri, keduanya akan
    // berpisah diam-diam pada perubahan saringan berikutnya.
    await admin
      .from("sessions")
      .update({ status_bayar: "menunggu_verifikasi" })
      .eq("id", SESI_LEPAS);
    await admin
      .from("sessions")
      .update({ status_bayar: "menunggu_verifikasi" })
      .eq("id", SESI_PAKET);
    const antrean = await hitungAntrean();
    expect(antrean.klaimMenunggu).toBe(await hitungKlaimMenunggu());
  });
});
