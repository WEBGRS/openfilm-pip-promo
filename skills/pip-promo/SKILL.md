---
name: pip-promo
description: A vertical (or 16:9) promo for an app or product - its real screens fill the frame, each on screen as the speaker names it - with the speaker in a small window that keeps out of the way of what is shown. Use when the person gives a recording of themselves talking about their product plus screen recordings or screenshots of it, and asks for a promo, ad, lead-generation or sales video (获客视频, 带货口播, 产品推广, 小窗口播, 画中画, 录屏加口播, app 推广视频).
---

# Product promo, speaker in a window

The viewer sees the product working the moment the speaker names what it does.

## What defines it

The product owns the frame. The speaker is a small window over its real footage, never where the action is. They fill the frame twice: the opening line that
stops the scroll, and the call to action.

## What has to be true

- **The real product**, its own recordings or screenshots, readable in a feed, nothing private in any frame.
- **On the word.** Everything the speaker names that the footage can show gets a shot, on within 0.3 s of the words;
  under two seconds is a mistake. One picture never holds while the speaker names things.
- **The window covers as little as it can**: the product's detail, the subtitles, the feed's buttons. It never leaves
  the frame and moves only where a shot changes. Plan and check read the footage's frames and give the share of its
  detail under the window.
- **Their words in their order.** Ums and long pauses go, each cut in a pause measured in the sound; anything else only
  when they ask. Report every cut over two seconds with its words, and where they say what the request calls out of date.
- **Subtitles from the transcript**, never drawn in a page: the `.vtt` beside the recording is their source, and they
  read on a light screen. A shot's label names a feature in a few words, in the language of the request.
- **A cover** in a line they said, readable at feed size.

## What you have

`node <this skill's folder>/scripts/pip.mjs plan` reads `pip.json` in the film's folder and writes film.html's own
tracks (the person's other tracks stay), a page per demo shot in `pip/`, `pip/cta.html` and `pip/cover.html`:

```json
{
  "shape": "9:16",
  "speaker": { "src": "assets/talk.mp4", "face": [x, y, w, h] },
  "demos": [
    { "id": "search", "say": "search", "src": "assets/app.mp4", "from": "mark:search", "label": "Search any dish",
      "focus": [{ "t": 4.5, "rect": [x, y, w, h] }, { "say": "filter", "rect": [x, y, w, h] }] }
  ],
  "cta": { "say": "free", "logo": "assets/logo.png", "label": "Free on iPhone and Android" },
  "music": { "src": "assets/bed.mp3", "volume": 0.3 }
}
```

- `say`: the phrase that brings the shot on, the first time it is said (or `word`: a second of the recording).
- `src`: a screen recording or a screenshot. `from`: where the shot starts in it, seconds or `mark:<name>` of a take
  filmed with web-demo or app-demo.
- `focus`: where the action is, in the footage's pixels (`[x, y, w, h]` for one place), at a second (`t`) or on a
  phrase (`say`), where the camera moves. Without it a take's `.record.json` gives its clicks. Look at the footage:
  it is what the speaker talks about then.
- `face`: head and shoulders in the speaker's frame. `shape`: `9:16`, `16:9`, `1:1` or `4:5`.
  `keep: [[in, out]]` when the cuts are chosen by hand; `window: { "width": 0.34, "slot": "top-left" }`.

The transcript comes first: `npx openfilm get asr --src assets/talk.mp4` (it costs their service the recording's
length). For repeats and retakes, `node <this skill's folder>/scripts/cuts.mjs pauses assets/talk.mp4` lists
every measured pause with the words around it; cut there and give `keep`. The plan prints each cut, each shot against
its word, the window's place and the detail under it, and `!` lines. Fix them and plan again.

`node <this skill's folder>/scripts/pip.mjs check` measures the film as it is now: the window
against the shown part, the detail, the frame and the subtitles; each shot against its word; held pictures; cuts in
pauses; whether the subtitles read. `--video <render>` finds each picture change and flash in it. It must end with ✓.
Then `npx openfilm look` and read the sheet: a small caption under the window is detail the share misses.
Render with `--subtitles`. `npx openfilm look pip/cover.html 0` is the cover.

## With the person

What they ask for comes first. Ask for the recording, the footage, the viewer's next step and where it will be posted,
without waiting. When done, say briefly: length before and after, cuts over two seconds with their words,
each shot and its words, what `check` measured, and what footage would improve it.
