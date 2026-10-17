
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (req.headers['x-app-secret'] !== process.env.APP_SECRET)
    return res.status(401).json({ error: 'unauthorized' });

  const { messages } = req.body || {};
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

  const r = await fetch(`${process.env.LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify({ model: process.env.LLM_MODEL, messages }),
  });

  const data = await r.json();
  if (!r.ok) return res.status(502).json({ error: data });
  res.json({ reply: data.choices?.[0]?.message?.content ?? '' });
}
