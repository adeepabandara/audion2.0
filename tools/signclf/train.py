"""Train the on-device sign classifier on extracted hand points, test it on signers it has not seen, export it.

  python train.py --data landmarks --out model_out
  python train.py --data landmarks_v2 --out model_out_pose --pose   # + where the hands are on the body (12 numbers)
--data is searched recursively for <SIGN>/<split>/*.npz. With --pose every clip must come from extract_pose.py (or
synthesize_phrases.py run on such clips), and model.json gets "pose": true and 144 features.
Writes model_out/{model.json, golden.json, report.txt}. model.json holds the weights for the hand-written JavaScript
inference (a 1-layer GRU + a linear layer); golden.json holds raw inputs with the expected outputs for the parity test.
"""
import argparse, json, random
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from features import FEATURES, POSE_FEATURES, STEPS, featurize, featurize_pose, mirror

SIGNS = [
    "hello", "bye", "yes", "no", "please", "thankyou", "wait", "why", "who", "where", "now", "later",
    "tomorrow", "time", "finish", "think", "look", "listen", "talk", "fine", "same", "not",
    "please_wait", "thankyou_bye", "yes_please", "no_thankyou", "talk_later", "not_now",
    "why_not", "think_same", "fine_thankyou", "talk_tomorrow", "think_not", "finish_now",
    "tomorrow_time", "time_now", "who_where", "look_listen", "wait_later", "hello_fine",
]
HIDDEN = 256
POSE = False  # set by --pose


class Net(nn.Module):
    def __init__(self, hidden=HIDDEN):
        super().__init__()
        self.gru = nn.GRU(FEATURES + (POSE_FEATURES if POSE else 0), hidden, batch_first=True)
        self.out = nn.Linear(hidden, len(SIGNS))

    def forward(self, x):
        _, h = self.gru(x)  # h: (1, B, H), the state after the last frame
        return self.out(h[0])


def load(data):
    """-> {split: [(sign_index, pts, seen, w, h, name, pose, pose_seen)]} (pose None without --pose)"""
    sets = {"train": [], "val": [], "test": []}
    for f in sorted(Path(data).glob("**/*.npz")):
        sign, split = f.parts[-3].lower(), f.parts[-2]
        if sign not in SIGNS or split not in sets:
            continue
        d = np.load(f)
        if POSE and "pose" not in d.files:
            raise SystemExit(f"--pose needs body points, missing in {f}")
        pose = (d["pose"].astype(np.float32), d["pose_seen"]) if POSE else (None, None)
        sets[split].append((SIGNS.index(sign), d["pts"].astype(np.float32), d["seen"], int(d["w"]), int(d["h"]), f.stem, *pose))
    return sets


def augment(pts, seen, w, h, rng, pose=None, pose_seen=None):
    flip = rng.random() < 0.5
    if flip:
        pts, seen = mirror(pts, seen)
    p = pts.copy()
    q = None if pose is None else pose.copy()
    if q is not None and flip:
        q[..., 0] = 1.0 - q[..., 0]
    # small random rotation, scale and shift of the whole sign, and per-point jitter
    a = np.radians(rng.uniform(-12, 12))
    c, s = np.cos(a), np.sin(a)
    scale, shift = rng.uniform(0.9, 1.1), rng.uniform(-0.03, 0.03, 2)

    def tf(xy):  # the same rotation, scale and shift for the hands and the body
        xy = xy - 0.5
        return np.stack([xy[..., 0] * c - xy[..., 1] * s, xy[..., 0] * s + xy[..., 1] * c], -1) * scale + 0.5 + shift

    p[..., :2] = tf(p[..., :2])
    if q is not None:
        q[..., :2] = tf(q[..., :2])
    p += rng.normal(0, 0.002, p.shape).astype(np.float32)
    # keep a random 85-100 % of the time span (a sign that starts or ends a little early or late)
    n = len(p)
    keep = max(4, int(n * rng.uniform(0.85, 1.0)))
    start = rng.integers(0, n - keep + 1)
    cut = slice(start, start + keep)
    return p[cut], seen[cut], w, h, (None if q is None else q[cut]), (None if q is None else pose_seen[cut])


def features_of(pts, seen, w, h, pose=None, pose_seen=None):
    return featurize_pose(pts, seen, pose, pose_seen, w, h) if POSE else featurize(pts, seen, w, h)


def tensors(items, augment_fn=None, rng=None, repeat=1):
    X, y = [], []
    for _ in range(repeat):
        for sign, pts, seen, w, h, _, pose, pose_seen in items:
            if augment_fn:
                pts, seen, w, h, pose, pose_seen = augment_fn(pts, seen, w, h, rng, pose, pose_seen)
            f = features_of(pts, seen, w, h, pose, pose_seen)
            if f is not None:
                X.append(f)
                y.append(sign)
    return torch.tensor(np.stack(X)), torch.tensor(y)


