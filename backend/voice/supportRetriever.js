import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, 'rag', 'documents');

let cachedDocs = null;

function loadDocs() {
  if (cachedDocs) return cachedDocs;
  cachedDocs = [];
  try {
    for (const name of readdirSync(DOCS_DIR)) {
      if (!name.endsWith('.md')) continue;
      const text = readFileSync(join(DOCS_DIR, name), 'utf8');
      cachedDocs.push({ name, text });
    }
  } catch {
    cachedDocs = [];
  }
  return cachedDocs;
}

export function retrieveSupportContext(query, k = 4) {
  const q = String(query || '').toLowerCase();
  const words = q.split(/\s+/).filter((w) => w.length > 3);
  const docs = loadDocs();
  const scored = docs
    .map(({ name, text }) => {
      const lower = text.toLowerCase();
      const score = words.reduce((s, w) => s + (lower.includes(w) ? 1 : 0), 0);
      return { score, name, snippet: text.slice(0, 800) };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((r) => `[${r.name}] ${r.snippet}`);
}
