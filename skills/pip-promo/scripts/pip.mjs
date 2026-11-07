#!/usr/bin/env node
// pip-promo: a product promo with the speaker in a small window over the product footage, planned from the speaker's words.
//   node pip.mjs plan [pip.json] [--keep-all] [--dry-run]   cuts, demo shots on the words that name them, the window
//                                                          placed clear of what each shot shows; writes film.html's
//                                                          pip tracks, a page per demo shot, cta.html and cover.html
//   node pip.mjs check [film.html] [--video <film.mp4>]    measures the film as it is now: window over the shown part,
//                                                          window off the frame or over subtitles, demo shots against
//                                                          their words, cuts in pauses, subtitles from the .vtt
// Needs Node 22 or later and ffmpeg/ffprobe on the PATH.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { levels, pausesOf, wordsOf, MARGIN } from './cuts.mjs';

export { MARGIN };

export const FPS = 30;
export const STILL = /\.(png|jpe?g|webp|gif|avif)$/i;
export const SHAPES = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] };
/** Demo shot starts this long before the word that names it */
export const LEAD = 0.1;
/** Shorter demo shots are reported */
export const MIN_SHOT = 2;
/** Gap kept between the window and what a shot shows, px */
export const GAP = 32;
export const FILLERS = new Set(['um', 'uh', 'er', 'erm', 'ah', 'hmm', 'mm', 'uhm', '嗯', '呃', '额', '唔', '啊']);

const round3 = (x) => Math.round(x * 1000) / 1000;
const r1 = (x) => Math.round(x * 10) / 10;
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

// ------------------------------------------------------------------ geometry

export const rect = (x, y, w, h) => ({ x, y, w, h });
export const area = (r) => Math.max(0, r.w) * Math.max(0, r.h);
export function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
export const grow = (r, d) => rect(r.x - d, r.y - d, r.w + 2 * d, r.h + 2 * d);
export const inside = (r, s, eps = 0.5) => r.x >= s.x - eps && r.y >= s.y - eps && r.x + r.w <= s.x + s.w + eps && r.y + r.h <= s.y + s.h + eps;

/** Where OpenFilm's subtitles sit by default (Studio's film-subtitle.mjs), two lines, as a band across the frame. */
export function subtitleBand([W, H], style = {}) {
  const vertical = H > W;
  const y = style.pos?.y ?? (vertical ? 0.72 : 0.94);
  const size = ((style.font?.sizePct ?? 4) / 100) * Math.min(W, H);
  const line = size * (style.font?.lineHeight ?? 1.45);
  const bottom = y * H + line / 2;
  return rect(0, Math.round(bottom - 2 * line - 12), W, Math.round(2 * line + 24));
}

/** Where the window may sit: left or right, at the top or just above the subtitles. */
export function windowSlots([W, H], band, o = {}) {
  const vertical = H > W;
  const ww = Math.round(W * (o.width ?? (vertical ? 0.34 : 0.2)));
  const [aw, ah] = String(o.aspect ?? '3:4').split(':').map(Number);
  const wh = Math.round((ww * ah) / aw);
  const m = Math.round(W * (vertical ? 0.037 : 0.025));
  const top = Math.round(vertical ? H * 0.078 : m);
  const low = band.y - Math.round(m * 0.8) - wh;
  const rows = [['top', top]];
  if (low > top + wh + m) rows.push([vertical ? 'mid' : 'low', low]);
  const slots = [];
  for (const [rn, y] of rows) for (const [cn, x] of [['right', W - m - ww], ['left', m]]) slots.push({ name: `${rn}-${cn}`, rect: rect(x, y, ww, wh) });
  return slots;
}

/** Parts of the frame a demo's shown part may use: none of it under the window, the subtitles, or a feed's top bar and buttons. */
export function obstacles([W, H], band, win) {
  const out = [rect(0, band.y - 8, W, band.h + 16)];
  if (H > W) out.push(rect(0, band.y, W, H - band.y), rect(0, 0, W, Math.round(H * 0.06)));
  if (win) out.push(grow(win, GAP));
  return out;
}

/** The largest empty rectangles of the frame between the obstacles. */
export function freeRects([W, H], obs) {
  const xs = [...new Set([0, W, ...obs.flatMap((o) => [o.x, o.x + o.w])].map((x) => clamp(x, 0, W)))].sort((a, b) => a - b);
  const ys = [...new Set([0, H, ...obs.flatMap((o) => [o.y, o.y + o.h])].map((y) => clamp(y, 0, H)))].sort((a, b) => a - b);
  const found = [];
  for (let a = 0; a < xs.length; a++) for (let b = a + 1; b < xs.length; b++) for (let c = 0; c < ys.length; c++) for (let d = c + 1; d < ys.length; d++) {
    const r = rect(xs[a], ys[c], xs[b] - xs[a], ys[d] - ys[c]);
    if (r.w < W * 0.3 || r.h < H * 0.15) continue;
    if (obs.some((o) => overlap(o, r) > 0)) continue;
    found.push(r);
  }
  return found.filter((r) => !found.some((q) => q !== r && inside(r, q, 0) && area(q) > area(r)));
}

/**
 * The camera that shows a focus (source px) inside a free rect of the frame: scale k and offset, so a source point p
 * lands at p * k + o. The footage is a card over the page's background: it may leave the frame by up to 45% of it.
 */
export function solveCamera(src, focus, free, [W, H], o = {}) {
  const kContain = Math.min(W / src.w, H / src.h), kCover = Math.max(W / src.w, H / src.h);
  const kmin = o.fit === 'cover' ? kCover : kContain * 0.85;
  const kmax = Math.max(kContain * (o.zoom ?? 2.2), kmin);
  const kFit = (o.fill ?? 0.82) * Math.min(free.w / focus.w, free.h / focus.h);
  const k = clamp(kFit, kmin, kmax);
  const axis = (c, f, size, S) => {
    const span = size * k, slack = o.fit === 'cover' ? 0 : S * 0.45;
    const lo = Math.min(S - span, 0) - slack, hi = Math.max(S - span, 0) + slack;
    return clamp(c - f * k, lo, hi);
  };
  const ox = axis(free.x + free.w / 2, focus.x + focus.w / 2, src.w, W);
  const oy = axis(free.y + free.h / 2, focus.y + focus.h / 2, src.h, H);
  return { k, ox, oy };
}

export const shown = (cam, f) => rect(f.x * cam.k + cam.ox, f.y * cam.k + cam.oy, f.w * cam.k, f.h * cam.k);

