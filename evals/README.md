# Evals

How this skill was tried. Nothing here goes to the agent: only `skills/` is installed.

Each real request was given to an agent once with the skill and once without it, in an isolated project where the only difference was the skill's folder. The runs showed defects, the skill was changed, and each request then got one more run with the skill. All of it ran on OpenFilm 0.3.0.

| request (word for word, below) | skill | with | without | seen |
| --- | --- | --- | --- | --- |
| 1: Chinese, a phone-page recording | 0.2.1, then 0.2.2 | Six shots, each on a named thing, the speaker's window clear of the page, Chinese labels, subtitles from the transcript. Picture changes on 5 of 6 named phrases, then on 3 of 6. | A split screen with the speaker on the top 60% and the phone page under the speaker, no subtitles, no picture change on any named phrase. | The skill's films are closer to a promo. The count of named phrases moved from run to run more than any effect of the skill. |
| 2: English, a website and an old Pi video | 0.2.0, then 0.2.2 | The speaker's words kept (97.5%), the window never over the product's text, subtitles that read. Picture changes on 1 of 5 named phrases, then on 4 of 5. | A designed ad: headline, the speaker in a small circle, large product cards, captions it drew. It kept 79% of the speaker's words. | The film made without the skill is the better design. The skill's website shots are too small to read. |

## Result

On request 1 the films made with the skill are clearly closer to what was asked than the one made without it. On request 2 they are not: the film made without the skill has a stronger opening, larger and readable product screens, and a caption style of its own, and the skill's films keep more of the speaker's words and put a picture change on more of the named phrases, but their 16:9 website recordings are shown too small for text to read in a feed, and the skill's warning about that did not make the agent zoom in.

One run per arm cannot separate the skill from the agent's choices. The same skill version put a picture change on 5 of 6 named phrases in one run of request 1 and on 3 of 6 in the next, so the phrase counts below say less than the rows that follow from the skill's scripts (the window and the detail under it, the subtitles, the flashes).

What the 0.2.x changes did, against 0.1.1 and 0.1.2 on the same requests (those ran on mixed OpenFilm versions and are kept only for this):
- Edge detail under the speaker's window: 11.9% before and 0.0% after on request 1; 3.2% and 3.4% before and 0.9% and 2.7% after on request 2.
- Subtitles from the transcript, burned in and readable on light screens, in every run with the skill.
- Labels in the request's language: Chinese on request 1, where 0.1.1 wrote English.
- Not shown to help: how many named phrases get a picture change, and the size of text in wide recordings.

## How it was run

- Agent: Claude Code 2.1.310, headless, model `claude-sonnet-5-5` as each run's init event reports, `--permission-mode acceptEdits`. In each `with` run the log shows the skill being read (`Skill: webgrs-pip-promo`); the `without` runs read only OpenFilm's own page.
- OpenFilm 0.3.0, one exact copy shared by every arm. Windows 11, 2026-11-06 and 07.
- Skill versions: 0.2.0 for the first run of request 2, 0.2.1 for the first run of request 1, 0.2.2 for the re-runs of both. The harness copies the skill folder when an arm starts, and each copy was compared by checksum with the files in the repository then. Only 0.2.2 is committed; what 0.2.0 and 0.2.1 lacked is in [CHANGELOG.md](../CHANGELOG.md).
- Transcripts were supplied beside each recording, the same for both arms: faster-whisper large-v3 word times, uncorrected except for joining "Wi -Fi". No transcription service was used.
- Films were read from contact sheets and frames made with `npx openfilm look` and ffmpeg. The owner watched and listened to the films of both arms and accepted the skill (2026-11-08). They were not played on a phone.
- The requests were written before the first run and not changed. Each ran once per arm, plus one more `with` run per request after the fixes. Every run is in the tables.
- Costs are from each run's result event. Times are wall clock on a machine shared with other trials, so they say little about the skill.

## Material

The people and products are real. The speakers are conference clips recorded before any of this. The media stays on the computer it was tried on.

