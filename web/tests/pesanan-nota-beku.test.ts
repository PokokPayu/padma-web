import { describe, it, expect, afterEach } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";
import { querySql } from "./helpers/db";
import { varianBaku } from "./helpers/varian";
import { JAM_TENGGAT_PESANAN } from "@/lib/pesanan/status";

/**
 * NOTA PESANAN — tabel uang yang barisnya tidak boleh ditulis ulang.
 *
 * `order_items.harga_beku` adalah satu-satunya angka yang dipakai
 * memverifikasi `gross_amount` notifikasi Midtrans. Bila baris itu bisa
 * disunting sesudah terbit, verifikasi jumlah berhenti berarti apa pun:
 * siapa pun yang bisa menulisnya bisa membuat setiap notifikasi "cocok".
 *
 * Karena itu pembekuannya dijaga TRIGGER, bukan ketiadaan policy. Ketiadaan
 * policy menjaga peran API; yang paling mungkin menulis ulang harga beku
 * justru webhook ber-SERVICE ROLE, dan service role melewati RLS sepenuhnya.
 * Uji di describe "pembekuan" karena itu menembak DUA jalur: PostgREST dengan
 * service role, dan SQL langsung sebagai `postgres`.
 *
 * DELETE sengaja TIDAK dijaga, dan itu diuji sebagai assertion positif:
 * cascade dari `orders` menjalankan DELETE sungguhan pada baris anak, dan
 * menolaknya membuat pesanan mustahil dihapus siapa pun — termasuk
 * pembersihan fixture berkas ini sendiri.
 */

// Diketik ulang, bukan diimpor dari scripts/seed-users.ts — pola yang sama
// dengan tests/link-client-injeksi.test.ts:36-38. Sumbernya
// scripts/seed-users.ts:23-24; keduanya disemai tests/global-setup.ts.
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";
const RINA_CLIENT_ID = "44444444-4444-4444-4444-444444444402";

const svc = createAdminSupabase();

/**
 * Sampah fixture, dibongkar terbalik di afterEach.
 *
 * URUTANNYA MENGIKAT: pesanan lebih dulu (cascade menyapu itemnya), baru
 * produk. `orders.client_id` ber-`on delete restrict`, jadi klien seed tidak
 * pernah ikut tersentuh — itu memang maksudnya: nota yang bisa lenyap bukan
 * nota.
 *
 * Kenapa ini bukan kerapian belaka: `pesanan_terbuka_satu_per_klien` adalah
 * indeks unik PARSIAL atas (client_id) untuk status 'menunggu_bayar'. Satu
 * pesanan terbuka yang tertinggal di sini akan memerahkan SETIAP berkas uji
 * lain yang membuat pesanan untuk klien yang sama — termasuk uji checkout
 * Tugas 4.
 */
const pesananSampah: string[] = [];
const produkSampah: string[] = [];
const permintaanSampah: string[] = [];

afterEach(async () => {
  while (pesananSampah.length) {
    await svc.from("orders").delete().eq("id", pesananSampah.pop()!);
  }
  while (permintaanSampah.length) {
    await svc.from("booking_requests").delete().eq("id", permintaanSampah.pop()!);
  }
  while (produkSampah.length) {
    await svc.from("digital_products").delete().eq("id", produkSampah.pop()!);
  }
});

let urutanSlug = 0;

async function semaiProduk(judul = "Uji nota beku"): Promise<string> {
  urutanSlug += 1;
  const { data, error } = await svc
    .from("digital_products")
    .insert({ judul, slug: `uji-nota-beku-${Date.now()}-${urutanSlug}`, jenis: "pdf", aktif: true })
    .select("id")
    .single();
  if (error) throw error;
  produkSampah.push(data!.id);
  return data!.id;
}

