// Verifies the app's own server-side LLM path (server/_core/llm.ts) works with
// the configured OpenAI key. dotenv MUST load before llm/env is imported.
import "dotenv/config";
import { invokeLLM } from "../../server/_core/llm";

console.log("forge url:", process.env.BUILT_IN_FORGE_API_URL, "| model:", process.env.LLM_MODEL);
const r = await invokeLLM({
  messages: [{ role: "user", content: "Reply with exactly: SERVER-LLM-OK" }],
  max_tokens: 16,
});
console.log("LLM reply:", JSON.stringify(r.choices?.[0]?.message?.content));
console.log("model used:", r.model);