def evaluate(model, X, y, threshold=None):
    model.eval()
    with torch.no_grad():
        prob = torch.softmax(model(X), -1)
    conf, pred = prob.max(-1)
    return pred, conf, (pred == y)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--pose", action="store_true", help="add the 12 body-position numbers per frame")
    a = ap.parse_args()
    global POSE
    POSE = a.pose
    random.seed(a.seed); np.random.seed(a.seed); torch.manual_seed(a.seed)
    rng = np.random.default_rng(a.seed)
    sets = load(a.data)
    print({k: len(v) for k, v in sets.items()}, flush=True)
    Xv, yv = tensors(sets["val"])
    Xt, yt = tensors(sets["test"])
    model = Net()
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-2)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=a.epochs * 40)
    lossf = nn.CrossEntropyLoss(label_smoothing=0.05)
    best, best_state = 0.0, None
    for ep in range(a.epochs):
        X, y = tensors(sets["train"], augment, rng)  # fresh augmentations every epoch
        model.train()
        perm = torch.randperm(len(X))
        bs = max(8, len(X) // 40)
        for i in range(0, len(X), bs):
            idx = perm[i:i + bs]
            if sched.last_epoch >= a.epochs * 40 - 1:
                break
            opt.zero_grad(); lossf(model(X[idx]), y[idx]).backward(); opt.step(); sched.step()
        _, _, ok = evaluate(model, Xv, yv)
        acc = ok.float().mean().item()
        if acc > best:
            best, best_state = acc, {k: v.clone() for k, v in model.state_dict().items()}
        if ep % 5 == 4 or ep == a.epochs - 1:
            print(f"epoch {ep+1}: val accuracy {acc:.3f} (best {best:.3f})", flush=True)
    model.load_state_dict(best_state)

    # Report on the held-out test split and choose a confidence threshold on the validation split.
    pv, cv, okv = evaluate(model, Xv, yv)
    pt, ct, okt = evaluate(model, Xt, yt)
    lines = [f"clips: train {len(sets['train'])}, val {len(sets['val'])}, test {len(sets['test'])}",
             f"test accuracy (all clips): {okt.float().mean():.3f}   val accuracy: {okv.float().mean():.3f}"]
    chosen = 0.9
    for thr in (0.5, 0.6, 0.7, 0.8, 0.9, 0.95):
        mv, mt = cv >= thr, ct >= thr
        lines.append(f"threshold {thr:.2f}: val coverage {mv.float().mean():.2f} accuracy {okv[mv].float().mean() if mv.any() else float('nan'):.3f} | "
                     f"test coverage {mt.float().mean():.2f} accuracy {okt[mt].float().mean() if mt.any() else float('nan'):.3f}")
    # the lowest threshold whose accuracy on the validation split is at least 95 %
    for thr in (0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99):
        mv = cv >= thr
        if mv.any() and okv[mv].float().mean() >= 0.95:
            chosen = thr
            break
    lines.append(f"chosen threshold (val accuracy >= 95 %): {chosen}")
    lines.append("per sign (test): " + ", ".join(f"{SIGNS[i]} {okt[yt == i].float().mean():.2f}" for i in range(len(SIGNS)) if (yt == i).any()))
    conf = {}
    for t, p, ok in zip(yt.tolist(), pt.tolist(), okt.tolist()):
        if not ok:
            conf[(SIGNS[t], SIGNS[p])] = conf.get((SIGNS[t], SIGNS[p]), 0) + 1
    lines.append("top confusions (true -> predicted: count): " + ", ".join(f"{t}->{p}: {n}" for (t, p), n in sorted(conf.items(), key=lambda kv: -kv[1])[:10]))
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    (out / "report.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))

    sd = {k: v.numpy().astype(np.float32) for k, v in model.state_dict().items()}
    (out / "model.json").write_text(json.dumps({
        "signs": SIGNS, "steps": STEPS, "features": FEATURES + (POSE_FEATURES if POSE else 0), "hidden": HIDDEN,
        "threshold": chosen, "pose": POSE,
        # GRU layout is PyTorch's: gates stacked as reset, update, new.
        "wIh": sd["gru.weight_ih_l0"].round(5).tolist(), "wHh": sd["gru.weight_hh_l0"].round(5).tolist(),
        "bIh": sd["gru.bias_ih_l0"].round(5).tolist(), "bHh": sd["gru.bias_hh_l0"].round(5).tolist(),
        "wOut": sd["out.weight"].round(5).tolist(), "bOut": sd["out.bias"].round(5).tolist(),
    }, separators=(",", ":")))
    # Parity test data: raw inputs of 4 test clips and the logits the PyTorch model gives for them.
    gold = []
    model.eval()
    for sign, pts, seen, w, h, name, pose, pose_seen in sets["test"][:: max(1, len(sets["test"]) // 4)][:4]:
        f = features_of(pts, seen, w, h, pose, pose_seen)
        if f is None:
            continue
        with torch.no_grad():
            logits = model(torch.tensor(f)[None])[0].tolist()
        g = {"w": w, "h": h, "pts": pts.round(5).tolist(), "seen": seen.tolist(), "logits": logits, "features": f.round(5).tolist()}
        if POSE:
            g.update(pose=pose.round(5).tolist(), pose_seen=pose_seen.tolist())
        gold.append(g)
    (out / "golden.json").write_text(json.dumps(gold, separators=(",", ":")))
    print("exported", [p.name for p in out.iterdir()])


if __name__ == "__main__":
    main()
