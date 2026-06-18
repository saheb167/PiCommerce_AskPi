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
/* Channels — the building blocks for templates and briefs          */
/* ---------------------------------------------------------------- */

export type Channel = "whatsapp" | "sms" | "voice";

/**
 * The channels / priority / fallback details Pi confirms before drafting an
 * A2 brief (and that back a multi-channel A1 template). `primary` sends first;
 * `fallback` (if any) sends after `fallbackWait` when the primary isn't delivered.
 */
export type BriefConfig = {
  channels: Channel[];
  primary: Channel;
  fallback: Channel | null;
  fallbackWait: string;
};

export const CHANNEL_META: Record<
  Channel,
  { label: string; resourceKind: TemplateVar["kind"]; resourceKey: string; resourceLabel: string }
> = {
  whatsapp: { label: "WhatsApp", resourceKind: "waTemplate", resourceKey: "waTemplate", resourceLabel: "Approved WhatsApp template" },
  sms: { label: "SMS", resourceKind: "smsSender", resourceKey: "smsSender", resourceLabel: "SMS sender header" },
  voice: { label: "Voice", resourceKind: "voiceAgent", resourceKey: "voiceAgent", resourceLabel: "Voice agent" },
};

export const CHANNEL_SAMPLE: Record<Channel, string> = {
  whatsapp: "Hi {{1}}, you left items in your cart — complete your order here: {{2}}",
  sms: "Hi {{first_name}}, your cart is waiting. Finish checkout: {{link}}",
  voice: "\"Hi, this is calling about the items still in your cart — can I help you complete the order now?\"",
};

const channelGap = (ch: Channel): TemplateVar => {
  const m = CHANNEL_META[ch];
  return { key: m.resourceKey, kind: m.resourceKind, label: m.resourceLabel, required: true } as TemplateVar;
};

/** One journey node for a channel, configured from resolved values + tenant defaults. */
function channelNode(ch: Channel, y: number, resolved: Record<string, string>): Node<WorkflowNodeData> {
  if (ch === "whatsapp") {
    const wa = findWaTemplate(resolved.waTemplate);
    return { id: "wa", type: "workflow", position: { x: 0, y },
      data: { kind: "whatsapp", title: "WhatsApp message",
        subtitle: wa ? `Template: ${wa.label}` : "Pick template",
        valid: !!wa, error: wa ? undefined : "Pick template",
        config: { waNumber: TENANT_DEFAULTS.waNumber, waMode: "template",
          waTemplate: wa ? `${wa.label} · ${wa.category}` : undefined,
          waVarMap: [{ v: "{{1}}", def: "contact.first_name" }, { v: "{{2}}", def: "payload.order_id" }] } } };
  }
  if (ch === "sms") {
    const sender = findSmsSender(resolved.smsSender);
    return { id: "sms", type: "workflow", position: { x: 0, y },
      data: { kind: "sms", title: "SMS",
        subtitle: sender ? `Sender: ${sender.senderId}` : "Add sender",
        valid: !!sender, error: sender ? undefined : "Select sender",
        config: { smsType: "Promotional", smsFormat: "Text",
          senderId: sender?.senderId, peId: sender?.peId,
          smsBody: "Hi {{first_name}}, complete your order: {{link}}" } } };
  }
  const agent = findVoiceAgent(resolved.voiceAgent);
  return { id: "voice", type: "workflow", position: { x: 0, y },
    data: { kind: "voiceCall", title: "Voice call",
      subtitle: agent ? `Agent: ${agent.name}` : "Select voice agent",
      valid: !!agent, error: agent ? undefined : "Select agent",
      config: { agent: agent?.name, callStart: TENANT_DEFAULTS.windowStart,
        callEnd: TENANT_DEFAULTS.windowEnd, timezone: TENANT_DEFAULTS.timezone,
        maxAttempts: 3, retryInterval: "1 hour",
        voiceVarMap: [{ v: "{{name}}", def: "contact.first_name" }] } } };
}

