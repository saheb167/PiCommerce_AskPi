/**
 * Tenant registry — the single source of real, selectable resources for the
 * Ask Pi conversational campaign builder (A1 templates, A2 briefs).
 *
 * Pickers in the Resolve card are bound to these arrays, so only real/approved
 * IDs can ever be chosen. In production these would be backend lookups; here
 * they are seeded with realistic values that mirror the rest of the app
 * (ConfigPanel options, agents.index voice agents, campaign-examples senders).
 */

import type { Edge, Node } from "reactflow";
import type { WorkflowNodeData } from "./campaign-types";
import type { AskPiPlan } from "@/components/workflow/AskPiWizard";

/* ---------------------------------------------------------------- */
/* Registry types + data                                            */
/* ---------------------------------------------------------------- */

export type ApprovalStatus = "approved" | "pending_reapproval";

export type Segment = { id: string; label: string; size: string };
export type WaTemplate = {
  id: string;
  label: string;
  category: "Marketing" | "Utility";
  status: ApprovalStatus;
  vars: string[];
};
export type SmsSender = { id: string; senderId: string; peId: string; label: string };
export type VoiceAgentRef = { id: string; name: string; type: "voice" | "chat"; status: string };
export type TenantDefaults = {
  windowStart: string;
  windowEnd: string;
  timezone: string;
  freqCap: string;
  waNumber: string;
};

export const SEGMENTS: Segment[] = [
  { id: "seg_emi_predue_3d", label: "EMI due in 3 days · Suryoday SFB", size: "8,210" },
  { id: "seg_emi_predue_7d", label: "EMI due in 7 days · Suryoday SFB", size: "14,905" },
  { id: "seg_cart_48h", label: "Abandoned cart · last 48h · StyleZen", size: "3,477" },
  { id: "seg_cart_7d", label: "Abandoned cart · last 7d · StyleZen", size: "11,260" },
  { id: "seg_dormant_90d", label: "Dormant traders · 90d", size: "26,540" },
];

export const WA_TEMPLATES: WaTemplate[] = [
  { id: "wa_emi_predue_v3", label: "emi_pre_due_reminder_v3", category: "Utility", status: "approved", vars: ["{{1}}", "{{2}}"] },
  { id: "wa_cart_recovery_v2", label: "cart_recovery_v2", category: "Marketing", status: "approved", vars: ["{{1}}", "{{2}}"] },
  { id: "wa_cart_recovery_v3", label: "cart_recovery_v3", category: "Marketing", status: "pending_reapproval", vars: ["{{1}}", "{{2}}"] },
  { id: "wa_reactivate_v3", label: "reactivate_v3", category: "Marketing", status: "approved", vars: ["{{1}}"] },
];

export const SMS_SENDERS: SmsSender[] = [
  { id: "sms_picomm", senderId: "PICOMM", peId: "1101234567890123456", label: "PICOMM · Promotional" },
  { id: "sms_styzen", senderId: "STYZEN", peId: "1107654321098765432", label: "STYZEN · Promotional" },
  { id: "sms_surday", senderId: "SURDAY", peId: "1109988776655443322", label: "SURDAY · Transactional" },
];

/** Voice agents mirror the live voice agents from agents.index.tsx (live only). */
export const VOICE_AGENTS: VoiceAgentRef[] = [
  { id: "a_voice_react", name: "Reactivation Voice", type: "voice", status: "live" },
  { id: "a_emi_voice", name: "EMI Reminder Voice", type: "voice", status: "live" },
  { id: "a_winback", name: "Win-back Voice", type: "voice", status: "live" },
];

export const TENANT_DEFAULTS: TenantDefaults = {
  windowStart: "10:00",
  windowEnd: "19:00",
  timezone: "Asia/Kolkata (IST)",
  freqCap: "2 / week",
  waNumber: "+91 98100 12345 · PiCommerce",
};

/* ---------------------------------------------------------------- */
/* Declared open variables                                          */
/* ---------------------------------------------------------------- */

export type TemplateVar =
  | { key: string; kind: "segment"; label: string; required?: boolean }
  | { key: string; kind: "waTemplate"; label: string; required?: boolean }
  | { key: string; kind: "voiceAgent"; label: string; required?: boolean }
  | { key: string; kind: "smsSender"; label: string; required?: boolean }
  | { key: string; kind: "duration"; label: string; default: string; required?: boolean };

/* ---------------------------------------------------------------- */
/* Lookup helpers                                                   */
/* ---------------------------------------------------------------- */

