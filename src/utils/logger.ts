import fs from "fs";
import path from "path";
import util from "util";
import { config } from "../config.js";

const timestamp = () => new Date().toISOString();
const logFilePath = path.join(config.dataDir, "logs", "email-service.log");

let stdoutAvailable = true;
let stderrAvailable = true;

function ensureLogDir(): void {
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
}

function isRecoverableStreamError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code || "") : "";
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED";
}

function stringifyLogData(data?: unknown): string {
  if (data === undefined || data === null || data === "") {
    return "";
  }

  if (data instanceof Error) {
    return data.stack || `${data.name}: ${data.message}`;
  }

  if (typeof data === "string") {
    return data;
  }

  try {
    return JSON.stringify(data);
  } catch {
    return util.inspect(data, {
      breakLength: 120,
      compact: false,
      depth: 4,
      maxArrayLength: 20,
    });
  }
}

function appendToFallbackLog(line: string): void {
  try {
    ensureLogDir();
    fs.appendFileSync(logFilePath, `${line}\n`, "utf8");
  } catch {
    // Swallow fallback log failures to avoid recursive logging loops.
  }
}

function writeLine(kind: "stdout" | "stderr", line: string): void {
  const stream = kind === "stdout" ? process.stdout : process.stderr;
  const isAvailable = kind === "stdout" ? stdoutAvailable : stderrAvailable;

  if (!isAvailable) {
    appendToFallbackLog(line);
    return;
  }

  try {
    stream.write(`${line}\n`);
  } catch (error) {
    if (isRecoverableStreamError(error)) {
      if (kind === "stdout") stdoutAvailable = false;
      else stderrAvailable = false;
      appendToFallbackLog(line);
      return;
    }

    appendToFallbackLog(
      `[${timestamp()}] LOGGER_FALLBACK: failed to write to ${kind}: ${stringifyLogData(error)}`
    );
    appendToFallbackLog(line);
  }
}

function log(kind: "stdout" | "stderr", level: string, message: string, data?: unknown): void {
  const serialized = stringifyLogData(data);
  const line = serialized
    ? `[${timestamp()}] ${level}: ${message} ${serialized}`
    : `[${timestamp()}] ${level}: ${message}`;
  writeLine(kind, line);
}

process.stdout.on("error", (error) => {
  if (isRecoverableStreamError(error)) {
    stdoutAvailable = false;
    return;
  }

  appendToFallbackLog(
    `[${timestamp()}] LOGGER_FALLBACK: stdout stream error ${stringifyLogData(error)}`
  );
});

process.stderr.on("error", (error) => {
  if (isRecoverableStreamError(error)) {
    stderrAvailable = false;
    return;
  }

  appendToFallbackLog(
    `[${timestamp()}] LOGGER_FALLBACK: stderr stream error ${stringifyLogData(error)}`
  );
});

export const logger = {
  info: (message: string, data?: unknown) => {
    log("stdout", "INFO", message, data);
  },
  warn: (message: string, data?: unknown) => {
    log("stderr", "WARN", message, data);
  },
  error: (message: string, data?: unknown) => {
    log("stderr", "ERROR", message, data);
  },
  success: (message: string, data?: unknown) => {
    log("stdout", "SUCCESS", message, data);
  },
};

export { logFilePath };
