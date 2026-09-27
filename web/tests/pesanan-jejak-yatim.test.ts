import { describe, it, expect, afterEach } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";
import { querySql } from "./helpers/db";

/**
 * HIGIENE + STRUKTUR jejak pesanan — saudara tests/jejak-yatim.test.ts.
 *
 * `jejak_pesanan` dan `notifikasi_pesanan` SENGAJA tanpa foreign key ke
 * `orders`: jejak audit yang ikut lenyap bersama yang diaudit tidak berguna
 * sama sekali. Konsekuensinya persis yang sudah menggigit repo ini satu kali —
 * tidak ada cascade yang menyapu baris yang sasarannya dihapus, dan tidak satu
 * pun uji lain meng-assert JUMLAH TOTAL jejak, sehingga kebocoran fixture bisa
 * hidup selamanya tanpa memerahkan apa pun.
 *
 * Berkas ini pagar yang hilang itu, untuk tabel pesanan. Setiap berkas uji
 * yang membuat lalu menghapus pesanan WAJIB menyapu jejak & notifikasinya
 * sendiri lewat SERVICE ROLE — peran `authenticated` memang tidak boleh punya
 * DELETE di sini, dan hak itu ditegaskan ulang di bawah supaya "perbaikan"
 * yang sebenarnya melonggarkan keamanan tetap merah.
 */
const svc = createAdminSupabase();

const jejakSampah: string[] = [];
const notifikasiSampah: string[] = [];
const pesananSampah: string[] = [];

afterEach(async () => {
  while (jejakSampah.length) {
    await svc.from("jejak_pesanan").delete().eq("id", jejakSampah.pop()!);
  }
  while (notifikasiSampah.length) {
    await svc.from("notifikasi_pesanan").delete().eq("id", notifikasiSampah.pop()!);
  }
  while (pesananSampah.length) {
    await svc.from("orders").delete().eq("id", pesananSampah.pop()!);
  }
});

const RINA_CLIENT_ID = "44444444-4444-4444-4444-444444444402";

function kodeUji(): string {
  return `PSN-260926-${Math.random().toString(16).slice(2, 8).toUpperCase().padEnd(6, "0")}`;
}

async function semaiPesanan(): Promise<string> {
  const { data, error } = await svc
    .from("orders")
    .insert({ kode: kodeUji(), client_id: RINA_CLIENT_ID, jumlah_item: 1 })
    .select("id")
    .single();
  if (error) throw error;
  pesananSampah.push(data!.id);
  return data!.id;
}

type Yatim = { sumber: string; id: string; pesanan_id: string; keterangan: string | null };

/**
 * Baris jejak & notifikasi yang pesanannya sudah tidak ada.
 *
 * `left join` + `is null`, bentuk yang sama dengan tests/jejak-yatim.test.ts:
 * ia ikut menangkap kolom yang berisi UUID yang tidak pernah ada sama sekali
 * (salah ketik fixture), bukan hanya yang sudah dihapus.
 */
async function yatim(): Promise<Yatim[]> {
  return querySql<Yatim>(
    `select 'jejak_pesanan' as sumber, j.id::text, j.pesanan_id::text, j.kejadian::text as keterangan
       from public.jejak_pesanan j
       left join public.orders o on o.id = j.pesanan_id
      where j.pesanan_id is not null and o.id is null
     union all
     select 'notifikasi_pesanan', n.id::text, n.pesanan_id::text, n.status_midtrans
       from public.notifikasi_pesanan n
       left join public.orders o2 on o2.id = n.pesanan_id
      where n.pesanan_id is not null and o2.id is null
      order by 1, 2`,
  );
}

