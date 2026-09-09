"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { hariIniJakarta } from "@/lib/passport/waktu";
import type { JenjangTransport } from "@/lib/transport/jarak";
import {
  JENJANG_SAH,
  PESAN,
  periksaNominal,
  periksaTanggal,
  pesanKodePostgres,
  pesanKodePostgresKhusus,
} from "./status";

/**
 * Jalur tulis TRANSPORT — rate card per jenjang jarak DAN tarif khusus >20 km.
 *
 * `tetapkanTarifTransport` mengikuti `tetapkanTarif` (rate card varian,
 * `owner/tarif/aksi.ts`) PERSIS — bukan reka ulang gaya baru — untuk aturan
 * yang sama persis pentingnya di sini:
 *
 *  1. `requireRole(["owner"])` — BUKAN daftar peran gabungan. Server action
 *     adalah ENDPOINT POST TERSENDIRI: `src/app/owner/layout.tsx` tidak
 *     pernah dilewati saat action dipanggil langsung.
 *
 *  2. INSERT-ONLY. Tarif transport lama TIDAK PERNAH diubah — trigger
 *     `kunci_riwayat_tarif_transport` menolak SETIAP UPDATE dari peran API,
 *     bahkan untuk owner. Tidak ada satu pun panggilan UPDATE ke
 *     `transport_rates` di berkas ini.
 *
 *  3. TANGGAL BERLAKU TIDAK BOLEH MUNDUR, diperiksa DI SINI supaya jawabannya
 *     berupa KALIMAT. Trigger `guard_tarif_transport_maju` tetap berdiri
 *     sebagai lapisan TERAKHIR, bukan satu-satunya.
 *
 *  4. INSERT yang tertahan RLS dijawab PostgREST 200 + `[]`, bukan error.
 *     Melaporkan "berhasil" tanpa memeriksa panjang `.select("id")` adalah
 *     kebohongan senyap tentang uang.
 *
 *  5. Sesi pengguna, bukan service role.
 *
 * `tetapkanTarifKhusus` menambah SATU pagar yang tidak dimiliki
 * `tetapkanTarifTransport`: `session_id` diverifikasi ADA dan sesinya
 * BENAR-BENAR berjenjang `di_atas_20` sebelum ditulis. Tanpa pagar itu, owner
 * (atau siapa pun yang keliru mengetik id) bisa menetapkan tarif khusus untuk
 * sesi berjenjang biasa — yang berarti sesi itu punya DUA sumber kebenaran
 * nominal sekaligus: `transport_rates` (lewat jenjangnya) dan
 * `transport_khusus` (baris nyasar ini).
 *
 * Beda dari `tetapkanTarif` varian: TIDAK ADA pemeriksaan "honor tidak boleh
 * melebihi harga" di modul ini. Subsidi PADMA justru NORMAL untuk transport
 * (0–5 km: klien Rp0, mitra Rp10.000) — `transport_rates_nilai_wajar` di
 * basis data pun sengaja tidak menuntutnya.
 */
type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };

type BarisTarif = { berlaku_sejak: string };

export async function tetapkanTarifTransport(formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["owner"]);

  const jenjang = String(formData.get("jenjang") ?? "").trim();
  const tarif = periksaNominal(String(formData.get("tarif") ?? ""), "Tarif klien");
  const honor = periksaNominal(String(formData.get("honor") ?? ""), "Honor mitra");
  // Medan tanggal kosong berarti "berlaku mulai hari ini" — hari ini menurut
  // kalender JAKARTA, bukan menurut jam server (Vercel berjalan UTC).
  const mentahMulai = String(formData.get("mulai") ?? "").trim();
  const mulai = periksaTanggal(mentahMulai || hariIniJakarta());

  if (!jenjang) return { ok: false, pesan: PESAN.jenjangWajib };
  if (!JENJANG_SAH.includes(jenjang as JenjangTransport)) {
    return { ok: false, pesan: PESAN.jenjangTakDikenal };
  }
  // Sampai migrasi `tarif_dasar_di_atas_20`, ada gerbang KEDUA di sini yang
  // menolak `di_atas_20` khusus dengan kalimat "bukan tarif rate card —
  // nominalnya per kasus" (Ruling 6, CHECK `transport_rates_bukan_per_kasus`
  // di basis data). Gerbang itu digugurkan, BUKAN lupa dihapus: sejak migrasi
  // itu `JENJANG_TARIF_RATE_CARD` sama persis dengan `JENJANG_SAH` (keduanya
  // memuat kelima jenjang), jadi `!JENJANG_TARIF_RATE_CARD.includes(jenjang)`
  // di titik ini TIDAK PERNAH bisa true lagi — nilai yang lolos pemeriksaan
  // `JENJANG_SAH` di atas otomatis lolos di sini juga. Mempertahankannya
  // hanya akan menyisakan kalimat penolakan yang tidak pernah terbaca siapa
  // pun DAN yang isinya sudah salah (owner sekarang BOLEH menetapkan tarif
  // dasar `di_atas_20` lewat formulir ini — lihat komentar migrasi).
  if (!tarif.ok) return { ok: false, pesan: tarif.pesan };
  if (!honor.ok) return { ok: false, pesan: honor.pesan };
  if (!mulai.ok) return { ok: false, pesan: mulai.pesan };

  const supabase = await createServerSupabase();

  // Riwayat tarif jenjang ini, dibaca lewat RLS owner. Perbandingan tanggal =
  // perbandingan STRING; keduanya YYYY-MM-DD sehingga urutan leksikografisnya
  // sudah kronologis.
  const { data: riwayat } = await supabase
    .from("transport_rates")
    .select("berlaku_sejak")
    .eq("jenjang", jenjang)
    .returns<BarisTarif[]>();

  const tanggalTerpakai = (riwayat ?? []).map((r) => r.berlaku_sejak);
  if (tanggalTerpakai.includes(mulai.nilai)) {
    return { ok: false, pesan: PESAN.kembar };
  }
  const terakhir = tanggalTerpakai.reduce<string | null>(
    (maks, t) => (maks === null || t > maks ? t : maks),
    null,
  );
  if (terakhir !== null && mulai.nilai < terakhir) {
    return { ok: false, pesan: `${PESAN.mundur} (${terakhir}).` };
  }

  // BARIS BARU, selalu. Tarif lama tetap berdiri sebagai bukti berapa honor
  // yang seharusnya dibayarkan pada pekan-pekan yang sudah lewat.
  const { data, error } = await supabase
    .from("transport_rates")
    .insert({
      jenjang,
      tarif_klien: tarif.nilai,
      honor_mitra: honor.nilai,
      berlaku_sejak: mulai.nilai,
    })
    .select("id");

  if (error) return { ok: false, pesan: pesanKodePostgres(error.code) };
  // 200 + [] berarti RLS menahan barisnya tanpa melempar error apa pun.
  if ((data ?? []).length === 0) return { ok: false, pesan: PESAN.tidakTersimpan };

  revalidatePath("/owner/transport");
  revalidatePath("/owner/rekap");
  revalidatePath("/owner");
  return { ok: true };
}

