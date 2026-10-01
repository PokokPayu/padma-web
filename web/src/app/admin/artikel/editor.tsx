"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uraiIsi } from "@/lib/artikel/urai";
import { ArtikelIsi } from "@/app/_situs/artikel-isi";
import { kelasFontSitus } from "@/app/_situs/font";
import { buatArtikel, hapusArtikel, simpanArtikel, tarikArtikel, terbitkanArtikel } from "./aksi";

const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13.5px]";
const KELAS_LABEL = "block text-[12.5px] font-bold text-panel-muted";
const TOMBOL_UTAMA = "rounded-lg bg-panel-ink px-3 py-2 text-[12px] font-bold text-panel-surface disabled:opacity-50";
const TOMBOL_GARIS =
  "rounded-lg border border-panel-border px-3 py-2 text-[12px] font-bold text-panel-ink disabled:opacity-50";

export function FormArtikelBaru() {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await buatArtikel(fd);
          if (r.ok) router.push(`/admin/artikel/${r.id}`);
          else setPesan(r.pesan);
        })
      }
      className="flex flex-wrap items-end gap-2"
    >
      <label className="min-w-[240px] flex-1">
        <span className={KELAS_LABEL}>Judul artikel baru</span>
        <input name="judul" required minLength={2} maxLength={200} className={KELAS_MEDAN} />
      </label>
      <button type="submit" disabled={pending} className={TOMBOL_UTAMA}>
        {pending ? "Membuat…" : "+ Buat draf"}
      </button>
      {pesan && <p className="w-full text-[13px] font-semibold text-clay">{pesan}</p>}
    </form>
  );
}

const PANDUAN = `Paragraf dipisah baris kosong.
## Subjudul
- butir daftar   atau   1. butir bernomor
**tebal**  *miring*  https://tautan  rujukan [1]
### Referensi  ← daftar bernomor sesudahnya jadi daftar pustaka`;

export function EditorArtikel({
  artikel,
}: {
  artikel: { id: string; judul: string; slug: string; kategori: string; isi: string; terbit: boolean };
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<{ ok: boolean; teks: string } | null>(null);
  const [judul, setJudul] = useState(artikel.judul);
  const [kategori, setKategori] = useState(artikel.kategori);
  const [isi, setIsi] = useState(artikel.isi);
  const terurai = useMemo(() => uraiIsi(isi), [isi]);

  function jalankan(fd: FormData, lanjut?: () => Promise<{ ok: true } | { ok: false; pesan: string }>) {
    mulai(async () => {
      const r = await simpanArtikel(artikel.id, fd);
      if (!r.ok) return setPesan({ ok: false, teks: r.pesan });
      if (lanjut) {
        const r2 = await lanjut();
        if (!r2.ok) return setPesan({ ok: false, teks: r2.pesan });
      }
      setPesan({ ok: true, teks: lanjut ? "Tersimpan dan diterbitkan." : "Tersimpan." });
      router.refresh();
    });
  }

  return (
    <form
      action={(fd) => jalankan(fd)}
      className="grid gap-3 xl:grid-cols-2"
    >
      <section className="flex flex-col gap-3 rounded-lg border border-panel-border bg-panel-surface p-4">
        <label>
          <span className={KELAS_LABEL}>Judul</span>
          <input
            name="judul"
            required
            minLength={2}
            maxLength={200}
            value={judul}
            onChange={(e) => setJudul(e.target.value)}
            className={KELAS_MEDAN}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className={KELAS_LABEL}>Kategori</span>
            <input
              name="kategori"
              maxLength={60}
              placeholder="mis. Kehamilan"
              value={kategori}
              onChange={(e) => setKategori(e.target.value)}
              className={KELAS_MEDAN}
            />
          </label>
          <label>
            <span className={KELAS_LABEL}>Alamat: /artikel/…</span>
            <input
              name="slug"
              required
              maxLength={80}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              defaultValue={artikel.slug}
              className={`${KELAS_MEDAN} font-mono`}
            />
          </label>
        </div>
        <label className="flex flex-1 flex-col">
          <span className={KELAS_LABEL}>Isi (markdown)</span>
          <textarea
            name="isi"
            value={isi}
            onChange={(e) => setIsi(e.target.value)}
            maxLength={60000}
            rows={24}
            className={`${KELAS_MEDAN} flex-1 font-mono text-[13px] leading-relaxed`}
          />
        </label>
        <pre className="rounded-lg bg-panel-bg p-3 text-[11.5px] whitespace-pre-wrap text-panel-muted">{PANDUAN}</pre>

        {pesan && (
          <p className={`text-[13px] font-semibold ${pesan.ok ? "text-leaf" : "text-clay"}`}>{pesan.teks}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={TOMBOL_UTAMA}>
            {pending ? "Menyimpan…" : "Simpan"}
          </button>
          {artikel.terbit ? (
            <button
              type="button"
              disabled={pending}
              className={TOMBOL_GARIS}
              onClick={() =>
                mulai(async () => {
                  const r = await tarikArtikel(artikel.id);
                  setPesan(r.ok ? { ok: true, teks: "Artikel ditarik menjadi draf." } : { ok: false, teks: r.pesan });
                  router.refresh();
                })
              }
            >
              Tarik ke draf
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              className={TOMBOL_GARIS}
              onClick={(e) => {
                const form = e.currentTarget.form;
                if (form?.reportValidity()) jalankan(new FormData(form), () => terbitkanArtikel(artikel.id));
              }}
            >
              Simpan &amp; terbitkan
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            className="ml-auto rounded-lg px-3 py-2 text-[12px] font-bold text-clay disabled:opacity-50"
            onClick={() => {
              if (!confirm(`Hapus artikel "${artikel.judul}"? Tindakan ini tidak bisa dibatalkan.`)) return;
              mulai(async () => {
                const r = await hapusArtikel(artikel.id);
                if (r.ok) router.push("/admin/artikel");
                else setPesan({ ok: false, teks: r.pesan });
              });
            }}
          >
            Hapus
          </button>
        </div>
      </section>

      <section
        aria-label="Pratinjau"
        className={`${kelasFontSitus} rounded-lg border border-panel-border bg-situs-krem p-6 font-jost text-situs-teks xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto`}
      >
        <p className="mb-4 text-[11px] font-bold tracking-[2px] text-panel-muted uppercase">Pratinjau</p>
        <p className="text-[13px] font-semibold tracking-[4px] text-situs-emas uppercase">{kategori || "Kategori"}</p>
        <p className="mt-3 font-garamond text-[36px] leading-[1.08] font-bold text-situs-judul">{judul}</p>
        <p className="mt-3 mb-6 text-sm text-situs-abu">± {terurai.menitBaca} menit baca</p>
        <ArtikelIsi isi={terurai} />
      </section>
    </form>
  );
}
