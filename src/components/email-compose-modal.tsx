"use client";

import React, { useState, useEffect, useTransition } from "react";
import type { CallerLeadView } from "@/server/repo/caller";
import {
  EMAIL_TEMPLATES,
  renderEmailTemplate,
} from "@/server/domain/email-templates";
import {
  sendProspectEmailAction,
  getCompanyEmailsAction,
} from "@/app/caller/actions";
import type { EmailActivityRecord } from "@/server/repo/email-activities";
import {
  X,
  Mail,
  Send,
  Loader2,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  User,
  Building2,
  History,
} from "lucide-react";

interface EmailComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: CallerLeadView;
  actorName: string;
  onEmailSent?: (result: { followUpDate: string; updatedNotes: string }) => void;
}

export function EmailComposeModal({
  isOpen,
  onClose,
  lead,
  actorName,
  onEmailSent,
}: EmailComposeModalProps) {
  const [isPending, startTransition] = useTransition();
  const [selectedTemplate, setSelectedTemplate] = useState<string>("info_requested");
  const [recipientEmail, setRecipientEmail] = useState<string>("");
  const [recipientName, setRecipientName] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [bodyText, setBodyText] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pastEmails, setPastEmails] = useState<EmailActivityRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  // Extract best initial recipient email & name from lead data
  useEffect(() => {
    if (!isOpen || !lead) return;

    setErrorMsg(null);

    // 1. Resolve recipient email
    let defaultEmail = lead.bestContact?.email?.trim() || "";
    if (!defaultEmail && lead.notes) {
      const match = lead.notes.match(/Email:\s*([^\s•\n]+@[^\s•\n]+)/i);
      if (match && match[1]) {
        defaultEmail = match[1].trim();
      }
    }
    setRecipientEmail(defaultEmail);

    // 2. Resolve recipient name
    const defaultName = lead.bestContact?.name?.trim() || "";
    setRecipientName(defaultName);

    // 3. Render initial template
    const rendered = renderEmailTemplate("info_requested", {
      ownerName: defaultName,
      companyName: lead.name,
      senderName: actorName,
      city: lead.city || lead.state || "",
    });
    setSubject(rendered.subject);
    setBodyText(rendered.bodyText);
    setSelectedTemplate("info_requested");

    // 4. Fetch past emails for this company
    setLoadingHistory(true);
    getCompanyEmailsAction(lead.companyId)
      .then((res) => {
        if (res.success && res.emails) {
          setPastEmails(res.emails);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [isOpen, lead, actorName]);

  // Handle template selection change
  const handleTemplateChange = (templateKey: string) => {
    setSelectedTemplate(templateKey);
    if (templateKey === "custom") return;

    const rendered = renderEmailTemplate(templateKey, {
      ownerName: recipientName || lead.bestContact?.name,
      companyName: lead.name,
      senderName: actorName,
      city: lead.city || lead.state || "",
    });
    setSubject(rendered.subject);
    setBodyText(rendered.bodyText);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientEmail.trim() || !recipientEmail.includes("@")) {
      setErrorMsg("Please provide a valid recipient email address.");
      return;
    }
    if (!subject.trim()) {
      setErrorMsg("Email subject cannot be empty.");
      return;
    }
    if (!bodyText.trim()) {
      setErrorMsg("Email body cannot be empty.");
      return;
    }

    setErrorMsg(null);
    startTransition(async () => {
      const res = await sendProspectEmailAction({
        companyId: lead.companyId,
        recipientEmail: recipientEmail.trim(),
        recipientName: recipientName.trim() || null,
        templateKey: selectedTemplate,
        subject: subject.trim(),
        bodyText: bodyText.trim(),
        actor: actorName,
      });

      if (res.success) {
        if (onEmailSent) {
          onEmailSent({
            followUpDate: res.followUpDate || "",
            updatedNotes: res.updatedNotes || "",
          });
        }
        onClose();
      } else {
        setErrorMsg(res.error || "Failed to dispatch email.");
      }
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-[#121215] border border-zinc-700/80 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Mail className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                Send Prospect Email
                <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-normal">
                  {lead.name}
                </span>
              </h2>
              <p className="text-[11px] text-zinc-400">
                Dispatches CAN-SPAM compliant email & auto-schedules +2 business day follow-up call.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Recipient Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-zinc-300 uppercase tracking-wider mb-1">
                Recipient Email <span className="text-rose-400">*</span>
              </label>
              <input
                type="email"
                required
                placeholder="owner@company.com"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-zinc-950/80 border border-zinc-700 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400 transition"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-zinc-300 uppercase tracking-wider mb-1">
                Recipient Name
              </label>
              <input
                type="text"
                placeholder="First Last (Owner / GM)"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-zinc-950/80 border border-zinc-700 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400 transition"
              />
            </div>
          </div>

          {/* Template Selector */}
          <div>
            <label className="block text-[11px] font-semibold text-zinc-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              Choose Email Template
            </label>
            <select
              value={selectedTemplate}
              onChange={(e) => handleTemplateChange(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-zinc-950/80 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:border-amber-400 transition"
            >
              {Object.values(EMAIL_TEMPLATES).map((tmpl) => (
                <option key={tmpl.key} value={tmpl.key}>
                  {tmpl.label}
                </option>
              ))}
              <option value="custom">Custom Email (Freeform)</option>
            </select>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-[11px] font-semibold text-zinc-300 uppercase tracking-wider mb-1">
              Subject Line <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-zinc-950/80 border border-zinc-700 text-xs text-white focus:outline-none focus:border-amber-400 transition"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-[11px] font-semibold text-zinc-300 uppercase tracking-wider mb-1">
              Email Body <span className="text-rose-400">*</span>
            </label>
            <textarea
              required
              rows={8}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-zinc-950/80 border border-zinc-700 text-xs text-zinc-100 font-mono leading-relaxed focus:outline-none focus:border-amber-400 transition"
            />
          </div>

          {/* Past Emails Accordion / Section */}
          <div className="pt-2 border-t border-zinc-800">
            <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-zinc-400">
              <History className="w-3.5 h-3.5 text-zinc-400" />
              <span>Email Activity History ({pastEmails.length})</span>
            </div>
            {loadingHistory ? (
              <div className="p-3 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Loading past emails...</span>
              </div>
            ) : pastEmails.length === 0 ? (
              <div className="p-3 rounded-lg bg-zinc-950/50 border border-zinc-800/80 text-[11px] text-zinc-500 italic">
                No previous emails recorded for {lead.name}.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                {pastEmails.map((em) => (
                  <div
                    key={em.id}
                    className="p-2 rounded-lg bg-zinc-950/70 border border-zinc-800 text-[11px] flex items-center justify-between gap-2"
                  >
                    <div className="truncate">
                      <span className="font-semibold text-zinc-200">{em.subject}</span>
                      <span className="text-zinc-500 ml-2">→ {em.recipientEmail}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 text-zinc-400">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 font-medium">
                        {em.status}
                      </span>
                      <span>
                        {em.sentAt ? new Date(em.sentAt).toLocaleDateString() : "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </form>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Next Action: <strong>Follow-up call in 2 business days</strong></span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 transition shadow-md shadow-amber-950/50 disabled:opacity-50 active:scale-95"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Email & Schedule Call</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
