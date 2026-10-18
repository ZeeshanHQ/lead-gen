"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { addCandidateAction, batchUrlsAction } from "./actions";
import {
  Compass,
  Building,
  Globe,
  Phone,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  ListPlus,
} from "lucide-react";

export function CandidateForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"single" | "urls">("single");

  // Single candidate state
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // URL batch state
  const [rawUrls, setRawUrls] = useState("");

  // Feedback state
  const [feedback, setFeedback] = useState<{
    type: "success" | "duplicate" | "possible_duplicates" | "excluded" | "invalid" | "error";
    message: string;
    detail?: any;
  } | null>(null);

  const handleSingleSubmit = async (e: React.FormEvent, force = false) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);

    const res = await addCandidateAction(
      {
        name,
        website: website || null,
        phone: phone || null,
        address: address || null,
        city: city || null,
        state: state || null,
        zip: zip || null,
        notes: notes || null,
        provider: "manual_entry",
      },
      force
    );

    setSubmitting(false);

    if (!res.ok || !res.result) {
      setFeedback({ type: "error", message: res.error || "Failed to intake candidate." });
      return;
    }

    const result = res.result;
    if (result.kind === "created") {
      setFeedback({
        type: "success",
        message: `Company "${name}" successfully registered and queued for research!`,
      });
      setName("");
      setWebsite("");
      setPhone("");
      setAddress("");
      setCity("");
      setState("");
      setZip("");
      setNotes("");
    } else if (result.kind === "duplicate") {
      setFeedback({
        type: "duplicate",
        message: `Existing company found: "${result.existingName}". Source reference was attached to the canonical record to prevent duplicate entries.`,
        detail: result,
      });
    } else if (result.kind === "possible_duplicates") {
      setFeedback({
        type: "possible_duplicates",
        message: `Found ${result.hits.length} similar record(s) in this city/state. Confirm if this is a distinct company.`,
        detail: result.hits,
      });
    } else if (result.kind === "excluded") {
      setFeedback({
        type: "excluded",
        message: `Blocked by active exclusion rule (${result.exclusion.kind}: ${result.exclusion.value}). Reason: ${result.exclusion.reason ?? "None provided"}`,
        detail: result.exclusion,
      });
    } else if (result.kind === "invalid") {
      const errList = Object.entries(result.errors)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; ");
      setFeedback({
        type: "invalid",
        message: `Validation error: ${errList}`,
      });
    }
  };

  const handleBatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const urls = rawUrls.split("\n").map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) return;

    setSubmitting(true);
    setFeedback(null);

    const res = await batchUrlsAction(urls);
    setSubmitting(false);

    if (res.ok) {
      setFeedback({
        type: "success",
        message: `Successfully processed ${res.results?.length ?? 0} candidate URL(s). Check the Review Queue to inspect discovered records.`,
      });
      setRawUrls("");
    } else {
      setFeedback({ type: "error", message: res.error || "Failed to process URLs." });
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Mode Toggle */}
      <div className="flex border-b border-slate-800">
        <button
          onClick={() => {
            setMode("single");
            setFeedback(null);
          }}
          className={`px-4 py-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
            mode === "single"
              ? "border-cyan-500 text-cyan-400 bg-slate-900/40"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Building className="w-3.5 h-3.5" />
          Single Candidate Intake
        </button>
        <button
          onClick={() => {
            setMode("urls");
            setFeedback(null);
          }}
          className={`px-4 py-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
            mode === "urls"
              ? "border-cyan-500 text-cyan-400 bg-slate-900/40"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <ListPlus className="w-3.5 h-3.5" />
          Batch URLs / Test URLs
        </button>
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div
          className={`p-4 rounded-xl text-xs border ${
            feedback.type === "success"
              ? "bg-emerald-950/80 text-emerald-200 border-emerald-800"
              : feedback.type === "duplicate"
              ? "bg-blue-950/80 text-blue-200 border-blue-800"
              : feedback.type === "possible_duplicates"
              ? "bg-amber-950/80 text-amber-200 border-amber-800"
              : "bg-rose-950/80 text-rose-200 border-rose-800"
          }`}
        >
          <div className="flex items-start gap-3">
            {feedback.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            ) : feedback.type === "excluded" ? (
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            ) : feedback.type === "possible_duplicates" ? (
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            )}
            <div className="space-y-2 flex-1">
              <p className="font-semibold text-sm">{feedback.message}</p>

              {/* Duplicate or Possible Duplicate details */}
              {feedback.type === "possible_duplicates" && feedback.detail && (
                <div className="space-y-2 mt-2">
                  <div className="bg-slate-950/80 p-3 rounded border border-amber-900/40 space-y-1">
                    {feedback.detail.map((hit: any) => (
                      <div key={hit.id} className="text-slate-300">
                        &bull; <span className="font-semibold text-white">{hit.name}</span> in{" "}
                        {hit.city ?? "Unknown City"}, {hit.state ?? "Unknown State"} ({hit.reason})
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={(e) => handleSingleSubmit(e, true)}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded text-xs transition-colors"
                  >
                    Confirm: This is a distinct business (Create Anyway)
                  </button>
                </div>
              )}

              {feedback.type === "success" && (
                <div className="pt-1">
                  <button
                    onClick={() => router.push("/review")}
                    className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold hover:underline"
                  >
                    Go to Review Queue <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mode: Single Candidate Form */}
      {mode === "single" ? (
        <form onSubmit={(e) => handleSingleSubmit(e, false)} className="space-y-5">
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
            <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-2 flex items-center gap-2">
              <Building className="w-4 h-4 text-cyan-400" />
              Company Details
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="text-slate-400 block mb-1 font-medium">
                  Company Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Dallas Heating & Air Conditioning LLC"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-medium">
                  Website URL
                </label>
                <div className="relative">
                  <Globe className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://dallasairconditioning.com"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-medium">
                  Company Main Phone
                </label>
                <div className="relative">
                  <Phone className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(214) 555-0199"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-medium">Street Address</label>
                <div className="relative">
                  <MapPin className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="1234 Industrial Blvd, Suite 100"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-medium">City</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Dallas"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1 font-medium">State</label>
                  <input
                    type="text"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    placeholder="TX"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1 font-medium">ZIP Code</label>
                  <input
                    type="text"
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                    placeholder="75201"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            </div>

            <div className="text-xs pt-2">
              <label className="text-slate-400 block mb-1 font-medium">Internal Notes (Optional)</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Discovered via trade directory; customer referrals mentioned."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs shadow-md transition-all"
            >
              <Compass className="w-4 h-4" />
              {submitting ? "Processing..." : "Intake Candidate Company"}
            </button>
          </div>
        </form>
      ) : (
        /* Mode: Batch / Test URLs */
        <form onSubmit={handleBatchSubmit} className="space-y-5">
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
            <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-2 flex items-center gap-2">
              <Globe className="w-4 h-4 text-cyan-400" />
              Test Mode / Batch URL Intake
            </h3>
            <p className="text-xs text-slate-300">
              Paste 1 to 5 HVAC contractor website URLs (one per line). The engine will normalize each domain, check exclusions and deduplication, and enqueue them into the research pipeline.
            </p>

            <textarea
              rows={5}
              required
              value={rawUrls}
              onChange={(e) => setRawUrls(e.target.value)}
              placeholder={`https://apexcomfort.com\nhttps://summithvac.com\nhttps://lonestarhvac.com`}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || !rawUrls.trim()}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs shadow-md transition-all"
            >
              <ListPlus className="w-4 h-4" />
              {submitting ? "Intaking URLs..." : "Intake Batch Candidate URLs"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
