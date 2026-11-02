import { describe, expect, it } from 'vitest';
import { lpArgs, safeFileName, sumatraArgs } from './printArgs';

const base = { printer: 'HP LaserJet', copies: 2, duplex: true, color: false, paperSize: 'A4' as const };

describe('sumatraArgs', () => {
  it('passes copies, sides, colour and paper as one settings string', () => {
    expect(sumatraArgs('C:\\tmp\\a.pdf', base)).toEqual([
      '-print-to', 'HP LaserJet',
      '-print-settings', '2x,duplexlong,monochrome,paper=A4,shrink',
      '-silent', '-exit-when-done', 'C:\\tmp\\a.pdf',
    ]);
  });

  it('prints colour single-sided', () => {
    const args = sumatraArgs('a.pdf', { ...base, copies: 1, duplex: false, color: true, paperSize: 'A3' });
    expect(args[3]).toBe('1x,simplex,color,paper=A3,shrink');
  });

  it('keeps a printer name with spaces and commas as one argument', () => {
    expect(sumatraArgs('a.pdf', { ...base, printer: 'Epson L3250, Office' })[1]).toBe('Epson L3250, Office');
  });
});

describe('lpArgs', () => {
  it('maps the order to CUPS options', () => {
    expect(lpArgs('/tmp/a.pdf', base)).toEqual([
      '-d', 'HP LaserJet',
      '-n', '2',
      '-o', 'sides=two-sided-long-edge',
      '-o', 'media=A4',
      '-o', 'print-color-mode=monochrome',
      '-o', 'collate=true',
      '--', '/tmp/a.pdf',
    ]);
  });

  it('ends options before the file so a name starting with - is safe', () => {
    const args = lpArgs('-weird.pdf', { ...base, duplex: false, color: true });
    expect(args.slice(-2)).toEqual(['--', '-weird.pdf']);
    expect(args).toContain('sides=one-sided');
    expect(args).toContain('print-color-mode=color');
  });
});

describe('safeFileName', () => {
  it('removes path characters', () => {
    expect(safeFileName('#12 ../../etc/passwd (B&W)')).toBe('#12 .._.._etc_passwd (B&W)');
    expect(safeFileName('')).toBe('print');
  });
});
