"""Synthesize realistic phrase landmark data for compound signs from isolated PopSign clips.

Reads pairs of isolated signs from `landmarks/` for:
  - please_wait    (PLEASE + WAIT)
  - thankyou_bye   (THANKYOU + BYE)
  - yes_please     (YES + PLEASE)
  - no_thankyou    (NO + THANKYOU)
  - talk_later     (TALK + LATER)
  - not_now        (NOT + NOW)
  - why_not        (WHY + NOT)
  - think_same     (THINK + SAME)
  - fine_thankyou  (FINE + THANKYOU)
  - talk_tomorrow  (TALK + TOMORROW)
  - think_not      (THINK + NOT)
  - finish_now     (FINISH + NOW)
  - tomorrow_time  (TOMORROW + TIME)
  - time_now       (TIME + NOW)
  - who_where      (WHO + WHERE)
  - look_listen    (LOOK + LISTEN)
  - wait_later     (WAIT + LATER)
  - hello_fine     (HELLO + FINE)

Matches clips by signer within each split ('train', 'val', 'test'), stitches landmark arrays
with 6-8 smooth transition frames using interpolation, and writes them to:
  `landmarks/<PHRASE>/<split>/<name>.npz`
"""
import argparse
from collections import defaultdict
from pathlib import Path
import random
import numpy as np

PHRASES = [
    ("PLEASE_WAIT", "PLEASE", "WAIT"),
    ("THANKYOU_BYE", "THANKYOU", "BYE"),
    ("YES_PLEASE", "YES", "PLEASE"),
    ("NO_THANKYOU", "NO", "THANKYOU"),
    ("TALK_LATER", "TALK", "LATER"),
    ("NOT_NOW", "NOT", "NOW"),
    ("WHY_NOT", "WHY", "NOT"),
    ("THINK_SAME", "THINK", "SAME"),
    ("FINE_THANKYOU", "FINE", "THANKYOU"),
    ("TALK_TOMORROW", "TALK", "TOMORROW"),
    ("THINK_NOT", "THINK", "NOT"),
    ("FINISH_NOW", "FINISH", "NOW"),
    ("TOMORROW_TIME", "TOMORROW", "TIME"),
    ("TIME_NOW", "TIME", "NOW"),
    ("WHO_WHERE", "WHO", "WHERE"),
    ("LOOK_LISTEN", "LOOK", "LISTEN"),
    ("WAIT_LATER", "WAIT", "LATER"),
    ("HELLO_FINE", "HELLO", "FINE"),
]

SPLITS = ["train", "val", "test"]


def smoothstep(a: float) -> float:
    """Cosine ease-in-out for smooth natural motion."""
    return 0.5 * (1.0 - np.cos(np.pi * a))


def match_clips(files_a: list[Path], files_b: list[Path]) -> list[tuple[Path, Path]]:
    """Match clips within the split, prioritising clips from the same signer."""
    by_signer_a = defaultdict(list)
    by_signer_b = defaultdict(list)
    for f in files_a:
        by_signer_a[f.name.split("-")[0]].append(f)
    for f in files_b:
        by_signer_b[f.name.split("-")[0]].append(f)

    pairs = []
    rem_a, rem_b = [], []
    all_signers = sorted(set(by_signer_a.keys()) | set(by_signer_b.keys()))
    for s in all_signers:
        la, lb = by_signer_a[s], by_signer_b[s]
        n = min(len(la), len(lb))
        for i in range(n):
            pairs.append((la[i], lb[i]))
        rem_a.extend(la[n:])
        rem_b.extend(lb[n:])

    # Pair remaining clips across signers to keep the split fully populated
    for fa, fb in zip(rem_a, rem_b):
        pairs.append((fa, fb))
    return pairs


