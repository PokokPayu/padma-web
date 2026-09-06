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
 * Keduanya ditutup dengan SARINGAN, dan saringan yang sama disalin ke tiga
 * berkas. Karena itu blok terakhir berkas ini mengunci lapis ketiga yang
 * membuat salinan-salinan itu tidak bisa berpisah diam-diam: constraint
 * `sessions_bayar_hanya_lepas`, yang mengubah "sesi berpaket berstatus bayar"
 * dari keadaan-yang-disaring menjadi keadaan-yang-tidak-bisa-ada.
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
import { varianBaku } from "./helpers/varian";

const admin = createAdminSupabase();

const KLIEN = "44444444-4444-4444-4444-444444444401"; // Ananda (tertaut)
const PAKET_SEED = "55555555-5555-5555-5555-555555555501"; // paket Ananda (seed)
const PAKET_UJI = "55555555-5555-5555-5555-5555555555b1";
const SESI_PAKET = "66666666-6666-6666-6666-6666666666b1";
const SESI_LEPAS = "66666666-6666-6666-6666-6666666666b2";
const SESI_LAHIR = "66666666-6666-6666-6666-6666666666b3";
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
  await admin
    .from("jejak_status_bayar")
    .delete()
    .in("sesi_id", [SESI_PAKET, SESI_LEPAS, SESI_LAHIR]);
  await admin.from("jejak_status_bayar").delete().eq("paket_klien_id", PAKET_UJI);
  await admin.from("sessions").delete().in("id", [SESI_PAKET, SESI_LEPAS, SESI_LAHIR]);
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
      variant_id: await varianBaku(admin, SVC_MASSAGE),
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
      variant_id: await varianBaku(admin, SVC_NUTRISI),
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
  it("keadaan 'sesi berpaket menunggu verifikasi' tidak bisa lagi dipaksakan sama sekali", async () => {
    // Semula test ini memaksa keadaannya lewat service role (menembus RPC) lalu
    // membuktikan saringan badge membuangnya. Sejak constraint
    // `sessions_bayar_hanya_lepas`, pemaksaan itu SENDIRI ditolak database —
    // jadi assertion diperkuat, bukan dilonggarkan: yang dibuktikan bukan lagi
    // "badge menyaringnya", melainkan "keadaannya tidak bisa lahir".
    //
    // Assertion lama tetap dipertahankan di baris terakhir. Tanpa itu, seorang
    // yang kelak mencabut saringan `client_package_id is null` dari
    // `hitungKlaimMenunggu()` tidak akan melihat satu pun test merah selama
    // constraint masih berdiri — dan saringan itu adalah lapis yang menjaga
    // badge tetap sama dengan daftar `/admin/bayar`.
    const sebelum = await hitungKlaimMenunggu();

    const { error } = await admin
      .from("sessions")
      .update({ status_bayar: "menunggu_verifikasi" })
      .eq("id", SESI_PAKET);
    expect(error?.code).toBe("23514");

    expect(await statusBayarSesi(SESI_PAKET)).toBe("belum");
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
    // Dua sasaran sekaligus (sesi lepas + paket aktif) supaya kedua cabang
    // hitungan ikut terbukti, bukan hanya salah satunya.
    // Bila dashboard dan badge menghitung sendiri-sendiri, keduanya akan
    // berpisah diam-diam pada perubahan saringan berikutnya.
    await admin
      .from("sessions")
      .update({ status_bayar: "menunggu_verifikasi" })
      .eq("id", SESI_LEPAS);
    await admin
      .from("client_packages")
      .update({ status_bayar: "menunggu_verifikasi" })
      .eq("id", PAKET_UJI);
    const antrean = await hitungAntrean();
    expect(antrean.klaimMenunggu).toBe(await hitungKlaimMenunggu());
  });
});

