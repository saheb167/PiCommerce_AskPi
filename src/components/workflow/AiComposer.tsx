import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, Loader2, Sparkle, Sparkles, X } from "lucide-react";
import { useCopilotChat } from "@copilotkit/react-core";
import { Role, TextMessage } from "@copilotkit/runtime-client-gql";
import { cn } from "@/lib/utils";
import type { AskPiPlan } from "./AskPiWizard";
import { AskPiConversation, type ConversationPhase } from "./AskPiConversation";

type State = "collapsed" | "idle" | "typing" | "thinking" | "result" | "wizard";

const SUGGESTIONS = [
  "Add dormant trader reactivation",
  "Insert Voice AI after WhatsApp fail",
];

export type AiComposerProps = {
  /** "wizard" mode shows the campaign builder Q&A inside the expanded panel. */
  mode?: "chat" | "wizard";
  /** When set, collapsed pill shows nudge styling + label instead of the default sparkle. */
  nudge?: { label: string; active: boolean };
  /** Auto-open the wizard immediately on mount (used for brand-new campaigns). */
  autoOpenWizard?: boolean;
  onWizardSkeleton?: (skeleton: AskPiPlan) => void;
  onWizardBuild?: (plan: AskPiPlan) => void;
  onBuildingChange?: (building: boolean) => void;
  /** Fires when the conversation saves a versioned draft (e.g. "v1"). */
  onSavedDraft?: (version: string) => void;
  /** Seed campaign name/description/objective used to rank suggested templates. */
  seedName?: string;
  seedDescription?: string;
  seedObjective?: string;
};

