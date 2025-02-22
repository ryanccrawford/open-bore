export interface ServerConfig {
    serverAddr: string;
    serverPort: number;
    token: string;
}

export interface ClientConfig {
    subdomain: string;
    localPort: number;
}

export interface SpeedStats {
    tx: number; // Bytes/sec
    rx: number; // Bytes/sec
}