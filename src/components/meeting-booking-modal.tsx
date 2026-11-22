"use client";

import React, { useState, useEffect, useTransition } from "react";
import type { CallerLeadView } from "@/server/repo/caller";
import type { MeetingPlatform, MeetingRecord } from "@/server/repo/meetings";
import {
  bookDiscoveryMeetingAction,
  getCompanyMeetingsAction,
} from "@/app/caller/actions";
import { buildPresetFollowUpIso } from "@/components/crm-lead-sheet";
import {
  X,
  Calendar,
  Video,
  Phone,
  MapPin,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Send,
  User,
  Mail,
  FileText,
  History,
  ExternalLink,
} from "lucide-react";

interface MeetingBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: CallerLeadView;
  actorName: string;
  onMeetingBooked?: (result: {
    meetingId: string;
    followUpDate: string;
    updatedNotes: string;
  }) => void;
}

const PLATFORM_OPTIONS: { id: MeetingPlatform; label: string; icon: React.ElementType }[] = [
  { id: "ZOOM", label: "Zoom", icon: Video },
  { id: "GOOGLE_MEET", label: "Google Meet", icon: Video },
  { id: "PHONE", label: "Phone Call", icon: Phone },
  { id: "IN_PERSON", label: "In Person", icon: MapPin },
];

