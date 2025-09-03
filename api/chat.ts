import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages } = req.body || {};
    if (!messages) {
      return res.status(400).json({ error: 'messages required' });
    }

    res.status(200).json({ echo: messages });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