describe("higiene jejak pesanan", () => {
  it("tidak ada baris jejak/notifikasi YATIM yang ditinggalkan berkas uji mana pun", async () => {
    const baris = await yatim();
    expect(
      baris.length,
      baris.length === 0
        ? ""
        : `${baris.length} baris menunjuk pesanan yang sudah tidak ada.\n` +
          `Sebuah berkas uji membuat pesanan lalu menghapusnya tanpa ikut menyapu\n` +
          `jejak/notifikasinya di afterAll. Kedua tabel itu SENGAJA tanpa foreign key,\n` +
          `jadi tidak ada cascade yang menyapunya — sapu manual lewat SERVICE ROLE.\n` +
          baris.map((b) => `  - ${b.sumber} ${b.id} -> ${b.pesanan_id} (${b.keterangan})`).join("\n"),
    ).toBe(0);
  });

  it("pemindai yatim benar-benar bisa merah (kontrol positif)", async () => {
    // Tanpa kasus ini, uji di atas hijau entah pemindainya bekerja atau
    // tabelnya kosong — dua keadaan yang tidak bisa dibedakan assertion itu
    // sendirian, dan persis kelemahan yang membuat kebocoran jejak lama hidup
    // bertahun-tahun.
    const pesananId = await semaiPesanan();
    const { data } = await svc
      .from("jejak_pesanan")
      .insert({ pesanan_id: pesananId, kejadian: "dibuat", keterangan: "kontrol positif" })
      .select("id")
      .single();
    jejakSampah.push(data!.id);

    // Pesanannya dihapus DULU, jejaknya sengaja ditinggal — inilah bentuk
    // kebocoran yang sedang diburu.
    await svc.from("orders").delete().eq("id", pesananId);
    pesananSampah.length = 0;

    const baris = await yatim();
    expect(baris.some((b) => b.id === data!.id)).toBe(true);
  });
});

describe("jejak 'lunas' lahir TEPAT SATU KALI per pesanan", () => {
  it("jejak lunas kedua untuk pesanan yang sama ditolak 23505", async () => {
    // Inilah SATU-SATUNYA janji P1 kepada proyek WhatsApp: pelanggan kejadian
    // boleh mengandaikan satu baris 'lunas' per pesanan, selamanya.
    // `unique (pesanan_id, kejadian)` SALAH dan akan mematahkan tiga kejadian
    // lain — itu diuji di kasus berikutnya.
    const pesananId = await semaiPesanan();
    const baris = { pesanan_id: pesananId, kejadian: "lunas" };

    const pertama = await svc.from("jejak_pesanan").insert(baris).select("id").single();
    expect(pertama.error).toBeNull();
    jejakSampah.push(pertama.data!.id);

    const kedua = await svc.from("jejak_pesanan").insert(baris).select("id");
    expect(kedua.error?.code).toBe("23505");
    expect(kedua.error?.message).toContain("jejak_pesanan_lunas_sekali");
  });

  it("kejadian LAIN boleh berulang untuk pesanan yang sama", async () => {
    // `notifikasi` lahir satu per notifikasi Midtrans, `diperiksa_ulang` satu
    // per panggilan penyapu, `token_terbit` satu per percobaan. Indeks unik
    // atas (pesanan_id, kejadian) akan mematahkan ketiganya — dan bentuk
    // kegagalannya adalah webhook yang menolak notifikasi kedua Midtrans.
    const pesananId = await semaiPesanan();
    for (const kejadian of ["notifikasi", "notifikasi", "diperiksa_ulang", "diperiksa_ulang"]) {
      const { data, error } = await svc
        .from("jejak_pesanan")
        .insert({ pesanan_id: pesananId, kejadian })
        .select("id")
        .single();
      expect(error, `kejadian ${kejadian} seharusnya boleh berulang`).toBeNull();
      jejakSampah.push(data!.id);
    }
  });
});

