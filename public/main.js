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
    window.location.hash = sanitizedCode;
    startVideoCall('#' + sanitizedCode);
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

            // Dispatches filter changes down through the P2P connection channel
            filter.addEventListener('change', (event) => {
                currentFilter = event.target.value
                video.style.filter = currentFilter
                SendData({ type: 'filter', value: currentFilter })
                event.preventDefault()
            })

            function InitPeer(type) {
                let peer = new Peer({ initiator: (type == 'init') ? true : false, stream: stream, trickle: false })
                
                peer.on('stream', function (stream) {
                    CreateVideo(stream)
                })
                
                // Read and act on multi-purpose incoming JSON events from your peer
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
                peer.on('signal', function (data) {
                    if (!client.gotAnswer) {
                        socket.emit('Offer', data)
                    }
                })
                client.peer = peer
            }

            function FrontAnswer(offer) {
                let peer = InitPeer('notInit')
                peer.on('signal', (data) => {
                    socket.emit('Answer', data)
                })
                peer.signal(offer)
                client.peer = peer
            }

            function SignalAnswer(answer) {
                client.gotAnswer = true
                let peer = client.peer
                peer.signal(answer)
            }

            function CreateVideo(stream) {
                CreateDiv()

                let videoElement = document.createElement('video')
                videoElement.id = 'peerVideo' // Targets full screen styling
                videoElement.srcObject = stream
                videoElement.setAttribute('class', '') // Clear out any interfering styling classes
                document.querySelector('#peerDiv').appendChild(videoElement)
                videoElement.play()
                
                // Immediately sync active parameters to our peer across the Data Channel
                setTimeout(() => {
                    SendData({ type: 'identity', value: myUsername })
                    if (currentFilter) SendData({ type: 'filter', value: currentFilter })
                }, 1000)

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

            // Wrapper assistant method to pass structured parameters cleanly over WebRTC
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
            }

            socket.on('BackOffer', FrontAnswer)
            socket.on('BackAnswer', SignalAnswer)
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
