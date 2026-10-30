'use strict';

const state = {
  currentScreen: 'home',
  cameraFacingMode: 'environment',
  cameraStream: null,
  speechRate: 1.0,
  selectedVoice: null,
  deviceStates: { glasses: false, cane: false, band: false },
  currentDirectionStep: 0,
  directionSteps: [],
  sosHoldTimer: null,
  tapCount: 0,
  tapTimer: null,
  micActive: false,
  recognition: null,
  settingsLoaded: false,
  speechSession: 0,
  voiceCmdBarTimer: null,
};

const SCREEN_GREETINGS = {
  home:     'Home. Four actions available: One, describe my surroundings. Two, read text or a sign. Three, check hazards ahead. Four, describe a photo or video.',
  connect:  'Connect. Choose from: My Circle, Community, Peer Support, or Professional Support.',
  sos:      'S O S. Tap the large red button to send an alert, or hold anywhere on screen for half a second to trigger emergency instantly.',
  places:   'Places. Type or say your destination, then tap Get walking directions.',
  devices:  'Devices. Three devices available: Smart Glasses, Smart Cane, and Wrist Band. Tap Connect to pair any device.',
  settings: 'Settings. Adjust assistance mode, speech speed, voice, language, notifications, and theme.',
};

async function callOnaAPI(action, imageDataURL) {
  await delay(1600);
  const samples = {
    describe: 'You are standing on a wide pavement. There is a bench on your left about two metres away and a pedestrian crossing ten metres ahead. The crossing signal is red.',
    read:     'The sign reads: Nairobi Central Market. Open Monday to Saturday, seven A M to six P M. Fresh produce, crafts and more.',
    hazards:  'Caution: there is a low-hanging branch at head height approximately three metres ahead, and an uneven kerb to your right.',
    media:    'This is a photograph of a street market taken during the day. A vendor is selling colourful fruits including mangoes, pineapples and watermelons.',
  };
  return samples[action] ?? 'Analysis complete.';
}

async function getWalkingDirections(destination) {
  await delay(1200);
  return [
    'Start at your current location and head north.',
    'Walk 200 metres along Kenyatta Avenue.',
    'Turn right at the Total petrol station.',
    'Continue for 150 metres on Moi Avenue.',
    'Cross at the marked pedestrian crossing.',
    `You have arrived at ${destination}.`,
  ];
}

async function sendSOSAlert(contact) {
  await delay(800);
  console.log(`SOS sent to: ${contact || 'saved contact'}`);
}

