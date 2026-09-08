/**
 * PEMBATALAN & JADWAL ULANG LEWAT RPC (spec C3 P1, P3, P4, P5, P7).
 *
 * Yang paling penting di berkas ini: pembatalan jenjang 2 adalah DUA tulisan
 * yang harus berlaku sebagai SATU keputusan — sesi menjadi batal, dan haknya
 * terbit. Kegagalan di antaranya meninggalkan klien tanpa sesi dan tanpa
 * gantinya, dan itu bentuk kegagalan paling mahal di seluruh C3.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { querySql } from "./helpers/db";
import { kedaluwarsaHak } from "@/lib/pembatalan/jenjang";

const admin = createAdminSupabase();

const ANANDA = "44444444-4444-4444-4444-444444444401";
// Klien KEDUA. Rina punya baris `clients` tetapi SENGAJA tanpa akun auth
// (`scripts/seed-users.ts` menegakkannya), jadi ia tidak pernah login di sini —
// perannya hanya sebagai PEMILIK baris yang dicoba disentuh Ananda.
const RINA = "44444444-4444-4444-4444-444444444402";
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333301";

let VARIAN: string;
let sesiKlien: SupabaseClient;
let sesiAdmin: SupabaseClient;

/**
 * Satu jam layanan sah (seed: 08–11, 13–16) yang jaraknya dari SEKARANG jatuh
 * ketat di dalam jendela jenjang 2 (2–24 jam) — dipakai uji balapan
 * `jadwal_ulang_sesi` supaya sasaran perpindahannya sendiri tidak melompat ke
 * jenjang 1 begitu baris sudah dipindah oleh panggilan pertama.
 */
function slotDekatJenjang2(): { tanggal: string; jam: string } {
  const JAM_LAYANAN = ["08:00", "09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"];
  const sekarang = Date.now();
  for (let hariOffset = 0; hariOffset <= 2; hariOffset++) {
    const wib = new Date(sekarang + 7 * 3_600_000 + hariOffset * 24 * 3_600_000);
    const tanggal = wib.toISOString().slice(0, 10);
    for (const jam of JAM_LAYANAN) {
      const sasaran = new Date(`${tanggal}T${jam}:00+07:00`).getTime();
      const jarakJam = (sasaran - sekarang) / 3_600_000;
      if (jarakJam > 2.5 && jarakJam < 23.5) {
        return { tanggal, jam };
      }
    }
  }
  throw new Error("tidak menemukan slot jam layanan di jendela jenjang 2");
}

// Dihitung SEKALI saat berkas dimuat, bukan di dalam tiap `it`: dua panggilan
// RPC di uji balapan memakai KONSTANTA yang sama ini, bukan memanggil
// `slotDekatJenjang2()` lagi masing-masing (sasarannya harus identik supaya
// keduanya benar-benar berebut baris yang sama).
const SLOT_BALAPAN = slotDekatJenjang2();

// `bersihkan()` menyapu berdasarkan APA YANG DIBUAT berkas ini, BUKAN
// tanggal yang kebetulan diingat. Percobaan pertama menyapu daftar tanggal
// tetap ("2027-09-20", "2027-09-25", dst) — itu bocor: `jamRelatif()` (dipakai
// hampir semua uji di berkas ini) menghasilkan tanggal yang BERGERAK
// mengikuti hari ini (mis. `jamRelatif(48)` = hari-ini+48 jam), tidak pernah
// masuk daftar tetap manapun, sehingga setiap sesi yang dibuat lewatnya
// tertinggal permanen. 148 baris menumpuk sebelum ini ketahuan dari
// suite penuh yang dijalankan orang lain.
//
// Alternatif yang DITOLAK: menyapu SELURUH sesi milik ANANDA/RINA. Kedua id
// klien itu bukan milik eksklusif berkas ini — dipakai puluhan berkas uji
// lain (`grep -rl "$ANANDA" tests/` mengembalikan >40 berkas) — jadi menyapu
// berdasarkan client_id berisiko menabrak fixture berkas lain bila pernah
// dijalankan berdampingan (mis. worker paralel Vitest). Begitu pula
// `partner_id = MITRA`: id itu juga dipakai puluhan berkas lain.
//
// Sebagai gantinya, SETIAP id sesi yang lahir dari kode berkas ini —
// `buatSesiUntuk()` dan setiap panggilan `tukar_hak_sesi` yang melahirkan
// sesi baru — dicatat ke `SESI_MILIK_UJI`, dan `bersihkan()` menyapu TEPAT
// himpunan itu. Gejala bila pagar id ini lepas lagi (mis. jalur pembuatan
// sesi baru ditambahkan tanpa mencatatnya ke set ini): berkas uji LAIN yang
// tidak pernah disentuh ikut merah karena jumlah baris yang mereka hitung
// membengkak — persis laporan yang membuka perbaikan ini.
const SESI_MILIK_UJI = new Set<string>();

