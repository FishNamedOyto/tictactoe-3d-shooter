# Cloudflare Deployment Guide

This guide explains how to deploy the Tic-Tac-Toe 3D Shooter to Cloudflare.

## Architecture Overview

The project consists of two parts:
1. **Next.js Frontend** - Can be deployed to Cloudflare Pages
2. **Game Server (WebSocket)** - Requires Cloudflare Durable Objects for real-time multiplayer

## Important Notes

⚠️ **WebSocket Limitation**: Cloudflare Pages doesn't support WebSocket servers directly. For the multiplayer game server, you have these options:

1. **Option A**: Deploy the game server separately on a VPS/VM (DigitalOcean, Railway, Fly.io, etc.)
2. **Option B**: Use Cloudflare Durable Objects (requires paid plan)
3. **Option C**: Convert to HTTP polling for turn-based gameplay (simpler but less responsive)

## Option A: Deploy Frontend to Cloudflare Pages + Game Server Elsewhere

### Step 1: Prepare for Deployment

1. Make sure you have a GitHub account
2. Create a new GitHub repository

### Step 2: Push to GitHub

```bash
# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit changes
git commit -m "Initial commit"

# Add your GitHub repository as remote
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# Push to GitHub
git push -u origin main
```

### Step 3: Connect to Cloudflare Pages

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**
3. Select your GitHub repository
4. Configure build settings:
   - **Framework preset**: Next.js
   - **Build command**: `npm run build` or `bun run build`
   - **Build output directory**: `.next`
   - **Node.js version**: 18 or higher

5. Click **Save and Deploy**

### Step 4: Environment Variables

Add these environment variables in Cloudflare Pages settings:

```
# Add any required environment variables
NEXT_PUBLIC_GAME_SERVER_URL=wss://your-game-server.com
```

### Step 5: Deploy Game Server Separately

Deploy the `mini-services/game-server` to a service that supports WebSockets:

#### Using Railway.app:
1. Create account at [Railway](https://railway.app/)
2. Deploy from GitHub repo
3. Set the start command: `cd mini-services/game-server && bun run dev`
4. Set port: 3005

#### Using Fly.io:
1. Create account at [Fly.io](https://fly.io/)
2. Install flyctl: `curl -L https://fly.io/install.sh | sh`
3. Navigate to game-server directory
4. Run: `fly launch`
5. Configure port 3005

#### Using DigitalOcean App Platform:
1. Create account at [DigitalOcean](https://www.digitalocean.com/)
2. Create new App
3. Connect GitHub repo
4. Configure:
   - Source directory: `mini-services/game-server`
   - Build command: `bun install`
   - Run command: `bun run dev`
   - HTTP port: 3005

## Option B: Deploy with Cloudflare Durable Objects (Advanced)

This requires modifying the game server to use Durable Objects for state management.

### Prerequisites
- Cloudflare paid plan (Workers Paid)
- Wrangler CLI installed

### Steps

1. Install Wrangler:
```bash
npm install -g wrangler
```

2. Login to Cloudflare:
```bash
wrangler login
```

3. Create Durable Objects migration:
```bash
wrangler init
```

4. Modify `mini-services/game-server/index.ts` to use Durable Objects

5. Deploy:
```bash
wrangler deploy
```

## Build Commands Reference

```bash
# Install dependencies
bun install

# Build for production
bun run build

# Start production server (for testing locally)
bun run start

# Run linting
bun run lint
```

## Troubleshooting

### Build Fails
- Check Node.js version (should be 18+)
- Check if all dependencies are installed
- Review build logs in Cloudflare dashboard

### WebSocket Connection Issues
- Ensure game server is running on a public URL
- Update the frontend to use the correct WebSocket URL
- Check CORS settings on the game server

### Game Not Loading
- Check browser console for errors
- Verify Three.js is loading correctly
- Check if WebGL is supported

## Alternative: Deploy Everything to VPS

For a simpler deployment, consider using a VPS (Virtual Private Server):

1. **DigitalOcean Droplet** - $4/month
2. **Linode** - $5/month  
3. **Vultr** - $2.50/month

Deploy both frontend and game server on the same machine:
```bash
# Install Node.js and bun
curl -fsSL https://bun.sh/install | bash

# Clone your repository
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

# Install dependencies
bun install

# Build the Next.js app
bun run build

# Start the game server (background)
cd mini-services/game-server && bun run dev &

# Start the Next.js server
cd ../.. && bun run start
```

## Need Help?

- [Cloudflare Pages Documentation](https://developers.cloudflare.com/pages/)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Next.js Deployment Docs](https://nextjs.org/docs/deployment)
