# Same measure for both arms. Run after prepare.mjs and words.py.
#   python measure.py <m-dir> <r1|r2> <source.vtt>
# <m-dir> holds delivered.mp4, delivered.vtt, c.mp4 (film as made, subtitles on), b.mp4 (same, talk hidden),
# n.mp4 (film as made, no --subtitles), times.json
import json, re, subprocess, sys, os
from difflib import SequenceMatcher
import cv2
import numpy as np

m, req, src_vtt = sys.argv[1:4]
STEP = 0.2
W = 270


def probe(f):
    c = cv2.VideoCapture(f)
    n, fps, w, h = c.get(7), c.get(5), c.get(3), c.get(4)
    c.release()
    return n / fps if fps else 0, w, h


def frames(f):
    # Yield (t, small BGR frame) every STEP
    c = cv2.VideoCapture(f)
    fps = c.get(5)
    i, nxt = 0, 0.0
    while True:
        ok, fr = c.read()
        if not ok:
            break
        t = i / fps
        if t + 1e-6 >= nxt:
            h = round(fr.shape[0] * W / fr.shape[1])
            yield t, cv2.resize(fr, (W, h), interpolation=cv2.INTER_AREA)
            nxt += STEP
        i += 1
    c.release()


def clock(s):
    p = s.split(":")
    return float(p[0]) * 3600 + float(p[1]) * 60 + float(p[2])


def words_of(path):
    out = []
    for block in re.split(r"\r?\n\r?\n", open(path, encoding="utf-8").read()):
        mm = re.search(r"([\d:.]+)\s*-->\s*([\d:.]+)[^\n]*\n([\s\S]*)", block)
        if not mm:
            continue
        t = clock(mm.group(1))
        parts = re.split(r"<([\d:.]+)>", mm.group(3).replace("\n", " "))
        for k in range(0, len(parts), 2):
            if k:
                t = clock(parts[k - 1])
            for w in parts[k].split():
                out.append((w, t))
    return out


norm = lambda s: re.sub(r"[^\w]+", "", s.lower(), flags=re.U).replace("_", "")


def phrase_time(words, phrase):
    target = norm(phrase)
    text, starts = "", []
    for w, t in words:
        starts.append((len(text), t))
        text += norm(w)
    at = text.find(target)
    if at < 0:
        return None
    best = None
    for pos, t in starts:
        if pos <= at:
            best = t
    return best


def scenes(f, thr=0.12):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-i", f, "-vf", f"scale=270:-2,select='gt(scene,{thr})',showinfo", "-an", "-f", "null", "-"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    return [float(x) for x in re.findall(r"pts_time:([\d.]+)", r.stderr)]


def scores(f):
    # Scene score of every frame: [(t, score)]
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-v", "error", "-i", f, "-vf", "scale=270:-2,select='gte(scene,0)',metadata=print:file=-", "-an", "-f", "null", "-"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    out, t = [], None
    for line in (r.stdout + r.stderr).splitlines():
        a = re.search(r"pts_time:([\d.]+)", line)
        if a:
            t = float(a.group(1))
        b = re.search(r"lavfi\.scene_score=([\d.]+)", line)
        if b and t is not None:
            out.append((t, float(b.group(1))))
    return out


def landed(sc, t):
    # A change within 0.3 s of t that is over 0.05 and three times the usual frame-to-frame change around it
    near = [x for x in sc if abs(x[0] - t) <= 0.3]
    if not near:
        return False
    pt, ps = max(near, key=lambda x: x[1])
    around = sorted(x[1] for x in sc if abs(x[0] - t) <= 1 and abs(x[0] - pt) > 0.15)
    usual = around[len(around) // 2] if around else 0
    return ps >= 0.05 and ps >= 3 * usual


def bbox(mask, min_frac=0.002):
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    if n <= 1:
        return None
    i = 1 + int(np.argmax(stats[1:, 4]))
    x, y, w, h, area = stats[i]
    if area < min_frac * mask.size:
        return None
    return int(x), int(y), int(w), int(h)


res = {"request": req}
D = os.path.join(m, "delivered.mp4")
dur, dw, dh = probe(D)
res["delivered"] = {"seconds": round(dur, 2), "size": f"{int(dw)}x{int(dh)}"}

# Words against the supplied transcript
src_w = [norm(w) for w, _ in words_of(src_vtt)]
got_t = words_of(os.path.join(m, "delivered.vtt"))
got_w = [norm(w) for w, _ in got_t]
# By letters: Whisper splits "health care" and "Wi-Fi" differently from run to run
src, got = "".join(src_w), "".join(got_w)
sm = SequenceMatcher(None, src, got, autojunk=False)
kept = sum(b.size for b in sm.get_matching_blocks())
res["words"] = {"source_words": len(src_w), "heard_words": len(got_w), "source_letters_kept_in_order_pct": round(100 * kept / max(1, len(src)), 1)}

# Shots against named phrases, in the delivered film
sc = scenes(D)
res["picture_changes"] = [round(x, 2) for x in sc]
phrases = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "phrases.json"), encoding="utf-8"))[req]
rows = []
for p in phrases:
    t = phrase_time(got_t, p)
    if t is None:
        rows.append({"phrase": p, "said": None, "nearest_change": None})
        continue
    near = min(sc, key=lambda x: abs(x - t)) if sc else None
    rows.append({"phrase": p, "said": round(t, 2), "nearest_change": round(near - t, 2) if near is not None else None})
