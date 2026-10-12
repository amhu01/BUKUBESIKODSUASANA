/**
 * A 5×7 block font for the share card's custom-text pattern. The letters are
 * never drawn: their filled cells become the mask that the exercise names pack
 * into, the same way the dumbbell or heart shapes work.
 */

const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

/** Long enough for a name, a split or a motto ("LEG DAY", "PR!"), short enough that strokes stay fat. */
export const PATTERN_TEXT_MAX = 8;

/** Uppercase, keep only characters the font has (and single spaces), cap the length. */
export function sanitizePatternText(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9!\- ]/g, '')
    .replace(/ +/g, ' ')
    .replace(/^ /, '')
    .slice(0, PATTERN_TEXT_MAX);
}

/** Split into rows: at spaces if there are any, otherwise as evenly as possible. */
function rowsFor(text: string, rowCount: number): string[] {
  const words = text.split(' ').filter(Boolean);
  if (words.length > 1 && words.length <= 3) return words;
  const flat = words.join('');
  const per = Math.ceil(flat.length / rowCount);
  const rows: string[] = [];
  for (let i = 0; i < flat.length; i += per) rows.push(flat.slice(i, i + per));
  return rows;
}

export interface TextMask {
  w: number;
  h: number;
  inside: (x: number, y: number) => boolean;
  /** The filled cells merged into horizontal runs, for drawing a faint letter tint. */
  backdrop: { x: number; y: number; w: number; h: number }[];
}

/**
 * Lays the letters out to fit `maxW` × `maxH`, choosing 1–3 rows by whichever
 * gives the fattest strokes (a stroke one cell wide has to hold whole words).
 */
export function textMask(text: string, maxW: number, maxH: number): TextMask {
  const clean = sanitizePatternText(text).trim() || 'GYM';
  let best: { rows: string[]; cell: number } | null = null;
  const hasSpaces = clean.includes(' ');
  for (const rowCount of hasSpaces ? [0] : [1, 2, 3]) {
    const rows = rowsFor(clean, rowCount);
    const longest = Math.max(...rows.map((r) => r.length));
    // Each glyph is 5 cells wide with a 1-cell gap; rows are 7 tall with a 2-cell gap.
    const cell = Math.min(maxW / (longest * (GLYPH_W + 1) - 1), maxH / (rows.length * (GLYPH_H + 2) - 2));
    if (!best || cell > best.cell) best = { rows, cell };
  }
  const { rows, cell } = best!;
  const longest = Math.max(...rows.map((r) => r.length));
  const w = (longest * (GLYPH_W + 1) - 1) * cell;
  const h = (rows.length * (GLYPH_H + 2) - 2) * cell;

  // Rasterise once into a cell grid; each row is centred horizontally.
  const cols = Math.round(w / cell);
  const gridRows = Math.round(h / cell);
  const filled = new Uint8Array(cols * gridRows);
  rows.forEach((row, r) => {
    const rowCols = row.length * (GLYPH_W + 1) - 1;
    const x0 = Math.floor((cols - rowCols) / 2);
    const y0 = r * (GLYPH_H + 2);
    [...row].forEach((ch, i) => {
      const glyph = GLYPHS[ch];
      if (!glyph) return;
      for (let gy = 0; gy < GLYPH_H; gy++)
        for (let gx = 0; gx < GLYPH_W; gx++)
          if (glyph[gy][gx] === '1') filled[(y0 + gy) * cols + x0 + i * (GLYPH_W + 1) + gx] = 1;
    });
  });

  const backdrop: TextMask['backdrop'] = [];
  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      if (!filled[gy * cols + gx]) continue;
      let end = gx;
      while (end + 1 < cols && filled[gy * cols + end + 1]) end++;
      backdrop.push({ x: gx * cell, y: gy * cell, w: (end - gx + 1) * cell, h: cell });
      gx = end;
    }
  }

  return {
    w,
    h,
    backdrop,
    inside: (x, y) => {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      return cx >= 0 && cy >= 0 && cx < cols && cy < gridRows && filled[cy * cols + cx] === 1;
    },
  };
}
