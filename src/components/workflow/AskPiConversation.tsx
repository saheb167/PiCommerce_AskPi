import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles, Check, Loader2, ChevronLeft, ArrowRight, ArrowUp,
  AlertTriangle, Wand2, FileText, MessageSquare, Phone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { buildSkeleton, BUILD_STEPS, type AskPiPlan } from "./AskPiWizard";
import {
  CAMPAIGN_TEMPLATES, SEGMENTS, WA_TEMPLATES, SMS_SENDERS, VOICE_AGENTS,
  matchTemplate, planFromBrief, applyResolved, applyRefinement, validateResolved,
  findVoiceAgent,
  type CampaignTemplate, type BriefPlan, type TemplateVar,
} from "@/lib/tenant-registry";

/* ----------------------------------------------------------------- */
/* Types                                                             */
/* ----------------------------------------------------------------- */

export type ConversationPhase =
  | "intent" | "planning" | "resolve" | "validating" | "confirm" | "saved";

type Mode = "a1" | "a2";
type Msg = { id: string; from: "pi" | "user"; text: string };

export type AskPiConversationProps = {
  /** When false the conversation resets and pauses timers. */
  active: boolean;
  onSkeleton: (skeleton: AskPiPlan) => void;
  onBuild: (plan: AskPiPlan) => void;
  onPhaseChange?: (phase: ConversationPhase) => void;
  onSavedDraft?: (version: string) => void;
};

let _mid = 0;
const nextId = () => `m${++_mid}`;

/* ----------------------------------------------------------------- */
/* Conversational engine                                             */
/* ----------------------------------------------------------------- */

