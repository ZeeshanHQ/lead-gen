"use client";

import React, { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { MarketView, TenantWorkspace } from "@/server/repo/markets";
import { NICHE_PRESET_TEMPLATES } from "@/server/domain/markets";
import { type TeamMember, ROLE_PRESETS, type PermissionKey } from "@/server/domain/team";
import {
  switchMarketAction,
  switchTenantAction,
  createNicheAction,
  updateNicheAction,
  deleteNicheAction,
  createTenantWorkspaceAction,
} from "@/app/actions/tenant";
import { switchActiveMemberAction } from "@/app/settings/actions";
import { logoutAction } from "@/app/login/actions";
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
  reviewCount = 0,
  approvedCount = 0,
  callerCount = 0,
  activeTenant,
  allTenants = [],
  activeMarket,
  tenantMarkets = [],
  allMarkets = [],
  activeMember,
  allMembers = [],
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false);
  const [nicheDropdownOpen, setNicheDropdownOpen] = useState(false);
  const [memberDropdownOpen, setMemberDropdownOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number>(0.9);

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

  const currentTenantName = activeTenant?.name || "Astraventa Workspace";
  const currentNicheName = activeMarket?.name || "Active Niche";

  const displayedTenants: TenantWorkspace[] =
    allTenants.length > 0
      ? allTenants
      : [{ id: "tenant_main", name: "Astraventa Workspace", role: "Owner" }];

  const displayedMarkets: MarketView[] =
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

  useEffect(() => {
    setMobileOpen(false);
    setTenantDropdownOpen(false);
    setNicheDropdownOpen(false);
    setMemberDropdownOpen(false);
  }, [pathname]);

  useEffect(() => {
    const saved = localStorage.getItem("astraventa_sidebar_collapsed");
    if (saved === "true") setCollapsed(true);
    const savedZoom = localStorage.getItem("astraventa_dashboard_zoom");
    if (savedZoom) setZoomLevel(parseFloat(savedZoom));
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("astraventa_sidebar_collapsed", String(next));
  };

  const handleZoomChange = (val: number) => {
    setZoomLevel(val);
    localStorage.setItem("astraventa_dashboard_zoom", String(val));
  };

  const handleSwitchTenant = (tenantId: string) => {
    setTenantDropdownOpen(false);
    startTransition(async () => {
      await switchTenantAction(tenantId);
      router.refresh();
    });
  };

  const handleSwitchNiche = (marketId: string) => {
    setNicheDropdownOpen(false);
    startTransition(async () => {
      await switchMarketAction(marketId);
      router.refresh();
    });
  };

  const handleSwitchMember = (memberId: string) => {
    setMemberDropdownOpen(false);
    startTransition(async () => {
      await switchActiveMemberAction(memberId);
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
    }>;
  }> = [
    {
      group: "Core Pipeline",
      items: [
        { href: "/", label: "Dashboard", icon: LayoutDashboard },
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
        { href: "/settings", label: "Team & Settings", icon: Settings, perm: "manageTeamAndSettings" },
      ],
    },
  ];

  // Filter navigation so only permitted options appear for the active member
  const visibleNavGroups = allNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !item.perm || !activeMember || activeMember.permissions[item.perm] === true
      ),
    }))
    .filter((group) => group.items.length > 0);

  // Check if current route requires a permission that the active member lacks
  const currentMatchedItem = allNavGroups
    .flatMap((g) => g.items)
    .find((item) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)));

  // Always allow /settings so the user can manage team or switch views
  const isCurrentRouteRestricted =
    pathname !== "/settings" &&
    Boolean(
      currentMatchedItem?.perm &&
        activeMember &&
        activeMember.permissions[currentMatchedItem.perm] === false
    );

  const getPageTitle = () => {
    for (const g of allNavGroups) {
      for (const item of g.items) {
        if (item.href === "/" && pathname === "/") return "Overview";
        if (item.href !== "/" && pathname.startsWith(item.href)) return item.label;
      }
    }
    if (pathname.startsWith("/company/")) return "Company Details";
    return "Lead Workspace";
  };

  const canManageNiches = !activeMember || activeMember.permissions.manageNiches;
  const canDiscover = !activeMember || activeMember.permissions.discoverLeads;
  const ownerMember = allMembers.find((m) => m.role === "OWNER") || allMembers[0];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#09090b] text-zinc-100">
      {/* Global Switching Indicator Toast */}
      {isPending && (
        <div className="fixed top-4 right-4 z-[100] flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-medium text-xs shadow-xl">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
          <span>Updating workspace...</span>
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
          "fixed inset-y-0 left-0 z-50 flex flex-col bg-[#0c0c0e] border-r border-[#1f1f23] backdrop-blur-xl transition-all duration-300 ease-in-out lg:static",
          collapsed ? "w-20" : "w-64 xl:w-72",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Brand Header */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#1f1f23] px-4">
          <Link href="/" className="flex items-center gap-3 overflow-hidden group">
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
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-900 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Workspace & Niche Selector */}
        {!collapsed && (
          <div className="p-3 border-b border-[#1f1f23] space-y-2 bg-slate-900/30">
            {/* Workspace Selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setTenantDropdownOpen(!tenantDropdownOpen);
                  setNicheDropdownOpen(false);
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-950/90 border border-slate-800 hover:border-slate-700 text-left transition-all"
              >
                <div className="min-w-0">
                  <div className="text-[10px] font-medium text-slate-500">Workspace</div>
                  <div className="text-xs font-medium text-slate-200 truncate flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                    <span className="truncate">{currentTenantName}</span>
                  </div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
              </button>

              {tenantDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-full z-50 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-1.5 space-y-1 max-h-80 overflow-y-auto">
                  <div className="px-2 py-1 text-[10px] font-medium text-slate-400 flex items-center justify-between">
                    <span>Switch Workspace</span>
                    <Briefcase className="w-3 h-3 text-slate-400" />
                  </div>
                  {displayedTenants.map((t) => {
                    const isCurrent = activeTenant ? activeTenant.id === t.id : currentTenantName === t.name;
                    const countForTenant = allMarkets.filter((m) => m.tenantId === t.id).length;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleSwitchTenant(t.id)}
                        className={cn(
                          "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors",
                          isCurrent
                            ? "bg-slate-800 text-white font-medium"
                            : "text-slate-300 hover:bg-slate-800/60"
                        )}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="truncate">{t.name}</div>
                          <div className="text-[10px] text-slate-500 truncate">
                            {countForTenant || 1} niche{countForTenant === 1 ? "" : "s"}
                          </div>
                        </div>
                        {isCurrent && <Check className="w-3.5 h-3.5 text-white shrink-0" />}
                      </button>
                    );
                  })}

                  {canManageNiches && (
                    <div className="pt-1 mt-1 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={() => {
                          setTenantDropdownOpen(false);
                          setModalError(null);
                          setTenantModalOpen(true);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>New Workspace</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Niche Selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNicheDropdownOpen(!nicheDropdownOpen);
                  setTenantDropdownOpen(false);
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-950/90 border border-slate-800 hover:border-slate-700 text-left transition-all"
              >
                <div className="min-w-0">
                  <div className="text-[10px] font-medium text-slate-500 flex items-center justify-between">
                    <span>Active Niche</span>
                    <span className="text-slate-400 ml-1">({allMarkets.length})</span>
                  </div>
                  <div className="text-xs font-medium text-white truncate flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span className="truncate">{currentNicheName}</span>
                  </div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
              </button>

              {nicheDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-72 z-50 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-2 space-y-1.5 max-h-[420px] overflow-y-auto">
                  <div className="px-2 py-1 text-[10px] font-medium text-slate-400 flex items-center justify-between">
                    <span>Switch Niche</span>
                    <span className="text-[10px] text-slate-500">
                      {activeMember?.nicheScope === "SELECTED" ? "Assigned to you" : "All niches"}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {(allMarkets.length > 0 ? allMarkets : displayedMarkets)
                      .filter(
                        (n) =>
                          !activeMember ||
                          activeMember.nicheScope === "ALL" ||
                          activeMember.allowedNicheIds.length === 0 ||
                          activeMember.allowedNicheIds.includes(n.id)
                      )
                      .map((n) => {
                        const isCurrent = activeMarket ? activeMarket.id === n.id : currentNicheName === n.name;
                        return (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => handleSwitchNiche(n.id)}
                            className={cn(
                              "w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left text-xs transition-all",
                              isCurrent
                                ? "bg-slate-800 text-white font-medium border border-slate-700"
                                : "text-slate-300 hover:bg-slate-800/60 border border-transparent"
                            )}
                          >
                            <div className="min-w-0 pr-2">
                              <div className="truncate flex items-center gap-1.5">
                                {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />}
                                <span className="truncate">{n.name}</span>
                              </div>
                              <div className="text-[10px] text-slate-400 truncate mt-0.5">
                                {n.description || "Custom niche"}
                              </div>
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-950 text-slate-300 shrink-0">
                              {n.leadCount} leads
                            </span>
                          </button>
                        );
                      })}
                  </div>

                  {canManageNiches && (
                    <div className="pt-1.5 mt-1.5 border-t border-slate-800 flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setNicheDropdownOpen(false);
                          setNicheModalTab("create");
                          setModalError(null);
                          setModalSuccess(null);
                          setNicheModalOpen(true);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-white hover:bg-slate-200 text-slate-950 text-xs font-medium transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add New Niche</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setNicheDropdownOpen(false);
                          setNicheModalTab("manage");
                          setModalError(null);
                          setModalSuccess(null);
                          setNicheModalOpen(true);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium transition-colors"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Manage Niches ({allMarkets.length})</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Navigation Groups (Strictly filtered by activeMember permissions) */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {visibleNavGroups.map((group) => (
            <div key={group.group} className="space-y-1">
              {!collapsed ? (
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {group.group}
                </div>
              ) : (
                <div className="h-2 border-t border-[#1f1f23] mx-2" />
              )}

              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={true}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "group flex items-center gap-3 rounded-lg px-2.5 py-2 text-xs font-medium transition-all relative",
                        isActive
                          ? "bg-slate-800/90 text-white"
                          : "text-slate-400 hover:bg-slate-900/80 hover:text-slate-200"
                      )}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-sky-400" />
                      )}

                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0 transition-colors",
                          isActive
                            ? "text-sky-400"
                            : "text-slate-400 group-hover:text-slate-200"
                        )}
                      />

                      {!collapsed && <span className="truncate flex-1">{item.label}</span>}

                      {!collapsed && item.count !== undefined && item.count > 0 && (
                        <span
                          className={cn(
                            "ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0",
                            item.highlight
                              ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                              : "bg-slate-800 text-slate-300"
                          )}
                        >
                          {item.count}
                        </span>
                      )}

                      {!collapsed && item.pill && (
                        <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">
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
        <div className="shrink-0 border-t border-[#1f1f23] p-3 bg-slate-950/90">
          {!collapsed ? (
            <div className="space-y-2">
              {activeMember && (
                <Link
                  href="/settings"
                  className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-slate-900/70 hover:bg-slate-900 border border-[#1f1f23] transition-colors"
                  title="Open Team & Settings"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-200 truncate">
                        {activeMember.name}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {ROLE_PRESETS[activeMember.role]?.label || activeMember.role}
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">
                    Team
                  </span>
                </Link>
              )}

              <button
                type="button"
                onClick={toggleCollapsed}
                className="w-full flex items-center justify-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-400 hover:text-white transition-colors"
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
              className="w-full flex items-center justify-center p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition-colors"
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
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#1f1f23] bg-[#09090b]/85 px-4 sm:px-6 backdrop-blur-xl z-30">
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
                <span className="truncate max-w-[160px] text-zinc-400 font-medium">{currentTenantName}</span>
                <span className="text-zinc-600">/</span>
                <span className="text-zinc-300 font-medium truncate">{currentNicheName}</span>
              </div>
              <h1 className="text-sm sm:text-base font-bold text-white tracking-tight truncate">
                {getPageTitle()}
              </h1>
            </div>
          </div>

          {/* Right Header: Niche Selector & User Menu */}
          <div className="flex items-center gap-3">
            {/* Clean Niche Switcher Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNicheDropdownOpen(!nicheDropdownOpen);
                  setMemberDropdownOpen(false);
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#141418] hover:bg-[#1a1a20] border border-zinc-800 text-xs text-zinc-300 hover:text-white transition shadow-sm"
                title="Active niche"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="font-medium text-white max-w-[130px] sm:max-w-[180px] truncate">{currentNicheName}</span>
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              </button>

              {nicheDropdownOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-64 z-50 rounded-xl bg-[#121215] border border-zinc-800 shadow-2xl p-2 space-y-1 max-h-80 overflow-y-auto">
                  <div className="px-2 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center justify-between">
                    <span>Switch Niche</span>
                    <Zap className="w-3 h-3 text-zinc-400" />
                  </div>
                  {displayedMarkets.map((n) => {
                    const isCurrent = activeMarket ? activeMarket.id === n.id : currentNicheName === n.name;
                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => {
                          handleSwitchNiche(n.id);
                          setNicheDropdownOpen(false);
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

            {/* User Profile Avatar & Dropdown */}
            {activeMember && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setMemberDropdownOpen(!memberDropdownOpen);
                    setNicheDropdownOpen(false);
                  }}
                  className="flex items-center gap-2 rounded-full pl-1 pr-2.5 py-1 bg-[#141418] hover:bg-[#1a1a20] border border-zinc-800 text-xs transition shadow-sm"
                  title="Account profile"
                >
                  <div className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[11px] font-bold text-white shrink-0">
                    {activeMember.name?.charAt(0).toUpperCase() || "U"}
                  </div>
                  <span className="font-semibold text-white max-w-[110px] truncate hidden sm:inline">
                    {activeMember.name.replace(/\s*\(You\)/i, "")}
                  </span>
                  <span className="text-[10px] text-zinc-400 hidden md:inline">
                    {ROLE_PRESETS[activeMember.role]?.label || activeMember.role}
                  </span>
                  <ChevronDown className="w-3 h-3 text-zinc-400" />
                </button>

                {memberDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-60 z-50 rounded-xl border border-zinc-800 bg-[#121215] p-3 shadow-2xl space-y-2.5">
                    <div className="border-b border-zinc-800/80 pb-2.5">
                      <div className="text-xs font-semibold text-white truncate">{activeMember.name}</div>
                      <div className="text-[11px] text-zinc-400 truncate">{activeMember.email || "Workspace Account"}</div>
                      <span className="inline-block mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
                        {ROLE_PRESETS[activeMember.role]?.label || activeMember.role}
                      </span>
                    </div>

                    {canManageNiches && (
                      <Link
                        href="/settings"
                        onClick={() => setMemberDropdownOpen(false)}
                        className="block rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition"
                      >
                        Team &amp; Settings
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
            {isCurrentRouteRestricted && activeMember ? (
              <div className="mx-auto max-w-lg rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center space-y-4 mt-10">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-slate-300">
                  <Lock className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-white">
                    Page Not Enabled for {activeMember.name}
                  </h2>
                  <p className="text-xs text-slate-400">
                    Your current role ({ROLE_PRESETS[activeMember.role]?.label || activeMember.role})
                    does not have access to <strong>{getPageTitle()}</strong>.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                  <Link
                    href="/"
                    className="rounded-lg bg-white px-4 py-2 text-xs font-medium text-slate-950 hover:bg-slate-200"
                  >
                    Go to Overview
                  </Link>
                  {ownerMember && ownerMember.id !== activeMember.id && (
                    <button
                      type="button"
                      onClick={() => handleSwitchMember(ownerMember.id)}
                      className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
                    >
                      Switch Back to {ownerMember.name}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              children
            )}
          </div>
        </main>
      </div>

      {/* ============================================================ */}
      {/* MODAL 1: CREATE / MANAGE NICHES                              */}
      {/* ============================================================ */}
      {nicheModalOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <div>
                <h2 className="text-base font-semibold text-white">Manage Niches</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Create unlimited niches (HVAC, Real Estate, Medical, Solar, or any custom niche).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNicheModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-800 px-6 pt-2 gap-4">
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
                    : "border-transparent text-slate-400 hover:text-slate-200"
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
                    : "border-transparent text-slate-400 hover:text-slate-200"
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
                    <label className="block text-xs font-medium text-slate-300 mb-2">
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
                              ? "bg-slate-800 border-slate-500 text-white font-medium"
                              : "bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700"
                          )}
                        >
                          <div className="font-medium truncate">{preset.name}</div>
                          <div className="text-[10px] text-slate-500 truncate">
                            {preset.keywords[0]}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Niche Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={nicheName}
                        onChange={(e) => setNicheName(e.target.value)}
                        placeholder="e.g., Real Estate, Medical Clinics, HVAC..."
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:border-slate-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Category Tag
                      </label>
                      <input
                        type="text"
                        value={nicheCategory}
                        onChange={(e) => setNicheCategory(e.target.value)}
                        placeholder="e.g., real_estate"
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:border-slate-600 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Short Description
                    </label>
                    <input
                      type="text"
                      value={nicheDesc}
                      onChange={(e) => setNicheDesc(e.target.value)}
                      placeholder="e.g., Local dental clinics, property management companies..."
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:border-slate-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Search Keywords (comma-separated)
                    </label>
                    <textarea
                      rows={2}
                      value={nicheKeywords}
                      onChange={(e) => setNicheKeywords(e.target.value)}
                      placeholder="e.g., real estate brokerage, property management"
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:border-slate-600 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Business Type
                      </label>
                      <select
                        value={nicheBusinessType}
                        onChange={(e) => setNicheBusinessType(e.target.value as any)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:border-slate-600 focus:outline-none"
                      >
                        <option value="both">Residential &amp; Commercial</option>
                        <option value="residential">Residential / Consumer</option>
                        <option value="commercial">Commercial / B2B</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Minimum Score (0 - 100)
                      </label>
                      <input
                        type="number"
                        min={10}
                        max={95}
                        value={nicheMinScore}
                        onChange={(e) => setNicheMinScore(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:border-slate-600 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setNicheModalOpen(false)}
                      className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isPending}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white hover:bg-slate-200 text-slate-950 text-xs font-medium transition disabled:opacity-50"
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
                            ? "bg-slate-800/60 border-slate-600"
                            : "bg-slate-950/60 border-slate-800"
                        )}
                      >
                        {isEditing ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                                  Niche Name
                                </label>
                                <input
                                  type="text"
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                                  Description
                                </label>
                                <input
                                  type="text"
                                  value={editDesc}
                                  onChange={(e) => setEditDesc(e.target.value)}
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                                Keywords (comma-separated)
                              </label>
                              <input
                                type="text"
                                value={editKeywords}
                                onChange={(e) => setEditKeywords(e.target.value)}
                                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                              />
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingMarketId(null)}
                                className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveEditMarket(m.id)}
                                className="px-3 py-1.5 rounded-lg bg-white text-slate-950 text-xs font-medium"
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
                                  <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-200 text-[10px] font-medium">
                                    Active
                                  </span>
                                )}
                                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 text-[10px]">
                                  {m.leadCount} leads
                                </span>
                              </div>
                              <p className="text-xs text-slate-400 mt-0.5">{m.description}</p>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {!isCurrent && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setNicheModalOpen(false);
                                    handleSwitchNiche(m.id);
                                  }}
                                  className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-200 text-slate-950 text-xs font-medium transition"
                                >
                                  Switch
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => startEditingMarket(m)}
                                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white"
                                title="Edit Niche"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              {allMarkets.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteMarket(m.id, m.name)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-950/50 hover:text-rose-300"
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
      {tenantModalOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <div>
                <h2 className="text-base font-semibold text-white">New Workspace</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Add a separate company or client workspace.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTenantModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
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
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Workspace Name *
                </label>
                <input
                  type="text"
                  required
                  value={newTenantName}
                  onChange={(e) => setNewTenantName(e.target.value)}
                  placeholder="e.g., Apex Agency, Client Workspace..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:border-slate-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Your Role
                </label>
                <input
                  type="text"
                  value={newTenantRole}
                  onChange={(e) => setNewTenantRole(e.target.value)}
                  placeholder="e.g., Owner, Manager"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:border-slate-600 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
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
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:border-slate-600 focus:outline-none"
                  >
                    {NICHE_PRESET_TEMPLATES.map((p) => (
                      <option key={p.category} value={p.category}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    First Niche Name
                  </label>
                  <input
                    type="text"
                    value={newTenantInitialNiche}
                    onChange={(e) => setNewTenantInitialNiche(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:border-slate-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTenantModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white hover:bg-slate-200 text-slate-950 text-xs font-medium"
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
