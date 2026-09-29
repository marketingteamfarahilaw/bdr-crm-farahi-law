/**
 * Ask before leaving a form with unsaved changes (Sept 2026: "if we go out of
 * the page without saving it lets us get out — it should ask do you want to go
 * out without saving the changes or save changes").
 *
 * Covers links, buttons and menu items and the browser's Back/Forward (through
 * lib/navigationGuard, which main.tsx installs before the router), and closing
 * or reloading the tab (the browser's own prompt). The caller renders `dialog`
 * and decides what "Save changes" does.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { setNavigationGuard } from "@/lib/navigationGuard";

export function useUnsavedChanges(dirty: boolean, { onSave, saving }: { onSave: (then: () => void) => void; saving?: boolean }) {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // Once the user has chosen to leave (or saved), nothing is held back again.
  const released = useRef(false);
  const [pending, setPending] = useState<(() => void) | null>(null);

  useEffect(() => {
    released.current = false;
    const holding = () => dirtyRef.current && !released.current;
    setNavigationGuard({ holding, ask: (go) => setPending(() => go) });
    const onUnload = (e: BeforeUnloadEvent) => { if (holding()) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      setNavigationGuard(null);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);

  /** Let the next navigation through — after a save, or from "Leave without saving". */
  const release = useCallback(() => { released.current = true; }, []);
  const leave = () => { const go = pending; release(); setPending(null); go?.(); };
  const save = () => {
    const go = pending;
    onSave(() => { release(); setPending(null); go?.(); });
  };

  const dialog = (
    <AlertDialog open={!!pending} onOpenChange={(o) => !o && !saving && setPending(null)}>
      <AlertDialogContent className="bg-card border-border">
        <AlertDialogHeader>
          <AlertDialogTitle>Save your changes?</AlertDialogTitle>
          <AlertDialogDescription>You changed this page but haven't saved. If you leave now, the changes are lost.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel disabled={saving}>Stay on this page</AlertDialogCancel>
          <Button variant="outline" className="border-border" disabled={saving} onClick={leave}>Leave without saving</Button>
          <AlertDialogAction
            disabled={saving}
            onClick={(e) => { e.preventDefault(); save(); }}
            style={{ background: "var(--gold)", color: "var(--gold-foreground)" }}
          >
            {saving ? "Saving…" : "Save changes"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { dialog, release };
}
