import type { ComposeRequest, RecognizeResponse, SpeakRequest } from '@audion/shared';

export interface RecognizeInput {
  clip: Buffer;
  mime: string;
}

export interface Recognizer {
  recognize(input: RecognizeInput): Promise<Omit<RecognizeResponse, 'latencyMs'>>;
}

export interface Composer {
  compose(input: ComposeRequest): Promise<string>;
}

export interface Speaker {
  speak(input: SpeakRequest): Promise<{ audio: Buffer; contentType: string }>;
}

export interface Services {
  mode: 'live' | 'mock';
  recognizer: Recognizer;
  composer: Composer;
  speaker: Speaker;
}
