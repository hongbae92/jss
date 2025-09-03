import type { VercelRequest, VercelResponse } from '@vercel/node';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function unifyApostrophe(s: string) {
  return s?.replace(/[\u2018\u2019\u02BC\u02BB]/g, "'");
}

function cyrToLatin(input: string) {
  if (!input) return input;
  let s = input;
  s = s
    .replace(/Ч/g, 'Ch').replace(/ч/g, 'ch')
    .replace(/Ш/g, 'Sh').replace(/ш/g, 'sh')
    .replace(/Ю/g, 'Yu').replace(/ю/g, 'yu')
    .replace(/Я/g, 'Ya').replace(/я/g, 'ya')
    .replace(/Ё/g, 'Yo').replace(/ё/g, 'yo');
  return unifyApostrophe(s);
}

function toBase64Utf8(s: string) {
  return Buffer.from(s ?? "", "utf8").toString("base64");
}

function normalizeTargetLang(input?: string) {
  const raw = (input || '').trim().toLowerCase();
  const uzLatnAliases = ['uz-latn','uzbek (latin)','oʻzbek lotin',"o'zbek lotin"];
  if (uzLatnAliases.includes(raw)) {
    return { code: 'uz-Latn', label: 'Uzbek (Latin)' };
  }
  return { code: 'uz-Latn', label: 'Uzbek (Latin)' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET')     return res.status(200).send('ok');
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const expectedToken = process.env.CLIENT_TOKEN;
    if (expectedToken) {
      const auth = String(req.headers['authorization'] || '');
      const incoming = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (incoming.trim() !== expectedToken.trim()) {
        return res.status(401).json({ error: 'Unauthorized: Invalid client token.' });
      }
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (typeof body.text !== 'string' || typeof body.targetLang !== 'string') {
      return res.status(400).json({ error: 'Bad Request: need { text, targetLang }' });
    }

    const sourceText: string = body.text;
    const { code: targetCode } = normalizeTargetLang(body.targetLang);

    const systemPrompt = `
You are a professional translator specialized in IT business documents.
Translate Korean project plans and specifications into Uzbek (Latin, ${targetCode}).
STRICT RULES:
- Translate EXACTLY, keep technical/professional meaning.
- NEVER answer conversationally, NEVER add greetings or comments.
- Preserve formatting: headings, bullets, line breaks.
- Output ONLY the Uzbek Latin translation.
`.trim();

    const payload = {
      model: body.model || DEFAULT_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: sourceText },
      ],
    };

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

    // 최종 Base64만 응답
    const result_b64 = toBase64Utf8(result_latin);

    return res.status(200).json({
      ok: true,
      mode: 'translate',
      result_b64
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
