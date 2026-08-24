import type { ClientToServerEvents, ServerToClientEvents, SocialSnapshot } from "@four/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";

import { api } from "./api";
import { SocialContext } from "./social-context";

export function SocialProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["social"],
    queryFn: () => api<SocialSnapshot>("/api/social"),
  });

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io("/account", {
      path: "/socket.io",
      withCredentials: true,
    });
    const replaceState = (state: SocialSnapshot) => {
      queryClient.setQueryData(["social"], state);
      void queryClient.invalidateQueries({ queryKey: ["games"] });
    };
    socket.on("connect", () => {
      socket.emit("account:subscribe", {}, (result) => {
        if (result.ok) replaceState(result.data);
      });
    });
    socket.on("account:state", replaceState);
    return () => {
      socket.disconnect();
    };
  }, [queryClient]);

  return (
    <SocialContext.Provider
      value={{
        social: query.data,
        isLoading: query.isLoading,
        error: query.error,
      }}
    >
      {children}
    </SocialContext.Provider>
  );
}
