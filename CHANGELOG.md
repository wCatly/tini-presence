# Changelog

All notable changes to this project will be documented in this file.

## [1.0.2] - 2026-01-18

### Added

- **Live Folder Watching**: The app now automatically detects new music files in your library and re-scans for cover art without requiring a service restart.
- **Discord Auto-Reconnect**: Implemented a resilient connection handler that automatically reconnects to Discord if it is restarted or closed.
- **Smart Local File Matching**: Added string normalization logic to match Spotify track titles (e.g., "Comme des Garçons") with local filenames (e.g., "07. Comme des Garcons.mp3") even when they have accents, numbers, or special characters.
- **Check for Updates Button**: Added a manual update check button in the Settings view.
- **Background Update Checks**: The app now silently checks for updates every hour and whenever the window is reopened.

### Fixed

- **Duplicate Tray Icon**: Resolved an issue where two tray icons would appear on macOS.
- **Update Status Persistence**: Fixed a bug where the download progress would reset to "Update Available" if the app window was hidden and reopened during a download.
- **macOS Permission Prompts**: Replaced external `find` command with a native recursive search to prevent repeated macOS security popups for subdirectories.
- **macOS Usage Descriptions**: Added clear privacy descriptions for Downloads, Documents, and Desktop folder access in `Info.plist`.

### Technical Improvements

- Simplified Apple Silicon + Intel (Universal) build distribution logic.
- Optimized local file scanning by ignoring common system and massive directories (node_modules, Library, etc.).
- Improved cleanup and resource management when restarting the presence service.

## [1.0.1] - 2026-01-17

- Initial production release with Copyparty CDN support.
- Implemented automated updater manifest generation.
- Universal macOS binary support.