async function toggleDevice(deviceId, connect) {
  await delay(900);
  return connect;
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

function cancelSpeech() {
  state.speechSession++;
  try { window.speechSynthesis?.cancel(); } catch { }
}

function speak(text) {
  return new Promise((resolve) => {
    const session = state.speechSession;
    try {
      if (!window.speechSynthesis) { resolve(); return; }
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.rate = state.speechRate;
      if (state.selectedVoice) utt.voice = state.selectedVoice;
      utt.onend   = resolve;
      utt.onerror = resolve;
      if (state.speechSession !== session) { resolve(); return; }
      window.speechSynthesis.speak(utt);
    } catch { resolve(); }
  });
}

async function speakIfSession(text, session) {
  if (state.speechSession !== session) return false;
  await speak(text);
  return state.speechSession === session;
}

function captureFrame() {
  try {
    const video  = document.getElementById('camera-video');
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch { return null; }
}

const lsSet = (key, val) => { try { localStorage.setItem('ona_' + key, JSON.stringify(val)); } catch { } };
const lsGet = (key, fb = null) => { try { const r = localStorage.getItem('ona_' + key); return r !== null ? JSON.parse(r) : fb; } catch { return fb; } };

function showCmdBar(text) {
  const bar = document.getElementById('voice-cmd-bar');
  bar.textContent = text;
  bar.classList.add('visible');
  clearTimeout(state.voiceCmdBarTimer);
  state.voiceCmdBarTimer = setTimeout(() => bar.classList.remove('visible'), 3000);
}

function escapeHTML(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

const WIZARD_MENU = [
  { num: 1, label: 'Describe my surroundings',  keywords: ['one','1','describe','surroundings','around'],              action: () => { closeWizard('home');    handleAction('describe'); } },
  { num: 2, label: 'Read text or a sign',        keywords: ['two','2','read','text','sign'],                            action: () => { closeWizard('home');    handleAction('read');     } },
  { num: 3, label: 'Check hazards ahead',        keywords: ['three','3','hazard','hazards','danger','obstacle'],        action: () => { closeWizard('home');    handleAction('hazards'); } },
  { num: 4, label: 'Get walking directions',     keywords: ['four','4','directions','places','navigate','walk','go'],   action: () => { closeWizard('places');  } },
  { num: 5, label: 'Connect with people',        keywords: ['five','5','connect','people','circle','community'],        action: () => { closeWizard('connect'); } },
  { num: 6, label: 'Send an SOS alert',          keywords: ['six','6','sos','emergency','help','alert'],                action: () => { closeWizard('sos');     } },
  { num: 7, label: 'Manage devices',             keywords: ['seven','7','device','devices','glasses','cane','band'],    action: () => { closeWizard('devices'); } },
  { num: 8, label: 'Settings',                   keywords: ['eight','8','settings','setting','preference'],             action: () => { closeWizard('settings'); } },
];

function highlightWizardRow(index) {
  document.querySelectorAll('#wizard-menu li').forEach((li, i) => li.classList.toggle('speaking', i === index));
}

function clearWizardHighlights() {
  document.querySelectorAll('#wizard-menu li').forEach((li) => li.classList.remove('speaking'));
}

async function readWizardMenu() {
  const session    = ++state.speechSession;
  const speakingEl = document.getElementById('wizard-speaking');

  speakingEl.textContent = 'Welcome to Ona';
  if (!(await speakIfSession('Welcome to Ona. I am your assistive companion. Here is what I can do. Say a number or tap a choice.', session))) return;
  await delay(300);

  for (let i = 0; i < WIZARD_MENU.length; i++) {
    if (state.speechSession !== session) return;
    const item = WIZARD_MENU[i];
    highlightWizardRow(i);
    speakingEl.textContent = `${item.num}. ${item.label}`;
    if (!(await speakIfSession(`${item.num}. ${item.label}`, session))) return;
    await delay(150);
  }

  if (state.speechSession !== session) return;
  clearWizardHighlights();
  speakingEl.textContent = 'Say a number, or tap "Speak your choice"';
  await speakIfSession('Say a number to choose, or tap the button to speak your choice.', session);
}

function matchCommand(text) {
  const lower = text.toLowerCase().trim();
  for (const item of WIZARD_MENU) {
    if (item.keywords.some((kw) => lower.includes(kw))) return item;
  }
  return null;
}

function closeWizard(targetScreen) {
  cancelSpeech();
  const overlay = document.getElementById('wizard-overlay');
  overlay.classList.add('hidden');
  setTimeout(() => overlay.setAttribute('aria-hidden', 'true'), 350);
  if (targetScreen) {
    showScreen(targetScreen);
  }
}

function startWizardListening() {
  const listenBtn  = document.getElementById('btn-wizard-listen');
  const heardEl    = document.getElementById('wizard-heard');
  const speakingEl = document.getElementById('wizard-speaking');

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    speak('Voice input is not supported in your browser. Please tap a number from the list.');
    heardEl.textContent = 'Voice not supported — tap a number below.';
    return;
  }

  if (state.micActive) {
    if (state.recognition) state.recognition.abort();
    listenBtn.classList.remove('active');
    listenBtn.innerHTML = micIcon() + ' Tap to speak your choice';
    state.micActive = false;
    return;
  }

  try {
    const rec = new SR();
    rec.lang = lsGet('language', 'en') === 'sw' ? 'sw-KE' : 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    state.recognition = rec;
    state.micActive   = true;

    listenBtn.classList.add('active');
    listenBtn.innerHTML = micIcon() + ' Listening…';
    speakingEl.textContent = 'Listening…';
    speak('Listening. Say a number.');

    rec.onresult = (e) => {
      let matched = null;
      for (let a = 0; a < e.results[0].length; a++) {
        const t = e.results[0][a].transcript;
        heardEl.textContent = `I heard: "${t}"`;
        matched = matchCommand(t);
        if (matched) break;
      }
      if (matched) {
        speakingEl.textContent = matched.label;
        cancelSpeech();
        speak(`Going to ${matched.label}.`).then(() => matched.action());
      } else {
        const heard = e.results[0][0].transcript;
        heardEl.textContent = `I did not understand "${heard}". Please try again.`;
        speak('Sorry, I did not catch that. Please say a number from one to eight.');
      }
    };

    rec.onerror = () => {
      heardEl.textContent = 'Could not hear you. Please try again.';
      speak('I could not hear you. Please tap the button and try again.');
      stopWizardListening(listenBtn);
    };

    rec.onend = () => stopWizardListening(listenBtn);
    rec.start();
  } catch (err) {
    speak('Voice input is not available. Please tap a choice from the list.');
    stopWizardListening(listenBtn);
  }
}

function stopWizardListening(listenBtn) {
  state.micActive   = false;
  state.recognition = null;
  listenBtn.classList.remove('active');
  listenBtn.innerHTML = micIcon() + ' Tap to speak your choice';
}

function micIcon() {
  return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
}

async function showHelpWizard() {
  cancelSpeech();
  const overlay = document.getElementById('wizard-overlay');
  overlay.removeAttribute('aria-hidden');
  overlay.classList.remove('hidden');
  document.getElementById('wizard-heard').textContent = '';
  document.getElementById('wizard-speaking').textContent = '';
  await readWizardMenu();
}

function showScreen(id) {
  cancelSpeech();

  if (state.currentScreen === id) {
    const greeting = SCREEN_GREETINGS[id];
    if (greeting) speak(greeting);
    return;
  }

  state.currentScreen = id;

  if (id !== 'connect') closeAllSubViews();

  document.querySelectorAll('.screen').forEach((el) => {
    const isTarget = el.id === 'screen-' + id;
    el.classList.toggle('active', isTarget);
    el.setAttribute('aria-hidden', String(!isTarget));
    el.setAttribute('tabindex', isTarget ? '0' : '-1');
  });

  document.querySelectorAll('[data-screen]').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.screen === id));
  });

  const target = document.getElementById('screen-' + id);
  if (target) setTimeout(() => target.focus({ preventScroll: false }), 80);

  const screenNames = { home:'Home', connect:'Connect', sos:'S O S', places:'Places', devices:'Devices', settings:'Settings' };
  if (screenNames[id]) showCmdBar(screenNames[id]);

  const greeting = SCREEN_GREETINGS[id];
  if (greeting) speak(greeting);
}

