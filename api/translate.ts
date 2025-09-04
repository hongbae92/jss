import type { VercelRequest, VercelResponse } from '@vercel/node';

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

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
  let s = input;
  s = s
    .replace(/Ч/g, "Ch").replace(/ч/g, "ch")
    .replace(/Ш/g, "Sh").replace(/ш/g, "sh")
    .replace(/Ю/g, "Yu").replace(/ю/g, "yu")
    .replace(/Я/g, "Ya").replace(/я/g, "ya")
    .replace(/Ё/g, "Yo").replace(/ё/g, "yo");
  return unifyApostrophe(s);
}
function toBase64Utf8(s: string) {
  return Buffer.from(s ?? "", "utf8").toString("base64");
}
function normalizeTargetLang(input?: string) {
  const raw = (input || "").trim().toLowerCase();
  const uzLatnAliases = ["uz-latn", "uzbek (latin)", "oʻzbek lotin", "o'zbek lotin"];
  if (uzLatnAliases.includes(raw)) {
    return { code: "uz-Latn", label: "Uzbek (Latin)" };
  }
  return { code: "uz-Latn", label: "Uzbek (Latin)" };
}
function hasHangul(s: string) {
  return /[\u3131-\uD7A3]/.test(s);
}
function looksLikeApologyOrRefusal(s: string) {
  const t = s.trim().toLowerCase();
  return /^(kechirasiz|uzr|sorry|i cannot|men bajara olmayman|impossible)/.test(t);
}

/** 아주 단순한 로마자 변환 fallback (최후의 보루) */
function romanizeHangul(input: string) {
  return input
    .replace(/가/g,"ga").replace(/나/g,"na").replace(/다/g,"da")
    .replace(/라/g,"ra").replace(/마/g,"ma").replace(/바/g,"ba")
    .replace(/사/g,"sa").replace(/아/g,"a").replace(/자/g,"ja")
    .replace(/차/g,"cha").replace(/카/g,"ka").replace(/타/g,"ta")
    .replace(/파/g,"pa").replace(/하/g,"ha");
  // 실제 구현은 더 확장 가능
}

async function requestTranslation(apiKey: string, model: string, sourceText: string, targetCode: string, strict: boolean) {
  const systemPrompt = strict
    ? `
You are a professional translator.
Translate the following Korean text into Uzbek (Latin, ${targetCode}).

RULES:
- ALWAYS translate literally and directly.
- NEVER echo Korean text. Hangul MUST NOT appear.
- NEVER refuse or apologize.
- Preserve line breaks, punctuation, and symbols.
- Output ONLY the Uzbek Latin translation.
`.trim()
    : `
Translate Korean into Uzbek (Latin, ${targetCode}).
Output only the translation.
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
    const { code: targetCode } = normalizeTargetLang(body.targetLang);

    let result_latin = "";

    // 1차 번역
    result_latin = unifyApostrophe(cyrToLatin(await requestTranslation(apiKey, body.model || DEFAULT_MODEL, sourceText, targetCode, true))).trim();

    // 2차 재시도 (한글/사과문 발견 시)
    if (hasHangul(result_latin) || looksLikeApologyOrRefusal(result_latin)) {
      result_latin = unifyApostrophe(cyrToLatin(await requestTranslation(apiKey, body.model || DEFAULT_MODEL, sourceText, targetCode, true))).trim();
    }

    // 최후의 보루: 여전히 한글이 남아있으면 로마자 변환
    if (hasHangul(result_latin)) {
      result_latin = romanizeHangul(sourceText);
    }

    const result_b64 = toBase64Utf8(result_latin);

    return res.status(200).json({
      ok: true,
      mode: "translate",
      result_b64,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
