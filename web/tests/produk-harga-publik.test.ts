import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";
import { anonClient, signInAs } from "./helpers/as-user";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * Batas kerahasiaan harga produk adalah DAFTAR KOLOM kedua view ini — sama
 * persis dengan yang dijaga `tests/harga-publik.test.ts` untuk `harga_publik`.
 * Daftarnya dikunci sebagai assertion karena menambah kolom ke proyeksi view
 * adalah satu baris ketikan yang tidak memerahkan apa pun.
 */
describe("harga produk digital", () => {
  it("harga_produk_publik berkolom PERSIS empat", async () => {
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'harga_produk_publik'
        order by ordinal_position`,
    );
    expect(kolom.map((k) => k.column_name)).toEqual([
      "product_id", "harga", "harga_coret", "berlaku_sejak",
    ]);
  });

  it("anon boleh membaca view, tapi TIDAK tabel dasarnya", async () => {
    const { error: viewErr } = await anonClient()
      .from("harga_produk_publik").select("product_id").limit(1);
    expect(viewErr).toBeNull();

    const { error: tabelErr } = await anonClient()
      .from("digital_product_prices").select("harga").limit(1);
    expect(tabelErr?.code).toBe("42501");
  });

  /**
   * Sampai Task 7, SELURUH hak tabel `digital_product_prices` tercabut dari
   * `authenticated` — klien login pun berhenti di 42501 GRANT, sama seperti
   * anon. Migration `20260921140000_produk_harga_grant.sql` membuka
   * `select, insert` kepada `authenticated` supaya OWNER bisa menetapkan
   * harga lewat sesinya sendiri (dibuktikan empiris: tanpa grant itu, INSERT
   * owner sungguhan berhenti 42501 juga). RLS-nya sudah berdiri sejak Task 2
   * ("harga produk: owner sisip"/"owner baca", keduanya `user_role() =
   * 'owner'"), jadi klien sekarang LOLOS ke lapis RLS dan berhenti DI SANA —
   * pola yang identik dengan `variant_rates` (lihat
   * "admin TETAP dijawab 0 baris oleh RLS..." &
   * "admin yang menyisipkan tarif langsung ... ditolak RLS" di
   * `tests/owner-tarif.test.ts`). "0 baris karena RLS" dan "ditolak karena
   * grant" tetap dua kegagalan berbeda — hanya saja sekarang klien mengalami
   * yang PERTAMA, bukan yang kedua, dan dua uji di bawah memeriksa keduanya
   * secara eksplisit alih-alih menganggap "tidak error" sudah cukup.
   */
  it("klien TETAP dijawab 0 baris oleh RLS bahkan lewat REST langsung", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { error, data } = await klien.from("digital_product_prices").select("harga").limit(1);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("klien yang menyisipkan harga langsung lewat REST ditolak RLS", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Uji klien insert", slug: "uji-klien-insert-harga", jenis: "pdf" })
      .select("id").single();

    const klien = await signInAs("ananda@padma.test");
    const { error } = await klien.from("digital_product_prices")
      .insert({ product_id: produk!.id, harga: 1 });
    expect(error?.code).toBe("42501");

    await svc.from("digital_products").delete().eq("id", produk!.id);
  });

  it("harga yang belum berlaku tidak bocor ke pengunjung", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Uji harga", slug: "uji-harga-masa-depan", jenis: "pdf", aktif: true })
      .select("id").single();

    // Kalender JAKARTA, bukan UTC — view memakai `(now() at time zone
    // 'Asia/Jakarta')::date`, dan pada 00:00-06:59 WIB "besok" versi UTC
    // sudah sama dengan hari ini versi Jakarta.
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });
    const besok = fmt.format(new Date(Date.now() + 86_400_000));

    await svc.from("digital_product_prices")
      .insert({ product_id: produk!.id, harga: 99_000, berlaku_sejak: besok });

    const { data } = await anonClient()
      .from("harga_produk_publik").select("harga").eq("product_id", produk!.id);
    expect(data).toEqual([]);

    await svc.from("digital_products").delete().eq("id", produk!.id);
  });

  /**
   * `produk_harga_staf` tidak punya pagar GRANT yang membedakan klien dari
   * admin/owner — ketiganya sama-sama peran SQL `authenticated`. Satu-satunya
   * pagar adalah predikat `user_role() in ('admin','owner')` DI DALAM view
   * itu sendiri. Dua uji di bawah memeriksa predikat itu langsung, bukan
   * cuma hak tabel — pasangan dari uji "tidak bocor ke pengunjung" di atas:
   * staf HARUS melihat harga yang sudah dijadwalkan owner, publik TIDAK.
   */
  it("admin melihat harga terjadwal lewat produk_harga_staf", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Uji staf", slug: "uji-staf-harga-terjadwal", jenis: "pdf", aktif: true })
      .select("id").single();

    // Kalender JAKARTA, bukan UTC — sama seperti uji "tidak bocor" di atas.
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });
    const besok = fmt.format(new Date(Date.now() + 86_400_000));

    await svc.from("digital_product_prices")
      .insert({ product_id: produk!.id, harga: 77_000, berlaku_sejak: besok });

    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin.from("produk_harga_staf")
      .select("harga").eq("product_id", produk!.id);
    expect(error).toBeNull();
    expect(data).toEqual([{ harga: 77_000 }]);

    await svc.from("digital_products").delete().eq("id", produk!.id);
  });

  it("klien mendapat array kosong (bukan galat) dari produk_harga_staf", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Uji staf klien", slug: "uji-staf-harga-klien", jenis: "pdf", aktif: true })
      .select("id").single();

    await svc.from("digital_product_prices")
      .insert({ product_id: produk!.id, harga: 88_000 });

    const klien = await signInAs("ananda@padma.test");
    const { data, error } = await klien.from("produk_harga_staf")
      .select("harga").eq("product_id", produk!.id);
    // Array kosong berarti predikat `user_role()` di dalam view yang
    // menyaring — beda kegagalan dari error grant (yang berarti hak tabel
    // yang salah). Keduanya harus dibedakan, bukan cuma "tidak error".
    expect(error).toBeNull();
    expect(data).toEqual([]);

    await svc.from("digital_products").delete().eq("id", produk!.id);
  });

  it("harga coret yang lebih murah dari harga jual DITOLAK basis data", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Uji coret", slug: "uji-coret-murah", jenis: "pdf" })
      .select("id").single();

    const { error } = await svc.from("digital_product_prices")
      .insert({ product_id: produk!.id, harga: 100_000, harga_coret: 50_000 })
      .select("id");
    expect(error?.code).toBe("23514");

    await svc.from("digital_products").delete().eq("id", produk!.id);
  });

  it("harga tidak bisa disunting maupun dihapus lewat peran API", async () => {
    const svc = createAdminSupabase();
    const { data: produk } = await svc.from("digital_products")
      .insert({ judul: "Uji riwayat", slug: "uji-riwayat-harga", jenis: "pdf" })
      .select("id").single();
    await svc.from("digital_product_prices")
      .insert({ product_id: produk!.id, harga: 50_000 });

    const owner = await signInAs("owner@padma.test");
    const { data: ubah } = await owner.from("digital_product_prices")
      .update({ harga: 1 }).eq("product_id", produk!.id).select("id");
    expect(ubah ?? []).toEqual([]);

    const { data: hapus } = await owner.from("digital_product_prices")
      .delete().eq("product_id", produk!.id).select("id");
    expect(hapus ?? []).toEqual([]);

    await svc.from("digital_products").delete().eq("id", produk!.id);
  });
});