/** A focus rect grown to a readable minimum around its middle, inside the source. */
export function padFocus(r, src, min = [0.55, 0.26]) {
  const pad = src.w * 0.05;
  let w = Math.max(r.w + 2 * pad, src.w * min[0]), h = Math.max(r.h + 2 * pad, src.h * min[1]);
  w = Math.min(w, src.w); h = Math.min(h, src.h);
  const cx = clamp(r.x + r.w / 2, w / 2, src.w - w / 2), cy = clamp(r.y + r.h / 2, h / 2, src.h - h / 2);
  return rect(cx - w / 2, cy - h / 2, w, h);
}

// ------------------------------------------------------------------ words

const norm = (s) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Every place a phrase is said: [{ i, j, s, e }] by word index and source seconds. */
export function findPhrase(words, phrase) {
  const target = norm(phrase);
  if (!target) return [];
  let text = '';
  const starts = [], ends = [];
  for (const w of words) { starts.push(text.length); text += norm(w.w); ends.push(text.length); }
  const loose = CJK.test(target);
  const out = [];
  for (let at = text.indexOf(target); at >= 0; at = text.indexOf(target, at + 1)) {
    const i = ends.findIndex((e) => e > at), j = ends.findIndex((e) => e >= at + target.length);
    if (i < 0 || j < 0) continue;
    if (!loose && (starts[i] !== at || ends[j] !== at + target.length)) continue;
    out.push({ i, j, s: words[i].s, e: words[j].e });
  }
  return out;
}

