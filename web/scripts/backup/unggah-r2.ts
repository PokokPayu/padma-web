/**
 * CLI backup: mengunggah satu berkas terenkripsi ke R2 lalu menerapkan retensi.
 *
 * Dipanggil workflow:
 *   npx tsx scripts/backup/unggah-r2.ts <berkas> <capWaktu>
 *
 * Seluruh keputusan hidup di src/lib/backup/*; berkas ini hanya merangkai
 * klien sungguhan dan menerjemahkan galat menjadi exit code.
 */
import { readFileSync } from "node:fs";
import {
  S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { unggahDanTerapkanRetensi, type KlienObjek } from "../../src/lib/backup/unggah";

function wajib(nama: string): string {
  const nilai = process.env[nama];
  if (nilai === undefined || nilai === "") {
    // Menyebut NAMA secret-nya, tidak pernah nilainya.
    console.error(`Secret ${nama} belum dipasang.`);
    process.exit(1);
  }
  return nilai;
}

// Dibungkus dalam fungsi async, BUKAN top-level await: web/package.json
// tidak menyetel "type": "module", jadi tsx mentranspilasi berkas ini ke
// CommonJS, dan esbuild menolak top-level await di format cjs
// (ERR_REQUIRE_ASYNC_MODULE). Menambahkan "type": "module" akan mengenai
// seluruh aplikasi Next.js, jadi pagar ini dipasang di sini saja.
async function utama() {
  const [berkas, capWaktu] = process.argv.slice(2);
  if (berkas === undefined || capWaktu === undefined) {
    console.error("Pakai: unggah-r2.ts <berkas> <capWaktu YYYYMMDD-HHMMSSZ>");
    process.exit(1);
  }

  const BUCKET = wajib("R2_BUCKET_BACKUP");
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${wajib("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: wajib("R2_ACCESS_KEY_ID"),
      secretAccessKey: wajib("R2_SECRET_ACCESS_KEY"),
    },
  });

  const klien: KlienObjek = {
    async daftar(prefiks) {
      const kunci: string[] = [];
      let token: string | undefined;
      // Paginasi WAJIB: tanpa ContinuationToken, R2 berhenti di 1000 objek dan
      // retensi diam-diam melewatkan sisanya.
      do {
        const r = await s3.send(new ListObjectsV2Command({
          Bucket: BUCKET, Prefix: prefiks, ContinuationToken: token,
        }));
        for (const o of r.Contents ?? []) if (o.Key !== undefined) kunci.push(o.Key);
        token = r.IsTruncated === true ? r.NextContinuationToken : undefined;
      } while (token !== undefined);
      return kunci;
    },
    async unggah(kunci, isi) {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: kunci, Body: isi,
        ContentType: "application/octet-stream",
      }));
    },
    async hapus(kunci) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: kunci }));
    },
  };

  const hasil = await unggahDanTerapkanRetensi(klien, {
    capWaktu,
    isi: readFileSync(berkas),
    sekarangEpochMs: Date.now(),
  });

  console.log(`Terunggah: ${hasil.kunciBaru}`);
  console.log(`Dihapus  : ${hasil.dihapus.length} objek kedaluwarsa`);
  for (const k of hasil.dihapus) console.log(`  - ${k}`);
}

utama();
