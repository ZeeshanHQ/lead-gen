import React from "react";
import Link from "next/link";
import { getDb } from "@/server/db/client";
import { listAllContacts } from "@/server/repo/detail";
import { getActiveContext } from "@/server/repo/markets";
import { ContactQualityBadge, ProvenanceBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const db = await getDb();
  const { market } = await getActiveContext(db);
  const rows = await listAllContacts(db, market.id);

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800/80 pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-white">
            Contacts — {market.name}
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Owners, managers, and business contacts found for <strong className="text-slate-200">{market.name}</strong>.
          </p>
        </div>

        <span className="text-xs px-3 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 font-medium">
          {rows.length} Contacts
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="p-12 text-center rounded-xl border border-slate-800/80 bg-slate-900/30 text-slate-400 text-xs">
          No contacts recorded yet. Research companies or add contacts from a company profile.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-900/30">
          <table className="w-full text-left text-xs text-slate-300 divide-y divide-slate-800/80">
            <thead className="bg-slate-950/60 text-[11px] font-medium uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3">Name &amp; Role</th>
                <th className="px-3 py-3">Title</th>
                <th className="px-3 py-3">Company</th>
                <th className="px-3 py-3">Phone</th>
                <th className="px-3 py-3">Email</th>
                <th className="px-3 py-3">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.map(({ contact: c, companyName, companyId, companyDomain }) => (
                <tr key={c.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3.5 font-semibold text-white">
                    {c.name ?? "Unknown Name"}
                    <span className="block text-[11px] text-slate-400 font-normal capitalize">
                      {c.roleClass.replace(/_/g, " ")}
                    </span>
                  </td>

                  <td className="px-3 py-3.5 text-slate-300">{c.title ?? "--"}</td>

                  <td className="px-3 py-3.5">
                    <Link
                      href={`/company/${companyId}`}
                      className="font-medium text-slate-200 hover:text-white hover:underline flex items-center gap-1"
                    >
                      <span>{companyName}</span>
                    </Link>
                    {companyDomain && (
                      <span className="text-[11px] text-slate-500">{companyDomain}</span>
                    )}
                  </td>

                  <td className="px-3 py-3.5">
                    <div className="space-y-1">
                      <span className="font-mono text-slate-200">
                        {c.phoneDisplay ?? "No phone"}
                      </span>
                      <ContactQualityBadge label={c.phoneType} className="block w-max text-[10px]" />
                    </div>
                  </td>

                  <td className="px-3 py-3.5 text-slate-300">{c.email ?? "--"}</td>

                  <td className="px-3 py-3.5">
                    <ProvenanceBadge provenance={c.provenance} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
