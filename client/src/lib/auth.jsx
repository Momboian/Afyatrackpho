// Holds the login state for the whole website: who is signed in, their ward and role, and the drop down lists.
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setWardId, getWardId, setUnauthorizedHandler } from './api.js';

// Any component can call useAuth() to read the login state.
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

// Wrap the app in AuthProvider so every page shares the same login state.
export function AuthProvider({ children }) {
  // loading is true until the first check finishes. me holds the signed in user, or null.
  const [state, setState] = useState({ loading: true, me: null });
  // lookups holds the drop down lists (categories, officers, locations, templates, premises).
  const [lookups, setLookups] = useState(null);

  // Asks the server who is signed in, remembers the ward, and loads the drop down lists.
  const refresh = useCallback(async () => {
    try {
      const me = await api('/auth/me');
      if (me.ward && String(me.ward.id) !== getWardId()) setWardId(me.ward.id);
      // Load lookups first so pages never render without them
      const lk = me.ward ? await api('/lookups') : { categories: [], officers: [], locations: [], templates: [], premises: [] };
      setLookups(lk);
      setState({ loading: false, me });
    // Not signed in (or the server could not be reached).
    } catch {
      setState({ loading: false, me: null });
    }
  }, []);

  // When the page first opens: set the "login expired" handler and check the login.
  useEffect(() => {
    setUnauthorizedHandler(() => setState((s) => (s.me ? { loading: false, me: null } : s)));
    refresh();
  }, [refresh]);

  // Signs in. The server sets the login cookie, then the state is reloaded.
  // Step 1 of sign in: check the password. The server then emails a code
  // and returns { two_factor: true, challenge_id, sent_to }. If two factor is switched off, sign in finishes here.
  const login = async (email, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { email, password } });
    if (r?.two_factor) return r;
    setWardId(null);
    await refresh();
    return r;
  };
  // Step 2 of sign in: send the 6 digit code. The server sets the sign in cookie.
  const verify = async (challengeId, code) => {
    await api('/auth/verify', { method: 'POST', body: { challenge_id: challengeId, code } });
    setWardId(null);
    await refresh();
  };
  // Sign in with Google: send the ID token from the Google button. The server sets the sign in cookie.
  const loginWithGoogle = async (credential) => {
    await api('/auth/google', { method: 'POST', body: { credential } });
    setWardId(null);
    await refresh();
  };
  // Signs out and clears the remembered ward.
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setWardId(null);
    setState({ loading: false, me: null });
  };
  // Switches to another ward and reloads everything for it.
  const switchWard = async (id) => { setWardId(id); await refresh(); };
  // Reloads the drop down lists, for example after adding a new location.
  const reloadLookups = async () => setLookups(await api('/lookups'));

  // What the current user is allowed to do. Pages use this to show or hide buttons.
  // The server checks the same rules again, so hiding a button is only for convenience.
  const me = state.me;
  const role = me?.role;
  const can = {
    write: ['officer', 'ward_lead', 'admin'].includes(role),
    lead: ['ward_lead', 'admin'].includes(role),
    admin: !!me?.user?.is_admin,
    audit: !!me?.user?.is_admin || ['reviewer', 'ward_lead'].includes(role)
  };

  // Share everything with the rest of the app.
  return (
    <AuthCtx.Provider value={{ ...state, role, can, login, verify, loginWithGoogle, logout, refresh, switchWard, lookups, reloadLookups }}>
      {children}
    </AuthCtx.Provider>
  );
}

// Friendly names for each role, shown on screen.
export const ROLE_LABEL = { officer: 'PHO / Officer', ward_lead: 'Ward PHO', admin: 'System Administrator', reviewer: 'Read only reviewer' };
