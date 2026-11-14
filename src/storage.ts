import { type Circuit, parseCircuit } from './circuit';

const LIST_KEY = 'trackpaint.circuits';
const DRAFT_KEY = 'trackpaint.draft';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the app keeps working, it just can't persist.
  }
}

export function listSaved(): Circuit[] {
  const raw = read<unknown[]>(LIST_KEY, []);
  const out: Circuit[] = [];
  for (const item of raw) {
    try {
      out.push(parseCircuit(item));
    } catch {
      /* skip corrupt entries */
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveCircuit(c: Circuit) {
  const list = listSaved().filter((x) => x.id !== c.id);
  list.unshift({ ...c, updatedAt: new Date().toISOString() });
  write(LIST_KEY, list);
}

export function deleteCircuit(id: string) {
  write(
    LIST_KEY,
    listSaved().filter((x) => x.id !== id),
  );
}

export function loadDraft(): Circuit | null {
  const raw = read<unknown>(DRAFT_KEY, null);
  if (!raw) return null;
  try {
    return parseCircuit(raw);
  } catch {
    return null;
  }
}

export function saveDraft(c: Circuit) {
  write(DRAFT_KEY, c);
}

export function downloadJson(c: Circuit) {
  const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${slug(c.name) || 'circuito'}.trackpaint.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function readJsonFile(file: File): Promise<Circuit> {
  const text = await file.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es JSON válido.');
  }
  return parseCircuit(data);
}

function slug(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
