import React from "react";
import { Loader2 } from "lucide-react";

export default function GlobalLoading() {
  return (
    <div className="flex items-center justify-center min-h-[45vh] text-zinc-400">
      <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[#121215] border border-zinc-800/80 text-xs font-medium text-zinc-300 shadow-lg">
        <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
        <span>Loading workspace...</span>
      </div>
    </div>
  );
}