/** The cues of a VTT: [{ s, e, text }]. */
export function cuesOf(vtt) {
  const clock = (t) => { const p = t.split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
  const out = [];
  for (const block of readFileSync(vtt, 'utf8').split(/\r?\n\r?\n/)) {
    const m = block.match(/([\d:.]+)\s*-->\s*([\d:.]+)[^\n]*\n([\s\S]*)/);
    if (m) out.push({ s: clock(m[1]), e: clock(m[2]), text: m[3].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() });
  }
  return out;
}

// ------------------------------------------------------------------ cuts

/**
 * What of the recording stays: [[in, out]] in its seconds. Pauses longer than maxPause keep keepPause of quiet; an
 * um with a pause on both sides goes; every cut point falls inside a pause measured in the sound.
 */
export function proposeKeeps(words, pauses, duration, o = {}) {
  const maxPause = o.maxPause ?? 0.6, keep = o.keepPause ?? 0.3;
  const inP = (p, t) => clamp(t, p[0] + MARGIN, p[1] - MARGIN);
  const cuts = [];
  const first = words[0], last = words.at(-1);
  let start = 0, end = duration;
  const lead = pauses.find((p) => p[0] <= 0.05 && p[1] >= first.s - 0.15);
  if (lead && lead[1] - lead[0] > keep / 2 + 2 * MARGIN) start = round3(inP(lead, lead[1] - keep / 2));
  const tail = pauses.find((p) => p[1] >= duration - 0.05 && p[0] <= last.e + 0.15);
  if (tail && tail[1] - tail[0] > keep / 2 + 2 * MARGIN) end = round3(inP(tail, tail[0] + keep / 2 + 0.05));
  for (const p of pauses) {
    if (p[0] <= 0.05 || p[1] >= duration - 0.05 || p[1] - p[0] <= maxPause) continue;
    cuts.push({ a: round3(inP(p, p[0] + keep / 2)), b: round3(inP(p, p[1] - keep / 2)), why: 'pause' });
  }
  words.forEach((w) => {
    if (!FILLERS.has(norm(w.w))) return;
    const p1 = pauses.find((p) => p[1] >= w.s - 0.25 && p[1] <= w.s + 0.15 && p[1] - p[0] >= 2 * MARGIN + 0.02);
    const p2 = pauses.find((p) => p[0] >= w.e - 0.2 && p[0] <= w.e + 0.3 && p[1] - p[0] >= 2 * MARGIN + 0.02);
    if (p1 && p2 && p1 !== p2) cuts.push({ a: round3(inP(p1, p1[0] + Math.min(keep / 2, (p1[1] - p1[0]) / 2))), b: round3(inP(p2, p2[1] - Math.min(keep / 2, (p2[1] - p2[0]) / 2))), why: `"${w.w}"` });
  });
  cuts.sort((x, y) => x.a - y.a);
  const merged = [];
  for (const c of cuts) {
    const l = merged.at(-1);
    if (l && c.a <= l.b) { l.b = Math.max(l.b, c.b); l.why = [...new Set([l.why, c.why])].join(' + '); } else merged.push({ ...c });
  }
  const keeps = [];
  let t = start;
  for (const c of merged) {
    if (c.a <= t || c.b >= end) continue;
    keeps.push([t, c.a]);
    t = c.b;
  }
  keeps.push([t, end]);
  const said = (a, b) => words.filter((w) => w.s >= a - 0.05 && w.e <= b + 0.05).map((w) => w.w).join(' ');
  return { keeps, cuts: merged.filter((c) => c.a > start && c.b < end).map((c) => ({ ...c, words: said(c.a, c.b) })), start, end };
}

/** Film seconds for a source second, through the keeps (a cut second goes to the next kept one). */
export function filmTimeOf(keeps, t) {
  let off = 0;
  for (const [a, b] of keeps) {
    if (t < a) return round3(off);
    if (t <= b) return round3(off + t - a);
    off += b - a;
  }
  return round3(off);
}

// ------------------------------------------------------------------ plan

/** Demo shots on the words that name them, in film seconds. */
export function matchDemos(words, keeps, demos, { ctaAt }) {
  const found = [], missing = [];
  for (const d of demos) {
    const says = [d.say ?? d.id].flat();
    let hit = null;
    if (d.word != null) hit = { s: d.word, e: d.word, phrase: `${d.word} s` };
    else for (const p of says) for (const m of findPhrase(words, p)) if (!hit || m.s < hit.s) hit = { ...m, phrase: p };
    if (!hit) { missing.push({ id: d.id, why: `never says ${says.map((s) => `"${s}"`).join(' or ')}` }); continue; }
    const at = filmTimeOf(keeps, hit.s);
    if (ctaAt != null && at >= ctaAt) { missing.push({ id: d.id, why: `"${hit.phrase}" is said in the call to action` }); continue; }
    found.push({ demo: d, word: round3(hit.s), phrase: hit.phrase, said: at });
  }
  found.sort((a, b) => a.said - b.said);
  return { found, missing };
}

/** Focus keyframes of a shot in its own seconds: [{ t, src rect }]. */
export function focusKeys(demo, src, from, len, record) {
  // Nothing says where: the middle of the screen
  const whole = padFocus(rect(src.w / 2, src.h / 2, 0, 0), src, src.h > src.w ? [1, 0.3] : [0.55, 0.4]);
  const keys = [];
  if (Array.isArray(demo.focus) && typeof demo.focus[0] === 'number') keys.push({ t: 0, r: rect(...demo.focus) });
  else if (Array.isArray(demo.focus)) for (const f of demo.focus) keys.push({ t: Math.max(0, f.t - from), r: rect(...f.rect) });
  else if (record) {
    const [cw] = record.size.split('x').map(Number);
    const s = src.w / cw;
    for (const e of record.take.events) {
      if (e.type !== 'target' || e.t < from - 0.3 || e.t > from + len - 0.6) continue;
      keys.push({ t: Math.max(0, e.t - from - 0.4), r: padFocus(rect(e.x * s, e.y * s, e.width * s, e.height * s), src, demo.min ?? (src.h > src.w ? [1, 0.3] : [0.55, 0.26])) });
    }
  }
  if (!keys.length || keys[0].t > 0.3) keys.unshift({ t: 0, r: keys[0]?.r ?? whole });
  keys[0].t = 0;
  return keys.filter((k, i) => i === 0 || k.t - keys[i - 1].t > 0.6 || ((keys[i - 1].drop = true), true)).filter((k) => !k.drop);
}

/** The camera path of a shot at FPS: [k, ox, oy, fx, fy, fw, fh], the shown part in frame px. */
export function cameraPath(cams, keys, len, push = 0.03) {
  const n = Math.max(1, Math.ceil(len * FPS) + 1);
  const out = [];
  for (let f = 0; f < n; f++) {
    const t = f / FPS;
    let i = 0;
    while (i + 1 < keys.length && t >= keys[i + 1].t - 0.5) i++;
    const c1 = cams[i], c0 = cams[Math.max(0, i - 1)];
    const u = i === 0 ? 1 : ease((t - (keys[i].t - 0.5)) / 0.8);
    let k = c0.k + (c1.k - c0.k) * u, ox = c0.ox + (c1.ox - c0.ox) * u, oy = c0.oy + (c1.oy - c0.oy) * u;
    const fr = keys[i].r;
    // Slow push around the shown part's middle
    const p = 1 + push * (t / Math.max(len, 0.001));
    const cx = (fr.x + fr.w / 2) * k + ox, cy = (fr.y + fr.h / 2) * k + oy;
    ox = cx - (cx - ox) * p; oy = cy - (cy - oy) * p; k *= p;
    out.push([Math.round(k * 10000) / 10000, r1(ox), r1(oy), r1(fr.x * k + ox), r1(fr.y * k + oy), r1(fr.w * k), r1(fr.h * k)]);
  }
  return out;
}

/** The best window slot and camera for a shot: nothing shown under the window, the shown part as large as fits. */
export function placeShot({ src, keys, len, fit, zoom }, stage, band, slots, prefer) {
  let best = null;
  slots.forEach((slot, si) => {
    const free = freeRects(stage, obstacles(stage, band, slot.rect));
    if (!free.length) return;
    // Each focus key's camera in each free rect; every combination tried, the one that never meets the window kept
    const options = keys.map((key) => free.map((fr) => {
      const cam = solveCamera(src, key.r, fr, stage, { fit, zoom });
      const s = shown(cam, key.r);
      return { ...cam, fits: inside(s, fr) && inside(s, rect(0, 0, ...stage)) };
    }));
    const win = grow(slot.rect, 4);
    const kBase = Math.min(stage[0] / src.w, stage[1] / src.h);
    let pick = null;
    const total = options.reduce((n, o) => n * o.length, 1);
    for (let c = 0; c < Math.min(total, 1024); c++) {
      let rest = c;
      const cams = options.map((o) => { const x = o[rest % o.length]; rest = Math.floor(rest / o.length); return x; });
      const path = cameraPath(cams, keys, len);
      const hits = path.filter((p) => overlap(rect(p[3], p[4], p[5], p[6]), win) > 0).length;
      const misfit = cams.filter((x) => !x.fits).length;
      // Larger, and more of the frame filled by the footage
      const fill = cams.reduce((n, x) => n + overlap(rect(x.ox, x.oy, src.w * x.k, src.h * x.k), rect(0, 0, ...stage)) / area(rect(0, 0, ...stage)), 0) / cams.length;
      const value = -hits * 1000 - misfit * 100 + cams.reduce((n, x) => n + x.k / kBase, 0) / cams.length * 10 + fill * 10;
      if (!pick || value > pick.value) pick = { path, hits, value };
    }
    const { path, hits } = pick;
    const score = pick.value + (slot.name === prefer ? 2 : 0) - si * 0.2;
    if (!best || score > best.score) best = { slot, path, hits, score };
  });
  return best;
}

/** The plan, from the config and what was measured; pure, so it can be tested. */
export function makePlan(cfg, m) {
  const stage = SHAPES[cfg.shape ?? '9:16'] ?? String(cfg.shape).split('x').map(Number);
  const band = subtitleBand(stage, m.subtitleStyle);
  const slots = windowSlots(stage, band, cfg.window);
  const words = m.words;
  const cut = cfg.keep ? { keeps: cfg.keep, cuts: [] } : cfg.cut === false ? { keeps: [[0, m.duration]], cuts: [] } : proposeKeeps(words, m.pauses, m.duration, cfg.cut);
  const keeps = cut.keeps.map(([a, b]) => [round3(a), round3(b)]);
  const length = round3(keeps.reduce((n, [a, b]) => n + b - a, 0));
  const warnings = [];
  // The call to action, full frame
  let ctaAt = null;
  if (cfg.cta !== false) {
    const cue = cfg.cta?.say ? (() => { const hit = findPhrase(words, cfg.cta.say)[0]; return hit ? m.cues.find((c) => c.e >= hit.s - 0.01) : null; })() : m.cues.at(-1);
    if (!cue) warnings.push(`the call to action "${cfg.cta.say}" is never said: the film ends on the last demo`);
    else {
      ctaAt = Math.max(0, round3(filmTimeOf(keeps, cue.s) - 0.05));
      // A cut just before it: start there, so no sliver of window is left
      let off = 0;
      for (const [a, b] of keeps) { if (off < ctaAt && ctaAt - off < 0.2) ctaAt = round3(off); off += b - a; }
    }
  }
  const { found, missing } = matchDemos(words, keeps, cfg.demos ?? [], { ctaAt });
  for (const x of missing) warnings.push(`demo ${x.id}: ${x.why}; it is left out`);
  const shots = [];
  const states = [];
  const end = ctaAt ?? length;
  let prefer = cfg.window?.slot ?? null;
  found.forEach((f, n) => {
    const start = Math.max(0, round3(f.said - LEAD));
    let stop = round3(n + 1 < found.length ? found[n + 1].said - LEAD : end);
    const d = f.demo, media = m.media[d.src];
    const from = typeof d.from === 'number' ? d.from : d.from?.startsWith?.('mark:') ? markTime(m.records[d.src], d.from.slice(5)) : 0;
    const room = round3(Math.min(d.to ?? Infinity, media.duration) - from - 0.5 / FPS);
    if (room < stop - start - 0.8) {
      warnings.push(`demo ${d.id}: its footage runs ${round3(room)} s, the words give it ${round3(stop - start)} s: the speaker fills the frame for the rest; film a longer take to cover it`);
      stop = round3(start + room);
    }
    const len = round3(stop - start);
    if (len < MIN_SHOT) warnings.push(`demo ${d.id} is on screen ${len} s, under ${MIN_SHOT} s: name the next one later, or leave one out`);
    const keys = focusKeys(d, media, from, len, m.records[d.src]);
    if (!d.focus && !m.records[d.src]) warnings.push(`demo ${d.id}: nothing says where its action is, so the window keeps clear of the middle of the screen; give "focus" rects or film it with web-demo or app-demo`);
    const placed = placeShot({ src: media, keys, len, fit: d.fit, zoom: d.zoom }, stage, band, slots, prefer);
    if (placed.hits) warnings.push(`demo ${d.id}: the window covers what it shows in ${placed.hits} frames whatever its place; give it a smaller focus`);
    prefer = placed.slot.name;
    const label = d.label ? placeLabel(d.label, stage, band, placed.slot.rect, placed.path) : null;
    shots.push({ id: d.id, n: n + 1, src: d.src, from: round3(from), at: start, len, word: f.word, said: f.said, phrase: f.phrase, slot: placed.slot, path: placed.path, label, size: [media.w, media.h], taps: tapsOf(m.records[d.src], from, len) });
  });
  // Full frame for the hook, between shots with no footage, and from the call to action
  let t = 0;
  for (const s of shots) {
    if (s.at > t + 0.001) states.push({ a: t, b: s.at, mode: 'full' });
    states.push({ a: s.at, b: round3(s.at + s.len), mode: 'window', slot: s.slot });
    t = round3(s.at + s.len);
  }
  if (t < length) states.push({ a: t, b: length, mode: 'full' });
  if (states[0]?.mode === 'full' && states[0].b > 6) warnings.push(`the opening runs ${states[0].b} s before the first demo: name a feature sooner`);
  const clips = speakerClips(keeps, states);
  return { stage, band, slots, keeps, cuts: cut.cuts, length, before: m.duration, ctaAt, shots, states, clips, warnings };
}

function markTime(record, name) {
  const e = record?.take.events.find((x) => x.type === 'mark' && x.name === name);
  if (!e) throw new Error(`no mark "${name}" in the take's record`);
  return e.t;
}

function tapsOf(record, from, len) {
  if (!record) return [];
  const [cw] = record.size.split('x').map(Number);
  const s = record.take.width / cw;
  return record.take.events.filter((e) => e.type === 'down' && e.t >= from && e.t <= from + len).map((e) => [round3(e.t - from), r1(e.x * s), r1(e.y * s)]);
}

/** A feature label at the top or bottom of the free part, clear of the window and of the shown part. */
export function placeLabel(text, [W, H], band, win, path) {
  const h = Math.round(Math.min(W, H) * 0.075), font = Math.min(W, H) * 0.036;
  const chars = [...text].reduce((n, c) => n + (CJK.test(c) ? 1.05 : 0.56), 0);
  const w = Math.min(Math.round(chars * font + h), W - 2 * Math.round(W * 0.05));
  const top = Math.round(H > W ? H * 0.078 : H * 0.05);
  const xs = [Math.round((W - w) / 2), Math.round(W * 0.05), W - Math.round(W * 0.05) - w];
  const ys = [top, band.y - h - 24, win.y + win.h + GAP];
  let best = null;
  for (const y of ys) for (const x of xs) {
    const r = rect(x, y, w, h);
    if (overlap(grow(r, 8), grow(win, 4)) || overlap(r, band) || r.y < 0) continue;
    const hits = path.filter((p) => overlap(r, rect(p[3], p[4], p[5], p[6])) > 0).length;
    if (!best || hits < best.hits) best = { rect: r, hits };
  }
  return best && best.hits === 0 ? { text, rect: best.rect } : null;
}

/** The speaker's clips: each kept stretch split where the window moves, the same file throughout. */
export function speakerClips(keeps, states) {
  const out = [];
  let off = 0;
  for (const [a, b] of keeps) {
    const fa = off, fb = round3(off + b - a);
    for (const s of states) {
      const x = Math.max(fa, s.a), y = Math.min(fb, s.b);
      if (y - x < 0.001) continue;
      out.push({ at: round3(x), in: round3(a + x - fa), out: round3(a + y - fa), mode: s.mode, slot: s.slot });
    }
    off = fb;
  }
  return out;
}

// ------------------------------------------------------------------ pages and film.html

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const url = (p) => encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
const px = (r) => `left: ${Math.round(r.x)}px; top: ${Math.round(r.y)}px; width: ${Math.round(r.w)}px; height: ${Math.round(r.h)}px`;

export function demoPage(shot, { srcUrl, background }) {
  const [W, H] = shot.stage;
  const data = { by: 'pip-promo', src: shot.src, from: shot.from, len: shot.len, rate: FPS, size: shot.size, stage: shot.stage, window: shot.slot.rect, path: shot.path, label: shot.label, taps: shot.taps };
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(shot.id)}: demo shot ${shot.n}</title>
<!-- Made by pip-promo: ${esc(shot.src)} from ${shot.from} s, moving in on what is talked about. "pip.mjs plan" writes it again. -->
<style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  body { background: ${background}; }
  #card { position: absolute; left: 0; top: 0; width: ${shot.size[0]}px; height: ${shot.size[1]}px; transform-origin: 0 0; overflow: hidden; background: #fff; box-shadow: 0 30px 80px rgba(20, 30, 20, 0.28); }
  #take { display: block; width: 100%; height: 100%; }
  #taps { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  #label { position: absolute; display: flex; align-items: center; justify-content: center; box-sizing: border-box; border-radius: 999px; background: #fff; color: #1d2320; font: 700 ${Math.round(Math.min(W, H) * 0.036)}px/1 "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16); white-space: nowrap; }
</style>
</head>
<body>
<div id="card">
  ${STILL.test(shot.src) ? `<img id="take" src="${srcUrl}" alt="">` : `<video id="take" src="${srcUrl}" muted playsinline preload="auto"></video>`}
  <svg id="taps" viewBox="0 0 ${shot.size[0]} ${shot.size[1]}" aria-hidden="true"><circle id="ring" r="0" fill="rgba(255,255,255,0.35)" stroke="#fff" stroke-width="4" opacity="0"></circle></svg>
</div>
${shot.label ? `<div id="label" style="${px(shot.label.rect)}">${esc(shot.label.text)}</div>` : ''}
<script type="application/json" id="pip-data">${JSON.stringify(data)}</script>
<script type="module">
const D = JSON.parse(document.getElementById('pip-data').textContent);
const video = document.getElementById('take');
const card = document.getElementById('card');
const ring = document.getElementById('ring');
const label = document.getElementById('label');
function at(t) {
  const f = Math.min(Math.max(t * D.rate, 0), D.path.length - 1);
  const i = Math.floor(f), u = f - i, p = D.path[i], q = D.path[Math.min(i + 1, D.path.length - 1)];
  return p.map((v, j) => v + (q[j] - v) * u);
}
function draw(t) {
  const [k, ox, oy] = at(t);
  card.style.transform = \`translate(\${ox}px, \${oy}px) scale(\${k})\`;
  card.style.borderRadius = \`\${28 / k}px\`;
  const tap = D.taps.filter((x) => x[0] <= t && t < x[0] + 0.6).pop();
  if (tap) {
    const u = (t - tap[0]) / 0.6;
    ring.setAttribute('cx', tap[1]); ring.setAttribute('cy', tap[2]);
    ring.setAttribute('r', String((18 + 40 * Math.sqrt(u)) / k * 1.4));
    ring.setAttribute('opacity', String(1 - u));
  } else ring.setAttribute('opacity', '0');
  if (label) label.style.opacity = String(Math.min(1, t / 0.25));
}
const still = video.tagName === 'IMG';
function frame(t) {
  if (!still) video.currentTime = Math.min(Math.max(D.from + t, 0), D.from + D.len);
  draw(t);
}
const ready = still ? video.decode().catch(() => undefined) : new Promise((done) => {
  if (video.readyState >= 2) done();
  else { video.addEventListener('loadeddata', done, { once: true }); video.addEventListener('error', done, { once: true }); }
});
window.film = { frame, duration: D.len, ready };
if (!window.filmHost && still) { const t0 = performance.now(); const loop = () => { draw(((performance.now() - t0) / 1000) % D.len); requestAnimationFrame(loop); }; loop(); }
else if (!window.filmHost) {
  ready.then(() => { video.currentTime = D.from; video.play().catch(() => undefined); });
  const loop = () => { draw(Math.max(0, video.currentTime - D.from) % D.len); requestAnimationFrame(loop); };
  loop();
}
</script>
</body>
</html>
`;
}

export function ctaPage({ stage: [W, H], len, logo, label }) {
  const top = Math.round(H > W ? H * 0.1 : H * 0.08);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Call to action</title>
<!-- Made by pip-promo: the logo and the line over the speaker's last words. Its text is an element: change it in Studio. -->
<style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: transparent; }
  #card { position: absolute; left: 50%; top: ${top}px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: ${Math.round(W * 0.02)}px; padding: ${Math.round(W * 0.03)}px ${Math.round(W * 0.05)}px; border-radius: 36px; background: rgba(255, 255, 255, 0.94); box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18); }
  #logo { height: ${Math.round(Math.min(W, H) * 0.1)}px; }
  #label { font: 800 ${Math.round(Math.min(W, H) * 0.05)}px/1.1 "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; color: #1d2320; white-space: nowrap; }
</style>
</head>
<body>
<div id="card">
  ${logo ? `<img id="logo" src="${logo}" alt="">` : ''}
  ${label ? `<div id="label">${esc(label)}</div>` : ''}
</div>
<script type="module">
const card = document.getElementById('card');
const img = document.getElementById('logo');
function frame(t) {
  const u = Math.min(1, t / 0.4), e = 1 - Math.pow(1 - u, 3);
  card.style.opacity = String(e);
  card.style.transform = \`translateX(-50%) translateY(\${(1 - e) * 40}px)\`;
}
const ready = img && !img.complete ? new Promise((r) => { img.onload = img.onerror = r; }) : undefined;
window.film = { frame, duration: ${len}, ready };
</script>
</body>
</html>
`;
}

export function coverPage({ stage: [W, H], speaker, speakerAt, face, title, demo }) {
  const s = Math.min(W, H);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Cover</title>
<!-- Made by pip-promo: the picture a feed shows before the film plays, in a line the speaker said. "npx openfilm look pip/cover.html 0" gives it. -->
<style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #222; }
  #face { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: ${face}; }
  #title { position: absolute; left: ${Math.round(W * 0.06)}px; right: ${Math.round(W * 0.06)}px; bottom: ${Math.round(H * 0.07)}px; padding: ${Math.round(s * 0.04)}px ${Math.round(s * 0.05)}px; border-radius: 32px; background: #fff; color: #161b18; font: 900 ${Math.round(s * 0.085)}px/1.08 "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; letter-spacing: -0.01em; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.25); }
  #demo { position: absolute; right: ${Math.round(W * 0.04)}px; top: ${Math.round(H * 0.04)}px; width: ${Math.round(Math.min(W * 0.26, H * 0.24))}px; border-radius: 28px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35); transform: rotate(4deg); border: 6px solid #fff; }
</style>
</head>
<body>
<video id="face" src="${speaker}" muted playsinline preload="auto"></video>
${demo ? (STILL.test(demo.src) ? `<img id="demo" src="${demo.src}" alt="">` : `<video id="demo" src="${demo.src}" muted playsinline preload="auto"></video>`) : ''}
<div id="title">${esc(title)}</div>
<script type="module">
const vids = [[document.getElementById('face'), ${speakerAt}]${demo ? `, [document.getElementById('demo'), ${demo.at}]` : ''}];
const ready = Promise.all(vids.map(([v, t]) => v.tagName === 'IMG' ? v.decode().catch(() => undefined) : new Promise((done) => {
  const go = () => { v.addEventListener('seeked', done, { once: true }); v.currentTime = t; };
  if (v.readyState >= 1) go(); else { v.addEventListener('loadedmetadata', go, { once: true }); v.addEventListener('error', done, { once: true }); }
})));
window.film = { frame() {}, ready, width: ${W}, height: ${H} };
</script>
</body>
</html>
`;
}

export function filmHtml(plan, { speaker, face, faceBox, music, musicVolume, cta, shotFiles }) {
  const [W, H] = plan.stage;
  const view = faceBox ? `object-view-box: inset(${Math.round(faceBox.y)}px ${Math.round(faceBox.sw - faceBox.x - faceBox.w)}px ${Math.round(faceBox.sh - faceBox.y - faceBox.h)}px ${Math.round(faceBox.x)}px); ` : '';
  const sp = plan.clips.map((c, i) => {
    const box = c.mode === 'full' ? rect(0, 0, W, H) : c.slot.rect;
    return `  <video id="speaker-${i + 1}" src="${url(speaker)}#t=${c.in},${c.out}" at="${c.at}" class="pip-${c.mode}" style="${px(box)}"></video>`;
  });
  const demos = plan.shots.map((s, i) => `  <iframe id="demo-${s.n}-${s.id}" src="${url(shotFiles[i])}#t=0,${s.len}" at="${s.at}" data-say="${esc(s.phrase)}" data-word="${s.word}"></iframe>`);
  const sections = [];
  if (cta) sections.push(`<section data-pip="cta">\n  <iframe id="cta" src="${url(cta.file)}#t=0,${cta.len}" at="${plan.ctaAt}"></iframe>\n</section>`);
  sections.push(`<section data-pip="speaker">\n${sp.join('\n')}\n</section>`);
  if (demos.length) sections.push(`<section data-pip="demo">\n${demos.join('\n')}\n</section>`);
  if (music) sections.push(`<section data-pip="music">\n  <audio id="music" src="${url(music)}#t=0,${plan.length}" volume="${musicVolume}"></audio>\n</section>`);
  const style = `<style data-pip>
  .pip-full { object-fit: cover; object-position: ${face}; }
  .pip-window { object-fit: cover; object-position: ${face}; ${view}border-radius: 28px; outline: 5px solid rgba(255, 255, 255, 0.95); box-shadow: 0 14px 40px rgba(0, 0, 0, 0.35); }
</style>`;
  return { sections, style, viewport: `<meta name="viewport" content="width=${W}, height=${H}">` };
}

/** film.html with its pip tracks and style replaced, the person's other tracks kept. */
export function mergeFilm(old, { sections, style, viewport }) {
  if (!old) return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n${viewport}\n${style}\n</head>\n<body>\n${sections.join('\n')}\n</body>\n</html>\n`;
  let html = /<meta name="viewport"[^>]*>/.test(old) ? old.replace(/<meta name="viewport"[^>]*>/, viewport) : old.replace(/(<meta charset[^>]*>)/, `$1
${viewport}`);
  html = /<style data-pip>[\s\S]*?<\/style>/.test(html) ? html.replace(/<style data-pip>[\s\S]*?<\/style>/, style) : html.replace('</head>', `${style}\n</head>`);
  const theirs = [...html.matchAll(/<section(?![^>]*data-pip)[^>]*>[\s\S]*?<\/section>/g)].map((x) => x[0]);
  // Caption tracks stay on top
  const captions = theirs.filter((s) => /<track\b/.test(s));
  const others = theirs.filter((s) => !/<track\b/.test(s));
  const body = [...captions, ...sections.slice(0, -1), ...others, sections.at(-1)];
  return html.replace(/<body>[\s\S]*<\/body>/, `<body>\n${body.join('\n')}\n</body>`);
}

// ------------------------------------------------------------------ measuring media

export function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file]).toString();
  const j = JSON.parse(out);
  return { w: j.streams?.[0]?.width ?? 0, h: j.streams?.[0]?.height ?? 0, duration: STILL.test(file) ? Infinity : +j.format.duration };
}