// ---------------------------------------------------------------------------
// CONSTRAINT STRUKTURAL
// ---------------------------------------------------------------------------
/**
 * Saringan `client_package_id is null` di RPC klaim, di `susunTagihan()`, dan
 * di `hitungKlaimMenunggu()` semuanya menjawab pertanyaan yang sama: "sesi
 * berpaket tidak memikul status pembayaran sendiri". Tiga salinan aturan di
 * tiga berkas adalah tiga kesempatan untuk berpisah diam-diam.
 *
 * `sessions_bayar_hanya_lepas` memindahkan aturannya ke tempat yang tidak bisa
 * dilewati siapa pun — termasuk service role, termasuk SECURITY DEFINER,
 * termasuk psql. Sejak itu, "sesi berpaket berstatus menunggu_verifikasi"
 * bukan lagi keadaan yang disaring, melainkan keadaan yang TIDAK ADA.
 *
 * URUTAN: constraint ini sengaja lahir SESUDAH perbaikan RPC klaim. Bila
 * dibalik, RPC melempar 23514 -> PostgREST 400 -> klien membaca "Gagal
 * memproses" padahal jawaban yang benar adalah "item ini memang bukan tagihan".
 * Test "klien TIDAK bisa mengklaim sesi yang sudah tercakup paket" di atas
 * menguncinya: ia meng-assert `error` NULL, bukan sekadar 0 baris.
 */
describe("constraint sesi berpaket tidak memikul status pembayaran", () => {
  it("service role sekalipun tidak bisa menyetel status_bayar pada sesi berpaket", async () => {
    const { error } = await admin
      .from("sessions")
      .update({ status_bayar: "menunggu_verifikasi" })
      .eq("id", SESI_PAKET);
    expect(error?.code).toBe("23514"); // pelanggaran CHECK
    expect(await statusBayarSesi(SESI_PAKET)).toBe("belum");
  });

  it("'lunas' pun tertutup — sesi berpaket mengikuti status paketnya, titik", async () => {
    const { error } = await admin
      .from("sessions")
      .update({ status_bayar: "lunas" })
      .eq("id", SESI_PAKET);
    expect(error?.code).toBe("23514");
    expect(await statusBayarSesi(SESI_PAKET)).toBe("belum");
  });

  it("sesi berpaket TIDAK bisa LAHIR membawa status bayar", async () => {
    // Trigger `guard_insert_status_bayar` hanya menjaga peran API; CHECK
    // berlaku untuk semua, termasuk jalur seed/migrasi data.
    const { error } = await admin.from("sessions").insert({
      id: SESI_LAHIR,
      client_id: KLIEN,
      client_package_id: PAKET_UJI,
      service_id: SVC_MASSAGE,
      variant_id: await varianBaku(admin, SVC_MASSAGE),
      partner_id: MITRA_A,
      tanggal: "2026-12-22",
      status: "terjadwal",
      status_bayar: "lunas",
      catatan: "",
      rekomendasi: "",
    });
    expect(error?.code).toBe("23514");
    const { data } = await admin.from("sessions").select("id").eq("id", SESI_LAHIR).maybeSingle();
    expect(data).toBeNull();
  });

  it("memindahkan sesi lepas berstatus bayar ke dalam paket ditolak", async () => {
    // Pintu belakang yang tersisa bila constraint hanya menjaga status_bayar:
    // bayar dulu sebagai sesi lepas, baru dimasukkan ke paket.
    const { error: eBayar } = await admin
      .from("sessions")
      .update({ status_bayar: "lunas" })
      .eq("id", SESI_LEPAS);
    expect(eBayar).toBeNull();

    const { error } = await admin
      .from("sessions")
      .update({ client_package_id: PAKET_UJI })
      .eq("id", SESI_LEPAS);
    expect(error?.code).toBe("23514");

    const { data } = await admin
      .from("sessions")
      .select("client_package_id")
      .eq("id", SESI_LEPAS)
      .single();
    expect(data!.client_package_id).toBeNull();
  });

  it("sesi lepas yang BELUM dibayar tetap boleh dimasukkan ke paket (alur sah hidup)", async () => {
    const { error } = await admin
      .from("sessions")
      .update({ client_package_id: PAKET_UJI })
      .eq("id", SESI_LEPAS);
    expect(error).toBeNull();
    const { data } = await admin
      .from("sessions")
      .select("client_package_id")
      .eq("id", SESI_LEPAS)
      .single();
    expect(data!.client_package_id).toBe(PAKET_UJI);
  });
});
