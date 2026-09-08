/**
 * PENAUTAN LEWAT EMAIL TERVERIFIKASI — jalur KEDUA di samping token undangan.
 *
 * Berkas ini menjaga keputusan K1/K2/K3 spec 8 September 2026, dan yang
 * dijaganya adalah PEMBALIKAN sadar atas catatan keras di
 * `src/lib/auth/link-client.ts`. Karena itu isinya tidak boleh dibaca sebagai
 * "test fitur": ia adalah pagar di sekeliling satu-satunya alasan pembalikan
 * itu sah.
 *
 * Dulu "email cocok" ditolak sebagai bukti kepemilikan — dan penolakan itu
 * BENAR, karena saat itu email tidak pernah dibuktikan:
 * `[auth.email] enable_confirmations = false` membuat GoTrue meng-auto-confirm
 * setiap pendaftaran mandiri, sehingga MENEBAK alamat email klien sudah cukup
 * untuk merebut rekam medisnya. Sejak 28 Agustus 2026 setelan itu menyala
 * (`supabase/config.toml`, dan `tests/konfirmasi-email-wajib.test.ts` menjaga
 * agar ia tidak mati diam-diam). Yang berubah bukan pendapat, melainkan fakta.
 *
 * Maka satu-satunya hal yang membuat jalur ini aman adalah pemeriksaan
 * `email_confirmed_at`. Setiap perkara di bawah membuktikannya DARI BASIS
 * DATA, bukan dari nilai balik fungsi saja: fungsi yang memulangkan `false`
 * tetapi sudah terlanjur menulis adalah kegagalan yang paling sulit terlihat,
 * dan justru kelas itulah yang dua kali lolos di repo ini.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import type { User } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  tautkanKlienLewatEmailTerverifikasi,
  terbitkanKlienMandiri,
} from "@/lib/auth/link-client";
import { pastikanKlien } from "@/lib/auth/pastikan-klien";

const admin = createAdminSupabase();

// Sampah dibereskan per perkara supaya berkas ini idempoten dan tidak
// meninggalkan akun/baris uji di stack lokal yang dipakai bersama.
// `emails` ada karena sebagian baris klien LAHIR di dalam kode yang diuji —
// idnya tidak pernah lewat di sini, jadi yang dipegang hanyalah emailnya.
const bekas: { userIds: string[]; clientIds: string[]; emails: string[] } = {
  userIds: [],
  clientIds: [],
  emails: [],
};

afterEach(async () => {
  // Baris klien lebih dulu: `clients.user_id` menunjuk `auth.users(id)` tanpa
  // ON DELETE, jadi menghapus usernya duluan akan ditolak foreign key.
  for (const id of bekas.clientIds) await admin.from("clients").delete().eq("id", id);
  for (const email of bekas.emails) await admin.from("clients").delete().eq("email", email);
  for (const id of bekas.userIds) await admin.auth.admin.deleteUser(id);
  bekas.userIds = [];
  bekas.clientIds = [];
  bekas.emails = [];
});

function emailUji(awalan: string): string {
  const email = `${awalan}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@padma.test`;
  bekas.emails.push(email);
  return email;
}

async function buatUser(email: string, terverifikasi: boolean): Promise<User> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "rahasia123",
    email_confirm: terverifikasi,
    user_metadata: { full_name: "Klien Mandiri", no_hp: "0812-3456-7890" },
  });
  if (error) throw new Error(`gagal membuat user uji ${email}: ${error.message}`);
  bekas.userIds.push(data.user!.id);
  return data.user!;
}

async function buatKlien(email: string, userId: string | null = null): Promise<string> {
  const { data, error } = await admin
    .from("clients")
    .insert({
      padma_id: `PAD-UJI-${Date.now()}${Math.floor(Math.random() * 1000)}`,
      nama: "Klien Uji",
      email,
      // `phase_id` menjadi nullable di migration `fase_klien_boleh_kosong`,
      // tetapi fixture ini SENGAJA mengisinya: yang diuji di sini penautan,
      // bukan efek samping fase.
      phase_id: "prekonsepsi",
      user_id: userId,
      linked_at: userId ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error) throw error;
  bekas.clientIds.push(data!.id as string);
  return data!.id as string;
}

async function barisKlien(id: string) {
  const { data, error } = await admin
    .from("clients")
    .select("user_id, linked_at, phase_id")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as { user_id: string | null; linked_at: string | null; phase_id: string | null };
}

async function barisKlienBeremail(email: string) {
  const { data, error } = await admin
    .from("clients")
    .select("id, user_id, linked_at, phase_id, nama, no_hp")
    .eq("email", email);
  if (error) throw error;
  return (data ?? []) as {
    id: string;
    user_id: string | null;
    linked_at: string | null;
    phase_id: string | null;
    nama: string;
    no_hp: string;
  }[];
}

/**
 * Membuat user dengan email TERVERIFIKASI lalu MEMBOHONGI fungsi yang diuji
 * dengan menghapus `email_confirmed_at` dari objek yang diberikan padanya.
 *
 * Ini menirukan satu-satunya bentuk penyalahgunaan yang tersisa bila
 * pemeriksaan konfirmasi dipindahkan ke luar fungsi: pemanggil yang menyerahkan
 * objek user apa adanya sementara fungsi menganggap "sudah diperiksa di atas".
 */
