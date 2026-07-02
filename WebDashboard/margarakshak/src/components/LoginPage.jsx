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

  return (
    <div className="auth-root">
      <div className="auth-split-card">

        {/* LEFT PANEL */}
        <div className="auth-left">
          <div className="auth-brand">
            <div className="auth-brand-icon">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2d6a4f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
</div>
            <div className="auth-brand-name">Live<em>Tracker</em></div>
            <p className="auth-brand-sub">Real-time location sharing<br />for people you trust</p>
          </div>
          <div className="auth-map-dots">
            {Array.from({ length: 40 }).map((_, i) => (
              <div key={i} className={`auth-map-dot ${[2,9,13,21,28,34].includes(i) ? "active" : [5,17,31].includes(i) ? "active2" : ""}`} />
            ))}
          </div>
          <ul className="auth-features">
            <li>Real-time GPS tracking</li>
            <li>Share with trusted people</li>
            <li>Speed &amp; accuracy metrics</li>
          </ul>
        </div>

        {/* RIGHT PANEL */}
        <div className="auth-right">
          <div className="auth-form-head">
            <h1>{tab === "signin" ? "Welcome back" : "Create account"}</h1>
            <p>{tab === "signin" ? "Sign in to continue to LiveTracker" : "Start tracking in minutes"}</p>
          </div>

          {/* Tabs */}
          <div className="auth-tabs">
            <button className={`auth-tab ${tab === "signin" ? "active" : ""}`} onClick={() => { setTab("signin"); setError(""); setMessage(""); }} type="button">Sign In</button>
            <button className={`auth-tab ${tab === "signup" ? "active" : ""}`} onClick={() => { setTab("signup"); setError(""); setMessage(""); }} type="button">Sign Up</button>
            <div className="auth-tab-indicator" style={{ transform: tab === "signin" ? "translateX(0)" : "translateX(100%)" }} />
          </div>

          {message && <div className="auth-message">{message}</div>}
          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={tab === "signin" ? handleSignIn : handleSignUp} className="auth-form">
            {tab === "signup" && (
              <div className="auth-field">
                <label>FULL NAME</label>
                <input type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} required />
              </div>
            )}
            <div className="auth-field">
              <label>EMAIL ADDRESS</label>
              <input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="auth-field">
              <label>PASSWORD</label>
              <input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <button className="auth-submit" disabled={loading} type="submit">
              {loading ? <span className="auth-spinner" /> : tab === "signin" ? "Sign in →" : "Create account →"}
            </button>
          </form>

          <div className="auth-divider">or</div>

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
      </div>
    </div>
  );
}