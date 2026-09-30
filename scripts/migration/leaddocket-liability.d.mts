// Types for leaddocket-liability.mjs, so server code and tests can import it.
export declare function liabilityStatusFrom(lead: unknown): string | null;
export declare const phoneKey: (s: unknown) => string | null;
export declare const LIABILITY_COLUMNS: [string, string][];
export declare const PHONE_INDEX: [string, string];
export declare function ensureLiabilityColumns(
  query: (sql: string) => Promise<Record<string, unknown>[]>,
): Promise<void>;
