import { Server, Socket } from 'socket.io';

const io = new Server({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

type Team = 'X' | 'O';

interface Player {
  id: string;
  name: string;
  team: Team;
  sector: number;
  lives: number;
  health: number;
  position: { x: number; y: number; z: number };
  rotation: number;
  // Track lives per sector - player cannot join a sector where they have 0 lives
  sectorLives: { [sector: number]: number };
}

interface Sector {
  xPlayers: number;
  oPlayers: number;
  owner: Team | null;
  shrinking: boolean;
  forceFieldRadius: number;
  xControlTime: number;
  oControlTime: number;
}

interface GameState {
  players: Map<string, Player>;
  sectors: Sector[];
  gameState: 'lobby' | 'pregame' | 'playing' | 'ended';
  countdown: number;
  winningTeam: Team | null;
}

const gameState: GameState = {
  players: new Map(),
  sectors: Array.from({ length: 9 }, () => ({
    xPlayers: 0,
    oPlayers: 0,
    owner: null,
    shrinking: false,
    forceFieldRadius: 100,
    xControlTime: 0,
    oControlTime: 0,
  })),
  gameState: 'lobby',
  countdown: 30,
  winningTeam: null,
};

let countdownInterval: NodeJS.Timeout | null = null;

// Track players in control zone per sector
const playersInControlZone = new Map<string, { team: Team; sector: number }>();

// Helper function to generate spawn position away from control zone
function generateSpawnPosition(): { x: number; y: number; z: number } {
  // Control zone is at center (0, 0) with radius 8
  // Spawn at least 20 units away from center
  const minDistance = 20;
  const maxDistance = 80;
  const angle = Math.random() * Math.PI * 2;
  const distance = minDistance + Math.random() * (maxDistance - minDistance);
  
  return {
    x: Math.cos(angle) * distance,
    y: 1.5,
    z: Math.sin(angle) * distance,
  };
}

// Helper function to validate player position and prevent overlap
function validatePlayerPosition(playerId: string, intendedPosition: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const playerRadius = 0.5;
  const minDistance = playerRadius + 0.5; // Combined radius for collision
  
  // Check against all other players in full 3D space
  for (const [id, otherPlayer] of gameState.players) {
    if (id === playerId) continue; // Skip self
    
    const dx = intendedPosition.x - otherPlayer.position.x;
    const dy = intendedPosition.y - otherPlayer.position.y;
    const dz = intendedPosition.z - otherPlayer.position.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    
    if (distSq < minDistance * minDistance) {
      // Overlap detected - push player away from other player in 3D
      const distance = Math.sqrt(distSq);
      const overlap = minDistance - distance;
      
      // Calculate push direction in 3D
      const normalX = dx / distance;
      const normalY = dy / distance;
      const normalZ = dz / distance;
      
      // Push to minimum valid position in 3D
      return {
        x: intendedPosition.x + normalX * (overlap + 0.1),
        y: intendedPosition.y + normalY * (overlap + 0.1),
        z: intendedPosition.z + normalZ * (overlap + 0.1),
      };
    }
  }
  
  return intendedPosition;
}

// Control zone update interval - runs every second
setInterval(() => {
  // BUG FIX 2: Log timer status for debugging
  console.log(`[CONTROL ZONE UPDATE] Game state: ${gameState.gameState}`);
  
  // BUG FIX 2: Removed game state check - control zone should work in any state
  // The previous check was blocking control zone updates because server state wasn't synced with client
  
  // Process each sector
  for (let sectorIndex = 0; sectorIndex < gameState.sectors.length; sectorIndex++) {
    const sector = gameState.sectors[sectorIndex];
    
    // Count players in control zone for this sector
    let xPlayersInZone = 0;
    let oPlayersInZone = 0;
    
    playersInControlZone.forEach((data, playerId) => {
      if (data.sector === sectorIndex) {
        if (data.team === 'X') xPlayersInZone++;
        else oPlayersInZone++;
      }
    });
    
    // BUG FIX 2: Log timer values every second
    console.log(`[CONTROL ZONE] Sector ${sectorIndex}: X players in zone=${xPlayersInZone}, O players in zone=${oPlayersInZone}, X time=${sector.xControlTime}, O time=${sector.oControlTime}`);
    
    // Increment control time for team with players in zone (only one team present)
    if (xPlayersInZone > 0 && oPlayersInZone === 0) {
      sector.xControlTime++;
      console.log(`[CONTROL ZONE] Sector ${sectorIndex}: X team control time = ${sector.xControlTime}`);
    } else if (oPlayersInZone > 0 && xPlayersInZone === 0) {
      sector.oControlTime++;
      console.log(`[CONTROL ZONE] Sector ${sectorIndex}: O team control time = ${sector.oControlTime}`);
    }
    
    // Check for sector capture (30 seconds of control)
    if (sector.xControlTime >= 30 && !sector.owner) {
      sector.owner = 'X';
      io.emit('sectorCaptured', { sector: sectorIndex, owner: 'X', xControlTime: sector.xControlTime, oControlTime: sector.oControlTime });
      checkVictoryCondition();
    } else if (sector.oControlTime >= 30 && !sector.owner) {
      sector.owner = 'O';
      io.emit('sectorCaptured', { sector: sectorIndex, owner: 'O', xControlTime: sector.xControlTime, oControlTime: sector.oControlTime });
      checkVictoryCondition();
    }
  }
  
  // Broadcast updated sectors
  io.emit('sectorsUpdate', gameState.sectors);
}, 1000);

io.on('connection', (socket: Socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Send current game state to new player
  socket.emit('gameState', {
    players: Array.from(gameState.players.values()),
    sectors: gameState.sectors,
    gameState: gameState.gameState,
    countdown: gameState.countdown,
  });

  // Player joins lobby
  socket.on('joinLobby', (data: { name: string; team: Team; sector: number, npcPlayers?: Player[] }) => {
    // Find valid spawn position that doesn't overlap with existing players and is away from control zone
    let position: { x: number; y: number; z: number };
    let attempts = 0;
    const maxAttempts = 10;

    do {
      position = generateSpawnPosition();
      attempts++;
    } while (attempts < maxAttempts && validatePlayerPosition(socket.id, position) !== position);

    // Initialize sector lives - player starts with 3 lives in each sector
    const sectorLives: { [sector: number]: number } = {};
    for (let i = 0; i < 9; i++) {
      sectorLives[i] = 3;
    }

    const player: Player = {
      id: socket.id,
      name: data.name,
      team: data.team,
      sector: data.sector,
      lives: 3,
      health: 100,
      position: position,
      rotation: 0,
      sectorLives: sectorLives,
    };

    gameState.players.set(socket.id, player);

    // If NPC players are provided, add them to the game state
    if (data.npcPlayers && Array.isArray(data.npcPlayers)) {
      data.npcPlayers.forEach(npc => {
        // Only add NPC if not already in the game
        if (!gameState.players.has(npc.id)) {
          // Generate a random position away from control zone for the NPC
          let npcPosition: { x: number; y: number; z: number };
          let npcAttempts = 0;
          
          do {
            npcPosition = generateSpawnPosition();
            npcAttempts++;
          } while (npcAttempts < maxAttempts && validatePlayerPosition(npc.id, npcPosition) !== npcPosition);

          // Initialize sector lives for NPC
          const npcSectorLives: { [sector: number]: number } = {};
          for (let i = 0; i < 9; i++) {
            npcSectorLives[i] = 3;
          }

          const npcPlayer: Player = {
            id: npc.id,
            name: npc.name,
            team: npc.team,
            sector: npc.sector,
            lives: 3,
            health: 100,
            position: npcPosition,
            rotation: 0,
            sectorLives: npcSectorLives,
          };

          gameState.players.set(npc.id, npcPlayer);
          console.log(`[SERVER] Added NPC player: ${npc.name} in sector ${npc.sector}`);
        }
      });
    }

    updateSectorCounts();
    io.emit('playerJoined', player);
    io.emit('sectorsUpdate', gameState.sectors);

    // Auto-start game if not already started and we have enough players
    if (gameState.gameState === 'lobby' && gameState.players.size >= 1) {
      console.log('[SERVER] Auto-starting game with', gameState.players.size, 'players');
      gameState.gameState = 'pregame';
      gameState.countdown = 5; // 5 second pregame countdown
      io.emit('gameStateUpdate', { gameState: gameState.gameState, countdown: gameState.countdown });
      
      // Start countdown
      if (countdownInterval) {
        clearInterval(countdownInterval);
      }
      countdownInterval = setInterval(() => {
        gameState.countdown--;
        io.emit('countdownUpdate', gameState.countdown);
        console.log('[SERVER] Pregame countdown:', gameState.countdown);
        
        if (gameState.countdown <= 0) {
          startGame();
        }
      }, 1000);
    }
  });

  // Player changes sector - NO LIMIT on switches, but check lives in target sector
  socket.on('changeSector', (sector: number) => {
    console.log(`[SERVER] Player ${socket.id} requesting sector change to ${sector}`);
    const player = gameState.players.get(socket.id);
    if (!player) {
      console.log(`[SERVER] Player not found for ${socket.id}`);
      socket.emit('error', { message: 'Player not found' });
      return;
    }

    // Check if player has lives remaining in target sector
    const livesInTargetSector = player.sectorLives[sector] ?? 3;
    if (livesInTargetSector <= 0) {
      console.log(`[SERVER] Player ${socket.id} has no lives in sector ${sector}`);
      socket.emit('error', { message: 'No lives remaining in that sector' });
      return;
    }

    if (gameState.countdown < 5) {
      gameState.countdown += 5;
      io.emit('countdownUpdate', gameState.countdown);
    }

    const oldSector = player.sector;
    player.sector = sector;
    
    // Decrement lives in the OLD sector when leaving (represents commitment)
    // Actually, we should decrement lives in the sector when player DIES there, not when switching
    // So we don't decrement here

    updateSectorCounts();

    // Get players in the new sector
    const playersInNewSector = Array.from(gameState.players.values()).filter(
      p => p.sector === sector && p.id !== socket.id
    );

    console.log(`[SERVER] Sending sectorChanged event to ${socket.id}: sector=${sector}, oldSector=${oldSector}, playersInSector=${playersInNewSector.length}`);

    // Emit sector changed event with full state of new sector
    socket.emit('sectorChanged', {
      sector: sector,
      oldSector: oldSector,
      playersInSector: playersInNewSector,
      sectorLives: player.sectorLives,
    });

    // Notify other players
    io.emit('playerUpdated', player);
    io.emit('sectorsUpdate', gameState.sectors);
  });

  // Player enters control zone
  socket.on('enterControlZone', () => {
    const player = gameState.players.get(socket.id);
    if (player) {
      playersInControlZone.set(socket.id, { team: player.team, sector: player.sector });
      console.log(`[CONTROL ZONE] Player ${socket.id} (${player.team}) entered control zone in sector ${player.sector}`);
    }
  });

  // Player leaves control zone
  socket.on('leaveControlZone', () => {
    playersInControlZone.delete(socket.id);
    console.log(`[CONTROL ZONE] Player ${socket.id} left control zone`);
  });

  // Start game countdown
  socket.on('startGame', () => {
    if (gameState.gameState !== 'lobby') return;

    gameState.gameState = 'pregame';
    io.emit('gameStateUpdate', { gameState: gameState.gameState });

    countdownInterval = setInterval(() => {
      gameState.countdown--;

      io.emit('countdownUpdate', gameState.countdown);

      if (gameState.countdown <= 0) {
        startGame();
      }
    }, 1000);
  });

  // Player position update
  socket.on('updatePosition', (data: { x: number; y: number; z: number; rotation: number }) => {
    const player = gameState.players.get(socket.id);
    if (player) {
      // Validate position on server to prevent overlap
      const intendedPosition = { x: data.x, y: data.y, z: data.z };
      const validPosition = validatePlayerPosition(socket.id, intendedPosition);
      
      player.position = { x: validPosition.x, y: validPosition.y, z: validPosition.z };
      player.rotation = data.rotation;
      
      socket.broadcast.emit('playerMoved', {
        id: socket.id,
        position: player.position,
        rotation: player.rotation,
      });
    }
  });

  // Player shoots
  socket.on('shoot', (data: { direction: { x: number; y: number; z: number } }) => {
    const player = gameState.players.get(socket.id);
    if (player && gameState.gameState === 'playing') {
      socket.broadcast.emit('playerShot', {
        id: socket.id,
        direction: data.direction,
        position: player.position,
      });
    }
  });

  // Player takes damage
  socket.on('takeDamage', (data: { damage: number; attackerId: string }) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    player.health -= data.damage;

    if (player.health <= 0) {
      // Decrement lives in current sector
      player.sectorLives[player.sector]--;
      player.lives--;
      player.health = 100;

      console.log(`[SERVER] Player ${socket.id} died in sector ${player.sector}. Lives in sector: ${player.sectorLives[player.sector]}, Total lives: ${player.lives}`);

      if (player.lives <= 0) {
        // Player eliminated
        gameState.players.delete(socket.id);
        playersInControlZone.delete(socket.id);
        io.emit('playerEliminated', { id: socket.id });
        checkVictoryCondition();
      } else {
        // Find a sector where player still has lives
        let respawnSector = -1;
        for (let i = 0; i < 9; i++) {
          if (player.sectorLives[i] > 0) {
            respawnSector = i;
            break;
          }
        }

        if (respawnSector === -1) {
          // No sectors with lives - player eliminated
          gameState.players.delete(socket.id);
          playersInControlZone.delete(socket.id);
          io.emit('playerEliminated', { id: socket.id });
          checkVictoryCondition();
          return;
        }

        // Respawn in sector with lives remaining
        player.sector = respawnSector;
        
        // Generate spawn position away from control zone
        let position: { x: number; y: number; z: number };
        let attempts = 0;
        const maxAttempts = 10;
        
        do {
          position = generateSpawnPosition();
          attempts++;
        } while (attempts < maxAttempts && validatePlayerPosition(socket.id, position) !== position);
        
        player.position = position;
        
        io.emit('playerRespawned', {
          id: socket.id,
          lives: player.lives,
          position: player.position,
          sector: player.sector,
          sectorLives: player.sectorLives,
        });
      }
    } else {
      io.emit('playerDamaged', {
        id: socket.id,
        health: player.health,
        attackerId: data.attackerId,
      });
    }
  });

  // Sector capture
  socket.on('sectorCapture', (sector: number) => {
    const player = gameState.players.get(socket.id);
    if (!player || !gameState.sectors[sector]) return;

    gameState.sectors[sector].owner = player.team;
    gameState.sectors[sector].shrinking = false;

    io.emit('sectorCaptured', {
      sector,
      owner: player.team,
      xControlTime: gameState.sectors[sector].xControlTime,
      oControlTime: gameState.sectors[sector].oControlTime,
    });

    checkVictoryCondition();
  });

  // Player disconnects
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    const player = gameState.players.get(socket.id);
    if (player) {
      gameState.players.delete(socket.id);
      playersInControlZone.delete(socket.id);
      updateSectorCounts();
      io.emit('playerLeft', { id: socket.id });
      io.emit('sectorsUpdate', gameState.sectors);
      checkVictoryCondition();
    }
  });
});

