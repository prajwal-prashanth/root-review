(function () {
  "use strict";

  var PUZZLES = window.PUZZLES;
  var STORAGE_PREFIX = "root-crossword-";
  var ASSIGNED_KEY = "root-crossword-assigned";
  var VALID = /^[A-Za-z\/]$/;
  var DELTA = { across: [0, 1], down: [1, 0] };

  var el = {
    signin: document.getElementById("signin"),
    nameForm: document.getElementById("name-form"),
    name: document.getElementById("name"),
    puzzle: document.getElementById("puzzle"),
    label: document.getElementById("puzzle-label"),
    grid: document.getElementById("grid"),
    entry: document.getElementById("entry"),
    clue: document.getElementById("current-clue"),
    across: document.getElementById("across"),
    down: document.getElementById("down"),
    clear: document.getElementById("clear"),
  };

  var state = {
    index: 0,
    puzzle: null,
    cells: null, // cells[r][c] = null | { across, down, num, circled, node }
    fills: null, // fills[r][c] = "" | letter
    order: [], // entries in Tab order
    row: 0,
    col: 0,
    dir: "across",
  };

  function cellsOf(entry) {
    var d = DELTA[entry.dir];
    var out = [];
    for (var i = 0; i < entry.len; i++) out.push([entry.row + d[0] * i, entry.col + d[1] * i]);
    return out;
  }

  function cellAt(r, c) {
    var p = state.puzzle;
    if (r < 0 || c < 0 || r >= p.rows || c >= p.cols) return null;
    return state.cells[r][c];
  }

  function activeEntry() {
    var cell = cellAt(state.row, state.col);
    return cell ? cell[state.dir] || cell[other(state.dir)] : null;
  }

  function other(dir) {
    return dir === "across" ? "down" : "across";
  }

  // Assignment: a name always maps to the same crossword, and the result is remembered.

  function normalizeName(name) {
    return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
  }

  // FNV-1a with a murmur3 finalizer, so similar names still spread evenly.
  function hashName(name) {
    var h = 0x811c9dc5;
    for (var i = 0; i < name.length; i++) {
      h ^= name.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  function readAssigned() {
    try {
      var saved = JSON.parse(localStorage.getItem(ASSIGNED_KEY));
      if (saved && saved.index >= 0 && saved.index < PUZZLES.length) return saved;
    } catch (err) {
      // Fall through to asking for a name.
    }
    return null;
  }

  function onNameSubmit(e) {
    e.preventDefault();
    var name = normalizeName(el.name.value);
    if (name.split(" ").length < 2) {
      el.name.setCustomValidity("Enter your first and last name.");
      el.name.reportValidity();
      return;
    }
    if (!confirm("Continue as \"" + el.name.value.trim() + "\"? This can't be changed later.")) return;
    var assigned = { name: name, index: hashName(name) % PUZZLES.length };
    try {
      localStorage.setItem(ASSIGNED_KEY, JSON.stringify(assigned));
    } catch (err) {
      // Without storage the student just re-enters their name next time and gets the same crossword.
    }
    start(assigned.index);
  }

  function start(index) {
    el.signin.hidden = true;
    el.puzzle.hidden = false;
    el.label.hidden = false;
    el.label.textContent = "Crossword " + (index + 1);
    load(index);
  }

  // Building

  function load(index) {
    var p = PUZZLES[index];
    state.index = index;
    state.puzzle = p;
    state.cells = [];
    state.fills = loadFills(index, p);
    for (var r = 0; r < p.rows; r++) {
      state.cells.push(new Array(p.cols).fill(null));
    }
    p.entries.forEach(function (entry) {
      cellsOf(entry).forEach(function (rc, i) {
        var cell = state.cells[rc[0]][rc[1]] || (state.cells[rc[0]][rc[1]] = {});
        cell[entry.dir] = entry;
        if (i === 0) cell.num = entry.num;
      });
    });
    p.circles.forEach(function (rc) {
      state.cells[rc[0]][rc[1]].circled = true;
    });
    state.order = p.entries.filter(function (e) { return e.dir === "across"; })
      .concat(p.entries.filter(function (e) { return e.dir === "down"; }));

    document.title = "Crossword " + (index + 1) + " \u2013 Root Crosswords";

    renderGrid();
    renderClues();
    var first = state.order[0];
    select(first.row, first.col, first.dir);
  }

  function renderGrid() {
    var p = state.puzzle;
    el.grid.innerHTML = "";
    el.grid.style.gridTemplateColumns = "repeat(" + p.cols + ", calc(var(--cell-size) - 1px))";
    el.grid.style.gridTemplateRows = "repeat(" + p.rows + ", calc(var(--cell-size) - 1px))";
    sizeGrid();
    for (var r = 0; r < p.rows; r++) {
      for (var c = 0; c < p.cols; c++) {
        var cell = state.cells[r][c];
        var node = document.createElement("div");
        node.className = "sq";
        if (cell) {
          node.className += " open" + (cell.circled ? " circled" : "");
          node.setAttribute("role", "gridcell");
          node.dataset.r = r;
          node.dataset.c = c;
          if (cell.num) {
            var num = document.createElement("span");
            num.className = "num";
            num.textContent = cell.num;
            node.appendChild(num);
          }
          var ch = document.createElement("span");
          ch.className = "ch";
          ch.textContent = state.fills[r][c];
          node.appendChild(ch);
          cell.node = node;
          cell.chNode = ch;
        }
        el.grid.appendChild(node);
      }
    }
  }

  function renderClues() {
    el.across.innerHTML = "";
    el.down.innerHTML = "";
    state.puzzle.entries.forEach(function (entry) {
      var li = document.createElement("li");
      li.innerHTML = '<span class="n"></span><span class="t"></span>';
      li.firstChild.textContent = entry.num;
      li.lastChild.textContent = entry.clue;
      li.addEventListener("click", function () {
        var target = firstEmpty(entry) || [entry.row, entry.col];
        select(target[0], target[1], entry.dir);
        focusEntry();
      });
      entry.li = li;
      (entry.dir === "across" ? el.across : el.down).appendChild(li);
    });
  }

  function sizeGrid() {
    var p = state.puzzle;
    var avail = window.innerWidth <= 860
      ? window.innerWidth - 32
      : Math.min(620, window.innerWidth * 0.58);
    var size = Math.max(18, Math.min(36, Math.floor(avail / p.cols)));
    el.grid.style.setProperty("--cell-size", size + "px");
  }

  // Selection and highlighting

  function select(r, c, dir) {
    var cell = cellAt(r, c);
    if (!cell) return;
    if (!cell[dir]) dir = other(dir);
    state.row = r;
    state.col = c;
    state.dir = dir;
    paint();
  }

  function paint() {
    var entry = activeEntry();
    var inWord = {};
    cellsOf(entry).forEach(function (rc) { inWord[rc[0] + ":" + rc[1]] = true; });
    var p = state.puzzle;
    for (var r = 0; r < p.rows; r++) {
      for (var c = 0; c < p.cols; c++) {
        var cell = state.cells[r][c];
        if (!cell) continue;
        cell.node.classList.toggle("in-word", !!inWord[r + ":" + c]);
        cell.node.classList.toggle("active", r === state.row && c === state.col);
      }
    }
    p.entries.forEach(function (e) {
      e.li.classList.toggle("active", e === entry);
      e.li.classList.toggle("filled", !firstEmpty(e));
    });
    el.clue.innerHTML = "<strong></strong><span></span>";
    el.clue.firstChild.textContent = entry.num + " " + (entry.dir === "across" ? "Across" : "Down");
    el.clue.lastChild.textContent = entry.clue;
  }

  function firstEmpty(entry) {
    var cells = cellsOf(entry);
    for (var i = 0; i < cells.length; i++) {
      if (!state.fills[cells[i][0]][cells[i][1]]) return cells[i];
    }
    return null;
  }

  // Editing

  function setFill(r, c, value) {
    state.fills[r][c] = value;
    state.cells[r][c].chNode.textContent = value;
    saveFills();
  }

  function step(n) {
    var d = DELTA[state.dir];
    var r = state.row + d[0] * n;
    var c = state.col + d[1] * n;
    var cell = cellAt(r, c);
    if (cell && cell[state.dir] === activeEntry()) {
      state.row = r;
      state.col = c;
      return true;
    }
    return false;
  }

  function type(ch) {
    setFill(state.row, state.col, ch.toUpperCase());
    step(1);
    paint();
  }

  function backspace() {
    if (state.fills[state.row][state.col]) {
      setFill(state.row, state.col, "");
    } else if (step(-1)) {
      setFill(state.row, state.col, "");
    }
    paint();
  }

  function move(dr, dc) {
    var dir = dr === 0 ? "across" : "down";
    var cur = cellAt(state.row, state.col);
    if (state.dir !== dir && cur[dir]) {
      select(state.row, state.col, dir);
      return;
    }
    var r = state.row + dr;
    var c = state.col + dc;
    var p = state.puzzle;
    while (r >= 0 && c >= 0 && r < p.rows && c < p.cols) {
      if (state.cells[r][c]) {
        select(r, c, dir);
        return;
      }
      r += dr;
      c += dc;
    }
  }

  function jump(n) {
    var i = state.order.indexOf(activeEntry());
    var next = state.order[(i + n + state.order.length) % state.order.length];
    var target = firstEmpty(next) || [next.row, next.col];
    select(target[0], target[1], next.dir);
  }

  function focusEntry() {
    el.entry.focus({ preventScroll: true });
    resetEntry();
  }

  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var handled = true;
    switch (e.key) {
      case "ArrowLeft": move(0, -1); break;
      case "ArrowRight": move(0, 1); break;
      case "ArrowUp": move(-1, 0); break;
      case "ArrowDown": move(1, 0); break;
      case "Backspace":
      case "Delete": backspace(); break;
      case "Tab": jump(e.shiftKey ? -1 : 1); break;
      case "Enter": jump(1); break;
      case " ": select(state.row, state.col, other(state.dir)); break;
      default:
        if (VALID.test(e.key)) type(e.key);
        else handled = false;
    }
    if (handled) e.preventDefault();
  }

  // Mobile keyboards often send keydown with key "Unidentified", so read from input events too.
  // The input always holds one placeholder space so a mobile backspace has something to delete.
  function onInput() {
    var value = el.entry.value;
    resetEntry();
    if (value === "") {
      backspace();
      return;
    }
    for (var i = 0; i < value.length; i++) {
      if (VALID.test(value[i])) type(value[i]);
    }
  }

  function resetEntry() {
    el.entry.value = " ";
    el.entry.setSelectionRange(1, 1);
  }

  function onGridClick(e) {
    var node = e.target.closest(".sq.open");
    if (!node) return;
    var r = Number(node.dataset.r);
    var c = Number(node.dataset.c);
    if (r === state.row && c === state.col) {
      select(r, c, other(state.dir));
    } else {
      select(r, c, state.dir);
    }
    focusEntry();
  }

  // Storage

  function loadFills(index, p) {
    var saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_PREFIX + (index + 1)));
    } catch (err) {
      saved = null;
    }
    var fills = [];
    for (var r = 0; r < p.rows; r++) {
      var row = [];
      for (var c = 0; c < p.cols; c++) {
        row.push(saved && saved[r] && typeof saved[r][c] === "string" ? saved[r][c] : "");
      }
      fills.push(row);
    }
    return fills;
  }

  function saveFills() {
    try {
      localStorage.setItem(STORAGE_PREFIX + (state.index + 1), JSON.stringify(state.fills));
    } catch (err) {
      // Storage can be unavailable (private mode); progress just won't persist.
    }
  }

  function clearPuzzle() {
    if (!confirm("Clear every square in crossword " + (state.index + 1) + "?")) return;
    var p = state.puzzle;
    for (var r = 0; r < p.rows; r++) {
      for (var c = 0; c < p.cols; c++) {
        if (state.cells[r][c]) setFill(r, c, "");
      }
    }
    var first = state.order[0];
    select(first.row, first.col, first.dir);
  }

  var assigned = readAssigned();
  if (assigned) start(assigned.index);
  else el.name.focus();

  el.nameForm.addEventListener("submit", onNameSubmit);
  el.name.addEventListener("input", function () {
    el.name.setCustomValidity("");
  });
  window.addEventListener("resize", function () {
    if (state.puzzle) sizeGrid();
  });
  el.grid.addEventListener("click", onGridClick);
  el.entry.addEventListener("keydown", onKeyDown);
  el.entry.addEventListener("input", onInput);
  el.clear.addEventListener("click", clearPuzzle);
})();
