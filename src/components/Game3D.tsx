'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { io, Socket } from 'socket.io-client';
import { SECTOR_MAPS, SECTOR_SPAWN_POINTS } from '@/lib/SECTOR_MAPS';

interface PlayerInfo {
  id: string;
  name: string;
  team: 'X' | 'O';
  sector: number;
  lives: number;
  health: number;
}

interface SectorState {
  xPlayers: number;
  oPlayers: number;
  owner: 'X' | 'O' | null;
  shrinking: boolean;
  forceFieldRadius: number;
  xControlTime: number;
  oControlTime: number;
}

interface Game3DProps {
  playerInfo: PlayerInfo;
  sectors: SectorState[];
  players: PlayerInfo[];
  notifications: { id: string; message: string; type: 'join' | 'leave' | 'kill'; timestamp: number }[];
  onGameEnd: (winner: 'X' | 'O') => void;
}

interface RemotePlayer {
  id: string;
  name: string;
  team: 'X' | 'O';
  sector: number;
  lives: number;
  health: number;
  maxHealth: number;
  mesh: THREE.Mesh;
  label: THREE.Group;
  healthBar: THREE.Sprite;
}

interface Obstacle {
  mesh: THREE.Mesh;
  radius: number;
  boxBounds?: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

// Weapon System Types
type WeaponType = 'none' | 'gun' | 'bazooka' | 'grenade';

interface WeaponConfig {
  type: WeaponType;
  name: string;
  damage: number;
  damageRadius?: number; // For AOE weapons
  bulletSpeed: number;
  bulletLifetime: number;
  bulletSize: number;
  maxAmmo: number;
  reloadTime: number;
  fireRate: number; // Minimum time between shots (ms)
  projectileType: 'bullet' | 'rocket';
}

interface WeaponState {
  config: WeaponConfig;
  currentAmmo: number;
  isReloading: boolean;
  lastFired: number;
}

interface DroppedWeapon {
  mesh: THREE.Mesh;
  config: WeaponConfig;
  position: THREE.Vector3;
}

// Weapon Configurations
const WEAPON_CONFIGS: Record<WeaponType, WeaponConfig> = {
  none: {
    type: 'none',
    name: 'None',
    damage: 0,
    bulletSpeed: 0,
    bulletLifetime: 0,
    bulletSize: 0,
    maxAmmo: 0,
    reloadTime: 0,
    fireRate: 0,
    projectileType: 'bullet',
  },
  gun: {
    type: 'gun',
    name: 'Pistol',
    damage: 10,
    bulletSpeed: 2.0,
    bulletLifetime: 500,
    bulletSize: 0.1,
    maxAmmo: 12,
    reloadTime: 1500,
    fireRate: 150,
    projectileType: 'bullet',
  },
  bazooka: {
    type: 'bazooka',
    name: 'Bazooka',
    damage: 50,
    damageRadius: 15, // AOE radius
    bulletSpeed: 1.2,
    bulletLifetime: 150,
    bulletSize: 0.25,
    maxAmmo: 1,
    reloadTime: 2000,
    fireRate: 2000,
    projectileType: 'rocket',
  },
  grenade: {
    type: 'grenade',
    name: 'Grenade Launcher',
    damage: 70,
    damageRadius: 8, // AOE radius
    bulletSpeed: 0.8,
    bulletLifetime: 180, // 3 seconds (60fps = 180 frames)
    bulletSize: 0.35,
    maxAmmo: 5,
    reloadTime: 2500,
    fireRate: 1000,
    projectileType: 'grenade',
  },
};

export default function Game3D({ playerInfo, sectors, players, notifications, onGameEnd }: Game3DProps) {
  const [visibleNotifications, setVisibleNotifications] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const playerRef = useRef<THREE.Mesh | null>(null);
  const bulletsRef = useRef<THREE.Mesh[]>([]);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const remotePlayersRef = useRef<Map<string, RemotePlayer>>(new Map());
  const aiBotsRef = useRef<Map<string, { 
    mesh: THREE.Mesh; 
    label: THREE.Group; 
    target: THREE.Vector3; 
    lastShot: number; 
    moveTimer: number; 
    health: number; 
    maxHealth: number; 
    healthBar: THREE.Sprite;
    state: 'idle' | 'chasing' | 'attacking' | 'hiding' | 'flanking' | 'reloading';
    currentWeapon: WeaponType;
    ammo: { gun: number; bazooka: number; grenade: number };
    isReloading: boolean;
    reloadStartTime: number;
    velocity: THREE.Vector3;
    jumpCooldown: number;
    canJump: boolean;
    coverPosition: THREE.Vector3 | null;
    strafeDirection: number;
    // Memory system
    lastKnownPlayerPos: THREE.Vector3 | null;
    lastSeenTime: number;
    // BUG FIX 6: Store movement direction for smooth every-frame movement
    storedMoveDir?: THREE.Vector3;
  }>>(new Map());
  const keysRef = useRef<{ [key: string]: boolean }>({});

  // Weapon system refs
  const weaponMeshRef = useRef<THREE.Group | null>(null);
  const droppedWeaponsRef = useRef<DroppedWeapon[]>([]);
  const controlZoneRef = useRef<THREE.Mesh | null>(null); // Reference to control zone mesh
  const detectionZoneBoxRef = useRef<THREE.Box3 | null>(null); // Reference to detection zone bounding box
  const controlZoneMarkerRef = useRef<THREE.Mesh | null>(null); // Reference to marker sphere
  const inControlZoneRef = useRef(false); // Track if player is in control zone
  const reloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Bot health persistence across sector switches
  const botHealthRef = useRef<Map<string, number>>(new Map()); // Maps player.id -> health
  const weaponAmmoRef = useRef<Record<WeaponType, number>>({
    none: 0,
    gun: WEAPON_CONFIGS.gun.maxAmmo,
    bazooka: WEAPON_CONFIGS.bazooka.maxAmmo,
    grenade: WEAPON_CONFIGS.grenade.maxAmmo,
  });
  const isReloadingRef = useRef(false);
  const lastFiredRef = useRef(0);
  const currentWeaponTypeRef = useRef<WeaponType>('gun');
  const playersRef = useRef<PlayerInfo[]>(players); // Ref to track players prop changes

  // Update playersRef when players prop changes
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  // Weapon state - Track ammo per weapon
  const [weaponAmmo, setWeaponAmmo] = useState<Record<WeaponType, number>>({
    none: 0,
    gun: WEAPON_CONFIGS.gun.maxAmmo,
    bazooka: WEAPON_CONFIGS.bazooka.maxAmmo,
    grenade: WEAPON_CONFIGS.grenade.maxAmmo,
  });
  const [currentWeaponType, setCurrentWeaponType] = useState<WeaponType>('gun');
  const [isReloading, setIsReloading] = useState(false);
  const [lastFired, setLastFired] = useState(0);
  const [availableWeapons, setAvailableWeapons] = useState<WeaponType[]>(['gun', 'bazooka', 'grenade']);

  // Computed current weapon state
  const currentWeapon: WeaponState = {
    config: WEAPON_CONFIGS[currentWeaponType],
    currentAmmo: weaponAmmo[currentWeaponType],
    isReloading,
    lastFired,
  };

  // Weapon Mesh Creation
  const createWeaponMesh = useCallback((weaponType: WeaponType): THREE.Group => {
    const weaponGroup = new THREE.Group();

    if (weaponType === 'gun') {
      // Create pistol model
      const bodyGeometry = new THREE.BoxGeometry(0.1, 0.15, 0.4);
      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: 0x2d2d2d,
        metalness: 0.8,
        roughness: 0.2,
      });
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
      body.position.set(0, 0, 0);
      weaponGroup.add(body);

      // Barrel
      const barrelGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8);
      const barrel = new THREE.Mesh(barrelGeometry, bodyMaterial);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.05, 0.35);
      weaponGroup.add(barrel);

      // Handle
      const handleGeometry = new THREE.BoxGeometry(0.08, 0.12, 0.3);
      const handle = new THREE.Mesh(handleGeometry, bodyMaterial);
      handle.position.set(0, -0.05, 0.05);
      handle.rotation.x = 0.3;
      weaponGroup.add(handle);