/**
 * Linear journey from a channel config: start → audience → primary →
 * (fallback ? wait → fallback) → end. Used by both A2 briefs and the
 * multi-channel A1 templates so node IDs/shape stay consistent for
 * applyResolved + applyRefinement (delay node patched in place).
 */
function buildFromChannels(name: string, cfg: BriefConfig, resolved: Record<string, string>): AskPiPlan {
  const seg = findSegment(resolved.segment);
  const nodes: Node<WorkflowNodeData>[] = [
    { id: "start", type: "workflow", position: { x: 0, y: 0 },
      data: { kind: "start", title: "Start", locked: true, valid: true } },
    { id: "audience", type: "workflow", position: { x: 0, y: 120 },
      data: { kind: "audience", title: "Audience",
        subtitle: seg ? `${seg.label} · ${seg.size}` : "Select segment",
        valid: !!seg, error: seg ? undefined : "Select segment",
        config: { audienceMode: "api", phoneField: "contact.phone" } } },
  ];
  let y = 240;
  nodes.push(channelNode(cfg.primary, y, resolved));
  y += 120;
  if (cfg.fallback) {
    const { value, unit } = parseDuration(resolved.fallbackWindow ?? cfg.fallbackWait);
    nodes.push({ id: "delay", type: "workflow", position: { x: 0, y },
      data: { kind: "delay", title: "Fallback wait", subtitle: `${value} ${unit}`, valid: true,
        config: { delayValue: value, delayUnit: unit } } });
    y += 120;
    nodes.push(channelNode(cfg.fallback, y, resolved));
    y += 120;
  }
  nodes.push({ id: "end", type: "workflow", position: { x: 0, y },
    data: { kind: "end", title: "End", locked: true, valid: true } });

  const ids = nodes.map((n) => n.id);
  const edges: Edge[] = ids.slice(1).map((id, i) => ({ id: `e_${ids[i]}_${id}`, source: ids[i], target: id }));
  return { nodes, edges, name };
}

/** Open variables implied by a channel config: segment + each channel's resource + fallback window. */
function channelOpenVars(cfg: BriefConfig): TemplateVar[] {
  const vars: TemplateVar[] = [
    { key: "segment", kind: "segment", label: "Audience segment", required: true },
  ];
  const seen = new Set<string>();
  for (const ch of cfg.channels) {
    const gap = channelGap(ch);
    if (seen.has(gap.key)) continue;
    seen.add(gap.key);
    vars.push(gap);
  }
  if (cfg.fallback) {
    vars.push({ key: "fallbackWindow", kind: "duration", label: "Fallback window", default: cfg.fallbackWait, required: false });
  }
  return vars;
}

/** Human-readable "Primary X → fallback Y (on non-delivery)" line. */
export function channelsSummary(cfg: BriefConfig): string {
  const p = CHANNEL_META[cfg.primary].label;
  if (cfg.fallback) return `Primary ${p} → fallback ${CHANNEL_META[cfg.fallback].label} (on non-delivery)`;
  return `Primary ${p} only`;
}

/* ---------------------------------------------------------------- */
/* A1 — Campaign templates (declarative open vars + builder)        */
/* ---------------------------------------------------------------- */

