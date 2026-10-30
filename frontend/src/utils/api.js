// Keep API calls same-origin by default. Vite proxies /api in development,
// and frontend/vercel.json rewrites /api to the backend in production.
export const DEFAULT_API_BASE = '/api';
export const API_BASE = String(import.meta.env.VITE_API_URL || DEFAULT_API_BASE).replace(/\/+$/, '');

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, { ...options, credentials: 'include', headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
