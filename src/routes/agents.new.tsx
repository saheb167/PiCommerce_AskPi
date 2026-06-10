import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  ChevronRight,
  ChevronLeft,
  Check,
  Phone,
  MessageCircle,
  Bot,
  User,
  Rocket,
  Sparkles,
  AudioLines,
  Plus,
  X,
  Send,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/agents/new")({
  component: CreateAgent,
  head: () => ({
    meta: [
      { title: "Create agent · Pi Commerce Enterprise" },
      { name: "description", content: "Spin up a new voice or chat AI agent." },
    ],
  }),
});

/* --------------------------------------------------------- */
/* Types & data                                              */
/* --------------------------------------------------------- */

type AgentType = "chat" | "voice";
type StepId = "type" | "basics" | "voice" | "prompt" | "review" | "test";

type Draft = {
  type: AgentType | null;
  name: string;
  description: string;
  tones: string[];
  languages: string[];
  voiceId: string;
  speakingRate: number;
  allowInterruptions: boolean;
  greeting: string;
  mission: string;
  intents: string[];
  signals: string[];
  doText: string;
  dontText: string;
  escalateToHuman: boolean;
};

const TONES = ["Warm", "Concise", "Formal", "Playful"] as const;
const LANGUAGES = ["English", "Hindi", "Tamil", "Telugu", "Marathi"] as const;

const VOICES = [
  { id: "aria", name: "Aria", desc: "Warm female · English + Hindi", accent: "Neutral Indian" },
  { id: "kabir", name: "Kabir", desc: "Confident male · Hindi + English", accent: "North Indian" },
  { id: "maya", name: "Maya", desc: "Friendly female · English", accent: "Global" },
  { id: "veer", name: "Veer", desc: "Energetic male · Hindi", accent: "Mumbai" },
] as const;

const INITIAL: Draft = {
  type: null,
  name: "",
  description: "",
  tones: ["Warm", "Concise"],
  languages: ["English", "Hindi"],
  voiceId: "aria",
  speakingRate: 1,
  allowInterruptions: true,
  greeting: "Hi! I'm here to help — what brings you in today?",
  mission:
    "Understand why the customer reached out, resolve it accurately on the first contact, and route anything high-value to a human.",
  intents: [
    "Resolve a support issue",
    "Answer a pricing or plan question",
    "Reactivate a dormant account",
  ],
  signals: ["Reason for contact", "Account ID", "Sentiment"],
  doText:
    "• Acknowledge the user's intent before answering\n• Confirm the details you captured back to them\n• Keep answers short and actionable",
  dontText:
    "• Never make investment recommendations\n• Never mention competitor brands\n• Never promise specific outcomes",
  escalateToHuman: true,
};

/* --------------------------------------------------------- */
/* Step plan (voice step only appears for voice agents)      */
/* Testing is always the final step of the flow.             */
/* --------------------------------------------------------- */

const STEP_META: Record<StepId, { label: string; hint: string }> = {
  type: { label: "Agent type", hint: "Chat or voice" },
  basics: { label: "Basics", hint: "Name & personality" },
  voice: { label: "Voice", hint: "Pick a voice" },
  prompt: { label: "Prompt", hint: "Intents & guardrails" },
  review: { label: "Review", hint: "Confirm the setup" },
  test: { label: "Test & deploy", hint: "Try it, then go live" },
};

function stepsFor(type: AgentType | null): StepId[] {
  const base: StepId[] = ["type", "basics", "prompt", "review", "test"];
  if (type === "voice") base.splice(2, 0, "voice");
  return base;
}

/* --------------------------------------------------------- */
/* Wizard                                                    */
/* --------------------------------------------------------- */