describe("notifikasi_pesanan — lapis idempotensi pertama", () => {
  it("sidik kembar ditolak 23505", async () => {
    const pesananId = await semaiPesanan();
    const sidik = `sidik-uji-${Date.now()}`;

    const pertama = await svc
      .from("notifikasi_pesanan")
      .insert({ pesanan_id: pesananId, sidik, status_midtrans: "settlement" })
      .select("id")
      .single();
    expect(pertama.error).toBeNull();
    notifikasiSampah.push(pertama.data!.id);

    const kedua = await svc
      .from("notifikasi_pesanan")
      .insert({ pesanan_id: pesananId, sidik, status_midtrans: "settlement" })
      .select("id");
    expect(kedua.error?.code).toBe("23505");
    expect(kedua.error?.message).toContain("notifikasi_pesanan_sidik_unik");
  });

  it("dua sidik BERBEDA untuk satu pesanan sama-sama diterima", async () => {
    // Midtrans mengirim beberapa notifikasi per pesanan: `pending` lalu
    // `settlement`. Dengan sidik SEPESANAN, yang pertama mengunci barisnya dan
    // `settlement` ditolak sebagai duplikat — pembeli membayar, uang masuk,
    // pesanan tinggal menunggu_bayar selamanya. Kasus ini pagar terhadap
    // "sederhanakan saja sidiknya jadi order_id".
    const pesananId = await semaiPesanan();
    for (const status of ["pending", "settlement"]) {
      const { data, error } = await svc
        .from("notifikasi_pesanan")
        .insert({ pesanan_id: pesananId, sidik: `sidik-${status}-${Date.now()}`, status_midtrans: status })
        .select("id")
        .single();
      expect(error).toBeNull();
      notifikasiSampah.push(data!.id);
    }
  });

  it("nominal_diterima ada dan bertipe angka — bukan teks", async () => {
    // Satu-satunya tempat nominal yang BENAR-BENAR diterima Midtrans
    // disimpan. Untuk baris `ditahan` — satu-satunya baris yang angkanya jadi
    // keputusan manusia — tanpa kolom ini yang tersimpan hanyalah angka yang
    // KITA tagih, dan staf tetap harus membuka dashboard Midtrans.
    const [kolom] = await querySql<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'notifikasi_pesanan'
          and column_name = 'nominal_diterima'`,
    );
    expect(kolom.data_type).toBe("numeric");
    // Nullable: notifikasi yang tanda tangannya sah tapi badannya tanpa
    // gross_amount tetap tercatat, dan "tidak tahu" bukan "nol rupiah".
    expect(kolom.is_nullable).toBe("YES");
  });
});

describe("notifikasi_ditolak_harian — penghitung penyerang", () => {
  it("kolomnya bernama `jumlah`, bukan `total`", async () => {
    // `/(^|_)totals?(_|$)/` adalah pola ke-15 dari sembilan belas di money
    // firewall struktural, dan penghitung notifikasi bertanda tangan salah
    // bukan tabel uang. Nama yang salah di sini memerahkan pagar yang tidak
    // ada hubungannya, dan "perbaikan"-nya akan melebarkan TABEL_UANG.
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'notifikasi_ditolak_harian'
        order by ordinal_position`,
    );
    expect(kolom.map((k) => k.column_name)).toEqual(["tanggal", "jumlah", "tak_dikenal"]);
  });

  it("catat_notifikasi_tak_dikenal() menaikkan tak_dikenal, BUKAN jumlah", async () => {
    // Dua penghitung, dua arti, dan memisahkannya bukan kerapian: `jumlah`
    // adalah notifikasi bertanda tangan PALSU (serangan atau kunci salah),
    // `tak_dikenal` adalah notifikasi bertanda tangan SAH yang order_id-nya
    // tidak menunjuk pesanan mana pun — yaitu uang yang benar-benar milik kita
    // lalu kita buang. Menyatukannya membuat angka kedua tidak pernah bisa
    // dibaca, dan angka kedua itulah satu-satunya jejak yang ditinggalkan
    // cabang `pesanan_tidak_ada`.
    const sebelumnya = await querySql<{ jumlah: number; tak_dikenal: number }>(
      `select jumlah, tak_dikenal from public.notifikasi_ditolak_harian
        where tanggal = current_date`,
    );
    const awal = sebelumnya.length
      ? { jumlah: Number(sebelumnya[0].jumlah), tak: Number(sebelumnya[0].tak_dikenal) }
      : null;

    try {
      expect((await svc.rpc("catat_notifikasi_tak_dikenal")).error).toBeNull();
      expect((await svc.rpc("catat_notifikasi_tak_dikenal")).error).toBeNull();

      const [sesudah] = await querySql<{ jumlah: number; tak_dikenal: number }>(
        `select jumlah, tak_dikenal from public.notifikasi_ditolak_harian
          where tanggal = current_date`,
      );
      expect(Number(sesudah.tak_dikenal)).toBe((awal?.tak ?? 0) + 2);
      // Dan penghitung tanda tangan salah TIDAK ikut bergerak.
      expect(Number(sesudah.jumlah)).toBe(awal?.jumlah ?? 0);
    } finally {
      if (awal === null) {
        await querySql(`delete from public.notifikasi_ditolak_harian where tanggal = current_date`);
      } else {
        await querySql(
          `update public.notifikasi_ditolak_harian
              set jumlah = $1, tak_dikenal = $2
            where tanggal = current_date`,
          [awal.jumlah, awal.tak],
        );
      }
    }
  });

  it("catat_notifikasi_ditolak() menaikkan hitungan hari ini tepat satu per panggilan", async () => {
    // Kenapa RPC, bukan upsert dari TypeScript: supabase-js `upsert` tidak
    // bisa menyatakan `jumlah = jumlah + 1` — ia menimpa. Dua notifikasi
    // bertanda tangan salah dalam satu hari akan tercatat sebagai satu.
    const sebelumnya = await querySql<{ jumlah: number }>(
      `select jumlah from public.notifikasi_ditolak_harian where tanggal = current_date`,
    );
    const awal = sebelumnya.length ? Number(sebelumnya[0].jumlah) : null;

    try {
      // Lewat service role, persis jalur yang dipakai rute webhook (Tugas 8).
      expect((await svc.rpc("catat_notifikasi_ditolak")).error).toBeNull();
      expect((await svc.rpc("catat_notifikasi_ditolak")).error).toBeNull();

      const [sesudah] = await querySql<{ jumlah: number }>(
        `select jumlah from public.notifikasi_ditolak_harian where tanggal = current_date`,
      );
      expect(Number(sesudah.jumlah)).toBe((awal ?? 0) + 2);
    } finally {
      // Dipulihkan PERSIS ke keadaan semula, bukan dihapus membabi buta:
      // berkas uji lain (webhook, Tugas 8) juga menaikkannya, dan menghapus
      // baris milik mereka akan memerahkan berkas yang sehat.
      if (awal === null) {
        await querySql(`delete from public.notifikasi_ditolak_harian where tanggal = current_date`);
      } else {
        await querySql(
          `update public.notifikasi_ditolak_harian set jumlah = $1 where tanggal = current_date`,
          [awal],
        );
      }
    }
  });

  it("authenticated TIDAK boleh memanggil kedua penghitungnya", async () => {
    for (const f of ["catat_notifikasi_ditolak", "catat_notifikasi_tak_dikenal"]) {
      const [row] = await querySql<{ bisa: boolean }>(
        `select has_function_privilege('authenticated',
                  format('public.%I()', $1::text)::regprocedure, 'EXECUTE') as bisa`,
        [f],
      );
      expect(row.bisa, `public.${f}() masih terbuka bagi authenticated`).toBe(false);
    }
  });

  it("tabelnya tertutup untuk kedua peran API", async () => {
    const hak = await querySql<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'notifikasi_ditolak_harian'
          and grantee in ('anon','authenticated')`,
    );
    expect(hak).toEqual([]);
  });
});

describe("hak & RLS kedua tabel jejak", () => {
  it("authenticated hanya memegang SELECT atas jejak_pesanan & notifikasi_pesanan", async () => {
    const hak = await querySql<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('jejak_pesanan','notifikasi_pesanan')
          and grantee = 'authenticated'
        order by table_name, privilege_type`,
    );
    expect(hak.map((h) => `${h.table_name}.${h.privilege_type}`)).toEqual([
      "jejak_pesanan.SELECT",
      "notifikasi_pesanan.SELECT",
    ]);
  });

  it("pembersihan TIDAK boleh dipermudah dengan memberi DELETE ke peran API", async () => {
    // Pagar terhadap "perbaikan" yang salah arah, disalin sengaja dari
    // tests/jejak-yatim.test.ts: kebocoran yatim ditutup dengan menyapu lewat
    // service role — BUKAN dengan melonggarkan hak tabel supaya
    // `authenticated` bisa menghapus jejaknya sendiri.
    const hak = await querySql<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('jejak_pesanan','notifikasi_pesanan')
          and grantee in ('anon','authenticated')
          and privilege_type in ('DELETE','TRUNCATE','UPDATE','INSERT')`,
    );
    expect(hak).toEqual([]);
  });

  it("staf membaca keduanya, klien TIDAK", async () => {
    // Satu baris disisipkan lewat service role tepat sebelum diperiksa, supaya
    // "0 baris" pada sisi klien membuktikan PENYARINGAN, bukan ketiadaan data.
    const pesananId = await semaiPesanan();
    const { data: jejak } = await svc
      .from("jejak_pesanan")
      .insert({ pesanan_id: pesananId, kejadian: "dibuat" })
      .select("id")
      .single();
    jejakSampah.push(jejak!.id);

    const admin = await signInAs("admin@padma.test");
    const dilihatAdmin = await admin.from("jejak_pesanan").select("id").eq("id", jejak!.id);
    expect(dilihatAdmin.error).toBeNull();
    expect((dilihatAdmin.data ?? []).length).toBe(1);

    const klien = await signInAs("ananda@padma.test");
    const dilihatKlien = await klien.from("jejak_pesanan").select("id").eq("id", jejak!.id);
    expect(dilihatKlien.error).toBeNull();
    expect(dilihatKlien.data ?? []).toEqual([]);
  });

  it("anon berhenti di 42501 pada ketiga tabel", async () => {
    for (const tabel of ["jejak_pesanan", "notifikasi_pesanan", "notifikasi_ditolak_harian"]) {
      const { error } = await anonClient().from(tabel).select("*").limit(1);
      expect(error?.code, `anon seharusnya ditolak pada ${tabel}`).toBe("42501");
    }
  });
});