export const findSegment = (id?: string) => SEGMENTS.find((s) => s.id === id);
export const findWaTemplate = (id?: string) => WA_TEMPLATES.find((t) => t.id === id);
export const findSmsSender = (id?: string) => SMS_SENDERS.find((s) => s.id === id);
export const findVoiceAgent = (id?: string) => VOICE_AGENTS.find((a) => a.id === id);

/** Parse "6 hours" / "3h" / "1 day" → { value, unit }. Falls back to 6 Hours. */
export function parseDuration(raw: string): { value: number; unit: "Minutes" | "Hours" | "Days" } {
  const m = raw.trim().match(/(\d+)\s*(m|min|minute|h|hr|hour|d|day)/i);
  if (!m) return { value: 6, unit: "Hours" };
  const n = parseInt(m[1], 10);
  const u = m[2].toLowerCase();
  if (u.startsWith("m")) return { value: n, unit: "Minutes" };
  if (u.startsWith("d")) return { value: n, unit: "Days" };
  return { value: n, unit: "Hours" };
}

const durationLabel = (raw: string) => {
  const { value, unit } = parseDuration(raw);
  return `${value} ${unit}`;
};

/* ---------------------------------------------------------------- */
/* A1 — Campaign templates (declarative open vars + builder)        */
/* ---------------------------------------------------------------- */

export type CampaignTemplate = {
  id: string;
  name: string;
  tenant: string;
  objective: string;
  /** Tenant defaults pre-filled (shown as assumptions, never asked). */
  assumptions: string[];
  openVars: TemplateVar[];
  build: (resolved: Record<string, string>) => AskPiPlan;
};

function emiTemplateBuild(resolved: Record<string, string>): AskPiPlan {
  const seg = findSegment(resolved.segment);
  const wa = findWaTemplate(resolved.waTemplate);
  const agent = findVoiceAgent(resolved.voiceAgent);
  const fw = durationLabel(resolved.fallbackWindow ?? "1 day");

  const nodes: Node<WorkflowNodeData>[] = [
    { id: "start", type: "workflow", position: { x: 0, y: 0 },
      data: { kind: "start", title: "Start", locked: true, valid: true } },
    { id: "audience", type: "workflow", position: { x: 0, y: 120 },
      data: {
        kind: "audience", title: "Audience",
        subtitle: seg ? `${seg.label} · ${seg.size}` : "Select segment",
        valid: !!seg, error: seg ? undefined : "Select segment",
        config: { audienceMode: "api", phoneField: "contact.phone" },
      } },
    { id: "wa", type: "workflow", position: { x: 0, y: 240 },
      data: {
        kind: "whatsapp", title: "WhatsApp reminder",
        subtitle: wa ? `Template: ${wa.label}` : "Pick template",
        valid: !!wa, error: wa ? undefined : "Pick template",
        config: {
          waNumber: TENANT_DEFAULTS.waNumber, waMode: "template",
          waTemplate: wa ? `${wa.label} · ${wa.category}` : undefined,
          waVarMap: [{ v: "{{1}}", def: "contact.first_name" }, { v: "{{2}}", def: "payload.amount" }],
        },
      } },
    { id: "delay", type: "workflow", position: { x: 0, y: 360 },
      data: {
        kind: "delay", title: "Fallback wait", subtitle: fw, valid: true,
        config: { delayValue: parseDuration(resolved.fallbackWindow ?? "1 day").value,
                  delayUnit: parseDuration(resolved.fallbackWindow ?? "1 day").unit },
      } },
    { id: "voice", type: "workflow", position: { x: 0, y: 480 },
      data: {
        kind: "voiceCall", title: "Voice reminder",
        subtitle: agent ? `Agent: ${agent.name}` : "Select voice agent",
        valid: !!agent, error: agent ? undefined : "Select agent",
        config: {
          agent: agent?.name, callStart: TENANT_DEFAULTS.windowStart,
          callEnd: TENANT_DEFAULTS.windowEnd, timezone: TENANT_DEFAULTS.timezone,
          maxAttempts: 3, retryInterval: "1 hour",
          voiceVarMap: [{ v: "{{name}}", def: "contact.first_name" }],
        },
      } },
    { id: "end", type: "workflow", position: { x: 0, y: 600 },
      data: { kind: "end", title: "End", locked: true, valid: true } },
  ];
  const edges: Edge[] = [
    { id: "e_s_a", source: "start", target: "audience" },
    { id: "e_a_wa", source: "audience", target: "wa" },
    { id: "e_wa_d", source: "wa", target: "delay" },
    { id: "e_d_v", source: "delay", target: "voice" },
    { id: "e_v_e", source: "voice", target: "end" },
  ];
  return { nodes, edges, name: "Pre-due EMI Reminder" };
}

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: "pre_due_emi_reminder_v3",
    name: "Pre-due EMI Reminder",
    tenant: "Suryoday SFB",
    objective: "Remind borrowers ahead of an upcoming EMI to reduce missed payments.",
    assumptions: [
      `Sending window ${TENANT_DEFAULTS.windowStart}–${TENANT_DEFAULTS.windowEnd} ${TENANT_DEFAULTS.timezone}`,
      `Frequency cap ${TENANT_DEFAULTS.freqCap}`,
      `Sender header ${TENANT_DEFAULTS.waNumber}`,
    ],
    openVars: [
      { key: "segment", kind: "segment", label: "Audience segment", required: true },
      { key: "waTemplate", kind: "waTemplate", label: "Approved WhatsApp template", required: true },
      { key: "voiceAgent", kind: "voiceAgent", label: "Voice agent", required: true },
      { key: "fallbackWindow", kind: "duration", label: "Fallback window", default: "1 day", required: true },
    ],
    build: emiTemplateBuild,
  },
];

