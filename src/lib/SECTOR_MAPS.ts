// Sector Maps - 9 unique sector configurations with unique obstacle layouts
// BUG FIX 7: No obstacles within control zone (center, radius 8)

export interface SectorMap {
  obstacles: Array<{ x: number; z: number; r: number; h: number }>;
  walls: { height: number; thickness: number };
}

export const SECTOR_MAPS: SectorMap[] = [
  // Sector 1 - Open field with scattered obstacles
  {
    obstacles: [
      { x: -30, z: -30, r: 6, h: 8 },
      { x: 30, z: -30, r: 5, h: 10 },
      { x: -30, z: 30, r: 7, h: 6 },
      { x: 30, z: 30, r: 5, h: 8 },
      { x: 0, z: -60, r: 5, h: 8 },
      { x: 0, z: 60, r: 6, h: 8 },
      { x: -60, z: 0, r: 4, h: 10 },
      { x: 60, z: 0, r: 5, h: 8 },
      { x: -20, z: -20, r: 4, h: 6 },
      { x: 20, z: -20, r: 5, h: 7 },
      { x: -20, z: 20, r: 5, h: 6 },
      { x: 20, z: 20, r: 4, h: 7 },
    ],
    walls: { height: 20, thickness: 5 }
  },

  // Sector 2 - Fortress around control zone (BUG FIX 7: moved obstacles away from center)
  {
    obstacles: [
      { x: -25, z: -25, r: 5, h: 8 },
      { x: 25, z: -25, r: 5, h: 8 },
      { x: -25, z: 25, r: 5, h: 8 },
      { x: 25, z: 25, r: 5, h: 8 },
      { x: -50, z: 0, r: 4, h: 10 },
      { x: 50, z: 0, r: 4, h: 10 },
      { x: 0, z: -50, r: 4, h: 10 },
      { x: 0, z: 50, r: 4, h: 10 },
      { x: -15, z: 0, r: 4, h: 8 },
      { x: 15, z: 0, r: 4, h: 8 },
      { x: 0, z: -15, r: 4, h: 8 },
      { x: 0, z: 15, r: 4, h: 8 },
    ],
    walls: { height: 20, thickness: 5 }
  },

  // Sector 3 - Long corridor with cover
  {
    obstacles: [
      { x: -70, z: 0, r: 6, h: 10 },
      { x: 70, z: 0, r: 6, h: 10 },
      { x: -35, z: -30, r: 5, h: 8 },
      { x: -35, z: 30, r: 5, h: 8 },
      { x: 35, z: -30, r: 5, h: 8 },
      { x: 35, z: 30, r: 5, h: 8 },
      { x: 0, z: -50, r: 4, h: 6 },
      { x: 0, z: 50, r: 4, h: 6 },
      { x: -20, z: 0, r: 4, h: 8 },
      { x: 20, z: 0, r: 4, h: 8 },
    ],
    walls: { height: 20, thickness: 5 }
  },

  // Sector 4 - Cross formation (BUG FIX 7: removed center obstacle)
  {
    obstacles: [
      { x: 0, z: -60, r: 8, h: 10 },
      { x: 0, z: 60, r: 8, h: 10 },
      { x: -60, z: 0, r: 8, h: 10 },
      { x: 60, z: 0, r: 8, h: 10 },
      { x: -30, z: -30, r: 5, h: 7 },
      { x: 30, z: -30, r: 5, h: 7 },
      { x: -30, z: 30, r: 5, h: 7 },
      { x: 30, z: 30, r: 5, h: 7 },
    ],
    walls: { height: 20, thickness: 5 }
  },

  // Sector 5 - Diagonal barriers (BUG FIX 7: removed center obstacle)
  {
    obstacles: [
      { x: -50, z: -50, r: 7, h: 9 },
      { x: 50, z: -50, r: 7, h: 9 },
      { x: -50, z: 50, r: 7, h: 9 },
      { x: 50, z: 50, r: 7, h: 9 },
      { x: -30, z: 0, r: 4, h: 6 },
      { x: 30, z: 0, r: 4, h: 6 },
      { x: 0, z: -30, r: 4, h: 6 },
      { x: 0, z: 30, r: 4, h: 6 },
    ],
    walls: { height: 20, thickness: 5 }
  },

  // Sector 6 - Circular ring (BUG FIX 7: removed central platform)
  {
    obstacles: [
      { x: -50, z: 0, r: 5, h: 8 },
      { x: 50, z: 0, r: 5, h: 8 },
      { x: 0, z: -50, r: 5, h: 8 },
      { x: 0, z: 50, r: 5, h: 8 },
      { x: -35, z: -35, r: 4, h: 6 },
      { x: 35, z: -35, r: 4, h: 6 },
      { x: -35, z: 35, r: 4, h: 6 },
      { x: 35, z: 35, r: 4, h: 6 },
    ],
    walls: { height: 20, thickness: 5 }
  },

  // Sector 7 - Maze-like (BUG FIX 7: removed center obstacle)
  {
    obstacles: [
      { x: -40, z: -40, r: 5, h: 8 },
      { x: -20, z: -40, r: 5, h: 8 },
      { x: 0, z: -40, r: 5, h: 8 },
      { x: 20, z: -40, r: 5, h: 8 },
      { x: 40, z: -40, r: 5, h: 8 },
      { x: -40, z: 0, r: 5, h: 8 },
      { x: 40, z: 0, r: 5, h: 8 },
      { x: -40, z: 40, r: 5, h: 8 },
      { x: -20, z: 40, r: 5, h: 8 },
      { x: 0, z: 40, r: 5, h: 8 },
      { x: 20, z: 40, r: 5, h: 8 },
      { x: 40, z: 40, r: 5, h: 8 },
    ],
    walls: { height: 20, thickness: 5 }
  },

  // Sector 8 - Open with pillars (BUG FIX 7: removed center obstacle)
  {
    obstacles: [
      { x: -60, z: -60, r: 6, h: 12 },
      { x: 60, z: -60, r: 6, h: 12 },
      { x: -60, z: 60, r: 6, h: 12 },
      { x: 60, z: 60, r: 6, h: 12 },
      { x: 0, z: -60, r: 5, h: 8 },
      { x: 0, z: 60, r: 5, h: 8 },
      { x: -60, z: 0, r: 5, h: 8 },
      { x: 60, z: 0, r: 5, h: 8 },
    ],
    walls: { height: 20, thickness: 5 }
  },

  // Sector 9 - Dense cover (BUG FIX 7: no obstacles near center)
  {
    obstacles: [
      { x: -45, z: -45, r: 6, h: 8 },
      { x: -15, z: -45, r: 5, h: 7 },
      { x: 15, z: -45, r: 5, h: 7 },
      { x: 45, z: -45, r: 6, h: 8 },
      { x: -45, z: -15, r: 5, h: 7 },
      { x: 45, z: -15, r: 5, h: 7 },
      { x: -45, z: 15, r: 5, h: 7 },
      { x: 45, z: 15, r: 5, h: 7 },
      { x: -45, z: 45, r: 6, h: 8 },
      { x: -15, z: 45, r: 5, h: 7 },
      { x: 15, z: 45, r: 5, h: 7 },
      { x: 45, z: 45, r: 6, h: 8 },
    ],
    walls: { height: 20, thickness: 5 }
  }
];

