// SUMBER KEBENARAN TUNGGAL bank soal skrining keselamatan PADMA.
// Dipakai server (penilaian otoritatif) dan klien (menampilkan pertanyaan).
//
// PAGAR KESELAMATAN — jangan diubah tanpa persetujuan eksplisit:
//  * urutan = urutan triase; jangan diurutkan/dikelompokkan ulang
//  * jumlah: umum 7, prekonsepsi 3, kehamilan 5, nifas 5, menopause 4
//  * `fever` WAJIB urgent pada kehamilan & nifas (korioamnionitis/sepsis puerperalis)
//  * `pp_mental` WAJIB urgent dan tetap di posisinya
//  * fase `newborn` (Shishu) TIDAK diskrining — yang diskrining ibunya (fase nifas)

export type FaseSkrining = "prekonsepsi" | "kehamilan" | "nifas" | "menopause";
export type Level = "urgent" | "review";

export type LevelDinamis = {
  default: Level;
  perFase: Partial<Record<FaseSkrining, Level>>;
};

export type Soal = {
  id: string;
  teks: string;
  hint: string;
  level: Level | LevelDinamis;
};

export const LABEL_FASE: Record<FaseSkrining, string> = {
  prekonsepsi: "Prekonsepsi / Promil",
  kehamilan: "Kehamilan",
  nifas: "Nifas / Menyusui",
  menopause: "Menopause",
};

export const SOAL_UMUM: Soal[] = [
  {
    id: "cardioresp",
    level: "urgent",
    teks: "Apakah saat ini Anda mengalami nyeri dada, sesak napas yang tidak biasa, pingsan, atau kejang?",
    hint: "Jika Ya, jangan lanjutkan layanan wellness.",
  },
  {
    id: "severe_pain",
    level: "urgent",
    teks: "Apakah Anda mengalami nyeri sangat hebat, mendadak, menetap, atau kondisi yang terasa seperti keadaan darurat?",
    hint: "Termasuk nyeri perut/panggul berat yang baru muncul.",
  },
  {
    id: "fever",
    // Satu-satunya level bergantung fase. Kunci HARUS memakai id fase DB
    // ("kehamilan", bukan "hamil" seperti prototipe) — bila tidak sinkron,
    // demam pada ibu hamil diam-diam turun jadi "review".
    level: { default: "review", perFase: { kehamilan: "urgent", nifas: "urgent" } },
    teks: "Apakah suhu tubuh Anda 38°C atau lebih, atau Anda sedang demam/menggigil dan merasa sakit akut?",
    hint: "Demam saat hamil atau setelah melahirkan perlu perhatian lebih cepat.",
  },
  {
    id: "acute_infection",
    level: "review",
    teks: "Apakah Anda sedang mengalami penyakit menular akut, muntah/diare aktif, atau infeksi yang belum tertangani?",
    hint: "Layanan sebaiknya ditunda sampai kondisi akut membaik.",
  },
  {
    id: "skin_wound",
    level: "review",
    teks: "Apakah ada luka terbuka, infeksi kulit, atau area yang sedang meradang pada bagian tubuh yang akan ditangani?",
    hint: "Tim perlu menilai apakah layanan harus ditunda atau dimodifikasi.",
  },
  {
    id: "recent_procedure",
    level: "review",
    teks: "Apakah Anda baru menjalani operasi/prosedur invasif, atau sedang dalam masa pembatasan aktivitas?",
    hint: "Bila Ya, tim membutuhkan informasi tambahan sebelum menjadwalkan.",
  },
  {
    id: "restriction",
    level: "review",
    teks: "Apakah dokter/bidan pernah meminta Anda membatasi pijat, olahraga, atau aktivitas fisik karena kondisi medis saat ini?",
    hint: "PADMA akan mengikuti arahan klinis tersebut.",
  },
];