function tanpaKonfirmasi(user: User): User {
  return { ...user, email_confirmed_at: undefined, confirmed_at: undefined };
}

describe("penautan lewat email terverifikasi", () => {
  it("email BELUM terverifikasi tidak menautkan apa pun, walau ada baris klien beremail sama", async () => {
    // Ini pintu yang menjaga seluruh keputusan K1. Baris kliennya SENGAJA ada
    // dan emailnya SENGAJA cocok — kalau perkara ini hijau karena barisnya
    // memang tidak ada, ia tidak menjaga apa pun.
    const email = emailUji("belum");
    const user = await buatUser(email, false);
    const clientId = await buatKlien(email);

    expect(user.email_confirmed_at ?? null).toBeNull();
    expect(await tautkanKlienLewatEmailTerverifikasi(user)).toBe(false);

    // Dibuktikan dari DB, bukan dari nilai balik saja.
    const klien = await barisKlien(clientId);
    expect(klien.user_id).toBeNull();
    expect(klien.linked_at).toBeNull();
  });

  it("baris klien yang sudah dimiliki orang lain TIDAK bisa direbut", async () => {
    // Baris klien milik pemilik sah, lalu penyerang yang emailnya SUDAH
    // terverifikasi mencoba menautkan dirinya ke baris beremail sama.
    const email = emailUji("korban");
    const pemilik = await buatUser(email, true);
    const clientId = await buatKlien(email, pemilik.id);

    const penyerang = await buatUser(emailUji("penyerang"), true);
    // Objek user penyerang dipalsukan emailnya — persis skenario "menebak
    // alamat email klien" yang dulu berhasil merebut rekam medis.
    const palsu: User = { ...penyerang, email };

    expect(await tautkanKlienLewatEmailTerverifikasi(palsu)).toBe(false);

    const klien = await barisKlien(clientId);
    expect(klien.user_id).toBe(pemilik.id);
    expect(klien.user_id).not.toBe(penyerang.id);
  });

  it("email terverifikasi + baris klien belum tertaut -> tertaut", async () => {
    const email = emailUji("tertaut");
    const user = await buatUser(email, true);
    const clientId = await buatKlien(email);

    expect(await tautkanKlienLewatEmailTerverifikasi(user)).toBe(true);

    const klien = await barisKlien(clientId);
    expect(klien.user_id).toBe(user.id);
    expect(klien.linked_at).not.toBeNull();
  });

  it("email terverifikasi + tidak ada baris klien -> baris baru lahir dengan user_id terisi", async () => {
    const email = emailUji("mandiri");
    const user = await buatUser(email, true);

    expect(await terbitkanKlienMandiri(user)).toBe(true);

    const baris = await barisKlienBeremail(email);
    expect(baris).toHaveLength(1);
    // Bertuan SEJAK INSERT (K3): tidak pernah ada jendela waktu ketika baris
    // ini menganggur dan bisa diperebutkan.
    expect(baris[0].user_id).toBe(user.id);
    expect(baris[0].linked_at).not.toBeNull();
    // Fase datang dari skrining, bukan dari pendaftaran.
    expect(baris[0].phase_id).toBeNull();
    // Nama & no. HP dirapikan dengan aturan yang sama seperti formulir /daftar.
    expect(baris[0].nama).toBe("Klien Mandiri");
    expect(baris[0].no_hp).toBe("081234567890");
  });

  it("terbitkanKlienMandiri menolak email yang belum terverifikasi", async () => {
    // Penjaga kedua di dalam fungsinya sendiri: gerbang memang memeriksanya
    // lebih dulu, tetapi fungsi ini juga bisa dipanggil dari rute lain kelak.
    const email = emailUji("mandiri-belum");
    const user = await buatUser(email, false);

    expect(await terbitkanKlienMandiri(user)).toBe(false);
    expect(await barisKlienBeremail(email)).toHaveLength(0);
  });

  it("pemeriksaan konfirmasi hidup DI DALAM fungsi, bukan di pemanggilnya", async () => {
    // Perkara ini SENGAJA tidak lagi menyodorkan string email telanjang.
    // Versi itu hanya lulus karena `"str".id` bernilai undefined — ia tidak
    // membuktikan apa pun tentang BENTUK fungsinya. Yang benar-benar menjaga
    // bentuk itu adalah tipe TypeScript, plus asersi struktural
    // `not.toContain("linkClientByEmail")` di tests/penautan-undangan.test.ts.
    //
    // Yang MASIH perlu dibuktikan di sini, dan tidak dijaga keduanya: user
    // yang emailnya sungguh terverifikasi tetapi objeknya sampai ke fungsi
    // TANPA `email_confirmed_at` harus tetap ditolak. Itulah bentuk yang
    // muncul bila suatu hari pemeriksaannya dipindahkan ke pemanggil.
    const email = emailUji("tanpa-konfirmasi");
    const user = await buatUser(email, true);
    const clientId = await buatKlien(email);

    expect(await tautkanKlienLewatEmailTerverifikasi(tanpaKonfirmasi(user))).toBe(false);
    expect(await terbitkanKlienMandiri(tanpaKonfirmasi(user))).toBe(false);
    expect((await barisKlien(clientId)).user_id).toBeNull();
    expect(await barisKlienBeremail(email)).toHaveLength(1); // tidak ada baris kedua
  });
});