function catatSesi(id: string | null | undefined): void {
  if (id) SESI_MILIK_UJI.add(id);
}

async function bersihkan() {
  const ids = Array.from(SESI_MILIK_UJI);
  if (ids.length > 0) {
    // Jejak DULU: tabelnya tanpa foreign key, jadi tidak ada cascade yang
    // menyapunya, dan `tests/jejak-yatim.test.ts` akan merah bila dilewati.
    await admin.from("jejak_jadwal").delete().in("sesi_id", ids);
    await admin.from("jejak_status_bayar").delete().in("sesi_id", ids);
    await admin.from("sessions").delete().in("id", ids);
  }
  await admin.from("hak_sesi").delete().in("client_id", [ANANDA, RINA]);
  SESI_MILIK_UJI.clear();
}

/** Satu sesi terjadwal & lunas milik klien yang disebut. */
async function buatSesiUntuk(klien: string, tanggal: string, jam: string): Promise<string> {
  const { data, error } = await admin
    .from("sessions")
    .insert({
      client_id: klien,
      service_id: SVC,
      variant_id: VARIAN,
      partner_id: MITRA,
      tanggal,
      jam_mulai: jam,
      status: "terjadwal",
      status_bayar: "lunas",
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw error;
  catatSesi(data.id);
  return data.id;
}

/** Pintasan untuk klien uji utama. */
async function buatSesi(tanggal: string, jam: string): Promise<string> {
  return buatSesiUntuk(ANANDA, tanggal, jam);
}

/** Jam yang membuat sesi HARI INI berjarak `jam` dari sekarang, dalam WIB. */
function jamRelatif(jamDariSekarang: number): { tanggal: string; jam: string } {
  const t = new Date(Date.now() + jamDariSekarang * 3_600_000);
  // Digeser ke WIB lalu dipotong — kolomnya date + time menurut Jakarta.
  const wib = new Date(t.getTime() + 7 * 3_600_000);
  // Dibulatkan KE BAWAH ke kelipatan 30 menit: `sessions_jam_bulat` menolak
  // menit selain :00/:30. Membulatkan ke bawah memundurkan jam sesi, sehingga
  // justru memperKECIL jarak ke sekarang (maksimal 30 menit) — aman di sini
  // hanya karena offset yang dipakai (48/6/1 jam) jauh dari ambang jenjang
  // (24/2 jam). Siapa pun yang mempersempit offset mendekati ambang wajib
  // menghitung ulang apakah pembulatan ini masih tidak melintasinya.
  wib.setUTCMinutes(wib.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
  return {
    tanggal: wib.toISOString().slice(0, 10),
    jam: wib.toISOString().slice(11, 16),
  };
}

beforeAll(async () => {
  VARIAN = await varianBaku(admin, SVC);
  sesiKlien = await signInAs("ananda@padma.test");
  sesiAdmin = await signInAs("admin@padma.test");
  await bersihkan();
});

beforeEach(bersihkan);
afterAll(bersihkan);

describe("batalkan_sesi — jenjang menentukan akibat", () => {
  it("jenjang 1 (≥24 jam): sesi batal, TIDAK ada hak yang terbit", async () => {
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesi(tanggal, jam);

    const { data } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "",
      darurat: false,
      oleh: "klien",
    });

    expect(data.jenjang).toBe(1);
    expect(data.akibat).toBe("refund");
    expect(data.hak_id).toBeNull();

    const { count } = await admin
      .from("hak_sesi")
      .select("id", { count: "exact", head: true })
      .eq("client_id", ANANDA);
    expect(count).toBe(0);
  });

  it("jenjang 2 (2–24 jam): sesi batal DAN tepat satu hak terbit", async () => {
    const { tanggal, jam } = jamRelatif(6);
    const id = await buatSesi(tanggal, jam);

    const { data } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "",
      darurat: false,
      oleh: "klien",
    });

    expect(data.jenjang).toBe(2);
    expect(data.akibat).toBe("hak");
    expect(data.hak_id).not.toBeNull();

    const { data: hak } = await admin
      .from("hak_sesi")
      .select("service_id, kedaluwarsa, sesi_asal_id, dipakai_sesi_id")
      .eq("id", data.hak_id)
      .single();

    expect(hak!.service_id, "hak terkunci ke layanan yang sama").toBe(SVC);
    expect(hak!.sesi_asal_id).toBe(id);
    expect(hak!.dipakai_sesi_id).toBeNull();
    expect(hak!.kedaluwarsa, "30 hari sejak TANGGAL SESI").toBe(kedaluwarsaHak(tanggal));
  });

  it("jenjang 3 (<2 jam): batal tanpa hak dan tanpa refund", async () => {
    const { tanggal, jam } = jamRelatif(1);
    const id = await buatSesi(tanggal, jam);

    const { data } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "",
      darurat: false,
      oleh: "klien",
    });

    expect(data.jenjang).toBe(3);
    expect(data.akibat).toBe("hangus");
    expect(data.hak_id).toBeNull();
  });
});

