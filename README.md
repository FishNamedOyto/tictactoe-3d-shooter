# Tic-Tac-Toe 3D Shooter

A multiplayer tactical 3D shooter game with Tic-Tac-Toe win conditions.

## Quick Start

### Prerequisites
- Node.js 18+ or Bun
- npm, yarn, or bun

### Installation

```bash
# Using bun (recommended)
bun install

# Using npm
npm install

# Using yarn
yarn install
```

### Development

```bash
# Start the Next.js frontend
bun run dev

# In another terminal, start the game server
cd mini-services/game-server && bun run dev
```

The app will be available at http://localhost:3000

### Production Build

```bash
# Build the Next.js app
bun run build

# Start production server
bun run start
```

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed Cloudflare and other deployment options.

## Game Features

- **3D Graphics**: Built with Three.js
- **Multiplayer**: Real-time gameplay via WebSocket
- **Tic-Tac-Toe Win Condition**: Capture 3 sectors in a row to win
- **Weapon System**: Pistol, Bazooka, and Grenade Launcher
- **AI Bots**: Play against computer-controlled opponents

## Controls

- **WASD** - Move
- **Mouse** - Look around
- **Space** - Jump
- **Click** - Shoot
- **Q / 1 / 2** - Switch weapons
- **R** - Reload
- **ESC** - Open sector change menu

## Tech Stack

- **Frontend**: Next.js 16, React 19, Three.js, Tailwind CSS
- **Backend**: Socket.io game server
- **UI Components**: shadcn/ui
- **State Management**: Zustand

## License

MIT
