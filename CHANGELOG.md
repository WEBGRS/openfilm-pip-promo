# Changelog

## 0.2.2

- `plan` reads the footage a second time at 10 frames a second and says where it goes blank (a page loading), with the
  second in the footage and what to do. In the first trial's film two such flashes, 0.1 and 0.13 s long, showed in
  frames; the detail read, one frame in 0.75 s, had missed them.
- `check --video` reports a change and a change back within a quarter second (away from where a shot starts) as a flash,
  with its time.
- `check` without `--video` ends by saying to render with `--subtitles` and run `check --video` on the result: in the
  first trial the agent did not run it, and said so.

## 0.2.1

- `plan` and `check` say when wide footage (900 px or more) is shown at less than its own pixels, which puts its small
  text under what a feed can read, and what a 14 px line becomes on the frame. In the second trial the 16:9 website
  recordings in a vertical film were shown at 0.73 to 0.84x.
- A shot under two seconds is told to leave it out or to move the camera on the word in the shot before it, not to
  move its `say`: in the second trial the agent moved four `say`s to seconds that were not the named words to make the
  shots long enough, and picture changes on the named phrases fell from 4 of 5 to 1 of 5.
- The brief says the footage is readable in a feed.

## 0.2.0

- The window avoids the product's detail, not only what `focus` declares. `plan` and `check` read the footage's own
  frames (edges, through ffmpeg) and print the share of detail under the window for each shot. `plan` tries the window
  slots and a slightly smaller product against that share. On the first trial's footage, the old plan left the window
  over 10.2% of a phone page's detail on average, and the new one 4.6%. `check` fails a window that covers clearly more
  than another place would, and says where; a dense screen no place can spare is a note, with the two things left to do.
- No window slot on the right edge below the top of a vertical frame, where a feed puts its buttons.
- Labels sit over the least detail, not the first free spot.
- `plan` prints the words said while one picture holds for over 6 s (`check` fails over 8 s), so a thing named in that
  stretch can get its own shot. A `focus` entry may name a `say` phrase to move the camera on the word.
- `plan` warns when a shot's footage opens on a nearly empty screen and names a later `from`.
- `check --video` no longer fails a cut between two light pages: a change counts when it is over 0.05 and three times
  the usual change between the frames around it.
- `check` reads the project's subtitle position and a caption track's own region and style: the window is checked
  against where the cues sit, and the subtitles' contrast on a white page is measured. White words with no box or
  outline fail.
- The brief asks for a shot for everything the speaker names, labels in the request's language, and a note of where
  the speaker says what the request calls out of date.

## 0.1.2

- The brief says to render with `--subtitles`: in a trial a plain render gave an mp4 with none.
- OpenFilm 0.3.0: `check` accepts a caption track, and a rebuild keeps one above the pip tracks, where it stays visible.

## 0.1.1

- `needs` in `openfilm.json`: FFmpeg and a transcription service.
- `evals/README.md`: the requests it was tried on, with and without it.

## 0.1.0

- First version.