describe("darurat medis menaikkan ke perlakuan jenjang 1", () => {
  it("sesi 1 jam lagi + darurat + alasan = jenjang 1", async () => {
    // "Ditinjau" di poster berarti keputusan MANUSIA. Sistem tidak pernah
    // mendeteksi keadaan darurat sendiri.
    const { tanggal, jam } = jamRelatif(1);
    const id = await buatSesi(tanggal, jam);

    const { data } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "Klien masuk rumah sakit, konfirmasi via WA 09.15",
      darurat: true,
      oleh: "klien",
    });

    expect(data.jenjang).toBe(1);
    expect(data.akibat).toBe("refund");
  });

  it("darurat TANPA alasan DITOLAK", async () => {
    // Pengecualian tanpa catatan adalah pengecualian yang tidak bisa ditinjau
    // siapa pun setelahnya.
    const { tanggal, jam } = jamRelatif(1);
    const id = await buatSesi(tanggal, jam);

    const { error } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "   ",
      darurat: true,
      oleh: "klien",
    });
    // Kode spesifik, bukan sekadar "ada galat": uji yang hanya menuntut
    // kehadiran galat tetap hijau ketika galatnya datang dari sebab lain sama
    // sekali.
    expect(error?.code).toBe("23514");
  });

  it("KLIEN tidak bisa menyatakan dirinya darurat", async () => {
    const { tanggal, jam } = jamRelatif(1);
    const id = await buatSesi(tanggal, jam);

    const { error } = await sesiKlien.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "darurat",
      darurat: true,
      oleh: "klien",
    });
    expect(error?.code).toBe("42501");
  });
});

describe("hak & kepemilikan", () => {
  it("klien TIDAK bisa membatalkan sesi orang lain walau tahu id-nya", async () => {
    // Sesinya milik RINA; yang mencoba adalah Ananda yang login. Arah ini
    // dipilih karena Rina sengaja tidak punya akun auth di seed — dan yang
    // sedang diuji memang penyerangnya, bukan korbannya.
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesiUntuk(RINA, tanggal, jam);

    const { data, error } = await sesiKlien.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "",
      darurat: false,
      oleh: "klien",
    });
    expect(data === null || error !== null).toBe(true);

    const { data: sesudah } = await admin
      .from("sessions")
      .select("status")
      .eq("id", id)
      .single();
    expect(sesudah!.status).toBe("terjadwal");
  });

  it("anon tidak bisa mengeksekusinya sama sekali", async () => {
    const baris = await querySql<{ ada: boolean }>(
      `select has_function_privilege('anon',
         'public.batalkan_sesi(uuid, text, boolean, text)', 'execute') as ada`,
    );
    expect(baris[0].ada).toBe(false);
  });
});

