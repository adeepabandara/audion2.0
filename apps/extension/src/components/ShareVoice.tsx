import { Banner, Button, Icon, Modal } from '@audion/ui';
import {
  applyFeedback,
  describeProfile,
  FEEDBACK,
  fillTemplate,
  LANGUAGES,
  MAX_SHARE_CHARS,
  SHARE_TEMPLATES,
  speakable,
  type Feedback,
  type LanguageCode,
  type VoiceProfile,
} from '@audion/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { analyseAudio, playAudio, type Playback } from '../lib/audioPlayer';
import { fromBase64, send } from '../lib/messages';
import { getSettingsStore } from '../lib/settings';
import { VoiceNote } from './VoiceNote';

type Note =
  | { state: 'idle' }
  | { state: 'making' }
  | {
      state: 'ready';
      bytes: Uint8Array;
      mime: string;
      duration: number;
      peaks: number[];
      forKey: string;
    }
  | { state: 'error'; message: string };

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const keyOf = (text: string, p: VoiceProfile, language: string) =>
  `${p.voiceId}|${p.pitch}|${p.speed}|${language}|${speakable(text)}`;

export interface ShareVoiceProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  profile: VoiceProfile;
  /** The person's reply changed the pitch or pace. */
  onProfileChange(p: VoiceProfile): void;
  /** The person's reply was "try another voice". */
  onAnotherVoice?(): void;
}

/**
 * "Ask someone to listen": a pop-up with a message to a person you trust, and a voice note that is that very message
 * read in the voice being checked. It can be sent through the device's share sheet, downloaded or copied. When they
 * reply (👍, higher, lower, faster, slower), a tap adjusts the voice and remakes the note. Nothing is stored: the
 * note lives in this page and the message is turned into speech like any sentence (and not logged).
 */
