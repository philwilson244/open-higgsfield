"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { signOut } from "@/app/ads/auth-actions";
import {
  savePlatformCredentials,
  clearPlatformCredentials,
} from "@/generation/actions";
import { saveBrand, saveCampaign } from "./actions";
import { createAdPlan } from "./plan";
import { AD_TARGETS } from "./platforms";
import {
  briefSchema,
  brandSchema,
  validationMessage,
  type BrandKit,
} from "./schema";
import { rankVideoModels } from "./model-router";
import { retimeBeat, shotPrompt, storyboardWarnings } from "./storyboard";
import type { Campaign, SavedBrand } from "./repository";
import type { AdBeat, AdBrief, AdPlan } from "./types";
import { COMPANY_TEMPLATES } from "./company-templates";
import { getProductionState } from "./production-actions";
import type { ProductionState } from "./production-types";
import {
  AnalyticsPanel,
  ProductionLibrary,
  RunwayCredentials,
  ShotProductionControls,
} from "./production-ui";

const emptyBrief: AdBrief = {
  brandName: "",
  productName: "",
  audience: "",
  problem: "",
  promise: "",
  callToAction: "",
  goal: "install",
  channels: ["youtube_shorts", "instagram_reels"],
};
const sample: AdBrief = {
  ...emptyBrief,
  brandName: "Fullcourt",
  productName: "Fullcourt",
  audience: "People organizing pickup basketball",
  problem: "A group chat shouldn’t be harder than the game",
  promise: "Get your next run organized in one place",
  callToAction: "Create your game on Fullcourt",
  tone: ["Funny", "Competitive"],
  proof: [],
  requiredText: ["Fullcourt"],
  prohibitedClaims: ["Guaranteed wins"],
};