export const SOAL_FASE: Record<FaseSkrining, Soal[]> = {
  prekonsepsi: [
    {
      id: "pre_heavy_bleeding",
      level: "urgent",
      teks: "Apakah Anda mengalami perdarahan vagina sangat banyak disertai pusing/lemas, atau perdarahan dengan nyeri perut/panggul hebat?",
      hint: "Kondisi ini perlu evaluasi medis terlebih dahulu.",
    },
    {
      id: "pre_abnormal_bleeding",
      level: "review",
      teks: "Apakah Anda mengalami perdarahan di luar pola haid biasa dan belum pernah diperiksa?",
      hint: "Sebaiknya dinilai sebelum layanan wellness.",
    },
    {
      id: "possible_pregnancy",
      level: "review",
      teks: "Apakah haid Anda terlambat atau ada kemungkinan sedang hamil tetapi belum terkonfirmasi?",
      hint: "Tim menyesuaikan jenis layanan bila ada kemungkinan kehamilan.",
    },
  ],
  kehamilan: [
    {
      id: "preg_bleeding_fluid",
      level: "urgent",
      teks: "Apakah saat ini ada perdarahan dari vagina lebih dari bercak ringan, atau cairan ketuban merembes/pecah?",
      hint: "Ini termasuk warning sign kehamilan.",
    },
    {
      id: "preg_headache_vision",
      level: "urgent",
      teks: "Apakah Anda mengalami sakit kepala berat/menetap, pandangan kabur, pusing berat, atau bengkak mendadak pada wajah/tangan?",
      hint: "Perlu evaluasi medis segera.",
    },
    {
      id: "preg_contractions",
      level: "urgent",
      teks: "Apakah ada nyeri perut hebat yang tidak hilang, atau kontraksi teratur yang terasa tidak sesuai waktunya?",
      hint: "Jangan lanjutkan pijat/yoga sebelum dievaluasi.",
    },
    {
      id: "preg_fetal_movement",
      level: "urgent",
      teks: "Jika Anda sudah biasa merasakan gerakan janin: apakah gerakannya berhenti atau jelas lebih sedikit dari biasanya? (Bila belum biasa merasakannya, pilih Tidak.)",
      hint: "",
    },
    {
      id: "preg_highrisk",
      level: "review",
      teks: "Apakah kehamilan Anda memiliki komplikasi/risiko khusus, atau dokter memberi pembatasan aktivitas?",
      hint: "Contoh: diminta bed rest atau kehati-hatian khusus.",
    },
  ],
  nifas: [
    {
      id: "pp_heavy_bleeding",
      level: "urgent",
      teks: "Apakah perdarahan setelah melahirkan sangat banyak — membasahi ≥1 pembalut per jam, keluar bekuan besar, atau disertai pusing/lemas?",
      hint: "Perdarahan berat pasca melahirkan adalah warning sign.",
    },
    {
      id: "pp_headache_vision",
      level: "urgent",
      teks: "Apakah Anda mengalami sakit kepala berat/menetap, perubahan penglihatan, atau bengkak mendadak pada wajah/tangan?",
      hint: "Masalah tekanan darah bisa muncul setelah persalinan.",
    },
    {
      id: "pp_leg",
      level: "urgent",
      teks: "Apakah satu kaki/betis terasa lebih bengkak, merah, hangat, atau nyeri dibanding sisi lainnya?",
      hint: "Perlu menyingkirkan kemungkinan masalah pembuluh darah.",
    },
    {
      id: "pp_mental",
      level: "urgent",
      teks: "Apakah muncul pikiran ingin menyakiti diri sendiri atau bayi, atau Anda merasa tidak mampu menjaga keselamatan diri/bayi?",
      hint: "Ini membutuhkan bantuan segera dan tidak boleh ditunda.",
    },
    {
      id: "pp_breast",
      level: "review",
      teks: "Apakah payudara sangat nyeri, merah, bengkak, atau ada keluhan menyusui akut yang belum dinilai tenaga kesehatan?",
      hint: "Tim akan mengarahkan ke layanan yang tepat.",
    },
  ],
  menopause: [
    {
      id: "meno_bleeding",
      level: "review",
      teks: "Apakah ada perdarahan/bercak dari vagina setelah Anda tidak haid selama 12 bulan atau lebih?",
      hint: "Perdarahan pascamenopause perlu diperiksa lebih dulu.",
    },
    {
      id: "meno_pelvic",
      level: "review",
      teks: "Apakah ada nyeri panggul baru yang menetap atau semakin berat dan belum diperiksa?",
      hint: "Perlu klarifikasi penyebab sebelum treatment.",
    },
    {
      id: "meno_lump",
      level: "review",
      teks: "Apakah Anda menemukan benjolan baru pada payudara/perut/panggul yang belum pernah diperiksa?",
      hint: "Sebaiknya dinilai tenaga kesehatan terlebih dahulu.",
    },
    {
      id: "meno_weight",
      level: "review",
      teks: "Apakah berat badan turun nyata tanpa disengaja, atau ada gejala baru menetap yang belum diketahui penyebabnya?",
      hint: "Perlu evaluasi klinis bila signifikan.",
    },
  ],
};

export function daftarSoal(fase: FaseSkrining): Soal[] {
  return [...SOAL_UMUM, ...SOAL_FASE[fase]];
}

/**
 * Menyaring `jawaban` kiriman klien ke id soal yang MEMANG ada untuk fase itu.
 *
 * Temuan red team: route lama menyimpan `jawaban` mentah verbatim, jadi kunci
 * id-palsu sembarang ikut masuk ke kolom jsonb data kesehatan. Penilaian sendiri
 * memang hanya membaca id yang dikenal — tapi yang TERSIMPAN harus ikut bersih,
 * bukan cuma yang dibaca.
 */
export function saringJawaban(
  fase: FaseSkrining,
  jawaban: Record<string, boolean>,
): Record<string, boolean> {
  const dikenal = new Set(daftarSoal(fase).map((s) => s.id));
  const bersih: Record<string, boolean> = {};
  for (const [id, nilai] of Object.entries(jawaban)) {
    if (dikenal.has(id)) bersih[id] = nilai;
  }
  return bersih;
}

export function levelSoal(soal: Soal, fase: FaseSkrining): Level {
  if (typeof soal.level === "string") return soal.level;
  return soal.level.perFase[fase] ?? soal.level.default;
}