const recordFor = (file) => join(dirname(file), `${basename(file, extname(file))}.record.json`);
const vttFor = (file) => join(dirname(file), `${basename(file, extname(file))}.vtt`);

// ------------------------------------------------------------------ plan command

async function planCommand(cfgPath, o) {
  const dir = dirname(resolve(cfgPath));
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const sp = resolve(dir, cfg.speaker.src);
  if (!existsSync(vttFor(sp))) throw new Error(`no transcript beside ${cfg.speaker.src}: npx openfilm get asr --src ${cfg.speaker.src}`);
  const lv = await levels(sp);
  const media = {}, records = {};
  for (const d of cfg.demos ?? []) {
    const f = resolve(dir, d.src);
    media[d.src] ??= probe(f);
    const rec = d.record ? resolve(dir, d.record) : recordFor(f);
    if (existsSync(rec)) records[d.src] ??= JSON.parse(readFileSync(rec, 'utf8'));
  }
  const subFile = join(dir, '.film', 'subtitles.json');
  const subtitleStyle = existsSync(subFile) ? JSON.parse(readFileSync(subFile, 'utf8')) : undefined;
  const plan = makePlan(o.keepAll ? { ...cfg, cut: false } : cfg, { words: wordsOf(vttFor(sp)), cues: cuesOf(vttFor(sp)), pauses: pausesOf(lv), duration: lv.duration, media, records, subtitleStyle });
  const sm = probe(sp);
  const fb = cfg.speaker.face ? { x: cfg.speaker.face[0], y: cfg.speaker.face[1], w: cfg.speaker.face[2], h: cfg.speaker.face[3], sw: sm.w, sh: sm.h } : null;
  const face = fb ? `${Math.round(((fb.x + fb.w / 2) / sm.w) * 100)}% ${Math.round(((fb.y + fb.h / 2) / sm.h) * 100)}%` : '50% 30%';
  report(plan, cfg);
  if (o.dryRun) return plan;
  // Boxed subtitles unless the project has a style of its own
  if (!subtitleStyle) {
    mkdirSync(join(dir, '.film'), { recursive: true });
    writeFileSync(subFile, JSON.stringify({ look: 'bar' }, null, 2) + '\n');
    console.log('subtitles: boxed (.film/subtitles.json, look "bar"), so they read on light product screens');
  }
  mkdirSync(join(dir, 'pip'), { recursive: true });
  const shotFiles = plan.shots.map((s) => {
    const file = `pip/demo-${s.n}-${s.id}.html`;
    writeFileSync(join(dir, file), demoPage({ ...s, stage: plan.stage }, { srcUrl: url(relative(join(dir, 'pip'), resolve(dir, s.src)).replace(/\\/g, '/')), background: cfg.background ?? 'radial-gradient(120% 80% at 50% 30%, #f7f5ef, #dfe5dc)' }));
    return file;
  });
  let cta = null;
  if (plan.ctaAt != null && (cfg.cta?.logo || cfg.cta?.label)) {
    cta = { file: 'pip/cta.html', len: round3(plan.length - plan.ctaAt) };
    writeFileSync(join(dir, cta.file), ctaPage({ stage: plan.stage, len: cta.len, logo: cfg.cta.logo ? url(relative(join(dir, 'pip'), resolve(dir, cfg.cta.logo)).replace(/\\/g, '/')) : null, label: cfg.cta.label }));
  }
  const rel = (p) => url(relative(join(dir, 'pip'), resolve(dir, p)).replace(/\\/g, '/'));
  const first = plan.shots[0];
  const hookLine = cuesOf(vttFor(sp))[0]?.text ?? '';
  writeFileSync(join(dir, 'pip', 'cover.html'), coverPage({ stage: plan.stage, speaker: rel(cfg.speaker.src), speakerAt: cfg.cover?.at ?? round3(plan.keeps[0][0] + 0.6), face, title: cfg.cover?.title ?? hookLine, demo: first ? { src: rel(first.src), at: round3(first.from + Math.min(first.len, 3) - 0.2) } : null }));
  const filmFile = join(dir, 'film.html');
  const parts = filmHtml(plan, { speaker: cfg.speaker.src, face, faceBox: fb, music: cfg.music?.src, musicVolume: cfg.music?.volume ?? 0.12, cta, shotFiles });
  writeFileSync(filmFile, mergeFilm(existsSync(filmFile) ? readFileSync(filmFile, 'utf8') : null, parts));
  console.log(`\nwrote film.html (${plan.length} s), ${shotFiles.length} demo pages, ${cta ? 'pip/cta.html, ' : ''}pip/cover.html`);
  return plan;
}

