const socket = io()
let myUsername = ""
let activeRoom = ""
let localStreamData = null
let currentPeerConnection = null
let myPeerInstance = null

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
        initializePeerJSConnection(localStreamData)
    } else {
        alert("Camera stream was not ready. Please refresh.")
    }
})

function initializePeerJSConnection(stream) {
    selectFilter.addEventListener('change', (event) => {
        let filterVal = event.target.value
        videoLocal.style.filter = filterVal
        if (currentPeerConnection && currentPeerConnection.dataConnection) {
            currentPeerConnection.dataConnection.send(filterVal)
        }
    })

    myPeerInstance = new window.Peer(null, { debug: 1 })

    myPeerInstance.on('open', (id) => {
        socket.emit('ReadyToConnect', { peerId: id, roomName: activeRoom })
    })

    myPeerInstance.on('call', (call) => {
        call.answer(stream)
        handleRemoteStream(call)
    })

    myPeerInstance.on('connection', (conn) => {
        if (!currentPeerConnection) currentPeerConnection = {}
        currentPeerConnection.dataConnection = conn
        setupDataListener(conn)
    })

    socket.on('ConnectWithPeer', ({ targetPeerId }) => {
        const call = myPeerInstance.call(targetPeerId, stream)
        handleRemoteStream(call)

        const conn = myPeerInstance.connect(targetPeerId)
        if (!currentPeerConnection) currentPeerConnection = {}
        currentPeerConnection.dataConnection = conn
        setupDataListener(conn)
    })
}

function handleRemoteStream(call) {
    if (!currentPeerConnection) currentPeerConnection = {}
    currentPeerConnection.mediaCall = call

    call.on('stream', (remoteStream) => {
        if (document.querySelector('#peerVideo')) return

        let container = document.createElement('div')
        container.setAttribute('class', 'video-wrapper')
        container.id = 'remote-wrapper'

        let remoteLabel = document.createElement('span')
        remoteLabel.setAttribute('class', 'video-label')
        remoteLabel.textContent = "Friend"

        let videoRemote = document.createElement('video')
        videoRemote.id = 'peerVideo'
        videoRemote.srcObject = remoteStream
        videoRemote.autoplay = true
        videoRemote.playsInline = true

        container.appendChild(remoteLabel)
        container.appendChild(videoRemote)
        document.querySelector('#peerDiv').appendChild(container)
    })
}

function setupDataListener(conn) {
    conn.on('data', (data) => {
        let peervideo = document.querySelector('#peerVideo')
        if(peervideo) peervideo.style.filter = data
    })
}

// TOGGLE BUTTON INTERACTION EVENT LOOPS
btnMute.addEventListener('click', () => {
    if (localStreamData) {
        // Toggle the active state of all audio track streams globally
        isAudioMuted = !isAudioMuted
        localStreamData.getAudioTracks().forEach(track => track.enabled = !isAudioMuted)
        btnMute.textContent = isAudioMuted ? "Unmute Mic" : "Mute Mic"
        btnMute.classList.toggle('active', isAudioMuted)
    }
})

btnVideo.addEventListener('click', () => {
    if (localStreamData) {
        // Toggle the active state of all video track streams globally
        isVideoHidden = !isVideoHidden
        localStreamData.getVideoTracks().forEach(track => track.enabled = !isVideoHidden)
        btnVideo.textContent = isVideoHidden ? "Show Video" : "Hide Video"
        btnVideo.classList.toggle('active', isVideoHidden)
    }
})

btnLeave.addEventListener('click', () => {
    // Notify the server to cleanly eject you from the active socket space
    socket.emit('disconnectRoom') // Custom signal fallback catcher helper
    executeEclipsxTeardown()
})

socket.on('Disconnect', () => {
    clearRemoteViewGrid()
})

function clearRemoteViewGrid() {
    const remoteWrapper = document.querySelector('#remote-wrapper')
    if(remoteWrapper) remoteWrapper.remove()
    if(currentPeerConnection) {
        if(currentPeerConnection.mediaCall) currentPeerConnection.mediaCall.close()
        if(currentPeerConnection.dataConnection) currentPeerConnection.dataConnection.close()
        currentPeerConnection = null
    }
}

function executeEclipsxTeardown() {
    clearRemoteViewGrid()
    
    // Destroy PeerJS engine footprint sessions fully to allow clean rebuild variables
    if(myPeerInstance) {
        myPeerInstance.destroy()
        myPeerInstance = null
    }
    
    // Reset room inputs configurations state parameters cleanly
    activeRoom = ""
    document.querySelector('#host-room').value = ""
    document.querySelector('#host-pass').value = ""
    document.querySelector('#join-room').value = ""
    document.querySelector('#join-pass').value = ""
    
    // Return back smoothly to dashboard state configuration screens layouts
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