export function ShareVoice({
  open,
  onOpenChange,
  profile,
  onProfileChange,
  onAnotherVoice,
}: ShareVoiceProps) {
  const settings = getSettingsStore().useStore((s) => s.settings);
  const [templateId, setTemplateId] = useState<(typeof SHARE_TEMPLATES)[number]['id']>('family');
  const [to, setTo] = useState('');
  const [language, setLanguage] = useState<LanguageCode>('en');
  const [text, setText] = useState('');
  const [note, setNote] = useState<Note>({ state: 'idle' });
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [translating, setTranslating] = useState(false);
  const playback = useRef<Playback | null>(null);
  const raf = useRef(0);
  const run = useRef(0);

  const stopPlayback = useCallback(() => {
    playback.current?.stop();
    cancelAnimationFrame(raf.current);
  }, []);
  useEffect(() => stopPlayback, [stopPlayback]);

  /** The message for a template, translated when another language is chosen. */
  const compose = useCallback(
    async (id: string, name: string, lang: LanguageCode): Promise<string> => {
      const t = SHARE_TEMPLATES.find((x) => x.id === id) ?? SHARE_TEMPLATES[0]!;
      const english = fillTemplate(t.text, { to: name, from: settings.displayName });
      if (lang === 'en') return english;
      setTranslating(true);
      const res = await send({ type: 'api/translate', text: english, language: lang });
      setTranslating(false);
      if (!res.ok) {
        setStatus('Translation failed. Using English.');
        return english;
      }
      return res.text;
    },
    [settings.displayName],
  );

  const makeNote = useCallback(
    async (message: string, p: VoiceProfile, lang: LanguageCode) => {
      const mine = ++run.current;
      stopPlayback();
      setPlaying(false);
      setProgress(0);
      setNote({ state: 'making' });
      const res = await send({
        type: 'api/speak',
        text: speakable(message),
        voiceId: p.voiceId,
        speed: p.speed,
        ...(p.pitch ? { pitch: p.pitch } : {}),
        ...(lang !== 'en' ? { language: lang } : {}),
      });
      if (mine !== run.current) return;
      if (!res.ok) {
        setNote({
          state: 'error',
          message:
            res.error.code === 'NETWORK'
              ? 'Can’t reach Ola. Try again.'
              : 'Couldn’t make the voice note.',
        });
        return;
      }
      try {
        const bytes = fromBase64(res.audioBase64);
        const a = await analyseAudio(bytes);
        if (mine !== run.current) return;
        setNote({
          state: 'ready',
          bytes,
          mime: res.contentType,
          duration: a.duration,
          peaks: a.peaks,
          forKey: keyOf(message, p, lang),
        });
        // A reply's message stays on screen; otherwise say the note is ready.
        setStatus((prev) => (/^(Made it|Trying another)/.test(prev) ? prev : 'Voice note ready.'));
      } catch {
        setNote({ state: 'error', message: 'Couldn’t play that on this device.' });
      }
    },
    [stopPlayback],
  );

  // Opening writes the message and makes the first voice note.
  useEffect(() => {
    if (!open) {
      run.current++;
      stopPlayback();
      return;
    }
    let live = true;
    void (async () => {
      const message = await compose(templateId, to, language);
      if (!live) return;
      setText(message);
      await makeNote(message, profile, language);
    })();
    return () => {
      live = false;
    };
    // Only when the pop-up opens; the controls below call rebuild() themselves.
  }, [open]);

  async function rebuild(id = templateId, name = to, lang = language) {
    const message = await compose(id, name, lang);
    setText(message);
    await makeNote(message, profile, lang);
  }

  async function toggle() {
    if (note.state !== 'ready') return;
    if (playing) return playback.current?.stop();
    try {
      const pb = await playAudio(note.bytes);
      playback.current = pb;
      setPlaying(true);
      setProgress(0);
      if (!reducedMotion()) {
        const tick = () => {
          setProgress(pb.duration ? pb.elapsed() / pb.duration : 0);
          raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
      }
      await pb.done;
    } catch {
      setStatus('Couldn’t play that on this device.');
    } finally {
      cancelAnimationFrame(raf.current);
      setPlaying(false);
      setProgress(1);
    }
  }

  const fresh = note.state === 'ready' && note.forKey === keyOf(text, profile, language);
  const ext = note.state === 'ready' && note.mime.includes('wav') ? 'wav' : 'mp3';

  const fileOf = () =>
    note.state === 'ready'
      ? new File([note.bytes as BlobPart], `ola-voice-note.${ext}`, { type: note.mime })
      : null;

  async function share() {
    const file = fileOf();
    const data = { title: 'My voice, from Ola', text, ...(file ? { files: [file] } : {}) };
    try {
      if (file && navigator.canShare?.(data)) {
        await navigator.share(data);
        setStatus('Shared. When they reply, tap their answer below.');
      } else if (navigator.share) {
        await navigator.share({ title: data.title, text });
        setStatus('Shared the message. Download the voice note and attach it.');
      } else {
        setStatus('Sharing isn’t available here. Download the voice note and copy the message.');
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError')
        setStatus('Couldn’t open sharing. Download the voice note and copy the message.');
    }
  }

  function download() {
    const file = fileOf();
    if (!file) return;
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setStatus('Voice note downloaded.');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Message copied.');
    } catch {
      setStatus('Couldn’t copy. Select the message and copy it.');
    }
  }

  function reply(f: Feedback) {
    if (f.id === 'good')
      return setStatus('Great, it sounds right to them. Use this voice when you are ready.');
    if (f.id === 'different') {
      setStatus('Trying another voice. Listen to the new note.');
      return onAnotherVoice?.();
    }
    const next = applyFeedback(profile, f.id);
    if (next.pitch === profile.pitch && next.speed === profile.speed) {
      return setStatus('That is as far as it can go. Try another voice.');
    }
    setStatus(`Made it ${f.label.replace('A bit ', 'a bit ')}. Listen to the new note.`);
    onProfileChange(next);
  }

  // A reply that changed the voice remakes the note.
  const lastProfile = useRef(keyOf('', profile, ''));
  useEffect(() => {
    const k = keyOf('', profile, '');
    if (k === lastProfile.current) return;
    lastProfile.current = k;
    if (open && text) void makeNote(text, profile, language);
  }, [profile.voiceId, profile.pitch, profile.speed]);

  const mailto = `mailto:?subject=${encodeURIComponent('Can you listen to my voice?')}&body=${encodeURIComponent(text)}`;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(text)}`;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      width={520}
      title="Ask someone to listen"
      description="Send a voice note in your new voice to someone you trust, and ask if it sounds right."
    >
      <div className="sv">
        <div className="sv__chips" role="radiogroup" aria-label="Message style">
          {SHARE_TEMPLATES.map((t) => (
            <label
              key={t.id}
              className={`vs__cand${t.id === templateId ? ' vs__cand--on' : ''}`}
              title={t.blurb}
            >
              <input
                type="radio"
                name="sv-template"
                checked={t.id === templateId}
                onChange={() => {
                  setTemplateId(t.id);
                  void rebuild(t.id);
                }}
              />
              <span className="vs__cand-name">{t.label}</span>
            </label>
          ))}
        </div>

        <div className="sv__row">
          <label className="sv__field">
            <span>Who is it for? (optional)</span>
            <input
              type="text"
              value={to}
              maxLength={40}
              onChange={(e) => setTo(e.target.value)}
              onBlur={() => void rebuild()}
              placeholder="Their name"
            />
          </label>
          <label className="sv__field">
            <span>Message language</span>
            <select
              value={language}
              onChange={(e) => {
                const l = e.target.value as LanguageCode;
                setLanguage(l);
                void rebuild(templateId, to, l);
              }}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="sv__field">
          <span>
            Message{' '}
            <span className="sv__count">
              {text.length}/{MAX_SHARE_CHARS}
            </span>
          </span>
          <textarea
            value={translating ? 'Translating…' : text}
            readOnly={translating}
            maxLength={MAX_SHARE_CHARS}
            rows={4}
            onChange={(e) => setText(e.target.value)}
          />
        </label>

        <div className="sv__bubble">
          <p className="sv__who">
            <Icon name="wave" size={14} /> Voice note · {describeProfile(profile)}
          </p>
          <VoiceNote
            peaks={note.state === 'ready' ? note.peaks : null}
            duration={note.state === 'ready' ? note.duration : 0}
            progress={progress}
            playing={playing}
            busy={note.state === 'making'}
            onToggle={() => void toggle()}
            label={
              note.state === 'ready'
                ? `Voice note, ${Math.round(note.duration)} seconds`
                : 'Voice note'
            }
          />
          {note.state === 'error' && <Banner tone="error">{note.message}</Banner>}
          {note.state === 'ready' && !fresh && (
            <Button
              variant="secondary"
              icon="wave"
              onClick={() => void makeNote(text, profile, language)}
            >
              Update the voice note
            </Button>
          )}
        </div>

        <div className="sv__actions">
          <Button icon="share" onClick={() => void share()} disabled={note.state !== 'ready'}>
            Share…
          </Button>
          <Button
            variant="secondary"
            icon="copy"
            onClick={download}
            disabled={note.state !== 'ready'}
          >
            Download voice note
          </Button>
          <Button variant="secondary" icon="copy" onClick={() => void copy()}>
            Copy message
          </Button>
        </div>
        <p className="sv__links">
          Message only, no voice note:{' '}
          <a href={whatsapp} target="_blank" rel="noreferrer">
            WhatsApp
          </a>{' '}
          · <a href={mailto}>Email</a>. Download the voice note and attach it.
        </p>

        <section className="sv__reply" aria-label="Their reply">
          <h3>When they reply, tap what they said</h3>
          <div className="sv__chips">
            {FEEDBACK.map((f) => (
              <button key={f.id} type="button" className="sv__chip" onClick={() => reply(f)}>
                <span aria-hidden="true">{f.emoji}</span> {f.label}
              </button>
            ))}
          </div>
        </section>

        <p className="sv__status" role="status">
          {status}
        </p>
        <p className="sv__privacy">
          <Icon name="lock" size={14} /> The voice note stays on this device. The message is turned
          into speech by Google Cloud Text-to-Speech and is not stored.
        </p>
      </div>
    </Modal>
  );
}
