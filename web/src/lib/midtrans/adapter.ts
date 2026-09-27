import "server-only";
import { basisApiMidtrans, basisSnap, serverKeyMidtrans } from "./konfig";

/**
 * Satu-satunya berkas di PADMA yang berbicara ke Midtrans lewat jaringan.
 *
 * `server-only`: kunci SERVER dipakai sebagai Basic auth di sini. Berkas ini
 * tidak boleh pernah ikut terbundel ke peramban, dan direktif itulah yang
 * membuat impor yang salah gagal saat build alih-alih membocorkan kunci diam-diam.
 *
 * Batas waktu dipasang eksplisit. `fetch` bawaan Node tidak punya batas waktu
 * bawaan — permintaan yang menggantung akan menahan rute checkout sampai
 * platform yang memutusnya, dan pembeli melihat tombol yang berputar selamanya.
 */
const BATAS_MS = 10_000;

function otorisasi(): string {
  // Midtrans memakai Basic auth: server key sebagai username, password KOSONG.
  // Titik dua di ujung bukan salah ketik.
  return `Basic ${Buffer.from(`${serverKeyMidtrans()}:`).toString("base64")}`;
}

/** Midtrans menolak `item_details.name` lebih dari 50 karakter. */
function potong(teks: string, maks: number): string {
  return teks.length <= maks ? teks : `${teks.slice(0, maks - 1)}…`;
}

export type PermintaanSnap = {
  orderId: string;
  nominal: number;
  judul: string;
  kedaluwarsaJam: number;
};

/**
 * Menerbitkan token Snap.
 *
 * `expiry` dikirim dari konstanta yang SAMA dengan yang mengisi
 * `orders.kedaluwarsa_pada` (`JAM_TENGGAT_PESANAN`). Dua angka yang boleh
 * berbeda adalah dua kegagalan simetris: kolom lebih pendek -> kita berhenti
 * bertanya sementara VA-nya masih bisa dibayar, dan settlement mendarat pada
 * pesanan yang sudah kita tutup; kolom lebih panjang -> penyapu menanyai
 * Midtrans tentang transaksi yang tidak akan pernah berubah.
 *
 * Tidak pernah melempar. Kegagalan dipulangkan sebagai nilai, karena pemanggilnya
 * (rute checkout) punya jawaban yang lebih baik daripada 500: 502 dengan pesan,
 * dan pembeli boleh mencoba lagi dengan `ulang: true`.
 */
