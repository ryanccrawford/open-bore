import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { platform } from 'os';
import { ServerConfig, ClientConfig, SpeedStats } from './types';

import http from 'http'; // Import the http module

class OpenBoreClient extends EventEmitter {
    private frpcProcess: ChildProcess | null = null;
    private serverConfig: ServerConfig | null = null;
    private config: ClientConfig;
    private running: boolean = false;
    private byteWindow: { tx: number[]; rx: number[]; timestamps: number[] } = { tx: [], rx: [], timestamps: [] };
    private frpcPath: string;
    private server: http.Server | null = null; // Add a server property


    constructor(config: ClientConfig, serverConfig?: ServerConfig | string) {
        super();
        this.config = config;

        const plat = platform();
        const frpcName = plat === 'win32' ? 'frpc-win.exe' : plat === 'darwin' ? 'frpc-macos' : 'frpc-linux';
        this.frpcPath = join(dirname(process.execPath), 'client', frpcName);
        if (!existsSync(this.frpcPath)) {
            this.frpcPath = join(__dirname, '..', 'frpc');
        }

        if (typeof serverConfig === 'string') {
            this.serverConfig = this.loadServerConfig(serverConfig);
        } else if (serverConfig) {
            this.serverConfig = serverConfig;
        } else {
            this.serverConfig = this.loadFromEnv() || this.loadServerConfigSafe('./open-bore.ini');
        }
    }

    private loadFromEnv(): ServerConfig | null {
        const serverAddr = process.env.OPEN_BORE_SERVER_ADDR;
        const serverPort = parseInt(process.env.OPEN_BORE_SERVER_PORT || '7000', 10);
        const token = process.env.OPEN_BORE_TOKEN;
        if (serverAddr && token) {
            return { serverAddr, serverPort, token };
        }
        return null;
    }

    private loadServerConfig(path: string): ServerConfig {
        const configData = readFileSync(path, 'utf-8');
        const parsed = require('ini').parse(configData).common;
        return {
            serverAddr: parsed.server_addr,
            serverPort: parsed.server_port,
            token: parsed.token,
        };
    }

    private loadServerConfigSafe(path: string): ServerConfig | null {
        try {
            return this.loadServerConfig(path);
        } catch (e: any) {
            if (e.code === 'ENOENT') {
                return null;
            }
            throw new Error(`Failed to load server config from ${path}: ${e.message}`);
        }
    }

    start() {
        if (this.running) return;

        if (!this.serverConfig) {
            this.serverConfig = this.loadServerConfigSafe('./open-bore.ini');
            if (!this.serverConfig) {
                console.error('No server config found—please create open-bore.ini, set environment variables, or use --server-addr, --server-port, --token');
                return;
            }
        }

        console.log('Starting frpc...');
        console.log('Subdomain:', this.config.subdomain);
        console.log('Local Port:', this.config.localPort);

        const serverConfig = this.serverConfig as ServerConfig;
        const subdomain = Array.isArray(this.config.subdomain) ? this.config.subdomain[0] : this.config.subdomain;
        const localPort = Array.isArray(this.config.localPort) ? this.config.localPort[0] : this.config.localPort;

        const configIni = `
[common]
server_addr = ${serverConfig.serverAddr}
server_port = ${serverConfig.serverPort}
token = ${serverConfig.token}
log_level = debug

[${subdomain}]
type = http
local_port = ${localPort}
subdomain = ${subdomain}
`.trim();
        writeFileSync('frpc.ini', configIni);

        this.frpcProcess = spawn(this.frpcPath, ['-c', 'frpc.ini'], { stdio: 'pipe' });

        this.frpcProcess.stdout?.on('data', (data) => {
            const msg = data.toString();
            console.log(`frpc stdout: ${msg}`);
            if (msg.includes('login to server success')) {
                this.running = true;
                this.emit('connected', this);
            }
            this.updateByteWindow(data.length, 0);
        });

        this.frpcProcess.stderr?.on('data', (data) => {
            console.error(`frpc stderr: ${data.toString()}`);
            this.updateByteWindow(data.length, 0);
        });

        this.frpcProcess.on('close', (code) => {
            console.log(`frpc exited with code ${code}`);
            this.running = false;
            this.emit('disconnected');
            this.reconnect();
        });

        this.monitorSpeeds();
        this.startProxyServer();
    }