describe("gerbang pastikanKlien: urutan keputusan", () => {
  it("email belum terverifikasi -> /periksa-email, dan TIDAK ADA baris klien yang lahir", async () => {
    // Langkah "email belum terverifikasi" berdiri DI ATAS langkah 3 & 4 karena
    // ia yang menjaga keduanya. Menukar urutannya berarti menerbitkan (atau
    // menautkan) baris klien untuk email yang belum dibuktikan siapa pun.
    const email = emailUji("gerbang-belum");
    const user = await buatUser(email, false);

    expect(await pastikanKlien(user, "")).toBe("/periksa-email");
    expect(await barisKlienBeremail(email)).toHaveLength(0);
  });

  it("email belum terverifikasi + baris klien beremail sama -> /periksa-email, baris tak tersentuh", async () => {
    const email = emailUji("gerbang-belum-ada");
    const user = await buatUser(email, false);
    const clientId = await buatKlien(email);

    expect(await pastikanKlien(user, "")).toBe("/periksa-email");

    const klien = await barisKlien(clientId);
    expect(klien.user_id).toBeNull();
    expect(klien.linked_at).toBeNull();
  });

  it("email terverifikasi + baris klien belum tertaut -> /passport", async () => {
    const email = emailUji("gerbang-tertaut");
    const user = await buatUser(email, true);
    const clientId = await buatKlien(email);

    expect(await pastikanKlien(user, "")).toBe("/passport");
    expect((await barisKlien(clientId)).user_id).toBe(user.id);
  });

  it("email terverifikasi tanpa baris klien -> /passport dengan baris baru berfase kosong", async () => {
    const email = emailUji("gerbang-mandiri");
    const user = await buatUser(email, true);

    expect(await pastikanKlien(user, "")).toBe("/passport");

    const baris = await barisKlienBeremail(email);
    expect(baris).toHaveLength(1);
    expect(baris[0].user_id).toBe(user.id);
    expect(baris[0].phase_id).toBeNull();
  });

  it("user yang sudah tertaut langsung ke /passport tanpa menyentuh apa pun", async () => {
    const email = emailUji("gerbang-sudah");
    const user = await buatUser(email, true);
    const clientId = await buatKlien(email, user.id);
    const sebelum = await barisKlien(clientId);

    expect(await pastikanKlien(user, "")).toBe("/passport");
    expect(await barisKlienBeremail(email)).toHaveLength(1);
    expect((await barisKlien(clientId)).linked_at).toBe(sebelum.linked_at);
  });

  it("baris klien milik orang lain: email terverifikasi TIDAK merebutnya", async () => {
    // Baris beremail X sudah bertuan; user lain yang mengaku beremail X tetap
    // tidak mendapat apa pun — dan tidak boleh pula mendapat baris klien baru
    // beremail X (unique `clients_email_key` yang menjadi penjaga terakhir).
    const email = emailUji("gerbang-rebut");
    const pemilik = await buatUser(email, true);
    const clientId = await buatKlien(email, pemilik.id);

    const penyerang = await buatUser(emailUji("gerbang-penyerang"), true);
    const palsu: User = { ...penyerang, email };

    expect(await pastikanKlien(palsu, "")).toBe("/akun-belum-terhubung");

    const baris = await barisKlienBeremail(email);
    expect(baris).toHaveLength(1);
    expect(baris[0].id).toBe(clientId);
    expect(baris[0].user_id).toBe(pemilik.id);
  });
});