export function AskPiConversation({
  active,
  onSkeleton,
  onBuild,
  onPhaseChange,
  onSavedDraft,
}: AskPiConversationProps) {
  const [phase, setPhase] = useState<ConversationPhase>("intent");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [refineText, setRefineText] = useState("");
  const [mode, setMode] = useState<Mode | null>(null);
  const [template, setTemplate] = useState<CampaignTemplate | null>(null);
  const [, setBrief] = useState<BriefPlan | null>(null);
  const [openVars, setOpenVars] = useState<TemplateVar[]>([]);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [warnMessages, setWarnMessages] = useState<string[]>([]);
  const [buildStepIdx, setBuildStepIdx] = useState(0);

  // Refs to read fresh values inside timeouts.
  const pendingPlanRef = useRef<AskPiPlan | null>(null);
  const openVarsRef = useRef<TemplateVar[]>([]);
  const resolvedRef = useRef<Record<string, string>>({});
  const logRef = useRef<HTMLDivElement>(null);
  const intentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { openVarsRef.current = openVars; }, [openVars]);
  useEffect(() => { resolvedRef.current = resolved; }, [resolved]);
  useEffect(() => { onPhaseChange?.(phase); }, [phase, onPhaseChange]);

  // Reset whenever the panel (re)opens.
  useEffect(() => {
    if (!active) return;
    setPhase("intent");
    setMessages([]);
    setInput("");
    setRefineText("");
    setMode(null);
    setTemplate(null);
    setBrief(null);
    setOpenVars([]);
    setResolved({});
    setAssumptions([]);
    setWarnMessages([]);
    setBuildStepIdx(0);
    pendingPlanRef.current = null;
  }, [active]);

  // Auto-scroll the chat trace.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, phase]);

  const pushPi = (text: string) => {
    const id = nextId();
    setMessages((m) => [...m, { id, from: "pi", text }]);
  };
  const pushUser = (text: string) => {
    const id = nextId();
    setMessages((m) => [...m, { id, from: "user", text }]);
  };

  /* --------------------------- routing --------------------------- */

  function startA1(tpl: CampaignTemplate) {
    setMode("a1");
    setTemplate(tpl);
    setBrief(null);
    setOpenVars(tpl.openVars);
    setAssumptions(tpl.assumptions);
    setWarnMessages([]);
    setResolved({});
    pendingPlanRef.current = tpl.build({});
    pushPi(`Found "${tpl.name}" (${tpl.tenant}). ${tpl.objective}`);
    pushPi(`Tenant defaults pre-filled — not asked: ${tpl.assumptions.join(" · ")}.`);
    pushPi("Instantiating the approved journey on the canvas…");
    setPhase("planning");
  }

  function startA2(text: string) {
    const bp = planFromBrief(text);
    setMode("a2");
    setBrief(bp);
    setTemplate(null);
    setOpenVars(bp.gaps);
    setAssumptions(bp.assumptions);
    setWarnMessages([]);
    setResolved({});
    pendingPlanRef.current = bp.plan;
    pushUser(text);
    pushPi(`Got it — ${bp.objective}`);
    pushPi(`Channels: ${bp.channelsLine}.`);
    pushPi(`Assumptions: ${bp.assumptions.join(" · ")}.`);
    pushPi("Drafting the journey on the canvas with real IDs…");
    setPhase("planning");
  }

  function handleIntentSubmit() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const tpl = matchTemplate(text);
    if (tpl) startA1(tpl);
    else startA2(text);
  }

  /* ------------------------- planning ---------------------------- */

  useEffect(() => {
    if (phase !== "planning") return;
    const p = pendingPlanRef.current;
    if (!p) return;
    onSkeleton(buildSkeleton(p));
    setBuildStepIdx(0);
    const tick = setInterval(
      () => setBuildStepIdx((i) => Math.min(i + 1, BUILD_STEPS.length - 1)),
      650,
    );
    const done = setTimeout(() => {
      onBuild(p);
      // Pre-fill duration defaults so the Resolve card opens ready.
      setResolved((prev) => {
        const next = { ...prev };
        for (const v of openVarsRef.current) {
          if (v.kind === "duration" && !next[v.key]) next[v.key] = v.default;
        }
        return next;
      });
      pushPi("Draft is on the canvas. I batched everything I still need into one step below.");
      setPhase("resolve");
    }, 3000);
    return () => { clearInterval(tick); clearTimeout(done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /* ------------------------- validating -------------------------- */

  useEffect(() => {
    if (phase !== "validating") return;
    const t = setTimeout(() => {
      const res = validateResolved(openVarsRef.current, resolvedRef.current);
      if (res.level === "block") {
        res.messages.forEach(pushPi);
        pushPi("Fix that above, then submit again.");
        setPhase("resolve");
        return;
      }
      const base = pendingPlanRef.current!;
      const patched = applyResolved(base, resolvedRef.current);
      pendingPlanRef.current = patched;
      onBuild(patched);
      if (res.level === "warn") {
        setWarnMessages(res.messages);
        pushPi("Validated with a warning — you'll accept it explicitly on the next step.");
      } else {
        setWarnMessages([]);
        pushPi("Validation passed. Here's the final review.");
      }
      setPhase("confirm");
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /* --------------------------- actions --------------------------- */

  const setField = (key: string, val: string) =>
    setResolved((r) => ({ ...r, [key]: val }));

  const canSubmitResolve = useMemo(
    () => openVars.filter((v) => v.required).every((v) => (resolved[v.key] ?? "").length > 0),
    [openVars, resolved],
  );

  function handleRefine() {
    const text = refineText.trim();
    if (!text) return;
    setRefineText("");
    pushUser(text);
    const base = pendingPlanRef.current;
    if (!base) return;
    const r = applyRefinement(text, base);
    if (!r) {
      pushPi("I can adjust the fallback wait — try \"make the fallback wait 3 hours\".");
      return;
    }
    pendingPlanRef.current = r.plan;
    onBuild(r.plan);
    // Keep the Resolve card's duration field in sync so a later validate
    // (applyResolved) doesn't overwrite this in-place patch.
    const durationVar = openVarsRef.current.find((v) => v.kind === "duration");
    if (durationVar) setResolved((prev) => ({ ...prev, [durationVar.key]: r.duration }));
    // Keep the assumptions list consistent with the patched wait so the
    // Confirm card doesn't contradict the canvas.
    setAssumptions((prev) =>
      prev.map((a) => (/fallback wait/i.test(a) ? `Fallback wait set to ${r.duration}` : a)),
    );
    pushPi(`${r.echo} Same node — re-validated, no rebuild.`);
  }

  function confirmDraft() {
    pushPi("Saved as draft v1 — review on the canvas. Launch stays a separate step.");
    setPhase("saved");
    onSavedDraft?.("v1");
  }

  /* --------------------------- previews -------------------------- */

  const waSample = useMemo(() => {
    if (mode === "a1") {
      return "Hi {{1}}, your Suryoday EMI of ₹{{2}} is due in 3 days. Tap to pay securely before the due date.";
    }
    return "Hi {{1}}, you left items in your cart. Complete your order here: {{2}}";
  }, [mode]);

  const voiceSample = useMemo(() => {
    if (mode !== "a1") return null;
    const agent = findVoiceAgent(resolved.voiceAgent);
    return `"Hello, this is ${agent?.name ?? "the EMI reminder"} calling from Suryoday. Your upcoming EMI is due in a few days — may I help you complete the payment now?"`;
  }, [mode, resolved.voiceAgent]);

  /* ----------------------------------------------------------------- */
  /* Render                                                            */
  /* ----------------------------------------------------------------- */

  const headerTitle =
    phase === "intent" ? "Ask Pi · Create a campaign"
      : phase === "planning" ? "Pi is drafting your campaign"
        : phase === "resolve" ? "Ask Pi · Resolve open variables"
          : phase === "validating" ? "Validating…"
            : phase === "confirm" ? "Ask Pi · Confirm draft"
              : "Saved as draft v1";
  const headerSubtitle =
    phase === "intent" ? "Start from a template or describe a campaign"
      : phase === "planning" ? BUILD_STEPS[buildStepIdx]
        : phase === "resolve" ? "Only the open variables — pickers list approved IDs only"
          : phase === "validating" ? "Checking required fields & approval state"
            : phase === "confirm" ? "Review the sample messages and assumptions"
              : "Review on canvas · launch separately";

  const PROGRESS: Record<ConversationPhase, number> = {
    intent: 8, planning: 35, resolve: 55, validating: 70, confirm: 88, saved: 100,
  };

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 pb-2 pt-3.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-ai/10">
          {phase === "planning" || phase === "validating"
            ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ai" />
            : phase === "saved"
              ? <Check className="h-3.5 w-3.5 text-success" />
              : <Sparkles className="h-3.5 w-3.5 text-ai" />}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[12.5px] font-medium text-foreground">{headerTitle}</p>
          <p className="truncate text-[11px] text-muted-foreground">{headerSubtitle}</p>
        </div>
      </div>

      {/* Progress */}
      <div className="h-[2px] w-full bg-secondary">
        <div className="h-full bg-ai transition-all duration-500" style={{ width: `${PROGRESS[phase]}%` }} />
      </div>

      {/* Chat trace */}
      {messages.length > 0 && (
        <div ref={logRef} className="scrollbar-thin max-h-44 space-y-2 overflow-y-auto px-5 pt-3">
          {messages.map((m) => (
            <div key={m.id} className={cn("flex gap-2", m.from === "user" && "justify-end")}>
              {m.from === "pi" && (
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-ai/10">
                  <Sparkles className="h-3 w-3 text-ai" />
                </div>
              )}
              <p
                className={cn(
                  "max-w-[82%] rounded-2xl px-3 py-1.5 text-[12px] leading-relaxed",
                  m.from === "pi"
                    ? "bg-secondary text-foreground"
                    : "bg-ai text-ai-foreground",
                )}
              >
                {m.text}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Intent */}
      {phase === "intent" && (
        <div className="px-5 pb-4 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => startA1(CAMPAIGN_TEMPLATES[0])}
              className="group flex flex-col gap-1 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-all hover:border-ai/40 hover:bg-ai/[0.03]"
            >
              <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
                <FileText className="h-3.5 w-3.5 text-ai" /> Start from template
              </span>
              <span className="text-[10.5px] text-muted-foreground">
                Approved templates · tenant defaults pre-filled
              </span>
            </button>
            <button
              onClick={() => intentRef.current?.focus()}
              className="group flex flex-col gap-1 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-all hover:border-ai/40 hover:bg-ai/[0.03]"
            >
              <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
                <Wand2 className="h-3.5 w-3.5 text-ai" /> Describe a campaign
              </span>
              <span className="text-[10.5px] text-muted-foreground">
                Plain language · Pi resolves &amp; refines
              </span>
            </button>
          </div>

          <div className="mt-3 flex items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2">
            <Sparkles className="mb-1.5 h-3.5 w-3.5 shrink-0 text-ai" />
            <textarea
              ref={intentRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleIntentSubmit(); }
              }}
              placeholder="e.g. pre_due_emi_reminder_v3  ·  or  ·  Recover abandoned carts on WhatsApp with an SMS fallback"
              className="max-h-28 min-w-0 flex-1 resize-none bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
            />
            <button
              onClick={handleIntentSubmit}
              disabled={!input.trim()}
              className={cn(
                "mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all",
                input.trim() ? "bg-foreground text-background hover:scale-[1.04]" : "bg-muted text-muted-foreground/60",
              )}
              aria-label="Send"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Planning trace */}
      {phase === "planning" && (
        <div className="px-5 pb-4 pt-3">
          <ul className="space-y-1">
            {BUILD_STEPS.map((s, i) => (
              <li
                key={s}
                className={cn(
                  "flex items-center gap-2 text-[12px] transition-colors",
                  i < buildStepIdx ? "text-muted-foreground"
                    : i === buildStepIdx ? "text-foreground" : "text-muted-foreground/50",
                )}
              >
                {i < buildStepIdx ? <Check className="h-3 w-3 text-success" />
                  : i === buildStepIdx ? <Loader2 className="h-3 w-3 animate-spin text-ai" />
                    : <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />}
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Resolve card */}
      {phase === "resolve" && (
        <div className="px-5 pb-4 pt-3">
          <div className="rounded-2xl border border-ai/30 bg-ai/[0.03] p-3.5">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-ai/30 bg-ai/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ai">
                <Sparkles className="h-3 w-3" /> Resolve
              </span>
              <span className="text-[11px] text-muted-foreground">
                {openVars.length} open variable{openVars.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="mt-3 space-y-3">
              {openVars.map((v) => (
                <ResolveField key={v.key} v={v} value={resolved[v.key] ?? ""} onChange={(val) => setField(v.key, val)} />
              ))}
            </div>

            <button
              onClick={() => setPhase("validating")}
              disabled={!canSubmitResolve}
              className={cn(
                "mt-3.5 flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-medium transition-all",
                canSubmitResolve
                  ? "bg-ai text-ai-foreground hover:opacity-90"
                  : "cursor-not-allowed bg-muted text-muted-foreground/60",
              )}
            >
              Validate &amp; continue <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* A2 refine input */}
          {mode === "a2" && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5">
              <Wand2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                value={refineText}
                onChange={(e) => setRefineText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleRefine(); } }}
                placeholder="Refine — e.g. make the fallback wait 3 hours, not 6"
                className="min-w-0 flex-1 bg-transparent py-1 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
              />
              <button
                onClick={handleRefine}
                disabled={!refineText.trim()}
                className={cn(
                  "shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  refineText.trim() ? "text-ai hover:bg-ai/10" : "text-muted-foreground/50",
                )}
              >
                Refine
              </button>
            </div>
          )}
        </div>
      )}

      {/* Validating spinner */}
      {phase === "validating" && (
        <div className="flex items-center gap-2 px-5 pb-5 pt-3 text-[12.5px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-ai" /> Validating the resolved draft…
        </div>
      )}

      {/* Confirm card */}
      {phase === "confirm" && (
        <div className="px-5 pb-4 pt-3">
          <div className="space-y-2.5">
            {voiceSample && (
              <SamplePreview icon={<Phone className="h-3.5 w-3.5 text-ai" />} label="Voice opener" body={voiceSample} />
            )}
            <SamplePreview icon={<MessageSquare className="h-3.5 w-3.5 text-ai" />} label="WhatsApp message" body={waSample} />

            <div className="rounded-xl border border-border bg-card px-3 py-2.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Assumptions</p>
              <ul className="mt-1.5 space-y-1">
                {assumptions.map((a) => (
                  <li key={a} className="flex items-start gap-1.5 text-[12px] text-foreground">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" /> {a}
                  </li>
                ))}
              </ul>
            </div>

            {warnMessages.length > 0 && (
              <div className="rounded-xl border border-warning/40 bg-warning/5 px-3 py-2.5">
                {warnMessages.map((w) => (
                  <p key={w} className="flex items-start gap-1.5 text-[12px] text-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> {w}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3.5 flex items-center justify-between gap-2">
            <button
              onClick={() => setPhase("resolve")}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11.5px] text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-3 w-3" /> Back
            </button>
            <button
              onClick={confirmDraft}
              className="inline-flex items-center gap-1.5 rounded-md bg-ai px-3 py-1.5 text-[11.5px] font-medium text-ai-foreground hover:opacity-90"
            >
              <Check className="h-3 w-3" /> {warnMessages.length > 0 ? "Accept & confirm" : "Confirm"}
            </button>
          </div>
        </div>
      )}

      {/* Saved */}
      {phase === "saved" && (
        <div className="px-5 pb-5 pt-3">
          <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 px-3 py-2.5">
            <Check className="h-4 w-4 text-success" />
            <p className="text-[12.5px] font-medium text-foreground">
              Saved as draft v1 — review on the canvas, launch separately.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* Resolve field renderer (registry-backed pickers)                  */
/* ----------------------------------------------------------------- */

function ResolveField({
  v, value, onChange,
}: { v: TemplateVar; value: string; onChange: (val: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-[11.5px] font-medium text-foreground">
        {v.label}
        {v.required && <span className="ml-1 text-warning">*</span>}
      </label>

      {v.kind === "duration" ? (
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
            {v.kind === "voiceAgent" && VOICE_AGENTS.map((a) => (
              <SelectItem key={a.id} value={a.id} className="text-[12.5px]">
                {a.name} · {a.type}
              </SelectItem>
            ))}
            {v.kind === "smsSender" && SMS_SENDERS.map((s) => (
              <SelectItem key={s.id} value={s.id} className="text-[12.5px]">
                {s.label} · {s.senderId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function SamplePreview({ icon, label, body }: { icon: React.ReactNode; label: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground">{body}</p>
    </div>
  );
}
