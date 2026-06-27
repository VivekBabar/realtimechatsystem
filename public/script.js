// ==========================================================================
// APPLICATION STATE
// ==========================================================================
let ws = null;
let myUsername = "";
let myAvatar = "🦊";
let activeChatUser = null;

let onlineUsers = []; // List of other online users
const chatHistories = new Map(); // username -> array of message objects
const unreadCounts = new Map(); // username -> integer count
const peerTypingStatuses = new Map(); // username -> boolean (isTyping)

// Audio & SFX settings
let isSoundEnabled = true;
let isTTSEnabled = false;
let audioCtx = null;

// Speech Recognition (Speech-to-Text)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let speechRecognizer = null;
let isSpeechRecognitionActive = false;

// Voice Note Recording (MediaRecorder)
let mediaRecorder = null;
let recordedChunks = [];
let recordDurationTimer = null;
let recordStartTime = 0;
let visualizerAnalyser = null;
let visualizerCanvasCtx = null;
let visualizerAnimationFrameId = null;
let isRecording = false;

// Typing Indicator Debounce
let isCurrentlyTyping = false;
let typingDebounceTimeout = null;

// ==========================================================================
// INIT & EVENT LISTENERS
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  setupAvatarSelector();
  setupRecordingButtons();
  
  // Load custom server URL from storage
  const customUrl = localStorage.getItem("customServerUrl");
  if (customUrl) {
    const input = document.getElementById("server-url-input");
    if (input) input.value = customUrl;
  }
});

// Setup Avatar Selector UI
function setupAvatarSelector() {
  const avatarButtons = document.querySelectorAll(".avatar-option");
  avatarButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      avatarButtons.forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      myAvatar = btn.getAttribute("data-avatar");
    });
  });
}

// ==========================================================================
// CLIENT-SIDE SYNTHESIZED SOUND EFFECTS (WEB AUDIO API)
// ==========================================================================
function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playSFX(type) {
  if (!isSoundEnabled) return;
  try {
    initAudioContext();
    const now = audioCtx.currentTime;
    
    if (type === 'join') {
      // Arpeggio
      const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.frequency.setValueAtTime(freq, now + idx * 0.1);
        gain.gain.setValueAtTime(0, now + idx * 0.1);
        gain.gain.linearRampToValueAtTime(0.15, now + idx * 0.1 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.1 + 0.35);
        
        osc.start(now + idx * 0.1);
        osc.stop(now + idx * 0.1 + 0.4);
      });
    } else if (type === 'send') {
      // Short rising pop
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.frequency.setValueAtTime(350, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
      
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.linearRampToValueAtTime(0.0001, now + 0.12);
      
      osc.start(now);
      osc.stop(now + 0.13);
    } else if (type === 'receive') {
      // Ding-dong bell
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      const gain2 = audioCtx.createGain();
      
      osc1.connect(gain1);
      osc2.connect(gain2);
      gain1.connect(audioCtx.destination);
      gain2.connect(audioCtx.destination);
      
      osc1.frequency.setValueAtTime(523.25, now); // C5
      gain1.gain.setValueAtTime(0.15, now);
      gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
      
      osc2.frequency.setValueAtTime(659.25, now + 0.1); // E5
      gain2.gain.setValueAtTime(0.15, now + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      
      osc1.start(now);
      osc1.stop(now + 0.45);
      osc2.start(now + 0.1);
      osc2.stop(now + 0.65);
    } else if (type === 'rec_start') {
      // Modern warning high tone
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(450, now + 0.15);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'rec_stop') {
      // Double click confirmation
      [0, 0.06].forEach(delay => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.frequency.setValueAtTime(880, now + delay);
        gain.gain.setValueAtTime(0.08, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.04);
        
        osc.start(now + delay);
        osc.stop(now + delay + 0.05);
      });
    }
  } catch (e) {
    console.warn("SFX failed: Web Audio is not fully initiated yet.", e);
  }
}

// Toggle Sound State
function toggleSound() {
  isSoundEnabled = !isSoundEnabled;
  const onIcon = document.getElementById("sound-on-icon");
  const offIcon = document.getElementById("sound-off-icon");
  const btn = document.getElementById("btn-sound-toggle");
  
  if (isSoundEnabled) {
    onIcon.classList.remove("hidden");
    offIcon.classList.add("hidden");
    btn.classList.add("active");
    playSFX('send');
  } else {
    onIcon.classList.add("hidden");
    offIcon.classList.remove("hidden");
    btn.classList.remove("active");
  }
}

