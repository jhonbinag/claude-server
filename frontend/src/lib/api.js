const getLocationId = () => localStorage.getItem('gtm_location_id') || '';

async function request(method, path, body = null, locationId = null) {
  const id = locationId || getLocationId();
  const headers = { 'x-location-id': id };
  if (body !== null) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method,
    headers,
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  try { return JSON.parse(text); } catch { return { success: false, error: text }; }
}

export const api = {
  get:        (path)           => request('GET',    path),
  post:       (path, body)     => request('POST',   path, body),
  del:        (path)           => request('DELETE', path),
  getWithKey: (path, locId)    => request('GET',    path, null, locId),
  postWithKey:(path, body, locId) => request('POST', path, body, locId),
};
