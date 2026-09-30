// Types for leaddocket-digital.mjs, so server code and tests can import it.
export declare function normalizeCaseValue(v: unknown): string | null;
export declare function caseValueFrom(lead: unknown): string | null;
export declare const DIGITAL_COLUMNS: [string, string][];
export declare function ensureDigitalColumns(
  query: (sql: string) => Promise<Record<string, unknown>[]>,
): Promise<void>;
