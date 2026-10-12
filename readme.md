# WebRTC Video Chat - Learning Boilerplate

A simple, well-commented WebRTC implementation for learning peer-to-peer video communication. This project demonstrates the core concepts of WebRTC signaling, media streaming, and real-time data exchange in under 200 lines of code.

## What You'll Learn

- **WebRTC Fundamentals**: How peer-to-peer connections work
- **Signaling Process**: SDP offer/answer exchange and ICE candidates
- **Media Streaming**: Camera/microphone access and video element handling  
- **Data Channels**: Real-time communication beyond audio/video
- **Socket.IO Integration**: Using WebSockets for signaling server
- **NAT Traversal**: How STUN servers enable connections across networks

## Technology Stack

**Backend**
- Node.js + Express - Minimal web server
- Socket.IO - WebSocket signaling server

**Frontend** 
- WebRTC APIs - Built-in browser peer-to-peer capabilities
- simple-peer - Simplified WebRTC wrapper library
- Vanilla JavaScript - No complex frameworks needed

## How WebRTC Works (Simplified)

1. **Media Capture**: `getUserMedia()` accesses camera/microphone
2. **Signaling**: Socket.IO exchanges connection info between peers  
3. **Peer Connection**: `RTCPeerConnection` establishes direct P2P link
4. **Media Exchange**: Video/audio streams flow directly between browsers
5. **Data Channels**: Send messages/data without going through server

## Quick Start

```bash
npm install
npm start
```

Open `localhost:3000` in two browser tabs to see it work.

## Code Walkthrough

### Server (`server.js`)
- Serves static files and handles Socket.IO connections
- Manages room state (max 2 users)
- Relays signaling messages between peers

```javascript
// Key concept: Server only handles signaling, not media
socket.on('Offer', (offer) => socket.broadcast.emit('BackOffer', offer))
socket.on('Answer', (answer) => socket.broadcast.emit('BackAnswer', answer))
```

### Client (`public/main.js`)

**1. Get User Media**
```javascript
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
```

**2. Create Peer Connection**
```javascript
let peer = new Peer({ 
    initiator: true,    // One peer initiates
    stream: stream,     // Local video/audio
    trickle: false      // Wait for all ICE candidates
})
```

**3. Handle Signaling**
```javascript
peer.on('signal', (data) => socket.emit('Offer', data))  // Send SDP
peer.signal(offer)                                       // Process SDP
```

**4. Receive Remote Stream**
```javascript
peer.on('stream', (remoteStream) => {
    remoteVideo.srcObject = remoteStream  // Display peer's video
})
```

## Key Learning Points

### Signaling vs Media
- **Signaling**: Coordination messages go through your server
- **Media**: Video/audio streams flow directly peer-to-peer

### ICE and NAT Traversal  
- Most users are behind firewalls/NAT
- STUN servers help discover public IP addresses
- simple-peer handles this complexity for you

### Data Channels
- Send any data directly between peers
- This demo syncs video filters in real-time
- Lower latency than WebSockets for peer communication

## Extending This Project

**Beginner Ideas:**
- Add text chat using data channels
- Implement screen sharing
- Add more video filters

**Intermediate Ideas:**  
- Support more than 2 users (mesh network)
- Add recording functionality
- Implement file transfer

**Advanced Ideas:**
- Add TURN server for better connectivity
- Implement selective forwarding unit (SFU)
- Add end-to-end encryption

## Project Structure

```
├── server.js           # Signaling server (Socket.IO)
├── public/
│   ├── index.html     # UI with video elements  
│   ├── main.js        # WebRTC client logic
│   ├── main.css       # Styles and video effects
│   └── bundle.js      # Browserified output
```

## Browser Requirements

- Chrome 23+, Firefox 22+, Safari 11+
- HTTPS required for production (getUserMedia restriction)
- Camera/microphone permissions needed

## Live Demo

https://hash-stream.herokuapp.com/

Open in two tabs or share with a friend to test peer-to-peer connection!

## License

MIT License - see [LICENSE](LICENSE) file for details. Feel free to use this code for learning, teaching, or building your own WebRTC applications.





