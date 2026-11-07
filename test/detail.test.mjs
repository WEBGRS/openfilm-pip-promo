// What the window covers of the product's picture, subtitles that read, pictures that change on the word, and long holds
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../skills/pip-promo/scripts/pip.mjs';

const V = [1080, 1920];
const w = (list) => list.map(([text, s, e]) => ({ w: text, s, e }));

// Edge maps of made-up footage: edges only inside the given boxes (map px)
function fakeDetail(src, boxes, { mw = 60, mh = 120, frames = 3 } = {}) {
  const map = new Uint8Array(mw * mh);
  for (const [x0, y0, x1, y1] of boxes) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) map[y * mw + x] = 1;
  const ii = P.integral(map, mw, mh);
  return P.makeDetail({ w: mw, h: mh, src, frames: Array.from({ length: frames }, () => ({ ii })) });
}

test('edge maps find a bar of contrast and nothing in a flat picture', () => {
  const w0 = 20, h0 = 20, flat = new Uint8Array(w0 * h0).fill(120);
  assert.equal(P.edgeMap(flat, w0, h0).reduce((a, b) => a + b, 0), 0);
  const bar = new Uint8Array(w0 * h0).fill(255);
  for (let y = 0; y < h0; y++) for (let x = 10; x < w0; x++) bar[y * w0 + x] = 0;
  const e = P.edgeMap(bar, w0, h0);
  assert.ok(e.reduce((a, b) => a + b, 0) >= 2 * (h0 - 2), 'the edge runs the picture\'s height');
  assert.equal(e[5 * w0 + 3], 0);
});

test('the share of detail under a rect follows where the detail is', () => {
  const src = { w: 780, h: 1688 };
  // All the detail in the top third of the footage
  const det = fakeDetail(src, [[0, 0, 60, 40]]);
  const cam = [1.38, 0, 0];
  const top = P.rect(0, 0, 540, 600), low = P.rect(0, 1200, 540, 600);
  const a = det.at(0, cam, top, V), b = det.at(0, cam, low, V);
  assert.ok(a.covered > 0 && a.covered / a.visible > 0.2, JSON.stringify(a));
  assert.equal(b.covered, 0);
  const path = Array.from({ length: 60 }, () => [1.38, 0, 0, 0, 0, 780, 600]);
  assert.ok(P.coverage(det, path, V, top).mean > 0.2);
  assert.equal(P.coverage(det, path, V, low).mean, 0);
});

test('the window goes where the footage has least on it', () => {
  const band = P.subtitleBand(V);
  const slots = P.windowSlots(V, band);
  const src = { w: 780, h: 1688 };
  const keys = [{ t: 0, r: P.rect(0, 400, 780, 700) }];
  // Busy at the top of the page, bare lower down
  const busy = fakeDetail(src, [[0, 0, 60, 50]]);
  const placed = P.placeShot({ src, keys, len: 3, detail: busy }, V, band, slots, 'top-right');
  assert.ok(placed.cover.mean < 0.03, JSON.stringify(placed.cover));
  const blind = P.placeShot({ src, keys, len: 3 }, V, band, slots, 'top-right');
  assert.equal(blind.cover, null);
});

test('no slot sits on the right edge below the top of a vertical frame, where a feed puts its buttons', () => {
  const slots = P.windowSlots(V, P.subtitleBand(V));
  assert.ok(slots.some((s) => s.name === 'top-right'));
  assert.ok(!slots.some((s) => /right/.test(s.name) && s.rect.y > 400));
});

test('colors parse and contrast follows the WCAG ratio', () => {
  assert.deepEqual(P.parseColor('#fff'), [255, 255, 255, 1]);
  assert.deepEqual(P.parseColor('rgba(0, 0, 0, 0.62)'), [0, 0, 0, 0.62]);
  assert.equal(P.parseColor('red'), null);
  assert.ok(Math.abs(P.contrast([255, 255, 255], [0, 0, 0]) - 21) < 0.01);
});

test('white words need a box or an outline to read on a white page', () => {
  assert.ok(P.subtitleContrast({ fill: '#ffffff', box: null, stroke: null }).ratio < 1.5);
  assert.ok(P.subtitleContrast(P.styleOf({ look: 'bar' })).ratio >= 4.5);
  assert.ok(P.subtitleContrast(P.styleOf({ look: 'outline' })).ratio >= 4.5);
  assert.equal(P.styleOf({ look: 'something-new' }), null);
  assert.equal(P.subtitleContrast(P.styleOf({ look: 'bar', box: { color: '#000000', opacity: 0.1 } })).page, 'white');
});

const VTT = (css, region = 'viewportanchor:50%,30%') => `WEBVTT\n\nREGION\nid:main\nwidth:90%\nlines:3\nregionanchor:50%,100%\n${region}\n\nSTYLE\n${css}\n\nc1\n00:00:00.000 --> 00:00:02.000 region:main\nHello\n`;

