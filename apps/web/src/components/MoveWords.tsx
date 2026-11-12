/** The contract asks each AI for COOPERATE or DEFECT. The site shows those moves as Trust and Betray. */
export function MoveWords({ className = "" }: { className?: string }) {
  return (
    <p className={`move-words ${className}`}>
      In the AI's own words, <b className="t">COOPERATE</b> means Trust and <b className="b">DEFECT</b> means Betray.
    </p>
  );
}
