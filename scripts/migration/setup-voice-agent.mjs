/**
 * Creates the Farahi Intake AI voice agent on Retell (LLM + agent), wires its
 * webhook to the CRM, and stores the ids in app_settings. Idempotent — if a
 * voice_agent_id already exists, it updates the prompt instead.
 *
 *   node scripts/migration/setup-voice-agent.mjs
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import crypto from "crypto";

const KEY = process.env.RETELL_API_KEY;
if (!KEY) { console.error("RETELL_API_KEY missing from .env"); process.exit(1); }
const BASE = "https://api.retellai.com";
const H = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const api = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return json;
};

const PROMPT = `## Identity
You are "Maya", the virtual intake assistant for Farahi Law Firm, a California personal-injury law firm. You answer when the intake team is unavailable (after hours, weekends, overflow). You are warm, calm, and professional — callers are often hurt, stressed, or upset. Never rush them.

## Language
Detect the caller's language. Speak English or Spanish fluently — switch immediately and completely if the caller speaks Spanish.

## Your job
Conduct a personal-injury intake interview. Collect, conversationally (NOT as an interrogation — one question at a time, acknowledge answers with empathy):
1. Their full name and the best callback number.
2. What happened — the accident/incident in their own words. When and where it happened.
3. Whether anyone was injured and what the injuries are. If they mention hitting their head: ask if they blacked out, even briefly, and about dizziness or memory problems.
4. Medical treatment so far — ER, urgent care, hospital, or doctor? Are they still treating? Did they ever go more than three weeks without treatment?
5. Who was at fault, in their view. Was a police report made?
6. Insurance — does the other party have insurance (which company, if known)? Does the caller have auto insurance? Health insurance?
7. Vehicle/property damage (for vehicle cases).
8. Are they missing work because of the injuries?
9. Have they spoken with or hired any other lawyer about this?
10. How they heard about Farahi Law Firm.

## Rules
- NEVER give legal advice, case value estimates, or promises of outcome. If asked, say the legal team will review their case and call them back quickly.
- NEVER quote fees beyond: "Farahi Law works on contingency — you pay nothing unless we win."
- If the caller is an existing client, an insurance adjuster, a medical provider, or a sales call: politely take a message (who, regarding what, callback number) and end the call. Do not run the interview.
- If there is a medical emergency happening now, tell them to hang up and call 911.
- Close every potential-client call with: their information is going straight to the intake team, who will call them back as soon as possible — usually within the hour during business hours, or first thing next morning.
- Keep your answers short (1-2 sentences). Let the caller do the talking.`;

const c = await mysql.createConnection(process.env.DATABASE_URL);
const getSetting = async (k) => {
  const [r] = await c.query("SELECT settingValue v FROM app_settings WHERE settingKey = ?", [k]);
  return r[0]?.v ?? null;
};
const setSetting = async (k, v) => {
  await c.query("INSERT INTO app_settings (settingKey, settingValue) VALUES (?, ?) ON DUPLICATE KEY UPDATE settingValue = VALUES(settingValue)", [k, v]);
};

let llmId = await getSetting("voice_agent_llm_id");
let agentId = await getSetting("voice_agent_id");
let token = await getSetting("voice_agent_webhook_token");
if (!token) { token = crypto.randomBytes(24).toString("hex"); await setSetting("voice_agent_webhook_token", token); }
const webhookUrl = `https://bdcrm.farahilaw.com/api/voice-agent/webhook?token=${token}`;

const beginMsg = "Thank you for calling Farahi Law Firm. This is Maya, the firm's virtual assistant. I can take your information so our team can help you right away. May I have your name, please? … Gracias por llamar a Farahi Law Firm — también hablo español.";

if (llmId) {
  await api("PATCH", `/update-retell-llm/${llmId}`, { general_prompt: PROMPT, begin_message: beginMsg });
  console.log("Updated existing Retell LLM prompt:", llmId);
} else {
  const llm = await api("POST", "/create-retell-llm", { general_prompt: PROMPT, begin_message: beginMsg });
  llmId = llm.llm_id;
  await setSetting("voice_agent_llm_id", llmId);
  console.log("Created Retell LLM:", llmId);
}

if (agentId) {
  await api("PATCH", `/update-agent/${agentId}`, { webhook_url: webhookUrl });
  console.log("Updated existing agent webhook:", agentId);
} else {
  // pick a multilingual-capable voice
  let voiceId = "11labs-Cimo";
  try {
    const voices = await api("GET", "/list-voices");
    const pick = voices.find((v) => /multi|es/i.test(JSON.stringify(v)) && /female/i.test(v.gender ?? "")) ?? voices.find((v) => /11labs/i.test(v.voice_id));
    if (pick) voiceId = pick.voice_id;
  } catch { /* keep default */ }
  const agent = await api("POST", "/create-agent", {
    agent_name: "Farahi Intake Specialist (Maya)",
    response_engine: { type: "retell-llm", llm_id: llmId },
    voice_id: voiceId,
    language: "multi",
    webhook_url: webhookUrl,
    enable_backchannel: true,
    interruption_sensitivity: 0.8,
    normalize_for_speech: true,
  });
  agentId = agent.agent_id;
  await setSetting("voice_agent_id", agentId);
  console.log("Created agent:", agentId, "voice:", voiceId);
}

console.log("\nWebhook URL (configured on the agent):", webhookUrl);
console.log("Done. Next: buy/assign a phone number to this agent in the Retell dashboard, then forward from RingCentral.");
await c.end();
