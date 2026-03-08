const getKey = () => localStorage.getItem('gtm_api_key') || '';

async function request(method, path, body = null, key = null) {
  const k = key || getKey();
  const headers = { 'x-api-key': k };
  if (body !== null) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method,
    headers,
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });

  // Try JSON parse; fall back to text so callers always get an object
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { success: false, error: text }; }
}

export const api = {
  get:        (path)       => request('GET',    path),
  post:       (path, body) => request('POST',   path, body),
  del:        (path)       => request('DELETE', path),
  getWithKey: (path, key)  => request('GET',    path, null, key),
};
