const GATEWAY = window.VITE_GATEWAY_URL || import.meta.env.VITE_GATEWAY_URL || 'http://localhost:8000';

async function request(path, options = {}) {
  const token = localStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${GATEWAY}${path}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

export const api = {
  register: (body) => request('/users/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => request('/users/login', { method: 'POST', body: JSON.stringify(body) }),
  me: () => request('/users/me'),
  discount: (id) => request(`/users/${id}/discount`),
  products: (params) => request(`/rentals/products?${new URLSearchParams(params)}`),
  product: (id) => request(`/rentals/products/${id}`),
  availability: (id, from, to) => request(`/rentals/products/${id}/availability?from=${from}&to=${to}`),
  recommendations: (date, limit = 6) => request(`/analytics/recommendations?date=${date}&limit=${limit}`),
  peakWindow: (from, to) => request(`/analytics/peak-window?from=${from}&to=${to}`),
  surgeDays: (month) => request(`/analytics/surge-days?month=${month}`),
  chatSessions: () => request('/chat/sessions'),
  chatHistory: (id) => request(`/chat/${id}/history`),
  chatSend: (sessionId, message) => request('/chat', { method: 'POST', body: JSON.stringify({ sessionId, message }) }),
  chatDelete: (id) => request(`/chat/${id}`, { method: 'DELETE' }),
  getCategories: () => request('/rentals/categories'),
};
