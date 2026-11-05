#!/usr/bin/env node
// From talking-head (github.com/WEBGRS/openfilm-talking-head, MIT), copied here with its functions exported.
// Pauses in a recording, measured in its sound, and the cuts of a film checked against them. Needs ffmpeg on the PATH.
//   node cuts.mjs pauses <recording> [--vtt <file>]   every pause of 0.12 s or more, the words around it, and where the
//                    [--json]                         transcript has a gap the sound does not (an um it left out may be there)
//   node cuts.mjs check [film.html]                   every in and out point of every recording clip falls in a pause
//   node cuts.mjs joined [film.html] --out <file.wav> one recording's clips back to back, to transcribe again
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const STEP = 0.01; // s per level frame
export const MIN_PAUSE = 0.12; // s
const QUIET = 0.3; // a frame is quiet below this share of the way from the room's floor to its speech
const LOUD = 0.6; // and is sound above this share
export const MARGIN = 0.02; // s of pause kept on each side of a cut point

function run(args, { binary = false } = {}) {
  return new Promise((ok, fail) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args], { windowsHide: true });
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => fail(new Error(e.code === 'ENOENT' ? 'ffmpeg is not on the PATH' : e.message)));
    p.on('close', (code) => (code ? fail(new Error(`ffmpeg: ${err.trim() || `exit ${code}`}`)) : ok(binary ? Buffer.concat(out) : '')));
  });
}

// Level per 10 ms frame in dB, and the room's floor
export async function levels(file) {
  const raw = await run(['-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { binary: true });
  const s = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
  const n = Math.floor(s.length / 160);
  const e = new Float64Array(n), db = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = i * 160; j < (i + 1) * 160; j++) e[i] += s[j] * s[j];
    e[i] /= 160;
  }
  // Level over 30 ms, so a room's flicker does not split a pause
  for (let i = 0; i < n; i++) db[i] = 10 * Math.log10((e[Math.max(i - 1, 0)] + e[i] + e[Math.min(i + 1, n - 1)]) / 3 + 1e-12);
  const sorted = [...db].sort((a, b) => a - b);
  const floor = sorted[Math.floor(n * 0.05)] ?? -90, speech = sorted[Math.floor(n * 0.9)] ?? floor;
  const span = Math.max(speech - floor, 6);
  return { db, floor, speech, quiet: floor + QUIET * span, loud: floor + LOUD * span, duration: n * STEP };
}

// Runs of quiet frames lasting MIN_PAUSE or more
export function pausesOf({ db, quiet: q }) {
  const quiet = (i) => db[i] <= q;
  const out = [];
  for (let i = 0; i < db.length; ) {
    if (!quiet(i)) { i++; continue; }
    let j = i;
    while (j < db.length && quiet(j)) j++;
    if ((j - i) * STEP >= MIN_PAUSE - 1e-9) out.push([i * STEP, j * STEP]);
    i = j;
  }
  return out;
}

const clock = (t) => { const [h, m, s] = t.split(':').length === 3 ? t.split(':') : ['0', ...t.split(':')]; return +h * 3600 + +m * 60 + +s; };

// Words with their start times from an OpenFilm VTT (a cue per line, a timestamp tag before each later word)
export function wordsOf(vtt) {
  const words = [];
  for (const block of readFileSync(vtt, 'utf8').split(/\r?\n\r?\n/)) {
    const m = block.match(/([\d:.]+)\s*-->\s*([\d:.]+)[^\n]*\n([\s\S]*)/);
    if (!m) continue;
    let t = clock(m[1]);
    const end = clock(m[2]);
    const parts = m[3].replace(/\r?\n/g, ' ').split(/<([\d:.]+)>/);
    const cue = [];
    for (let k = 0; k < parts.length; k += 2) {
      if (k) t = clock(parts[k - 1]);
      for (const w of parts[k].trim().split(/\s+/).filter(Boolean)) cue.push({ w, s: t });
    }
    cue.forEach((x, k) => (x.e = k + 1 < cue.length ? cue[k + 1].s : end));
    words.push(...cue);
  }
  return words;
}

const fmt = (t) => t.toFixed(2);
export const around = (words, t, n = 4) => {
  const k = words.findIndex((x) => x.s >= t);
  const before = (k < 0 ? words : words.slice(0, k)).slice(-n).map((x) => x.w).join(' ');
  const after = (k < 0 ? [] : words.slice(k, k + n)).map((x) => x.w).join(' ');
  return `${before} | ${after}`;
};

