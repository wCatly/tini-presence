/**
 * File-based logging for tini-presence sidecar
 * Logs to ~/Library/Logs/tini-presence/sidecar.log
 */

import {
  existsSync,
  mkdirSync,
  appendFileSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
  statSync,
  copyFileSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB max log size

function ensureDir(dir: string): boolean {
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return true;
  } catch {
    return false;
  }
}

function resolveLogDir(): string {
  const primary = join(homedir(), "Library", "Logs", "tini-presence");
  if (ensureDir(primary)) return primary;

  const fallback = join(homedir(), "Library", "Application Support", "tini-presence");
  if (ensureDir(fallback)) return fallback;

  const tmp = join(process.env.TMPDIR || "/tmp", "tini-presence");
  ensureDir(tmp);
  return tmp;
}

const LOG_DIR = resolveLogDir();
const LOG_FILE = join(LOG_DIR, "sidecar.log");
const LOCK_FILE = join(LOG_DIR, "sidecar.lock");

// Rotate log if too large
function rotateLogIfNeeded() {
  try {
    if (existsSync(LOG_FILE)) {
      const stats = statSync(LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        const oldLog = join(LOG_DIR, "sidecar.old.log");
        if (existsSync(oldLog)) unlinkSync(oldLog);
        copyFileSync(LOG_FILE, oldLog);
        unlinkSync(LOG_FILE);
      }
    }
  } catch {
    // Ignore rotation errors
  }
}

rotateLogIfNeeded();

function formatTimestamp(): string {
  return new Date().toISOString();
}

function writeLog(level: string, args: unknown[]) {
  const message = args.map(arg => 
    typeof arg === "object" ? JSON.stringify(arg) : String(arg)
  ).join(" ");
  
  const line = `[${formatTimestamp()}] [${level}] ${message}\n`;
  
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // Ignore write errors
  }
  
  // Also write to stderr for Tauri to capture
  process.stderr.write(line);
}

export const logger = {
  log: (...args: unknown[]) => writeLog("INFO", args),
  info: (...args: unknown[]) => writeLog("INFO", args),
  warn: (...args: unknown[]) => writeLog("WARN", args),
  error: (...args: unknown[]) => writeLog("ERROR", args),
  debug: (...args: unknown[]) => writeLog("DEBUG", args),
};

/**
 * Acquire a lock file to prevent multiple sidecar instances
 * Returns true if lock acquired, false if another instance is running
 */
export function acquireLock(): boolean {
  const pid = process.pid;
  let exitReason = "exit";

  try {
    // Check if lock file exists
    if (existsSync(LOCK_FILE)) {
      const existingPid = parseInt(readFileSync(LOCK_FILE, "utf-8").trim(), 10);

      // Check if process is still running
      if (existingPid && isProcessRunning(existingPid)) {
        logger.error(`Another sidecar instance is running (PID ${existingPid})`);
        return false;
      }

      // Stale lock file, remove it
      logger.info(`Removing stale lock file (old PID ${existingPid})`);
      unlinkSync(LOCK_FILE);
    }

    // Create lock file with our PID
    writeFileSync(LOCK_FILE, String(pid));
    logger.info(`Lock acquired (PID ${pid})`);

    // Remove lock file on exit
    const cleanup = () => {
      try {
        if (existsSync(LOCK_FILE)) {
          const lockPid = parseInt(readFileSync(LOCK_FILE, "utf-8").trim(), 10);
          if (lockPid === pid) {
            unlinkSync(LOCK_FILE);
            logger.info(`Lock released (${exitReason})`);
          }
        }
      } catch {
        // Ignore cleanup errors
      }
    };

    process.on("exit", (code) => {
      exitReason = `exit code ${code ?? "unknown"}`;
      cleanup();
    });
    process.on("SIGINT", () => {
      exitReason = "SIGINT";
      cleanup();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      exitReason = "SIGTERM";
      cleanup();
      process.exit(0);
    });
    process.on("SIGHUP", () => {
      exitReason = "SIGHUP";
      cleanup();
      process.exit(0);
    });

    return true;
  } catch (err) {
    logger.error("Failed to acquire lock:", err);
    return false;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    const result = Bun.spawnSync({
      cmd: ["ps", "-p", String(pid), "-o", "comm="],
    });
    if (result.exitCode !== 0) return false;
    const output = new TextDecoder().decode(result.stdout).trim();
    if (!output) return false;
    return output.includes("tini-presence-core");
  } catch {
    try {
      // Fallback: check if pid exists
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Release the lock file
 */
export function releaseLock() {
  try {
    if (existsSync(LOCK_FILE)) {
      unlinkSync(LOCK_FILE);
    }
  } catch {
    // Ignore
  }
}

export const LOG_DIR_PATH = LOG_DIR;
export const LOG_FILE_PATH = LOG_FILE;
export const LOCK_FILE_PATH = LOCK_FILE;
