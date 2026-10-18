import React from "react";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getCompanyDetail } from "@/server/repo/detail";
import { CompanyView } from "./company-view";

export const dynamic = "force-dynamic";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await getDb();
  const detail = await getCompanyDetail(db, id);

  if (!detail) {
    notFound();
  }

  return <CompanyView detail={detail} />;
}
