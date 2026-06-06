import type { Dispatch, SetStateAction } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Option lists — mirror the team's Excel data-validation.
export const LEAD_ROLES = ["FR", "BDR"];
export const ROLE_MEMBERS: Record<string, string[]> = {
  FR: ["Jezel", "Lupe", "Zulema", "Genysys"],
  BDR: ["Grace", "Queenie", "Ally", "Miguel"],
};
export const ALL_MEMBERS = [...ROLE_MEMBERS.FR, ...ROLE_MEMBERS.BDR];
export const LEAD_VALUES = ["Rank X", "High", "Medium", "Low"];
export const LEAD_OUTCOMES = ["Open", "Signed", "Signed Referred", "Referred Out", "Rejected", "Not interested", "LOC"];
export const LEAD_CLASSIFICATIONS = ["Driver", "Passenger"];
export const LEAD_LIABILITIES = ["Accepted", "Disputed"];

const NONE = "__none__";

function FieldSelect({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string;
  options: string[];
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger className="bg-background border-border"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>—</SelectItem>
        {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

type FieldDef = { key: string; label: string; kind: "text" | "date" | "select" | "member"; options?: string[]; required?: boolean };
const FIELDS: FieldDef[] = [
  { key: "leadDate", label: "Date", kind: "date" },
  { key: "role", label: "Role", kind: "select", options: LEAD_ROLES },
  { key: "member", label: "Member", kind: "member" },
  { key: "leadName", label: "Lead Name", kind: "text", required: true },
  { key: "value", label: "Value", kind: "select", options: LEAD_VALUES },
  { key: "outcome", label: "Outcome", kind: "select", options: LEAD_OUTCOMES },
  { key: "classification", label: "Classification", kind: "select", options: LEAD_CLASSIFICATIONS },
  { key: "sud", label: "SUD", kind: "date" },
  { key: "liability", label: "Liability", kind: "select", options: LEAD_LIABILITIES },
  { key: "disposition", label: "Disposition", kind: "text" },
  { key: "facility", label: "Facility", kind: "text" },
  { key: "typeOfFacility", label: "Type of Facility", kind: "text" },
  { key: "clientLocation", label: "Client's Location", kind: "text" },
  { key: "fvDocumentation", label: "FV Documentation", kind: "text" },
];

/** All lead-intake form fields with the right control per field (dropdowns for
 *  Role/Member/Value/Outcome/Classification/Liability). Member options track Role. */
export function LeadFormFields({
  form,
  setForm,
  lockFacility,
}: {
  form: Record<string, string>;
  setForm: Dispatch<SetStateAction<Record<string, string>>>;
  lockFacility?: boolean;
}) {
  const memberOptions = form.role && ROLE_MEMBERS[form.role] ? ROLE_MEMBERS[form.role] : ALL_MEMBERS;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <label className="text-xs text-muted-foreground">
            {f.label}{f.required && <span className="text-destructive"> *</span>}
          </label>
          {f.kind === "date" ? (
            <Input
              type="date"
              value={form[f.key] ?? ""}
              onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              className="bg-background border-border"
            />
          ) : f.kind === "select" ? (
            <FieldSelect
              value={form[f.key] ?? ""}
              options={f.options!}
              placeholder={f.label}
              onChange={(v) =>
                f.key === "role"
                  ? setForm((s) => {
                      const valid = ROLE_MEMBERS[v] ?? ALL_MEMBERS;
                      return { ...s, role: v, member: valid.includes(s.member ?? "") ? (s.member ?? "") : "" };
                    })
                  : setForm((s) => ({ ...s, [f.key]: v }))
              }
            />
          ) : f.kind === "member" ? (
            <FieldSelect
              value={form[f.key] ?? ""}
              options={memberOptions}
              placeholder="Member"
              onChange={(v) => setForm((s) => ({ ...s, member: v }))}
            />
          ) : (
            <Input
              value={form[f.key] ?? ""}
              disabled={!!lockFacility && f.key === "facility"}
              onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              placeholder={f.label}
              className="bg-background border-border"
            />
          )}
        </div>
      ))}
    </div>
  );
}
