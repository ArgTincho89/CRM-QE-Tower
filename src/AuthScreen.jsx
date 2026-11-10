import { useEffect, useRef, useState } from 'react';
import { login, register } from './api.js';

const MIN_PASSWORD_LENGTH = 8;

export default function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerInviteCode, setRegisterInviteCode] = useState('');

  const firstFieldRef = useRef(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, [mode]);

  const switchMode = (next) => {
    if (next === mode) return;
    setError('');
    setMode(next);
  };

  const submitLogin = async (event) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const { user } = await login({
        email: loginEmail.trim(),
        password: loginPassword,
      });
      onAuthenticated(user);
    } catch (err) {
      setError(err?.message || 'No se pudo iniciar sesión.');
    } finally {
      setBusy(false);
    }
  };

  const submitRegister = async (event) => {
    event.preventDefault();
    if (busy) return;
    setError('');

    if (registerPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }

    setBusy(true);
    try {
      const { user } = await register({
        email: registerEmail.trim(),
        name: registerName.trim(),
        password: registerPassword,
        inviteCode: registerInviteCode.trim(),
      });
      onAuthenticated(user);
    } catch (err) {
      setError(err?.message || 'No se pudo crear la cuenta.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <img className="brand-logo" src="/logo-seidor.jpeg" alt="SEIDOR" />
          <div className="auth-brand-text">
            <span className="eyebrow">SEIDOR · QUALITY ENGINEERING</span>
            <h1 id="auth-title">CRM QE</h1>
            <p>Tablero comercial compartido del equipo QE.</p>
          </div>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="Acceso">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={`auth-tab${mode === 'login' ? ' active' : ''}`}
            onClick={() => switchMode('login')}
            disabled={busy}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={`auth-tab${mode === 'register' ? ' active' : ''}`}
            onClick={() => switchMode('register')}
            disabled={busy}
          >
            Crear cuenta
          </button>
        </div>

        {mode === 'login' ? (
          <form className="auth-form" onSubmit={submitLogin} noValidate>
            <label className="form-field">
              Email
              <input
                ref={firstFieldRef}
                type="email"
                autoComplete="username"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                placeholder="tu@empresa.com"
                required
                disabled={busy}
              />
            </label>
            <label className="form-field">
              Contraseña
              <input
                type="password"
                autoComplete="current-password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="••••••••"
                required
                disabled={busy}
              />
            </label>
            <button className="button button-primary auth-submit" type="submit" disabled={busy}>
              {busy ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={submitRegister} noValidate>
            <label className="form-field">
              Nombre
              <input
                ref={firstFieldRef}
                type="text"
                autoComplete="name"
                value={registerName}
                onChange={(event) => setRegisterName(event.target.value)}
                placeholder="Nombre y apellido"
                required
                disabled={busy}
              />
            </label>
            <label className="form-field">
              Email
              <input
                type="email"
                autoComplete="email"
                value={registerEmail}
                onChange={(event) => setRegisterEmail(event.target.value)}
                placeholder="tu@empresa.com"
                required
                disabled={busy}
              />
            </label>
            <label className="form-field">
              Contraseña
              <input
                type="password"
                autoComplete="new-password"
                value={registerPassword}
                onChange={(event) => setRegisterPassword(event.target.value)}
                placeholder="Mínimo 8 caracteres"
                required
                disabled={busy}
              />
            </label>
            <label className="form-field">
              Código de invitación
              <input
                type="text"
                autoComplete="off"
                value={registerInviteCode}
                onChange={(event) => setRegisterInviteCode(event.target.value)}
                placeholder="Te lo proporciona quien administra el tablero"
                required
                disabled={busy}
              />
              <span className="field-hint">Te lo proporciona quien administra el tablero.</span>
            </label>
            <button className="button button-primary auth-submit" type="submit" disabled={busy}>
              {busy ? 'Creando cuenta…' : 'Crear cuenta'}
            </button>
          </form>
        )}

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <p className="auth-note">
          El primer usuario que se registre será el administrador del tablero.
        </p>
      </section>
    </div>
  );
}
