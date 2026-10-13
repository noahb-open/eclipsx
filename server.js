const express = require('express');
const app = express();

// Global HTTPS Redirect for Railway environments
app.enable('trust proxy');
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(`https://${req.headers.host}${req.url}`);
  }
  next();
});

const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*" }
});
const path = require('path');
const mediasoup = require('mediasoup');

const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

let worker;
const rooms = {}; 
let publicIp = '127.0.0.1'; // Internal fallback

const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: { 'x-google-start-bitrate': 1000 }
  }
];

// Resolves the host container's actual unproxied external internet IPv4 address
async function fetchPublicIp() {
  return new Promise((resolve) => {
    const options = { hostname: 'api.ipify.org', port: 80, path: '/?format=text', method: 'GET' };
    const req = require('http').request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data.trim()));
    });
    req.on('error', () => resolve('127.0.0.1'));
    req.end();
  });
}

(async () => {
  try {
    publicIp = await fetchPublicIp();
    console.log(`WebRTC Media Routing configured. Target public IPv4: ${publicIp}`);

    worker = await mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: 20000,
      rtcMaxPort: 20100,
    });
    
    worker.on('died', () => {
      process.exit(1);
    });
    
    console.log(`Mediasoup native worker process spawned successfully.`);
  } catch (err) {
    console.error('Failed to spawn mediasoup worker:', err);
    process.exit(1);
  }
})();

io.on('connection', (socket) => {
  socket.on('joinRoom', async ({ roomName }, callback) => {
    socket.join(roomName);
    socket.roomName = roomName;

    if (!rooms[roomName]) {
      const router = await worker.createRouter({ mediaCodecs });
      rooms[roomName] = { router, peers: {} };
    }

    rooms[roomName].peers[socket.id] = { transports: [], producers: [], consumers: [] };
    callback({ rtpCapabilities: rooms[roomName].router.rtpCapabilities });
  });

  socket.on('createWebRtcTransport', async (_, callback) => {
    const roomName = socket.roomName;
    if (!roomName || !rooms[roomName]) return callback({ error: 'Room context has dropped.' });
    
    const router = rooms[roomName].router;

    try {
      // Force direct UDP media routing to bypass proxy layers
      const transport = await router.createWebRtcTransport({
        listenInfos: [
          {
            protocol: 'udp',
            ip: '0.0.0.0', 
            announcedAddress: publicIp, // Mandate direct public IP traversal
          }
        ],
        enableUdp: true,
        enableTcp: false, // Turn off TCP proxy fallback entirely to avoid traffic drops
      });

      rooms[roomName].peers[socket.id].transports.push(transport);

      callback({
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        }
      });

      transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') transport.close();
      });
    } catch (err) {
      console.error('Failed to instantiate WebRtcTransport infrastructure layer:', err);
      callback({ error: err.message });
    }
  });

  socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
    const transport = findTransport(socket.roomName, socket.id, transportId);
    if (transport) {
      await transport.connect({ dtlsParameters });
      callback();
    }
  });

  socket.on('produce', async ({ transportId, kind, rtpParameters }, callback) => {
    const transport = findTransport(socket.roomName, socket.id, transportId);
    if (!transport) return callback({ error: 'Uplink transport dropped.' });

    const producer = await transport.produce({ kind, rtpParameters });
    rooms[socket.roomName].peers[socket.id].producers.push(producer);

    socket.to(socket.roomName).emit('newProducerAvailable', { 
      producerId: producer.id, 
      producerSocketId: socket.id, 
      kind 
    });

    callback({ id: producer.id });
  });

  socket.on('consume', async ({ transportId, producerId, rtpCapabilities }, callback) => {
    const roomName = socket.roomName;
    if (!roomName || !rooms[roomName]) return callback({ error: 'Call room context dropped.' });

    const router = rooms[roomName].router;

    if (router.canConsume({ producerId, rtpCapabilities })) {
      const transport = findTransport(roomName, socket.id, transportId);
      if (!transport) return callback({ error: 'Receiver transport tunnel dropped.' });

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });

      rooms[roomName].peers[socket.id].consumers.push(consumer);

      callback({
        params: {
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        }
      });
    }
  });

  socket.on('resumeConsumer', async ({ consumerId }) => {
    const peerIndex = rooms[socket.roomName]?.peers[socket.id];
    const consumer = peerIndex?.consumers.find(c => c.id === consumerId);
    if (consumer) {
      await consumer.resume();
    }
  });

  socket.on('getExistingProducers', (callback) => {
    const roomName = socket.roomName;
    const producerList = [];

    if (roomName && rooms[roomName]) {
      Object.keys(rooms[roomName].peers).forEach(peerSocketId => {
        if (peerSocketId === socket.id) return;
        rooms[roomName].peers[peerSocketId].producers.forEach(p => {
          producerList.push({ producerId: p.id, producerSocketId: peerSocketId, kind: p.kind });
        });
      });
    }

    callback({ producerList });
  });

  socket.on('disconnect', () => {
    handlePeerTeardown(socket.roomName, socket.id);
  });
});

function findTransport(roomName, socketId, transportId) {
  return rooms[roomName]?.peers[socketId]?.transports.find(t => t.id === transportId);
}

function handlePeerTeardown(roomName, socketId) {
  if (!roomName || !rooms[roomName] || !rooms[roomName].peers[socketId]) return;

  const peer = rooms[roomName].peers[socketId];
  peer.producers.forEach(p => p.close());
  peer.consumers.forEach(c => c.close());
  peer.transports.forEach(t => t.close());

  delete rooms[roomName].peers[socketId];
  io.to(roomName).emit('peerLeftMesh', { socketId });

  if (Object.keys(rooms[roomName].peers).length === 0) {
    delete rooms[roomName];
  }
}

http.listen(port, () => console.log(`SFU Mediasoup Server active pipeline running on port ${port}`));
