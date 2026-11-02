// A shop's link: <customer app>/s/<slug>. Same rule as the shops.slug check in the database.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const SLUG_MAX = 40;

/** "Sharma Xerox & Print" → "sharma-xerox-print" */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
}

/** What's wrong with a link the owner typed, or null if it's fine. */
export function slugProblem(slug: string): string | null {
  if (slug.length < 3) return 'Use at least 3 letters or numbers.';
  if (slug.length > SLUG_MAX) return `Use at most ${SLUG_MAX} characters.`;
  if (!SLUG_RE.test(slug)) return 'Use lowercase letters, numbers and dashes, starting and ending with a letter or number.';
  return null;
}

/** The next link to suggest when one is taken: shop → shop-2 → shop-3. */
export function nextSlug(slug: string): string {
  const match = /^(.*)-(\d+)$/.exec(slug);
  const base = match ? match[1] : slug;
  const suffix = `-${match ? Number(match[2]) + 1 : 2}`;
  return base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '') + suffix;
}
