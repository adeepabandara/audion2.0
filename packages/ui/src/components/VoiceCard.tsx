import { useId } from 'react';
import { Button } from './Button';

export interface VoiceCardProps {
  name: string;
  description: string;
  groupName: string;
  selected: boolean;
  playing?: boolean;
  onSelect?: () => void;
  onPlay?: () => void;
}

/** Native radio (keyboard + screen reader semantics for free) plus a separate preview button. */
export function VoiceCard({
  name,
  description,
  groupName,
  selected,
  playing,
  onSelect,
  onPlay,
}: VoiceCardProps) {
  const id = useId();
  return (
    <div className={`au-voice${selected ? ' au-voice--selected' : ''}`}>
      <label className="au-voice__pick" htmlFor={id}>
        <input
          id={id}
          type="radio"
          name={groupName}
          className="au-voice__radio"
          checked={selected}
          onChange={() => onSelect?.()}
        />
        <span>
          <span className="au-voice__name">{name}</span>
          <span className="au-voice__meta">{description}</span>
        </span>
      </label>
      <Button variant="secondary" icon={playing ? 'pause' : 'play'} iconOnly onClick={onPlay}>
        {playing ? `Stop ${name} preview` : `Play ${name} preview`}
      </Button>
    </div>
  );
}
