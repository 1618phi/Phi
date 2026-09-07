/* script.js */

const STORAGE_KEY = "1618_seasons_unlocked";

// Mappa numero frammento (1-4) → pagina stagione corrispondente.
// Unica fonte di verità: se cambiano i nomi dei file basta aggiornare qui.
const PIECE_PAGES = ['spring.html', 'summer.html', 'autumn.html', 'winter.html'];

function getUnlockedPieces() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

// Pagina a cui portare l'utente in base al progresso salvato:
// il primo enigma NON ancora sbloccato, oppure seasons.html se ha
// già recuperato tutti e 4 i frammenti.
function getCurrentEnigmaPage() {
  const unlocked = getUnlockedPieces();
  for (let i = 0; i < PIECE_PAGES.length; i++) {
    if (!unlocked.includes(i + 1)) return PIECE_PAGES[i];
  }
  return 'seasons.html';
}

function updateClock() {
  const clockEl = document.getElementById('clock');
  if (clockEl) {
    clockEl.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
  }
}
setInterval(updateClock, 1000);
updateClock();

const nodeEl = document.getElementById('node');
if (nodeEl) {
  nodeEl.textContent = 'NODE: ' + Math.random().toString(16).slice(2, 8).toUpperCase();
}

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function typeWriter(text, id, speed = 200) {
  let i = 0;
  const el = document.getElementById(id);
  if (!el) return;
  function type() {
    if (i < text.length) { el.textContent += text.charAt(i); i++; setTimeout(type, speed); }
  }
  type();
}

function unlockPiece(n) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    if (!saved.includes(n)) { saved.push(n); localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); }
  } catch(e) {}
}

// XOR reversibile — usato solo per il link WhatsApp (deve poter
// tornare in chiaro per generare il QR). Le risposte invece usano
// sempre l'hash sopra, che non è reversibile.
function xorDecrypt(hexStr, key) {
  let out = '';
  for (let i = 0; i < hexStr.length; i += 2) {
    const byte = parseInt(hexStr.substr(i, 2), 16);
    out += String.fromCharCode(byte ^ key.charCodeAt((i / 2) % key.length));
  }
  return out;
}

let _failCount = 0;

function showWarning() {
  let overlay = document.getElementById('warning-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'warning-overlay';
    overlay.innerHTML = `
      <div class="warning-inner">
        <div class="warning-phi">Φ</div>
        <div class="warning-text">ACCESSO NEGATO</div>
        <div class="warning-sub">TENTATIVO_NON_AUTORIZZATO_RILEVATO</div>
      </div>`;
    document.body.appendChild(overlay);
  }

  overlay.classList.remove('warning-hide');
  overlay.classList.add('warning-show');

  setTimeout(() => {
    overlay.classList.remove('warning-show');
    overlay.classList.add('warning-hide');
  }, 2200);
}

function openAttachment() {
  const overlay  = document.getElementById('attachment-overlay');
  const img      = document.getElementById('attachment-img');
  const sweep    = document.querySelector('.scan-sweep');
  const caption  = document.getElementById('attachment-caption');
  if (!overlay || !img) return;

  overlay.classList.add('active');

  img.classList.remove('revealing');
  sweep && sweep.classList.remove('active');
  caption && caption.classList.remove('visible');
  void img.offsetWidth; // forza il restart dell'animazione

  img.classList.add('revealing');
  sweep && sweep.classList.add('active');

  setTimeout(() => { caption && caption.classList.add('visible'); }, 1150);
}

function closeAttachment() {
  const overlay = document.getElementById('attachment-overlay');
  if (overlay) overlay.classList.remove('active');
}

/* ============================================================
   STAZIONE NUMERICA — genera bip Morse via Web Audio, nessun
   file audio necessario
   ============================================================ */
const MORSE_DIGITS = {
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.'
};

function playMorse(text, unit = 90) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  let t = ctx.currentTime + 0.1;

  text.split('').forEach(ch => {
    const code = MORSE_DIGITS[ch];
    if (!code) return;
    code.split('').forEach(sym => {
      const dur = (sym === '.' ? unit : unit * 3) / 1000;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 620;
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.008);
      gain.gain.setValueAtTime(0.25, t + dur - 0.015);
      gain.gain.linearRampToValueAtTime(0, t + dur);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += dur + unit / 1000;
    });
    t += (unit * 2) / 1000; // pausa extra tra una cifra e l'altra
  });
}

/* ============================================================
   CESARE GENERICO — usato dalla ruota cifrante per il preview
   dal vivo mentre l'utente ruota
   ============================================================ */
function caesarDecode(str, shift) {
  return str.replace(/[a-zA-Z]/g, c => {
    const base = c === c.toUpperCase() ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base - shift) % 26 + 26) % 26 + base);
  });
}

/* ============================================================
   RUOTA CIFRANTE — disco trascinabile (SVG), scatta sulle 26
   lettere e riporta lo spostamento corrente
   ============================================================ */
