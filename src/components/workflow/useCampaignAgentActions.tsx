/**
 * useCampaignAgentActions — the CopilotKit frontend-action surface for the
 * template (A1) campaign-creation path.
 *
 * The LLM (Anthropic via the CopilotKit runtime) orchestrates campaign creation
 * by calling these actions; it never invents resource ids. The actions split
 * into two kinds:
 *
 *  - **Data / side-effect actions** (`handler`): registry lookups + the
 *    `instantiateCampaignTemplate` bridge (template → {@link CampaignDSL} →
 *    canvas) + deterministic `validateCampaign`. These return JSON the model
 *    reads; the instantiate/resolve handlers also push the compiled graph onto
 *    the canvas via the provided callbacks.
 *  - **HITL generative-UI cards** (`renderAndWaitForResponse`):
 *    `resolveCampaign` (the single Resolve card listing only the DSL's open
 *    variables, backed by registry pickers) and `confirmCampaign` (sample
 *    messages + assumptions + any carried warn). Each blocks the agent until the
 *    user submits, then `respond`s the outcome back to the model.
 *
 * The working draft lives in a ref so successive actions patch one DSL in place
 * (stable node ids), keeping the agent path and the canvas in lock-step. All
 * data here is metadata + ids only — no PII ever reaches the model.
 */
import { useRef, useState } from "react";
import { useCopilotAction } from "@copilotkit/react-core";
import {
  Check,
  ChevronLeft,
  AlertTriangle,
  XCircle,
  ShieldCheck,
  Sparkles,
  MessageSquare,
  Phone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  SEGMENTS, WA_TEMPLATES, VOICE_AGENTS, CHANNEL_SAMPLE,
  findSegment, findWaTemplate, findVoiceAgent,
  type TemplateVar,
} from "@/lib/tenant-registry";
import type { AskPiPlan } from "./AskPiWizard";
import {
  listTemplates, listSegments, listWhatsAppTemplates, listVoiceAgents,
  instantiateTemplate, findTemplate,
} from "@/lib/campaign/registry";
import { compile, applyResolved } from "@/lib/campaign/compiler";
import { validate } from "@/lib/campaign/validation";
import type { CampaignDSL } from "@/lib/campaign/campaign-dsl";

/* ----------------------------------------------------------------- */
/* Hook                                                              */
/* ----------------------------------------------------------------- */

export type CampaignAgentCallbacks = {
  /** Render the dimmed "building" skeleton on the canvas (optional). */
  onSkeleton?: (skeleton: AskPiPlan) => void;
  /** Render the compiled draft graph on the canvas (real ids bound). */
  onBuild?: (plan: AskPiPlan) => void;
  /** Fires once the Confirm card saves a versioned draft (e.g. "v1"). */
  onSavedDraft?: (version: string) => void;
};

/**
 * Register the A1 template actions on the surrounding CopilotKit provider.
 * Must be called from a component mounted inside `<CopilotKit>` (i.e. the
 * AiComposer on /campaigns/new).
 */
