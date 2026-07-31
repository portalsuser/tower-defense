/**
 * LOCAL DEV MOCK of the Portals SDK.
 *
 * When this game is uploaded to Portals, Portals injects its own real
 * "./_portals/sdk.js" and overwrites this file — do not rely on this
 * mock's internals from game code, only use the public Portals.* API
 * documented at https://portals.to/documentation/advanced-tooling/portals-sdk
 *
 * This mock exists purely so the game can be opened and fully tested
 * (sign-in, saved state, leaderboard) outside of Portals, e.g. by
 * double-clicking index.html. It fakes sign-in with a name prompt and
 * stores state/scores in localStorage.
 */
(function () {
  const LS_PLAYER = "portals_mock_player";
  const LS_STATE_PREFIX = "portals_mock_state_";
  const LS_SCORES_PREFIX = "portals_mock_scores_";

  let currentPlayer = loadPlayer();
  const listeners = new Set();

  function loadPlayer() {
    try {
      const raw = localStorage.getItem(LS_PLAYER);
      return raw ? JSON.parse(raw) : { playerId: null, displayName: null };
    } catch (e) {
      return { playerId: null, displayName: null };
    }
  }

  function persistPlayer(player) {
    currentPlayer = player;
    try {
      localStorage.setItem(LS_PLAYER, JSON.stringify(player));
    } catch (e) {}
    listeners.forEach((fn) => {
      try { fn(currentPlayer); } catch (e) {}
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randomId() {
    return "mock-" + Math.random().toString(36).slice(2, 10);
  }

  const Portals = {
    async ready() {
      await delay(150);
      return {
        context: "standalone",
        player: { ...currentPlayer },
      };
    },

    async getPlayer() {
      await delay(30);
      return { ...currentPlayer };
    },

    identity: {
      async requestLogin() {
        await delay(200);
        const name = window.prompt(
          "[Local mock sign-in] Enter a display name to play as:",
          currentPlayer.displayName || "Player"
        );
        if (!name) {
          throw new Error("Sign-in was cancelled");
        }
        const player = {
          playerId: currentPlayer.playerId || randomId(),
          displayName: name.trim().slice(0, 24) || "Player",
        };
        persistPlayer(player);
        return { ...player };
      },

      onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },

    async saveState(data) {
      await delay(80);
      if (!currentPlayer.playerId) {
        throw new Error("Cannot save state: player is not signed in");
      }
      const json = JSON.stringify(data);
      if (new Blob([json]).size > 64 * 1024) {
        throw new Error("State exceeds 64KB limit");
      }
      localStorage.setItem(LS_STATE_PREFIX + currentPlayer.playerId, json);
      return true;
    },

    async loadState() {
      await delay(60);
      if (!currentPlayer.playerId) return null;
      const raw = localStorage.getItem(LS_STATE_PREFIX + currentPlayer.playerId);
      return raw ? JSON.parse(raw) : null;
    },

    async submitScore(score, mode) {
      await delay(100);
      if (!currentPlayer.playerId) {
        throw new Error("Cannot submit score: player is not signed in");
      }
      const m = (mode || "default").toLowerCase();
      const key = LS_SCORES_PREFIX + m;
      let board = [];
      try {
        board = JSON.parse(localStorage.getItem(key) || "[]");
      } catch (e) {
        board = [];
      }
      const existing = board.find((e) => e.playerId === currentPlayer.playerId);
      if (existing) {
        if (score > existing.score) existing.score = score;
      } else {
        board.push({
          playerId: currentPlayer.playerId,
          displayName: currentPlayer.displayName,
          avatarUrl: null,
          score,
        });
      }
      localStorage.setItem(key, JSON.stringify(board));
      return true;
    },

    async getLeaderboard(options) {
      await delay(80);
      const opts = options || {};
      const mode = (opts.mode || "default").toLowerCase();
      const limit = Math.min(Math.max(opts.limit || 10, 1), 100);
      let board = [];
      try {
        board = JSON.parse(localStorage.getItem(LS_SCORES_PREFIX + mode) || "[]");
      } catch (e) {
        board = [];
      }
      board.sort((a, b) => b.score - a.score);
      const entries = board.slice(0, limit).map((e, i) => ({
        rank: i + 1,
        playerId: e.playerId,
        displayName: e.displayName,
        avatarUrl: e.avatarUrl || null,
        score: e.score,
      }));
      return { entries };
    },

    quit() {
      console.log("[Portals mock] quit() called — host would close the game here.");
      alert("Thanks for playing! (In Portals, this would return you to the host.)");
    },
  };

  window.Portals = Portals;
})();
