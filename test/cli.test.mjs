// pip.mjs plan and check on made-up media: tones for words, a test pattern for the product
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PIP = fileURLToPath(new URL('../skills/pip-promo/scripts/pip.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'pip-'));
mkdirSync(join(dir, 'assets'));
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);

// Lines said at these seconds; quiet room between
const lines = [[0.5, 2.0, 'Meet Pantry the shopping app'], [2.6, 5.4, 'Search any dish you like tonight'], [6.9, 9.8, 'Tap a recipe to see every amount'], [10.5, 12.0, 'Try it free today']];
const on = lines.map(([a, b]) => `between(t,${a},${b})`).join('+');
ff('-f', 'lavfi', '-i', 'color=c=0x445566:s=360x640:r=30:d=12.6', '-f', 'lavfi', '-i', `aevalsrc='0.3*sin(2*PI*220*t)*(${on})+0.003*(random(0)-0.5)':s=16000:d=12.6`, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(dir, 'assets', 'talk.mp4'));
ff('-f', 'lavfi', '-i', 'testsrc2=s=390x844:r=30:d=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'assets', 'app.mp4'));
const stamp = (t) => `00:00:${t.toFixed(3).padStart(6, '0')}`;
writeFileSync(join(dir, 'assets', 'talk.vtt'), `WEBVTT\n\n${lines.map(([a, b, text]) => {
  const ws = text.split(' '), d = (b - a) / ws.length;
  return `${stamp(a)} --> ${stamp(b)}\n${ws.map((x, i) => (i ? `<${stamp(a + i * d)}>` : '') + x).join(' ')}`;
}).join('\n\n')}\n`);
writeFileSync(join(dir, 'pip.json'), JSON.stringify({
  shape: '9:16',
  speaker: { src: 'assets/talk.mp4' },
  demos: [
    { id: 'search', say: 'search', src: 'assets/app.mp4', from: 0, focus: [{ t: 0, rect: [0, 0, 390, 300] }], label: 'Search any dish' },
    { id: 'recipe', say: 'recipe', src: 'assets/app.mp4', from: 4, focus: [{ t: 4, rect: [0, 500, 390, 300] }] },
  ],
  cta: { say: 'try it', label: 'Free today' },
}));

const run = (...a) => spawnSync('node', [PIP, ...a], { cwd: dir, encoding: 'utf8' });

test('plan writes the film, a page per demo, the call to action and the cover', () => {
  const r = run('plan');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /search: "search" said at/);
  assert.match(r.stdout, /window \S+ over [\d.]+% of its detail/, 'the plan reads the footage and says what the window covers');
  assert.match(r.stdout, /cut \d/, 'the long pause before "Tap" is cut');
  for (const f of ['film.html', 'pip/demo-1-search.html', 'pip/demo-2-recipe.html', 'pip/cta.html', 'pip/cover.html']) assert.ok(existsSync(join(dir, f)), f);
  const html = readFileSync(join(dir, 'film.html'), 'utf8');
  assert.match(html, /class="pip-full"/);
  assert.match(html, /class="pip-window"/);
  assert.match(html, /data-say="recipe"/);
  assert.doesNotMatch(readFileSync(join(dir, 'pip/demo-1-search.html'), 'utf8'), /any dish you like/);
});

test('check passes the planned film and fails one with the window moved over the demo', () => {
  let r = run('check');
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /over the shown part in 0 frames/);
  assert.match(r.stdout, /demo-1-search: window over [\d.]+% of its detail/);
  assert.match(r.stdout, /subtitles: [\d.]+:1 against their box or outline/);
  assert.match(r.stdout, /next: render with --subtitles, then run check --video/);
  const file = join(dir, 'film.html');
  const html = readFileSync(file, 'utf8');
  writeFileSync(file, html.replace(/(class="pip-window" style=")[^"]*"/g, '$1left: 40px; top: 160px; width: 600px; height: 800px"'));
  r = run('check');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /covers the shown part/);
  writeFileSync(file, html);
});

test('plan reports a phrase never said and leaves that demo out', () => {
  const cfg = JSON.parse(readFileSync(join(dir, 'pip.json'), 'utf8'));
  cfg.demos.push({ id: 'export', say: 'export', src: 'assets/app.mp4', from: 0 });
  writeFileSync(join(dir, 'pip2.json'), JSON.stringify(cfg));
  const r = run('plan', 'pip2.json', '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /demo export: never says "export"/);
});

test('a screenshot works as a demo shot', () => {
  ff('-f', 'lavfi', '-i', 'testsrc2=s=780x1688', '-frames:v', '1', join(dir, 'assets', 'shot.png'));
  const cfg = JSON.parse(readFileSync(join(dir, 'pip.json'), 'utf8'));
  cfg.demos[1] = { id: 'amount', say: 'recipe', src: 'assets/shot.png', focus: [0, 900, 780, 500] };
  writeFileSync(join(dir, 'pip.json'), JSON.stringify(cfg));
  let r = run('plan');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(readFileSync(join(dir, 'pip/demo-2-amount.html'), 'utf8'), /<img id="take" src="\.\.\/assets\/shot\.png"/);
  r = run('check');
  assert.equal(r.status, 0, r.stdout);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
