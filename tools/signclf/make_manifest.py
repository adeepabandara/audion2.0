"""Pick a seeded random sample of PopSign clips per sign and split from the owner's bucket (listing only, nothing downloaded).
Usage: python make_manifest.py OUT.json [--bucket gs://signvoice-data/popsign_v1_0/raw] [--per train=100,val=25,test=25]
Needs `gcloud` signed in. The manifest holds bucket paths only (no video, no data): still keep it out of git.
"""
import argparse, json, random, subprocess
from pathlib import Path

SIGNS = "hello bye yes no please thankyou wait why who where now later tomorrow time finish think look listen talk fine same not".split()

def ls(gcloud: str, url: str) -> list[str]:
    out = subprocess.run([gcloud, "storage", "ls", url], capture_output=True, text=True)
    return [l.strip() for l in out.stdout.splitlines() if l.strip().endswith(".mp4")]

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--bucket", default="gs://signvoice-data/popsign_v1_0/raw")
    ap.add_argument("--per", default="train=100,val=25,test=25")
    ap.add_argument("--gcloud", default=str(Path.home() / "google-cloud-sdk/bin/gcloud"))
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    per = {k: int(v) for k, v in (p.split("=") for p in a.per.split(","))}
    rng = random.Random(a.seed)
    manifest, found = [], {}
    for sign in SIGNS:
        for split, n in per.items():
            files = ls(a.gcloud, f"{a.bucket}/{sign.upper()}/{split}/")
            found[f"{sign}/{split}"] = len(files)
            for f in rng.sample(files, min(n, len(files))):
                manifest.append({"sign": sign, "split": split, "uri": f})
    Path(a.out).write_text(json.dumps({"seed": a.seed, "found": found, "clips": manifest}, indent=1))
    print(f"{len(manifest)} clips; fewer than asked for: {[k for k, v in found.items() if v < per[k.split('/')[1]]]}")

if __name__ == "__main__":
    main()
