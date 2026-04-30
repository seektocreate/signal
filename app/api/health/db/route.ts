// TODO: temporary verification route used to confirm the Supabase client can
// reach the database. Safe to delete (or replace with a real digest endpoint)
// once /today is wired up.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabase
    .from("digests")
    .select("date")
    .limit(1);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sample: data });
}
