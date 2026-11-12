/** Marks a coin whose holders voted in new rules. Nothing for a coin still on its first rules. */
export function RulesPill({ version, className = "" }: { version: number | undefined; className?: string }) {
  if (!version || version <= 1) return null;
  return (
    <span className={`rules-pill ${className}`} title={`Its holders voted in new rules. This is version ${version}.`}>
      rules v{version}
    </span>
  );
}
