"use client";

import React from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "./theme-provider";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-zinc-800 bg-[#141418] px-2.5 text-[11px] font-semibold text-zinc-300 hover:border-zinc-700 hover:bg-[#1a1a20] hover:text-white transition shadow-sm"
      title={theme === "dark" ? "Switch to Bright Mode" : "Switch to Dark Mode"}
      aria-label="Toggle theme mode"
    >
      {theme === "dark" ? (
        <>
          <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="hidden sm:inline">Bright</span>
        </>
      ) : (
        <>
          <Moon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="hidden sm:inline">Dark</span>
        </>
      )}
    </button>
  );
}
