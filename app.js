// ============================================================
// app.js — SSBU Crew Battle Manager
// Firebase-based networking (no WebRTC)
// ============================================================

// ---------- SHORTCUTS ----------
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function showScreen(screen) {
    $$(".screen").forEach(s => s.classList.add("hide"));
    $(`.screen[data-screen="${screen}"]`).classList.remove("hide");
}

function setStatus(msg) {
    $("#global-status").textContent = msg;
}

// ---------- GLOBAL ----------
let db = firebase.database();
let roomId = null;
let myRole = null;       // "home" or "away"
let isHost = false;

// ---------- STATE ----------
let state = {
    phase: "connection",
    home: { name:"Home", players:[], totalStocks:12, idx:0 },
    away: { name:"Away", players:[], totalStocks:12, idx:0 },
    matchNum: 1,
    previousWinner: null,
    stage: null
};

const STARTERS = [
    "Battlefield","Final Destination","Town & City","Pokémon Stadium 2","Smashville"
];

const COUNTERPICKS = [
    "Kalos Pokémon League","Lylat Cruise","Small Battlefield","Yoshi's Story","Hollow Bastion"
];

const ALL_STAGES = [...STARTERS, ...COUNTERPICKS];

// ---------- DATABASE HELPERS ----------
function write(path, value) {
    return db.ref(`rooms/${roomId}/${path}`).set(value);
}

function update(path, value) {
    return db.ref(`rooms/${roomId}/${path}`).update(value);
}

function listen(path, callback) {
    db.ref(`rooms/${roomId}/${path}`).on("value", snap => {
        if (snap.exists()) callback(snap.val());
    });
}

// ============================================================
// 1. CREATE / JOIN ROOM
// ============================================================

$("#host-btn").addEventListener("click", async () => {
    // generate room id
    roomId = "cb-" + Math.random().toString(36).substring(2, 6);
    $("#room-id").textContent = roomId;

    isHost = true;
    myRole = null;

    // initialize room in DB
    await write("", {
        state,
        roles: { home: null, away: null }
    });

    $("#host-info").classList.remove("hide");
    setStatus("Room created. Waiting…");

    bindRoomListeners();
});

$("#join-btn").addEventListener("click", () => {
    const entered = $("#join-id-input").value.trim();
    if (!entered) return;

    roomId = entered;
    isHost = false;
    myRole = null;

    setStatus("Connecting…");
    bindRoomListeners();
});

// ============================================================
// 2. ROLE SELECTION SCREEN
// ============================================================

function gotoRoleScreen() {
    showScreen("role");
    setStatus("Select Home or Away");
}

function bindRoomListeners() {
    // Listen for room creation
    listen("roles", (roles) => {
        if (!roles) return;

        // Update UI role buttons
        if (roles.home) {
            $("#pick-home").disabled = true;
            $("#pick-home").textContent = `Home (Taken by ${roles.home})`;
        }
        if (roles.away) {
            $("#pick-away").disabled = true;
            $("#pick-away").textContent = `Away (Taken by ${roles.away})`;
        }

        // If both roles chosen → go to roster
        if (roles.home && roles.away) {
            state = state; // unchanged
            gotoRoster();
        }
    });

    // Listen for state updates
    listen("state", (newState) => {
        state = newState;
        restoreUI();
    });

    // After connecting, load role screen
    gotoRoleScreen();
}

// Pick home
$("#pick-home").addEventListener("click", () => {
    if (isHost || true) {  // both host & guest can choose roles
        update("roles", { home: myRole || "Client" });
        myRole = "home";
    }
});

// Pick away
$("#pick-away").addEventListener("click", () => {
    update("roles", { away: myRole || "Client" });
    myRole = "away";
});

// After roles chosen → move automatically
function gotoRoster() {
    state.phase = "roster";
    write("state", state);
    restoreUI();
}


// ============================================================
// 3. ROSTER SETUP
// ============================================================

$("#submit-roster-btn").addEventListener("click", () => {
    const name = $("#my-team-name").value || (myRole === "home" ? "Home Team" : "Away Team");

    let players = [];
    for (let i = 1; i <= 4; i++) {
        players.push({ name: `${name} Player ${i}`, stocks: 3 });
    }

    state[myRole].name = name;
    state[myRole].players = players;

    $("#submit-roster-btn").disabled = true;
    $("#roster-status").textContent = "Ready! Waiting…";

    write("state", state);
});

function checkRosterDone() {
    return state.home.players.length && state.away.players.length;
}


// ============================================================
// 4. RESTORE UI BY PHASE
// ============================================================