function initCipherWheel(wheelId, offsetDisplayId, onChange) {
  const svg = document.getElementById(wheelId);
  const innerGroup = svg.querySelector('.wheel-inner');
  let currentAngle = 0;
  let dragging = false;
  let startAngle = 0;
  let startPointerAngle = 0;

  function angleFromEvent(e) {
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const point = e.touches ? e.touches[0] : e;
    const x = point.clientX - cx;
    const y = point.clientY - cy;
    return Math.atan2(y, x) * 180 / Math.PI;
  }

  function setRotation(deg) {
    innerGroup.setAttribute('transform', `rotate(${deg} 150 150)`);
  }

  function reportOffset() {
    const step = 360 / 26;
    let offset = Math.round(((currentAngle % 360) + 360) % 360 / step);
    offset = (26 - offset) % 26;
    const el = document.getElementById(offsetDisplayId);
    if (el) el.textContent = offset;
    onChange && onChange(offset);
  }

  function snap() {
    const step = 360 / 26;
    currentAngle = Math.round(currentAngle / step) * step;
    setRotation(currentAngle);
    reportOffset();
  }

  function onDown(e) {
    dragging = true;
    startPointerAngle = angleFromEvent(e);
    startAngle = currentAngle;
  }
  function onMove(e) {
    if (!dragging) return;
    const a = angleFromEvent(e);
    currentAngle = startAngle + (a - startPointerAngle);
    setRotation(currentAngle);
    reportOffset();
    if (e.cancelable) e.preventDefault();
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    snap();
  }

  svg.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  svg.addEventListener('touchstart', onDown, { passive: true });
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onUp);

  reportOffset();
}

/* ============================================================
   CUBI — stato separato da quello dei frammenti normali.
   Tre chiavi segrete (una per spring/summer/autumn) portano a
   winter.html invece che a seasons.html, purificando un cubo.
   ============================================================ */
const CUBE_STORAGE_KEY = "1618_cubes_purified";

function getPurifiedCubes() {
  try { return JSON.parse(localStorage.getItem(CUBE_STORAGE_KEY)) || []; }
  catch { return []; }
}

function purifyCube(name) {
  const cubes = getPurifiedCubes();
  if (!cubes.includes(name)) {
    cubes.push(name);
    localStorage.setItem(CUBE_STORAGE_KEY, JSON.stringify(cubes));
  }
  return cubes;
}

// Marca in modo permanente ma discreto la parola segreta nel testo
// già decodificato di un enigma (usata come indizio per winter.html).
function markSecretWord(containerSelector, plainText, word, delayMs) {
  setTimeout(() => {
    const spans = document.querySelectorAll(containerSelector + ' .char');
    const rawIdx = plainText.toUpperCase().indexOf(word.toUpperCase());
    if (rawIdx === -1) return;
    // Gli "a capo" diventano <br> senza uno span proprio, quindi
    // vanno esclusi dal conteggio per non sfasare la posizione.
    const before = plainText.slice(0, rawIdx);
    const newlineCount = (before.match(/\n/g) || []).length;
    const spanIdx = rawIdx - newlineCount;
    for (let i = spanIdx; i < spanIdx + word.length; i++) {
      if (spans[i]) spans[i].classList.add('secret-word');
    }
  }, delayMs);
}

// Trasforma un elemento cubo da "corrotto" a "puro" con una breve
// animazione di transizione.
function playCubePurify(cubeEl, onDone) {
  cubeEl.classList.add('cube-transitioning');
  setTimeout(() => {
    cubeEl.dataset.state = 'pure';
    cubeEl.classList.remove('cube-transitioning');
    onDone && onDone();
  }, 1200);
}

// Percorso "segreto": invece del normale successo, un lampo di luce
// (l'opposto del collasso buio) e redirect a winter.html col cubo
// di questa stagione.
function triggerCubeReveal() {
  const inputRow = document.querySelector('.input-row');
  const input    = document.getElementById('ans');
  const msg      = document.getElementById('msg');

  inputRow.classList.add('success');
  msg.style.color = 'var(--primary)';
  msg.textContent = '>> SEGNALE_ANOMALO_RILEVATO';
  input.disabled  = true;

  purifyCube(CUBE_NAME);

  document.body.classList.add('lightburst');

  setTimeout(() => {
    document.body.classList.remove('lightburst');
    document.getElementById('main-ui').style.display = 'none';
    const reveal = document.getElementById('cube-reveal');
    reveal.style.display = 'flex';

    const cubeEl = document.getElementById('cube-reveal-visual');
    setTimeout(() => {
      playCubePurify(cubeEl, () => {
        setTimeout(() => {
          window.location.href = `winter.html?cube=${CUBE_NAME}`;
        }, 1600);
      });
    }, 400);
  }, 900);
}