export function AdStudio({
  mode,
  email,
  brands: initialBrands,
  campaigns: initialCampaigns,
}: {
  mode: "cloud" | "preview";
  email?: string;
  brands: SavedBrand[];
  campaigns: Campaign[];
}) {
  const cloud = mode === "cloud";
  const [brands, setBrands] = useState(initialBrands);
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [brief, setBrief] = useState<AdBrief>(emptyBrief);
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<AdPlan | null>(null);
  const [saved, setSaved] = useState<Campaign | null>(null);
  const [variantIndex, setVariantIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"brief" | "brand" | "provider">("brief");
  const [color, setColor] = useState("#d1fe17");
  const [budgetCents, setBudgetCents] = useState(10_000);
  const [production, setProduction] = useState<ProductionState | null>(null);
  const variant = plan?.variants[variantIndex];

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function refreshProduction() {
    if (!saved) {
      setProduction(null);
      return;
    }
    const result = await getProductionState(saved.id);
    if (result.data) setProduction(result.data);
  }

  useEffect(() => {
    if (!saved) {
      setProduction(null);
      return;
    }
    let live = true;
    const refresh = async () => {
      const result = await getProductionState(saved.id);
      if (live && result.data) setProduction(result.data);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [saved?.id]);

  function mayDiscard() {
    return !dirty || window.confirm("Discard unsaved edits and continue?");
  }
  function changeBrief(patch: Partial<AdBrief>) {
    setBrief((v) => ({ ...v, ...patch }));
    setDirty(true);
  }
  function reset() {
    if (!mayDiscard()) return;
    setSaved(null);
    setPlan(null);
    setName("");
    setBrief(emptyBrief);
    setVariantIndex(0);
    setBudgetCents(10_000);
    setProduction(null);
    setDirty(false);
    setPanel("brief");
    setNotice("");
  }
  function open(campaign: Campaign) {
    if (!mayDiscard()) return;
    setSaved(campaign);
    setPlan(campaign.plan);
    setBrief(campaign.plan.brief);
    setName(campaign.name);
    setVariantIndex(0);
    setBudgetCents(campaign.budget_cents);
    setProduction(null);
    setDirty(false);
    setPanel("brief");
    setNotice("");
  }
  function build(event: FormEvent) {
    event.preventDefault();
    const result = briefSchema.safeParse(brief);
    if (!result.success) {
      setNotice(validationMessage(result.error));
      return;
    }
    if (
      plan &&
      !window.confirm(
        "Rebuild all concepts? This replaces your current storyboard edits.",
      )
    )
      return;
    setPlan(createAdPlan(result.data));
    setVariantIndex(0);
    setDirty(true);
    setNotice(
      "Concept drafts are ready. Review the copy, evidence, and timing before approval.",
    );
  }
  function editBeat(index: number, patch: Partial<AdBeat>) {
    setPlan((p) =>
      p
        ? {
            ...p,
            variants: p.variants.map((v, vi) =>
              vi === variantIndex
                ? {
                    ...v,
                    beats: v.beats.map((b, bi) =>
                      bi === index ? { ...b, ...patch } : b,
                    ),
                  }
                : v,
            ),
          }
        : p,
    );
    setDirty(true);
  }
  async function persist(
    status: Campaign["status"] = "draft",
    duplicate = false,
  ) {
    if (!plan) return;
    // Brief edits require an explicit rebuild, so saved plans always retain the brief they were based on.
    setBusy(true);
    setNotice("");
    try {
      const result = await saveCampaign({
        ...(saved && !duplicate
          ? { id: saved.id, revision: saved.revision }
          : {}),
        name: duplicate ? `${name.slice(0, 110)} copy` : name,
        status,
        budgetCents,
        approveProduction: status === "approved",
        plan,
      });
      if (result.error) {
        setNotice(result.error);
        return;
      }
      const campaign = result.data!;
      setSaved(campaign);
      setName(campaign.name);
      setCampaigns((list) => [
        campaign,
        ...list.filter((c) => c.id !== campaign.id),
      ]);
      setDirty(false);
      setNotice(
        status === "approved"
          ? "Storyboard approved and saved. No video was generated or published."
          : "Campaign saved to your account.",
      );
    } catch {
      setNotice("Could not save. Your edits are still here; try again.");
    } finally {
      setBusy(false);
    }
  }
  function exportPlan() {
    if (!plan) return;
    const blob = new Blob([JSON.stringify({ name, plan }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9-]/gi, "_") || "ad-storyboard"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const briefChanged =
    plan &&
    JSON.stringify(briefSchema.safeParse(brief).data) !==
      JSON.stringify(briefSchema.safeParse(plan.brief).data);

  return (
    <main className="ads-shell">
      <header className="ads-header">
        <Link className="ads-wordmark" href="/ads">
          ◈ <span>AD STUDIO</span>
          <small>BETA</small>
        </Link>
        <nav aria-label="Studio">
          <Link
            href="/"
            onClick={(e) => {
              if (!mayDiscard()) e.preventDefault();
            }}
          >
            Generation studio ↗
          </Link>
          {cloud && (
            <form
              action={signOut}
              onSubmit={(e) => {
                if (!mayDiscard()) e.preventDefault();
              }}
            >
              <button>Sign out</button>
            </form>
          )}
        </nav>
      </header>
      {!cloud && (
        <div className="ads-banner">
          Preview mode · Explore the workflow and export your plan. Cloud
          saving, accounts, and video generation need project configuration.
          Edits here reset on reload.
        </div>
      )}
      <div className="ads-workspace">
        <aside className="ads-sidebar">
          <p className="ads-eyebrow">YOUR WORKSPACE</p>
          <h2>Campaigns</h2>
          <button className="ads-primary" onClick={reset} disabled={busy}>
            + New campaign
          </button>
          <p className="ads-muted">
            {cloud ? email : "Private campaigns, reusable brands."}
          </p>
          <div className="ads-campaign-list">
            {campaigns.length === 0 ? (
              <p className="ads-empty">
                Your saved campaigns will appear here.
              </p>
            ) : (
              campaigns.map((c) => (
                <button
                  disabled={busy}
                  aria-current={saved?.id === c.id ? "page" : undefined}
                  key={c.id}
                  onClick={() => open(c)}
                >
                  <strong>{c.name}</strong>
                  <span>
                    {c.status} · {c.plan.variants.length} concepts
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="ads-sidebar-bottom">
            <button onClick={() => setPanel("brand")}>Brand kit</button>
            <button onClick={() => setPanel("provider")}>
              Provider settings
            </button>
            <p className="ads-muted">
              Planning is free of generation charges. Rendering is a separate
              step.
            </p>
          </div>
        </aside>
        <section className="ads-main">
          <fieldset disabled={busy}>
            <div className="ads-title-row">
              <div>
                <p className="ads-eyebrow">BRIEF → CONCEPTS → STORYBOARD</p>
                <h1>Make your next ad.</h1>
                <p className="ads-muted">
                  One brief. Three angles. Every placement.
                </p>
              </div>
              <div className="ads-status">
                {dirty
                  ? "Unsaved changes"
                  : saved
                    ? `Saved · v${saved.revision}`
                    : "New campaign"}
              </div>
            </div>
            <div
              role="status"
              aria-live="polite"
              className={notice ? "ads-notice" : "ads-sr"}
            >
              {notice}
            </div>
            <div className="ads-tabs" role="group" aria-label="Campaign tools">
              {(["brief", "brand", "provider"] as const).map((p) => (
                <button
                  aria-pressed={panel === p}
                  onClick={() => setPanel(p)}
                  key={p}
                >
                  {p === "brief"
                    ? "01 / Campaign brief"
                    : p === "brand"
                      ? "02 / Brand kit"
                      : "03 / Providers"}
                </button>
              ))}
            </div>

            {panel === "brand" && (
              <section className="ads-card ads-stack">
                <h2>Reusable brand kit</h2>
                <p className="ads-muted">
                  Save the brand details from your brief as a reusable template.
                  Claims are a review checklist, not an automated legal
                  approval.
                </p>
                <div className="ads-company-presets" aria-label="Company brand templates">
                  {COMPANY_TEMPLATES.map((template) => (
                    <button
                      type="button"
                      key={template.id}
                      onClick={() => {
                        const kit = template.kit;
                        changeBrief({
                          brandName: kit.name,
                          productName: kit.product,
                          audience: kit.audience,
                          tone: kit.tone,
                          requiredText: kit.requiredText,
                          prohibitedClaims: kit.prohibitedClaims,
                        });
                        setColor(kit.color);
                        setNotice(`${template.label} production template loaded.`);
                      }}
                    >
                      Load {template.label}
                    </button>
                  ))}
                </div>
                <div className="ads-grid">
                  <label>
                    Brand name
                    <input
                      value={brief.brandName}
                      onChange={(e) =>
                        changeBrief({ brandName: e.target.value })
                      }
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Product
                    <input
                      value={brief.productName}
                      onChange={(e) =>
                        changeBrief({ productName: e.target.value })
                      }
                      maxLength={2000}
                    />
                  </label>
                </div>
                <label>
                  Audience
                  <input
                    value={brief.audience}
                    onChange={(e) => changeBrief({ audience: e.target.value })}
                    maxLength={2000}
                  />
                </label>
                <div className="ads-grid">
                  <label>
                    Tone (one per line)
                    <textarea
                      value={brief.tone?.join("\n") ?? ""}
                      onChange={(e) =>
                        changeBrief({ tone: e.target.value.split("\n") })
                      }
                    />
                  </label>
                  <label>
                    Brand accent
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => {
                        setColor(e.target.value);
                        setDirty(true);
                      }}
                    />
                  </label>
                </div>
                <div className="ads-grid">
                  <label>
                    Required exact copy
                    <textarea
                      value={brief.requiredText?.join("\n") ?? ""}
                      onChange={(e) =>
                        changeBrief({
                          requiredText: e.target.value.split("\n"),
                        })
                      }
                    />
                  </label>
                  <label>
                    Prohibited claims
                    <textarea
                      value={brief.prohibitedClaims?.join("\n") ?? ""}
                      onChange={(e) =>
                        changeBrief({
                          prohibitedClaims: e.target.value.split("\n"),
                        })
                      }
                    />
                  </label>
                </div>
                <button
                  className="ads-primary"
                  disabled={!cloud || busy}
                  onClick={async () => {
                    const kit: BrandKit = {
                      name: brief.brandName,
                      product: brief.productName,
                      audience: brief.audience,
                      color,
                      tone: (brief.tone ?? []).filter(Boolean),
                      requiredText: (brief.requiredText ?? []).filter(Boolean),
                      prohibitedClaims: (brief.prohibitedClaims ?? []).filter(
                        Boolean,
                      ),
                      fonts: [],
                      ctaLibrary: [],
                      voiceDirection: undefined,
                      musicDirection: undefined,
                      referenceNotes: undefined,
                    };
                    const parsed = brandSchema.safeParse(kit);
                    if (!parsed.success) {
                      setNotice(validationMessage(parsed.error));
                      return;
                    }
                    setBusy(true);
                    try {
                      const result = await saveBrand(parsed.data);
                      if (result.error) setNotice(result.error);
                      else {
                        setBrands((b) => [result.data!, ...b]);
                        setNotice("Brand template saved.");
                      }
                    } catch {
                      setNotice("Could not save your brand. Try again.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Saving…" : "Save brand template"}
                </button>
                <p className="ads-muted">
                  Logos and reference files can be attached in the campaign
                  media library. Shared team workspaces are still planned.
                </p>
              </section>
            )}

            {panel === "provider" && (
              <section className="ads-card ads-stack">
                <h2>Generation provider</h2>
                <p>
                  Runway powers campaign shot jobs. The legacy platform adapter
                  remains available in the generation workbench.
                </p>
                <RunwayCredentials notice={setNotice} />
                <hr />
                <ProviderForm enabled={cloud} report={setNotice} />
                <p className="ads-muted">
                  Keys are encrypted server-side and stored against your
                  account. Saving a key doesn’t start a paid generation.
                </p>
              </section>
            )}

            {panel === "brief" && (
              <form className="ads-card ads-stack" onSubmit={build}>
                <div className="ads-card-heading">
                  <h2>The creative brief</h2>
                  <button
                    type="button"
                    onClick={() => {
                      if (mayDiscard()) {
                        setBrief(sample);
                        setName("Fullcourt / Get the run together");
                        setPlan(null);
                        setSaved(null);
                        setDirty(true);
                      }
                    }}
                  >
                    Try a Fullcourt example
                  </button>
                </div>
                <div className="ads-grid">
                  <label>
                    Campaign name
                    <input
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setDirty(true);
                      }}
                      required
                      maxLength={120}
                      placeholder="Summer launch / Hook test 01"
                    />
                  </label>
                  <label>
                    Load a brand template
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const b = brands.find((b) => b.id === e.target.value);
                        if (b) {
                          changeBrief({
                            brandName: b.kit.name,
                            productName: b.kit.product,
                            audience: b.kit.audience,
                            tone: b.kit.tone,
                            requiredText: b.kit.requiredText,
                            prohibitedClaims: b.kit.prohibitedClaims,
                          });
                          setColor(b.kit.color);
                        }
                      }}
                    >
                      <option value="">Choose a saved brand</option>
                      {brands.map((b) => (
                        <option value={b.id} key={b.id}>
                          {b.kit.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="ads-grid">
                  <label>
                    Brand
                    <input
                      required
                      maxLength={100}
                      value={brief.brandName}
                      onChange={(e) =>
                        changeBrief({ brandName: e.target.value })
                      }
                      placeholder="Fullcourt"
                    />
                  </label>
                  <label>
                    Product
                    <input
                      required
                      maxLength={2000}
                      value={brief.productName}
                      onChange={(e) =>
                        changeBrief({ productName: e.target.value })
                      }
                      placeholder="What are you advertising?"
                    />
                  </label>
                </div>
                <label>
                  Who is this for?
                  <input
                    required
                    maxLength={2000}
                    value={brief.audience}
                    onChange={(e) => changeBrief({ audience: e.target.value })}
                    placeholder="Be specific about the audience and situation"
                  />
                </label>
                <div className="ads-grid">
                  <label>
                    Customer problem
                    <textarea
                      required
                      maxLength={2000}
                      value={brief.problem}
                      onChange={(e) => changeBrief({ problem: e.target.value })}
                      placeholder="What frustrates them?"
                    />
                  </label>
                  <label>
                    Product promise
                    <textarea
                      required
                      maxLength={2000}
                      value={brief.promise}
                      onChange={(e) => changeBrief({ promise: e.target.value })}
                      placeholder="What changes when they use it?"
                    />
                  </label>
                </div>
                <div className="ads-grid">
                  <label>
                    Offer (optional)
                    <input
                      maxLength={2000}
                      value={brief.offer ?? ""}
                      onChange={(e) => changeBrief({ offer: e.target.value })}
                      placeholder="Only include a real, approved offer"
                    />
                  </label>
                  <label>
                    Call to action
                    <input
                      required
                      maxLength={2000}
                      value={brief.callToAction}
                      onChange={(e) =>
                        changeBrief({ callToAction: e.target.value })
                      }
                      placeholder="One clear next step"
                    />
                  </label>
                </div>
                <div className="ads-grid">
                  <label>
                    Verified supporting evidence (one per line)
                    <textarea
                      maxLength={10000}
                      value={brief.proof?.join("\n") ?? ""}
                      onChange={(e) =>
                        changeBrief({ proof: e.target.value.split("\n") })
                      }
                      placeholder="Facts you can substantiate. No invented testimonials."
                    />
                  </label>
                  <label>
                    Campaign goal
                    <select
                      value={brief.goal}
                      onChange={(e) =>
                        changeBrief({ goal: e.target.value as AdBrief["goal"] })
                      }
                    >
                      {[
                        "awareness",
                        "traffic",
                        "lead",
                        "install",
                        "purchase",
                      ].map((g) => (
                        <option value={g} key={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <fieldset>
                  <legend>Placements</legend>
                  <div className="ads-placements">
                    {Object.values(AD_TARGETS).map((target) => (
                      <label key={target.channel} className="ads-placement">
                        <input
                          type="checkbox"
                          checked={brief.channels.includes(target.channel)}
                          onChange={(e) =>
                            changeBrief({
                              channels: e.target.checked
                                ? [...brief.channels, target.channel]
                                : brief.channels.filter(
                                    (c) => c !== target.channel,
                                  ),
                            })
                          }
                        />
                        <span>
                          {target.label}
                          <small>
                            {target.aspectRatio} · {target.durationSeconds}s
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="ads-card-heading">
                  <p className="ads-muted">
                    Template-based drafts, ready for your edits. No AI video
                    render is started.
                  </p>
                  <button className="ads-primary" disabled={busy}>
                    {plan ? "Rebuild concepts" : "Build concepts →"}
                  </button>
                </div>
              </form>
            )}

            {plan && variant && (
              <section className="ads-storyboard">
                <div className="ads-title-row">
                  <div>
                    <p className="ads-eyebrow">THE CONCEPT BOARD</p>
                    <h2>{plan.variants.length} directions to work with.</h2>
                  </div>
                  <button onClick={exportPlan}>Export storyboard JSON ↓</button>
                </div>
                {briefChanged && (
                  <div className="ads-banner">
                    Your brief has changed. Rebuild concepts to apply it.
                    Existing storyboard edits still use the previous brief.
                  </div>
                )}
                <div className="ads-concepts">
                  {plan.variants.map((v, i) => (
                    <button
                      className="ads-concept"
                      aria-pressed={i === variantIndex}
                      key={v.id}
                      onClick={() => setVariantIndex(i)}
                    >
                      <small>
                        {v.target.label} / {v.target.aspectRatio}
                      </small>
                      <strong>{v.name.split(" · ")[1]}</strong>
                      <span>{v.hookAngle}</span>
                      <em>
                        {v.target.durationSeconds}s · {v.beats.length} beats
                      </em>
                    </button>
                  ))}
                </div>
                <div className="ads-title-row">
                  <h2>{variant.name}</h2>
                  <span className="ads-muted">
                    {variant.target.width} × {variant.target.height} · editorial
                    preset
                  </span>
                </div>
                <div className="ads-timeline" aria-label="Storyboard timing">
                  {variant.beats.map((b) => (
                    <div
                      key={b.id}
                      style={{ flexGrow: b.endSeconds - b.startSeconds }}
                    >
                      <span>{b.kind}</span>
                      <small>
                        {(b.endSeconds - b.startSeconds).toFixed(1)}s
                      </small>
                    </div>
                  ))}
                </div>
                <div className="ads-shots">
                  {variant.beats.map((beat, i) => {
                    const duration = beat.endSeconds - beat.startSeconds;
                    const routes = rankVideoModels({
                      target: variant.target,
                      shotDurationSeconds: duration,
                    }).slice(0, 3);
                    return (
                      <article className="ads-card ads-shot" key={beat.id}>
                        <div className="ads-shot-index">
                          <span>{String(i + 1).padStart(2, "0")}</span>
                          <strong>{beat.kind}</strong>
                          <small>
                            {beat.startSeconds.toFixed(1)}–
                            {beat.endSeconds.toFixed(1)}s
                          </small>
                        </div>
                        <div className="ads-stack">
                          <label>
                            Visual direction
                            <textarea
                              aria-label={`Shot ${i + 1} visual direction`}
                              maxLength={2000}
                              value={beat.visualDirection}
                              onChange={(e) =>
                                editBeat(i, { visualDirection: e.target.value })
                              }
                            />
                          </label>
                          <div className="ads-grid">
                            <label>
                              Voiceover
                              <textarea
                                aria-label={`Shot ${i + 1} voiceover`}
                                maxLength={2000}
                                value={beat.voiceover}
                                onChange={(e) =>
                                  editBeat(i, { voiceover: e.target.value })
                                }
                              />
                            </label>
                            <label>
                              On-screen copy
                              <textarea
                                aria-label={`Shot ${i + 1} on-screen copy`}
                                maxLength={500}
                                value={beat.onScreenText ?? ""}
                                onChange={(e) =>
                                  editBeat(i, { onScreenText: e.target.value })
                                }
                              />
                            </label>
                          </div>
                          <label>
                            Duration in seconds (adjusts the next beat)
                            <input
                              type="number"
                              step="0.1"
                              min="0.5"
                              disabled={i === variant.beats.length - 1}
                              key={`${beat.id}-${duration}`}
                              defaultValue={duration.toFixed(1)}
                              onBlur={(e) => {
                                if (Number(e.target.value) === duration) return;
                                try {
                                  const next = retimeBeat(
                                    variant,
                                    i,
                                    Number(e.target.value),
                                  );
                                  setPlan((p) =>
                                    p
                                      ? {
                                          ...p,
                                          variants: p.variants.map((v, vi) =>
                                            vi === variantIndex ? next : v,
                                          ),
                                        }
                                      : p,
                                  );
                                  setDirty(true);
                                } catch (err) {
                                  setNotice(
                                    err instanceof Error
                                      ? err.message
                                      : "Invalid timing",
                                  );
                                  e.target.value = duration.toFixed(1);
                                }
                              }}
                            />
                          </label>
                          <details>
                            <summary>
                              Model suggestions and production prompt
                            </summary>
                            <p className="ads-muted">
                              Catalog compatibility only. Availability, quality,
                              and prices haven’t been verified with the
                              provider. No automatic rendering.
                            </p>
                            {routes.length ? (
                              routes.map((r) => (
                                <p key={r.modelId}>
                                  <strong>{r.modelLabel}</strong> ·{" "}
                                  {r.renderDurationSeconds}s ·{" "}
                                  {r.renderAspectRatio}
                                  {r.requiresTrim ? " · trim in edit" : ""}
                                  {r.requiresCrop ? " · crop in edit" : ""}
                                </p>
                              ))
                            ) : (
                              <p>
                                No compatible text-only model. Use an uploaded
                                shot or prepare an image reference.
                              </p>
                            )}
                            <pre>{shotPrompt(plan.brief, beat)}</pre>
                          </details>
                          {saved && (
                            <ShotProductionControls
                              campaign={saved}
                              state={production}
                              refresh={refreshProduction}
                              notice={setNotice}
                              variantId={variant.id}
                              beatId={beat.id}
                            />
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
                {saved && (
                  <>
                    <ProductionLibrary
                      campaign={saved}
                      state={production}
                      refresh={refreshProduction}
                      notice={setNotice}
                      variant={variant}
                    />
                    <AnalyticsPanel
                      campaign={saved}
                      state={production}
                      refresh={refreshProduction}
                      notice={setNotice}
                    />
                  </>
                )}
                <Review brief={plan.brief} variant={variant} />
                <div className="ads-savebar">
                  <p>
                    {!cloud
                      ? "Preview edits aren’t saved. Export your plan to keep a copy."
                      : saved?.status === "archived"
                        ? "Archived campaign. Save a draft to reopen it."
                        : "Save your work or approve the storyboard for production."}
                  </p>
                  <label className="ads-budget">
                    Production budget
                    <span>$</span>
                    <input
                      type="number"
                      min="0"
                      max="100000"
                      step="1"
                      value={(budgetCents / 100).toFixed(0)}
                      onChange={(event) => {
                        setBudgetCents(Math.max(0, Math.round(Number(event.target.value) * 100)));
                        setDirty(true);
                      }}
                    />
                    {saved && (
                      <small>
                        ${(saved.spent_cents / 100).toFixed(2)} spent · ${(saved.reserved_cents / 100).toFixed(2)} reserved
                      </small>
                    )}
                  </label>
                  <div>
                    <button
                      disabled={
                        !cloud || busy || !name.trim() || Boolean(briefChanged)
                      }
                      onClick={() => void persist("draft", true)}
                    >
                      Save a copy
                    </button>
                    <button
                      disabled={
                        !cloud || !saved || busy || Boolean(briefChanged)
                      }
                      onClick={() => void persist("archived")}
                    >
                      Archive
                    </button>
                    <button
                      disabled={
                        !cloud || busy || !name.trim() || Boolean(briefChanged)
                      }
                      onClick={() => {
                        if (
                          window.confirm(
                            `Approve this storyboard and a $${(budgetCents / 100).toFixed(2)} maximum production budget? Generation starts only when you press Generate on a shot.`,
                          )
                        )
                          void persist("approved");
                      }}
                    >
                      Approve
                    </button>
                    <button
                      className="ads-primary"
                      disabled={
                        !cloud || busy || !name.trim() || Boolean(briefChanged)
                      }
                      onClick={() => void persist("draft")}
                    >
                      {busy ? "Saving…" : "Save campaign"}
                    </button>
                  </div>
                </div>
              </section>
            )}
          </fieldset>
        </section>
      </div>
    </main>
  );
}

function Review({
  brief,
  variant,
}: {
  brief: AdBrief;
  variant: NonNullable<AdPlan["variants"][number]>;
}) {
  const warnings = storyboardWarnings(brief, variant);
  return (
    <section className="ads-card">
      <h3>Before you render</h3>
      {warnings.length ? (
        <ul>
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : (
        <p>
          No copy or timing warnings from the basic checks. Human review is
          still required.
        </p>
      )}
      <p className="ads-muted">
        Safe-zone guides are editorial estimates. Check the current placement
        preview before publishing. Use original screenshots for app screens and
        add exact text in post-production.
      </p>
    </section>
  );
}
function ProviderForm({
  enabled,
  report,
}: {
  enabled: boolean;
  report: (value: string) => void;
}) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="ads-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await savePlatformCredentials({ apiKey: secret });
          setSecret("");
          report("Provider key saved securely to your account.");
        } catch {
          report(
            "Key was not saved. Check id:secret format, database setup, and server encryption configuration.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Platform API key
        <input
          type="password"
          autoComplete="off"
          maxLength={4096}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="id:secret"
          required
        />
      </label>
      <div className="ads-actions">
        <button
          className="ads-primary"
          disabled={!enabled || busy || !secret.trim()}
        >
          Save or replace key
        </button>
        <button
          type="button"
          disabled={!enabled || busy}
          onClick={async () => {
            if (!window.confirm("Remove your saved provider key?")) return;
            setBusy(true);
            try {
              await clearPlatformCredentials();
              report("Provider key removed.");
            } catch {
              report("Could not remove the provider key. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Remove key
        </button>
      </div>
    </form>
  );
}