describe("idempotensi & jejak", () => {
  it("dipanggil DUA KALI tidak menerbitkan dua hak", async () => {
    // Klien yang menekan tombol dua kali karena jaringan lambat tidak boleh
    // mendapat dua kredit.
    const { tanggal, jam } = jamRelatif(6);
    const id = await buatSesi(tanggal, jam);

    await sesiAdmin.rpc("batalkan_sesi", { sesi_id: id, alasan: "", darurat: false, oleh: "klien" });
    const { data: kedua } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "",
      darurat: false,
      oleh: "klien",
    });

    expect(kedua, "panggilan kedua mengenai baris yang sudah batal").toBeNull();

    const { count } = await admin
      .from("hak_sesi")
      .select("id", { count: "exact", head: true })
      .eq("sesi_asal_id", id);
    expect(count).toBe(1);
  });

  it("mencatat jejak beraktor, berjenjang, dan bertanggal sesi asal", async () => {
    const { tanggal, jam } = jamRelatif(6);
    const id = await buatSesi(tanggal, jam);
    await sesiAdmin.rpc("batalkan_sesi", { sesi_id: id, alasan: "", darurat: false, oleh: "klien" });

    const { data: jejak } = await admin
      .from("jejak_jadwal")
      .select("tindakan, jenjang, dari_tanggal, peran_aktor, aktor_id")
      .eq("sesi_id", id)
      .single();

    expect(jejak!.tindakan).toBe("batal");
    expect(jejak!.jenjang).toBe(2);
    expect(jejak!.dari_tanggal).toBe(tanggal);
    expect(jejak!.peran_aktor).toBe("admin");
    expect(jejak!.aktor_id, "jejak tanpa aktor tidak bisa ditinjau").not.toBeNull();
  });

  it("oleh='padma' mencatat jenjang 4, bukan jenjang waktu", async () => {
    // Ini pembedaan yang paling mudah hilang: admin membatalkan sesi H-3 hari
    // BUKAN karena kliennya minta, melainkan karena PADMA berhalangan. Yang
    // membedakan bukan waktu melainkan siapa — dan hanya `dibatalkan_padma`
    // yang menyebutnya benar. Sejak perbaikan aktor, yang menyatakannya adalah
    // ARGUMEN `oleh`, bukan kehadiran teks di kotak alasan.
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesi(tanggal, jam);

    const { data } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "Bidan sakit mendadak",
      darurat: false,
      oleh: "padma",
    });
    expect(data.jenjang).toBe(4);

    const { data: sesudah } = await admin
      .from("sessions")
      .select("status")
      .eq("id", id)
      .single();
    expect(sesudah!.status).toBe("dibatalkan_padma");
  });
});

