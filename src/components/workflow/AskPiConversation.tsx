import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles, Check, Loader2, ChevronLeft, ArrowRight, ArrowUp,
  AlertTriangle, XCircle, ShieldCheck, Wand2, FileText, MessageSquare, Phone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { buildSkeleton, type AskPiPlan } from "./AskPiWizard";
import {
  SEGMENTS, WA_TEMPLATES, SMS_SENDERS, VOICE_AGENTS,
  CHANNEL_META, CHANNEL_SAMPLE,
  matchTemplate, planFromBrief, analyzeBrief, suggestTemplates, channelsSummary,
  applyResolved, applyRefinement, validateResolved, runChecks,
  type CampaignTemplate, type BriefPlan, type TemplateVar,
  type BriefConfig, type Channel, type ValidationCheck,
} from "@/lib/tenant-registry";

/* ----------------------------------------------------------------- */
/* Types                                                             */
/* ----------------------------------------------------------------- */

export type ConversationPhase =
  | "intent" | "briefConfirm" | "planning" | "resolve" | "validating" | "blocked" | "confirm" | "saved";

type Mode = "a1" | "a2";
type Msg = { id: string; from: "pi" | "user"; text: string };

export type AskPiConversationProps = {
  /** When false the conversation resets and pauses timers. */
  active: boolean;
  onSkeleton: (skeleton: AskPiPlan) => void;
  onBuild: (plan: AskPiPlan) => void;
  onPhaseChange?: (phase: ConversationPhase) => void;
  onSavedDraft?: (version: string) => void;
  /** Seed campaign name/description/objective used to rank suggested templates. */
  seedName?: string;
  seedDescription?: string;
  seedObjective?: string;
};

const CHANNEL_ORDER: Channel[] = ["whatsapp", "sms", "voice"];

