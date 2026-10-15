import type {
  ComposeRequest,
  ContextRequest,
  RecognizeResponse,
  SpeakRequest,
  TranslateRequest,
} from '@audion/shared';

export interface RecognizeInput {
  clip: Buffer;
  mime: string;
}

export interface Recognizer {
  /** Which model answers: "mock", the base model name, or "tuned:<endpoint id>". Shown to testers. */
  readonly modelId: string;
  recognize(input: RecognizeInput): Promise<Omit<RecognizeResponse, 'latencyMs'>>;
  warmUp?(): Promise<void>;
}

export interface Composer {
  compose(input: ComposeRequest): Promise<string>;
  /** Best-effort: make the first real request fast (connection, credentials). Never throws. */
  warmUp?(): Promise<void>;
}

export interface Summarizer {
  /** The updated meeting summary from the previous one plus new live-caption text. Nothing is stored or logged. */
  summarize(input: ContextRequest): Promise<string>;
  warmUp?(): Promise<void>;
}

export interface Translator {
  /** The sentence in the target language. Nothing is stored or logged. */
  translate(input: TranslateRequest): Promise<string>;
  warmUp?(): Promise<void>;
}

export interface Speaker {
  speak(input: SpeakRequest): Promise<{ audio: Buffer; contentType: string }>;
  warmUp?(): Promise<void>;
}

export interface Services {
  mode: 'live' | 'mock';
  /** Which voices speak: Google Cloud Text-to-Speech, or the mock placeholder tone. */
  voices: 'google' | 'mock';
  recognizer: Recognizer;
  composer: Composer;
  summarizer: Summarizer;
  translator: Translator;
  speaker: Speaker;
}
