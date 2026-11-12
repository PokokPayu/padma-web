import "server-only";
import { randomUUID } from "node:crypto";
import {
  PATH_BUAT_PEMBAYARAN,
  basisApiDoku,
  clientIdDoku,
  pathStatusDoku,
  secretKeyDoku,
} from "./konfig";
import { normalisasiNominal } from "./nominal";
import {
  hitungDigest,
  hitungTandaTangan,
  rakitKomponenTandaTangan,
} from "./tanda-tangan";

/**
 * Satu-satunya berkas di PADMA yang berbicara ke DOKU lewat jaringan.
 *
 * `server-only`: Secret Key dipakai menandatangani di sini dan tidak boleh
 * ikut terbundel ke peramban.
 *
 * Batas waktu dipasang eksplisit: `fetch` Node tidak punya batas bawaan, dan
 * permintaan yang menggantung menahan rute checkout sampai platform
 * memutusnya. Tidak ada fungsi di sini yang melempar; kegagalan dipulangkan
 * sebagai nilai. Log menyebut kode HTTP dan `error_messages`, tidak pernah
 * kunci, tanda tangan, atau badan permintaan.
 */
const BATAS_MS = 10_000;

/** ISO8601 UTC tanpa milidetik, bentuk contoh DOKU: `2020-09-22T01:51:00Z`. */
function cap(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function tandatangani(
  requestId: string,
  requestTimestamp: string,
  requestTarget: string,
  digest: string | null,
): string {
  return hitungTandaTangan(
    rakitKomponenTandaTangan({
      clientId: clientIdDoku(),
      requestId,
      requestTimestamp,
      requestTarget,
      digest,
    }),
    secretKeyDoku(),
  );
}

function kunciKosong(): boolean {
  return clientIdDoku() === "" || secretKeyDoku() === "";
}

export type ItemDoku = { nama: string; harga: number };
export type PermintaanPembayaranDoku = {
  invoice: string;
  nominal: number;
  items: ItemDoku[];
  menitBerlaku: number;
  callbackUrl: string;
};

/**
 * Membuat tautan bayar Checkout.
 *
 * Σ harga item diperiksa SEBELUM menelepon: DOKU menolak `line_items` yang
 * totalnya berbeda dari `order.amount`, dan penolakan itu baru kita ketahui
 * sesudah satu putaran jaringan (dan sebuah invoice yang terbakar). Selisih
 * di sini berarti cacat di pemanggil, jadi berhenti lebih awal.
 *
 * Sengaja TIDAK ada `customer`: data pribadi minimum (spec §5.3); DOKU tidak
 * perlu tahu siapa pembelinya untuk menampilkan halaman bayar.
 */
export async function buatPembayaranDoku(
  p: PermintaanPembayaranDoku,
): Promise<{ ok: true; url: string; tokenId: string } | { ok: false; pesan: string }> {
  if (kunciKosong()) {
    return { ok: false, pesan: "Pembayaran belum aktif. Hubungi tim PADMA." };
  }
  const jumlah = p.items.reduce((s, i) => s + i.harga, 0);
  if (p.items.length === 0 || jumlah !== p.nominal) {
    console.error("[doku] Jumlah item tidak sama dengan nominal; permintaan tidak dikirim.");
    return { ok: false, pesan: "Pembayaran belum bisa dimulai. Hubungi tim PADMA." };
  }

  // Badan diserialisasi SATU kali; string yang sama dipakai untuk Digest dan
  // untuk dikirim. Serialisasi ulang bisa mengubah byte-nya.
  const badan = JSON.stringify({
    order: {
      amount: p.nominal,
      invoice_number: p.invoice,
      line_items: p.items.map((i) => ({ name: i.nama, price: i.harga, quantity: 1 })),
      callback_url: p.callbackUrl,
      auto_redirect: true,
      recover_abandoned_cart: false,
    },
    payment: { payment_due_date: p.menitBerlaku },
  });

  const requestId = randomUUID();
  const requestTimestamp = cap();

  let jawab: Response;
  try {
    jawab = await fetch(`${basisApiDoku()}${PATH_BUAT_PEMBAYARAN}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "Client-Id": clientIdDoku(),
        "Request-Id": requestId,
        "Request-Timestamp": requestTimestamp,
        Signature: tandatangani(
          requestId,
          requestTimestamp,
          PATH_BUAT_PEMBAYARAN,
          hitungDigest(badan),
        ),
      },
      body: badan,
      signal: AbortSignal.timeout(BATAS_MS),
    });
  } catch {
    console.error("[doku] Checkout tidak bisa dihubungi.");
    return { ok: false, pesan: "Layanan pembayaran tidak bisa dihubungi." };
  }

  const isi = (await jawab.json().catch(() => null)) as {
    response?: { payment?: { url?: unknown; token_id?: unknown } };
    error_messages?: unknown;
  } | null;
  const url = isi?.response?.payment?.url;

  if (!jawab.ok || typeof url !== "string" || url === "") {
    // `error_messages` hanya ke log server; tidak pernah ke pembeli.
    const galat = Array.isArray(isi?.error_messages) ? isi.error_messages.join("; ") : "";
    console.error(`[doku] Checkout menolak ${jawab.status}:`, galat);
    return { ok: false, pesan: "Pembayaran belum bisa dimulai. Coba lagi sebentar lagi." };
  }

  const token = isi?.response?.payment?.token_id;
  return { ok: true, url, tokenId: typeof token === "string" ? token : "" };
}

export type StatusDoku = {
  invoice: string;
  status: string;
  nominal: number | null;
  transaksiId: string;
  kanal: string;
};

/**
 * Check Status — dipakai pemeriksaan saat halaman dibuka, tombol periksa
 * ulang, dan penyapu.
 *
 * `kode` pada kegagalan mengikat pemanggil:
 *   -1  = kunci belum terpasang; nol permintaan keluar.
 *    0  = tidak terjangkau (jaringan/batas waktu) ATAU jawaban 200 yang
 *         `transaction.status`-nya tidak terbaca. Bukan vonis apa pun tentang
 *         transaksinya; jangan diterjemahkan menjadi status.
 *   404 = invoice tidak dikenal. Bentuk jawabannya (K7) dibuktikan di A12;
 *         pemanggil menyimpulkan "kedaluwarsa" hanya sesudah masa tenggang.
 *   lain = HTTP DOKU apa adanya.
 *
 * `nominal` null bila `order.amount` tidak lolos `normalisasiNominal`; null
 * bukan 0, dan pemanggil menahan pesanan alih-alih menyatakan lunas.
 * GET tidak bertubuh, jadi komponen tanda tangan tanpa baris Digest.
 */
export async function bacaStatusDoku(
  invoice: string,
): Promise<{ ok: true; status: StatusDoku } | { ok: false; kode: number; pesan: string }> {
  if (kunciKosong()) {
    return { ok: false, kode: -1, pesan: "Kunci DOKU belum dipasang." };
  }

  const path = pathStatusDoku(invoice);
  const requestId = randomUUID();
  const requestTimestamp = cap();

  let jawab: Response;
  try {
    jawab = await fetch(`${basisApiDoku()}${path}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        "Client-Id": clientIdDoku(),
        "Request-Id": requestId,
        "Request-Timestamp": requestTimestamp,
        Signature: tandatangani(requestId, requestTimestamp, path, null),
      },
      signal: AbortSignal.timeout(BATAS_MS),
    });
  } catch {
    return { ok: false, kode: 0, pesan: "Layanan pembayaran tidak bisa dihubungi." };
  }

  if (jawab.status === 404) {
    return { ok: false, kode: 404, pesan: "Invoice tidak dikenal DOKU." };
  }
  if (!jawab.ok) {
    console.error(`[doku] Check Status menjawab ${jawab.status}.`);
    return { ok: false, kode: jawab.status, pesan: "DOKU menjawab tidak seperti biasanya." };
  }

  const isi = (await jawab.json().catch(() => null)) as {
    order?: { invoice_number?: unknown; amount?: unknown };
    transaction?: { status?: unknown; original_request_id?: unknown };
    channel?: { id?: unknown };
  } | null;
  const status = isi?.transaction?.status;
  if (typeof status !== "string" || status === "") {
    return { ok: false, kode: 0, pesan: "Jawaban DOKU tanpa transaction.status yang bisa dibaca." };
  }

  const teks = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    ok: true,
    status: {
      invoice: teks(isi?.order?.invoice_number) || invoice,
      status,
      nominal: normalisasiNominal(isi?.order?.amount),
      // Medan ini tidak ditetapkan spec; kosong bila tidak ada.
      transaksiId: teks(isi?.transaction?.original_request_id),
      kanal: teks(isi?.channel?.id),
    },
  };
}
