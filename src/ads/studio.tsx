"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { signOut } from "@/app/ads/auth-actions";
import {
  savePlatformCredentials,
  clearPlatformCredentials,
} from "@/generation/actions";
import { deleteBrand, deleteBrandAsset, getBrandAssets, saveBrand, saveCampaign } from "./actions";
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
import { applyBrandKit, emptyBrandKit, kitFromBrief } from "./brand-kit";
import type { BrandAsset } from "./brand-assets";
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
  const [brandDraft, setBrandDraft] = useState<BrandKit>(emptyBrandKit);
  const [editingBrand, setEditingBrand] = useState<SavedBrand | null>(null);
  const [brandDirty, setBrandDirty] = useState(false);
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [selectedKit, setSelectedKit] = useState<BrandKit | null>(null);
  const [brandAssets, setBrandAssets] = useState<BrandAsset[]>([]);
  const [campaignAssets, setCampaignAssets] = useState<BrandAsset[]>([]);
  const [assetKind, setAssetKind] = useState<BrandAsset["kind"]>("logo");
  const [assetBusy, setAssetBusy] = useState(false);
  const brandFileRef = useRef<HTMLInputElement>(null);
  const [budgetCents, setBudgetCents] = useState(10_000);
  const [production, setProduction] = useState<ProductionState | null>(null);
  const variant = plan?.variants[variantIndex];

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || brandDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, brandDirty]);

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

  useEffect(() => {
    if (!editingBrand || !cloud) {
      setBrandAssets([]);
      return;
    }
    let live = true;
    void getBrandAssets(editingBrand.id).then((result) => {
      if (!live) return;
      if (result.data) setBrandAssets(result.data);
      else setNotice(result.error ?? "Could not load brand files.");
    });
    return () => { live = false; };
  }, [editingBrand?.id, cloud]);

  useEffect(() => {
    if (!saved?.plan.brandId || !cloud) {
      setCampaignAssets([]);
      return;
    }
    let live = true;
    void getBrandAssets(saved.plan.brandId).then((result) => {
      if (live) setCampaignAssets(result.data ?? []);
    });
    return () => { live = false; };
  }, [saved?.id, saved?.plan.brandId, cloud]);

  function mayDiscard() {
    return !dirty || window.confirm("Discard unsaved edits and continue?");
  }
  function mayDiscardBrand() {
    return !brandDirty || window.confirm("Discard unsaved brand kit edits?");
  }
  function changeBrief(patch: Partial<AdBrief>) {
    setBrief((v) => ({ ...v, ...patch }));
    setDirty(true);
  }
  function changeKit(patch: Partial<BrandKit>) {
    setBrandDraft((kit) => ({ ...kit, ...patch }));
    setBrandDirty(true);
  }
  function editKit(brand: SavedBrand) {
    if (!mayDiscardBrand()) return;
    setEditingBrand(brand);
    setBrandDraft({ ...brand.kit });
    setBrandDirty(false);
    setPanel("brand");
  }
  function newKit(kit: BrandKit = emptyBrandKit) {
    if (!mayDiscardBrand()) return;
    setEditingBrand(null);
    setBrandDraft({ ...kit });
    setBrandDirty(Boolean(kit.name));
    setPanel("brand");
  }
  function useKit(kit: BrandKit, id: string) {
    setBrief((previous) => applyBrandKit(previous, kit));
    setColor(kit.color);
    setSelectedBrandId(id);
    setSelectedKit(kit);
    setDirty(true);
    setNotice(`${kit.name} applied. Finish the campaign details, then build concepts.`);
    setPanel("brief");
  }
  async function importKit(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !mayDiscardBrand()) return;
    if (file.size > 40_000) {
      setNotice("Brand kit files must be under 40 KB.");
      return;
    }
    try {
      const raw: unknown = JSON.parse(await file.text());
      const parsed = brandSchema.safeParse(raw);
      if (!parsed.success) throw new Error(validationMessage(parsed.error));
      setEditingBrand(null);
      setBrandDraft(parsed.data);
      setBrandDirty(true);
      setNotice("Kit imported. Review it, then save it to your account.");
    } catch (error) {
      setNotice(error instanceof Error ? `Could not import kit: ${error.message}` : "Could not import kit.");
    }
  }
  function exportKit() {
    const parsed = brandSchema.safeParse(brandDraft);
    if (!parsed.success) {
      setNotice(validationMessage(parsed.error));
      return;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(parsed.data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${parsed.data.name.replace(/[^a-z0-9-]/gi, "_")}.brand-kit.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function persistKit(asNew = false) {
    const parsed = brandSchema.safeParse(brandDraft);
    if (!parsed.success) {
      setNotice(validationMessage(parsed.error));
      return;
    }
    setBusy(true);
    try {
      const result = await saveBrand({
        kit: parsed.data,
        ...(!asNew && editingBrand ? { id: editingBrand.id, revision: editingBrand.revision } : {}),
      });
      if (result.error) {
        setNotice(result.error);
        return;
      }
      const brand = result.data!;
      setBrands((list) => [brand, ...list.filter((item) => item.id !== brand.id)]);
      setEditingBrand(brand);
      setBrandDraft(brand.kit);
      setBrandDirty(false);
      if (selectedBrandId === brand.id) setSelectedKit(brand.kit);
      setNotice(`${brand.kit.name} saved. You can now apply it to any campaign.`);
    } catch {
      setNotice("Could not save the kit. Your edits are still here.");
    } finally {
      setBusy(false);
    }
  }
  async function removeKit() {
    if (!editingBrand || !window.confirm(`Delete ${editingBrand.kit.name} from your saved brand kits? Existing campaigns keep their snapshot.`)) return;
    setBusy(true);
    try {
      const result = await deleteBrand(editingBrand.id);
      if (result.error) {
        setNotice(result.error);
        return;
      }
      setBrands((list) => list.filter((item) => item.id !== editingBrand.id));
      if (selectedBrandId === editingBrand.id) setSelectedBrandId("");
      setEditingBrand(null);
      setBrandDraft(emptyBrandKit);
      setBrandDirty(false);
      setNotice("Brand kit deleted. Existing campaign storyboards are unchanged.");
    } finally {
      setBusy(false);
    }
  }
  async function uploadBrandImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !editingBrand) return;
    const form = new FormData();
    form.set("brandId", editingBrand.id);
    form.set("kind", assetKind);
    form.set("file", file);
    setAssetBusy(true);
    try {
      const response = await fetch("/api/ads/brand-assets", { method: "POST", body: form });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not upload the image.");
      const updated = await getBrandAssets(editingBrand.id);
      if (updated.error) throw new Error(updated.error);
      setBrandAssets(updated.data!);
      setNotice(`${file.name} added to ${editingBrand.kit.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not upload the image.");
    } finally {
      setAssetBusy(false);
    }
  }
  async function removeBrandImage(asset: BrandAsset) {
    if (!window.confirm(`Delete ${asset.filename} from this brand kit?`)) return;
    setAssetBusy(true);
    try {
      const result = await deleteBrandAsset(asset.id);
      if (result.error) setNotice(result.error);
      else {
        setBrandAssets((items) => items.filter((item) => item.id !== asset.id));
        setNotice("Brand file deleted.");
      }
    } finally {
      setAssetBusy(false);
    }
  }
  function reset() {
    if (!mayDiscard()) return;
    setSaved(null);
    setPlan(null);
    setName("");
    setBrief(emptyBrief);
    setSelectedBrandId("");
    setSelectedKit(null);
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
    setSelectedBrandId(campaign.plan.brandId ?? "");
    setSelectedKit(campaign.plan.brandKit ?? null);
    setColor(campaign.plan.brandKit?.color ?? "#d1fe17");
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
    const brand = selectedKit ? {
      ...(selectedBrandId && !selectedBrandId.startsWith("preset:") ? { id: selectedBrandId } : {}),
      kit: {
        ...selectedKit,
        name: result.data.brandName,
        product: result.data.productName,
        audience: result.data.audience,
        tone: result.data.tone ?? [],
        requiredText: result.data.requiredText ?? [],
        prohibitedClaims: result.data.prohibitedClaims ?? [],
      },
    } : undefined;
    setPlan(createAdPlan(result.data, new Date(), brand));
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
            <button onClick={() => setPanel("brand")}>Brand kits ({brands.length})</button>
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
                      ? "02 / Brand kits"
                      : "03 / Providers"}
                </button>
              ))}
            </div>

            {panel === "brand" && (
              <section className="ads-card ads-stack">
                <div className="ads-card-heading">
                  <div>
                    <h2>Brand kits</h2>
                    <p className="ads-muted">Save your identity, voice, copy rules, and visual direction once. Apply a kit when you start a campaign.</p>
                  </div>
                  <button type="button" onClick={() => newKit()}>+ New kit</button>
                </div>
                {brands.length > 0 && (
                  <div className="ads-brand-list" aria-label="Saved brand kits">
                    {brands.map((brand) => (
                      <button type="button" key={brand.id} aria-pressed={editingBrand?.id === brand.id}
                        onClick={() => editKit(brand)}>
                        <span className="ads-brand-swatch" style={{ background: brand.kit.color }} />
                        <span><strong>{brand.kit.name}</strong><small>{brand.kit.product}</small></span>
                      </button>
                    ))}
                  </div>
                )}
                <div>
                  <p className="ads-eyebrow">START FROM A TEMPLATE</p>
                  <div className="ads-company-presets">
                    {COMPANY_TEMPLATES.map((template) => (
                      <button type="button" key={template.id} onClick={() => newKit(template.kit)}>
                        <span className="ads-brand-swatch" style={{ background: template.kit.color }} />
                        {template.label} ↗
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ads-brand-actions">
                  <button type="button" onClick={() => newKit(kitFromBrief(brief, color))}>Start from current brief</button>
                  <button type="button" onClick={() => brandFileRef.current?.click()}>Import kit JSON ↑</button>
                  <input ref={brandFileRef} className="ads-sr" type="file" accept=".json,application/json"
                    aria-label="Import brand kit JSON" onChange={(event) => void importKit(event)} />
                </div>
                <div className="ads-brand-editor-title">
                  <h3>{editingBrand ? `Edit ${editingBrand.kit.name}` : "New brand kit"}</h3>
                  {brandDirty && <span className="ads-muted">Unsaved kit edits</span>}
                </div>
                <div className="ads-grid">
                  <label>Brand name
                    <input value={brandDraft.name} maxLength={100} placeholder="Your company"
                      onChange={(event) => changeKit({ name: event.target.value })} />
                  </label>
                  <label>Product or service
                    <input value={brandDraft.product} maxLength={2000} placeholder="What you sell"
                      onChange={(event) => changeKit({ product: event.target.value })} />
                  </label>
                </div>
                <div className="ads-grid">
                  <label>Core audience
                    <input value={brandDraft.audience} maxLength={2000} placeholder="Who the brand speaks to"
                      onChange={(event) => changeKit({ audience: event.target.value })} />
                  </label>
                  <label>Accent color
                    <input type="color" value={brandDraft.color}
                      onChange={(event) => changeKit({ color: event.target.value })} />
                  </label>
                </div>
                <div className="ads-grid">
                  <label>Voice and tone (one per line)
                    <textarea value={brandDraft.tone.join("\n")} placeholder="Direct\nPlayful"
                      onChange={(event) => changeKit({ tone: event.target.value.split("\n") })} />
                  </label>
                  <label>Preferred calls to action (one per line)
                    <textarea value={brandDraft.ctaLibrary.join("\n")} placeholder="Book a call\nGet started"
                      onChange={(event) => changeKit({ ctaLibrary: event.target.value.split("\n") })} />
                  </label>
                </div>
                <div className="ads-grid">
                  <label>Required exact copy (one per line)
                    <textarea value={brandDraft.requiredText.join("\n")} placeholder="Your approved brand wording"
                      onChange={(event) => changeKit({ requiredText: event.target.value.split("\n") })} />
                  </label>
                  <label>Claims to avoid (one per line)
                    <textarea value={brandDraft.prohibitedClaims.join("\n")} placeholder="Guaranteed results"
                      onChange={(event) => changeKit({ prohibitedClaims: event.target.value.split("\n") })} />
                  </label>
                </div>
                <div className="ads-grid">
                  <label>Brand fonts (one per line)
                    <textarea value={brandDraft.fonts.join("\n")} placeholder="Your display and body fonts"
                      onChange={(event) => changeKit({ fonts: event.target.value.split("\n") })} />
                  </label>
                  <label>Visual rules and reference notes
                    <textarea value={brandDraft.referenceNotes ?? ""} maxLength={4000}
                      placeholder="Use real product screens. Preserve vehicle details."
                      onChange={(event) => changeKit({ referenceNotes: event.target.value })} />
                  </label>
                </div>
                <div className="ads-grid">
                  <label>Voiceover direction
                    <textarea value={brandDraft.voiceDirection ?? ""} maxLength={2000}
                      onChange={(event) => changeKit({ voiceDirection: event.target.value })} />
                  </label>
                  <label>Music and sound direction
                    <textarea value={brandDraft.musicDirection ?? ""} maxLength={2000}
                      onChange={(event) => changeKit({ musicDirection: event.target.value })} />
                  </label>
                </div>
                <div className="ads-brand-media">
                  <h3>Logos and visual references</h3>
                  <p className="ads-muted">Add real brand files to keep them with this kit. Use reference images for shot generation when the chosen model supports them.</p>
                  {editingBrand && cloud ? (
                    <div className="ads-brand-actions">
                      <label>File type
                        <select value={assetKind} onChange={(event) => setAssetKind(event.target.value as BrandAsset["kind"])}>
                          <option value="logo">Logo</option>
                          <option value="reference">Visual reference</option>
                          <option value="screenshot">Product screenshot</option>
                        </select>
                      </label>
                      <label>Upload image (PNG, JPEG, WebP · 10 MB max)
                        <input type="file" accept="image/png,image/jpeg,image/webp" disabled={assetBusy}
                          onChange={(event) => void uploadBrandImage(event)} />
                      </label>
                    </div>
                  ) : <p className="ads-muted">Save this kit to add image files.</p>}
                  {assetBusy && <p className="ads-muted">Updating brand files…</p>}
                  {brandAssets.length > 0 && <div className="ads-brand-assets">
                    {brandAssets.map((asset) => <article key={asset.id}>
                      <a href={asset.signedUrl} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={asset.signedUrl} alt={`${asset.kind}: ${asset.filename}`} />
                      </a>
                      <div><strong>{asset.kind}</strong><small title={asset.filename}>{asset.filename}</small></div>
                      <button type="button" disabled={assetBusy} onClick={() => void removeBrandImage(asset)}>Remove</button>
                    </article>)}
                  </div>}
                </div>
                <p className="ads-muted">Visual, voice, and music notes guide shot prompts. Exact logos and fonts still need real assets during editing.</p>
                <div className="ads-brand-actions">
                  <button className="ads-primary" type="button" disabled={!cloud || busy} onClick={() => void persistKit()}>
                    {busy ? "Saving…" : editingBrand ? "Save kit changes" : "Save brand kit"}
                  </button>
                  {editingBrand && <button type="button" disabled={!cloud || busy} onClick={() => void persistKit(true)}>Save as new</button>}
                  <button type="button" onClick={() => {
                    const parsed = brandSchema.safeParse(brandDraft);
                    if (!parsed.success) setNotice(validationMessage(parsed.error));
                    else useKit(parsed.data, editingBrand?.id ?? "");
                  }}>Use in campaign →</button>
                  <button type="button" onClick={exportKit}>Export JSON ↓</button>
                  {editingBrand && <button type="button" className="ads-danger" disabled={busy} onClick={() => void removeKit()}>Delete kit</button>}
                </div>
              </section>
            )}

            {panel === "provider" && (
              <section className="ads-card ads-stack">
                <h2>Generation provider</h2>
                <p>
                  Runway and fal.ai power durable campaign shot jobs. Model
                  choices show their provider before any paid generation starts.
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
                        setSelectedBrandId("");
                        setSelectedKit(null);
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
                    Brand kit
                    <select
                      value={selectedBrandId}
                      onChange={(e) => {
                        const id = e.target.value;
                        const kit = id.startsWith("preset:")
                          ? COMPANY_TEMPLATES.find((item) => `preset:${item.id}` === id)?.kit
                          : brands.find((item) => item.id === id)?.kit;
                        if (kit) useKit(kit, id);
                        else if (!id) { setSelectedBrandId(""); setSelectedKit(null); }
                      }}
                    >
                      <option value="">Choose a brand kit</option>
                      {brands.length > 0 && <optgroup label="Your saved kits">
                        {brands.map((b) => <option value={b.id} key={b.id}>{b.kit.name}</option>)}
                      </optgroup>}
                      <optgroup label="Starter templates">
                        {COMPANY_TEMPLATES.map((template) => (
                          <option value={`preset:${template.id}`} key={template.id}>{template.label}</option>
                        ))}
                      </optgroup>
                    </select>
                    <button type="button" className="ads-inline-link" onClick={() => newKit(kitFromBrief(brief, color))}>
                      Create or edit brand kits →
                    </button>
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
                            <pre>{shotPrompt(plan.brief, beat, plan.brandKit)}</pre>
                          </details>
                          {saved && !dirty && (
                            <ShotProductionControls
                              brandAssets={campaignAssets}
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
                {saved && !dirty && (
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
