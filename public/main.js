let Peer = require('simple-peer')
let socket = io()

// DOM elements for interface step switching
const lobby = document.querySelector('#lobby')
const stepName = document.querySelector('#stepName')
const stepAction = document.querySelector('#stepAction')
const callInterface = document.querySelector('#callInterface')

// Inputs & Interactive elements
const nameInput = document.querySelector('#nameInput')
const hostRoomInput = document.querySelector('#hostRoomInput')
const roomInput = document.querySelector('#roomInput')
const nextBtn = document.querySelector('#nextBtn')
const hostBtn = document.querySelector('#hostBtn')
const joinBtn = document.querySelector('#joinBtn')
const leaveBtn = document.querySelector('#leaveBtn')
const greetingName = document.querySelector('#greetingName')
const peerNameTag = document.querySelector('#peerNameTag')

const video = document.querySelector('video')
const filter = document.querySelector('#filter')
const checkboxTheme = document.querySelector('#theme')

let client = {}
let currentFilter
let myUsername = ""

// --- LOBBY WORKFLOW ENGINE ---

// If an invite link is already in the URL hash, pre-populate the join field
if (window.location.hash) {
    roomInput.value = window.location.hash.substring(1);
}

// Step 1: Submit Name
nextBtn.addEventListener('click', proceedToRoomSelection);
nameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') proceedToRoomSelection(); });

function proceedToRoomSelection() {
    myUsername = nameInput.value.trim();
    if (!myUsername) {
        alert('Please enter your name to continue!');
        return;
    }
    
    // Smoothly swap visibility over to Step 2 options panel
    greetingName.innerText = myUsername;
    stepName.style.display = 'none';
    stepAction.style.display = 'block';
}

// Step 2, Option A: Host a Call with a Custom Name
hostBtn.addEventListener('click', handleCustomHost);
hostRoomInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleCustomHost(); });

function handleCustomHost() {
    let rawCode = hostRoomInput.value.trim().toLowerCase();
    if (!rawCode) {
        alert('Please name your room first!');
        return;
    }
    
    // Sanitize string to format securely inside URL hash contexts
    let sanitizedCode = rawCode.replace(/[^a-z0-9-_]/g, '-');
    window.location.hash = sanitizedCode;
    startVideoCall('#' + sanitizedCode);
}

// Step 2, Option B: Join an Existing Call by Typing the Name
joinBtn.addEventListener('click', handleCustomJoin);
roomInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleCustomJoin(); });

function handleCustomJoin() {
    let rawCode = roomInput.value.trim().toLowerCase();
    if (!rawCode) {
        alert('Please enter a room code!');
        return;
    }
    
    let sanitizedCode = rawCode.replace(/[^a-z0-9-_]/g, '-');
    let targetRoom = '#' + sanitizedCode;

    // Ask the server if this room exists first before doing anything
    socket.emit("CheckRoom", targetRoom);

    // Create a temporary one-time listener for the server's verification response
    socket.once("RoomCheckResult", function(result) {
        if (!result.exists) {
            alert("This room does not exist! Please check the code or host a new call.");
        } else if (result.full) {
            alert("This room is already full with 2 users.");
        } else {
            // The room exists and has space! Safe to join.
            window.location.hash = sanitizedCode;
            startVideoCall(targetRoom);
        }
    });
}

// --- CORE WEBRTC & STREAM CALL ENGINE ---

