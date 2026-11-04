const exactKey = label => label?.normalize('NFKC').trim().replace(/\s+/g, '_');
const compactKey = label => exactKey(label)?.replaceAll('_', '');

// Prefer the standard filename; tolerate omitted spaces only when unambiguous.
export function createCardImageLookup(modules) {
  const exact = new Map(), compact = new Map();
  for (const [path, url] of Object.entries(modules)) {
    const label = path.split('/').at(-1).replace(/\.png$/i, '');
    exact.set(exactKey(label), url);
    const key = compactKey(label);
    compact.set(key, [...(compact.get(key) || []), url]);
  }
  return label => {
    if (!label) return undefined;
    const direct = exact.get(exactKey(label));
    if (direct) return direct;
    const matches = compact.get(compactKey(label)) || [];
    return matches.length === 1 ? matches[0] : undefined;
  };
}
