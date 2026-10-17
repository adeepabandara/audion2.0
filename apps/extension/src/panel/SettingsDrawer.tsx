import { Banner, Button, Drawer, Icon, LanguageMenu, Segmented, Tabs, Toggle } from '@audion/ui';
import { describeProfile, type LanguageCode } from '@audion/shared';
import { useState } from 'react';
import { VoicePicker } from '../components/VoicePicker';
import { VoiceSetup } from '../components/VoiceSetup';
import { getSettingsStore } from '../lib/settings';
import { LANGUAGE_OPTIONS } from './languages';
import { SignsGrid } from './SignsGrid';

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
  /** Which model the server reported for the last (or next) recognition; null before Ola has asked. */
  modelId?: string | null;
}

/** The pause choice nearest to a stored value. */
const pauseChoice = (ms: number): '1500' | '3000' | '4500' =>
  ms < 2250 ? '1500' : ms < 3750 ? '3000' : '4500';

/** Settings in five tabs: what people reach for most (language and voice) first, the reference material last. */
export function SettingsDrawer({ open, onOpenChange, modelId = null }: SettingsDrawerProps) {
  const { useStore } = getSettingsStore();
  const s = useStore((st) => st.settings);
  const update = useStore((st) => st.update);
  const [settingUp, setSettingUp] = useState(false);

  const voice = (
    <>
      <Section title="Translate to">
        <LanguageMenu
          label="Translate Ola’s sentences into"
          value={s.language}
          options={LANGUAGE_OPTIONS}
          onValueChange={(v) => void update({ language: v as LanguageCode })}
          side="bottom"
          align="start"
        />
        <p className="ap-note">
          {s.language === 'en'
            ? 'Ola speaks your sentences in English. Pick a language to have them translated, shown and spoken in it.'
            : 'Each sentence is translated by Gemini, then shown and spoken in this language.'}
        </p>
      </Section>
      <Section title="My voice">
        <p className="ap-note">
          {s.voiceSetupDone ? 'Your voice' : 'Not set up yet'}:{' '}
          <strong>{describeProfile({ voiceId: s.voiceId, pitch: s.pitch, speed: s.speed })}</strong>
        </p>
        {settingUp ? (
          <VoiceSetup onSaved={() => setSettingUp(false)} />
        ) : (
          <Button variant="secondary" icon="wave" onClick={() => setSettingUp(true)}>
            {s.voiceSetupDone ? 'Set up my voice again' : 'Set up my voice'}
          </Button>
        )}
        <p className="ap-note">
          Answer a few questions, then hear, see and check how your voice sounds to others.
        </p>
      </Section>
      <Section title="Choose by hand">
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
    </>
  );

  const signing = (
    <>
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
          How long Ola waits after your last sign before joining the signs into a sentence. If each
          sign is spoken alone, choose a longer pause.
        </p>
      </Section>
      <Section title="Recognition">
        <Toggle
          label="Fast signs on this device"
          checked={s.fastSigns}
          onCheckedChange={(fastSigns) => void update({ fastSigns })}
        />
        <p className="ap-note">
          Signs are named on this device in milliseconds, with no cloud call. Under 50% sure, Ola
          asks you to sign again. Off sends every sign to the cloud model instead.
        </p>
        <Toggle
          label="Have Gemini double-check signs"
          checked={s.cloudCheck}
          onCheckedChange={(cloudCheck) => void update({ cloudCheck })}
        />
        <p className="ap-note">
          Also sends a short clip of each sign to Google Cloud and corrects it if Gemini disagrees.
          Slower, and one cloud call per sign.
        </p>
      </Section>
      <Section title="Meeting context">
        <Toggle
          label="Use the meeting to word sentences"
          checked={s.meetingContext}
          onCheckedChange={(meetingContext) => void update({ meetingContext })}
        />
        <p className="ap-note">
          Ola reads the meeting’s live captions (turn on CC in Meet), has Gemini keep a short
          summary and uses it to word your sentences. The captions are other people’s words: sent to
          Google Cloud only while this is on, never stored, forgotten when Ola turns off. Off by
          default.
        </p>
      </Section>
    </>
  );

  const display = (
    <>
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
          Other people can’t see Ola’s caption bar. They hear your voice, so Meet’s live captions
          caption it if they have captions on. Posting to chat lets everyone read your sentences.
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
    </>
  );

  const about = (
    <>
      <Section title="Privacy">
        <Toggle label="Don’t store any video" checked disabled />
        <p className="ap-note">
          <Icon name="lock" size={14} /> Always on. Ola never stores video: short clips are held in
          memory and discarded.
        </p>
        <Toggle
          label="Send thumbs up/down feedback (sign labels only, never video)"
          checked={s.feedbackConsent}
          onCheckedChange={(feedbackConsent) => void update({ feedbackConsent })}
        />
      </Section>
      <Section title="About">
        <p className="ap-note">
          Ola’s sign model learned from PopSign ASL v1.0 (CC BY 4.0) by Georgia Tech and the Deaf
          Professional Arts Network.
        </p>
        <p className="ap-note">
          Recognition model: <strong>{modelId ?? 'not known yet (turn Ola on)'}</strong>
        </p>
      </Section>
    </>
  );

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      modal={false}
      width={440}
      title="Settings"
      description="Changes save automatically."
    >
      <Tabs
        label="Settings sections"
        tabs={[
          { id: 'voice', label: 'Voice', panel: voice },
          { id: 'signing', label: 'Signing', panel: signing },
          { id: 'signs', label: 'Signs', panel: <SignsGrid /> },
          { id: 'display', label: 'Display', panel: display },
          { id: 'about', label: 'About', panel: about },
        ]}
      />
    </Drawer>
  );
}
