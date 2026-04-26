import { useState, useRef, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface LoginProps {
  onLogin: (email: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // IntersectionObserver — exactly as your script.js
  useEffect(() => {
    const elements = document.querySelectorAll('.animate-on-scroll');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
          } else {
            entry.target.classList.remove('is-visible');
          }
        });
      },
      { threshold: 0.3 }
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Smooth video scrubbing — lerp toward target time
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let targetTime = 0;
    let currentTime = 0;
    const ease = 0.08;
    let raf = 0;

    const onScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll > 0) {
        targetTime = video.duration * (scrollTop / maxScroll);
      }
    };

    function renderLoop() {
      const diff = targetTime - currentTime;
      if (Math.abs(diff) > 0.01) {
        currentTime += diff * ease;
        if (currentTime >= 0 && currentTime <= video.duration) {
          video.currentTime = currentTime;
        }
      }
      raf = requestAnimationFrame(renderLoop);
    }

    const bind = () => {
      window.addEventListener('scroll', onScroll, { passive: true });
      raf = requestAnimationFrame(renderLoop);
    };

    if (video.readyState >= 1) bind();
    else video.addEventListener('loadedmetadata', bind);

    return () => {
      video.removeEventListener('loadedmetadata', bind);
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    document.body.style.backgroundColor = '#0f172a';
    return () => { document.body.style.backgroundColor = ''; };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    document.body.style.backgroundColor = '';
    setTimeout(() => onLogin(email || 'installer@tectum.de'), 600);
  };

  return (
    <>
      <style>{`
        .animate-on-scroll {
          opacity: 0;
          transform: translateY(40px);
          transition: opacity 0.8s ease-out, transform 0.8s ease-out;
          will-change: opacity, transform;
        }
        .animate-on-scroll.is-visible {
          opacity: 1;
          transform: translateY(0);
        }

        .login-input {
          padding: 1rem;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: transparent;
          color: white;
          font-size: 0.95rem;
          font-family: 'Inter', system-ui, sans-serif;
          outline: none;
          width: 100%;
          box-sizing: border-box;
        }
        .login-input:focus {
          border-color: #3b82f6;
        }
        .login-input::placeholder {
          color: rgba(255,255,255,0.4);
        }

        .login-btn {
          padding: 1rem;
          border: none;
          border-radius: 8px;
          background-color: #3b82f6;
          color: white;
          font-size: 1rem;
          font-family: 'Inter', system-ui, sans-serif;
          font-weight: 600;
          cursor: pointer;
          width: 100%;
          transition: background-color 0.2s;
          letter-spacing: 0.01em;
        }
        .login-btn:hover { background-color: #2563eb; }
        .login-btn:disabled { opacity: 0.5; cursor: default; }
      `}</style>

      {/* Background video — fixed, behind everything */}
      <video
        ref={videoRef}
        muted
        playsInline
        preload="auto"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          objectFit: 'cover',
          zIndex: -1,
          opacity: 0.6,
        }}
      >
        <source src="/hero.mp4" type="video/mp4" />
      </video>

      {/* Scroll container — transparent so video shows through */}
      <main style={{ position: 'relative', zIndex: 1 }}>
        {/* Section 1 — Logo + Brand, center-right */}
        <section
          style={{
            minHeight: '100vh',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            padding: 'clamp(2rem, 5vw, 5rem)',
          }}
        >
          <div className="animate-on-scroll" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <h1
              style={{
                fontSize: 'clamp(6rem, 16vw, 12rem)',
                fontWeight: 700,
                margin: 0,
                letterSpacing: '-0.02em',
                lineHeight: 0.85,
                color: '#f8fafc',
                fontFamily: "'Inter', system-ui, sans-serif",
                textShadow: '0 4px 30px rgba(0,0,0,0.5), 0 1px 3px rgba(0,0,0,0.3)',
              }}
            >
              Tectum
            </h1>
            <p
              style={{
                fontFamily: "'Inter', system-ui, sans-serif",
                fontSize: '0.75rem',
                fontWeight: 500,
                letterSpacing: '0.3em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.25)',
                marginTop: '1.5rem',
              }}
            >
              Solar Design Platform
            </p>
          </div>
        </section>

        {/* Section 2 — Login */}
        <section
          style={{
            minHeight: '100vh',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
            padding: '2rem',
          }}
        >
          <div className="animate-on-scroll">
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.22)',
                backdropFilter: 'blur(30px)',
                WebkitBackdropFilter: 'blur(30px)',
                padding: '3rem',
                borderRadius: '16px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                width: '100%',
                maxWidth: '400px',
              }}
            >
              <h2
                style={{
                  color: '#f8fafc',
                  fontSize: '1.75rem',
                  fontWeight: 400,
                  marginBottom: '2rem',
                  fontFamily: "'Instrument Serif', Georgia, serif",
                  letterSpacing: '-0.01em',
                }}
              >
                Welcome Back
              </h2>

              <form
                onSubmit={handleSubmit}
                style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
              >
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email Address"
                  className="login-input"
                />
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    className="login-input"
                    style={{ paddingRight: '3rem' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'rgba(255,255,255,0.3)',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <button type="submit" disabled={loading} className="login-btn">
                  {loading ? 'Signing in…' : 'Login'}
                </button>
              </form>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