/**
 * Satu permintaan jadwal, bahan uji CHECK bercermin sisi `sesi`.
 *
 * Statusnya 'ditolak' SENGAJA: indeks dedup antrean
 * (`booking_requests_antrean_unik`) hanya mencakup diminta/mencari_mitra/
 * mitra_siap, jadi baris ini tidak pernah bertabrakan dengan fixture berkas
 * uji lain.
 *
 * TANPA `screening_id`, dan itu sah: kolomnya di-`drop not null`
 * (20260912130000_tenggat_dan_skrining.sql:27) dan indeks uniknya kini parsial
 * `where screening_id is not null`. Ketiga trigger BEFORE INSERT pada tabel itu
 * — termasuk `guard_booking_skrining` yang menuntut skrining hijau — bergerbang
 * `current_user in ('anon','authenticated','authenticator')`, jadi service role
 * melewatinya. Fixture ini karena itu tidak perlu menyeret satu baris
 * `screenings` yang kemudian harus ikut disapu.
 *
 * Tidak ada trigger jejak status bayar pada `booking_requests`
 * (jejak_status_bayar hanya dipasang pada `sessions` dan `client_packages`),
 * jadi baris ini tidak meninggalkan jejak yatim.
 */
async function semaiPermintaan(): Promise<string> {
  const { data: layanan, error: eLayanan } = await svc
    .from("services")
    .select("id")
    .eq("aktif", true)
    .limit(1)
    .single();
  if (eLayanan) throw eLayanan;

  const { data, error } = await svc
    .from("booking_requests")
    .insert({
      client_id: ANANDA_CLIENT_ID,
      service_id: layanan!.id,
      variant_id: await varianBaku(svc, layanan!.id),
      tanggal: "2027-01-15",
      preferensi_waktu: "pagi",
      jam_mulai: "09:00",
      status: "ditolak",
    })
    .select("id")
    .single();
  if (error) throw error;
  permintaanSampah.push(data!.id);
  return data!.id;
}

function kodeUji(): string {
  const acak = Math.random().toString(16).slice(2, 8).toUpperCase().padEnd(6, "0");
  return `PSN-260926-${acak}`;
}

type BentukPesanan = {
  client_id?: string;
  status?: string;
  ditutup_pada?: string | null;
  percobaan?: number;
  jumlah_item?: number;
};

async function sisipPesanan(bentuk: BentukPesanan = {}) {
  const hasil = await svc
    .from("orders")
    .insert({
      kode: kodeUji(),
      client_id: bentuk.client_id ?? ANANDA_CLIENT_ID,
      status: bentuk.status ?? "menunggu_bayar",
      ditutup_pada: bentuk.ditutup_pada ?? null,
      percobaan: bentuk.percobaan ?? 1,
      jumlah_item: bentuk.jumlah_item ?? 1,
    })
    .select("id")
    .single();
  if (hasil.data) pesananSampah.push(hasil.data.id);
  return hasil;
}