      // Muzzle flash
      const muzzleGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8);
      const muzzleMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
      const muzzle = new THREE.Mesh(muzzleGeometry, muzzleMaterial);
      muzzle.position.set(0, 0.1, 0.4);
      weaponGroup.add(muzzle);

    } else if (weaponType === 'bazooka') {
      // Create bazooka model
      const tubeGeometry = new THREE.CylinderGeometry(0.15, 0.18, 1.2, 16);
      const tubeMaterial = new THREE.MeshStandardMaterial({
        color: 0x3d5a3d,
        metalness: 0.3,
        roughness: 0.7,
      });
      const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);
      tube.rotation.z = Math.PI / 2;
      tube.position.set(0, 0, 0.2);
      weaponGroup.add(tube);

      // Back part
      const backGeometry = new THREE.CylinderGeometry(0.2, 0.18, 0.3, 16);
      const back = new THREE.Mesh(backGeometry, tubeMaterial);
      back.rotation.z = Math.PI / 2;
      back.position.set(0, 0, -0.45);
      weaponGroup.add(back);

      // Handle
      const handleGeometry = new THREE.BoxGeometry(0.12, 0.2, 0.25);
      const handle = new THREE.Mesh(handleGeometry, tubeMaterial);
      handle.position.set(0, -0.1, 0.15);
      handle.rotation.x = 0.2;
      weaponGroup.add(handle);

      // Sight
      const sightGeometry = new THREE.BoxGeometry(0.05, 0.1, 0.05);
      const sightMaterial = new THREE.MeshStandardMaterial({
        color: 0x1d1d1d,
        metalness: 0.9,
        roughness: 0.1,
      });
      const sight = new THREE.Mesh(sightGeometry, sightMaterial);
      sight.position.set(0, 0.18, 0.5);
      weaponGroup.add(sight);

    } else if (weaponType === 'grenade') {
      // Create grenade launcher model
      const tubeGeometry = new THREE.CylinderGeometry(0.1, 0.12, 0.8, 16);
      const tubeMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a3728,
        metalness: 0.4,
        roughness: 0.6,
      });
      const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);
      tube.rotation.z = Math.PI / 2;
      tube.position.set(0, 0, 0.2);
      weaponGroup.add(tube);

      // Pump grip
      const pumpGeometry = new THREE.CylinderGeometry(0.12, 0.12, 0.15, 16);
      const pumpMaterial = new THREE.MeshStandardMaterial({
        color: 0x2d1d1d,
        metalness: 0.5,
        roughness: 0.4,
      });
      const pump = new THREE.Mesh(pumpGeometry, pumpMaterial);
      pump.rotation.z = Math.PI / 2;
      pump.position.set(0, 0, 0.45);
      weaponGroup.add(pump);

      // Handle
      const handleGeometry = new THREE.BoxGeometry(0.1, 0.18, 0.2);
      const handle = new THREE.Mesh(handleGeometry, tubeMaterial);
      handle.position.set(0, -0.08, 0.05);
      handle.rotation.x = 0.25;
      weaponGroup.add(handle);

      // Stock
      const stockGeometry = new THREE.BoxGeometry(0.08, 0.12, 0.25);
      const stock = new THREE.Mesh(stockGeometry, tubeMaterial);
      stock.position.set(0, 0, -0.35);
      weaponGroup.add(stock);

      // Barrel tip
      const tipGeometry = new THREE.CylinderGeometry(0.11, 0.11, 0.08, 16);
      const tipMaterial = new THREE.MeshStandardMaterial({
        color: 0x1d1d1d,
        metalness: 0.8,
        roughness: 0.2,
      });
      const tip = new THREE.Mesh(tipGeometry, tipMaterial);
      tip.rotation.z = Math.PI / 2;
      tip.position.set(0, 0, 0.65);
      weaponGroup.add(tip);
    }

    return weaponGroup;
  }, []);

  // Player physics

  // Player physics
  const velocityRef = useRef({ x: 0, y: 0, z: 0 });
  const isJumpingRef = useRef(false);
  const gravity = 0.015;
  const jumpForce = 0.4;

  // Sector switch refs
  const justClosedMenuRef = useRef(false);
  const isFrozenRef = useRef(false);

  const [health, setHealth] = useState(100);
  const [lives, setLives] = useState(3);
  const [kills, setKills] = useState(0);
  const [showCrosshair, setShowCrosshair] = useState(true);
  const [showCaptureAlert, setShowCaptureAlert] = useState(false);
  const [currentCapture, setCurrentCapture] = useState<{ sector: number; team: 'X' | 'O' } | null>(null);
  const [sectorControlTimes, setSectorControlTimes] = useState<{ x: number; o: number }>({ x: 0, o: 0 });
  const [allSectorTimers, setAllSectorTimers] = useState<Array<{ xControlTime: number; oControlTime: number; owner: 'X' | 'O' | null }>>([]);
  const [showInControlZone, setShowInControlZone] = useState(false);
  const [showWinMessage, setShowWinMessage] = useState(false);
  const [winner, setWinner] = useState<'X' | 'O' | null>(null);
  const [playerSector, setPlayerSector] = useState(playerInfo.sector);
  const playerSectorRef = useRef(playerInfo.sector); // Ref for synchronous access in socket handlers
  const [showRespawnDialog, setShowRespawnDialog] = useState(false);
  const [selectedRespawnSector, setSelectedRespawnSector] = useState<number | null>(null);

  // Sector switch state
  const [showSectorSwitchMenu, setShowSectorSwitchMenu] = useState(false);
  const [selectedSwitchSector, setSelectedSwitchSector] = useState<number | null>(null);
  const selectedSwitchSectorRef = useRef<number | null>(null); // Ref for synchronous access
  const [sectorSwitchCountdown, setSectorSwitchCountdown] = useState<number | null>(null);
  const [isSectorSwitching, setIsSectorSwitching] = useState(false);

  // Check collision for spawn points
  const isPositionClear = useCallback((position: THREE.Vector3): boolean => {
    // Check collision with obstacles
    for (const obstacle of obstaclesRef.current) {
      // Box collision for walls
      if (obstacle.boxBounds) {
        const { minX, maxX, minZ, maxZ } = obstacle.boxBounds;
        // Add buffer for player size (0.5 radius)
        const buffer = 0.5;
        if (position.x + buffer > minX && position.x - buffer < maxX &&
            position.z + buffer > minZ && position.z - buffer < maxZ) {
          return false; // Position is blocked
        }
      }
      // Circle collision for cylindrical obstacles
      else {
        const dx = position.x - obstacle.mesh.position.x;
        const dz = position.z - obstacle.mesh.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        if (distance < 0.5 + obstacle.radius + 1) { // 1 unit buffer
          return false; // Position is blocked
        }
      }
    }
    return true; // Position is clear
  }, []);

  const createArena = useCallback((scene: THREE.Scene) => {
    // Create grey texture with better contrast
    const createGreyTexture = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d')!;
      
      // Base grey color
      ctx.fillStyle = '#7a8289';
      ctx.fillRect(0, 0, 512, 512);
      
      // Add stronger noise/texture for better visibility
      for (let i = 0; i < 3000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const size = Math.random() * 3 + 1;
        const shade = Math.random() > 0.5 ? '#5a6269' : '#9aa2a9';
        ctx.fillStyle = shade;
        ctx.fillRect(x, y, size, size);
      }
      
      // Add some larger surface variations
      for (let i = 0; i < 50; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const size = Math.random() * 20 + 10;
        const shade = Math.random() > 0.5 ? '#6a7279' : '#8a9299';
        ctx.fillStyle = shade;
        ctx.fillRect(x, y, size, size);
      }
      
      return new THREE.CanvasTexture(canvas);
    };

    const greyTexture = createGreyTexture();

    // Much larger ground plane - single sector
    const groundSize = 200;
    const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x2d2d44,
      roughness: 0.8,
      metalness: 0.2,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid lines - much larger grid
    const gridHelper = new THREE.GridHelper(groundSize, 40, 0x9333ea, 0x4a4a6a);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Control zone in center
    const controlZoneGeometry = new THREE.CylinderGeometry(8, 8, 0.5, 32);
    const controlZoneMaterial = new THREE.MeshStandardMaterial({
      color: 0x9333ea,
      emissive: 0x9333ea,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.7,
    });
    const controlZone = new THREE.Mesh(controlZoneGeometry, controlZoneMaterial);
    controlZone.position.set(0, 0.25, 0);
    controlZone.receiveShadow = true;
    scene.add(controlZone);
    controlZoneRef.current = controlZone;

    // Create explicit detection cylinder (invisible but has collision bounds)
    // BUG FIX 3: Reduced height to 1 unit, positioned at y=0 (spans y=-0.5 to y=+0.5)
    // This matches the visual control zone more closely
    const detectionZoneGeometry = new THREE.CylinderGeometry(8, 8, 1, 32);
    const detectionZoneMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      visible: false,
    });
    const detectionZone = new THREE.Mesh(detectionZoneGeometry, detectionZoneMaterial);
    detectionZone.position.set(0, 0, 0); // Centered at y=0, spans y=-0.5 to y=+0.5
    scene.add(detectionZone);

    // Create bounding box for detection zone and store in ref
    const detectionZoneBox = new THREE.Box3().setFromObject(detectionZone);
    detectionZoneBoxRef.current = detectionZoneBox;
    console.log('[CONTROL ZONE] Detection zone created, bounding box:', detectionZoneBox);
    console.log('[CONTROL ZONE] Box min:', detectionZoneBox.min, 'Box max:', detectionZoneBox.max);

    // Add a bright floating marker in the center
    const markerGeometry = new THREE.SphereGeometry(1, 16, 16);
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.8,
    });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.set(0, 3, 0);
    scene.add(marker);
    controlZoneMarkerRef.current = marker;

    // Add a light at the marker
    const markerLight = new THREE.PointLight(0x00ff00, 2, 30);
    markerLight.position.set(0, 3, 0);
    scene.add(markerLight);

    // Add a vertical beam/cylinder to make the control zone more visible from distance
    const beamGeometry = new THREE.CylinderGeometry(8, 8, 20, 32, 1, true);
    const beamMaterial = new THREE.MeshBasicMaterial({
      color: 0x9333ea,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.position.set(0, 10, 0);
    scene.add(beam);

    // Outer ring for control zone - made brighter
    const ringGeometry = new THREE.TorusGeometry(12, 1, 16, 100);
    const ringMaterial = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x00ff88,
      emissiveIntensity: 1.0,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.set(0, 0.5, 0);
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);

    // Many more obstacles and cover - spread across larger area
    const obstacles = [
      { x: -40, z: -40, r: 5, h: 8 },
      { x: 40, z: -40, r: 4, h: 10 },
      { x: -40, z: 40, r: 6, h: 6 },
      { x: 40, z: 40, r: 5, h: 8 },
      { x: 0, z: -60, r: 5, h: 8 },
      { x: 0, z: 60, r: 6, h: 8 },
      { x: -60, z: 0, r: 4, h: 10 },
      { x: 60, z: 0, r: 5, h: 8 },
      { x: -30, z: -20, r: 4, h: 6 },
      { x: 30, z: -20, r: 5, h: 7 },
      { x: -30, z: 20, r: 5, h: 6 },
      { x: 30, z: 20, r: 4, h: 7 },
      { x: -50, z: -30, r: 6, h: 5 },
      { x: 50, z: -30, r: 5, h: 6 },
      { x: -50, z: 30, r: 5, h: 7 },
      { x: 50, z: 30, r: 6, h: 5 },
    ];

    const obstacleMaterial = new THREE.MeshStandardMaterial({
      map: greyTexture,
      color: 0x7a8289,
      roughness: 0.6,
      metalness: 0.2,
    });

    obstacles.forEach(obs => {
      const obstacleGeometry = new THREE.CylinderGeometry(obs.r, obs.r, obs.h, 8);
      const obstacle = new THREE.Mesh(obstacleGeometry, obstacleMaterial);
      obstacle.position.set(obs.x, obs.h / 2, obs.z);
      obstacle.castShadow = true;
      obstacle.receiveShadow = true;
      scene.add(obstacle);
      
      obstaclesRef.current.push({
        mesh: obstacle,
        radius: obs.r,
      });
    });

    // Boundary walls - Fixed positions and made visible
    const wallHeight = 20;
    const halfSize = groundSize / 2;
    const wallThickness = 5;
    
    const wallMaterial = new THREE.MeshStandardMaterial({
      map: greyTexture,
      color: 0x7a8289,
      roughness: 0.6,
      metalness: 0.2,
    });

    // North wall (at Z = -halfSize, back of map)
    const wallNorthGeometry = new THREE.BoxGeometry(groundSize + wallThickness * 2, wallHeight, wallThickness);
    const wallNorth = new THREE.Mesh(wallNorthGeometry, wallMaterial);
    wallNorth.position.set(0, wallHeight / 2, -halfSize - wallThickness / 2);
    wallNorth.castShadow = true;
    wallNorth.receiveShadow = true;
    scene.add(wallNorth);

    // South wall (at Z = +halfSize, front of map)
    const wallSouthGeometry = new THREE.BoxGeometry(groundSize + wallThickness * 2, wallHeight, wallThickness);
    const wallSouth = new THREE.Mesh(wallSouthGeometry, wallMaterial);
    wallSouth.position.set(0, wallHeight / 2, halfSize + wallThickness / 2);
    wallSouth.castShadow = true;
    wallSouth.receiveShadow = true;
    scene.add(wallSouth);

    // East wall (at X = +halfSize, right of map)
    const wallEastGeometry = new THREE.BoxGeometry(wallThickness, wallHeight, groundSize);
    const wallEast = new THREE.Mesh(wallEastGeometry, wallMaterial);
    wallEast.position.set(halfSize + wallThickness / 2, wallHeight / 2, 0);
    wallEast.castShadow = true;
    wallEast.receiveShadow = true;
    scene.add(wallEast);

    // West wall (at X = -halfSize, left of map)
    const wallWestGeometry = new THREE.BoxGeometry(wallThickness, wallHeight, groundSize);
    const wallWest = new THREE.Mesh(wallWestGeometry, wallMaterial);
    wallWest.position.set(-halfSize - wallThickness / 2, wallHeight / 2, 0);
    wallWest.castShadow = true;
    wallWest.receiveShadow = true;
    scene.add(wallWest);

    // Add walls to collision system with proper box bounds
    obstaclesRef.current.push(
      {
        mesh: wallNorth,
        radius: wallThickness / 2,
        boxBounds: {
          minX: -105,  // width/2 from center (0) for 210 width
          maxX: 105,
          minY: 0,    // wall position.y (10) - wallHeight/2 (10)
          maxY: 20,   // wall position.y (10) + wallHeight/2 (10)
          minZ: -105, // position.z - depth/2 = -102.5 - 2.5
          maxZ: -100, // position.z + depth/2 = -102.5 + 2.5
        }
      },
      {
        mesh: wallSouth,
        radius: wallThickness / 2,
        boxBounds: {
          minX: -105,  // width/2 from center (0) for 210 width
          maxX: 105,
          minY: 0,    // wall position.y (10) - wallHeight/2 (10)
          maxY: 20,   // wall position.y (10) + wallHeight/2 (10)
          minZ: 100,  // position.z - depth/2 = 102.5 - 2.5
          maxZ: 105,  // position.z + depth/2 = 102.5 + 2.5
        }
      },
      {
        mesh: wallEast,
        radius: wallThickness / 2,
        boxBounds: {
          minX: 100,  // position.x - width/2 = 102.5 - 2.5
          maxX: 105,  // position.x + width/2 = 102.5 + 2.5
          minY: 0,    // wall position.y (10) - wallHeight/2 (10)
          maxY: 20,   // wall position.y (10) + wallHeight/2 (10)
          minZ: -100,  // depth/2 from center (0) for 200 depth
          maxZ: 100,
        }
      },
      {
        mesh: wallWest,
        radius: wallThickness / 2,
        boxBounds: {
          minX: -105,  // position.x - width/2 = -102.5 - 2.5
          maxX: -100, // position.x + width/2 = -102.5 + 2.5
          minY: 0,    // wall position.y (10) - wallHeight/2 (10)
          maxY: 20,   // wall position.y (10) + wallHeight/2 (10)
          minZ: -100,  // depth/2 from center (0) for 200 depth
          maxZ: 100,
        }
      }
    );
  }, []);

  // Load sector map - load unique obstacles for the specified sector
  const loadSectorMap = useCallback((scene: THREE.Scene, sectorIndex: number) => {
    if (sectorIndex < 0 || sectorIndex >= SECTOR_MAPS.length) return;

    const sectorMap = SECTOR_MAPS[sectorIndex];

    // Remove existing cylinder obstacles from scene (keep walls)
    obstaclesRef.current.forEach(obs => {
      // Only remove cylinder obstacles (those without boxBounds)
      if (obs.boxBounds === undefined && obs.mesh) {
        scene.remove(obs.mesh);
      }
    });

    // Clear cylinder obstacles from collision array (keep walls)
    obstaclesRef.current = obstaclesRef.current.filter(obs => obs.boxBounds !== undefined);

    // Create grey texture for new obstacles
    const createGreyTexture = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d')!;

      ctx.fillStyle = '#7a8289';
      ctx.fillRect(0, 0, 512, 512);

      for (let i = 0; i < 3000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const size = Math.random() * 3 + 1;
        const shade = Math.random() > 0.5 ? '#5a6269' : '#9aa2a9';
        ctx.fillStyle = shade;
        ctx.fillRect(x, y, size, size);
      }

      for (let i = 0; i < 50; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const size = Math.random() * 20 + 10;
        const shade = Math.random() > 0.5 ? '#6a7279' : '#8a9299';
        ctx.fillStyle = shade;
        ctx.fillRect(x, y, size, size);
      }

      return new THREE.CanvasTexture(canvas);
    };

    const greyTexture = createGreyTexture();
    const obstacleMaterial = new THREE.MeshStandardMaterial({
      map: greyTexture,
      color: 0x7a8289,
      roughness: 0.6,
      metalness: 0.2,
    });

    // Add sector-specific obstacles
    sectorMap.obstacles.forEach(obs => {
      const obstacleGeometry = new THREE.CylinderGeometry(obs.r, obs.r, obs.h, 8);
      const obstacle = new THREE.Mesh(obstacleGeometry, obstacleMaterial);
      obstacle.position.set(obs.x, obs.h / 2, obs.z);
      obstacle.castShadow = true;
      obstacle.receiveShadow = true;
      scene.add(obstacle);

      obstaclesRef.current.push({
        mesh: obstacle,
        radius: obs.r,
      });
    });

    console.log(`[SECTOR] Loaded sector ${sectorIndex} with ${sectorMap.obstacles.length} obstacles`);
  }, []);

  // Handle sector switch request
  const handleSectorSwitch = (newSector: number) => {
    if (newSector === playerSector) return;

    setSelectedSwitchSector(newSector);
    selectedSwitchSectorRef.current = newSector; // Immediate synchronous update
    setSectorSwitchCountdown(5);
    setIsSectorSwitching(true);
    isFrozenRef.current = true;
    setShowSectorSwitchMenu(false);
    justClosedMenuRef.current = true;

    console.log(`[SECTOR] User selected sector ${newSector} to switch to`);

    setTimeout(() => {
      justClosedMenuRef.current = false;
    }, 500);
  };

  const createPlayer = useCallback((scene: THREE.Scene) => {
    const playerGeometry = new THREE.CapsuleGeometry(0.5, 2, 4, 8);
    const playerColor = playerInfo.team === 'X' ? 0x3b82f6 : 0xef4444;
    const playerMaterial = new THREE.MeshStandardMaterial({
      color: playerColor,
      emissive: playerColor,
      emissiveIntensity: 0.3,
    });
    const player = new THREE.Mesh(playerGeometry, playerMaterial);

    // BUG FIX 1: Spawn at random position away from control zone
    // Control zone is at center (0, 0) with radius 8
    // Spawn at least 20 units away from center
    const minDistance = 20;
    const maxDistance = 80;
    const angle = Math.random() * Math.PI * 2;
    const distance = minDistance + Math.random() * (maxDistance - minDistance);
    const spawnX = Math.cos(angle) * distance;
    const spawnZ = Math.sin(angle) * distance;

    player.position.set(spawnX, 1.5, spawnZ);
    player.castShadow = true;
    scene.add(player);
    playerRef.current = player;

    console.log(`[SPAWN] Player spawned at (${spawnX.toFixed(2)}, 1.5, ${spawnZ.toFixed(2)}), distance from center: ${distance.toFixed(2)}`);
  }, [playerInfo.team]);

  // Helper function to create health bar sprite
  const createHealthBar = useCallback((currentHealth: number, maxHealth: number = 100): THREE.Sprite => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 16;
    const context = canvas.getContext('2d')!;

    // Background (empty health bar)
    context.fillStyle = '#333333';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Health fill
    const healthPercent = Math.max(0, Math.min(1, currentHealth / maxHealth));
    const healthColor = healthPercent > 0.6 ? '#00ff00' : healthPercent > 0.3 ? '#ffff00' : '#ff0000';
    context.fillStyle = healthColor;
    context.fillRect(0, 0, canvas.width * healthPercent, canvas.height);

    // Border
    context.strokeStyle = '#ffffff';
    context.lineWidth = 2;
    context.strokeRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(2, 0.25, 1);

    return sprite;
  }, []);

  // Helper function to update health bar
  const updateHealthBar = useCallback((healthBar: THREE.Sprite, currentHealth: number, maxHealth: number = 100) => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 16;
    const context = canvas.getContext('2d')!;

    // Background (empty health bar)
    context.fillStyle = '#333333';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Health fill
    const healthPercent = Math.max(0, Math.min(1, currentHealth / maxHealth));
    const healthColor = healthPercent > 0.6 ? '#00ff00' : healthPercent > 0.3 ? '#ffff00' : '#ff0000';
    context.fillStyle = healthColor;
    context.fillRect(0, 0, canvas.width * healthPercent, canvas.height);

    // Border
    context.strokeStyle = '#ffffff';
    context.lineWidth = 2;
    context.strokeRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    (healthBar.material as THREE.SpriteMaterial).map = texture;
    (healthBar.material as THREE.SpriteMaterial).needsUpdate = true;
  }, []);

  const createRemotePlayer = useCallback((scene: THREE.Scene, playerInfo: PlayerInfo) => {
    const playerGeometry = new THREE.CapsuleGeometry(0.5, 2, 4, 8);
    const enemyColor = playerInfo.team === 'X' ? 0x3b82f6 : 0xef4444;
    const playerMaterial = new THREE.MeshStandardMaterial({
      color: enemyColor,
      emissive: enemyColor,
      emissiveIntensity: 0.3,
    });
    const playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
    playerMesh.position.set(
      (Math.random() - 0.5) * 80,
      1.5,
      (Math.random() - 0.5) * 80
    );
    playerMesh.castShadow = true;
    scene.add(playerMesh);

    // Create label (team + name)
    const labelGroup = new THREE.Group();
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const context = canvas.getContext('2d')!;

    context.fillStyle = playerInfo.team === 'X' ? '#3b82f6' : '#ef4444';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = 'white';
    context.font = 'bold 24px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(`${playerInfo.team} ${playerInfo.name}`, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(4, 1, 1);
    sprite.position.set(0, 2.5, 0);
    labelGroup.add(sprite);
    labelGroup.position.copy(playerMesh.position);
    scene.add(labelGroup);

    // Create health bar as child of label group (NOT scene)
    const healthBar = createHealthBar(playerInfo.health, playerInfo.health);
    healthBar.position.set(0, 3.2, 0); // Above label, relative to label group
    labelGroup.add(healthBar);

    const remotePlayer: RemotePlayer = {
      id: playerInfo.id,
      name: playerInfo.name,
      team: playerInfo.team,
      sector: playerInfo.sector,
      lives: playerInfo.lives,
      health: playerInfo.health,
      maxHealth: playerInfo.health,
      mesh: playerMesh,
      label: labelGroup,
      healthBar: healthBar,
    };

    remotePlayersRef.current.set(playerInfo.id, remotePlayer);
  }, [createHealthBar]);

  const createAIBots = useCallback((scene: THREE.Scene, players: PlayerInfo[]) => {
    console.log('[AI] Creating bots, player count:', players.length, 'player sector:', playerInfo.sector);

    // Save bot health before clearing
    aiBotsRef.current.forEach((bot, botId) => {
      if (bot.health > 0) {
        botHealthRef.current.set(botId, bot.health);
        console.log(`[AI] Saving bot ${botId} health: ${bot.health}`);
      }
    });
    
    // Clear existing bots
    aiBotsRef.current.forEach((bot, id) => {
      if (bot.mesh && scene) {
        scene.remove(bot.mesh);
      }
      if (bot.label && scene) {
        scene.remove(bot.label);
      }
      if (bot.healthBar && scene) {
        bot.label.remove(bot.healthBar);
      }
    });
    aiBotsRef.current.clear();

    // Create new bots from players list (excluding current player)
    players.forEach(player => {
      if (player.id === playerInfo.id) return; // Skip current player

      const playerGeometry = new THREE.CapsuleGeometry(0.5, 2, 4, 8);
      const botColor = player.team === 'X' ? 0x3b82f6 : 0xef4444;
      const playerMaterial = new THREE.MeshStandardMaterial({
        color: botColor,
        emissive: botColor,
        emissiveIntensity: 0.3,
      });
      const playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
      
      // Random position within sector
      playerMesh.position.set(
        (Math.random() - 0.5) * 60,
        1.5,
        (Math.random() - 0.5) * 60
      );
      playerMesh.castShadow = true;
      scene.add(playerMesh);
      
      console.log('[AI] Created bot:', player.id, 'team:', player.team, 'sector:', player.sector, 'position:', playerMesh.position);

      // Create label
      const labelGroup = new THREE.Group();
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const context = canvas.getContext('2d')!;

      context.fillStyle = player.team === 'X' ? '#3b82f6' : '#ef4444';
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.fillStyle = 'white';
      context.font = 'bold 24px Arial';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(`${player.team} ${player.name}`, canvas.width / 2, canvas.height / 2);

      const texture = new THREE.CanvasTexture(canvas);
      const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.scale.set(4, 1, 1);
      sprite.position.set(0, 2.5, 0);
      labelGroup.add(sprite);
      labelGroup.position.copy(playerMesh.position);
      scene.add(labelGroup);

      // Create health bar as child of label group (NOT scene)
      // Restore or set bot health
      const savedHealth = botHealthRef.current.get(player.id) || 100;
      const botHealth = Math.max(1, Math.min(100, savedHealth));
      
      console.log(`[SECTOR] Bot ${player.id} health: ${savedHealth} -> ${botHealth}`);

      const healthBar = createHealthBar(botHealth, botHealth);
      healthBar.position.set(0, 3.2, 0); // Above label, relative to label group
      labelGroup.add(healthBar);

      // Store bot with sophisticated AI state
      aiBotsRef.current.set(player.id, {
        mesh: playerMesh,
        label: labelGroup,
        target: new THREE.Vector3(0, 1.5, 0),
        lastShot: Date.now(),
        moveTimer: 0,
        health: botHealth,
        maxHealth: 100,
        healthBar: healthBar,
        // State machine
        state: 'idle',
        // Weapon system
        currentWeapon: 'gun',
        ammo: {
          gun: WEAPON_CONFIGS.gun.maxAmmo,
          bazooka: WEAPON_CONFIGS.bazooka.maxAmmo,
          grenade: WEAPON_CONFIGS.grenade.maxAmmo,
        },
        isReloading: false,
        reloadStartTime: 0,
        // Movement
        velocity: new THREE.Vector3(0, 0, 0),
        jumpCooldown: 0,
        canJump: true,
        coverPosition: null,
        strafeDirection: Math.random() > 0.5 ? 1 : -1,
        // Memory system
        lastKnownPlayerPos: null,
        lastSeenTime: 0,
        // BUG FIX 6: Initialize storedMoveDir so bots can move immediately
        storedMoveDir: new THREE.Vector3(0, 0, 0),
      });
    });
  }, [playerInfo.id, playerInfo.sector, players]);

  const createBullet = useCallback((position: any, direction: any, weaponConfig: WeaponConfig, isLocalPlayer: boolean = true, shooterTeam?: 'X' | 'O') => {
    if (!sceneRef.current) return;

    // Use weapon config properties
    const bulletGeometry = new THREE.SphereGeometry(weaponConfig.bulletSize, 8, 8);
    // Color projectiles by type: Rockets (orange), Grenades (green), Pistols (yellow)
    const bulletColor = weaponConfig.projectileType === 'rocket'
      ? 0xff6600  // Orange for rockets
      : weaponConfig.projectileType === 'grenade'
        ? 0x00ff00  // Green for grenades
        : 0xffff00;  // Yellow for pistol bullets
    const bulletMaterial = new THREE.MeshBasicMaterial({ color: bulletColor });
    const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
    bullet.position.set(position.x, position.y, position.z);

    // Determine shooter team
    const team = shooterTeam ?? playerInfo.team;

    bullet.userData = {
      velocity: new THREE.Vector3(direction.x, direction.y, direction.z).multiplyScalar(weaponConfig.bulletSpeed),
      lifetime: weaponConfig.bulletLifetime,
      damage: weaponConfig.damage,
      damageRadius: weaponConfig.damageRadius || 0,
      projectileType: weaponConfig.projectileType,
      isLocalPlayer: isLocalPlayer,
      bulletSize: weaponConfig.bulletSize,
      shooterTeam: team,
    };

    sceneRef.current.add(bullet);
    bulletsRef.current.push(bullet);
  }, [playerInfo.team]);

  const reloadWeapon = useCallback(() => {
    // Don't allow reload when frozen (during sector switch)
    if (isFrozenRef.current) return;

    // Clear any existing reload timeout
    if (reloadTimeoutRef.current) {
      clearTimeout(reloadTimeoutRef.current);
      reloadTimeoutRef.current = null;
    }

    const currentType = currentWeaponTypeRef.current;

    // Prevent reload if already reloading or already at max ammo
    if (isReloadingRef.current || weaponAmmoRef.current[currentType] >= WEAPON_CONFIGS[currentType].maxAmmo) {
      return;
    }

    setIsReloading(true);
    isReloadingRef.current = true;

    reloadTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;

      setWeaponAmmo(prev => ({
        ...prev,
        [currentType]: WEAPON_CONFIGS[currentType].maxAmmo,
      }));
      weaponAmmoRef.current[currentType] = WEAPON_CONFIGS[currentType].maxAmmo;
      setIsReloading(false);
      isReloadingRef.current = false;
      reloadTimeoutRef.current = null;
    }, WEAPON_CONFIGS[currentType].reloadTime);
  }, []);

  const switchWeapon = useCallback((weaponType: WeaponType) => {
    // Don't switch if same weapon or weapon not available
    if (!availableWeapons.includes(weaponType) || weaponType === currentWeaponType) return;

    // Clear any ongoing reload
    if (reloadTimeoutRef.current) {
      clearTimeout(reloadTimeoutRef.current);
      reloadTimeoutRef.current = null;
      setIsReloading(false);
      isReloadingRef.current = false;
    }

    // Update weapon type
    setCurrentWeaponType(weaponType);
    currentWeaponTypeRef.current = weaponType;
    setLastFired(0);
    lastFiredRef.current = 0;

    // Sync refs with current ammo state
    weaponAmmoRef.current[weaponType] = weaponAmmo[weaponType];
  }, [availableWeapons, currentWeaponType, weaponAmmo]);

  const shoot = useCallback(() => {
    // Don't allow shooting when frozen (during sector switch)
    if (isFrozenRef.current) {
      console.log('[SHOOT] Blocked: Player is frozen');
      return;
    }

    // Don't allow shooting when pointer is not locked
    if (document.pointerLockElement !== containerRef.current) {
      console.log('[SHOOT] Blocked: Pointer not locked. PointerLockElement:', document.pointerLockElement, 'Container:', containerRef.current);
      return;
    }

    if (!cameraRef.current || !socketRef.current || !playerRef.current) {
      console.log('[SHOOT] Blocked: Missing refs - camera:', !!cameraRef.current, 'socket:', !!socketRef.current, 'player:', !!playerRef.current);
      return;
    }

    const now = Date.now();
    const currentType = currentWeaponTypeRef.current;
    const config = WEAPON_CONFIGS[currentType];
    const currentAmmo = weaponAmmoRef.current[currentType];

    // Check if reloading
    if (isReloadingRef.current) return;

    // Check fire rate
    if (now - lastFiredRef.current < config.fireRate) return;

    // Check ammo
    if (currentAmmo <= 0) {
      // Auto reload when out of ammo
      // reloadWeapon(); // Remove the auto reload
      return;
    }

    const direction = new THREE.Vector3();
    cameraRef.current.getWorldDirection(direction);

    // Fire bullet using current weapon config
    createBullet(cameraRef.current.position, direction, config, true);

    // Update ammo and last fired time
    setWeaponAmmo(prev => ({
      ...prev,
      [currentType]: prev[currentType] - 1,
    }));
    weaponAmmoRef.current[currentType] -= 1;
    setLastFired(now);
    lastFiredRef.current = now;

    socketRef.current.emit('shoot', {
      direction: { x: direction.x, y: direction.y, z: direction.z },
      weaponType: currentType,
      position: { x: cameraRef.current.position.x, y: cameraRef.current.position.y, z: cameraRef.current.position.z },
    });
  }, [createBullet, reloadWeapon]);

  const createExplosion = useCallback((position: THREE.Vector3, radius: number) => {
    if (!sceneRef.current) return;

    // Create explosion sphere
    const explosionGeometry = new THREE.SphereGeometry(radius / 2, 16, 16);
    const explosionMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.8,
    });
    const explosion = new THREE.Mesh(explosionGeometry, explosionMaterial);
    explosion.position.copy(position);
    // Don't force y=1.5 - use actual impact position
    sceneRef.current.add(explosion);

    // Animate explosion with mount check
    let scale = 1;
    let animationFrameId: number;

    const animateExplosion = () => {
      if (!isMountedRef.current) {
        // Component unmounted, clean up
        if (sceneRef.current && explosion.parent === sceneRef.current) {
          sceneRef.current.remove(explosion);
        }
        return;
      }

      scale += 0.2;
      explosion.scale.set(scale, scale, scale);
      explosion.material.opacity -= 0.05;

      if (explosion.material.opacity > 0) {
        animationFrameId = requestAnimationFrame(animateExplosion);
      } else {
        if (sceneRef.current) {
          sceneRef.current.remove(explosion);
        }
      }
    };
    animateExplosion();

    // Return cleanup function
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, []);

  const checkCollision = useCallback((position: THREE.Vector3, playerRadius: number = 0.5, excludePlayerId?: string) => {
    if (!sceneRef.current) return false;

    for (const obstacle of obstaclesRef.current) {
      // Box collision for walls
      if (obstacle.boxBounds) {
        const { minX, maxX, minZ, maxZ } = obstacle.boxBounds;

        // Check if player (with radius) overlaps with box
        if (position.x + playerRadius > minX && position.x - playerRadius < maxX &&
            position.z + playerRadius > minZ && position.z - playerRadius < maxZ) {
          return true;
        }
      }
      // Circle collision for cylindrical obstacles
      else {
        const dx = position.x - obstacle.mesh.position.x;
        const dz = position.z - obstacle.mesh.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance < playerRadius + obstacle.radius) {
          return true;
        }
      }
    }

    // Check collision with remote players
    for (const [playerId, remotePlayer] of remotePlayersRef.current) {
      if (playerId === excludePlayerId || !remotePlayer.mesh.visible) continue;

      const dx = position.x - remotePlayer.mesh.position.x;
      const dz = position.z - remotePlayer.mesh.position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance < playerRadius + 0.5) { // 0.5 is the other player's radius
        return true;
      }
    }

    // Check collision with AI bots
    // BUG FIX 6: Exclude the bot that's checking collision (passed as excludePlayerId)
    for (const [otherBotId, bot] of aiBotsRef.current) {
      if (otherBotId === excludePlayerId) continue; // Don't collide with self
      if (!bot.mesh || !bot.mesh.visible) continue;

      const dx = position.x - bot.mesh.position.x;
      const dz = position.z - bot.mesh.position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance < playerRadius + 0.5) { // 0.5 is the bot's radius
        return true;
      }
    }

    return false;
  }, []);

  // Helper: Calculate predictive aim position
  const getPredictedAimPosition = useCallback((targetPos: THREE.Vector3, targetVelocity: THREE.Vector3, bulletSpeed: number): THREE.Vector3 => {
    const distToTarget = targetPos.distanceTo(playerRef.current?.position || new THREE.Vector3());
    const bulletTravelTime = distToTarget / bulletSpeed;
    
    // Predict where target will be when bullet arrives
    const predictedPos = targetPos.clone().add(
      targetVelocity.clone().multiplyScalar(bulletTravelTime * 10)
    );
    
    return predictedPos;
  }, []);

  // Helper: Calculate grenade bounce point off wall
  const getGrenadeBouncePoint = useCallback((targetPos: THREE.Vector3, startPos: THREE.Vector3): THREE.Vector3 | null => {
    // Get wall bounds (assuming 100x100 arena from -100 to 100)
    const wallMin = -95;
    const wallMax = 95;
    
    // Try bouncing off each wall
    const walls = [
      { normal: new THREE.Vector3(1, 0, 0), pos: wallMin },  // Left wall
      { normal: new THREE.Vector3(-1, 0, 0), pos: wallMax },  // Right wall
      { normal: new THREE.Vector3(0, 0, 1), pos: wallMin },  // Back wall
      { normal: new THREE.Vector3(0, 0, -1), pos: wallMax },  // Front wall
    ];
    
    let bestBouncePoint: THREE.Vector3 | null = null;
    let bestBounceDist = Infinity;
    
    for (const wall of walls) {
      // Calculate reflection using: V_reflect = V - 2(V·N)N
      const toTarget = targetPos.clone().sub(startPos);
      const toWall = wall.normal.clone().multiplyScalar(wall.pos - (wall.normal.x === 1 ? startPos.x : wall.normal.z === 1 ? startPos.z : 0));
      
      // Check if wall is in the right direction
      if (toTarget.dot(toWall) > 0) {
        // Calculate reflection vector
        const reflected = toTarget.clone().sub(
          wall.normal.clone().multiplyScalar(2 * toTarget.dot(wall.normal))
        );
        
        // Calculate bounce point (where grenade hits wall)
        const distToWall = Math.abs(wall.pos - (wall.normal.x === 1 ? startPos.x : wall.normal.z === 1 ? startPos.z : 0));
        const wallHitPoint = startPos.clone().add(
          toTarget.clone().normalize().multiplyScalar(distToWall)
        );
        
        // Calculate reflected target point
        const reflectedTarget = wallHitPoint.clone().add(reflected.normalize().multiplyScalar(30));
        
        // Check if this bounce point is better (closer to actual target)
        const distToActualTarget = reflectedTarget.distanceTo(targetPos);
        if (distToActualTarget < bestBounceDist) {
          bestBounceDist = distToActualTarget;
          bestBouncePoint = reflectedTarget;
        }
      }
    }
    
    return bestBouncePoint;
  }, []);

  const update = useCallback(() => {
    if (!cameraRef.current || !playerRef.current || !sceneRef.current) return;

    // Player movement
    const moveSpeed = 0.15;
    const keys = keysRef.current;

    // Projectile collision detection radius (0.8 units for direct hits)
    const projectileCollisionRadius = 0.8;

    // Freeze player during sector switch
    if (isFrozenRef.current) {
      // Keep camera synced with player position (constant Y offset)
      cameraRef.current.position.x = playerRef.current.position.x;
      cameraRef.current.position.z = playerRef.current.position.z;
      cameraRef.current.position.y = playerRef.current.position.y + 2.5;
    } else {
      // Normal movement logic
    const direction = new THREE.Vector3();
    const forward = new THREE.Vector3(0, 0, -1);
    const right = new THREE.Vector3(1, 0, 0);

    forward.applyQuaternion(cameraRef.current.quaternion);
    forward.y = 0;
    forward.normalize();

    right.applyQuaternion(cameraRef.current.quaternion);
    right.y = 0;
    right.normalize();

    if (keys.w || keys.W) direction.add(forward);
    if (keys.s || keys.S) direction.sub(forward);
    if (keys.a || keys.A) direction.sub(right);
    if (keys.d || keys.D) direction.add(right);

    // Apply movement with collision detection
    if (direction.length() > 0) {
      direction.normalize().multiplyScalar(moveSpeed);
      
      const newPos = playerRef.current.position.clone();
      newPos.x += direction.x;
      newPos.z += direction.z;
      
      // Check horizontal movement collision
      const testPosX = playerRef.current.position.clone();
      testPosX.x += direction.x;
      if (!checkCollision(testPosX, 0.5, playerInfo.id)) {
        velocityRef.current.x = direction.x;
      } else {
        velocityRef.current.x = 0;
      }

      // Check forward/backward movement collision
      const testPosZ = playerRef.current.position.clone();
      testPosZ.z += direction.z;
      if (!checkCollision(testPosZ, 0.5, playerInfo.id)) {
        velocityRef.current.z = direction.z;
      } else {
        velocityRef.current.z = 0;
      }
      
      playerRef.current.position.x += velocityRef.current.x;
      playerRef.current.position.z += velocityRef.current.z;
    }

    // Always keep camera Y position in sync with player (even when not moving)
    cameraRef.current.position.y = playerRef.current.position.y + 2.5;
    cameraRef.current.position.x = playerRef.current.position.x;
    cameraRef.current.position.z = playerRef.current.position.z;

    // Emit position update
    if (socketRef.current) {
      socketRef.current.emit('updatePosition', {
        x: playerRef.current.position.x,
        y: playerRef.current.position.y + 2.5,
        z: playerRef.current.position.z,
        rotation: cameraRef.current.rotation.y,
      });
    }
    }  // End of else (not frozen)

    // Jumping
    if ((keys[' '] || keys[' ']) && !isJumpingRef.current && playerRef.current.position.y <= 1.5) {
      velocityRef.current.y = jumpForce;
      isJumpingRef.current = true;
    }

    // Apply gravity
    velocityRef.current.y -= gravity;
    playerRef.current.position.y += velocityRef.current.y;

    // Ground collision
    if (playerRef.current.position.y < 1.5) {
      playerRef.current.position.y = 1.5;
      velocityRef.current.y = 0;
      isJumpingRef.current = false;
    }

    // Check if player is in control zone using distance from center
    // BUG FIX 2: Use simple distance check instead of bounding box
    // Control zone is at center (0, 0) with radius 8
    const playerPos = playerRef.current.position.clone();
    const distFromCenter = Math.sqrt(playerPos.x * playerPos.x + playerPos.z * playerPos.z);
    const inZone = distFromCenter <= 8;
    
    // DEBUG: Log distance every frame when checking zone
    // console.log(`[CONTROL ZONE] Player pos: (${playerPos.x.toFixed(2)}, ${playerPos.z.toFixed(2)}), Distance: ${distFromCenter.toFixed(2)}, In zone: ${inZone}`);

    // Visual feedback for control zone
    if (controlZoneRef.current) {
      const material = controlZoneRef.current.material as THREE.MeshStandardMaterial;
      if (inZone) {
        // Player is in zone - pulse effect
        material.emissiveIntensity = 1.5 + Math.sin(Date.now() * 0.01) * 0.5;
        material.color.setHex(playerInfo.team === 'X' ? 0x3b82f6 : 0xef4444);
        material.emissive.setHex(playerInfo.team === 'X' ? 0x3b82f6 : 0xef4444);
      } else {
        // Player is not in zone - normal purple color
        material.emissiveIntensity = 0.8;
        material.color.setHex(0x9333ea);
        material.emissive.setHex(0x9333ea);
      }
    }

    // Animate marker when player is in zone
    if (controlZoneMarkerRef.current) {
      if (inZone) {
        // Make marker pulse and change color to team color
        const scale = 1 + Math.sin(Date.now() * 0.02) * 0.3;
        controlZoneMarkerRef.current.scale.set(scale, scale, scale);
        controlZoneMarkerRef.current.position.y = 3 + Math.sin(Date.now() * 0.005) * 0.5;
        (controlZoneMarkerRef.current.material as THREE.MeshBasicMaterial).color.setHex(playerInfo.team === 'X' ? 0x3b82f6 : 0xef4444);
      } else {
        // Gentle floating animation
        controlZoneMarkerRef.current.scale.set(1, 1, 1);
        controlZoneMarkerRef.current.position.y = 3 + Math.sin(Date.now() * 0.002) * 0.3;
        (controlZoneMarkerRef.current.material as THREE.MeshBasicMaterial).color.setHex(0x00ff00);
      }
    }

    // Update UI state for control zone
    setShowInControlZone(inZone);

    // Debug logging
    if (inZone !== inControlZoneRef.current) {
      console.log(`[CONTROL ZONE] Player position: (${playerPos.x.toFixed(2)}, ${playerPos.y.toFixed(2)}, ${playerPos.z.toFixed(2)})`);
      console.log(`[CONTROL ZONE] Detection box:`, detectionZoneBoxRef.current);
      console.log(`[CONTROL ZONE] In zone: ${inZone}`);
    }

    if (inZone !== inControlZoneRef.current && socketRef.current) {
      // State changed - emit appropriate event
      if (inZone) {
        console.log(`[CONTROL ZONE] Emitting enterControlZone event`);
        socketRef.current.emit('enterControlZone');
      } else {
        console.log(`[CONTROL ZONE] Emitting leaveControlZone event`);
        socketRef.current.emit('leaveControlZone');
      }
      inControlZoneRef.current = inZone;
    }
    // Update bullets
    bulletsRef.current.forEach((bullet, index) => {
      if (bullet.userData.projectileType === 'grenade') {
        bullet.userData.velocity.y -= 0.01;
      }
      bullet.position.add(bullet.userData.velocity);
      bullet.userData.lifetime--;

      // Check if bullet is a grenade
      const isGrenade = bullet.userData.projectileType === 'grenade';
      const isRocket = bullet.userData.projectileType === 'rocket';
      const bulletRadius = bullet.userData.bulletSize;

      // Rockets and pistols: check collision with obstacles
      if (!isGrenade) {
        for (const obstacle of obstaclesRef.current) {
          let hitObstacle = false;

          if (obstacle.boxBounds) {
            // Wall (box bounds) - check sphere-AABB intersection in 3D
            const minX = obstacle.boxBounds.minX;
            const maxX = obstacle.boxBounds.maxX;
            const minY = obstacle.boxBounds.minY;
            const maxY = obstacle.boxBounds.maxY;
            const minZ = obstacle.boxBounds.minZ;
            const maxZ = obstacle.boxBounds.maxZ;

            // Closest point on AABB to sphere center
            const closestX = Math.max(minX, Math.min(bullet.position.x, maxX));
            const closestY = Math.max(minY, Math.min(bullet.position.y, maxY));
            const closestZ = Math.max(minZ, Math.min(bullet.position.z, maxZ));

            // Distance from sphere center to closest point
            const dx = closestX - bullet.position.x;
            const dy = closestY - bullet.position.y;
            const dz = closestZ - bullet.position.z;
            const distSq = dx * dx + dy * dy + dz * dz;

            // Check if sphere intersects AABB in 3D
            if (distSq < bulletRadius * bulletRadius) {
              hitObstacle = true;
            }
          } else {
            // Cylinder obstacle - check sphere-cylinder intersection in 3D
            const cylRadius = obstacle.radius;
            const cylHeight = 10; // Cylinder height from arena creation
            const cylPos = obstacle.mesh.position;

            // Check if within cylinder height range
            const withinHeight = bullet.position.y >= cylPos.y - cylHeight / 2 &&
                                bullet.position.y <= cylPos.y + cylHeight / 2;

            if (withinHeight) {
              // Horizontal distance from cylinder center to sphere center
              const dx = bullet.position.x - cylPos.x;
              const dz = bullet.position.z - cylPos.z;
              const horizontalDistSq = dx * dx + dz * dz;
              const horizontalDist = Math.sqrt(horizontalDistSq);

              // Check if sphere is close enough to cylinder (radial)
              if (horizontalDist < (cylRadius + bulletRadius)) {
                hitObstacle = true;
              }
            }
          }

          if (hitObstacle && bullet.userData.lifetime > 0) {
            bullet.userData.lifetime = 0;
            if (isRocket) {
              createExplosion(bullet.position, bullet.userData.damageRadius);
            }
            break;
          }
        }
      }

      let hasExploded = false;

      // Grenade specific logic: bounce and explode after delay
      if (isGrenade) {
        // Initialize grenade data if not set
        if (bullet.userData.bounces === undefined) {
          bullet.userData.bounces = 0;
          bullet.userData.explosionTimer = 120; // 2 seconds at 60fps
        }

        // Decrement explosion timer
        bullet.userData.explosionTimer--;

        // Check if grenade should explode (timer expired or max bounces reached)
        const shouldExplode = bullet.userData.explosionTimer <= 0 || bullet.userData.bounces >= 10;

        if (shouldExplode && !hasExploded) {
          createExplosion(bullet.position, bullet.userData.damageRadius);
          hasExploded = true;
          bullet.userData.lifetime = 0;
        } else {
          // Track if grenade bounced this frame to prevent multiple bounces in one frame
          let bouncedThisFrame = false;

          // Bounce off obstacles
          for (const obstacle of obstaclesRef.current) {
            if (bullet.userData.bounces >= 10 || bouncedThisFrame) break;

            if (obstacle.boxBounds) {
              // Wall collision - check sphere-AABB intersection
              const minX = obstacle.boxBounds.minX;
              const maxX = obstacle.boxBounds.maxX;
              const minY = obstacle.boxBounds.minY;
              const maxY = obstacle.boxBounds.maxY;
              const minZ = obstacle.boxBounds.minZ;
              const maxZ = obstacle.boxBounds.maxZ;

              const closestX = Math.max(minX, Math.min(bullet.position.x, maxX));
              const closestY = Math.max(minY, Math.min(bullet.position.y, maxY));
              const closestZ = Math.max(minZ, Math.min(bullet.position.z, maxZ));

              const dx = closestX - bullet.position.x;
              const dy = closestY - bullet.position.y;
              const dz = closestZ - bullet.position.z;
              const distSq = dx * dx + dy * dy + dz * dz;

              if (distSq < bulletRadius * bulletRadius) {
                // Determine which face was hit and calculate normal
                const overlapX = bulletRadius - Math.abs(dx);
                const overlapY = bulletRadius - Math.abs(dy);
                const overlapZ = bulletRadius - Math.abs(dz);

                let normal = new THREE.Vector3(0, 0, 0);

                if (overlapX < overlapY && overlapX < overlapZ) {
                  // Hit X-face
                  normal.set(dx > 0 ? -1 : 1, 0, 0);
                  bullet.position.x += dx > 0 ? -overlapX - 0.01 : overlapX + 0.01;
                } else if (overlapY < overlapZ) {
                  // Hit Y-face (ceiling/floor)
                  normal.set(0, dy > 0 ? -1 : 1, 0);
                  bullet.position.y += dy > 0 ? -overlapY - 0.01 : overlapY + 0.01;
                } else {
                  // Hit Z-face
                  normal.set(0, 0, dz > 0 ? -1 : 1);
                  bullet.position.z += dz > 0 ? -overlapZ - 0.01 : overlapZ + 0.01;
                }

                // Reflect velocity using surface normal: V_new = V_old - 2(V_old · N)N
                const dotProduct = bullet.userData.velocity.dot(normal);
                bullet.userData.velocity.sub(normal.multiplyScalar(2 * dotProduct));
                
                // Apply velocity multiplier (slow down)
                bullet.userData.velocity.multiplyScalar(0.9);

                bullet.userData.bounces++;
                bouncedThisFrame = true;
                break;
              }
            } else {
              // Cylinder collision
              const cylRadius = obstacle.radius;
              const cylHeight = 10;
              const cylPos = obstacle.mesh.position;

              const withinHeight = bullet.position.y >= cylPos.y - cylHeight / 2 &&
                                  bullet.position.y <= cylPos.y + cylHeight / 2;

              if (withinHeight) {
                const dx = bullet.position.x - cylPos.x;
                const dz = bullet.position.z - cylPos.z;
                const horizontalDistSq = dx * dx + dz * dz;
                const horizontalDist = Math.sqrt(horizontalDistSq);
                const minDistance = cylRadius + bulletRadius;

                if (horizontalDist < minDistance) {
                  // Calculate normal vector (from cylinder center to impact point)
                  const normal = new THREE.Vector3(dx, 0, dz).normalize();
                  
                  // Reflect velocity using surface normal: V_new = V_old - 2(V_old · N)N
                  const dotProduct = bullet.userData.velocity.dot(normal);
                  bullet.userData.velocity.sub(normal.multiplyScalar(2 * dotProduct));
                  
                  // Apply velocity multiplier (slow down)
                  bullet.userData.velocity.multiplyScalar(0.9);

                  // Push grenade out of cylinder
                  const overlap = minDistance - horizontalDist;
                  const pushOut = overlap + 0.01;
                  bullet.position.x += normal.x * pushOut;
                  bullet.position.z += normal.z * pushOut;

                  bullet.userData.bounces++;
                  bouncedThisFrame = true;
                  break;
                }
              }
            }
          }

          // Bounce off ground (only if hasn't bounced this frame)
          if (!bouncedThisFrame && bullet.position.y < 1.5 && bullet.userData.bounces < 10) {
            bullet.position.y = 1.5;
            
            // Ground normal is (0, 1, 0) - pointing up
            const normal = new THREE.Vector3(0, 1, 0);
            
            // Reflect velocity using surface normal: V_new = V_old - 2(V_old · N)N
            const dotProduct = bullet.userData.velocity.dot(normal);
            bullet.userData.velocity.sub(normal.multiplyScalar(2 * dotProduct));
            
            // Apply velocity multiplier (slow down)
            bullet.userData.velocity.multiplyScalar(0.9);
            
            bullet.userData.bounces++;
          }
        }
      }

      // Check ground collision (non-grenade projectiles)
      if (!isGrenade && bullet.position.y < 1.5) {
        bullet.userData.lifetime = 0;
        if (isRocket && !hasExploded) {
          createExplosion(bullet.position, bullet.userData.damageRadius);
          hasExploded = true;
        }
      }

      // Check collision with targets (players and bots)
      // For rockets and grenades: explode on collision or lifetime end (AOE damage)
      // For pistols: apply damage immediately on hit, then destroy bullet
      const damageRadius = (isRocket || isGrenade) ? bullet.userData.damageRadius : projectileCollisionRadius;
      let bulletHit = false;

      // Track which players/bots are killed by this bullet to prevent duplicate kills
      const killedTargets = new Set<string>();

      // Apply damage to remote players
      // For rockets: only deal damage when exploding
      // For grenades: only deal damage when exploding, but explode on direct hit
      let grenadeExploding = isGrenade && bullet.userData.explosionTimer !== undefined && bullet.userData.explosionTimer <= 0;
      const rocketExploding = isRocket && hasExploded;
      
      // Check for grenade direct hits BEFORE processing damage
      // This ensures grenades explode on contact and damage is applied
      if (isGrenade && !grenadeExploding) {
        const directHitDistance = bulletRadius + 0.5; // grenade radius + player radius
        
        // Check remote players
        for (const [playerId, remotePlayer] of remotePlayersRef.current) {
          if (remotePlayer.health > 0 && remotePlayer.mesh.visible) {
            const distance = bullet.position.distanceTo(remotePlayer.mesh.position);
            if (distance < directHitDistance) {
              // Direct hit! Grenade explodes immediately
              if (!hasExploded) {
                createExplosion(bullet.position, bullet.userData.damageRadius);
                hasExploded = true;
                bullet.userData.lifetime = 0;
                // Set explosion timer to 0 so damage will be calculated below
                bullet.userData.explosionTimer = 0;
                grenadeExploding = true;
              }
              break;
            }
          }
        }
        
        // Check AI bots if no direct hit on players
        if (!hasExploded) {
          for (const [botId, bot] of aiBotsRef.current) {
            if (bot.mesh && bot.mesh.visible && bot.health > 0) {
              const distance = bullet.position.distanceTo(bot.mesh.position);
              if (distance < directHitDistance) {
                // Direct hit! Grenade explodes immediately
                if (!hasExploded) {
                  createExplosion(bullet.position, bullet.userData.damageRadius);
                  hasExploded = true;
                  bullet.userData.lifetime = 0;
                  // Set explosion timer to 0 so damage will be calculated below
                  bullet.userData.explosionTimer = 0;
                  grenadeExploding = true;
                }
                break;
              }
            }
          }
        }
      }
      
      remotePlayersRef.current.forEach((remotePlayer, playerId) => {
        // Skip damage check if rocket hasn't exploded yet
        if (isRocket && !rocketExploding) return;
        
        // Skip damage check if grenade hasn't exploded yet
        if (isGrenade && !grenadeExploding) return;

        if (remotePlayer.health > 0 && remotePlayer.mesh.visible) {
          const distance = bullet.position.distanceTo(remotePlayer.mesh.position);
          if (distance < damageRadius) {
            // Get the shooter's team from the bullet
            const shooterTeam = bullet.userData.shooterTeam ?? playerInfo.team;

            // Only damage enemy players (shooter's team != remote player's team)
            if (remotePlayer.team !== shooterTeam) {
              // For pistols: destroy bullet immediately on first hit
              // Rockets and grenades: don't destroy on contact (explode separately)
              if (!isRocket && !isGrenade && !bulletHit) {
                bulletHit = true;
                bullet.userData.lifetime = 0;
              }

              // Calculate damage with falloff for AOE weapons (rockets and grenades)
              let damage = bullet.userData.damage;
              if (isRocket || isGrenade) {
                // Damage falloff: less damage at edge of explosion
                // At center: 100% damage, at edge: 20% damage
                const falloffRatio = distance / damageRadius;
                const damageMultiplier = 1 - (falloffRatio * 0.8); // Linear falloff to 20%
                damage = Math.max(1, Math.floor(damage * damageMultiplier));
              }

              // Check if this hit kills the player
              const wasAlive = remotePlayer.health > 0;
              const newHealth = Math.max(0, remotePlayer.health - damage);
              const isDead = newHealth <= 0;

              // Apply damage locally (client-side prediction)
              remotePlayer.health = newHealth;

              // Update health bar
              if (remotePlayer.healthBar) {
                updateHealthBar(remotePlayer.healthBar, newHealth, remotePlayer.maxHealth);
              }

              // Visual flash feedback
              if (remotePlayer.mesh.material instanceof THREE.MeshStandardMaterial) {
                remotePlayer.mesh.material.emissive.setHex(0xffffff);
                setTimeout(() => {
                  remotePlayer.mesh.material.emissive.setHex(
                    remotePlayer.team === 'X' ? 0x3b82f6 : 0xef4444
                  );
                }, 100);
              }

              // Emit damage to server
              if (socketRef.current && bullet.userData.isLocalPlayer) {
                socketRef.current.emit('takeDamage', {
                  targetId: playerId,
                  damage: damage,
                  attackerId: playerInfo.id,
                });
              }

              // Count kill ONLY if this hit actually killed the player
              if (wasAlive && isDead && !killedTargets.has(playerId)) {
                killedTargets.add(playerId);
                setKills(prev => prev + 1);
              }
            }
          }
        }
      });


      // Check collision with AI bots
      aiBotsRef.current.forEach((bot, botId) => {
        // Skip damage check if rocket hasn't exploded yet
        if (isRocket && !rocketExploding) return;
        
        // Skip damage check if grenade hasn't exploded yet
        if (isGrenade && !grenadeExploding) return;

        if (bot.mesh && bot.mesh.visible && bot.health > 0) {
          const distance = bullet.position.distanceTo(bot.mesh.position);
          if (distance < damageRadius) {
            // Calculate bot team
            const botInfo = players.find(p => p.id === botId);
            const remoteTeam = remotePlayersRef.current.get(botId)?.team;
            const botTeam = botInfo?.team ?? remoteTeam ?? (playerInfo.team === 'X' ? 'O' : 'X');

            // Get the shooter's team from the bullet
            const shooterTeam = bullet.userData.shooterTeam ?? playerInfo.team;

            // Only damage enemy bots (shooter's team != bot's team)
            if (botTeam !== shooterTeam) {
              // For pistols: destroy bullet immediately on first hit
              // Rockets and grenades: don't destroy on contact (explode separately)
              if (!isRocket && !isGrenade && !bulletHit) {
                bulletHit = true;
                bullet.userData.lifetime = 0;
              }

              // Calculate damage with falloff for AOE weapons (rockets and grenades)
              let damage = bullet.userData.damage;
              if (isRocket || isGrenade) {
                // Damage falloff: less damage at edge of explosion
                // At center: 100% damage, at edge: 20% damage
                const falloffRatio = distance / damageRadius;
                const damageMultiplier = 1 - (falloffRatio * 0.8); // Linear falloff to 20%
                damage = Math.max(1, Math.floor(damage * damageMultiplier));
              }

              // Check if this hit kills the bot
              const wasAlive = bot.health > 0;
              const newHealth = Math.max(0, bot.health - damage);
              const isDead = newHealth <= 0;

              // Apply damage
              bot.health = newHealth;

              // Update health bar
              if (bot.healthBar) {
                updateHealthBar(bot.healthBar, newHealth, bot.maxHealth);
              }

              // Visual feedback - flash red
              if (bot.mesh.material instanceof THREE.MeshStandardMaterial) {
                bot.mesh.material.emissive.setHex(0xffffff);
                setTimeout(() => {
                  bot.mesh.material.emissive.setHex(
                    botTeam === 'X' ? 0x3b82f6 : 0xef4444
                  );
                }, 100);
              }

              // Kill bot if health is 0
              if (newHealth <= 0) {
                bot.mesh.visible = false;
                if (bot.label) {
                  bot.label.visible = false;
                }
                if (bot.healthBar) {
                  bot.healthBar.visible = false;
                }
              }

              // Count kill ONLY if this hit actually killed the bot
              if (wasAlive && isDead && !killedTargets.has(botId)) {
                killedTargets.add(botId);
                setKills(prev => prev + 1);
              }
            }
          }
        }
      });
      // Rockets: explode on lifetime end or when hit
      if (isRocket && bullet.userData.lifetime <= 0 && !rocketExploding) {
        // Create explosion effect for rockets (only if not already exploded from obstacle/ground collision)
        createExplosion(bullet.position, bullet.userData.damageRadius);
        bullet.userData.lifetime = 0;
      }

      if (bullet.userData.lifetime <= 0) {
        // BUG FIX 4: Properly remove bullet from scene before removing from array
        if (sceneRef.current && bullet.parent === sceneRef.current) {
          sceneRef.current.remove(bullet);
        }
        // Dispose geometry and material for memory cleanup
        if (bullet.geometry) bullet.geometry.dispose();
        if (bullet.material) {
          if (Array.isArray(bullet.material)) {
            bullet.material.forEach(m => m.dispose());
          } else {
            bullet.material.dispose();
          }
        }
        bulletsRef.current.splice(index, 1);
      }
    });

    // Update AI bots with sophisticated AI
    if (playerRef.current && sceneRef.current) {
      const playerPos = playerRef.current.position;
      const playerVelocity = new THREE.Vector3(velocityRef.current.x, 0, velocityRef.current.z);
      const botSpeed = 0.15;
      const now = Date.now();

      aiBotsRef.current.forEach((bot, botId) => {
        if (!bot.mesh || !bot.mesh.visible || bot.health <= 0) return;

        // Initialize bot velocity if needed
        if (!bot.velocity) {
          bot.velocity = new THREE.Vector3(0, 0, 0);
        }

        // Determine bot team
        let botTeam: 'X' | 'O';
        if (botId.startsWith('npc_')) {
          const found = players.find(p => p.id === botId);
          botTeam = found?.team || (playerInfo.team === 'X' ? 'O' : 'X');
        } else {
          botTeam = remotePlayersRef.current.get(botId)?.team || (playerInfo.team === 'X' ? 'O' : 'X');
        }

        // Determine if player is enemy
        const isEnemy = botTeam !== playerInfo.team;
        const distToPlayer = bot.mesh.position.distanceTo(playerPos);
        
        // Check if player is visible (in range and not too far)
        const playerVisible = isEnemy && distToPlayer < 60 && distToPlayer > 5;

        // Weapon switching logic - only for enemy bots
        if (isEnemy && !bot.isReloading) {
          const currentConfig = WEAPON_CONFIGS[bot.currentWeapon];

          // Force reload if out of ammo
          if (bot.ammo[bot.currentWeapon] <= 0 && bot.state !== 'reloading') {
            bot.state = 'reloading';
            bot.isReloading = true;
            bot.reloadStartTime = now;
            return;
          }

          // Weapon selection priority based on situation
          let preferredWeapon: WeaponType = 'gun'; // Default

          if (distToPlayer > 40 && bot.ammo.bazooka > 0) {
            // Long range - use bazooka
            preferredWeapon = 'bazooka';
          } else if (!playerVisible && bot.lastKnownPlayerPos && bot.ammo.grenade > 0) {
            // Player hidden - use grenade
            preferredWeapon = 'grenade';
          } else if (distToPlayer < 20 && bot.ammo.grenade > 0 && Math.random() > 0.7) {
            // Close range - occasional grenade
            preferredWeapon = 'grenade';
          }

          // Switch to preferred weapon if different and has ammo
          if (preferredWeapon !== bot.currentWeapon && bot.ammo[preferredWeapon] > 0) {
            bot.currentWeapon = preferredWeapon;
          }
        }

        // --- MEMORY SYSTEM ---

        // Update last known position if player is visible
        if (isEnemy && distToPlayer < 60) {
          bot.lastKnownPlayerPos = playerPos.clone();
          bot.lastSeenTime = now;
        }

        // --- STATE MACHINE ---

        // Handle reloading state (check here first, before state transitions)
        if (bot.state === 'reloading') {
          const currentConfig = WEAPON_CONFIGS[bot.currentWeapon];
          if (now - bot.reloadStartTime >= currentConfig.reloadTime) {
            bot.ammo[bot.currentWeapon] = currentConfig.maxAmmo;
            bot.isReloading = false;
            bot.state = 'idle';
          }
          // Don't do anything else while reloading
          return;
        }

        // State transitions
        if (isEnemy) {
          const newState = distToPlayer < 15
            ? (Math.random() > 0.5 ? 'flanking' : 'attacking')
            : distToPlayer > 50
            ? 'chasing'
            : bot.health < bot.maxHealth * 0.3
            ? 'hiding'
            : 'attacking';

          if (bot.state !== newState) {
            bot.state = newState;
          }
        } else {
          // Friendly - patrol
          if (bot.state !== 'idle') {
            bot.state = 'idle';
          }
        }

        // --- BEHAVIOR IMPLEMENTATION ---

        const directionToPlayer = new THREE.Vector3()
          .subVectors(playerPos, bot.mesh.position)
          .normalize();

        bot.moveTimer = (bot.moveTimer || 0) + 1;

        // BUG FIX 6: Recalculate movement direction every 10 frames, but apply movement EVERY frame
        // This fixes the issue where bots appeared stuck because movement was only applied every 10 frames
        // Also force recalculation if storedMoveDir is zero (initial state)
        const needsRecalculation = bot.moveTimer > 10 || 
          (bot.storedMoveDir && bot.storedMoveDir.length() === 0);
        
        if (needsRecalculation) {
          bot.moveTimer = 0;

          let moveDir = new THREE.Vector3(0, 0, 0);

          switch (bot.state) {
            case 'chasing':
              // Move directly towards player
              moveDir = directionToPlayer.clone();
              break;

            case 'attacking':
              // Strafe while attacking
              const strafeVec = new THREE.Vector3(-directionToPlayer.z, 0, directionToPlayer.x);
              strafeVec.multiplyScalar(bot.strafeDirection * 0.8);
              moveDir = strafeVec;

              // Occasionally change strafe direction
              if (Math.random() < 0.1) {
                bot.strafeDirection *= -1;
              }
              break;

            case 'flanking':
              // Move to last known player position (memory system)
              if (bot.lastKnownPlayerPos) {
                const toLastKnown = new THREE.Vector3()
                  .subVectors(bot.lastKnownPlayerPos, bot.mesh.position)
                  .normalize();

                // Add some strafing while flanking
                const flankStrafe = new THREE.Vector3(-toLastKnown.z, 0, toLastKnown.x);
                flankStrafe.multiplyScalar(bot.strafeDirection * 0.6);

                moveDir = toLastKnown.clone().multiplyScalar(0.9).add(flankStrafe);
              } else {
                // Fall back to circle strafing
                const strafeVec = new THREE.Vector3(-directionToPlayer.z, 0, directionToPlayer.x);
                strafeVec.multiplyScalar(bot.strafeDirection);
                moveDir = strafeVec;
              }
              break;

            case 'hiding':
              // Find nearest obstacle as cover
              if (!bot.coverPosition || bot.mesh.position.distanceTo(bot.coverPosition) < 3) {
                // Find new cover
                let nearestObstacle: any = null;
                let nearestDist = Infinity;
                for (const obs of obstaclesRef.current) {
                  const dist = bot.mesh.position.distanceTo(obs.mesh.position);
                  // Check if obstacle is between bot and player
                  const toObstacle = obs.mesh.position.clone().sub(bot.mesh.position).normalize();
                  if (toObstacle.dot(directionToPlayer) > 0.5 && dist > 10 && dist < nearestDist) {
                    nearestObstacle = obs;
                    nearestDist = dist;
                  }
                }
                if (nearestObstacle) {
                  bot.coverPosition = nearestObstacle.mesh.position.clone();
                  // Position behind obstacle relative to player
                  const toPlayer = directionToPlayer.clone().multiplyScalar(-15);
                  bot.coverPosition.add(toPlayer);
                }
              }

              if (bot.coverPosition) {
                const toCover = new THREE.Vector3().subVectors(bot.coverPosition, bot.mesh.position).normalize();
                moveDir = toCover.multiplyScalar(0.8);
              }
              break;

            case 'idle':
            default:
              // Random patrol
              // BUG FIX 6: Use hash of botId instead of parseInt to handle non-numeric IDs
              // parseInt returns NaN for IDs like 'npc_1' or socket IDs, causing movement issues
              const botIdHash = botId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
              moveDir = new THREE.Vector3(
                Math.sin(now / 2000 + botIdHash),
                0,
                Math.cos(now / 2000 + botIdHash)
              ).multiplyScalar(0.4);
              break;
          }

          // Obstacle avoidance
          const avoidDir = new THREE.Vector3(0, 0, 0);
          for (const obstacle of obstaclesRef.current) {
            if (obstacle.boxBounds) continue;
            const distToObstacle = bot.mesh.position.distanceTo(obstacle.mesh.position);
            if (distToObstacle < 10) {
              const avoidVector = bot.mesh.position.clone().sub(obstacle.mesh.position).normalize();
              avoidDir.add(avoidVector.multiplyScalar(0.5));
            }
          }

          // Combine movement and avoidance, then normalize and apply speed
          const finalDir = moveDir.clone().add(avoidDir);
          if (finalDir.length() > 0) {
            finalDir.normalize().multiplyScalar(botSpeed);
          }

          // Store the calculated movement direction for use every frame
          bot.storedMoveDir = finalDir.clone();
        }

        // Apply movement EVERY frame using stored direction (BUG FIX 6)
        if (bot.storedMoveDir) {
          const finalDir = bot.storedMoveDir;

          // Try to move in X direction
          const testPosX = bot.mesh.position.clone();
          testPosX.x += finalDir.x;
          if (!checkCollision(testPosX, 0.5, botId)) {
            bot.mesh.position.x += finalDir.x;
          }

          // Try to move in Z direction
          const testPosZ = bot.mesh.position.clone();
          testPosZ.z += finalDir.z;
          if (!checkCollision(testPosZ, 0.5, botId)) {
            bot.mesh.position.z += finalDir.z;
          }
        }

        // Jumping - jump over obstacles or randomly during combat (every frame check)
        bot.jumpCooldown = (bot.jumpCooldown || 0) - 1;
        if (bot.canJump && bot.jumpCooldown <= 0) {
          // Jump when obstacle ahead or randomly during combat
          if (isEnemy && Math.random() < 0.02) {
            bot.velocity.y = jumpForce;
            bot.canJump = false;
            bot.jumpCooldown = 60;
          } else {
            // Check if obstacle directly ahead
            const forwardCheck = bot.mesh.position.clone().add(directionToPlayer.multiplyScalar(4));
            let obstacleAhead = false;
            for (const obstacle of obstaclesRef.current) {
              if (obstacle.boxBounds) continue;
              if (forwardCheck.distanceTo(obstacle.mesh.position) < obstacle.radius + 3) {
                obstacleAhead = true;
                break;
              }
            }
            if (obstacleAhead) {
              bot.velocity.y = jumpForce;
              bot.canJump = false;
              bot.jumpCooldown = 60;
            }
          }
        }

        // Apply gravity to bot (every frame)
        bot.velocity.y = (bot.velocity.y || 0) - gravity;
        bot.mesh.position.y += bot.velocity.y;

        // Ground collision (every frame)
        if (bot.mesh.position.y < 1.5) {
          bot.mesh.position.y = 1.5;
          bot.velocity.y = 0;
          bot.canJump = true;
        }

        // Update label position (every frame)
        bot.label.position.copy(bot.mesh.position);
        bot.label.position.y = bot.mesh.position.y + 2.5;

        // --- SHOOTING WITH PREDICTIVE AIMING ---
        if (isEnemy && bot.state !== 'hiding' && bot.state !== 'reloading') {
          const weaponConfig = WEAPON_CONFIGS[bot.currentWeapon];
          const minRange = bot.currentWeapon === 'grenade' ? 20 : 15;
          const maxRange = bot.currentWeapon === 'bazooka' ? 60 : 50;

          if (distToPlayer >= minRange && distToPlayer <= maxRange) {
            if (now - (bot.lastShot || 0) > weaponConfig.fireRate && bot.ammo[bot.currentWeapon] > 0) {
              bot.lastShot = now;
              bot.ammo[bot.currentWeapon]--;

              let shootDir = directionToPlayer.clone();
              let shootTarget = playerPos.clone();

              // Predictive aiming for pistol
              if (bot.currentWeapon === 'gun') {
                const predictedPos = getPredictedAimPosition(playerPos, playerVelocity, weaponConfig.bulletSpeed);
                shootTarget = predictedPos;
                shootDir = new THREE.Vector3()
                  .subVectors(shootTarget, bot.mesh.position)
                  .normalize();
              }
              // Grenade bounce calculation
              else if (bot.currentWeapon === 'grenade') {
                const bouncePoint = getGrenadeBouncePoint(playerPos, bot.mesh.position);
                if (bouncePoint) {
                  shootTarget = bouncePoint;
                  shootDir = new THREE.Vector3()
                    .subVectors(shootTarget, bot.mesh.position)
                    .normalize();
                }
              }
              // Bazooka aims at ground for splash damage
              else if (bot.currentWeapon === 'bazooka') {
                // Aim at a point on the ground slightly between bot and player
                // This maximizes splash damage potential
                const groundTarget = playerPos.clone();
                groundTarget.y = 1.5; // Ground level

                // Add some randomness to avoid predictable patterns
                groundTarget.x += (Math.random() - 0.5) * 5;
                groundTarget.z += (Math.random() - 0.5) * 5;

                shootDir = new THREE.Vector3()
                  .subVectors(groundTarget, bot.mesh.position)
                  .normalize();
              }

              createBullet(bot.mesh.position, { x: shootDir.x, y: shootDir.y, z: shootDir.z }, weaponConfig, false, botTeam);
            }
          }
        }

        // Update health bar
        if (bot.healthBar) {
          updateHealthBar(bot.healthBar, bot.health, bot.maxHealth);
        }
      });
    }
  }, [playerInfo.id, playerInfo.team, players, shoot, checkCollision, health, createExplosion, WEAPON_CONFIGS, updateHealthBar, getPredictedAimPosition, getGrenadeBouncePoint, botHealthRef, detectionZoneBoxRef, controlZoneRef, controlZoneMarkerRef, inControlZoneRef, setShowInControlZone]);

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 100, 400);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 1.5 + 2.5, 0); // Player at (0, 1.5, 0), camera 2.5 units above
    camera.rotation.order = 'YXZ';
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights - Enhanced for better texture visibility
    // Main ambient light for overall illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    // Hemisphere light for natural sky/ground lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemiLight.position.set(0, 200, 0);
    scene.add(hemiLight);

    // Primary directional light from front-right
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -150;
    directionalLight.shadow.camera.right = 150;
    directionalLight.shadow.camera.top = 150;
    directionalLight.shadow.camera.bottom = -150;
    scene.add(directionalLight);

    // Secondary directional light from opposite direction for better fill
    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight2.position.set(-50, 80, -50);
    scene.add(directionalLight2);

    // Point light for atmosphere in center
    const pointLight = new THREE.PointLight(0x9333ea, 2, 300);
    pointLight.position.set(0, 50, 0);
    scene.add(pointLight);

    // Create single sector arena
    createArena(scene);

    // Create player
    createPlayer(scene);

    // Create AI bots - use playersRef to get current value
    const playersToCreate = playersRef.current || players;
    console.log('[INIT] Creating AI bots on init, count:', playersToCreate.length);
    createAIBots(scene, playersToCreate);

    // Event listeners
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []); // Empty dependencies - run once on mount only (prevents re-initialization)

  // Mouse look controls
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!cameraRef.current) return;

      // Don't rotate camera when player is frozen (during sector switch)
      if (isFrozenRef.current) return;

      // Only rotate camera when pointer is locked
      if (document.pointerLockElement === containerRef.current) {
        const sensitivity = 0.002;

        try {
          cameraRef.current.rotation.y -= event.movementX * sensitivity;
          cameraRef.current.rotation.x -= event.movementY * sensitivity;

          // Clamp vertical rotation
          cameraRef.current.rotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, cameraRef.current.rotation.x));
        } catch (err) {
          // Ignore rotation errors that might occur during rapid pointer lock changes
          console.log('Camera rotation error:', err);
        }
      }
    };

    document.addEventListener('mousemove', handleMouseMove);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  // Initialize WebSocket connection
  useEffect(() => {
    // BUG FIX 5: Fixed port from 3003 to 3005 to match server
    const socket = io('/?XTransformPort=3005', {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;
    console.log('[SOCKET] Connecting to game server on port 3005...');

    socket.on('connect', () => {
      console.log('Connected to game server, socket ID:', socket.id);
      socket.emit('joinLobby', {
        name: playerInfo.name,
        team: playerInfo.team,
        sector: playerInfo.sector,
        npcPlayers: players, // Send all NPC players to the server
      });
      console.log('[SOCKET] Sent joinLobby with', players.length, 'NPC players');
    });

    socket.on('playerJoined', (player: PlayerInfo) => {
      console.log('Player joined:', player.name);
      if (sceneRef.current && player.id !== socket.id && player.sector === playerInfo.sector) {
        createRemotePlayer(sceneRef.current, player);
      }
    });

    socket.on('playerMoved', (data: { id: string; position: any; rotation: number }) => {
      const remotePlayer = remotePlayersRef.current.get(data.id);
      if (remotePlayer) {
        remotePlayer.mesh.position.set(data.position.x, data.position.y, data.position.z);
        remotePlayer.label.position.copy(remotePlayer.mesh.position);
      }
    });

    socket.on('playerShot', (data: { id: string; direction: any; position: any; weaponType?: WeaponType }) => {
      const weaponConfig = data.weaponType ? WEAPON_CONFIGS[data.weaponType] : WEAPON_CONFIGS.gun;
      const remotePlayer = remotePlayersRef.current.get(data.id);
      createBullet(data.position, data.direction, weaponConfig, false, remotePlayer?.team);
    });

    socket.on('playerDamaged', (data: { id: string; health: number }) => {
      const remotePlayer = remotePlayersRef.current.get(data.id);
      if (remotePlayer) {
        // Flash effect
        if (remotePlayer.mesh.material instanceof THREE.MeshStandardMaterial) {
          remotePlayer.mesh.material.emissive.setHex(0xffffff);
          setTimeout(() => {
            remotePlayer.mesh.material.emissive.setHex(
              remotePlayer.team === 'X' ? 0xef4444 : 0x3b82f6
            );
          }, 100);
        }
      }
    });

    socket.on('playerRespawned', (data: { id: string; lives: number; position: any }) => {
      const remotePlayer = remotePlayersRef.current.get(data.id);
      if (remotePlayer) {
        remotePlayer.mesh.position.set(data.position.x, data.position.y, data.position.z);
        remotePlayer.label.position.copy(remotePlayer.mesh.position);
        remotePlayer.mesh.visible = true;
        remotePlayer.label.visible = true;
      }
    });

    socket.on('playerEliminated', (data: { id: string }) => {
      const remotePlayer = remotePlayersRef.current.get(data.id);
      if (remotePlayer) {
        remotePlayer.mesh.visible = false;
        if (remotePlayer.label) {
          remotePlayer.label.visible = false;
        }
      }
    });

    socket.on('takeDamage', (data: { damage: number }) => {
      // Current player taking damage
      setHealth(prev => {
        const newHealth = Math.max(0, prev - data.damage);
        if (newHealth <= 0 && prev > 0) {
          // Just died, show respawn dialog
          setTimeout(() => setShowRespawnDialog(true), 500);
        }
        return newHealth;
      });
    });

    socket.on('playerRespawned', (data: { lives: number }) => {
      // Current player respawned
      setLives(data.lives);
      setHealth(100);
      setShowRespawnDialog(false);
      // Reset weapon ammo on respawn
      setWeaponAmmo({
        none: 0,
        gun: WEAPON_CONFIGS.gun.maxAmmo,
        bazooka: WEAPON_CONFIGS.bazooka.maxAmmo,
        grenade: WEAPON_CONFIGS.grenade.maxAmmo,
      });
      // Clear any reload state
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
      setIsReloading(false);
      setLastFired(0);
    });

    socket.on('playerEliminated', (data: { id: string }) => {
      if (data.id === playerInfo.id) {
        // Current player eliminated
        setShowRespawnDialog(true);
      }
    });

    socket.on('sectorChanged', (data: { sector: number; oldSector: number; playersInSector: PlayerInfo[]; sectorLives?: { [sector: number]: number } }) => {
      console.log('[SECTOR] Received sectorChanged event:', data);
      console.log('[SECTOR] Switching from sector', data.oldSector, 'to sector', data.sector);
      console.log('[SECTOR] Players in new sector:', data.playersInSector);

          // Update player sector - both state and ref
      setPlayerSector(data.sector);
      playerSectorRef.current = data.sector;
      console.log('[SECTOR] Updated playerSectorRef to:', data.sector);
      setShowRespawnDialog(false);

      // Load the new sector's obstacles
      if (sceneRef.current) {
        loadSectorMap(sceneRef.current, data.sector);
      }

      // Respawn player at a collision-free spawn point in the new sector
      if (playerRef.current) {
        const spawnPoints = SECTOR_SPAWN_POINTS[data.sector] || SECTOR_SPAWN_POINTS[0];

        // Try to find a clear spawn point
        let spawnPoint = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
        const spawnPosition = new THREE.Vector3(spawnPoint.x, 1.5, spawnPoint.z);
        let attempts = 0;
        const maxAttempts = 10;

        // Try different spawn points until we find a clear one
        while (!isPositionClear(spawnPosition) && attempts < maxAttempts) {
          spawnPoint = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
          spawnPosition.set(spawnPoint.x, 1.5, spawnPoint.z);
          attempts++;
        }

        playerRef.current.position.set(spawnPoint.x, 1.5, spawnPoint.z);

        // Sync camera to new player position
        if (cameraRef.current) {
          cameraRef.current.position.set(
            playerRef.current.position.x,
            playerRef.current.position.y + 2.5,
            playerRef.current.position.z + 2.5
          );
          cameraRef.current.lookAt(playerRef.current.position.x, playerRef.current.position.y + 1, playerRef.current.position.z - 10);
        }

        console.log('[SECTOR] Spawned at position:', spawnPoint, 'after', attempts, 'attempts');
      }

      // Remove all existing bots (we'll recreate them)
      aiBotsRef.current.forEach((bot, botId) => {
        if (bot.mesh && sceneRef.current) {
          sceneRef.current.remove(bot.mesh);
        }
        if (bot.label && sceneRef.current) {
          sceneRef.current.remove(bot.label);
        }
      });
      aiBotsRef.current.clear();

      // Remove all existing remote players
      remotePlayersRef.current.forEach((remotePlayer, playerId) => {
        if (remotePlayer.mesh && sceneRef.current) {
          sceneRef.current.remove(remotePlayer.mesh);
        }
        if (remotePlayer.label && sceneRef.current) {
          sceneRef.current.remove(remotePlayer.label);
        }
      });
      remotePlayersRef.current.clear();

      // Add remote players in the new sector
      data.playersInSector.forEach(playerData => {
        createRemotePlayer(sceneRef.current!, playerData);
        console.log('[SECTOR] Added remote player in sector:', playerData.id, 'sector', playerData.sector);
      });

      // Create bots for all players in the new sector (except current player)
      data.playersInSector.forEach(player => {
        if (player.id !== playerInfo.id) {
          console.log('[SECTOR] Creating bot for player in new sector:', player.id, 'name:', player.name);

          const playerGeometry = new THREE.CapsuleGeometry(0.5, 2, 4, 8);
          const botColor = player.team === 'X' ? 0x3b82f6 : 0xef4444;
          const playerMaterial = new THREE.MeshStandardMaterial({
            color: botColor,
            emissive: botColor,
            emissiveIntensity: 0.3,
          });
          const playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);

          // Find a collision-free spawn position for the bot
          let botSpawnPoint: { x: number; z: number };
          let botPosition: THREE.Vector3;
          let botAttempts = 0;
          const maxBotAttempts = 20;

          do {
            botSpawnPoint = {
              x: (Math.random() - 0.5) * 60,
              z: (Math.random() - 0.5) * 60,
            };
            botPosition = new THREE.Vector3(botSpawnPoint.x, 1.5, botSpawnPoint.z);
            botAttempts++;
          } while (!isPositionClear(botPosition) && botAttempts < maxBotAttempts);

          playerMesh.position.set(botPosition.x, 1.5, botPosition.z);
          playerMesh.castShadow = true;
          sceneRef.current!.add(playerMesh);

          console.log('[SECTOR] Bot spawned at:', botPosition, 'after', botAttempts, 'attempts');

          // Create label
          const labelGroup = new THREE.Group();
          const canvas = document.createElement('canvas');
          canvas.width = 256;
          canvas.height = 64;
          const context = canvas.getContext('2d')!;

          context.fillStyle = player.team === 'X' ? '#3b82f6' : '#ef4444';
          context.fillRect(0, 0, canvas.width, canvas.height);

          context.fillStyle = 'white';
          context.font = 'bold 24px Arial';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillText(`${player.team} ${player.name}`, canvas.width / 2, canvas.height / 2);

          const texture = new THREE.CanvasTexture(canvas);
          const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
          const sprite = new THREE.Sprite(spriteMaterial);
          sprite.scale.set(4, 1, 1);
          sprite.position.set(0, 2.5, 0);
          labelGroup.add(sprite);
          labelGroup.position.copy(playerMesh.position);
          sceneRef.current!.add(labelGroup);

          // Create health bar
          const healthBar = createHealthBar(100, 100);
          healthBar.position.set(0, 3.2, 0);
          labelGroup.add(healthBar);

          // Store bot
          aiBotsRef.current.set(player.id, {
            mesh: playerMesh,
            label: labelGroup,
            target: new THREE.Vector3(0, 1.5, 0),
            lastShot: Date.now(),
            moveTimer: 0,
            health: 100,
            maxHealth: 100,
            healthBar: healthBar,
            state: 'idle',
            currentWeapon: 'gun',
            ammo: {
              gun: WEAPON_CONFIGS.gun.maxAmmo,
              bazooka: WEAPON_CONFIGS.bazooka.maxAmmo,
              grenade: WEAPON_CONFIGS.grenade.maxAmmo,
            },
            isReloading: false,
            reloadStartTime: 0,
            velocity: new THREE.Vector3(0, 0, 0),
            jumpCooldown: 0,
            canJump: true,
            coverPosition: null,
            strafeDirection: Math.random() > 0.5 ? 1 : -1,
            lastKnownPlayerPos: null,
            lastSeenTime: 0,
            // BUG FIX 6: Initialize storedMoveDir so bots can move immediately
            storedMoveDir: new THREE.Vector3(0, 0, 0),
          });
        }
      });

      // Clear bullets when switching sectors
      if (sceneRef.current) {
        bulletsRef.current.forEach(bullet => {
          sceneRef.current!.remove(bullet);
        });
        bulletsRef.current = [];
      }

      // Reset player health and ammo on sector switch
      setHealth(100);
      setWeaponAmmo({
        none: 0,
        gun: WEAPON_CONFIGS.gun.maxAmmo,
        bazooka: WEAPON_CONFIGS.bazooka.maxAmmo,
        grenade: WEAPON_CONFIGS.grenade.maxAmmo,
      });
      setIsReloading(false);
      setLastFired(0);

      // Unfreeze player after sector switch is complete
      setIsSectorSwitching(false);
      isFrozenRef.current = false;

      // Show sector switch menu so player can click to re-lock pointer
      setTimeout(() => {
        setShowSectorSwitchMenu(true);
      }, 100);

      console.log('[SECTOR] Sector switch complete, now in sector', data.sector, 'with', aiBotsRef.current.size, 'bots');
      console.log('[SECTOR] Player unfrozen, click to re-lock pointer');
    });

    socket.on('playerLeft', (data: { id: string }) => {
      const remotePlayer = remotePlayersRef.current.get(data.id);
      if (remotePlayer && sceneRef.current) {
        sceneRef.current.remove(remotePlayer.mesh);
        if (remotePlayer.label) {
          sceneRef.current.remove(remotePlayer.label);
        }
        remotePlayersRef.current.delete(data.id);
      }
    });

    socket.on('sectorsUpdate', (updatedSectors: SectorState[]) => {
      // Log ALL sectors' timers every second
      console.log('[SECTOR TIMERS UPDATE] All sectors:');
      updatedSectors.forEach((sector, index) => {
        console.log(`[SECTOR CONTROL TIMER] Sector ${index}: X=${sector.xControlTime}s, O=${sector.oControlTime}s, Owner=${sector.owner || 'None'}`);
      });
      
      // Use ref for synchronous access to current sector
      const currentSector = playerSectorRef.current;
      const currentSectorData = updatedSectors[currentSector];
      if (currentSectorData) {
        console.log(`[SECTOR CONTROL TIMER] Current Sector ${currentSector}: X=${currentSectorData.xControlTime}s, O=${currentSectorData.oControlTime}s, Owner=${currentSectorData.owner || 'None'}`);
        setSectorControlTimes({
          x: currentSectorData.xControlTime || 0,
          o: currentSectorData.oControlTime || 0,
        });
      }
      
      // Update allSectorTimers state for UI (sector buttons)
      setAllSectorTimers(updatedSectors.map(s => ({
        xControlTime: s.xControlTime || 0,
        oControlTime: s.oControlTime || 0,
        owner: s.owner,
      })));
    });

    socket.on('sectorCaptured', (data: { sector: number; owner: 'X' | 'O'; xControlTime: number; oControlTime: number }) => {
      console.log('[CLIENT] Sector captured:', data);
      setCurrentCapture(data);
      setShowCaptureAlert(true);
      setTimeout(() => setShowCaptureAlert(false), 3000);

      // Update control zone color based on owner
      if (controlZoneRef.current && data.owner) {
        const color = data.owner === 'X' ? 0x3b82f6 : 0xef4444;
        const emissive = data.owner === 'X' ? 0x3b82f6 : 0xef4444;
        (controlZoneRef.current.material as THREE.MeshStandardMaterial).color.setHex(color);
        (controlZoneRef.current.material as THREE.MeshStandardMaterial).emissive.setHex(emissive);
      }
    });

    socket.on('gameEnded', (data: { winner: 'X' | 'O' }) => {
      console.log('[CLIENT] Game ended, winner:', data.winner);
      setWinner(data.winner);
      setShowWinMessage(true);
      onGameEnd(data.winner);
    });

    socket.on('forceFieldsUpdate', () => {
      // Force fields removed - no longer needed
    });

    socket.on('error', (error: any) => {
      console.error('[SOCKET] Server error:', error);
      // Unfreeze player if there's a server error
      if (isFrozenRef.current) {
        console.log('[SOCKET] Unfreezing player due to server error');
        setIsSectorSwitching(false);
        isFrozenRef.current = false;
        setShowSectorSwitchMenu(true);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [playerInfo, onGameEnd, createRemotePlayer, createBullet]);

  const handleRespawnSectorChange = (newSector: number) => {
    setSelectedRespawnSector(newSector);
    if (socketRef.current) {
      socketRef.current.emit('changeSector', newSector);
    }
  };

  // Handle pointer lock change for ESC menu
  useEffect(() => {
    const handlePointerLockChange = () => {
      if (!document.pointerLockElement && !isSectorSwitching && !justClosedMenuRef.current) {
        // Cancel all movement when pointer is unlocked
        Object.keys(keysRef.current).forEach(key => {
          keysRef.current[key] = false;
        });
        velocityRef.current = { x: 0, y: 0, z: 0 };
        setShowSectorSwitchMenu(true);
      }
    };

    document.addEventListener('pointerlockchange', handlePointerLockChange);

    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
    };
  }, [isSectorSwitching]);

  // Keyboard event handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle ESC key first - cancel all movement
      if (e.key === 'Escape') {
        // Cancel all movement
        Object.keys(keysRef.current).forEach(key => {
          keysRef.current[key] = false;
        });
        // Reset velocity to stop movement
        velocityRef.current = { x: 0, y: 0, z: 0 };
        // Exit pointer lock (this will show menu via pointerlockchange event)
        document.exitPointerLock();
        return;
      }

      keysRef.current[e.key] = true;
      keysRef.current[e.key.toLowerCase()] = true;

      // Don't allow weapon switching or reload when frozen
      if (isFrozenRef.current) return;

      // Weapon switching
      if (e.key === 'q' || e.key === 'Q') {
        // Cycle through weapons
        const currentIndex = availableWeapons.findIndex(w => w === currentWeaponType);
        const nextIndex = (currentIndex + 1) % availableWeapons.length;
        switchWeapon(availableWeapons[nextIndex]);
      }
      if (e.key === '1') {
        switchWeapon('gun');
      }
      if (e.key === '2') {
        switchWeapon('bazooka');
      }

      // Reload
      if (e.key === 'r' || e.key === 'R') {
        reloadWeapon();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key] = false;
      keysRef.current[e.key.toLowerCase()] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [availableWeapons, switchWeapon, reloadWeapon]);

  // Mouse click to lock pointer
  useEffect(() => {
    const handleClick = () => {
      if (!showRespawnDialog) {
        containerRef.current?.requestPointerLock().catch(err => {
          // Ignore errors from pointer lock (user might have exited it)
          console.log('Pointer lock request failed:', err.message);
        });
      }
    };

    containerRef.current?.addEventListener('click', handleClick);
    containerRef.current?.addEventListener('mousedown', shoot);

    return () => {
      containerRef.current?.removeEventListener('click', handleClick);
      containerRef.current?.removeEventListener('mousedown', shoot);
    };
  }, [shoot, showRespawnDialog]);

  // Sector switch countdown effect
  useEffect(() => {
    if (sectorSwitchCountdown === null || sectorSwitchCountdown <= 0) return;

    const timer = setInterval(() => {
      setSectorSwitchCountdown(prev => {
        if (prev === null) return null;
        const next = prev - 1;

        console.log(`[SECTOR] Countdown: ${next}`);

        if (next <= 0) {
          const targetSector = selectedSwitchSectorRef.current; // Read from ref (synchronous)
          console.log(`[SECTOR] Countdown finished, requesting sector change to ${targetSector}`);
          if (targetSector !== null && socketRef.current) {
            console.log(`[SECTOR] Socket is connected, emitting changeSector event for sector ${targetSector}`);
            socketRef.current.emit('changeSector', targetSector);
            console.log(`[SECTOR] changeSector event emitted`);
          } else {
            console.log('[SECTOR] ERROR: Socket is not connected!');
            // Safety: unfreeze if there's an error
            setIsSectorSwitching(false);
            isFrozenRef.current = false;
            setShowSectorSwitchMenu(true);
          }
          setSectorSwitchCountdown(null);
          setSelectedSwitchSector(null);
          selectedSwitchSectorRef.current = null;
        }
        return next;
      });
    }, 1000);

    // Safety timeout: unfreeze after 10 seconds if sectorChanged doesn't arrive
    const safetyTimeout = setTimeout(() => {
      if (isFrozenRef.current) {
        console.log('[SECTOR] Safety timeout: Forcing unfreeze');
        setIsSectorSwitching(false);
        isFrozenRef.current = false;
      }
    }, 10000);

    return () => {
      clearInterval(timer);
      clearTimeout(safetyTimeout);
    };
  }, [sectorSwitchCountdown]);

  // Update AI bots when players prop changes
  useEffect(() => {
    if (sceneRef.current) {
      createAIBots(sceneRef.current, players);
    }
  }, [players]);

  // Update weapon mesh attached to camera
  useEffect(() => {
    if (!cameraRef.current || !sceneRef.current) return;

    // Remove old weapon mesh if exists
    if (weaponMeshRef.current) {
      cameraRef.current.remove(weaponMeshRef.current);
    }

    // Create new weapon mesh
    const newWeaponMesh = createWeaponMesh(currentWeaponType);

    // Position weapon in front of camera (first-person view)
    newWeaponMesh.position.set(0.3, -0.2, -0.5);
    newWeaponMesh.rotation.y = Math.PI; // Face forward

    cameraRef.current.add(newWeaponMesh);
    weaponMeshRef.current = newWeaponMesh;

    return () => {
      if (weaponMeshRef.current && cameraRef.current) {
        cameraRef.current.remove(weaponMeshRef.current);
      }
    };
  }, [currentWeaponType, createWeaponMesh]);

  // Cleanup effect - Set mounted flag to false on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Clear any ongoing reload
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="fixed inset-0">
      {/* HUD Overlay */}
      <div className="fixed inset-0 pointer-events-none">
        {/* Crosshair */}
        {showCrosshair && (
          <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <div className="w-8 h-8 relative">
              <div className="absolute top-1/2 left-0 w-full h-0.5 bg-white/80 transform -translate-y-1/2" />
              <div className="absolute left-1/2 top-0 h-full w-0.5 bg-white/80 transform -translate-x-1/2" />
            </div>
          </div>
        )}

        {/* Sector Switch Menu */}
        {showSectorSwitchMenu && (
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 pointer-events-auto p-2"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isSectorSwitching) {
                setShowSectorSwitchMenu(false);
                justClosedMenuRef.current = true;
                setTimeout(() => {
                  justClosedMenuRef.current = false;
                }, 500);
              }
            }}
          >
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 border-2 border-purple-500 rounded-xl p-3 max-w-sm w-full flex flex-col">
              <div className="text-center mb-2">
                <h2 className="text-lg font-bold text-white">
                  {isSectorSwitching ? 'Switching Sector...' : `Change Sector (Current: ${playerSector + 1})`}
                </h2>
                <p className="text-white/70 text-xs">
                  {isSectorSwitching
                    ? 'Deploying to new sector...'
                    : 'Select a new sector. Click outside to close.'}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-1.5 mb-2">
                {Array.from({ length: 9 }).map((_, i) => {
                  const sector = sectors[i];
                  const sectorTimer = allSectorTimers[i];
                  const sectorOwner = sectorTimer?.owner || sector?.owner;
                  const isSelected = selectedSwitchSector === i;
                  const isCurrent = i === playerSector;
                  const teamColor = playerInfo.team === 'X' ? 'blue' : 'red';

                  return (
                    <button
                      key={i}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isSectorSwitching) {
                          handleSectorSwitch(i);
                        }
                      }}
                      disabled={isCurrent}
                      className={`
                        aspect-square rounded-lg border-2 transition-all p-1.5 flex flex-col items-center justify-center relative
                        ${isSelected
                          ? `border-${teamColor}-400 bg-${teamColor}-600/50 shadow-lg scale-105`
                          : isCurrent
                          ? `border-gray-600 bg-gray-700/30 cursor-not-allowed opacity-60`
                          : `border-white/30 bg-white/5 hover:bg-white/10 cursor-pointer`
                        }
                      `}
                    >
                      {/* X/O indicator for team control - use allSectorTimers for real-time owner */}
                      {sectorOwner && (
                        <div className={`absolute top-0.5 right-0.5 text-xs font-bold ${sectorOwner === 'X' ? 'text-blue-400' : 'text-red-400'}`}>
                          {sectorOwner}
                        </div>
                      )}
                      <div className="flex gap-1 text-[10px]">
                        <div className="bg-black/50 px-1 rounded text-blue-400">
                          {sector.xPlayers}
                        </div>
                        <div className="bg-black/50 px-1 rounded text-red-400">
                          {sector.oPlayers}
                        </div>
                      </div>
                      <span className="text-white/60 text-[10px]">S{i + 1}</span>
                      {isCurrent && (
                        <span className="text-yellow-400 text-[8px] font-bold">HERE</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-2 justify-center pt-1.5 border-t border-white/10">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSectorSwitchMenu(false);
                    justClosedMenuRef.current = true;
                    setTimeout(() => {
                      justClosedMenuRef.current = false;
                    }, 500);
                  }}
                  className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-1.5 px-4 rounded-lg text-xs transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Sector Switch Countdown */}
        {isSectorSwitching && sectorSwitchCountdown !== null && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-40 pointer-events-none">
            <div className="text-center">
              <div className="text-6xl font-bold text-white mb-4 animate-pulse">
                {sectorSwitchCountdown}
              </div>
              <div className="text-2xl text-purple-400 font-semibold">
                Deploying to Sector {selectedSwitchSector !== null ? selectedSwitchSector + 1 : '?'}
              </div>
            </div>
          </div>
        )}

        {/* Respawn Dialog */}
        {showRespawnDialog && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 pointer-events-auto">
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 border-2 border-purple-500 rounded-xl p-8 max-w-2xl w-full mx-auto">
              <div className="text-center mb-6">
                <h2 className="text-3xl font-bold text-white mb-2">
                  Choose Your New Sector
                </h2>
                <p className="text-white/70 text-lg">
                  You have {lives} lives remaining. Select a new sector to continue fighting.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-6">
                {Array.from({ length: 9 }).map((_, i) => {
                  const sector = sectors[i];
                  const isSelected = selectedRespawnSector === i;
                  const teamColor = playerInfo.team === 'X' ? 'blue' : 'red';

                  return (
                    <button
                      key={i}
                      onClick={() => handleRespawnSectorChange(i)}
                      disabled={i === playerSector}
                      className={`
                        aspect-square rounded-lg border-2 transition-all p-4 flex flex-col items-center justify-center gap-2
                        ${isSelected
                          ? `border-${teamColor}-400 bg-${teamColor}-600/50 shadow-lg scale-105`
                          : i === playerSector
                          ? `border-gray-600 bg-gray-700/30 cursor-not-allowed opacity-60`
                          : `border-white/30 bg-white/5 hover:bg-white/10 cursor-pointer`
                        }
                      `}
                    >
                      <div className="flex gap-2 text-sm">
                        <div className={`bg-black/50 px-2 py-1 rounded text-blue-400`}>
                          {sector.xPlayers}
                        </div>
                        <div className={`bg-black/50 px-2 py-1 rounded text-red-400`}>
                          {sector.oPlayers}
                        </div>
                      </div>
                      <span className="text-white/60 text-xs">Sector {i + 1}</span>
                      {i === playerSector && (
                        <span className="text-yellow-400 text-xs font-bold">CURRENT</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="text-center">
                <button
                  onClick={() => {
                    if (selectedRespawnSector !== null && selectedRespawnSector !== playerSector) {
                      handleRespawnSectorChange(selectedRespawnSector);
                    }
                  }}
                  disabled={selectedRespawnSector === null || selectedRespawnSector === playerSector}
                  className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-8 rounded-lg text-lg transition-all"
                >
                  Deploy to Sector {selectedRespawnSector !== null ? selectedRespawnSector + 1 : '?'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Capture Alert */}
        {showCaptureAlert && currentCapture && (
          <div className="fixed top-1/3 left-1/2 transform -translate-x-1/2 animate-bounce z-50">
            <div
              className={`text-white px-8 py-4 rounded-lg text-2xl font-bold shadow-2xl ${
                currentCapture.team === 'X'
                  ? 'bg-gradient-to-r from-blue-600 to-blue-800'
                  : 'bg-gradient-to-r from-red-600 to-red-800'
              }`}
            >
              {currentCapture.team} Team Captured Sector {currentCapture.sector + 1}!
            </div>
          </div>
        )}

        {/* Win/Lose Message */}
        {showWinMessage && winner && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 pointer-events-none">
            <div className="text-center">
              <div className="text-8xl font-bold mb-4 animate-bounce">
                {winner === playerInfo.team ? '🎉' : '💀'}
              </div>
              <div className={`text-6xl font-bold mb-4 ${
                winner === playerInfo.team
                  ? 'bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent'
                  : 'bg-gradient-to-r from-red-500 to-pink-500 bg-clip-text text-transparent'
              }`}>
                {winner === playerInfo.team ? 'YOU WIN!' : 'YOU LOSE!'}
              </div>
              <div className="text-2xl text-white/80">
                {winner} Team Wins with 3 in a Row!
              </div>
            </div>
          </div>
        )}

        {/* Control Zone Indicator */}
        {showInControlZone && (
          <div className="fixed top-1/4 left-1/2 transform -translate-x-1/2 z-40">
            <div
              className={`text-white px-6 py-3 rounded-lg text-xl font-bold shadow-2xl animate-pulse ${
                playerInfo.team === 'X'
                  ? 'bg-gradient-to-r from-blue-600/80 to-blue-800/80'
                  : 'bg-gradient-to-r from-red-600/80 to-red-800/80'
              }`}
            >
              🔥 IN CONTROL ZONE - Capturing for {playerInfo.team} Team! 🔥
            </div>
          </div>
        )}

        {/* Player Count Debug Info */}
          <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4 border-yellow-500/30">
            <div className="text-xs text-gray-400 mb-1">PLAYERS IN SECTOR</div>
            <div className="text-lg font-bold text-white">
              {players.filter(p => p.sector === playerInfo.sector).length}
            </div>
            <div className="text-xs text-gray-400 mb-2">
              BOTS: {players.filter(p => p.id.startsWith('npc_')).length}
            </div>
          </div>

          {/* Notifications Display */}
          {visibleNotifications > 0 && (
            <div className="fixed top-24 left-1/2 transform -translate-x-1/2 z-50 space-y-2">
              {notifications.slice(-5).filter(n => Date.now() - n.timestamp < 5000).map(notification => (
                <div
                  key={notification.id}
                  className={`
                    px-4 py-2 rounded-lg shadow-lg animate-in-down
                    ${notification.type === 'join' ? 'bg-green-500 border-2 border-green-400' :
                      notification.type === 'leave' ? 'bg-yellow-500 border-2 border-yellow-400' :
                      'bg-red-500 border-2 border-red-400'
                  }`}
                >
                  <div className="text-white font-semibold text-sm flex items-center gap-2">
                    {notification.type === 'join' && <span className="text-2xl">👋</span>}
                    {notification.type === 'leave' && <span className="text/orange-2xl">👋</span>}
                    {notification.type === 'kill' && <span className="text-2xl">💀</span>}
                    <span>{notification.message}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

        {/* Top HUD - Player Info */}
        <div className="fixed top-4 left-4 right-4 flex justify-between items-start">
          <div className="flex items-center gap-4">
            <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4 border border-purple-500/30">
              <div className="text-white font-bold text-lg">{playerInfo.name}</div>
              <div className={`text-xl font-bold ${playerInfo.team === 'X' ? 'text-blue-400' : 'text-red-400'}`}>
                Team {playerInfo.team}
              </div>
            </div>

            <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4 border border-green-500/30">
              <div className="text-green-400 text-sm font-semibold">KILLS</div>
              <div className="text-white text-3xl font-bold">{kills}</div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4 border border-red-500/30">
              <div className="text-red-400 text-sm font-semibold">LIVES</div>
              <div className="text-white text-3xl font-bold">{lives}</div>
            </div>

            <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4 border border-purple-500/30 min-w-[200px]">
              <div className="text-purple-400 text-sm font-semibold mb-2">HEALTH</div>
              <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    health > 50 ? 'bg-gradient-to-r from-green-500 to-green-400' :
                    health > 25 ? 'bg-gradient-to-r from-yellow-500 to-yellow-400' :
                    'bg-gradient-to-r from-red-500 to-red-400'
                  }`}
                  style={{ width: `${health}%` }}
                />
              </div>
              <div className="text-white text-right mt-1 font-mono">{Math.max(0, health)}%</div>
            </div>

            <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4 border border-purple-500/30 min-w-[200px]">
              <div className="text-purple-400 text-sm font-semibold mb-2">SECTOR CONTROL</div>
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-blue-400">Team X</span>
                    <span className="text-blue-400 font-mono">{Math.floor(sectorControlTimes.x)}s</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-300"
                      style={{ width: `${Math.min(100, (sectorControlTimes.x / 30) * 100)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-red-400">Team O</span>
                    <span className="text-red-400 font-mono">{Math.floor(sectorControlTimes.o)}s</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-red-600 to-red-400 transition-all duration-300"
                      style={{ width: `${Math.min(100, (sectorControlTimes.o / 30) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Current Sector Info */}
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2">
          <div className={`bg-black/50 backdrop-blur-sm rounded-lg px-6 py-3 border border-2 ${
            playerInfo.team === 'X' ? 'border-blue-500' : 'border-red-500'
          }`}>
            <div className="text-white text-sm font-semibold">
              Fighting in Sector {playerSector + 1}
            </div>
          </div>
        </div>

        {/* Bottom HUD - Controls & Sector Info */}
        <div className="fixed bottom-4 left-4 right-4 flex justify-between items-end">
          <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4 border border-purple-500/30">
            <div className="text-white text-xs mb-2">CONTROLS</div>
            <div className="text-white/70 text-sm space-y-1">
              <div><span className="text-purple-400 font-mono">W A S D</span> - Move</div>
              <div><span className="text-purple-400 font-mono">MOUSE</span> - Look (click to lock)</div>
              <div><span className="text-purple-400 font-mono">SPACE</span> - Jump</div>
              <div><span className="text-purple-400 font-mono">CLICK</span> - Shoot</div>
              <div><span className="text-purple-400 font-mono">Q / 1 / 2</span> - Switch Weapon</div>
              <div><span className="text-purple-400 font-mono">R</span> - Reload</div>
              <div><span className="text-purple-400 font-mono">ESC</span> - Change Sector</div>
            </div>
          </div>

          <div className="flex gap-2">
            {/* Weapon Info */}
            <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4 border border-purple-500/30 min-w-[180px]">
              <div className="text-purple-400 text-xs font-semibold mb-1">WEAPON</div>
              <div className="text-white text-lg font-bold">{currentWeapon.config.name}</div>
              <div className="flex items-center justify-between mt-2">
                <div className="text-white/70 text-sm">AMMO</div>
                <div className={`text-xl font-bold ${currentWeapon.currentAmmo === 0 ? 'text-red-400' : 'text-white'}`}>
                  {currentWeapon.currentAmmo}/{currentWeapon.config.maxAmmo}
                </div>
              </div>
              {currentWeapon.isReloading && (
                <div className="text-yellow-400 text-xs mt-1 animate-pulse">Reloading...</div>
              )}
            </div>

            <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4 border border-purple-500/30">
              <div className="text-purple-400 text-sm font-semibold">SECTOR</div>
              <div className="text-white text-2xl font-bold">{playerSector + 1}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
