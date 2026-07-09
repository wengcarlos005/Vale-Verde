// Chamadas HTTP autenticadas + sessão local.
export const session = {
  get token() { return localStorage.getItem('gv_token'); },
  set token(v) { v ? localStorage.setItem('gv_token', v) : localStorage.removeItem('gv_token'); },
  get user() { try { return JSON.parse(localStorage.getItem('gv_user')); } catch { return null; } },
  set user(v) { v ? localStorage.setItem('gv_user', JSON.stringify(v)) : localStorage.removeItem('gv_user'); },
};

export async function api(path, body, method) {
  const res = await fetch(path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error((data && data.error) || 'network');
    err.code = (data && data.error) || 'network';
    throw err;
  }
  return data;
}