function report(plan, cfg) {
  console.log(`speaker ${cfg.speaker.src}: ${round3(plan.before)} s -> ${plan.length} s, ${plan.cuts.length} cuts`);
  for (const c of plan.cuts) if (c.b - c.a > 0.05) console.log(`  cut ${c.a}-${c.b} (${round3(c.b - c.a)} s, ${c.why})${c.words ? `: ${c.words}` : ''}${c.b - c.a > 2 ? '  [over 2 s: say it]' : ''}`);
  for (const s of plan.states) {
    if (s.mode === 'full') console.log(`${s.a.toFixed(2)}-${s.b.toFixed(2)}  speaker full frame${s.a === 0 ? ' (hook)' : s.a >= (plan.ctaAt ?? Infinity) - 0.01 ? ' (call to action)' : ''}`);
    else {
      const shot = plan.shots.find((x) => x.at === s.a);
      console.log(`${s.a.toFixed(2)}-${s.b.toFixed(2)}  ${shot.id}: "${shot.phrase}" said at ${shot.said.toFixed(2)}, shot from ${shot.src} ${shot.from} s, window ${s.slot.name}${shot.label ? `, label "${shot.label.text}"` : ''}`);
    }
  }
  for (const w of plan.warnings) console.log(`! ${w}`);
}

