import { Icon } from '@audion/ui';
import { Shell } from './Shell';

export function Done() {
  return (
    <Shell center>
      <div className="ob__bigicon">
        <Icon name="check-circle" size={44} />
      </div>
      <h1>You’re all set</h1>
      <p>
        Open a Google Meet call, then turn Audion on from the pill at the bottom right. If your call
        tab was open before you installed Audion, reload it once so Audion can speak in the call.
      </p>
      <a
        className="au-btn au-btn--primary"
        href="https://meet.google.com/"
        target="_blank"
        rel="noreferrer"
      >
        Open Google Meet
      </a>
    </Shell>
  );
}
