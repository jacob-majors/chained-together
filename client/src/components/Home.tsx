import React, { useState } from 'react';

interface Props {
  onCreateRoom:  (playerName: string) => void;
  onJoinRoom:    (playerName: string, code: string) => void;
  onSplitScreen: (p1Name: string, p2Name: string) => void;
  error: string;
}

type Tab = 'online' | 'split';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px', borderRadius: 9,
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(255,255,255,0.07)', color: '#fff',
  fontSize: 15, outline: 'none', boxSizing: 'border-box',
};

const Home: React.FC<Props> = ({ onCreateRoom, onJoinRoom, onSplitScreen, error }) => {
  const [tab, setTab]     = useState<Tab>('online');
  const [name, setName]   = useState('');
  const [code, setCode]   = useState('');
  const [p1, setP1]       = useState('');
  const [p2, setP2]       = useState('');

  const create = () => { if (name.trim()) onCreateRoom(name.trim()); };
  const join   = () => { if (name.trim() && code.trim()) onJoinRoom(name.trim(), code.trim().toUpperCase()); };
  const split  = () => { if (p1.trim() && p2.trim()) onSplitScreen(p1.trim(), p2.trim()); };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', gap: 28,
      background: 'radial-gradient(ellipse at center, #1a1a4e 0%, #0a0a1a 100%)',
    }}>
      {/* Title */}
      <div style={{ textAlign: 'center', userSelect: 'none' }}>
        <h1 style={{
          fontSize: 52, fontWeight: 900, margin: 0, letterSpacing: -2,
          background: 'linear-gradient(135deg,#FF6644 0%,#FFDD44 50%,#44FFAA 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          ⛓ ASCENT TOGETHER
        </h1>
        <p style={{ color: '#666', marginTop: 8, fontSize: 15 }}>
          2–4 players · stay chained · reach the top
        </p>
      </div>

      {/* Mode tabs */}
      <div style={{
        display: 'flex', borderRadius: 12, overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.1)', width: 380,
      }}>
        {(['online', 'split'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: '11px 0', border: 'none', cursor: 'pointer',
              fontWeight: 700, fontSize: 14, transition: 'background 0.15s',
              background: tab === t ? (t === 'split' ? '#7744CC' : '#FF6644') : 'rgba(255,255,255,0.04)',
              color: tab === t ? '#fff' : '#555',
            }}
          >
            {t === 'online' ? '🌐 Online' : '🖥️ Split Screen'}
          </button>
        ))}
      </div>

      {/* Card */}
      <div style={{
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 16, padding: '28px 32px', width: 380,
        display: 'flex', flexDirection: 'column', gap: 0,
      }}>
        {error && (
          <div style={{
            background: '#FF444422', border: '1px solid #FF4444', borderRadius: 8,
            padding: '8px 14px', marginBottom: 16, fontSize: 14, color: '#FF9999',
          }}>
            {error}
          </div>
        )}

        {tab === 'online' ? (
          <>
            <label style={{ fontSize: 11, color: '#888', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 7 }}>
              Your Name
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && create()}
              placeholder="e.g. ClimbBot9000"
              maxLength={16}
              style={{ ...inputStyle, marginBottom: 18 }}
            />

            <button
              onClick={create}
              disabled={!name.trim()}
              style={{
                padding: '13px 0', borderRadius: 10, border: 'none',
                background: name.trim() ? '#FF6644' : '#333',
                color: '#fff', fontWeight: 700, fontSize: 16,
                cursor: name.trim() ? 'pointer' : 'default',
                letterSpacing: 0.5, marginBottom: 22, width: '100%',
                transition: 'background 0.15s',
              }}
            >
              Create Room →
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
              <span style={{ color: '#444', fontSize: 12 }}>or join existing</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && join()}
                placeholder="CODE"
                maxLength={4}
                style={{
                  flex: 1, padding: '11px 14px', borderRadius: 9,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.07)', color: '#fff',
                  fontSize: 18, outline: 'none', letterSpacing: 5,
                  textTransform: 'uppercase', textAlign: 'center', boxSizing: 'border-box',
                }}
              />
              <button
                onClick={join}
                disabled={!name.trim() || !code.trim()}
                style={{
                  padding: '11px 20px', borderRadius: 9, border: 'none',
                  background: name.trim() && code.trim() ? '#4488FF' : '#333',
                  color: '#fff', fontWeight: 700, fontSize: 15,
                  cursor: name.trim() && code.trim() ? 'pointer' : 'default',
                  whiteSpace: 'nowrap',
                }}
              >
                Join
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 13, color: '#888', lineHeight: 1.6 }}>
                Two players, one screen.<br />
                <span style={{ color: '#44AAFF' }}>P1</span> uses <b>WASD + Space</b> · <span style={{ color: '#FF8844' }}>P2</span> uses <b>Arrow Keys + Enter</b>
              </div>
            </div>

            <label style={{ fontSize: 11, color: '#44AAFF', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 7 }}>
              Player 1 Name
            </label>
            <input
              value={p1}
              onChange={e => setP1(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && split()}
              placeholder="e.g. Player One"
              maxLength={16}
              style={{ ...inputStyle, marginBottom: 14, borderColor: 'rgba(68,170,255,0.35)' }}
            />

            <label style={{ fontSize: 11, color: '#FF8844', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 7 }}>
              Player 2 Name
            </label>
            <input
              value={p2}
              onChange={e => setP2(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && split()}
              placeholder="e.g. Player Two"
              maxLength={16}
              style={{ ...inputStyle, marginBottom: 22, borderColor: 'rgba(255,136,68,0.35)' }}
            />

            <button
              onClick={split}
              disabled={!p1.trim() || !p2.trim()}
              style={{
                padding: '13px 0', borderRadius: 10, border: 'none',
                background: p1.trim() && p2.trim() ? '#7744CC' : '#333',
                color: '#fff', fontWeight: 700, fontSize: 16,
                cursor: p1.trim() && p2.trim() ? 'pointer' : 'default',
                width: '100%', transition: 'background 0.15s',
              }}
            >
              Play Split Screen →
            </button>
          </>
        )}
      </div>

      <p style={{ color: '#333', fontSize: 12 }}>
        {tab === 'online'
          ? 'WASD — move · Space — jump · Mouse drag — rotate camera'
          : 'P1: WASD+Space  ·  P2: Arrows+Enter  ·  Mouse drag — rotate each camera'
        }
      </p>
    </div>
  );
};

export default Home;
