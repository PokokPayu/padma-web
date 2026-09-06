import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { nomorWaKlinik } from "@/lib/admin/pengaturan";
import { formatTanggalID } from "@/lib/passport/waktu";
import { FormEditKlien } from "../form-klien";
import { KartuAktivasi } from "./kartu-aktivasi";

export const metadata = { title: "Detail Klien" };

type Klien = {
  id: string;
  padma_id: string;
  nama: string;
  email: string;
  no_hp: string;
  phase_id: string;
  user_id: string | null;
  alamat: string;
};

type Sesi = {
  id: string;
  tanggal: string;
  status: string;
  services: { nama: string } | null;
};

export default async function DetailKlienPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["admin", "owner"]);
  const { id } = await params; // Next 16: `params` adalah Promise

  const supabase = await createServerSupabase();

  // Operator SETARA, tidak pernah pola: operator pola akan membuat id berisi
  // `%` cocok dengan baris klien mana pun.
  const { data: klien } = await supabase
    .from("clients")
    .select("id, padma_id, nama, email, no_hp, phase_id, user_id, alamat")
    .eq("id", id)
    .maybeSingle<Klien>();

  if (!klien) notFound();

  // Nomor klinik dibaca per permintaan lewat sesi admin, bukan dipanggang:
  // sejak /admin/pengaturan lahir, nomornya bisa berubah kapan saja dan pesan
  // sambutan yang menyebut nomor mati adalah kesalahan yang tidak terlihat
  // siapa pun sampai ada klien yang tidak bisa menghubungi klinik.
  const [{ data: fase }, { data: sesi }, wa] = await Promise.all([
    supabase
      .from("phases")
      .select("id, nama, urutan")
      .order("urutan")
      .returns<{ id: string; nama: string; urutan: number }[]>(),
    supabase
      .from("sessions")
      .select("id, tanggal, status, services ( nama )")
      .eq("client_id", id)
      .order("tanggal", { ascending: false })
      .limit(8)
      .returns<Sesi[]>(),
    nomorWaKlinik(),
  ]);

  const aktif = klien.user_id !== null;
  const namaFase =
    (fase ?? []).find((f) => f.id === klien.phase_id)?.nama ?? klien.phase_id;

  return (
    <main>
      <Link
        href="/admin/klien"
        className="mb-3.5 inline-block rounded-xl border border-black/10 bg-white px-4 py-2 text-[13px] font-bold"
      >
        ← Kembali ke daftar klien
      </Link>

      <header className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl text-night">{klien.nama}</h1>
            <p className="mt-1 font-mono text-xs text-ink-soft">{klien.padma_id}</p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
              aktif ? "bg-leaf-soft text-leaf" : "bg-clay/10 text-clay"
            }`}
          >
            {aktif ? "Aktif" : "Belum aktif"}
          </span>
        </div>

        <dl className="mt-4 grid gap-3 text-[13.5px] sm:grid-cols-3">
          <div>
            <dt className="text-[11.5px] font-bold uppercase tracking-wider text-ink-soft">
              Email
            </dt>
            <dd className="mt-0.5 break-all">{klien.email}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] font-bold uppercase tracking-wider text-ink-soft">
              WhatsApp
            </dt>
            <dd className="mt-0.5">{klien.no_hp || "—"}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] font-bold uppercase tracking-wider text-ink-soft">
              Fase
            </dt>
            <dd className="mt-0.5">{namaFase}</dd>
          </div>
        </dl>
      </header>

      {/* Kartu aktivasi hanya untuk klien yang BELUM tertaut. Menerbitkan
          tautan untuk akun yang sudah aktif akan menghapus catatan siapa
          menukarkan undangannya — server menolaknya, dan tombolnya pun tidak
          ditawarkan di sini. */}
      {!aktif && (
        <KartuAktivasi
          clientId={klien.id}
          nama={klien.nama}
          nomorWa={wa.tampilan}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <FormEditKlien
          id={klien.id}
          awal={{
            nama: klien.nama,
            noHp: klien.no_hp,
            faseId: klien.phase_id,
            alamat: klien.alamat,
          }}
          fase={fase ?? []}
        />

        <section className="rounded-2xl border border-black/10 bg-white p-5">
          <h2 className="mb-3 font-serif text-lg text-night">Sesi terakhir</h2>
          {(sesi ?? []).length === 0 ? (
            <p className="text-[13px] italic text-ink-soft">
              Belum ada sesi tercatat untuk klien ini.
            </p>
          ) : (
            <ul className="grid gap-2.5">
              {(sesi ?? []).map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 pb-2 text-[13px] last:border-b-0"
                >
                  <span>
                    <b>{s.services?.nama ?? "Layanan"}</b>
                    <span className="mt-0.5 block text-[11.5px] text-ink-soft">
                      {formatTanggalID(s.tanggal)}
                    </span>
                  </span>
                  <span className="text-[11.5px] font-extrabold uppercase tracking-wider text-ink-soft">
                    {s.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