test('a caption track says where its cues sit and how they look', () => {
  const look = P.captionLook(VTT('::cue { font: 600 4cqmin/1.45 sans-serif; color: #ffffff; background: rgba(0, 0, 0, 0.62); padding: 0.12em 0.4em; }'));
  assert.equal(look.y, 0.3);
  assert.equal(look.size, 4);
  assert.deepEqual(look.style.box, { color: 'rgb(0,0,0)', opacity: 0.62 });
  assert.ok(P.subtitleContrast(look.style).ratio >= 4.5);
  assert.equal(P.captionLook('WEBVTT\n\n00:00.000 --> 00:01.000\nHi\n').style, null);
});

// A planned film for the check
const media = { 'assets/app.mp4': { w: 780, h: 1688, duration: 20 } };
const said = (text, s, e) => { const ws = text.split(' '); const d = (e - s) / ws.length; return ws.map((x, i) => [x, s + i * d, s + (i + 1) * d]); };
const words = w([...said('Meet Pantry.', 0.5, 1.3), ...said('Search any dish and see what you can cook tonight.', 2, 5), ...said('Tap a recipe for every amount you need to buy.', 6, 9), ...said('Try it free.', 11, 12)]);
const cues = [{ s: 0.5, e: 1.3, text: 'Meet Pantry.' }, { s: 2, e: 5, text: '…' }, { s: 6, e: 9, text: '…' }, { s: 11, e: 12, text: 'Try it free.' }];
const pauses = [[0, 0.5], [1.3, 2], [5, 6], [9, 11], [12, 12.5]];
const cfg = { shape: '9:16', speaker: { src: 'assets/talk.mp4' }, demos: [{ id: 'search', say: 'search', src: 'assets/app.mp4', from: 0, focus: [0, 400, 780, 700] }, { id: 'recipe', say: 'recipe', src: 'assets/app.mp4', from: 5, focus: [0, 400, 780, 700] }], cta: { say: 'try it' } };
const busyTop = (src) => fakeDetail(src, [[0, 0, 60, 50]]);
const plan = P.makePlan(cfg, { words, cues, pauses, duration: 12.5, media, records: {}, detail: (_src, size) => busyTop(size) });
const filmOf = (p) => P.mergeFilm(null, P.filmHtml(p, { speaker: 'assets/talk.mp4', face: '50% 30%', shotFiles: p.shots.map((s) => `pip/demo-${s.n}.html`), musicVolume: 0.1 }));
const pages = Object.fromEntries(plan.shots.map((s) => [`pip/demo-${s.n}.html`, { rate: P.FPS, path: s.path, label: s.label, src: 'assets/app.mp4', from: s.from, len: s.len, size: s.size }]));
const deps = (over = {}) => ({ dir: '.', pageData: (f) => pages[f], pausesFor: () => pauses, wordsFor: () => words, detailFor: (d) => busyTop({ w: d.size[0], h: d.size[1] }), ...over });
const noVtt = (r) => r.problems.filter((x) => !/no \.vtt/.test(x));

test('plan measures what the window covers and keeps it off the busy part', () => {
  for (const s of plan.shots) assert.ok(s.cover.mean < 0.05, JSON.stringify(s.cover));
});

test('check reports the share of detail under the window and passes a planned film', () => {
  const r = P.checkFilm(filmOf(plan), deps());
  assert.deepEqual(noVtt(r), []);
  assert.ok(r.lines.some((x) => /window over \d+(\.\d+)?% of its detail/.test(x)), r.lines.join('\n'));
});

