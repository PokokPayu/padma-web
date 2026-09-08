/**
 * SKRINING MERAH BOLEH DIULANG TANPA JEDA (spec C1 J9).
 *
 * Tidak ada kode yang perlu ditulis untuk keputusan ini — yang perlu dipastikan
 * adalah tidak ada yang MENGHALANGI. Berkas ini karena itu menjaga KETIADAAN
 * sebuah pagar, dan ia ditulis justru supaya keputusannya punya wujud yang bisa
 * gagal: tanpa uji, "boleh diulang" hanyalah kesunyian yang kelak dibaca sebagai
 * "belum sempat dikerjakan", lalu seseorang menambahkan jeda dengan niat baik.
 *
 * ALASAN keputusannya, disalin dari spec supaya tidak hilang bersama konteks:
 * menahan pengulangan menghukum orang yang salah pencet, sementara siapa pun
 * yang berniat mengulang sampai hijau toh bisa membuka jendela penyamaran.
 * Yang menjaga adalah JEJAK — tiap percobaan tersimpan sebagai baris tersendiri
 * dan muncul di inbox admin, sehingga pola "mengulang sampai hijau" terlihat
 * oleh manusia yang bisa menindaknya.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { skriningHijau } from "./helpers/skrining";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");

const ANANDA = "44444444-4444-4444-4444-444444444401";

async function bersihkan() {
  await admin.from("screenings").delete().like("kode", "UJI-%");
}

beforeAll(bersihkan);
beforeEach(bersihkan);
afterAll(bersihkan);

describe("hasil merah boleh diulang", () => {
  it("dua skrining MERAH berturut-turut untuk orang yang sama sama-sama tersimpan", async () => {
    const pertama = await skriningHijau(admin, ANANDA, { hasil: "merah" });
    const kedua = await skriningHijau(admin, ANANDA, { hasil: "merah" });
    expect(pertama).not.toBe(kedua);

    const { data } = await admin
      .from("screenings")
      .select("id")
      .eq("client_id", ANANDA)
      .like("kode", "UJI-%");
    expect((data ?? []).length).toBe(2);
  });

  it("merah lalu HIJAU: yang hijau bisa dipakai memesan, yang merah tetap tercatat", async () => {
    // Inilah alur yang sebenarnya diharapkan: orang menjawab keliru, mengulang,
    // dan yang kedua benar. Yang pertama TIDAK dihapus — ia bagian jejak.
    await skriningHijau(admin, ANANDA, { hasil: "merah" });
    await skriningHijau(admin, ANANDA);

    const { data } = await admin
      .from("screenings")
      .select("hasil")
      .eq("client_id", ANANDA)
      .like("kode", "UJI-%");
    const hasil = (data ?? []).map((b) => b.hasil).sort();
    expect(hasil).toEqual(["hijau", "merah"]);
  });

  it("TIDAK ADA jeda/kuota antar-skrining di kode mana pun", () => {
    // Pagar sumber. Bila kelak seseorang menambahkan jeda dengan niat baik,
    // uji ini yang menahannya — dan memaksanya membaca alasan di dokblok atas
    // lebih dulu.
    //
    // Pembatas LAJU (`terlaluSering`, `terlaluSeringKlien`) BUKAN yang dilarang
    // di sini: ia menahan banjir permintaan per menit, bukan menghukum orang
    // yang mengulang skriningnya. Yang dilarang adalah jeda antar-SKRINING.
    const sumber = [
      "src/app/api/skrining/route.ts",
      "src/app/api/skrining/akun/route.ts",
      "src/app/skrining/wizard.tsx",
    ].map((rel) => readFileSync(path.join(AKAR, rel), "utf8"));

    for (const isi of sumber) {
      const kode = isi.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(kode).not.toMatch(/jeda|cooldown|tunggu_?\d|sudah_?pernah_?skrining/i);
    }
  });
});

describe("jejaknya yang menjaga, dan jejak itu terlihat staf", () => {
  it("skrining merah muncul di inbox admin seperti skrining lain", async () => {
    // "Yang menjaga adalah jejak" hanya benar bila jejaknya benar-benar
    // terbaca. Inbox admin membaca `screenings` apa adanya — uji ini menahan
    // penyaringan diam-diam yang membuang hasil merah dari layar.
    await skriningHijau(admin, ANANDA, { hasil: "merah" });

    const { data } = await admin
      .from("screenings")
      .select("id, hasil, status_tindak_lanjut")
      .like("kode", "UJI-%");

    expect((data ?? []).length).toBe(1);
    expect(data![0].hasil).toBe("merah");
    // Baris baru selalu masuk sebagai pekerjaan yang belum ditangani.
    expect(data![0].status_tindak_lanjut).toBe("baru");
  });
});
