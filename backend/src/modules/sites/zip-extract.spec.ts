import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deflateRawSync } from 'zlib';
import { extractZip, normalizeEntryPath, ZipError } from './zip-extract';

/**
 * Testes do extrator de ZIP.
 *
 * Os ZIPs são montados à mão (método "stored" e "deflate"), para não depender
 * de ferramenta externa no CI.
 */

interface ZipInput {
  name: string;
  content: string | Buffer;
  /** Quando true, a entrada é marcada como symlink. */
  symlink?: boolean;
  /** Quando true, o nome é usado literally (permite `..` e path absoluto). */
  raw?: boolean;
}

function crc32(buf: Buffer): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(inputs: ZipInput[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const input of inputs) {
    const data = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content, 'utf8');
    const nameBuf = Buffer.from(input.name, 'utf8');
    const compressed = deflateRawSync(data);
    const method = 8;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, compressed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    // external attrs: unix mode no high word. Symlink = S_IFLNK (0xA000).
    cd.writeUInt32LE(input.symlink ? 0xa1ff0000 : 0x81a40000, 38);
    cd.writeUInt32LE(offset, 42);

    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(inputs.length, 8);
  eocd.writeUInt16LE(inputs.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mfextract-'));
}

describe('normalizeEntryPath', () => {
  it('rejeita path traversal', () => {
    expect(normalizeEntryPath('../../etc/passwd')).toBeNull();
    expect(normalizeEntryPath('a/../../b.html')).toBeNull();
  });

  it('rejeita path absoluto', () => {
    expect(normalizeEntryPath('/etc/passwd')).toBeNull();
    expect(normalizeEntryPath('C:\\Windows\\x.html')).toBeNull();
  });

  it('normaliza separadores e pontos', () => {
    expect(normalizeEntryPath('a\\b\\c.html')).toBe('a/b/c.html');
    expect(normalizeEntryPath('./a//b.html')).toBe('a/b.html');
  });
});

describe('extractZip', () => {
  it('extrai um ZIP válido e detecta o entry', () => {
    const buf = makeZip([
      { name: 'index.html', content: '<html><body>oi</body></html>' },
      { name: 'css/style.css', content: 'body{color:red}' },
      { name: 'img/logo.png', content: 'fake' },
    ]);
    const dest = tmpDir();
    const res = extractZip(buf, dest);

    expect(res.entry).toBe('index.html');
    expect(res.files.map((f) => f.path).sort()).toEqual(['css/style.css', 'img/logo.png', 'index.html']);
    expect(fs.existsSync(path.join(dest, 'index.html'))).toBe(true);
    expect(fs.readFileSync(path.join(dest, 'css/style.css'), 'utf8')).toBe('body{color:red}');
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it('remove o diretório-raiz comum', () => {
    const buf = makeZip([
      { name: 'meu-site/index.html', content: '<html></html>' },
      { name: 'meu-site/css/a.css', content: 'a{}' },
    ]);
    const dest = tmpDir();
    const res = extractZip(buf, dest);

    expect(res.entry).toBe('index.html');
    expect(res.files.map((f) => f.path)).toContain('css/a.css');
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it('ignora extensões não permitidas', () => {
    const buf = makeZip([
      { name: 'index.html', content: '<html></html>' },
      { name: 'evil.php', content: '<?php echo 1; ?>' },
      { name: 'shell.sh', content: 'rm -rf /' },
    ]);
    const dest = tmpDir();
    const res = extractZip(buf, dest);

    expect(res.files.map((f) => f.path)).toEqual(['index.html']);
    expect(fs.existsSync(path.join(dest, 'evil.php'))).toBe(false);
    expect(res.skipped).toContain('evil.php');
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it('ignora entrada com path traversal (não escreve fora do destino)', () => {
    const buf = makeZip([
      { name: 'index.html', content: '<html></html>' },
      { name: '../../etc/passwd', content: 'root:x:0:0' },
    ]);
    const dest = tmpDir();
    const res = extractZip(buf, dest);

    expect(res.files.map((f) => f.path)).toEqual(['index.html']);
    expect(fs.existsSync(path.resolve(dest, '..', '..', 'etc', 'passwd'))).toBe(false);
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it('ignora entrada com path absoluto', () => {
    const buf = makeZip([
      { name: 'index.html', content: '<html></html>' },
      { name: '/tmp/abs.html', content: 'abs' },
    ]);
    const dest = tmpDir();
    const res = extractZip(buf, dest);

    expect(res.files.map((f) => f.path)).toEqual(['index.html']);
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it('ignora symlink', () => {
    const buf = makeZip([
      { name: 'index.html', content: '<html></html>' },
      { name: 'link.html', content: '/etc/passwd', symlink: true },
    ]);
    const dest = tmpDir();
    const res = extractZip(buf, dest);

    expect(res.files.map((f) => f.path)).toEqual(['index.html']);
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it('rejeita arquivo acima do limite de 20 MB', () => {
    const big = Buffer.alloc(21 * 1024 * 1024, 0x61);
    const buf = makeZip([{ name: 'index.html', content: '<html></html>' }, { name: 'big.mp4', content: big }]);
    const dest = tmpDir();
    expect(() => extractZip(buf, dest)).toThrow(ZipError);
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it('rejeita ZIP com mais de 2000 arquivos', () => {
    const inputs: ZipInput[] = [];
    for (let i = 0; i < 2001; i++) inputs.push({ name: `f${i}.html`, content: 'x' });
    const dest = tmpDir();
    expect(() => extractZip(makeZip(inputs), dest)).toThrow(ZipError);
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it('lança erro para buffer que não é ZIP', () => {
    const dest = tmpDir();
    expect(() => extractZip(Buffer.from('isto nao e um zip'), dest)).toThrow(ZipError);
    fs.rmSync(dest, { recursive: true, force: true });
  });
});
