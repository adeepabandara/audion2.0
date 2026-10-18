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


# Optional body (pose) features: WHERE on the body each hand is. Clips from extract_pose.py carry MediaPipe Pose
# points: pose (T, 33, 4) = x, y, z, visibility, and pose_seen (T,). 12 more numbers per frame, appended after the
# 132: per hand slot, the wrist and the index fingertip measured from the nose, and the wrist from the middle of the
# shoulders, all in shoulder widths (zeros when that hand or the shoulders are not seen). A browser that uses a
# pose model must compute exactly these numbers too.
POSE_FEATURES = 12
NOSE, L_SHOULDER, R_SHOULDER, INDEX_TIP = 0, 11, 12, 8


def anchors(pose, pose_seen, aspect):
    """Per-clip nose, shoulder centre and shoulder width (medians over frames where both shoulders are visible)."""
    ok = pose_seen & (pose[:, L_SHOULDER, 3] > 0.5) & (pose[:, R_SHOULDER, 3] > 0.5)
    if not ok.any():
        return None
    p = pose[ok].astype(np.float32).copy()
    p[..., 0] *= aspect
    nose = np.median(p[:, NOSE, :2], axis=0)
    sc = np.median((p[:, L_SHOULDER, :2] + p[:, R_SHOULDER, :2]) / 2, axis=0)
    width = float(np.median(np.linalg.norm(p[:, L_SHOULDER, :2] - p[:, R_SHOULDER, :2], axis=-1)))
    return nose, sc, max(width, 0.05)


def featurize_pose(pts, seen, pose, pose_seen, w, h, steps=STEPS):
    """Returns (steps, 132 + 12) float32, or None when fewer than 4 frames have a hand."""
    base = featurize(pts, seen, w, h, steps)
    if base is None:
        return None
    a, b = span(seen)
    p = pts[a:b].astype(np.float32).copy()
    s = seen[a:b]
    aspect = w / h
    p[..., 0] *= aspect
    anc = anchors(pose[a:b], pose_seen[a:b], aspect) if pose is not None else None
    extra = np.zeros((steps, 2, 6), np.float32)
    if anc is not None:
        nose, sc, width = anc
        sel = np.minimum((np.arange(steps) * len(p) / steps).astype(int), len(p) - 1)
        for hnd in range(2):
            m = s[sel, hnd]
            wr = p[sel][m, hnd, WRIST, :2]
            tip = p[sel][m, hnd, INDEX_TIP, :2]
            extra[m, hnd] = np.concatenate([(wr - nose) / width, (tip - nose) / width, (wr - sc) / width], axis=-1)
    return np.concatenate([base, extra.reshape(steps, POSE_FEATURES)], axis=1)
