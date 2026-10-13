/** Audion mark: a signing hand-dot emitting sound arcs. Original artwork. */
export function Wordmark({ size = 28, markOnly }: { size?: number; markOnly?: boolean }) {
  return (
    <span className="au-wordmark">
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        role="img"
        aria-label={markOnly ? 'Audion' : undefined}
        aria-hidden={markOnly ? undefined : true}
      >
        <rect width="32" height="32" rx="9" fill="#0F766E" />
        <circle cx="10" cy="16" r="3.2" fill="#fff" />
        <path
          d="M16 10.5a7.5 7.5 0 010 11M20.5 7a12.5 12.5 0 010 18"
          fill="none"
          stroke="#2DD4BF"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
      {!markOnly && <span>Audion</span>}
    </span>
  );
}