| request | file | what it is | licence |
| --- | --- | --- | --- |
| 1 | `talk.webm` | [James Heilman on Internet-in-a-Box](https://commons.wikimedia.org/wiki/File:Kiwix_Conference_2017_James_Heilman_Internet-in-a-box.webm), 29.5 s, by Lane Rasberry | CC BY-SA 3.0 |
| 1 | `iiab.mp4` | The live instance at iiab.me, filmed with web-demo at 390x844 from [take-iiab.json](take-iiab.json), 30 s, plain video with no record file | site's own; not published |
| 2 | `talk.webm` | [Guillaume on the Pi Box installer](https://commons.wikimedia.org/wiki/File:Kiwix_Conference_2017_Guillaume_(in_English_language).webm), 30.5 s, by Lane Rasberry | CC BY 3.0 |
| 2 | `kiwix.mp4` | get.kiwix.org's hotspot page and browse.library.kiwix.org, filmed with web-demo at 1280x720 from [take-kiwix.json](take-kiwix.json), 33.5 s, plain video | site's own; not published |
| 2 | `raspberry-pi.webm` | [Kiwix on a Raspberry Pi](https://commons.wikimedia.org/wiki/File:Kiwix_on_a_Raspberry_Pi.webm), 204 s, by Andrew Errington | CC BY 3.0 |

The project from `tools/make-sample.mjs` was not used: its presenter is drawn and voiced by a local TTS and its app is made up, so it is a test project.

## Request 1

```
我们是做 Internet-in-a-Box 的，想发一条抖音竖屏推广视频，让诊所和学校的人知道这东西。assets 里 talk.webm 是 James 对着镜头讲产品的录像（talk.vtt 是转写），iiab.mp4 是产品页面的手机录屏。帮我剪成片，渲染出 mp4。
```

| measure | with 0.2.1 | with 0.2.2 | without | earlier with 0.1.1 |
| --- | --- | --- | --- | --- |
| length | 29.2 s, one 0.36 s cut in a pause | 29.2 s, the same | 27.7 s, end trimmed | 29.2 s, the same cut |
| the speaker's words kept in order, by letters | 100% | 100% | 98.4% | |
| named phrases with a picture change within 0.3 s (scene score over 0.12) | 5 of 6 | 3 of 6 | 0 of 6 | 3 of 6 |
| the same by the local test | 6 of 6 | 4 of 6 | 0 of 6 | not measured |
| shots tied to what the speaker names | 6 | 6 | none | 4 |
| speaker | small window, 6.9% of the frame (width 0.27, set by the agent), 20.2 s | the same | top 60% of the frame for the whole film | small window, 10.5%, 19.4 s |
| speaker full frame at start / end | 2.4 s / 6.6 s | 2.4 s / 6.6 s | 0 / 0 | 3.2 s / 6.6 s |
| edge detail under the speaker's box: mean (90th percentile, maximum) | 0.0% (0.0, 0.3) | 0.0% (0.0, 0.0) | 43.4%, which is the speaker's own half of the frame | 11.9% |
| time the box sits over burned subtitles | 0 s | 0 s | 0 s | |
| subtitles | burned from the `.vtt`, contrast 7.1 (lowest 6.4), found at 3 of 4 spoken lines | burned, 7.1 (lowest 6.3), 5 of 5 | none, and it said so | burned from the `.vtt` |
| labels | Chinese | Chinese | Chinese | English |
| longest stretch with no picture change over the product | 5.9 s | 10.5 s | 16.6 s | |
| cover | made, not looked at | made, not looked at | none | made |
| cost, time | $0.29, 16.6 min | $0.38, 30.6 min | $0.27, 7.7 min | $0.22, 12.4 min |

Seen, with 0.2.1:
- Six shots of the phone recording, the window top-right and narrower than the default, which the agent chose after the plan said the page was dense. The speaker fills the frame for the first line and the closing one. Labels are Chinese, for a Chinese request.
- The recording goes blank for about 0.1 s twice, at 12.6 s and 15.0 s of the film. It is a page loading in the recording, a white flicker over the product. The plan did not say so and `check --video` was never run, which the agent told the person. Both flashes are in the frames, and `check --video` of 0.2.2 lists both.
- The subtitles sit in a grey box over the product's own text and cover some of it. They read.
- A label overlaps a few lines of page text at 15.9 s.

Seen, with 0.2.2:
- The agent ran `check --video`, which found that one shot's picture change was too light to count, and it re-rendered. Its shots start on "basically" and "connect", not on "SD card" and "Wi-Fi", so those phrases have no picture change at them. It said the recording has no picture of either.
- No flash was left in the render by the check's count. The window is over blank margin, 0.0% of the detail.

Seen, without:
- A split screen: James on top, the phone recording over the chest and the lower half. The page changes by scrolling, not on the words, and one page is held for 16.6 s.
- Chinese headline and closing line, which suit the audience. No subtitles, and it said so. It ran `look --full` and found nothing.

## Request 2

```
Here's footage for a promo of the Kiwix Hotspot (it used to be called Pi Box). In assets/: talk.webm is Guillaume talking about it to camera, with its transcript talk.vtt, kiwix.mp4 is a screen recording of the website and the content library, and raspberry-pi.webm is an older video of Kiwix running on a Raspberry Pi. Make me a vertical promo for Reels and TikTok that gets people to try it, and render it to an mp4.
```

| measure | with 0.2.0 | with 0.2.2 | without | earlier with 0.1.1 / 0.1.2 |
| --- | --- | --- | --- | --- |
| length | 30.5 s, no cuts | 30.5 s, no cuts | 26.5 s, the talk trimmed | 30.5 s, no cuts |
| the speaker's words kept in order, by letters | 97.5% | 97.5% | 79.1% | 97.5% |
| named phrases with a picture change within 0.3 s (scene score over 0.12) | 1 of 5 | 4 of 5 | 0 of 5 | 3 of 5 (0.1.1), 4 of 5 (0.1.2) |
| the same by the local test | 1 of 5 | 4 of 5 | 1 of 5 | not measured |
| product shots | 7 | 5 | about 7 screens | |
| speaker | small window, 10.4%, 20.8 s | small window, 10.2%, 20.8 s | circle, 12.6%, 23.6 s | window, 10.4% |
| speaker full frame at start / end | 3.8 s / 6.0 s | 3.8 s / 6.0 s | 0 / 0 | 3.8 s / 3.8 s and 3.8 s / 6.0 s |
| edge detail under the speaker's box: mean (90th percentile, maximum) | 0.9% (3.3, 5.5) | 2.7% (4.9, 8.3) | 1.9% (0.0, 25.2) | 3.2% (0.1.1), 3.4% (0.1.2) |
| time the box sits over burned subtitles | 0.2 s | 0 s | 0 s | |
| subtitles | burned from the `.vtt`, contrast 7.4 (lowest 7.1), 6 of 6 lines | burned, 8.7 (lowest 6.3), 6 of 6 | a caption file the agent wrote and burned in, with word highlight and a corrected "KA Lite"; the script cannot measure it | none (0.1.1), burned (0.1.2) |
| longest stretch with no picture change over the product | 4.4 s | 5.8 s | 7.7 s | |
| cost, time | $0.50, 21.7 min | $0.53, 18.1 min | $0.74, 34.5 min | $1.05, 48.3 min and $0.40, 16.1 min |

Seen, with 0.2.0:
- The plan warned that two named things came under 2 s apart. The agent answered by giving four of the seven shots a second of the recording in place of the phrase, so the shots are long enough, and four phrases sit 0.6 to 1.2 s from a picture change. The check passed, since it measures a shot against the word it was given. That is why 1 of 5 phrases changed on the word. The warning's wording is what 0.2.1 changed.
- The 16:9 website recordings take about a third of the frame's height in a vertical film and their text is too small to read, as in the earlier trials. One shot is a page with a single book on it.
- Guillaume says "Pi Box", the old name. The agent kept it, said where, and put the new name in the label.

Seen, with 0.2.2:
- Every shot keeps its phrase: "Wikimedia", "installer", "Raspberry", "hotspot", "smartphone". The plan warned that the recording goes blank at 8.4 s and at 14.7 s; the agent dropped the shot that would have shown the 14.7 s blank. The window covers 2.7% of the detail on average, 8.3% at most at one moment.
- The plan warned that the website is shown at 0.72 to 0.94 of its own pixels, which makes a 14 px line 10 to 13 px. The agent left it and told the person some page text is small. The frames agree: the website shots are unreadable at feed size. This is the open defect.
- The cover line was changed to "A Raspberry Pi with content on it"; the agent said the default first line, "Hello, I'm Guillaume", sells nothing. The last 6 s are only the speaker.

Seen, without:
- The strongest opening of the arms: a headline, "No internet? Take Wikipedia anyway", with a "formerly Pi Box" tag while the old name is said. Product screens are large and readable, in cards with the speaker in a small circle.
- It cut the talk to 23 s and kept 79% of the speaker's words. It changed "Kalyte" to "KA Lite" in the captions by guess. It burned in a corrected caption file, `captions.vtt`, with word highlight. The mix is about -11 LUFS and it said so.

## Measures

The same scripts ran on each arm's finished film, whichever arm made it.

1. `node prepare.mjs <run-dir> [--c-is-delivered]` makes, in `<run-dir>/_m`, the delivered film, the project rendered with subtitles (`c.mp4`, or the delivered film itself with `--c-is-delivered`), the same render with the speaker hidden (`b.mp4`), and the project rendered without `--subtitles` (`n.mp4`). `<run-dir>/work` is the project, or a folder holding it.
2. A word-timed transcript of the delivered mp4 as `_m/delivered.vtt`: `npx openfilm get asr`, or Whisper with word timestamps.
3. `python measure.py <run-dir>/_m r1|r2 <talk.vtt>` needs ffmpeg, numpy and opencv-python. [phrases.json](phrases.json) lists the named phrases, written before the first run.

What it reports:
- Words kept in order: the supplied transcript against the delivered one, by letters.
- Named phrases with a picture change within 0.3 s, by ffmpeg's scene score over 0.12 as in the earlier trials, which misses a cut between two light pages, and by a local test: a change over 0.05 and three times the usual change in the second around it.
- The speaker's box: the difference between the delivered render and the render with the speaker hidden. Edge detail under it is the share of the hidden render's Canny edges that are inside the box, sampled five times a second, with its mean, 90th percentile and maximum.
- Time with the speaker full frame at the start and the end, the longest stretch with no picture change while the product is on screen, and the time the box sits over burned subtitles.
- Subtitles burned by the delivery render: the contrast between the block they changed and its brightest 1% of pixels, a ratio like WCAG's, at the middle of each spoken line. A first version of this read 2.1 for a box the style says is 6.2, so it was fixed against a frame before any number here was taken; the box's own pixels made the old version's "bright" end wrong. Subtitles drawn in a page, or a caption track, cannot be told apart this way and are read from frames.

The `with` skill's own check (`pip.mjs check`) reports the same detail share from the footage's frames, before any render, and the two agree to within a point or two on the same film: on the first request's old plan it gave 10.2% where this script gave 11.9%.

What the measures cannot see: whether a small caption under the box matters, how large the text is on a phone, and whether the film is good to watch. Those came from the frames.

## Not tried

- Playing the films in Studio or on a phone.
- A person filming the recordings, screenshots in place of recordings, or takes with a `.record.json`.
- Studio opening the project, which makes a caption track from `.film/subtitles.json`.
- The demo shots' video drawn as a clip with CSS animation instead of a page, which 0.3.0 allows. Render times here were taken on a busy machine and cannot say whether it would be faster.
- A speaker talking in Chinese, and any speaker other than these two.
