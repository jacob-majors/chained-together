import React, { useState } from 'react';

interface Props {
  onCreateRoom: (playerName: string) => void;
  onJoinRoom:   (playerName: string, code: string) => void;
  error: string;
}

const Home: React.FC<Props> = ({ onCreateRoom, onJoinRoom, error }) => {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const create = () => {
    if (!name.trim()) return;
    onCreateRoom(name.trim());
  };

  const join = () => {
    if (!name.trim() || !code.trim()) return;
    onJoinRoom(name.trim(), code.trim().toUpperCase());
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', gap: 32,
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

      {/* Main card */}
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

        {/* Name */}
        <label style={{ fontSize: 11, color: '#888', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 7 }}>
          Your Name
        </label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && create()}
          placeholder="e.g. ClimbBot9000"
          maxLength={16}
          style={{
            width: '100%', padding: '11px 14px', borderRadius: 9,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(255,255,255,0.07)', color: '#fff',
            fontSize: 15, outline: 'none', marginBottom: 18, boxSizing: 'border-box',
          }}
        />

        {/* Create room */}
        <button
          onClick={create}
          disabled={!name.trim()}
          style={{
            padding: '13px 0', borderRadius: 10, border: 'none',
            background: name.trim() ? '#FF6644' : '#444',
            color: '#fff', fontWeight: 700, fontSize: 16,
            cursor: name.trim() ? 'pointer' : 'default',
            letterSpacing: 0.5, marginBottom: 22, width: '100%',
            transition: 'background 0.15s',
          }}
        >
          Create Room →
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
          <span style={{ color: '#444', fontSize: 12 }}>or join existing</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
        </div>

        {/* Join row */}
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
      </div>

      <p style={{ color: '#333', fontSize: 12 }}>
        WASD — move · Space — jump · Mouse drag — rotate camera
      </p>
    </div>
  );
};

export default Home;
