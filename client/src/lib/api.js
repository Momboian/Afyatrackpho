// Small helper for calling the AfyaTrack API from the website.
// The chosen ward is remembered in the browser under this key.
const WARD_KEY = 'afyatrack.ward';

// Reads the remembered ward id. try/catch protects against browsers that block storage.
export function getWardId() {
  try { return localStorage.getItem(WARD_KEY); } catch { return null; }
}
// Saves or clears the remembered ward id.
export function setWardId(id) {
  try { id ? localStorage.setItem(WARD_KEY, String(id)) : localStorage.removeItem(WARD_KEY); } catch { /* ignore */ }
}

// Error thrown when the API replies with an error. It carries the status code and the field errors
// so forms can show the message next to the right field.
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.errors = body?.errors || {};
    this.body = body;
  }
}

// Function to run when the login has expired. AuthProvider sets it to send the user back to the login page.
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

// Calls the API. Example: await api('/tasks', { method: 'POST', body: { title: 'Visit' } })
// It adds the JSON headers, the chosen ward and the login cookie, then returns the reply as JSON.
export async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ward = getWardId();
  if (ward) headers['X-Ward-Id'] = ward;
  // credentials: 'include' sends the login cookie with the request.
  const res = await fetch(`/api${path}`, { method, headers, credentials: 'include', body: body !== undefined ? JSON.stringify(body) : undefined });
  // raw = true returns the full response, used for file downloads.
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  // Login expired (401): tell the app so it shows the login page.
  if (res.status === 401 && !/^\/auth\/(login|verify|resend)/.test(path)) onUnauthorized();
  // Any other error becomes an ApiError with the server's message.
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// Builds a query string from an object, skipping empty values. Example: qs({ status: 'open' }) gives "?status=open".
export const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

// Downloads a file from the API (CSV report, Word notice) and saves it with the name sent by the server.
export async function download(path, fallbackName) {
  const res = await api(path, { raw: true });
  if (!res.ok) throw new Error('Download failed.');
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || fallbackName;
  // Create a temporary link, click it to start the download, then remove it.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
