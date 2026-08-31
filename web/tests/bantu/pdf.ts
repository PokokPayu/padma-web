/**
 * PDF minimal yang sah, dibuat TANPA dependensi.
 *
 * Dipakai unit test maupun E2E supaya tidak ada berkas biner yang perlu
 * di-commit sebagai fixture — dan supaya jumlah halamannya bisa diatur per
 * test. Offset xref dihitung dari panjang string yang sudah tersusun; PDF
 * dengan xref salah akan ditolak PDF.js, jadi ini bukan detail yang bisa
 * dikira-kira.
 */
export function buatPdfUji(jumlahHalaman: number): Buffer {
  const objek: string[] = [];
  const kids: string[] = [];
  const idFont = 3 + jumlahHalaman * 2;

  for (let i = 0; i < jumlahHalaman; i++) {
    const idPage = 3 + i * 2;
    const idIsi = idPage + 1;
    kids.push(`${idPage} 0 R`);
    const isi = `BT /F1 24 Tf 20 100 Td (HALAMAN ${i + 1}) Tj ET`;
    objek[idPage] =
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]` +
      `/Contents ${idIsi} 0 R/Resources<</Font<</F1 ${idFont} 0 R>>>>>>`;
    objek[idIsi] = `<</Length ${isi.length}>>stream\n${isi}\nendstream`;
  }
  objek[1] = `<</Type/Catalog/Pages 2 0 R>>`;
  objek[2] = `<</Type/Pages/Kids[${kids.join(" ")}]/Count ${jumlahHalaman}>>`;
  objek[idFont] = `<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>`;

  let pdf = "%PDF-1.4\n";
  const offset: number[] = [];
  for (let id = 1; id <= idFont; id++) {
    offset[id] = pdf.length;
    pdf += `${id} 0 obj\n${objek[id]}\nendobj\n`;
  }
  const awalXref = pdf.length;
  pdf += `xref\n0 ${idFont + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= idFont; id++) {
    pdf += `${String(offset[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<</Size ${idFont + 1}/Root 1 0 R>>\nstartxref\n${awalXref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
