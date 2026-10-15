"""Turn a random sample of PopSign clips into MediaPipe hand points, one clip at a time.

Each clip is copied from your own bucket (read-only), run through the SAME Hand Landmarker model file the browser
uses, saved as a small .npz of hand points, and the video is deleted straight away. Nothing is written inside the repo.

  python extract.py --lists ../../../audion-data/lists --out ../../../audion-data/landmarks --per-split 100,25,25
Resumable: clips that already have a .npz are skipped.
"""
import argparse, json, os, random, subprocess, sys, tempfile, time
from multiprocessing import Pool
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

MODEL = Path(__file__).resolve().parents[2] / "apps/extension/public/models/hand_landmarker.task"
GCLOUD = os.environ.get("GCLOUD") or (os.path.expanduser("~/google-cloud-sdk/bin/gcloud") if os.path.exists(os.path.expanduser("~/google-cloud-sdk/bin/gcloud")) else "gcloud")
BUCKET_PREFIX = "gs://signvoice-data/popsign_v1_0/raw/"


def make_landmarker():
    opts = vision.HandLandmarkerOptions(
        base_options=mpt.BaseOptions(model_asset_path=str(MODEL), delegate=mpt.BaseOptions.Delegate.CPU),
        running_mode=vision.RunningMode.VIDEO,
        num_hands=2,
        min_hand_detection_confidence=0.5,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    return vision.HandLandmarker.create_from_options(opts)


def extract_video(path, landmarker):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    pts = np.zeros((0, 2, 21, 3), np.float32)
    seen = np.zeros((0, 2), bool)
    frames, i, kept = [], 0, 0
    step = max(1, round(fps / 15))  # 15 fps is plenty for a sign (resampled to a fixed length later) and halves the work
    while True:
        ok = cap.grab()
        if not ok:
            break
        i += 1
        if (i - 1) % step:
            continue
        ok, bgr = cap.retrieve()
        if not ok:
            break
        scale = 480 / bgr.shape[0]  # webcam-sized frames; the clips are 1944x2592
        if scale < 1:
            bgr = cv2.resize(bgr, (round(bgr.shape[1] * scale), 480), interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        res = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(kept * 1000 * step / fps) + 1)
        kept += 1
        slot = np.zeros((2, 21, 3), np.float32)
        have = np.zeros(2, bool)
        # Up to two hands, ordered left-to-right in the image (handedness labels are not trusted).
        hands = sorted(res.hand_landmarks, key=lambda lm: lm[0].x)[:2]
        for j, lm in enumerate(hands):
            slot[j] = [[p.x, p.y, p.z] for p in lm]
            have[j] = True
        frames.append((slot, have))
    cap.release()
    if frames:
        pts = np.stack([f[0] for f in frames])
        seen = np.stack([f[1] for f in frames])
    return pts, seen, fps / step, w, h


def work(job):
    uri, out_path, tmp_root = job
    out = Path(out_path)
    if out.exists():
        return ("skip", uri)
    with tempfile.TemporaryDirectory(dir=tmp_root) as d:
        local = os.path.join(d, "clip.mp4")
        r = subprocess.run([GCLOUD, "storage", "cp", "--quiet", uri, local], capture_output=True, text=True)
        if r.returncode != 0:
            return ("fail", f"{uri} {r.stderr.strip()[:200]}")
        try:
            # A fresh landmarker per clip: MediaPipe wants timestamps that only ever increase.
            with make_landmarker() as lm:
                pts, seen, fps, w, h = extract_video(local, lm)
        except Exception as e:  # a bad file must not stop the run
            return ("fail", f"{uri} {e}")
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, pts=pts.astype(np.float16), seen=seen, fps=fps, w=w, h=h)
    return ("ok", uri)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lists", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--per-split", default="100,25,25", help="train,val,test clips per sign")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    counts = dict(zip(["train", "val", "test"], map(int, a.per_split.split(","))))
    rng = random.Random(a.seed)
    jobs = []
    for f in sorted(Path(a.lists).glob("*.txt")):
        sign, split = f.stem.split("_")
        uris = sorted(l.strip() for l in f.read_text().splitlines() if l.strip().endswith(".mp4"))
        for uri in rng.sample(uris, min(counts[split], len(uris))):
            name = uri.rsplit("/", 1)[1].replace(".mp4", ".npz")
            jobs.append((uri, str(Path(a.out) / sign / split / name), a.out))
    Path(a.out).mkdir(parents=True, exist_ok=True)
    (Path(a.out) / "manifest.json").write_text(json.dumps([[j[0], j[1]] for j in jobs]))
    print(f"{len(jobs)} clips planned", flush=True)
    done = fails = 0
    t0 = time.time()
    with Pool(a.workers) as pool:
        for status, info in pool.imap_unordered(work, jobs):
            done += 1
            if status == "fail":
                fails += 1
                print("FAIL", info, flush=True)
            if done % 50 == 0 or done == len(jobs):
                rate = done / (time.time() - t0)
                print(f"{done}/{len(jobs)} done, {fails} failed, {rate:.2f} clips/s, ~{(len(jobs)-done)/max(rate,1e-6)/60:.0f} min left", flush=True)


if __name__ == "__main__":
    main()
