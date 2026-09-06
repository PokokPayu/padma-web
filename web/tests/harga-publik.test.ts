import { describe, it, expect } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { anonClient } from "./helpers/as-user";
import { querySql } from "./helpers/db";

/**
 * Batas kerahasiaan harga publik adalah DAFTAR KOLOM view ini.
 *
 * Karena itu daftarnya dikunci sebagai assertion, bukan sekadar dipercayakan
 * pada niat: menambahkan `honor_mitra` ke proyeksi adalah satu baris ketikan,
 * dan tanpa uji ini ia lolos tanpa satu pun assertion berubah merah.
 */
describe("view harga_publik", () => {
  it("kolomnya PERSIS empat — honor_mitra tidak ada", async () => {
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'harga_publik'
        order by ordinal_position`,
    );
    expect(kolom.map((k) => k.column_name)).toEqual([
      "variant_id",
      "harga_klien",
      "harga_coret",
      "berlaku_sejak",
    ]);
  });

  it("anon boleh membacanya, dan mendapat baris", async () => {
    const { data, error } = await anonClient().from("harga_publik").select("variant_id").limit(1);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("anon tetap tidak bisa menyentuh variant_rates langsung", async () => {
    const { error } = await anonClient().from("variant_rates").select("harga_klien").limit(1);
    expect(error?.code).toBe("42501");
  });

  it("tarif yang belum berlaku tidak bocor ke pengunjung", async () => {
    const svc = createAdminSupabase();
    const { data: varian } = await svc.from("service_variants").select("id").limit(1);
    const variantId = varian![0].id as string;

    // Kalender uji ini WAJIB kalender Jakarta yang SAMA dengan yang dipakai
    // view (`(now() at time zone 'Asia/Jakarta')::date`) — bukan
    // `new Date(...).toISOString()`, yang membaca kalender UTC. Pada jam UTC
    // >= 17:00 (pukul 00:00–06:59 WIB), "besok" versi UTC sudah SAMA dengan
    // hari ini versi Jakarta, sehingga baris yang seharusnya "belum berlaku"
    // ternyata sudah berlaku menurut view dan uji ini gagal 7 jam setiap
    // hari — persis jendela waktu yang jadi alasan klausa Jakarta itu ada.
    // `Intl.DateTimeFormat("en-CA", ...)` memulangkan `YYYY-MM-DD` langsung
    // dalam zona waktu yang diminta, tanpa perlu aritmetika tanggal manual.
    const formatJakarta = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });
    const besok = formatJakarta.format(new Date(Date.now() + 86_400_000));

    const { data: sisip, error: sisipError } = await svc
      .from("variant_rates")
      .insert({
        variant_id: variantId,
        harga_klien: 12_345_678,
        honor_mitra: 0,
        berlaku_sejak: besok,
      })
      .select("id")
      .single();
    expect(sisipError).toBeNull();

    let hasilBocor: number[] = [];
    let hapusError: { message: string } | null = null;
    try {
      const { data } = await anonClient()
        .from("harga_publik")
        .select("harga_klien")
        .eq("variant_id", variantId);
      hasilBocor = (data ?? []).map((b) => b.harga_klien);
    } finally {
      // Baris masa depan ini disisipkan lewat service role di luar transaksi
      // uji manapun. Tanpa pembersihan, ia bertahan di database bersama dan
      // meracuni uji lain dalam proses vitest yang sama: baris KEDUA untuk
      // varian yang sama membuat `guard_tarif_varian_maju` (yang menyaring
      // baris SELAIN yang sedang ditulis) bereaksi berbeda pada UPDATE tanpa
      // filter di tests/varian-tarif-pengerasan.test.ts, menutupi pesan
      // "append-only" yang seharusnya diuji di sana dengan pesan "harus
      // berlaku sesudah" milik guard yang lain.
      //
      // supabase-js tidak MELEMPAR pada kegagalan delete — errornya hanya
      // muncul di `error` hasil panggilan. Errornya ditangkap di sini lalu
      // diasersikan SESUDAH blok try/finally (bukan di dalamnya), supaya
      // kegagalan pembersihan tidak diam-diam menutupi assertion `hasilBocor`
      // di atas bila keduanya sama-sama gagal.
      const hasil = await svc.from("variant_rates").delete().eq("id", sisip!.id);
      hapusError = hasil.error;
    }
    expect(hasilBocor).not.toContain(12_345_678);
    expect(hapusError, "pembersihan baris racun gagal senyap").toBeNull();
  });
});
