"use client";

import React, { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { MarketView, TenantWorkspace } from "@/server/repo/markets";
import { NICHE_PRESET_TEMPLATES } from "@/server/domain/markets";
import {
  type TeamMember,
  ROLE_PRESETS,
  type PermissionKey,
  canMemberAccessPath,
  getDefaultRouteForMember,
} from "@/server/domain/team";
import {
  switchMarketAction,
  switchTenantAction,
  createNicheAction,
  updateNicheAction,
  deleteNicheAction,
  createTenantWorkspaceAction,
} from "@/app/actions/tenant";
import { logoutAction } from "@/app/login/actions";
import {
  LayoutDashboard,
  Compass,
  PhoneCall,
  Settings,
  Activity,
  Building2,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Zap,
  ChevronDown,
  Check,
  Plus,
  Trash2,
  Edit3,
  Loader2,
  Briefcase,
  Lock,
  LogOut,
} from "lucide-react";

interface AppShellProps {
  children: React.ReactNode;
  reviewCount?: number;
  approvedCount?: number;
  callerCount?: number;
  activeTenant?: TenantWorkspace;
  allTenants?: TenantWorkspace[];
  activeMarket?: MarketView;
  tenantMarkets?: MarketView[];
  allMarkets?: MarketView[];
  activeMember?: TeamMember;
  allMembers?: TeamMember[];
}

function AppShellInner({
  children,
  callerCount = 0,
  activeTenant,
  allTenants = [],
  activeMarket,
  tenantMarkets = [],
  allMarkets = [],
  activeMember,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Live synced member state (updates automatically when Owner changes permissions in /settings)
  const [liveMember, setLiveMember] = useState<TeamMember | undefined>(activeMember);
  const [optimisticPath, setOptimisticPath] = useState<string>(pathname);

  useEffect(() => {
    setLiveMember(activeMember);
  }, [activeMember]);

  useEffect(() => {
    setOptimisticPath(pathname);
  }, [pathname]);

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false);
  const [sidebarNicheOpen, setSidebarNicheOpen] = useState(false);
  const [headerNicheOpen, setHeaderNicheOpen] = useState(false);
  const [memberDropdownOpen, setMemberDropdownOpen] = useState(false);

  // Modals for Multi-Niche & Multi-Tenant Management
  const [nicheModalOpen, setNicheModalOpen] = useState(false);
  const [nicheModalTab, setNicheModalTab] = useState<"create" | "manage">("create");
  const [tenantModalOpen, setTenantModalOpen] = useState(false);

  // Create Niche Form State
  const [nicheName, setNicheName] = useState("");
  const [nicheCategory, setNicheCategory] = useState("custom");
  const [nicheDesc, setNicheDesc] = useState("");
  const [nicheKeywords, setNicheKeywords] = useState("");
  const [nicheBusinessType, setNicheBusinessType] = useState<"residential" | "commercial" | "both">("both");
  const [nicheMinScore, setNicheMinScore] = useState<number>(60);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalSuccess, setModalSuccess] = useState<string | null>(null);

  // Edit Niche State
  const [editingMarketId, setEditingMarketId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editKeywords, setEditKeywords] = useState("");

  // Create Tenant Workspace Form State
  const [newTenantName, setNewTenantName] = useState("");
  const [newTenantRole, setNewTenantRole] = useState("Workspace Owner");
  const [newTenantInitialNiche, setNewTenantInitialNiche] = useState("US Residential HVAC");
  const [newTenantInitialCategory, setNewTenantInitialCategory] = useState("hvac");

  // Live Permission & Access Heartbeat — syncs permissions in real time without manual refresh
  useEffect(() => {
    let active = true;

    const syncMemberAccess = async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!active || !data.ok || !data.activeMember) return;

        const nextMember: TeamMember = data.activeMember;
        if (nextMember.id === "guest" || nextMember.status === "SUSPENDED") {
          window.location.href = "/login";
          return;
        }

        setLiveMember((prev) => {
          const prevSig = prev
            ? JSON.stringify({
                role: prev.role,
                status: prev.status,
                perms: prev.permissions,
                scope: prev.nicheScope,
                niches: prev.allowedNicheIds,
              })
            : "";
          const nextSig = JSON.stringify({
            role: nextMember.role,
            status: nextMember.status,
            perms: nextMember.permissions,
            scope: nextMember.nicheScope,
            niches: nextMember.allowedNicheIds,
          });
          if (prevSig !== nextSig) {
            // Owner updated this member's permissions or role — refresh server state too
            router.refresh();
            return nextMember;
          }
          return prev;
        });
      } catch {
        // Ignore transient network errors
      }
    };

    const interval = setInterval(syncMemberAccess, 4000);
    const onFocus = () => syncMemberAccess();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [router]);

  // Enforce strict route protection on client navigation & live permission changes
  const isAllowedOnCurrentPath = canMemberAccessPath(liveMember, pathname);
  const fallbackRoute = getDefaultRouteForMember(liveMember);

  useEffect(() => {
    if (liveMember && !isAllowedOnCurrentPath) {
      router.replace(fallbackRoute);
    }
  }, [liveMember, isAllowedOnCurrentPath, fallbackRoute, router, pathname]);

  const currentTenantName = activeTenant?.name || "Astraventa Workspace";
  const currentNicheName = activeMarket?.name || "Active Niche";

  const displayedTenants: TenantWorkspace[] =
    allTenants.length > 0
      ? allTenants
      : [{ id: "tenant_main", name: "Astraventa Workspace", role: "Owner" }];

  const baseMarkets: MarketView[] =
    tenantMarkets.length > 0
      ? tenantMarkets
      : allMarkets.length > 0
      ? allMarkets
      : [
          {
            id: "hvac",
            key: "hvac",
            name: "US Residential HVAC",
            description: "AC/Heating replacement & installs",
            status: "ACTIVE",
            tenantId: "tenant_main",
            category: "hvac",
            icon: "flame",
            keywords: ["HVAC contractor", "AC replacement"],
            leadCount: 0,
            reviewCount: 0,
            approvedCount: 0,
          },
        ];

  // Filter markets to only those allowed for this member
  const allowedMarketsForMember = baseMarkets.filter(
    (n) =>
      !liveMember ||
      liveMember.role === "OWNER" ||
      liveMember.nicheScope === "ALL" ||
      liveMember.allowedNicheIds.length === 0 ||
      liveMember.allowedNicheIds.includes(n.id)
  );

  useEffect(() => {
    setMobileOpen(false);
    setTenantDropdownOpen(false);
    setSidebarNicheOpen(false);
    setHeaderNicheOpen(false);
    setMemberDropdownOpen(false);
  }, [pathname]);

  useEffect(() => {
    const saved = localStorage.getItem("astraventa_sidebar_collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("astraventa_sidebar_collapsed", String(next));
  };

  const handleSwitchTenant = (tenantId: string) => {
    setTenantDropdownOpen(false);
    startTransition(async () => {
      await switchTenantAction(tenantId);
      router.refresh();
    });
  };

  const handleSwitchNiche = (marketId: string) => {
    setSidebarNicheOpen(false);
    setHeaderNicheOpen(false);
    startTransition(async () => {
      await switchMarketAction(marketId);
      router.refresh();
    });
  };

  const applyPresetTemplate = (presetKey: string) => {
    const preset = NICHE_PRESET_TEMPLATES.find((p) => p.category === presetKey);
    if (!preset) return;
    setNicheCategory(preset.category);
    setNicheName(preset.name);
    setNicheDesc(preset.description);
    setNicheKeywords(preset.keywords.join(", "));
    setNicheBusinessType(preset.businessType);
    setNicheMinScore(preset.minScore);
    setModalError(null);
  };

  const handleCreateNicheSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    setModalSuccess(null);

    if (!nicheName.trim()) {
      setModalError("Please enter a Niche Name (e.g., HVAC, Real Estate, Medical).");
      return;
    }

    const parsedKeywords = nicheKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    startTransition(async () => {
      const res = await createNicheAction({
        name: nicheName.trim(),
        description: nicheDesc.trim(),
        category: nicheCategory,
        tenantId: activeTenant?.id || "tenant_main",
        keywords: parsedKeywords,
        businessType: nicheBusinessType,
        minScore: nicheMinScore,
      });

      if (!res.ok) {
        setModalError(res.error || "Failed to create niche");
        return;
      }

      setNicheName("");
      setNicheDesc("");
      setNicheKeywords("");
      setNicheModalOpen(false);
      router.refresh();
    });
  };

  const startEditingMarket = (m: MarketView) => {
    setEditingMarketId(m.id);
    setEditName(m.name);
    setEditDesc(m.description);
    setEditKeywords(m.keywords.join(", "));
    setModalError(null);
  };

  const handleSaveEditMarket = (marketId: string) => {
    setModalError(null);
    const parsedKeywords = editKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    startTransition(async () => {
      const res = await updateNicheAction(marketId, {
        name: editName,
        description: editDesc,
        keywords: parsedKeywords,
      });
      if (!res.ok) {
        setModalError(res.error || "Failed to update niche");
        return;
      }
      setEditingMarketId(null);
      setModalSuccess("Niche updated.");
      router.refresh();
    });
  };

  const handleDeleteMarket = (marketId: string, name: string) => {
    if (allMarkets.length <= 1) {
      setModalError("You must keep at least one active niche.");
      return;
    }
    setModalError(null);
    startTransition(async () => {
      const res = await deleteNicheAction(marketId);
      if (!res.ok) {
        setModalError(res.error || `Could not delete ${name}`);
        return;
      }
      setModalSuccess(`Removed "${name}".`);
      router.refresh();
    });
  };

  const handleCreateTenantSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    if (!newTenantName.trim()) {
      setModalError("Please enter a Workspace name.");
      return;
    }

    const preset = NICHE_PRESET_TEMPLATES.find((p) => p.category === newTenantInitialCategory);

    startTransition(async () => {
      const res = await createTenantWorkspaceAction({
        name: newTenantName.trim(),
        role: newTenantRole.trim() || "Owner",
        initialNicheName: newTenantInitialNiche.trim() || preset?.name || "US Residential HVAC",
        initialNicheCategory: newTenantInitialCategory,
        initialNicheKeywords: preset?.keywords,
      });

      if (!res.ok) {
        setModalError(res.error || "Failed to create workspace");
        return;
      }

      setNewTenantName("");
      setTenantModalOpen(false);
      router.refresh();
    });
  };

  const isOwner = !liveMember || liveMember.role === "OWNER";
  const canManageNiches = isOwner || Boolean(liveMember?.permissions.manageNiches);
  const canManageTeam = isOwner || Boolean(liveMember?.permissions.manageTeamAndSettings);
  // Show niche switcher only if user can manage niches OR has multiple assigned niches
  const showNicheSwitcher = canManageNiches || allowedMarketsForMember.length > 1;

  const allNavGroups: Array<{
    group: string;
    items: Array<{
      href: string;
      label: string;
      icon: any;
      pill?: string;
      count?: number;
      highlight?: boolean;
      perm?: PermissionKey;
      alwaysVisible?: boolean;
      ownerOnly?: boolean;
    }>;
  }> = [
    {
      group: "Workspace",
      items: [
        { href: "/", label: "Dashboard", icon: LayoutDashboard, perm: "approveLeads" },
        { href: "/discover", label: "Find Leads", icon: Compass, perm: "discoverLeads" },
        {
          href: "/caller",
          label: "Leads CRM",
          icon: PhoneCall,
          count: callerCount,
          highlight: callerCount > 0,
          perm: "callerWorkbench",
        },
      ],
    },
    {
      group: "Administration",
      items: [
        {
          href: "/settings",
          label: canManageTeam ? "Team & Settings" : "Account Settings",
          icon: Settings,
          alwaysVisible: true,
        },
        {
          href: "/usage",
          label: "API Usage",
          icon: Activity,
          ownerOnly: true,
        },
      ],
    },
  ];

  // Filter navigation so ONLY permitted options appear for the active member
  const visibleNavGroups = allNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.ownerOnly) return isOwner;
        if (item.alwaysVisible) return true;
        return isOwner || (item.perm ? Boolean(liveMember?.permissions[item.perm]) : false);
      }),
    }))
    .filter((group) => group.items.length > 0);

  const getPageTitle = () => {
    for (const g of allNavGroups) {
      for (const item of g.items) {
        if (item.href === "/" && pathname === "/") return "Overview Dashboard";
        if (item.href !== "/" && pathname.startsWith(item.href)) return item.label;
      }
    }
    if (pathname.startsWith("/company/")) return "Lead Profile";
    return "Leads CRM";
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#09090b] text-zinc-100">
      {/* Global Switching Indicator Toast */}
      {isPending && (
        <div className="fixed top-4 right-4 z-[100] flex items-center gap-2.5 px-4 py-2 rounded-lg bg-[#121215] border border-zinc-700 text-zinc-100 font-medium text-xs shadow-xl">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
          <span>Updating...</span>
        </div>
      )}

      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ============================================================ */}
      {/* SIDEBAR                                                      */}
      {/* ============================================================ */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col bg-[#0c0c0e] border-r border-[#1f1f23] backdrop-blur-xl transition-all duration-200 ease-in-out lg:static",
          collapsed ? "w-20" : "w-64 xl:w-68",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Brand Header */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#1f1f23] px-4">
          <Link
            href={fallbackRoute}
            onClick={() => setOptimisticPath(fallbackRoute)}
            className="flex items-center gap-3 overflow-hidden group"
          >
            <img
              src="/logo.png"
              alt="Astraventa"
              className="h-8 w-8 object-contain shrink-0"
            />
            {!collapsed && (
              <div className="min-w-0">
                <div className="text-sm font-bold tracking-tight text-white">
                  ASTRAVENTA
                </div>
                <div className="text-[10px] tracking-wider uppercase text-zinc-500 font-semibold">
                  Lead Engine CRM
                </div>
              </div>
            )}
          </Link>

          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-900 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Compact Niche Selector — ONLY shown if member has permission to switch/manage niches */}
        {!collapsed && canManageNiches && (
          <div className="px-3 py-2.5 border-b border-[#1f1f23] bg-[#09090b]/40">
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setSidebarNicheOpen(!sidebarNicheOpen);
                  setHeaderNicheOpen(false);
                  setTenantDropdownOpen(false);
                }}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#121215] border border-zinc-800/90 hover:border-zinc-700 text-left transition-all shadow-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <span className="text-xs font-semibold text-white truncate">
                    {currentNicheName}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                    {allowedMarketsForMember.length}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                </div>
              </button>

              {sidebarNicheOpen && (
                <div className="absolute top-full left-0 mt-1.5 w-64 z-50 rounded-xl bg-[#121215] border border-zinc-800 shadow-2xl p-2 space-y-1.5 max-h-[380px] overflow-y-auto">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
                    <span>Switch Niche</span>
                    <span className="text-[10px] text-zinc-500">{allowedMarketsForMember.length} available</span>
                  </div>

                  <div className="space-y-1">
                    {allowedMarketsForMember.map((n) => {
                      const isCurrent = activeMarket ? activeMarket.id === n.id : currentNicheName === n.name;
                      return (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => handleSwitchNiche(n.id)}
                          className={cn(
                            "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-xs transition-all",
                            isCurrent
                              ? "bg-zinc-800 text-white font-semibold border border-zinc-700"
                              : "text-zinc-300 hover:bg-zinc-800/60 border border-transparent"
                          )}
                        >
                          <div className="min-w-0 pr-2 flex items-center gap-1.5">
                            {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />}
                            <span className="truncate">{n.name}</span>
                          </div>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-black text-zinc-400 shrink-0">
                            {n.leadCount}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-1.5 mt-1 border-t border-zinc-800 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSidebarNicheOpen(false);
                        setNicheModalTab("create");
                        setModalError(null);
                        setModalSuccess(null);
                        setNicheModalOpen(true);
                      }}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-black text-[11px] font-bold transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      <span>New Niche</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSidebarNicheOpen(false);
                        setNicheModalTab("manage");
                        setModalError(null);
                        setModalSuccess(null);
                        setNicheModalOpen(true);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 hover:text-white text-[11px] font-medium transition-colors"
                      title="Manage Niches"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Navigation Groups (Strictly filtered by liveMember permissions) */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {visibleNavGroups.map((group) => (
            <div key={group.group} className="space-y-1">
              {!collapsed ? (
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {group.group}
                </div>
              ) : (
                <div className="h-2 border-t border-[#1f1f23] mx-2" />
              )}

              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const activeCheckPath = optimisticPath || pathname;
                  const isActive =
                    item.href === "/"
                      ? activeCheckPath === "/"
                      : activeCheckPath.startsWith(item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={true}
                      onClick={() => setOptimisticPath(item.href)}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "group flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-xs font-semibold transition-all relative",
                        isActive
                          ? "bg-zinc-800/90 text-white shadow-sm"
                          : "text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-200"
                      )}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-white" />
                      )}

                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0 transition-colors",
                          isActive
                            ? "text-white"
                            : "text-zinc-400 group-hover:text-zinc-200"
                        )}
                      />

                      {!collapsed && <span className="truncate flex-1">{item.label}</span>}

                      {!collapsed && item.count !== undefined && item.count > 0 && (
                        <span
                          className={cn(
                            "ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0",
                            item.highlight
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                              : "bg-zinc-800 text-zinc-300"
                          )}
                        >
                          {item.count}
                        </span>
                      )}

                      {!collapsed && item.pill && (
                        <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 shrink-0">
                          {item.pill}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Sidebar Footer */}
        <div className="shrink-0 border-t border-[#1f1f23] p-3 bg-[#09090b]">
          {!collapsed ? (
            <div className="space-y-2">
              {liveMember && (
                <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#121215] border border-zinc-800/80">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-zinc-100 truncate">
                        {liveMember.name}
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate">
                        {ROLE_PRESETS[liveMember.role]?.label || liveMember.role}
                      </div>
                    </div>
                  </div>
                  <form action={logoutAction}>
                    <button
                      type="submit"
                      title="Log Out"
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </div>
              )}

              <button
                type="button"
                onClick={toggleCollapsed}
                className="w-full flex items-center justify-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#121215] hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-400 hover:text-white transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Collapse Sidebar</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={toggleCollapsed}
              title="Expand Sidebar"
              className="w-full flex items-center justify-center p-2 rounded-lg bg-[#121215] hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </aside>

      {/* ============================================================ */}
      {/* MAIN VIEWPORT CONTAINER                                      */}
      {/* ============================================================ */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Top Header Bar */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#1f1f23] bg-[#09090b]/90 px-4 sm:px-6 backdrop-blur-xl z-30">
          <div className="flex items-center gap-3.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="p-1.5 rounded-lg text-zinc-400 hover:bg-[#18181b] hover:text-white lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div>
              <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                <span className="text-zinc-300 font-medium truncate">{currentNicheName}</span>
              </div>
              <h1 className="text-sm sm:text-base font-bold text-white tracking-tight truncate">
                {getPageTitle()}
              </h1>
            </div>
          </div>

          {/* Right Header: Niche Switcher (Only if permitted) & User Menu */}
          <div className="flex items-center gap-3">
            {showNicheSwitcher && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setHeaderNicheOpen(!headerNicheOpen);
                    setSidebarNicheOpen(false);
                    setMemberDropdownOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#141418] hover:bg-[#1a1a20] border border-zinc-800 text-xs text-zinc-300 hover:text-white transition shadow-sm"
                  title="Active niche"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <span className="font-medium text-white max-w-[130px] sm:max-w-[180px] truncate">{currentNicheName}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                </button>

                {headerNicheOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-64 z-50 rounded-xl bg-[#121215] border border-zinc-800 shadow-2xl p-2 space-y-1 max-h-80 overflow-y-auto">
                    <div className="px-2 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center justify-between">
                      <span>Switch Niche</span>
                      <Zap className="w-3 h-3 text-zinc-400" />
                    </div>
                    {allowedMarketsForMember.map((n) => {
                      const isCurrent = activeMarket ? activeMarket.id === n.id : currentNicheName === n.name;
                      return (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            handleSwitchNiche(n.id);
                            setHeaderNicheOpen(false);
                          }}
                          className={cn(
                            "w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left text-xs transition",
                            isCurrent
                              ? "bg-zinc-800 text-white font-medium"
                              : "text-zinc-300 hover:bg-zinc-800/60"
                          )}
                        >
                          <span className="truncate pr-2">{n.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-black text-zinc-400 shrink-0">
                            {n.leadCount}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* User Profile Avatar & Dropdown */}
            {liveMember && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setMemberDropdownOpen(!memberDropdownOpen);
                    setHeaderNicheOpen(false);
                    setSidebarNicheOpen(false);
                  }}
                  className="flex items-center gap-2 rounded-full pl-1 pr-2.5 py-1 bg-[#141418] hover:bg-[#1a1a20] border border-zinc-800 text-xs transition shadow-sm"
                  title="Account profile"
                >
                  <div className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[11px] font-bold text-white shrink-0">
                    {liveMember.name?.charAt(0).toUpperCase() || "U"}
                  </div>
                  <span className="font-semibold text-white max-w-[110px] truncate hidden sm:inline">
                    {liveMember.name.replace(/\s*\(You\)/i, "")}
                  </span>
                  <span className="text-[10px] text-zinc-400 hidden md:inline">
                    {ROLE_PRESETS[liveMember.role]?.label || liveMember.role}
                  </span>
                  <ChevronDown className="w-3 h-3 text-zinc-400" />
                </button>

                {memberDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-60 z-50 rounded-xl border border-zinc-800 bg-[#121215] p-3 shadow-2xl space-y-2.5">
                    <div className="border-b border-zinc-800/80 pb-2.5">
                      <div className="text-xs font-semibold text-white truncate">{liveMember.name}</div>
                      <div className="text-[11px] text-zinc-400 truncate">{liveMember.email || "Workspace Account"}</div>
                      <span className="inline-block mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
                        {ROLE_PRESETS[liveMember.role]?.label || liveMember.role}
                      </span>
                    </div>

                    <Link
                      href="/settings"
                      onClick={() => setMemberDropdownOpen(false)}
                      className="block rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition"
                    >
                      {canManageTeam ? "Team & Settings" : "Account Settings"}
                    </Link>
                    {isOwner && (
                      <Link
                        href="/usage"
                        onClick={() => setMemberDropdownOpen(false)}
                        className="block rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition"
                      >
                        API Usage &amp; Quotas
                      </Link>
                    )}

                    <form action={logoutAction}>
                      <button
                        type="submit"
                        className="w-full text-left rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition"
                      >
                        Log Out
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 lg:p-6 transition-all bg-[#09090b]">
          <div className="w-full max-w-[1700px] mx-auto space-y-5">
            {!isAllowedOnCurrentPath && liveMember ? (
              <div className="mx-auto max-w-md rounded-xl border border-zinc-800 bg-[#121215] p-8 text-center space-y-4 mt-10">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-zinc-300">
                  <Lock className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-white">Redirecting to Your Workspace...</h2>
                  <p className="text-xs text-zinc-400">
                    Taking you to your permitted workspace view.
                  </p>
                </div>
                <div className="pt-2">
                  <Link
                    href={fallbackRoute}
                    className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-bold text-black hover:bg-zinc-200"
                  >
                    Continue
                  </Link>
                </div>
              </div>
            ) : (
              children
            )}
          </div>
        </main>
      </div>

      {/* ============================================================ */}
      {/* MODAL 1: CREATE / MANAGE NICHES (Owner / Permitted Only)     */}
      {/* ============================================================ */}
      {nicheModalOpen && canManageNiches && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-xl bg-[#121215] border border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <div>
                <h2 className="text-base font-bold text-white">Manage Niches</h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Create unlimited niches (HVAC, Real Estate, Medical, Solar, or any custom niche).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNicheModalOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-zinc-800 px-6 pt-2 gap-4">
              <button
                type="button"
                onClick={() => {
                  setNicheModalTab("create");
                  setModalError(null);
                  setModalSuccess(null);
                }}
                className={cn(
                  "pb-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5",
                  nicheModalTab === "create"
                    ? "border-white text-white"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                )}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add New Niche</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setNicheModalTab("manage");
                  setModalError(null);
                  setModalSuccess(null);
                }}
                className={cn(
                  "pb-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5",
                  nicheModalTab === "manage"
                    ? "border-white text-white"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                )}
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>All Niches ({allMarkets.length})</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {modalError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
                  {modalError}
                </div>
              )}
              {modalSuccess && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
                  {modalSuccess}
                </div>
              )}

              {nicheModalTab === "create" ? (
                <form onSubmit={handleCreateNicheSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-2">
                      Quick Templates (Or type any custom niche below)
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {NICHE_PRESET_TEMPLATES.map((preset) => (
                        <button
                          key={preset.category}
                          type="button"
                          onClick={() => applyPresetTemplate(preset.category)}
                          className={cn(
                            "px-3 py-2 rounded-lg border text-left text-xs transition",
                            nicheCategory === preset.category && nicheName === preset.name
                              ? "bg-zinc-800 border-zinc-500 text-white font-medium"
                              : "bg-[#09090b] border-zinc-800 text-zinc-300 hover:border-zinc-700"
                          )}
                        >
                          <div className="font-medium truncate">{preset.name}</div>
                          <div className="text-[10px] text-zinc-500 truncate">
                            {preset.keywords[0]}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-zinc-300 mb-1">
                        Niche Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={nicheName}
                        onChange={(e) => setNicheName(e.target.value)}
                        placeholder="e.g., Real Estate, Medical Clinics, HVAC..."
                        className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-1">
                        Category Tag
                      </label>
                      <input
                        type="text"
                        value={nicheCategory}
                        onChange={(e) => setNicheCategory(e.target.value)}
                        placeholder="e.g., real_estate"
                        className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1">
                      Short Description
                    </label>
                    <input
                      type="text"
                      value={nicheDesc}
                      onChange={(e) => setNicheDesc(e.target.value)}
                      placeholder="e.g., Local dental clinics, property management companies..."
                      className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1">
                      Search Keywords (comma-separated)
                    </label>
                    <textarea
                      rows={2}
                      value={nicheKeywords}
                      onChange={(e) => setNicheKeywords(e.target.value)}
                      placeholder="e.g., real estate brokerage, property management"
                      className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-1">
                        Business Type
                      </label>
                      <select
                        value={nicheBusinessType}
                        onChange={(e) => setNicheBusinessType(e.target.value as any)}
                        className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                      >
                        <option value="both">Residential &amp; Commercial</option>
                        <option value="residential">Residential / Consumer</option>
                        <option value="commercial">Commercial / B2B</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-1">
                        Minimum Score (0 - 100)
                      </label>
                      <input
                        type="number"
                        min={10}
                        max={95}
                        value={nicheMinScore}
                        onChange={(e) => setNicheMinScore(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="pt-3 border-t border-zinc-800 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setNicheModalOpen(false)}
                      className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isPending}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white hover:bg-zinc-200 text-black text-xs font-bold transition disabled:opacity-50"
                    >
                      {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      <span>Create Niche</span>
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-2.5">
                  {allMarkets.map((m) => {
                    const isCurrent = activeMarket?.id === m.id;
                    const isEditing = editingMarketId === m.id;

                    return (
                      <div
                        key={m.id}
                        className={cn(
                          "p-3.5 rounded-xl border transition-all",
                          isCurrent
                            ? "bg-zinc-800/60 border-zinc-600"
                            : "bg-[#09090b] border-zinc-800"
                        )}
                      >
                        {isEditing ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                                  Niche Name
                                </label>
                                <input
                                  type="text"
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-white"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                                  Description
                                </label>
                                <input
                                  type="text"
                                  value={editDesc}
                                  onChange={(e) => setEditDesc(e.target.value)}
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-white"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                                Keywords (comma-separated)
                              </label>
                              <input
                                type="text"
                                value={editKeywords}
                                onChange={(e) => setEditKeywords(e.target.value)}
                                className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-white"
                              />
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingMarketId(null)}
                                className="px-3 py-1.5 rounded-lg bg-zinc-800 text-xs text-zinc-300"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveEditMarket(m.id)}
                                className="px-3 py-1.5 rounded-lg bg-white text-black text-xs font-bold"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-white">{m.name}</span>
                                {isCurrent && (
                                  <span className="px-2 py-0.5 rounded bg-zinc-700 text-zinc-200 text-[10px] font-medium">
                                    Active
                                  </span>
                                )}
                                <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 text-[10px]">
                                  {m.leadCount} leads
                                </span>
                              </div>
                              <p className="text-xs text-zinc-400 mt-0.5">{m.description}</p>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {!isCurrent && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setNicheModalOpen(false);
                                    handleSwitchNiche(m.id);
                                  }}
                                  className="px-3 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-black text-xs font-bold transition"
                                >
                                  Switch
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => startEditingMarket(m)}
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white"
                                title="Edit Niche"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              {allMarkets.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteMarket(m.id, m.name)}
                                  className="p-1.5 rounded-lg text-zinc-400 hover:bg-rose-950/50 hover:text-rose-300"
                                  title="Remove Niche"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 2: CREATE NEW WORKSPACE                                */}
      {/* ============================================================ */}
      {tenantModalOpen && canManageNiches && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl bg-[#121215] border border-zinc-800 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <div>
                <h2 className="text-base font-bold text-white">New Workspace</h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Add a separate company or client workspace.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTenantModalOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTenantSubmit} className="p-6 space-y-4">
              {modalError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
                  {modalError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Workspace Name *
                </label>
                <input
                  type="text"
                  required
                  value={newTenantName}
                  onChange={(e) => setNewTenantName(e.target.value)}
                  placeholder="e.g., Apex Agency, Client Workspace..."
                  className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Your Role
                </label>
                <input
                  type="text"
                  value={newTenantRole}
                  onChange={(e) => setNewTenantRole(e.target.value)}
                  placeholder="e.g., Owner, Manager"
                  className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    First Niche Template
                  </label>
                  <select
                    value={newTenantInitialCategory}
                    onChange={(e) => {
                      const cat = e.target.value;
                      setNewTenantInitialCategory(cat);
                      const preset = NICHE_PRESET_TEMPLATES.find((p) => p.category === cat);
                      if (preset) setNewTenantInitialNiche(preset.name);
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  >
                    {NICHE_PRESET_TEMPLATES.map((p) => (
                      <option key={p.category} value={p.category}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    First Niche Name
                  </label>
                  <input
                    type="text"
                    value={newTenantInitialNiche}
                    onChange={(e) => setNewTenantInitialNiche(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTenantModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white hover:bg-zinc-200 text-black text-xs font-bold"
                >
                  {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Create Workspace</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const BARE_ROUTES = ["/login", "/invite/"];

/** Login and invite screens render without the workspace chrome. */
export function AppShell(props: AppShellProps) {
  const pathname = usePathname();
  if (BARE_ROUTES.some((r) => pathname === r.replace(/\/$/, "") || pathname.startsWith(r))) {
    return <>{props.children}</>;
  }
  return <AppShellInner {...props} />;
}
