import OpenBoreClient from './src/client';

const client = new OpenBoreClient({ subdomain: 'ryan', localPort: 3000 });
client.on('connected', (connection) => {
    console.info('Client is connected');
    client.on('speed', (speeds) => {
        console.info(`Speed: Upload - ${speeds.tx.toFixed(2)} bps, Download - ${speeds.rx.toFixed(2)} bps`);
    });
});
client.start();