// ==========================================================================
// TEXT-TO-SPEECH (TTS) NARRATION
// ==========================================================================
function toggleTTS() {
  isTTSEnabled = !isTTSEnabled;
  const btn = document.getElementById("btn-tts-toggle");
  if (isTTSEnabled) {
    btn.classList.add("active");
    speakText("Text to speech enabled");
  } else {
    btn.classList.remove("active");
    window.speechSynthesis.cancel();
  }
}

function speakText(text) {
  try {
    window.speechSynthesis.cancel(); // Halt previous read-outs
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.error("Speech Synthesis Error:", e);
  }
}

// ==========================================================================
// SPEECH-TO-TEXT DICTATION (VOICE TYPING)
// ==========================================================================
function toggleSpeechRecognition() {
  if (!SpeechRecognition) {
    alert("Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.");
    return;
  }
  
  const btn = document.getElementById("btn-speech-typing");
  const textInput = document.getElementById("chat-message-input");
  
  if (isSpeechRecognitionActive) {
    speechRecognizer.stop();
    return;
  }
  
  initAudioContext();
  playSFX('rec_stop');
  
  speechRecognizer = new SpeechRecognition();
  speechRecognizer.continuous = false;
  speechRecognizer.interimResults = false;
  speechRecognizer.lang = 'en-US';
  
  speechRecognizer.onstart = () => {
    isSpeechRecognitionActive = true;
    btn.classList.add("active");
    textInput.placeholder = "Listening... Speak now...";
  };
  
  speechRecognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    textInput.value = textInput.value ? textInput.value + " " + transcript : transcript;
    handleTypingNotification();
  };
  
  speechRecognizer.onerror = (e) => {
    console.error("Speech Recognition Error:", e);
    cleanupSpeechRecognition();
  };
  
  speechRecognizer.onend = () => {
    cleanupSpeechRecognition();
  };
  
  speechRecognizer.start();
}

function cleanupSpeechRecognition() {
  isSpeechRecognitionActive = false;
  const btn = document.getElementById("btn-speech-typing");
  const textInput = document.getElementById("chat-message-input");
  if (btn) btn.classList.remove("active");
  if (textInput) textInput.placeholder = "Type a secure message...";
}

// ==========================================================================
// WEBSOCKET CONNECTION AND PROTOCOL HANDLER
// ==========================================================================
function initiateConnection() {
  const usernameField = document.getElementById("username-input");
  const username = usernameField.value.trim();
  
  if (!username) {
    alert("Please enter a codename before connecting.");
    return;
  }
  
  initAudioContext();
  
  // Determine URL to connect to
  let wsUrl = "";
  const customUrl = localStorage.getItem("customServerUrl");
  if (customUrl && customUrl.trim() !== "") {
    wsUrl = customUrl.trim();
  } else {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    wsUrl = `${protocol}//${window.location.host}`;
  }
  
  console.log("Connecting to WebSocket gateway:", wsUrl);
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: "join",
      username: username
    }));
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWebSocketMessage(data);
    } catch (e) {
      console.error("Failed to parse incoming WS text:", e);
    }
  };
  
  ws.onerror = (e) => {
    console.error("WebSocket Connection Error:", e);
    alert("Could not connect to Private Sphere server. Make sure node server is active.");
  };
  
  ws.onclose = () => {
    console.log("Disconnected from WebSocket server.");
    // Show Login Card, hide dashboard
    document.getElementById("login-panel").classList.add("active");
    document.getElementById("chat-dashboard").classList.remove("active");
    alert("Link dropped. Returning to entry gate.");
  };
}

function handleWebSocketMessage(msg) {
  switch (msg.type) {
    case "join_response":
      if (msg.success) {
        myUsername = msg.username;
        // Shift UI Screens
        document.getElementById("login-panel").classList.remove("active");
        document.getElementById("chat-dashboard").classList.add("active");
        
        // Render current identity displays
        document.getElementById("my-name-display").textContent = myUsername;
        document.getElementById("my-avatar-display").textContent = myAvatar;
        
        playSFX('join');
      } else {
        alert("Failed to join private channel.");
      }
      break;
      
    case "user_list":
      // Extract peers (all except me)
      onlineUsers = msg.users.filter(u => u !== myUsername);
      renderContactsList();
      break;
      
    case "private":
      handleIncomingPrivateMessage(msg);
      break;
      
    case "typing":
      handleIncomingTypingIndicator(msg);
      break;
  }
}

