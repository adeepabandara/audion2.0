"""Compare exported classifiers (model.json) on the same held-out clips.

  python compare.py --data landmarks_v2 --split test shipped=../../apps/extension/public/models/signclf.json new=model_out_pose/model.json
Each model gets the features it was trained on (hands only, or hands + body when model.json has "pose": true), so the
clips must carry body points when any model uses them. Only clips whose sign every model knows are scored.
Single signs are real recordings; phrase classes (with "_") are synthetic joins, so they are reported apart.
"""
import argparse, collections, json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from features import featurize, featurize_pose

APP_THRESHOLD = 0.5  # DEVICE_ONLY_MIN_CONFIDENCE in the extension


def load_model(path):
    m = json.loads(Path(path).read_text())
    gru = nn.GRU(m["features"], m["hidden"], batch_first=True)
    out = nn.Linear(m["hidden"], len(m["signs"]))
    with torch.no_grad():
        gru.weight_ih_l0.copy_(torch.tensor(m["wIh"])); gru.weight_hh_l0.copy_(torch.tensor(m["wHh"]))
        gru.bias_ih_l0.copy_(torch.tensor(m["bIh"])); gru.bias_hh_l0.copy_(torch.tensor(m["bHh"]))
        out.weight.copy_(torch.tensor(m["wOut"])); out.bias.copy_(torch.tensor(m["bOut"]))
    return m, gru, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--split", default="test")
    ap.add_argument("models", nargs="+", help="name=path/to/model.json")
    a = ap.parse_args()
    models = {n: load_model(p) for n, p in (s.split("=", 1) for s in a.models)}
    known = set.intersection(*(set(m["signs"]) for m, _, _ in models.values()))
    clips = []
    for f in sorted(Path(a.data).glob(f"**/{a.split}/*.npz")):
        sign = f.parts[-3].lower()
        if sign in known:
            d = np.load(f)
            clips.append((sign, d))
    print(f"{len(clips)} {a.split} clips over {len(known)} shared classes")

    results = {}
    for name, (m, gru, out) in models.items():
        X, y = [], []
        for sign, d in clips:
            pts, seen, w, h = d["pts"].astype(np.float32), d["seen"], int(d["w"]), int(d["h"])
            if m.get("pose"):
                f = featurize_pose(pts, seen, d["pose"].astype(np.float32), d["pose_seen"], w, h, m["steps"])
            else:
                f = featurize(pts, seen, w, h, m["steps"])
            X.append(f); y.append(sign)
        ok_idx = [i for i, f in enumerate(X) if f is not None]
        with torch.no_grad():
            _, hid = gru(torch.tensor(np.stack([X[i] for i in ok_idx])))
            prob = torch.softmax(out(hid[0]), -1).numpy()
        pred = np.full(len(X), "", object); conf = np.zeros(len(X))
        pred[ok_idx] = [m["signs"][k] for k in prob.argmax(1)]; conf[ok_idx] = prob.max(1)
        results[name] = (np.array(y), pred, conf, m.get("threshold"))

    def row(mask, y, pred, conf, thr):
        ok = pred[mask] == y[mask]; c = conf[mask] >= thr
        return f"{ok.mean() * 100:5.1f}%   at >= {thr}: answers {c.mean() * 100:3.0f}%, {ok[c].mean() * 100:5.1f}% right"

    for name, (y, pred, conf, thr) in results.items():
        single = np.array(["_" not in s for s in y])
        print(f"\n== {name}  (own threshold {thr})")
        for label, mask in (("all", np.ones_like(single)), ("single signs (real)", single), ("phrases (synthetic)", ~single)):
            if mask.any():
                print(f"  {label:20s} {row(mask, y, pred, conf, APP_THRESHOLD)}")
        print(f"  {'singles, own thr':20s} {row(single, y, pred, conf, thr)}")

    names = list(results)
    signs = sorted(known, key=lambda s: ("_" in s, s))
    print("\nper sign (accuracy, all clips): " + " | ".join(names))
    for s in signs:
        print(f"  {s:15s} " + "  ".join(f"{(results[n][1][results[n][0] == s] == s).mean() * 100:5.1f}" for n in names))
    for n in names:
        y, pred, _, _ = results[n]
        cf = collections.Counter((t, p) for t, p in zip(y, pred) if t != p)
        print(f"\n{n} top confusions: " + ", ".join(f"{t}->{p or 'none'} {k}" for (t, p), k in cf.most_common(10)))
    # agreement detail: what one fixes and the other breaks
    if len(names) == 2:
        (y, p0, _, _), (_, p1, _, _) = results[names[0]], results[names[1]]
        fixed = ((p0 != y) & (p1 == y)).sum(); broke = ((p0 == y) & (p1 != y)).sum()
        print(f"\n{names[1]} vs {names[0]}: fixes {fixed} clips, breaks {broke} clips")


if __name__ == "__main__":
    main()