function CreateAgent() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(INITIAL);
  const [idx, setIdx] = useState(0);

  const steps = useMemo(() => stepsFor(draft.type), [draft.type]);
  const current = steps[Math.min(idx, steps.length - 1)];
  const isLast = current === "test";

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const toggleIn = (key: "tones" | "languages", value: string) =>
    setDraft((d) => {
      const arr = d[key];
      return { ...d, [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] };
    });

  const addItem = (key: "intents" | "signals", value: string) =>
    setDraft((d) =>
      !value.trim() || d[key].includes(value.trim()) ? d : { ...d, [key]: [...d[key], value.trim()] },
    );

  const removeItem = (key: "intents" | "signals", value: string) =>
    setDraft((d) => ({ ...d, [key]: d[key].filter((v) => v !== value) }));

  const canAdvance = (): boolean => {
    if (current === "type") return draft.type !== null;
    if (current === "basics") return draft.name.trim().length > 1;
    if (current === "voice") return draft.voiceId !== "";
    return true;
  };

  const back = () => setIdx((i) => Math.max(0, i - 1));
  const next = () => {
    if (!canAdvance()) return;
    setIdx((i) => Math.min(steps.length - 1, i + 1));
  };

  const deploy = () => {
    toast.success(`${draft.name || "New agent"} deployed`, {
      description: `${draft.type === "voice" ? "Voice" : "Chat"} agent is live in the sandbox.`,
    });
    navigate({ to: "/agents" });
  };

  return (
    <AppShell bare>
      <div className="flex h-full flex-col">
        {/* Top bar — mirrors the agent detail builder header */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2 text-sm">
            <Link to="/agents" className="text-muted-foreground hover:text-foreground">Agents</Link>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="font-medium">{draft.name.trim() || "New agent"}</span>
            <span className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
              <span className="h-1.5 w-1.5 rounded-full bg-warning" /> Draft
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
              <Link to="/agents">Cancel</Link>
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={!draft.name.trim() || !draft.type}
              onClick={deploy}
            >
              <Rocket className="h-3.5 w-3.5" /> Deploy
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* Stepper rail */}
          <aside className="w-[212px] shrink-0 border-r border-border px-2 py-3">
            <p className="px-2 pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Create agent</p>
            <ul className="space-y-0.5">
              {steps.map((s, i) => {
                const active = i === idx;
                const done = i < idx;
                return (
                  <li key={s}>
                    <button
                      onClick={() => i <= idx && setIdx(i)}
                      disabled={i > idx}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                        active
                          ? "bg-accent font-medium text-foreground"
                          : done
                            ? "text-foreground hover:bg-accent/50"
                            : "cursor-default text-muted-foreground/60",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                          active
                            ? "border-foreground bg-foreground text-background"
                            : done
                              ? "border-success bg-success/10 text-success"
                              : "border-border text-muted-foreground",
                        )}
                      >
                        {done ? <Check className="h-3 w-3" /> : i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate leading-tight">{STEP_META[s].label}</span>
                        <span className="block truncate text-[10.5px] font-normal text-muted-foreground">{STEP_META[s].hint}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Form column — single, focused canvas (no side preview rail).
              my-auto vertically centres short steps; tall steps scroll from the top. */}
          <section className="flex flex-1 flex-col overflow-y-auto px-8 py-10">
            <div className="mx-auto my-auto w-full max-w-2xl space-y-5">
              {current === "type" && <TypeStep draft={draft} onPick={(t) => set("type", t)} />}
              {current === "basics" && <BasicsStep draft={draft} set={set} toggleIn={toggleIn} />}
              {current === "voice" && <VoiceStep draft={draft} set={set} />}
              {current === "prompt" && (
                <PromptStep draft={draft} set={set} addItem={addItem} removeItem={removeItem} />
              )}
              {current === "review" && <ReviewStep draft={draft} steps={steps} onJump={setIdx} />}
              {current === "test" && <TestStep draft={draft} />}
            </div>
          </section>
        </div>

        {/* Footer nav */}
        <footer className="flex h-14 shrink-0 items-center justify-between border-t border-border px-4">
          <button
            onClick={back}
            disabled={idx === 0}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12.5px]",
              idx === 0 ? "cursor-default text-muted-foreground/40" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Back
          </button>
          <p className="text-[11px] text-muted-foreground">
            Step {idx + 1} of {steps.length} · {STEP_META[current].label}
          </p>
          {isLast ? (
            <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={!draft.name.trim()} onClick={deploy}>
              <Rocket className="h-3.5 w-3.5" /> Deploy agent
            </Button>
          ) : (
            <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={!canAdvance()} onClick={next}>
              Continue <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </footer>
      </div>
    </AppShell>
  );
}

/* --------------------------------------------------------- */
/* Steps                                                     */
/* --------------------------------------------------------- */

function TypeStep({ draft, onPick }: { draft: Draft; onPick: (t: AgentType) => void }) {
  const cards = [
    {
      type: "chat" as const,
      icon: MessageCircle,
      title: "Chat agent",
      desc: "Text conversations across WhatsApp, web chat and in-app messaging.",
      tone: "success" as const,
      points: ["WhatsApp / web / in-app", "Rich cards & quick replies", "Best for support & onboarding"],
    },
    {
      type: "voice" as const,
      icon: Phone,
      title: "Voice agent",
      desc: "Natural phone conversations with a configurable synthetic voice.",
      tone: "ai" as const,
      points: ["Inbound & outbound calls", "Barge-in & live interruptions", "Best for reactivation & win-back"],
    },
  ];
  return (
    <>
      <SectionTitle title="What kind of agent?" desc="This shapes the rest of the setup. You can't change it later, so pick the channel this agent will live on." />
      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => {
          const selected = draft.type === c.type;
          const Icon = c.icon;
          return (
            <button
              key={c.type}
              onClick={() => onPick(c.type)}
              className={cn(
                "flex flex-col gap-3 rounded-xl border p-4 text-left transition-all",
                selected
                  ? c.tone === "ai"
                    ? "border-ai/60 ring-2 ring-ai/20"
                    : "border-success/60 ring-2 ring-success/20"
                  : "border-border hover:border-foreground/20 hover:shadow-[0_8px_24px_-12px_rgba(0,0,0,0.12)]",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-lg",
                    c.tone === "ai" ? "bg-ai/10 text-ai" : "bg-success/10 text-success",
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full border transition-all",
                    selected
                      ? c.tone === "ai"
                        ? "border-ai bg-ai text-ai-foreground"
                        : "border-success bg-success text-background"
                      : "border-border text-transparent",
                  )}
                >
                  <Check className="h-3.5 w-3.5" />
                </span>
              </div>
              <div>
                <h3 className="text-[15px] font-semibold">{c.title}</h3>
                <p className="mt-1 text-[12.5px] text-muted-foreground">{c.desc}</p>
              </div>
              <ul className="mt-1 space-y-1 border-t border-border pt-3">
                {c.points.map((p) => (
                  <li key={p} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <Check className={cn("h-3 w-3", c.tone === "ai" ? "text-ai" : "text-success")} /> {p}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>
    </>
  );
}

function BasicsStep({
  draft,
  set,
  toggleIn,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  toggleIn: (k: "tones" | "languages", v: string) => void;
}) {
  return (
    <>
      <SectionTitle title="Basics" desc="How the agent introduces itself and feels to customers." />
      <Field label="Agent name">
        <Input
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder={draft.type === "voice" ? "e.g. Reactivation Voice" : "e.g. Pi Concierge"}
          className="h-9"
        />
      </Field>
      <Field label="Persona description">
        <Textarea
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="A calm, knowledgeable concierge for Indian retail traders. Confident but never pushy."
          className="min-h-24 resize-none text-sm"
        />
      </Field>
      <Field label="Tone of voice">
        <div className="grid grid-cols-4 gap-2">
          {TONES.map((t) => {
            const on = draft.tones.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggleIn("tones", t)}
                className={cn(
                  "rounded-md border px-3 py-2 text-[12.5px] transition-colors",
                  on ? "border-foreground bg-accent font-medium" : "border-border text-muted-foreground hover:bg-accent/50",
                )}
              >
                {t}
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Languages">
        <div className="flex flex-wrap gap-1.5">
          {LANGUAGES.map((l) => {
            const on = draft.languages.includes(l);
            return (
              <button
                key={l}
                onClick={() => toggleIn("languages", l)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11.5px] transition-colors",
                  on ? "border-foreground bg-accent" : "border-border text-muted-foreground hover:bg-accent/50",
                )}
              >
                {l}
              </button>
            );
          })}
        </div>
      </Field>
    </>
  );
}

function VoiceStep({
  draft,
  set,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
}) {
  return (
    <>
      <SectionTitle title="Voice" desc="Choose the synthetic voice and how it speaks on calls." />
      <Field label="Voice">
        <div className="grid grid-cols-2 gap-2">
          {VOICES.map((v) => {
            const selected = draft.voiceId === v.id;
            return (
              <button
                key={v.id}
                onClick={() => set("voiceId", v.id)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all",
                  selected ? "border-ai/60 ring-2 ring-ai/20" : "border-border hover:border-ai/40",
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ai/10 text-ai">
                  <AudioLines className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{v.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{v.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Field>
      <Field label={`Speaking rate · ${draft.speakingRate.toFixed(2)}×`}>
        <Slider
          value={[draft.speakingRate]}
          min={0.75}
          max={1.5}
          step={0.05}
          onValueChange={([v]) => set("speakingRate", v)}
        />
        <div className="flex justify-between text-[10.5px] text-muted-foreground">
          <span>Slower</span>
          <span>Default</span>
          <span>Faster</span>
        </div>
      </Field>
      <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
        <div>
          <p className="text-[13px] font-medium">Allow interruptions (barge-in)</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Let callers cut in while the agent is speaking.</p>
        </div>
        <Switch checked={draft.allowInterruptions} onCheckedChange={(v) => set("allowInterruptions", v)} />
      </div>
    </>
  );
}

/* --------------------------------------------------------- */
/* Prompt configuration — intent-first, with a live          */
/* compiled system prompt artifact                           */
/* --------------------------------------------------------- */

function PromptStep({
  draft,
  set,
  addItem,
  removeItem,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  addItem: (k: "intents" | "signals", v: string) => void;
  removeItem: (k: "intents" | "signals", v: string) => void;
}) {
  return (
    <>
      <SectionTitle
        title="Prompt configuration"
        desc="Tell the agent what to accomplish and the intents it should capture. Everything here compiles into the system prompt shown below."
      />

      <Field label={draft.type === "voice" ? "Call opening" : "Greeting"}>
        <Input value={draft.greeting} onChange={(e) => set("greeting", e.target.value)} className="h-9" />
      </Field>

      <Field label="Primary objective">
        <Textarea
          value={draft.mission}
          onChange={(e) => set("mission", e.target.value)}
          placeholder="In one or two sentences, what must this agent achieve on every conversation?"
          className="min-h-20 resize-none text-sm"
        />
        <p className="text-[11px] text-muted-foreground">The single outcome the agent optimises for.</p>
      </Field>

      {/* Intents to capture */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5 text-ai" />
          <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Intents to capture</Label>
        </div>
        <p className="text-[11.5px] text-muted-foreground">
          The user goals this agent should recognise, classify and act on. Add the intents that matter for this channel.
        </p>
        <ChipEditor
          items={draft.intents}
          onAdd={(v) => addItem("intents", v)}
          onRemove={(v) => removeItem("intents", v)}
          placeholder="e.g. Reset KYC, Dispute a charge, Upgrade plan"
        />
      </div>

      {/* Signals to capture */}
      <div className="space-y-1.5">
        <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Signals to capture</Label>
        <p className="text-[11.5px] text-muted-foreground">
          Information the agent should extract from the conversation and log against the contact.
        </p>
        <ChipEditor
          items={draft.signals}
          onAdd={(v) => addItem("signals", v)}
          onRemove={(v) => removeItem("signals", v)}
          placeholder="e.g. Account ID, Reason for contact, Sentiment"
        />
      </div>

      <Field label="Always do">
        <Textarea value={draft.doText} onChange={(e) => set("doText", e.target.value)} className="min-h-24 resize-none text-sm" />
      </Field>
      <Field label="Never do">
        <Textarea value={draft.dontText} onChange={(e) => set("dontText", e.target.value)} className="min-h-24 resize-none text-sm" />
      </Field>

      <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
        <div>
          <p className="text-[13px] font-medium">Escalate to a human</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Route negative sentiment, high-value, or compliance intents to an operator.</p>
        </div>
        <Switch checked={draft.escalateToHuman} onCheckedChange={(v) => set("escalateToHuman", v)} />
      </div>

      <CompiledPrompt draft={draft} />
    </>
  );
}

function ChipEditor({
  items,
  onAdd,
  onRemove,
  placeholder,
}: {
  items: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  placeholder: string;
}) {
  const [val, setVal] = useState("");
  const commit = () => {
    if (!val.trim()) return;
    onAdd(val);
    setVal("");
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {items.length === 0 ? (
          <span className="text-[12px] text-muted-foreground">None yet — add one below.</span>
        ) : (
          items.map((it) => (
            <span
              key={it}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-accent/40 px-2.5 py-1 text-[12px]"
            >
              {it}
              <button
                type="button"
                onClick={() => onRemove(it)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${it}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={placeholder}
          className="h-9"
        />
        <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 gap-1 text-xs" onClick={commit}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
    </div>
  );
}

function buildPrompt(draft: Draft): string {
  const name = draft.name.trim() || "an AI agent";
  const type = draft.type ?? "chat";
  const parts: string[] = [];
  parts.push(`You are ${name}, a ${type} agent for Pi Commerce.`);
  if (draft.description.trim()) parts.push(`Persona: ${draft.description.trim()}`);
  parts.push(`Tone: ${draft.tones.join(", ") || "neutral"}. Languages: ${draft.languages.join(", ") || "English"}.`);

  parts.push("", "OBJECTIVE", draft.mission.trim() || "Help the customer and capture their intent.");

  if (draft.intents.length) {
    parts.push("", "RECOGNISE & ACT ON THESE INTENTS");
    draft.intents.forEach((i) => parts.push(`- ${i}`));
  }
  if (draft.signals.length) {
    parts.push("", "CAPTURE THESE SIGNALS EVERY CONVERSATION");
    draft.signals.forEach((s) => parts.push(`- ${s}`));
  }
  if (draft.doText.trim()) parts.push("", "ALWAYS", draft.doText.trim());
  if (draft.dontText.trim()) parts.push("", "NEVER", draft.dontText.trim());
  if (draft.escalateToHuman) {
    parts.push(
      "",
      "Escalate to a human when an intent involves negative sentiment, a high-value account, or a compliance matter.",
    );
  }
  parts.push("", `Open with: "${draft.greeting.trim()}"`);
  return parts.join("\n");
}

function CompiledPrompt({ draft }: { draft: Draft }) {
  const text = useMemo(() => buildPrompt(draft), [draft]);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-secondary/30">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles className="h-3.5 w-3.5 text-ai" />
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Compiled system prompt</p>
        <span className="ml-auto text-[10.5px] text-muted-foreground">auto-generated</span>
      </div>
      <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap px-3 py-3 font-mono text-[12px] leading-relaxed text-foreground/90">
        {text}
      </pre>
    </div>
  );
}

function ReviewStep({
  draft,
  steps,
  onJump,
}: {
  draft: Draft;
  steps: StepId[];
  onJump: (i: number) => void;
}) {
  const jumpTo = (s: StepId) => {
    const i = steps.indexOf(s);
    if (i >= 0) onJump(i);
  };
  return (
    <>
      <SectionTitle title="Review" desc="Confirm the configuration. The next step lets you test it before going live." />

      <SummaryCard title="Agent type" onEdit={() => jumpTo("type")}>
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium capitalize">
          {draft.type === "voice" ? <Phone className="h-3.5 w-3.5 text-ai" /> : <MessageCircle className="h-3.5 w-3.5 text-success" />}
          {draft.type ?? "—"} agent
        </span>
      </SummaryCard>

      <SummaryCard title="Basics" onEdit={() => jumpTo("basics")}>
        <Row k="Name" v={draft.name.trim() || "—"} />
        <Row k="Tone" v={draft.tones.join(", ") || "—"} />
        <Row k="Languages" v={draft.languages.join(", ") || "—"} />
        {draft.description.trim() && <Row k="Persona" v={draft.description.trim()} />}
      </SummaryCard>

      {draft.type === "voice" && (
        <SummaryCard title="Voice" onEdit={() => jumpTo("voice")}>
          <Row k="Voice" v={VOICES.find((v) => v.id === draft.voiceId)?.name ?? "—"} />
          <Row k="Speaking rate" v={`${draft.speakingRate.toFixed(2)}×`} />
          <Row k="Barge-in" v={draft.allowInterruptions ? "Enabled" : "Off"} />
        </SummaryCard>
      )}

      <SummaryCard title="Prompt configuration" onEdit={() => jumpTo("prompt")}>
        <Row k={draft.type === "voice" ? "Opening" : "Greeting"} v={draft.greeting} />
        <Row k="Objective" v={draft.mission} />
        <Row k="Intents" v={draft.intents.join(", ") || "None"} />
        <Row k="Signals" v={draft.signals.join(", ") || "None"} />
        <Row k="Human escalation" v={draft.escalateToHuman ? "On" : "Off"} />
      </SummaryCard>
    </>
  );
}

/* --------------------------------------------------------- */
/* Test step — the only place the playground appears         */
/* --------------------------------------------------------- */

function TestStep({ draft }: { draft: Draft }) {
  return (
    <>
      <SectionTitle
        title="Test & deploy"
        desc="Try the agent in the sandbox. When it behaves the way you want, deploy it from the button below."
      />
      <TestConsole draft={draft} />
      <div className="flex items-start gap-2 rounded-lg border border-ai/30 bg-ai/[0.04] px-3 py-2.5 text-[12px] text-muted-foreground">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ai" />
        Deploying creates a draft and pushes it to the sandbox. It won't reach production users until you publish from the builder.
      </div>
    </>
  );
}

function TestConsole({ draft }: { draft: Draft }) {
  const [mode, setMode] = useState<AgentType>(draft.type ?? "chat");
  const [msgs, setMsgs] = useState<{ who: "user" | "bot"; text: string }[]>(() => [
    { who: "bot", text: draft.greeting.trim() || "Hi! How can I help?" },
  ]);
  const [input, setInput] = useState("");

  const send = () => {
    const text = input.trim();
    if (!text) return;
    const intent = draft.intents[0] ?? "your request";
    const signal = draft.signals[0];
    const reply =
      `Thanks — I've classified this as "${intent}"` +
      (signal ? ` and captured ${signal.toLowerCase()}.` : ".") +
      (draft.escalateToHuman ? " If it turns high-value, I'll bring in a human." : " Let me resolve it for you.");
    setMsgs((m) => [...m, { who: "user", text }, { who: "bot", text: reply }]);
    setInput("");
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Sandbox</p>
          <h3 className="text-sm font-semibold">Test playground</h3>
        </div>
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5 text-[11px]">
          {(["chat", "voice"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn("rounded px-2 py-1 capitalize", mode === m ? "bg-accent font-medium" : "text-muted-foreground")}
            >
              {m === "voice" ? (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3 w-3" /> Voice
                </span>
              ) : (
                "Chat"
              )}
            </button>
          ))}
        </div>
      </div>

      {mode === "chat" ? (
        <>
          <div className="h-[300px] space-y-3 overflow-y-auto p-4">
            {msgs.map((m, i) => (
              <Msg key={i} who={m.who} text={m.text} />
            ))}
          </div>
          <div className="border-t border-border p-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    send();
                  }
                }}
                className="flex-1 bg-transparent text-[13px] focus:outline-none"
                placeholder="Reply as a test user…"
              />
              <button
                onClick={send}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background"
                aria-label="Send"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-2 text-[10.5px] text-muted-foreground">Sandbox · won't affect production users</p>
          </div>
        </>
      ) : (
        <div className="flex h-[360px] flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ai/10 text-ai">
            <Phone className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium">{VOICES.find((v) => v.id === draft.voiceId)?.name ?? "Call"} · sandbox call</p>
          <p className="text-[12px] text-muted-foreground">Dial a sandbox number to talk to the agent live.</p>
          <Button
            size="sm"
            className="mt-1 h-8 gap-1.5 text-xs"
            onClick={() => toast.success("Sandbox call started", { description: "Connecting you to the agent…" })}
          >
            <Phone className="h-3 w-3" /> Start test call
          </Button>
        </div>
      )}
    </div>
  );
}

function Msg({ who, text }: { who: "user" | "bot"; text: string }) {
  const isUser = who === "user";
  return (
    <div className={cn("flex items-start gap-2", isUser && "flex-row-reverse")}>
      <div className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", isUser ? "bg-foreground text-background" : "bg-ai/10 text-ai")}>
        {isUser ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
      </div>
      <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed", isUser ? "bg-foreground text-background" : "border border-border bg-background")}>
        {text}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- */
/* Shared bits                                               */
/* --------------------------------------------------------- */

function SectionTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="border-b border-border pb-3">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground">{desc}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function SummaryCard({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <button onClick={onEdit} className="text-[11.5px] text-muted-foreground hover:text-foreground hover:underline">Edit</button>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 text-[12.5px]">
      <span className="w-28 shrink-0 text-muted-foreground">{k}</span>
      <span className="min-w-0 flex-1 text-foreground">{v}</span>
    </div>
  );
}