export function AiComposer({
  mode = "chat",
  nudge,
  autoOpenWizard: _autoOpenWizard = false,
  onWizardSkeleton,
  onWizardBuild,
  onBuildingChange,
  onSavedDraft,
  seedName,
  seedDescription,
  seedObjective,
}: AiComposerProps = {}) {
  const [state, setState] = useState<State>("collapsed");
  const [value, setValue] = useState("");
  // Live chat round-trip to the CopilotKit runtime (Anthropic adapter, or the
  // deterministic offline fallback when no ANTHROPIC_API_KEY is set). The
  // provider is only mounted on /campaigns/new, which is the only place this
  // composer renders, so the hook is always inside a CopilotKit provider.
  // `useCopilotChat` is the open-source hook (no license key required);
  // `appendMessage`/`visibleMessages` are its supported send/read surface.
  const { appendMessage, visibleMessages } = useCopilotChat();
  // Latest assistant reply to surface in the result panel. `visibleMessages` can
  // be undefined before the chat context hydrates, so default it defensively.
  let replyText = "";
  const chatMessages = visibleMessages ?? [];
  for (let i = chatMessages.length - 1; i >= 0; i--) {
    const m = chatMessages[i];
    if (m.isTextMessage() && m.role === Role.Assistant && (m.content?.length ?? 0) > 0) {
      replyText = m.content;
      break;
    }
  }
  const [wizardPhase, setWizardPhase] = useState<ConversationPhase>("intent");
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const [hasEngaged, setHasEngaged] = useState(false);
  // The blank-canvas build wizard runs once. After it completes, Ask Pi becomes a chat composer.
  const [built, setBuilt] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state === "idle" || state === "typing") inputRef.current?.focus();
  }, [state]);

  useEffect(() => {
    if (value.length > 0 && state === "idle") setState("typing");
    if (value.length === 0 && state === "typing") setState("idle");
  }, [value, state]);

  // Notify parent of building lock — freeze the canvas only while Pi is
  // materializing or validating the draft (the interactive cards stay live).
  useEffect(() => {
    onBuildingChange?.(state === "wizard" && (wizardPhase === "planning" || wizardPhase === "validating"));
  }, [state, wizardPhase, onBuildingChange]);

  // Mark engaged + built once the draft is saved — nudge won't reappear, and
  // Ask Pi switches from the conversational builder to a persistent chat composer.
  useEffect(() => {
    if (wizardPhase === "saved") { setHasEngaged(true); setBuilt(true); }
  }, [wizardPhase]);

  // When the draft is saved, collapse Ask Pi back to its floating pill.
  // Clicking the pill reopens it as the persistent chat composer (built ⇒ no wizard).
  useEffect(() => {
    if (state === "wizard" && wizardPhase === "saved") {
      const t = setTimeout(() => setState("collapsed"), 1600);
      return () => clearTimeout(t);
    }
  }, [state, wizardPhase]);

  const submit = async (override?: string) => {
    const text = (override ?? value).trim();
    if (!text) return;
    setValue("");
    setState("thinking");
    try {
      await appendMessage(new TextMessage({ content: text, role: Role.User }));
    } catch {
      // Surface a graceful result even if the runtime round-trip fails.
    }
    setState("result");
  };

  const reset = () => {
    setValue("");
    setState("idle");
  };

  const collapse = () => {
    if (state === "wizard" && (wizardPhase === "planning" || wizardPhase === "validating")) return;
    setValue("");
    setState("collapsed");
  };

  // Wizard only runs for the first blank-canvas build (new campaigns, not yet built).
  // Otherwise Ask Pi opens straight into the chat text-input.
  const wizardAvailable = mode === "wizard" && !!nudge?.active && !built;

  const openPrimary = () => {
    setHasEngaged(true);
    setState(wizardAvailable ? "wizard" : "idle");
  };

  const isOpen = state !== "collapsed";
  const expandedTall = state === "thinking" || state === "result";
  const isWizard = state === "wizard";
  const showNudge = !!(nudge?.active && !isOpen && !nudgeDismissed && !hasEngaged);

  // Click-outside collapses, unless in wizard or user is typing.
  // Capture phase is required: the ReactFlow pane (d3-zoom) calls
  // stopImmediatePropagation() on mousedown, so a bubble-phase document
  // listener never fires when clicking the canvas. Capturing runs first.
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      if (state === "wizard") return;
      if (value.trim().length > 0) return;
      collapse();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, state, value]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center px-4">
      {/* Collapsed pill — original Google-Docs-style sparkle, with optional floating nudge bubble */}
      {!isOpen && (
        <div className="pointer-events-none relative flex flex-col items-center">
          {showNudge && (
            <div className="askpi-nudge-bubble pointer-events-auto relative mb-3 flex items-center gap-2 rounded-2xl border border-ai/30 bg-card px-3 py-2 text-[12.5px] font-medium text-foreground shadow-[0_10px_30px_-10px_color-mix(in_oklch,var(--ai)_45%,transparent)] animate-slide-up">
              <button
                onClick={openPrimary}
                className="flex items-center gap-2 pr-1 text-left"
                aria-label="Open Ask Pi to build campaign"
              >
                <Sparkles className="h-3.5 w-3.5 text-ai" />
                {nudge!.label}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setNudgeDismissed(true); }}
                className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Dismiss nudge"
              >
                <X className="h-3 w-3" />
              </button>
              {/* tail anchoring bubble to pill */}
              <span className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-ai/30 bg-card" />
              <style>{`
                @keyframes askPiNudgePulse {
                  0%, 100% { box-shadow: 0 10px 30px -12px color-mix(in oklch, var(--ai) 30%, transparent); }
                  50% { box-shadow: 0 14px 34px -10px color-mix(in oklch, var(--ai) 65%, transparent); }
                }
                .askpi-nudge-bubble { animation: askPiNudgePulse 2.4s ease-in-out infinite; }
                .askpi-nudge-bubble:hover { animation: none; }
              `}</style>
            </div>
          )}
          <button
            onClick={openPrimary}
            className="pointer-events-auto group flex h-9 w-24 items-center justify-center rounded-full border border-border bg-secondary text-foreground shadow-[0_4px_16px_-6px_rgba(0,0,0,0.15)] transition-all hover:w-28 hover:bg-accent animate-slide-up"
            aria-label="Open AI assistant"
          >
            <Sparkle className="h-3.5 w-3.5 fill-foreground" />
          </button>
        </div>
      )}

      {/* Expanded composer */}
      {isOpen && (
        <div
          ref={containerRef}
          className={cn(
            "pointer-events-auto overflow-hidden rounded-[28px] border border-border bg-card shadow-[0_12px_40px_-12px_rgba(0,0,0,0.22)] ring-4 ring-ai/5 transition-all duration-300 ease-out animate-slide-up",
            isWizard ? "w-[640px]" : expandedTall ? "w-[680px]" : "w-[680px]",
          )}
        >
          {/* Wizard mode body — conversational campaign builder */}
          {isWizard && (
            <div className="relative">
              {(wizardPhase === "intent" || wizardPhase === "briefConfirm" || wizardPhase === "resolve" || wizardPhase === "blocked" || wizardPhase === "confirm") && (
                <button
                  onClick={collapse}
                  className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Cancel"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <AskPiConversation
                active={isWizard}
                onSkeleton={(s) => onWizardSkeleton?.(s)}
                onBuild={(p) => onWizardBuild?.(p)}
                onPhaseChange={setWizardPhase}
                onSavedDraft={(v) => onSavedDraft?.(v)}
                seedName={seedName}
                seedDescription={seedDescription}
                seedObjective={seedObjective}
              />
            </div>
          )}

          {/* Chat mode — result / thinking surface */}
          {!isWizard && expandedTall && (
            <div className="border-b border-border px-5 py-4 animate-fade-in">
              {state === "thinking" ? <ThinkingTrace /> : <ResultPreview reply={replyText} onDismiss={reset} />}
            </div>
          )}

          {/* Chat mode — single-line input row with inline suggestions */}
          {!isWizard && (
            <div className="flex items-center gap-2 px-4 py-2.5">
              <Sparkle className="h-3.5 w-3.5 shrink-0 fill-ai text-ai" />
              <textarea
                ref={inputRef}
                rows={1}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                  if (e.key === "Escape" && !value) collapse();
                }}
                placeholder="Ask Pi anything…"
                className="scrollbar-thin max-h-32 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground/80 focus:outline-none"
              />

              {state === "idle" && value.length === 0 && (
                <div className="flex shrink-0 items-center gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setValue(s);
                        void submit(s);
                      }}
                      className="truncate rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-ai/40 hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={() => (state === "thinking" ? reset() : void submit())}
                disabled={!value.trim() && state !== "thinking"}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all",
                  value.trim() || state === "thinking"
                    ? "bg-foreground text-background hover:scale-[1.04]"
                    : "bg-muted text-muted-foreground/60",
                )}
                aria-label="Send"
              >
                {state === "thinking" ? (
                  <Square className="h-3 w-3 fill-current" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingTrace() {
  return (
    <div className="flex items-center gap-2 text-[12.5px] font-medium text-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-ai" />
      Pi is thinking…
    </div>
  );
}

function ResultPreview({ reply, onDismiss }: { reply: string; onDismiss: () => void }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-start gap-2">
        <Sparkle className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-ai text-ai" />
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
          {reply || "Pi didn't return a response. Try again."}
        </p>
      </div>
      <div className="flex items-center justify-end">
        <button onClick={onDismiss} className="rounded-md px-2.5 py-1 text-[11.5px] text-muted-foreground hover:text-foreground">
          Close
        </button>
      </div>
    </div>
  );
}