res["phrases"] = rows
found = [r for r in rows if r["nearest_change"] is not None]
res["phrases_within_0.3s"] = f"{sum(abs(r['nearest_change']) <= 0.3 for r in found)} of {len(phrases)}"
all_sc = scores(D)
res["phrases_changed_on_word_local"] = f"{sum(1 for r in rows if r['said'] is not None and landed(all_sc, r['said']))} of {len(phrases)}"
said = [r["said"] for r in rows if r["said"] is not None]
res["changes_within_0.3s_of_a_phrase"] = f"{sum(any(abs(c - s) <= 0.3 for s in said) for c in sc)} of {len(sc)}"

# Window from a against b, subtitles from the delivered film against c
# a: as made with subtitles; b: the same with the talk hidden (their difference is the window); c: as made, no --subtitles
A, B, C = os.path.join(m, "c.mp4"), os.path.join(m, "b.mp4"), os.path.join(m, "n.mp4")
if not all(os.path.exists(x) for x in (A, B)):
    res["window"] = "not measurable: no a/b render"
else:
    samples = []
    prev_b = None
    gen_c = frames(C) if os.path.exists(C) else None
    gen_d = frames(D)
    for (t, fa), (_, fb) in zip(frames(A), frames(B)):
        fc = next(gen_c)[1] if gen_c else None
        fd = next(gen_d)[1]
        ga, gb = cv2.cvtColor(fa, cv2.COLOR_BGR2GRAY), cv2.cvtColor(fb, cv2.COLOR_BGR2GRAY)
        d = cv2.GaussianBlur(cv2.absdiff(ga, gb), (3, 3), 0) > 14
        frac = d.mean()
        box = bbox(d)
        # 75% of the frame differing, or a box that spans it, is the speaker filling the frame
        if box and (frac > 0.6 or (box[2] * box[3]) > 0.7 * d.size):
            mode = "full"
        elif box:
            mode = "window"
        else:
            mode = "none"
        s = {"t": round(t, 2), "mode": mode, "box": box}
        if mode == "window":
            x, y, w, h = box
            edges = cv2.Canny(gb, 80, 160) > 0
            under = edges[y:y + h, x:x + w].sum()
            s["win_area"] = w * h / d.size
            s["edge_under"] = float(under) / max(1.0, float(edges.sum()))
            if prev_b is not None:
                mv = cv2.absdiff(gb, prev_b) > 20
                # Skip a shot change
                if 0.0005 < mv.mean() < 0.3:
                    s["motion_under"] = float(mv[y:y + h, x:x + w].sum()) / float(mv.sum())
            if fc is not None:
                gc = cv2.cvtColor(fc, cv2.COLOR_BGR2GRAY)
                sub = cv2.absdiff(gc, cv2.cvtColor(fd, cv2.COLOR_BGR2GRAY)) > 30
                sb = bbox(sub, 0.0005)
                if sb:
                    ox = min(x + w, sb[0] + sb[2]) - max(x, sb[0])
                    oy = min(y + h, sb[1] + sb[3]) - max(y, sb[1])
                    s["over_subs"] = bool(ox > 0 and oy > 0)
        samples.append(s)
        prev_b = gb
    n = len(samples)
    secs = lambda k: round(sum(x["mode"] == k for x in samples) * STEP, 1)
    lead = 0
    while lead < n and samples[lead]["mode"] == "full":
        lead += 1
    tail = 0
    while tail < n and samples[n - 1 - tail]["mode"] == "full":
        tail += 1
    wins = [x for x in samples if x["mode"] == "window"]
    avg = lambda k: round(100 * float(np.mean([x[k] for x in wins if k in x])), 1) if any(k in x for x in wins) else None
    moved_off_cut = 0
    bsc = scenes(B, 0.1)
    for p, q in zip(samples, samples[1:]):
        if p["mode"] == q["mode"] == "window":
            jump = abs((p["box"][0] + p["box"][2] / 2) - (q["box"][0] + q["box"][2] / 2)) + abs((p["box"][1] + p["box"][3] / 2) - (q["box"][1] + q["box"][3] / 2))
            if jump > 0.08 * W and not any(abs(c - q["t"]) < 0.3 for c in bsc):
                moved_off_cut += 1
    res["window"] = {
        "speaker_full_s": secs("full"), "window_s": secs("window"), "no_speaker_s": secs("none"),
        "full_at_start_s": round(lead * STEP, 1), "full_at_end_s": round(tail * STEP, 1),
        "window_area_pct": avg("win_area"), "edges_under_window_pct": avg("edge_under"),
        "edges_under_window_p90_pct": round(100 * float(np.percentile([x["edge_under"] for x in wins if "edge_under" in x], 90)), 1) if any("edge_under" in x for x in wins) else None,
        "edges_under_window_max_pct": round(100 * max([x["edge_under"] for x in wins if "edge_under" in x], default=0), 1),
        "motion_under_window_pct": avg("motion_under"),
        "window_over_subs_s": round(sum(bool(x.get("over_subs")) for x in wins) * STEP, 1),
        "moves_off_a_shot_change": moved_off_cut,
    }
    # Shot lengths over the product
    runs = []
    if wins:
        bounds = [0.0] + [c for c in bsc] + [dur]
        for a, b in zip(bounds, bounds[1:]):
            mid = (a + b) / 2
            hit = min(samples, key=lambda x: abs(x["t"] - mid))
            if hit["mode"] == "window":
                runs.append(round(b - a, 2))
    res["product_shots"] = runs
    res["product_shots_under_2s"] = sum(r < 2 for r in runs)
    res["longest_product_shot_s"] = max(runs, default=None)
    json.dump(samples, open(os.path.join(m, "samples.json"), "w"))


