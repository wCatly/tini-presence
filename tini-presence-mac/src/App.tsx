import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

interface TrackStatus {
  playing: boolean;
  reason?: string;
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string | null;
  source?: string;
  positionMs?: number;
  durationMs?: number;
}

interface AppConfig {
  musicFolders: string[];
  discordClientId?: string;
  copypartyApiKey?: string;
  copypartyUrl?: string;
  copypartyPath?: string;
}

const defaultConfig: AppConfig = {
  musicFolders: [],
  discordClientId: "",
  copypartyApiKey: "",
  copypartyUrl: "https://pifiles.florian.lt",
  copypartyPath: "/cdn",
};

function formatTime(ms?: number) {
  if (!ms || Number.isNaN(ms)) return "00:00";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [trackStatus, setTrackStatus] = useState<TrackStatus | null>(null);
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    // Get initial status
    invoke<boolean>("get_service_status").then(setIsRunning);
    invoke<TrackStatus | null>("get_track_status").then(setTrackStatus);
    invoke<AppConfig | null>("get_config").then((value) => {
      if (value) {
        setConfig({ ...defaultConfig, ...value });
      }
    });

    // Listen for status changes
    const unlistenService = listen<boolean>("service-status", (event) => {
      setIsRunning(event.payload);
      if (!event.payload) {
        setTrackStatus(null);
      }
    });

    const unlistenTrack = listen<TrackStatus | null>("track-status", (event) => {
      setTrackStatus(event.payload ?? null);
    });

    const unlistenConfig = listen<AppConfig>("config-updated", (event) => {
      setConfig({ ...defaultConfig, ...event.payload });
    });

    const unlistenLog = listen<string>("sidecar-log", (event) => {
      setLogs((prev) => [event.payload, ...prev].slice(0, 8));
    });

    invoke("request_config");

    return () => {
      unlistenService.then((fn) => fn());
      unlistenTrack.then((fn) => fn());
      unlistenConfig.then((fn) => fn());
      unlistenLog.then((fn) => fn());
    };
  }, []);

  const handleToggle = async () => {
    const newStatus = await invoke<boolean>("toggle_service");
    setIsRunning(newStatus);
  };

  const handleQuit = () => {
    invoke("quit_app");
  };

  const handleAddFolder = () => {
    invoke("add_folder");
  };

  const handleOpenConfig = () => {
    invoke("open_config");
  };

  const handleSaveConfig = () => {
    invoke("update_config", { config });
    invoke("request_config");
  };

  return (
    <div className="container">
      <div className="header">
        <div className="logo" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
            <title>tini-presence</title>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
        </div>
        <h1>tini-presence</h1>
        <button
          type="button"
          className="icon-button"
          onClick={() => {
            setShowSettings((value) => !value);
            invoke("request_config");
          }}
          aria-label="Open settings"
        >
          ⚙
        </button>
      </div>

      {showSettings ? (
        <div className="settings">
          <div className="settings-header">
            <span className="settings-title">Settings</span>
            <button
              type="button"
              className="btn-text"
              onClick={() => setShowSettings(false)}
            >
              Done
            </button>
          </div>

          <div className="settings-section">
            <label className="settings-label" htmlFor="discord-client-id">
              Discord Client ID
            </label>
            <input
              id="discord-client-id"
              className="settings-input"
              placeholder="Your Discord app client ID"
              value={config.discordClientId || ""}
              onChange={(event) =>
                setConfig((prev) => ({
                  ...prev,
                  discordClientId: event.target.value,
                }))
              }
            />
          </div>

          <div className="settings-section">
            <label className="settings-label" htmlFor="copyparty-api-key">
              Copyparty API Key
            </label>
            <input
              id="copyparty-api-key"
              className="settings-input"
              placeholder="Optional"
              value={config.copypartyApiKey || ""}
              onChange={(event) =>
                setConfig((prev) => ({
                  ...prev,
                  copypartyApiKey: event.target.value,
                }))
              }
            />
          </div>

          <div className="settings-row">
            <div className="settings-section">
              <label className="settings-label" htmlFor="copyparty-url">
                Copyparty URL
              </label>
            <input
              id="copyparty-url"
              className="settings-input"
              placeholder="https://pifiles.florian.lt"
              value={config.copypartyUrl || ""}
              onChange={(event) =>
                setConfig((prev) => ({
                  ...prev,
                  copypartyUrl: event.target.value,
                }))
              }
            />
            </div>

            <div className="settings-section">
              <label className="settings-label" htmlFor="copyparty-path">
                Copyparty Path
              </label>
            <input
              id="copyparty-path"
              className="settings-input"
              placeholder="/cdn"
              value={config.copypartyPath || ""}
              onChange={(event) =>
                setConfig((prev) => ({
                  ...prev,
                  copypartyPath: event.target.value,
                }))
              }
            />
            </div>
          </div>

          <div className="settings-section">
            <span className="settings-label">Music folders</span>
            <div className="folders">
              {config.musicFolders.length === 0 ? (
                <span className="muted">No folders added yet</span>
              ) : (
                config.musicFolders.map((folder) => (
                  <div key={folder} className="folder-item">
                    {folder}
                  </div>
                ))
              )}
            </div>
            <div className="settings-actions">
              <button type="button" className="btn-secondary" onClick={handleAddFolder}>
                Add folder
              </button>
              <button type="button" className="btn-secondary" onClick={handleOpenConfig}>
                Open config file
              </button>
            </div>
          </div>

          <div className="settings-actions settings-save">
            <button
              type="button"
              className="btn"
              onClick={handleSaveConfig}
            >
              Save settings
            </button>
          </div>

          <div className="log-panel">
            <span className="settings-label">Sidecar logs</span>
            <div className="log-list">
              {logs.length === 0 ? (
                <div className="log-empty">No logs yet</div>
              ) : (
                logs.map((line) => (
                  <div key={line} className="log-line">
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="status-card">
            <div className={`status-indicator ${isRunning ? "active" : "inactive"}`} />
            <div className="status-text">
              <span className="status-label">Discord Presence</span>
              <span className={`status-value ${isRunning ? "active" : "inactive"}`}>
                {isRunning ? "Active" : "Stopped"}
              </span>
            </div>
          </div>

          <div className="track-card">
            {trackStatus && trackStatus.playing ? (
              <>
                <div className="cover">
                  {trackStatus.coverUrl ? (
                    <img src={trackStatus.coverUrl} alt="Album cover" />
                  ) : (
                    <div className="cover-placeholder">♪</div>
                  )}
                </div>
                <div className="track-info">
                  <span className="track-title">{trackStatus.title}</span>
                  <span className="track-artist">{trackStatus.artist}</span>
                  <span className="track-album">{trackStatus.album}</span>
                  <div className="track-progress">
                    <span className="track-time">
                      {formatTime(trackStatus.positionMs)}
                    </span>
                    <div className="track-bar">
                      <div
                        className="track-bar-fill"
                        style={{
                          width: trackStatus.durationMs
                            ? `${Math.min(
                                100,
                                (trackStatus.positionMs ?? 0) /
                                  trackStatus.durationMs *
                                  100
                              ).toFixed(2)}%`
                            : "0%",
                        }}
                      />
                    </div>
                    <span className="track-time">
                      {formatTime(trackStatus.durationMs)}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="track-empty">
                <span className="track-empty-title">
                  {trackStatus?.reason === "spotify-not-running"
                    ? "Spotify is closed"
                    : "Not playing"}
                </span>
                <span className="track-empty-sub">
                  {trackStatus?.reason === "not-local"
                    ? "Only local files show presence"
                    : "Start a local track to show status"}
                </span>
              </div>
            )}
          </div>

          <div className="info-section">
            <p className="info-text">
              {isRunning
                ? "Showing your Spotify local files on Discord"
                : "Click Start to begin sharing your music"}
            </p>
          </div>

          <div className="actions">
            <button
              type="button"
              className={`btn ${isRunning ? "btn-stop" : "btn-start"}`}
              onClick={handleToggle}
            >
              {isRunning ? "Stop" : "Start"}
            </button>
          </div>

          <div className="footer">
            <button type="button" className="btn-text" onClick={handleQuit}>
              Quit
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
