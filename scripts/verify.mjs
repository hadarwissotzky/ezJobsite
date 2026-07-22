#!/usr/bin/env node
/**
 * ONE COMMAND THAT SAYS WHETHER THIS REPO IS OK.  `npm run verify`
 *
 * WHY THIS EXISTS: the checks were real but scattered -- two directories, four
 * invocations, different argument conventions, and two of them silently pass when
 * you call them wrong. Both of those bit me in one session:
 *
 *   check-i18n-coverage.mjs with no argument CRASHES with an ERR_INVALID_ARG_TYPE
 *   stack, which reads like a broken checker rather than a missed argument.
 *
 *   A hand-rolled HTML syntax check "passed" against ZERO characters because its
 *   regex missed a `type="module"` attribute. A green tick on an empty string is
 *   worse than no check, because it is believed.
 *
 * So every check here declares what a PASS must look like, and a check that
 * inspected nothing is reported as INCONCLUSIVE, never as a pass.
 *
 * Exit code is 0 only if every check passes. Anything else is non-zero, so this is
 * usable as a gate.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = join(ROOT, 'apps/mobile');

const results = [];
function record(name, status, detail) {
  results.push({ name, status, detail });
  const tick = status === 'pass' ? '✓' : status === 'inconclusive' ? '?' : '✗';
  console.log(`  ${tick} ${name.padEnd(26)} ${detail}`);
}

/** Run a command; return {ok, out}. Never throws. */
function run(cmd, args, cwd) {
  try {
    const out = execFileSync(cmd, args, {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000,
    });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` || String(e.message) };
  }
}

console.log('\nverifying…\n');

// ── 1. TypeScript ─────────────────────────────────────────────────────────────
{
  const r = run('npx', ['tsc', '--noEmit'], MOBILE);
  const errs = (r.out.match(/error TS/g) ?? []).length;
  record('typecheck', r.ok && errs === 0 ? 'pass' : 'fail',
    r.ok && errs === 0 ? 'no type errors' : `${errs || '?'} error(s)\n${r.out.slice(0, 800)}`);
}

// ── 2. Unit tests ─────────────────────────────────────────────────────────────
{
  // `node --test src/` treats `src` as a single test FILE and fails with
  // MODULE_NOT_FOUND -- it does not walk the directory. Caught by this script on its
  // first run, which is the argument for the script. Delegate to the npm script so
  // there is one definition of "the tests" instead of two that can drift.
  const r = run('npm', ['test', '--silent'], MOBILE);
  const pass = Number(r.out.match(/^# pass (\d+)/m)?.[1] ?? r.out.match(/ℹ pass (\d+)/)?.[1] ?? 0);
  const fail = Number(r.out.match(/^# fail (\d+)/m)?.[1] ?? r.out.match(/ℹ fail (\d+)/)?.[1] ?? 0);
  // A suite that ran zero tests is NOT a pass. That is the empty-string trap.
  if (pass === 0 && fail === 0) record('unit tests', 'inconclusive', 'ran 0 tests — nothing was checked');
  else record('unit tests', fail === 0 ? 'pass' : 'fail', `${pass} passed, ${fail} failed`);
}

// ── 3. One object, one file ───────────────────────────────────────────────────
{
  const r = run('node', [join(ROOT, 'scripts/check-sql-duplicates.mjs'), join(MOBILE, 'sql')], ROOT);
  const m = r.out.match(/(\d+) files, (\d+) objects, (\d+) owned by more than one file/);
  if (!m) record('sql single-ownership', 'inconclusive', 'checker produced no summary line');
  else if (Number(m[2]) === 0) record('sql single-ownership', 'inconclusive', 'parsed 0 objects — checker saw nothing');
  else record('sql single-ownership', Number(m[3]) === 0 ? 'pass' : 'fail',
    `${m[2]} objects, ${m[3]} multi-owned`);
}

// ── 4. Both languages, every key ──────────────────────────────────────────────
{
  const i18n = join(MOBILE, 'src/i18n.ts');
  const r = run('node', [join(ROOT, 'scripts/check-i18n-coverage.mjs'), i18n], ROOT);
  const m = r.out.match(/EN keys: (\d+)\s+ES keys: (\d+)/);
  const missing = /missing from Spanish: NONE/.test(r.out);
  if (!m) record('i18n parity', 'inconclusive', 'checker produced no key counts (bad argument?)');
  else if (Number(m[1]) === 0) record('i18n parity', 'inconclusive', 'parsed 0 keys — checker saw nothing');
  else record('i18n parity', m[1] === m[2] && missing ? 'pass' : 'fail',
    `EN ${m[1]} / ES ${m[2]}${missing ? '' : ', keys missing from Spanish'}`);
}

// ── 4b. Every key the code ASKS FOR actually exists ───────────────────────────
// PARITY IS NOT COVERAGE, and conflating them cost real money here. check 4 compares
// EN against ES and passed at 315/315 while 116 keys referenced by newly written
// screens did not exist in either language. t() returns the key when it misses
// (i18n.ts: `if (s === undefined) return k`), so the failure is silent and the
// contractor reads "ewa.capReadback" off the screen instead of a sentence.
{
  const i18nSrc = readFileSync(join(MOBILE, 'src/i18n.ts'), 'utf8');
  const files = run('sh', ['-c',
    `find "${join(MOBILE, 'src')}" "${MOBILE}/App.tsx" -name '*.ts' -o -name '*.tsx' -o -name 'App.tsx' 2>/dev/null`],
    ROOT).out.split('\n').map((s) => s.trim())
    .filter((f) => f && !f.endsWith('.test.ts') && !f.endsWith('/i18n.ts'));

  const referenced = new Set();
  for (const f of files) {
    let t; try { t = readFileSync(f, 'utf8'); } catch { continue; }
    // t('a.b') / T('a.b') / { k: 'a.b' } — the three call shapes used in this repo.
    for (const m of t.matchAll(/\b[tT]\(\s*['"]([a-z0-9]+\.[A-Za-z0-9_.]+)['"]/g)) referenced.add(m[1]);
    for (const m of t.matchAll(/\bk:\s*['"]([a-z0-9]+\.[A-Za-z0-9_.]+)['"]/g)) referenced.add(m[1]);
  }
  const missing = [...referenced].filter((k) => !i18nSrc.includes(`'${k}'`)).sort();
  if (referenced.size === 0) {
    record('i18n coverage', 'inconclusive', 'found 0 key references — the scan is wrong');
  } else {
    record('i18n coverage', missing.length === 0 ? 'pass' : 'fail',
      missing.length === 0
        ? `${referenced.size} keys referenced, all defined`
        : `${missing.length} of ${referenced.size} referenced keys are UNDEFINED — ` +
          `t() will render the key itself. e.g. ${missing.slice(0, 4).join(', ')}`);
  }
}

// ── 4c. Is every module actually reachable from the app? ──────────────────────
// THE CHECK THAT WOULD HAVE CAUGHT THE BIG ONE. A 23-agent run added 61 files with
// 209 passing tests, and App.tsx imported NONE of them. Everything was green on code
// no user could reach. The same thing had already happened to R5c on a smaller scale:
// three commits, sixteen tests, two migrations, zero callers.
//
// Tests prove a module does what it says. Only reachability proves anyone can get to
// it. "A module with no caller is NOT BUILT" is the rule this repo settled on; this
// makes the rule executable instead of remembered.
//
// It walks real import edges from App.tsx, transitively — not a grep for the name,
// which would count a mention in a comment as wiring.
{
  const walk = (entry) => {
    const seen = new Set(); const stack = [entry];
    const resolve = (from, rel) => {
      const base = join(dirname(from), rel);
      for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
        if (existsSync(base + ext) && !base.endsWith('/')) {
          try { if (readFileSync(base + ext)) return base + ext; } catch { /* dir */ }
        }
      }
      return null;
    };
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      let t; try { t = readFileSync(f, 'utf8'); } catch { continue; }
      for (const m of t.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const r = resolve(f, m[1]);
        if (r && !seen.has(r)) stack.push(r);
      }
    }
    return seen;
  };
  const reachable = walk(join(MOBILE, 'App.tsx'));
  const all = run('sh', ['-c',
    `find "${join(MOBILE, 'src')}" -name '*.ts' -o -name '*.tsx'`], ROOT).out
    .split('\n').map((s) => s.trim())
    .filter((f) => f && !f.endsWith('.test.ts') && !f.endsWith('/i18n.ts'));
  const orphans = all.filter((f) => !reachable.has(f))
    .map((f) => f.replace(join(MOBILE, 'src') + '/', '')).sort();

  if (all.length === 0) record('module reachability', 'inconclusive', 'found 0 modules — the scan is wrong');
  else record('module reachability', orphans.length === 0 ? 'pass' : 'fail',
    orphans.length === 0
      ? `all ${all.length} modules reachable from App.tsx`
      : `${orphans.length} of ${all.length} unreachable from App.tsx (written, not wired): ` +
        orphans.slice(0, 6).join(', ') + (orphans.length > 6 ? ` … +${orphans.length - 6}` : ''));
}

// ── 5. Client vs server schema ────────────────────────────────────────────────
{
  const r = run('node', [join(ROOT, 'scripts/check-schema-agreement.mjs')], ROOT);
  const m = r.out.match(/(\d+) fatal, (\d+) warnings/);
  if (!m) record('schema agreement', 'inconclusive', 'checker produced no summary line');
  else record('schema agreement', Number(m[1]) === 0 ? 'pass' : 'fail',
    `${m[1]} fatal, ${m[2]} warnings`);
}

// ── 6. The approval page's JavaScript actually parses ─────────────────────────
// Hand-rolled last time and it "passed" on an empty match. Here the extraction is
// asserted before the parse: no script content found is INCONCLUSIVE, not a pass.
{
  const page = join(ROOT, 'apps/web/confirm.html');
  if (!existsSync(page)) record('approval page parses', 'fail', 'confirm.html not found');
  else {
    const html = readFileSync(page, 'utf8');
    const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
      .map((m) => m[1]).filter((s) => s.trim().length > 0);
    const chars = blocks.reduce((n, b) => n + b.length, 0);
    if (chars < 500) {
      record('approval page parses', 'inconclusive',
        `only ${chars} chars of script found — extraction is wrong, nothing was checked`);
    } else {
      let bad = null;
      for (const [i, js] of blocks.entries()) {
        // Strip ES module imports; new Function() is script context, not module.
        const stripped = js.replace(/^\s*import\s[^;]*;?\s*$/gm, '');
        try { new Function(stripped); } catch (e) { bad = `block ${i}: ${e.message}`; break; }
      }
      record('approval page parses', bad ? 'fail' : 'pass', bad ?? `${chars} chars, clean`);
    }
  }
}

// ── 7. Migrations are numbered and unique ─────────────────────────────────────
{
  const dir = join(MOBILE, 'sql');
  const files = run('ls', [dir], ROOT).out.split('\n').filter((f) => f.endsWith('.sql'));
  const nums = files.map((f) => f.slice(0, 3));
  const dupes = nums.filter((n, i) => nums.indexOf(n) !== i);
  const unnumbered = files.filter((f) => !/^\d{3}_/.test(f));
  if (!files.length) record('migration numbering', 'inconclusive', 'no .sql files found');
  else record('migration numbering', dupes.length === 0 && unnumbered.length === 0 ? 'pass' : 'fail',
    dupes.length ? `duplicate prefixes: ${[...new Set(dupes)].join(', ')}`
      : unnumbered.length ? `unnumbered: ${unnumbered.join(', ')}`
      : `${files.length} files, all uniquely numbered`);
}

// ── 8. Migration ORDER is checked by scripts/check-migration-order.sh, not here ──
// I wrote a static version of that check twice and deleted both. Matching bare
// column names claimed 020 depended on 100 because both say `created_at`.
// Table-qualifying it still flagged 080 -> 100 on `project.lat`, in migrations that
// are applied and demonstrably working. A check that cries wolf gets muted, and then
// it is not there for the real one.
//
// The order bug is real -- 305 died on `column prior.superseded_by does not exist`
// because 307 creates it, taking every later migration down with it -- but it is
// only visible by APPLYING them in sequence. That needs database credentials, so it
// cannot live in this offline script. It lives in check-migration-order.sh and is a
// deliberate, separate step before any migration run.

// ── verdict ───────────────────────────────────────────────────────────────────
const failed = results.filter((r) => r.status === 'fail');
const unknown = results.filter((r) => r.status === 'inconclusive');
console.log('');
if (failed.length) {
  console.log(`FAIL — ${failed.length} check(s) failed: ${failed.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
if (unknown.length) {
  // Deliberately non-zero. A check that inspected nothing is not evidence of health,
  // and treating it as one is how a green tick starts meaning nothing.
  console.log(`INCONCLUSIVE — ${unknown.length} check(s) verified nothing: ${unknown.map((r) => r.name).join(', ')}`);
  process.exit(2);
}
console.log(`PASS — ${results.length} checks, all green.`);
