const express = require('express')
const app = express()
const http = require('http').Server(app)
const io = require('socket.io')(http)
const path = require('path')
const port = process.env.PORT || 3000

app.use(express.static(path.join(__dirname, "public")))

const activeRooms = {};

io.on('connection', function (socket) {

    socket.on("HostRoom", function ({ roomName, passcode, username }) {
        if (activeRooms[roomName]) {
            socket.emit("RoomError", "That room name is taken.")
            return
        }

        activeRooms[roomName] = {
            passcode: passcode,
            hostSocketId: socket.id,
            peerId: null, // Populated during initialization
            clients: 1
        }

        socket.roomName = roomName
        socket.username = username
        socket.join(roomName)
        socket.emit("RoomJoined", { isHost: true, roomName })
    })

    socket.on("JoinRoom", function ({ roomName, passcode, username }) {
        const roomData = activeRooms[roomName]

        if (!roomData) {
            socket.emit("RoomError", "Room not found.")
            return
        }
        if (roomData.clients >= 2) {
            socket.emit("RoomError", "This room is full.")
            return
        }
        if (roomData.passcode !== passcode) {
            socket.emit("RoomError", "Wrong code.")
            return
        }

        roomData.clients++
        socket.roomName = roomName
        socket.username = username
        socket.join(roomName)
        socket.emit("RoomJoined", { isHost: false, roomName })
    })

    // Bridge connection routing IDs safely between clients
    socket.on('ReadyToConnect', function ({ peerId, roomName }) {
        const roomData = activeRooms[roomName]
        if (!roomData) return

        if (socket.id === roomData.hostSocketId) {
            roomData.peerId = peerId
        } else {
            // If the joiner is ready, tell them to call the host's direct link ID
            if (roomData.peerId) {
                socket.emit('ConnectWithPeer', { targetPeerId: roomData.peerId })
            }
        }
    })

    socket.on('disconnect', function () {
        if (socket.roomName) {
            socket.to(socket.roomName).emit("Disconnect")
            const roomData = activeRooms[socket.roomName]
            if (roomData) {
                roomData.clients--
                if (roomData.clients <= 0) delete activeRooms[socket.roomName]
            }
            socket.leave(socket.roomName)
        }
    })
})

http.listen(port, () => console.log(`ECLIPSX app running on port ${port}`))

