// Planning logic: window slots, free space, camera, word matching, cuts, and the film check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../skills/pip-promo/scripts/pip.mjs';

const V = [1080, 1920], L = [1920, 1080];
const w = (list) => list.map(([text, s, e]) => ({ w: text, s, e }));

test('subtitle band sits where Studio puts subtitles on each shape', () => {
  const v = P.subtitleBand(V), l = P.subtitleBand(L);
  assert.ok(v.y > 1920 * 0.6 && v.y + v.h < 1920 * 0.76, JSON.stringify(v));
  assert.ok(l.y > 1080 * 0.8 && l.y + l.h <= 1080, JSON.stringify(l));
});

test('window slots stay on the frame and off the subtitles', () => {
  for (const stage of [V, L, [1080, 1080]]) {
    const band = P.subtitleBand(stage);
    const slots = P.windowSlots(stage, band);
    assert.ok(slots.length >= 2);
    for (const s of slots) {
      assert.ok(P.inside(s.rect, P.rect(0, 0, ...stage)), `${s.name} off the frame`);
      assert.equal(P.overlap(s.rect, band), 0, `${s.name} over the subtitles`);
    }
  }
  const [a] = P.windowSlots(V, P.subtitleBand(V));
  assert.equal(a.rect.w, Math.round(1080 * 0.34));
  assert.equal(a.rect.h, Math.round((a.rect.w * 4) / 3));
});

test('free rects never meet an obstacle', () => {
  const band = P.subtitleBand(V);
  const [slot] = P.windowSlots(V, band);
  const obs = P.obstacles(V, band, slot.rect);
  const free = P.freeRects(V, obs);
  assert.ok(free.length >= 2);
  for (const f of free) for (const o of obs) assert.equal(P.overlap(f, o), 0);
});

test('the camera puts the focus inside the free rect when it can', () => {
  const src = { w: 780, h: 1688 };
  const focus = P.rect(0, 1100, 780, 500);
  const free = P.rect(0, 115, 1080, 600);
  const cam = P.solveCamera(src, focus, free, V);
  assert.ok(P.inside(P.shown(cam, focus), free), JSON.stringify(P.shown(cam, focus)));
});

test('phrases match whole words in English and any characters in Chinese', () => {
  const en = w([['Search', 1, 1.4], ['research', 2, 2.5], ['add', 3, 3.2], ['to', 3.2, 3.3], ['list,', 3.3, 3.6]]);
  assert.deepEqual(P.findPhrase(en, 'search').map((m) => m.s), [1]);
  assert.deepEqual(P.findPhrase(en, 'add to list').map((m) => [m.s, m.e]), [[3, 3.6]]);
  const zh = w([['打', 1, 1.2], ['开', 1.2, 1.4], ['搜', 1.4, 1.6], ['索', 1.6, 1.8]]);
  assert.deepEqual(P.findPhrase(zh, '搜索').map((m) => m.s), [1.4]);
});

test('an um with a pause on both sides goes, one inside speech stays, long pauses shrink', () => {
  const words = w([['so', 0.3, 0.8], ['um', 1.2, 1.5], ['the', 1.9, 2.3], ['uh', 2.3, 2.5], ['law', 2.5, 3.0], ['is', 4.5, 4.8]]);
  const pauses = [[0, 0.3], [0.8, 1.2], [1.5, 1.9], [3.0, 4.5], [4.8, 5.2]];
  const r = P.proposeKeeps(words, pauses, 5.2);
  const cutOut = (t) => !r.keeps.some(([a, b]) => t >= a && t <= b);
  assert.ok(cutOut(1.35), 'um between pauses is cut');
  assert.ok(!cutOut(2.4), 'uh inside speech stays');
  assert.ok(cutOut(3.75), 'the middle of a 1.5 s pause is cut');
  for (const [a, b] of r.keeps) for (const t of [a, b]) {
    if (t <= 0.05 || t >= 5.15) continue;
    assert.ok(pauses.some(([x, y]) => t >= x + P.MARGIN - 1e-9 && t <= y - P.MARGIN + 1e-9), `cut point ${t} not in a pause`);
  }
  const quiet = r.keeps.slice(1).map(([a], i) => a - r.keeps[i][1]);
  assert.ok(quiet.every((q) => q > 0));
});

