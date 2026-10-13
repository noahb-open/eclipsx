const express = require('express')
const app = express()
const http = require('http').Server(app)
const io = require('socket.io')(http)
const path = require('path')
const port = process.env.PORT || 3000

app.use(express.static(path.join(__dirname, "public")))

// Room registry tracking structure mapping: 
// { roomName: { hostSocketId, participants: [ { socketId, peerId, username } ] } }
const activeRooms = {};

io.on('connection', function (socket) {

    // 1. Host Initialises Room Space
    socket.on("HostRoom", function ({ roomName, passcode, username }) {
        if (activeRooms[roomName]) {
            socket.emit("RoomError", "That room name is taken.")
            return
        }

        activeRooms[roomName] = {
            hostSocketId: socket.id, // Explicitly track the room administrator
            participants: []
        }

        socket.roomName = roomName
        socket.username = username
        socket.isHost = true // Flag the socket instance locally
        socket.join(roomName)
        socket.emit("RoomJoined", { isHost: true, roomName })
    })

    // 2. Guest Joins Room Mesh
    socket.on("JoinRoom", function ({ roomName, passcode, username }) {
        if (!activeRooms[roomName]) {
            socket.emit("RoomError", "Room not found.")
            return
        }

        // ENFORCE MAX 4 PARTICIPANTS LIMIT (1 Host + 3 Guests max)
        if (activeRooms[roomName].participants.length >= 3) { 
            socket.emit("RoomError", "This room is full (Maximum 4 users allowed).")
            return
        }

        socket.roomName = roomName
        socket.username = username
        socket.isHost = false
        socket.join(roomName)
        socket.emit("RoomJoined", { isHost: false, roomName })
    })

    // 3. Client Local Peer Engine is Configured and Ready
    socket.on('ReadyToConnect', function ({ peerId, roomName }) {
        const room = activeRooms[roomName]
        if (!room) return

        // Compile a baseline roster of everyone already sitting inside the channel mesh
        const existingPeers = room.participants.map(user => ({
            peerId: user.peerId,
            username: user.username,
            socketId: user.socketId
        }))

        // Commit this socket record to the live room registry array
        room.participants.push({
            socketId: socket.id,
            peerId: peerId,
            username: socket.username
        })

        // Hand the list down to the newcomer node
        socket.emit('MeshRoomRoster', { 
            existingPeers,
            isHost: socket.isHost 
        })

        // Alert everyone else already in the mesh that a newcomer entered
        socket.to(roomName).emit('NewPeerJoinedMesh', { 
            peerId: peerId, 
            username: socket.username, 
            socketId: socket.id 
        })
    })

    // 4. Host Admin Command: Force-eject a participant
    socket.on('KickParticipant', function ({ targetSocketId }) {
        const room = activeRooms[socket.roomName]
        
        // Security Verification: Ensure only the valid host can execute this trigger
        if (room && socket.id === room.hostSocketId) {
            const targetSocket = io.sockets.connected[targetSocketId]
            if (targetSocket) {
                targetSocket.emit('YouHaveBeenKicked') // Direct signal targeting the rulebreaker
                targetSocket.leave(socket.roomName)   // Evict from socket room stream
                handleUserRemoval(targetSocket)       // Trigger regular mesh disconnection logic
            }
        }
    })

    // 5. Clean Disconnection Catcher Handlers
    socket.on('disconnectRoom', function() {
        handleUserRemoval(socket)
    })

    socket.on('disconnect', function () {
        handleUserRemoval(socket)
    })
})

// Centralized mesh teardown and memory cleanup utility
function handleUserRemoval(socket) {
    if (socket.roomName && activeRooms[socket.roomName]) {
        const room = activeRooms[socket.roomName]
        
        // Remove target user array footprint entry smoothly
        room.participants = room.participants.filter(user => user.socketId !== socket.id)

        // Broadcast cleanup command layout signals out across the remaining mesh nodes
        socket.to(socket.roomName).emit("PeerDisconnectedFromMesh", { socketId: socket.id })

        // Administrative Rule: If the Host leaves, close down the entire session space
        if (socket.id === room.hostSocketId) {
            socket.to(socket.roomName).emit("HostClosedRoom")
            delete activeRooms[socket.roomName]
        } else if (room.participants.length === 0) {
            delete activeRooms[socket.roomName]
        }
        
        socket.leave(socket.roomName)
        socket.roomName = null
    }
}

// Fallback version lookups compatibility mapper for varying Socket.IO versions
if (!io.sockets.connected) {
    Object.defineProperty(io.sockets, 'connected', {
        get: function() { return io.of("/").sockets; }
    });
}

http.listen(port, () => console.log(`ECLIPSX Multi-room Engine running on port ${port}`))