export function matchTemplate(text: string): CampaignTemplate | undefined {
  const t = text.toLowerCase();
  return CAMPAIGN_TEMPLATES.find(
    (c) => t.includes(c.id) || t.includes(c.id.replace(/_/g, " ")) || t.includes(c.name.toLowerCase()),
  );
}

/* ---------------------------------------------------------------- */
/* A2 — Brief → plan (keyword detection)                            */
/* ---------------------------------------------------------------- */

export type BriefPlan = {
  plan: AskPiPlan;
  objective: string;
  channelsLine: string;
  assumptions: string[];
  gaps: TemplateVar[];
};

/** Cart-recovery WhatsApp → (wait) → SMS fallback. Default brief shape. */
export function planFromBrief(_text: string): BriefPlan {
  const defaultWait = "6 hours";
  const { value, unit } = parseDuration(defaultWait);

  const nodes: Node<WorkflowNodeData>[] = [
    { id: "start", type: "workflow", position: { x: 0, y: 0 },
      data: { kind: "start", title: "Start", locked: true, valid: true } },
    { id: "audience", type: "workflow", position: { x: 0, y: 120 },
      data: { kind: "audience", title: "Audience", subtitle: "Select segment",
        valid: false, error: "Select segment",
        config: { audienceMode: "api", phoneField: "contact.phone" } } },
    { id: "wa", type: "workflow", position: { x: 0, y: 240 },
      data: { kind: "whatsapp", title: "WhatsApp recovery", subtitle: "Pick template",
        valid: false, error: "Pick template",
        config: { waNumber: TENANT_DEFAULTS.waNumber, waMode: "template",
          waVarMap: [{ v: "{{1}}", def: "contact.first_name" }, { v: "{{2}}", def: "payload.order_id" }] } } },
    { id: "delay", type: "workflow", position: { x: 0, y: 360 },
      data: { kind: "delay", title: "Fallback wait", subtitle: `${value} ${unit}`, valid: true,
        config: { delayValue: value, delayUnit: unit } } },
    { id: "sms", type: "workflow", position: { x: 0, y: 480 },
      data: { kind: "sms", title: "SMS fallback", subtitle: "Add sender", valid: false, error: "Select sender",
        config: { smsType: "Promotional", smsFormat: "Text",
          smsBody: "Hi {{first_name}}, your cart is waiting — complete your order: {{link}}" } } },
    { id: "end", type: "workflow", position: { x: 0, y: 600 },
      data: { kind: "end", title: "End", locked: true, valid: true } },
  ];
  const edges: Edge[] = [
    { id: "e_s_a", source: "start", target: "audience" },
    { id: "e_a_wa", source: "audience", target: "wa" },
    { id: "e_wa_d", source: "wa", target: "delay" },
    { id: "e_d_sms", source: "delay", target: "sms" },
    { id: "e_sms_e", source: "sms", target: "end" },
  ];

  return {
    plan: { nodes, edges, name: "Abandoned Cart Recovery" },
    objective: "Recover abandoned carts via WhatsApp, falling back to SMS when WhatsApp isn't delivered.",
    channelsLine: "Primary WhatsApp → fallback SMS (on non-delivery)",
    assumptions: [
      `Fallback wait defaulted to ${defaultWait}`,
      "Sending window 9:00–21:00 Asia/Kolkata (IST)",
    ],
    gaps: [
      { key: "segment", kind: "segment", label: "Audience segment", required: true },
      { key: "waTemplate", kind: "waTemplate", label: "Approved WhatsApp template", required: true },
      { key: "smsSender", kind: "smsSender", label: "SMS sender header", required: true },
      { key: "fallbackWindow", kind: "duration", label: "Confirm fallback window", default: defaultWait, required: false },
    ],
  };
}