async function startCamera(facingMode = state.cameraFacingMode) {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
    state.cameraStream = null;
  }
  const video    = document.getElementById('camera-video');
  const fallback = document.getElementById('camera-fallback');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facingMode } }, audio: false });
    state.cameraStream     = stream;
    video.srcObject        = stream;
    video.style.display    = 'block';
    fallback.classList.remove('shown');
    state.cameraFacingMode = facingMode;
  } catch {
    video.style.display = 'none';
    fallback.classList.add('shown');
  }
}

function switchCamera() {
  startCamera(state.cameraFacingMode === 'environment' ? 'user' : 'environment');
}

async function handleAction(action) {
  const caption    = document.getElementById('ona-says');
  const loading    = document.getElementById('caption-loading');
  const actionBtns = document.querySelectorAll('.action-btn');
  const session    = ++state.speechSession;

  caption.textContent = '';
  loading.classList.add('active');
  actionBtns.forEach((b) => { b.disabled = true; });

  try {
    const result = await callOnaAPI(action, captureFrame());
    if (state.speechSession !== session) return;
    caption.textContent = result;
    await speakIfSession(result, session);
    if (state.speechSession !== session) return;
    await delay(500);
    await speakIfSession('Say another action, or tap the help button to return to the menu.', session);
  } catch {
    if (state.speechSession !== session) return;
    const msg = 'Something went wrong. Please try again.';
    caption.textContent = msg;
    speak(msg);
  } finally {
    loading.classList.remove('active');
    actionBtns.forEach((b) => { b.disabled = false; });
  }
}