// Spawn points for each sector
export const SECTOR_SPAWN_POINTS = [
  // Sector 1 spawn points
  [
    { x: -40, z: -40 },
    { x: 40, z: -40 },
    { x: -40, z: 40 },
    { x: 40, z: 40 },
    { x: -60, z: 0 },
    { x: 60, z: 0 },
    { x: 0, z: -60 },
    { x: 0, z: 60 },
  ],
  // Sector 2 spawn points
  [
    { x: -50, z: -50 },
    { x: 50, z: -50 },
    { x: -50, z: 50 },
    { x: 50, z: 50 },
    { x: -70, z: 0 },
    { x: 70, z: 0 },
    { x: 0, z: -70 },
    { x: 0, z: 70 },
  ],
  // Sector 3 spawn points
  [
    { x: -80, z: -40 },
    { x: 80, z: -40 },
    { x: -80, z: 40 },
    { x: 80, z: 40 },
    { x: -50, z: 0 },
    { x: 50, z: 0 },
    { x: 0, z: -70 },
    { x: 0, z: 70 },
  ],
  // Sector 4 spawn points
  [
    { x: -80, z: -80 },
    { x: 80, z: -80 },
    { x: -80, z: 80 },
    { x: 80, z: 80 },
    { x: -60, z: 0 },
    { x: 60, z: 0 },
    { x: 0, z: -60 },
    { x: 0, z: 60 },
  ],
  // Sector 5 spawn points
  [
    { x: -70, z: -70 },
    { x: 70, z: -70 },
    { x: -70, z: 70 },
    { x: 70, z: 70 },
    { x: -50, z: 0 },
    { x: 50, z: 0 },
    { x: 0, z: -50 },
    { x: 0, z: 50 },
  ],
  // Sector 6 spawn points
  [
    { x: -70, z: -70 },
    { x: 70, z: -70 },
    { x: -70, z: 70 },
    { x: 70, z: 70 },
    { x: -60, z: 0 },
    { x: 60, z: 0 },
    { x: 0, z: -60 },
    { x: 0, z: 60 },
  ],
  // Sector 7 spawn points
  [
    { x: -70, z: -70 },
    { x: 70, z: -70 },
    { x: -70, z: 70 },
    { x: 70, z: 70 },
    { x: -50, z: 0 },
    { x: 50, z: 0 },
    { x: 0, z: -50 },
    { x: 0, z: 50 },
  ],
  // Sector 8 spawn points
  [
    { x: -80, z: -80 },
    { x: 80, z: -80 },
    { x: -80, z: 80 },
    { x: 80, z: 80 },
    { x: -60, z: 0 },
    { x: 60, z: 0 },
    { x: 0, z: -60 },
    { x: 0, z: 60 },
  ],
  // Sector 9 spawn points
  [
    { x: -70, z: -70 },
    { x: 70, z: -70 },
    { x: -70, z: 70 },
    { x: 70, z: 70 },
    { x: -50, z: 0 },
    { x: 50, z: 0 },
    { x: 0, z: -50 },
    { x: 0, z: 50 },
  ],
];
