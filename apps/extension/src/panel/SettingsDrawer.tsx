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
}

export function SettingsDrawer({ open, onOpenChange, onShowSigns }: SettingsDrawerProps) {
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

      <Section title="When Audion speaks">
        <Segmented
          label="When Audion speaks"
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
          Other people can’t see Audion’s own caption bar. They hear your voice, so Meet’s live
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
          <Icon name="lock" size={14} /> This is always on. Audion never stores video: short clips
          are sent only to recognise a sign, held in memory, and discarded.
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
          Audion’s sign recognition model is tuned on PopSign ASL v1.0 (CC BY 4.0) by Georgia Tech
          and the Deaf Professional Arts Network.
        </p>
      </Section>
    </Drawer>
  );
}
