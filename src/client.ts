import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { platform } from 'os';
import { ServerConfig, ClientConfig, SpeedStats } from './types';

class OpenBoreClient extends EventEmitter {
    private frpcProcess: ChildProcess | null = null;
    private serverConfig: ServerConfig | null = null; // Nullable until start
    private config: ClientConfig;
    private running: boolean = false;
    private byteWindow: { tx: number[]; rx: number[]; timestamps: number[] } = { tx: [], rx: [], timestamps: [] };
    private frpcPath: string;

    constructor(config: ClientConfig, serverConfig?: ServerConfig | string) {
        super();
        this.config = config;

        const plat = platform();
        const frpcName = plat === 'win32' ? 'frpc-win.exe' : plat === 'darwin' ? 'frpc-macos' : 'frpc-linux';
        this.frpcPath = join(__dirname, '..', 'client', frpcName);
        if (!existsSync(this.frpcPath)) {
            this.frpcPath = join(__dirname, '..', 'frpc'); // Dev fallback
        }

        if (typeof serverConfig === 'string') {
            this.serverConfig = this.loadServerConfig(serverConfig);
        } else if (serverConfig) {
            this.serverConfig = serverConfig;
        } else {
            this.serverConfig = this.loadFromEnv() || this.loadServerConfigSafe('./open-bore.ini');
        }

        if (!this.serverConfig) {
            console.log('No server config provided—will use open-bore.ini if present at runtime');
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

        // Ensure serverConfig is loaded or fail gracefully
        if (!this.serverConfig) {
            this.serverConfig = this.loadServerConfigSafe('./open-bore.ini');
            if (!this.serverConfig) {
                console.error('No server config found—please create open-bore.ini or set environment variables');
                return;
            }
        }

        console.log('Starting frpc...');

        // Type assertion safe here—serverConfig is guaranteed non-null
        const configIni = `
[common]
server_addr = ${(this.serverConfig as ServerConfig).serverAddr}
server_port = ${(this.serverConfig as ServerConfig).serverPort}
token = ${(this.serverConfig as ServerConfig).token}
log_level = debug

[${this.config.subdomain}]
type = https
local_port = ${this.config.localPort}
custom_domains = ${this.config.subdomain}.${(this.serverConfig as ServerConfig).serverAddr}
`;
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
}

const args = require('yargs')
    .option('subdomain', { alias: 's', type: 'string', demandOption: true, description: 'Subdomain to use' })
    .option('port', { alias: 'p', type: 'number', default: 3000, description: 'Local port to forward' })
    .option('showspeed', { type: 'boolean', default: false, description: 'Show speed stats' })
    .argv;

if (require.main === module) {
    const client = new OpenBoreClient({ subdomain: args.subdomain, localPort: args.port });
    client.on('connected', () => console.log('Client is connected'));
    if (args.showspeed) {
        client.on('speed', (speeds: SpeedStats) => {
            console.info(`Current speed: Upload - ${speeds.tx.toFixed(2)} bps, Download - ${speeds.rx.toFixed(2)} bps`);
        });
    }
    client.start();
}

export default OpenBoreClient;