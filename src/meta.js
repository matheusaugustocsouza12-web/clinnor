const crypto = require('crypto');

function verifySignature(req, res, next) {
  if (!process.env.META_APP_SECRET) return next();
  const signature = req.headers['x-hub-signature-256'];
  const expected = `sha256=${crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(req.rawBody || '')
    .digest('hex')}`;
  if (!signature || signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Assinatura Meta inválida.' });
  }
  return next();
}

function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}

async function sendMetaMessage(channel, recipientId, body) {
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) throw new Error('META_ACCESS_TOKEN não configurado.');

  let url;
  let payload;
  if (channel === 'whatsapp') {
    if (!process.env.WHATSAPP_PHONE_NUMBER_ID) {
      throw new Error('WHATSAPP_PHONE_NUMBER_ID não configurado.');
    }
    url = `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    payload = { messaging_product: 'whatsapp', to: recipientId, type: 'text', text: { body } };
  } else {
    if (!process.env.INSTAGRAM_PAGE_ID) {
      throw new Error('INSTAGRAM_PAGE_ID não configurado.');
    }
    url = `https://graph.facebook.com/v21.0/${process.env.INSTAGRAM_PAGE_ID}/messages`;
    payload = { recipient: { id: recipientId }, message: { text: body } };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Meta API: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

module.exports = { verifySignature, verifyWebhook, sendMetaMessage };