export function MeetingBookingModal({
  isOpen,
  onClose,
  lead,
  actorName,
  onMeetingBooked,
}: MeetingBookingModalProps) {
  const [isPending, startTransition] = useTransition();
  const [meetingAt, setMeetingAt] = useState<string>("");
  const [platform, setPlatform] = useState<MeetingPlatform>("ZOOM");
  const [meetingUrl, setMeetingUrl] = useState<string>("");
  const [attendeeName, setAttendeeName] = useState<string>("");
  const [attendeeEmail, setAttendeeEmail] = useState<string>("");
  const [prepNotes, setPrepNotes] = useState<string>("");
  const [sendConfirmationEmail, setSendConfirmationEmail] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pastMeetings, setPastMeetings] = useState<MeetingRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen || !lead) return;

    setErrorMsg(null);

    // 1. Initial meeting time (tomorrow 10:00 AM prospect-local time)
    const initialIso = buildPresetFollowUpIso("TOMORROW", lead.state);
    setMeetingAt(initialIso);

    // 2. Pre-fill attendee details
    const defaultName = lead.bestContact?.name?.trim() || "";
    setAttendeeName(defaultName);

    let defaultEmail = lead.bestContact?.email?.trim() || "";
    if (!defaultEmail && lead.notes) {
      const match = lead.notes.match(/Email:\s*([^\s•\n]+@[^\s•\n]+)/i);
      if (match && match[1]) {
        defaultEmail = match[1].trim();
      }
    }
    setAttendeeEmail(defaultEmail);
    setSendConfirmationEmail(Boolean(defaultEmail));

    // 3. Pre-fill prep notes from pain points or facts
    let initialPrep = "";
    if (lead.painIdentified) {
      initialPrep = `Pain: ${lead.painIdentified}`;
    } else if (lead.facts?.["pain_point"]) {
      initialPrep = `Pain: ${lead.facts["pain_point"]}`;
    }
    setPrepNotes(initialPrep);

    // 4. Load past meetings
    setLoadingHistory(true);
    getCompanyMeetingsAction(lead.companyId)
      .then((res) => {
        if (res.success && res.meetings) {
          setPastMeetings(res.meetings);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [isOpen, lead]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!meetingAt) {
      setErrorMsg("Please select a meeting date and time.");
      return;
    }

    startTransition(async () => {
      const res = await bookDiscoveryMeetingAction({
        companyId: lead.companyId,
        meetingAt,
        platform,
        meetingUrl: meetingUrl.trim() || null,
        attendeeName: attendeeName.trim() || null,
        attendeeEmail: attendeeEmail.trim() || null,
        bookedBy: actorName,
        prepNotes: prepNotes.trim() || null,
        sendConfirmationEmail: sendConfirmationEmail && Boolean(attendeeEmail.trim()),
      });

      if (!res.success) {
        setErrorMsg(res.error || "Failed to book discovery meeting");
        return;
      }

      if (onMeetingBooked && res.meetingId && res.followUpDate && res.updatedNotes) {
        onMeetingBooked({
          meetingId: res.meetingId,
          followUpDate: res.followUpDate,
          updatedNotes: res.updatedNotes,
        });
      }

      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-2xl bg-[#0e0f12] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800/80 bg-zinc-950/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <span>Book Discovery Meeting</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">
                  Meeting Booked
                </span>
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                {lead.name} {lead.city ? `• ${lead.city}, ${lead.state}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMsg && (
            <div className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form id="meeting-booking-form" onSubmit={handleSubmit} className="space-y-4">
            {/* Meeting Date & Platform Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Meeting Date & Time <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type="datetime-local"
                    required
                    value={meetingAt}
                    onChange={(e) => setMeetingAt(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-800 bg-zinc-900/90 text-sm text-white focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 transition"
                  />
                </div>
                <p className="text-[10px] text-zinc-500 mt-1">
                  Synchronizes with follow-up calendar and caller focus queue.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Platform / Channel
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {PLATFORM_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const isSelected = platform === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setPlatform(opt.id)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition cursor-pointer ${
                          isSelected
                            ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300 shadow-sm"
                            : "bg-zinc-900/50 border-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Meeting URL (Video Link) */}
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Meeting Link / URL (Optional)
              </label>
              <div className="relative">
                <input
                  type="url"
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                  placeholder="https://zoom.us/j/... or https://meet.google.com/..."
                  className="w-full px-3.5 py-2 rounded-xl border border-zinc-800 bg-zinc-900/90 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 transition"
                />
              </div>
            </div>

            {/* Attendee Details */}
            <div className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-950/40 space-y-3">
              <div className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-zinc-400" />
                <span>Prospect Attendee Details</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    Decision Maker Name
                  </label>
                  <input
                    type="text"
                    value={attendeeName}
                    onChange={(e) => setAttendeeName(e.target.value)}
                    placeholder="e.g. Sarah Jenkins"
                    className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900/90 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/60 transition"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    Prospect Email
                  </label>
                  <input
                    type="email"
                    value={attendeeEmail}
                    onChange={(e) => setAttendeeEmail(e.target.value)}
                    placeholder="sarah@brokerage.com"
                    className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900/90 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/60 transition"
                  />
                </div>
              </div>

              {/* Confirmation Email Checkbox */}
              {attendeeEmail.trim() && (
                <label className="flex items-center gap-2.5 pt-1 text-xs text-zinc-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={sendConfirmationEmail}
                    onChange={(e) => setSendConfirmationEmail(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500/40"
                  />
                  <span>
                    Send calendar confirmation email to{" "}
                    <strong className="text-white">{attendeeEmail}</strong> immediately
                  </span>
                </label>
              )}
            </div>

            {/* Prep Notes */}
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5 flex items-center justify-between">
                <span>Discovery Prep Notes & Pain Points</span>
                <span className="text-[10px] text-zinc-500 font-normal">
                  Visible to executive team in Admin Monitor
                </span>
              </label>
              <textarea
                rows={3}
                value={prepNotes}
                onChange={(e) => setPrepNotes(e.target.value)}
                placeholder="Key pain points discovered, current tech stack, team size, primary goals for demo..."
                className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-900/90 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 transition resize-none leading-relaxed"
              />
            </div>
          </form>

          {/* Past Meetings Accordion */}
          {pastMeetings.length > 0 && (
            <div className="pt-2 border-t border-zinc-800/80">
              <div className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5 mb-2.5">
                <History className="w-3.5 h-3.5 text-zinc-500" />
                <span>Past Meeting History ({pastMeetings.length})</span>
              </div>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {pastMeetings.map((pm) => (
                  <div
                    key={pm.id}
                    className="p-2.5 rounded-lg border border-zinc-800/60 bg-zinc-950/60 text-xs flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-semibold text-zinc-200 flex items-center gap-2">
                        <span>{new Date(pm.meetingAt).toLocaleString()}</span>
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded font-semibold uppercase ${
                            pm.status === "ATTENDED"
                              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                              : pm.status === "NO_SHOW"
                              ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                              : pm.status === "RESCHEDULED"
                              ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                              : "bg-zinc-800 text-zinc-300"
                          }`}
                        >
                          {pm.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">
                        {pm.platform} &bull; Booked by {pm.bookedBy}
                        {pm.attendeeName ? ` for ${pm.attendeeName}` : ""}
                      </div>
                    </div>
                    {pm.meetingUrl && (
                      <a
                        href={pm.meetingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1 text-[11px]"
                      >
                        <span>Link</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800/80 bg-zinc-950/80 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="meeting-booking-form"
            disabled={isPending}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs shadow-lg shadow-emerald-500/20 transition cursor-pointer disabled:opacity-50"
          >
            {isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Booking Discovery Call...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Confirm Discovery Meeting</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
