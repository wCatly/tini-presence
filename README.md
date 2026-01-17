# tini-presence

A macOS app that displays your Spotify playback as Discord Rich Presence, with special support for local files including cover art upload.

## Features

- Shows current Spotify track in Discord Rich Presence
- Works with both streaming and local files
- Extracts and uploads cover art from local MP3s
- Uses Copyparty for cover art hosting
- Native macOS Finder picker for adding music folders

## Requirements

- macOS (uses AppleScript to communicate with Spotify)
- [Bun](https://bun.sh) runtime
- Spotify desktop app
- Discord desktop app
- Copyparty server for cover art uploads (or use the default)

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
2. Poll Spotify every 5 seconds
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
├── spotify.ts      # Spotify client (AppleScript integration)
├── cover.ts        # Cover art extraction from audio files
├── upload.ts       # Copyparty upload service
└── local-files.ts  # Local file finder and config management

tests/
├── unit/           # Unit tests for each service
└── integration/    # Integration tests (Discord, uploads)

test-music/         # Test MP3 files with embedded cover art
```

## How It Works

1. **Spotify Client** (`src/spotify.ts`): Uses AppleScript to query Spotify's current track, including detecting if it's a local file (track ID starts with `spotify:local:`).

2. **Cover Extraction** (`src/cover.ts`): Uses `music-metadata` to extract embedded album art from MP3 files. Generates a hash-based filename for deduplication.

3. **Upload Service** (`src/upload.ts`): Uploads cover art to Copyparty API with in-memory caching to avoid duplicate uploads.

4. **Local File Finder** (`src/local-files.ts`): Searches configured folders for matching audio files using artist and title from Spotify.

5. **Main Loop** (`index.ts`): Orchestrates everything - polls Spotify, handles local file cover art, and updates Discord presence.

## Running Tests

```bash
# All tests
bun test

# Unit tests only
bun test:unit

# Integration tests (requires Discord and network)
bun test:integration
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_CLIENT_ID` | Yes | - | Your Discord application ID |
| `COPYPARTY_API_KEY` | No | - | API key for Copyparty uploads |
| `COPYPARTY_URL` | No | `https://pifiles.florian.lt` | Copyparty server URL |
| `COPYPARTY_PATH` | No | `/cdn` | Upload path on server |

## License

MIT