/* ---------------------------------------------------------------- */
/* Apply resolved values + refinement patches to a plan             */
/* ---------------------------------------------------------------- */

/** Patch a plan's node configs/subtitles from resolved Resolve-card values. */
export function applyResolved(plan: AskPiPlan, resolved: Record<string, string>): AskPiPlan {
  const seg = findSegment(resolved.segment);
  const wa = findWaTemplate(resolved.waTemplate);
  const sender = findSmsSender(resolved.smsSender);
  const agent = findVoiceAgent(resolved.voiceAgent);
  const fw = resolved.fallbackWindow;

  const nodes = plan.nodes.map((n) => {
    const d = n.data;
    if (seg && d.kind === "audience") {
      return { ...n, data: { ...d, subtitle: `${seg.label} · ${seg.size}`, valid: true, error: undefined } };
    }
    if (wa && d.kind === "whatsapp") {
      return { ...n, data: { ...d, subtitle: `Template: ${wa.label}`, valid: true, error: undefined,
        config: { ...d.config, waTemplate: `${wa.label} · ${wa.category}` } } };
    }
    if (sender && d.kind === "sms") {
      return { ...n, data: { ...d, subtitle: `Sender: ${sender.senderId}`, valid: true, error: undefined,
        config: { ...d.config, senderId: sender.senderId, peId: sender.peId } } };
    }
    if (agent && d.kind === "voiceCall") {
      return { ...n, data: { ...d, subtitle: `Agent: ${agent.name}`, valid: true, error: undefined,
        config: { ...d.config, agent: agent.name } } };
    }
    if (fw && d.kind === "delay") {
      const { value, unit } = parseDuration(fw);
      return { ...n, data: { ...d, subtitle: `${value} ${unit}`,
        config: { ...d.config, delayValue: value, delayUnit: unit } } };
    }
    return n;
  });
  return { ...plan, nodes };
}

/**
 * A2 refinement: parse a chat instruction and patch a single node in place
 * (same node IDs — no rebuild). Returns the patched plan + a human echo, or
 * null when the instruction isn't understood.
 */
export function applyRefinement(text: string, plan: AskPiPlan): { plan: AskPiPlan; echo: string; duration: string } | null {
  const m = text.toLowerCase().match(/(wait|fallback|delay)[^\d]*(\d+)\s*(m|min|minute|h|hr|hour|d|day)/i);
  if (!m) return null;
  const { value, unit } = parseDuration(`${m[2]} ${m[3]}`);
  let changed = false;
  const nodes = plan.nodes.map((n) => {
    if (n.data.kind !== "delay") return n;
    changed = true;
    return { ...n, data: { ...n.data, subtitle: `${value} ${unit}`,
      config: { ...n.data.config, delayValue: value, delayUnit: unit } } };
  });
  if (!changed) return null;
  return { plan: { ...plan, nodes }, echo: `Updated the fallback wait to ${value} ${unit}.`, duration: `${value} ${unit}` };
}

/* ---------------------------------------------------------------- */
/* Validation                                                       */
/* ---------------------------------------------------------------- */

export type ValidationLevel = "pass" | "warn" | "block";
export type ValidationResult = { level: ValidationLevel; messages: string[] };

/** Validate resolved values against required gaps + registry approval states. */
export function validateResolved(vars: TemplateVar[], resolved: Record<string, string>): ValidationResult {
  const messages: string[] = [];
  let level: ValidationLevel = "pass";

  for (const v of vars) {
    if (v.required && !resolved[v.key]) {
      level = "block";
      messages.push(`${v.label} is required.`);
    }
  }
  if (level === "block") return { level, messages };

  const wa = findWaTemplate(resolved.waTemplate);
  if (wa?.status === "pending_reapproval") {
    level = "warn";
    messages.push(`WhatsApp template "${wa.label}" is pending re-approval — it can be saved but won't send until approved.`);
  }
  return { level, messages };
}
