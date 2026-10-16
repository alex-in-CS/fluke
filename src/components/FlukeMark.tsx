/** Fluke logo mark: a whale's tail fluke breaking a wave line. */
export function FlukeMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 15.5c-.6-3.2-2.6-5.6-6.2-6.6C4.3 8.5 3 8.9 2.5 9.6c2.6.2 4.6 1.7 5.6 4.1.7 1.7 2 2.6 3.9 2.6s3.2-.9 3.9-2.6c1-2.4 3-3.9 5.6-4.1-.5-.7-1.8-1.1-3.3-.7-3.6 1-5.6 3.4-6.2 6.6Z"
        fill="currentColor"
      />
      <path
        d="M12 15.5v2.2M3 20.5c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
