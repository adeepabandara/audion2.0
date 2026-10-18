"""Write the parity-test file for the browser classifier: SYNTHETIC hand points (no PopSign data) with the features and
logits the PyTorch model gives for them. The TypeScript code must reproduce both.

  python golden.py model.json ../../apps/extension/src/lib/classifier.golden.json
"""
import json, sys

import numpy as np
import torch

from features import featurize
from train import SIGNS, Net

model_json, out = sys.argv[1], sys.argv[2]
m = json.load(open(model_json))
net = Net(m.get("hidden", 192))
net.load_state_dict({
    "gru.weight_ih_l0": torch.tensor(m["wIh"]), "gru.weight_hh_l0": torch.tensor(m["wHh"]),
    "gru.bias_ih_l0": torch.tensor(m["bIh"]), "gru.bias_hh_l0": torch.tensor(m["bHh"]),
    "out.weight": torch.tensor(m["wOut"]), "out.bias": torch.tensor(m["bOut"]),
})
net.eval()
rng = np.random.default_rng(7)
cases = []
for n_frames, both in ((24, True), (37, False), (13, True)):
    base = rng.uniform(0.2, 0.8, (2, 1, 3)).astype(np.float32)
    drift = rng.normal(0, 0.01, (n_frames, 2, 1, 3)).cumsum(0).astype(np.float32)
    pts = base[None] + drift + rng.normal(0, 0.03, (n_frames, 2, 21, 3)).astype(np.float32)
    pts[..., 2] *= 0.1
    seen = np.zeros((n_frames, 2), bool)
    seen[2:-1, 0] = True
    if both:
        seen[4:-3, 1] = True
    pts[~seen] = 0
    # slot order = left to right by wrist x, as the extractor and the browser do
    for t in range(n_frames):
        if seen[t].all() and pts[t, 0, 0, 0] > pts[t, 1, 0, 0]:
            pts[t] = pts[t, ::-1]
    w, h = 640, 480
    f = featurize(pts, seen, w, h)
    with torch.no_grad():
        lg = net(torch.tensor(f)[None])[0].tolist()
    cases.append({"w": w, "h": h, "pts": pts.round(5).tolist(), "seen": seen.tolist(),
                  "features": f.round(5).tolist(), "logits": lg})
json.dump(cases, open(out, "w"), separators=(",", ":"))
print("wrote", out, len(cases), "cases")
