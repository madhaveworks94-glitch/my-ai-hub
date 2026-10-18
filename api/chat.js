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

const BASE_SYSTEM =
  "You are the assistant inside the user's personal AI hub. " +
  'When the user asks for a web page, app, tool, game, calculator, chart or visual, ' +
  'reply with ONE complete self-contained HTML file (inline CSS and JS, no external files) ' +
  'inside a single ```html code block, and keep any explanation outside the block short.';

async function getSystem() {
  let text = BASE_SYSTEM;
  try {
    const r = await sb('skills?select=name,instructions&enabled=eq.true&order=id.asc');
    const rows = await r.json();
    if (r.ok && rows.length)
      text += '\n\nActive skills. Follow them:\n' + rows.map(s => `## ${s.name}\n${s.instructions}`).join('\n\n');
  } catch (e) {}
  return text;
}

function sanitize(arr) {
  const out = [];
  let imgs = 0;
  for (const a of (Array.isArray(arr) ? arr : []).slice(0, 10)) {
    const name = String((a && a.name) || 'file').slice(0, 120);
    if (a.kind === 'text' && typeof a.text === 'string') {
      out.push({ kind: 'text', name, text: a.text.slice(0, 20000) });
    } else if (a.kind === 'image' && Array.isArray(a.images)) {
      const images = a.images
        .filter(u => typeof u === 'string' && u.startsWith('data:image/'))
        .slice(0, Math.max(0, 8 - imgs));
      imgs += images.length;
      if (images.length) out.push({ kind: 'image', name, images });
    }
  }
  return out;
}

function toModelMsg(role, content, atts, metaNames) {
  if (!atts || !atts.length) {
    if (metaNames && metaNames.length)
      return { role, content: `${content}\n\n[Earlier attachments no longer available: ${metaNames.join(', ')}]` };
    return { role, content };
  }
  let text = content;
  const imgs = [];
  for (const a of atts) {
    if (a.kind === 'text') text += `\n\n[File: ${a.name}]\n${a.text}`;
    else if (a.images) {
      if (a.images.length > 1)
        text += `\n\n[Attachment "${a.name}": ${a.images.length} frames sampled in time order from a video]`;
      imgs.push(...a.images);
    }
  }
  if (!imgs.length) return { role, content: text };
  return {
    role,
    content: [{ type: 'text', text }, ...imgs.map(u => ({ type: 'image_url', image_url: { url: u } }))],
  };
}

async function askModel(messages, hasImages) {
  const raw = hasImages && process.env.LLM_VISION_MODEL ? process.env.LLM_VISION_MODEL : process.env.LLM_MODEL || '';
  const models = raw.split(',').map(m => m.trim()).filter(Boolean);
  const full = [{ role: 'system', content: await getSystem() }, ...messages];
  let lastError = 'no model configured';
  for (const model of models) {
    try {
      const r = await fetch(`${process.env.LLM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.LLM_API_KEY}`,
        },
        body: JSON.stringify({ model, messages: full }),
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
      if (req.query.skills) {
        const r = await sb('skills?select=id,name,instructions,enabled&order=id.asc');
        const rows = await r.json();
        if (!r.ok) return res.status(502).json({ error: rows });
        return res.json({ skills: rows });
      }
      if (req.query.conversation) {
        const id = Number(req.query.conversation);
        if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
        const r = await sb(`messages?select=id,role,content,att_meta&conversation_id=eq.${id}&order=id.asc&limit=200`);
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

    if (b.action === 'skill_save') {
      const name = String(b.name || '').trim().slice(0, 80);
      const instructions = String(b.instructions || '').trim().slice(0, 4000);
      if (!name || !instructions) return res.status(400).json({ error: 'name and instructions required' });
      const enabled = b.enabled !== false;
      if (Number.isInteger(Number(b.id)) && b.id != null) {
        await sb(`skills?id=eq.${Number(b.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, instructions, enabled }),
        });
      } else {
        await sb('skills', { method: 'POST', body: JSON.stringify({ name, instructions, enabled }) });
      }
      return res.json({ ok: true });
    }

    if (b.action === 'skill_toggle') {
      const id = Number(b.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
      await sb(`skills?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !!b.enabled }) });
      return res.json({ ok: true });
    }

    if (b.action === 'skill_delete') {
      const id = Number(b.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
      await sb(`skills?id=eq.${id}`, { method: 'DELETE' });
      return res.json({ ok: true });
    }

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
      const msgs = b.messages;
      if (!Number.isInteger(id) || !Array.isArray(msgs) || !msgs.length)
        return res.status(400).json({ error: 'conversation_id and messages required' });
      const L = msgs.length - 1;
      const last = msgs[L];
      if (last.role !== 'user') return res.status(400).json({ error: 'last message must be user' });

      const newAtt = sanitize(b.new_attachments);

      // load stored attachments for the last 2 earlier messages that had them
      const wanted = msgs
        .map((m, i) => ({ m, i }))
        .filter(x => x.i < L && Number.isInteger(Number(x.m.id)) && Array.isArray(x.m.att) && x.m.att.length)
        .slice(-2)
        .map(x => Number(x.m.id));
      const stored = {};
      if (wanted.length) {
        const r = await sb(`messages?select=id,attachments&conversation_id=eq.${id}&id=in.(${wanted.join(',')})`);
        const rows = await r.json();
        if (r.ok) for (const row of rows) stored[row.id] = row.attachments;
      }

      let hasImages = false;
      const model = msgs.map((m, i) => {
        const content = String(m.content || '');
        let atts = null;
        let missing = null;
        if (i === L) atts = newAtt;
        else if (stored[m.id]) atts = stored[m.id];
        else if (Array.isArray(m.att) && m.att.length) missing = m.att.map(a => String(a.name || 'file'));
        if (atts && atts.some(a => a.images && a.images.length)) hasImages = true;
        return toModelMsg(m.role, content, atts, missing);
      });

      const out = await askModel(model, hasImages);
      if (out.error) return res.status(502).json({ error: out.error });

      if (b.truncate_from_id != null && Number.isInteger(Number(b.truncate_from_id))) {
        await sb(`messages?conversation_id=eq.${id}&id=gte.${Number(b.truncate_from_id)}`, { method: 'DELETE' });
      }
      const ins = await sb('messages', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([
          {
            conversation_id: id,
            role: 'user',
            content: last.content,
            attachments: newAtt.length ? newAtt : null,
            att_meta: newAtt.length ? newAtt.map(a => ({ kind: a.kind, name: a.name })) : null,
          },
          { conversation_id: id, role: 'assistant', content: out.reply, attachments: null, att_meta: null },
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
