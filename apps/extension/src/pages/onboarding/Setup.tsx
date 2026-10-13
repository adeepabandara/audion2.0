import { Button, Banner } from '@audion/ui';
import { useState } from 'react';
import { Calibration } from './Calibration';
import { Shell, Steps } from './Shell';
import { VoicePicker } from '../../components/VoicePicker';

export function Setup({ onBack, onFinish }: { onBack(): void; onFinish(): void }) {
  const [passed, setPassed] = useState(false);
  return (
    <Shell>
      <Steps active={[2, 3]} />
      <div className="ob__cols">
        <VoicePicker />
        <Calibration onPassed={setPassed} />
      </div>
      {!passed && <Banner tone="info">Finish setup unlocks after your camera check passes.</Banner>}
      <div className="ob__actions">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onFinish} disabled={!passed}>
          Finish setup
        </Button>
      </div>
    </Shell>
  );
}
