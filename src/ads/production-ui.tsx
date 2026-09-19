"use client";

import { useRef, useState } from "react";
import {
  enqueueCampaignRender,
  enqueueShotCandidates,
  cancelGenerationJob,
  importCampaignMetrics,
  saveProviderCredentials,
  selectGenerationCandidate,
} from "./production-actions";
import { PRODUCTION_MODELS } from "@/generation/providers/registry";
import type { Campaign } from "./repository";
import type { AdVariantPlan } from "./types";
import type { ProductionState } from "./production-types";

type CommonProps = {
  campaign: Campaign;
  state: ProductionState | null;
  refresh: () => Promise<void>;
  notice: (message: string) => void;
};

function ProviderCredentialForm({ provider, label, notice }: {
  provider: "runway" | "fal";
  label: string;
  notice: (message: string) => void;
}) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="ads-stack"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void saveProviderCredentials(provider, secret).then((result) => {
          setBusy(false);
          if (result.error) notice(result.error);
          else {
            setSecret("");
            notice(`${label} API key encrypted and saved.`);
          }
        });
      }}
    >
      <h3>{label}</h3>
      <p className="ads-muted">Used by the Railway production worker. The browser never receives this key.</p>
      <label>
        {label} API secret
        <input
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          placeholder="key_…"
        />
      </label>
      <button className="ads-primary" disabled={busy || secret.trim().length < 20}>
        {busy ? "Saving…" : `Save ${label} key`}
      </button>
    </form>
  );
}

export function RunwayCredentials({ notice }: { notice: (message: string) => void }) {
  return (
    <div className="ads-stack">
      <ProviderCredentialForm provider="runway" label="Runway" notice={notice} />
      <ProviderCredentialForm provider="fal" label="fal.ai" notice={notice} />
    </div>
  );
}

