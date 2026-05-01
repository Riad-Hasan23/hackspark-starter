import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { api } from './api';

/* ── Auth Context ──────────────────────────────────────────────────────────── */
const AuthCtx = React.createContext();
function useAuth() { return React.useContext(AuthCtx); }

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));

  useEffect(() => {
    if (token) {
      api.me().then(setUser).catch(() => { localStorage.removeItem('token'); setToken(null); });
    }
  }, [token]);

  const login = (t, u) => { localStorage.setItem('token', t); setToken(t); setUser(u); };
  const logout = () => { localStorage.removeItem('token'); setToken(null); setUser(null); };

  return <AuthCtx.Provider value={{ user, token, login, logout }}>{children}</AuthCtx.Provider>;
}

/* ── Skeleton Loader ───────────────────────────────────────────────────────── */
function Skeleton({ count = 3 }) {
  return (
    <div className="skeleton-wrap">
      {Array.from({ length: count }).map((_, i) => <div key={i} className="skeleton-card" />)}
    </div>
  );
}

/* ── Navbar ────────────────────────────────────────────────────────────────── */
function Navbar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const isActive = (path) => location.pathname === path ? 'active' : '';

  return (
    <nav className="navbar">
      <Link to="/" className="nav-brand">⚡ RentPi</Link>
      <div className="nav-links">
        <Link to="/products" className={isActive('/products')}>Products</Link>
        <Link to="/availability" className={isActive('/availability')}>Availability</Link>
        <Link to="/analytics" className={isActive('/analytics')}>Analytics</Link>
        <Link to="/chat" className={isActive('/chat')}>Chat</Link>
        {user ? (
          <>
            <Link to="/profile" className={isActive('/profile')}>Profile</Link>
            <button onClick={logout} className="btn btn-sm btn-ghost">Logout</button>
          </>
        ) : (
          <>
            <Link to="/login" className={isActive('/login')}>Login</Link>
            <Link to="/register" className="btn btn-sm btn-primary">Sign Up</Link>
          </>
        )}
      </div>
    </nav>
  );
}

