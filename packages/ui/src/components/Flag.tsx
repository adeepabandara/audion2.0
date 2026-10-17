import { useId } from 'react';

/**
 * Small original flag drawings (simple shapes, no text or emblems) for the language menu. Flags are drawn rather than
 * written as emoji because Windows does not show flag emoji. A flag stands for the country whose voice and wording
 * Ola uses for that language; it is decoration, so the language name is always written next to it.
 */
export type FlagCode = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'hi' | 'ja' | 'zh' | 'ar';

const star = (cx: number, cy: number, r: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.4;
    return `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

function Art({ code }: { code: FlagCode }) {
  switch (code) {
    case 'en':
      return (
        <>
          <rect width="24" height="16" fill="#fff" />
          {[0, 2, 4, 6].map((i) => (
            <rect key={i} y={i * 2.286} width="24" height="2.286" fill="#B22234" />
          ))}
          <rect width="10.5" height="9.14" fill="#3C3B6E" />
          {[2.2, 5.2, 8.2].flatMap((x) =>
            [2.2, 4.6, 7].map((y) => (
              <circle key={`${x}${y}`} cx={x} cy={y} r="0.55" fill="#fff" />
            )),
          )}
        </>
      );
    case 'es':
      return (
        <>
          <rect width="24" height="16" fill="#AA151B" />
          <rect y="4" width="24" height="8" fill="#F1BF00" />
        </>
      );
    case 'fr':
      return (
        <>
          <rect width="8" height="16" fill="#0055A4" />
          <rect x="8" width="8" height="16" fill="#fff" />
          <rect x="16" width="8" height="16" fill="#EF4135" />
        </>
      );
    case 'de':
      return (
        <>
          <rect width="24" height="5.34" fill="#000" />
          <rect y="5.33" width="24" height="5.34" fill="#DD0000" />
          <rect y="10.66" width="24" height="5.34" fill="#FFCE00" />
        </>
      );
    case 'pt':
      return (
        <>
          <rect width="24" height="16" fill="#009C3B" />
          <path d="M12 1.6L22 8L12 14.4L2 8z" fill="#FFDF00" />
          <circle cx="12" cy="8" r="3.4" fill="#002776" />
        </>
      );
    case 'hi':
      return (
        <>
          <rect width="24" height="5.34" fill="#FF9933" />
          <rect y="5.33" width="24" height="5.34" fill="#fff" />
          <rect y="10.66" width="24" height="5.34" fill="#138808" />
          <circle cx="12" cy="8" r="1.9" fill="none" stroke="#000080" strokeWidth="0.8" />
        </>
      );
    case 'ja':
      return (
        <>
          <rect width="24" height="16" fill="#fff" />
          <circle cx="12" cy="8" r="4.6" fill="#BC002D" />
        </>
      );
    case 'zh':
      return (
        <>
          <rect width="24" height="16" fill="#DE2910" />
          <polygon points={star(5, 5, 3)} fill="#FFDE00" />
          {[
            [9.6, 2],
            [11.2, 4],
            [11.2, 6.6],
            [9.6, 8.4],
          ].map(([x, y]) => (
            <polygon key={`${x}${y}`} points={star(x!, y!, 0.9)} fill="#FFDE00" />
          ))}
        </>
      );
    case 'ar':
      return (
        <>
          <rect width="24" height="5.34" x="0" fill="#00732F" />
          <rect y="5.33" width="24" height="5.34" fill="#fff" />
          <rect y="10.66" width="24" height="5.34" fill="#000" />
          <rect width="6" height="16" fill="#FF0000" />
        </>
      );
  }
}

export function Flag({ code, size = 20 }: { code: FlagCode; size?: number }) {
  const clip = useId().replace(/:/g, '');
  return (
    <svg
      className="au-flag"
      viewBox="0 0 24 16"
      width={size}
      height={(size * 2) / 3}
      aria-hidden="true"
      focusable="false"
    >
      <clipPath id={clip}>
        <rect width="24" height="16" rx="2.5" />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <Art code={code} />
      </g>
      <rect
        width="24"
        height="16"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="1"
      />
    </svg>
  );
}
