"""Turn PopSign clips into MediaPipe hand points AND body (pose) points, one clip at a time, then delete the video.

Like extract.py, plus a second model: MediaPipe Pose Landmarker (the face, shoulders, arms), so a classifier can know
WHERE on the body a hand is. Each clip becomes a small .npz: pts (T,2,21,3) float16, seen (T,2) bool, fps, w, h, and
pose (T,33,4) float16 (x, y, z, visibility), pose_seen (T,) bool. No video is kept; nothing is written inside the repo.

Two sources:
  bucket  clips already in your bucket (read-only), listed in --lists files (HELLO_train.txt ...)
  gt      the PopSign tars at Georgia Tech (CC BY 4.0), one tar per sign and split, downloaded to a temp folder,
          sampled, processed and deleted before the next one

  python extract_pose.py bucket --lists ../../../audion-data/lists --out OUT --per-split 450,100,100 \
      --hand-model hand_landmarker.task --pose-model pose_landmarker_lite.task
  python extract_pose.py gt --signs can,will,have --out OUT --per-split 450,100,100 --hand-model ... --pose-model ...
Resumable: clips that already have a .npz are skipped.
"""
import argparse, os, random, shutil, subprocess, tempfile, time
from multiprocessing import Pool
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

GCLOUD = os.environ.get("GCLOUD") or (os.path.expanduser("~/google-cloud-sdk/bin/gcloud") if os.path.exists(os.path.expanduser("~/google-cloud-sdk/bin/gcloud")) else "gcloud")
GT_URL = "https://signdata.cc.gatech.edu/data/popsign_v1_0/game/{split}/{sign}.tar"
CFG = {}  # model paths, set in main() and inherited by the worker processes


def init_worker(cfg):
    """Worker processes may be spawned (macOS) instead of forked, so they get the model paths explicitly."""
    CFG.update(cfg)


def make_models():
    hand = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
        base_options=mpt.BaseOptions(model_asset_path=CFG["hand"], delegate=mpt.BaseOptions.Delegate.CPU),
        running_mode=vision.RunningMode.VIDEO, num_hands=2,
        min_hand_detection_confidence=0.5, min_hand_presence_confidence=0.5, min_tracking_confidence=0.5))
    pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=mpt.BaseOptions(model_asset_path=CFG["pose"], delegate=mpt.BaseOptions.Delegate.CPU),
        running_mode=vision.RunningMode.VIDEO, num_poses=1,
        min_pose_detection_confidence=0.5, min_pose_presence_confidence=0.5, min_tracking_confidence=0.5))
    return hand, pose


def extract_video(path, hand, pose):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    step = max(1, round(fps / 15))  # 15 fps is plenty for a sign
    frames, i, kept = [], 0, 0
    while True:
        if not cap.grab():
            break
        i += 1
        if (i - 1) % step:
            continue
        ok, bgr = cap.retrieve()
        if not ok:
            break
        scale = 480 / bgr.shape[0]  # webcam-sized frames
        if scale < 1:
            bgr = cv2.resize(bgr, (round(bgr.shape[1] * scale), 480), interpolation=cv2.INTER_AREA)
        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        ts = int(kept * 1000 * step / fps) + 1
        kept += 1
        hres, pres = hand.detect_for_video(img, ts), pose.detect_for_video(img, ts)
        slot, have = np.zeros((2, 21, 3), np.float32), np.zeros(2, bool)
        for j, lm in enumerate(sorted(hres.hand_landmarks, key=lambda l: l[0].x)[:2]):  # left-to-right in the image
            slot[j] = [[p.x, p.y, p.z] for p in lm]
            have[j] = True
        body, bseen = np.zeros((33, 4), np.float32), False
        if pres.pose_landmarks:
            body = np.array([[p.x, p.y, p.z, p.visibility or 0.0] for p in pres.pose_landmarks[0]], np.float32)
            bseen = True
        frames.append((slot, have, body, bseen))
    cap.release()
    if not frames:
        return np.zeros((0, 2, 21, 3), np.float32), np.zeros((0, 2), bool), np.zeros((0, 33, 4), np.float32), np.zeros(0, bool), fps / step, w, h
    return (np.stack([f[0] for f in frames]), np.stack([f[1] for f in frames]), np.stack([f[2] for f in frames]),
            np.array([f[3] for f in frames]), fps / step, w, h)


def process(path, out_path):
    """One local video file -> one .npz. A fresh pair of models per clip: MediaPipe wants timestamps that only increase."""
    out = Path(out_path)
    if out.exists():
        return ("skip", path)
    try:
        hand, pose = make_models()
        with hand, pose:
            pts, seen, body, bseen, fps, w, h = extract_video(path, hand, pose)
    except Exception as e:  # a bad file must not stop the run
        return ("fail", f"{path} {e}")
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, pts=pts.astype(np.float16), seen=seen, pose=body.astype(np.float16), pose_seen=bseen, fps=fps, w=w, h=h)
    return ("ok", path)


