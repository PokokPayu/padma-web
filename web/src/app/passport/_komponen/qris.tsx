// QR DEKORATIF — bukan kode QRIS sungguhan, dan halaman mengatakannya apa
// adanya ("Contoh QR — bukan untuk dipindai").
//
// Polanya dibangkitkan SEKALI di tingkat modul dengan LCG berbenih tetap:
// deterministik, jadi render server dan render klien menghasilkan markup yang
// sama persis. Math.random() akan menimbulkan ketidakcocokan hidrasi yang
// munculnya acak, dan membangkitkannya di dalam badan komponen berarti 625
// putaran per render tanpa alasan.
const SISI = 25;

function bangunPola(): Array<[number, number]> {
  let seed = 26082026;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const kotak: Array<[number, number]> = [];
  for (let y = 0; y < SISI; y++) {
    for (let x = 0; x < SISI; x++) {
      const finder = (x < 7 && y < 7) || (x > 17 && y < 7) || (x < 7 && y > 17);
      if (finder) {
        const lx = x > 17 ? x - 18 : x;
        const ly = y > 17 ? y - 18 : y;
        const bingkai = lx === 0 || lx === 6 || ly === 0 || ly === 6;
        const inti = lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4;
        if (bingkai || inti) kotak.push([x, y]);
      } else if (rnd() > 0.52) {
        kotak.push([x, y]);
      }
    }
  }
  return kotak;
}

const POLA = bangunPola();

export function QrisContoh() {
  return (
    <svg
      viewBox={`0 0 ${SISI} ${SISI}`}
      role="img"
      aria-label="Contoh QRIS — bukan kode yang bisa dipindai"
      className="h-[150px] w-[150px] flex-none rounded-xl border border-black/10 bg-white p-2.5"
    >
      {POLA.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#1F2E26" />
      ))}
    </svg>
  );
}