// In-memory histories helper
function saveToChatHistory(senderOrReceiver, msgObj) {
  if (!chatHistories.has(senderOrReceiver)) {
    chatHistories.set(senderOrReceiver, []);
  }
  chatHistories.get(senderOrReceiver).push(msgObj);
}

// Handling Incoming Messages
function handleIncomingPrivateMessage(msg) {
  const sender = msg.from;
  const isCurrentlyActive = (activeChatUser === sender);
  
  const savedMsg = {
    sender: sender,
    text: msg.text,
    mediaType: msg.mediaType || "text",
    fileName: msg.fileName,
    fileSize: msg.fileSize,
    timestamp: msg.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  
  saveToChatHistory(sender, savedMsg);
  playSFX('receive');
  
  if (isCurrentlyActive) {
    appendMessageBubble(savedMsg, false);
    scrollMessageBoardToBottom();
    
    // Auto-read via TTS if enabled
    if (isTTSEnabled) {
      if (savedMsg.mediaType === "text") {
        speakText(`${sender} says: ${savedMsg.text}`);
      } else {
        speakText(`${sender} sent a voice message`);
      }
    }
  } else {
    // Unread count increment
    const currentUnread = unreadCounts.get(sender) || 0;
    unreadCounts.set(sender, currentUnread + 1);
    renderContactsList();
  }
}

// Handle Incoming Typing Indicator
function handleIncomingTypingIndicator(msg) {
  const sender = msg.from;
  peerTypingStatuses.set(sender, msg.isTyping);
  
  if (activeChatUser === sender) {
    const indicator = document.getElementById("recipient-typing-indicator");
    const nameText = document.getElementById("typing-username-text");
    if (msg.isTyping) {
      nameText.textContent = sender;
      indicator.classList.add("active");
    } else {
      indicator.classList.remove("active");
    }
  }
}

// ==========================================================================
// SIDEBAR & CHAT INTERACTIVE CONTROLS
// ==========================================================================
function renderContactsList() {
  const container = document.getElementById("contacts-container");
  container.innerHTML = "";
  
  if (onlineUsers.length === 0) {
    container.innerHTML = `
      <div class="empty-contacts">
        <p>No other channels online. Send this URL link to another tab or friend to connect!</p>
      </div>
    `;
    return;
  }
  
  onlineUsers.forEach(username => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "contact-item";
    if (activeChatUser === username) {
      item.classList.add("active");
    }
    
    item.onclick = () => selectChatContact(username);
    
    // Get last message preview
    const history = chatHistories.get(username) || [];
    let preview = "Click to establish connection";
    if (history.length > 0) {
      const lastMsg = history[history.length - 1];
      preview = lastMsg.mediaType === "audio" ? "🎵 Voice Note" : lastMsg.text;
    }
    
    // Check unread count
    const unread = unreadCounts.get(username) || 0;
    
    // Static mapped avatar based on username characters for aesthetic persistence
    const avatarList = ["🦊", "🐺", "🐱", "🐉", "🐼", "👾"];
    const avatarIndex = Math.abs(hashCode(username)) % avatarList.length;
    const userAvatar = avatarList[avatarIndex];
    
    // Contact Item DOM
    item.innerHTML = `
      <div class="contact-card-info">
        <div class="avatar-glow">${userAvatar}</div>
        <div class="contact-meta">
          <span class="contact-name">${username}</span>
          <span class="contact-preview">${preview}</span>
        </div>
      </div>
      <div class="contact-indicators">
        ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : `<span class="online-dot"></span>`}
      </div>
    `;
    
    container.appendChild(item);
  });
}

