/**
 * QRIS + langkah pembayaran, sebagai satu komponen server.
 *
 * Dipakai DUA tempat: halaman satu tagihan (`/passport/bayar/[id]`), tempat ia
 * berdiri berdampingan dengan tombol unggah, dan daftar tagihan, tempat ia
 * TERLIPAT. Yang kedua tetap perlu: tagihan sesi lepas ditagih lewat WhatsApp
 * dan tidak punya halaman sendiri, jadi kliennya tetap butuh kode untuk
 * dipindai.
 *
 * Satu salinan, bukan dua. Nama penerima dan NMID adalah satu-satunya yang
 * bisa diperiksa mata sebelum mengirim uang — dua salinan yang boleh berbeda
 * adalah dua kesempatan salah satunya menyebut penerima yang keliru.
 *
 * SINKRON, dan setelannya dioper masuk: komponen server yang `async` di dalam
 * pohon halaman tidak bisa dirender `renderToStaticMarkup`, dan seluruh suite
 * ini merender halaman persis begitu. Pengambilan data karena itu tetap milik
 * halaman — pola yang sama dipegang setiap komponen anak di repo ini.
 */
export function CaraBayar({
  qrisGambar,
  qrisMerchant,
  qrisNmid,
}: {
  qrisGambar: string;
  qrisMerchant: string;
  qrisNmid: string;
}) {
  return (
    <div className="flex flex-wrap items-start gap-5">
      {/* QRIS SUNGGUHAN (spec J12) — bukan pola dekoratif. Alamat gambarnya
          dibaca dari `app_settings`: kode QRIS bisa berganti, dan
          penggantiannya tidak boleh menuntut deploy. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qrisGambar}
        alt={`Kode QRIS ${qrisMerchant}`}
        width={200}
        height={200}
        className="h-[200px] w-[200px] rounded-xl border border-black/10 bg-white object-contain p-2"
      />
      <div className="min-w-[210px] flex-1 text-[13.5px] text-[#3C4C42]">
        <b className="mb-1 block text-[15px] text-ink">Scan QRIS di samping</b>
        Bisa dengan aplikasi bank atau e-wallet apa pun.
        {/* NAMA MERCHANT & NMID ditampilkan, dan itu bukan hiasan: QRIS statis
            tidak menyebut nominal, jadi satu-satunya yang bisa diperiksa mata
            sebelum mengirim uang adalah nama penerimanya. */}
        <span className="mt-3 block rounded-xl border border-black/10 bg-paper p-3 text-[12px] leading-relaxed">
          <span className="block text-ink-soft">Pastikan nama penerima cocok:</span>
          <b className="block text-ink">{qrisMerchant}</b>
          <span className="block text-ink-soft">NMID {qrisNmid}</span>
        </span>
      </div>
    </div>
  );
}

/** Tiga langkah, urutannya sama di mana pun ia dirender. */
export function LangkahBayar({ unggahDiSini }: { unggahDiSini: boolean }) {
  const langkah: [string, string][] = [
    ["01", "Scan QRIS di atas, atau transfer sesuai arahan admin"],
    [
      "02",
      unggahDiSini
        ? "Unggah bukti pembayaran lewat tombol di atas"
        : "Kirim bukti pembayaran ke WhatsApp PADMA",
    ],
    ["03", "Tim memverifikasi & jadwal Anda terkunci"],
  ];

  return (
    <>
      {langkah.map(([no, teks]) => (
        <p
          key={no}
          className="flex items-center gap-3 border-b border-dashed border-black/10 py-3 text-[13.5px] text-[#3C4C42] last:border-0"
        >
          <span className="w-6 flex-none font-mono text-[11px] text-gold">{no}</span>
          {teks}
        </p>
      ))}
    </>
  );
}
