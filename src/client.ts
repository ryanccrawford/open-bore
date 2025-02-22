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
    private txBytes: number = 0;
    private rxBytes: number = 0;
    private lastCheck: number = Date.now();

    constructor(config: ClientConfig, serverConfigPath: string = './open-bore.ini') {
        super();
        this.config = config;
        this.serverConfig = this.loadServerConfig(serverConfigPath);
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
        this.rxBytes += data.length;

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
            this.rxBytes += data.length;
            if (this.localSocket) this.localSocket.write(data);
        });
        this.proxySocket.on('error', (err) => console.error(`Proxy socket error: ${err.message}`));
        this.proxySocket.on('close', () => this.cleanup());

        this.localSocket = connect(this.config.localPort, '127.0.0.1', () => {
            console.log(`Local connection to ${this.config.localPort} established`);
        });
        this.localSocket.on('data', (data) => {
            this.txBytes += data.length;
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

    private monitorSpeeds() {
        setInterval(() => {
            const now = Date.now();
            const elapsed = (now - this.lastCheck) / 1000;
            const txSpeed = (this.txBytes * 8) / elapsed; // Bits/sec
            const rxSpeed = (this.rxBytes * 8) / elapsed; // Bits/sec
            this.emit('speed', { tx: txSpeed, rx: rxSpeed });
            this.txBytes = 0;
            this.rxBytes = 0;
            this.lastCheck = now;
        }, 5000);
    }

    getSendSpeed(): number {
        return this.txBytes * 8; // Bits for last interval
    }

    getRecSpeed(): number {
        return this.rxBytes * 8; // Bits for last interval
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