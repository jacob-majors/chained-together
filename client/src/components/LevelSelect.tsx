/**
 * LevelSelect — shown after "Create Room" is clicked.
 * Lets the host pick a level; clicking a level emits create_room
 * and transitions to the waiting room.
 */
import React, { useState } from 'react';
import { LEVEL_CATALOGUE, LevelInfo, getLeaderboard, formatTime } from '../types';

interface Props {
  playerName: string;
  onBack: () => void;
  onCreated: (levelId: string) => void; // called after socket create_room fires
}

const stars = (n: 1 | 2 | 3) => '★'.repeat(n) + '☆'.repeat(3 - n);

const LevelSelect: React.FC<Props> = ({ onBack, onCreated }) => {
  const [hovered, setHovered] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'flex-start', minHeight: '100vh', padding: '32px 16px',
      background: 'radial-gradient(ellipse at center, #1a1a4e 0%, #0a0a1a 100%)',
      overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28, alignSelf: 'flex-start', maxWidth: 900, width: '100%' }}>
        <button onClick={onBack} style={{
          background: 'none', border: '1px solid rgba(255,255,255,0.15)',
          color: '#aaa', borderRadius: 8, padding: '7px 14px',
          cursor: 'pointer', fontSize: 13,
        }}>
          ← Back
        </button>
        <div>
          <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>Pick a Level</h2>
          <p style={{ margin: 0, color: '#666', fontSize: 13 }}>You'll be the host — share your room code after</p>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 16, width: '100%', maxWidth: 900,
      }}>
        {LEVEL_CATALOGUE.map(level => (
          <LevelCard
            key={level.id}
            level={level}
            isHovered={hovered === level.id}
            isExpanded={expanded === level.id}
            onMouseEnter={() => setHovered(level.id)}
            onMouseLeave={() => setHovered(null)}
            onToggleLb={() => setExpanded(prev => prev === level.id ? null : level.id)}
            onPlay={() => onCreated(level.id)}
          />
        ))}
      </div>
    </div>
  );
};

const LevelCard: React.FC<{
  level: LevelInfo;
  isHovered: boolean;
  isExpanded: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onToggleLb: () => void;
  onPlay: () => void;
}> = ({ level, isHovered, isExpanded, onMouseEnter, onMouseLeave, onToggleLb, onPlay }) => {
  const lb = getLeaderboard(level.id);

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        background: isHovered ? `${level.accentColor}18` : 'rgba(255,255,255,0.04)',
        border: `1px solid ${isHovered ? level.accentColor : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 14, overflow: 'hidden',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      {/* Header */}
      <div style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 32 }}>{level.emoji}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{level.name}</div>
            <div style={{ color: '#FFD700', fontSize: 12, marginTop: 2 }}>{stars(level.difficulty)}</div>
          </div>
        </div>
        <p style={{ color: '#999', fontSize: 12, marginTop: 10, lineHeight: 1.5, margin: '10px 0 0' }}>
          {level.description}
        </p>
      </div>

      {/* Leaderboard toggle */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 20px' }}>
        <button
          onClick={onToggleLb}
          style={{
            background: 'none', border: 'none', color: '#555',
            fontSize: 12, cursor: 'pointer', padding: 0,
          }}
        >
          {isExpanded ? '▲ hide leaderboard' : `▼ leaderboard${lb.length > 0 ? ` (${lb.length})` : ''}`}
        </button>
      </div>

      {isExpanded && (
        <div style={{ padding: '0 20px 12px' }}>
          {lb.length === 0 ? (
            <div style={{ color: '#444', fontSize: 12, fontStyle: 'italic', marginBottom: 8 }}>No records yet</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 8 }}>
              <tbody>
                {lb.slice(0, 5).map((e, i) => (
                  <tr key={i}>
                    <td style={{ padding: '3px 0', color: i === 0 ? '#FFD700' : i === 1 ? '#CCC' : '#888', width: 20 }}>{i+1}</td>
                    <td style={{ color: '#ddd' }}>{e.playerName}</td>
                    <td style={{ textAlign: 'right', color: '#44FF88', fontFamily: 'monospace' }}>{formatTime(e.time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Play button */}
      <div style={{ padding: '0 14px 14px' }}>
        <button
          onClick={onPlay}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 9, border: 'none',
            background: level.accentColor, color: '#fff',
            fontWeight: 700, fontSize: 14, cursor: 'pointer',
          }}
        >
          Create Room with this Level →
        </button>
      </div>
    </div>
  );
};

export default LevelSelect;
