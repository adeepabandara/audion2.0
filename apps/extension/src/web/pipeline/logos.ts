import type { NodeId } from './model';

/**
 * Official Google logos for the steps that are Google products, files in `web/public/logos/` (served at `/logos/`).
 * They are used as supplied: not redrawn, recoloured or distorted, and always on a white disc so their own colours
 * read the same in the dark view. A step without an entry keeps its line icon. Follow Google's brand guidelines when
 * changing these.
 */
export interface Logo {
  src: string;
  /** Accessible name of the product. */
  name: string;
}

/** A wide wordmark: the part of the picture to show (x, y, width, height in the file's pixels). */
export interface Wordmark extends Logo {
  crop: [number, number, number, number];
}

const file = (name: string) => `/logos/${name}`;

/** The picture in each step's round badge. */
export const LOGOS: Partial<Record<NodeId, Logo>> = {
  api: { src: file('google-cloud-transparent.png'), name: 'Google Cloud (Cloud Run)' },
  gemini: { src: file('gemini.png'), name: 'Gemini' },
  sentence: { src: file('gemma.png'), name: 'Gemma' },
  tts: { src: file('google-cloud-transparent.png'), name: 'Google Cloud' },
  stt: { src: file('google-cloud-transparent.png'), name: 'Google Cloud' },
  captions: { src: file('meet.webp'), name: 'Google Meet' },
};

/** A wordmark shown in place of a step's subtitle (it is too wide for the round badge). */
export const WORDMARKS: Partial<Record<NodeId, Wordmark>> = {
  mediapipe: { src: file('google-ai-edge.png'), name: 'Google AI Edge', crop: [90, 205, 790, 135] },
};

/** A second, smaller logo in the top-right corner of a step. */
export const BADGES: Partial<Record<NodeId, Logo>> = {
  gemini: { src: file('vertex-ai.png'), name: 'Vertex AI' },
};

/** Next to the "GOOGLE CLOUD" label of the cloud area. */
export const CLOUD_ZONE_LOGO: Logo = { src: file('google-cloud.png'), name: 'Google Cloud' };
