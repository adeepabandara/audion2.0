import { Banner, Button, Icon } from '@audion/ui';
import { useCallback, useEffect, useState } from 'react';
import type { CameraProblem } from '../../lib/camera';
import { queryPermission, requestMedia, type MediaKind } from '../../lib/permissions';
import { Shell, Steps } from './Shell';

type Access = 'needed' | 'allowed' | CameraProblem;

const PROBLEM_TEXT: Record<CameraProblem, string> = {
  blocked:
    'Chrome is blocking this. Click the lock or camera icon in the address bar, choose Allow, then press Try again.',
  busy: 'Another app is using it. Close other apps that use your camera or microphone, then press Try again.',
  missing: 'No device was found. Plug one in or check your system settings, then press Try again.',
  unknown: 'Something went wrong asking for access. Press Try again.',
};

export function Permissions({ onBack, onNext }: { onBack(): void; onNext(): void }) {
  const [camera, setCamera] = useState<Access>('needed');
  const [mic, setMic] = useState<Access>('needed');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      if ((await queryPermission('camera')) === 'granted') setCamera('allowed');
      if ((await queryPermission('microphone')) === 'granted') setMic('allowed');
    })();
  }, []);

  const request = useCallback(async () => {
    setBusy(true);
    const [c, m] = [await requestMedia('camera'), await requestMedia('microphone')];
    setCamera(c.ok ? 'allowed' : c.problem);
    setMic(m.ok ? 'allowed' : m.problem);
    setBusy(false);
  }, []);

  const rows: Array<{
    kind: MediaKind;
    title: string;
    desc: string;
    icon: 'camera' | 'mic';
    state: Access;
  }> = [
    {
      kind: 'camera',
      title: 'Camera',
      desc: 'Lets Audion see your signs. Video stays on your device except short clips sent to recognize one sign.',
      icon: 'camera',
      state: camera,
    },
    {
      kind: 'microphone',
      title: 'Microphone channel',
      desc: 'Carries Audion’s voice into the call alongside your own microphone, so everyone hears you.',
      icon: 'mic',
      state: mic,
    },
  ];
  const problems = rows.filter((r) => r.state !== 'needed' && r.state !== 'allowed');
  const allAllowed = camera === 'allowed' && mic === 'allowed';

  return (
    <Shell center>
      <Steps active={[1]} />
      <div className="ob__bigicon">
        <Icon name="camera" size={44} />
      </div>
      <h1>Allow camera and microphone</h1>
      <p>
        Audion needs both to work in a call. Chrome may ask once more on Google Meet itself, because
        Meet is a different site.
      </p>
      <div className="ob__rows">
        {rows.map((r) => (
          <div className="ob__row" key={r.kind}>
            <Icon name={r.icon} size={28} />
            <div>
              <strong>{r.title}</strong>
              <span className="desc">{r.desc}</span>
            </div>
            <span role="status">
              {r.state === 'allowed' ? (
                <span className="au-pill au-pill--ok">
                  <Icon name="check-circle" size={18} /> Allowed
                </span>
              ) : r.state === 'needed' ? (
                <span className="au-pill">
                  <Icon name="info" size={18} /> Needed
                </span>
              ) : (
                <span className="au-pill au-pill--warn">
                  <Icon name="alert" size={18} /> Blocked
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      {problems.map((r) => (
        <Banner key={r.kind} tone="warning" title={`${r.title}: `}>
          {PROBLEM_TEXT[r.state as CameraProblem]}
        </Banner>
      ))}
      <div className="ob__actions">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        {allAllowed ? (
          <Button onClick={onNext}>Continue</Button>
        ) : (
          <Button onClick={request} disabled={busy} icon={busy ? 'spinner' : undefined}>
            {problems.length ? 'Try again' : 'Allow access'}
          </Button>
        )}
      </div>
    </Shell>
  );
}