export type CampaignTemplate = {
  id: string;
  name: string;
  tenant: string;
  objective: string;
  /** One-line pitch shown on the suggestion card. */
  summary: string;
  /** Channels this template uses (priority order) — drives confirm previews. */
  channels: Channel[];
  /** Keywords used to rank this template against the campaign goal/description. */
  keywords: string[];
  /** Tenant defaults pre-filled (shown as assumptions, never asked). */
  assumptions: string[];
  openVars: TemplateVar[];
  build: (resolved: Record<string, string>) => AskPiPlan;
  /** Optional channel-specific sample copy for the Confirm card. */
  samples?: Partial<Record<Channel, string>>;
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

const tenantAssumptions = (): string[] => [
  `Sending window ${TENANT_DEFAULTS.windowStart}–${TENANT_DEFAULTS.windowEnd} ${TENANT_DEFAULTS.timezone}`,
  `Frequency cap ${TENANT_DEFAULTS.freqCap}`,
  `Sender header ${TENANT_DEFAULTS.waNumber}`,
];

const CART_CFG: BriefConfig = { channels: ["whatsapp", "sms"], primary: "whatsapp", fallback: "sms", fallbackWait: "6 hours" };
const DORMANT_CFG: BriefConfig = { channels: ["whatsapp", "voice"], primary: "whatsapp", fallback: "voice", fallbackWait: "1 day" };

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: "pre_due_emi_reminder_v3",
    name: "Pre-due EMI Reminder",
    tenant: "Suryoday SFB",
    objective: "Remind borrowers ahead of an upcoming EMI to reduce missed payments.",
    summary: "WhatsApp reminder before the due date, with a voice fallback for non-responders.",
    channels: ["whatsapp", "voice"],
    keywords: ["emi", "payment", "due", "loan", "reminder", "repayment", "collection", "installment", "instalment"],
    assumptions: tenantAssumptions(),
    openVars: [
      { key: "segment", kind: "segment", label: "Audience segment", required: true },
      { key: "waTemplate", kind: "waTemplate", label: "Approved WhatsApp template", required: true },
      { key: "voiceAgent", kind: "voiceAgent", label: "Voice agent", required: true },
      { key: "fallbackWindow", kind: "duration", label: "Fallback window", default: "1 day", required: true },
    ],
    build: emiTemplateBuild,
    samples: {
      whatsapp: "Hi {{1}}, your EMI of {{2}} is due soon. Tap to pay now and avoid late fees.",
      voice: "\"Hi, this is a quick reminder that your upcoming EMI is due in a few days — would you like to pay now?\"",
    },
  },
  {
    id: "abandoned_cart_recovery_v2",
    name: "Abandoned Cart Recovery",
    tenant: "StyleZen",
    objective: "Win back shoppers who left items in their cart with a WhatsApp nudge and SMS fallback.",
    summary: "WhatsApp recovery message, falling back to SMS if WhatsApp isn't delivered.",
    channels: ["whatsapp", "sms"],
    keywords: ["cart", "abandon", "checkout", "recover", "shop", "ecommerce", "purchase", "basket", "order"],
    assumptions: tenantAssumptions(),
    openVars: channelOpenVars(CART_CFG),
    build: (resolved) => buildFromChannels("Abandoned Cart Recovery", CART_CFG, resolved),
    samples: { whatsapp: CHANNEL_SAMPLE.whatsapp, sms: CHANNEL_SAMPLE.sms },
  },
  {
    id: "dormant_reactivation_v1",
    name: "Dormant Reactivation",
    tenant: "Pi Commerce",
    objective: "Re-engage customers inactive for 90+ days with WhatsApp and a voice win-back.",
    summary: "WhatsApp re-engagement, with a voice win-back call for high-value dormant users.",
    channels: ["whatsapp", "voice"],
    keywords: ["dormant", "inactive", "reactivat", "reactivation", "win back", "winback", "lapsed", "churn", "re-engage", "reengage"],
    assumptions: tenantAssumptions(),
    openVars: channelOpenVars(DORMANT_CFG),
    build: (resolved) => buildFromChannels("Dormant Reactivation", DORMANT_CFG, resolved),
    samples: {
      whatsapp: "Hi {{1}}, we've missed you! Here's {{2}} to welcome you back.",
      voice: CHANNEL_SAMPLE.voice,
    },
  },
];

