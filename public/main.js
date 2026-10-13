const socket = io()
let myUsername = ""
let activeRoom = ""
let localStreamData = null
let myPeerInstance = null
let iAmTheHost = false // Local administrative authority state flag

// Mesh architecture collection maps tracking active connections dynamically
const activePeerCalls = {}       // Stores: { socketId: MediaConnection }
const activePeerConnections = {} // Stores: { socketId: DataConnection }

// Hardware Mute State Toggles
let isAudioMuted = false
let isVideoHidden = false

// View Nodes
const viewAuth = document.querySelector('#view-auth')
const viewDashboard = document.querySelector('#view-dashboard')
const viewChat = document.querySelector('#view-chat')

// Active Elements
const videoLocal = document.querySelector('#localVideo')
const selectFilter = document.querySelector('#filter')
const errorText = document.querySelector('#error-message')

// Action Elements
const btnMute = document.querySelector('#btn-toggle-mute')
const btnVideo = document.querySelector('#btn-toggle-video')
const btnLeave = document.querySelector('#btn-leave-room')

// Initialize user media tracks on startup loading loops
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(stream => {
        localStreamData = stream
        videoLocal.srcObject = stream
    })
    .catch(err => {
        console.error("Camera initialization failed:", err)
        alert("Could not access camera/microphone. Check permissions and close active apps.")
    })

// Step 1: Name Form submission
document.querySelector('#btn-next').addEventListener('click', (e) => {
    e.preventDefault();
    const nameInput = document.querySelector('#input-username').value.trim()
    if(nameInput) {
        myUsername = nameInput
        document.querySelector('#display-user').textContent = myUsername
        switchView(viewDashboard)
    } else {
        alert("Please enter your name.")
    }
})

// Tab Navigation Toggles
document.querySelector('#tab-host').addEventListener('click', (e) => toggleTabs(e.target, '#panel-host'))
document.querySelector('#tab-join').addEventListener('click', (e) => toggleTabs(e.target, '#panel-join'))

// Create Room Action Form Router
document.querySelector('#btn-host-launch').addEventListener('click', () => {
    const roomName = document.querySelector('#host-room').value.trim()
    const passcode = document.querySelector('#host-pass').value.trim()
    if(roomName && passcode) {
        socket.emit("HostRoom", { roomName, passcode, username: myUsername })
    } else {
        if (errorText) errorText.textContent = "Please fill in all fields."
    }
})

// Join Room Action Form Router
document.querySelector('#btn-join-launch').addEventListener('click', () => {
    const roomName = document.querySelector('#join-room').value.trim()
    const passcode = document.querySelector('#join-pass').value.trim()
    if(roomName && passcode) {
        socket.emit("JoinRoom", { roomName, passcode, username: myUsername })
    } else {
        if (errorText) errorText.textContent = "Please fill in all fields."
    }
})

socket.on("RoomError", (err) => {
    if (errorText) errorText.textContent = err
})

socket.on("RoomJoined", ({ isHost, roomName }) => {
    activeRoom = roomName
    document.querySelector('#current-room-text').textContent = roomName
    if (errorText) errorText.textContent = ""
    
    switchView(viewChat)

    if (localStreamData) {
        initializeMeshCallingTopology(localStreamData)
    } else {
        alert("Camera stream was not ready. Please refresh.")
    }
})

function initializeMeshCallingTopology(stream) {
    // Globally sync any drop-down image manipulation across all active connections
    selectFilter.addEventListener('change', (event) => {
        let filterVal = event.target.value
        videoLocal.style.filter = filterVal
        Object.values(activePeerConnections).forEach(conn => {
            if (conn.open) conn.send(filterVal)
        })
    })

    // Bootstraps our local browser standalone PeerJS network instance
    myPeerInstance = new window.Peer(null, { debug: 1 })

    myPeerInstance.on('open', (id) => {
        socket.emit('ReadyToConnect', { peerId: id, roomName: activeRoom })
    })

    // Handle inbound incoming calls coming from newcomers entering after us
    myPeerInstance.on('call', (call) => {
        call.answer(stream)
        
        // Destructures matching socket information stored safely inside the inbound call configuration options metadata field
        const metadata = call.metadata || {}
        handleIncomingRemoteMeshStream(call, metadata.socketId, metadata.username || "Friend")
    })

    // Handle incoming data channel links meant for tracking visual canvas filters
    myPeerInstance.on('connection', (conn) => {
        const metadata = conn.metadata || {}
        activePeerConnections[metadata.socketId] = conn
        setupMeshDataConnectionListeners(conn, metadata.socketId)
    })
}

// Fired within a newcomer browser session when pulling down the structural layout roster
socket.on('MeshRoomRoster', ({ existingPeers, isHost }) => {
    iAmTheHost = isHost // Assign administrative level flags locally

    existingPeers.forEach(peerNode => {
        // Construct and dispatch a direct video stream call tracking our identity metrics
        const call = myPeerInstance.call(peerNode.peerId, localStreamData, {
            metadata: { socketId: socket.id, username: myUsername }
        })
        handleIncomingRemoteMeshStream(call, peerNode.socketId, peerNode.username)

        // Pair the above pipeline with a raw data channel socket pipeline connection link
        const conn = myPeerInstance.connect(peerNode.peerId, {
            metadata: { socketId: socket.id }
        })
        activePeerConnections[peerNode.socketId] = conn
        setupMeshDataConnectionListeners(conn, peerNode.socketId)
    })
})