export function useCampaignAgentActions(cb: CampaignAgentCallbacks) {
  // The single working draft. Successive actions patch this one DSL in place so
  // the canvas and the agent never diverge.
  const dslRef = useRef<CampaignDSL | null>(null);

  /* -------- Data / lookup actions (the agent's only id source) -------- */

  useCopilotAction({
    name: "listCampaignTemplates",
    description:
      "List the approved campaign templates the tenant can start from, optionally ranked against a free-text goal. Returns template ids + metadata only. Call this first when the user wants to create a campaign from a template.",
    parameters: [
      { name: "query", type: "string", description: "Optional free-text goal to rank templates by.", required: false },
    ],
    handler: async ({ query }) => listTemplates(query),
  });

  useCopilotAction({
    name: "listSegments",
    description: "List selectable audience segments (id, label, size). Use to describe options; the Resolve card binds the actual picker.",
    parameters: [],
    handler: async () => listSegments(),
  });

  useCopilotAction({
    name: "listWhatsAppTemplates",
    description: "List approved WhatsApp templates (including any pending re-approval, which validation will flag as a warning). Returns ids + metadata only.",
    parameters: [],
    handler: async () => listWhatsAppTemplates(),
  });

  useCopilotAction({
    name: "listVoiceAgents",
    description: "List live voice agents bindable to a voice step. Returns ids + names only.",
    parameters: [],
    handler: async () => listVoiceAgents(),
  });

  /* -------- instantiateCampaignTemplate: template → DSL → canvas -------- */

  useCopilotAction({
    name: "instantiateCampaignTemplate",
    description:
      "Instantiate an approved template into a campaign draft: tenant defaults are pre-filled (surfaced as assumptions, never asked) and the draft graph is rendered on the canvas. Returns the still-open variables the user must resolve plus the baked assumptions. Call after the user picks a template id from listCampaignTemplates.",
    parameters: [
      { name: "templateId", type: "string", description: "The template id to instantiate (e.g. pre_due_emi_reminder_v3).", required: true },
    ],
    handler: async ({ templateId }) => {
      let dsl: CampaignDSL;
      try {
        dsl = instantiateTemplate(templateId);
      } catch {
        return { ok: false, error: `Unknown template id: ${templateId}. Call listCampaignTemplates for valid ids.` };
      }
      dslRef.current = dsl;
      const { plan, needsInput, assumptions } = compile(dsl);
      cb.onBuild?.(plan);
      return {
        ok: true,
        name: dsl.name,
        objective: dsl.objective,
        assumptions,
        needsInput: needsInput.map((v) => ({ key: v.key, label: v.label, kind: v.kind })),
        message:
          "Draft rendered on the canvas with tenant defaults pre-filled. Next, call resolveCampaign so the user can fill the open variables.",
      };
    },
  });

  /* -------- resolveCampaign: the single HITL Resolve card -------- */

  useCopilotAction({
    name: "resolveCampaign",
    description:
      "Show the single Resolve card listing ONLY the current draft's open variables (segment, approved WhatsApp template, voice agent, fallback window), each backed by a registry-bound picker. Blocks until the user submits. Call after instantiateCampaignTemplate.",
    parameters: [],
    renderAndWaitForResponse: ({ status, respond }) => {
      const dsl = dslRef.current;
      if (!dsl) {
        return <CardNote tone="block" text="No draft yet — instantiate a template first." />;
      }
      const { needsInput } = compile(dsl);
      return (
        <ResolveCard
          vars={needsInput}
          done={status === "complete"}
          onSubmit={(resolved) => {
            const next = applyResolved(dsl, resolved);
            dslRef.current = next;
            cb.onBuild?.(compile(next).plan);
            respond?.(
              `User resolved: ${JSON.stringify(resolved)}. Now call validateCampaign before confirming.`,
            );
          }}
        />
      );
    },
  });

  /* -------- validateCampaign: deterministic gate (never the LLM) -------- */

  useCopilotAction({
    name: "validateCampaign",
    description:
      "Run the deterministic compliance gate over the current draft. Returns level (pass | warn | block) plus a granular checklist. On block, re-open resolveCampaign. On pass or warn, proceed to confirmCampaign (carry any warn into the confirm step for explicit acceptance).",
    parameters: [],
    handler: async () => {
      const dsl = dslRef.current;
      if (!dsl) return { level: "block" as const, messages: ["No draft to validate."], checks: [] };
      const result = validate(dsl);
      return { level: result.level, messages: result.messages, checks: result.checks };
    },
  });

  /* -------- confirmCampaign: the HITL Confirm card -------- */

  useCopilotAction({
    name: "confirmCampaign",
    description:
      "Show the Confirm card: sample WhatsApp message + voice opener rendered from the bound template, the full assumptions list, and any carried validation warning the user must explicitly accept. On confirm, the draft is saved as a version (no launch). Call only after validateCampaign returns pass or warn.",
    parameters: [
      { name: "warning", type: "string", description: "Optional validation warning to surface for explicit acceptance (e.g. a WhatsApp template pending re-approval).", required: false },
    ],
    renderAndWaitForResponse: ({ args, status, respond }) => {
      const dsl = dslRef.current;
      if (!dsl) {
        return <CardNote tone="block" text="No draft to confirm." />;
      }
      const { assumptions } = compile(dsl);
      return (
        <ConfirmCard
          dsl={dsl}
          assumptions={assumptions}
          warning={args?.warning}
          done={status === "complete"}
          onBack={() => respond?.("User chose to go back to the Resolve card. Call resolveCampaign again.")}
          onConfirm={() => {
            cb.onSavedDraft?.("v1");
            respond?.("User confirmed. Saved as draft v1. Do not launch.");
          }}
        />
      );
    },
  });
}