describe("aktor pembatalan — dinyatakan, tidak disimpulkan", () => {
  // Dua uji pertama di bawah adalah DUA KEGAGALAN UANG yang versi pertama
  // fungsi ini benar-benar bisa hasilkan dari satu-satunya layar yang hidup.
  // Keduanya berangkat dari aturan lama "staf DAN alasan tidak kosong DAN
  // bukan darurat → jenjang 4", sementara panel merender `alasan` sebagai
  // catatan biasa yang opsional.

  it("alasan yang diketik untuk pembatalan KLIEN tidak menjadikannya jenjang 4", async () => {
    // Skenario nyata: klien menelepon 6 jam sebelum sesi. Layar berkata
    // "jenjang 2 — dana menjadi hak sesi 30 hari". Admin mengetik "klien minta
    // batal" di kolom alasan. Di aturan LAMA basis data mencatat jenjang 4,
    // `dibatalkan_padma`, refund penuh, tanpa hak — dan jejaknya menyebut
    // PADMA yang membatalkan. Klien kehilangan kreditnya, klinik mengeluarkan
    // uang yang tidak seharusnya, dan catatannya salah menyebut siapa.
    const { tanggal, jam } = jamRelatif(6);
    const id = await buatSesi(tanggal, jam);

    const { data } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "klien minta batal",
      darurat: false,
      oleh: "klien",
    });

    expect(data.jenjang, "alasan bukan pernyataan aktor").toBe(2);
    expect(data.akibat).toBe("hak");
    expect(data.hak_id).not.toBeNull();
    expect(data.status).toBe("dibatalkan_klien");
  });

  it("PADMA membatalkan 1 jam sebelum sesi tetap jenjang 4, bukan hangus", async () => {
    // Skenario nyata: bidan sakit, admin membatalkan 1 jam sebelum sesi. Di
    // aturan LAMA, alasan yang dibiarkan kosong (memang opsional) menjatuhkan
    // panggilan ini ke cabang waktu: jenjang 3, hangus, `dibatalkan_klien`.
    // Klien sudah membayar, PADMA yang berhalangan, klien tidak menerima apa
    // pun, dan catatannya menyalahkan klien.
    const { tanggal, jam } = jamRelatif(1);
    const id = await buatSesi(tanggal, jam);

    const { data } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "Bidan sakit mendadak, dikabari 08.40",
      darurat: false,
      oleh: "padma",
    });

    expect(data.jenjang, "PADMA membatalkan SELALU jenjang 4").toBe(4);
    expect(data.akibat).toBe("refund");
    expect(data.status).toBe("dibatalkan_padma");
  });

  it("PADMA membatalkan TANPA alasan DITOLAK", async () => {
    // Jenjang 4 adalah satu-satunya jenjang yang uangnya keluar tanpa dituntut
    // waktu. Ia butuh pembenaran yang bisa ditinjau, persis seperti
    // pengecualian darurat.
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesi(tanggal, jam);

    const { error } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "  ",
      darurat: false,
      oleh: "padma",
    });
    expect(error?.code).toBe("23514");
  });

  it("KLIEN tidak bisa membatalkan atas nama PADMA", async () => {
    // Kalau bisa, setiap klien punya tombol refund penuh sendiri.
    const { tanggal, jam } = jamRelatif(1);
    const id = await buatSesi(tanggal, jam);

    const { error } = await sesiKlien.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "PADMA batal",
      darurat: false,
      oleh: "padma",
    });
    expect(error?.code).toBe("42501");
  });

  it("aktor yang tidak dikenal DITOLAK, bukan jatuh ke salah satu cabang", async () => {
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesi(tanggal, jam);

    const { error } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "",
      darurat: false,
      oleh: "entah",
    });
    expect(error?.code).toBe("22023");

    const { data: sesudah } = await admin
      .from("sessions")
      .select("status")
      .eq("id", id)
      .single();
    expect(sesudah!.status, "penolakan tidak menyentuh baris").toBe("terjadwal");
  });

  it("darurat + oleh='padma' DITOLAK — pengecualian itu milik pembatalan klien", async () => {
    // Jenjang 4 sudah refund penuh; menerima `darurat` di sini diam-diam
    // berarti admin mengira ia menerapkan sesuatu yang sebenarnya diabaikan.
    const { tanggal, jam } = jamRelatif(1);
    const id = await buatSesi(tanggal, jam);

    const { error } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "Bidan masuk IGD",
      darurat: true,
      oleh: "padma",
    });
    expect(error?.code).toBe("22023");
  });
});