describe("struktur orders", () => {
  it("berkolom PERSIS sembilan belas, urut seperti yang ditulis migrasi", async () => {
    // Daftar dikunci karena menambah kolom ke tabel uang adalah satu baris
    // ketikan yang tidak memerahkan apa pun — dan tabel ini yang menjadi nota.
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'orders'
        order by ordinal_position`,
    );
    expect(kolom.map((k) => k.column_name)).toEqual([
      "id",
      "kode",
      "percobaan",
      "client_id",
      "status",
      "jumlah_item",
      "dibuat_pada",
      "kedaluwarsa_pada",
      "lunas_pada",
      "ditutup_pada",
      "snap_token",
      "snap_diterbitkan_pada",
      "notifikasi_pada",
      "diperiksa_pada",
      "butuh_tinjauan_pada",
      "sebab_tinjauan",
      "kanal",
      "transaksi_id",
      "status_midtrans",
    ]);
  });

  it("NOL kolom nominal — total dijumlahkan dari order_items, tidak pernah disimpan", async () => {
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'orders'`,
    );
    const nominal = kolom
      .map((k) => k.column_name)
      .filter((n) => /(^|_)(harga|nominal|tarif|biaya|totals?|amounts?)(_|$)/.test(n));
    expect(
      nominal,
      "orders SENGAJA lahir tanpa kolom nominal — itulah kenapa ia TIDAK masuk " +
        "TABEL_UANG di tests/money-firewall-struktural.test.ts. Kolom nominal di " +
        "sini akan membocorkan angka ke dua policy SELECT yang dipegang klien.",
    ).toEqual([]);
  });

  it("tenggat bawaannya SAMA dengan JAM_TENGGAT_PESANAN di TypeScript", async () => {
    // Pengikat dua angka yang harus identik. Payload Snap memakai konstanta
    // TS; kolom ini memakai literal SQL. Dua angka yang boleh berbeda adalah
    // dua kegagalan simetris — kolom lebih pendek berarti settlement mendarat
    // pada pesanan yang sudah kita tutup.
    const [kolom] = await querySql<{ column_default: string | null }>(
      `select column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'orders'
          and column_name = 'kedaluwarsa_pada'`,
    );
    expect(kolom.column_default).toContain(`${JAM_TENGGAT_PESANAN}:00:00`);
  });

  it("client_id ber-ON DELETE RESTRICT — nota yang bisa lenyap bukan nota", async () => {
    const [fk] = await querySql<{ confdeltype: string }>(
      `select c.confdeltype
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public' and t.relname = 'orders' and c.contype = 'f'
          and c.conkey = array[(select attnum from pg_attribute
                                 where attrelid = t.oid and attname = 'client_id')]`,
    );
    // 'r' = restrict, 'c' = cascade, 'a' = no action.
    expect(fk.confdeltype).toBe("r");
  });
});

describe("dua CHECK berpasangan — nilai enum yang lupa diklasifikasikan gagal", () => {
  it("status tertutup WAJIB membawa ditutup_pada", async () => {
    const { error } = await sisipPesanan({ status: "lunas", ditutup_pada: null });
    expect(error?.code).toBe("23514");
    // Postgres melaporkan pelanggaran CHECK menurut URUTAN ABJAD nama
    // constraint (index scan atas pg_constraint), BUKAN urutan deklarasi —
    // dibuktikan lewat tabel percobaan terpisah sebelum baris ini ditulis.
    // Untuk KELIMA nilai order_status yang sudah diklasifikasi, kedua CHECK
    // berpasangan itu logisnya EKUIVALEN (status & ditutup_pada saling
    // komplementer-eksklusif atas domain lima nilai itu), jadi baris yang
    // salah selalu melanggar KEDUANYA sekaligus, dan "pesanan_terbuka_tanpa_cap"
    // menang abjad atas "pesanan_tutup_bercap". Errcode 23514 di atas sudah
    // membuktikan pasangan CHECK ini menolak baris tertutup tanpa cap;
    // assertion di bawah menerima nama YANG MANA PUN dari pasangan itu,
    // bukan cuma satu yang kebetulan menang urutan.
    expect(error?.message).toMatch(/pesanan_(tutup_bercap|terbuka_tanpa_cap)/);
  });

  it("status menunggu_bayar TIDAK boleh membawa ditutup_pada", async () => {
    const { error } = await sisipPesanan({
      status: "menunggu_bayar",
      ditutup_pada: new Date().toISOString(),
    });
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("pesanan_terbuka_tanpa_cap");
  });

  it("pasangan yang benar lolos KEDUA CHECK", async () => {
    // Pagar yang membabi buta akan membuat kasus ini merah. Dua arah, satu
    // batas — kedua CHECK positif harus bisa dipenuhi bersamaan.
    const { error } = await sisipPesanan({
      status: "lunas",
      ditutup_pada: new Date().toISOString(),
    });
    expect(error).toBeNull();
  });

  it("percobaan di luar 1..9 ditolak di kedua ujungnya", async () => {
    const nol = await sisipPesanan({ percobaan: 0 });
    expect(nol.error?.code).toBe("23514");
    expect(nol.error?.message).toContain("pesanan_percobaan_wajar");

    const sepuluh = await sisipPesanan({ percobaan: 10 });
    expect(sepuluh.error?.code).toBe("23514");
  });
});

