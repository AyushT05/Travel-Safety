import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function LoginPage() {
  const [tab, setTab] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSignIn(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
    // AuthContext listener auto-updates → App.jsx re-renders to dashboard
  }

  async function handleSignUp(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: name } }
    });
    if (error) setError(error.message);
    else setMessage("Check your email to confirm your account!");
    setLoading(false);
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
  }

  const isIn = tab === "signin";
  const switchTab = (next) => { setTab(next); setError(""); setMessage(""); };

  return (
    <div className="auth-root">
      {/* BRAND PANEL */}
      <section className="auth-art" aria-hidden="false">
        <img className="auth-logo" src="/logo-full-light.png" alt="Margarakshak" />

        <svg className="auth-map" viewBox="0 0 520 380" role="img" aria-label="A traveller's route across a map with a geofenced zone">
          <g className="auth-contours" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M-10 90C80 40 150 120 240 80S400 20 530 70" />
            <path d="M-10 140C90 90 160 170 250 130S410 70 530 120" />
            <path d="M-10 190C100 140 170 220 260 180S420 120 530 170" />
            <path d="M-10 240C110 190 180 270 270 230S430 170 530 220" />
            <path d="M-10 290C120 240 190 320 280 280S440 220 530 270" />
            <path d="M-10 340C130 290 200 370 290 330S450 270 530 320" />
          </g>
          <circle className="auth-fence" cx="372" cy="222" r="48" />
          <path className="auth-route" pathLength="1" d="M56 312C130 292 150 214 228 236S318 312 372 222S446 120 470 78" />
          {[[56,312],[228,236],[372,222],[470,78]].map(([x, y], i) => (
            <g key={i} className="auth-pin" style={{ animationDelay: `${0.5 + i * 0.85}s` }}>
              {i === 3 && <circle className="auth-pin-ring" cx={x} cy={y} r="9" />}
              <circle cx={x} cy={y} r={i === 3 ? 7 : 5} />
            </g>
          ))}
        </svg>

        <div className="auth-pitch">
          <h2>Safe passage, watched over in real time.</h2>
          <p>Live traveller locations, zone alerts and SOS response for tourism and police teams.</p>
          <ul className="auth-features">
            <li>Live traveller map</li>
            <li>Geofence and SOS alerts</li>
            <li>Incident briefs for responders</li>
          </ul>
        </div>
      </section>

      {/* FORM PANEL */}
      <main className="auth-panel">
        <div className="auth-form-wrap">
          <img className="auth-logo-small" src="/logo-full.png" alt="Margarakshak" />
          <div className="auth-form-head">
            <h1>{isIn ? "Welcome back" : "Create your account"}</h1>
            <p>{isIn ? "Sign in to open the monitoring dashboard." : "Set up access to the monitoring dashboard."}</p>
          </div>

          <div className="auth-tabs" role="tablist">
            <button role="tab" aria-selected={isIn} className={`auth-tab ${isIn ? "active" : ""}`} onClick={() => switchTab("signin")} type="button">Sign in</button>
            <button role="tab" aria-selected={!isIn} className={`auth-tab ${!isIn ? "active" : ""}`} onClick={() => switchTab("signup")} type="button">Sign up</button>
            <div className="auth-tab-indicator" style={{ transform: isIn ? "translateX(0)" : "translateX(100%)" }} />
          </div>

          {message && <div className="auth-message" role="status">{message}</div>}
          {error && <div className="auth-error" role="alert">{error}</div>}

          <form onSubmit={isIn ? handleSignIn : handleSignUp} className="auth-form">
            {!isIn && (
              <div className="auth-field">
                <label htmlFor="auth-name">Full name</label>
                <input id="auth-name" type="text" autoComplete="name" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} required />
              </div>
            )}
            <div className="auth-field">
              <label htmlFor="auth-email">Email address</label>
              <input id="auth-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="auth-field">
              <label htmlFor="auth-pass">Password</label>
              <input id="auth-pass" type="password" autoComplete={isIn ? "current-password" : "new-password"} placeholder="Enter your password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <button className="auth-submit" disabled={loading} type="submit">
              {loading ? <span className="auth-spinner" /> : isIn ? "Sign in" : "Create account"}
            </button>
          </form>

          <div className="auth-divider"><span>or</span></div>

          <button className="auth-google-btn" onClick={handleGoogle} type="button">
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908C16.658 14.027 17.64 11.72 17.64 9.2z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"/>
              <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
            </svg>
            Continue with Google
          </button>
        </div>
      </main>
    </div>
  );
}