describe("jadwal_ulang_sesi — baris yang SAMA berpindah", () => {
  it("jenjang 1: berpindah tanpa memakai jatah", async () => {
    // Poster memberi pilihan bebas di ≥24 jam: refund penuh ATAU jadwal ulang
    // gratis. Jatah hanya relevan di jendela 2–24 jam.
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesi(tanggal, jam);

    const { data } = await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-25",
      jam_baru: "10:00",
    });

    expect(data.jenjang).toBe(1);
    expect(data.jatah_terpakai).toBe(false);

    const { data: s } = await admin
      .from("sessions")
      .select("id, tanggal, jam_mulai, status, jadwal_ulang_terpakai")
      .eq("id", id)
      .single();

    expect(s!.id, "baris yang SAMA, bukan baris baru").toBe(id);
    expect(s!.tanggal).toBe("2027-09-25");
    expect(s!.jam_mulai).toBe("10:00:00");
    expect(s!.status).toBe("terjadwal");
    expect(s!.jadwal_ulang_terpakai).toBe(false);
  });

  it("jenjang 2: berpindah DAN jatahnya terpakai", async () => {
    const { tanggal, jam } = jamRelatif(6);
    const id = await buatSesi(tanggal, jam);

    const { data } = await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-25",
      jam_baru: "11:00",
    });

    expect(data.jenjang).toBe(2);
    expect(data.jatah_terpakai).toBe(true);

    const { data: s } = await admin
      .from("sessions")
      .select("jadwal_ulang_terpakai")
      .eq("id", id)
      .single();
    expect(s!.jadwal_ulang_terpakai).toBe(true);
  });

  it("jatah HABIS: percobaan kedua di jendela 2–24 jam DITOLAK", async () => {
    // Sesudah jatahnya habis, klien yang tetap ingin berubah harus MEMBATALKAN
    // — dan pembatalan di jendela ini menerbitkan kredit 30 hari. Yang ditolak
    // di sini adalah perpindahannya, bukan haknya untuk berubah.
    const { tanggal, jam } = jamRelatif(6);
    const id = await buatSesi(tanggal, jam);

    await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-25",
      jam_baru: "11:00",
    });
    // Sesi kini bertanggal jauh; digeser kembali ke jendela 2–24 jam supaya
    // percobaan kedua benar-benar diuji pada jenjang yang sama.
    const dekat = jamRelatif(6);
    await admin
      .from("sessions")
      .update({ tanggal: dekat.tanggal, jam_mulai: dekat.jam })
      .eq("id", id);

    const { error } = await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-26",
      jam_baru: "11:00",
    });
    expect(error).not.toBeNull();
  });

  it("jenjang 3 (<2 jam): jadwal ulang DITOLAK — itu pemesanan baru", async () => {
    const { tanggal, jam } = jamRelatif(1);
    const id = await buatSesi(tanggal, jam);

    const { error } = await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-25",
      jam_baru: "12:00",
    });
    expect(error).not.toBeNull();
  });
});

describe("jadwal ulang tunduk pada pagar yang sama dengan pemesanan", () => {
  it("jam DI LUAR app_settings.jam_layanan DITOLAK", async () => {
    // Pagar ini TIDAK diwarisi: `guard_booking_pembatas` adalah trigger
    // `before insert on booking_requests` dan tidak pernah melihat `sessions`.
    // Ia harus ditegakkan di dalam fungsi ini, membaca kunci `app_settings`
    // yang sama supaya jam buka klinik tidak punya dua sumber.
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesi(tanggal, jam);

    const { error } = await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-25",
      jam_baru: "03:00",
    });
    expect(error).not.toBeNull();
  });

  it("pagar jam BEKERJA untuk sesi klien, bukan diam karena RLS", async () => {
    // C1-a sudah menemukan jebakannya sekali: `guard_booking_pembatas` bersifat
    // SECURITY INVOKER, sehingga ia membaca `app_settings` sebagai klien,
    // mendapat NOL BARIS karena policy, lalu DIAM alih-alih menolak. Pagar yang
    // membaca pengaturannya dengan hak pemanggil adalah pagar yang mati tanpa
    // suara. Uji ini dijalankan dengan sesi KLIEN sungguhan — dijalankan dengan
    // service role, ia lolos vakum.
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesi(tanggal, jam);

    const { error } = await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-25",
      jam_baru: "23:00",
    });
    expect(error, "pagar jam DIAM di sesi klien — RLS menelan app_settings").not.toBeNull();
  });

  it("bidan yang sudah terisi pada jam itu DITOLAK", async () => {
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesi(tanggal, jam);
    await buatSesi("2027-09-25", "10:00"); // bidan sama, slot terisi

    const { error } = await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-25",
      jam_baru: "10:00",
    });
    expect(error).not.toBeNull();
  });

  it("mencatat perpindahannya di jejak: dari mana, ke mana", async () => {
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesi(tanggal, jam);
    await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-25",
      jam_baru: "13:00",
    });

    const { data: jejak } = await admin
      .from("jejak_jadwal")
      .select("tindakan, dari_tanggal, ke_tanggal, ke_jam")
      .eq("sesi_id", id)
      .single();

    expect(jejak!.tindakan).toBe("jadwal_ulang");
    expect(jejak!.dari_tanggal).toBe(tanggal);
    expect(jejak!.ke_tanggal).toBe("2027-09-25");
    expect(jejak!.ke_jam).toBe("13:00:00");
  });
});

