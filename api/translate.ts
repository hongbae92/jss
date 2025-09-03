import type { VercelRequest, VercelResponse } from '@vercel/node';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

/** CORS */
function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/** 특수 아포스트로피 통일 */
function unifyApostrophe(s: string) {
  return s?.replace(/[\u2018\u2019\u02BC\u02BB]/g, "'");
}

/** Uzbek Cyrillic -> Latin */
function cyrToLatin(input: string) {
  if (!input) return input;
  let s = input;
  s = s
    .replace(/Ч/g, 'Ch').replace(/ч/g, 'ch')
    .replace(/Ш/g, 'Sh').replace(/ш/g, 'sh')
    .replace(/Ю/g, 'Yu').replace(/ю/g, 'yu')
    .replace(/Я/g, 'Ya').replace(/я/g, 'ya')
    .replace(/Ё/g, 'Yo').replace(/ё/g, 'yo');
  const map: Record<string, string> = {
    'Қ': 'Q',  'қ': 'q',
    'Ғ': "G'", 'ғ': "g'",
    'Ў': "O'", 'ў': "o'",
    'Ҳ': 'H',  'ҳ': 'h',
    'Й': 'Y',  'й': 'y',
    'Ж': 'J',  'ж': 'j',
    'Э': 'E',  'э': 'e',
  };
  s = s.split('').map(ch => map[ch] ?? ch).join('');
  return unifyApostrophe(s);
}

/** 라틴 → ASCII 근사치 */
function toAsciiUzbek(s: string) {
  if (!s) return s;
  let t = unifyApostrophe(s);
  t = t.replace(/[^\x20-\x7E]/g, "?");
  return t;
}

function toBase64Utf8(s: string) {
  return Buffer.from(s ?? "", "utf8").toString("base64");
}

/** targetLang 정규화 */
function normalizeTargetLang(input?: string) {
  const raw = (input || '').trim().toLowerCase();
  const uzLatnAliases = ['uz-latn','uzbek (latin)','oʻzbek lotin',"o'zbek lotin"];
  if (uzLatnAliases.includes(raw)) {
    return { code: 'uz-Latn', label: 'Uzbek (Latin)' };
  }
  return { code: 'uz-Latn', label: 'Uzbek (Latin)' }; // 기본값
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET')     return res.status(200).send('ok');
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // 1) 토큰 검사
    const expectedToken = process.env.CLIENT_TOKEN;
    if (expectedToken) {
      const auth = String(req.headers['authorization'] || '');
      const incoming = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (incoming.trim() !== expectedToken.trim()) {
        return res.status(401).json({ error: 'Unauthorized: Invalid client token.' });
      }
    }

    // 2) API 키 확인
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    // 3) 바디 파싱
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (typeof body.text !== 'string' || typeof body.targetLang !== 'string') {
      return res.status(400).json({ error: 'Bad Request: need { text, targetLang }' });
    }

    const sourceText: string = body.text;
    const { code: targetCode, label: targetLabel } = normalizeTargetLang(body.targetLang);

    // 4) 프롬프트 (기획서 번역 전용)
    const systemPrompt = `
You are a professional translator specialized in IT business documents.
Your task is to translate Korean project plans and specifications into Uzbek (Latin, ${targetCode}).
STRICT RULES:
- Translate the text EXACTLY as written, preserving professional and technical meaning.
- NEVER respond in a conversational or casual style.
- NEVER answer as if you are an assistant. Do not add greetings or explanations.
- Preserve formatting: headings, bullet points, line breaks, and punctuation.
- Use terminology consistent with IT project management, software development, and UX/UI design.
- Output ONLY the Uzbek (Latin) translation of the given text. Nothing else.
`.trim();

    const payload = {
      model: body.model || DEFAULT_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: sourceText },
      ],
    };

    // 5) OpenAI 요청
    const resp = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return res.status(resp.status).json({ error: 'OpenAI error', detail: errText });
    }

    const data = await resp.json();
    let translatedRaw: string = data?.choices?.[0]?.message?.content ?? '';
    let result_latin = unifyApostrophe(cyrToLatin(translatedRaw)).trim();

    // 6) 후처리
    result_latin = result_latin.replace(/[^\x20-\x7E\u02BB\u02BC]/g, '').trim();
    const result_ascii = toAsciiUzbek(result_latin);
    const result_b64   = toBase64Utf8(result_latin);

    return res.status(200).json({
      ok: true,
      mode: 'translate',
      targetLang: targetLabel,
      targetLangCode: targetCode,
      result: result_latin,
      result_ascii,
      result_b64,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
