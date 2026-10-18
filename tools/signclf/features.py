"""Hand points -> the fixed-size input of the sign classifier. The browser (apps/extension/src/lib/classifier.ts)
must compute EXACTLY the same numbers; golden.json (written by export.py) is the parity test between the two.

Input: pts (T, 2, 21, 3) normalised MediaPipe landmarks, up to two hands ordered left-to-right in the image,
       seen (T, 2) bool, and the frame size (w, h).
Output: (STEPS, 132) float32.
Per hand and frame (66 numbers): 63 hand-shape numbers (21 points, wrist-centred, divided by hand size, x and z scaled
by the image aspect so x and y use the same unit) + the wrist position relative to the sign's mean wrist position,
divided by hand size (2) + a seen flag (1). Frames outside the span where a hand is visible are dropped; the span is
resampled to STEPS frames by nearest index (so a missing hand stays missing instead of being blended).
"""
import numpy as np

STEPS = 48
FEATURES = 132
WRIST, MIDDLE_MCP = 0, 9


def span(seen):
    idx = np.flatnonzero(seen.any(axis=1))
    return (int(idx[0]), int(idx[-1]) + 1) if len(idx) else None


def featurize(pts, seen, w, h, steps=STEPS):
    """Returns (steps, 132) float32, or None when fewer than 4 frames have a hand."""
    s = span(seen)
    if s is None or s[1] - s[0] < 4:
        return None
    pts = pts[s[0]:s[1]].astype(np.float32).copy()
    seen = seen[s[0]:s[1]]
    aspect = w / h
    pts[..., 0] *= aspect
    pts[..., 2] *= aspect
    scale = pts[..., MIDDLE_MCP, :2] - pts[..., WRIST, :2]  # (T,2,2)
    size = np.linalg.norm(scale, axis=-1)  # (T,2)
    valid = seen & (size > 1e-4)
    med = np.median(size[valid]) if valid.any() else 0.1
    med = max(float(med), 0.02)
    wrist = pts[..., WRIST, :2]  # (T,2,2)
    centre = wrist[seen].mean(axis=0) if seen.any() else np.zeros(2, np.float32)
    # one global centre: mean wrist position over every seen hand-frame
    out = np.zeros((len(pts), 2, 66), np.float32)
    for hnd in range(2):
        m = seen[:, hnd]
        if not m.any():
            continue
        shape = (pts[m, hnd] - pts[m, hnd, WRIST:WRIST + 1]) / med  # (n,21,3)
        out[m, hnd, :63] = shape.reshape(-1, 63)
        out[m, hnd, 63:65] = (wrist[m, hnd] - centre) / med
        out[m, hnd, 65] = 1.0
    idx = np.minimum((np.arange(steps) * len(out) / steps).astype(int), len(out) - 1)
    return out[idx].reshape(steps, 132)


def mirror(pts, seen):
    """Left-right mirror: flip x about the image centre and swap the two hand slots (they are ordered by x)."""
    p = pts.copy()
    p[..., 0] = 1.0 - p[..., 0]
    p, m = p[:, ::-1].copy(), seen[:, ::-1].copy()
    # A lone hand always sits in slot 0 (as the extractor and the browser put it).
    lone = ~m[:, 0] & m[:, 1]
    p[lone, 0], m[lone, 0] = p[lone, 1], True
    p[lone, 1], m[lone, 1] = 0, False
    return p, m
