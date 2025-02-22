import { EventEmitter } from 'events';
import { Socket, connect } from 'net';
import { readFileSync } from 'fs';
import { ServerConfig, ClientConfig, SpeedStats } from './types';

class OpenBoreClient extends EventEmitter {
    private controlSocket: Socket | null = null;
    private proxySocket: Socket | null = null;
    private localSocket: Socket | null = null;
    private serverConfig: ServerConfig;
    private config: ClientConfig;
    private running: boolean = false;
    private byteWindow: { tx: number[]; rx: number[]; timestamps: number[] } = { tx: [], rx: [], timestamps: [] };

    constructor(config: ClientConfig, serverConfig?: ServerConfig | string) {
        super();
        this.config = config;
        if (typeof serverConfig === 'string') {
            this.serverConfig = this.loadServerConfig(serverConfig);
        } else if (serverConfig) {
            this.serverConfig = serverConfig;
        } else {
            // Try .env first, then fall back to open-bore.ini
            this.serverConfig = this.loadFromEnv() || this.loadServerConfig('./open-bore.ini');
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
        try {
            const configData = readFileSync(path, 'utf-8');
            const parsed = require('ini').parse(configData).common;
            return {
                serverAddr: parsed.server_addr,
                serverPort: parsed.server_port,
                token: parsed.token,
            };
        } catch (e: any) {
            throw new Error(`Failed to load server config from ${path}: ${e.message}`);
        }
    }

    start() {
        if (this.running) return;
        this.connectControl();
    }

    private connectControl() {
        this.controlSocket = connect(this.serverConfig.serverPort, this.serverConfig.serverAddr, () => {
            console.log('Connected to server');
            this.sendLogin();
        });

        this.controlSocket.on('data', (data) => this.handleControlData(data));
        this.controlSocket.on('error', (err) => {
            console.error(`Control socket error: ${err.message}`);
            this.reconnect();
        });
        this.controlSocket.on('close', () => {
            console.log('Control socket closed');
            this.cleanup();
        });

        this.monitorSpeeds();
    }

    private sendLogin() {
        const loginMsg = {
            type: 'Login',
            version: '0.58.0',
            hostname: this.serverConfig.serverAddr,
            os: process.platform,
            arch: process.arch,
            user: '',
            privilegeKey: '',
            timestamp: Math.floor(Date.now() / 1000),
            runId: '',
            poolCount: 1,
            token: this.serverConfig.token,
        };
        this.controlSocket?.write(JSON.stringify(loginMsg) + '\n');
    }

    private handleControlData(data: Buffer) {
        const msg = JSON.parse(data.toString().trim());
        this.updateByteWindow(data.length, 0);

        if (msg.type === 'LoginResp' && msg.content.error === '') {
            console.log('Login successful');
            this.running = true;
            this.emit('connected', this);
            this.registerProxy();
        } else if (msg.type === 'NewProxyResp') {
            this.startProxy(msg.content.proxyId);
        }
    }

    private registerProxy() {
        const proxyMsg = {
            type: 'NewProxy',
            proxyName: this.config.subdomain,
            proxyType: 'https',
            remotePort: 443,
            customDomains: [`${this.config.subdomain}.${this.serverConfig.serverAddr}`],
        };
        this.controlSocket?.write(JSON.stringify(proxyMsg) + '\n');
    }

    private startProxy(proxyId: string) {
        this.proxySocket = connect(this.serverConfig.serverPort, this.serverConfig.serverAddr, () => {
            console.log(`Proxy ${this.config.subdomain} connected`);
            this.sendWorkConn(proxyId);
        });

        this.proxySocket.on('data', (data) => {
            this.updateByteWindow(data.length, 0);
            if (this.localSocket) this.localSocket.write(data);
        });
        this.proxySocket.on('error', (err) => console.error(`Proxy socket error: ${err.message}`));
        this.proxySocket.on('close', () => this.cleanup());

        this.localSocket = connect(this.config.localPort, '127.0.0.1', () => {
            console.log(`Local connection to ${this.config.localPort} established`);
        });
        this.localSocket.on('data', (data) => {
            this.updateByteWindow(0, data.length);
            if (this.proxySocket) this.proxySocket.write(data);
        });
        this.localSocket.on('error', (err) => console.error(`Local socket error: ${err.message}`));
        this.localSocket.on('close', () => this.cleanup());
    }

    private sendWorkConn(proxyId: string) {
        const workConnMsg = {
            type: 'NewWorkConn',
            runId: '',
            proxyId: proxyId,
        };
        this.proxySocket?.write(JSON.stringify(workConnMsg) + '\n');
    }

    stop() {
        if (this.controlSocket) {
            this.controlSocket.end();
            this.controlSocket = null;
        }
        if (this.proxySocket) {
            this.proxySocket.end();
            this.proxySocket = null;
        }
        if (this.localSocket) {
            this.localSocket.end();
            this.localSocket = null;
        }
        this.running = false;
    }

    private cleanup() {
        this.stop();
        this.emit('disconnected');
        this.reconnect();
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
            const txSpeed = (txTotal * 8) / windowDuration; // Bits/sec
            const rxSpeed = (rxTotal * 8) / windowDuration; // Bits/sec
            this.emit('speed', { tx: txSpeed, rx: rxSpeed });
        }, 100);
    }

    getSendSpeed(): number {
        const windowDuration = (Date.now() - (this.byteWindow.timestamps[0] || Date.now())) / 1000 || 1;
        const txTotal = this.byteWindow.tx.reduce((sum, bytes) => sum + bytes, 0);
        return (txTotal * 8) / windowDuration; // Bits/sec
    }

    getRecSpeed(): number {
        const windowDuration = (Date.now() - (this.byteWindow.timestamps[0] || Date.now())) / 1000 || 1;
        const rxTotal = this.byteWindow.rx.reduce((sum, bytes) => sum + bytes, 0);
        return (rxTotal * 8) / windowDuration; // Bits/sec
    }
}

// CLI Usage
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