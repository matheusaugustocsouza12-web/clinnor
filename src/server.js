require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const db = require('./db');
const { sign, authenticate, requireAuth, requireRole } = require('./auth');
const { verifyWebhook, verifySignature, sendMetaMessage } = require('./meta');
const { extractName, generateAiReply } = require('./ana-agent');

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buffer) => { req.rawBody = buffer.toString('utf8'); },
}));

async function anaReply(channel, externalId, text, providerMessageId) {
  const settings = await db.query('SELECT * FROM clinic_settings WHERE id = 1');
  const config = settings.rows[0];
  let contact = await db.query(
    'SELECT * FROM contacts WHERE channel = $1 AND external_id = $2',
    [channel, externalId]
  );
  if (!contact.rows[0]) {
    contact = await db.query(
      'INSERT INTO contacts (channel, external_id) VALUES ($1, $2) RETURNING *',
      [channel, externalId]
    );
  }
  const contactRow = contact.rows[0];
  let conversation = await db.query(
    `SELECT * FROM conversations WHERE contact_id = $1 AND status <> 'closed'
     ORDER BY created_at DESC LIMIT 1`,
    [contactRow.id]
  );
  if (!conversation.rows[0]) {
    conversation = await db.query(
      'INSERT INTO conversations (contact_id) VALUES ($1) RETURNING *',
      [contactRow.id]
    );
  }
  const conversationRow = conversation.rows[0];
  const inboundCount = await db.query(
    "SELECT COUNT(*)::int AS count FROM messages WHERE conversation_id = $1 AND direction = 'inbound'",
    [conversationRow.id]
  );
  await db.query(
    `INSERT INTO messages (conversation_id, direction, sender, body, provider_message_id)
     VALUES ($1, 'inbound', 'customer', $2, $3)
     ON CONFLICT (provider_message_id) DO NOTHING`,
    [conversationRow.id, text, providerMessageId || null]
  );
  await db.query("UPDATE conversations SET last_message_at = now() WHERE id = $1", [conversationRow.id]);

  const normalized = text.trim().toLowerCase();
  let reply;
  if (!contactRow.name) {
    if (inboundCount.rows[0].count === 0) {
      reply = `Olá! Você está falando com a secretaria da ${config.business_name}. Estou disponível para ajudar com agendamentos, procedimentos e dúvidas. ${config.ana_initial_message}`;
      await db.query(
        `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"awaiting_name":true}'::jsonb WHERE id = $1`,
        [conversationRow.id]
      );
      return { conversationId: conversationRow.id, reply };
    }
    const name = extractName(text);
    await db.query('UPDATE contacts SET name = $1 WHERE id = $2', [name, contactRow.id]);
    reply = `Tudo bem, ${name}? Em que posso ajudar?`;
    return { conversationId: conversationRow.id, reply };
  }
  if (/reembolso|queixa|reclamação|reclamacao|dor|complica|clínico|clinico/.test(normalized)) {
    await db.query(
      `INSERT INTO human_transfers (conversation_id, requested_by_contact_id, reason, option_selected)
       VALUES ($1, $2, 'Assunto clínico ou de atendimento humano', 'Equipe')`,
      [conversationRow.id, contactRow.id]
    );
    await db.query("UPDATE conversations SET status = 'waiting_human' WHERE id = $1", [conversationRow.id]);
    return { conversationId: conversationRow.id, reply: config.transfer_message || 'Vou transferir você para uma pessoa da equipe agora.' };
  }
  if (/(tirar dúvida|duvida|outros)/.test(normalized)) {
    await db.query(
      `INSERT INTO human_transfers (conversation_id, requested_by_contact_id, reason, option_selected)
       VALUES ($1, $2, 'Solicitação explícita do cliente', $3)`,
      [conversationRow.id, contactRow.id, normalized.includes('outros') ? 'Outros' : 'Tirar dúvida']
    );
    await db.query("UPDATE conversations SET status = 'waiting_human' WHERE id = $1", [conversationRow.id]);
    reply = config.transfer_message;
  } else if (normalized.includes('agend')) {
    reply = 'Claro. Qual procedimento você deseja realizar e para qual dia prefere ser atendido?';
  } else if (normalized.includes('reagend') || normalized.includes('cancel')) {
    reply = 'Posso ajudar. Informe a data atual, o profissional e a nova preferência de horário.';
  } else if (normalized.includes('procediment')) {
    reply = 'Qual procedimento ou área você deseja conhecer?';
  } else if (/valor|preço|preco|quanto custa/.test(normalized) && !contactRow.name) {
    reply = `Antes de falar sobre valores, preciso confirmar sua identidade. ${config.ana_initial_message}`;
  } else if (/pix|boleto|cartao|cartão|link de pagamento/.test(normalized)) {
    reply = 'Posso enviar o link da cobrança pelo canal desta conversa. Primeiro é necessário confirmar o orçamento aprovado e os dados de pagamento.';
  } else {
    const history = await db.query(
      `SELECT direction, sender, body FROM messages
       WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 9`,
      [conversationRow.id]
    );
    reply = await generateAiReply({
      message: text,
      patientName: contactRow.name,
      clinicName: config.business_name,
      history: history.rows.reverse(),
      settings: config,
    });
  }
  return { conversationId: conversationRow.id, reply };
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await authenticate(email, password);
    if (!user) return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    return res.json({ token: sign(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error) { next(error); }
});

app.post('/api/users', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const bcrypt = require('bcryptjs');
    const { name, email, password, role } = req.body;
    if (!['admin', 'professional', 'reception'].includes(role)) {
      return res.status(400).json({ error: 'Perfil inválido.' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await db.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, active = true
       RETURNING id, name, email, role, active`,
      [name, email.toLowerCase(), passwordHash, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.get('/api/me', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query('SELECT id, name, email, role FROM users WHERE id = $1', [req.user.sub]);
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.get('/api/settings', requireAuth, async (_req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM clinic_settings WHERE id = 1');
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.put('/api/settings', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { business_name, ana_initial_message, ana_options, transfer_message } = req.body;
    const result = await db.query(
      `UPDATE clinic_settings SET business_name = COALESCE($1, business_name),
       ana_initial_message = COALESCE($2, ana_initial_message),
       ana_options = COALESCE($3, ana_options),
       transfer_message = COALESCE($4, transfer_message), updated_at = now()
       WHERE id = 1 RETURNING *`,
      [business_name, ana_initial_message, ana_options ? JSON.stringify(ana_options) : null, transfer_message]
    );
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.get('/api/conversations', requireAuth, async (_req, res, next) => {
  try {
    const result = await db.query(
      `SELECT c.*, co.name contact_name, co.channel, co.external_id
       FROM conversations c JOIN contacts co ON co.id = c.contact_id
       ORDER BY c.last_message_at DESC LIMIT 100`
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/conversations/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.post('/api/conversations/:id/assign', requireAuth, async (req, res, next) => {
  try {
    await db.query(
      `UPDATE conversations SET human_owner_id = $1, status = 'waiting_human' WHERE id = $2`,
      [req.user.sub, req.params.id]
    );
    res.status(204).end();
  } catch (error) { next(error); }
});

app.post('/api/conversations/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const contact = await db.query(
      `SELECT co.channel, co.external_id FROM conversations c
       JOIN contacts co ON co.id = c.contact_id WHERE c.id = $1`,
      [req.params.id]
    );
    if (!contact.rows[0]) return res.status(404).json({ error: 'Conversa não encontrada.' });
    const row = contact.rows[0];
    await sendMetaMessage(row.channel, row.external_id, req.body.body);
    await db.query(
      `INSERT INTO messages (conversation_id, direction, sender, body) VALUES ($1, 'outbound', 'human', $2)`,
      [req.params.id, req.body.body]
    );
    res.status(201).json({ sent: true });
  } catch (error) { next(error); }
});

app.get('/api/availability', requireAuth, async (req, res, next) => {
  try {
    const { professionalId, date } = req.query;
    const workday = new Date(`${date}T09:00:00-03:00`);
    const available = [];
    for (let hour = 9; hour < 18; hour++) {
      const starts = new Date(workday);
      starts.setHours(hour, 0, 0, 0);
      const busy = await db.query(
        `SELECT 1 FROM appointments WHERE professional_id = $1 AND status <> 'cancelled'
         AND starts_at < $3 AND ends_at > $2 LIMIT 1`,
        [professionalId, starts.toISOString(), new Date(starts.getTime() + 60 * 60 * 1000).toISOString()]
      );
      if (!busy.rows.length) available.push(starts.toISOString());
    }
    res.json(available);
  } catch (error) { next(error); }
});

app.post('/api/appointments', requireAuth, async (req, res, next) => {
  try {
    const { patient_name, professional_id, procedure_id, starts_at, conversation_id } = req.body;
    const procedure = await db.query('SELECT duration_minutes FROM procedures WHERE id = $1', [procedure_id]);
    if (!procedure.rows[0]) return res.status(400).json({ error: 'Procedimento inválido.' });
    const start = new Date(starts_at);
    const end = new Date(start.getTime() + procedure.rows[0].duration_minutes * 60 * 1000);
    const conflict = await db.query(
      `SELECT 1 FROM appointments WHERE professional_id = $1 AND status <> 'cancelled'
       AND starts_at < $3 AND ends_at > $2 LIMIT 1`,
      [professional_id, start.toISOString(), end.toISOString()]
    );
    if (conflict.rows[0]) return res.status(409).json({ error: 'Horário indisponível.' });
    const result = await db.query(
      `INSERT INTO appointments (conversation_id, patient_name, professional_id, procedure_id, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [conversation_id || null, patient_name, professional_id, procedure_id, start.toISOString(), end.toISOString()]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.get('/api/charges', requireAuth, async (_req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM charges ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.post('/api/charges', requireAuth, async (req, res, next) => {
  try {
    const { quote_number, patient_name, amount, method, due_at, channel, contact } = req.body;
    if (!['PIX', 'Boleto', 'Cartão'].includes(method)) return res.status(400).json({ error: 'Forma de pagamento inválida.' });
    if (!contact) return res.status(400).json({ error: 'Contato do paciente obrigatório.' });
    const count = await db.query("SELECT COUNT(*)::int AS count FROM charges WHERE created_at::date = CURRENT_DATE");
    const number = `CB-${String(count.rows[0].count + 1).padStart(4, '0')}`;
    const providerLink = `https://pay.brainmed.local/${number}`;
    const result = await db.query(
      `INSERT INTO charges (number, quote_number, patient_name, amount, method, due_at, payment_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [number, quote_number, patient_name, amount, method, due_at, providerLink]
    );
    res.status(201).json({ ...result.rows[0], channel, contact });
  } catch (error) { next(error); }
});

app.patch('/api/appointments/:id', requireAuth, async (req, res, next) => {
  try {
    const { status, starts_at, cancelled_reason } = req.body;
    let result;
    if (starts_at) {
      const procedure = await db.query(
        `SELECT a.procedure_id, p.duration_minutes FROM appointments a
         JOIN procedures p ON p.id = a.procedure_id WHERE a.id = $1`,
        [req.params.id]
      );
      if (!procedure.rows[0]) return res.status(404).json({ error: 'Agendamento não encontrado.' });
      const start = new Date(starts_at);
      const end = new Date(start.getTime() + procedure.rows[0].duration_minutes * 60000);
      const current = await db.query(
        'SELECT professional_id FROM appointments WHERE id = $1',
        [req.params.id]
      );
      if (!current.rows[0]) return res.status(404).json({ error: 'Agendamento não encontrado.' });
      const conflict = await db.query(
        `SELECT 1 FROM appointments WHERE professional_id = $1 AND id <> $4
         AND status <> 'cancelled' AND starts_at < $3 AND ends_at > $2 LIMIT 1`,
        [current.rows[0].professional_id, start.toISOString(), end.toISOString(), req.params.id]
      );
      if (conflict.rows[0]) return res.status(409).json({ error: 'Horário indisponível.' });
      result = await db.query(
        `UPDATE appointments SET starts_at = $1, ends_at = $2, status = 'confirmed',
         updated_at = now() WHERE id = $3 RETURNING *`,
        [start.toISOString(), end.toISOString(), req.params.id]
      );
    } else {
      result = await db.query(
        `UPDATE appointments SET status = COALESCE($1, status),
         cancelled_reason = COALESCE($2, cancelled_reason), updated_at = now()
         WHERE id = $3 RETURNING *`,
        [status, cancelled_reason, req.params.id]
      );
    }
    if (!result.rows[0]) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.get('/webhooks/meta', verifyWebhook);
app.post('/webhooks/meta', verifySignature, async (req, res, next) => {
  res.sendStatus(200);
  try {
    for (const entry of req.body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const messaging = value.messaging || [];
        for (const event of messaging) {
          const externalId = event.sender?.id;
          const text = event.message?.text;
          if (!externalId || !text) continue;
          const processed = await anaReply('instagram', externalId, text, event.message?.mid);
          if (processed?.reply) await sendMetaMessage('instagram', externalId, processed.reply);
          if (processed?.conversationId && processed.reply) {
            await db.query(
              `INSERT INTO messages (conversation_id, direction, sender, body) VALUES ($1, 'outbound', 'ana', $2)`,
              [processed.conversationId, processed.reply]
            );
          }
        }
      }
      for (const message of entry.messaging || []) {
        const externalId = message.sender?.id;
        const text = message.message?.text;
        if (!externalId || !text) continue;
        const processed = await anaReply('instagram', externalId, text, message.message?.mid);
        if (processed?.reply) await sendMetaMessage('instagram', externalId, processed.reply);
        if (processed?.conversationId && processed.reply) {
          await db.query(
            `INSERT INTO messages (conversation_id, direction, sender, body) VALUES ($1, 'outbound', 'ana', $2)`,
            [processed.conversationId, processed.reply]
          );
        }
      }
    }
    for (const change of req.body.entry?.flatMap(item => item.changes || []) || []) {
      for (const message of change.value?.messages || []) {
        const externalId = message.from;
        const text = message.text?.body;
        if (!externalId || !text) continue;
        const processed = await anaReply('whatsapp', externalId, text, message.id);
        if (processed?.reply) await sendMetaMessage('whatsapp', externalId, processed.reply);
        if (processed?.conversationId && processed.reply) {
          await db.query(
            `INSERT INTO messages (conversation_id, direction, sender, body) VALUES ($1, 'outbound', 'ana', $2)`,
            [processed.conversationId, processed.reply]
          );
        }
      }
    }
  } catch (error) {
    console.error('Erro ao processar webhook Meta:', error);
  }
});

app.use((error, _req, res, _next) => {
  console.error('Erro interno:', error);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`BrainMed API ouvindo na porta ${port}`));