const subViewMap = {
  'my-circle':    'sub-my-circle',
  'community':    'sub-community',
  'peer-support': 'sub-peer-support',
  'professional': 'sub-professional',
};

const subViewGreetings = {
  'my-circle':    'My Circle. These are your trusted personal contacts who receive your location and SOS alerts.',
  'community':    'Community. Join local and global communities of Ona users.',
  'peer-support': 'Peer Support. Connect with trained peer supporters who have lived experience of vision impairment.',
  'professional': 'Professional Support. Find certified specialists and therapists near you.',
};

function openSubView(key) {
  cancelSpeech();
  document.getElementById('connect-list').style.display = 'none';
  Object.values(subViewMap).forEach((id) => document.getElementById(id).classList.remove('active'));
  const targetId = subViewMap[key];
  if (targetId) {
    const el = document.getElementById(targetId);
    el.classList.add('active');
    const backBtn = el.querySelector('.back-btn');
    if (backBtn) setTimeout(() => backBtn.focus(), 80);
    const greeting = subViewGreetings[key];
    if (greeting) speak(greeting);
  }
}

function closeAllSubViews() {
  const listEl = document.getElementById('connect-list');
  if (listEl) listEl.style.display = '';
  Object.values(subViewMap).forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
}

async function triggerSOS() {
  cancelSpeech();
  const contact = lsGet('sos_contact', '');
  await sendSOSAlert(contact);
  showSOSAlert();
  speak('SOS alert sent.');
}

function showSOSAlert() {
  const alertEl = document.getElementById('sos-alert');
  alertEl.classList.add('visible');
  setTimeout(dismissSOSAlert, 6000);
}

function dismissSOSAlert() {
  document.getElementById('sos-alert').classList.remove('visible');
}