test('check fails a window left over the busy part where another place is bare, and says where', () => {
  const html = filmOf(plan).replace(/(class="pip-window" style=")[^"]*"/g, '$1left: 40px; top: 150px; width: 367px; height: 489px"');
  const r = P.checkFilm(html, deps());
  assert.ok(r.problems.some((x) => /covers \d+(\.\d+)?% of the footage's detail where (top|mid)-\w+ covers/.test(x)), r.problems.join('\n'));
});

test('a dense screen no place can spare is a note, not a failure', () => {
  const dense = fakeDetail({ w: 780, h: 1688 }, [[0, 0, 60, 120]]);
  const r = P.checkFilm(filmOf(plan), deps({ detailFor: () => dense }));
  assert.deepEqual(noVtt(r), []);
  assert.ok(r.lines.some((x) => /^! .*dense screen/.test(x)), r.lines.join('\n'));
});

test('check measures subtitles against a caption track\'s own style and band', () => {
  const add = `<section><track kind="captions" src="captions/talk.vtt"></section>`;
  const html = filmOf(plan).replace('</section>', `</section>\n${add}`);
  const white = VTT('::cue { font: 600 4cqmin/1.45 sans-serif; color: #ffffff; background: none; }');
  let r = P.checkFilm(html, deps({ captionFor: () => white }));
  assert.ok(r.problems.some((x) => /subtitles would not read on a white screen/.test(x)), r.problems.join('\n'));
  const boxed = VTT('::cue { font: 600 4cqmin/1.45 sans-serif; color: #ffffff; background: rgba(0,0,0,0.7); }');
  r = P.checkFilm(html, deps({ captionFor: () => boxed }));
  assert.deepEqual(noVtt(r), []);
  assert.ok(r.lines.some((x) => /^subtitles: \d/.test(x)));
});

test('check with a project style: white words with no box fail, the boxed look passes', () => {
  let r = P.checkFilm(filmOf(plan), deps({ style: { fill: '#ffffff', box: null, stroke: null } }));
  assert.ok(r.problems.some((x) => /would not read/.test(x)));
  r = P.checkFilm(filmOf(plan), deps({ style: { look: 'bar' } }));
  assert.deepEqual(noVtt(r), []);
});

test('a cut between two light pages counts as a picture change when it stands out from its frames', () => {
  const calm = (t0, t1, s = 0.004) => Array.from({ length: Math.round((t1 - t0) * 30) }, (_, i) => ({ t: t0 + i / 30, s }));
  const scores = [...calm(0, 5), { t: 5.1, s: 0.083 }, ...calm(5.133, 10)];
  const hit = P.changeNear(scores, 5.2);
  assert.equal(hit.landed, true);
  assert.ok(Math.abs(hit.t - 5.1) < 1e-9);
  const small = [...calm(0, 5), { t: 5.1, s: 0.02 }, ...calm(5.133, 10)];
  assert.equal(P.changeNear(small, 5.2).landed, false);
  const noisy = [...calm(0, 10, 0.06), { t: 5.1, s: 0.09 }];
  assert.equal(P.changeNear(noisy, 5.2).landed, false, 'a scrolling page scores high all the time');
});

test('camera moves split a shot into the stretches that hold one picture', () => {
  const still = Array.from({ length: 150 }, () => [1, 0, 0, 100, 100, 400, 400]);
  assert.deepEqual(P.cameraMoves(still), []);
  const moved = still.map((p, f) => (f < 60 ? p : f < 84 ? [1, 0, 0, 100, 100 + (f - 60) * 30, 400, 400] : [1, 0, 0, 100, 820, 400, 400]));
  const mv = P.cameraMoves(moved);
  assert.equal(mv.length, 1);
  const holds = P.holdsOf(10, 5, moved);
  assert.equal(holds.length, 2);
  assert.ok(holds[0].b - holds[0].a < 3 && holds[1].b - holds[1].a < 3);
});

test('plan says what the speaker names while one picture holds, and a focus can move the camera on a phrase', () => {
  const longCfg = { ...cfg, demos: [{ id: 'search', say: 'search', src: 'assets/app.mp4', from: 0, focus: [0, 400, 780, 700] }], cta: { say: 'try it' } };
  const p = P.makePlan(longCfg, { words, cues, pauses, duration: 12.5, media, records: {} });
  assert.ok(p.warnings.some((x) => /demo search holds one picture for [\d.]+ s .* while the speaker says ".*recipe/.test(x)), p.warnings.join('\n'));
  const moved = P.makePlan({ ...longCfg, demos: [{ ...longCfg.demos[0], focus: [{ t: 0, rect: [0, 100, 780, 500] }, { say: 'recipe', rect: [0, 1000, 780, 500] }] }] }, { words, cues, pauses, duration: 12.5, media, records: {} });
  assert.ok(!moved.warnings.some((x) => /holds one picture/.test(x)), moved.warnings.join('\n'));
  const unsaid = P.makePlan({ ...longCfg, demos: [{ ...longCfg.demos[0], focus: [{ t: 0, rect: [0, 100, 780, 500] }, { say: 'export', rect: [0, 1000, 780, 500] }] }] }, { words, cues, pauses, duration: 12.5, media, records: {} });
  assert.ok(unsaid.warnings.some((x) => /focus says "export" but it is not said/.test(x)));
});

test('check refuses one picture held for more than eight seconds', () => {
  const long = { ...cfg, cut: false, demos: [{ id: 'search', say: 'search', src: 'assets/app.mp4', from: 0, focus: [0, 500, 780, 300] }] };
  const p = P.makePlan(long, { words: w([...said('Search it now.', 1, 3), ...said('Try it free.', 14, 15)]), cues: [{ s: 1, e: 3, text: 'x' }, { s: 14, e: 15, text: 'Try it free.' }], pauses: [[0, 1], [3, 14], [15, 15.5]], duration: 15.5, media, records: {}, detail: null });
  const only = Object.fromEntries(p.shots.map((s) => [`pip/demo-${s.n}.html`, { rate: P.FPS, path: s.path, label: s.label }]));
  const r = P.checkFilm(filmOf(p), { dir: '.', pageData: (f) => only[f], pausesFor: () => [[0, 1], [3, 14], [15, 15.5]], wordsFor: () => [] });
  assert.ok(r.problems.some((x) => /holds one picture for [\d.]+ s/.test(x)), r.problems.join('\n'));
});

test('wide footage shown smaller than it was filmed is told its text will not read', () => {
  const wide = { 'assets/site.mp4': { w: 1280, h: 720, duration: 20 } };
  const c = { shape: '9:16', speaker: { src: 'assets/talk.mp4' }, demos: [{ id: 'site', say: 'search', src: 'assets/site.mp4', from: 0, focus: [0, 100, 1280, 520] }], cta: { say: 'try it' } };
  const p = P.makePlan(c, { words, cues, pauses, duration: 12.5, media: wide, records: {} });
  assert.ok(p.warnings.some((x) => /demo site: its footage is shown at 0\.\d+x of its own pixels/.test(x)), p.warnings.join('\n'));
  const tight = P.makePlan({ ...c, demos: [{ ...c.demos[0], focus: [300, 150, 400, 200] }] }, { words, cues, pauses, duration: 12.5, media: wide, records: {} });
  assert.ok(!tight.warnings.some((x) => /shown at/.test(x)), tight.warnings.join('\n'));
  const phone = P.makePlan(cfg, { words, cues, pauses, duration: 12.5, media, records: {} });
  assert.ok(!phone.warnings.some((x) => /shown at/.test(x)), 'a phone recording is not wide');
});

test('a shot under two seconds is told to leave out or move the camera on the word, not to move its say', () => {
  const close = { ...cfg, demos: [{ id: 'a', say: 'search', src: 'assets/app.mp4', from: 0, focus: [0, 500, 780, 300] }, { id: 'b', say: 'dish', src: 'assets/app.mp4', from: 5, focus: [0, 500, 780, 300] }] };
  const p = P.makePlan(close, { words, cues, pauses, duration: 12.5, media, records: {} });
  assert.ok(p.warnings.some((x) => /demo \w is on screen [\d.]+ s, under 2 s: leave it out/.test(x) && /"say":/.test(x)), p.warnings.join('\n'));
});

test('a shot whose footage goes blank is told when, and a page that is plain throughout is not', () => {
  const src = { w: 780, h: 1688 };
  const mw = 60, mh = 120, full = P.integral(new Uint8Array(mw * mh).fill(1), mw, mh);
  const frames = Array(8).fill({ ii: full });
  const flashing = P.makeDetail({ w: mw, h: mh, src, frames, blanks: [{ t: 1.5, secs: 0.1 }, { t: 3.2, secs: 0.2 }] });
  const p = P.makePlan(cfg, { words, cues, pauses, duration: 12.5, media, records: {}, detail: () => flashing });
  assert.ok(p.warnings.some((x) => /demo search: its footage goes blank at 1\.5 s and 1 more times \(0\.1 s, a page loading\)/.test(x)), p.warnings.join('\n'));
  const solid = P.makeDetail({ w: mw, h: mh, src, frames });
  assert.ok(!P.makePlan(cfg, { words, cues, pauses, duration: 12.5, media, records: {}, detail: () => solid }).warnings.some((x) => /goes blank/.test(x)));
});

test('a change and a change back within a quarter second is a flash, a cut at a shot start is not', () => {
  const calm = (t0, t1) => Array.from({ length: Math.round((t1 - t0) * 30) }, (_, i) => ({ t: t0 + i / 30, s: 0.003 }));
  const scores = [...calm(0, 5), { t: 5, s: 0.064 }, ...calm(5.033, 5.1), { t: 5.133, s: 0.185 }, ...calm(5.166, 9), { t: 9, s: 0.3 }, { t: 9.033, s: 0.2 }, ...calm(9.066, 12)];
  const f = P.flashes(scores, [9, 0]);
  assert.equal(f.length, 1);
  assert.ok(Math.abs(f[0].t - 5) < 0.001 && f[0].secs < 0.2);
  assert.equal(P.flashes(calm(0, 5), []).length, 0);
});

test('blank spans come from frames with far fewer edges than the usual one', () => {
  const totals = [5000, 5100, 5000, 100, 5000, 5000, 80, 90, 5000];
  assert.deepEqual(P.blankSpans(totals), [{ t: 0.3, secs: 0.1 }, { t: 0.6, secs: 0.2 }]);
  assert.deepEqual(P.blankSpans([10, 12, 9, 11]), [], 'footage that is plain throughout has no blank moments');
});