describe("satu pesanan terbuka per klien", () => {
  it("pesanan terbuka KEDUA untuk klien yang sama ditolak 23505", async () => {
    // Inilah yang membuat "dua panggilan checkout paralel melahirkan tepat
    // satu pesanan" benar tanpa kunci di TypeScript (Tugas 4): yang kalah
    // menerima 23505, membaca ulang, dan memulangkan pesanan terbuka yang
    // sudah ada.
    const pertama = await sisipPesanan();
    expect(pertama.error).toBeNull();

    const kedua = await sisipPesanan();
    expect(kedua.error?.code).toBe("23505");
    expect(kedua.error?.message).toContain("pesanan_terbuka_satu_per_klien");
  });

  it("dua klien BERBEDA boleh sama-sama punya pesanan terbuka", async () => {
    // Pagar yang kebablasan akan membuat PADMA hanya bisa melayani satu
    // pembeli pada satu waktu.
    const a = await sisipPesanan({ client_id: ANANDA_CLIENT_ID });
    const b = await sisipPesanan({ client_id: RINA_CLIENT_ID });
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
  });

  it("pesanan yang sudah TERTUTUP tidak menghalangi pesanan terbuka berikutnya", async () => {
    const lama = await sisipPesanan({
      status: "kedaluwarsa",
      ditutup_pada: new Date().toISOString(),
    });
    expect(lama.error).toBeNull();

    const baru = await sisipPesanan();
    expect(baru.error).toBeNull();
  });
});

describe("dua CHECK bercermin pada order_items", () => {
  async function sisipItem(isi: Record<string, unknown>) {
    const pesanan = await sisipPesanan();
    return svc
      .from("order_items")
      .insert({
        pesanan_id: pesanan.data!.id,
        judul_beku: "Kelas Prakonsepsi",
        harga_beku: 150000,
        urutan: 1,
        ...isi,
      })
      .select("id");
  }

  it("jenis produk_digital TANPA product_id ditolak", async () => {
    const permintaanId = await semaiPermintaan();
    const { error } = await sisipItem({
      jenis: "produk_digital",
      booking_request_id: permintaanId,
    });
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("item_produk_bercermin");
  });

  it("jenis sesi yang membawa product_id ditolak", async () => {
    // Dengan SATU CHECK (`num_nonnulls = 1`) saja, baris ini lolos: ia memang
    // hanya mengisi satu kolom. Cerminnya yang menangkapnya — jenis='sesi'
    // dengan product_id terisi melanggar KEDUA cermin sekaligus
    // (item_produk_bercermin karena product_id terisi padahal jenis bukan
    // 'produk_digital', item_sesi_bercermin karena booking_request_id kosong
    // padahal jenis 'sesi'). Postgres melaporkan menurut abjad nama
    // constraint, bukan urutan deklarasi (dibuktikan empiris), dan
    // "item_produk_bercermin" menang abjad — assertion di bawah menerima
    // nama YANG MANA PUN dari pasangan cermin ini.
    const produkId = await semaiProduk();
    const { error } = await sisipItem({ jenis: "sesi", product_id: produkId });
    expect(error?.code).toBe("23514");
    expect(error?.message).toMatch(/item_(produk|sesi)_bercermin/);
  });

  it("mengisi KEDUA kolom sumber ditolak", async () => {
    const produkId = await semaiProduk();
    const permintaanId = await semaiPermintaan();
    const { error } = await sisipItem({
      jenis: "produk_digital",
      product_id: produkId,
      booking_request_id: permintaanId,
    });
    expect(error?.code).toBe("23514");
    // Baris ini juga melanggar item_sesi_bercermin (booking_request_id terisi
    // padahal jenis bukan 'sesi'), dan itu menang abjad atas
    // item_sumber_tunggal. item_produk_bercermin sendiri LOLOS di sini (jenis
    // memang 'produk_digital' dan product_id memang terisi) — pasangan yang
    // menangkap baris ini adalah item_sumber_tunggal DAN item_sesi_bercermin,
    // bukan cermin produk. Assertion menerima YANG MANA PUN dari keduanya.
    expect(error?.message).toMatch(/item_(sumber_tunggal|sesi_bercermin)/);
  });

  it("baris produk_digital yang benar lolos", async () => {
    const produkId = await semaiProduk();
    const { error } = await sisipItem({ jenis: "produk_digital", product_id: produkId });
    expect(error).toBeNull();
  });

  it("baris sesi yang benar lolos — P3 tidak perlu alter table pada tabel uang", async () => {
    // `booking_request_id` lahir sekarang dan tidak pernah terisi di P1. Ini
    // pelanggaran SADAR terhadap doktrin "nol kolom mati": ongkosnya asimetris
    // — satu kolom nullable hari ini versus alter table pada tabel uang yang
    // sudah memuat nota nyata besok. Assertion ini membuktikan jalurnya memang
    // terbuka, bukan sekadar dijanjikan.
    const permintaanId = await semaiPermintaan();
    const { error } = await sisipItem({ jenis: "sesi", booking_request_id: permintaanId });
    expect(error).toBeNull();
  });

  it("urutan kembar dalam satu pesanan ditolak", async () => {
    const produkId = await semaiProduk();
    const pesanan = await sisipPesanan();
    const baris = {
      pesanan_id: pesanan.data!.id,
      jenis: "produk_digital",
      product_id: produkId,
      judul_beku: "Kelas Prakonsepsi",
      harga_beku: 150000,
      urutan: 1,
    };
    expect((await svc.from("order_items").insert(baris).select("id")).error).toBeNull();
    const kedua = await svc.from("order_items").insert(baris).select("id");
    expect(kedua.error?.code).toBe("23505");
    expect(kedua.error?.message).toContain("order_items_pesanan_urutan_unik");
  });
});