async function fetchDirections(destination) {
  cancelSpeech();
  const btn = document.getElementById('btn-get-directions');
  btn.disabled = true;
  btn.textContent = 'Finding route…';
  const session = ++state.speechSession;
  await speakIfSession(`Getting walking directions to ${destination}. Please wait.`, session);

  try {
    const steps = await getWalkingDirections(destination);
    if (state.speechSession !== session) return;
    state.directionSteps       = steps;
    state.currentDirectionStep = 0;
    renderDirections(destination, steps, session);
  } catch {
    if (state.speechSession !== session) return;
    speak('Could not get directions. Please try again.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg> Get walking directions`;
  }
}

function renderDirections(destination, steps, session) {
  document.getElementById('dest-name').textContent = destination;
  const list = document.getElementById('step-list');
  list.innerHTML = '';

  steps.forEach((text, i) => {
    const li = document.createElement('li');
    li.className = 'step-item' + (i === 0 ? ' current' : '');
    li.id = 'step-' + i;
    li.innerHTML = `<span class="step-num" aria-hidden="true">${i + 1}</span>${escapeHTML(text)}`;
    list.appendChild(li);
  });

  document.getElementById('directions-panel').classList.add('shown');
  if (state.speechSession === session) {
    speak(`Directions ready. Step one: ${steps[0]}. Tap Next step to continue.`);
  }
  document.getElementById('btn-next-step').focus();
}

function advanceStep() {
  const steps = state.directionSteps;
  if (!steps.length) return;
  cancelSpeech();
  const next = Math.min(state.currentDirectionStep + 1, steps.length - 1);
  state.currentDirectionStep = next;

  document.querySelectorAll('.step-item').forEach((el, i) => el.classList.toggle('current', i === next));
  document.getElementById('step-' + next)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  speak(steps[next]);

  if (next === steps.length - 1) {
    const btn = document.getElementById('btn-next-step');
    btn.textContent = 'Arrived';
    btn.disabled = true;
  }
}

async function handleDeviceToggle(deviceId, cardEl, btn) {
  cancelSpeech();
  const isConnected = state.deviceStates[deviceId];
  btn.disabled = true;
  btn.textContent = isConnected ? 'Disconnecting…' : 'Connecting…';

  try {
    const newState = await toggleDevice(deviceId, !isConnected);
    state.deviceStates[deviceId] = newState;
    cardEl.classList.toggle('connected', newState);
    cardEl.querySelector('.status-text').textContent = newState ? 'Connected' : 'Disconnected';
    btn.textContent = newState ? 'Disconnect' : 'Connect';
    btn.setAttribute('aria-pressed', String(newState));
    btn.setAttribute('aria-label', `${newState ? 'Disconnect' : 'Connect'} ${cardEl.querySelector('.device-name').textContent}`);
    speak(`${cardEl.querySelector('.device-name').textContent} ${newState ? 'connected.' : 'disconnected.'}`);
  } catch {
    btn.textContent = isConnected ? 'Disconnect' : 'Connect';
    speak('Device toggle failed. Please try again.');
  } finally {
    btn.disabled = false;
  }
}

function populateVoices() {
  if (!window.speechSynthesis) return;
  const sel    = document.getElementById('voice-select');
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;
  sel.innerHTML = '';
  voices.forEach((v, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(opt);
  });
  const savedIdx = lsGet('voice_idx', 0);
  sel.value = savedIdx;
  state.selectedVoice = voices[savedIdx] || voices[0];
}

function applyTheme(value) {
  document.documentElement.setAttribute('data-theme', value);
  lsSet('theme', value);
}

function loadSettings() {
  if (state.settingsLoaded) return;
  state.settingsLoaded = true;

  const theme = lsGet('theme', '');
  document.documentElement.setAttribute('data-theme', theme);
  const themeRadio = document.querySelector(`input[name="theme"][value="${theme}"]`);
  if (themeRadio) themeRadio.checked = true;

  const speed = lsGet('speech_rate', 1.0);
  state.speechRate = speed;
  document.getElementById('speech-speed').value = speed;
  document.getElementById('speed-display').textContent = speed.toFixed(1) + '×';

  const mode = lsGet('assist_mode', 'independent');
  const modeRadio = document.querySelector(`input[name="assist-mode"][value="${mode}"]`);
  if (modeRadio) modeRadio.checked = true;

  document.getElementById('notif-freq').value = lsGet('notif_freq', 'normal');
  document.getElementById('lang-select').value = lsGet('language', 'en');

  const contact = lsGet('sos_contact', '');
  const contactInput = document.getElementById('sos-contact');
  if (contactInput) contactInput.value = contact;

  populateVoices();
  if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = populateVoices;
}

function startVoiceInput(targetInput, micBtn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { speak('Voice input is not supported in this browser.'); return; }

  if (state.micActive) {
    if (state.recognition) state.recognition.abort();
    stopVoiceInput(micBtn);
    return;
  }

  try {
    const rec = new SR();
    rec.lang = lsGet('language', 'en') === 'sw' ? 'sw-KE' : 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    state.recognition = rec;
    state.micActive   = true;
    micBtn.classList.add('recording');
    micBtn.setAttribute('aria-pressed', 'true');
    speak('Listening.');

    rec.onresult = (e) => {
      targetInput.value = e.results[0][0].transcript;
      targetInput.dispatchEvent(new Event('input'));
      speak(`You said: ${targetInput.value}`);
    };
    rec.onerror = () => stopVoiceInput(micBtn);
    rec.onend   = () => stopVoiceInput(micBtn);
    rec.start();
  } catch {
    stopVoiceInput(micBtn);
    speak('Voice input failed. Please type instead.');
  }
}

function stopVoiceInput(micBtn) {
  state.micActive   = false;
  state.recognition = null;
  micBtn.classList.remove('recording');
  micBtn.setAttribute('aria-pressed', 'false');
}

function handleDoubleTap(e) {
  if (e.target.closest('button, a, input, select, textarea, [role="button"]')) return;
  state.tapCount++;
  if (state.tapCount === 1) {
    state.tapTimer = setTimeout(() => { state.tapCount = 0; }, 300);
  } else if (state.tapCount >= 2) {
    clearTimeout(state.tapTimer);
    state.tapCount = 0;
    showScreen('home');
  }
}

function setupSOSHold() {
  const sosScreen = document.getElementById('screen-sos');
  if (!sosScreen) return;
  sosScreen.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select')) return;
    state.sosHoldTimer = setTimeout(() => triggerSOS(), 600);
  });
  const cancel = () => { clearTimeout(state.sosHoldTimer); state.sosHoldTimer = null; };
  sosScreen.addEventListener('pointerup',     cancel);
  sosScreen.addEventListener('pointercancel', cancel);
  sosScreen.addEventListener('pointermove',   cancel);
}

