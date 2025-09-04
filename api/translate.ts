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
function cyrToLatin(input: string) {
  if (!input) return input;
  return input
    .replace(/Ч/g, "Ch").replace(/ч/g, "ch")
    .replace(/Ш/g, "Sh").replace(/ш/g, "sh")
    .replace(/Ю/g, "Yu").replace(/ю/g, "yu")
    .replace(/Я/g, "Ya").replace(/я/g, "ya")
    .replace(/Ё/g, "Yo").replace(/ё/g, "yo");
}
function toBase64Utf8(s: string) {
  return Buffer.from(s ?? "", "utf8").toString("base64");
}
function hasHangul(s: string) {
  return /[\u3131-\uD7A3]/.test(s);
}
function isBadOutput(s: string) {
  const t = s.trim().toLowerCase();
  return (
    hasHangul(t) ||
    t.includes("???") ||
    t.startsWith("sorry") ||
    t.startsWith("uzr") ||
    t.startsWith("kechirasiz")
  );
}

/** === 요청 === */
async function requestTranslation(apiKey: string, model: string, sourceText: string, targetCode: string) {
  const systemPrompt = `
You are a professional translator.
Your ONLY task is to translate Korean text into Uzbek (Latin, ${targetCode}).

RULES:
- Output ONLY the Uzbek Latin translation.
- NO Korean (Hangul forbidden).
- NO apologies. NO placeholders like ???.
- NO paraphrasing. Translate literally and faithfully.
- Preserve line breaks, punctuation, and symbols (~~ etc).
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
    const targetCode = "uz-Latn";

    // 1차 번역
    let result_latin = unifyApostrophe(cyrToLatin(await requestTranslation(apiKey, body.model || DEFAULT_MODEL, sourceText, targetCode))).trim();

    // 검증 실패 시 재시도
    if (isBadOutput(result_latin)) {
      const retry = await requestTranslation(apiKey, body.model || DEFAULT_MODEL, sourceText, targetCode);
      result_latin = unifyApostrophe(cyrToLatin(retry)).trim();
    }

    // 최후의 보루: 그래도 나쁘면 그냥 "Translation failed" 넣기 (빈칸 방지)
    if (isBadOutput(result_latin) || !result_latin) {
      result_latin = "Tarjima muvaffaqiyatsiz bajarildi (fallback).";
    }

    const result_b64 = toBase64Utf8(result_latin);
    return res.status(200).json({ ok: true, mode: "translate", result_b64 });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
