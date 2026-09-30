import { AlertTriangle, RotateCw } from "lucide-react";

/** Instead of skeletons that never end: say it failed, and offer to try again. */
export function LoadError({ what, message, onRetry }: { what: string; message?: string; onRetry: () => void }) {
  return (
    <div className="sr-panel sr-err" role="alert">
      <AlertTriangle />
      <div>
        <b>Couldn't load {what}.</b>
        <p>{message ? `The server said: ${message}` : "The connection may have dropped."} Try again; if it keeps failing, reload the page.</p>
      </div>
      <button className="sr-btn2" onClick={onRetry}><RotateCw /> Try again</button>
    </div>
  );
}
