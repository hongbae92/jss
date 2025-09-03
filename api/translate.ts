import type { VercelRequest, VercelResponse } from '@vercel/node';

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

/** CORS */
function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/** 특수 아포스트로피 통일 */
function unifyApostrophe(s: string) {
  return s?.replace(/[\u2018\u2019\u02BC\u02BB]/g, "'");
}

/** 키릴 → 라틴 변환 */
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

/** Base64 변환 */
function toBase64Utf8(s: string) {
  return Buffer.from(s ?? "", "utf8").toString("base64");
}

/** targetLang 정규화 */
function normalizeTargetLang(input?: string) {
  const raw = (input || "").trim().toLowerCase();
  const uzLatnAliases = ["uz-latn", "uzbek (latin)", "oʻzbek lotin", "o'zbek lotin"];
  if (uzLatnAliases.includes(raw)) {
    return { code: "uz-Latn", label: "Uzbek (Latin)" };
  }
  return { code: "uz-Latn", label: "Uzbek (Latin)" };
}

/** 사과/거절 감지 */
function looksLikeApologyOrRefusal(s: string) {
  const t = s.trim().toLowerCase();
  return /^(kechirasiz|uzr|sorry|i cannot|men bajara olmayman|impossible)/.test(t);
}

/** 한글 포함 여부 */
function hasHangul(s: string) {
  return /[\u3131-\uD7A3]/.test(s);
}

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

    // OpenAI API 키 확인
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    // 바디 파싱
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (typeof body.text !== "string" || typeof body.targetLang !== "string") {
      return res.status(400).json({ error: "Bad Request: need { text, targetLang }" });
    }

    const sourceText: string = body.text;
    const { code: targetCode } = normalizeTargetLang(body.targetLang);

    // 번역 전용 프롬프트 (의역 금지)
    const systemPrompt = `
You are a strict literal translator.
Translate ALL Korean text into Uzbek (Latin, ${targetCode}).

STRICT RULES:
- ALWAYS translate word-for-word, literally and faithfully.
- NEVER refuse, NEVER apologize.
- NEVER echo the Korean source.
- NEVER alter style, tone, or meaning.
- Korean (Hangul) characters MUST NEVER appear in the output.
- Preserve line breaks, bullet points, punctuation, and symbols (e.g. ~~).
- Output ONLY the Uzbek Latin translation, nothing else.
`.trim();

    const payload = {
      model: body.model || DEFAULT_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: sourceText },
      ],
    };

    // 1차 요청
    const resp = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return res.status(resp.status).json({ error: "OpenAI error", detail: errText });
    }

    const data = await resp.json();
    let translatedRaw: string = data?.choices?.[0]?.message?.content ?? "";
    let result_latin = unifyApostrophe(cyrToLatin(translatedRaw)).trim();

    // 사과/거절 or 한글 포함 시 → 재시도
    if (looksLikeApologyOrRefusal(result_latin) || hasHangul(result_latin)) {
      const retryPayload = {
        model: body.model || DEFAULT_MODEL,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `
Translate into Uzbek (Latin, ${targetCode}).
MUST always translate literally. Do not echo Korean. Hangul forbidden.
Do not refuse, do not apologize. Output only translation.
`.trim(),
          },
          { role: "user", content: sourceText },
        ],
      };
      const retryResp = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(retryPayload),
      });
      const retryData = await retryResp.json().catch(() => ({} as any));
      const retr = String(retryData?.choices?.[0]?.message?.content ?? "");
      result_latin = unifyApostrophe(cyrToLatin(retr)).trim();
    }

    // 최종 Base64만 응답
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
