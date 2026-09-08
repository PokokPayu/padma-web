/**
 * BATAS GERBANG: dua fungsi penaut TIDAK BOLEH TERJANGKAU oleh user yang
 * emailnya belum terbukti.
 *
 * Kenapa berkas ini ada, padahal `tests/penautan-email-terverifikasi.test.ts`
 * sudah menguji perilaku gerbang dari basis data: dicoba sungguhan (8 Sep 2026)
 * — memindahkan penjaga `email_confirmed_at` ke BAWAH dua langkah yang
 * dijaganya membuat kedua belas perkara perilaku di sana tetap HIJAU, karena
 * kedua fungsi memeriksa ulang sendiri. Pertahanan berlapis menyembunyikan
 * matinya lapis pertama.
 *
 * Berkas itu menutupnya dengan pemindaian teks, dan pemindaian teks memang
 * menangkap mutasi tersebut — tetapi ia menjaga POSISI TULISAN, bukan aliran
 * kendali: `indexOf` mengambil kecocokan pertama di mana saja termasuk di dalam
 * komentar, sehingga satu kalimat tambahan di blok dokumentasi bisa
 * menghijaukannya selamanya; dan ia tetap hijau bila penjaganya ada tetapi lupa
 * `return`.
 *
 * Di sini batasnya yang di-mock, sehingga yang diasersikan adalah KONTRAK
 * gerbangnya: untuk user yang belum terbukti, kedua fungsi itu tidak pernah
 * dipanggil sama sekali. Stub-nya sengaja dibuat "longgar" — ia memulangkan
 * `true` tanpa memeriksa `email_confirmed_at` — persis supaya matinya penjaga
 * di gerbang tidak bisa lagi ditutupi oleh lapis kedua. Tidak ada basis data
 * yang disentuh berkas ini.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User } from "@supabase/supabase-js";

vi.mock("@/lib/auth/link-client", () => ({
  isClientLinked: vi.fn(async () => false),
  linkClientByInvite: vi.fn(async () => false),
  // SENGAJA mengabaikan `email_confirmed_at`: stub ini adalah lapis kedua yang
  // dicopot, supaya yang diuji benar-benar lapis pertama.
  tautkanKlienLewatEmailTerverifikasi: vi.fn(async () => true),
  terbitkanKlienMandiri: vi.fn(async () => true),
}));

import { pastikanKlien } from "@/lib/auth/pastikan-klien";
import {
  isClientLinked,
  linkClientByInvite,
  tautkanKlienLewatEmailTerverifikasi,
  terbitkanKlienMandiri,
} from "@/lib/auth/link-client";

function pengguna(terkonfirmasi: boolean): User {
  return {
    id: "00000000-0000-0000-0000-0000000000aa",
    email: "uji@padma.test",
    email_confirmed_at: terkonfirmasi ? "2026-09-08T00:00:00.000Z" : undefined,
    user_metadata: {},
    app_metadata: {},
    aud: "authenticated",
    created_at: "2026-09-08T00:00:00.000Z",
  } as unknown as User;
}

beforeEach(() => {
  vi.mocked(isClientLinked).mockResolvedValue(false);
  vi.mocked(linkClientByInvite).mockResolvedValue(false);
  vi.mocked(tautkanKlienLewatEmailTerverifikasi).mockResolvedValue(true);
  vi.mocked(terbitkanKlienMandiri).mockResolvedValue(true);
  vi.clearAllMocks();
});

describe("gerbang: batas terhadap user yang emailnya belum terbukti", () => {
  it("email belum terkonfirmasi -> /periksa-email, dan KEDUA penaut tidak pernah dipanggil", async () => {
    const tujuan = await pastikanKlien(pengguna(false), "");

    expect(tujuan).toBe("/periksa-email");
    expect(tautkanKlienLewatEmailTerverifikasi).not.toHaveBeenCalled();
    expect(terbitkanKlienMandiri).not.toHaveBeenCalled();
  });

  it("penjaga berdiri di atas PENERBITAN juga, bukan hanya di atas penautan", async () => {
    // Dipisah dari perkara di atas supaya matinya penjaga terhadap salah satu
    // langkah tidak tersembunyi di balik langkah yang lain: di sini penautan
    // memang gagal, jadi satu-satunya yang bisa menyelamatkan adalah penjaga.
    vi.mocked(tautkanKlienLewatEmailTerverifikasi).mockResolvedValue(false);

    expect(await pastikanKlien(pengguna(false), "")).toBe("/periksa-email");
    expect(terbitkanKlienMandiri).not.toHaveBeenCalled();
  });

  it("token undangan tetap dicoba lebih dulu — dan cukup, walau email belum terbukti", async () => {
    // Undangan adalah bukti yang LEBIH kuat: ia menyatakan tim PADMA memang
    // bermaksud menautkan akun ini. Kontrak itu ikut dikunci di sini supaya
    // tidak ikut hilang ketika seseorang merapikan urutannya.
    vi.mocked(linkClientByInvite).mockResolvedValue(true);

    expect(await pastikanKlien(pengguna(false), "token-sah")).toBe("/passport");
    expect(linkClientByInvite).toHaveBeenCalledOnce();
    expect(tautkanKlienLewatEmailTerverifikasi).not.toHaveBeenCalled();
    expect(terbitkanKlienMandiri).not.toHaveBeenCalled();
  });

  it("KONTROL POSITIF: email terkonfirmasi memang mencapai kedua langkah", async () => {
    // Tanpa perkara ini, "tidak pernah dipanggil" di atas bisa lulus hanya
    // karena gerbangnya rusak dan tidak pernah mencapai apa pun.
    expect(await pastikanKlien(pengguna(true), "")).toBe("/passport");
    expect(tautkanKlienLewatEmailTerverifikasi).toHaveBeenCalledOnce();

    vi.mocked(tautkanKlienLewatEmailTerverifikasi).mockResolvedValue(false);
    expect(await pastikanKlien(pengguna(true), "")).toBe("/passport");
    expect(terbitkanKlienMandiri).toHaveBeenCalledOnce();
  });

  it("semua gagal -> /akun-belum-terhubung, sesudah memeriksa ulang langkah 1", async () => {
    vi.mocked(tautkanKlienLewatEmailTerverifikasi).mockResolvedValue(false);
    vi.mocked(terbitkanKlienMandiri).mockResolvedValue(false);

    expect(await pastikanKlien(pengguna(true), "")).toBe("/akun-belum-terhubung");
    // Langkah 1 dijalankan DUA kali: sekali di awal, sekali sebagai pemeriksaan
    // ulang sesudah kalah balapan.
    expect(isClientLinked).toHaveBeenCalledTimes(2);
  });

  it("kalah balapan: baris lahir dari permintaan lain -> /passport, bukan buntu", async () => {
    vi.mocked(tautkanKlienLewatEmailTerverifikasi).mockResolvedValue(false);
    vi.mocked(terbitkanKlienMandiri).mockResolvedValue(false);
    vi.mocked(isClientLinked)
      .mockResolvedValueOnce(false) // langkah 1
      .mockResolvedValueOnce(true); // pemeriksaan ulang: permintaan kembar menang

    expect(await pastikanKlien(pengguna(true), "")).toBe("/passport");
  });
});