// Recording clips of a film: <video>/<audio> with their file, in and out points, and place
export function clipsOf(film) {
  const html = readFileSync(film, 'utf8');
  const out = [];
  for (const m of html.matchAll(/<(video|audio)\b([^>]*)>/g)) {
    const attr = (name) => m[2].match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
    const src = attr('src');
    if (!src) continue;
    const [file, frag] = src.split('#');
    const t = frag?.match(/^t=([\d.]*)(?:,([\d.]*))?$/);
    out.push({ id: attr('id') ?? file, file: decodeURI(file), in: t?.[1] ? +t[1] : 0, out: t?.[2] ? +t[2] : null, at: +(attr('at') ?? 0), speed: +(attr('speed') ?? 1) });
  }
  return out;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function pauses(file) {
  const lv = await levels(file);
  const ps = pausesOf(lv);
  const vtt = arg('--vtt') ?? file.replace(/\.[^.\\/]+$/, '.vtt');
  const words = existsSync(vtt) ? wordsOf(vtt) : null;
  const hidden = words ? hiddenOf(lv, words) : [];
  if (process.argv.includes('--json')) {
    const unheard = hidden.map(([a, b, k]) => ({ start: a, end: b, after: words[k - 1].w, before: words[k].w }));
    console.log(JSON.stringify({ duration: lv.duration, room: lv.floor, speech: lv.speech, pauses: ps, unheard }));
    return;
  }
  console.log(`${file}: ${fmt(lv.duration)} s, room ${lv.floor.toFixed(1)} dB, speech ${lv.speech.toFixed(1)} dB, ${ps.length} pauses of ${MIN_PAUSE} s or more`);
  for (const [a, b] of ps) console.log(`  ${fmt(a)}-${fmt(b)}  (${fmt(b - a)} s)${words ? `  ${around(words, (a + b) / 2)}` : ''}`);
  if (hidden.length) {
    console.log(`\nsound where the transcript has no word (an um or a stumble it left out may be there):`);
    for (const [a, b, k] of hidden) console.log(`  ${fmt(a)}-${fmt(b)}  ${words[k - 1].w} [?] ${words[k].w}`);
  }
}

// Transcript gaps holding sound: a word it left out may be there
export function hiddenOf(lv, words) {
  const hidden = [];
  for (let k = 1; k < words.length; k++) {
    const a = words[k - 1].e, b = words[k].s;
    if (b - a < 0.3) continue;
    const loud = [];
    for (let i = Math.ceil(a / STEP) + 5; i < Math.floor(b / STEP) - 5; i++) if (lv.db[i] > lv.loud) loud.push(i);
    if (loud.length * STEP >= 0.15) hidden.push([loud[0] * STEP, (loud.at(-1) + 1) * STEP, k]);
  }
  return hidden;
}

export function inPause(ps, t) {
  return ps.some(([a, b]) => t >= a + MARGIN - 1e-9 && t <= b - MARGIN + 1e-9);
}

async function check(film) {
  const dir = dirname(film);
  const byFile = Map.groupBy(clipsOf(film), (c) => c.file);
  let bad = 0, points = 0;
  for (const [file, clips] of byFile) {
    const path = resolve(dir, file);
    if (!existsSync(path)) continue;
    const lv = await levels(path);
    const ps = pausesOf(lv);
    const vtt = path.replace(/\.[^.\\/]+$/, '.vtt');
    const words = existsSync(vtt) ? wordsOf(vtt) : null;
    for (const c of clips) {
      for (const [side, t] of [['in', c.in], ['out', c.out ?? lv.duration]]) {
        if (t <= 0.05 || t >= lv.duration - 0.05) continue; // the recording's own start and end
        points++;
        if (inPause(ps, t)) continue;
        bad++;
        const near = ps.reduce((best, p) => (Math.abs((p[0] + p[1]) / 2 - t) < Math.abs((best[0] + best[1]) / 2 - t) ? p : best), [Infinity, Infinity]);
        console.log(`✗ ${c.id} ${side} ${fmt(t)} in ${file} is not in a pause${words ? ` (${around(words, t)})` : ''}; nearest pause ${fmt(near[0])}-${fmt(near[1])}`);
      }
    }
  }
  console.log(bad ? `${bad} of ${points} cut points are not in a pause` : `✓ all ${points} cut points fall in a pause of ${MIN_PAUSE} s or more`);
  process.exitCode = bad ? 1 : 0;
}

async function joined(film) {
  const out = arg('--out');
  if (!out) throw new Error('joined needs --out <file.wav>');
  const clips = clipsOf(film).sort((a, b) => a.at - b.at);
  const file = arg('--src') ?? Map.groupBy(clips, (c) => c.file).entries().reduce((best, e) => (e[1].length > best[1].length ? e : best))[0];
  const own = clips.filter((c) => c.file === file);
  const path = resolve(dirname(film), file);
  const graph = own.map((c, k) => `[0:a]atrim=${c.in}${c.out != null ? `:${c.out}` : ''},asetpts=PTS-STARTPTS${c.speed !== 1 ? `,atempo=${c.speed}` : ''}[a${k}];`).join('')
    + own.map((_, k) => `[a${k}]`).join('') + `concat=n=${own.length}:v=0:a=1[o]`;
  await run(['-y', '-i', path, '-filter_complex', graph, '-map', '[o]', '-ac', '1', '-ar', '16000', out]);
  console.log(`${out}: ${own.length} clips of ${file}, back to back`);
}

const main = process.argv[1] && import.meta.filename === resolve(process.argv[1]);
if (main) {
  const [cmd, target] = process.argv.slice(2);
  const films = (t) => (t && !t.startsWith('--') ? t : 'film.html');
  try {
    if (cmd === 'pauses' && target) await pauses(target);
    else if (cmd === 'check') await check(films(target));
    else if (cmd === 'joined') await joined(films(target));
    else { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(2, 7).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exitCode = cmd ? 2 : 0; }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
