import { Banner } from '@audion/ui';
import { BodyPlace, HandShape } from './HandPose';
import { SIGN_LIST } from './signs';

/** The 22 supported signs with a small picture of the hand shape and where it is made. Shown in Settings > Signs. */
export function SignsGrid() {
  return (
    <>
      <p className="ap-note">
        Ola recognises these {SIGN_LIST.length} American Sign Language signs. Sign slowly and
        clearly, one at a time.
      </p>
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
    </>
  );
}
