import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Read the bundled Fredoka's TrueType advance widths. This keeps live graphics
// and the browser preview on the same line breaks without loading a browser in
// playout or approximating the widths of long German words.
let measure: ((text: string, size: number) => number) | undefined;

export function comingUpTextWidth(text: string, size: number): number {
  if (!measure) {
    const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const projectRoot = path.basename(sourceRoot) === 'dist' ? path.dirname(sourceRoot) : sourceRoot;
    const font = fs.readFileSync(path.join(projectRoot, 'assets/weather/fonts/Fredoka.ttf'));
    const tables = new Map<string, number>();
    for (let i = 0; i < font.readUInt16BE(4); i++) {
      const offset = 12 + i * 16;
      tables.set(font.toString('ascii', offset, offset + 4), font.readUInt32BE(offset + 8));
    }
    const table = (name: string): number => {
      const offset = tables.get(name);
      if (offset === undefined) throw new Error(`Fredoka is missing its ${name} table`);
      return offset;
    };
    const units = font.readUInt16BE(table('head') + 18);
    const metricsCount = font.readUInt16BE(table('hhea') + 34);
    const metrics = table('hmtx'), cmap = table('cmap');
    let mapping: number | undefined;
    for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
      const record = cmap + 4 + i * 8;
      const platform = font.readUInt16BE(record), encoding = font.readUInt16BE(record + 2);
      const offset = cmap + font.readUInt32BE(record + 4);
      if ((platform === 0 || (platform === 3 && encoding === 1)) && font.readUInt16BE(offset) === 4) mapping = offset;
    }
    if (mapping === undefined) throw new Error('Fredoka needs a Unicode BMP character map');
    const count = font.readUInt16BE(mapping + 6) / 2;
    const ends = mapping + 14, starts = ends + count * 2 + 2;
    const deltas = starts + count * 2, ranges = deltas + count * 2;
    const widths = new Map<number, number>();
    const advance = (code: number): number => {
      const cached = widths.get(code);
      if (cached !== undefined) return cached;
      let glyph = 0;
      for (let i = 0; i < count; i++) {
        if (code > font.readUInt16BE(ends + i * 2)) continue;
        const start = font.readUInt16BE(starts + i * 2);
        if (code >= start) {
          const delta = font.readInt16BE(deltas + i * 2), range = font.readUInt16BE(ranges + i * 2);
          glyph = range ? font.readUInt16BE(ranges + i * 2 + range + (code - start) * 2) : (code + delta) & 0xffff;
          if (range && glyph) glyph = (glyph + delta) & 0xffff;
        }
        break;
      }
      const width = font.readUInt16BE(metrics + Math.min(glyph, metricsCount - 1) * 4) / units;
      widths.set(code, width); return width;
    };
    measure = (value, fontSize) => Array.from(value).reduce((sum, c) => sum + advance(c.codePointAt(0)!), 0) * fontSize;
  }
  // Small clearance accommodates shaping and rasterization rounding.
  return measure(text, size) * 1.03;
}
