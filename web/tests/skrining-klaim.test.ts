/**
 * TOKEN KLAIM SKRINING (spec C1 J4).
 *
 * Yang dijaga berkas ini adalah satu kalimat: jawaban kesehatan seseorang tidak
 * boleh berakhir di Passport orang lain. Setiap uji di bawah adalah satu cara
 * hal itu bisa terjadi.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  buatTokenKlaim,
  hashTokenKlaim,
  terbitkanTokenKlaim,
  klaimSkrining,
  KLAIM_TTL_JAM,
} from "@/lib/skrining/klaim";
import { querySql } from "./helpers/db";

const admin = createAdminSupabase();

const ANANDA = "44444444-4444-4444-4444-444444444401";
const RINA = "44444444-4444-4444-4444-444444444402";

/** Skrining ANONIM — persis bentuk yang lahir dari corong landing. */
async function skriningAnonim(fase = "kehamilan", nama = "Sari Anonim"): Promise<string> {
  const { data, error } = await admin
    .from("screenings")
    .insert({
      kode: `UJI-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
      nama,
      no_hp: "0800-1111-2222",
      fase,
      jawaban: {},
      hasil: "hijau",
      flags: [],
      // client_id sengaja NULL: inilah yang membedakan skrining corong dari
      // skrining yang lahir di dalam Passport.
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw error;
  return data.id;
}

async function faseKlien(id: string): Promise<string | null> {
  const { data } = await admin
    .from("clients")
    .select("phase_id")
    .eq("id", id)
    .maybeSingle<{ phase_id: string | null }>();
  return data?.phase_id ?? null;
}

let faseAsliAnanda: string | null = null;
let faseAsliRina: string | null = null;

async function bersihkan() {
  await admin.from("screenings").delete().like("kode", "UJI-%");
}

beforeAll(async () => {
  faseAsliAnanda = await faseKlien(ANANDA);
  faseAsliRina = await faseKlien(RINA);
  await bersihkan();
});

beforeEach(bersihkan);

afterAll(async () => {
  await bersihkan();
  // Fase dikembalikan: berkas uji lain mengasersikan sampul Passport klien ini.
  await admin.from("clients").update({ phase_id: faseAsliAnanda }).eq("id", ANANDA);
  await admin.from("clients").update({ phase_id: faseAsliRina }).eq("id", RINA);
});

describe("bentuk token", () => {
  it("32 byte acak, dan dua panggilan tidak pernah sama", () => {
    const a = buatTokenKlaim();
    const b = buatTokenKlaim();
    expect(a).not.toBe(b);
    // base64url dari 32 byte = 43 karakter tanpa padding.
    expect(a.length).toBe(43);
  });

  it("yang disimpan adalah HASH, bukan tokennya", async () => {
    const s = await skriningAnonim();
    const token = await terbitkanTokenKlaim(s);

    const baris = await querySql<{ token_hash: string }>(
      "select token_hash from public.screening_claims where screening_id = $1",
      [s],
    );
    expect(baris[0].token_hash).toBe(hashTokenKlaim(token));
    expect(baris[0].token_hash).not.toBe(token);
  });

  it("umurnya 2 jam", async () => {
    const s = await skriningAnonim();
    await terbitkanTokenKlaim(s);
    const [{ jam }] = await querySql<{ jam: number }>(
      `select extract(epoch from (expires_at - now())) / 3600 as jam
         from public.screening_claims where screening_id = $1`,
      [s],
    );
    expect(Number(jam)).toBeGreaterThan(KLAIM_TTL_JAM - 0.1);
    expect(Number(jam)).toBeLessThanOrEqual(KLAIM_TTL_JAM);
  });
});

describe("klaim", () => {
  it("menyambungkan skrining ke klien, dan MENYEBUT NAMANYA", async () => {
    // Nama dipulangkan supaya Passport bisa menyebutkannya terbuka. Itu satu-
    // satunya pertahanan terhadap perangkat bersama yang tidak bergantung pada
    // waktu: salah sambung menjadi terlihat.
    const s = await skriningAnonim("kehamilan", "Sari Wulandari");
    const token = await terbitkanTokenKlaim(s);

    const hasil = await klaimSkrining(token, ANANDA);
    expect(hasil.ok).toBe(true);
    expect(hasil.ok === true && hasil.nama).toBe("Sari Wulandari");

    const { data } = await admin
      .from("screenings")
      .select("client_id")
      .eq("id", s)
      .maybeSingle<{ client_id: string }>();
    expect(data?.client_id).toBe(ANANDA);
  });

  it("SEKALI PAKAI — token yang sama ditolak pada percobaan kedua", async () => {
    const s = await skriningAnonim();
    const token = await terbitkanTokenKlaim(s);

    expect((await klaimSkrining(token, ANANDA)).ok).toBe(true);
    expect((await klaimSkrining(token, RINA)).ok).toBe(false);
  });

  it("DUA klaim BERSAMAAN hanya menghasilkan satu pemenang", async () => {
    // Inilah yang membuat "sekali pakai" berlaku terhadap balapan, bukan hanya
    // terhadap urutan. Tanpa filter `used_at is null` di dalam UPDATE, dua
    // akun bisa sama-sama menang dan skrining berpindah dua kali.
    const s = await skriningAnonim();
    const token = await terbitkanTokenKlaim(s);

    const hasil = await Promise.all([
      klaimSkrining(token, ANANDA),
      klaimSkrining(token, RINA),
    ]);
    expect(hasil.filter((h) => h.ok).length).toBe(1);
  });

  it("token KEDALUWARSA ditolak", async () => {
    const s = await skriningAnonim();
    const token = await terbitkanTokenKlaim(s);
    await querySql(
      "update public.screening_claims set expires_at = now() - interval '1 minute' where screening_id = $1",
      [s],
    );
    expect((await klaimSkrining(token, ANANDA)).ok).toBe(false);

    const { data } = await admin
      .from("screenings")
      .select("client_id")
      .eq("id", s)
      .maybeSingle<{ client_id: string | null }>();
    expect(data?.client_id).toBeNull();
  });

  it("token karangan ditolak, tanpa melempar", async () => {
    // Jalur pemanggilnya adalah pendaftaran. Pendaftaran tidak boleh gagal
    // hanya karena cookie basi atau dikarang orang.
    expect((await klaimSkrining("bukan-token-sungguhan", ANANDA)).ok).toBe(false);
    expect((await klaimSkrining("", ANANDA)).ok).toBe(false);
  });

  it("skrining yang SUDAH bertuan tidak bisa direbut", async () => {
    const s = await skriningAnonim();
    const token = await terbitkanTokenKlaim(s);
    await admin.from("screenings").update({ client_id: RINA }).eq("id", s);

    expect((await klaimSkrining(token, ANANDA)).ok).toBe(false);

    const { data } = await admin
      .from("screenings")
      .select("client_id")
      .eq("id", s)
      .maybeSingle<{ client_id: string }>();
    expect(data?.client_id).toBe(RINA);
  });
});

describe("fase klien terisi dari skrining pertama (spec J11)", () => {
  it("fase yang KOSONG terisi dari skrining", async () => {
    await admin.from("clients").update({ phase_id: null }).eq("id", ANANDA);
    const s = await skriningAnonim("nifas");
    const token = await terbitkanTokenKlaim(s);

    const hasil = await klaimSkrining(token, ANANDA);
    expect(hasil.ok === true && hasil.fase).toBe("nifas");
    expect(await faseKlien(ANANDA)).toBe("nifas");
  });

  it("fase yang SUDAH terisi TIDAK digeser skrining berikutnya", async () => {
    // Fase bisa ditetapkan admin dari percakapan yang tidak pernah masuk
    // wizard. Skrining kedua yang menimpanya diam-diam akan memindahkan klien
    // ke lini layanan yang salah.
    await admin.from("clients").update({ phase_id: "kehamilan" }).eq("id", ANANDA);
    const s = await skriningAnonim("menopause");
    const token = await terbitkanTokenKlaim(s);

    const hasil = await klaimSkrining(token, ANANDA);
    expect(hasil.ok).toBe(true);
    expect(hasil.ok === true && hasil.fase).toBeNull();
    expect(await faseKlien(ANANDA)).toBe("kehamilan");
  });

  it("NAMA & NO. HP akun TIDAK pernah tertimpa skrining", async () => {
    // Skrining diisi anonim di landing, dan bisa saja ditulis orang lain —
    // suami yang mengisikan untuk istrinya, atau resepsionis yang membantu.
    // Menimpakannya ke akun berarti membiarkan corong publik menulis ulang
    // identitas seseorang.
    const { data: sebelum } = await admin
      .from("clients")
      .select("nama, no_hp")
      .eq("id", ANANDA)
      .maybeSingle<{ nama: string; no_hp: string }>();

    const s = await skriningAnonim("kehamilan", "Nama Dari Skrining");
    const token = await terbitkanTokenKlaim(s);
    await klaimSkrining(token, ANANDA);

    const { data: sesudah } = await admin
      .from("clients")
      .select("nama, no_hp")
      .eq("id", ANANDA)
      .maybeSingle<{ nama: string; no_hp: string }>();

    expect(sesudah?.nama).toBe(sebelum?.nama);
    expect(sesudah?.no_hp).toBe(sebelum?.no_hp);
  });
});