/* ----------------------------------------------------------------- */
/* Cards (generative UI rendered inside the CopilotKit chat)         */
/* ----------------------------------------------------------------- */

function CardNote({ tone, text }: { tone: "block" | "pass"; text: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-1.5 rounded-xl border px-3 py-2.5 text-[12.5px] leading-relaxed",
        tone === "block"
          ? "border-destructive/40 bg-destructive/[0.04] text-muted-foreground"
          : "border-success/40 bg-success/[0.05] text-foreground",
      )}
    >
      {tone === "block" ? (
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
      ) : (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
      )}
      <span>{text}</span>
    </div>
  );
}

/** The single Resolve card — only the draft's open variables, registry-backed. */
function ResolveCard({
  vars, done, onSubmit,
}: {
  vars: TemplateVar[];
  done: boolean;
  onSubmit: (resolved: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const v of vars) if (v.kind === "duration" && v.default) seed[v.key] = v.default;
    return seed;
  });
  const [submitted, setSubmitted] = useState(false);

  const missing = vars.filter((v) => v.required && !values[v.key]?.trim());
  const ready = missing.length === 0;

  if (done || submitted) {
    return (
      <CardNote
        tone="pass"
        text={`Resolved ${vars.length} ${vars.length === 1 ? "field" : "fields"}.`}
      />
    );
  }

  return (
    <div className="w-full max-w-[440px] space-y-3 rounded-2xl border border-border bg-card p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ai">
        <Sparkles className="h-3.5 w-3.5" /> Resolve open variables
      </p>
      <div className="space-y-2.5">
        {vars.map((v) => (
          <ResolveField
            key={v.key}
            v={v}
            value={values[v.key] ?? ""}
            onChange={(val) => setValues((prev) => ({ ...prev, [v.key]: val }))}
          />
        ))}
      </div>
      <div className="flex items-center justify-end pt-0.5">
        <button
          disabled={!ready}
          onClick={() => { setSubmitted(true); onSubmit(values); }}
          className={cn(
            "rounded-lg px-3.5 py-1.5 text-[12.5px] font-medium transition-all",
            ready
              ? "bg-foreground text-background hover:scale-[1.02]"
              : "cursor-not-allowed bg-muted text-muted-foreground/60",
          )}
        >
          Submit
        </button>
      </div>
    </div>
  );
}

