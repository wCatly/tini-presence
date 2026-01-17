# tini-presence

A macOS app that displays your Spotify playback as Discord Rich Presence, with special support for local files including cover art upload.

## Features

- Shows current Spotify track in Discord Rich Presence
- Works with both streaming and local files
- Extracts and uploads cover art from local MP3s
- Organized uploads by device and folder (no conflicts when sharing server)
- Uses Copyparty for cover art hosting
- Native macOS Finder picker for adding music folders

## Requirements

- macOS (uses AppleScript to communicate with Spotify)
- [Bun](https://bun.sh) runtime
- Spotify desktop app
- Discord desktop app
- Copyparty server for cover art uploads (optional)

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/tini-presence.git
   cd tini-presence
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Create a Discord application at [Discord Developer Portal](https://discord.com/developers/applications) and copy the Application ID.

4. Create a `.env` file:
   ```bash
   DISCORD_CLIENT_ID=your_discord_app_id
   COPYPARTY_API_KEY=your_api_key        # Optional: for cover uploads
   COPYPARTY_URL=https://your-server.com # Optional: defaults to pifiles.florian.lt
   COPYPARTY_PATH=/cdn                   # Optional: upload path
   ```

## Usage

### Run the app
```bash
bun run dev
```

The app will:
1. Connect to Discord RPC
2. Poll Spotify every second
3. Update your Discord presence with the current track
4. For local files: extract cover art, upload it, and display in Discord

### Add local music folders

To enable cover art for local files, add your music folder:

```bash
bun run dev --add-folder
```

This opens a native macOS Finder picker. Select your music folder and it will be saved to `~/.config/tini-presence/config.json`.

## Project Structure

```
src/
├── identity.ts     # Device identity (machine name + unique ID)
├── spotify.ts      # Spotify client (AppleScript integration)
├── cover.ts        # Cover art extraction from audio files
├── upload.ts       # Copyparty upload service
├── local-files.ts  # Local file finder and config management
└── presence.ts     # Presence service (orchestrates the flow)

index.ts            # Main entry point (Discord RPC + Spotify polling)

tests/
├── unit/           # Unit tests for each service
└── integration/    # Integration tests (Discord, uploads)

test-music/         # Test MP3 files with embedded cover art
```

## How It Works

1. **Identity** (`src/identity.ts`): Generates a unique device identity (machine name + ID) stored in `~/.config/tini-presence/identity.json`. This prevents conflicts when multiple users share the same Copyparty server.

2. **Spotify Client** (`src/spotify.ts`): Uses AppleScript to query Spotify's current track, including detecting if it's a local file (track ID starts with `spotify:local:`).

3. **Cover Extraction** (`src/cover.ts`): Uses `music-metadata` to extract embedded album art from audio files.

4. **Upload Service** (`src/upload.ts`): Uploads cover art to Copyparty with retry logic and caching.

5. **Local File Finder** (`src/local-files.ts`): Searches configured folders for matching audio files.

6. **Presence Service** (`src/presence.ts`): Orchestrates the full flow - find file, extract cover, upload, build Discord activity.

### Upload Path Structure

Cover art is uploaded with an organized path:

```
tini-presence/{machine-name}-{id}/{folder}/{song-title}-{hash}.jpg
```

Example:
```
tini-presence/MacBook-Pro-a1b2c3d4/Music/My_Song-fb715b3f.jpg
```

This ensures:
- Each device has its own folder
- Files are organized by source folder
- Song titles are readable
- Hash prevents duplicates

## Running Tests

```bash
# All tests
bun test

# Unit tests only
bun test:unit

# Integration tests (requires Discord and network)
bun test:integration
```

## Configuration Files

| File | Location | Purpose |
|------|----------|---------|
| `config.json` | `~/.config/tini-presence/` | Music folder paths |
| `identity.json` | `~/.config/tini-presence/` | Device identity |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_CLIENT_ID` | Yes | - | Your Discord application ID |
| `COPYPARTY_API_KEY` | No | - | API key for Copyparty uploads |
| `COPYPARTY_URL` | No | `https://pifiles.florian.lt` | Copyparty server URL |
| `COPYPARTY_PATH` | No | `/cdn` | Upload path on server |

## License

MIT
