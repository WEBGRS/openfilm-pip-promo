#!/usr/bin/env node
// Builds the sample project in out/sample: a talking presenter (local voice + drawn face), a phone app take, a logo, a music bed.
//   node tools/make-sample.mjs [--out out/sample]
// Needs: openfilm-local-voice (LOCAL_VOICE_CLI or a sibling checkout), openfilm-web-demo (WEB_DEMO_CLI or sibling),
// ffmpeg, and openfilm (OPENFILM_CLI, else npx openfilm).
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(import.meta.dirname, '..');
const { values: o } = parseArgs({ options: { out: { type: 'string', default: join(ROOT, 'out', 'sample') } } });
const OUT = resolve(o.out);
const ASSETS = join(OUT, 'assets');
const sibling = (name, file) => resolve(ROOT, '..', name, file);
const VOICE = process.env.LOCAL_VOICE_CLI ?? sibling('openfilm-local-voice', 'local-voice.mjs');
const WEBDEMO = process.env.WEB_DEMO_CLI ?? sibling('openfilm-web-demo', 'skills/web-demo/scripts/record.mjs');
const openfilm = (args, cwd) => {
  const cli = process.env.OPENFILM_CLI;
  const r = cli ? spawnSync('node', [cli, ...args], { cwd, stdio: 'inherit' }) : spawnSync('npx', ['openfilm', ...args], { cwd, stdio: 'inherit', shell: true });
  if (r.status) throw new Error(`openfilm ${args[0]} failed`);
};
const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

// What the presenter says, and the silence after each line
const LINES = [
  ['Still writing your shopping list on paper? There\'s a faster way.', 0.5],
  ['Open Pantry and search any dish, like pasta.', 1.4],
  ['Um,', 0.45],
  ['tap a recipe, and you get every ingredient with the amounts.', 0.5],
  ['Then one tap on add to list, and it\'s all on your shopping list, sorted by aisle.', 1.2],
  ['Pantry is free. Tap the link and try it tonight.', 0.6],
];
const RATE = 24000;

const clock = (t) => { const [h, m, s] = t.split(':'); return +h * 3600 + +m * 60 + +s; };
const stamp = (t) => { const ms = Math.round(t * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = (ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`; };
const shift = (vtt, by) => vtt.replace(/^WEBVTT\s*/, '').replace(/(\d+:\d+:\d+\.\d+)/g, (x) => stamp(clock(x) + by)).trim();

function voice() {
  const dir = join(OUT, 'tts');
  mkdirSync(dir, { recursive: true });
  const pcm = [];
  const cues = [];
  let at = 0.4;
  pcm.push(Buffer.alloc(Math.round(at * RATE) * 2));
  LINES.forEach(([text, gap], i) => {
    const wav = join(dir, `${i}.wav`);
    if (!existsSync(wav)) execFileSync('node', [VOICE, 'say', text, wav, '--voice', 'af_sol'], { stdio: 'inherit' });
    const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
    cues.push(shift(readFileSync(wav.replace(/\.wav$/, '.vtt'), 'utf8'), at));
    pcm.push(raw, Buffer.alloc(Math.round(gap * RATE) * 2));
    at += raw.length / 2 / RATE + gap;
  });
  const body = Buffer.concat(pcm);
  // Quiet room noise so pauses are measured as in a real take
  for (let k = 0; k < body.length; k += 2) body.writeInt16LE(Math.max(-32768, Math.min(32767, body.readInt16LE(k) + Math.round((Math.sin(k * 12.9898) * 43758.5453 % 1) * 60))), k);
  writeFileSync(join(dir, 'voice.pcm'), body);
  ff('-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', join(dir, 'voice.pcm'), join(dir, 'voice.wav'));
  return { wav: join(dir, 'voice.wav'), vtt: `WEBVTT\n\n${cues.join('\n\n')}\n`, duration: at };
}

// Mouth opening per 1/30 s from the voice's level
function envelope(wav) {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', '24000', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const s = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  const env = [];
  for (let i = 0; i < s.length; i += 800) {
    let e = 0;
    for (let j = i; j < Math.min(i + 800, s.length); j++) e += s[j] * s[j];
    env.push(Math.sqrt(e / 800));
  }
  const peak = [...env].sort((a, b) => a - b)[Math.floor(env.length * 0.97)] || 1;
  return env.map((x) => Math.round(Math.min(1, Math.max(0, (x / peak - 0.04) * 1.1)) * 100) / 100);
}

function presenter({ wav, vtt, duration }) {
  const dir = join(OUT, 'presenter');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'assets'), { recursive: true });
  copyFileSync(join(ROOT, 'tools', 'sample', 'presenter.html'), join(dir, 'face.html'));
  writeFileSync(join(dir, 'env.json'), JSON.stringify(envelope(wav)));
  copyFileSync(wav, join(dir, 'assets', 'voice.wav'));
  const len = Math.round(duration * 1000) / 1000;
  writeFileSync(join(dir, 'film.html'), `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1080, height=1920">
</head>
<body>
<section>
  <iframe src="face.html#t=0,${len}"></iframe>
</section>
<section>
  <audio src="assets/voice.wav"></audio>
</section>
</body>
</html>
`);
  openfilm(['render', '--out', 'film.mp4'], dir);
  copyFileSync(join(dir, 'film.mp4'), join(ASSETS, 'talk.mp4'));
  writeFileSync(join(ASSETS, 'talk.vtt'), vtt);
}

function take() {
  if (existsSync(join(ASSETS, 'app.mp4'))) return;
  const url = pathToFileURL(join(ROOT, 'tools', 'sample', 'app', 'index.html')).href;
  execFileSync('node', [WEBDEMO, url, join(ASSETS, 'app.mp4'), '--steps', join(ROOT, 'tools', 'sample', 'steps.json'), '--size', '390x844'], { stdio: 'inherit' });
}

function extras() {
  writeFileSync(join(ASSETS, 'logo.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="140" viewBox="0 0 480 140">
<rect x="4" y="10" width="120" height="120" rx="32" fill="#2f7d4f"/><path d="M38 92 C38 58 60 40 90 40 C90 74 70 92 38 92 Z" fill="#f6f3ec"/>
<text x="148" y="96" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-weight="700" font-size="76" fill="#1f2a1f">Pantry</text></svg>
`);
  // A soft chord bed
  ff('-f', 'lavfi', '-i', "aevalsrc='0.05*(sin(2*PI*220*t)+sin(2*PI*277.2*t)+sin(2*PI*329.6*t))*(0.6+0.4*sin(2*PI*0.25*t))':s=44100:d=40", '-c:a', 'libmp3lame', '-q:a', '5', join(ASSETS, 'bed.mp3'));
}

mkdirSync(ASSETS, { recursive: true });
take();
presenter(voice());
extras();
console.log(`${OUT}: assets/talk.mp4 + talk.vtt, assets/app.mp4 + app.record.json, assets/logo.svg, assets/bed.mp3`);