function startVideoCall(roomName) {
    // Swap lobby screen layouts to reveal call UI layers
    lobby.style.display = 'none';
    callInterface.style.display = 'block';

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            // Register local instance directly inside the specified room space
            socket.emit('NewClient', roomName)
            video.srcObject = stream
            video.play()

            // Hook up the Leave Button handler inside our media loop
            leaveBtn.addEventListener('click', handleLeaveCall);

            function handleLeaveCall() {
                leaveBtn.removeEventListener('click', handleLeaveCall);
                window.location.hash = '';
                socket.emit('disconnect'); 
                
                // Shut down camera and mic hardware tracks cleanly
                stream.getTracks().forEach(track => track.stop());
                
                RemovePeer();
                video.srcObject = null;
                
                // Return smoothly to the step selection lobby
                callInterface.style.display = 'none';
                lobby.style.display = 'block';
            }

            // Dispatches filter changes down through the P2P connection channel
            filter.addEventListener('change', (event) => {
                currentFilter = event.target.value
                video.style.filter = currentFilter
                SendData({ type: 'filter', value: currentFilter })
                event.preventDefault()
            })

            function InitPeer(type) {
                // Enabled trickle for instant P2P network connections
                let peer = new Peer({ 
                    initiator: (type == 'init') ? true : false, 
                    stream: stream, 
                    trickle: true 
                })
                
                peer.on('stream', function (stream) {
                    CreateVideo(stream)
                })
                
                // Send out trickle network candidate chunks as they are found
                peer.on('signal', function (data) {
                    if (data.candidate) {
                        socket.emit('SignalData', { room: roomName, signal: data })
                    }
                })
                
                // Read incoming data channel configurations (names and filters)
                peer.on('data', function (data) {
                    let decodedData = new TextDecoder('utf-8').decode(data)
                    let message = JSON.parse(decodedData)

                    if (message.type === 'identity') {
                        peerNameTag.innerText = message.value
                        peerNameTag.style.display = 'block'
                    } 
                    else if (message.type === 'filter') {
                        let peervideo = document.querySelector('#peerVideo')
                        if (peervideo) peervideo.style.filter = message.value
                    }
                })
                return peer
            }

            function MakePeer() {
                client.gotAnswer = false
                let peer = InitPeer('init')
                
                // Track primary SDP offer signals with specific room parameters
                peer.on('signal', function (data) {
                    if (data.sdp && !client.gotAnswer) {
                        socket.emit('Offer', { room: roomName, sdp: data })
                    }
                })
                client.peer = peer
            }

            function FrontAnswer(offer) {
                let peer = InitPeer('notInit')
                
                // Track secondary SDP answer signals with specific room parameters
                peer.on('signal', (data) => {
                    if (data.sdp) {
                        socket.emit('Answer', { room: roomName, sdp: data })
                    }
                })
                peer.signal(offer)
                client.peer = peer
            }

            // Handle incoming target SDP answers or piecemeal trickle network logs
            function ProcessIncomingSignal(signalData) {
                if (client.peer) {
                    if (signalData.sdp && signalData.sdp.type === 'answer') {
                        client.gotAnswer = true
                    }
                    client.peer.signal(signalData)
                }
            }

            function CreateVideo(stream) {
                // Prevent duplicate elements from spawning on trickle refreshes
                if (document.getElementById('peerVideo')) return;

                CreateDiv()

                let videoElement = document.createElement('video')
                videoElement.id = 'peerVideo' // Targets layout backdrops
                videoElement.srcObject = stream
                videoElement.setAttribute('class', '') 
                document.querySelector('#peerDiv').appendChild(videoElement)
                videoElement.play()
                
                // Sync username and active lens targets after half a second
                setTimeout(() => {
                    SendData({ type: 'identity', value: myUsername })
                    if (currentFilter) SendData({ type: 'filter', value: currentFilter })
                }, 500)

                videoElement.addEventListener('click', () => {
                    if (videoElement.volume != 0) videoElement.volume = 0
                    else videoElement.volume = 1
                })
            }

            function SessionActive() {
                alert('This room is full! Returning you to the lobby.');
                window.location.hash = '';
                window.location.reload();
            }

            // Assistant helper to bundle payload objects over Data Channel connections
            function SendData(obj) {
                if (client.peer && client.peer.connected) {
                    client.peer.send(JSON.stringify(obj))
                }
            }

            function RemovePeer() {
                if (document.getElementById("peerVideo")) document.getElementById("peerVideo").remove();
                if (document.getElementById("muteText")) document.getElementById("muteText").remove();
                peerNameTag.style.display = 'none';
                if (client.peer) {
                    client.peer.destroy()
                }
                client = {};
            }

            socket.on('BackOffer', FrontAnswer)
            socket.on('BackAnswer', ProcessIncomingSignal)
            socket.on('BackSignal', ProcessIncomingSignal)
            socket.on('SessionActive', SessionActive)
            socket.on('CreatePeer', MakePeer)
            socket.on('Disconnect', RemovePeer)
        })
        .catch(err => {
            console.error(err)
            alert('Unable to load video call. Please allow camera and microphone access.')
        })
}

// --- VISUAL UI COMPONENT HANDLERS ---

checkboxTheme.addEventListener('click', () => {
    if (checkboxTheme.checked == true) {
        document.body.style.backgroundColor = '#0a0c10' // Deep Space Background
    }
    else {
        document.body.style.backgroundColor = '#1c1f26' // Lunar Surface slate
    }
})

function CreateDiv() {
    let div = document.createElement('div')
    div.setAttribute('class', "centered")
    div.id = "muteText"
    div.innerHTML = "Click stream to mute / unmute"
    document.querySelector('#peerDiv').appendChild(div)
}
