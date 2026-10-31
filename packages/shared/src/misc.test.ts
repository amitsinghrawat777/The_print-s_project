import { describe, expect, it } from 'vitest';
import { fileTypeFromName, ACCEPT_ATTRIBUTE } from './constants';
import { signBody, signedHeaders, verifyBody, SIGNATURE_HEADER, TIMESTAMP_HEADER } from './hmac';
import { planPrintParts } from './printPlan';
import { submitJobBody } from './schemas';
import { canTransition, JOB_STATUSES, JOB_TRANSITIONS } from './status';

describe('planPrintParts', () => {
  const base = { pageSequence: [1, 2, 3, 4], colorPages: [] as number[], copies: 1, sides: 'single' as const };

  it('makes one B&W or one colour part when the file is not mixed', () => {
    expect(planPrintParts(base, 'split')).toEqual([{ kind: 'bw', pages: [1, 2, 3, 4], mixed: false }]);
    expect(planPrintParts({ ...base, colorPages: [1, 2, 3, 4] }, 'split')).toEqual([
      { kind: 'color', pages: [1, 2, 3, 4], mixed: false },
    ]);
  });

  it('splits a mixed single-sided single copy when the shop splits', () => {
    expect(planPrintParts({ ...base, colorPages: [3] }, 'split')).toEqual([
      { kind: 'bw', pages: [1, 2, 4], mixed: false },
      { kind: 'color', pages: [3], mixed: false },
    ]);
  });

  it('keeps one mixed colour part when splitting would scramble sheets', () => {
    const mixed = [{ kind: 'color', pages: [1, 2, 3, 4], mixed: true }];
    expect(planPrintParts({ ...base, colorPages: [3], sides: 'double' }, 'split')).toEqual(mixed);
    expect(planPrintParts({ ...base, colorPages: [3], copies: 2 }, 'split')).toEqual(mixed);
    expect(planPrintParts({ ...base, colorPages: [3] }, 'single_pass')).toEqual(mixed);
  });
});

describe('hmac', () => {
  it('verifies its own signature and rejects tampering', async () => {
    const headers = await signedHeaders('secret', '{"a":1}');
    const ts = headers[TIMESTAMP_HEADER];
    const sig = headers[SIGNATURE_HEADER];
    expect(await verifyBody('secret', ts, '{"a":1}', sig)).toBe(true);
    expect(await verifyBody('secret', ts, '{"a":2}', sig)).toBe(false);
    expect(await verifyBody('other', ts, '{"a":1}', sig)).toBe(false);
    expect(await verifyBody('secret', ts, '{"a":1}', 'zz')).toBe(false);
    expect(await verifyBody('secret', undefined, '{"a":1}', sig)).toBe(false);
  });

  it('rejects old timestamps', async () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const sig = await signBody('secret', old, 'x');
    expect(await verifyBody('secret', old, 'x', sig)).toBe(false);
  });
});

describe('status transitions', () => {
  it('only lists known statuses', () => {
    for (const [from, tos] of Object.entries(JOB_TRANSITIONS)) {
      expect(JOB_STATUSES).toContain(from);
      for (const to of tos) expect(JOB_STATUSES).toContain(to);
    }
  });

  it('allows the happy path and blocks going backwards', () => {
    const path = ['draft', 'building', 'new', 'opened', 'printing', 'ready', 'done'] as const;
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
    expect(canTransition('done', 'new')).toBe(false);
    expect(canTransition('new', 'draft')).toBe(false);
  });
});

describe('file types', () => {
  it('recognises accepted files by extension', () => {
    expect(fileTypeFromName('Resume.PDF')?.kind).toBe('pdf');
    expect(fileTypeFromName('photo.jpeg')?.mime).toBe('image/jpeg');
    expect(fileTypeFromName('notes.docx')?.kind).toBe('office');
    expect(fileTypeFromName('virus.exe')).toBeNull();
    expect(fileTypeFromName('noextension')).toBeNull();
    expect(ACCEPT_ATTRIBUTE).toContain('.pptx');
  });
});

describe('submitJobBody', () => {
  const file = {
    fileId: '0d6f3f2e-9c1a-4b8e-8f43-2d6f0b1c9a10',
    pageSequence: [1],
    colorPages: [],
    copies: 1,
    sides: 'single',
    paperSize: 'A4',
  };

  it('trims the name and defaults the note', () => {
    const parsed = submitJobBody.parse({ customerName: '  Ravi ', files: [file], clientTotalPaise: 200 });
    expect(parsed.customerName).toBe('Ravi');
    expect(parsed.note).toBe('');
  });

  it('rejects a blank name and duplicate files', () => {
    expect(submitJobBody.safeParse({ customerName: ' ', files: [file], clientTotalPaise: 0 }).success).toBe(false);
    expect(
      submitJobBody.safeParse({ customerName: 'A', files: [file, file], clientTotalPaise: 0 }).success,
    ).toBe(false);
  });
});
