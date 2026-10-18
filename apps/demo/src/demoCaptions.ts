/**
 * The web demo has no real Meet call, so its "meeting" is a short scripted conversation shown as live captions in the
 * call window. The very same MeetingContext that reads Meet's captions in the extension reads these: they are
 * summarised by Gemini at regular intervals, and the summary is used to word sentences. The lines are made up for
 * this demo (a team planning a product demo).
 */
export interface CaptionLine {
  speaker: string;
  text: string;
}

export const DEMO_MEETING: CaptionLine[] = [
  { speaker: 'Priya', text: 'Okay, let us go over the plan for the customer demo.' },
  { speaker: 'Marcus', text: 'The demo is on Friday at three in the afternoon.' },
  { speaker: 'Dana', text: 'I will prepare the slides and the budget numbers by Thursday.' },
  { speaker: 'Priya', text: 'Marcus, can you check the room and the projector?' },
  { speaker: 'Marcus', text: 'Yes, I will visit the room tomorrow morning.' },
  { speaker: 'Dana', text: 'We still need to decide who presents the pricing section.' },
  {
    speaker: 'Priya',
    text: 'I think Marcus should present pricing, and I will present the overview.',
  },
  { speaker: 'Marcus', text: 'Fine. Please send me the pricing notes today.' },
  { speaker: 'Dana', text: 'Done, I will send them right after this meeting.' },
  { speaker: 'Priya', text: 'Great. Any other questions about the schedule or the room?' },
];

type Snapshot = (lines: string[]) => void;

/** Plays the script, one caption every `everyMs`, and lets listeners follow it (with the backlog on joining). */
export class ScriptedCaptions {
  private shown: CaptionLine[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly listeners = new Set<Snapshot>();
  private readonly viewers = new Set<(recent: CaptionLine[]) => void>();

  constructor(
    private readonly script: CaptionLine[] = DEMO_MEETING,
    private readonly everyMs = 3500,
  ) {}

  /** Start playing (once). */
  start(): void {
    if (this.timer !== undefined || this.shown.length >= this.script.length) return;
    this.next();
    this.timer = setInterval(() => this.next(), this.everyMs);
  }

  private next(): void {
    const line = this.script[this.shown.length];
    if (!line) {
      clearInterval(this.timer);
      return;
    }
    this.shown.push(line);
    this.listeners.forEach((l) => l(this.flatten(this.shown.slice(-3))));
    this.viewers.forEach((v) => v(this.shown.slice(-2)));
    if (this.shown.length >= this.script.length) clearInterval(this.timer);
  }

  /** Speaker name and words as separate lines, the way Meet's caption area reads. */
  private flatten(lines: CaptionLine[]): string[] {
    return lines.flatMap((l) => [l.speaker, l.text]);
  }

  /** For the meeting-context tracker: gets what was said so far at once, then each new snapshot. */
  watch = (onSnapshot: Snapshot): (() => void) => {
    this.listeners.add(onSnapshot);
    if (this.shown.length) onSnapshot(this.flatten(this.shown));
    return () => this.listeners.delete(onSnapshot);
  };

  /** For the caption strip drawn in the call window. */
  view(onRecent: (recent: CaptionLine[]) => void): () => void {
    this.viewers.add(onRecent);
    if (this.shown.length) onRecent(this.shown.slice(-2));
    return () => this.viewers.delete(onRecent);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
