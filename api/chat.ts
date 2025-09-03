import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const expectedToken = process.env.CLIENT_TOKEN;
    const auth = String(req.headers['authorization'] || '');
    const incoming = auth.startsWith('Bearer ') ? auth.slice(7) : '';

    // debug logs
    console.log('expectedToken raw:', JSON.stringify(expectedToken));
    console.log('incoming raw:', JSON.stringify(incoming));
    console.log('expectedToken length:', (expectedToken || '').length);
    console.log('incoming length:', incoming.length);

    if (incoming !== expectedToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        expectedLen: (expectedToken || '').length,
        incomingLen: incoming.length,
      });
    }

    const { messages } = req.body || {};
    if (!messages) {
      return res.status(400).json({ error: 'messages required' });
    }

    res.status(200).json({ echo: messages });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
