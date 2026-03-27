'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skull, Crosshair, Shield, Zap, Timer, Users, Play, Plus, Trash2 } from 'lucide-react';
import dynamic from 'next/dynamic';

// Dynamic import for Three.js game to avoid SSR issues
const Game3D = dynamic(() => import('@/components/Game3D'), { ssr: false });

type Team = 'X' | 'O';
type Sector = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

interface PlayerInfo {
  id: string;
  name: string;
  team: Team;
  sector: Sector;
  lives: number;
  health: number;
  sectorLives?: { [sector: number]: number };
}

interface SectorState {
  xPlayers: number;
  oPlayers: number;
  owner: Team | null;
  shrinking: boolean;
  forceFieldRadius: number;
  xControlTime: number;
  oControlTime: number;
}

export default function TicTacToeShooter() {
  const [gameState, setGameState] = useState<'lobby' | 'pregame' | 'playing' | 'ended'>('lobby');
  const [playerName, setPlayerName] = useState('');
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [selectedSector, setSelectedSector] = useState<Sector | null>(null);
  const [countdown, setCountdown] = useState(5);
  const [sectors, setSectors] = useState<SectorState[]>(
    Array.from({ length: 9 }, () => ({
      xPlayers: 0,
      oPlayers: 0,
      owner: null,
      shrinking: false,
      forceFieldRadius: 100,
      xControlTime: 0,
      oControlTime: 0,
    }))
  );
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [winningTeam, setWinningTeam] = useState<Team | null>(null);
  const [notifications, setNotifications] = useState<{ id: string; message: string; type: 'join' | 'leave' | 'kill'; timestamp: number }[]>([]);
  
  // Bot configuration state
  const [botTeam, setBotTeam] = useState<Team>('O');
  const [botSector, setBotSector] = useState<Sector>(0);
  
  // Track lives per sector for current player
  const [sectorLives, setSectorLives] = useState<{ [sector: number]: number }>(() => {
    const lives: { [sector: number]: number } = {};
    for (let i = 0; i < 9; i++) {
      lives[i] = 3;
    }
    return lives;
  });

  // Generate random player ID
  const playerId = useRef(`player_${Math.random().toString(36).substr(2, 9)}`);

  // REMOVED: Random bot addition - users now control bots manually
  
  // Update sector player counts
  useEffect(() => {
    const newSectors = sectors.map((sector, index) => {
      const xCount = players.filter(p => p.team === 'X' && p.sector === index).length;
      const oCount = players.filter(p => p.team === 'O' && p.sector === index).length;

      return {
        ...sector,
        xPlayers: xCount + (selectedTeam === 'X' && selectedSector === index ? 1 : 0),
        oPlayers: oCount + (selectedTeam === 'O' && selectedSector === index ? 1 : 0),
      };
    });

    setSectors(newSectors);
  }, [players, selectedTeam, selectedSector]);

  const startGame = () => {
    setGameState('playing');
  };

  // Countdown timer
  useEffect(() => {
    if (gameState === 'pregame' && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (gameState === 'pregame' && countdown === 0) {
      startGame();
    }
  }, [gameState, countdown]);

  const handleJoinGame = () => {
    if (playerName.trim() && selectedTeam && selectedSector !== null) {
      setGameState('pregame');
    }
  };

  // Add a bot with specific team and sector
  const handleAddBot = () => {
    const newBot: PlayerInfo = {
      id: `npc_${Math.random().toString(36).substr(2, 9)}`,
      name: `Bot${players.filter(p => p.id.startsWith('npc_')).length + 1}`,
      team: botTeam,
      sector: botSector,
      lives: 3,
      health: 100,
    };
    setPlayers(prev => [...prev, newBot]);
  };

  // Remove a bot
  const handleRemoveBot = (botId: string) => {
    setPlayers(prev => prev.filter(p => p.id !== botId));
  };

  // Clear all bots
  const handleClearBots = () => {
    setPlayers(prev => prev.filter(p => !p.id.startsWith('npc_')));
  };

  const handleSectorSelect = (sector: Sector) => {
    if (gameState !== 'lobby' && gameState !== 'pregame') return;
    if (sectorLives[sector] <= 0) return;
    setSelectedSector(sector);
  };

  if (gameState === 'playing') {
    return (
      <div className="fixed inset-0 bg-black">
        <Game3D
          playerInfo={{
            id: playerId.current,
            name: playerName,
            team: selectedTeam!,
            sector: selectedSector!,
            lives: 3,
            health: 100,
          }}
          sectors={sectors}
          players={players}
          notifications={notifications}
          onGameEnd={(winner) => {
            setWinningTeam(winner);
            setGameState('ended');
          }}
        />
      </div>
    );
  }

  if (gameState === 'ended') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl bg-black/50 border-2 border-purple-500/50">
          <CardHeader className="text-center">
            <CardTitle className="text-6xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              {winningTeam} Team Wins!
            </CardTitle>
            <CardDescription className="text-xl text-white/80">
              Tactical Tic-Tac-Toe Victory
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center gap-4">
            <Button
              size="lg"
              onClick={() => {
                setGameState('lobby');
                setCountdown(5);
                setWinningTeam(null);
                setPlayers([]);
                const newSectorLives: { [sector: number]: number } = {};
                for (let i = 0; i < 9; i++) {
                  newSectorLives[i] = 3;
                }
                setSectorLives(newSectorLives);
              }}
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
            >
              Play Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Lobby / Pregame UI
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-5xl md:text-7xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 bg-clip-text text-transparent animate-pulse">
            TIC-TAC-TOE
          </h1>
          <h2 className="text-2xl md:text-3xl text-white/90 font-semibold">
            Tactical 3D Shooter
          </h2>
          <p className="text-white/70 text-lg">
            Dominate the 3x3 grid. Control sectors. Win by strategy.
          </p>
        </div>

        {/* Game Mode Selection */}
        {gameState === 'lobby' && (
          <Card className="bg-black/50 border-2 border-purple-500/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-2xl text-white">Join the Battle</CardTitle>
              <CardDescription className="text-white/70">
                Choose your team, name, and starting sector
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Player Name */}
              <div className="space-y-2">
                <label className="text-white font-semibold">Your Callsign</label>
                <Input
                  type="text"
                  placeholder="Enter your name..."
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  className="bg-white/10 border-purple-500/30 text-white placeholder:text-white/50"
                  maxLength={20}
                />
              </div>

              {/* Team Selection */}
              <div className="space-y-3">
                <label className="text-white font-semibold text-lg">Choose Your Team</label>
                <div className="grid grid-cols-2 gap-4">
                  <Button
                    size="lg"
                    onClick={() => setSelectedTeam('X')}
                    className={`h-32 text-5xl font-bold transition-all ${
                      selectedTeam === 'X'
                        ? 'bg-gradient-to-br from-blue-600 to-blue-800 border-4 border-blue-400 shadow-lg shadow-blue-500/50'
                        : 'bg-white/10 hover:bg-white/20'
                    }`}
                  >
                    X
                  </Button>
                  <Button
                    size="lg"
                    onClick={() => setSelectedTeam('O')}
                    className={`h-32 text-5xl font-bold transition-all ${
                      selectedTeam === 'O'
                        ? 'bg-gradient-to-br from-red-600 to-red-800 border-4 border-red-400 shadow-lg shadow-red-500/50'
                        : 'bg-white/10 hover:bg-white/20'
                    }`}
                  >
                    O
                  </Button>
                </div>
              </div>

              {/* Sector Grid */}
              {selectedTeam && (
                <div className="space-y-3">
                  <label className="text-white font-semibold text-lg">
                    Choose Your Starting Sector
                  </label>
                  <div className="grid grid-cols-3 gap-2 max-w-md mx-auto">
                    {Array.from({ length: 9 }).map((_, i) => {
                      const sector = sectors[i];
                      const isSelected = selectedSector === i;
                      const teamColor = selectedTeam === 'X' ? 'blue' : 'red';
                      const hasLives = sectorLives[i] > 0;

                      return (
                        <button
                          key={i}
                          onClick={() => handleSectorSelect(i as Sector)}
                          disabled={!hasLives}
                          className={`
                            aspect-square rounded-lg border-2 transition-all p-3 flex flex-col items-center justify-center gap-2 relative
                            ${isSelected
                              ? `border-${teamColor}-400 bg-${teamColor}-600/50 shadow-lg`
                              : !hasLives
                              ? 'border-gray-600 bg-gray-800/50 cursor-not-allowed opacity-50'
                              : `border-white/30 bg-white/5 hover:bg-white/10 cursor-pointer`
                            }
                          `}
                        >
                          {sector.owner && (
                            <div className={`absolute top-1 right-1 text-2xl font-bold ${sector.owner === 'X' ? 'text-blue-400' : 'text-red-400'}`}>
                              {sector.owner}
                            </div>
                          )}
                          <div className="flex gap-2 text-sm">
                            <Badge variant="outline" className="text-blue-400 border-blue-400">
                              {sector.xPlayers}
                            </Badge>
                            <Badge variant="outline" className="text-red-400 border-red-400">
                              {sector.oPlayers}
                            </Badge>
                          </div>
                          <span className="text-white/60 text-xs">Sector {i + 1}</span>
                          {!hasLives && (
                            <span className="text-red-500 text-xs font-bold">NO LIVES</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Bot Configuration */}
              <div className="space-y-4 border-t border-white/10 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-semibold text-lg">Add Bots</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearBots}
                    className="text-red-400 border-red-400 hover:bg-red-400/20"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Clear All Bots
                  </Button>
                </div>
                
                <div className="grid grid-cols-3 gap-4 items-end">
                  {/* Bot Team */}
                  <div className="space-y-2">
                    <label className="text-white/70 text-sm">Bot Team</label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        onClick={() => setBotTeam('X')}
                        className={`text-lg font-bold ${botTeam === 'X' ? 'bg-blue-600 border-2 border-blue-400' : 'bg-white/10'}`}
                      >
                        X
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => setBotTeam('O')}
                        className={`text-lg font-bold ${botTeam === 'O' ? 'bg-red-600 border-2 border-red-400' : 'bg-white/10'}`}
                      >
                        O
                      </Button>
                    </div>
                  </div>

                  {/* Bot Sector */}
                  <div className="space-y-2">
                    <label className="text-white/70 text-sm">Bot Sector</label>
                    <select
                      value={botSector}
                      onChange={(e) => setBotSector(Number(e.target.value) as Sector)}
                      className="w-full bg-white/10 border border-purple-500/30 rounded-md p-2 text-white"
                    >
                      {Array.from({ length: 9 }).map((_, i) => (
                        <option key={i} value={i} className="bg-gray-800 text-white">
                          Sector {i + 1}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Add Button */}
                  <Button
                    onClick={handleAddBot}
                    className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Bot
                  </Button>
                </div>

                {/* Bot List */}
                {players.filter(p => p.id.startsWith('npc_')).length > 0 && (
                  <div className="space-y-2">
                    <label className="text-white/70 text-sm">Configured Bots ({players.filter(p => p.id.startsWith('npc_')).length})</label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-40 overflow-y-auto">
                      {players.filter(p => p.id.startsWith('npc_')).map((bot) => (
                        <div
                          key={bot.id}
                          className="flex items-center justify-between bg-white/5 rounded-lg p-2 border border-white/10"
                        >
                          <div className="flex items-center gap-2">
                            <Badge className={`${bot.team === 'X' ? 'bg-blue-600' : 'bg-red-600'}`}>
                              {bot.team}
                            </Badge>
                            <span className="text-white text-sm">{bot.name}</span>
                            <span className="text-white/50 text-xs">S{bot.sector + 1}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveBot(bot.id)}
                            className="text-red-400 hover:text-red-300 hover:bg-red-400/20 h-6 w-6 p-0"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Join Button */}
              <Button
                size="lg"
                onClick={handleJoinGame}
                disabled={!playerName.trim() || !selectedTeam || selectedSector === null}
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="mr-2 h-5 w-5" />
                Join Queue
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Pregame Countdown */}
        {gameState === 'pregame' && (
          <Card className="bg-black/50 border-2 border-purple-500/50 backdrop-blur-sm">
            <CardHeader className="text-center">
              <div className="flex items-center justify-center gap-4 mb-4">
                <Timer className="h-12 w-12 text-purple-400 animate-pulse" />
                <div className="text-6xl font-bold text-white">{countdown}</div>
              </div>
              <CardTitle className="text-2xl text-white">
                Match Starting Soon
              </CardTitle>
              <CardDescription className="text-white/70">
                Prepare for battle!
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Game Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white/5 rounded-lg p-4 text-center">
                  <Users className="h-8 w-8 mx-auto mb-2 text-purple-400" />
                  <div className="text-2xl font-bold text-white">{players.length + 1}</div>
                  <div className="text-white/60 text-sm">Total Players</div>
                </div>
                <div className="bg-white/5 rounded-lg p-4 text-center">
                  <Skull className="h-8 w-8 mx-auto mb-2 text-red-400" />
                  <div className="text-2xl font-bold text-white">3</div>
                  <div className="text-white/60 text-sm">Lives per Sector</div>
                </div>
                <div className="bg-white/5 rounded-lg p-4 text-center">
                  <Crosshair className="h-8 w-8 mx-auto mb-2 text-green-400" />
                  <div className="text-2xl font-bold text-white">9</div>
                  <div className="text-white/60 text-sm">Sectors</div>
                </div>
                <div className="bg-white/5 rounded-lg p-4 text-center">
                  <Shield className="h-8 w-8 mx-auto mb-2 text-blue-400" />
                  <div className="text-2xl font-bold text-white">
                    {sectors.filter(s => s.owner).length}
                  </div>
                  <div className="text-white/60 text-sm">Captured</div>
                </div>
              </div>

              {/* Player Info */}
              <div className="flex items-center justify-center gap-4 p-4 bg-gradient-to-r from-purple-600/20 to-pink-600/20 rounded-lg border border-purple-500/30">
                <div className="text-4xl font-bold text-white">
                  Team {selectedTeam}
                </div>
                <Badge className="text-lg bg-gradient-to-r from-purple-600 to-pink-600">
                  {playerName}
                </Badge>
                <Badge variant="outline" className="text-lg">
                  Sector {selectedSector! + 1}
                </Badge>
              </div>

              {/* Bot Summary */}
              {players.filter(p => p.id.startsWith('npc_')).length > 0 && (
                <div className="mt-4 p-4 bg-white/5 rounded-lg border border-white/10">
                  <h4 className="text-white font-semibold mb-2">Bots in Match:</h4>
                  <div className="grid grid-cols-9 gap-1 text-center text-xs">
                    {Array.from({ length: 9 }).map((_, i) => {
                      const xBots = players.filter(p => p.id.startsWith('npc_') && p.team === 'X' && p.sector === i).length;
                      const oBots = players.filter(p => p.id.startsWith('npc_') && p.team === 'O' && p.sector === i).length;
                      return (
                        <div key={i} className="bg-white/5 rounded p-1">
                          <div className="text-blue-400">{xBots}</div>
                          <div className="text-white/40">S{i + 1}</div>
                          <div className="text-red-400">{oBots}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Rules Preview */}
              <div className="mt-6 space-y-2">
                <h3 className="text-lg font-semibold text-white">Game Rules:</h3>
                <ul className="text-white/70 space-y-1 text-sm">
                  <li>• Capture 3 sectors in a row (horizontal, vertical, or diagonal) to win</li>
                  <li>• Eliminate all opposing players to win</li>
                  <li>• Stay in the control zone to capture for your team</li>
                  <li>• You have 3 lives per sector - lose them all and you&apos;re locked out</li>
                  <li>• Switch sectors anytime, but can&apos;t return to sectors where you have no lives</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Features Section */}
        <div className="grid md:grid-cols-3 gap-4">
          <Card className="bg-black/30 border border-purple-500/30 backdrop-blur-sm">
            <CardHeader>
              <Zap className="h-8 w-8 text-yellow-400 mb-2" />
              <CardTitle className="text-lg text-white">Fast-Paced Action</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-white/60 text-sm">
                Shrink zones, power cores, and dynamic weapon pickups create intense, strategic combat.
              </p>
            </CardContent>
          </Card>
          <Card className="bg-black/30 border border-purple-500/30 backdrop-blur-sm">
            <CardHeader>
              <Shield className="h-8 w-8 text-blue-400 mb-2" />
              <CardTitle className="text-lg text-white">Team Strategy</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-white/60 text-sm">
                Coordinate with teammates across sectors. Share info, rotate players, dominate the grid.
              </p>
            </CardContent>
          </Card>
          <Card className="bg-black/30 border border-purple-500/30 backdrop-blur-sm">
            <CardHeader>
              <Crosshair className="h-8 w-8 text-green-400 mb-2" />
              <CardTitle className="text-lg text-white">Skill-Based Combat</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-white/60 text-sm">
                Headshots, movement, and positioning matter. Master each sector&apos;s unique abilities.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