// ------------------------------------------------------------------ check command

/** Clips of film.html with what the check needs. */
export function filmClips(html) {
  const vp = html.match(/<meta name="viewport" content="width=(\d+),\s*height=(\d+)"/);
  const stage = vp ? [+vp[1], +vp[2]] : [1920, 1080];
  const clips = [];
  let track = 0;
  for (const sec of html.matchAll(/<section([^>]*)>([\s\S]*?)<\/section>/g)) {
    track++;
    for (const m of sec[2].matchAll(/<(video|audio|iframe|img)\b([^>]*)>/g)) {
      const attr = (n) => m[2].match(new RegExp(`\\s${n}="([^"]*)"`))?.[1];
      const [file, frag] = (attr('src') ?? '').split('#');
      const t = frag?.match(/^t=([\d.]*)(?:,([\d.]*))?$/);
      const st = attr('style') ?? '';
      const n = (k) => { const v = st.match(new RegExp(`(?:^|;)\\s*${k}:\\s*(-?[\\d.]+)px`)); return v ? +v[1] : null; };
      clips.push({ kind: m[1], id: attr('id'), file: decodeURI(file), in: t?.[1] ? +t[1] : 0, out: t?.[2] ? +t[2] : null, at: +(attr('at') ?? 0), speed: +(attr('speed') ?? 1), volume: attr('volume') != null ? +attr('volume') : 1, muted: /\smuted\b/.test(m[2]), cls: attr('class') ?? '', box: n('width') != null ? rect(n('left') ?? 0, n('top') ?? 0, n('width'), n('height') ?? n('width')) : null, say: attr('data-say'), word: attr('data-word') != null ? +attr('data-word') : null, track, hidden: /\shidden\b/.test(sec[1]) || /\smuted\b/.test(sec[1]) });
    }
  }
  return { stage, clips };
}

