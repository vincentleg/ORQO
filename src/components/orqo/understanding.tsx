/**
 * Adaptive Commercial Understanding views (Phase 14): Business DNA, the one
 * question, and how the company's market works. Server components; the only
 * interactive parts are the validation forms. Every item shows how ORQO knows
 * it (fact / inference / hypothesis / unknown) with its evidence on demand.
 */
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import { DIMENSION_KEYS, MARKET_SECTIONS, type Dimension } from "@/lib/understanding/ontology";
import type { BusinessDna, DnaFacet, DnaItem, MarketModel, NextQuestion } from "@/lib/understanding/types";
import { ItemValidation, QuestionForm } from "./understanding-forms";
import { Badge, Card, CardHeader } from "./ui";

const GROUPS: { key: "what" | "who" | "how" | "proof" | "signals"; facets: DnaFacet[] }[] = [
  { key: "what", facets: ["description", "offering_form", "value_chain_role", "offerings", "problems_solved", "technologies", "identity"] },
  { key: "who", facets: ["customer_scope", "customers", "industries", "geographies"] },
  { key: "how", facets: ["sales_motion", "revenue_model", "business_model", "regulation"] },
  { key: "proof", facets: ["public_partners", "integrations", "certifications", "case_studies"] },
  { key: "signals", facets: ["strategic_signals"] },
];
const SHOWN_UNKNOWNS: DnaFacet[] = ["offering_form", "customer_scope", "revenue_model", "sales_motion", "offerings", "customers", "geographies", "public_partners", "certifications"];

const isDimension = (f: string): f is Dimension | "value_chain_role" => (DIMENSION_KEYS as string[]).includes(f) || f === "value_chain_role";

function valueLabel(t: ReturnType<typeof createTranslator>, facet: string, value: string): string {
  return isDimension(facet) ? t(`understanding.values.${facet}.${value}` as MessageKey) : value;
}

function StateBadge({ item, t }: { item: DnaItem; t: ReturnType<typeof createTranslator> }) {
  if (item.origin === "user") return <Badge tone="positive">{t("understanding.states.stated")}</Badge>;
  if (item.confirmed) return <Badge tone="positive">{t("understanding.states.confirmed")}</Badge>;
  const tone = item.state === "fact" ? "brand" : item.state === "inference" ? "neutral" : "caution";
  return <Badge tone={tone}>{t(`understanding.states.${item.state}`)}</Badge>;
}

/** A statement read on the website: compact, with its label and source. Validation is kept for ORQO's own readings. */
function Statement({ item, locale }: { item: DnaItem; locale: Locale }) {
  const t = createTranslator(locale);
  const src = item.evidence.find((e) => e.sourceUrl)?.sourceUrl ?? null;
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1.5 text-[14px] text-fg" data-testid="dna-item" data-state={item.state}>
      <StateBadge item={item} t={t} />
      <span className="min-w-0 break-words">{item.value}</span>
      {src && (
        <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="text-[12.5px] text-brand underline-offset-2 hover:underline">
          {t("understanding.actions.source")}
        </a>
      )}
    </li>
  );
}

const VISIBLE_STATEMENTS = 3;