describe("pembekuan baris nota", () => {
  async function semaiNota(): Promise<{ pesananId: string; itemId: string }> {
    const produkId = await semaiProduk();
    const pesanan = await sisipPesanan();
    const { data, error } = await svc
      .from("order_items")
      .insert({
        pesanan_id: pesanan.data!.id,
        jenis: "produk_digital",
        product_id: produkId,
        judul_beku: "Kelas Prakonsepsi",
        harga_beku: 150000,
        urutan: 1,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { pesananId: pesanan.data!.id, itemId: data!.id };
  }

  it("UPDATE lewat PostgREST dengan SERVICE ROLE ditolak 42501", async () => {
    const { itemId } = await semaiNota();
    const { error } = await svc.from("order_items").update({ harga_beku: 1 }).eq("id", itemId);
    expect(error?.code).toBe("42501");
  });

  it("UPDATE lewat SQL langsung sebagai postgres JUGA ditolak 42501", async () => {
    // Bukan pengulangan. Uji di atas membuktikan pagarnya berdiri di jalur
    // PostgREST; uji ini membuktikan ia bukan pagar PostgREST — trigger tanpa
    // gerbang `current_user` menolak SIAPA PUN, termasuk superuser migrasi.
    // Kalau seseorang kelak menambahkan gerbang peran "supaya pemeliharaan
    // gampang", uji inilah yang merah.
    const { itemId } = await semaiNota();
    await expect(
      querySql(`update public.order_items set harga_beku = 1 where id = $1`, [itemId]),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("UPDATE kolom yang BUKAN nominal pun ditolak", async () => {
    // Trigger menolak SELURUH update, bukan `update of harga_beku`. Judul beku
    // adalah bagian nota yang sama: nota yang judulnya bisa diganti sesudah
    // terbit bukan nota.
    const { itemId } = await semaiNota();
    const { error } = await svc
      .from("order_items")
      .update({ judul_beku: "Judul lain" })
      .eq("id", itemId);
    expect(error?.code).toBe("42501");
  });

  it("DELETE baris item TIDAK dijaga — cascade harus bisa jalan", async () => {
    const { itemId } = await semaiNota();
    const { error } = await svc.from("order_items").delete().eq("id", itemId);
    expect(error).toBeNull();
  });

  it("menghapus pesanan ikut menyapu itemnya (cascade sungguhan)", async () => {
    const { pesananId, itemId } = await semaiNota();
    const { error } = await svc.from("orders").delete().eq("id", pesananId);
    expect(error).toBeNull();

    const { data } = await svc.from("order_items").select("id").eq("id", itemId);
    expect(data ?? []).toEqual([]);
  });
});

describe("hak tabel & RLS", () => {
  it("authenticated hanya memegang SELECT atas orders — tidak pernah menulis", async () => {
    const hak = await querySql<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'orders' and grantee = 'authenticated'
        order by privilege_type`,
    );
    expect(hak.map((h) => h.privilege_type)).toEqual(["SELECT"]);
  });

  it("authenticated TIDAK memegang hak apa pun atas order_items", async () => {
    // Nol grant, bukan "grant select lalu RLS". Baris nota tidak pernah dibaca
    // langsung oleh peran API — yang dibaca layar staf adalah view
    // `pesanan_item_staf` (migrasi 5), yang batas kolom & perannya ada DI
    // DALAM view.
    const hak = await querySql<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'order_items'
          and grantee = 'authenticated'`,
    );
    expect(hak).toEqual([]);
  });

  it("anon nol hak atas KEDUA tabel", async () => {
    const hak = await querySql<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name in ('orders','order_items')
          and grantee = 'anon'`,
    );
    expect(hak).toEqual([]);
  });

  it("klien membaca pesanannya sendiri dan TIDAK membaca pesanan klien lain", async () => {
    // Dua baris disisipkan lewat service role tepat sebelum diperiksa, supaya
    // "0 baris" membuktikan PENYARINGAN, bukan ketiadaan data.
    const milikAnanda = await sisipPesanan({ client_id: ANANDA_CLIENT_ID });
    const milikRina = await sisipPesanan({ client_id: RINA_CLIENT_ID });
    expect(milikAnanda.error).toBeNull();
    expect(milikRina.error).toBeNull();

    const klien = await signInAs("ananda@padma.test");
    const { data, error } = await klien
      .from("orders")
      .select("id")
      .in("id", [milikAnanda.data!.id, milikRina.data!.id]);
    expect(error).toBeNull();
    expect((data ?? []).map((b) => b.id)).toEqual([milikAnanda.data!.id]);
  });

  it("staf membaca KEDUANYA", async () => {
    const milikAnanda = await sisipPesanan({ client_id: ANANDA_CLIENT_ID });
    const milikRina = await sisipPesanan({ client_id: RINA_CLIENT_ID });

    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin
      .from("orders")
      .select("id")
      .in("id", [milikAnanda.data!.id, milikRina.data!.id]);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(2);
  });

  it("klien login berhenti di 42501 pada order_items — GRANT, bukan RLS", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { error } = await klien.from("order_items").select("harga_beku").limit(1);
    expect(error?.code).toBe("42501");
  });

  it("anon berhenti di 42501 pada orders", async () => {
    const { error } = await anonClient().from("orders").select("kode").limit(1);
    expect(error?.code).toBe("42501");
  });

  it("klien TIDAK bisa menyisipkan pesanan untuk dirinya lewat REST", async () => {
    // Checkout adalah RPC (Tugas 4), bukan insert. Klien yang bisa menulis
    // barisnya sendiri adalah klien yang bisa memilih harganya sendiri.
    const klien = await signInAs("ananda@padma.test");
    const { error } = await klien
      .from("orders")
      .insert({ kode: kodeUji(), client_id: ANANDA_CLIENT_ID, jumlah_item: 1 })
      .select("id");
    expect(error?.code).toBe("42501");
  });
});
