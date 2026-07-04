"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Tool } from "@/components/tools";
import {
  ALL,
  TOOL_SHELL_EVENT,
  readToolShell,
  writeToolShell,
  toggleFavourite as rToggleFavourite,
  setMembership as rSetMembership,
  createGroup as rCreateGroup,
  renameGroup as rRenameGroup,
  deleteGroup as rDeleteGroup,
  reorderGroups as rReorderGroups,
  seedState,
  type ToolShellState,
} from "@/components/tool-store";

type ShellCtx = {
  state: ToolShellState;
  activeGroup: string;
  setActiveGroup: (id: string) => void;
  query: string;
  setQuery: (q: string) => void;
  toggleFavourite: (id: string) => void;
  setMembership: (tool: Tool, groupId: string, on: boolean) => void;
  createGroup: (label: string, addToolId?: string) => string;
  renameGroup: (id: string, label: string) => void;
  deleteGroup: (id: string) => void;
  reorderGroups: (ids: string[]) => void;
};

const Ctx = createContext<ShellCtx | null>(null);

export function ToolShellProvider({ children }: { children: ReactNode }) {
  // Seed on the server and first client render to avoid hydration mismatch, then hydrate from storage.
  const [state, setState] = useState<ToolShellState>(seedState);
  const [activeGroup, setActiveGroup] = useState<string>(ALL);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setState(readToolShell());
    const onChange = () => setState(readToolShell());
    window.addEventListener(TOOL_SHELL_EVENT, onChange);
    return () => window.removeEventListener(TOOL_SHELL_EVENT, onChange);
  }, []);

  // Persist + broadcast, then reflect locally.
  const commit = useCallback((next: ToolShellState) => {
    writeToolShell(next);
    setState(next);
  }, []);

  const value: ShellCtx = {
    state,
    activeGroup,
    setActiveGroup,
    query,
    setQuery,
    toggleFavourite: (id) => commit(rToggleFavourite(state, id)),
    setMembership: (tool, groupId, on) => commit(rSetMembership(state, tool, groupId, on)),
    createGroup: (label, addToolId) => {
      const { state: next, id } = rCreateGroup(state, label, addToolId);
      commit(next);
      return id;
    },
    renameGroup: (id, label) => commit(rRenameGroup(state, id, label)),
    deleteGroup: (id) => {
      if (activeGroup === id) setActiveGroup(ALL);
      commit(rDeleteGroup(state, id));
    },
    reorderGroups: (ids) => commit(rReorderGroups(state, ids)),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToolShell(): ShellCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToolShell must be used within ToolShellProvider");
  return ctx;
}