function Item({ item, locale, organizationId, canWrite }: { item: DnaItem; locale: Locale; organizationId: string; canWrite: boolean }) {
  const t = createTranslator(locale);
  const label = valueLabel(t, item.facet, item.value);
  const sources = item.evidence.filter((e) => e.sourceUrl || e.excerpt).slice(0, 3);
  return (
    <li className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-start sm:justify-between" data-testid="dna-item" data-state={item.state}>
      <div className="min-w-0">
        <p className="text-[14px] text-fg">{label}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <StateBadge item={item} t={t} />
          {item.origin === "derived" && <Badge tone="outline">{t("understanding.states.derived")}</Badge>}
          {item.selfDescribed && item.origin === "research" && <Badge tone="outline">{t("understanding.states.selfDescribed")}</Badge>}
        </div>
        {sources.length > 0 && (
          <details className="mt-1.5 text-[12.5px] text-fg-muted">
            <summary className="cursor-pointer select-none hover:text-fg">{t("understanding.actions.evidence")}</summary>
            <ul className="mt-1 space-y-1">
              {sources.map((e) => (
                <li key={e.claimId}>
                  {e.excerpt && <q className="text-fg-muted">{e.excerpt}</q>}{" "}
                  {e.sourceUrl && (
                    <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-brand underline-offset-2 hover:underline">
                      {t("understanding.actions.source")}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {canWrite && item.origin !== "user" && <ItemValidation locale={locale} organizationId={organizationId} itemKey={item.key} label={label} confirmed={item.confirmed} />}
    </li>
  );
}

function Statements({ items, locale }: { items: DnaItem[]; locale: Locale }) {
  const t = createTranslator(locale);
  const shown = items.slice(0, VISIBLE_STATEMENTS);
  const more = items.slice(VISIBLE_STATEMENTS);
  return (
    <ul>
      {shown.map((i) => (
        <Statement key={i.key} item={i} locale={locale} />
      ))}
      {more.length > 0 && (
        <li>
          <details>
            <summary className="cursor-pointer py-1 text-[12.5px] text-fg-muted hover:text-fg">{t("understanding.actions.more", { count: more.length })}</summary>
            <ul>
              {more.map((i) => (
                <Statement key={i.key} item={i} locale={locale} />
              ))}
            </ul>
          </details>
        </li>
      )}
    </ul>
  );
}

export function BusinessDnaCard({ dna, locale, organizationId, canWrite, action }: { dna: BusinessDna; locale: Locale; organizationId: string; canWrite: boolean; action: React.ReactNode }) {
  const t = createTranslator(locale);
  if (dna.status !== "analyzed") {
    return (
      <Card data-testid="business-dna">
        <CardHeader title={t("understanding.notAnalyzedTitle")} description={t("understanding.notAnalyzedBody")} />
        <div className="px-5 py-5">{action}</div>
      </Card>
    );
  }
  const date = dna.basis.researchedAt ? new Date(dna.basis.researchedAt).toLocaleDateString(locale, { dateStyle: "medium" }) : "";
  const unknown = dna.unknowns.filter((f) => SHOWN_UNKNOWNS.includes(f)).map((f) => t(`understanding.facets.${f}` as MessageKey));
  // A statement is shown once, in the first group that uses it (a partnership announcement is proof, not also a signal).
  const seen = new Set<string>();
  const visible = dna.items.filter((i) => {
    if (isDimension(i.facet)) return true;
    const k = i.value.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return (
    <Card data-testid="business-dna">
      <CardHeader title={t("understanding.title")} description={t("understanding.description")} />
      <div className="space-y-5 px-5 py-4">
        <p className="text-[12.5px] text-fg-muted">{t("understanding.legend")}</p>
        {GROUPS.map((g) => {
          const facets = g.facets.filter((f) => visible.some((i) => i.facet === f));
          if (facets.length === 0) return null;
          return (
            <section key={g.key} aria-labelledby={`dna-${g.key}`}>
              <h3 id={`dna-${g.key}`} className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase">
                {t(`understanding.groups.${g.key}`)}
              </h3>
              <dl className="mt-1 divide-y divide-edge">
                {facets.map((f) => (
                  <div key={f} className="grid gap-1 py-2 sm:grid-cols-[170px_1fr]">
                    <dt className="pt-2.5 text-[13px] text-fg-muted">{t(`understanding.facets.${f}` as MessageKey)}</dt>
                    <dd>
                      {isDimension(f) ? (
                        <ul className="divide-y divide-edge/60">
                          {visible
                            .filter((i) => i.facet === f)
                            .map((i) => (
                              <Item key={i.key} item={i} locale={locale} organizationId={organizationId} canWrite={canWrite} />
                            ))}
                        </ul>
                      ) : (
                        <Statements items={visible.filter((i) => i.facet === f)} locale={locale} />
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
        {unknown.length > 0 && (
          <p className="rounded-lg bg-subtle px-3 py-2 text-[13px] text-fg-muted" data-testid="dna-unknowns">
            <Badge tone="outline">{t("understanding.states.unknown")}</Badge> {t("understanding.unknowns", { list: unknown.join(", ") })}
          </p>
        )}
        {dna.rejected.length > 0 && (
          <p className="text-[12.5px] text-fg-faint">
            {t("understanding.actions.rejected")}: {dna.rejected.map((r) => valueLabel(t, r.facet, r.value)).join(", ")}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-edge pt-3 text-[12.5px] text-fg-muted">
          {dna.basis.website && <span>{t("understanding.analyzedOn", { website: dna.basis.website.replace(/^https?:\/\//, ""), date })}</span>}
          {action}
        </div>
      </div>
    </Card>
  );
}

export function NextQuestionCard({ question, locale, organizationId }: { question: NextQuestion; locale: Locale; organizationId: string }) {
  const t = createTranslator(locale);
  const promptKey = `understanding.question.prompts.${question.dimension}` as MessageKey;
  return (
    <Card className="border-brand/40" data-testid="next-question-card">
      <CardHeader title={t("understanding.question.title")} description={t("understanding.question.body", { count: question.unlocks })} />
      <div className="px-5 py-5">
        <QuestionForm locale={locale} organizationId={organizationId} dimension={question.dimension} prompt={t(promptKey)} options={question.options.map((v) => ({ value: v, label: valueLabel(t, question.dimension, v) }))} />
      </div>
    </Card>
  );
}

const VISIBLE_ENTRIES = 4;

function MarketEntries({ section, items, t }: { section: string; items: MarketModel["items"]; t: ReturnType<typeof createTranslator> }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {items.map((i) => (
        <li key={i.key} data-testid="market-item" data-state={i.state} className="inline-flex min-h-9 max-w-full flex-wrap items-center gap-x-2 rounded-full border border-edge px-3 py-1 text-[13px] text-fg">
          {t(`understanding.market.entries.${section}.${i.key}` as MessageKey)}
          {i.relation && section === "role" && <span className="text-fg-faint">· {t(`understanding.market.relations.${i.relation}`)}</span>}
          <Badge tone={i.state === "inference" ? "positive" : "outline"}>{i.state === "inference" ? t("understanding.market.evidenced") : t("understanding.market.typical")}</Badge>
        </li>
      ))}
    </ul>
  );
}

export function MarketModelCard({ market, locale }: { market: MarketModel; locale: Locale }) {
  const t = createTranslator(locale);
  const tone = market.coverage === "sufficient" ? "positive" : market.coverage === "partial" ? "caution" : "outline";
  const known = DIMENSION_KEYS.filter((d) => market.archetype[d].state !== "unknown");
  return (
    <Card data-testid="market-model" data-coverage={market.coverage}>
      <CardHeader title={t("understanding.market.title")} description={t("understanding.market.description")} action={<Badge tone={tone}>{t(`understanding.market.coverage.${market.coverage}`)}</Badge>} />
      <div className="space-y-5 px-5 py-4">
        {market.coverage === "insufficient" ? (
          <p className="text-[14px] text-fg-muted">{t("understanding.market.insufficientBody")}</p>
        ) : (
          <>
            <dl className="grid gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-2">
              {known.map((d) => (
                <div key={d}>
                  <dt className="text-fg-muted">{t(`understanding.facets.${d}`)}</dt>
                  <dd className="text-fg">{market.archetype[d].values.map((v) => valueLabel(t, d, v)).join(", ")}</dd>
                </div>
              ))}
              {market.roles.length > 0 && (
                <div>
                  <dt className="text-fg-muted">{t("understanding.facets.value_chain_role")}</dt>
                  <dd className="text-fg">{market.roles.map((r) => valueLabel(t, "value_chain_role", r.value)).join(", ")}</dd>
                </div>
              )}
            </dl>
            <p className="text-[12.5px] text-fg-muted">
              <Badge tone="positive">{t("understanding.market.evidenced")}</Badge> <Badge tone="outline">{t("understanding.market.typical")}</Badge> {t("understanding.market.typicalHelp")}
            </p>
            {MARKET_SECTIONS.map((section) => {
              const items = market.items.filter((i) => i.section === section).sort((a, b) => (a.state === b.state ? 0 : a.state === "inference" ? -1 : 1));
              if (items.length === 0) return null;
              return (
                <section key={section} aria-labelledby={`market-${section}`}>
                  <h3 id={`market-${section}`} className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase">
                    {t(`understanding.market.sections.${section}`)}
                  </h3>
                  <MarketEntries section={section} items={items.slice(0, VISIBLE_ENTRIES)} t={t} />
                  {items.length > VISIBLE_ENTRIES && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[12.5px] text-fg-muted hover:text-fg">{t("understanding.actions.more", { count: items.length - VISIBLE_ENTRIES })}</summary>
                      <MarketEntries section={section} items={items.slice(VISIBLE_ENTRIES)} t={t} />
                    </details>
                  )}
                </section>
              );
            })}
          </>
        )}
        {market.unknowns.length > 0 && (
          <p className="text-[12.5px] text-fg-muted">{t("understanding.market.unknownDimensions", { list: market.unknowns.map((d) => t(`understanding.facets.${d}`)).join(", ") })}</p>
        )}
        {market.terminology.length > 0 && (
          <p className="text-[12.5px] text-fg-muted">
            {t("understanding.market.terminology")}: {market.terminology.join(" · ")}
          </p>
        )}
      </div>
    </Card>
  );
}
