import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Bell, Clock, Phone, ArrowLeftRight, Scale, CheckCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const LAST_READ_KEY = "notif-last-read-at";

const ICONS: Record<string, any> = {
  followup: Clock,
  recap: Phone,
  lead: ArrowLeftRight,
  imbalance: Scale,
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/**
 * In-app notification bell — surfaces follow-ups due/overdue, new call recaps,
 * inbound referrals, and partner imbalance flags. "Read" state is tracked per
 * device in localStorage (a timestamp watermark); the badge counts time-stamped
 * items newer than the last time the panel was opened.
 */
export function NotificationBell() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [lastRead, setLastRead] = useState<number>(() => {
    const v = Number(localStorage.getItem(LAST_READ_KEY));
    return Number.isFinite(v) ? v : 0;
  });

  const { data: items = [] } = trpc.crm.notifications.list.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const unread = useMemo(
    () =>
      items.filter(
        (n) => n.timestamp && new Date(n.timestamp).getTime() > lastRead,
      ).length,
    [items, lastRead],
  );

  const markAllRead = () => {
    const now = Date.now();
    localStorage.setItem(LAST_READ_KEY, String(now));
    setLastRead(now);
  };

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    // Clear the badge shortly after opening so the user still sees what's new.
    if (v && unread > 0) setTimeout(markAllRead, 1200);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className="relative flex items-center gap-3 rounded-lg px-2 py-2 mb-1 w-full text-left text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Notifications"
          aria-label={`Notifications${unread > 0 ? ` (${unread} new)` : ""}`}
        >
          <span className="relative shrink-0">
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center leading-none">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </span>
          <span className="group-data-[collapsible=icon]:hidden">
            Notifications
          </span>
          {unread > 0 && (
            <span className="ml-auto group-data-[collapsible=icon]:hidden text-[10px] font-semibold text-primary">
              {unread} new
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        className="w-80 p-0 max-h-[70vh] overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
          <span className="text-sm font-semibold">Notifications</span>
          {items.length > 0 && (
            <button
              onClick={markAllRead}
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <CheckCheck className="h-3 w-3" /> Mark all read
            </button>
          )}
        </div>
        <div className="overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              <Bell className="h-6 w-6 mx-auto mb-2 opacity-40" />
              You&apos;re all caught up.
            </div>
          ) : (
            items.map((n) => {
              const Icon = ICONS[n.type] ?? Bell;
              const isUnread =
                !!n.timestamp && new Date(n.timestamp).getTime() > lastRead;
              return (
                <button
                  key={n.id}
                  onClick={() => {
                    setOpen(false);
                    navigate(n.link);
                  }}
                  className={`w-full text-left flex gap-3 px-3 py-2.5 border-b border-border/50 hover:bg-accent/50 transition-colors ${
                    isUnread ? "bg-primary/5" : ""
                  }`}
                >
                  <span className="mt-0.5 shrink-0 h-7 w-7 rounded-full bg-secondary flex items-center justify-center">
                    <Icon className="h-3.5 w-3.5 text-primary" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground truncate">
                        {n.title}
                      </span>
                      {n.timestamp && (
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {timeAgo(n.timestamp)}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {n.description}
                    </span>
                  </span>
                  {isUnread && (
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
