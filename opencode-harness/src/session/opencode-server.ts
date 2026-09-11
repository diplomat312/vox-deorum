// Owns the OpenCode server process that the harness talks to.
// The harness uses the server API rather than the run command because the run
// command cannot start a session on this machine, and because the server
// returns strictly more: thinking text, cache splits and spend per response.

import { spawn, type ChildProcess } from "node:child_process";
import { logger } from "../utils/logger.js";

// How long to wait for a freshly started server to answer, in milliseconds.
//
// This is generous because a server starting while several others are also
// starting, on a machine under load, can take well over a minute. Waiting
// longer costs nothing when the server comes up quickly, and it turns a slow
// machine into a slow start rather than a failed run.
const readyTimeoutMs = 180000;

// How long to wait between readiness probes, in milliseconds.
const readyPollMs = 500;

// How long to allow a server to exit after being asked to stop, in milliseconds.
const stopTimeoutMs = 10000;

// Credentials the harness gives a server it starts. The server requires basic
// auth on every request, so the same pair is kept here for the client to send.
export interface ServerCredentials {
  // Basic auth user name.
  username: string;
  // Basic auth password.
  password: string;
}

// What a running server needs to be reachable.
export interface RunningServer {
  // Base address, for example "http://127.0.0.1:4137".
  url: string;
  // Credentials the client must present.
  credentials: ServerCredentials;
}

// Wait for a short while.
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A server the harness started, which it also owns stopping.
export class OpenCodeServer {
  // The child process, held so it can be stopped with the run.
  private child: ChildProcess | null = null;

  // The address and credentials of the running server, or null when stopped.
  private running: RunningServer | null = null;

  // Where the server keeps per-run state that must not leak between runs.
  private readonly directory: string;

  // Build an owner for one server. The directory scopes the server's project,
  // which keeps one run's sessions away from another's.
  constructor(directory: string) {
    this.directory = directory;
  }

  // The address and credentials of the running server.
  address(): RunningServer {
    if (!this.running) {
      throw new Error("The OpenCode server is not running");
    }
    return this.running;
  }

  // Whether the server process is still alive. A run checks this when a turn
  // fails, because a seat whose server has exited cannot be asked again and
  // must not be recorded as merely slow.
  isAlive(): boolean {
    return this.child !== null && this.child.exitCode === null && this.running !== null;
  }

  // The port the server is listening on, so a replacement can take the same
  // one rather than leaving a gap in the run's ports.
  port(): number | null {
    if (!this.running) return null;
    const parsed = Number(new URL(this.running.url).port);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // Start the server and wait until it answers. The caller may pass credentials
  // so a run can use its own pair, and a port so several runs can coexist.
  async start(options: { port: number; credentials?: ServerCredentials }): Promise<RunningServer> {
    if (this.running) return this.running;
    const credentials = options.credentials ?? {
      username: "harness",
      password: Math.random().toString(36).slice(2) + Date.now().toString(36)
    };
    const url = "http://127.0.0.1:" + options.port;
    logger.info("Starting the OpenCode server on " + url + " in " + this.directory);
    this.child = spawn("opencode", ["serve", "--port", String(options.port), "--hostname", "127.0.0.1"], {
      cwd: this.directory,
      env: {
        ...process.env,
        OPENCODE_SERVER_USERNAME: credentials.username,
        OPENCODE_SERVER_PASSWORD: credentials.password
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    this.child.stdout?.on("data", (chunk: Buffer) => logger.debug("opencode serve: " + chunk.toString().trim()));
    this.child.stderr?.on("data", (chunk: Buffer) => logger.warn("opencode serve: " + chunk.toString().trim()));
    this.child.on("exit", (code, signal) => {
      logger.warn("The OpenCode server exited with code " + String(code) + " and signal " + String(signal));
      this.child = null;
      this.running = null;
    });
    const ready: RunningServer = { url, credentials };
    await this.waitUntilReady(ready);
    this.running = ready;
    logger.info("The OpenCode server is answering on " + url);
    return ready;
  }

  // Poll the server until it answers an authenticated request, or give up.
  private async waitUntilReady(server: RunningServer): Promise<void> {
    const deadline = Date.now() + readyTimeoutMs;
    let lastError = "no response";
    while (Date.now() < deadline) {
      if (!this.child) {
        throw new Error("The OpenCode server exited before it was ready");
      }
      try {
        const response = await fetch(server.url + "/app", { headers: authHeaders(server.credentials) });
        if (response.ok) return;
        lastError = "HTTP " + response.status;
      } catch (error) {
        lastError = String(error);
      }
      await delay(readyPollMs);
    }
    throw new Error("The OpenCode server did not become ready within " + readyTimeoutMs + "ms (" + lastError + ")");
  }

  // Ask the server to stop, and make sure the process is gone.
  async stop(): Promise<void> {
    const child = this.child;
    this.running = null;
    if (!child || child.exitCode !== null) {
      this.child = null;
      return;
    }
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    let forceTimer: NodeJS.Timeout | undefined;
    const forced = new Promise<void>((resolve) => {
      forceTimer = setTimeout(() => {
        logger.warn("The OpenCode server did not stop in time, killing it");
        child.kill("SIGKILL");
        resolve();
      }, stopTimeoutMs);
    });
    child.kill();
    await Promise.race([exited, forced]);
    if (forceTimer) clearTimeout(forceTimer);
    this.child = null;
  }
}

// Build the basic auth header the server requires on every request.
export function authHeaders(credentials: ServerCredentials): Record<string, string> {
  const encoded = Buffer.from(credentials.username + ":" + credentials.password, "utf8").toString("base64");
  return { Authorization: "Basic " + encoded };
}
