import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UpdateBanner } from "./UpdateBanner";
import {
  Settings,
  Power,
  Music,
  Folder,
  FileText,
  Check,
  X,
  ChevronDown,
  ScrollText,
  Loader2,
  History,
} from "lucide-react";
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
  trackId?: string;
  filePath?: string | null;
}

type ThemeColor = "cyan" | "red" | "green" | "purple" | "orange";

interface AppConfig {
  musicFolders: string[];
  discordClientId?: string;
  copypartyApiKey?: string;
  copypartyUrl?: string;
  copypartyPath?: string;
  theme?: ThemeColor;
}

const defaultConfig: AppConfig = {
  musicFolders: [],
  discordClientId: "",
  copypartyApiKey: "",
  copypartyUrl: "https://pifiles.florian.lt",
  copypartyPath: "/cdn",
  theme: "cyan",
};

const themeOptions: { value: ThemeColor; label: string; color: string }[] = [
  { value: "cyan", label: "Cyan", color: "bg-[oklch(0.75_0.15_200)]" },
  { value: "red", label: "Red", color: "bg-[oklch(0.65_0.22_25)]" },
  { value: "green", label: "Green", color: "bg-[oklch(0.72_0.19_145)]" },
  { value: "purple", label: "Purple", color: "bg-[oklch(0.7_0.18_300)]" },
  { value: "orange", label: "Orange", color: "bg-[oklch(0.75_0.18_55)]" },
];