def stitch_landmarks(
    pts_a: np.ndarray,
    seen_a: np.ndarray,
    pts_b: np.ndarray,
    seen_b: np.ndarray,
    num_trans: int,
) -> tuple[np.ndarray, np.ndarray] | tuple[None, None]:
    """Stitches landmark arrays with num_trans smooth transition frames."""
    idx_a = np.flatnonzero(seen_a.any(axis=1))
    idx_b = np.flatnonzero(seen_b.any(axis=1))
    if len(idx_a) < 4 or len(idx_b) < 4:
        return None, None

    last_a = idx_a[-1]
    first_b = idx_b[0]

    # Keep active span of A up to last seen frame, and active span of B from first seen frame
    start_a = max(0, idx_a[0] - 2)
    end_a = last_a + 1
    start_b = first_b
    end_b = min(len(pts_b), idx_b[-1] + 3)

    pa = pts_a[start_a:end_a].astype(np.float32).copy()
    sa = seen_a[start_a:end_a].copy()
    pb = pts_b[start_b:end_b].astype(np.float32).copy()
    sb = seen_b[start_b:end_b].copy()

    k_trans = num_trans
    trans_p = np.zeros((k_trans, 2, 21, 3), dtype=np.float32)
    trans_s = np.zeros((k_trans, 2), dtype=bool)

    ha = [j for j in (0, 1) if sa[-1, j]]
    hb = [j for j in (0, 1) if sb[0, j]]

    if len(ha) == 1 and len(hb) == 1:
        p0a = pa[-1, ha[0]]
        p0b = pb[0, hb[0]]
        for k in range(k_trans):
            alpha = smoothstep((k + 1) / (k_trans + 1))
            trans_p[k, 0] = (1.0 - alpha) * p0a + alpha * p0b
            trans_s[k, 0] = True
    elif len(ha) == 2 and len(hb) == 2:
        d00 = np.linalg.norm(pa[-1, 0, 0] - pb[0, 0, 0]) + np.linalg.norm(pa[-1, 1, 0] - pb[0, 1, 0])
        d01 = np.linalg.norm(pa[-1, 0, 0] - pb[0, 1, 0]) + np.linalg.norm(pa[-1, 1, 0] - pb[0, 0, 0])
        pair_b = (0, 1) if d00 <= d01 else (1, 0)
        for k in range(k_trans):
            alpha = smoothstep((k + 1) / (k_trans + 1))
            trans_p[k, 0] = (1.0 - alpha) * pa[-1, 0] + alpha * pb[0, pair_b[0]]
            trans_p[k, 1] = (1.0 - alpha) * pa[-1, 1] + alpha * pb[0, pair_b[1]]
            trans_s[k] = True
    elif len(ha) == 1 and len(hb) == 2:
        mb = 0 if np.linalg.norm(pa[-1, ha[0], 0] - pb[0, 0, 0]) < np.linalg.norm(pa[-1, ha[0], 0] - pb[0, 1, 0]) else 1
        ub = 1 - mb
        p_entry = pb[0, ub].copy()
        p_entry[..., 1] += 0.15  # hand rises from resting below
        k_start = k_trans // 2
        for k in range(k_trans):
            alpha = smoothstep((k + 1) / (k_trans + 1))
            trans_p[k, 0] = (1.0 - alpha) * pa[-1, ha[0]] + alpha * pb[0, mb]
            trans_s[k, 0] = True
            if k >= k_start:
                beta = smoothstep((k - k_start + 1) / (k_trans - k_start + 1))
                trans_p[k, 1] = (1.0 - beta) * p_entry + beta * pb[0, ub]
                trans_s[k, 1] = True
    elif len(ha) == 2 and len(hb) == 1:
        ma = 0 if np.linalg.norm(pb[0, hb[0], 0] - pa[-1, 0, 0]) < np.linalg.norm(pb[0, hb[0], 0] - pa[-1, 1, 0]) else 1
        ua = 1 - ma
        p_exit = pa[-1, ua].copy()
        p_exit[..., 1] += 0.15  # non-dominant hand lowers to rest
        k_end = k_trans // 2
        for k in range(k_trans):
            alpha = smoothstep((k + 1) / (k_trans + 1))
            trans_p[k, 0] = (1.0 - alpha) * pa[-1, ma] + alpha * pb[0, hb[0]]
            trans_s[k, 0] = True
            if k <= k_end:
                beta = smoothstep((k + 1) / (k_end + 2))
                trans_p[k, 1] = (1.0 - beta) * pa[-1, ua] + beta * p_exit
                trans_s[k, 1] = True

    # Enforce standard invariant: lone hand in slot 0, 2 hands sorted left-to-right
    for k in range(k_trans):
        if not trans_s[k, 0] and trans_s[k, 1]:
            trans_p[k, 0] = trans_p[k, 1]
            trans_s[k, 0] = True
            trans_p[k, 1] = 0.0
            trans_s[k, 1] = False
        elif trans_s[k, 0] and trans_s[k, 1]:
            if trans_p[k, 0, 0, 0] > trans_p[k, 1, 0, 0]:
                trans_p[k] = trans_p[k, ::-1]

    out_pts = np.concatenate([pa, trans_p, pb], axis=0)
    out_seen = np.concatenate([sa, trans_s, sb], axis=0)
    return out_pts, out_seen


def is_valid_clip(f: Path) -> bool:
    try:
        d = np.load(f)
        idx = np.flatnonzero(d["seen"].any(axis=1))
        return len(idx) >= 4
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="/Users/adeepabandara/Test/audion-data/landmarks")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    random.seed(args.seed)
    rng = np.random.default_rng(args.seed)
    base = Path(args.data)

    target_counts = {"train": 100, "val": 25, "test": 25}
    total_generated = 0
    for phrase_dir, sign_a, sign_b in PHRASES:
        print(f"\nSynthesizing phrase {phrase_dir} from {sign_a} + {sign_b}...")
        for split in SPLITS:
            dir_a = base / sign_a / split
            dir_b = base / sign_b / split
            out_dir = base / phrase_dir / split
            out_dir.mkdir(parents=True, exist_ok=True)

            target = target_counts[split]
            files_a = [f for f in sorted(list(dir_a.glob("*.npz"))) if is_valid_clip(f)]
            files_b = [f for f in sorted(list(dir_b.glob("*.npz"))) if is_valid_clip(f)]

            pairs = match_clips(files_a, files_b)
            # If target > len(pairs), sample extra pairs from valid files
            idx = 0
            while len(pairs) < target:
                fa = files_a[idx % len(files_a)]
                fb = files_b[(idx * 7 + 3) % len(files_b)]
                pairs.append((fa, fb))
                idx += 1

            saved = 0
            for fa, fb in pairs[:target]:
                da = np.load(fa)
                db = np.load(fb)
                trans_len = int(rng.integers(6, 9))  # 6, 7, or 8 frames
                pts, seen = stitch_landmarks(da["pts"], da["seen"], db["pts"], db["seen"], trans_len)
                if pts is None or seen is None:
                    continue

                fps = float(da["fps"]) if "fps" in da else 15.0
                w = int(da["w"]) if "w" in da else 1944
                h = int(da["h"]) if "h" in da else 2592

                out_name = f"{fa.stem}_+_{fb.stem}_{saved}.npz"
                np.savez_compressed(
                    out_dir / out_name,
                    pts=pts.astype(np.float16),
                    seen=seen,
                    fps=fps,
                    w=w,
                    h=h,
                )
                saved += 1
            print(f"  [{split}] saved {saved} clips to {out_dir}")
            total_generated += saved

    print(f"\nDone. Successfully generated {total_generated} compound phrase clips.")



if __name__ == "__main__":
    main()
