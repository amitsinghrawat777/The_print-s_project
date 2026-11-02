import { describe, expect, it } from 'vitest';
import { detectOs, safeNext } from './os';
import { buildRateRows, defaultDraft, keyOf, toPaise } from './rates';
import { SLUG_RE, nextSlug, slugProblem, slugify } from './slug';

describe('slugify', () => {
  it('makes a link from a shop name', () => {
    expect(slugify('Sharma Xerox & Print')).toBe('sharma-xerox-print');
    expect(slugify('  Café   Prints!! ')).toBe('cafe-prints');
    expect(slugify('---')).toBe('');
  });

  it('stays within 40 characters and never ends with a dash', () => {
    const slug = slugify('a'.repeat(39) + ' b');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
    expect(SLUG_RE.test(slug)).toBe(true);
  });
});

describe('slugProblem', () => {
  it('accepts what the database accepts', () => {
    expect(slugProblem('demo-xerox')).toBeNull();
    expect(slugProblem('abc')).toBeNull();
  });

  it('explains what the database would reject', () => {
    expect(slugProblem('ab')).toMatch(/at least 3/);
    expect(slugProblem('-abc')).toMatch(/lowercase/);
    expect(slugProblem('Abc')).toMatch(/lowercase/);
    expect(slugProblem('a'.repeat(41))).toMatch(/at most 40/);
  });
});

describe('nextSlug', () => {
  it('counts up', () => {
    expect(nextSlug('demo-xerox')).toBe('demo-xerox-2');
    expect(nextSlug('demo-xerox-2')).toBe('demo-xerox-3');
    expect(nextSlug('demo-xerox-9')).toBe('demo-xerox-10');
  });

  it('stays a valid link at the length limit', () => {
    const slug = nextSlug('a'.repeat(40));
    expect(slug).toHaveLength(40);
    expect(slugProblem(slug)).toBeNull();
  });
});

describe('rates', () => {
  it('reads prices like the desktop rate card', () => {
    expect(toPaise('2')).toBe(200);
    expect(toPaise(' 2.5 ')).toBe(250);
    expect(toPaise('')).toBeNull();
    expect(() => toPaise('abc')).toThrow(/not a price/);
    expect(() => toPaise('1001')).toThrow(/₹1,000/);
  });

  it('saves only the chosen papers, and both-sides prices only with duplex', () => {
    const draft = defaultDraft();
    const single = buildRateRows('shop', ['A4'], false, draft);
    expect(single.map((r) => `${r.color_mode}/${r.sides}=${r.price_paise}`)).toEqual(['bw/single=200', 'color/single=1000']);
    expect(buildRateRows('shop', ['A4', 'A3'], true, draft)).toHaveLength(8);
  });

  it('treats a blank price as not offered, but needs one price per paper', () => {
    const draft = { ...defaultDraft(), [keyOf('A4', 'color', 'single')]: '' };
    expect(buildRateRows('shop', ['A4'], false, draft)).toHaveLength(1);
    const none = { ...draft, [keyOf('A4', 'bw', 'single')]: '' };
    expect(() => buildRateRows('shop', ['A4'], false, none)).toThrow(/at least one price for A4/);
  });

  it('names the cell with a bad price', () => {
    const draft = { ...defaultDraft(), [keyOf('A3', 'bw', 'single')]: 'two' };
    expect(() => buildRateRows('shop', ['A3'], false, draft)).toThrow(/A3, B&W, one side/);
  });
});

describe('detectOs and safeNext', () => {
  it('detects desktop systems', () => {
    expect(detectOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(detectOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('mac');
    expect(detectOs('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('other');
  });

  it('only returns to paths on this site', () => {
    expect(safeNext('/dashboard')).toBe('/dashboard');
    expect(safeNext('https://evil.test')).toBe('/onboarding');
    expect(safeNext('//evil.test')).toBe('/onboarding');
    expect(safeNext('/\\evil.test')).toBe('/onboarding');
    expect(safeNext(null)).toBe('/onboarding');
  });
});