function bindEvents() {
  document.querySelectorAll('[data-screen]').forEach((btn) => {
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
  });

  document.addEventListener('touchend', handleDoubleTap, { passive: true });

  document.querySelectorAll('#wizard-menu li').forEach((li, i) => {
    li.addEventListener('click', () => {
      const item = WIZARD_MENU[i];
      if (item) {
        cancelSpeech();
        speak(`Going to ${item.label}.`).then(() => item.action());
      }
    });
  });

  document.getElementById('btn-wizard-listen').addEventListener('click', startWizardListening);

  document.getElementById('btn-wizard-skip').addEventListener('click', () => {
    closeWizard('home');
  });

  document.getElementById('btn-global-help').addEventListener('click', showHelpWizard);

  document.getElementById('btn-switch-cam').addEventListener('click', switchCamera);

  document.querySelectorAll('.action-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleAction(btn.dataset.action));
  });

  document.querySelectorAll('.connect-card').forEach((btn) => {
    btn.addEventListener('click', () => openSubView(btn.dataset.subview));
  });

  document.querySelectorAll('.back-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      cancelSpeech();
      closeAllSubViews();
      speak(SCREEN_GREETINGS.connect);
      setTimeout(() => { document.querySelector('.connect-card')?.focus(); }, 80);
    });
  });

  document.getElementById('btn-sos').addEventListener('click', triggerSOS);
  document.getElementById('btn-sos-dismiss').addEventListener('click', dismissSOSAlert);
  setupSOSHold();

  document.getElementById('btn-sos-mic').addEventListener('click', function () {
    startVoiceInput(document.getElementById('sos-contact'), this);
  });
  document.getElementById('sos-contact').addEventListener('blur', function () {
    lsSet('sos_contact', this.value.trim());
  });

  document.getElementById('places-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const dest = document.getElementById('destination-input').value.trim();
    if (!dest) { speak('Please enter or say a destination.'); document.getElementById('destination-input').focus(); return; }
    fetchDirections(dest);
  });

  document.getElementById('btn-dest-mic').addEventListener('click', function () {
    startVoiceInput(document.getElementById('destination-input'), this);
  });

  document.getElementById('btn-next-step').addEventListener('click', advanceStep);

  document.querySelectorAll('.device-card').forEach((card) => {
    const btn = card.querySelector('.toggle-btn');
    btn.addEventListener('click', () => handleDeviceToggle(card.dataset.device, card, btn));
  });

  document.querySelectorAll('input[name="theme"]').forEach((r) => r.addEventListener('change', () => applyTheme(r.value)));

  const speedRange = document.getElementById('speech-speed');
  speedRange.addEventListener('input', () => {
    const val = parseFloat(speedRange.value);
    state.speechRate = val;
    document.getElementById('speed-display').textContent = val.toFixed(1) + '×';
    speedRange.setAttribute('aria-valuenow', val);
    lsSet('speech_rate', val);
  });

  document.getElementById('voice-select').addEventListener('change', function () {
    const voices = window.speechSynthesis?.getVoices() || [];
    state.selectedVoice = voices[parseInt(this.value)] || null;
    lsSet('voice_idx', parseInt(this.value));
  });

  document.getElementById('btn-test-voice').addEventListener('click', () => {
    cancelSpeech();
    speak('Hello. I am Ona, your assistive companion.');
  });

  document.querySelectorAll('input[name="assist-mode"]').forEach((r) => r.addEventListener('change', () => lsSet('assist_mode', r.value)));
  document.getElementById('notif-freq').addEventListener('change', function () { lsSet('notif_freq', this.value); });
  document.getElementById('lang-select').addEventListener('change', function () { lsSet('language', this.value); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { dismissSOSAlert(); closeAllSubViews(); }
  });
}

async function init() {
  loadSettings();
  bindEvents();

  state.currentScreen = '';
  showScreen('home');
  startCamera();

  await delay(600);
  await readWizardMenu();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
