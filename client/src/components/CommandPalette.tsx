import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import { trpc } from "@/lib/trpc";
import { Building2, Search, LayoutDashboard, Map, BarChart3, Users, Phone, MapPin } from "lucide-react";

const PAGES = [
  { label: "Command Center", path: "/", icon: LayoutDashboard },
  { label: "Facilities", path: "/crm/facilities", icon: Building2 },
  { label: "Lead Search", path: "/search", icon: Search },
  { label: "Lead Map", path: "/map", icon: Map },
  { label: "BDR Reports", path: "/crm/reports", icon: BarChart3 },
  { label: "Agents", path: "/agents", icon: Users },
  { label: "RingCentral Settings", path: "/crm/ringcentral", icon: Phone },
];

// Open from anywhere: dispatch `new CustomEvent("open-command-palette")`.
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [, navigate] = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("open-command-palette", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("open-command-palette", onOpen);
    };
  }, []);

  const { data: facilities } = trpc.crm.facilities.list.useQuery(
    { search: query },
    { enabled: open && query.trim().length >= 2 },
  );

  const go = (path: string) => { setOpen(false); setQuery(""); navigate(path); };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Jump to a facility or page">
      <CommandInput placeholder="Search facilities or jump to a page…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{query.trim().length >= 2 ? "No facilities found." : "Type at least 2 letters to search facilities."}</CommandEmpty>
        {(facilities ?? []).length > 0 && (
          <CommandGroup heading="Facilities">
            {(facilities ?? []).slice(0, 8).map((f: any) => (
              <CommandItem key={f.id} value={`${f.name} ${f.city ?? ""} ${f.address ?? ""}`} onSelect={() => go(`/crm/facilities/${f.id}`)}>
                <Building2 className="text-primary" />
                <span className="flex-1 truncate">{f.name}</span>
                {f.city && <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0"><MapPin className="w-3 h-3" />{f.city}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Go to">
          {PAGES.map((p) => {
            const Icon = p.icon;
            return (
              <CommandItem key={p.path} value={`page ${p.label}`} onSelect={() => go(p.path)}>
                <Icon />
                <span>{p.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
