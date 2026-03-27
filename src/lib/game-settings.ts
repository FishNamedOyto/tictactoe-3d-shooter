/**
 * Global Game Settings
 * Centralized configuration for all game parameters
 * All time values are in seconds unless otherwise specified
 */

export const GAME_SETTINGS = {
  // ==========================================
  // SECTOR CONTROL SETTINGS
  // ==========================================
  
  /** Time required to capture a sector (in seconds) */
  SECTOR_CAPTURE_TIME: 30,
  
  /** Radius of the control zone (in game units) */
  CONTROL_ZONE_RADIUS: 8,
  
  /** Total number of sectors in the game (3x3 grid) */
  TOTAL_SECTORS: 9,
  
  // ==========================================
  // COUNTDOWN & GAME STATE SETTINGS
  // ==========================================
  
  /** Pre-game countdown before match starts (in seconds) */
  PREGAME_COUNTDOWN: 5,
  
  /** Initial countdown for lobby state (in seconds) */
  INITIAL_COUNTDOWN: 30,
  
  /** Delay before game resets after ending (in milliseconds) */
  GAME_RESET_DELAY: 10000,
  
  // ==========================================
  // PLAYER SETTINGS
  // ==========================================
  
  /** Initial lives per player */
  INITIAL_LIVES: 3,
  
  /** Initial lives per sector for each player */
  LIVES_PER_SECTOR: 3,
  
  /** Initial health points */
  INITIAL_HEALTH: 100,
  
  /** Player collision radius */
  PLAYER_RADIUS: 0.5,
  
  /** Player height (capsule) */
  PLAYER_HEIGHT: 2.5,
  
  // ==========================================
  // SPAWN SETTINGS
  // ==========================================
  
  /** Minimum distance from center for spawn points */
  SPAWN_MIN_DISTANCE: 20,
  
  /** Maximum distance from center for spawn points */
  SPAWN_MAX_DISTANCE: 80,
  
  /** Player spawn height (Y position) */
  SPAWN_HEIGHT: 1.5,
  
  // ==========================================
  // ARENA SETTINGS
  // ==========================================
  
  /** Arena ground size (width and depth) */
  ARENA_SIZE: 200,
  
  /** Wall height */
  WALL_HEIGHT: 20,
  
  /** Wall thickness */
  WALL_THICKNESS: 5,
  
  // ==========================================
  // WEAPON SETTINGS
  // ==========================================
  
  WEAPONS: {
    GUN: {
      NAME: 'Pistol',
      DAMAGE: 10,
      BULLET_SPEED: 2.0,
      BULLET_LIFETIME: 500, // frames
      BULLET_SIZE: 0.1,
      MAX_AMMO: 12,
      RELOAD_TIME: 1500, // milliseconds
      FIRE_RATE: 150, // milliseconds between shots
      PROJECTILE_TYPE: 'bullet',
    },
    BAZOOKA: {
      NAME: 'Bazooka',
      DAMAGE: 50,
      DAMAGE_RADIUS: 15,
      BULLET_SPEED: 1.2,
      BULLET_LIFETIME: 150, // frames
      BULLET_SIZE: 0.25,
      MAX_AMMO: 1,
      RELOAD_TIME: 2000, // milliseconds
      FIRE_RATE: 2000, // milliseconds between shots
      PROJECTILE_TYPE: 'rocket',
    },
    GRENADE: {
      NAME: 'Grenade Launcher',
      DAMAGE: 70,
      DAMAGE_RADIUS: 8,
      BULLET_SPEED: 0.8,
      BULLET_LIFETIME: 180, // frames (3 seconds at 60fps)
      BULLET_SIZE: 0.35,
      MAX_AMMO: 5,
      RELOAD_TIME: 2500, // milliseconds
      FIRE_RATE: 1000, // milliseconds between shots
      PROJECTILE_TYPE: 'grenade',
    },
  },
  
  // ==========================================
  // PROJECTILE DETECTION SETTINGS
  // ==========================================
  
  /** Ground level (Y position) */
  GROUND_LEVEL: 1.5,
  
  /** 
   * Underground detection threshold for projectiles
   * Projectiles can go this far below ground before being destroyed
   * This fixes bazooka rockets sometimes not exploding on ground
   */
  UNDERGROUND_DETECTION_THRESHOLD: -5,
  
  /** Direct hit collision radius for projectiles */
  PROJECTILE_DIRECT_HIT_RADIUS: 0.8,
  
  // ==========================================
  // BOT AI SETTINGS
  // ==========================================
  
  BOT: {
    /** Base movement speed */
    SPEED: 0.15,
    
    /** Detection range for enemies */
    DETECTION_RANGE: 80,
    
    /** Attack range for close combat */
    CLOSE_COMBAT_RANGE: 15,
    
    /** Range at which bot will chase enemies */
    CHASE_RANGE: 50,
    
    /** Jump cooldown in frames */
    JUMP_COOLDOWN: 60,
    
    /** Close combat jump cooldown in frames */
    CLOSE_COMBAT_JUMP_COOLDOWN: 30,
  },
  
  // ==========================================
  // VICTORY CONDITIONS
  // ==========================================
  
  /** 
   * Winning patterns for Tic-Tac-Toe victory
   * Each array contains 3 sector indices that form a winning line
   */
  WINNING_PATTERNS: [
    // Horizontal rows
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    // Vertical columns
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    // Diagonals
    [0, 4, 8],
    [2, 4, 6],
  ],
  
  // ==========================================
  // FORCE FIELD SETTINGS
  // ==========================================
  
  /** Initial force field radius */
  INITIAL_FORCE_FIELD_RADIUS: 100,
  
  /** Minimum force field radius */
  MIN_FORCE_FIELD_RADIUS: 5,
  
  /** Base shrink rate per tick */
  BASE_SHRINK_RATE: 0.1,
  
  /** Additional shrink rate per player */
  SHRINK_RATE_PER_PLAYER: 0.05,
  
} as const;

// Export type for TypeScript intellisense
export type GameSettings = typeof GAME_SETTINGS;