test('film time follows the keeps', () => {
  const keeps = [[1, 3], [5, 8]];
  assert.equal(P.filmTimeOf(keeps, 2), 1);
  assert.equal(P.filmTimeOf(keeps, 4), 2);
  assert.equal(P.filmTimeOf(keeps, 6), 3);
});

test('demos are placed on the words that name them, in the order said, none in the call to action', () => {
  const words = w([['open', 0, 0.3], ['search', 1, 1.4], ['then', 2, 2.2], ['share', 3, 3.3], ['buy', 5, 5.3], ['search', 6, 6.2]]);
  const { found, missing } = P.matchDemos(words, [[0, 7]], [{ id: 'b', say: 'share' }, { id: 'a', say: 'search' }, { id: 'c', say: 'export' }, { id: 'd', say: 'buy' }], { ctaAt: 4.9 });
  assert.deepEqual(found.map((f) => [f.demo.id, f.said]), [['a', 1], ['b', 3]]);
  assert.deepEqual(missing.map((m) => m.id), ['c', 'd']);
});

test('speaker clips meet frame to frame where the window moves', () => {
  const clips = P.speakerClips([[0.2, 4], [5, 9]], [{ a: 0, b: 2, mode: 'full' }, { a: 2, b: 6, mode: 'window', slot: {} }, { a: 6, b: 7.8, mode: 'full' }]);
  for (let i = 1; i < clips.length; i++) {
    const p = clips[i - 1], c = clips[i];
    assert.ok(Math.abs(p.at + (p.out - p.in) - c.at) < 0.0011, 'no gap on the film');
  }
  assert.deepEqual(clips.map((c) => c.mode), ['full', 'window', 'window', 'full']);
  assert.equal(clips.at(-1).out, 9);
});

test('the window moves away from what a shot shows', () => {
  const band = P.subtitleBand(V);
  const slots = P.windowSlots(V, band);
  const src = { w: 1080, h: 1920 };
  // Focus in the top right of the footage: the window must not stay there
  const keys = [{ t: 0, r: P.rect(600, 120, 460, 500) }];
  const placed = P.placeShot({ src, keys, len: 3, fit: 'cover' }, V, band, slots, 'top-right');
  assert.equal(placed.hits, 0);
  assert.notEqual(placed.slot.name, 'top-right');
  for (const p of placed.path) assert.equal(P.overlap(P.rect(p[3], p[4], p[5], p[6]), placed.slot.rect), 0);
});

test('moves between focus keys never cross the window', () => {
  const band = P.subtitleBand(V);
  const slots = P.windowSlots(V, band);
  const src = { w: 780, h: 1688 };
  const keys = [{ t: 0, r: P.rect(0, 0, 780, 500) }, { t: 1.6, r: P.rect(0, 1100, 780, 500) }];
  const placed = P.placeShot({ src, keys, len: 4 }, V, band, slots);
  assert.equal(placed.hits, 0);
});

// A made-up project, measured, for makePlan and checkFilm
const media = { 'assets/app.mp4': { w: 780, h: 1688, duration: 20 } };
const said = (text, s, e) => { const ws = text.split(' '); const d = (e - s) / ws.length; return ws.map((x, i) => [x, s + i * d, s + (i + 1) * d]); };
const words = w([...said('Meet Pantry.', 0.5, 1.3), ...said('Search any dish and see what you can cook tonight.', 2, 5), ...said('Tap a recipe for every amount you need to buy.', 6, 9), ...said('Try it free.', 11, 12)]);
const cues = [{ s: 0.5, e: 1.3, text: 'Meet Pantry.' }, { s: 2, e: 5, text: '…' }, { s: 6, e: 9, text: '…' }, { s: 11, e: 12, text: 'Try it free.' }];
const pauses = [[0, 0.5], [1.3, 2], [5, 6], [9, 11], [12, 12.5]];
const cfg = { shape: '9:16', speaker: { src: 'assets/talk.mp4' }, demos: [{ id: 'search', say: 'search', src: 'assets/app.mp4', from: 0 }, { id: 'recipe', say: 'recipe', src: 'assets/app.mp4', from: 5 }], cta: { say: 'try it' } };
const plan = P.makePlan(cfg, { words, cues, pauses, duration: 12.5, media, records: {} });

