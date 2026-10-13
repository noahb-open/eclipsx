const express = require('express')
const app = express()
const http = require('http').Server(app)
const io = require('socket.io')(http)
const port = process.env.PORT || 3000

// Serve static assets out of the public assets directory
app.use(express.static(__dirname + "/public"))

// Track active user counts per specific room code: Map<roomName, count>
const roomClients = new Map()

io.on('connection', function (socket) {
    let currentRoom = null

    // Triggered when a user joins the lobby screen and picks or hosts a room
    socket.on("NewClient", function (roomName) {
        const room = roomName || 'default'
        currentRoom = room

        // Calculate how many users are currently sitting inside this specific room space
        let clientsInRoom = roomClients.get(room) || 0

        // Enforce maximum 1-to-1 capability restrictions per room
        if (clientsInRoom < 2) {
            socket.join(room)
            clientsInRoom++
            roomClients.set(room, clientsInRoom)

            // If this is the second client to arrive, signal them to kick off the peer connection
            if (clientsInRoom === 2) {
                socket.emit('CreatePeer') 
            }
        } else {
            // Kick the user back to the lobby if the 2-person slot is already occupied
            socket.emit('SessionActive')
        }
    })

    // Relay the WebRTC SDP connection Offer ONLY to the other peer inside the exact same room
    socket.on('Offer', function (offer) {
        if (currentRoom) {
            socket.to(currentRoom).emit("BackOffer", offer)
        }
    })

    // Relay the WebRTC SDP connection Answer ONLY to the other peer inside the exact same room
    socket.on('Answer', function (data) {
        if (currentRoom) {
            socket.to(currentRoom).emit("BackAnswer", data)
        }
    })

    // Handle abrupt user disconnects or window close events gracefully
    socket.on('disconnect', function () {
        if (currentRoom) {
            let clientsInRoom = roomClients.get(currentRoom) || 0
            if (clientsInRoom > 0) {
                // Alert the remaining room participant that their teammate left, forcing a layout teardown
                socket.to(currentRoom).emit("Disconnect")
                clientsInRoom--
                
                // Clear out room memory entirely if it's completely empty
                if (clientsInRoom === 0) {
                    roomClients.delete(currentRoom) 
                } else {
                    roomClients.set(currentRoom, clientsInRoom)
                }
            }
        }
    })
})

// Fire up server interface pipelines
http.listen(port, () => console.log(`🌌 Eclipsx Satellite Active on port ${port}`))