# Subtitles: what the delivery render burned in (delivered film against the same project rendered without --subtitles), at the middle of each spoken line
def lum(bgr):
    return 0.0722 * bgr[..., 0] + 0.7152 * bgr[..., 1] + 0.2126 * bgr[..., 2]


def rel(v):
    v = v / 255.0
    return np.where(v <= 0.03928, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def captions():
    A, N = D, os.path.join(m, "n.mp4")
    cues = []
    for block in re.split(r"\r?\n\r?\n", open(os.path.join(m, "delivered.vtt"), encoding="utf-8").read()):
        mm = re.search(r"([\d:.]+)\s*-->\s*([\d:.]+)", block)
        if mm:
            cues.append((clock(mm.group(1)), clock(mm.group(2))))
    if not (os.path.exists(A) and os.path.exists(N)) or not cues:
        return {"separable": False, "why": "no n.mp4 or no spoken lines"}
    ca, cn = cv2.VideoCapture(A), cv2.VideoCapture(N)
    seen, rows = 0, []
    for s0, e0 in cues:
        t = (s0 + e0) / 2
        ca.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        cn.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok1, fa = ca.read()
        ok2, fn = cn.read()
        if not (ok1 and ok2):
            continue
        d = cv2.cvtColor(cv2.absdiff(fa, fn), cv2.COLOR_BGR2GRAY) > 40
        # Two renders can differ a frame in the speaker's video: look only where subtitles sit by default
        d[: int(0.62 * d.shape[0])] = False
        d[int(0.86 * d.shape[0]):] = False
        # A block big enough to be a box or words
        n_px = int(d.sum())
        box = bbox(d, 0.0003)
        if n_px < 0.0008 * d.size or box is None:
            rows.append({"t": round(t, 2), "visible": False})
            continue
        seen += 1
        # White words on a light page barely differ from it, so take the whole block the burn touched
        bx, by, bw, bh = box
        L = rel(lum(fa.astype(np.float64)))[by:by + bh, bx:bx + bw]
        px = L.ravel()
        # Words are a thin share of the block, a box is most of it: brightest 1% against the 25th percentile
        hi, lo = np.percentile(px, 99), np.percentile(px, 25)
        rows.append({"t": round(t, 2), "visible": True, "ratio": round(float((hi + 0.05) / (lo + 0.05)), 1)})
    ca.release(); cn.release()
    vis = [r for r in rows if r["visible"]]
    if not vis:
        return {"separable": False, "why": "burning subtitles changed nothing: none, or drawn in a page", "lines": len(rows)}
    ratios = sorted(r["ratio"] for r in vis)
    return {"separable": True, "lines": len(rows), "lines_with_burned_words": len(vis), "contrast_median": ratios[len(ratios) // 2], "contrast_min": ratios[0], "lines_under_4.5": sum(r["ratio"] < 4.5 for r in vis)}


res["captions"] = captions()
if os.path.exists(os.path.join(m, "times.json")):
    res["render_seconds"] = json.load(open(os.path.join(m, "times.json")))

json.dump(res, open(os.path.join(m, "measure.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(json.dumps(res, indent=1, ensure_ascii=False))
