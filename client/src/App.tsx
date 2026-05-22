/**
 * App — centralised socket state + screen routing.
 *
 * Flow:
 *   home ──► pick_level ──► waiting ──► game ──► victory
 *       └──► waiting (join)
 *
 * All socket.io listeners live here so nothing is registered twice.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Home       from './components/Home';
import LevelSelect from './components/LevelSelect';
import Lobby      from './components/Lobby';
import GameCanvas from './game/GameCanvas';
import { PlayerState, LEVEL_CATALOGUE, saveLeaderboardEntry, formatTime } from './types';
import { getSocket } from './socket';

type Screen = 'home' | 'pick_level' | 'waiting' | 'game' | 'victory';

interface RoomState {
  roomCode:   string;
  levelId:    string;
  hostId:     string;
  players:    PlayerState[];
  localPlayer: PlayerState | null;
  isReady:    boolean;
}

const EMPTY_ROOM: RoomState = {
  roomCode: '', levelId: 'level1', hostId: '',
  players: [], localPlayer: null, isReady: false,
};

const App: React.FC = () => {
  const [screen,     setScreen]     = useState<Screen>('home');
  const [room,       setRoom]       = useState<RoomState>(EMPTY_ROOM);
  const [playerName, setPlayerName] = useState('');
  const [error,      setError]      = useState('');
  const [victoryMsg, setVictoryMsg] = useState('');
  const [finalTime,  setFinalTime]  = useState(0);

  // Ref prevents double-registration in strict mode / hot reload
  const listenersRef = useRef(false);

  useEffect(() => {
    if (listenersRef.current) return;
    listenersRef.current = true;
    const socket = getSocket();

    socket.on('room_created', ({ roomCode, player, players, hostId, levelId }: any) => {
      setError('');
      setRoom({ roomCode, levelId: levelId ?? 'level1', hostId, players, localPlayer: player, isReady: false });
      setScreen('waiting');
    });

    socket.on('room_joined', ({ roomCode, player, players, hostId, levelId }: any) => {
      setError('');
      setRoom(prev => ({ ...prev, roomCode, hostId, players, localPlayer: player, levelId: levelId ?? prev.levelId, isReady: false }));
      setScreen('waiting');
    });

    socket.on('join_error',   ({ message }: { message: string }) => setError(message));

    const onPlayerJoined = ({ player }: { player: PlayerState }) => {
      setRoom(prev => ({
        ...prev,
        players: prev.players.find(p => p.id === player.id) ? prev.players : [...prev.players, player],
      }));
    };
    const onPlayerLeft = ({ playerId }: { playerId: string }) => {
      setRoom(prev => ({ ...prev, players: prev.players.filter(p => p.id !== playerId) }));
    };
    socket.on('player_joined', onPlayerJoined);
    socket.on('player_left', onPlayerLeft);

    socket.on('player_ready', ({ playerId }: { playerId: string }) => {
      setRoom(prev => ({
        ...prev,
        players: prev.players.map(p => p.id === playerId ? { ...p, isReady: true } : p),
      }));
    });

    socket.on('host_changed', ({ newHostId }: { newHostId: string }) => {
      setRoom(prev => ({ ...prev, hostId: newHostId }));
    });

    socket.on('game_start', ({ levelId }: { levelId?: string } = {}) => {
      if (levelId) setRoom(prev => ({ ...prev, levelId }));
      setScreen('game');
    });

    return () => {
      socket.off('room_created'); socket.off('room_joined'); socket.off('join_error');
      socket.off('player_joined', onPlayerJoined); socket.off('player_left', onPlayerLeft);
      socket.off('player_ready'); socket.off('host_changed'); socket.off('game_start');
      listenersRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleCreateRoom = useCallback((name: string) => {
    setPlayerName(name); setError(''); setScreen('pick_level');
  }, []);

  const handleJoinRoom = useCallback((name: string, code: string) => {
    setPlayerName(name); setError('');
    getSocket().emit('join_room', { roomCode: code, playerName: name });
  }, []);

  const handleLevelSelected = useCallback((levelId: string) => {
    setRoom(prev => ({ ...prev, levelId }));
    getSocket().emit('create_room', { playerName, levelId });
  }, [playerName]);

  const handleReady = useCallback(() => {
    getSocket().emit('set_ready');
    setRoom(prev => ({ ...prev, isReady: true }));
  }, []);

  const handleStart = useCallback(() => {
    getSocket().emit('start_game');
  }, []);

  const handleLeaveRoom = useCallback(() => {
    setRoom(EMPTY_ROOM); setScreen('home'); setError('');
    // Reconnect so they can create/join a new room cleanly
    const s = getSocket();
    if (s.connected) s.disconnect();
    setTimeout(() => s.connect(), 100);
  }, []);

  const handleGameEnd = useCallback((msg: string, time: number) => {
    setVictoryMsg(msg); setFinalTime(time); setScreen('victory');
  }, []);

  const savedLb = useRef(false);
  if (screen === 'victory' && room.localPlayer && finalTime > 0 && !savedLb.current) {
    savedLb.current = true;
    saveLeaderboardEntry(room.levelId, {
      playerName: room.localPlayer.name, time: finalTime,
      date: new Date().toLocaleDateString(),
    });
  }

  const handlePlayAgain = useCallback(() => {
    savedLb.current = false;
    setScreen('waiting'); setVictoryMsg(''); setFinalTime(0);
    setRoom(prev => ({ ...prev, isReady: false }));
  }, []);

  const handleReturnHome = useCallback(() => {
    savedLb.current = false;
    setScreen('home'); setRoom(EMPTY_ROOM); setVictoryMsg(''); setFinalTime(0);
    const s = getSocket();
    if (s.connected) s.disconnect();
    setTimeout(() => s.connect(), 100);
  }, []);

  const levelName = LEVEL_CATALOGUE.find(l => l.id === room.levelId)?.name ?? room.levelId;

  // ── Screen routing ─────────────────────────────────────────────────────────
  if (screen === 'home') {
    return <Home onCreateRoom={handleCreateRoom} onJoinRoom={handleJoinRoom} error={error} />;
  }

  if (screen === 'pick_level') {
    return (
      <LevelSelect
        playerName={playerName}
        onBack={() => setScreen('home')}
        onCreated={handleLevelSelected}
      />
    );
  }

  if (screen === 'waiting' && room.localPlayer) {
    return (
      <Lobby
        roomCode={room.roomCode}
        levelName={levelName}
        players={room.players}
        localPlayerId={room.localPlayer.id}
        hostId={room.hostId}
        isReady={room.isReady}
        onReady={handleReady}
        onStart={handleStart}
        onBack={handleLeaveRoom}
      />
    );
  }

  if (screen === 'game' && room.localPlayer) {
    return (
      <GameCanvas
        levelId={room.levelId}
        localPlayer={room.localPlayer}
        initialPlayers={room.players}
        roomCode={room.roomCode}
        onGameEnd={handleGameEnd}
      />
    );
  }

  if (screen === 'victory') {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100vh', gap: 24,
        background: 'radial-gradient(ellipse at center, #1a1a4e 0%, #0a0a1a 100%)',
      }}>
        <div style={{ fontSize: 72 }}>🏆</div>
        <h1 style={{
          fontSize: 32, fontWeight: 900, textAlign: 'center', margin: 0,
          background: 'linear-gradient(135deg,#FFD700,#FF8C00)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          {victoryMsg || 'Level Complete!'}
        </h1>
        {finalTime > 0 && (
          <div style={{
            fontFamily: 'monospace', fontSize: 26, color: '#44FF88',
            background: 'rgba(0,0,0,0.4)', borderRadius: 10, padding: '10px 30px', letterSpacing: 2,
          }}>
            ⏱ {formatTime(finalTime)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 14 }}>
          <button onClick={handlePlayAgain} style={{
            padding: '12px 26px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)',
            background: 'transparent', color: '#ccc', fontWeight: 600, fontSize: 15, cursor: 'pointer',
          }}>
            Play Again
          </button>
          <button onClick={handleReturnHome} style={{
            padding: '12px 26px', borderRadius: 10, border: 'none',
            background: '#FF6644', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
          }}>
            Home
          </button>
        </div>
      </div>
    );
  }

  // Fallback: go home
  return <Home onCreateRoom={handleCreateRoom} onJoinRoom={handleJoinRoom} error={error} />;
};

export default App;