export async function terbitkanTokenSnap(
  p: PermintaanSnap,
): Promise<{ ok: true; token: string } | { ok: false; pesan: string }> {
  if (serverKeyMidtrans() === "") {
    return { ok: false, pesan: "Pembayaran belum aktif. Hubungi tim PADMA." };
  }

  let jawab: Response;
  try {
    jawab = await fetch(`${basisSnap()}/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: otorisasi(),
      },
      body: JSON.stringify({
        transaction_details: { order_id: p.orderId, gross_amount: p.nominal },
        item_details: [
          { id: p.orderId, price: p.nominal, quantity: 1, name: potong(p.judul, 50) },
        ],
        expiry: { unit: "hour", duration: p.kedaluwarsaJam },
      }),
      signal: AbortSignal.timeout(BATAS_MS),
    });
  } catch {
    // Jaringan mati, DNS gagal, batas waktu lewat. Tidak dicatat isinya —
    // yang berguna bagi pembeli hanyalah "coba lagi".
    console.error("[midtrans] Snap tidak bisa dihubungi.");
    return { ok: false, pesan: "Layanan pembayaran tidak bisa dihubungi." };
  }

  const isi = (await jawab.json().catch(() => null)) as
    | { token?: string; error_messages?: string[] }
    | null;

  if (!jawab.ok || !isi?.token) {
    // Pesan galat Midtrans dicatat ke LOG SERVER (berguna: ia menyebut field
    // mana yang ditolak) tetapi tidak pernah dipulangkan ke pembeli.
    console.error(
      `[midtrans] Snap menolak ${jawab.status}:`,
      (isi?.error_messages ?? []).join("; "),
    );
    return { ok: false, pesan: "Pembayaran belum bisa dimulai. Coba lagi sebentar lagi." };
  }

  return { ok: true, token: isi.token };
}

export type StatusMidtrans = {
  order_id: string;
  status_code: string;
  transaction_status: string;
  transaction_id: string;
  gross_amount: string;
  fraud_status: string | null;
  payment_type: string | null;
};

/**
 * Status API — dipakai Lapis 1b (pemeriksaan saat halaman dibuka), tombol
 * "Periksa ulang" staf, dan penyapu terjadwal.
 *
 * `kode` pada kegagalan punya arti yang MENGIKAT bagi pemanggil:
 *   404 = Midtrans menyatakan transaksinya TIDAK PERNAH ADA. Hanya pemanggil
 *         yang boleh menyimpulkan "kedaluwarsa" darinya, dan HANYA bila
 *         `kedaluwarsa_pada + JAM_TENGGANG_404` sudah lewat — satu jam itu
 *         margin terhadap jam Midtrans, bukan perpanjangan tenggat.
 *   0   = tidak bisa dihubungi sama sekali (jaringan/batas waktu), ATAU jawaban
 *         yang `gross_amount`-nya hilang / bukan angka. Bukan vonis apa pun
 *         tentang transaksinya; jangan pernah diterjemahkan jadi status.
 *  -1   = `MIDTRANS_SERVER_KEY` belum terpasang. Nol permintaan keluar.
 * Nilai lain = jawaban HTTP Midtrans apa adanya.
 *
 * ===== KENAPA -1 PUNYA KODE SENDIRI, BUKAN IKUT 0 =====
 * Keduanya berarti "tidak ada jawaban", tapi keduanya menuntut KALIMAT yang
 * berbeda kepada manusia yang menekan tombolnya: jaringan yang mati sembuh
 * dengan dicoba lagi, kunci server yang belum dipasang TIDAK PERNAH. Dilebur,
 * layar staf berkata "Midtrans tidak menjawab. Coba lagi beberapa saat lagi."
 * untuk keadaan yang tidak akan berubah sampai seseorang memasang env — dan
 * staf mencoba lagi selamanya. Kedua permukaan T8 yang lain sudah memisahkannya
 * (rute webhook menjawab 503 `kunci_kosong`, `terbitkanTokenSnap` di atas
 * memulangkan "Pembayaran belum aktif. Hubungi tim PADMA."); hanya jalur Status
 * API yang sempat meleburnya. Pemetaannya di T10: `kode === -1` →
 * `"kunci_belum_terpasang"`, dan `Record<HasilPeriksaPesanan, string>` di T11
 * memaksa kalimatnya ditulis.
 */
export async function bacaStatusTransaksi(
  orderId: string,
): Promise<{ ok: true; status: StatusMidtrans } | { ok: false; kode: number; pesan: string }> {
  if (serverKeyMidtrans() === "") {
    return { ok: false, kode: -1, pesan: "Kunci Midtrans belum dipasang." };
  }

  let jawab: Response;
  try {
    jawab = await fetch(`${basisApiMidtrans()}/${encodeURIComponent(orderId)}/status`, {
      method: "GET",
      headers: { accept: "application/json", authorization: otorisasi() },
      signal: AbortSignal.timeout(BATAS_MS),
    });
  } catch {
    return { ok: false, kode: 0, pesan: "Layanan pembayaran tidak bisa dihubungi." };
  }

  const isi = (await jawab.json().catch(() => null)) as Record<string, unknown> | null;

  if (jawab.status === 404) {
    return { ok: false, kode: 404, pesan: "Transaksi tidak ada di Midtrans." };
  }
  if (!jawab.ok || isi === null) {
    return { ok: false, kode: jawab.status, pesan: "Midtrans menjawab tidak seperti biasanya." };
  }

  const teks = (kunci: string): string => (isi[kunci] == null ? "" : String(isi[kunci]));
  const teksAtauNull = (kunci: string): string | null =>
    isi[kunci] == null ? null : String(isi[kunci]);

  const gross = teks("gross_amount");
  if (!/^\d+(\.\d+)?$/.test(gross)) {
    // TIDAK dipalsukan menjadi "0". "Tidak tahu berapa" bukan "nol rupiah" —
    // alasan yang sama persis dengan yang sudah ditulis untuk kolom
    // `notifikasi_pesanan.nominal_diterima` yang nullable.
    //
    // Bentuk kegagalan kalau ia dipalsukan: jawaban Status API yang benar
    // `settlement` tapi tanpa medan `gross_amount` mengirim 0 ke mesin,
    // verifikasi jumlah gagal, dan pesanan yang SUDAH DIBAYAR PENUH digeser ke
    // `ditahan` ber-`nominal_diterima = 0`. Itu bukan kegagalan yang hilang —
    // ia muncul di "Butuh perhatian" — tapi ia menuntut putusan manusia untuk
    // pembayaran yang sempurna, dan `putuskan_pesanan_ditahan` MELOLOSKANNYA
    // karena `0` bukan `null`.
    //
    // `kode: 0` = "tidak tahu apa-apa", dan pemanggil dilarang
    // menerjemahkannya jadi status apa pun. Pesanan tidak bergerak, dan
    // pemeriksaan berikutnya mencoba lagi.
    return { ok: false, kode: 0, pesan: "Jawaban Midtrans tanpa gross_amount yang bisa dibaca." };
  }

  return {
    ok: true,
    status: {
      order_id: teks("order_id") || orderId,
      status_code: teks("status_code"),
      transaction_status: teks("transaction_status"),
      transaction_id: teks("transaction_id"),
      // Dijamin berbentuk angka oleh penjaga di atas, dan diteruskan APA
      // ADANYA sebagai string ke RPC — bentuk yang sama dengan jalur webhook.
      gross_amount: gross,
      fraud_status: teksAtauNull("fraud_status"),
      payment_type: teksAtauNull("payment_type"),
    },
  };
}
