// Local replica of the token-radar-01 gate's seven checks, run against an
// output directory. Usage: node validate.mjs [out-dir] [snapshot.json]
// Exits 0 when all seven pass, 1 otherwise. Not part of the submission's
// program: it only reads what main.ts wrote.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';

const out = process.argv[2] ?? 'out';
const snapshotPath = process.argv[3] ?? '../kit-v32/token-radar-01-kit/input/snapshot.json';
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const slugs = new Set(snapshot.protocols.map((p) => p.slug));
const watchlist = snapshot.watchlist;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

// 1. dashboard_files
{
  const dir = join(out, 'dashboard');
  let ok = true, detail = '';
  if (!existsSync(join(dir, 'index.html'))) { ok = false; detail = 'no index.html'; }
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile()) : [];
  const hasCss = files.some((f) => f.endsWith('.css'));
  const hasJs = files.some((f) => f.endsWith('.js'));
  if (!hasCss || !hasJs) { ok = false; detail = 'missing css or js'; }
  let bytes = 0;
  for (const f of files) {
    bytes += statSync(join(dir, f)).size;
    const text = readFileSync(join(dir, f), 'utf8');
    if (f.endsWith('.html') || f.endsWith('.css') || f.endsWith('.js')) {
      if (/https?:\/\//.test(text)) { ok = false; detail = `network ref in ${f}`; break; }
    }
    if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(f)) { ok = false; detail = `bad name ${f}`; break; }
  }
  if (files.length > 400 || bytes > 4_194_304) { ok = false; detail = 'dashboard over caps'; }
  check('dashboard_files', ok, detail || `${files.length} files, ${bytes} bytes`);
}

// 2-5. board checks
let board = null;
{
  const raw = readFileSync(join(out, 'board.json'), 'utf8');
  const parsed = JSON.parse(raw);
  board = Array.isArray(parsed) ? parsed : parsed.rows;
  let ok = true, detail = '';
  if (!Array.isArray(board) || board.length < 100 || board.length > 4000) { ok = false; detail = `row count ${board?.length}`; }
  if (Buffer.byteLength(raw) > 8 * 1024 * 1024) { ok = false; detail = 'board over 8 MiB'; }
  if (ok) {
    for (const r of board) {
      if (!slugs.has(r.slug)) { ok = false; detail = `unknown slug ${r.slug}`; break; }
      if (typeof r.name !== 'string' || !r.name) { ok = false; detail = `bad name ${r.slug}`; break; }
      if (!Number.isInteger(r.rank) || r.rank < 1) { ok = false; detail = `bad rank ${r.slug}`; break; }
      if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) { ok = false; detail = `bad implied ${r.slug}`; break; }
      if (!Array.isArray(r.farm_steps)) { ok = false; detail = `no farm_steps ${r.slug}`; break; }
    }
  }
  check('board_file', ok, detail || `${board.length} rows`);
}
{
  const ranks = [...board.map((r) => r.rank)].sort((a, b) => a - b);
  let ok = ranks.every((v, i) => v === i + 1);
  let detail = '';
  if (ok) {
    const byRank = [...board].sort((a, b) => a.rank - b.rank);
    for (let i = 1; i < byRank.length; i++) {
      if (byRank[i].implied_value_usd > byRank[i - 1].implied_value_usd) { ok = false; detail = 'implied rises with rank'; break; }
    }
    if (ok && board.every((r) => r.implied_value_usd === board[0].implied_value_usd)) { ok = false; detail = 'all implied equal'; }
  } else detail = 'ranks are not 1..N';
  check('sorted_by_value', ok, detail || `${board.length} rows, rank 1 = $${board.find((r) => r.rank === 1).implied_value_usd}`);
}
{
  const seen = new Set(board.map((r) => r.slug));
  const missing = watchlist.filter((w) => !seen.has(w));
  const outside = board.filter((r) => !watchlist.includes(r.slug)).length;
  check('coverage', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `40/40 watchlist, ${outside} outside`);
}
{
  let ok = true, detail = '';
  for (const r of board) {
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) { ok = false; detail = `step count ${r.slug}`; break; }
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) { ok = false; detail = `step length ${t.length} in ${r.slug}`; break; }
    }
    if (!ok) break;
  }
  check('farm_steps', ok, detail || `${board.length} rows x ${board[0].farm_steps.length} steps`);
}

// 6. screenshots
{
  const dir = join(out, 'screenshots');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.') && statSync(join(dir, f)).isFile()) : [];
  let ok = files.length >= 3 && files.length <= 4;
  let detail = '';
  if (!ok) detail = `${files.length} images`;
  for (const f of files) {
    const buf = readFileSync(join(dir, f));
    if (buf.length > 524_288) { ok = false; detail = `${f} over 512 KiB`; break; }
    const size = pngSize(buf) ?? jpegSize(buf);
    if (!size) { ok = false; detail = `${f} is not a whole PNG/JPEG`; break; }
    const longSide = Math.max(size.w, size.h), shortSide = Math.min(size.w, size.h);
    if (longSide > 1440 || shortSide < 800) { ok = false; detail = `${f} is ${size.w}x${size.h}`; break; }
    detail = `${files.length} images, e.g. ${f} ${size.w}x${size.h} ${Math.round(buf.length / 1024)} KiB`;
  }
  check('screenshots', ok, detail);
}

// 7. dossier_matches
{
  let ok = false, detail = '';
  try {
    const rebuilt = buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } });
    const stored = readFileSync(join(out, 'dossier.json'));
    ok = Buffer.compare(Buffer.from(rebuilt), stored) === 0;
    detail = ok ? `${stored.length} bytes, byte-identical` : 'dossier differs from rebuild';
  } catch (e) {
    detail = String(e);
  }
  check('dossier_matches', ok, detail);
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/7 checks passed`);
process.exit(passed === 7 ? 0 : 1);
