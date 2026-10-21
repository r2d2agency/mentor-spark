import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';

/**
 * A entidade usa decorators do TypeORM, que dependem de `emitDecoratorMetadata`
 * — o esbuild do vitest não emite os metadados, então o TypeORM não adivinha
 * o tipo da coluna e explode na importação. Aqui só interessa a lógica de
 * disco/token do service, então o módulo da entidade é substituído por um dublô.
 */
vi.mock('../../entities/sales-page.entity', () => ({
  SalesPage: class {},
  SalesPageProductType: {},
  SalesPagePaymentMode: {},
}));

import { SitesService } from './sites.service';

/**
 * Testes de segurança do SitesService: resolução de asset (path traversal),
 * emissão/validação do token de preview e busca de página.
 *
 * O repositório é um dublô — aqui só interessa a lógica de disco/token,
 * não o TypeORM.
 */
describe('SitesService', () => {
  let root: string;
  let service: SitesService;

  const fakeRepo: any = {
    findOne: vi.fn(async () => null),
    update: vi.fn(async () => ({ affected: 1 })),
  };

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-sites-'));
    // O service usa process.cwd()/sites — apontamos o cwd para o temp.
    process.chdir(root);
    service = new SitesService(fakeRepo);
  });

  afterAll(() => {
    process.chdir(path.dirname(root));
    fs.rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    fakeRepo.findOne.mockReset();
    const dir = path.join(root, 'sites', 'page-1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(dir, 'obrigado.html'), '<html></html>');
    // Arquivo FORA do site — deve ser inalcançável.
    fs.writeFileSync(path.join(root, 'secret.txt'), 'nao deve ser servido');
  });

  describe('resolveAsset', () => {
    it('resolve um arquivo dentro do site', () => {
      const { file } = service.resolveAsset('page-1', 'index.html');
      expect(file.endsWith(path.join('page-1', 'index.html'))).toBe(true);
    });

    it('rejeita travessia com ..', () => {
      expect(() => service.resolveAsset('page-1', '../secret.txt')).toThrow(NotFoundException);
      expect(() => service.resolveAsset('page-1', '..\secret.txt')).toThrow(NotFoundException);
      expect(() => service.resolveAsset('page-1', 'a/../../secret.txt')).toThrow(NotFoundException);
    });

    it('rejeita path absoluto', () => {
      expect(() => service.resolveAsset('page-1', '/etc/passwd')).toThrow(NotFoundException);
      expect(() => service.resolveAsset('page-1', path.join(root, 'secret.txt'))).toThrow(NotFoundException);
    });

    it('rejeita caminho vazio, diretório e arquivo inexistente', () => {
      expect(() => service.resolveAsset('page-1', '')).toThrow(NotFoundException);
      expect(() => service.resolveAsset('page-1', 'nao-existe.png')).toThrow(NotFoundException);
      expect(() => service.resolveAsset('page-1', '.')).toThrow(NotFoundException);
    });
  });

  describe('preview token', () => {
    it('aceita o token emitido para a mesma página', () => {
      const token = service.issuePreviewToken('page-1');
      expect(service.verifyPreviewToken('page-1', token)).toBe(true);
    });

    it('rejeita token emitido para outra página', () => {
      const token = service.issuePreviewToken('page-1');
      expect(service.verifyPreviewToken('page-2', token)).toBe(false);
    });

    it('rejeita token adulterado, vazio ou malformado', () => {
      const token = service.issuePreviewToken('page-1');
      const [payload, sig] = token.split('.');
      expect(service.verifyPreviewToken('page-1', payload + '.' + '0'.repeat(sig.length))).toBe(false);
      expect(service.verifyPreviewToken('page-1', payload)).toBe(false);
      expect(service.verifyPreviewToken('page-1', 'abc.def.ghi')).toBe(false);
      expect(service.verifyPreviewToken('page-1', undefined)).toBe(false);
      expect(service.verifyPreviewToken('page-1', '')).toBe(false);
    });

    it('rejeita token expirado (assinatura correta, prazo vencido)', async () => {
      const { createHmac } = await import('crypto');
      const payload = `page-1.${Date.now() - 1000}`;
      const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
      const sig = createHmac('sha256', secret).update(payload).digest('hex');
      const token = `${Buffer.from(payload).toString('base64url')}.${sig}`;
      expect(service.verifyPreviewToken('page-1', token)).toBe(false);
    });
  });

  describe('injectBase', () => {
    it('coloca o <base> antes de qualquer link do head', () => {
      const html = '<html><head><link rel="stylesheet" href="css/a.css"></head><body></body></html>';
      const out = service.injectBase(html, 'https://ex.com/base/');
      expect(out.indexOf('<base')).toBeLessThan(out.indexOf('<link'));
    });

    it('não duplica um <base> que o mentor já definiu', () => {
      const html = '<html><head><base href="/x/"></head><body></body></html>';
      const out = service.injectBase(html, 'https://ex.com/base/');
      expect(out.match(/<base/gi)).toHaveLength(1);
    });

    it('funciona em HTML sem <head>', () => {
      const out = service.injectBase('<body><p>oi</p></body>', 'https://ex.com/base/');
      expect(out).toContain('<base href="https://ex.com/base/">');
    });
  });

  describe('pageById', () => {    it('busca a página sem checar dono', async () => {
      fakeRepo.findOne.mockResolvedValueOnce({ id: 'page-1', mentorId: 'm1' });
      const page = await service.pageById('page-1');
      expect(page?.id).toBe('page-1');
      expect(fakeRepo.findOne).toHaveBeenCalledWith({ where: { id: 'page-1' } });
    });

    it('retorna null para id vazio sem consultar o banco', async () => {
      expect(await service.pageById('')).toBeNull();
      expect(fakeRepo.findOne).not.toHaveBeenCalled();
    });
  });
});
