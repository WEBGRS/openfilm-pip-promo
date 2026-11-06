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

- **The real product**, its own recordings or screenshots, nothing private in any frame.
- **On the word.** Each demo shot comes on within 0.3 s of the words that name it and stays until the next one is
  named; a shot under two seconds is a mistake. The view moves in gently on what is talked about.
- **The window never covers what is shown**, the subtitles or the feed's buttons, never leaves the frame, and moves
  only where a shot changes.
- **Their words in their order.** Ums and long pauses go, each cut in a pause measured in the sound; anything else only
  when they ask. Report every cut over two seconds with its words.
- **Subtitles from the transcript**, never drawn in a page: the `.vtt` beside the recording is what Studio turns into
  subtitles. A shot's label names a feature in a few words, never the speaker's sentence.
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
      "focus": [{ "t": 4.5, "rect": [x, y, w, h] }] }
  ],
  "cta": { "say": "free", "logo": "assets/logo.png", "label": "Free on iPhone and Android" },
  "music": { "src": "assets/bed.mp3", "volume": 0.3 }
}
```

- `say`: the phrase that brings the shot on, the first time it is said (or `word`: a second of the recording).
- `src`: a screen recording or a screenshot. `from`: where the shot starts in it, seconds or `mark:<name>` of a take
  filmed with web-demo or app-demo.
- `focus`: where the action is, in the footage's pixels and seconds (`[x, y, w, h]` for one place). Without it a
  take's `.record.json` gives its clicks; with neither, the window keeps off the middle. The focus is what the speaker
  talks about then, not only what is clicked: look at the footage.
- `face`: head and shoulders in the speaker's frame, for the 3:4 window. `shape`: `9:16`, `16:9`, `1:1` or `4:5`.
  `keep: [[in, out]]` when the cuts are chosen by hand; `window: { "width": 0.34, "slot": "top-left" }`.

The transcript comes first: `npx openfilm get asr --src assets/talk.mp4` (it costs their service the recording's
length). For repeats and retakes, `node <this skill's folder>/scripts/cuts.mjs pauses assets/talk.mp4` lists
every measured pause with the words around it; cut there and give `keep`. The plan prints each cut, each shot against
its word, the window's place, and `!` lines: footage too short for its words, a feature named too soon after the last,
a phrase never said. Fix them and plan again.

`node <this skill's folder>/scripts/pip.mjs check` measures the film as it is now, after anyone's edits: frames where
the window covers the shown part, leaves the frame, sits on the subtitles or floats over nothing; each shot against
its word; cuts in pauses; subtitles from the `.vtt`. `--video <render>` also times the picture changes. It must end
with ✓. Then `npx openfilm look` and read the sheet: the plan only keeps the window off what `focus` says. A project
with no subtitle style gets Studio's boxed look ("bar"); light screens swallow white words. `npx openfilm look pip/cover.html 0` is the cover.

## With the person

What they ask for comes first. The recording, the product footage, the viewer's next step, where it
will be posted. Ask without holding up the work. When
done, say briefly: the length before and after, cuts over two seconds with their words, each shot and the words
it sits on, what `check` measured, and what footage would make it better.
