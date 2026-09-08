import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";
import { JAM_LAYANAN_BAWAAN, uraikanDaftarJam } from "@/lib/jadwal/jam";
import { periksaNilai } from "@/lib/pengaturan/bentuk";
import { bacaPengaturan } from "@/lib/settings";

describe("registri kunci jam_layanan", () => {
  it("kuncinya terdaftar dengan bentuk daftar_jam", async () => {
    const baris = await querySql<{ bentuk: string; keterangan: string }>(
      "select bentuk, keterangan from public.app_setting_keys where key = 'jam_layanan'",
    );
    expect(baris[0]?.bentuk).toBe("daftar_jam");
    expect(baris[0]?.keterangan).toBeTruthy();
  });

  it("CHECK bentuk menerima daftar_jam", async () => {
    // Kunci yang terdaftar dengan bentuk tak dikenal ditolak CHECK, dan
    // migrasinya gagal — pagar ini menangkapnya di uji, bukan di deploy.
    const baris = await querySql<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'public.app_setting_keys'::regclass and contype = 'c'`,
    );
    expect(baris.map((b) => b.def).join(" ")).toContain("daftar_jam");
  });
});

describe("nilai bawaan ditanam migrasi", () => {
  it("barisnya ADA, dan isinya identik dengan JAM_LAYANAN_BAWAAN", async () => {
    // Bukan sekadar kerapian: `guard_booking_pembatas` membaca baris ini untuk
    // menolak jam di luar jam layanan. Bila barisnya tidak ada, pagar basis
    // data lahir DIAM dan satu-satunya yang berlaku kembali server action —
    // padahal klien memegang policy INSERT dan bisa melewatinya.
    //
    // Kedua daftar karena itu wajib identik, dan uji ini yang menahannya.
    const baris = await querySql<{ value: string }>(
      "select value from public.app_settings where key = 'jam_layanan'",
    );
    expect(baris.length, "baris jam_layanan tidak ditanam migrasi").toBe(1);
    expect(uraikanDaftarJam(baris[0].value)).toEqual([...JAM_LAYANAN_BAWAAN]);
  });
});

describe("bacaPengaturan", () => {
  it("memulangkan jam layanan sebagai daftar, bukan teks mentah", async () => {
    const p = await bacaPengaturan();
    expect(Array.isArray(p.jamLayanan)).toBe(true);
    expect(p.jamLayanan.length).toBeGreaterThan(0);
  });

  it("jam_operasional dan jam_layanan adalah DUA hal berbeda", async () => {
    // Namanya mirip dan keduanya soal jam, tetapi yang satu KALIMAT untuk
    // dibaca pengunjung di footer, yang satu DAFTAR untuk divalidasi server
    // sebelum sebuah janji dibuat. Menggabungkannya berarti satu dari keduanya
    // pasti salah bentuk.
    const p = await bacaPengaturan();
    expect(typeof p.jamTampilan).toBe("string");
    expect(Array.isArray(p.jamLayanan)).toBe(true);
  });
});

describe("gerbang tulis setelan bertipe daftar_jam", () => {
  it("menormalkan: unik, terurut, dipisah koma-spasi", () => {
    const r = periksaNilai("daftar_jam", " 13:00,09:00 , 09:00,11:00 ");
    expect(r).toEqual({ ok: true, nilai: "09:00, 11:00, 13:00" });
  });

  it("MENOLAK entri yang salah bentuk, menyebut entrinya", () => {
    // Jalur TULIS sengaja lebih ketat daripada jalur BACA. `uraikanDaftarJam()`
    // membuang entri buruk karena formulir pemesanan tidak boleh pernah terbit
    // tanpa pilihan; di sini sikap yang sama akan berbohong — admin mengetik
    // "8 pagi", panel menjawab "Tersimpan", dan yang tersimpan sesuatu yang lain.
    const r = periksaNilai("daftar_jam", "09:00, 8 pagi, 11:00");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.pesan).toContain("8 pagi");
  });

  it("MENOLAK menit ganjil, walau bentuknya HH:MM", () => {
    // 09:07 akan lolos sampai ke formulir pemesanan lalu gagal saat klien
    // menekan kirim — kegagalan yang muncul di tangan orang yang tidak
    // melakukan kesalahan apa pun. CHECK basis data adalah lapis terakhirnya,
    // bukan satu-satunya.
    const r = periksaNilai("daftar_jam", "09:07");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.pesan).toContain("09:07");
  });

  it("MENOLAK daftar kosong", () => {
    expect(periksaNilai("daftar_jam", "   ").ok).toBe(false);
    expect(periksaNilai("daftar_jam", ",,").ok).toBe(false);
  });
});
