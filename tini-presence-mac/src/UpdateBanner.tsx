import { useState, useEffect, useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Download, AlertCircle, Loader2 } from "lucide-react";

interface UpdateState {
  status:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "installing"
    | "error";
  update: Update | null;
  progress: number;
  downloaded: number;
  total: number;
  error: string | null;
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({
    status: "idle",
    update: null,
    progress: 0,
    downloaded: 0,
    total: 0,
    error: null,
  });

  const checkForUpdates = useCallback(async (silent = false) => {
    if (!silent) {
      setState((prev) => ({ ...prev, status: "checking", error: null }));
    }

    try {
      const update = await check();
      if (update) {
        setState((prev) => ({
          ...prev,
          status: "available",
          update,
        }));
      } else {
        setState((prev) => ({ ...prev, status: "idle" }));
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
      if (!silent) {
        setState((prev) => ({
          ...prev,
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Failed to check for updates",
        }));
      }
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!state.update) return;

    setState((prev) => ({ ...prev, status: "downloading", progress: 0 }));

    try {
      let downloaded = 0;
      let contentLength = 0;

      await state.update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started": {
            contentLength = event.data.contentLength ?? 0;
            setState((prev) => ({ ...prev, total: contentLength }));
            break;
          }
          case "Progress": {
            downloaded += event.data.chunkLength;
            const progress =
              contentLength > 0 ? (downloaded / contentLength) * 100 : 0;
            setState((prev) => ({
              ...prev,
              downloaded,
              progress,
            }));
            break;
          }
          case "Finished": {
            setState((prev) => ({
              ...prev,
              status: "installing",
              progress: 100,
            }));
            break;
          }
        }
      });

      await relaunch();
    } catch (error) {
      console.error("Failed to install update:", error);
      setState((prev) => ({
        ...prev,
        status: "error",
        error:
          error instanceof Error ? error.message : "Failed to install update",
      }));
    }
  }, [state.update]);

  useEffect(() => {
    // Initial check (non-silent)
    checkForUpdates();

    // Background check every hour
    const interval = setInterval(() => {
      checkForUpdates(true);
    }, 1000 * 60 * 60);

    // Check when window is focused
    const handleFocus = () => checkForUpdates(true);
    window.addEventListener("focus", handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [checkForUpdates]);

  if (state.status === "idle") return null;

  if (state.status === "checking") {
    return (
      <div className="px-5 py-3 bg-primary/5 border-b border-border">
        <div className="flex items-center gap-3 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Checking for updates...</span>
        </div>
      </div>
    );
  }

  if (state.status === "available" && state.update) {
    return (
      <div className="px-5 py-3 bg-primary/5 border-b border-border animate-slide-up">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Download className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Update available
              </p>
              <p className="text-xs text-primary">
                v{state.update.currentVersion} → v{state.update.version}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={installUpdate}
            className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 px-3 text-xs font-medium"
          >
            Update
          </Button>
        </div>
      </div>
    );
  }

  if (state.status === "downloading") {
    return (
      <div className="px-5 py-3 bg-primary/5 border-b border-border">
        <div className="flex items-center gap-3 mb-2">
          <Download className="w-4 h-4 text-primary" />
          <span className="text-sm text-foreground">
            Downloading... {formatBytes(state.downloaded)} /{" "}
            {formatBytes(state.total)}
          </span>
        </div>
        <Progress value={state.progress} className="h-1.5" />
      </div>
    );
  }

  if (state.status === "installing") {
    return (
      <div className="px-5 py-3 bg-primary/5 border-b border-border">
        <div className="flex items-center gap-3 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span>Installing update...</span>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="px-5 py-3 bg-destructive/5 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-destructive text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>{state.error}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => checkForUpdates()}
            className="h-8 px-3 text-xs"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
