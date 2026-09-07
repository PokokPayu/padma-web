/**
 * RPC `perbarui_profil_klien` — satu-satunya jalur tulis klien ke barisnya
 * sendiri di `clients`.
 *
 * Kenapa RPC, bukan policy UPDATE baru? Karena RLS Postgres tidak mengenal
 * pembatasan per-KOLOM untuk UPDATE (alasan yang sama sudah ditulis panjang di
 * migration `kunci_kolom_penautan_klien`). Satu policy UPDATE untuk klien akan
 * menyerahkan SELURUH baris — termasuk `email` yang menjadi dasar penautan akun
 * dan `phase_id` yang menentukan materi apa yang terbuka baginya.
 *
 * Karena itu policy `clients: milik sendiri` tetap `for select` saja, dan
 * pembuktiannya tetap hidup di `tests/passport-profil.test.ts`: UPDATE langsung
 * lewat PostgREST harus tetap nol baris. Berkas ini menguji pintu sempit yang
 * kita tambahkan di sebelahnya, beserta semua yang TIDAK boleh dilewatinya.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";

const ANANDA = "44444444-4444-4444-4444-444444444401";

type BarisKlien = {
  nama: string;
  no_hp: string;
  alamat: string;
  alamat_lat: number | null;
  alamat_lon: number | null;
  email: string;
  phase_id: string;
  padma_id: string;
  user_id: string | null;
};

const KOLOM =
  "nama, no_hp, alamat, alamat_lat, alamat_lon, email, phase_id, padma_id, user_id";

let klien: SupabaseClient;
let semula: BarisKlien;

async function bacaAnanda(): Promise<BarisKlien> {
  const { data, error } = await createAdminSupabase()
    .from("clients")
    .select(KOLOM)
    .eq("id", ANANDA)
    .single<BarisKlien>();
  if (error) throw new Error(`gagal membaca baris Ananda: ${error.message}`);
  return data!;
}

beforeAll(async () => {
  klien = await signInAs("ananda@padma.test");
  semula = await bacaAnanda();
});

// Instans Supabase lokal ini dipakai bersama oleh beberapa sesi kerja, dan
// berkas uji lain meng-assert nama & nomor Ananda apa adanya. Setiap uji di
// sini menulis baris SUNGGUHAN, jadi pemulihannya wajib — bukan kerapian.
afterEach(async () => {
  await createAdminSupabase()
    .from("clients")
    .update({
      nama: semula.nama,
      no_hp: semula.no_hp,
      alamat: semula.alamat,
      alamat_lat: semula.alamat_lat,
      alamat_lon: semula.alamat_lon,
    })
    .eq("id", ANANDA);
});

describe("perbarui_profil_klien — jalur sah", () => {
  it("menyimpan nama, no. WhatsApp, dan alamat milik pemanggil sendiri", async () => {
    const { error } = await klien.rpc("perbarui_profil_klien", {
      p_nama: "Ananda Putri Wijaya",
      p_no_hp: "0812-9999-0000",
      p_alamat: "Jl. Besar Ijen No. 77, Kota Malang",
    });
    expect(error).toBeNull();

    const kini = await bacaAnanda();
    expect(kini.nama).toBe("Ananda Putri Wijaya");
    expect(kini.no_hp).toBe("0812-9999-0000");
    expect(kini.alamat).toBe("Jl. Besar Ijen No. 77, Kota Malang");
  });
});

describe("perbarui_profil_klien — yang TIDAK boleh ikut berubah", () => {
  it("tidak menyentuh email, fase, PADMA ID, maupun penautan akun", async () => {
    await klien.rpc("perbarui_profil_klien", {
      p_nama: "Nama Baru",
      p_no_hp: "0800-1111-2222",
      p_alamat: "Jl. Veteran No. 8, Kota Malang",
    });

    const kini = await bacaAnanda();
    expect(kini.email).toBe(semula.email);
    expect(kini.phase_id).toBe(semula.phase_id);
    expect(kini.padma_id).toBe(semula.padma_id);
    expect(kini.user_id).toBe(semula.user_id);
  });

  it("tidak mengubah baris klien lain", async () => {
    await klien.rpc("perbarui_profil_klien", {
      p_nama: "Nama Baru",
      p_no_hp: "0800-1111-2222",
      p_alamat: "Jl. Veteran No. 8, Kota Malang",
    });

    const { data: rina } = await createAdminSupabase()
      .from("clients")
      .select("nama")
      .eq("id", "44444444-4444-4444-4444-444444444402")
      .single<{ nama: string }>();
    expect(rina!.nama).toBe("Rina Hapsari");
  });
});

describe("perbarui_profil_klien — koordinat", () => {
  it("mengosongkan koordinat ketika teks alamat berubah", async () => {
    const admin = createAdminSupabase();
    await admin
      .from("clients")
      .update({ alamat: "Jl. Lama No. 1, Kota Malang", alamat_lat: -7.98, alamat_lon: 112.63 })
      .eq("id", ANANDA);

    await klien.rpc("perbarui_profil_klien", {
      p_nama: semula.nama,
      p_no_hp: semula.no_hp,
      p_alamat: "Jl. Baru No. 2, Kota Malang",
    });

    const kini = await bacaAnanda();
    expect(kini.alamat_lat).toBeNull();
    expect(kini.alamat_lon).toBeNull();
  });

  it("mempertahankan koordinat ketika hanya nama yang berubah", async () => {
    const admin = createAdminSupabase();
    await admin
      .from("clients")
      .update({ alamat: "Jl. Tetap No. 3, Kota Malang", alamat_lat: -7.98, alamat_lon: 112.63 })
      .eq("id", ANANDA);

    await klien.rpc("perbarui_profil_klien", {
      p_nama: "Ananda P. W.",
      p_no_hp: semula.no_hp,
      p_alamat: "Jl. Tetap No. 3, Kota Malang",
    });

    const kini = await bacaAnanda();
    expect(kini.nama).toBe("Ananda P. W.");
    expect(kini.alamat_lat).toBe(-7.98);
    expect(kini.alamat_lon).toBe(112.63);
  });
});

describe("perbarui_profil_klien — pemanggil tanpa hak", () => {
  // Kedua uji di bawah menuntut KODE galat yang spesifik, bukan sekadar
  // "ada error". Tanpa itu keduanya tetap hijau seandainya fungsinya dihapus —
  // "fungsi tidak ada" juga memulangkan galat, dan uji yang lulus karena
  // ketiadaan fitur tidak membuktikan apa pun tentang fiturnya.
  it("menolak pemanggil anonim di lapisan hak, bukan di badan fungsi", async () => {
    const { error } = await anonClient().rpc("perbarui_profil_klien", {
      p_nama: "Penyusup",
      p_no_hp: "0800-0000-0000",
      p_alamat: "Jl. Mana Saja No. 1, Kota Malang",
    });
    expect(error?.code).toBe("42501");
    expect(error!.message).toMatch(/permission denied/i);

    const kini = await bacaAnanda();
    expect(kini.nama).toBe(semula.nama);
  });

  it("menolak pengguna yang punya sesi tetapi bukan klien", async () => {
    const admin = await signInAs("admin@padma.test");
    const { error } = await admin.rpc("perbarui_profil_klien", {
      p_nama: "Admin Iseng",
      p_no_hp: "0800-0000-0000",
      p_alamat: "Jl. Mana Saja No. 1, Kota Malang",
    });
    // "Tidak berhak" harus terbaca berbeda dari "tidak ada yang berubah":
    // nol baris yang senyap membuat pemanggil tidak bisa membedakan keduanya.
    expect(error?.code).toBe("42501");
    expect(error!.message).toBe("tidak ada baris klien untuk akun ini");
  });
});
