import "server-only";

/**
 * SATU-SATUNYA jalur keluar email PADMA.
 *
 * `import "server-only"` bukan hiasan: `RESEND_API_KEY` tidak boleh punya satu
 * pun jalan ke bundel peramban, dan direktif ini membuat impor dari komponen
 * klien GAGAL DI BUILD alih-alih gagal diam-diam di produksi.
 *
 * ===== FUNGSI INI TIDAK PERNAH MELEMPAR =====
 * Pemanggilnya adalah `terbitkanTagihan()`, dan penerbitan tagihan tidak boleh
 * gagal karena penyedia email sedang bermasalah. Setiap galat — jaringan,
 * 4xx, 5xx, JSON yang tidak terbaca — berakhir sebagai `{ ok: false, sebab }`.
 * Pola yang sama persis dengan `geocodeAlamat()`, dan alasannya sama.
 *
 * ===== GAGAL TERTUTUP TERHADAP KONFIGURASI =====
 * Tanpa `RESEND_API_KEY` atau `EMAIL_PENGIRIM`, fungsi ini tidak mengirim apa
 * pun dan memulangkan sebab `env_kosong` — bukan diam-diam "berhasil". Env
 * yang hilang lalu terbaca sebagai sukses adalah persis kelas cacat yang sudah
 * dibayar di jalur video R2 (fix F3), dan di sini akibatnya lebih mahal:
 * seluruh klien berhenti menerima tagihan tanpa satu baris pun di log.
 *
 * Tanpa dependensi baru: Resend menerima HTTP biasa.
 */
const ENDPOINT = "https://api.resend.com/emails";

export type HasilKirim = { ok: true; id: string } | { ok: false; sebab: string };

export async function kirimEmail(input: {
  ke: string;
  subjek: string;
  html: string;
  /** WAJIB. Klien email yang memblokir HTML menampilkan bagian ini. */
  teks: string;
}): Promise<HasilKirim> {
  const kunci = process.env.RESEND_API_KEY;
  const dari = process.env.EMAIL_PENGIRIM;
  if (!kunci || !dari) {
    console.warn("[email] RESEND_API_KEY / EMAIL_PENGIRIM belum terpasang — tidak mengirim.");
    return { ok: false, sebab: "env_kosong" };
  }
  if (input.ke.trim() === "") {
    return { ok: false, sebab: "tujuan_kosong" };
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${kunci}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: dari,
        to: [input.ke],
        subject: input.subjek,
        html: input.html,
        text: input.teks,
      }),
    });

    if (!res.ok) {
      // Badan responsnya ikut dicatat: Resend menjelaskan penolakan domain yang
      // belum terverifikasi di sana, dan itu justru kegagalan yang paling
      // mungkin terjadi saat go-live.
      const isi = await res.text().catch(() => "");
      console.error(`[email] Resend menolak (${res.status}): ${isi.slice(0, 500)}`);
      return { ok: false, sebab: `http_${res.status}` };
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: data.id ?? "" };
  } catch (e) {
    console.error("[email] gagal menghubungi Resend:", e);
    return { ok: false, sebab: "jaringan" };
  }
}