/** Single Resolve-card field: registry-bound Select for ids, Input for durations. */
function ResolveField({
  v, value, onChange,
}: { v: TemplateVar; value: string; onChange: (val: string) => void }) {
  const liveAgents = VOICE_AGENTS.filter((a) => a.status === "live");
  const resourceEmpty =
    (v.kind === "waTemplate" && WA_TEMPLATES.length === 0) ||
    (v.kind === "voiceAgent" && liveAgents.length === 0);

  return (
    <div>
      <label className="mb-1 block text-[11.5px] font-medium text-foreground">
        {v.label}
        {v.required && <span className="ml-1 text-warning">*</span>}
      </label>

      {resourceEmpty ? (
        <div className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/[0.04] px-2.5 py-2">
          <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            No {v.kind === "waTemplate" ? "approved WhatsApp templates" : "live voice agents"} are available — set one up before this channel can run.
          </p>
        </div>
      ) : v.kind === "duration" ? (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={v.default}
          className="h-8 text-[12.5px]"
        />
      ) : (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="h-8 text-[12.5px]">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {v.kind === "segment" && SEGMENTS.map((s) => (
              <SelectItem key={s.id} value={s.id} className="text-[12.5px]">
                {s.label} · {s.size}
              </SelectItem>
            ))}
            {v.kind === "waTemplate" && WA_TEMPLATES.map((t) => (
              <SelectItem key={t.id} value={t.id} className="text-[12.5px]">
                <span className="flex items-center gap-1.5">
                  {t.label}
                  {t.status === "pending_reapproval" && (
                    <span className="inline-flex items-center gap-0.5 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-px text-[9.5px] font-medium text-warning">
                      <AlertTriangle className="h-2.5 w-2.5" /> pending
                    </span>
                  )}
                </span>
              </SelectItem>
            ))}
            {v.kind === "voiceAgent" && liveAgents.map((a) => (
              <SelectItem key={a.id} value={a.id} className="text-[12.5px]">
                {a.name} · {a.type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/** Confirm card — sample messages + assumptions + optional warn, save as draft. */
function ConfirmCard({
  dsl, assumptions, warning, done, onBack, onConfirm,
}: {
  dsl: CampaignDSL;
  assumptions: string[];
  warning?: string;
  done: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const [choice, setChoice] = useState<"confirmed" | "back" | null>(null);

  const tpl = dsl.source.templateId ? findTemplate(dsl.source.templateId) : undefined;
  const seg = findSegment(dsl.audience.segment.value);
  const waStep = dsl.steps.find((s) => s.type === "whatsapp");
  const voiceStep = dsl.steps.find((s) => s.type === "voice");
  const wa = waStep?.type === "whatsapp" ? findWaTemplate(waStep.waTemplate.value) : undefined;
  const agent = voiceStep?.type === "voice" ? findVoiceAgent(voiceStep.voiceAgent.value) : undefined;

  const waSample = tpl?.samples?.whatsapp ?? CHANNEL_SAMPLE.whatsapp;
  const voiceSample = tpl?.samples?.voice ?? CHANNEL_SAMPLE.voice;

  if (done || choice) {
    return (
      <CardNote
        tone={choice === "back" ? "block" : "pass"}
        text={choice === "back" ? "Back to the Resolve card." : "Saved as draft v1 — review on canvas, launch separately."}
      />
    );
  }

  return (
    <div className="w-full max-w-[440px] space-y-3 rounded-2xl border border-border bg-card p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ai">
        <ShieldCheck className="h-3.5 w-3.5" /> Confirm draft
      </p>

      <div className="space-y-1 text-[12.5px]">
        <p className="font-medium text-foreground">{dsl.name}</p>
        {seg && <p className="text-muted-foreground">Audience · {seg.label} ({seg.size})</p>}
      </div>

      {/* Sample messages */}
      <div className="space-y-2">
        {wa && (
          <SamplePreview
            icon={<MessageSquare className="h-3.5 w-3.5 text-ai" />}
            title={`WhatsApp · ${wa.label}`}
            body={waSample}
          />
        )}
        {agent && (
          <SamplePreview
            icon={<Phone className="h-3.5 w-3.5 text-ai" />}
            title={`Voice · ${agent.name}`}
            body={voiceSample}
          />
        )}
      </div>

      {/* Assumptions */}
      {assumptions.length > 0 && (
        <div className="rounded-xl border border-border bg-secondary/40 px-3 py-2">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Assumptions</p>
          <ul className="space-y-0.5">
            {assumptions.map((a, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" /> {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Carried warning — explicit acceptance */}
      {warning && (
        <div className="flex items-start gap-1.5 rounded-xl border border-warning/40 bg-warning/[0.06] px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <p className="text-[11.5px] leading-relaxed text-foreground">{warning}</p>
        </div>
      )}

      <div className="flex items-center justify-between pt-0.5">
        <button
          onClick={() => { setChoice("back"); onBack(); }}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Back
        </button>
        <button
          onClick={() => { setChoice("confirmed"); onConfirm(); }}
          className="rounded-lg bg-foreground px-3.5 py-1.5 text-[12.5px] font-medium text-background transition-all hover:scale-[1.02]"
        >
          {warning ? "Accept and confirm" : "Confirm"}
        </button>
      </div>
    </div>
  );
}

function SamplePreview({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/40 px-3 py-2">
      <p className="mb-1 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon} {title}
      </p>
      <p className="text-[12px] leading-relaxed text-foreground">{body}</p>
    </div>
  );
}