export function ShotProductionControls({
  campaign,
  state,
  refresh,
  notice,
  variantId,
  beatId,
}: CommonProps & { variantId: string; beatId: string }) {
  const [busy, setBusy] = useState(false);
  const [modelId, setModelId] = useState(PRODUCTION_MODELS[0].id);
  const [referenceImageUrl, setReferenceImageUrl] = useState("");
  const selectedModel = PRODUCTION_MODELS.find((model) => model.id === modelId) ?? PRODUCTION_MODELS[0];
  const jobs = state?.jobs.filter((job) => job.beat_id === beatId) ?? [];
  const jobIds = new Set(jobs.map((job) => job.id));
  const outputs = state?.outputs.filter((output) => jobIds.has(output.job_id)) ?? [];
  const active = jobs.some((job) => job.status === "queued" || job.status === "processing");
  const approved = campaign.status === "approved" && Boolean(campaign.production_approved_at);
  return (
    <div className="ads-production-shot">
      <div className="ads-card-heading">
        <div>
          <strong>Production</strong>
          <small className="ads-muted">
            {active ? "Generating candidates…" : `${outputs.length} candidate${outputs.length === 1 ? "" : "s"}`}
          </small>
        </div>
        <button
          disabled={!approved || busy || active}
          onClick={() => {
            setBusy(true);
            void enqueueShotCandidates({
              campaignId: campaign.id,
              variantId,
              beatId,
              candidates: 2,
              modelId,
              ...(referenceImageUrl ? { referenceImageUrl } : {}),
            })
              .then(async (result) => {
                if (result.error) notice(result.error);
                else notice(`Two ${selectedModel.label} candidates queued. Reserved budget is shown in the campaign bar.`);
                await refresh();
              })
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Queuing…" : outputs.length ? "Generate 2 more" : "Generate 2 candidates"}
        </button>
      </div>
      <div className="ads-production-options">
        <label>
          Generation model
          <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
            {PRODUCTION_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label} · {model.provider === "runway" ? "Runway" : "fal.ai connection required"}
              </option>
            ))}
          </select>
        </label>
        {selectedModel.supportsReferenceImage && (
          <label>
            Approved reference image URL
            <input
              type="url"
              value={referenceImageUrl}
              onChange={(event) => setReferenceImageUrl(event.target.value)}
              placeholder="https://…"
            />
          </label>
        )}
      </div>
      {!approved && <p className="ads-muted">Approve the storyboard and budget to enable paid generation.</p>}
      {jobs.some((job) => job.status === "failed") && (
        <p className="ads-warning">{jobs.find((job) => job.status === "failed")?.error ?? "A candidate failed."}</p>
      )}
      {jobs.filter((job) => job.status === "queued" || job.status === "processing").map((job) => (
        <button
          key={job.id}
          className="ads-cancel-job"
          disabled={busy || Boolean(job.cancel_requested_at)}
          onClick={() => {
            setBusy(true);
            void cancelGenerationJob(job.id)
              .then(async (result) => {
                notice(result.error ?? "Cancellation requested. Reserved budget will be released.");
                await refresh();
              })
              .finally(() => setBusy(false));
          }}
        >
          {job.cancel_requested_at ? "Cancellation pending…" : `Cancel ${job.model} job`}
        </button>
      ))}
      {outputs.length > 0 && (
        <div className="ads-candidate-grid">
          {outputs.map((output) => (
            <article key={output.id} className={output.selected ? "is-selected" : ""}>
              {output.signedUrl ? <video src={output.signedUrl} controls preload="metadata" /> : <div>Preview unavailable</div>}
              <button
                disabled={busy || output.selected}
                onClick={() => {
                  setBusy(true);
                  void selectGenerationCandidate(output.id)
                    .then(async (result) => {
                      notice(result.error ?? "Candidate selected for the final timeline.");
                      await refresh();
                    })
                    .finally(() => setBusy(false));
                }}
              >
                {output.selected ? "Selected" : "Use this take"}
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProductionLibrary({ campaign, state, refresh, notice, variant }: CommonProps & { variant: AdVariantPlan }) {
  const [busy, setBusy] = useState(false);
  const outputs = state?.outputs ?? [];
  const renders = state?.renders.filter((render) => render.variant_id === variant.id) ?? [];
  return (
    <section className="ads-card ads-production-library">
      <div className="ads-title-row">
        <div>
          <p className="ads-eyebrow">CAMPAIGN MEDIA</p>
          <h3>Selected takes and final exports</h3>
        </div>
        <button
          className="ads-primary"
          disabled={busy || outputs.filter((output) => output.selected).length < variant.beats.length}
          onClick={() => {
            setBusy(true);
            void enqueueCampaignRender({ campaignId: campaign.id, variantId: variant.id })
              .then(async (result) => {
                notice(result.error ?? "MP4 render queued on Railway.");
                await refresh();
              })
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Queuing…" : "Render final MP4"}
        </button>
      </div>
      <p className="ads-muted">Select one take for every shot. The renderer applies timing, captions, branding, and the placement aspect ratio.</p>
      <div className="ads-media-library">
        {outputs.filter((output) => output.selected).map((output) => (
          <video key={output.id} src={output.signedUrl} controls preload="metadata" />
        ))}
        {renders.map((render) =>
          render.signedUrl ? (
            <a key={render.id} href={render.signedUrl} download>
              Download {variant.target.label} MP4
            </a>
          ) : (
            <span key={render.id}>{render.status === "failed" ? render.error : `Render ${render.status}`}</span>
          ),
        )}
      </div>
      <details className="ads-audit-trail">
        <summary>Paid generation audit trail ({state?.audits.length ?? 0})</summary>
        {state?.audits.length ? (
          <ol>
            {state.audits.slice(0, 20).map((event) => (
              <li key={event.id}>
                <strong>{event.event_type}</strong>{" "}
                <span>{new Date(event.created_at).toLocaleString()}</span>{" "}
                <small>{event.entity_type} {event.entity_id.slice(0, 8)}</small>
              </li>
            ))}
          </ol>
        ) : <p>No paid production events yet.</p>}
      </details>
    </section>
  );
}

export function AnalyticsPanel({ campaign, state, refresh, notice }: CommonProps) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="ads-card ads-analytics">
      <div className="ads-title-row">
        <div>
          <p className="ads-eyebrow">CREATIVE RESULTS</p>
          <h3>Import placement performance</h3>
        </div>
        <label className="ads-file-button">
          {busy ? "Importing…" : "Import CSV"}
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setBusy(true);
              void file.text().then((csv) => importCampaignMetrics({ campaignId: campaign.id, csv }))
                .then(async (result) => {
                  notice(result.error ?? `${result.data?.imported ?? 0} analytics rows imported.`);
                  await refresh();
                })
                .finally(() => {
                  setBusy(false);
                  if (input.current) input.current.value = "";
                });
            }}
          />
        </label>
      </div>
      <p className="ads-muted">CSV columns: creative_id, platform, date, spend, impressions, three_second_views, completions, clicks, conversions, revenue.</p>
      {state?.metrics.length ? (
        <div className="ads-metrics-table">
          {state.metrics.slice(0, 20).map((metric) => (
            <div key={metric.id}>
              <strong>{metric.creative_id}</strong>
              <span>{metric.platform}</span>
              <span>{metric.score.toFixed(1)} score</span>
              <span>{metric.impressions.toLocaleString()} impressions</span>
              <span>${(metric.spend_cents / 100).toFixed(2)} spend</span>
            </div>
          ))}
        </div>
      ) : <p>No performance data imported yet.</p>}
    </section>
  );
}
