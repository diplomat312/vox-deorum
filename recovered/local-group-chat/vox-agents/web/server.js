/**
 * Web UI Server for Vox Agents
 * Provides REST API and SSE endpoints for telemetry, logs, sessions, and agent chat
 */
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import * as fsPromises from 'fs/promises';
import { createLogger } from '../utils/logger.js';
import { sseManager } from './sse-manager.js';
import { startWorldBeat } from './chat/world-beat.js';
import config from '../utils/config.js';
import telemetryRoutes from './routes/telemetry.js';
import configRoutes from './routes/config.js';
import { createAgentRoutes } from './routes/agent.js';
import sessionRoutes from './routes/session.js';
import { processManager } from '../infra/process-manager.js';
import { isAllowedDashboardRequest, isAllowedLoopbackOrigin } from './origin.js';
// Get __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Initialize Express app
const app = express();
const PORT = config.webui.port;
const shutdownUrlFile = process.env.VOX_SHUTDOWN_URL_FILE;
// Create loggers using the unified logger utility
// These will automatically stream to SSE when available
const webLogger = createLogger('WebUI', 'webui'); // Web UI logger with source: 'webui'
let activeServer = null;
let heartbeatInterval = null;
let activePort = null;
/** Resolves the browser-origin CORS policy using the middleware callback contract. */
function allowLoopbackCorsOrigin(origin, callback) {
    callback(null, isAllowedLoopbackOrigin(origin));
}
/** Rejects browser and Host-header requests that do not identify the loopback dashboard. */
function requireAllowedDashboardRequest(req, res, next) {
    if (!isAllowedDashboardRequest(req.hostname, req.get('origin'))) {
        res.status(403).json({ error: 'This request is not allowed to access the local dashboard.' });
        return;
    }
    next();
}
/** Returns a loopback hostname suitable for the local shutdown URL. */
function getShutdownHost(host) {
    if (host === '0.0.0.0' || host === '::' || host === '::1' || host === 'localhost') {
        return '127.0.0.1';
    }
    return host;
}
async function writeShutdownUrlFile(port, host = '127.0.0.1') {
    if (!shutdownUrlFile)
        return;
    const shutdownUrl = `http://${getShutdownHost(host)}:${port}/shutdown`;
    await fsPromises.writeFile(shutdownUrlFile, `${shutdownUrl}\n`, 'utf8');
    webLogger.info(`Wrote shutdown URL to ${shutdownUrlFile}`);
}
export async function shutdownWebServer() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    if (!activeServer) {
        return;
    }
    const server = activeServer;
    activeServer = null;
    activePort = null;
    sseManager.closeAll();
    await new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            webLogger.info('Web UI server closed');
            resolve();
        });
        server.closeAllConnections();
    });
}
// Middleware setup
app.use(cors({ origin: allowLoopbackCorsOrigin }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Protect every API and shutdown route from cross-origin and DNS-rebinding requests.
app.use(['/api', '/shutdown'], requireAllowedDashboardRequest);
// Serve static files from dist-ui directory (production build)
const staticPath = path.join(__dirname, '../../dist-ui');
app.use(express.static(staticPath, {
    maxAge: 0,
    etag: false,
    setHeaders: (res, filePath) => {
        // Prevent caching for development
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        // Set proper content types for specific file extensions
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
        else if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        }
    }
}));
// API routes should come before the catch-all route
// Mount telemetry routes
app.use('/api/telemetry', telemetryRoutes);
// Mount config routes
app.use('/api/config', configRoutes);
// Mount agent routes
app.use('/api', createAgentRoutes());
// Mount session routes
app.use('/api/session', sessionRoutes);
// Health check endpoint - minimal API foundation
app.get('/api/health', (_req, res) => {
    const healthStatus = {
        timestamp: new Date().toISOString(),
        service: 'vox-agents-webui',
        version: config.versionInfo?.version || '0.0.0',
        uptime: process.uptime(),
        clients: sseManager.getClientCount(),
        port: activePort ?? PORT
    };
    res.json(healthStatus);
});
// SSE endpoint for log streaming
app.get('/api/logs/stream', (_req, res) => {
    webLogger.info('New SSE client connected');
    sseManager.addClient(res);
});
app.post('/shutdown', (_req, res) => {
    webLogger.info('Received HTTP shutdown request');
    res.status(202).json({ success: true, message: 'Shutdown initiated' });
    setImmediate(() => {
        void processManager.shutdown('http-shutdown');
    });
});
// Return JSON for unknown API endpoints before the SPA fallback can serve index.html.
app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});
// Catch-all route for SPA - must come AFTER all API routes
app.get('*', (_req, res) => {
    const indexPath = path.join(staticPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    }
    else {
        res.status(404).json({
            error: 'UI not built',
            details: 'Run "npm run build" in ui/ directory to build the frontend'
        });
    }
});
/** Try to listen on the given port. Resolves with the port on success, null on EADDRINUSE. */
function tryListen(port) {
    return new Promise((resolve, reject) => {
        const server = app.listen(port, '127.0.0.1', () => {
            const address = server.address();
            const actualHost = typeof address === 'object' && address ? address.address : '127.0.0.1';
            const actualPort = typeof address === 'object' && address ? address.port : port;
            activeServer = server;
            activePort = actualPort;
            processManager.register('web-server', async () => {
                await shutdownWebServer();
            });
            webLogger.info(`🌐 Web UI available at: http://localhost:${actualPort}`);
            webLogger.info('Press Ctrl+C to stop the server');
            webLogger.info(`Shutdown endpoint: POST http://${getShutdownHost(actualHost)}:${actualPort}/shutdown`);
            // Start SSE heartbeat to keep connections alive
            heartbeatInterval = sseManager.startHeartbeat();
            void writeShutdownUrlFile(actualPort, actualHost).catch((error) => {
                webLogger.warn(`Failed to write shutdown URL file: ${String(error)}`);
            });
            resolve(actualPort);
        });
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(null);
            }
            else {
                reject(err);
            }
        });
    });
}
// Start server function — tries configured port, then falls back to port + 1
export async function startWebServer() {
    try {
        startWorldBeat();
        webLogger.info('World chat beat scheduler started');
    }
    catch (error) {
        webLogger.warn(`World chat beat failed to start: ${String(error)}`);
    }
    const result = await tryListen(PORT);
    if (result !== null)
        return result;
    const fallback = PORT + 1;
    webLogger.warn(`Port ${PORT} is already in use — trying ${fallback}`);
    const fallbackResult = await tryListen(fallback);
    if (fallbackResult !== null)
        return fallbackResult;
    webLogger.warn(`Port ${fallback} is also in use — skipping Web UI startup`);
    return null;
}
// Export for integration with vox-agents process
export { app };
//# sourceMappingURL=server.js.map