describe("tukar_hak_sesi — hak menjadi sesi baru", () => {
  async function terbitkanHak(kedaluwarsa: string): Promise<string> {
    const { data, error } = await admin
      .from("hak_sesi")
      .insert({ client_id: ANANDA, service_id: SVC, kedaluwarsa })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;
    return data.id;
  }

  it("melahirkan sesi terjadwal yang sudah LUNAS", async () => {
    // Uangnya sudah dibayar untuk sesi yang batal. Sesi penggantinya lahir
    // lunas — tanpa itu klien menerima tagihan kedua untuk sesi yang sudah ia
    // bayar, persis kesalahan yang C2 tutup saat sesi lahir dari konfirmasi.
    const hak = await terbitkanHak("2027-12-31");

    const { data: sesiBaru } = await sesiAdmin.rpc("tukar_hak_sesi", {
      hak_id: hak,
      tanggal_baru: "2027-09-25",
      jam_baru: "14:00",
      mitra: MITRA,
    });
    catatSesi(sesiBaru);

    const { data: s } = await admin
      .from("sessions")
      .select("status, status_bayar, service_id, client_id")
      .eq("id", sesiBaru)
      .single();

    expect(s!.status).toBe("terjadwal");
    expect(s!.status_bayar).toBe("lunas");
    expect(s!.service_id).toBe(SVC);
    expect(s!.client_id).toBe(ANANDA);
  });

  it("hak yang sudah dipakai TIDAK bisa dipakai lagi", async () => {
    const hak = await terbitkanHak("2027-12-31");
    const { data: pertama } = await sesiAdmin.rpc("tukar_hak_sesi", {
      hak_id: hak,
      tanggal_baru: "2027-09-25",
      jam_baru: "15:00",
      mitra: MITRA,
    });
    catatSesi(pertama);

    const { data: kedua, error } = await sesiAdmin.rpc("tukar_hak_sesi", {
      hak_id: hak,
      tanggal_baru: "2027-09-26",
      jam_baru: "15:00",
      mitra: MITRA,
    });
    catatSesi(kedua);
    expect(kedua === null || error !== null).toBe(true);
  });

  it("hak KEDALUWARSA ditolak — dan ditolaknya di basis data", async () => {
    // Pemeriksaannya di sini, bukan di TypeScript: kedaluwarsa yang hanya
    // diperiksa di layar adalah kedaluwarsa yang bisa dilewati satu panggilan
    // RPC.
    const hak = await terbitkanHak("2020-01-01");

    const { data, error } = await sesiAdmin.rpc("tukar_hak_sesi", {
      hak_id: hak,
      tanggal_baru: "2027-09-25",
      jam_baru: "16:00",
      mitra: MITRA,
    });
    catatSesi(data);
    expect(error).not.toBeNull();
  });

  it("klien tidak bisa menukar hak milik orang lain", async () => {
    // Haknya milik RINA; Ananda yang login mencobanya.
    const { data: h, error: eh } = await admin
      .from("hak_sesi")
      .insert({ client_id: RINA, service_id: SVC, kedaluwarsa: "2027-12-31" })
      .select("id")
      .single<{ id: string }>();
    if (eh) throw eh;
    const hak = h.id;

    // 16:00 dan BUKAN 17:00: jam layanan seed hanya
    // 08,09,10,11,13,14,15,16. Memakai jam di luar daftar membuat uji ini
    // hijau karena jamnya tak sah, bukan karena kepemilikannya ditolak — uji
    // yang lolos karena sebab lain tidak menjaga apa pun.
    const { data, error } = await sesiKlien.rpc("tukar_hak_sesi", {
      hak_id: hak,
      tanggal_baru: "2027-09-25",
      jam_baru: "16:00",
      mitra: MITRA,
    });
    catatSesi(data);
    expect(data === null || error !== null).toBe(true);
  });
});

