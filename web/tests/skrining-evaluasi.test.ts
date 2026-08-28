import { describe, it, expect } from "vitest";
import {
  SOAL_UMUM, SOAL_FASE, daftarSoal, levelSoal, LABEL_FASE,
  type FaseSkrining,
} from "@/lib/skrining/bank-soal";
import { nilaiSkrining } from "@/lib/skrining/evaluasi";

const SEMUA_FASE: FaseSkrining[] = ["prekonsepsi", "kehamilan", "nifas", "menopause"];

describe("bank soal — integritas triase", () => {
  it("jumlah soal persis seperti sumber medis", () => {
    expect(SOAL_UMUM).toHaveLength(7);
    expect(SOAL_FASE.prekonsepsi).toHaveLength(3);
    expect(SOAL_FASE.kehamilan).toHaveLength(5);
    expect(SOAL_FASE.nifas).toHaveLength(5);
    expect(SOAL_FASE.menopause).toHaveLength(4);
  });

  it("urutan triase: dua soal pertama adalah urgent kardiorespirasi & nyeri hebat", () => {
    expect(SOAL_UMUM[0].id).toBe("cardioresp");
    expect(SOAL_UMUM[1].id).toBe("severe_pain");
    expect(levelSoal(SOAL_UMUM[0], "prekonsepsi")).toBe("urgent");
    expect(levelSoal(SOAL_UMUM[1], "prekonsepsi")).toBe("urgent");
  });

  it("fase newborn TIDAK ada di skrining (yang diskrining ibunya)", () => {
    expect(Object.keys(SOAL_FASE).sort()).toEqual(
      ["kehamilan", "menopause", "nifas", "prekonsepsi"],
    );
    expect(Object.keys(LABEL_FASE)).not.toContain("newborn");
  });

  it("setiap soal punya id unik", () => {
    const semua = SEMUA_FASE.flatMap((f) => daftarSoal(f).map((s) => s.id));
    const perFase = SEMUA_FASE.map((f) => daftarSoal(f).map((s) => s.id));
    perFase.forEach((ids) => expect(new Set(ids).size).toBe(ids.length));
    expect(semua.length).toBeGreaterThan(0);
  });

  it("pp_mental tetap urgent dan tidak dipindah ke akhir", () => {
    const idx = SOAL_FASE.nifas.findIndex((s) => s.id === "pp_mental");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(levelSoal(SOAL_FASE.nifas[idx], "nifas")).toBe("urgent");
  });
});

describe("PAGAR KESELAMATAN: level demam bergantung fase", () => {
  const fever = SOAL_UMUM.find((s) => s.id === "fever")!;

  it("demam pada KEHAMILAN = urgent", () => {
    expect(levelSoal(fever, "kehamilan")).toBe("urgent");
  });
  it("demam pada NIFAS = urgent", () => {
    expect(levelSoal(fever, "nifas")).toBe("urgent");
  });
  it("demam pada PREKONSEPSI = review", () => {
    expect(levelSoal(fever, "prekonsepsi")).toBe("review");
  });
  it("demam pada MENOPAUSE = review", () => {
    expect(levelSoal(fever, "menopause")).toBe("review");
  });

  it("demam saat hamil menghentikan skrining (urgent), saat prekonsepsi tidak", () => {
    const hamil = nilaiSkrining("kehamilan", { cardioresp: false, severe_pain: false, fever: true });
    expect(hamil.hasil).toBe("merah");
    expect(hamil.urgent).toBe(true);
    expect(hamil.dihentikanPada).toBe("fever");

    const pre = nilaiSkrining("prekonsepsi", {
      cardioresp: false, severe_pain: false, fever: true, acute_infection: false,
      skin_wound: false, recent_procedure: false, restriction: false,
      pre_heavy_bleeding: false, pre_abnormal_bleeding: false, possible_pregnancy: false,
    });
    expect(pre.hasil).toBe("merah");
    expect(pre.urgent).toBe(false);
    expect(pre.dihentikanPada).toBeNull();
  });
});

describe("nilaiSkrining", () => {
  const semuaTidak = (fase: FaseSkrining) =>
    Object.fromEntries(daftarSoal(fase).map((s) => [s.id, false]));

  it("semua tidak -> hijau tanpa flag", () => {
    for (const fase of SEMUA_FASE) {
      const r = nilaiSkrining(fase, semuaTidak(fase));
      expect(r.hasil).toBe("hijau");
      expect(r.flags).toHaveLength(0);
      expect(r.urgent).toBe(false);
    }
  });

  it("satu review 'ya' -> merah non-urgent", () => {
    const j = { ...semuaTidak("menopause"), meno_lump: true };
    const r = nilaiSkrining("menopause", j);
    expect(r.hasil).toBe("merah");
    expect(r.urgent).toBe(false);
    expect(r.flags.map((f) => f.id)).toContain("meno_lump");
  });

  it("urgent 'ya' menghentikan: soal sesudahnya TIDAK dicatat sebagai tidak", () => {
    const r = nilaiSkrining("nifas", {
      cardioresp: false, severe_pain: false, fever: false, acute_infection: false,
      skin_wound: false, recent_procedure: false, restriction: false,
      pp_heavy_bleeding: true,
      // sisanya sengaja tidak dikirim — memang tidak pernah ditanyakan
    });
    expect(r.urgent).toBe(true);
    expect(r.dihentikanPada).toBe("pp_heavy_bleeding");
    expect(r.flags.map((f) => f.id)).toEqual(["pp_heavy_bleeding"]);
  });

  it("flags menyimpan level agar admin bisa bedakan urgent vs review", () => {
    const r = nilaiSkrining("kehamilan", {
      cardioresp: false, severe_pain: false, fever: false, acute_infection: true,
      skin_wound: false, recent_procedure: false, restriction: false,
      preg_bleeding_fluid: false, preg_headache_vision: false, preg_contractions: false,
      preg_fetal_movement: false, preg_highrisk: true,
    });
    expect(r.flags.every((f) => f.level === "review")).toBe(true);
    expect(r.flags.every((f) => typeof f.teks === "string" && f.teks.length > 10)).toBe(true);
  });

  it("jawaban untuk id yang tidak dikenal diabaikan (tidak bisa menyuntik flag)", () => {
    const r = nilaiSkrining("prekonsepsi", { ...semuaTidak("prekonsepsi"), id_palsu: true });
    expect(r.hasil).toBe("hijau");
    expect(r.flags).toHaveLength(0);
  });
});
