(function () {
  const API_URL = document.body.dataset.apiUrl || localStorage.getItem('brainmed-api-url') || 'http://localhost:3000';

  async function api(path, options = {}) {
    const token = localStorage.getItem('brainmed-token');
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Erro HTTP ${response.status}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  window.BrainMedAPI = { api, url: API_URL };

  async function bootstrap() {
    const token = localStorage.getItem('brainmed-token');
    if (!token) return;
    try {
      const me = await api('/api/me');
      document.dispatchEvent(new CustomEvent('brainmed:authenticated', { detail: me }));
    } catch {
      localStorage.removeItem('brainmed-token');
    }
  }

  document.addEventListener('submit', async event => {
    if (!event.target.matches('#brainmed-login-form')) return;
    event.preventDefault();
    const form = new FormData(event.target);
    const submit = event.target.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: String(form.get('email')), password: String(form.get('password')) }),
      });
      localStorage.setItem('brainmed-token', result.token);
      document.getElementById('brainmed-login').remove();
      document.dispatchEvent(new CustomEvent('brainmed:authenticated', { detail: result.user }));
    } catch (error) {
      event.target.querySelector('.brainmed-login-error').textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  bootstrap();
})();
