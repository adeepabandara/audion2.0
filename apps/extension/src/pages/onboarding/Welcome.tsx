import { Button, Icon } from '@audion/ui';
import { Shell } from './Shell';

const PLATFORMS: Array<{ name: string; available: boolean }> = [
  { name: 'Google Meet', available: true },
  { name: 'Microsoft Teams', available: false },
  { name: 'Zoom', available: false },
];

export function Welcome({ onStart }: { onStart(): void }) {
  return (
    <Shell center fixed logoSize={104}>
      <h1>Sign. Be heard in any video call.</h1>
      <p className="ob__lead">
        Ola by Audion turns your sign language into spoken words and captions, live, so you can join
        meetings in your own voice.
      </p>

      <section className="ob__section" aria-labelledby="ob-where">
        <h2 id="ob-where">Works where you meet</h2>
        <ul className="ob__platforms">
          {PLATFORMS.map((p) => (
            <li key={p.name}>
              <span className="ob__platform-name">{p.name}</span>
              <span className={`ob__platform-status${p.available ? ' is-available' : ''}`}>
                <Icon name={p.available ? 'check' : 'sparkle'} size={14} />
                {p.available ? 'Available now' : 'Coming soon'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="ob__privacy">
        <Icon name="lock" size={18} />
        Your video is processed to recognize signs and never stored.
      </p>
      <Button onClick={onStart}>Get started</Button>
      <p className="ob__fine">
        Ola is not affiliated with Google, Microsoft or Zoom. Their names are trademarks of their
        owners.
      </p>
    </Shell>
  );
}
