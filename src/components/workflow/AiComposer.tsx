import { useEffect, useRef, useState } from "react";
import { Sparkle, Sparkles, X } from "lucide-react";
import { CopilotChat } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { cn } from "@/lib/utils";
import type { AskPiPlan } from "./AskPiWizard";
import { AskPiConversation, type ConversationPhase } from "./AskPiConversation";
import { useCampaignAgentActions } from "./useCampaignAgentActions";

type State = "collapsed" | "idle" | "wizard";

/** System guidance for the live agent driving the A1 template flow. */
const AGENT_INSTRUCTIONS = [
  "You are Pi, the campaign-creation copilot for a marketing platform.",
  "To create a campaign FROM A TEMPLATE, orchestrate these frontend actions in order:",
  "1) listCampaignTemplates (optionally pass the user's goal) and help them pick one.",
  "2) instantiateCampaignTemplate with the chosen id — this renders the draft on the canvas and returns the open variables + tenant-default assumptions.",
  "3) resolveCampaign — shows the single Resolve card so the user fills the open variables.",
  "4) validateCampaign — the deterministic compliance gate. If it returns level 'block', call resolveCampaign again. If 'warn', keep the warning text to pass along.",
  "5) confirmCampaign (pass the warning, if any) — shows sample messages + assumptions and saves the draft as a version. Do NOT launch.",
  "Never invent ids — only use ids returned by the list actions. Keep chat replies short; let the cards carry the detail.",
].join(" ");

export type AiComposerProps = {
  /** "wizard" mode shows the deterministic campaign builder Q&A in the expanded panel. */
  mode?: "chat" | "wizard";
  /** When set, collapsed pill shows nudge styling + label instead of the default sparkle. */
  nudge?: { label: string; active: boolean };
  /** Auto-open the wizard immediately on mount (used for brand-new campaigns). */
  autoOpenWizard?: boolean;
  onWizardSkeleton?: (skeleton: AskPiPlan) => void;
  onWizardBuild?: (plan: AskPiPlan) => void;
  onBuildingChange?: (building: boolean) => void;
  /** Fires when the conversation (or agent) saves a versioned draft (e.g. "v1"). */
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
  // Register the A1 template frontend actions on the surrounding CopilotKit
  // provider (mounted only on /campaigns/new, so this hook is always inside it).
  // The agent calls these to instantiate → resolve → validate → confirm, and the
  // canvas updates via the same onWizardBuild callback the deterministic wizard uses.
  useCampaignAgentActions({
    onSkeleton: onWizardSkeleton,
    onBuild: onWizardBuild,
    onSavedDraft,
  });

  const [wizardPhase, setWizardPhase] = useState<ConversationPhase>("intent");
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const [hasEngaged, setHasEngaged] = useState(false);
  // The blank-canvas build wizard runs once. After it completes, Ask Pi becomes
  // the persistent agent chat composer.
  const [built, setBuilt] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Notify parent of building lock — freeze the canvas only while the
  // deterministic wizard is materializing or validating the draft.
  useEffect(() => {
    onBuildingChange?.(state === "wizard" && (wizardPhase === "planning" || wizardPhase === "validating"));
  }, [state, wizardPhase, onBuildingChange]);

  // Mark engaged + built once the draft is saved — nudge won't reappear, and
  // Ask Pi switches from the conversational builder to the agent chat composer.
  useEffect(() => {
    if (wizardPhase === "saved") { setHasEngaged(true); setBuilt(true); }
  }, [wizardPhase]);

  // When the draft is saved, collapse Ask Pi back to its floating pill.
  useEffect(() => {
    if (state === "wizard" && wizardPhase === "saved") {
      const t = setTimeout(() => setState("collapsed"), 1600);
      return () => clearTimeout(t);
    }
  }, [state, wizardPhase]);

  const collapse = () => {
    if (state === "wizard" && (wizardPhase === "planning" || wizardPhase === "validating")) return;
    setState("collapsed");
  };

  // Wizard only runs for the first blank-canvas build (new campaigns, not yet built).
  // Otherwise Ask Pi opens straight into the agent chat.
  const wizardAvailable = mode === "wizard" && !!nudge?.active && !built;

  const openPrimary = () => {
    setHasEngaged(true);
    setState(wizardAvailable ? "wizard" : "idle");
  };

  const isOpen = state !== "collapsed";
  const isWizard = state === "wizard";
  const showNudge = !!(nudge?.active && !isOpen && !nudgeDismissed && !hasEngaged);

  // Click-outside collapses, unless in the wizard (the wizard owns its own close).
  // Capture phase is required: the ReactFlow pane (d3-zoom) calls
  // stopImmediatePropagation() on mousedown, so a bubble-phase document listener
  // never fires when clicking the canvas. Capturing runs first.
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      if (state === "wizard") return;
      collapse();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, state]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center px-4">
      {/* Collapsed pill — sparkle, with optional floating nudge bubble */}
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
            isWizard ? "w-[640px]" : "w-[680px]",
          )}
        >
          {/* Wizard mode body — deterministic conversational campaign builder */}
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

          {/* Chat mode — the live agent (Anthropic via CopilotKit runtime). The
              agent drives the A1 template flow and renders the Resolve / Confirm
              HITL cards inline as generative UI. */}
          {!isWizard && (
            <div className="relative flex h-[460px] flex-col">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
                  <Sparkle className="h-3.5 w-3.5 fill-ai text-ai" /> Ask Pi
                </span>
                <button
                  onClick={collapse}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="askpi-chat min-h-0 flex-1">
                <CopilotChat
                  instructions={AGENT_INSTRUCTIONS}
                  className="h-full"
                  labels={{
                    title: "Ask Pi",
                    initial: "Tell me which campaign template to start from, or describe your goal.",
                    placeholder: "e.g. Start from pre_due_emi_reminder_v3",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