/**
 * PEMINDAIAN BERKAS atas urutan di dalam gerbang.
 *
 * Kenapa perlu, padahal perkara-perkara di atas sudah menguji perilakunya:
 * dicoba sungguhan pada berkas ini (8 Sep 2026) — MEMINDAHKAN penjaga
 * `email_confirmed_at` dari atas ke BAWAH kedua langkah yang dijaganya membuat
 * SELURUH 12 perkara di atas tetap hijau. Bukan karena testnya lemah,
 * melainkan karena kedua fungsi di `link-client.ts` memeriksa ulang sendiri
 * (pertahanan berlapis) sehingga akibatnya tidak terlihat dari luar.
 *
 * Justru itu yang berbahaya: lapis kedua menyembunyikan matinya lapis pertama,
 * sampai suatu hari seseorang menambahkan langkah KETIGA di antara keduanya —
 * langkah yang tidak punya pemeriksaannya sendiri karena penulisnya melihat
 * penjaga di atas dan menganggap urusannya sudah selesai. Perkara ini menjaga
 * bentuk berkasnya, bukan perilakunya, karena hanya bentuk yang bisa
 * membedakan keduanya.
 */
describe("bentuk gerbang: penjaga berdiri DI ATAS yang dijaganya", () => {
  const sumber = readFileSync(
    path.resolve(__dirname, "..", "src", "lib", "auth", "pastikan-klien.ts"),
    "utf8",
  );

  it("`email_confirmed_at` diperiksa sebelum penautan-lewat-email maupun penerbitan", () => {
    const penjaga = sumber.indexOf("!user.email_confirmed_at");
    const tautkan = sumber.indexOf("await tautkanKlienLewatEmailTerverifikasi(");
    const terbitkan = sumber.indexOf("await terbitkanKlienMandiri(");

    expect(penjaga, "penjaga email_confirmed_at hilang dari gerbang").toBeGreaterThan(-1);
    expect(tautkan).toBeGreaterThan(-1);
    expect(terbitkan).toBeGreaterThan(-1);
    expect(penjaga, "penjaga harus mendahului penautan lewat email").toBeLessThan(tautkan);
    expect(penjaga, "penjaga harus mendahului penerbitan baris klien").toBeLessThan(terbitkan);
  });

  it("gerbang tidak menulis ke `clients` sendiri", () => {
    // Seluruh tulisan hidup di `link-client.ts`, tempat penjaganya berada.
    // Query yang lahir di berkas ini akan menjadi salinan aturan yang kedua.
    expect(sumber).not.toContain('.from("clients")');
    expect(sumber).not.toContain("createAdminSupabase");
  });
});

describe("balapan PADMA ID pada penerbitan mandiri", () => {
  it("dua pendaftaran serentak sama-sama mendapat baris, dengan padma_id berbeda", async () => {
    // Nomor PADMA ID TIDAK datang dari sequence Postgres (dilarang migration
    // `fail_closed_sequence_fungsi`) melainkan dihitung dari nomor tertinggi
    // yang terpakai, jadi dua permintaan pada detik yang sama memang bisa
    // memperoleh nomor yang sama. Yang menjadi penjaga terakhir adalah indeks
    // unik `clients_padma_id_key`, dan perkara ini membuktikan bahwa
    // percobaan-ulangnya benar-benar bekerja.
    //
    // Ia sekaligus membuktikan pembedaan 23505 tidak terbalik: kalau bentrok
    // `padma_id` salah dibaca sebagai bentrok email, yang kalah akan menyerah
    // dan pulang `false` alih-alih mencoba nomor berikutnya.
    const emailA = emailUji("balapan-a");
    const emailB = emailUji("balapan-b");
    const [a, b] = await Promise.all([
      buatUser(emailA, true),
      buatUser(emailB, true),
    ]);

    const hasil = await Promise.all([
      terbitkanKlienMandiri(a),
      terbitkanKlienMandiri(b),
    ]);
    expect(hasil).toEqual([true, true]);

    const { data } = await admin
      .from("clients")
      .select("padma_id, user_id")
      .in("email", [emailA, emailB]);
    const baris = (data ?? []) as { padma_id: string; user_id: string }[];
    expect(baris).toHaveLength(2);
    expect(new Set(baris.map((r) => r.padma_id)).size).toBe(2);
    expect(new Set(baris.map((r) => r.user_id))).toEqual(new Set([a.id, b.id]));
  });
});