function selectChatContact(username) {
  if (activeChatUser === username) return;
  
  // Transition styling on mobile
  document.getElementById("chat-dashboard").classList.add("chat-active");
  
  activeChatUser = username;
  
  // Clear unreads
  unreadCounts.set(username, 0);
  renderContactsList();
  
  // Slide panels
  document.getElementById("lobby-view").classList.remove("active");
  const chatFrame = document.getElementById("active-chat-frame");
  chatFrame.classList.add("active");
  
  // Update header text
  document.getElementById("active-username").textContent = username;
  
  const avatarList = ["🦊", "🐺", "🐱", "🐉", "🐼", "👾"];
  const avatarIndex = Math.abs(hashCode(username)) % avatarList.length;
  document.getElementById("active-avatar").textContent = avatarList[avatarIndex];
  
  // Check typing status of selected user
  const isTyping = peerTypingStatuses.get(username) || false;
  const indicator = document.getElementById("recipient-typing-indicator");
  if (isTyping) {
    document.getElementById("typing-username-text").textContent = username;
    indicator.classList.add("active");
  } else {
    indicator.classList.remove("active");
  }
  
  // Populate messages board
  renderChatMessages();
  playSFX('join');
}

function renderChatMessages() {
  const container = document.getElementById("messages-container");
  container.innerHTML = "";
  
  const messages = chatHistories.get(activeChatUser) || [];
  messages.forEach(msg => {
    const isOutgoing = (msg.sender === myUsername);
    appendMessageBubble(msg, isOutgoing);
  });
  
  scrollMessageBoardToBottom();
}

// Append Bubble in Container
function appendMessageBubble(msg, isOutgoing) {
  const container = document.getElementById("messages-container");
  
  const row = document.createElement("div");
  row.className = `message-row ${isOutgoing ? 'outgoing' : 'incoming'}`;
  
  // Avatar Resolve
  const avatarList = ["🦊", "🐺", "🐱", "🐉", "🐼", "👾"];
  const avatarIndex = Math.abs(hashCode(msg.sender)) % avatarList.length;
  const avatar = isOutgoing ? myAvatar : avatarList[avatarIndex];
  
  const avatarDiv = document.createElement("div");
  avatarDiv.className = "msg-avatar";
  avatarDiv.textContent = avatar;
  
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  
  // Injected Contents
  if (msg.mediaType === "audio") {
    // Custom Audio Player Structure
    const playerWrapper = document.createElement("div");
    playerWrapper.className = "audio-message-player";
    
    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "audio-play-btn";
    playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
    
    const timelineWrapper = document.createElement("div");
    timelineWrapper.className = "audio-timeline-wrapper";
    
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "audio-slider";
    slider.value = 0;
    slider.max = 100;
    
    const timeMeta = document.createElement("div");
    timeMeta.className = "audio-time-meta";
    
    const currentTimeText = document.createElement("span");
    currentTimeText.textContent = "0:00";
    const durationText = document.createElement("span");
    durationText.textContent = "--:--";
    
    timeMeta.appendChild(currentTimeText);
    timeMeta.appendChild(durationText);
    timelineWrapper.appendChild(slider);
    timelineWrapper.appendChild(timeMeta);
    
    playerWrapper.appendChild(playBtn);
    playerWrapper.appendChild(timelineWrapper);
    bubble.appendChild(playerWrapper);
    
    // Audio Event Bindings
    const audio = new Audio(msg.text);
    let isAudioPlaying = false;
    
    audio.onloadedmetadata = () => {
      durationText.textContent = formatDuration(audio.duration);
    };
    
    audio.ontimeupdate = () => {
      if (audio.duration) {
        const percentage = (audio.currentTime / audio.duration) * 100;
        slider.value = percentage;
        currentTimeText.textContent = formatDuration(audio.currentTime);
      }
    };
    
    audio.onended = () => {
      isAudioPlaying = false;
      playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
      slider.value = 0;
      currentTimeText.textContent = "0:00";
    };
    
    playBtn.onclick = () => {
      initAudioContext();
      if (isAudioPlaying) {
        audio.pause();
        isAudioPlaying = false;
        playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
      } else {
        // Pause all other audios playing
        document.querySelectorAll("audio").forEach(el => el.pause());
        audio.play();
        isAudioPlaying = true;
        playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
      }
    };
    
    slider.oninput = () => {
      if (audio.duration) {
        const targetTime = (slider.value / 100) * audio.duration;
        audio.currentTime = targetTime;
      }
    };
    
  } else if (msg.mediaType === "image") {
    // Image content layout
    bubble.classList.add("message-bubble-image");
    const img = document.createElement("img");
    img.src = msg.text;
    img.alt = msg.fileName || "Shared Image";
    img.onclick = () => openLightbox(msg.text, msg.fileName || "Image Preview", "image");
    bubble.appendChild(img);
    
  } else if (msg.mediaType === "video") {
    // Video content layout
    bubble.classList.add("message-bubble-video");
    const video = document.createElement("video");
    video.src = msg.text;
    video.controls = true;
    video.playsInline = true;
    video.addEventListener("dblclick", () => {
      video.pause();
      openLightbox(msg.text, msg.fileName || "Video Preview", "video");
    });
    bubble.appendChild(video);
    
  } else if (msg.mediaType === "file") {
    // Document layout card
    const fileCard = document.createElement("a");
    fileCard.href = msg.text;
    fileCard.download = msg.fileName || "file_attachment";
    fileCard.className = "file-attachment-card";
    
    fileCard.innerHTML = `
      <div class="file-icon-wrapper">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
      </div>
      <div class="file-info-details">
        <span class="file-attachment-name" title="${msg.fileName || 'Attachment'}">${msg.fileName || 'Attachment'}</span>
        <span class="file-attachment-size">${msg.fileSize || 'Unknown size'}</span>
      </div>
      <div class="file-download-action">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      </div>
    `;
    bubble.appendChild(fileCard);
    
  } else {
    // Standard Text
    const textNode = document.createElement("p");
    textNode.textContent = msg.text;
    bubble.appendChild(textNode);
  }
  
  // Timestamp Metadata
  const meta = document.createElement("div");
  meta.className = "message-meta";
  
  const timeSpan = document.createElement("span");
  timeSpan.textContent = msg.timestamp;
  meta.appendChild(timeSpan);
  
  // For incoming text messages, add a single-bubble TTS trigger button
  if (!isOutgoing && msg.mediaType === "text") {
    const ttsBtn = document.createElement("button");
    ttsBtn.type = "button";
    ttsBtn.className = "bubble-tts-btn";
    ttsBtn.title = "Read aloud";
    ttsBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v1a7 7 0 0 1-14 0v-1"></path></svg>`;
    ttsBtn.onclick = (e) => {
      e.stopPropagation();
      speakText(`${msg.sender} says: ${msg.text}`);
    };
    meta.appendChild(ttsBtn);
  }
  
  bubble.appendChild(meta);
  row.appendChild(avatarDiv);
  row.appendChild(bubble);
  
  container.appendChild(row);
}

