import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { UpdateBanner } from "./UpdateBanner";
import "@/index.css";

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
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [trackStatus, setTrackStatus] = useState<TrackStatus | null>(null);
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [logs, setLogs] = useState<{ id: number; text: string }[]>([]);
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    invoke<boolean>("get_service_status").then(setIsRunning);
    invoke<TrackStatus | null>("get_track_status").then(setTrackStatus);
    invoke<AppConfig | null>("get_config").then((value) => {
      if (value) {
        setConfig({ ...defaultConfig, ...value });
      }
    });

    const unlistenService = listen<boolean>("service-status", (event) => {
      setIsRunning(event.payload);
      if (!event.payload) {
        setTrackStatus(null);
      }
    });

    const unlistenTrack = listen<TrackStatus | null>(
      "track-status",
      (event) => {
        setTrackStatus(event.payload ?? null);
      }
    );

    const unlistenConfig = listen<AppConfig>("config-updated", (event) => {
      setConfig({ ...defaultConfig, ...event.payload });
    });

    const unlistenLog = listen<string>("sidecar-log", (event) => {
      setLogs((prev) =>
        [{ id: Date.now(), text: event.payload }, ...prev].slice(0, 8)
      );
    });

    invoke("request_config");

    return () => {
      unlistenService.then((fn) => fn());
      unlistenTrack.then((fn) => fn());
      unlistenConfig.then((fn) => fn());
      unlistenLog.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    getVersion().then(setAppVersion);
  }, []);

  const handleToggle = async () => {
    const newStatus = await invoke<boolean>("toggle_service");
    setIsRunning(newStatus);
  };

  const handleQuit = () => invoke("quit_app");
  const handleAddFolder = () => invoke("add_folder");
  const handleOpenConfig = () => invoke("open_config");

  const handleSaveConfig = () => {
    invoke("update_config", { config });
    invoke("request_config");
  };

  const progressPercent = trackStatus?.durationMs
    ? Math.min(
        100,
        ((trackStatus.positionMs ?? 0) / trackStatus.durationMs) * 100
      )
    : 0;

  return (
    <div className="flex h-full flex-col gap-3 rounded-xl bg-background/95 p-4 backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <div className="text-primary">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
            <title>tini-presence</title>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
        </div>
        <h1 className="flex-1 text-base font-semibold tracking-tight">
          tini-presence
        </h1>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            setShowSettings((v) => !v);
            invoke("request_config");
          }}
        >
          ⚙️
        </Button>
      </div>

      {/* Update Banner */}
      <UpdateBanner />

      {showSettings ? (
        <div className="flex-1 overflow-y-auto -mr-2 pr-2">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">Settings</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSettings(false)}
              >
                Done
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="discord-client-id">Discord Client ID</Label>
              <Input
                id="discord-client-id"
                placeholder="Your Discord app client ID"
                value={config.discordClientId || ""}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    discordClientId: e.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="copyparty-api-key">Copyparty API Key</Label>
              <Input
                id="copyparty-api-key"
                placeholder="Optional"
                value={config.copypartyApiKey || ""}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    copypartyApiKey: e.target.value,
                  }))
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="copyparty-url">Copyparty URL</Label>
                <Input
                  id="copyparty-url"
                  placeholder="https://pifiles.florian.lt"
                  value={config.copypartyUrl || ""}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      copypartyUrl: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="copyparty-path">Path</Label>
                <Input
                  id="copyparty-path"
                  placeholder="/cdn"
                  value={config.copypartyPath || ""}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      copypartyPath: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Music Folders</Label>
              <div className="rounded-md border border-border bg-muted/30 p-2">
                {config.musicFolders.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    No folders added yet
                  </span>
                ) : (
                  <div className="flex flex-col gap-1">
                    {config.musicFolders.map((folder) => (
                      <span
                        key={folder}
                        className="truncate text-xs text-muted-foreground"
                      >
                        {folder}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={handleAddFolder}>
                  Add folder
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleOpenConfig}
                >
                  Open config
                </Button>
              </div>
            </div>

            <Button onClick={handleSaveConfig}>Save settings</Button>

            <div className="space-y-2">
              <Label>Sidecar Logs</Label>
              <div className="max-h-24 overflow-auto rounded-md border border-border bg-muted/30 p-2">
                {logs.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    No logs yet
                  </span>
                ) : (
                  logs.map((log) => (
                    <div
                      key={log.id}
                      className="text-[10px] text-muted-foreground break-all"
                    >
                      {log.text}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Status Card */}
          <Card>
            <CardContent className="flex items-center gap-3 p-3">
              <div
                className={`h-3 w-3 shrink-0 rounded-full ${
                  isRunning
                    ? "bg-primary shadow-[0_0_8px] shadow-primary animate-pulse-slow"
                    : "bg-muted-foreground"
                }`}
              />
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Discord Presence
                </span>
                <span
                  className={`text-sm font-medium ${
                    isRunning ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {isRunning ? "Active" : "Stopped"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Track Card */}
          <Card className="flex-1">
            <CardContent className="flex h-full items-center gap-3 p-3">
              {trackStatus?.playing ? (
                <>
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {trackStatus.coverUrl ? (
                      <img
                        src={trackStatus.coverUrl}
                        alt="Cover"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-2xl text-muted-foreground">
                        ♪
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold">
                      {trackStatus.title}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {trackStatus.artist}
                    </span>
                    <span className="truncate text-xs text-muted-foreground/60">
                      {trackStatus.album}
                    </span>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">
                        {formatTime(trackStatus.positionMs)}
                      </span>
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {formatTime(trackStatus.durationMs)}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-muted-foreground">
                    {trackStatus?.reason === "spotify-not-running"
                      ? "Spotify is closed"
                      : "Not playing"}
                  </span>
                  <span className="text-xs text-muted-foreground/60">
                    {trackStatus?.reason === "not-local"
                      ? "Only local files show presence"
                      : "Start a local track to show status"}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Info */}
          <p className="px-1 text-xs text-muted-foreground">
            {isRunning
              ? "Showing your Spotify local files on Discord"
              : "Click Start to begin sharing your music"}
          </p>

          {/* Action */}
          <Button
            className={
              isRunning
                ? "bg-destructive hover:bg-destructive/90"
                : "btn-spotify"
            }
            onClick={handleToggle}
          >
            {isRunning ? "Stop" : "Start"}
          </Button>

          {/* Footer */}
          <Separator />
          <div className="flex items-center justify-between">
            <Badge variant="secondary" className="text-[10px] font-normal">
              v{appVersion}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={handleQuit}
            >
              Quit
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