const lenOf = (c) => (c.out != null ? (c.out - c.in) / c.speed : Infinity);

export function checkFilm(html, { dir, pageData, pausesFor, wordsFor }) {
  const { stage, clips } = filmClips(html);
  const [W, H] = stage;
  const frame = rect(0, 0, W, H);
  const band = subtitleBand(stage);
  const speaker = clips.filter((c) => c.kind === 'video' && /pip-(window|full)/.test(c.cls)).sort((a, b) => a.at - b.at);
  const demos = clips.filter((c) => c.kind === 'iframe' && c.say != null).map((c) => ({ ...c, data: pageData(c.file) })).filter((c) => c.data);
  const problems = [], lines = [];
  const end = Math.max(...clips.filter((c) => c.kind !== 'audio').map((c) => c.at + lenOf(c)).filter(Number.isFinite), 0);
  let covered = 0, offFrame = 0, overSubs = 0, bare = 0, windowFrames = 0, labelHits = 0;
  for (let f = 0; f < Math.ceil(end * FPS); f++) {
    const t = (f + 0.5) / FPS;
    const sp = speaker.find((c) => t >= c.at && t < c.at + lenOf(c));
    if (!sp?.box || (sp.box.w >= W - 1 && sp.box.h >= H - 1)) continue;
    windowFrames++;
    const win = sp.box;
    if (!inside(win, frame)) offFrame++;
    if (overlap(win, band) > 0) overSubs++;
    const d = demos.find((c) => t >= c.at && t < c.at + lenOf(c));
    if (!d) { bare++; continue; }
    const p = d.data.path, i = Math.min(p.length - 1, Math.max(0, Math.round((t - d.at + d.in) * d.data.rate)));
    const shownR = rect(p[i][3], p[i][4], p[i][5], p[i][6]);
    if (overlap(shownR, grow(win, 5)) > 0) covered++;
    if (d.data.label && (overlap(d.data.label.rect, grow(win, 5)) > 0 || overlap(d.data.label.rect, shownR) > 0)) labelHits++;
  }
  lines.push(`window on screen ${(windowFrames / FPS).toFixed(1)} s: over the shown part in ${covered} frames, off the frame in ${offFrame}, over the subtitles in ${overSubs}, over no demo in ${bare}; labels in the way in ${labelHits}`);
  if (covered) problems.push(`the window covers the shown part of a demo in ${covered} frames`);
  if (offFrame) problems.push(`the window leaves the frame in ${offFrame} frames`);
  if (overSubs) problems.push(`the window sits over the subtitles in ${overSubs} frames`);
  if (bare) problems.push(`the window floats over no demo in ${bare} frames`);
  if (labelHits) problems.push(`a label overlaps the window or the shown part in ${labelHits} frames`);
  // Demo shots against their words
  let worst = 0;
  for (const d of demos) {
    const sp = speaker.find((c) => d.word >= c.in - 1e-6 && d.word <= (c.out ?? Infinity) + 1e-6);
    if (!sp) { problems.push(`${d.id}: its word at ${d.word} s is cut out of the speaker`); continue; }
    const said = sp.at + (d.word - sp.in) / sp.speed;
    const delta = d.at - said;
    worst = Math.max(worst, Math.abs(delta));
    lines.push(`${d.id}: on at ${d.at.toFixed(2)}, "${d.say}" said at ${said.toFixed(2)} (${delta >= 0 ? '+' : ''}${delta.toFixed(2)} s)`);
    if (Math.abs(delta) > 0.3) problems.push(`${d.id} comes on ${delta.toFixed(2)} s from "${d.say}"`);
    if (lenOf(d) < MIN_SHOT) problems.push(`${d.id} is on screen ${lenOf(d).toFixed(2)} s`);
  }
  // Cuts of the speaker in pauses
  const files = [...new Set(speaker.map((c) => c.file))];
  let cutsN = 0, cutsBad = 0;
  for (const file of files) {
    const own = speaker.filter((c) => c.file === file);
    const ps = pausesFor(file);
    const inPause = (t) => ps.some(([a, b]) => t >= a + MARGIN - 1e-6 && t <= b - MARGIN + 1e-6);
    for (let i = 0; i + 1 < own.length; i++) {
      const a = own[i], b = own[i + 1];
      if (Math.abs(a.out - b.in) < 0.0015 && Math.abs(a.at + lenOf(a) - b.at) < 0.0015) continue;
      cutsN++;
      const bad = [['out', a.out, a.id], ['in', b.in, b.id]].filter(([, t]) => !inPause(t));
      if (bad.length) cutsBad++;
      for (const [side, t, id] of bad) problems.push(`${id} ${side} ${t} is not in a pause`);
    }
    // Subtitles from the speaker's .vtt
    const vtt = join(dir, dirname(file), `${basename(file, extname(file))}.vtt`);
    if (!existsSync(vtt)) problems.push(`${file} has no .vtt beside it: the film has no subtitles`);
    if (own.some((c) => c.muted || c.volume === 0 || c.hidden)) problems.push(`${file} is muted somewhere: its subtitles go with it`);
  }
  lines.push(`speaker cuts: ${cutsN}, ${cutsN - cutsBad} with both sides in a pause`);
  // No subtitles drawn in a page
  const said = files.flatMap((f) => wordsFor(f)).map((w) => norm(w.w));
  const runs = new Set();
  for (let i = 0; i + 4 <= said.length; i++) runs.add(said.slice(i, i + 4).join(' '));
  for (const c of clips.filter((x) => x.kind === 'iframe')) {
    const p = join(dir, c.file);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');
    const ws = text.split(/\s+/).map(norm).filter(Boolean);
    for (let i = 0; i + 4 <= ws.length; i++) if (runs.has(ws.slice(i, i + 4).join(' '))) { problems.push(`${c.file} draws the speaker's words "${ws.slice(i, i + 4).join(' ')}": subtitles come from the .vtt`); break; }
  }
  // Caption tracks are allowed; their cues are not measured
  const tags = html.match(/<track\b[^>]*>/g) ?? [];
  const captionTags = tags.filter((t) => !/\skind=/.test(t) || /\skind=["']?(captions|subtitles)\b/.test(t));
  if (captionTags.length) lines.push(`${captionTags.length} caption track(s): the window is checked against the default subtitle band, not their cues`);
  if (captionTags.length < tags.length) problems.push('film.html has a <track> that is not a caption track');
  return { lines, problems, worst, covered, offFrame, overSubs, bare, windowFrames };
}

async function checkCommand(film, o) {
  const dir = dirname(resolve(film));
  const html = readFileSync(film, 'utf8');
  const cache = new Map();
  const pauseMap = new Map();
  for (const c of filmClips(html).clips.filter((x) => x.kind === 'video' && /pip-/.test(x.cls))) {
    if (!pauseMap.has(c.file)) pauseMap.set(c.file, pausesOf(await levels(join(dir, c.file))));
  }
  const res = checkFilm(html, {
    dir,
    pageData: (file) => {
      if (!cache.has(file)) {
        const p = join(dir, file);
        const m = existsSync(p) ? readFileSync(p, 'utf8').match(/<script type="application\/json" id="pip-data">([\s\S]*?)<\/script>/) : null;
        cache.set(file, m ? JSON.parse(m[1]) : null);
      }
      return cache.get(file);
    },
    pausesFor: (file) => pauseMap.get(file),
    wordsFor: (file) => { const v = join(dir, dirname(file), `${basename(file, extname(file))}.vtt`); return existsSync(v) ? wordsOf(v) : []; },
  });
  for (const l of res.lines) console.log(l);
  if (o.video) {
    const { clips } = filmClips(html);
    const changes = sceneTimes(o.video);
    const speaker = clips.filter((c) => c.kind === 'video' && /pip-/.test(c.cls));
    for (const d of clips.filter((c) => c.kind === 'iframe' && c.say != null)) {
      const sp = speaker.find((c) => d.word >= c.in - 1e-6 && d.word <= (c.out ?? Infinity) + 1e-6);
      const said = sp ? sp.at + (d.word - sp.in) / sp.speed : NaN;
      const near = changes.reduce((b, x) => (Math.abs(x - d.at) < Math.abs(b - d.at) ? x : b), Infinity);
      const delta = near - said;
      console.log(`${d.id} in ${basename(o.video)}: picture changes at ${near.toFixed(2)}, "${d.say}" said at ${said.toFixed(2)} (${delta >= 0 ? '+' : ''}${delta.toFixed(2)} s)`);
      if (!(Math.abs(delta) <= 0.3)) res.problems.push(`${d.id}: in the render the picture changes ${delta.toFixed(2)} s from "${d.say}"`);
    }
  }
  for (const p of res.problems) console.log(`✗ ${p}`);
  console.log(res.problems.length ? `${res.problems.length} problems` : '✓ window clear of every demo, on the frame and off the subtitles; demos on their words; cuts in pauses; subtitles from the .vtt');
  process.exitCode = res.problems.length ? 1 : 0;
  return res;
}

/** Times where the rendered picture changes a lot from one frame to the next. */
export function sceneTimes(video, threshold = 0.12) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', video, '-vf', `scale=270:-2,select='gt(scene,${threshold})',showinfo`, '-an', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return [...r.stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]);
}

// ------------------------------------------------------------------ main

const main = process.argv[1] && import.meta.filename === resolve(process.argv[1]);
if (main) {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(n);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--video'].includes(args[i - 1])));
  try {
    if (pos[0] === 'plan') await planCommand(pos[1] ?? 'pip.json', { keepAll: flag('--keep-all'), dryRun: flag('--dry-run') });
    else if (pos[0] === 'check') await checkCommand(pos[1] ?? 'film.html', { video: opt('--video') });
    else { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 9).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exitCode = pos[0] ? 2 : 0; }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
