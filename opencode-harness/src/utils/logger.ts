// The one logger the harness writes through, matching the other services:
// console output plus a rotating error log and a combined log under logs/.
// Production code never uses console directly.

import fs from "node:fs";
import path from "node:path";
import winston from "winston";

// Keep the log directory beside whatever directory the harness runs from.
const logsDirectory = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDirectory)) {
  fs.mkdirSync(logsDirectory, { recursive: true });
}

// Structured output for the files, which are read by tools rather than people.
const structured = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Readable output for the console, which is read by whoever is watching a run.
const readable = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
    const label = context ? " [" + String(context) + "]" : "";
    const extra = Object.keys(meta).length > 0 ? " " + JSON.stringify(meta) : "";
    return timestamp + " " + level.toUpperCase() + label + " " + String(message) + extra;
  })
);

// The shared logger. LOG_LEVEL changes how much reaches the console and the
// combined log, exactly as it does for the other services.
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: readable,
  transports: [
    new winston.transports.Console({ format: readable }),
    new winston.transports.File({
      filename: path.join(logsDirectory, "error.log"),
      level: "error",
      format: structured,
      maxsize: 10485760,
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: path.join(logsDirectory, "combined.log"),
      level: "debug",
      format: structured,
      maxsize: 10485760,
      maxFiles: 10
    })
  ],
  exitOnError: false
});

// Build a child logger that labels every line with a component name.
export function createLogger(context: string): winston.Logger {
  return logger.child({ context });
}

export default logger;