/* ── Home / Trending Widget ────────────────────────────────────────────────── */
function Home() {
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchTrending = () => {
    setLoading(true); setError('');
    const today = new Date().toISOString().split('T')[0];
    api.recommendations(today, 6)
      .then(d => setRecs(d.recommendations || []))
      .catch(() => setError('Could not load trending products.'))
      .finally(() => setLoading(false));
  };
  useEffect(fetchTrending, []);

  const categoryIcons = {
    ELECTRONICS: '💻', FURNITURE: '🪑', VEHICLES: '🚗', TOOLS: '🔧',
    OUTDOOR: '⛺', SPORTS: '⚽', MUSIC: '🎵', CAMERAS: '📷',
    OFFICE: '📎', KITCHEN: '🍳', GAMING: '🎮', GARDEN: '🌿',
  };

  return (
    <div className="page">
      <div className="hero">
        <h1>Welcome to <span className="gradient-text">RentPi</span></h1>
        <p>Rent anything — electronics, vehicles, tools, outdoor gear & more. Smart pricing, real-time availability.</p>
      </div>

      <div className="section">
        <div className="section-header">
          <h2>🔥 Trending Today</h2>
          <button onClick={fetchTrending} className="btn btn-sm" id="refresh-trending-btn">
            ↻ Refresh
          </button>
        </div>
        {loading ? <Skeleton count={6} /> : error ? <div className="error-msg">{error}</div> : (
          <div className="card-grid">
            {recs.map(r => (
              <div key={r.productId} className="card product-card">
                <span className="badge">{categoryIcons[r.category] || '📦'} {r.category}</span>
                <h3>{r.name}</h3>
                <p className="score">🏆 Score: {r.score}</p>
              </div>
            ))}
            {recs.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No trending data available yet.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Login ─────────────────────────────────────────────────────────────────── */
function Login() {
  const { login: authLogin } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const data = await api.login(form);
      authLogin(data.token, data.user);
      nav('/');
    } catch (err) { setError(err.error || 'Login failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="page auth-page">
      <form onSubmit={submit} className="auth-form">
        <h2>Welcome Back</h2>
        <p style={{ marginTop: '-0.5rem' }}>Sign in to your RentPi account</p>
        {error && <div className="error-msg">{error}</div>}
        <input id="login-email" placeholder="Email address" type="email" value={form.email}
          onChange={e => setForm({ ...form, email: e.target.value })} required />
        <input id="login-password" placeholder="Password" type="password" value={form.password}
          onChange={e => setForm({ ...form, password: e.target.value })} required />
        <button className="btn btn-primary" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
          {loading ? '⏳ Signing in...' : 'Sign In →'}
        </button>
        <p>Don't have an account? <Link to="/register">Create one</Link></p>
      </form>
    </div>
  );
}

/* ── Register ──────────────────────────────────────────────────────────────── */
function Register() {
  const { login: authLogin } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const data = await api.register(form);
      authLogin(data.token, data.user);
      nav('/');
    } catch (err) { setError(err.error || 'Registration failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="page auth-page">
      <form onSubmit={submit} className="auth-form">
        <h2>Create Account</h2>
        <p style={{ marginTop: '-0.5rem' }}>Join RentPi and start renting today</p>
        {error && <div className="error-msg">{error}</div>}
        <input id="register-name" placeholder="Full Name" value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })} required />
        <input id="register-email" placeholder="Email address" type="email" value={form.email}
          onChange={e => setForm({ ...form, email: e.target.value })} required />
        <input id="register-password" placeholder="Create a password" type="password" value={form.password}
          onChange={e => setForm({ ...form, password: e.target.value })} required />
        <button className="btn btn-primary" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
          {loading ? '⏳ Creating...' : 'Create Account →'}
        </button>
        <p>Already have an account? <Link to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}

/* ── Products ──────────────────────────────────────────────────────────────── */
function Products() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const limit = 20;

  useEffect(() => {
    setLoading(true); setError('');
    const params = { page, limit };
    if (category) params.category = category;
    api.products(params)
      .then(d => { setProducts(d.data || []); setTotal(d.totalPages || 0); })
      .catch(err => setError(err.error || 'Failed to load products'))
      .finally(() => setLoading(false));
  }, [category, page]);

  const categories = ['', 'ELECTRONICS', 'FURNITURE', 'VEHICLES', 'TOOLS', 'OUTDOOR', 'SPORTS', 'MUSIC', 'CAMERAS', 'OFFICE', 'KITCHEN', 'GAMING', 'GARDEN'];
  const categoryIcons = {
    ELECTRONICS: '💻', FURNITURE: '🪑', VEHICLES: '🚗', TOOLS: '🔧',
    OUTDOOR: '⛺', SPORTS: '⚽', MUSIC: '🎵', CAMERAS: '📷',
    OFFICE: '📎', KITCHEN: '🍳', GAMING: '🎮', GARDEN: '🌿',
  };

  return (
    <div className="page">
      <h1>Products</h1>
      <div className="filters">
        <select id="category-filter" value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}>
          <option value="">📦 All Categories</option>
          {categories.filter(Boolean).map(c => (
            <option key={c} value={c}>{categoryIcons[c] || ''} {c}</option>
          ))}
        </select>
      </div>
      {loading ? <Skeleton count={6} /> : error ? <div className="error-msg">{error}</div> : (
        <>
          <div className="card-grid">
            {products.map(p => (
              <div key={p.id} className="card product-card">
                <span className="badge">{categoryIcons[p.category] || '📦'} {p.category}</span>
                <h3>{p.name}</h3>
                <p className="price">${p.pricePerDay}/day</p>
              </div>
            ))}
          </div>
          <div className="pagination">
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span>Page {page} of {total}</span>
            <button className="btn btn-sm" disabled={page >= total} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Availability ──────────────────────────────────────────────────────────── */
function Availability() {
  const [productId, setProductId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const check = async (e) => {
    e.preventDefault(); setLoading(true); setError(''); setResult(null);
    try {
      const data = await api.availability(productId, from, to);
      setResult(data);
    } catch (err) { setError(err.error || 'Failed to check availability'); }
    finally { setLoading(false); }
  };

  return (
    <div className="page">
      <h1>Check Availability</h1>
      <form onSubmit={check} className="avail-form">
        <div className="form-group">
          <label>Product ID</label>
          <input id="avail-product-id" type="number" placeholder="e.g. 42" value={productId}
            onChange={e => setProductId(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>From</label>
          <input id="avail-from" type="date" value={from} onChange={e => setFrom(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>To</label>
          <input id="avail-to" type="date" value={to} onChange={e => setTo(e.target.value)} required />
        </div>
        <button className="btn btn-primary" disabled={loading} style={{ alignSelf: 'flex-end' }}>
          {loading ? '⏳ Checking...' : '🔍 Check'}
        </button>
      </form>
      {error && <div className="error-msg">{error}</div>}
      {result && (
        <div className="avail-result">
          <div className={`avail-status ${result.available ? 'available' : 'unavailable'}`}>
            {result.available ? '✅ Product is Available!' : '❌ Not Available for This Period'}
          </div>
          {result.busyPeriods?.length > 0 && (
            <div className="section">
              <h3 style={{ marginBottom: '0.5rem' }}>Busy Periods</h3>
              {result.busyPeriods.map((b, i) => (
                <div key={i} className="period busy">📅 {b.start} → {b.end}</div>
              ))}
            </div>
          )}
          {result.freeWindows?.length > 0 && (
            <div className="section">
              <h3 style={{ marginBottom: '0.5rem' }}>Free Windows</h3>
              {result.freeWindows.map((f, i) => (
                <div key={i} className="period free">✅ {f.start} → {f.end}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Chat ──────────────────────────────────────────────────────────────────── */
function Chat() {
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEnd = useRef(null);

  useEffect(() => { api.chatSessions().then(d => setSessions(d.sessions || [])).catch(() => {}); }, []);
  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const loadSession = async (sid) => {
    setActiveSession(sid);
    try {
      const data = await api.chatHistory(sid);
      setMessages(data.messages || []);
    } catch { setMessages([]); }
  };

  const newChat = () => {
    setActiveSession(crypto.randomUUID());
    setMessages([]);
  };

  const send = async () => {
    if (!input.trim() || sending) return;
    const sid = activeSession || crypto.randomUUID();
    if (!activeSession) setActiveSession(sid);

    const userMsg = { role: 'user', content: input, timestamp: new Date().toISOString() };
    setMessages(m => [...m, userMsg]);
    setInput(''); setSending(true);

    try {
      const data = await api.chatSend(sid, input);
      setMessages(m => [...m, { role: 'assistant', content: data.reply, timestamp: new Date().toISOString() }]);
      api.chatSessions().then(d => setSessions(d.sessions || [])).catch(() => {});
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.', timestamp: new Date().toISOString() }]);
    } finally { setSending(false); }
  };

  const deleteSession = async (sid, e) => {
    e.stopPropagation();
    await api.chatDelete(sid);
    setSessions(s => s.filter(x => x.sessionId !== sid));
    if (activeSession === sid) { setActiveSession(null); setMessages([]); }
  };

  return (
    <div className="page chat-page">
      <div className="chat-sidebar">
        <button onClick={newChat} className="btn btn-primary" id="new-chat-btn">✨ New Chat</button>
        <div className="session-list">
          {sessions.map(s => (
            <div key={s.sessionId}
              className={`session-item ${activeSession === s.sessionId ? 'active' : ''}`}
              onClick={() => loadSession(s.sessionId)}>
              <span className="session-name">💬 {s.name || 'Untitled'}</span>
              <button className="delete-btn" onClick={(e) => deleteSession(s.sessionId, e)}>×</button>
            </div>
          ))}
        </div>
      </div>
      <div className="chat-main">
        <div className="messages">
          {messages.length === 0 && (
            <div className="empty-chat">
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🤖</div>
              <div>Hi! I'm RentPi's AI Assistant.</div>
              <div style={{ fontSize: '0.9rem', marginTop: '0.5rem', color: 'var(--text-muted)' }}>
                Ask me about products, availability, trends, or discounts.
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`message ${m.role}`}>
              <div className="bubble">{m.content}</div>
            </div>
          ))}
          {sending && (
            <div className="message assistant">
              <div className="bubble typing">⏳ Thinking...</div>
            </div>
          )}
          <div ref={messagesEnd} />
        </div>
        <div className="chat-input">
          <input id="chat-message-input" value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="Ask about rentals, products, trends..."
            disabled={sending} />
          <button onClick={send} className="btn btn-primary" disabled={sending} id="chat-send-btn">
            {sending ? '...' : '↑'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Profile ───────────────────────────────────────────────────────────────── */
function Profile() {
  const { user } = useAuth();
  const [discountInfo, setDiscountInfo] = useState(null);
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(false);

  const checkDiscount = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await api.discount(userId);
      setDiscountInfo(data);
    } catch { setDiscountInfo(null); }
    finally { setLoading(false); }
  };

  return (
    <div className="page">
      <h1>User Profile</h1>
      {user && (
        <div className="card profile-card">
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>👤</div>
          <h2>{user.name}</h2>
          <p>{user.email}</p>
        </div>
      )}
      <div className="section">
        <h2 style={{ marginBottom: '1rem' }}>🏷️ Check Discount Tier</h2>
        <div className="inline-form">
          <input type="number" placeholder="User ID (from Central API)" value={userId}
            onChange={e => setUserId(e.target.value)} />
          <button className="btn btn-primary" onClick={checkDiscount} disabled={loading}>
            {loading ? '⏳...' : '🔍 Check'}
          </button>
        </div>
        {discountInfo && (
          <div className="card discount-card">
            <h3>User #{discountInfo.userId}</h3>
            <p style={{ color: 'var(--text-secondary)' }}>
              Security Score: <strong style={{ color: 'var(--text)' }}>{discountInfo.securityScore}</strong>
            </p>
            <p className="discount-value">{discountInfo.discountPercent}% OFF</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Analytics Dashboard ───────────────────────────────────────────────────── */
function Analytics() {
  const [peakData, setPeakData] = useState(null);
  const [surgeData, setSurgeData] = useState(null);
  const [peakFrom, setPeakFrom] = useState('2024-01');
  const [peakTo, setPeakTo] = useState('2024-06');
  const [surgeMonth, setSurgeMonth] = useState('2024-03');
  const [loading, setLoading] = useState({});

  const fetchPeak = async () => {
    setLoading(l => ({ ...l, peak: true }));
    try { const d = await api.peakWindow(peakFrom, peakTo); setPeakData(d); } catch {}
    finally { setLoading(l => ({ ...l, peak: false })); }
  };

  const fetchSurge = async () => {
    setLoading(l => ({ ...l, surge: true }));
    try { const d = await api.surgeDays(surgeMonth); setSurgeData(d); } catch {}
    finally { setLoading(l => ({ ...l, surge: false })); }
  };

  return (
    <div className="page">
      <h1>Analytics Dashboard</h1>
      <div className="analytics-grid">
        <div className="card analytics-card">
          <h2>🏔️ Peak 7-Day Window</h2>
          <div className="inline-form">
            <input type="month" value={peakFrom} onChange={e => setPeakFrom(e.target.value)} />
            <input type="month" value={peakTo} onChange={e => setPeakTo(e.target.value)} />
            <button className="btn btn-primary" onClick={fetchPeak} disabled={loading.peak}>
              {loading.peak ? '⏳ Loading...' : '📊 Find Peak'}
            </button>
          </div>
          {peakData?.peakWindow && (
            <div className="peak-result">
              <p className="big-number">{peakData.peakWindow.totalRentals}</p>
              <p>Total rentals from {peakData.peakWindow.from} to {peakData.peakWindow.to}</p>
            </div>
          )}
        </div>
        <div className="card analytics-card">
          <h2>⚡ Surge Days</h2>
          <div className="inline-form">
            <input type="month" value={surgeMonth} onChange={e => setSurgeMonth(e.target.value)} />
            <button className="btn btn-primary" onClick={fetchSurge} disabled={loading.surge}>
              {loading.surge ? '⏳ Loading...' : '📈 Analyze'}
            </button>
          </div>
          {surgeData?.data && (
            <div className="surge-list">
              {surgeData.data.slice(0, 10).map((d, i) => (
                <div key={i} className="surge-item">
                  <span>📅 {d.date}</span>
                  <span className="surge-count">{d.count} rentals</span>
                  <span className="surge-next">
                    {d.nextSurgeDate ? `Next: ${d.nextSurgeDate} (${d.daysUntil}d)` : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── App ───────────────────────────────────────────────────────────────────── */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Navbar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/products" element={<Products />} />
          <Route path="/availability" element={<Availability />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
