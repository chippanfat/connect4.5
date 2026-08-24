import type { SocialSnapshot } from "@four/contracts";
import { createContext, useContext } from "react";

export interface SocialContextValue {
  social: SocialSnapshot | undefined;
  isLoading: boolean;
  error: Error | null;
}

export const SocialContext = createContext<SocialContextValue | null>(null);

export function useSocial() {
  const context = useContext(SocialContext);
  if (!context) throw new Error("useSocial must be used inside SocialProvider");
  return context;
}