function formatTime(ms?: number) {
  if (!ms || Number.isNaN(ms)) return "0:00";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [trackStatus, setTrackStatus] = useState<TrackStatus | null>(null);
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("");
  const [logs, setLogs] = useState<{ id: number; text: string }[]>([]);

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
        [{ id: Date.now(), text: event.payload }, ...prev].slice(0, 20)
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

  const themeClass = `theme-${config.theme || "cyan"}`;

  return (
    <div className={`h-full flex flex-col ${themeClass}`}>
      <div className="rounded-2xl bg-card border border-border overflow-hidden shadow-2xl shadow-black/20 h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 overflow-hidden flex items-center justify-center">
              {showSettings ? (
                <Settings className="w-4 h-4 text-primary" />
              ) : (
                <img
                  src="/app-icon.png"
                  alt="Logo"
                  className="w-5 h-5 pointer-events-none"
                />
              )}
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold text-foreground tracking-tight leading-tight">
                  tini-presence
                </h1>
                {import.meta.env.DEV && (
                  <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-500/20 text-amber-500 border border-amber-500/30 uppercase tracking-widest">
                    Dev
                  </span>
                )}
              </div>
              {showSettings ? (
                <span className="text-[10px] font-medium text-muted-foreground">
                  Settings
                </span>
              ) : (
                <div className="flex items-center gap-1.5">
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${
                      isRunning
                        ? "bg-primary animate-pulse-glow text-primary"
                        : "bg-muted-foreground/40"
                    }`}
                  />
                  <span
                    className={`text-[10px] font-medium ${
                      isRunning ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {isRunning ? "Connected" : "Offline"}
                  </span>
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowSettings(!showSettings);
              invoke("request_config");
            }}
            className="w-8 h-8 rounded-lg bg-secondary/60 hover:bg-secondary flex items-center justify-center transition-colors"
          >
            {showSettings ? (
              <X className="w-4 h-4 text-muted-foreground" />
            ) : (
              <Settings className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        </div>

        {/* Update Banner */}
        <UpdateBanner />

        {showSettings ? (
          <SettingsView
            config={config}
            setConfig={setConfig}
            onSave={handleSaveConfig}
            onAddFolder={handleAddFolder}
            onOpenConfig={handleOpenConfig}
            logs={logs}
          />
        ) : (
          <MainView
            isRunning={isRunning}
            trackStatus={trackStatus}
            progressPercent={progressPercent}
            onToggle={handleToggle}
            onQuit={handleQuit}
            appVersion={appVersion}
          />
        )}
      </div>
    </div>
  );
}

function MainView({
  isRunning,
  trackStatus,
  progressPercent,
  onToggle,
  onQuit,
  appVersion,
}: {
  isRunning: boolean;
  trackStatus: TrackStatus | null;
  progressPercent: number;
  onToggle: () => void;
  onQuit: () => void;
  appVersion: string;
}) {
  return (
    <div className="flex flex-col">
      {/* Now Playing Section */}
      <div className="p-4">
        <div className="rounded-xl bg-secondary/50 p-4">
          {trackStatus?.title ? (
            <div className="flex items-start gap-4 w-full animate-slide-up">
              <div className="w-16 h-16 rounded-xl bg-muted overflow-hidden flex-shrink-0 shadow-lg">
                {trackStatus.coverUrl ? (
                  <img
                    src={trackStatus.coverUrl}
                    alt="Album cover"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Music className="w-8 h-8 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">
                  {trackStatus.title}
                </p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {trackStatus.artist}
                </p>
                <p className="text-xs text-muted-foreground/60 truncate">
                  {trackStatus.album}
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {formatTime(trackStatus.positionMs)}
                  </span>
                  <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300 rounded-full"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {formatTime(trackStatus.durationMs)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                  <Music className="w-5 h-5 text-muted-foreground/50" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {trackStatus?.reason === "spotify-not-running"
                      ? "Spotify is closed"
                      : "Not playing"}
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    {trackStatus?.reason === "spotify-not-running"
                      ? "Spotify is closed"
                      : "Start a track to show status"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="px-4 pb-3">
        <p className="text-xs text-muted-foreground text-center">
          {isRunning
            ? "Showing your Spotify activity on Discord"
            : "Click Start to begin sharing your music"}
        </p>
      </div>

      {/* Action Button */}
      <div className="px-4 pb-4">
        <Button
          onClick={onToggle}
          className={`w-full h-11 text-sm font-semibold transition-all ${
            isRunning
              ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              : "bg-primary hover:bg-primary/90 text-primary-foreground"
          }`}
        >
          <Power className="w-4 h-4 mr-2" />
          {isRunning ? "Stop" : "Start"}
        </Button>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-border mt-auto">
        <span className="text-[10px] text-muted-foreground/70 font-medium">
          v{appVersion}
        </span>
        <span className="text-[10px] text-muted-foreground">
          made with <span className="text-red-500">&#9829;</span> by florian
        </span>
        <button
          type="button"
          onClick={onQuit}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          Quit
        </button>
      </div>
    </div>
  );
}

interface Manifest {
  version: string;
  notes: string;
  pub_date: string;
}

function ChangelogSection() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("https://pifiles.florian.lt/cdn/tini-presence/releases/latest.json")
      .then((res) => res.json())
      .then((data) => {
        setManifest(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50 italic animate-pulse">
        <Loader2 className="w-3 h-3 animate-spin" />
        Checking for updates...
      </div>
    );

  if (!manifest) return null;

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-foreground/80 uppercase tracking-wider">
          Latest Release: v{manifest.version}
        </span>
        <span className="text-[10px] text-muted-foreground/60 italic">
          {new Date(manifest.pub_date).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </div>
      <div className="text-[10px] leading-relaxed text-muted-foreground bg-muted/20 rounded-lg p-2.5 border border-border/40 font-mono whitespace-pre-wrap">
        {manifest.notes}
      </div>
    </div>
  );
}

function SettingsView({
  config,
  setConfig,
  onSave,
  onAddFolder,
  onOpenConfig,
  logs,
}: {
  config: AppConfig;
  setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
  onSave: () => void;
  onAddFolder: () => void;
  onOpenConfig: () => void;
  logs: { id: number; text: string }[];
}) {
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    getVersion().then(setAppVersion);
  }, []);

  return (
    <div className="flex flex-col animate-slide-up">
      <div className="px-4 py-4 space-y-5 max-h-[350px] overflow-y-auto">
        {/* Theme Selector */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">
            Theme Color
          </Label>
          <div className="flex gap-2">
            {themeOptions.map((theme) => (
              <button
                type="button"
                key={theme.value}
                onClick={() => {
                  const newConfig = { ...config, theme: theme.value };
                  setConfig(newConfig);
                  invoke("update_config", { config: newConfig });
                }}
                className={`w-8 h-8 rounded-lg ${
                  theme.color
                } transition-all hover:scale-110 ${
                  config.theme === theme.value
                    ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                    : ""
                }`}
                title={theme.label}
              />
            ))}
          </div>
        </div>

        {/* Discord Client ID */}
        <div className="space-y-2">
          <Label
            htmlFor="discord-client-id"
            className="text-xs font-medium text-muted-foreground"
          >
            Discord Client ID
          </Label>
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
            className="h-10 bg-input border-border text-sm"
          />
        </div>

        {/* Copyparty API Key */}
        <div className="space-y-2">
          <Label
            htmlFor="copyparty-api-key"
            className="text-xs font-medium text-muted-foreground"
          >
            Copyparty API Key
          </Label>
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
            className="h-10 bg-input border-border text-sm"
          />
        </div>

        {/* URL and Path */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label
              htmlFor="copyparty-url"
              className="text-xs font-medium text-muted-foreground"
            >
              Copyparty URL
            </Label>
            <Input
              id="copyparty-url"
              placeholder="https://example.com"
              value={config.copypartyUrl || ""}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, copypartyUrl: e.target.value }))
              }
              className="h-10 bg-input border-border text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="copyparty-path"
              className="text-xs font-medium text-muted-foreground"
            >
              Path
            </Label>
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
              className="h-10 bg-input border-border text-sm"
            />
          </div>
        </div>

        {/* Music Folders */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">
            Music Folders
          </Label>
          <div className="rounded-lg border border-border bg-input p-3 min-h-[60px]">
            {config.musicFolders.length === 0 ? (
              <span className="text-xs text-muted-foreground/60">
                No folders added yet
              </span>
            ) : (
              <div className="space-y-2">
                {config.musicFolders.map((folder) => (
                  <div
                    key={folder}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <Folder className="w-3.5 h-3.5 text-primary/70" />
                    <span className="truncate">{folder}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="h-8 text-xs font-medium"
              onClick={onAddFolder}
            >
              <Folder className="w-3.5 h-3.5 mr-1.5" />
              Add folder
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="h-8 text-xs font-medium"
              onClick={onOpenConfig}
            >
              <FileText className="w-3.5 h-3.5 mr-1.5" />
              Open config
            </Button>
          </div>
        </div>

        {/* Changelog Section */}
        <div className="space-y-3 pt-2 border-t border-border/30">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1.5 font-medium">
              <History className="w-3.5 h-3.5" />
              <span>Version History</span>
            </div>
            <div className="flex items-center gap-2">
              <span>Current: v{appVersion}</span>
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("trigger-update-check"));
                }}
                className="px-1.5 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary transition-colors font-medium border border-primary/20"
              >
                Check for updates
              </button>
            </div>
          </div>
          <ChangelogSection />
        </div>

        {/* Collapsible Logs */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setLogsExpanded(!logsExpanded)}
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            <ScrollText className="w-3.5 h-3.5" />
            <span>Sidecar Logs</span>
            <ChevronDown
              className={`w-3.5 h-3.5 ml-auto transition-transform ${
                logsExpanded ? "rotate-180" : ""
              }`}
            />
          </button>
          {logsExpanded && (
            <div className="rounded-lg border border-border bg-muted/30 p-2 max-h-24 overflow-y-auto">
              {logs.length === 0 ? (
                <span className="text-xs text-muted-foreground/60">
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
          )}
        </div>
      </div>

      {/* Save Button - Sticky at bottom */}
      <div className="px-4 pb-4 pt-2 border-t border-border">
        <Button
          onClick={onSave}
          className="w-full h-10 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold"
        >
          <Check className="w-4 h-4 mr-2" />
          Save settings
        </Button>
      </div>
    </div>
  );
}

export default App;