def work_bucket(job):
    uri, out_path, tmp_root = job
    if Path(out_path).exists():
        return ("skip", uri)
    with tempfile.TemporaryDirectory(dir=tmp_root) as d:
        local = os.path.join(d, "clip.mp4")
        r = subprocess.run([GCLOUD, "storage", "cp", "--quiet", uri, local], capture_output=True, text=True)
        if r.returncode != 0:
            return ("fail", f"{uri} {r.stderr.strip()[:200]}")
        status, info = process(local, out_path)
        return (status, uri if status != "fail" else info)


def work_local(job):
    return process(*job)


def report(results, total, t0):
    done = fails = 0
    for status, info in results:
        done += 1
        if status == "fail":
            fails += 1
            print("FAIL", info, flush=True)
        if done % 50 == 0 or done == total:
            rate = done / (time.time() - t0)
            print(f"{done}/{total} done, {fails} failed, {rate:.2f} clips/s, ~{(total-done)/max(rate,1e-6)/60:.0f} min left", flush=True)


def run_bucket(a, counts):
    rng = random.Random(a.seed)
    jobs = []
    for f in sorted(Path(a.lists).glob("*.txt")):
        sign, split = f.stem.split("_")
        uris = sorted(l.strip() for l in f.read_text().splitlines() if l.strip().endswith(".mp4"))
        for uri in rng.sample(uris, min(counts[split], len(uris))):
            jobs.append((uri, str(Path(a.out) / sign / split / uri.rsplit("/", 1)[1].replace(".mp4", ".npz")), a.tmp))
    print(f"{len(jobs)} clips planned", flush=True)
    t0 = time.time()
    with Pool(a.workers, initializer=init_worker, initargs=(dict(CFG),)) as pool:
        report(pool.imap_unordered(work_bucket, jobs), len(jobs), t0)


def run_gt(a, counts):
    rng = random.Random(a.seed)
    for sign in a.signs.split(","):
        for split in ("train", "val", "test"):
            if counts[split] <= 0:
                continue
            with tempfile.TemporaryDirectory(dir=a.tmp) as d:
                tar = os.path.join(d, "x.tar")
                url = GT_URL.format(split=split, sign=sign.lower())
                print(f"downloading {url}", flush=True)
                r = subprocess.run(["curl", "-sS", "-L", "--fail", "--retry", "3", "-o", tar, url], capture_output=True, text=True)
                if r.returncode != 0:
                    print("FAIL download", url, r.stderr.strip()[:200], flush=True)
                    continue
                print(f"  {os.path.getsize(tar) / 1e9:.2f} GB, extracting", flush=True)
                subprocess.run(["tar", "-xf", tar, "-C", d], check=True)
                os.remove(tar)
                vids = sorted(Path(d).rglob("*.mp4"))
                picks = rng.sample(vids, min(counts[split], len(vids)))
                jobs = [(str(v), str(Path(a.out) / sign.upper() / split / (v.stem + ".npz"))) for v in picks]
                print(f"  {len(vids)} videos, using {len(jobs)}", flush=True)
                t0 = time.time()
                with Pool(a.workers, initializer=init_worker, initargs=(dict(CFG),)) as pool:
                    report(pool.imap_unordered(work_local, jobs), len(jobs), t0)
            shutil.rmtree(d, ignore_errors=True)  # the videos are gone before the next tar


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="mode", required=True)
    for name in ("bucket", "gt"):
        p = sub.add_parser(name)
        p.add_argument("--out", required=True)
        p.add_argument("--per-split", default="100,25,25", help="train,val,test clips per sign")
        p.add_argument("--workers", type=int, default=4)
        p.add_argument("--seed", type=int, default=0)
        p.add_argument("--tmp", default=None, help="temp folder for downloaded video (needs space for one tar)")
        p.add_argument("--hand-model", required=True)
        p.add_argument("--pose-model", required=True)
        if name == "bucket":
            p.add_argument("--lists", required=True)
        else:
            p.add_argument("--signs", required=True, help="comma-separated PopSign sign names, e.g. can,will,haveto")
    a = ap.parse_args()
    CFG.update(hand=a.hand_model, pose=a.pose_model)
    counts = dict(zip(["train", "val", "test"], map(int, a.per_split.split(","))))
    Path(a.out).mkdir(parents=True, exist_ok=True)
    (run_bucket if a.mode == "bucket" else run_gt)(a, counts)


if __name__ == "__main__":
    main()