function restoreUI() {
    if (state.phase === "connection") return;

    if (state.phase === "roster") {
        showScreen("roster");

        if (state[myRole].players.length) {
            $("#submit-roster-btn").disabled = true;
            $("#roster-status").textContent = "Ready! Waiting…";
        }

        if (checkRosterDone()) {
            state.phase = "scoreboard";
            write("state", state);
        }
        return;
    }

    if (state.phase === "scoreboard") {
        showScreen("scoreboard");
        updateScoreboard();
        return;
    }

    if (state.phase === "stage-select") {
        showScreen("stage-select");
        renderStages();
        return;
    }

    if (state.phase === "report") {
        showScreen("report");
        setupReportUI();
        return;
    }

    if (state.phase === "gameover") {
        showScreen("gameover");
        setupGameoverUI();
        return;
    }
}


// ============================================================
// 5. SCOREBOARD
// ============================================================

function updateScoreboard() {
    $("#disp-home-name").textContent = state.home.name;
    $("#disp-away-name").textContent = state.away.name;

    $("#score-home").textContent = state.home.totalStocks;
    $("#score-away").textContent = state.away.totalStocks;

    const hP = state.home.players[state.home.idx];
    const aP = state.away.players[state.away.idx];

    $("#current-home-player").textContent = hP ? hP.name : "Eliminated";
    $("#stocks-home").textContent = hP ? "●".repeat(hP.stocks) : "";

    $("#current-away-player").textContent = aP ? aP.name : "Eliminated";
    $("#stocks-away").textContent = aP ? "●".repeat(aP.stocks) : "";

    if (myRole === "home") {
        $("#start-stage-select-btn").classList.remove("hide");
        $("#action-text").textContent = "Start Stage Selection";
    } else {
        $("#start-stage-select-btn").classList.add("hide");
        $("#action-text").textContent = "Waiting for Host…";
    }
}

$("#start-stage-select-btn").addEventListener("click", () => {
    state.phase = "stage-select";
    write("state", state);
});


// ============================================================
// 6. STAGE SELECTION
// ============================================================

function renderStages() {
    const isMyTurn = (myRole === "home"); // Simplified depending on match #
    $("#instructions").textContent = isMyTurn ? "Your Turn" : "Waiting for opponent";

    const starters = $("#starter-list");
    const cps = $("#counterpick-list");
    starters.innerHTML = "";
    cps.innerHTML = "";

    for (let s of ALL_STAGES) {
        const btn = document.createElement("button");
        btn.textContent = s;
        btn.className = "stage-btn";

        if (!isMyTurn) btn.disabled = true;

        btn.onclick = () => finalizeStage(s);

        if (STARTERS.includes(s)) starters.appendChild(btn);
        else cps.appendChild(btn);
    }
}

function finalizeStage(stage) {
    state.stage = stage;
    state.phase = "report";
    write("state", state);
}


// ============================================================
// 7. REPORT SCREEN
// ============================================================

function setupReportUI() {
    $("#report-stage-name").textContent = state.stage;

    $("#stock-count-selector").classList.add("hide");
    $$(".report-buttons button").forEach(b => b.classList.remove("hide"));
}

let pendingWinner = null;

$("#btn-home-won").addEventListener("click", () => onWinner("home"));
$("#btn-away-won").addEventListener("click", () => onWinner("away"));

function onWinner(team) {
    pendingWinner = team;
    $$(".report-buttons button").forEach(b => b.classList.add("hide"));
    $("#stock-count-selector").classList.remove("hide");
}

$$(".stock-number-buttons button").forEach(b => {
    b.addEventListener("click", () => {
        const stocksLeft = parseInt(b.dataset.stocks, 10);
        applyGameResult(pendingWinner, stocksLeft);
        write("state", state);
    });
});


// ============================================================
// 8. APPLY RESULT
// ============================================================

function applyGameResult(winner, stocksLeft) {
    const loser = winner === "home" ? "away" : "home";

    const wP = state[winner].players[state[winner].idx];
    const lP = state[loser].players[state[loser].idx];

    const diff = wP.stocks - stocksLeft;
    state[winner].totalStocks -= diff;
    wP.stocks = stocksLeft;

    state[loser].totalStocks -= lP.stocks;
    lP.stocks = 0;
    state[loser].idx++;

    if (state.home.totalStocks <= 0) return endRound("away");
    if (state.away.totalStocks <= 0) return endRound("home");

    state.previousWinner = winner;
    state.matchNum++;
    state.phase = "scoreboard";
}

function endRound(role) {
    state.phase = "gameover";
    state.roundWinner = role;
}


// ============================================================
// 9. GAMEOVER
// ============================================================

function setupGameoverUI() {
    const winnerName = state[state.roundWinner].name;
    $("#winner-banner").textContent = winnerName + " WINS!";

    const homeTaken = 12 - state.home.totalStocks;
    const awayTaken = 12 - state.away.totalStocks;
    $("#final-score-display").textContent = `${homeTaken} – ${awayTaken}`;

    $("#new-match-btn").onclick = () => location.reload();
}