async function check() {
  const inputRow = document.querySelector('.input-row');
  const input    = document.getElementById('ans');

  // Normalizzazione: maiuscolo + rimozione accenti (VERITÀ -> VERITA)
  const normalizedVal = input.value.trim().toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const msg  = document.getElementById('msg');
  const hash = await sha256(normalizedVal);

  inputRow.classList.remove('error', 'success');
  void inputRow.offsetWidth;

  if (typeof SOLUTION_HASH !== 'undefined' && hash === SOLUTION_HASH) {
    inputRow.classList.add('success');
    msg.style.color = 'var(--primary)';
    msg.textContent = '>> ACCESS_GRANTED... SYSTEM_OVERRIDE';
    input.disabled  = true;

    unlockPiece(PIECE_NUMBER);

    setTimeout(() => document.body.classList.add('collapsing'), 300);

    setTimeout(() => {
      document.getElementById('main-ui').style.display = 'none';
      document.getElementById('success').style.display = 'flex';
      document.body.classList.remove('collapsing');

      setTimeout(() => {
        document.getElementById('piece-notice').classList.add('glitch-pop');
        setTimeout(() => { window.location.href = NEXT_URL; }, REDIRECT_DELAY);
      }, 500);
    }, 1800);

  } else if (typeof SECRET_HASH !== 'undefined' && hash === SECRET_HASH) {
    triggerCubeReveal();

  } else {
    inputRow.classList.add('error');
    input.value     = '';
    msg.style.color = '#5e1111';
    msg.textContent = '>> ERROR: UNAUTHORIZED_BREACH_DETECTED';

    _failCount++;
    if (_failCount >= 10) {
      _failCount = 0;
      showWarning();
    }

    setTimeout(() => {
      msg.textContent = '';
      inputRow.classList.remove('error');
    }, 2000);
  }
}

document.getElementById('ans')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') check();
});

function runDecode(cipher, plain, selector, charDelay = 40, initialDelay = 800) {
  const block = document.querySelector(selector);
  if (!block) return;

  block.innerHTML = '';
  const spans = [];

  for (let i = 0; i < cipher.length; i++) {
    if (cipher[i] === '\n') {
      block.appendChild(document.createElement('br'));
    } else {
      const span = document.createElement('span');
      span.className  = 'char';
      span.textContent = cipher[i];
      span.dataset.letter = plain[i] ?? cipher[i];
      block.appendChild(span);
      spans.push({
        span,
        target:   plain[i] ?? cipher[i],
        isLetter: /[a-zA-ZàèéìòùÀÈÉÌÒÙ]/.test(cipher[i])
      });
    }
  }

  const cur = document.createElement('span');
  cur.className = 'cursor';
  block.appendChild(cur);

  let i = 0;
  function decodeNext() {
    while (i < spans.length && !spans[i].isLetter) {
      spans[i].span.classList.add('decoded');
      i++;
    }
    if (i >= spans.length) return;

    const { span, target } = spans[i];
    span.classList.add('decoding');
    span.textContent = target;
    setTimeout(() => {
      span.classList.remove('decoding');
      span.classList.add('decoded');
      i++;
      setTimeout(decodeNext, charDelay);
    }, charDelay / 2);
  }

  setTimeout(decodeNext, initialDelay);
}

function runBootlog(onComplete) {
  const bootlog   = document.getElementById('bootlog');
  const logEl     = document.getElementById('bootlog-log');
  const barEl     = document.getElementById('bootlog-bar');
  const percentEl = document.getElementById('bootlog-percent');
  const statusEl  = document.getElementById('bootlog-status');
  const mainUI    = document.getElementById('main-ui');

  if (!bootlog) {
    if (mainUI) mainUI.classList.add('loaded');
    if (onComplete) onComplete();
    return;
  }

  const bootMessages = [
    'INIT_KERNEL...', 'MOUNT /dev/null...', 'LOAD ENCRYPTION_MODULE...',
    'DECRYPT_X64_CORE... OK', 'ESTABLISH_SECURE_CHANNEL...',
    'VERIFY_IDENTITY_KEY 0x1618...', 'SIGNAL_ACQUIRED...',
    'DECODE_INCOMING_TRANSMISSION...', 'BUFFER_OVERFLOW_CHECK... CLEAN',
    'FINAL_SEQUENCE_DETECTED...', 'PREPARING_INTERFACE...', 'READY.'
  ];

  let progress = 0, logIndex = 0;

  function updateBar() {
    barEl.style.width = Math.floor(progress) + '%';
    percentEl.textContent = Math.floor(progress) + '%';
  }

  function addLogLine() {
    if (logIndex < bootMessages.length) {
      const div = document.createElement('div');
      div.textContent = '> ' + bootMessages[logIndex++];
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  const interval = setInterval(() => {
    progress += Math.random() * 4 + 2;

    if (progress >= 100) {
      progress = 100;
      updateBar();
      statusEl.textContent = 'COMPLETE';
      addLogLine();
      clearInterval(interval);

      setTimeout(() => {
        bootlog.classList.add('hidden');
        if (mainUI) mainUI.classList.add('loaded');
        setTimeout(() => onComplete && onComplete(), 400);
      }, 600);
      return;
    }

    updateBar();
    if (Math.random() > 0.5) addLogLine();
  }, 60);
}