// Trigger text message sending
function triggerSendMessage() {
  const input = document.getElementById("chat-message-input");
  const text = input.value.trim();
  
  if (!text || !activeChatUser || !ws) return;
  
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const messageData = {
    type: "private",
    to: activeChatUser,
    text: text,
    mediaType: "text"
  };
  
  // Send via WS
  ws.send(JSON.stringify(messageData));
  
  // Save local history
  const localSavedMsg = {
    sender: myUsername,
    text: text,
    mediaType: "text",
    timestamp: timestamp
  };
  
  saveToChatHistory(activeChatUser, localSavedMsg);
  appendMessageBubble(localSavedMsg, true);
  
  input.value = "";
  input.focus();
  scrollMessageBoardToBottom();
  
  // Reset typing state
  handleStopTyping();
  playSFX('send');
}

// Keyboard Enter Key Trigger
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && document.activeElement.id === "chat-message-input") {
    triggerSendMessage();
  }
});

// ==========================================================================
// REAL-TIME TYPING NOTIFICATIONS
// ==========================================================================
function handleTypingNotification() {
  if (!ws || !activeChatUser) return;
  
  if (!isCurrentlyTyping) {
    isCurrentlyTyping = true;
    ws.send(JSON.stringify({
      type: "typing",
      to: activeChatUser,
      isTyping: true
    }));
  }
  
  clearTimeout(typingDebounceTimeout);
  typingDebounceTimeout = setTimeout(handleStopTyping, 2000);
}

function handleStopTyping() {
  if (isCurrentlyTyping && ws && activeChatUser) {
    isCurrentlyTyping = false;
    ws.send(JSON.stringify({
      type: "typing",
      to: activeChatUser,
      isTyping: false
    }));
  }
}

// ==========================================================================
// VOICE RECORDING (MEDIARECORDER & AMPLITUDE WAVE VISUALIZATION)
// ==========================================================================
function setupRecordingButtons() {
  const recBtn = document.getElementById("btn-voice-record");
  
  // Standard click-to-toggle recording pattern fits all devices
  recBtn.addEventListener("click", () => {
    initAudioContext();
    if (!isRecording) {
      startVoiceNoteRecording();
    } else {
      stopVoiceNoteRecording(true); // Send it
    }
  });
}

