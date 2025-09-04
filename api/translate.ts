import type { VercelRequest, VercelResponse } from '@vercel/node';

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

/** === Utils === */
function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
function unifyApostrophe(s: string) {
  return s?.replace(/[\u2018\u2019\u02BC\u02BB]/g, "'");
}
function toBase64Utf8(s: string) {
  return Buffer.from(s ?? "", "utf8").toString("base64");
}

/** === OpenAI 요청 === */
async function requestTranslation(apiKey: string, model: string, sourceText: string) {
  const systemPrompt = `
You are a professional translator.
Translate the following Korean text into Uzbek (Latin, uz-Latn).
Output ONLY the Uzbek Latin translation. Nothing else.
`.trim();

  const payload = {
    model,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: sourceText },
    ],
  };

  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`OpenAI error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  return String(data?.choices?.[0]?.message?.content ?? "");
}

/** === Handler === */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") return res.status(200).send("ok");
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    // 토큰 검사
    const expectedToken = process.env.CLIENT_TOKEN;
    if (expectedToken) {
      const auth = String(req.headers["authorization"] || "");
      const incoming = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (incoming.trim() !== expectedToken.trim()) {
        return res.status(401).json({ error: "Unauthorized: Invalid client token." });
      }
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (typeof body.text !== "string" || typeof body.targetLang !== "string") {
      return res.status(400).json({ error: "Bad Request: need { text, targetLang }" });
    }

    const sourceText: string = body.text;

    // 번역 요청
    let result_latin = await requestTranslation(apiKey, body.model || DEFAULT_MODEL, sourceText);
    result_latin = unifyApostrophe(result_latin).trim();

    // Base64로 반환 (출력 깨짐 방지)
    const result_b64 = toBase64Utf8(result_latin);

    return res.status(200).json({ ok: true, mode: "translate", result_b64 });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