    stop() {
        if (this.frpcProcess) {
            this.frpcProcess.kill('SIGTERM');
            this.frpcProcess = null;
        }
        this.running = false;
    }

    private reconnect() {
        if (!this.running) {
            console.log('Reconnecting in 5 seconds...');
            setTimeout(() => this.start(), 5000);
        }
    }

    private updateByteWindow(rx: number, tx: number) {
        const now = Date.now();
        this.byteWindow.rx.push(rx);
        this.byteWindow.tx.push(tx);
        this.byteWindow.timestamps.push(now);

        while (this.byteWindow.timestamps[0] < now - 1000) {
            this.byteWindow.rx.shift();
            this.byteWindow.tx.shift();
            this.byteWindow.timestamps.shift();
        }
    }

    private monitorSpeeds() {
        setInterval(() => {
            const now = Date.now();
            const windowDuration = (now - (this.byteWindow.timestamps[0] || now)) / 1000 || 1;
            const txTotal = this.byteWindow.tx.reduce((sum, bytes) => sum + bytes, 0);
            const rxTotal = this.byteWindow.rx.reduce((sum, bytes) => sum + bytes, 0);
            const txSpeed = (txTotal * 8) / windowDuration;
            const rxSpeed = (rxTotal * 8) / windowDuration;
            this.emit('speed', { tx: txSpeed, rx: rxSpeed });
        }, 100);
    }

    getSendSpeed(): number {
        const windowDuration = (Date.now() - (this.byteWindow.timestamps[0] || Date.now())) / 1000 || 1;
        const txTotal = this.byteWindow.tx.reduce((sum, bytes) => sum + bytes, 0);
        return (txTotal * 8) / windowDuration;
    }

    getRecSpeed(): number {
        const windowDuration = (Date.now() - (this.byteWindow.timestamps[0] || Date.now())) / 1000 || 1;
        const rxTotal = this.byteWindow.rx.reduce((sum, bytes) => sum + bytes, 0);
        return (rxTotal * 8) / windowDuration;
    }

    private startProxyServer() {
        this.server = http.createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', () => {
                // Log the request method, URL, headers, and body
                console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
                console.log('Headers:', req.headers);
                console.log('Body:', body);

                // Forward the request to the local port.
                const localReq = http.request({
                    host: 'localhost',
                    port: this.config.localPort,
                    method: req.method,
                    path: req.url,
                    headers: req.headers,
                }, (localRes) => {
                    // Passthrough the headers and status code from the local server.
                    res.writeHead(localRes.statusCode || 200, localRes.headers);
                    localRes.pipe(res); // Pipe the response from the local server to the client.
                });

                // Handle errors on the local request
                localReq.on('error', (err) => {
                    console.error(`Error forwarding to local port ${this.config.localPort}:`, err);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end(`Error forwarding request: ${err.message}`);
                });

                // Send the body of the incoming request to the local server
                localReq.end(body);
            });
        });

        this.server.listen(0, () => { // Listen on a random available port
            const addr = this.server?.address();
            const port = typeof addr === 'string' ? 0 : addr?.port || 0;
            console.log(`Proxy server listening on port ${port}`);
        });
    }

}

const args = require('yargs')
    .option('subdomain', { alias: 's', type: 'string', demandOption: true, array: false, description: 'Subdomain to use' })
    .option('port', { alias: 'p', type: 'number', demandOption: true, array: false, description: 'Local port to forward' })
    .option('server-addr', { type: 'string', description: 'Server address (e.g., easydevfrp.com)' })
    .option('server-port', { type: 'number', default: 7000, description: 'Server port' })
    .option('token', { type: 'string', description: 'Server token' })
    .option('showspeed', { type: 'boolean', default: false, description: 'Show speed stats' })
    .strict()
    .argv;

if (require.main === module) {
    const serverConfig = args.serverAddr && args.token ? {
        serverAddr: args.serverAddr,
        serverPort: args.serverPort,
        token: args.token
    } : undefined;
    const client = new OpenBoreClient({ subdomain: args.subdomain, localPort: args.port }, serverConfig);
    client.on('connected', () => console.log('Client is connected'));
    if (args.showspeed) {
        client.on('speed', (speeds: SpeedStats) => {
            console.info(`Current speed: Upload - ${speeds.tx.toFixed(2)} bps, Download - ${speeds.rx.toFixed(2)} bps`);
        });
    }
    client.start();
}

export default OpenBoreClient;