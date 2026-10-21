import * as fs from 'fs';
import * as path from 'path';
import { inflateRawSync } from 'zlib';

/**
 * Leitor/extraidor de ZIP em JavaScript puro (sem dependência externa).
 *
 * O ZIP do mentor é conteúdo **não confiável**: pode tentar escapar do diretório
 * de destino (zip-slip), esgotar o disco (zip bomb), conter symlink ou executar
 * arquivos. Todas as checagens abaixo são obrigatórias — não remover.
 */

/** Extensões que são efetivamente extraídas para o disco. */
const ALLOWED_EXT = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'json', 'map', 'svg',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp4', 'webm', 'ogv', 'pdf', 'txt', 'xml', 'csv',
  'mp3', 'ogg', 'wav', 'm4a',
]);

/** Pastas/arquivos de sistema operacional ignorados. */
const IGNORED_SEGMENTS = new Set(['__macosx', '.git', 'node_modules']);
const IGNORED_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

export const MAX_ENTRIES = 2000;
export const MAX_TOTAL_UNCOMPRESSED = 100 * 1024 * 1024; // 100 MB
export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB por arquivo
export const MAX_ENTRY_PATH = 255;

export interface ExtractedFile {
  /** Caminho relativo à raiz extraída, sempre com `/`. */
  path: string;
  size: number;
}

export interface ExtractResult {
  files: ExtractedFile[];
  /** Arquivo de entrada detectado (relativo à raiz extraída). */
  entry: string | null;
  /** Nomes das entradas ignoradas (para feedback no editor). */
  skipped: string[];
}

export class ZipError extends Error {}

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  externalAttrs: number;
  isDir: boolean;
}

// ---------- leitura do diretório central ----------

function findEocd(buf: Buffer): number {
  // O EOCD tem no mínimo 22 bytes e pode ter um comentário até 65535 bytes.
  const max = Math.min(buf.length, 22 + 0xffff);
  for (let i = buf.length - 22; i >= buf.length - max; i--) {
    if (i < 0) break;
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new ZipError('Arquivo não parece ser um ZIP válido (EOCD não encontrado).');
}

function readCentralDirectory(buf: Buffer): CentralEntry[] {
  const eocd = findEocd(buf);
  const total = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const entries: CentralEntry[] = [];
  let p = cdOffset;

  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length) throw new ZipError('ZIP truncado (diretório central incompleto).');
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('ZIP corrompido (assinatura inválida).');

    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const externalAttrs = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
      externalAttrs,
      isDir: name.endsWith('/') || (externalAttrs & 0x10) !== 0,
    });

    p += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/** Extrai os bytes do conteúdo de uma entrada a partir do local header. */
function readEntryData(buf: Buffer, entry: CentralEntry): Buffer {
  const p = entry.localOffset;
  if (p + 30 > buf.length) throw new ZipError('ZIP truncado (header local inválido).');
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new ZipError('ZIP corrompido (header local inválido).');

  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const dataStart = p + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buf.length) throw new ZipError('ZIP truncado (dados incompletos).');

  const raw = buf.subarray(dataStart, dataEnd);
  if (entry.method === 0) return Buffer.from(raw); // stored
  if (entry.method === 8) return inflateRawSync(raw); // deflate
  throw new ZipError(`Método de compressão não suportado: ${entry.method}.`);
}

// ---------- normalização de caminhos ----------

/** Converte para um caminho relativo seguro, ou `null` se for perigoso. */
export function normalizeEntryPath(name: string): string | null {
  if (!name) return null;
  // Separa em segmentos, ignorando separadores do Windows.
  const raw = name.replace(/\\/g, '/');
  if (raw.startsWith('/')) return null; // path absoluto
  if (/^[a-zA-Z]:/.test(raw)) return null; // path absoluto Windows

  const parts: string[] = [];
  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') return null; // zip-slip
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(seg)) return null;
    if (parts.length >= 32) return null; // profundidade
    parts.push(seg);
  }
  if (!parts.length) return null;

  const joined = parts.join('/');
  if (joined.length > MAX_ENTRY_PATH) return null;
  return joined;
}

