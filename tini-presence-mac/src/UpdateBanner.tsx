import { useState, useEffect, useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

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

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({
    status: "idle",
    update: null,
    progress: 0,
    downloaded: 0,
    total: 0,
    error: null,
  });

  const checkForUpdates = useCallback(async () => {
    setState((prev) => ({ ...prev, status: "checking", error: null }));

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
      setState((prev) => ({
        ...prev,
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : "Failed to check for updates",
      }));
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
    checkForUpdates();
  }, [checkForUpdates]);

  if (state.status === "idle") return null;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <Alert className="border-primary/30 bg-primary/10">
      {state.status === "checking" && (
        <AlertDescription className="flex items-center gap-2 text-muted-foreground">
          <span className="animate-spin">🔄</span>
          Checking for updates...
        </AlertDescription>
      )}

      {state.status === "available" && state.update && (
        <AlertDescription className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span>🎉</span>
            <div className="flex flex-col">
              <span className="font-medium">Update available!</span>
              <span className="text-xs text-primary">
                v{state.update.currentVersion} → v{state.update.version}
              </span>
            </div>
          </div>
          <Button size="sm" onClick={installUpdate}>
            Update now
          </Button>
        </AlertDescription>
      )}

      {state.status === "downloading" && (
        <AlertDescription className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span>⬇️</span>
            Downloading... {formatBytes(state.downloaded)} /{" "}
            {formatBytes(state.total)}
          </div>
          <Progress value={state.progress} className="h-1" />
        </AlertDescription>
      )}

      {state.status === "installing" && (
        <AlertDescription className="flex items-center gap-2 text-muted-foreground">
          <span className="animate-spin">⚙️</span>
          Installing update...
        </AlertDescription>
      )}

      {state.status === "error" && (
        <AlertDescription className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-destructive">
            <span>❌</span>
            <span className="text-sm">{state.error}</span>
          </div>
          <Button size="sm" variant="outline" onClick={checkForUpdates}>
            Retry
          </Button>
        </AlertDescription>
      )}
    </Alert>
  );
}
