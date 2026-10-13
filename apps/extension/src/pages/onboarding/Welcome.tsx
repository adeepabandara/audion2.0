import { Button, Icon } from '@audion/ui';
import { Shell } from './Shell';

function Illustration() {
  return (
    <div className="ob__art" role="img" aria-label="A signing hand turning into sound waves">
      <Icon name="hand" size={96} />
      <svg
        width="72"
        height="96"
        viewBox="0 0 36 48"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path className="arc" d="M6 18a8 8 0 010 12" />
        <path className="arc" d="M14 12a16 16 0 010 24" />
        <path className="arc" d="M22 6a24 24 0 010 36" />
      </svg>
    </div>
  );
}

export function Welcome({ onStart }: { onStart(): void }) {
  return (
    <Shell center>
      <Illustration />
      <h1>Sign. Be heard in any Google Meet call.</h1>
      <p className="ob__privacy">
        <Icon name="lock" size={18} />
        Your video is processed to recognize signs and never stored.
      </p>
      <Button onClick={onStart}>Get started</Button>
    </Shell>
  );
}
