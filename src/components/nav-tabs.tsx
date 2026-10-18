"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  SlidersHorizontal,
  Compass,
  PlaySquare,
  Inbox,
  CheckCircle,
  Sheet,
  PhoneCall,
  Radio,
  Users,
  ShieldAlert,
  Coins,
  Settings,
  History,
  Building2,
  BadgeCheck,
} from "lucide-react";

interface NavTabsProps {
  reviewCount?: number;
  approvedCount?: number;
  callerCount?: number;
}

export function NavTabs({ reviewCount = 0, approvedCount = 0, callerCount = 0 }: NavTabsProps) {
  const pathname = usePathname();

  const tabs = [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    { href: "/rules", label: "Research Rules", icon: SlidersHorizontal },
    { href: "/qualified", label: "Qualified Leads", icon: BadgeCheck, highlight: true },
    { href: "/discover", label: "Discover Leads", icon: Compass },
    { href: "/runs", label: "Research Runs", icon: PlaySquare, badge: "Phase 3" },
    {
      href: "/review",
      label: "Review Queue",
      icon: Inbox,
      count: reviewCount,
      highlight: reviewCount > 0,
    },
    {
      href: "/approved",
      label: "Approved Leads",
      icon: CheckCircle,
      count: approvedCount,
    },
    { href: "/sheets", label: "Google Sheets", icon: Sheet, badge: "Phase 6" },
    {
      href: "/caller",
      label: "Caller Queue",
      icon: PhoneCall,
      count: callerCount,
      badge: "Phase 7",
    },
    { href: "/sources", label: "Sources", icon: Radio, badge: "Phase 3" },
    { href: "/contacts", label: "Contacts", icon: Users },
    { href: "/exclusions", label: "Exclusions", icon: ShieldAlert },
    { href: "/usage", label: "Usage & Costs", icon: Coins, badge: "Phase 8" },
    { href: "/settings", label: "Settings", icon: Settings },
    { href: "/audit", label: "Audit Log", icon: History },
  ];

  return (
    <header className="border-b border-slate-800 bg-slate-950/80 sticky top-0 z-40 backdrop-blur-md">
      {/* Top corporate bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 border-b border-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg overflow-hidden bg-slate-900 border border-slate-700/80 flex items-center justify-center p-0.5 shadow-md shadow-indigo-950/60">
              <img
                src="/logo.png"
                alt="Astraventa Logo"
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold tracking-wider bg-gradient-to-r from-white via-slate-100 to-cyan-300 bg-clip-text text-transparent text-base">ASTRAVENTA</span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">LEAD INTELLIGENCE</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-slate-900 border border-slate-800">
              <Building2 className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-slate-400">Market:</span>
              <span className="font-semibold text-slate-200">US Residential HVAC Contractors</span>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>System Ready</span>
            </div>
          </div>
        </div>

        {/* 13 Primary Navigation Tabs */}
        <nav className="flex space-x-1 overflow-x-auto py-2 no-scrollbar" aria-label="Tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors",
                  isActive
                    ? "bg-slate-800 text-cyan-300 shadow-sm border border-slate-700/60 font-semibold"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
                )}
              >
                <Icon className={cn("w-3.5 h-3.5", isActive ? "text-cyan-400" : "text-slate-500")} />
                <span>{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    className={cn(
                      "ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold",
                      tab.highlight
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        : "bg-slate-800 text-slate-300"
                    )}
                  >
                    {tab.count}
                  </span>
                )}
                {tab.badge && (
                  <span className="text-[9px] uppercase tracking-wider px-1 py-0.2 rounded bg-slate-900 text-slate-500 border border-slate-800">
                    {tab.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
