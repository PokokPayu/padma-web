import { describe, it, expect } from "vitest";
import { periksaPekan, PESAN, pesanKodePostgres } from "@/app/owner/rekap/status";

// ===========================================================================
// periksaPekan — gerbang bentuk `week_start` sebuah tanda bayar
// ===========================================================================
// Berjalan tanpa Supabase: validatornya murni, dan `hariIni` selalu diberikan
// pemanggil justru supaya pekan mana pun bisa diuji tanpa menyentuh jam.
//
// Sesudah butir 4, pekan honor dimulai SABTU. Tanda bertanggal Senin kini
// tidak akan pernah cocok dengan ember rekap mana pun — honornya terlihat
// "belum dibayar" selamanya sementara uangnya sudah ditransfer, dan tandanya
// TIDAK BISA dihapus (DELETE atas honor_marks sudah dicabut, owner pun
// dijawab 42501). Karena itu penolakannya harus terjadi SEBELUM baris lahir.

const SABTU = "2026-09-19";       // awal pekan yang memuat 22 Sep
const SELASA = "2026-09-22";      // "hari ini" di seluruh berkas ini

describe("periksaPekan — hari awal pekan", () => {
  it("menerima hari Sabtu", () => {
    expect(periksaPekan(SABTU, SELASA)).toEqual({ ok: true, nilai: SABTU });
  });

  it("menolak hari Senin — hari awal pekan yang LAMA", () => {
    const hasil = periksaPekan("2026-09-21", SELASA);
    expect(hasil.ok).toBe(false);
    expect(hasil.ok === false && hasil.pesan).toBe(PESAN.bukanSabtu);
  });

  it("menolak kelima hari lain dalam pekannya", () => {
    // Minggu s.d. Jumat — seluruh sisa pekan, bukan hanya satu contoh.
    for (const t of ["2026-09-20", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"]) {
      const hasil = periksaPekan(t, "2026-09-30");
      expect(hasil.ok, `${t} harus ditolak`).toBe(false);
    }
  });

  it("pesannya menyebut Sabtu, bukan Senin", () => {
    expect(PESAN.bukanSabtu).toMatch(/sabtu/i);
    expect(PESAN.bukanSabtu).not.toMatch(/senin/i);
  });

  it("CHECK basis data yang dilanggar (23514) diterjemahkan ke kalimat yang sama", () => {
    // Satu-satunya CHECK pada honor_marks yang bisa dilanggar peran aplikasi
    // adalah bentuk hari week_start. Menerjemahkannya ke kalimat lain berarti
    // pemilik klinik membaca SQLSTATE.
    expect(pesanKodePostgres("23514")).toBe(PESAN.bukanSabtu);
  });
});

describe("periksaPekan — pekan yang belum berjalan", () => {
  it("pekan berjalan tetap boleh ditandai", () => {
    // Sengaja dipertahankan longgar. Gajian jatuh Sabtu, dan Sabtu kini hari
    // PERTAMA pekannya — jadi menandai pekan berjalan berarti membayar di muka.
    // Itu keputusan pemilik klinik, bukan keputusan validator ini.
    expect(periksaPekan(SABTU, SELASA).ok).toBe(true);
  });

  it("pekan berikutnya ditolak — tandanya tidak bisa dicabut", () => {
    const hasil = periksaPekan("2026-09-26", SELASA); // Sabtu pekan depan
    expect(hasil.ok).toBe(false);
    expect(hasil.ok === false && hasil.pesan).toBe(PESAN.pekanBelumBerjalan);
  });

  it("pekan yang sudah lewat diterima", () => {
    expect(periksaPekan("2026-09-12", SELASA).ok).toBe(true); // Sabtu sebelumnya
  });
});

describe("periksaPekan — bentuk tanggal", () => {
  it("menolak yang bukan YYYY-MM-DD", () => {
    for (const buruk of ["", "19-09-2026", "2026-9-19", "2026-09-19T00:00:00Z"]) {
      const hasil = periksaPekan(buruk, SELASA);
      expect(hasil.ok, buruk).toBe(false);
      expect(hasil.ok === false && hasil.pesan, buruk).toBe(PESAN.pekanTakSah);
    }
  });

  it("menolak tanggal yang cocok polanya tapi tidak ada di kalender", () => {
    const hasil = periksaPekan("2026-02-31", SELASA);
    expect(hasil.ok).toBe(false);
    expect(hasil.ok === false && hasil.pesan).toMatch(/tidak ada di kalender/i);
  });
});
