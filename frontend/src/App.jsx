import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
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

/* ── UI Components ─────────────────────────────────────────────────────────── */
function Skeleton({ count = 3 }) {
  return (
    <div className="skeleton-wrap">
      {Array.from({ length: count }).map((_, i) => <div key={i} className="skeleton-card" />)}
    </div>
  );
}

const CATEGORY_ICONS = {
  ELECTRONICS: '💻', FURNITURE: '🪑', VEHICLES: '🚗', TOOLS: '🔧',
  OUTDOOR: '⛺', SPORTS: '⚽', MUSIC: '🎵', CAMERAS: '📷',
  OFFICE: '📎', KITCHEN: '🍳', GAMING: '🎮', GARDEN: '🌿',
};

/* ── Navbar ────────────────────────────────────────────────────────────────── */
function Navbar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const isActive = (path) => location.pathname === path ? 'active' : '';

  return (
    <nav className="navbar">
      <Link to="/" className="nav-brand">⚡ RentPi</Link>
      <div className="nav-links">
        <Link to="/products" className={isActive('/products')}>Catalog</Link>
        <Link to="/availability" className={isActive('/availability')}>Availability</Link>
        <Link to="/deals" className={isActive('/deals')}>Deals</Link>
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

/* ── Pages ─────────────────────────────────────────────────────────────────── */

// 1. HOME / TRENDING
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

  return (
    <div className="page">
      <div className="hero">
        <h1>Welcome to <span className="gradient-text">RentPi</span></h1>
        <p>Rent anything — from 🎮 Gaming consoles to 🚗 Vehicles. Real-time availability & smart pricing.</p>
      </div>

      <div className="section">
        <div className="section-header">
          <h2>🔥 Trending Today</h2>
          <button onClick={fetchTrending} className="btn btn-sm" id="refresh-trending-btn">↻ Refresh</button>
        </div>
        {loading ? <Skeleton count={6} /> : error ? <div className="error-msg">{error}</div> : (
          <div className="card-grid">
            {recs.map(r => (
              <Link to={`/products/${r.productId}`} key={r.productId} className="card product-card" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className="badge">{CATEGORY_ICONS[r.category] || '📦'} {r.category}</span>
                <h3>{r.name}</h3>
                <p className="score">🏆 Score: {r.score}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 2. PRODUCT LIST (CATALOG)
function Products() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const limit = 20;

  useEffect(() => {
    api.getCategories().then(d => setCategories(d.categories || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true); setError('');
    const params = { page, limit };
    if (category) params.category = category;
    api.products(params)
      .then(d => { setProducts(d.data || []); setTotal(d.totalPages || 0); })
      .catch(err => setError(err.error || 'Failed to load products'))
      .finally(() => setLoading(false));
  }, [category, page]);

  return (
    <div className="page">
      <h1>Catalog</h1>
      <div className="filters">
        <select id="category-filter" value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}>
          <option value="">📦 All Categories</option>
          {categories.map(c => (
            <option key={c} value={c}>{CATEGORY_ICONS[c] || ''} {c}</option>
          ))}
        </select>
      </div>
      {loading ? <Skeleton count={6} /> : error ? <div className="error-msg">{error}</div> : (
        <>
          <div className="card-grid">
            {products.map(p => (
              <Link to={`/products/${p.id}`} key={p.id} className="card product-card" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className="badge">{CATEGORY_ICONS[p.category] || '📦'} {p.category}</span>
                <h3>{p.name}</h3>
                <p className="price">${p.pricePerDay}/day</p>
              </Link>
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

// 3. PRODUCT DETAIL
function ProductDetail() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api.product(id)
      .then(setProduct)
      .catch(() => setError('Product not found'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="page"><Skeleton count={1} /></div>;
  if (error) return <div className="page"><div className="error-msg">{error}</div></div>;

  return (
    <div className="page">
      <div className="card" style={{ maxWidth: '800px', margin: '2rem auto' }}>
        <span className="badge">{CATEGORY_ICONS[product.category]} {product.category}</span>
        <h1 style={{ background: 'none', WebkitTextFillColor: 'initial', color: 'var(--text)', marginBottom: '1rem' }}>{product.name}</h1>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '2rem' }}>
          <div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
              Experience high-quality renting with RentPi. This product belongs to the <strong>{product.category}</strong> category and is maintained by a trusted owner.
            </p>
            <div className="price" style={{ fontSize: '2.5rem' }}>
              ${product.pricePerDay}
              <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 400 }}> / day</span>
            </div>
          </div>
          <div style={{ background: 'var(--bg-secondary)', padding: '1.5rem', borderRadius: 'var(--radius)' }}>
            <h4 style={{ marginBottom: '0.8rem' }}>Ownership</h4>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Listed by User: <strong>#{product.ownerId}</strong></p>
            <div style={{ marginTop: '2rem' }}>
              <Link to={`/availability?productId=${id}`} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Check Availability →</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 4. AVAILABILITY
function Availability() {
  const [searchParams] = useSearchParams();
  const [productId, setProductId] = useState(searchParams.get('productId') || '');
  const [product, setProduct] = useState(null);
  const [range, setRange] = useState({ from: '2024-03-01', to: '2024-03-14' });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (productId && productId.length > 0) {
      api.product(productId).then(setProduct).catch(() => setProduct(null));
    } else {
      setProduct(null);
    }
  }, [productId]);

  const check = async (e) => {
    e.preventDefault();
    if (!productId) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const data = await api.availability(productId, range.from, range.to);
      setResult(data);
    } catch (err) { setError(err.error || 'Check failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="page">
      <h1>Availability Checker</h1>
      <form onSubmit={check} className="avail-form">
        <div className="form-group">
          <label>Product ID</label>
          <input value={productId} onChange={e => setProductId(e.target.value)} placeholder="Enter Product ID" required />
        </div>
        <div className="form-group">
          <label>Start Date</label>
          <input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} required />
        </div>
        <div className="form-group">
          <label>End Date</label>
          <input type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} required />
        </div>
        <button className="btn btn-primary" disabled={loading}>{loading ? 'Checking...' : 'Check →'}</button>
      </form>

      {product && (
        <div className="card" style={{ marginBottom: '1.5rem', background: 'var(--primary-glow)', border: '1px solid var(--primary-light)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '2rem' }}>{CATEGORY_ICONS[product.category] || '📦'}</span>
            <div>
              <p style={{ fontWeight: 700, fontSize: '1.1rem' }}>{product.name}</p>
              <p style={{ fontSize: '0.85rem', opacity: 0.8 }}>ID: #{product.id} | Category: {product.category}</p>
            </div>
          </div>
        </div>
      )}

      {error && <div className="error-msg">{error}</div>}
      {result && (
        <div className="avail-result">
          <div className={`avail-status ${result.available ? 'available' : 'unavailable'}`}>
            {result.available ? '✅ This product is free to rent!' : '❌ Busy during this period'}
          </div>
          <div className="analytics-grid">
            <div className="card">
              <h3>Occupied Dates</h3>
              {result.busyPeriods.length > 0 ? result.busyPeriods.map((p, i) => (
                <div key={i} className="period busy">📅 {p.start} to {p.end}</div>
              )) : <p style={{ color: 'var(--text-muted)' }}>No conflicts found.</p>}
            </div>
            <div className="card">
              <h3>Free Windows</h3>
              {result.freeWindows.length > 0 ? result.freeWindows.map((p, i) => (
                <div key={i} className="period free">✨ {p.start} to {p.end}</div>
              )) : <p style={{ color: 'var(--text-muted)' }}>No free slots in this range.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 5. DEALS (Discounted Products)
function Deals() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    api.recommendations(today, 12)
      .then(d => setDeals(d.recommendations || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page">
      <h1>Exclusive Deals</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>Unlock up to 20% OFF based on your security score.</p>
      {loading ? <Skeleton count={6} /> : (
        <div className="card-grid">
          {deals.map(p => (
            <Link to={`/products/${p.productId}`} key={p.productId} className="card product-card" style={{ border: '1px solid var(--accent-glow)' }}>
              <span className="badge" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>Loyalty Discount</span>
              <h3>{p.name}</h3>
              <p className="score">Popularity: {p.score}</p>
              <div className="price">SAVE ON RENTAL</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// 6. ANALYTICS
function Analytics() {
  const [peak, setPeak] = useState(null);
  const [surge, setSurge] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.peakWindow('2024-01', '2024-06'),
      api.surgeDays('2024-03')
    ]).then(([p, s]) => { setPeak(p.peakWindow); setSurge(s.data); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page">
      <h1>Platform Analytics</h1>
      {loading ? <Skeleton count={2} /> : (
        <div className="analytics-grid">
          <div className="card analytics-card">
            <h2>📈 Peak Demand Period</h2>
            <div className="big-number">{peak?.totalRentals}</div>
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Total rentals from <strong>{peak?.from}</strong> to <strong>{peak?.to}</strong></p>
          </div>
          <div className="card analytics-card">
            <h2>⚡ Next Spikes (Surge Days)</h2>
            <div className="surge-list">
              {surge.slice(0, 10).map((d, i) => (
                <div key={i} className="surge-item">
                  <span>{d.date}</span>
                  <span className="surge-count">{d.count} rentals</span>
                  <span className="surge-next">{d.nextSurgeDate ? `↑ Next spike in ${d.daysUntil}d` : 'Max'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 7. CHAT
function Chat() {
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef();

  useEffect(() => {
    api.chatSessions().then(d => setSessions(d.sessions || []));
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const loadSession = async (id) => {
    setCurrentSessionId(id);
    const data = await api.chatHistory(id);
    setMessages(data.messages || []);
  };

  const startNewChat = () => {
    setCurrentSessionId(Math.random().toString(36).substring(2, 15));
    setMessages([]);
  };

  const send = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const msg = input;
    const sid = currentSessionId || Math.random().toString(36).substring(2, 15);
    if (!currentSessionId) setCurrentSessionId(sid);
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);
    try {
      const data = await api.chatSend(sid, msg);
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
      api.chatSessions().then(d => setSessions(d.sessions || []));
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'AI Service Error. Please try again later.' }]);
    } finally { setLoading(false); }
  };

  return (
    <div className="chat-page">
      <div className="chat-sidebar">
        <button className="btn btn-primary" onClick={startNewChat}>+ New Chat</button>
        <div className="session-list">
          {sessions.map(s => (
            <div key={s.sessionId} className={`session-item ${currentSessionId === s.sessionId ? 'active' : ''}`} onClick={() => loadSession(s.sessionId)}>
              <div className="session-name">{s.name}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="chat-main">
        <div className="messages" ref={scrollRef}>
          {messages.length === 0 && <div className="empty-chat">How can I help you with RentPi today?</div>}
          {messages.map((m, i) => (
            <div key={i} className={`message ${m.role}`}>
              <div className="bubble">{m.content}</div>
            </div>
          ))}
          {loading && <div className="message assistant"><div className="bubble typing">Assistant is typing...</div></div>}
        </div>
        <form className="chat-input" onSubmit={send}>
          <input placeholder="Ask about products, availability or stats..." value={input} onChange={e => setInput(e.target.value)} disabled={loading} />
          <button className="btn btn-primary" disabled={loading}>Send</button>
        </form>
      </div>
    </div>
  );
}

// 8. PROFILE
function Profile() {
  const { user } = useAuth();
  const [discount, setDiscount] = useState(null);

  useEffect(() => {
    if (user) api.discount(user.id).then(setDiscount).catch(() => {});
  }, [user]);

  if (!user) return <div className="page">Please sign in to view your profile.</div>;

  return (
    <div className="page">
      <h1>Your Profile</h1>
      <div className="card profile-card" style={{ marginBottom: '1.5rem' }}>
        <h2>{user.name}</h2>
        <p>{user.email}</p>
        <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>Member since: 2024</p>
      </div>
      {discount && (
        <div className="card" style={{ border: '1px solid var(--success)' }}>
          <h3 style={{ color: 'var(--success)' }}>🏆 Loyalty Reward</h3>
          <div className="discount-value" style={{ margin: '1rem 0' }}>{discount.discountPercent}% OFF</div>
          <p>Your Security Score is <strong>{discount.securityScore}</strong>. Keep it high for more savings!</p>
        </div>
      )}
    </div>
  );
}

// 9. AUTH
function Auth({ mode }) {
  const { login: authLogin } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const data = mode === 'login' ? await api.login(form) : await api.register(form);
      authLogin(data.token, data.user);
      navigate('/');
    } catch (err) { setError(err.error || 'Auth failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="page auth-page">
      <form onSubmit={submit} className="auth-form">
        <h2>{mode === 'login' ? 'Welcome Back' : 'Create Account'}</h2>
        {error && <div className="error-msg">{error}</div>}
        {mode === 'register' && <input placeholder="Full Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />}
        <input type="email" placeholder="Email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required />
        <input type="password" placeholder="Password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required />
        <button className="btn btn-primary" disabled={loading}>{loading ? '...' : (mode === 'login' ? 'Login' : 'Sign Up')}</button>
        <p>{mode === 'login' ? "Don't have an account?" : "Already have an account?"} <Link to={mode === 'login' ? '/register' : '/login'}>{mode === 'login' ? 'Sign up' : 'Login'}</Link></p>
      </form>
    </div>
  );
}

/* ── App Shell ─────────────────────────────────────────────────────────────── */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Navbar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Auth mode="login" />} />
          <Route path="/register" element={<Auth mode="register" />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/availability" element={<Availability />} />
          <Route path="/deals" element={<Deals />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