describe("balapan — dua panggilan bersamaan tidak boleh melahirkan dua akibat", () => {
  it("10 tukar_hak_sesi SERENTAK atas SATU hak → tepat satu sesi lahir", async () => {
    const { data: h, error: eh } = await admin
      .from("hak_sesi")
      .insert({ client_id: ANANDA, service_id: SVC, kedaluwarsa: "2027-12-31" })
      .select("id")
      .single<{ id: string }>();
    if (eh) throw eh;
    const hak = h.id;

    // Sepuluh percobaan, jam berbeda-beda supaya kegagalan bidan-bentrok tidak
    // ikut campur — satu-satunya yang boleh menggagalkan sembilan lainnya
    // adalah hak yang sudah terpakai.
    const jamPilihan = ["08:00", "09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "08:00", "09:00"];
    const hasil = await Promise.all(
      jamPilihan.map((jam, i) =>
        sesiAdmin.rpc("tukar_hak_sesi", {
          hak_id: hak,
          tanggal_baru: i < 8 ? "2027-09-25" : "2027-09-26",
          jam_baru: jam,
          mitra: MITRA,
        }),
      ),
    );
    // Dicatat untuk `bersihkan()` walau kesepuluh percobaan gagal kecuali satu:
    // `data` yang null bagi sembilan panggilan yang kalah cukup diabaikan oleh
    // `catatSesi()` sendiri.
    hasil.forEach((r) => catatSesi(r.data));

    // Basis data yang membuktikan, bukan nilai kembalian RPC: hitung sesi yang
    // benar-benar lahir dari klien ini di tanggal-tanggal percobaan.
    const { data: sesiLahir } = await admin
      .from("sessions")
      .select("id")
      .eq("client_id", ANANDA)
      .in("tanggal", ["2027-09-25", "2027-09-26"]);
    expect(sesiLahir).toHaveLength(1);

    const { data: hakSesudah } = await admin
      .from("hak_sesi")
      .select("dipakai_sesi_id")
      .eq("id", hak)
      .single();
    expect(hakSesudah!.dipakai_sesi_id).toBe(sesiLahir![0].id);
  });

  it("2 jadwal_ulang_sesi SERENTAK atas satu sesi jenjang 2 → tepat satu berhasil", async () => {
    const { tanggal, jam } = jamRelatif(6);
    const id = await buatSesi(tanggal, jam);

    // Sasaran perpindahan sengaja dekat (jendela 2–24 jam), BUKAN tanggal jauh
    // tetap ("2027-09-25" dst): jika sasarannya jauh, panggilan kedua yang
    // menunggu kunci lalu membaca baris yang SUDAH dipindah pertama akan
    // menghitung jenjangnya sendiri sebagai 1 (≥24 jam dari sekarang) dan lolos
    // sebagai perpindahan gratis kedua — bukan balapan yang gagal ditangkap,
    // melainkan aturan jenjang yang memang berbeda untuk sesi yang sudah jauh.
    // Sasaran yang tetap berada di jendela jenjang 2 menjaga uji ini benar-benar
    // menguji jatah, bukan menguji sesuatu yang lain.
    const hasil = await Promise.all([
      sesiKlien.rpc("jadwal_ulang_sesi", {
        sesi_id: id,
        tanggal_baru: SLOT_BALAPAN.tanggal,
        jam_baru: SLOT_BALAPAN.jam,
      }),
      sesiKlien.rpc("jadwal_ulang_sesi", {
        sesi_id: id,
        tanggal_baru: SLOT_BALAPAN.tanggal,
        jam_baru: SLOT_BALAPAN.jam,
      }),
    ]);

    const berhasil = hasil.filter((r) => r.error === null && r.data !== null);
    expect(berhasil).toHaveLength(1);

    const { data: s } = await admin
      .from("sessions")
      .select("jadwal_ulang_terpakai")
      .eq("id", id)
      .single();
    expect(s!.jadwal_ulang_terpakai).toBe(true);

    const { data: jejak } = await admin.from("jejak_jadwal").select("id").eq("sesi_id", id);
    expect(jejak).toHaveLength(1);
  });
});
