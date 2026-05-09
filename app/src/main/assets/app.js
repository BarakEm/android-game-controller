(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const GRID_W = 10;
  const GRID_H = 20;
  let CELL = 36;
  let SIDE_W = 260;
  let WINDOW_W = GRID_W * CELL + SIDE_W;
  let WINDOW_H = GRID_H * CELL;
  let SHOW_PANEL = true;
  let DPR = window.devicePixelRatio || 1;

  const COLORS = {
    I: [0, 240, 240],    // cyan
    O: [240, 240, 0],    // yellow
    T: [160, 0, 240],    // purple
    S: [0, 240, 0],      // green
    Z: [240, 0, 0],      // red
    J: [0, 0, 240],      // blue
    L: [240, 160, 0],    // orange
  };

  const SHAPES = {
    I: [[1,1,1,1]],
    O: [[1,1],[1,1]],
    T: [[0,1,0],[1,1,1]],
    S: [[0,1,1],[1,1,0]],
    Z: [[1,1,0],[0,1,1]],
    J: [[1,0,0],[1,1,1]],
    L: [[0,0,1],[1,1,1]],
  };

  const bgColor   = "#000000";
  const gridBg    = "#000000";
  const gridLine  = "#141430";
  const textColor = "#ffffff";
  const nesFont   = "'Press Start 2P', monospace";

  function computeLayout() {
    DPR = window.devicePixelRatio || 1;
    const maxCssW = Math.max(200, Math.floor(window.innerWidth - 24));
    const narrow = window.innerWidth < 720;
    const maxCssH = Math.floor(window.innerHeight * (narrow ? 0.78 : 0.92));

    SHOW_PANEL = !narrow;
    if (narrow) {
      SIDE_W = 0;
      CELL = Math.max(24, Math.floor(maxCssW / GRID_W));
    } else {
      SIDE_W = 260;
      CELL = 36;
      const neededW = GRID_W * CELL + SIDE_W;
      if (neededW > maxCssW) {
        CELL = Math.max(24, Math.floor((maxCssW - SIDE_W) / GRID_W));
      }
    }

    if (maxCssH > 0) {
      const maxCellH = Math.floor(maxCssH / GRID_H);
      if (maxCellH > 0 && maxCellH < CELL) {
        CELL = Math.max(20, maxCellH);
      }
    }

    WINDOW_W = GRID_W * CELL + SIDE_W;
    WINDOW_H = GRID_H * CELL;

    canvas.width = Math.round(WINDOW_W * DPR);
    canvas.height = Math.round(WINDOW_H * DPR);
    canvas.style.width = `${WINDOW_W}px`;
    canvas.style.height = `${WINDOW_H}px`;
    // transform is re-applied every frame in draw()
  }

  computeLayout();
  window.addEventListener("resize", computeLayout);

  // (gradient removed — NES uses flat dark background)

  function rotateCW(mat) {
    return mat[0].map((_, i) => mat.map(r => r[i]).reverse());
  }

  class Piece {
    constructor(kind) {
      this.kind = kind;
      this.shape = SHAPES[kind].map(r => r.slice());
      this.x = Math.floor(GRID_W/2 - this.shape[0].length/2);
      this.y = 0;
    }
    color() { return COLORS[this.kind]; }
  }

  class Game {
    constructor() { this.reset(); }
    reset() {
      this.grid = Array.from({length: GRID_H}, () => Array(GRID_W).fill(null));
      this.bag = [];
      this.score = 0;
      this.lines = 0;
      this.level = 1;
      this.gameOver = false;
      this.paused = false;
      this.current = this.nextPiece();
      this.next = this.nextPiece();
      this.fallTimer = 0;
    }
    refill() {
      this.bag = Object.keys(SHAPES);
      for (let i = this.bag.length -1; i>0; i--) {
        const j = Math.floor(Math.random()*(i+1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    nextPiece() {
      if (window._pieceQueue && window._pieceQueue.length > 0) {
        return new Piece(window._pieceQueue.shift());
      }
      if (!this.bag.length) this.refill();
      const name = this.bag.pop();
      try { if (window.AndroidBridge) AndroidBridge.onNextPiece(name); } catch(_) {}
      return new Piece(name);
    }
    speed() { return Math.max(0.90, 1.90 - (this.level - 1) * 0.07); }
    valid(piece, dx=0, dy=0, shape=null) {
      const shp = shape || piece.shape;
      for (let r=0; r<shp.length; r++) {
        for (let c=0; c<shp[r].length; c++) {
          if (!shp[r][c]) continue;
          const nx = piece.x + c + dx;
          const ny = piece.y + r + dy;
          if (nx < 0 || nx >= GRID_W || ny >= GRID_H) return false;
          if (ny >= 0 && this.grid[ny][nx]) return false;
        }
      }
      return true;
    }
    move(dx, dy) {
      if (this.valid(this.current, dx, dy)) {
        this.current.x += dx; this.current.y += dy; return true;
      }
      return false;
    }
    rotate() {
      const r = rotateCW(this.current.shape);
      for (const k of [0,-1,1,-2,2]) {
        if (this.valid(this.current, k, 0, r)) {
          this.current.shape = r; this.current.x += k; return true;
        }
      }
      return false;
    }
    softDrop() { if (this.move(0,1)) this.score += 1; else this.lock(); }
    hardDrop() {
      let distance = 0;
      while (this.move(0,1)) distance++;
      this.score += distance * 2;
      this.lock();
    }
    lock() {
      for (let r=0; r<this.current.shape.length; r++) {
        for (let c=0; c<this.current.shape[r].length; c++) {
          if (this.current.shape[r][c]) {
            const x = this.current.x + c;
            const y = this.current.y + r;
            if (y < 0) { this.gameOver = true; return; }
            this.grid[y][x] = this.current.color();
          }
        }
      }
      this.clearLines();
      this.fallTimer = 0;
      this.current = this.next;
      this.next = this.nextPiece();
      if (!this.valid(this.current, 0, 0)) this.gameOver = true;
    }
    clearLines() {
      let cleared = 0;
      for (let y = GRID_H-1; y>=0; y--) {
        if (this.grid[y].every(v => v)) {
          this.grid.splice(y,1);
          this.grid.unshift(Array(GRID_W).fill(null));
          cleared++;
          y++;
        }
      }
      if (cleared) {
        this.lines += cleared;
        this.score += [0, 40, 100, 300, 1200][cleared] * this.level;
        this.level = 1 + Math.floor(this.lines / 8);
      }
    }
    ghostOffset() {
      let dy = 0;
      while (this.valid(this.current, 0, dy+1)) dy++;
      return dy;
    }
    update(dt) {
      if (this.gameOver || this.paused) return;
      this.fallTimer += dt;
      if (this.fallTimer >= this.speed()) {
        if (!this.move(0,1)) this.lock();
        this.fallTimer = 0;
      }
    }
  }

  const game = new Game();

  // Camera preview (streamed from controller tablet)
  let cameraFrame = null;
  // Gesture flash: {side:'left'|'right', until:timestamp}
  let gestureFlash = null;

  // DOM refs for overlays and mobile stats
  const goOverlay  = document.getElementById('go-overlay');
  const goScoreEl  = document.getElementById('go-score');
  const mScoreEl   = document.getElementById('m-score');
  const mLevelEl   = document.getElementById('m-level');
  const mLinesEl   = document.getElementById('m-lines');
  const pauseBtn   = document.getElementById('pause-btn');

  function showGameOver() {
    goScoreEl.textContent = String(game.score).padStart(7, '0');
    goOverlay.classList.add('active');
  }
  function hideGameOver() {
    goOverlay.classList.remove('active');
  }

  function drawBlock(x, y, color) {
    const [r, g, b] = color;
    // Main fill (1px inset gives a cell gap)
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
    // Highlight top-left (NES 3D bevel)
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(x + 1, y + 1, CELL - 2, 2);
    ctx.fillRect(x + 1, y + 1, 2, CELL - 2);
    // Shadow bottom-right
    ctx.fillStyle = "rgba(0,0,0,0.50)";
    ctx.fillRect(x + 1, y + CELL - 3, CELL - 2, 2);
    ctx.fillRect(x + CELL - 3, y + 1, 2, CELL - 2);
  }

  function drawGhost(x, y, color) {
    const [r, g, b] = color;
    ctx.strokeStyle = `rgba(${r},${g},${b},0.38)`;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
  }

  function draw() {
    // Re-apply DPR transform every frame (resets on canvas resize)
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // Camera preview background (controller streams JPEG frames)
    if (cameraFrame) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      // Mirror horizontally so the user sees themselves naturally
      ctx.translate(WINDOW_W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(cameraFrame, 0, 0, WINDOW_W, WINDOW_H);
      ctx.restore();
      // Dark overlay to keep game readable over camera feed
      ctx.fillStyle = "rgba(0,0,0,0.80)";
    } else {
      ctx.fillStyle = bgColor;
    }
    ctx.fillRect(0, 0, WINDOW_W, WINDOW_H);

    const boardW = GRID_W * CELL + SIDE_W;
    const boardH = GRID_H * CELL;
    const offsetX = (WINDOW_W - boardW) / 2;
    const offsetY = (WINDOW_H - boardH) / 2;
    const gridX = offsetX;
    const gridY = offsetY;
    const panelX = gridX + GRID_W * CELL + 20;

    // Grid background
    ctx.fillStyle = gridBg;
    ctx.fillRect(gridX, gridY, GRID_W * CELL, GRID_H * CELL);

    // Grid border — NES blue, sharp
    ctx.strokeStyle = "#1c5fe8";
    ctx.lineWidth = 3;
    ctx.strokeRect(gridX - 2, gridY - 2, GRID_W * CELL + 4, GRID_H * CELL + 4);

    // Grid cells + placed blocks
    ctx.strokeStyle = gridLine;
    ctx.lineWidth = 1;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        ctx.strokeRect(gridX + x * CELL, gridY + y * CELL, CELL, CELL);
        if (game.grid[y][x] !== null) drawBlock(gridX + x * CELL, gridY + y * CELL, game.grid[y][x]);
      }
    }

    // Ghost + current piece
    if (!game.gameOver) {
      const ghost = game.ghostOffset();
      for (let r = 0; r < game.current.shape.length; r++)
        for (let c = 0; c < game.current.shape[r].length; c++)
          if (game.current.shape[r][c])
            drawGhost(gridX + (game.current.x + c) * CELL, gridY + (game.current.y + r + ghost) * CELL, game.current.color());
      for (let r = 0; r < game.current.shape.length; r++)
        for (let c = 0; c < game.current.shape[r].length; c++)
          if (game.current.shape[r][c])
            drawBlock(gridX + (game.current.x + c) * CELL, gridY + (game.current.y + r) * CELL, game.current.color());
    }

    // Side panel — NES stats
    if (SHOW_PANEL) {
      let px = panelX;
      let py = gridY + 14;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";

      const lbl = (t) => {
        ctx.font = `9px ${nesFont}`;
        ctx.fillStyle = "#f0f000";
        ctx.fillText(t, px, py);
        py += 17;
      };
      const val = (t) => {
        ctx.font = `11px ${nesFont}`;
        ctx.fillStyle = textColor;
        ctx.fillText(t, px, py);
        py += 30;
      };

      lbl("SCORE");  val(String(game.score).padStart(7, "0"));
      lbl("LEVEL");  val(String(game.level).padStart(2, "0"));
      lbl("LINES");  val(String(game.lines).padStart(3, "0"));
      py += 4;

      // NEXT piece
      lbl("NEXT");
      py += 4;
      for (let r = 0; r < game.next.shape.length; r++)
        for (let c = 0; c < game.next.shape[r].length; c++)
          if (game.next.shape[r][c])
            drawBlock(px + c * CELL, py + r * CELL, game.next.color());
    }

    // Gesture flash — semi-transparent side highlight when a move fires
    const now = performance.now();
    if (gestureFlash && gestureFlash.until > now) {
      const progress = (gestureFlash.until - now) / 450;
      const alpha = Math.min(1, progress) * 0.55;
      const isLeft = gestureFlash.side === 'left';
      const flashX = isLeft ? 0 : gridX + GRID_W * CELL;
      const flashW = isLeft ? gridX : SIDE_W + 20;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#00e88a';
      ctx.fillRect(flashX, 0, flashW, WINDOW_H);
      // Large directional arrow
      ctx.globalAlpha = Math.min(1, alpha * 2.2);
      ctx.font = `bold ${Math.round(CELL * 2.8)}px monospace`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isLeft ? '◀' : '▶', flashX + flashW / 2, WINDOW_H / 2);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }

    // Paused overlay
    if (game.paused) {
      ctx.fillStyle = "rgba(0,0,20,0.78)";
      ctx.fillRect(gridX, gridY, GRID_W * CELL, GRID_H * CELL);
      ctx.font = `12px ${nesFont}`;
      ctx.fillStyle = "#f0f000";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("PAUSED", gridX + (GRID_W * CELL) / 2, gridY + (GRID_H * CELL) / 2);
      ctx.textAlign = "left";
    }

    // Voice overlay — visible on TV when casting
    if (voiceOn) {
      const heard = (Date.now() - lastHeardAt < 2500) ? lastHeard : '';
      const label = heard || '';
      ctx.save();
      ctx.font = `8px ${nesFont}`;
      const tw = ctx.measureText(label).width;
      const bw = tw + 18, bh = 18;
      const bx = gridX + GRID_W * CELL - bw - 4;
      const by = gridY + 4;
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = "#1c5fe8";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillStyle = "#00f000";
      ctx.beginPath();
      ctx.arc(bx + 7, by + bh / 2, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = textColor;
      ctx.textBaseline = "middle";
      ctx.fillText(label, bx + 14, by + bh / 2);
      ctx.restore();
    }
  }

  let last = performance.now();
  let prevGameOver = false;
  function loop(t) {
    const dt = Math.min((t - last) / 1000, 0.25);
    last = t;
    game.update(dt);
    draw();

    // Sync HTML game-over overlay
    if (game.gameOver !== prevGameOver) {
      prevGameOver = game.gameOver;
      if (game.gameOver) showGameOver(); else hideGameOver();
    }

    // Sync mobile stats bar
    if (mScoreEl) mScoreEl.textContent = String(game.score).padStart(7, '0');
    if (mLevelEl) mLevelEl.textContent = String(game.level).padStart(2, '0');
    if (mLinesEl) mLinesEl.textContent = String(game.lines).padStart(3, '0');

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  const handlers = {
    left:   () => { if (!game.paused && !game.gameOver) game.move(-1, 0); },
    right:  () => { if (!game.paused && !game.gameOver) game.move(1, 0); },
    rotate: () => { if (!game.paused && !game.gameOver) game.rotate(); },
    down:   () => { if (!game.paused && !game.gameOver) game.softDrop(); },
    drop:   () => { if (!game.paused && !game.gameOver) game.hardDrop(); },
    pause:  () => { if (!game.gameOver) { game.paused = true;  if (pauseBtn) pauseBtn.textContent = '▶ RESUME'; } },
    resume: () => { if (!game.gameOver) { game.paused = false; if (pauseBtn) pauseBtn.textContent = '⏸ PAUSE'; } },
    togglePause: () => {
      if (game.gameOver) return;
      game.paused = !game.paused;
      if (pauseBtn) pauseBtn.textContent = game.paused ? '▶ RESUME' : '⏸ PAUSE';
    },
    restart: () => { game.reset(); hideGameOver(); prevGameOver = false; lastHeard = ''; lastHeardAt = 0; if (pauseBtn) pauseBtn.textContent = '⏸ PAUSE'; },
  };

  // Allow external injection from Android TV WebView
  window.handleCommand = cmd => handlers[cmd]?.();

  // Mirror bridge — intercept every handler call to broadcast to MiBox
  (() => {
    const _orig = {};
    Object.keys(handlers).forEach(cmd => {
      _orig[cmd] = handlers[cmd];
      handlers[cmd] = (...a) => {
        _orig[cmd](...a);
        try { if (window.AndroidBridge) AndroidBridge.onCommand(cmd); } catch(_) {}
      };
    });
  })();

  document.querySelectorAll("button[data-cmd]").forEach(btn => {
    btn.addEventListener("click", () => handlers[btn.dataset.cmd]?.());
  });
  pauseBtn?.addEventListener('click', () => handlers.togglePause());
  document.getElementById('go-restart')?.addEventListener('click', () => handlers.restart());

  // Web Speech API
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voiceDot = document.getElementById("voice-dot");
  const voiceLabel = document.getElementById("voice-label");
  const toggle = document.getElementById("voice-toggle");
  let recog;
  let voiceOn = false;
  let lastHeard = '';
  let lastHeardAt = 0;
  const logEndpoint = "/log";
  let logEnabled = true;

  function serverLog(message) {
    const msg = `[voice] ${message}`;
    console.log(msg);
    if (!logEnabled) return;
    fetch(logEndpoint, { method: "POST", headers: { "Content-Type": "text/plain" }, body: msg })
      .then((res) => { if (!res.ok) logEnabled = false; })
      .catch(() => { logEnabled = false; });
  }

  function setVoice(state) {
    voiceOn = state;
    voiceDot.style.background = state ? "#58d28c" : "#e17a8c";
    voiceLabel.textContent = `Voice: ${state ? "ON" : "OFF"}`;
    toggle.textContent = state ? "STOP VOICE" : "START VOICE";
  }

  if (SpeechRecognition) {
    setVoice(false);
    recog = new SpeechRecognition();
    recog.lang = "en-US";
    recog.continuous = true;
    recog.interimResults = true;

    const normalizeText = (text) => text
      .replace(/\b(write|rite)\b/g, "right")
      .replace(/\b(rotated|rotating|rotation|turn|spin)\b/g, "rotate")
      .replace(/\bdawn\b/g, "down")
      .replace(/\blift\b/g, "left");

    const heardEl = document.getElementById("voice-heard");

    recog.onresult = (e) => {
      let interimText = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + " ";
        else interimText += e.results[i][0].transcript + " ";
      }
      const rawFinal = finalText.trim();
      const rawInterim = interimText.trim();

      const normFinal = normalizeText(rawFinal.toLowerCase());
      const normInterim = normalizeText(rawInterim.toLowerCase());
      const display = normFinal || normInterim;
      if (display) { serverLog(`heard: ${display}`); lastHeard = display; lastHeardAt = Date.now(); }
      if (heardEl) heardEl.textContent = display;
      if (!rawFinal) return;
      normFinal.split(/\s+/).forEach(token => {
        if (handlers[token]) handlers[token]();
      });
    };

    recog.onstart = () => { serverLog("start"); };
    recog.onerror = (e) => {
      const msg = e?.error ? `voice error: ${e.error}` : "voice error: unknown";
      serverLog(msg);
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        setVoice(false);
      }
    };
    recog.onend = () => { if (voiceOn) recog.start(); };

    toggle.addEventListener("click", () => {
      if (!voiceOn) { setVoice(true); recog.start(); }
      else { setVoice(false); recog.stop(); }
    });

  } else {
    toggle.disabled = true;
    voiceLabel.textContent = "Voice: NOT SUPPORTED";
  }

  // Swipe / touch gesture controls on the game canvas
  {
    let tx, ty, tt;
    canvas.addEventListener('touchstart', e => {
      tx = e.touches[0].clientX;
      ty = e.touches[0].clientY;
      tt = Date.now();
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - tx;
      const dy = e.changedTouches[0].clientY - ty;
      const dist = Math.hypot(dx, dy);
      if (dist < 18 && Date.now() - tt < 220) {
        handlers.rotate();               // tap = rotate
      } else if (Math.abs(dx) >= Math.abs(dy)) {
        if (dx > 35) handlers.right();   // swipe right
        else if (dx < -35) handlers.left(); // swipe left
      } else {
        if (dy > 35) handlers.drop();    // swipe down = hard drop
        else if (dy < -35) handlers.rotate(); // swipe up = rotate
      }
      e.preventDefault();
    }, { passive: false });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.repeat) return;
    const map = {
      ArrowLeft: 'left', ArrowRight: 'right',
      ArrowDown: 'down', ArrowUp: 'rotate',
      ' ': 'drop', z: 'rotate', Z: 'rotate',
      p: 'togglePause', P: 'togglePause', Escape: 'togglePause',
      r: 'restart', R: 'restart',
    };
    if (map[e.key]) { handlers[map[e.key]](); e.preventDefault(); }
  });

  // Cast to TV — show instructions modal (Chrome Tab Cast works on localhost)
  document.getElementById('cast-btn')?.addEventListener('click', () => {
    document.getElementById('cast-modal')?.classList.add('active');
  });

  // Phone controller bridge — called by Android TV WebView injection
  window.receiveSwipe = function(data) {
    if (!data || !data.direction) return;
    const dir = data.direction;
    const map = { left:'left', right:'right', rotate:'rotate', up:'rotate',
                  down:'down', drop:'drop', tap:'rotate', pause:'pause',
                  resume:'resume', restart:'restart' };
    if (map[dir]) handlers[map[dir]]();
  };

  // Piece queue for mirror mode (MiBox receives next-piece names from phone)
  window._pieceQueue = [];
  window.forceNextPiece = name => window._pieceQueue.push(name);

  // Full state snapshot — sent to MiBox when it connects
  window.getGameState = () => JSON.stringify({
    grid: game.grid,
    currentKind: game.current.kind,
    currentShape: game.current.shape,
    currentX: game.current.x,
    currentY: game.current.y,
    nextKind: game.next.kind,
    bag: game.bag,
    score: game.score,
    lines: game.lines,
    level: game.level,
    paused: game.paused,
    gameOver: game.gameOver,
  });

  window.setGameState = json => {
    try {
      const s = (typeof json === 'string') ? JSON.parse(json) : json;
      game.grid = s.grid;
      game.current = new Piece(s.currentKind);
      game.current.shape = s.currentShape;
      game.current.x = s.currentX;
      game.current.y = s.currentY;
      game.next = new Piece(s.nextKind);
      game.bag = s.bag || [];
      game.score = s.score;
      game.lines = s.lines;
      game.level = s.level;
      game.paused = s.paused;
      game.gameOver = s.gameOver;
    } catch(e) { console.error('setGameState error', e); }
  };

  // ── Camera + gesture bridge (called by MainActivity.kt) ──────────────────────
  window.receiveFrame = function(dataUrl) {
    const img = new Image();
    img.onload = function() { cameraFrame = img; };
    img.src = dataUrl;
  };

  window.onGestureFlash = function(side) {
    gestureFlash = { side: side, until: performance.now() + 450 };
  };

  // ── TV overlay (Android TV APK) ───────────────────────────────────────────────
  const tvOverlay  = document.getElementById('tv-overlay');
  const tvSoloBtn  = document.getElementById('tv-solo-btn');
  const tvIpEl     = document.getElementById('tv-ip');
  const tvStatus   = document.getElementById('tv-wait-status');
  const ctrlBadge  = document.getElementById('controller-badge');

  if (tvOverlay) {
    if (window.AndroidBridge && typeof AndroidBridge.getLocalIp === 'function' && tvIpEl) {
      try { tvIpEl.textContent = AndroidBridge.getLocalIp(); } catch(_) {}
    }

    tvSoloBtn?.addEventListener('click', () => {
      tvOverlay.style.display = 'none';
      game.paused = false;
    });

    window.setGamePaused = (paused) => { game.paused = !!paused; };

    window.onControllerConnected = () => {
      tvOverlay.style.display = 'none';
      game.paused = false;
      if (ctrlBadge) ctrlBadge.style.display = '';
      if (tvStatus)  tvStatus.textContent = '✅ Controller connected!';
    };

    window.onControllerDisconnected = () => {
      tvOverlay.style.display = '';
      game.paused = true;
      if (ctrlBadge) ctrlBadge.style.display = 'none';
      if (tvStatus)  tvStatus.textContent = '🔍 Waiting for controller…';
    };
  }
})();