socket.on('NewPeerJoinedMesh', ({ peerId, username, socketId }) => {
    console.log(`${username} joined call mesh connections...`)
})

function handleIncomingRemoteMeshStream(call, remoteSocketId, remoteUsername) {
    activePeerCalls[remoteSocketId] = call

    call.on('stream', (remoteStream) => {
        // Enforces structural integrity layout locks to block duplicates
        if (document.getElementById(`wrapper-${remoteSocketId}`)) return

        const videoGrid = document.querySelector('#peerDiv')

        // Assemble an elegant, nested container matching your CSS layout guidelines rules
        let container = document.createElement('div')
        container.setAttribute('class', 'video-wrapper')
        container.id = `wrapper-${remoteSocketId}`

        let remoteLabel = document.createElement('span')
        remoteLabel.setAttribute('class', 'video-label')
        remoteLabel.textContent = remoteUsername

        // If I am verified as the room host, render administrative kick actions overrides
        if (iAmTheHost) {
            let kickBtn = document.createElement('button')
            kickBtn.textContent = "Kick"
            kickBtn.setAttribute('style', 'position: absolute; top: 10px; right: 10px; z-index: 10; background: #ef4444; color: #fff; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 0.85rem;')
            
            kickBtn.addEventListener('click', () => {
                if (confirm(`Are you sure you want to disconnect ${remoteUsername}?`)) {
                    socket.emit('KickParticipant', { targetSocketId: remoteSocketId })
                }
            })
            container.appendChild(kickBtn)
        }

        let videoRemote = document.createElement('video')
        videoRemote.id = `video-${remoteSocketId}`
        videoRemote.srcObject = remoteStream
        videoRemote.autoplay = true
        videoRemote.playsInline = true

        container.appendChild(remoteLabel)
        container.appendChild(videoRemote)
        videoGrid.appendChild(container)
    })
}

function setupMeshDataConnectionListeners(conn, remoteSocketId) {
    conn.on('data', (filterData) => {
        let peerVideoElement = document.getElementById(`video-${remoteSocketId}`)
        if (peerVideoElement) {
            peerVideoElement.style.filter = filterData
        }
    })
}

// TOGGLE BUTTON INTERACTION EVENT LOOPS
btnMute.addEventListener('click', () => {
    if (localStreamData) {
        isAudioMuted = !isAudioMuted
        localStreamData.getAudioTracks().forEach(track => track.enabled = !isAudioMuted)
        btnMute.textContent = isAudioMuted ? "Unmute Mic" : "Mute Mic"
        btnMute.classList.toggle('active', isAudioMuted)
    }
})

btnVideo.addEventListener('click', () => {
    if (localStreamData) {
        isVideoHidden = !isVideoHidden
        localStreamData.getVideoTracks().forEach(track => track.enabled = !isVideoHidden)
        btnVideo.textContent = isVideoHidden ? "Show Video" : "Hide Video"
        btnVideo.classList.toggle('active', isVideoHidden)
    }
})

btnLeave.addEventListener('click', () => {
    socket.emit('disconnectRoom')
    executeEclipsxTeardown()
})

socket.on('PeerDisconnectedFromMesh', ({ socketId }) => {
    removeSinglePeerFromMeshDisplay(socketId)
})

// Administrative Signal Catchers
socket.on('YouHaveBeenKicked', () => {
    alert("You have been disconnected from the call by the room host.")
    executeEclipsxTeardown()
})

socket.on('HostClosedRoom', () => {
    alert("The host has ended this room call session.")
    executeEclipsxTeardown()
})

function removeSinglePeerFromMeshDisplay(socketId) {
    const remoteWrapper = document.getElementById(`wrapper-${socketId}`)
    if (remoteWrapper) remoteWrapper.remove()

    if (activePeerCalls[socketId]) {
        activePeerCalls[socketId].close()
        delete activePeerCalls[socketId]
    }
    if (activePeerConnections[socketId]) {
        activePeerConnections[socketId].close()
        delete activePeerConnections[socketId]
    }
}

function executeEclipsxTeardown() {
    // 1. Terminate all active data links safely in memory loop hooks
    Object.keys(activePeerCalls).forEach(socketId => {
        removeSinglePeerFromMeshDisplay(socketId)
    })
    
    // 2. Clear out core local network configurations footprints completely
    if (myPeerInstance) {
        myPeerInstance.destroy()
        myPeerInstance = null
    }
    
    activeRoom = ""
    iAmTheHost = false // Clear authority levels
    document.querySelector('#host-room').value = ""
    document.querySelector('#host-pass').value = ""
    document.querySelector('#join-room').value = ""
    document.querySelector('#join-pass').value = ""
    
    switchView(viewDashboard)
}
function switchView(targetView) {
    if(!viewAuth || !viewDashboard || !viewChat) return;
    [viewAuth, viewDashboard, viewChat].forEach(v => v.classList.remove('active'))
    targetView.classList.add('active')
}

function toggleTabs(activeTabButton, activePanelSelector) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'))
    document.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'))
    activeTabButton.classList.add('active')
    document.querySelector(activePanelSelector).classList.add('active')
}
