import { Button, Banner } from '@audion/ui';
import { useState } from 'react';
import { Calibration } from './Calibration';
import { Shell, Steps } from './Shell';
import { VoicePicker } from '../../components/VoicePicker';
import { VoiceSetup } from '../../components/VoiceSetup';

export function Setup({ onBack, onFinish }: { onBack(): void; onFinish(): void }) {
  const [passed, setPassed] = useState(false);
  // The sign check proves the camera and recognition work, but it needs a correct "hello". Someone who does not
  // sign yet (or a pilot model that misreads it) must still be able to finish setup, so it can be skipped.
  const [skipped, setSkipped] = useState(false);
  const canFinish = passed || skipped;
  const [byHand, setByHand] = useState(false);
  return (
    <Shell>
      <Steps active={[2, 3]} />
      <div className="ob__cols">
        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <h2>Set up your voice</h2>
          <p>
            Answer a few questions. You’ll hear each voice, see its sound and check what others will
            hear.
          </p>
          {byHand ? <VoicePicker heading={false} /> : <VoiceSetup />}
          <Button variant="ghost" onClick={() => setByHand((b) => !b)}>
            {byHand ? 'Back to the questions' : 'Pick a voice by hand instead'}
          </Button>
        </div>
        <Calibration onPassed={setPassed} />
      </div>
      {!canFinish && (
        <Banner tone="info">
          Finish setup unlocks after your camera check passes. Don’t sign yet? You can skip the sign
          check.
        </Banner>
      )}
      {skipped && !passed && (
        <Banner tone="info">
          Sign check skipped. Ola’s Settings, under Signs, shows how to make each sign.
        </Banner>
      )}
      <div className="ob__actions">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        {!canFinish && (
          <Button variant="ghost" onClick={() => setSkipped(true)}>
            Skip the sign check
          </Button>
        )}
        <Button onClick={onFinish} disabled={!canFinish}>
          Finish setup
        </Button>
      </div>
    </Shell>
  );
}
