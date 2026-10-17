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
  /** `linear16`: 16 kHz raw PCM, for Speech-to-Text (the voice check) instead of the MP3 sent to the browser. */
  speak(
    input: SpeakRequest,
    opts?: { linear16?: boolean },
  ): Promise<{ audio: Buffer; contentType: string }>;
  warmUp?(): Promise<void>;
}

export interface Transcriber {
  /** What Speech-to-Text hears in 16 kHz linear PCM audio. Nothing is stored or logged. */
  transcribe(input: { audio: Buffer; languageCode: string; hint?: string }): Promise<string>;
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
  /** Google Speech-to-Text, or the mock that repeats the text it was given. */
  transcriber: Transcriber;
  transcriberMode: 'google' | 'mock';
}