async function startVoiceNoteRecording() {
  if (isRecording) return;
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Set recording states
    isRecording = true;
    recordedChunks = [];
    
    // UI adjustment
    const recBtn = document.getElementById("btn-voice-record");
    recBtn.classList.add("recording");
    
    const visualizer = document.getElementById("visualizer-container");
    visualizer.classList.add("active");
    
    playSFX('rec_start');
    
    // Timer updates
    recordStartTime = Date.now();
    const durationText = document.getElementById("rec-duration");
    durationText.textContent = "0:00";
    
    recordDurationTimer = setInterval(() => {
      const secondsElapsed = Math.floor((Date.now() - recordStartTime) / 1000);
      const minutes = Math.floor(secondsElapsed / 60);
      const seconds = secondsElapsed % 60;
      durationText.textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }, 1000);
    
    // Canvas visualizer setup
    setupAudioAnalyser(stream);
    
    // Media Recorder initialization
    mediaRecorder = new MediaRecorder(stream);
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = async () => {
      // Clean streaming tracks
      stream.getTracks().forEach(track => track.stop());
      
      if (recordedChunks.length === 0) return;
      
      const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
      
      // Convert to Base64
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = () => {
        const base64AudioData = reader.result;
        sendVoiceNoteMessage(base64AudioData);
      };
    };
    
    mediaRecorder.start();
    
  } catch (err) {
    console.error("Mic Access Denied/Failed:", err);
    alert("Could not access microphone. Verify hardware connections and permissions.");
    cleanupRecordingUIState();
  }
}

function stopVoiceNoteRecording(shouldSend) {
  if (!isRecording) return;
  
  isRecording = false;
  cleanupRecordingUIState();
  
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    if (!shouldSend) {
      // Clear data chunks to drop voice note
      recordedChunks = [];
      playSFX('click');
    } else {
      playSFX('rec_stop');
    }
    mediaRecorder.stop();
  }
}

function cleanupRecordingUIState() {
  clearInterval(recordDurationTimer);
  
  // UI classes reset
  const recBtn = document.getElementById("btn-voice-record");
  if (recBtn) recBtn.classList.remove("recording");
  
  const visualizer = document.getElementById("visualizer-container");
  if (visualizer) visualizer.classList.remove("active");
  
  // Stop visualizer animation loop
  if (visualizerAnimationFrameId) {
    cancelAnimationFrame(visualizerAnimationFrameId);
  }
}

// Web Audio API visualizer
function setupAudioAnalyser(stream) {
  const canvas = document.getElementById("waveform-canvas");
  visualizerCanvasCtx = canvas.getContext("2d");
  
  // Resize canvas to internal display width
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  
  const source = audioCtx.createMediaStreamSource(stream);
  visualizerAnalyser = audioCtx.createAnalyser();
  visualizerAnalyser.fftSize = 256;
  source.connect(visualizerAnalyser);
  
  const bufferLength = visualizerAnalyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  function drawWaveform() {
    if (!isRecording) return;
    
    visualizerAnimationFrameId = requestAnimationFrame(drawWaveform);
    visualizerAnalyser.getByteTimeDomainData(dataArray);
    
    // Clear canvas
    visualizerCanvasCtx.fillStyle = 'rgba(14, 10, 31, 0.4)';
    visualizerCanvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw waves
    visualizerCanvasCtx.lineWidth = 2.5;
    
    // Violet/Aqua gradient wave
    const gradient = visualizerCanvasCtx.createLinearGradient(0, 0, canvas.width, 0);
    gradient.addColorStop(0, '#6c5ce7');
    gradient.addColorStop(0.5, '#00d2d3');
    gradient.addColorStop(1, '#6c5ce7');
    visualizerCanvasCtx.strokeStyle = gradient;
    
    visualizerCanvasCtx.beginPath();
    
    const sliceWidth = canvas.width * 1.0 / bufferLength;
    let x = 0;
    
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = v * canvas.height / 2;
      
      if (i === 0) {
        visualizerCanvasCtx.moveTo(x, y);
      } else {
        visualizerCanvasCtx.lineTo(x, y);
      }
      
      x += sliceWidth;
    }
    
    visualizerCanvasCtx.lineTo(canvas.width, canvas.height / 2);
    visualizerCanvasCtx.stroke();
  }
  
  drawWaveform();
}

