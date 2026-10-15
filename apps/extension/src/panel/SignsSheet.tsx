import { Banner, Drawer } from '@audion/ui';
import { BodyPlace, HandShape } from './HandPose';
import { SIGN_LIST } from './signs';

export function SignsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      modal={false}
      width={440}
      title="Supported signs"
      description="Ola recognises these 22 American Sign Language signs. Sign slowly and clearly, one at a time."
    >
      <ul className="ap-signs">
        {SIGN_LIST.map((s) => (
          <li key={s.sign} className="ap-sign">
            <div className="ap-sign__art">
              <HandShape shape={s.shape} />
              <BodyPlace place={s.place} />
            </div>
            <strong>{s.label}</strong>
            <span>{s.hint}</span>
          </li>
        ))}
      </ul>
      <Banner tone="info">
        The list will grow. The pictures are quick reminders of hand shape and position, not a full
        guide to each sign.
      </Banner>
    </Drawer>
  );
}
