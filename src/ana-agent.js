function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractName(message) {
  const cleaned = clean(message)
    .replace(/^(meu nome é|me chamo|pode me chamar de|sou)\s+/i, '')
    .replace(/[.!?]+$/, '');
  const words = cleaned.split(/\s+/).filter(word => /^[A-Za-zÀ-ÿ]+(?:[-'][A-Za-zÀ-ÿ]+)?$/.test(word));
  if (!words.length || words.length > 4) return '';
  return words.slice(0, 3).map(word =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ');
}

function localFallback(message, patientName, clinicName) {
  const text = clean(message).toLowerCase();
  if (/^(oi|ola|olá|bom dia|boa tarde|boa noite)[!., ]*$/.test(text)) {
    return `${patientName ? `${patientName}, ` : ''}Olá! Como posso ajudar hoje?`;
  }
  if (/cancelar|cancelamento|desmarcar/.test(text)) {
    return `Posso ajudar com o cancelamento. Para confirmar, me informe seu nome completo e a data da consulta.`;
  }
  if (/reagend|remarc|trocar.*consulta/.test(text)) {
    return `Claro. Qual é o procedimento, a data atual da consulta e para qual dia ou período você gostaria de reagendar?`;
  }
  if (/agend|marcar|consulta/.test(text)) {
    return `Vou ajudar com o agendamento. Qual procedimento você gostaria de realizar?`;
  }
  if (/procedimento|tratamento|valor|preço|preco/.test(text)) {
    return `Posso te orientar melhor. Qual procedimento ou região você tem interesse?`;
  }
  if (/tirar dúvida|tirar duvida|outros|pessoa real|humano/.test(text)) {
    return 'Entendi. Vou encaminhar você para uma pessoa da nossa equipe.';
  }
  if (patientName) {
    return `${patientName}, entendi sua mensagem. Você deseja agendar ou reagendar uma consulta, conhecer um procedimento ou falar com nossa equipe?`;
  }
  return 'Entendi. Conte-me um pouco mais sobre o que você precisa, por favor.';
}

async function generateAiReply({ message, patientName, clinicName, history, settings }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return localFallback(message, patientName, clinicName);

  const systemPrompt = [
    'Você é a assistente virtual da secretaria da clínica. Não se apresente por um nome próprio.',
    `O nome da clínica é ${clinicName}.`,
    'Fale português brasileiro com naturalidade, acolhimento e objetividade.',
    'Nunca invente preços, profissionais, horários, descontos ou disponibilidade.',
    'Não confirme agendamentos: solicite dados e diga que irá verificar os horários.',
    'Não transfira dados sensíveis e não peça CPF ou informações clínicas desnecessárias.',
    'Para dúvidas técnicas ou solicitações complexas, encaminhe para uma pessoa da equipe.',
    'Responda no máximo em dois parágrafos curtos.',
    settings.transfer_message ? settings.transfer_message : '',
  ].filter(Boolean).join('\n');

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        temperature: 0.3,
        max_tokens: 180,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.slice(-8).map(item => ({
            role: item.direction === 'inbound' ? 'user' : 'assistant',
            content: clean(item.body),
          })),
          { role: 'user', content: clean(message) },
        ],
      }),
    });
    if (!response.ok) return localFallback(message, patientName, clinicName);
    const data = await response.json();
    return clean(data.choices?.[0]?.message?.content) || localFallback(message, patientName, clinicName);
  } catch {
    return localFallback(message, patientName, clinicName);
  }
}

module.exports = { extractName, localFallback, generateAiReply };