/** Remove o diretório-raiz comum (exports de Elementor/WordPress vêm com uma pasta). */
function stripCommonRoot(paths: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (!paths.length) return map;

  const firsts = new Set(paths.map((p) => p.split('/')[0]));
  // Só remove se TODOS os caminhos compartilham a mesma primeira pasta
  // e existe pelo menos um arquivo dentro dela.
  let common: string | null = null;
  if (firsts.size === 1) {
    const only = [...firsts][0];
    const hasFileInside = paths.some((p) => p.split('/').length > 1);
    if (hasFileInside) common = only;
  }

  for (const p of paths) {
    let out = p;
    if (common) {
      const rest = p.slice(common.length + 1);
      if (!rest) continue; // a própria pasta-raiz — ignorada
      out = rest;
    }
    map.set(p, out);
  }
  return map;
}

function pickEntry(files: ExtractedFile[]): string | null {
  const htmls = files.filter((f) => /\.html?$/i.test(f.path));
  if (!htmls.length) return null;
  if (htmls.some((f) => f.path.toLowerCase() === 'index.html')) return 'index.html';
  // o .html mais raso
  const sorted = [...htmls].sort(
    (a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path),
  );
  return sorted[0].path;
}

// ---------- extração ----------

/**
 * Extrai um ZIP em `destDir`.
 *
 * A extração é atômica por chamador: extraia num diretório temporário e renomeie
 * depois. Aqui apenas garantimos a segurança de cada caminho escrito.
 */
export function extractZip(buf: Buffer, destDir: string): ExtractResult {
  const entries = readCentralDirectory(buf);
  if (!entries.length) throw new ZipError('O ZIP está vazio.');

  const skipped: string[] = [];
  const safe: CentralEntry[] = [];
  let totalUncompressed = 0;

  for (const e of entries) {
    if (e.isDir) continue;

    const rel = normalizeEntryPath(e.name);
    if (!rel) {
      skipped.push(e.name);
      continue;
    }

    const segments = rel.split('/');
    if (segments.some((s) => IGNORED_SEGMENTS.has(s.toLowerCase()))) {
      skipped.push(e.name);
      continue;
    }
    const base = segments[segments.length - 1].toLowerCase();
    if (IGNORED_FILES.has(base)) {
      skipped.push(e.name);
      continue;
    }

    const ext = base.includes('.') ? base.split('.').pop()! : '';
    if (!ALLOWED_EXT.has(ext)) {
      skipped.push(e.name);
      continue;
    }

    if (e.uncompressedSize > MAX_FILE_SIZE) {
      throw new ZipError(`Arquivo "${rel}" excede o limite de ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.`);
    }
    totalUncompressed += e.uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
      throw new ZipError('O conteúdo descomprimido do ZIP excede o limite de 100 MB.');
    }

    safe.push(e);
  }

  if (!safe.length) throw new ZipError('Nenhum arquivo utilizável encontrado no ZIP.');
  if (safe.length > MAX_ENTRIES) {
    throw new ZipError(`O ZIP tem mais de ${MAX_ENTRIES} arquivos.`);
  }

  // Remove o diretório-raiz comum antes de escrever.
  const remap = stripCommonRoot(safe.map((e) => normalizeEntryPath(e.name)!));
  const root = path.resolve(destDir);

  const written: ExtractedFile[] = [];
  for (const e of safe) {
    const original = normalizeEntryPath(e.name)!;
    const rel = remap.get(original);
    if (!rel) continue;

    // Symlink (unix mode S_IFLNK) — nunca extrair.
    const unixMode = (e.externalAttrs >>> 16) & 0xf000;
    if (unixMode === 0xa000) {
      skipped.push(e.name);
      continue;
    }

    // Confirma que o caminho final está dentro do destino (proteção final).
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new ZipError(`Caminho inválido no ZIP: "${e.name}".`);
    }

    const data = readEntryData(buf, e);
    if (data.length > MAX_FILE_SIZE) {
      throw new ZipError(`Arquivo "${rel}" excede o limite de tamanho.`);
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data, { mode: 0o644 });
    written.push({ path: rel, size: data.length });
  }

  if (!written.length) throw new ZipError('Nenhum arquivo utilizável encontrado no ZIP.');

  return { files: written, entry: pickEntry(written), skipped };
}
