# Evals

How this skill was tried. Nothing here goes to the agent: only `skills/` is installed.

Two real requests, each run once with the skill and once without, in an isolated project. The only difference between arms was the skill's folder. One request found a defect, which was fixed, and that request was run again with the skill.

- Skill versions: 0.1.1, and 0.1.2 for the re-run.
- Agent: Claude Code 2.1.310, headless. Model `claude-sonnet-5-5`, as reported by each run's init event.
- OpenFilm 0.2.7 installed. Windows 11. 2026-11-06. The agent's OpenFilm instructions say `npx -y openfilm@latest`, which was 0.3.0 once it came out that day. Without the skill on request 1, the agent ran `look` and `render` through it. On request 2, both arms read the 0.3.0 manual through it. The other runs used 0.2.7.
- Transcripts were supplied beside each recording, the same for both arms: faster-whisper large-v3 word times, uncorrected except for joining "Wi -Fi". No transcription service was used.
- Films were read from contact sheets and frames, with `npx openfilm look` and ffmpeg. They were not played in Studio.

## Material

The people and products are real. The speakers were recorded as conference clips, before any of this. The media stays on the computer it was tried on.

| request | file | what it is | licence |
| --- | --- | --- | --- |
| 1 | `talk.webm` | [James Heilman on Internet-in-a-Box](https://commons.wikimedia.org/wiki/File:Kiwix_Conference_2017_James_Heilman_Internet-in-a-box.webm), 29.5 s, by Lane Rasberry | CC BY-SA 3.0 |
| 1 | `iiab.mp4` | The live instance at iiab.me, filmed with web-demo at 390x844 from [take-iiab.json](take-iiab.json), 30 s, plain video with no record file | site's own; not published |
| 2 | `talk.webm` | [Guillaume on the Pi Box installer](https://commons.wikimedia.org/wiki/File:Kiwix_Conference_2017_Guillaume_(in_English_language).webm), 30.5 s, by Lane Rasberry | CC BY 3.0 |
| 2 | `kiwix.mp4` | get.kiwix.org's hotspot page and browse.library.kiwix.org, filmed with web-demo at 1280x720 from [take-kiwix.json](take-kiwix.json), 33.5 s, plain video | site's own; not published |
| 2 | `raspberry-pi.webm` | [Kiwix on a Raspberry Pi](https://commons.wikimedia.org/wiki/File:Kiwix_on_a_Raspberry_Pi.webm), 204 s, by Andrew Errington | CC BY 3.0 |

The project from `tools/make-sample.mjs` was not used. Its presenter is drawn and voiced by a local TTS, its app is a made-up one in `tools/sample/app`, and its music is an ffmpeg sine chord, so it is a test project.

## Request 1

```
我们是做 Internet-in-a-Box 的，想发一条抖音竖屏推广视频，让诊所和学校的人知道这东西。assets 里 talk.webm 是 James 对着镜头讲产品的录像（talk.vtt 是转写），iiab.mp4 是产品页面的手机录屏。帮我剪成片，渲染出 mp4。
```

| measure | with 0.1.1 | without |
| --- | --- | --- |
| length | 29.2 s, one 0.36 s cut in a pause | 28.5 s, end trimmed |
| named phrases with a picture change within 0.3 s | 3 of 6 | 1 of 6 |
| speaker layout | small window, 10.5% of the frame, 19.4 s | top half, 48.5% of the frame, 28.6 s |
| speaker full frame at start / end | 3.2 s / 6.6 s | 0 s / 0 s |
| product detail under the speaker | 11.9% of its edge pixels | none: the speaker has its own half (the script prints 6.1%, which is the label and bar in that half, read from a frame) |
| window moves away from a shot change | 0 | 0 |
| subtitles in the mp4 | yes, from the `.vtt` | none |
| cover | yes | none |
| cost, time | $0.22, 12.4 min | $0.30, 6.6 min |

Seen, with:
- The format the skill asks for: the speaker opens and closes full frame, with four product shots between.
- `pip.mjs check` measured 0 frames of the window over the shown part, but the frames show it over page headings in all four shots ("Typical School tea…", "Reference Materia…", the Malaria picture). The agent gave every shot the same `focus`, `[0, 800, 780, 600]`, and the check only knows `focus`. The window's 11.9% of the edges on 10.5% of the area means its corner was no emptier than the rest of the picture.
- The labels sit over page titles too.
- The phone recording fills about 70% of the frame's width, and the bottom fifth of the frame is empty.
- Labels are in English for a Chinese request.
- `check --video` ended with ✗ on the second shot, and the agent said so and left it. The shot is on time in film.html (9.26 s) and the sheet shows it changed. The cut is from one light list page to another, with a scene score of 0.083 against the check's threshold of 0.12. A change inside the footage just before it scores 0.118, so the threshold cannot simply come down.

Seen, without:
- A static split: James on top, the recording running through underneath in its own order, not tied to his words.
- Chinese labels and a Chinese end line written by the agent, which suit the audience.
- It found and cut a flash in the recording at 7.13 s, a page-load state with a "Power Off" header. The frame confirms it.
- It told the person it left subtitles out.

## Request 2

```
Here's footage for a promo of the Kiwix Hotspot (it used to be called Pi Box). In assets/: talk.webm is Guillaume talking about it to camera, with its transcript talk.vtt, kiwix.mp4 is a screen recording of the website and the content library, and raspberry-pi.webm is an older video of Kiwix running on a Raspberry Pi. Make me a vertical promo for Reels and TikTok that gets people to try it, and render it to an mp4.
```

| measure | with 0.1.1 | with 0.1.2 | without |
| --- | --- | --- | --- |
| length | 30.5 s, no cuts | 30.5 s, no cuts | 18 s, 13.7 s of it speech |
| his words kept in order, by letters | 97.5% | 97.5% | 52.9% |
| named phrases with a picture change within 0.3 s | 3 of 5 | 4 of 5 | 0 of 5 |
| speaker layout | small window, 10.4%, 23 s | small window, 10.4%, 20.8 s | full frame for 13.8 s, product cards over the lower half |
| speaker full frame at start / end | 3.8 s / 3.8 s | 3.8 s / 6 s | 13.8 s from the start, then a 4.2 s end card |
| product detail under the speaker | 3.2% of its edge pixels | 3.4% | not measured, as the cards sit over the speaker |
| product shots under 2 s | 0 | 0 | not measured, no window to detect |
| subtitles in the mp4 | none | yes, from the `.vtt` | drawn in a page |
| cover | yes | yes | none |
| cost, time | $1.05, 48.3 min | $0.40, 16.1 min | $0.71, 6.2 min |

The skill asks for the speaker's words in order, so the kept-words row favours it. The without agent cut the opening on purpose, so that the old name "Pi Box" is never heard, and it said so. One of its phrase misses is Whisper's: "hotspot" is in its audio and caption, and the transcript of its film dropped the word.

Seen, with 0.1.1:
- A plain `render` left the mp4 with no subtitles, and the agent said it had not checked them. The brief did not mention `--subtitles`. This is the defect fixed in 0.1.2, and the re-run rendered with it.
- The window covers part of the "4Gb micro SD" caption in the Raspberry Pi clip, while `check` ends with ✓.

Seen, with 0.1.2:
- The 16:9 recordings take 30 to 45% of the frame's height in a vertical film, with empty background above and below, and some run off the frame's edge. The "Join from any phone" shot is body text too small to read at feed size.
- The first shot opens on a library page with one book on it.
- The opening is his own "Hello, I'm Guillaume", as the skill keeps his words and order.
- "Pi Box" is still heard and in the subtitles, although the request says the name changed. The labels say Kiwix Hotspot.
- `look` reported that the same t drew two pictures at 12.725 s, in two runs on a busy machine. One was a late frame of the recording, as if a seek had not finished. The mp4 shows no stray picture change at that point.

Seen, without:
- The strongest opening of the three: a headline, "NO INTERNET? Kiwix Hotspot shares Wikipedia anyway".
- The product cards cover his chin and mouth while he talks, and the product never has the frame.
- It changed "Kalyte" to "Kolibri" in the captions, a guess. He said KA Lite.
- The captions are drawn in a page because it took the subtitle track to be unsupported.

## Measures

The same scripts ran on each arm's finished film, independent of what made it:

1. `prepare.mjs <run-dir> [film.mp4] [--c-is-delivered]` renders the film with subtitles and again with the talk hidden. `<run-dir>/work` is the project, or a folder holding it.
2. A word-timed transcript of the finished mp4, as `_m/delivered.vtt`: `npx openfilm get asr` or Whisper with word timestamps.
3. `python measure.py <run-dir>/_m r1|r2 <talk.vtt>` needs ffmpeg, numpy and opencv-python. [phrases.json](phrases.json) lists the named phrases, written before the first run.

The difference between the two renders is the speaker, so its box is measured from pixels. Edge pixels are Canny edges of the picture with the speaker hidden.

The picture-change count uses ffmpeg's scene score at 0.12, the same threshold as `pip.mjs check --video`. It misses cuts between similar pages and also counts changes inside the footage, so 3 of 6 and 4 of 5 understate the with arm. Times include rendering on a machine busy with other trials. The numbers above are as measured, without corrections. Each request ran once per version.

## On OpenFilm 0.3.0

After the trials, a copy of a finished trial project was run on the released OpenFilm 0.3.0 (Windows 11, 2026-11-06), without an agent and not in Studio.

- `look` passed. A 4 s `render` and `render --subtitles` both came out, and the second showed the project's boxed subtitles.
- A caption track written into the film was drawn by a plain render. `check` now accepts one and does not measure where its cues sit. A rebuild keeps the track above the pip tracks.
