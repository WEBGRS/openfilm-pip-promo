// Prepare one arm for measuring, in <run>/_m: delivered.mp4, c.mp4 (film as made, with subtitles), b.mp4 (same, talk hidden)
//   node prepare.mjs <run-dir> [delivered.mp4] [--c-is-delivered]
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const run = args[0], given = args[1];
const cIsDelivered = process.argv.includes('--c-is-delivered');
const work = join(run, 'work'), m = join(run, '_m');
mkdirSync(m, { recursive: true });

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  if (['node_modules', '.claude', '_m'].includes(e.name)) return [];
  const p = join(d, e.name);
  return e.isDirectory() ? walk(p) : [p];
});
const all = walk(work);
const mp4s = all.filter((f) => /\.mp4$/i.test(f) && !/[\\/]assets[\\/]/.test(f) && !/[\\/]\.film[\\/]/.test(f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
const delivered = given ?? mp4s[0];
console.log('finals:', mp4s.map((f) => relative(work, f)).join(', ') || 'none');
if (delivered) copyFileSync(delivered, join(m, 'delivered.mp4'));

const openfilm = (cwd, a) => {
  const r = spawnSync('npx', ['openfilm', ...a], { cwd, shell: true, encoding: 'utf8', env: { ...process.env, OPENFILM_NO_BROWSER: '1', OPENFILM_RUN: 'npx openfilm', OPENFILM_HOME: join(run, 'home'), OPENFILM_LIBRARY: join(run, 'library') } });
  console.log(`openfilm ${a.join(' ')}: ${r.status}\n${(r.stdout + r.stderr).split('\n').slice(-5).join('\n')}`);
  return r.status;
};
// The project: the work folder or a folder the agent opened inside it
const films = all.filter((f) => /[\\/]film\.html$/.test(f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
if (!films.length) { console.log('no film.html: only delivered.mp4 is measured'); process.exit(0); }
const proj = films[0].replace(/[\\/]film\.html$/, '');
console.log('project:', relative(work, proj) || '.');

if (cIsDelivered) copyFileSync(join(m, 'delivered.mp4'), join(m, 'c.mp4'));
else if (!existsSync(join(m, 'c.mp4'))) openfilm(proj, ['render', '--subtitles', '--out', join(m, 'c.mp4')]);

// A copy of the project with the talk hidden in film.html and every page
const hide = join(m, 'hide');
if (!existsSync(join(m, 'b.mp4'))) {
  rmSync(hide, { recursive: true, force: true });
  cpSync(proj, hide, { recursive: true, filter: (s) => !/[\\/](node_modules|\.claude|_m)$/.test(s) && !(/\.mp4$/i.test(s) && !/[\\/]assets[\\/]/.test(s)) && !/[\\/]\.film[\\/]history/.test(s) });
  symlinkSync(join(work, 'node_modules'), join(hide, 'node_modules'), 'junction');
  const rule = '<style data-measure>video[src*="talk"],img[src*="talk"]{opacity:0 !important}</style>';
  let n = 0;
  for (const f of walk(hide).filter((x) => /\.html$/i.test(x))) {
    const t = readFileSync(f, 'utf8');
    if (/talk/.test(t)) { writeFileSync(f, t.includes('</head>') ? t.replace('</head>', `${rule}\n</head>`) : rule + t); n++; }
  }
  console.log(`talk hidden in ${n} html files`);
  openfilm(hide, ['render', '--subtitles', '--out', join(m, 'b.mp4')]);
}
