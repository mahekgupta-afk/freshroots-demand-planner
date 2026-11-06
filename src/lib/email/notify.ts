import { formatWhen, monthName } from "@/lib/format";

export interface Message {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export type SendResult = { ok: true; id?: string } | { ok: false; error: string };

export interface EmailConfig {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** Split a comma/semicolon/space separated list, drop anything that is not an address, dedupe. */
export function parseEmails(raw: string | undefined): string[] {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(/[,;\s]+/)) {
    const e = part.trim().toLowerCase();
    if (EMAIL_RE.test(e)) out.add(e);
  }
  return [...out];
}

/** Send through Resend's HTTP API. Never throws: a broken email must not break a run. */
export async function sendEmail(msg: Message, cfg: EmailConfig): Promise<SendResult> {
  if (msg.to.length === 0) return { ok: false, error: "no recipients" };
  try {
    const res = await (cfg.fetchImpl ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ from: cfg.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok) return { ok: false, error: `Resend HTTP ${res.status}${json?.message ? `: ${json.message}` : ""}` };
    return { ok: true, id: json?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------- content

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const LABEL: Record<string, string> = {
  stockout: "Stockout",
  needs_review: "Needs review",
  high_demand: "High demand",
  overstock: "Overstock",
  on_track: "On track",
};
const ORDER = ["stockout", "needs_review", "high_demand", "overstock", "on_track"] as const;

export interface RunEmailData {
  startedAt: string;
  rulesVersion: string;
  planningMonth: number;
  total: number;
  counts: Record<string, number>;
  pendingReview: number;
  rulesShare: number;
  festival: boolean;
  /** Most urgent SKUs first, already trimmed to a handful. */
  urgent: { sku_id: string; name: string; status: string; qty: number | null }[];
  aiFailed: number;
  appUrl: string | null;
}

export function renderRunEmail(d: RunEmailData): Omit<Message, "to"> {
  const when = formatWhen(d.startedAt);
  const reviewLink = d.appUrl ? `${d.appUrl}/review` : null;
  const subject =
    d.pendingReview > 0
      ? `Demand plan ${when}: ${d.counts.stockout ?? 0} stockouts, ${d.pendingReview} to review`
      : `Demand plan ${when}: ${d.counts.stockout ?? 0} stockouts, nothing to review`;
  const qty = (q: number | null) => (q === null ? "no order" : q === 0 ? "pause" : `order ${q}`);

  const text = [
    `Demand plan run on ${when}`,
    `Rules ${d.rulesVersion} · ${d.total} SKUs · ${Math.round(d.rulesShare * 100)}% decided by rules`,
    d.festival ? `Festival month (${monthName(d.planningMonth)}): demand uplifted 25%.` : "",
    "",
    ...ORDER.map((s) => `${LABEL[s]}: ${d.counts[s] ?? 0}`),
    "",
    d.pendingReview > 0
      ? `${d.pendingReview} SKU(s) are waiting for review${reviewLink ? `: ${reviewLink}` : "."}`
      : "Nothing is waiting for review.",
    d.aiFailed > 0 ? `AI notes were unavailable for ${d.aiFailed} SKU(s); decide those from the numbers.` : "",
    ...(d.urgent.length ? ["", "Most urgent:", ...d.urgent.map((u) => `- ${u.sku_id} ${u.name} (${LABEL[u.status] ?? u.status}, ${qty(u.qty)})`)] : []),
    d.appUrl ? `\nOpen the planner: ${d.appUrl}` : "",
  ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n");

  const row = (s: string) =>
    `<tr><td style="padding:4px 16px 4px 0;color:#475569">${LABEL[s]}</td><td style="padding:4px 0;font-weight:600;text-align:right">${d.counts[s] ?? 0}</td></tr>`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;color:#0f172a">
<h2 style="margin:0 0 4px">Demand plan</h2>
<p style="margin:0 0 12px;color:#475569">Run on ${escapeHtml(when)} · rules ${escapeHtml(d.rulesVersion)} · ${d.total} SKUs · ${Math.round(d.rulesShare * 100)}% decided by rules</p>
${d.festival ? `<p style="background:#fff7ed;border:1px solid #fdba74;padding:8px 12px;border-radius:6px">Festival month (${escapeHtml(monthName(d.planningMonth))}): demand uplifted 25%.</p>` : ""}
<table style="border-collapse:collapse;margin:8px 0 16px">${ORDER.map(row).join("")}</table>
<p>${
    d.pendingReview > 0
      ? `<strong>${d.pendingReview} SKU${d.pendingReview === 1 ? " is" : "s are"} waiting for review.</strong>${reviewLink ? ` <a href="${escapeHtml(reviewLink)}">Open the review queue</a>` : ""}`
      : "Nothing is waiting for review."
  }</p>
${d.aiFailed > 0 ? `<p style="color:#475569">AI notes were unavailable for ${d.aiFailed} SKU${d.aiFailed === 1 ? "" : "s"}; decide those from the numbers.</p>` : ""}
${d.urgent.length ? `<p style="margin-bottom:4px"><strong>Most urgent</strong></p><ul style="margin-top:0">${d.urgent.map((u) => `<li>${escapeHtml(u.sku_id)} ${escapeHtml(u.name)} (${escapeHtml(LABEL[u.status] ?? u.status)}, ${escapeHtml(qty(u.qty))})</li>`).join("")}</ul>` : ""}
${d.appUrl ? `<p><a href="${escapeHtml(d.appUrl)}">Open the planner</a></p>` : ""}
</div>`;
  return { subject, html, text };
}

export interface FailureEmailData {
  startedAt: string;
  error: string;
  trigger: string;
  appUrl: string | null;
}

export function renderFailureEmail(d: FailureEmailData): Omit<Message, "to"> {
  const when = formatWhen(d.startedAt);
  const subject = `Demand plan run FAILED (${when})`;
  const text = [
    `The demand plan run on ${when} (${d.trigger}) failed and produced no new recommendations.`,
    "",
    `Error: ${d.error}`,
    "",
    "The dashboard still shows the previous successful run. Check the SAP export files first, then the Zoho connection.",
    d.appUrl ? `\n${d.appUrl}` : "",
  ].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;color:#0f172a">
<h2 style="margin:0 0 8px;color:#b91c1c">Demand plan run failed</h2>
<p>The run on ${escapeHtml(when)} (${escapeHtml(d.trigger)}) failed and produced no new recommendations.</p>
<pre style="background:#fef2f2;border:1px solid #fecaca;padding:10px 12px;border-radius:6px;white-space:pre-wrap">${escapeHtml(d.error)}</pre>
<p>The dashboard still shows the previous successful run. Check the SAP export files first, then the Zoho connection.</p>
${d.appUrl ? `<p><a href="${escapeHtml(d.appUrl)}">Open the planner</a></p>` : ""}
</div>`;
  return { subject, html, text };
}

// ---------------------------------------------------------------- wiring

export interface NotifyOutcome {
  sent: boolean;
  recipients: number;
  skipped?: string;
  error?: string;
}

export interface Notifier {
  run(data: RunEmailData): Promise<NotifyOutcome>;
  failure(data: FailureEmailData): Promise<NotifyOutcome>;
}

/** Notifier built from environment variables. Returns null (with the reason) when email is not configured. */
export function notifierFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): { notifier: Notifier | null; reason: string | null } {
  const apiKey = env.RESEND_API_KEY;
  const from = env.NOTIFY_FROM;
  const runTo = parseEmails(env.NOTIFY_EMAILS);
  if (!apiKey || !from) return { notifier: null, reason: "RESEND_API_KEY or NOTIFY_FROM is not set" };
  if (runTo.length === 0) return { notifier: null, reason: "NOTIFY_EMAILS has no valid addresses" };
  // Failure alerts go to the admin/IT list; fall back to the normal list so a failure is never silent.
  const alertTo = parseEmails(env.ALERT_EMAILS);
  const failTo = alertTo.length > 0 ? alertTo : runTo;
  const cfg: EmailConfig = { apiKey, from, fetchImpl };

  const deliver = async (to: string[], m: Omit<Message, "to">): Promise<NotifyOutcome> => {
    const r = await sendEmail({ ...m, to }, cfg);
    return r.ok ? { sent: true, recipients: to.length } : { sent: false, recipients: to.length, error: r.error };
  };
  return {
    reason: null,
    notifier: {
      run: (d) => deliver(runTo, renderRunEmail(d)),
      failure: (d) => deliver(failTo, renderFailureEmail(d)),
    },
  };
}

/** Public site address for links in emails. */
export function appUrlFromEnv(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = env.APP_URL?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : null;
}
