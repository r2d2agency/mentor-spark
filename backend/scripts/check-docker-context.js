#!/usr/bin/env node
/**
 * Guard de contexto Docker.
 *
 * O `.dockerignore` da raiz do repo exclui `sites/` e `uploads/` (dados de
 * runtime) do contexto da imagem. O problema: os mesmos nomes existem como
 * PASTAS DE CODIGO dentro do backend (`backend/src/modules/sites/`,
 * `backend/src/modules/uploads/`). Quando uma regra sem ancora casa nesses
 * niveis, os modulos saem do contexto, o `nest build` dentro da imagem quebra
 * com MODULE_NOT_FOUND, a imagem nunca e produzida e o EasyPanel responde 502
 * em todas as rotas da API — inclusive o login.
 *
 * Este script simula as regras do .dockerignore e falha se algum arquivo de
 * codigo do backend for excluido. Roda antes do build da imagem (ver o stage
 * `builder` do backend/Dockerfile) e localmente antes de comitar.
 *
 * Uso:
 *   node backend/scripts/check-docker-context.js [contexto]
 *
 * `contexto` e a raiz do build context (a pasta copiada para a imagem).
 * Sem argumento, ela e deduzida da localizacao do proprio script.
 *
 * Semantica implementada (fonte: moby/moby `builder/dockerignore` +
 * `moby/patternmatcher`):
 *
 * - O leitor aplica `filepath.Clean` no padrao e REMOVE a barra inicial, ou
 *   seja `/sites` e `sites` sao a MESMA regra. A barra inicial nao ancora.
 * - Sem `**`, o padrao e um `exactMatch`: casa apenas com o caminho INTEIRO
 *   relativo a raiz do contexto (`sites` -> `<ctx>/sites`).
 * - Com `**`, o padrao vira regexp/suffixMatch e casa em qualquer nivel
 *   (ex.: `**` + `/sites` casa com `<ctx>/backend/src/modules/sites`).
 *   E o padrao perigoso.
 * - `*` e `?` nao atravessam `/`: `*.tsbuildinfo` casa so na raiz do contexto.
 * - A ultima regra que casa vence; `!` nega.
 * - Um diretorio excluido exclui tudo abaixo dele (o walker do Docker nao
 *   desce nele).
 */
const fs = require('fs');
const path = require('path');

/**
 * Raiz do build context (a pasta copiada para a imagem).
 * - .../backend/scripts/check-docker-context.js -> .../   (raiz do repo)
 * - .../scripts/check-docker-context.js            -> .../backend
 */
function detectContextRoot(explicit) {
  if (explicit) return path.resolve(explicit);
  const twoUp = path.resolve(__dirname, '..', '..');
  if (fs.existsSync(path.join(twoUp, 'backend', 'package.json'))) return twoUp;
  return path.resolve(__dirname, '..');
}

/**
 * Descobre onde esta o codigo do backend dentro do contexto.
 * - contexto = raiz do repo   -> codigo em <ctx>/backend
 * - contexto = pasta backend  -> codigo em <ctx>
 */
function detectLayout(ctx) {
  if (fs.existsSync(path.join(ctx, 'backend', 'package.json'))) {
    return { codeRoot: path.join(ctx, 'backend'), prefix: 'backend/' };
  }
  if (fs.existsSync(path.join(ctx, 'package.json'))) {
    return { codeRoot: ctx, prefix: '' };
  }
  return null;
}

/** Escapa um caractere para uso em regexp. */
function escapeRe(ch) {
  return ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/**
 * Converte um padrao com wildcards na mesma regexp que o patternmatcher do
 * moby monta:
 * - `**` seguido de barra -> zero ou mais diretorios
 * - `**`   -> `.*`
 * - `*`    -> `[^/]*`
 * - `?`    -> `[^/]`
 */
function buildRegex(pattern) {
  let out = '^';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        while (pattern[i] === '*') i++;
        if (pattern[i] === '/') {
          i++; // consome a barra: `**/` casa zero ou mais diretorios
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
        continue;
      }
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += escapeRe(ch);
    }
    i++;
  }
  return new RegExp(out + '$');
}

/** Le as regras do .dockerignore no formato do Docker (moby/patternmatcher). */
function parseRules(raw) {
  const rules = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    let negated = false;
    let pattern = trimmed;
    if (pattern.startsWith('!')) {
      negated = true;
      pattern = pattern.slice(1).trim();
    }
    if (!pattern) continue;

    // `filepath.Clean` + remocao da barra inicial, como o leitor do moby.
    pattern = pattern.replace(/\\/g, '/').replace(/\/+/g, '/');
    pattern = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!pattern) continue;

    const hasWildcard = /[*?]/.test(pattern);
    rules.push({
      negated,
      pattern,
      segs: pattern.split('/'),
      rx: hasWildcard ? buildRegex(pattern) : null,
    });
  }
  return rules;
}

/** A regra casa com o caminho (segmentos) informado? */
function ruleMatches(rule, segs) {
  if (rule.rx) return rule.rx.test(segs.join('/'));
  if (segs.length !== rule.segs.length) return false;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] !== rule.segs[i]) return false;
  }
  return true;
}

