/** STT / accent token fixes applied before product search and fuzzy ranking. */
export const SEARCH_TOKEN_ALIASES = {
  simant: 'cement',
  cament: 'cement',
  semment: 'cement',
  siment: 'cement',
  cimint: 'cement',
  stil: 'steel',
  still: 'steel',
  steal: 'steel',
  steele: 'steel',
  rodd: 'rod',
  rode: 'rod',
  pype: 'pipe',
  piip: 'pipe',
  pant: 'paint',
  paynt: 'paint',
  tyle: 'tile',
  briks: 'brick',
  brix: 'brick',
  gravell: 'gravel',
  concreat: 'concrete',
  morter: 'mortar',
  mack: 'mac',
  mak: 'mac',
  mackbook: 'macbook',
  makbook: 'macbook',
  macbok: 'macbook',
  macbuk: 'macbook',
  laptap: 'laptop',
  lapto: 'laptop',
  labtop: 'laptop',
  iphon: 'iphone',
  ifone: 'iphone',
  samsang: 'samsung',
  samung: 'samsung'
};

export function normalizeSearchQueryAliases(raw) {
  let q = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!q) return '';

  q = q.replace(/\bmak\s+air\b/g, 'mac air');
  q = q.replace(/\bmak\s+book\b/g, 'macbook');
  q = q.replace(/\btmt\s+bars?\b/g, 'steel rod');

  const words = q.split(/\s+/).map((w) => SEARCH_TOKEN_ALIASES[w] || w);
  return words.join(' ').trim();
}
