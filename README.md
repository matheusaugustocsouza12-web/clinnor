# BrainMed

O BrainMed possui uma interface estática em `index.html` e uma API Node.js/PostgreSQL para integração real com WhatsApp, Instagram, usuários da equipe, conversas, transferências humanas e agendamentos.

## Executar localmente

1. Instale o PostgreSQL e crie o banco `brainmed`.
2. Copie `.env.example` para `.env` e configure banco, JWT e credenciais da Meta.
3. Instale e migre:
   ```bash
   npm install
   npm run migrate
   npm run seed
   npm start
   ```
4. Sirva o front-end separadamente, por exemplo com `python3 -m http.server 4173`.

## Meta/WhatsApp/Instagram

Configure o webhook HTTPS apontando para:

```
https://SEU-DOMINIO/webhooks/meta
```

Preencha:

- `META_VERIFY_TOKEN`: mesmo valor configurado no App Meta.
- `META_APP_SECRET`: validação HMAC dos webhooks.
- `META_ACCESS_TOKEN`: token permanente ou de longa duração.
- `WHATSAPP_PHONE_NUMBER_ID`.

Para respostas humanizadas por IA, configure opcionalmente:

- `OPENAI_API_KEY`: ativa respostas contextuais da Ana.
- `OPENAI_MODEL`: modelo da Ana; o padrão é `gpt-4.1-mini`.

Sem a chave da OpenAI, a Ana continua funcionando com respostas humanas locais e fluxos seguros.
- `INSTAGRAM_PAGE_ID` ou configuração equivalente da conta profissional.

Para WhatsApp, assine o webhook de mensagens. Para Instagram, assine `messages`, além de conectar a conta profissional ao App Meta.

## Teste completo do WhatsApp e Instagram

1. Crie um App Meta do tipo **Negócios** no painel de Desenvolvedores da Meta.
2. Configure PostgreSQL, execute as migrations e inicie o servidor HTTPS público do BrainMed na porta 3000.
3. Para testar localmente, instale o ngrok e execute:
   ```bash
   ngrok http 3000
   ```
4. No App Meta, adicione os produtos **WhatsApp** e **Instagram/Messenger**.
5. Em Configuração do webhook, informe:
   - URL: `https://SEU-ENDERECO-NGROK/webhooks/meta`
   - Token de verificação: o mesmo valor de `META_VERIFY_TOKEN`
6. Assine os campos `messages` e confirme o webhook.
7. Preencha `.env` com o ID do número do WhatsApp, o Page ID da conta Instagram profissional, o token de acesso e o App Secret.
8. Envie uma mensagem pelo número de teste do WhatsApp e por uma conta Instagram conectada à página.
9. Confirme em `/api/conversations` que a origem está identificada como `whatsapp` ou `instagram` e que as mensagens foram persistidas.

Observações:
- O Meta exige HTTPS para o webhook.
- O App deve estar em modo de desenvolvimento para testes com contas adicionadas como testers.
- Para produção, submeta o App para revisão dos campos e permissões necessários.

## API

- `POST /api/auth/login`
- `GET /api/conversations`
- `POST /api/conversations/:id/messages`
- `POST /api/conversations/:id/assign`
- `GET /api/availability?professionalId=...&date=YYYY-MM-DD`
- `POST /api/appointments`
- `PATCH /api/appointments/:id`
- `GET/PUT /api/settings`