function sendVoiceNoteMessage(base64Data) {
  if (!ws || !activeChatUser) return;
  
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const messageData = {
    type: "private",
    to: activeChatUser,
    text: base64Data,
    mediaType: "audio"
  };
  
  ws.send(JSON.stringify(messageData));
  
  // Save local history
  const localSavedMsg = {
    sender: myUsername,
    text: base64Data,
    mediaType: "audio",
    timestamp: timestamp
  };
  
  saveToChatHistory(activeChatUser, localSavedMsg);
  appendMessageBubble(localSavedMsg, true);
  scrollMessageBoardToBottom();
  
  playSFX('send');
}

// ==========================================================================
// UTILITY FUNCTIONS & HELPERS
// ==========================================================================
function scrollMessageBoardToBottom() {
  const container = document.getElementById("messages-container");
  container.scrollTop = container.scrollHeight;
}

// String hash code helper for avatar and color persistence
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
}

// Format duration from float seconds to string m:ss
function formatDuration(sec) {
  if (isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ==========================================================================
// MEDIA ATTACHMENTS & FULLSCREEN LIGHTBOX LOGIC
// ==========================================================================

// Trigger file attachment selection
function triggerFileAttachmentClick() {
  document.getElementById("file-attachment-input").click();
}

// Handle file attachment selection
function handleFileAttachmentSelected(inputEl) {
  const file = inputEl.files[0];
  if (!file || !activeChatUser || !ws) return;
  
  // 10MB limit
  const maxBytes = 10 * 1024 * 1024;
  if (file.size > maxBytes) {
    alert("File exceeds maximum 10MB transmission threshold for secure channels.");
    inputEl.value = "";
    return;
  }
  
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => {
    const base64DataUrl = reader.result;
    
    // Determine media classifications
    let mediaType = "file";
    if (file.type.startsWith("image/")) {
      mediaType = "image";
    } else if (file.type.startsWith("video/")) {
      mediaType = "video";
    }
    
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const messagePayload = {
      type: "private",
      to: activeChatUser,
      text: base64DataUrl,
      mediaType: mediaType,
      fileName: file.name,
      fileSize: formatBytes(file.size)
    };
    
    // Broadcast via WS
    ws.send(JSON.stringify(messagePayload));
    
    // Save to history locally
    const localSavedMsg = {
      sender: myUsername,
      text: base64DataUrl,
      mediaType: mediaType,
      fileName: file.name,
      fileSize: formatBytes(file.size),
      timestamp: timestamp
    };
    
    saveToChatHistory(activeChatUser, localSavedMsg);
    appendMessageBubble(localSavedMsg, true);
    scrollMessageBoardToBottom();
    
    playSFX('send');
    inputEl.value = ""; // Reset
  };
  
  reader.onerror = (err) => {
    console.error("FileReader error:", err);
    alert("An error occurred while loading the attachment.");
  };
}

// Format bytes to human readable sizes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Fullscreen Lightbox triggers
function openLightbox(src, caption, type) {
  const lightbox = document.getElementById("media-lightbox");
  const container = document.getElementById("lightbox-media-container");
  const captionText = document.getElementById("lightbox-caption");
  
  container.innerHTML = "";
  captionText.textContent = caption;
  
  if (type === "image") {
    const img = document.createElement("img");
    img.src = src;
    img.alt = caption;
    container.appendChild(img);
  } else if (type === "video") {
    const video = document.createElement("video");
    video.src = src;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    container.appendChild(video);
  }
  
  lightbox.classList.add("active");
  playSFX('join');
}

function closeLightbox() {
  const lightbox = document.getElementById("media-lightbox");
  const container = document.getElementById("lightbox-media-container");
  
  // Terminate playbacks
  const video = container.querySelector("video");
  if (video) {
    video.pause();
  }
  
  lightbox.classList.remove("active");
}

// ==========================================================================
// SERVER SETTINGS COG INTERACTIVE TRIGGERS
// ==========================================================================
function toggleServerSettings() {
  const dropdown = document.getElementById("server-settings-dropdown");
  dropdown.classList.toggle("hidden");
}

function saveServerSettings() {
  const input = document.getElementById("server-url-input");
  const url = input.value.trim();
  if (url === "") {
    localStorage.removeItem("customServerUrl");
  } else {
    localStorage.setItem("customServerUrl", url);
  }
}