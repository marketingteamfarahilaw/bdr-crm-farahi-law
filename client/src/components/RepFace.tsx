import type { ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { isIntakeOnly } from "@shared/permissions";
import { repNameKey } from "@shared/team";

/**
 * Reps' RingCentral profile pictures (server/repPhotos.ts), by name. One query
 * for the whole app, kept for half an hour; the intake side never asks — rep
 * data is BD/FR's.
 */
export function useRepPhotos(): (name: string | null | undefined) => string | null {
  const { user } = useAuth();
  const { data } = trpc.repPhotos.useQuery(undefined, {
    enabled: !!user && !isIntakeOnly(user.role),
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  return (name) => (name && data ? data[repNameKey(name)] ?? null : null);
}

/**
 * A rep's face inside an existing avatar circle: their RingCentral picture when
 * there is one, otherwise the fallback (their initials) exactly as before.
 */
export function RepFace({ name, fallback, className = "" }: { name: string; fallback: ReactNode; className?: string }) {
  const photo = useRepPhotos()(name);
  if (!photo) return <>{fallback}</>;
  return <img src={photo} alt="" className={`rep-face ${className}`.trim()} draggable={false} />;
}
