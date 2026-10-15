import { Banner, Button, Card, Icon } from '@audion/ui';
import { useState } from 'react';
import type { TranscriptEntry } from '../lib/messages';

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function transcriptText(entries: TranscriptEntry[]): string {
  return entries.map((e) => `[${time(e.at)}] ${e.text}`).join('\n');
}

export interface SummaryCardProps {
  entries: TranscriptEntry[];
  /** Whether the signer allowed sending thumbs up/down (rating and sign labels only). */
  feedbackConsent: boolean;
  onCopy(text: string): Promise<boolean>;
  onFeedback(rating: 'up' | 'down'): Promise<boolean>;
  onClose(): void;
  style?: React.CSSProperties;
}

/** Shown when the call ends: everything Ola spoke, with timestamps. Held in memory; cleared on close. */
export function SummaryCard({
  entries,
  feedbackConsent,
  onCopy,
  onFeedback,
  onClose,
  style,
}: SummaryCardProps) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const [feedback, setFeedback] = useState<'idle' | 'sent' | 'failed' | 'off'>('idle');

  return (
    <Card
      className="ap-summary"
      title="Call summary"
      raised
      aria-label="Call summary"
      style={style}
    >
      <p className="ap-note">
        What Ola said for you in this call. It is kept in memory only and cleared when you close
        this.
      </p>
      <ol className="ap-transcript">
        {entries.map((e, i) => (
          <li key={i}>
            <time className="ap-note">{time(e.at)}</time> <span>{e.text}</span>
          </li>
        ))}
      </ol>
      <div className="ap-actions">
        <Button
          variant="secondary"
          icon="copy"
          onClick={async () => setCopied((await onCopy(transcriptText(entries))) ? 'ok' : 'failed')}
        >
          Copy
        </Button>
        <span role="status" className="ap-note">
          {copied === 'ok' && (
            <>
              <Icon name="check" size={14} /> Copied
            </>
          )}
          {copied === 'failed' && 'Couldn’t copy. Select the text instead.'}
        </span>
      </div>

      <div className="ap-feedback" role="group" aria-label="Was this accurate?">
        <span>Was this accurate?</span>
        {(['up', 'down'] as const).map((rating) => (
          <Button
            key={rating}
            variant="ghost"
            icon={rating === 'up' ? 'thumbs-up' : 'thumbs-down'}
            iconOnly
            disabled={feedback === 'sent'}
            onClick={async () => {
              if (!feedbackConsent) return setFeedback('off');
              setFeedback((await onFeedback(rating)) ? 'sent' : 'failed');
            }}
          >
            {rating === 'up' ? 'Yes, accurate' : 'No, not accurate'}
          </Button>
        ))}
      </div>
      <div role="status">
        {feedback === 'sent' && (
          <span className="ap-note">Thanks. Only your rating and the sign words were sent.</span>
        )}
        {feedback === 'failed' && <Banner tone="warning">Couldn’t send feedback right now.</Banner>}
        {feedback === 'off' && (
          <Banner tone="info">
            Feedback is off. Turn it on in Settings under Privacy to send ratings (sign words only,
            never video).
          </Banner>
        )}
      </div>

      <Button onClick={onClose}>Close</Button>
    </Card>
  );
}