// Logical, mode-aware "thinking" steps shown while Pi drafts the journey.
// A1 instantiates an approved template; A2 reasons from a free-text brief.
const A1_PLAN_STEPS = [
  "Loading the approved template…",
  "Pre-filling tenant defaults — window, frequency cap, sender header…",
  "Instantiating the journey nodes…",
  "Wiring channel steps & the fallback branch…",
  "Rendering the draft on the canvas…",
];
const A2_PLAN_STEPS = [
  "Reading your brief…",
  "Resolving tenant registries — segments, templates, senders…",
  "Selecting channels & the send sequence…",
  "Wiring the fallback branch with real IDs…",
  "Rendering the draft on the canvas…",
];

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
  seedName,
  seedDescription,
  seedObjective,
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
  const [validationChecks, setValidationChecks] = useState<ValidationCheck[]>([]);
  const [buildStepIdx, setBuildStepIdx] = useState(0);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [briefText, setBriefText] = useState("");
  const [briefConfig, setBriefConfig] = useState<BriefConfig | null>(null);

  const seedText = useMemo(
    () => [seedName, seedObjective, seedDescription].filter(Boolean).join(" · "),
    [seedName, seedObjective, seedDescription],
  );
  const suggestedTemplates = useMemo(() => suggestTemplates(seedText), [seedText]);
  const planSteps = mode === "a1" ? A1_PLAN_STEPS : A2_PLAN_STEPS;

  // Refs to read fresh values inside timeouts.
  const pendingPlanRef = useRef<AskPiPlan | null>(null);
  const openVarsRef = useRef<TemplateVar[]>([]);
  const resolvedRef = useRef<Record<string, string>>({});
  const channelsRef = useRef<Channel[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const intentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { openVarsRef.current = openVars; }, [openVars]);
  useEffect(() => { resolvedRef.current = resolved; }, [resolved]);
  useEffect(() => { channelsRef.current = channels; }, [channels]);
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
    setValidationChecks([]);
    setBuildStepIdx(0);
    setChannels([]);
    setBriefText("");
    setBriefConfig(null);
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
    setChannels(tpl.channels);
    setWarnMessages([]);
    setResolved({});
    pendingPlanRef.current = tpl.build({});
    pushPi(`Found "${tpl.name}" (${tpl.tenant}). ${tpl.objective}`);
    pushPi(`Tenant defaults pre-filled — not asked: ${tpl.assumptions.join(" · ")}.`);
    pushPi("Instantiating the approved journey on the canvas…");
    setPhase("planning");
  }

  /** A2 entry: confirm channels / priority / fallback before drafting. */
  function goToBriefConfirm(text: string) {
    const cfg = analyzeBrief(text);
    setMode("a2");
    setTemplate(null);
    setBrief(null);
    setBriefText(text);
    setBriefConfig(cfg);
    pushUser(text);
    pushPi("Before I draft this, let me confirm how it should run — the channels, which sends first, and any fallback.");
    setPhase("briefConfirm");
  }

  function startA2(text: string, cfg: BriefConfig) {
    const bp = planFromBrief(text, cfg);
    setMode("a2");
    setBrief(bp);
    setTemplate(null);
    setOpenVars(bp.gaps);
    setAssumptions(bp.assumptions);
    setChannels(bp.channels);
    setWarnMessages([]);
    setResolved({});
    pendingPlanRef.current = bp.plan;
    pushPi(`Got it — ${bp.objective}`);
    pushPi(`Channels: ${bp.channelsLine}.`);
    pushPi(`Assumptions: ${bp.assumptions.join(" · ")}.`);
    pushPi("Drafting the journey on the canvas with real IDs…");
    setPhase("planning");
  }

  function confirmBrief() {
    if (!briefConfig) return;
    const norm: BriefConfig = {
      ...briefConfig,
      channels: briefConfig.fallback ? [briefConfig.primary, briefConfig.fallback] : [briefConfig.primary],
    };
    startA2(briefText, norm);
  }

  function handleIntentSubmit() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const tpl = matchTemplate(text);
    if (tpl) startA1(tpl);
    else goToBriefConfirm(text);
  }

  /* ----------------------- brief-confirm edits ------------------- */

  function toggleChannel(ch: Channel) {
    setBriefConfig((cfg) => {
      if (!cfg) return cfg;
      let next = cfg.channels.includes(ch)
        ? cfg.channels.filter((c) => c !== ch)
        : [...cfg.channels, ch];
      if (next.length === 0) next = [ch];
      const primary = next.includes(cfg.primary) ? cfg.primary : next[0];
      const fallback =
        cfg.fallback && next.includes(cfg.fallback) && cfg.fallback !== primary
          ? cfg.fallback
          : (next.find((c) => c !== primary) ?? null);
      return { ...cfg, channels: next, primary, fallback };
    });
  }

  function setPrimaryChannel(ch: Channel) {
    setBriefConfig((cfg) => {
      if (!cfg) return cfg;
      const next = cfg.channels.includes(ch) ? cfg.channels : [...cfg.channels, ch];
      const fallback = cfg.fallback === ch ? null : cfg.fallback;
      return { ...cfg, channels: next, primary: ch, fallback };
    });
  }

  function setFallbackChannel(val: string) {
    setBriefConfig((cfg) => {
      if (!cfg) return cfg;
      if (val === "__none") return { ...cfg, fallback: null };
      const ch = val as Channel;
      const next = cfg.channels.includes(ch) ? cfg.channels : [...cfg.channels, ch];
      return { ...cfg, fallback: ch, channels: next };
    });
  }

  /* ------------------------- planning ---------------------------- */

  useEffect(() => {
    if (phase !== "planning") return;
    const p = pendingPlanRef.current;
    if (!p) return;
    onSkeleton(buildSkeleton(p));
    setBuildStepIdx(0);
    const tick = setInterval(
      () => setBuildStepIdx((i) => Math.min(i + 1, planSteps.length - 1)),
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
      const res = validateResolved(openVarsRef.current, resolvedRef.current, channelsRef.current);
      setValidationChecks(res.checks);
      if (res.level === "block") {
        const blocks = res.checks.filter((c) => c.status === "block");
        pushPi(`Validation failed — ${blocks.length} check${blocks.length === 1 ? "" : "s"} blocked the draft. Review the card below.`);
        setPhase("blocked");
        return;
      }
      const base = pendingPlanRef.current!;
      const patched = applyResolved(base, resolvedRef.current);
      pendingPlanRef.current = patched;
      onBuild(patched);
      const warns = res.checks.filter((c) => c.status === "warn").map((c) => c.detail);
      if (res.level === "warn") {
        setWarnMessages(warns);
        pushPi(`All ${res.checks.length} checks ran — ${warns.length} need explicit acceptance on the next step.`);
      } else {
        setWarnMessages([]);
        pushPi(`All ${res.checks.length} validation checks passed. Here's the final review.`);
      }
      setPhase("confirm");
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /* --------------------------- actions --------------------------- */

  const setField = (key: string, val: string) =>
    setResolved((r) => ({ ...r, [key]: val }));

  // Live pre-flight checks shown under the Resolve fields so the user sees
  // exactly what's still blocking before they hit "Validate & continue".
  const liveChecks = useMemo(
    () => (openVars.length ? runChecks(openVars, resolved, channels) : []),
    [openVars, resolved, channels],
  );
  const liveBlocks = useMemo(
    () => liveChecks.filter((c) => c.status === "block").length,
    [liveChecks],
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

  const samplePreviews = useMemo(
    () =>
      channels.map((ch) => ({
        ch,
        label: ch === "voice" ? "Voice opener" : `${CHANNEL_META[ch].label} message`,
        body: template?.samples?.[ch] ?? CHANNEL_SAMPLE[ch],
      })),
    [channels, template],
  );

  /* ----------------------------------------------------------------- */
  /* Render                                                            */
  /* ----------------------------------------------------------------- */

  const headerTitle =
    phase === "intent" ? "Ask Pi · Create a campaign"
      : phase === "briefConfirm" ? "Ask Pi · Confirm channels"
        : phase === "planning" ? "Pi is drafting your campaign"
          : phase === "resolve" ? "Ask Pi · Resolve open variables"
            : phase === "validating" ? "Validating…"
              : phase === "blocked" ? "Ask Pi · Validation failed"
                : phase === "confirm" ? "Ask Pi · Confirm draft"
                  : "Saved as draft v1";
  const headerSubtitle =
    phase === "intent" ? "Pick a suggested template or describe a campaign"
      : phase === "briefConfirm" ? "Channels, priority & fallback before I draft"
        : phase === "planning" ? planSteps[buildStepIdx]
          : phase === "resolve" ? "Only the open variables — pickers list approved IDs only"
            : phase === "validating" ? "Checking audience, channels, approvals & compliance"
              : phase === "blocked" ? "Fix the blocked checks, then re-validate"
                : phase === "confirm" ? "Review the sample messages and assumptions"
                  : "Review on canvas · launch separately";

  const PROGRESS: Record<ConversationPhase, number> = {
    intent: 8, briefConfirm: 22, planning: 35, resolve: 55, validating: 70, blocked: 70, confirm: 88, saved: 100,
  };

  return (
    <div className="flex max-h-[min(600px,75vh)] flex-col animate-fade-in">
      {/* Pinned: header + progress (stay visible while the body scrolls) */}
      <div className="shrink-0">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 pb-2 pt-3.5">
        <div className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md",
          phase === "blocked" ? "bg-destructive/10" : "bg-ai/10",
        )}>
          {phase === "planning" || phase === "validating"
            ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ai" />
            : phase === "saved"
              ? <Check className="h-3.5 w-3.5 text-success" />
              : phase === "blocked"
                ? <XCircle className="h-3.5 w-3.5 text-destructive" />
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
      </div>

      {/* Scrollable conversation body — fixed max height, internal scroll */}
      <div ref={logRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {/* Chat trace */}
        {messages.length > 0 && (
          <div className="space-y-2 px-5 pt-3">
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
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <FileText className="h-3.5 w-3.5 text-ai" />
            {seedText ? "Suggested for your campaign" : "Suggested templates"}
          </p>

          <div className="mt-2 space-y-2">
            {suggestedTemplates.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => startA1(tpl)}
                className="group flex w-full items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-all hover:border-ai/40 hover:bg-ai/[0.03]"
              >
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ai/10">
                  <Sparkles className="h-3.5 w-3.5 text-ai" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-medium text-foreground">{tpl.name}</span>
                    <span className="shrink-0 rounded-full bg-secondary px-1.5 py-px text-[9.5px] text-muted-foreground">{tpl.tenant}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{tpl.summary}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {tpl.channels.map((ch) => (
                      <span key={ch} className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-px text-[9.5px] text-muted-foreground">
                        <ChannelIcon ch={ch} className="h-2.5 w-2.5" /> {CHANNEL_META[ch].label}
                      </span>
                    ))}
                  </div>
                </div>
                <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-ai" />
              </button>
            ))}
          </div>

          <div className="mt-3.5 flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10.5px] text-muted-foreground">or describe your campaign</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="mt-2.5 flex items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2">
            <Wand2 className="mb-1.5 h-3.5 w-3.5 shrink-0 text-ai" />
            <textarea
              ref={intentRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleIntentSubmit(); }
              }}
              placeholder="e.g. Recover abandoned carts on WhatsApp with an SMS fallback"
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

      {/* Brief confirm — channels / priority / fallback */}
      {phase === "briefConfirm" && briefConfig && (
        <div className="px-5 pb-4 pt-3">
          <div className="rounded-2xl border border-ai/30 bg-ai/[0.03] p-3.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-ai/30 bg-ai/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ai">
              <Sparkles className="h-3 w-3" /> Confirm
            </span>

            {/* Channels */}
            <p className="mt-3 text-[11.5px] font-medium text-foreground">Channels to use</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {CHANNEL_ORDER.map((ch) => {
                const on = briefConfig.channels.includes(ch);
                return (
                  <button
                    key={ch}
                    onClick={() => toggleChannel(ch)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors",
                      on ? "border-ai/40 bg-ai/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <ChannelIcon ch={ch} className="h-3 w-3" /> {CHANNEL_META[ch].label}
                    {on && <Check className="h-3 w-3 text-ai" />}
                  </button>
                );
              })}
            </div>

            {/* Priority */}
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <div>
                <p className="mb-1 text-[11.5px] font-medium text-foreground">Sends first</p>
                <Select value={briefConfig.primary} onValueChange={(v) => setPrimaryChannel(v as Channel)}>
                  <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {briefConfig.channels.map((ch) => (
                      <SelectItem key={ch} value={ch} className="text-[12.5px]">{CHANNEL_META[ch].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="mb-1 text-[11.5px] font-medium text-foreground">Fallback</p>
                <Select value={briefConfig.fallback ?? "__none"} onValueChange={setFallbackChannel}>
                  <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none" className="text-[12.5px]">No fallback</SelectItem>
                    {CHANNEL_ORDER.filter((ch) => ch !== briefConfig.primary).map((ch) => (
                      <SelectItem key={ch} value={ch} className="text-[12.5px]">{CHANNEL_META[ch].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Fallback wait */}
            {briefConfig.fallback && (
              <div className="mt-3">
                <p className="mb-1 text-[11.5px] font-medium text-foreground">Fallback wait (after non-delivery)</p>
                <Input
                  value={briefConfig.fallbackWait}
                  onChange={(e) => setBriefConfig((cfg) => (cfg ? { ...cfg, fallbackWait: e.target.value } : cfg))}
                  placeholder="e.g. 6 hours"
                  className="h-8 text-[12.5px]"
                />
              </div>
            )}

            <p className="mt-3 text-[11px] text-muted-foreground">{channelsSummary(briefConfig)}.</p>

            <div className="mt-3.5 flex items-center justify-between gap-2">
              <button
                onClick={() => setPhase("intent")}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11.5px] text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-3 w-3" /> Back
              </button>
              <button
                onClick={confirmBrief}
                className="inline-flex items-center gap-1.5 rounded-md bg-ai px-3 py-1.5 text-[11.5px] font-medium text-ai-foreground hover:opacity-90"
              >
                Draft this <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Planning trace */}
      {phase === "planning" && (
        <div className="px-5 pb-4 pt-3">
          <ul className="space-y-1">
            {planSteps.map((s, i) => (
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

            {liveChecks.length > 0 && (
              <div className="mt-3.5">
                <ValidationChecklist checks={liveChecks} title="Pre-flight checks" />
              </div>
            )}

            <button
              onClick={() => setPhase("validating")}
              className="mt-3.5 flex w-full items-center justify-center gap-1.5 rounded-md bg-ai px-3 py-2 text-[12px] font-medium text-ai-foreground transition-all hover:opacity-90"
            >
              {liveBlocks > 0 ? "Run validation" : "Validate & continue"}
              <ArrowRight className="h-3.5 w-3.5" />
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

      {/* Validation-failed card — shown when one or more checks block the draft */}
      {phase === "blocked" && (
        <div className="px-5 pb-4 pt-3">
          <div className="rounded-2xl border border-destructive/40 bg-destructive/[0.04] p-3.5">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-destructive">
                <XCircle className="h-3 w-3" /> Validation failed
              </span>
              <span className="text-[11px] text-muted-foreground">
                {validationChecks.filter((c) => c.status === "block").length} check
                {validationChecks.filter((c) => c.status === "block").length === 1 ? "" : "s"} need fixing
              </span>
            </div>

            <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">
              The draft can&rsquo;t move to confirmation until these are resolved. Fix the flagged items, then re-validate.
            </p>

            {validationChecks.length > 0 && (
              <div className="mt-3">
                <ValidationChecklist checks={validationChecks} title="Validation results" />
              </div>
            )}

            <button
              onClick={() => setPhase("resolve")}
              className="mt-3.5 flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-[12px] font-medium text-background transition-all hover:opacity-90"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Back to fix &amp; re-validate
            </button>
          </div>
        </div>
      )}

      {/* Confirm card */}
      {phase === "confirm" && (
        <div className="px-5 pb-4 pt-3">
          <div className="space-y-2.5">
            {samplePreviews.map((s) => (
              <SamplePreview key={s.ch} icon={<ChannelIcon ch={s.ch} />} label={s.label} body={s.body} />
            ))}

            {validationChecks.length > 0 && (
              <ValidationChecklist checks={validationChecks} title="Validation checks" />
            )}

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
              <div className="flex items-start gap-1.5 rounded-xl border border-warning/40 bg-warning/5 px-3 py-2.5 text-[12px] text-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <span>
                  {warnMessages.length} warning{warnMessages.length === 1 ? "" : "s"} above — &ldquo;Accept &amp; confirm&rdquo; saves the draft anyway; it won&rsquo;t launch until resolved.
                </span>
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

/** Granular pre-flight validation checklist shown on the Resolve + Confirm cards. */
function ValidationChecklist({ checks, title }: { checks: ValidationCheck[]; title: string }) {
  const blocks = checks.filter((c) => c.status === "block").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const passes = checks.length - blocks - warns;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-ai" /> {title}
        </p>
        <span className="flex shrink-0 items-center gap-2 text-[10px] font-medium">
          <span className="text-success">{passes} pass</span>
          {warns > 0 && <span className="text-warning">{warns} warn</span>}
          {blocks > 0 && <span className="text-destructive">{blocks} blocked</span>}
        </span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {checks.map((c) => (
          <li key={c.id} className="flex items-start gap-1.5 text-[12px] leading-relaxed">
            {c.status === "pass" ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            ) : c.status === "warn" ? (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            ) : (
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            )}
            <span className="min-w-0">
              <span className="font-medium text-foreground">{c.label}</span>
              <span className="text-muted-foreground"> — {c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChannelIcon({ ch, className = "h-3.5 w-3.5 text-ai" }: { ch: Channel; className?: string }) {
  if (ch === "voice") return <Phone className={className} />;
  return <MessageSquare className={className} />;
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
