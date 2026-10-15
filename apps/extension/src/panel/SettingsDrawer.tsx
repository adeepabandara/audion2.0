import { Banner, Button, Drawer, Icon, Segmented, Toggle } from '@audion/ui';
import { VoicePicker } from '../components/VoicePicker';
import { getSettingsStore } from '../lib/settings';

const COMING_SOON = ['Spanish', 'French'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ap-section" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export interface SettingsDrawerProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onShowSigns(): void;
  /** Which model the server reported for the last (or next) recognition; null before Ola has asked. */
  modelId?: string | null;
}

/** The pause choice nearest to a stored value. */
const pauseChoice = (ms: number): '1500' | '3000' | '4500' =>
  ms < 2250 ? '1500' : ms < 3750 ? '3000' : '4500';

export function SettingsDrawer({
  open,
  onOpenChange,
  onShowSigns,
  modelId = null,
}: SettingsDrawerProps) {
  const { useStore } = getSettingsStore();
  const s = useStore((st) => st.settings);
  const update = useStore((st) => st.update);

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      modal={false}
      title="Settings"
      description="Changes save automatically."
    >
      <Section title="Voice and speed">
        <VoicePicker heading={false} />
      </Section>

      <Section title="When Ola speaks">
        <Segmented
          label="When Ola speaks"
          value={s.speakMode}
          onValueChange={(speakMode) => void update({ speakMode })}
          options={[
            { value: 'auto', label: 'Auto-speak', icon: 'wave' },
            { value: 'confirm', label: 'Confirm first', icon: 'eye' },
          ]}
        />
        <p className="ap-note">
          {s.speakMode === 'auto'
            ? 'Sentences are spoken as soon as they are ready.'
            : 'You review each sentence, then press Speak.'}
        </p>
        <Toggle
          label="Hear Ola’s voice on this device"
          checked={s.monitorVoice}
          onCheckedChange={(monitorVoice) => void update({ monitorVoice })}
        />
        <p className="ap-note">
          Meet doesn’t play your own microphone back to you, so this plays Ola’s voice on your
          speakers too. Use headphones so your microphone doesn’t pick it up again.
        </p>
      </Section>

      <Section title="Meeting context">
        <Toggle
          label="Use the meeting to word sentences"
          checked={s.meetingContext}
          onCheckedChange={(meetingContext) => void update({ meetingContext })}
        />
        <p className="ap-note">
          Ola reads the live captions of the meeting (turn captions on in Meet with the CC button),
          has Gemini keep a short summary of what is being discussed, and uses it to word your
          sentences better. The captions are other people’s words: they are sent to Google Cloud to
          be summarised only while this is on, are never stored, and are forgotten when you turn Ola
          off. Off by default.
        </p>
      </Section>

      <Section title="Sentence pause">
        <Segmented
          label="Sentence pause"
          value={pauseChoice(s.pauseMs)}
          onValueChange={(v) => void update({ pauseMs: Number(v) })}
          options={[
            { value: '1500', label: 'Short' },
            { value: '3000', label: 'Normal' },
            { value: '4500', label: 'Long' },
          ]}
        />
        <p className="ap-note">
          How long Ola waits after your last sign before it joins the signs into a sentence. If each
          sign is spoken on its own, choose a longer pause.
        </p>
      </Section>

      <Section title="Speed">
        <Toggle
          label="Fast signs on this device"
          checked={s.fastSigns}
          onCheckedChange={(fastSigns) => void update({ fastSigns })}
        />
        <p className="ap-note">
          Ola names signs on this device, in milliseconds, with no cloud call. If the on-device
          model is under 50% sure it asks you to sign again. Turn this off to send every sign to the
          cloud model instead.
        </p>
        <Toggle
          label="Have Gemini double-check signs"
          checked={s.cloudCheck}
          onCheckedChange={(cloudCheck) => void update({ cloudCheck })}
        />
        <p className="ap-note">
          Sends a short video clip of each sign to Google Cloud as well, and corrects the sign if
          Gemini disagrees. It is slower and costs a cloud call per sign.
        </p>
      </Section>

      <Section title="Captions">
        <Segmented
          label="Caption size"
          value={s.captionSize}
          onValueChange={(captionSize) => void update({ captionSize })}
          options={[
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
            { value: 'large', label: 'Large' },
          ]}
        />
        <Segmented
          label="Caption position"
          value={s.captionPosition}
          onValueChange={(captionPosition) => void update({ captionPosition })}
          options={[
            { value: 'bottom', label: 'Bottom' },
            { value: 'top', label: 'Top' },
          ]}
        />
        <Toggle
          label="Also post sentences to Meet chat"
          checked={s.postToChat}
          onCheckedChange={(postToChat) => void update({ postToChat })}
        />
        <Banner tone="info">
          Other people can’t see Ola’s own caption bar. They hear your voice, so Meet’s live
          captions will caption it if they have captions on. Posting to chat lets everyone read your
          sentences too.
        </Banner>
      </Section>

      <Section title="Appearance">
        <Segmented
          label="Theme"
          value={s.theme}
          onValueChange={(theme) => void update({ theme })}
          options={[
            { value: 'system', label: 'System', icon: 'sparkle' },
            { value: 'light', label: 'Light', icon: 'sun' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Section>

      <Section title="Language">
        <ul className="ap-lang">
          <li>
            <Icon name="check" size={18} /> English <span className="ap-note">(selected)</span>
          </li>
          {COMING_SOON.map((l) => (
            <li key={l} aria-disabled="true" className="ap-lang--off">
              {l} <span className="ap-note">Coming soon</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Privacy">
        <Toggle label="Don’t store any video" checked disabled />
        <p className="ap-note">
          <Icon name="lock" size={14} /> This is always on. Ola never stores video: short clips are
          sent only to recognise a sign, held in memory, and discarded.
        </p>
        <Toggle
          label="Send thumbs up/down feedback (sign labels only, never video)"
          checked={s.feedbackConsent}
          onCheckedChange={(feedbackConsent) => void update({ feedbackConsent })}
        />
      </Section>

      <Section title="Signs">
        <Button variant="secondary" icon="hand" onClick={onShowSigns}>
          See supported signs
        </Button>
      </Section>

      <Section title="About">
        <p className="ap-note">
          Ola’s sign recognition model is tuned on PopSign ASL v1.0 (CC BY 4.0) by Georgia Tech and
          the Deaf Professional Arts Network.
        </p>
        <p className="ap-note">
          Recognition model: <strong>{modelId ?? 'not known yet (turn Ola on)'}</strong>
        </p>
      </Section>
    </Drawer>
  );
}