/** Rank templates against a campaign description/goal (keyword overlap). */
export function suggestTemplates(text: string): CampaignTemplate[] {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return CAMPAIGN_TEMPLATES.slice();
  const scored = CAMPAIGN_TEMPLATES.map((c) => {
    let score = 0;
    for (const k of c.keywords) if (t.includes(k)) score += 2;
    if (t.includes(c.name.toLowerCase())) score += 3;
    if (t.includes(c.tenant.toLowerCase())) score += 1;
    return { c, score };
  });
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  return hits.length ? hits.map((s) => s.c) : CAMPAIGN_TEMPLATES.slice();
}

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
  channels: Channel[];
  assumptions: string[];
  gaps: TemplateVar[];
};

/** Derive a short campaign name from the brief text. */
export function briefName(text: string): string {
  const t = (text || "").toLowerCase();
  if (t.includes("cart") || t.includes("checkout") || t.includes("basket")) return "Abandoned Cart Recovery";
  if (t.includes("dormant") || t.includes("inactive") || t.includes("reactivat") || t.includes("win back") || t.includes("winback") || t.includes("lapsed")) return "Dormant Reactivation";
  if (t.includes("emi") || t.includes("payment") || t.includes("due") || t.includes("repayment")) return "Payment Reminder";
  if (t.includes("welcome") || t.includes("onboard")) return "Welcome Journey";
  return "New Campaign";
}

/**
 * Inspect a free-form brief and infer the channels / priority / fallback that
 * Pi will confirm with the user before drafting. Order of detection sets the
 * default priority; an explicit "fallback" mention overrides which is the fallback.
 */
export function analyzeBrief(text: string): BriefConfig {
  const t = (text || "").toLowerCase();
  const detected: Channel[] = [];
  if (/whats\s?app|\bwa\b/.test(t)) detected.push("whatsapp");
  if (/\bsms\b|text message|text msg/.test(t)) detected.push("sms");
  if (/voice|\bcall\b|calling|ivr|phone\b/.test(t)) detected.push("voice");
  if (detected.length === 0) detected.push("whatsapp");

  let primary = detected[0];
  let fallback: Channel | null = detected[1] ?? null;

  // Pin the fallback channel from explicit phrasing: prefer "<channel> fallback"
  // (channel right before the word), then "fallback to/on/via <channel>".
  const toChannel = (s: string): Channel => (/whats/.test(s) ? "whatsapp" : /sms/.test(s) ? "sms" : "voice");
  const fbMatch =
    t.match(/(whats\s?app|sms|voice|call)\s+fall\s?back/) ??
    t.match(/fall\s?back\s+(?:to|on|via|with|using)?\s*(whats\s?app|sms|voice|call)/);
  if (fbMatch && detected.length >= 2) {
    const fb = toChannel(fbMatch[1]);
    fallback = fb;
    primary = detected.find((c) => c !== fb) ?? primary;
  }

  const ordered = fallback ? [primary, fallback] : [primary];
  const fallbackWait = primary === "whatsapp" && fallback === "sms" ? "6 hours" : "1 day";
  return { channels: ordered, primary, fallback, fallbackWait };
}

/** Build a brief plan from confirmed channel config. Gaps surface in the Resolve card. */
export function planFromBrief(text: string, cfg: BriefConfig): BriefPlan {
  const name = briefName(text);
  const plan = buildFromChannels(name, cfg, {});
  const line = channelsSummary(cfg);
  const assumptions = [
    ...(cfg.fallback ? [`Fallback wait defaulted to ${durationLabel(cfg.fallbackWait)}`] : []),
    `Sending window ${TENANT_DEFAULTS.windowStart}–${TENANT_DEFAULTS.windowEnd} ${TENANT_DEFAULTS.timezone}`,
    `Frequency cap ${TENANT_DEFAULTS.freqCap}`,
  ];
  return {
    plan,
    objective: `${name} — ${line.toLowerCase()}.`,
    channelsLine: line,
    channels: cfg.channels,
    assumptions,
    gaps: channelOpenVars(cfg),
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