test('makePlan: hook and call to action full frame, demos in between, nothing uncovered', () => {
  assert.equal(plan.states[0].mode, 'full');
  assert.equal(plan.states.at(-1).mode, 'full');
  assert.deepEqual(plan.shots.map((s) => s.id), ['search', 'recipe']);
  for (const s of plan.shots) assert.ok(Math.abs(s.at - (s.said - P.LEAD)) < 0.002);
  assert.ok(plan.length < 12.5, 'long pauses cut');
  const winStates = plan.states.filter((s) => s.mode === 'window');
  for (const s of winStates) assert.ok(plan.shots.some((x) => x.at <= s.a + 1e-6 && x.at + x.len >= s.b - 1e-6));
});

function filmOf(p) {
  const parts = P.filmHtml(p, { speaker: 'assets/talk.mp4', face: '50% 30%', shotFiles: p.shots.map((s) => `pip/demo-${s.n}.html`), musicVolume: 0.1 });
  return P.mergeFilm(null, parts);
}
const pages = Object.fromEntries(plan.shots.map((s) => [`pip/demo-${s.n}.html`, { rate: P.FPS, path: s.path, label: s.label }]));
const deps = (over = {}) => ({ dir: '.', pageData: (f) => (over[f] ?? pages[f]), pausesFor: () => pauses, wordsFor: () => words });

test('checkFilm passes the planned film', () => {
  const r = P.checkFilm(filmOf(plan), deps());
  assert.deepEqual(r.problems.filter((x) => !/no \.vtt/.test(x)), []);
  assert.equal(r.covered, 0);
  assert.ok(r.windowFrames > 0);
  assert.ok(r.worst <= 0.3);
});

test('checkFilm catches a window moved over the shown part', () => {
  const s = plan.shots[0];
  const p0 = s.path[0];
  const html = filmOf(plan).replace(new RegExp(`(class="pip-window" style=")[^"]*(")`), `$1left: ${Math.round(p0[3])}px; top: ${Math.round(p0[4])}px; width: 300px; height: 400px$2`);
  const r = P.checkFilm(html, deps());
  assert.ok(r.covered > 0);
  assert.ok(r.problems.some((x) => /covers the shown part/.test(x)));
});

test('checkFilm catches a window off the frame, and a demo late for its word', () => {
  let html = filmOf(plan).replace(/(class="pip-window" style=")left: \d+px/, '$1left: 900px');
  let r = P.checkFilm(html, deps());
  assert.ok(r.offFrame > 0);
  const s = plan.shots[1];
  html = filmOf(plan).replace(`at="${s.at}" data-say`, `at="${P.filmTimeOf(plan.keeps, s.word) + 0.6}" data-say`);
  r = P.checkFilm(html, deps());
  assert.ok(r.problems.some((x) => /comes on 0\.\d+ s from "recipe"/.test(x)), r.problems.join('\n'));
});

test('checkFilm catches a cut outside a pause', () => {
  const html = filmOf(plan).replace(/#t=([\d.]+),([\d.]+)" at="0"/, (m, a) => `#t=${a},2.2" at="0"`);
  const r = P.checkFilm(html, deps());
  assert.ok(r.problems.some((x) => /not in a pause/.test(x)), r.problems.join('\n'));
});

test('mergeFilm keeps the person\'s own tracks', () => {
  const parts = P.filmHtml(plan, { speaker: 'assets/talk.mp4', face: '50% 30%', shotFiles: plan.shots.map((s) => `pip/demo-${s.n}.html`), music: 'assets/bed.mp3', musicVolume: 0.1 });
  const old = '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n</head>\n<body>\n<section>\n  <iframe src="title.html#t=0,2"></iframe>\n</section>\n</body>\n</html>\n';
  const merged = P.mergeFilm(old, parts);
  assert.match(merged, /title\.html/);
  assert.match(merged, /<meta name="viewport" content="width=1080, height=1920">/);
  assert.equal((merged.match(/data-pip="speaker"/g) ?? []).length, 1);
  const again = P.mergeFilm(merged, parts);
  assert.equal((again.match(/data-pip="speaker"/g) ?? []).length, 1);
  assert.equal((again.match(/title\.html/g) ?? []).length, 1);
  assert.ok(again.indexOf('title.html') < again.indexOf('data-pip="music"'), 'music stays the bottom track');
});
