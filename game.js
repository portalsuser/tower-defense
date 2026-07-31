/* Portal Defense — a small low-poly tower defense game for Portals.to
 * Built with Three.js. Uses the Portals SDK for casual score submission
 * and leaderboard reads (see ./_portals/sdk.js and the Portals docs).
 */

(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------

  const GROUND_W = 18;
  const GROUND_D = 14;
  const BOUND_X = GROUND_W / 2 - 0.7;
  const BOUND_Z = GROUND_D / 2 - 0.7;
  const CORRIDOR_HALF = 1.15; // no-build zone around the path centerline
  const ROAD_HALF_WIDTH = 0.85;
  const TOWER_CLEARANCE = 1.05;

  // Path waypoints in world space (x, z). Enemies walk a straight line
  // between consecutive points.
  const WAYPOINTS = [
    { x: -9, z: -3 },
    { x: -3, z: -3 },
    { x: -3, z: 2 },
    { x: 2, z: 2 },
    { x: 2, z: -2 },
    { x: 6, z: -2 },
    { x: 6, z: 4 },
    { x: 9, z: 4 },
  ];

  const TOWER_DEFS = {
    basic: {
      key: "basic",
      name: "Sentry",
      cost: 50,
      range: 4.2,
      damage: 9,
      fireRate: 1.6, // shots per second
      projectileSpeed: 14,
      color: 0x6ea8ff,
      splash: 0,
    },
    sniper: {
      key: "sniper",
      name: "Longshot",
      cost: 90,
      range: 7.5,
      damage: 32,
      fireRate: 0.65,
      projectileSpeed: 22,
      color: 0xb48cff,
      splash: 0,
    },
    splash: {
      key: "splash",
      name: "Mortar",
      cost: 120,
      range: 3.6,
      damage: 14,
      fireRate: 0.85,
      projectileSpeed: 10,
      color: 0xff9d5c,
      splash: 1.6,
    },
  };

  const START_LIVES = 20;
  const START_GOLD = 100;

  // ---------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------

  const el = {
    canvasWrap: document.getElementById("canvas-wrap"),
    lives: document.getElementById("stat-lives"),
    gold: document.getElementById("stat-gold"),
    wave: document.getElementById("stat-wave"),
    score: document.getElementById("stat-score"),
    toast: document.getElementById("toast"),
    towerBtns: Array.from(document.querySelectorAll(".tower-btn")),
    btnCancel: document.getElementById("btn-cancel"),
    btnStartWave: document.getElementById("btn-start-wave"),
    btnSpeed: document.getElementById("btn-speed"),
    btnSignin: document.getElementById("btn-signin"),
    btnLeaderboard: document.getElementById("btn-leaderboard"),
    overlayStart: document.getElementById("overlay-start"),
    btnPlay: document.getElementById("btn-play"),
    overlayGameover: document.getElementById("overlay-gameover"),
    finalWave: document.getElementById("final-wave"),
    finalScore: document.getElementById("final-score"),
    gameoverStatus: document.getElementById("gameover-status"),
    btnSubmitScore: document.getElementById("btn-submit-score"),
    btnRestart: document.getElementById("btn-restart"),
    overlayLeaderboard: document.getElementById("overlay-leaderboard"),
    leaderboardList: document.getElementById("leaderboard-list"),
    btnCloseLeaderboard: document.getElementById("btn-close-leaderboard"),
  };

  // ---------------------------------------------------------------------
  // Three.js scene setup
  // ---------------------------------------------------------------------

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c1220);
  scene.fog = new THREE.Fog(0x0c1220, 22, 42);

  const camera = new THREE.PerspectiveCamera(
    48,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(0, 15, 12);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  el.canvasWrap.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = 8;
  controls.maxDistance = 26;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minPolarAngle = Math.PI * 0.18;
  controls.target.set(0, 0, 0);
  controls.update();

  // Lights
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x2a3320, 0.8);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d9, 1.1);
  sun.position.set(10, 18, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  sun.shadow.camera.far = 40;
  scene.add(sun);

  // Ground
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x4f9153,
    flatShading: true,
    roughness: 1,
  });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_W, GROUND_D, 1, 1),
    groundMat
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(
    Math.max(GROUND_W, GROUND_D),
    Math.max(GROUND_W, GROUND_D),
    0x2c3a24,
    0x2c3a24
  );
  grid.position.y = 0.011;
  grid.material.opacity = 0.25;
  grid.material.transparent = true;
  scene.add(grid);

  // ---------------------------------------------------------------------
  // Path geometry + math helpers
  // ---------------------------------------------------------------------

  const segments = [];
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const a = WAYPOINTS[i];
    const b = WAYPOINTS[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    segments.push({
      a,
      b,
      length,
      dirX: dx / length,
      dirZ: dz / length,
    });
  }
  const totalPathLength = segments.reduce((s, seg) => s + seg.length, 0);
  const segStartDist = [];
  {
    let acc = 0;
    for (const seg of segments) {
      segStartDist.push(acc);
      acc += seg.length;
    }
  }

  const roadMat = new THREE.MeshStandardMaterial({
    color: 0xcbb489,
    flatShading: true,
    roughness: 1,
  });
  const pathGroup = new THREE.Group();
  scene.add(pathGroup);

  for (const seg of segments) {
    const w = ROAD_HALF_WIDTH * 2;
    const geo = new THREE.BoxGeometry(w, 0.06, seg.length + w);
    const mesh = new THREE.Mesh(geo, roadMat);
    const midX = (seg.a.x + seg.b.x) / 2;
    const midZ = (seg.a.z + seg.b.z) / 2;
    mesh.position.set(midX, 0.03, midZ);
    mesh.rotation.y = Math.atan2(seg.dirX, seg.dirZ);
    mesh.receiveShadow = true;
    pathGroup.add(mesh);
  }

  function distPointToSegment(px, pz, seg) {
    const abx = seg.b.x - seg.a.x;
    const abz = seg.b.z - seg.a.z;
    const apx = px - seg.a.x;
    const apz = pz - seg.a.z;
    const lenSq = abx * abx + abz * abz;
    let t = lenSq > 0 ? (apx * abx + apz * abz) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = seg.a.x + abx * t;
    const cz = seg.a.z + abz * t;
    return Math.hypot(px - cx, pz - cz);
  }

  function isBuildable(x, z) {
    if (x < -BOUND_X || x > BOUND_X || z < -BOUND_Z || z > BOUND_Z) return false;
    for (const seg of segments) {
      if (distPointToSegment(x, z, seg) < CORRIDOR_HALF) return false;
    }
    for (const t of towers) {
      if (Math.hypot(x - t.mesh.position.x, z - t.mesh.position.z) < TOWER_CLEARANCE) {
        return false;
      }
    }
    return true;
  }

  // portal + spawn gate visuals
  function makeRing(color, y) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.14, 8, 20),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.6,
        flatShading: true,
      })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    return ring;
  }

  const spawnPoint = WAYPOINTS[0];
  const exitPoint = WAYPOINTS[WAYPOINTS.length - 1];

  const spawnGate = makeRing(0x3a4b6b, 0.9);
  spawnGate.position.x = spawnPoint.x;
  spawnGate.position.z = spawnPoint.z;
  scene.add(spawnGate);

  const portalRing = makeRing(0x7ad1ff, 0.9);
  portalRing.position.x = exitPoint.x;
  portalRing.position.z = exitPoint.z;
  scene.add(portalRing);

  // Decorative trees / rocks scattered off the path
  const decoGroup = new THREE.Group();
  scene.add(decoGroup);
  {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a34, flatShading: true });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7a44, flatShading: true });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b8f9b, flatShading: true });
    let placed = 0;
    let attempts = 0;
    while (placed < 22 && attempts < 400) {
      attempts++;
      const x = (Math.random() - 0.5) * (GROUND_W - 1.2);
      const z = (Math.random() - 0.5) * (GROUND_D - 1.2);
      let tooClose = false;
      for (const seg of segments) {
        if (distPointToSegment(x, z, seg) < 1.6) { tooClose = true; break; }
      }
      if (tooClose) continue;

      if (Math.random() < 0.75) {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.5, 6), trunkMat);
        trunk.position.y = 0.25;
        const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.1, 6), leafMat);
        leaves.position.y = 1.0;
        trunk.castShadow = true;
        leaves.castShadow = true;
        tree.add(trunk, leaves);
        tree.position.set(x, 0, z);
        tree.scale.setScalar(0.8 + Math.random() * 0.5);
        decoGroup.add(tree);
      } else {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), rockMat);
        rock.position.set(x, 0.18, z);
        rock.rotation.set(Math.random(), Math.random(), Math.random());
        rock.castShadow = true;
        decoGroup.add(rock);
      }
      placed++;
    }
  }

  // Placement ghost (range preview while a tower is selected)
  const ghostRing = new THREE.Mesh(
    new THREE.RingGeometry(0.01, 1, 40),
    new THREE.MeshBasicMaterial({
      color: 0x4f7cff,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    })
  );
  ghostRing.rotation.x = -Math.PI / 2;
  ghostRing.position.y = 0.02;
  ghostRing.visible = false;
  scene.add(ghostRing);

  const ghostTower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.4, 0.6, 8),
    new THREE.MeshBasicMaterial({ color: 0x4f7cff, transparent: true, opacity: 0.5 })
  );
  ghostTower.visible = false;
  scene.add(ghostTower);

  // ---------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------

  const state = {
    lives: START_LIVES,
    gold: START_GOLD,
    wave: 0,
    score: 0,
    waveInProgress: false,
    gameOver: false,
    gameStarted: false,
    timeScale: 1,
    selectedTowerKey: null,
  };

  const towers = [];
  const enemies = [];
  const projectiles = [];
  const fx = [];

  let spawnQueue = 0;
  let spawnTimer = 0;
  let waveEnemyHp = 0;
  let waveEnemySpeed = 1.6;
  let waveEnemyReward = 5;
  let waveEnemyScore = 20;

  function toast(msg, duration = 1600) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.toast.classList.remove("show"), duration);
  }

  function updateHud() {
    el.lives.textContent = state.lives;
    el.gold.textContent = state.gold;
    el.wave.textContent = state.wave;
    el.score.textContent = state.score;
    el.towerBtns.forEach((btn) => {
      const def = TOWER_DEFS[btn.dataset.tower];
      btn.disabled = state.gold < def.cost || state.gameOver;
    });
  }

  // ---------------------------------------------------------------------
  // Enemies
  // ---------------------------------------------------------------------

  function tierColor(wave) {
    if (wave <= 2) return 0x62c370;
    if (wave <= 5) return 0xe0b23f;
    if (wave <= 9) return 0xe07a3f;
    return 0xd6435a;
  }

  function spawnEnemy() {
    const color = tierColor(state.wave);
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.34, 0),
      new THREE.MeshStandardMaterial({ color, flatShading: true })
    );
    body.position.y = 0.34;
    body.castShadow = true;
    group.add(body);

    const eye = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.22, 5),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, flatShading: true })
    );
    eye.rotation.x = Math.PI / 2;
    eye.position.set(0, 0.34, 0.32);
    group.add(eye);

    // health bar
    const barBg = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: 0x1a1a1a, depthTest: false })
    );
    barBg.scale.set(0.62, 0.09, 1);
    barBg.position.y = 0.85;
    barBg.renderOrder = 1;
    group.add(barBg);

    const barFg = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: 0x4ee36b, depthTest: false })
    );
    barFg.scale.set(0.58, 0.06, 1);
    barFg.position.y = 0.85;
    barFg.position.z = 0.001;
    barFg.renderOrder = 2;
    group.add(barFg);

    group.position.set(spawnPoint.x, 0, spawnPoint.z);
    scene.add(group);

    enemies.push({
      mesh: group,
      barFg,
      hp: waveEnemyHp,
      maxHp: waveEnemyHp,
      speed: waveEnemySpeed,
      reward: waveEnemyReward,
      scoreValue: waveEnemyScore,
      segIndex: 0,
      distIntoSeg: 0,
      traveled: 0,
      dead: false,
    });
  }

  function updateEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const en = enemies[i];
      let move = en.speed * dt;
      let leaked = false;

      while (move > 0) {
        const seg = segments[en.segIndex];
        if (!seg) { leaked = true; break; }
        const remaining = seg.length - en.distIntoSeg;
        if (move < remaining) {
          en.distIntoSeg += move;
          en.traveled += move;
          move = 0;
        } else {
          move -= remaining;
          en.traveled += remaining;
          en.segIndex++;
          en.distIntoSeg = 0;
          if (en.segIndex >= segments.length) { leaked = true; break; }
        }
      }

      if (leaked) {
        scene.remove(en.mesh);
        enemies.splice(i, 1);
        state.lives = Math.max(0, state.lives - 1);
        updateHud();
        if (state.lives <= 0) {
          triggerGameOver();
        }
        continue;
      }

      const seg = segments[Math.min(en.segIndex, segments.length - 1)];
      const x = seg.a.x + seg.dirX * en.distIntoSeg;
      const z = seg.a.z + seg.dirZ * en.distIntoSeg;
      en.mesh.position.x = x;
      en.mesh.position.z = z;
      en.mesh.rotation.y = Math.atan2(seg.dirX, seg.dirZ);

      const pct = Math.max(0, en.hp / en.maxHp);
      en.barFg.scale.x = 0.58 * pct;
      en.barFg.position.x = -0.29 * (1 - pct);
      en.barFg.material.color.setHex(pct > 0.5 ? 0x4ee36b : pct > 0.25 ? 0xe0b23f : 0xe0453f);
    }
  }

  function damageEnemy(en, dmg) {
    if (en.dead) return;
    en.hp -= dmg;
    if (en.hp <= 0) {
      en.dead = true;
      state.gold += en.reward;
      state.score += en.scoreValue;
      const idx = enemies.indexOf(en);
      if (idx !== -1) enemies.splice(idx, 1);
      scene.remove(en.mesh);
      updateHud();
    }
  }

  // ---------------------------------------------------------------------
  // Towers
  // ---------------------------------------------------------------------

  function buildTowerMesh(def) {
    const group = new THREE.Group();
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x394356, flatShading: true });
    const accentMat = new THREE.MeshStandardMaterial({ color: def.color, flatShading: true });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.46, 0.3, 8), baseMat);
    base.position.y = 0.15;
    base.castShadow = true;
    group.add(base);

    const turret = new THREE.Group();
    turret.position.y = 0.3;
    group.add(turret);

    if (def.key === "basic") {
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.32, 8), accentMat);
      head.position.y = 0.2;
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.55), accentMat);
      barrel.position.set(0, 0.2, 0.4);
      head.castShadow = true;
      barrel.castShadow = true;
      turret.add(head, barrel);
    } else if (def.key === "sniper") {
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8), accentMat);
      head.position.y = 0.3;
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.9), accentMat);
      barrel.position.set(0, 0.35, 0.55);
      head.castShadow = true;
      barrel.castShadow = true;
      turret.add(head, barrel);
    } else {
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.24, 8), accentMat);
      head.position.y = 0.14;
      const mortar = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), accentMat);
      mortar.position.set(0, 0.36, 0.12);
      mortar.rotation.x = -0.5;
      head.castShadow = true;
      mortar.castShadow = true;
      turret.add(head, mortar);
    }

    group.userData.turret = turret;
    return group;
  }

  function placeTower(key, x, z) {
    const def = TOWER_DEFS[key];
    const mesh = buildTowerMesh(def);
    mesh.position.set(x, 0, z);
    scene.add(mesh);

    towers.push({
      def,
      mesh,
      turret: mesh.userData.turret,
      cooldown: 0,
    });

    state.gold -= def.cost;
    updateHud();
  }

  function findTarget(tower) {
    let best = null;
    let bestProgress = -1;
    for (const en of enemies) {
      const dx = en.mesh.position.x - tower.mesh.position.x;
      const dz = en.mesh.position.z - tower.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= tower.def.range) {
        const progress = segStartDist[en.segIndex] + en.distIntoSeg;
        if (progress > bestProgress) {
          bestProgress = progress;
          best = en;
        }
      }
    }
    return best;
  }

  function spawnProjectile(tower, target) {
    const def = tower.def;
    const geo = def.splash > 0
      ? new THREE.SphereGeometry(0.13, 6, 6)
      : new THREE.SphereGeometry(0.08, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: def.color });
    const mesh = new THREE.Mesh(geo, mat);
    const originY = 0.55;
    mesh.position.set(tower.mesh.position.x, originY, tower.mesh.position.z);
    scene.add(mesh);

    projectiles.push({
      mesh,
      target,
      speed: def.projectileSpeed,
      damage: def.damage,
      splash: def.splash,
      color: def.color,
    });
  }

  function updateTowers(dt) {
    for (const tower of towers) {
      tower.cooldown -= dt;
      const target = findTarget(tower);
      if (target) {
        const dx = target.mesh.position.x - tower.mesh.position.x;
        const dz = target.mesh.position.z - tower.mesh.position.z;
        tower.turret.rotation.y = Math.atan2(dx, dz);

        if (tower.cooldown <= 0) {
          spawnProjectile(tower, target);
          tower.cooldown = 1 / tower.def.fireRate;
        }
      }
    }
  }

  function spawnImpactFx(x, y, z, color, radius) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.02, radius, 20),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.05, z);
    scene.add(ring);
    fx.push({ mesh: ring, life: 0.3, maxLife: 0.3, kind: "ring" });
  }

  function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      const alive = !p.target.dead && enemies.includes(p.target);
      const tx = alive ? p.target.mesh.position.x : p.mesh.position.x;
      const tz = alive ? p.target.mesh.position.z : p.mesh.position.z;
      const ty = alive ? p.target.mesh.position.y + 0.34 : p.mesh.position.y;

      const dx = tx - p.mesh.position.x;
      const dy = ty - p.mesh.position.y;
      const dz = tz - p.mesh.position.z;
      const dist = Math.hypot(dx, dy, dz);
      const step = p.speed * dt;

      if (!alive || dist <= step) {
        if (p.splash > 0) {
          for (const en of enemies) {
            const ex = en.mesh.position.x - p.mesh.position.x;
            const ez = en.mesh.position.z - p.mesh.position.z;
            if (Math.hypot(ex, ez) <= p.splash) {
              damageEnemy(en, p.damage);
            }
          }
          spawnImpactFx(p.mesh.position.x, 0, p.mesh.position.z, p.color, p.splash);
        } else if (alive) {
          damageEnemy(p.target, p.damage);
        }
        scene.remove(p.mesh);
        projectiles.splice(i, 1);
        continue;
      }

      p.mesh.position.x += (dx / dist) * step;
      p.mesh.position.y += (dy / dist) * step;
      p.mesh.position.z += (dz / dist) * step;
    }
  }

  function updateFx(dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.life -= dt;
      if (f.life <= 0) {
        scene.remove(f.mesh);
        fx.splice(i, 1);
        continue;
      }
      const t = 1 - f.life / f.maxLife;
      f.mesh.scale.setScalar(1 + t * 1.4);
      f.mesh.material.opacity = 0.55 * (1 - t);
    }
  }

  // ---------------------------------------------------------------------
  // Waves
  // ---------------------------------------------------------------------

  function startWave() {
    if (state.waveInProgress || state.gameOver) return;
    state.wave += 1;
    state.waveInProgress = true;

    const n = state.wave;
    waveEnemyHp = 18 + n * 9;
    waveEnemySpeed = Math.min(1.6 + n * 0.03, 2.8);
    waveEnemyReward = Math.max(3, Math.round(waveEnemyHp / 9));
    waveEnemyScore = waveEnemyHp;

    spawnQueue = 5 + n * 2;
    spawnTimer = 0;

    el.btnStartWave.disabled = true;
    el.btnStartWave.textContent = `Wave ${n} in progress...`;
    updateHud();
  }

  function updateSpawning(dt) {
    if (spawnQueue <= 0) return;
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnEnemy();
      spawnQueue -= 1;
      spawnTimer = 0.55;
    }
  }

  function checkWaveComplete() {
    if (state.waveInProgress && spawnQueue <= 0 && enemies.length === 0 && !state.gameOver) {
      state.waveInProgress = false;
      const bonus = 20 + state.wave * 6;
      const scoreBonus = 50 + state.wave * 10;
      state.gold += bonus;
      state.score += scoreBonus;
      toast(`Wave ${state.wave} complete! +${bonus}g +${scoreBonus} pts`, 2200);
      el.btnStartWave.disabled = false;
      el.btnStartWave.textContent = `Start Wave ${state.wave + 1}`;
      updateHud();
    }
  }

  // ---------------------------------------------------------------------
  // Input: tower selection + placement
  // ---------------------------------------------------------------------

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let pointerDown = null;

  function setSelectedTower(key) {
    state.selectedTowerKey = key;
    el.towerBtns.forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.tower === key);
    });
    el.btnCancel.style.display = key ? "inline-flex" : "none";
    ghostRing.visible = false;
    ghostTower.visible = false;
    if (key) {
      const def = TOWER_DEFS[key];
      ghostRing.geometry.dispose();
      ghostRing.geometry = new THREE.RingGeometry(def.range - 0.03, def.range, 48);
      ghostTower.material.color.setHex(def.color);
    }
  }

  el.towerBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      if (state.selectedTowerKey === btn.dataset.tower) {
        setSelectedTower(null);
      } else {
        setSelectedTower(btn.dataset.tower);
      }
    });
  });

  el.btnCancel.addEventListener("click", () => setSelectedTower(null));

  function groundPointFromEvent(evt) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObject(ground, false);
    return hits.length ? hits[0].point : null;
  }

  renderer.domElement.addEventListener("pointerdown", (evt) => {
    pointerDown = { x: evt.clientX, y: evt.clientY };
  });

  renderer.domElement.addEventListener("pointermove", (evt) => {
    if (!state.selectedTowerKey || state.gameOver) return;
    const pt = groundPointFromEvent(evt);
    if (!pt) {
      ghostRing.visible = false;
      ghostTower.visible = false;
      return;
    }
    const ok = isBuildable(pt.x, pt.z);
    ghostRing.visible = true;
    ghostTower.visible = true;
    ghostRing.position.set(pt.x, 0.02, pt.z);
    ghostTower.position.set(pt.x, 0.3, pt.z);
    ghostRing.material.color.setHex(ok ? 0x4f7cff : 0xe0453f);
    ghostTower.material.color.setHex(ok ? TOWER_DEFS[state.selectedTowerKey].color : 0xe0453f);
  });

  renderer.domElement.addEventListener("pointerup", (evt) => {
    const dx = pointerDown ? evt.clientX - pointerDown.x : 0;
    const dy = pointerDown ? evt.clientY - pointerDown.y : 0;
    const dragged = Math.hypot(dx, dy) > 6;
    pointerDown = null;
    if (dragged || !state.gameStarted || state.gameOver) return;
    if (!state.selectedTowerKey) return;

    const pt = groundPointFromEvent(evt);
    if (!pt) return;

    const def = TOWER_DEFS[state.selectedTowerKey];
    if (state.gold < def.cost) {
      toast("Not enough gold");
      return;
    }
    if (!isBuildable(pt.x, pt.z)) {
      toast("Can't build there");
      return;
    }
    placeTower(state.selectedTowerKey, pt.x, pt.z);
    setSelectedTower(null);
  });

  // ---------------------------------------------------------------------
  // Buttons: wave, speed, restart
  // ---------------------------------------------------------------------

  el.btnStartWave.addEventListener("click", startWave);

  el.btnSpeed.addEventListener("click", () => {
    state.timeScale = state.timeScale === 1 ? 2 : 1;
    el.btnSpeed.textContent = `${state.timeScale}x`;
  });

  el.btnPlay.addEventListener("click", () => {
    state.gameStarted = true;
    el.overlayStart.classList.add("hidden");
  });

  el.btnRestart.addEventListener("click", () => window.location.reload());

  // ---------------------------------------------------------------------
  // Game over + Portals score submission
  // ---------------------------------------------------------------------

  function triggerGameOver() {
    if (state.gameOver) return;
    state.gameOver = true;
    state.waveInProgress = false;
    setSelectedTower(null);
    el.finalWave.textContent = state.wave;
    el.finalScore.textContent = state.score;
    el.gameoverStatus.textContent = "";
    el.btnSubmitScore.disabled = false;
    el.btnSubmitScore.textContent = "Submit Score";
    el.overlayGameover.classList.remove("hidden");
    updateHud();
  }

  el.btnSubmitScore.addEventListener("click", async () => {
    el.btnSubmitScore.disabled = true;
    el.gameoverStatus.textContent = "Submitting...";
    try {
      let player = await Portals.getPlayer();
      if (!player || !player.playerId) {
        player = await Portals.identity.requestLogin();
      }
      await Portals.submitScore(state.score, "default");
      el.gameoverStatus.textContent = "Score submitted! Check the leaderboard.";
    } catch (err) {
      console.warn(err);
      el.gameoverStatus.textContent = "Couldn't submit score (sign-in required).";
      el.btnSubmitScore.disabled = false;
    }
  });

  // ---------------------------------------------------------------------
  // Leaderboard
  // ---------------------------------------------------------------------

  async function openLeaderboard() {
    el.overlayLeaderboard.classList.remove("hidden");
    el.leaderboardList.innerHTML = `<li class="leaderboard-empty">Loading...</li>`;
    try {
      const board = await Portals.getLeaderboard({ mode: "default", limit: 10 });
      if (!board.entries || board.entries.length === 0) {
        el.leaderboardList.innerHTML = `<li class="leaderboard-empty">No scores yet — be the first!</li>`;
        return;
      }
      el.leaderboardList.innerHTML = "";
      for (const entry of board.entries) {
        const li = document.createElement("li");
        li.innerHTML = `<span class="rank">#${entry.rank}</span><span class="name">${
          entry.displayName || "Player"
        }</span><span class="score">${entry.score}</span>`;
        el.leaderboardList.appendChild(li);
      }
    } catch (err) {
      console.warn(err);
      el.leaderboardList.innerHTML = `<li class="leaderboard-empty">Couldn't load leaderboard.</li>`;
    }
  }

  el.btnLeaderboard.addEventListener("click", openLeaderboard);
  el.btnCloseLeaderboard.addEventListener("click", () => {
    el.overlayLeaderboard.classList.add("hidden");
  });

  // ---------------------------------------------------------------------
  // Portals SDK integration (identity)
  // ---------------------------------------------------------------------

  function updateSignInUI(player) {
    if (player && player.playerId) {
      el.btnSignin.textContent = player.displayName || "Player";
      el.btnSignin.disabled = true;
    } else {
      el.btnSignin.textContent = "Sign in";
      el.btnSignin.disabled = false;
    }
  }

  el.btnSignin.addEventListener("click", async () => {
    try {
      const player = await Portals.identity.requestLogin();
      updateSignInUI(player);
    } catch (err) {
      console.warn("Sign-in not completed", err);
    }
  });

  async function initPortals() {
    try {
      const session = await Portals.ready();
      console.log("Portals context:", session.context);
      if (session.player && session.player.playerId) {
        updateSignInUI(session.player);
      }
      if (Portals.identity && Portals.identity.onChange) {
        Portals.identity.onChange(updateSignInUI);
      }
    } catch (err) {
      console.warn("Portals SDK not available:", err);
    }
  }

  // ---------------------------------------------------------------------
  // Resize + render loop
  // ---------------------------------------------------------------------

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();

  function animate() {
    const rawDt = Math.min(clock.getDelta(), 0.1);
    controls.update();

    portalRing.rotation.z += rawDt * 0.6;
    spawnGate.rotation.z -= rawDt * 0.4;

    if (state.gameStarted && !state.gameOver) {
      const dt = rawDt * state.timeScale;
      updateSpawning(dt);
      updateEnemies(dt);
      updateTowers(dt);
      updateProjectiles(dt);
      updateFx(dt);
      checkWaveComplete();
    } else {
      updateFx(rawDt);
    }

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  updateHud();
  initPortals();
  requestAnimationFrame(animate);
})();