function startGame() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  gameState.gameState = 'playing';
  io.emit('gameStateUpdate', { gameState: gameState.gameState });

  // Start shrinking force fields
  const shrinkInterval = setInterval(() => {
    if (gameState.gameState !== 'playing') {
      clearInterval(shrinkInterval);
      return;
    }

    gameState.sectors.forEach((sector, index) => {
      if (sector.forceFieldRadius > 5) {
        const playersInSector = Array.from(gameState.players.values()).filter(
          p => p.sector === index
        ).length;

        // Faster shrink with more players
        const shrinkRate = 0.1 + (playersInSector * 0.05);
        sector.forceFieldRadius = Math.max(5, sector.forceFieldRadius - shrinkRate);
      }
    });

    io.emit('forceFieldsUpdate', gameState.sectors);
  }, 100);
}

function updateSectorCounts() {
  // Reset sector counts
  gameState.sectors.forEach(sector => {
    sector.xPlayers = 0;
    sector.oPlayers = 0;
  });

  // Count players in each sector
  gameState.players.forEach(player => {
    const sector = gameState.sectors[player.sector];
    if (sector) {
      if (player.team === 'X') {
        sector.xPlayers++;
      } else {
        sector.oPlayers++;
      }
    }
  });
}

function checkVictoryCondition() {
  console.log('[VICTORY CHECK] Game state:', gameState.gameState);
  
  // Only check victory during playing state
  if (gameState.gameState !== 'playing') {
    console.log('[VICTORY CHECK] Skipping - game not in playing state');
    return;
  }

  // Check for 3 in a row
  const winningPatterns = [
    // Horizontal
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    // Vertical
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    // Diagonal
    [0, 4, 8],
    [2, 4, 6],
  ];

  // Log current sector ownership
  console.log('[VICTORY CHECK] Sector ownership:');
  gameState.sectors.forEach((s, i) => {
    console.log(`[VICTORY CHECK] Sector ${i}: owner=${s.owner}`);
  });

  for (const pattern of winningPatterns) {
    const [a, b, c] = pattern;
    const ownerA = gameState.sectors[a].owner;
    const ownerB = gameState.sectors[b].owner;
    const ownerC = gameState.sectors[c].owner;

    console.log(`[VICTORY CHECK] Pattern [${a},${b},${c}]: owners=${ownerA},${ownerB},${ownerC}`);

    if (ownerA && ownerA === ownerB && ownerA === ownerC) {
      console.log(`[VICTORY CHECK] WINNER FOUND: ${ownerA} has pattern [${a},${b},${c}]`);
      endGame(ownerA);
      return;
    }
  }

  // Check if one team has no players left
  const xPlayers = Array.from(gameState.players.values()).filter(p => p.team === 'X').length;
  const oPlayers = Array.from(gameState.players.values()).filter(p => p.team === 'O').length;

  if (xPlayers === 0 && oPlayers > 0) {
    endGame('O');
  } else if (oPlayers === 0 && xPlayers > 0) {
    endGame('X');
  }
}

function endGame(winner: Team) {
  gameState.gameState = 'ended';
  gameState.winningTeam = winner;

  io.emit('gameEnded', {
    winner,
    sectors: gameState.sectors,
  });

  // Reset after delay
  setTimeout(() => {
    gameState.gameState = 'lobby';
    gameState.countdown = 30;
    gameState.winningTeam = null;
    gameState.players.clear();
    playersInControlZone.clear();
    gameState.sectors = Array.from({ length: 9 }, () => ({
      xPlayers: 0,
      oPlayers: 0,
      owner: null,
      shrinking: false,
      forceFieldRadius: 100,
      xControlTime: 0,
      oControlTime: 0,
    }));

    io.emit('gameReset');
  }, 10000);
}

const PORT = 3005;

io.listen(PORT);
console.log(`Game server running on port ${PORT}`);
