import { redirect } from "next/navigation";

/** Compatibility (Phase 16B): a company now lives at /workspace/companies/{id}. The query string is kept. */
export default async function NetworkCompanyRedirect({ params, searchParams }: PageProps<"/workspace/network/[companyId]">) {
  const { companyId } = await params;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const x of Array.isArray(v) ? v : v ? [v] : []) query.append(k, x);
  const qs = query.toString();
  redirect(`/workspace/companies/${encodeURIComponent(companyId)}${qs ? `?${qs}` : ""}`);
}
