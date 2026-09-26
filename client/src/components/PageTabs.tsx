/**
 * The sticky tab strip at the top of a page that holds more than one tool
 * (Expenses: the two ledgers and Uber Eats; Settings: branding and RingCentral).
 */
export function PageTabs<K extends string>({ tabs, active, onChange }: {
  tabs: readonly (readonly [K, string])[];
  active: K;
  onChange: (key: K) => void;
}) {
  return (
    <div className="sticky top-0 z-20 flex justify-center px-6 py-2.5 bg-background/85 backdrop-blur border-b border-border">
      <div className="inline-flex flex-wrap justify-center rounded-lg border border-border bg-card p-1 text-sm">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            onClick={() => onChange(k)}
            className={`px-4 py-1.5 rounded-md font-medium transition-colors ${
              active === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
