/** Waiting room — shown after create/join, before game starts. */
import React from 'react';
import { PlayerState } from '../types';
import { getSocket } from '../socket';

interface Props {
  roomCode:      string;
  levelName:     string;
  players:       PlayerState[];
  localPlayerId: string;
  hostId:        string;
  isReady:       boolean;
  onReady:       () => void;
  onStart:       () => void;
  onBack:        () => void;
}

const Lobby: React.FC<Props> = ({
  roomCode, levelName, players, localPlayerId, hostId, isReady, onReady, onStart, onBack,
}) => {
  const isHost = localPlayerId === hostId || getSocket().id === hostId;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', gap: 24,
      background: 'radial-gradient(ellipse at center, #1a1a4e 0%, #0a0a1a 100%)',
    }}>
      {/* Room code */}
      <div style={{ textAlign: 'center' }}>
        <p style={{ color: '#666', fontSize: 13, margin: '0 0 6px' }}>Share this code with friends</p>
        <div style={{
          fontSize: 46, fontWeight: 900, letterSpacing: 10,
          fontFamily: 'monospace', color: '#FFD700',
          background: 'rgba(255,215,0,0.08)', borderRadius: 12,
          padding: '10px 28px', border: '1px solid rgba(255,215,0,0.2)',
        }}>
          {roomCode}
        </div>
        <p style={{ color: '#555', fontSize: 12, marginTop: 8 }}>Level: <b style={{ color: '#ccc' }}>{levelName}</b></p>
      </div>

      {/* Player list */}
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: 14, padding: '20px 26px', width: 380,
      }}>
        <div style={{ fontSize: 11, color: '#666', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>
          Players ({players.length}/4)
        </div>

        {players.map(p => (
          <div key={p.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}>
            <div style={{ width: 16, height: 16, borderRadius: 4, background: p.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontWeight: p.id === localPlayerId ? 700 : 400 }}>
              {p.name}{p.id === localPlayerId ? ' (you)' : ''}
            </span>
            {p.id === hostId && (
              <span style={{ fontSize: 10, color: '#FFD700', border: '1px solid #FFD70033', borderRadius: 4, padding: '2px 7px' }}>HOST</span>
            )}
            {p.isReady && (
              <span style={{ fontSize: 10, color: '#44FF88', border: '1px solid #44FF8833', borderRadius: 4, padding: '2px 7px' }}>READY</span>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          {!isReady && (
            <button
              onClick={onReady}
              style={{
                flex: 1, padding: '11px 0', borderRadius: 9, border: 'none',
                background: '#44AA66', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}
            >
              ✓ Ready
            </button>
          )}
          {isHost && (
            <button
              onClick={onStart}
              style={{
                flex: 1, padding: '11px 0', borderRadius: 9, border: 'none',
                background: '#FF6644', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}
            >
              ▶ Start Game
            </button>
          )}
          {!isHost && isReady && (
            <div style={{ flex: 1, textAlign: 'center', color: '#555', paddingTop: 12, fontSize: 13 }}>
              Waiting for host to start…
            </div>
          )}
        </div>
      </div>

      <button onClick={onBack} style={{
        background: 'none', border: 'none', color: '#444',
        cursor: 'pointer', fontSize: 13,
      }}>
        ← Leave room
      </button>
    </div>
  );
};

export default Lobby;
