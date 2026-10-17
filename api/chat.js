const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const sb = (path, opts = {}) =>
  fetch(`${SB}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });

async function askModel(messages) {
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
      if (r.ok && reply) return { reply, model };
      lastError = data;
    } catch (e) {
      lastError = String(e);
    }
  }
  return { error: lastError };
}

export default async function handler(req, res) {
  if (req.headers['x-app-secret'] !== process.env.APP_SECRET)
    return res.status(401).json({ error: 'unauthorized' });

  try {
    if (req.method === 'GET') {
      if (req.query.conversation) {
        const id = Number(req.query.conversation);
        if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
        const r = await sb(`messages?select=id,role,content&conversation_id=eq.${id}&order=id.asc&limit=200`);
        const rows = await r.json();
        if (!r.ok) return res.status(502).json({ error: rows });
        return res.json({ messages: rows });
      }
      const r = await sb('conversations?select=id,title&order=id.desc&limit=100');
      const rows = await r.json();
      if (!r.ok) return res.status(502).json({ error: rows });
      return res.json({ conversations: rows });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });
    const b = req.body || {};

    if (b.action === 'new') {
      const r = await sb('conversations', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ title: 'New chat' }),
      });
      const rows = await r.json();
      if (!r.ok) return res.status(502).json({ error: rows });
      return res.json(rows[0]);
    }

    if (b.action === 'delete') {
      const id = Number(b.conversation_id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
      await sb(`conversations?id=eq.${id}`, { method: 'DELETE' });
      return res.json({ ok: true });
    }

    if (b.action === 'chat') {
      const id = Number(b.conversation_id);
      const messages = b.messages;
      if (!Number.isInteger(id) || !Array.isArray(messages) || !messages.length)
        return res.status(400).json({ error: 'conversation_id and messages required' });
      const last = messages[messages.length - 1];
      if (last.role !== 'user') return res.status(400).json({ error: 'last message must be user' });

      const out = await askModel(messages);
      if (out.error) return res.status(502).json({ error: out.error });

      if (b.truncate_from_id != null && Number.isInteger(Number(b.truncate_from_id))) {
        await sb(`messages?conversation_id=eq.${id}&id=gte.${Number(b.truncate_from_id)}`, { method: 'DELETE' });
      }
      const ins = await sb('messages', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([
          { conversation_id: id, role: 'user', content: last.content },
          { conversation_id: id, role: 'assistant', content: out.reply },
        ]),
      });
      const rows = await ins.json();
      if (!ins.ok) return res.status(502).json({ error: rows });

      await sb(`conversations?id=eq.${id}&title=eq.New%20chat`, {
        method: 'PATCH',
        body: JSON.stringify({ title: String(last.content).slice(0, 40) }),
      }).catch(() => {});

      return res.json({ reply: out.reply, model: out.model, user_id: rows[0].id, assistant_id: rows[1].id });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
