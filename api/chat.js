const SB = process.env.SUPABASE_URL;
const sbHeaders = {
  apikey: process.env.SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

export default async function handler(req, res) {
  if (req.headers['x-app-secret'] !== process.env.APP_SECRET)
    return res.status(401).json({ error: 'unauthorized' });

  if (req.method === 'GET') {
    const r = await fetch(`${SB}/rest/v1/messages?select=role,content&order=id.desc&limit=50`, { headers: sbHeaders });
    const rows = await r.json();
    if (!r.ok) return res.status(502).json({ error: rows });
    return res.json({ messages: rows.reverse() });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const { messages } = req.body || {};
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

  const models = (process.env.LLM_MODEL || '').split(',').map(m => m.trim()).filter(Boolean);
  let lastError = 'no model configured';

  for (const model of models) {
    try {
      const r = await fetch(`${process.env.LLM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.LLM_API_KEY}`,
        },
        body: JSON.stringify({ model, messages }),
      });
      const data = await r.json();
      const reply = data.choices?.[0]?.message?.content;
      if (r.ok && reply) {
        const last = messages[messages.length - 1];
        await fetch(`${SB}/rest/v1/messages`, {
          method: 'POST',
          headers: { ...sbHeaders, Prefer: 'return=minimal' },
          body: JSON.stringify([
            { role: last.role, content: last.content },
            { role: 'assistant', content: reply },
          ]),
        }).catch(() => {});
        return res.json({ reply, model });
      }
      lastError = data;
    } catch (e) {
      lastError = String(e);
    }
  }
  return res.status(502).json({ error: lastError });
}
