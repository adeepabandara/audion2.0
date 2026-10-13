import { basename, extname, isAbsolute, join } from 'node:path';
import { normaliseSign, type Sign } from '@audion/shared';

export interface EvalItem {
  /** Where the clip is on THIS machine. */
  path: string;
  mime: string;
  label: Sign;
  line: number;
}

const MIME: Record<string, string> = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

export class ManifestError extends Error {}

interface TuningPart {
  text?: string;
  fileData?: { mimeType?: string; fileUri?: string };
}
interface TuningLine {
  contents?: Array<{ role?: string; parts?: TuningPart[] }>;
  clip?: string;
  label?: string;
  mime?: string;
}

/**
 * Parse one line of the labelled list. Two formats:
 *   - Vertex tuning JSONL (what the model was tuned on): the user turn holds fileData.fileUri (usually gs://...),
 *     the model turn holds the label. The clip is looked up by file name inside `clipsDir`; nothing is fetched
 *     from gs://.
 *   - Simple: {"clip": "path/or/name.webm", "label": "hello", "mime": "video/webm"}
 */
export function parseLine(raw: string, line: number, clipsDir: string): EvalItem {
  let obj: TuningLine;
  try {
    obj = JSON.parse(raw) as TuningLine;
  } catch {
    throw new ManifestError(`line ${line}: not valid JSON`);
  }

  let ref: string | undefined;
  let labelRaw: string | undefined;
  let mime: string | undefined;
  if (obj.contents) {
    const user = obj.contents.find((c) => c.role === 'user')?.parts ?? [];
    const model = obj.contents.find((c) => c.role === 'model')?.parts ?? [];
    const file = user.find((p) => p.fileData)?.fileData;
    ref = file?.fileUri;
    mime = file?.mimeType;
    labelRaw = model.find((p) => typeof p.text === 'string')?.text;
  } else {
    ref = obj.clip;
    labelRaw = obj.label;
    mime = obj.mime;
  }
  if (!ref) throw new ManifestError(`line ${line}: no clip reference`);
  if (!labelRaw) throw new ManifestError(`line ${line}: no label`);

  const label = normaliseSign(labelRaw);
  if (label === 'unknown')
    throw new ManifestError(`line ${line}: label "${labelRaw}" is not in the vocabulary`);

  const isUri = /^[a-z]+:\/\//i.test(ref);
  const path = isUri ? join(clipsDir, basename(ref)) : isAbsolute(ref) ? ref : join(clipsDir, ref);
  return { path, mime: mime ?? MIME[extname(path).toLowerCase()] ?? 'video/webm', label, line };
}

export function parseManifest(
  text: string,
  clipsDir: string,
): { items: EvalItem[]; errors: string[] } {
  const items: EvalItem[] = [];
  const errors: string[] = [];
  text.split('\n').forEach((raw, i) => {
    if (!raw.trim()) return;
    try {
      items.push(parseLine(raw, i + 1, clipsDir));
    } catch (e) {
      errors.push((e as Error).message);
    }
  });
  return { items, errors };
}