/**
 * Decide se um path relativo ao CONTEXTO e excluido.
 *
 * Para cada regra verificamos o path e seus diretorios ancestrais (o walker
 * do Docker nao desce em diretorio excluido, entao excluir o diretorio
 * exclui tudo abaixo). A ultima regra que casa vence (como o Docker faz).
 */
function evaluate(rules, relPath) {
  const segs = relPath.split('/');
  let excluded = false;
  let culprit = null;

  for (const rule of rules) {
    let matched = false;
    for (let i = 1; i <= segs.length && !matched; i++) {
      if (ruleMatches(rule, segs.slice(0, i))) matched = true;
    }
    if (!matched) continue;
    excluded = !rule.negated;
    culprit = rule.negated ? null : rule;
  }

  return { excluded, culprit };
}

function isExcluded(rules, relPath) {
  return evaluate(rules, relPath).excluded;
}

const ctx = detectContextRoot(process.argv[2]);
const layout = detectLayout(ctx);

if (!layout) {
  console.error(
    '[ctx] FALHA: contexto Docker invalido em ' + ctx +
      ' (esperado backend/package.json ou package.json na raiz).'
  );
  process.exit(1);
}

const dockerignorePath = path.join(ctx, '.dockerignore');
let rules = [];

if (fs.existsSync(dockerignorePath)) {
  rules = parseRules(fs.readFileSync(dockerignorePath, 'utf8'));
} else {
  console.log('[ctx] aviso: nenhum .dockerignore no contexto — nada e excluido.');
}

/** Arquivos de codigo do backend que NUNCA podem sair do contexto. */
const CRITICAL = [
  'src/app.module.ts',
  'src/main.ts',
  'src/db.config.ts',
  'src/data-source.ts',
  'src/seeds/bootstrap.ts',
  'src/entities/sales-page.entity.ts',
  'src/modules/auth/auth.module.ts',
  'src/modules/billing/billing.module.ts',
  'src/modules/events/events.module.ts',
  'src/modules/sales-pages/sales-pages.module.ts',
  'src/modules/sales-pages/sales-pages.service.ts',
  'src/modules/sales-pages/sales-pages.controller.ts',
  'src/modules/sites/sites.module.ts',
  'src/modules/sites/sites.service.ts',
  'src/modules/sites/sites.controller.ts',
  'src/modules/sites/bridge.ts',
  'src/modules/sites/zip-extract.ts',
  'src/modules/uploads/uploads.module.ts',
  'src/modules/uploads/uploads.controller.ts',
  'docker-entrypoint.sh',
  'package.json',
  'package-lock.json',
  'nest-cli.json',
  'tsconfig.json',
  'tsconfig.build.json',
];

const failures = [];

for (const rel of CRITICAL) {
  const abs = path.join(layout.codeRoot, rel);
  const ctxPath = layout.prefix + rel;
  const { excluded, culprit } = evaluate(rules, ctxPath);
  if (!fs.existsSync(abs)) {
    failures.push(
      '   arquivo inexistente no contexto: ' + ctxPath +
        (culprit ? '  (excluido pela regra "' + culprit.pattern + '")' : '')
    );
    continue;
  }
  if (excluded) {
    failures.push(
      '   EXCLUIDO do contexto Docker: ' + ctxPath +
        (culprit ? '  (casa com o padrao "' + culprit.pattern + '")' : '')
    );
  }
}

// Varredura ampla: nenhum arquivo .ts/.js/.json/.sh do codigo do backend
// pode ser excluido.
let scanned = 0;
function walk(dir, rel) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const r = rel ? rel + '/' + entry.name : entry.name;
    const ctxPath = layout.prefix + r;
    if (entry.isDirectory()) {
      // Se o diretorio inteiro esta excluido, tudo abaixo dele tambem.
      const { excluded, culprit } = evaluate(rules, ctxPath);
      if (excluded) {
        failures.push(
          '   EXCLUIDO do contexto Docker: ' + ctxPath + '/ (e todo o conteudo)' +
            (culprit ? '  (casa com o padrao "' + culprit.pattern + '")' : '')
        );
        continue;
      }
      walk(path.join(dir, entry.name), r);
    } else if (/\.(ts|js|json|sh)$/.test(entry.name)) {
      scanned++;
      if (isExcluded(rules, ctxPath)) {
        failures.push('   EXCLUIDO do contexto Docker: ' + ctxPath);
      }
    }
  }
}
walk(path.join(layout.codeRoot, 'src'), 'src');

const unique = [...new Set(failures)];

if (unique.length) {
  console.error('[ctx] FALHA: o .dockerignore exclui codigo do backend do contexto da imagem.');
  console.error('[ctx] A imagem nao sera construida e a API respondera 502 em todas as rotas.');
  unique.forEach((f) => console.error(f));
  process.exit(1);
}

console.log(
  '[ctx] OK: nenhum codigo do backend e excluido do contexto Docker (' +
    scanned +
    ' arquivos verificados em ' +
    layout.codeRoot +
    ').'
);
