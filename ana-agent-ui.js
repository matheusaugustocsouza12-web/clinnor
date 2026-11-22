(function () {
  class AnaAgent {
    constructor(clinicName) {
      this.clinicName = clinicName || 'Clínica Lumina';
      this.reset();
    }

    reset() {
      this.phase = 'name';
      this.patientName = '';
      this.context = {};
    }

    greeting() {
      return `Olá! Seja bem-vindo(a) à ${this.clinicName}. Para oferecer um atendimento mais próximo, como gostaria de ser chamado(a)?`;
    }

    extractName(message) {
      let text = String(message || '').trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[.!?,]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^(oi|ola|bom dia|boa tarde|boa noite)([, ]+)/i, '')
        .replace(/^(oi|ola|bom dia|boa tarde|boa noite)$/i, '')
        .replace(/^(meu nome e|me chamo|pode me chamar de|sou)\s+/i, '')
        .trim();

      if (text.length < 2 || text.length > 60) return null;
      if (/^(oi|ola|olá|bom dia|boa tarde|boa noite|quero|preciso|gostaria|sim|não|nao)\b/i.test(text)) return null;

      const words = text.split(/\s+/).filter(word => /^[A-Za-zÀ-ÿ]+(?:[-'][A-Za-zÀ-ÿ]+)?$/.test(word));
      if (words.length < 1 || words.length > 4) return null;
      return words.map(word => word.charAt(0).toLocaleUpperCase('pt-BR') + word.slice(1).toLocaleLowerCase('pt-BR')).join(' ');
    }

    options() {
      return ['Realizar Agendamento', 'Reagendar consulta', 'Procedimentos', 'Tirar dúvida', 'Outros'];
    }

    isHumanRequest(text) {
      return /\b(tirar d(u|ú)vida|falar com pessoa|atendente|humano|outros|especialista)\b/i.test(text);
    }

    respond(message) {
      const text = String(message || '').trim();
      if (!text) return 'Pode repetir? Não consegui entender sua mensagem.';

      if (this.phase === 'name') {
        const name = this.extractName(text);
        if (!name) {
          return 'Para começarmos, me informe apenas seu nome, por favor. Por exemplo: “Meu nome é Mariana”.';
        }
        this.patientName = name;
        this.phase = 'options';
        return `${name}, é um prazer falar com você. Em que posso ajudar hoje?`;
      }

      const normalized = text.toLowerCase();
      if (this.isHumanRequest(normalized)) {
        this.phase = 'human';
        return 'Entendi. Vou encaminhar você para uma pessoa da nossa equipe. Em poucos minutos alguém assumirá o atendimento.';
      }

      if (/cancel(ar|amento)|desmarc/.test(normalized)) {
        this.phase = 'cancel';
        return `Sem problemas, ${this.patientName}. Para cancelar com segurança, me informe o nome do procedimento e a data ou o horário da consulta.`;
      }

      if (/reagend|remarc|mudar.*consulta|trocar.*horário|trocar.*horario/.test(normalized)) {
        this.phase = 'reschedule';
        const booking = JSON.parse(localStorage.getItem('brainmed-current-booking') || 'null');
        if (booking) {
          window.dispatchEvent(new CustomEvent('ana:reschedule-requested', { detail: { booking } }));
          return '';
        }
        return `Claro, ${this.patientName}. Vou localizar sua próxima consulta. Informe o nome do procedimento ou me envie a data em que você está agendado.`;
      }

      if (this.phase === 'appointment') {
        const procedure = this.extractProcedure(normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
        if (procedure) {
          this.context.procedure = procedure;
          window.dispatchEvent(new CustomEvent('ana:procedure-selected', { detail: { procedure } }));
          return '';
        }
      }

      if (this.phase === 'procedure') {
        const procedure = this.extractProcedure(normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
        if (procedure) {
          this.context.procedure = procedure;
          window.dispatchEvent(new CustomEvent('ana:procedure-selected', {
            detail: { procedure, intent: 'procedure-info' }
          }));
          return '';
        }
        return `Qual procedimento você gostaria de conhecer? ${String(localStorage.getItem('brainmed-ana-procedures') || '').split('\n').filter(Boolean).join(', ')}.`;
      }

      if (/agend|marcar|consulta|horário disponível|horario disponivel/.test(normalized)) {
        this.phase = 'appointment';
        const procedure = this.extractProcedure(normalized);
        if (procedure) {
          this.context.procedure = procedure;
          const preferredDay = this.extractDay(normalized);
          if (!preferredDay) {
            return `Perfeito, ${this.patientName}. Para o agendamento de ${procedure}, em qual dia você prefere ser atendida? Posso consultar a disponibilidade.`;
          }
          return `Entendi, ${this.patientName}. Você gostaria de fazer ${procedure} na ${preferredDay}. Qual período fica melhor para você: manhã ou tarde?`;
        }
        return `Vou ajudar com isso, ${this.patientName}. Qual procedimento você gostaria de realizar?`;
      }

      if (this.phase === 'appointment') {
        const procedure = this.extractProcedure(normalized);
        if (procedure) {
          this.context.procedure = procedure;
          return `Perfeito, ${this.patientName}. Você gostaria de fazer ${procedure} em qual dia? Posso consultar a disponibilidade.`;
        }
      }

      if (/procediment|tratamento|valor|preço|preco|quanto custa/.test(normalized)) {
        this.phase = 'procedure';
        return `Posso te explicar melhor, ${this.patientName}. Qual procedimento ou região você tem interesse?`;
      }

      if (/^(oi|ola|olá|bom dia|boa tarde|boa noite)[!., ]*$/.test(normalized)) {
        return `${this.patientName}, oi! Como posso ajudar?`;
      }

      return `Entendi, ${this.patientName}. Você pode me dizer se deseja realizar ou reagendar uma consulta, conhecer procedimentos ou falar com nossa equipe?`;
    }

    extractProcedure(text) {
      const normalizedText = String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const configuredProcedures = String(localStorage.getItem('brainmed-ana-procedures') || '')
        .split('\n')
        .map(value => value.trim())
        .filter(Boolean);
      const configuredMatch = configuredProcedures.find(procedure => {
        const normalizedProcedure = procedure.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        return normalizedText.includes(normalizedProcedure) ||
          normalizedProcedure.split(/\s+/).filter(word => word.length >= 4).some(word => normalizedText.includes(word));
      });
      if (configuredMatch) return configuredMatch;
      const procedures = [
        ['botox', 'toxina botulínica'],
        ['toxin', 'toxina botulínica'],
        ['preenchimento', 'preenchimento'],
        ['bioestimulador', 'bioestimulador'],
        ['harmonização', 'harmonização facial'],
        ['laser', 'laser'],
        ['limpeza de pele', 'limpeza de pele'],
        ['acido hialuronico', 'ácido hialurônico'],
        ['ácido hialurônico', 'ácido hialurônico'],
        ['preenchimento labial', 'preenchimento labial'],
        ['preenchimento facial', 'preenchimento facial'],
        ['sculptra', 'sculptra'],
        ['radiesse', 'radiesse'],
        ['enzima', 'enzimas de gordura'],
        ['enzimas', 'enzimas de gordura'],
        ['microagulhamento', 'microagulhamento'],
        ['peeling', 'peeling'],
        ['criolipolise', 'criolipólise'],
        ['criolipólise', 'criolipólise'],
        ['depilacao a laser', 'depilação a laser'],
        ['depilação a laser', 'depilação a laser'],
        ['lifting', 'lifting facial'],
        ['fio de pdo', 'fios de PDO'],
        ['fios de pdo', 'fios de PDO'],
        ['skinbooster', 'skinbooster'],
        ['hidratacao', 'hidratação facial'],
        ['hidratação', 'hidratação facial'],
        ['limpeza', 'limpeza de pele'],
        ['consulta de avaliacao', 'consulta de avaliação'],
        ['consulta', 'consulta de avaliação'],
      ];
      return procedures.find(([key]) =>
        normalizedText.includes(key.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
      )?.[1] || '';
    }

    extractDay(text) {
      const days = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
      const found = days.find(day => text.includes(day) || text.includes(day.replace('-feira', '')));
      if (found) return found;
      if (/hoje/.test(text)) return 'hoje';
      if (/amanhã/.test(text)) return 'amanhã';
      return '';
    }
  }

  window.BrainMedAnaAgent = AnaAgent;
})();
