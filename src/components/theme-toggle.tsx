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
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-[#141418] text-zinc-300 hover:border-zinc-700 hover:bg-[#1a1a20] hover:text-white transition"
      title={theme === "dark" ? "Switch to Bright Mode" : "Switch to Dark Mode"}
      aria-label="Toggle theme mode"
    >
      {theme === "dark" ? (
        <Sun className="w-4 h-4 text-amber-400" />
      ) : (
        <Moon className="w-4 h-4 text-indigo-400" />
      )}
    </button>
  );
}