type BarisSesiJenjang = { id: string; jenjang: JenjangTransport | null };

/**
 * Menetapkan tarif khusus SATU KALI untuk satu sesi >20 km. `session_id`
 * adalah primary key `transport_khusus` (tanpa riwayat, sesuai desain
 * migrasinya) — sesi yang sudah punya tarif khusus ditolak dengan kalimat,
 * bukan menimpanya (trigger `kunci_transport_khusus` menolak UPDATE untuk
 * peran API sekalipun).
 *
 * `ditetapkan_oleh`/`ditetapkan_pada` SENGAJA tidak dikirim di sini: trigger
 * `jaga_transport_khusus` merebutnya dari `auth.uid()`/`now()` sungguhan.
 * Mengirim uid milik sendiri dari sini hanya akan ditimpa trigger itu, dan
 * menuliskannya memberi kesan salah bahwa formulir ini yang menentukan
 * identitas penetap.
 */
export async function tetapkanTarifKhusus(formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["owner"]);

  const sessionId = String(formData.get("sesi") ?? "").trim();
  const tarif = periksaNominal(String(formData.get("tarif") ?? ""), "Tarif klien");
  const honor = periksaNominal(String(formData.get("honor") ?? ""), "Honor mitra");

  if (!sessionId) return { ok: false, pesan: PESAN.sesiWajib };
  if (!tarif.ok) return { ok: false, pesan: tarif.pesan };
  if (!honor.ok) return { ok: false, pesan: honor.pesan };

  const supabase = await createServerSupabase();

  // Sesi harus ADA dan BENAR-BENAR berjenjang di_atas_20 — menetapkan tarif
  // khusus untuk sesi berjenjang biasa akan menciptakan sumber kebenaran
  // KEDUA untuk nominal yang seharusnya datang dari transport_rates.
  const { data: sesi } = (await supabase
    .from("sessions")
    .select("id, jenjang")
    .eq("id", sessionId)
    .maybeSingle()) as { data: BarisSesiJenjang | null };

  if (!sesi) return { ok: false, pesan: PESAN.sesiTakDikenal };
  if (sesi.jenjang !== "di_atas_20") return { ok: false, pesan: PESAN.sesiBukanDiAtas20 };

  const { data, error } = await supabase
    .from("transport_khusus")
    .insert({
      session_id: sessionId,
      tarif_klien: tarif.nilai,
      honor_mitra: honor.nilai,
    })
    .select("session_id");

  if (error) {
    // Primary key `session_id` kembar berarti sesi ini sudah punya tarif
    // khusus — UPDATE memang ditolak trigger, jadi ini bukan kegagalan aneh,
    // melainkan tepat yang diharapkan desainnya.
    if (error.code === "23505") return { ok: false, pesan: PESAN.sudahDitetapkan };
    // `pesanKodePostgresKhusus`, BUKAN `pesanKodePostgres` milik rate card:
    // `transport_khusus` tidak punya tanggal berlaku, jadi kalimat "harus
    // berlaku setelah tarif terakhir" (dipetakan dari 42501 di sana) tidak
    // bermakna apa pun di sini.
    return { ok: false, pesan: pesanKodePostgresKhusus(error.code) };
  }
  // 200 + [] berarti RLS menahan barisnya tanpa melempar error apa pun.
  if ((data ?? []).length === 0) return { ok: false, pesan: PESAN.tidakTersimpanKhusus };

  // `/admin` ikut disegarkan: StatTile "Sesi >20 km menunggu tarif" di
  // dashboard admin membaca `hitungAntrean()`, dan angka yang tidak
  // disegarkan sesudah tarifnya ditetapkan adalah angka basi begitu ia
  // benar-benar dirender di sana (Ruling 12).
  revalidatePath("/owner/transport");
  revalidatePath("/owner/rekap");
  revalidatePath("/owner");
  revalidatePath("/admin");
  return { ok: true };
}
