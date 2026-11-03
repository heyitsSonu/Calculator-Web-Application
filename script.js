"use strict";

/* ==========================================================
   Constants
   ========================================================== */
const MAX_DIGITS = 15;     // longest number a user can type
const PRECISION = 15;      // significant digits kept in results (fixes 0.1 + 0.2)
const HISTORY_LIMIT = 50;  // number of history entries stored
const SYMBOLS = { "+": "+", "-": "−", "*": "×", "/": "÷" };
const STORAGE = { theme: "calc-theme", history: "calc-history" };

/* ==========================================================
   State
   ========================================================== */
const state = {
  current: "0",           // the number being typed or shown (as a string)
  previous: null,         // first operand, stored when an operator is chosen
  operator: null,         // "+", "-", "*" or "/"
  overwrite: true,        // true -> the next digit replaces the current number
  awaitingOperand: false, // true -> an operator was just pressed
  expression: "",         // small line above the display
  error: null,            // error message, or null
};

let calcHistory = [];

/* ==========================================================
   Helpers: numbers and formatting
   ========================================================== */

/** Rounds away floating-point noise, e.g. 0.30000000000000004 -> 0.3 */
function round(n) {
  return Number(n.toPrecision(PRECISION));
}

/** Converts a number to a clean string (no "-0", exponent for huge values). */
function numberToString(n) {
  const r = round(n);
  if (r === 0) return "0";
  if (Math.abs(r) >= 1e15) return r.toExponential(6).replace(/\.?0+e/, "e");
  return String(r);
}

/** Adds thousands separators while keeping a trailing "." or "0" the user typed. */
function formatForDisplay(str) {
  if (str.includes("e")) return str;
  const negative = str.startsWith("-");
  const [intPart, decPart] = (negative ? str.slice(1) : str).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (negative ? "-" : "") + grouped + (decPart !== undefined ? "." + decPart : "");
}

/** Cleans an operand string for the expression line, e.g. "5." -> "5". */
function pretty(str) {
  return formatForDisplay(numberToString(parseFloat(str)));
}

/* ==========================================================
   Core arithmetic
   ========================================================== */

/** Returns { value } on success or { error } for invalid results. */
function calculate(a, b, op) {
  let value;
  switch (op) {
    case "+": value = a + b; break;
    case "-": value = a - b; break;
    case "*": value = a * b; break;
    case "/":
      if (b === 0) return { error: "Cannot divide by zero" };
      value = a / b;
      break;
    default: return { error: "Invalid operation" };
  }
  if (!Number.isFinite(value)) return { error: "Result is too large" };
  return { value: round(value) };
}

/* ==========================================================
   State changes (no DOM access)
   ========================================================== */

function clearAll() {
  state.current = "0";
  state.previous = null;
  state.operator = null;
  state.overwrite = true;
  state.awaitingOperand = false;
  state.expression = "";
  state.error = null;
}

function setError(message, expression) {
  clearAll();
  state.error = message;
  state.expression = expression;
}

function inputDigit(digit) {
  state.awaitingOperand = false;
  if (state.overwrite) {
    state.current = digit;
    state.overwrite = false;
    return;
  }
  const digitCount = state.current.replace(/[-.]/g, "").length;
  if (digitCount >= MAX_DIGITS) return;
  if (state.current === "0") state.current = digit;
  else if (state.current === "-0") state.current = "-" + digit;
  else state.current += digit;
}

function inputDecimal() {
  state.awaitingOperand = false;
  if (state.overwrite) {
    state.current = "0.";
    state.overwrite = false;
  } else if (!state.current.includes(".")) {
    state.current += ".";
  }
}

function deleteLast() {
  if (state.overwrite) return; // results and operands cannot be partially deleted
  const c = state.current;
  const isSingleDigit = c.length === 1 || (c.length === 2 && c.startsWith("-"));
  state.current = isSingleDigit ? "0" : c.slice(0, -1);
}

function toggleSign() {
  if (state.awaitingOperand) {
    // Start a negative second number, e.g. 5 × (−)3
    state.current = "-0";
    state.overwrite = false;
    state.awaitingOperand = false;
  } else if (state.current !== "0") {
    state.current = state.current.startsWith("-") ? state.current.slice(1) : "-" + state.current;
  }
}

function percent() {
  const value = parseFloat(state.current);
  const isAddOrSubtract = state.operator === "+" || state.operator === "-";
  // 200 + 10% means 10% of 200; otherwise % simply divides by 100.
  const result = isAddOrSubtract ? (parseFloat(state.previous) * value) / 100 : value / 100;
  state.current = numberToString(result);
  state.overwrite = true;
  state.awaitingOperand = false;
}

/** Runs previous <operator> current. Returns { expression, result } or null on error. */
function evaluate() {
  const a = parseFloat(state.previous);
  const b = parseFloat(state.current);
  const expression = `${pretty(state.previous)} ${SYMBOLS[state.operator]} ${pretty(state.current)}`;
  const outcome = calculate(a, b, state.operator);

  if (outcome.error) {
    setError(outcome.error, expression + " =");
    return null;
  }
  const result = numberToString(outcome.value);
  addHistory(expression, result);
  return { expression, result };
}

function chooseOperator(op) {
  // Changing your mind: 5 + then × just swaps the operator.
  if (state.operator && state.awaitingOperand) {
    state.operator = op;
    state.expression = `${pretty(state.previous)} ${SYMBOLS[op]}`;
    return;
  }
  // Chained calculation: 2 + 3 then × computes 5 first.
  if (state.operator) {
    const done = evaluate();
    if (!done) return;
    state.current = done.result;
  }
  state.previous = state.current;
  state.operator = op;
  state.overwrite = true;
  state.awaitingOperand = true;
  state.expression = `${pretty(state.previous)} ${SYMBOLS[op]}`;
}

function equals() {
  if (!state.operator) return;
  const done = evaluate();
  if (!done) return;
  state.expression = done.expression + " =";
  state.current = done.result;
  state.previous = null;
  state.operator = null;
  state.overwrite = true;
  state.awaitingOperand = false;
}

/* ==========================================================
   History (stored state + persistence)
   ========================================================== */

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    /* Storage can be blocked (private mode); the app still works without it. */
  }
}

function addHistory(expression, result) {
  calcHistory.unshift({ expression, result });
  calcHistory = calcHistory.slice(0, HISTORY_LIMIT);
  writeStorage(STORAGE.history, calcHistory);
  renderHistory(true);
}

function clearHistory() {
  calcHistory = [];
  writeStorage(STORAGE.history, calcHistory);
  renderHistory(false);
}

/* ==========================================================
   Rendering
   ========================================================== */
const els = {
  display: document.getElementById("display"),
  expression: document.getElementById("expression"),
  keypad: document.getElementById("keypad"),
  historyList: document.getElementById("history-list"),
  historyEmpty: document.getElementById("history-empty"),
  clearHistoryBtn: document.getElementById("clear-history"),
  themeToggle: document.getElementById("theme-toggle"),
};

function render() {
  const text = state.error ?? formatForDisplay(state.current);
  els.display.textContent = text;
  els.display.classList.toggle("is-error", Boolean(state.error));
  els.display.dataset.size = text.length <= 9 ? "lg" : text.length <= 12 ? "md" : text.length <= 16 ? "sm" : "xs";
  els.expression.textContent = state.expression;

  // Highlight the operator that is waiting for a second number.
  els.keypad.querySelectorAll(".key--op").forEach((btn) => {
    btn.classList.toggle("active", state.awaitingOperand && btn.dataset.value === state.operator);
  });
}

function renderHistory(animateNewest) {
  els.historyList.innerHTML = "";
  calcHistory.forEach((entry, i) => {
    const item = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "history-item" + (animateNewest && i === 0 ? " is-new" : "");
    btn.title = "Use this result";
    btn.dataset.index = i;

    const expr = document.createElement("span");
    expr.className = "history-expr";
    expr.textContent = entry.expression + " =";
    const result = document.createElement("span");
    result.className = "history-result";
    result.textContent = formatForDisplay(entry.result);

    btn.append(expr, result);
    item.append(btn);
    els.historyList.append(item);
  });
  els.historyEmpty.hidden = calcHistory.length > 0;
  els.clearHistoryBtn.disabled = calcHistory.length === 0;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  writeStorage(STORAGE.theme, theme);
}

/* ==========================================================
   Input handling
   ========================================================== */
const actions = {
  digit: inputDigit,
  decimal: inputDecimal,
  operator: chooseOperator,
  equals: equals,
  percent: percent,
  sign: toggleSign,
  delete: deleteLast,
  clear: clearAll,
};

/** Runs one calculator action and refreshes the screen. */
function perform(action, value) {
  // After an error, any key resets; digits then start a new number.
  if (state.error && action !== "clear") {
    const startsNumber = action === "digit" || action === "decimal";
    clearAll();
    if (!startsNumber) {
      render();
      return;
    }
  }
  actions[action](value);
  render();
}

function findKey(action, value) {
  const selector = value !== undefined
    ? `[data-action="${action}"][data-value="${value}"]`
    : `[data-action="${action}"]`;
  return els.keypad.querySelector(selector);
}

/** Gives the on-screen key a brief pressed look when a keyboard key is used. */
function flashKey(action, value) {
  const key = findKey(action, value);
  if (!key) return;
  key.classList.add("pressed");
  setTimeout(() => key.classList.remove("pressed"), 130);
}

function handleKeydown(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key;
  let action = null;
  let value;

  if (/^[0-9]$/.test(key)) { action = "digit"; value = key; }
  else if (key === "." || key === ",") action = "decimal";
  else if (["+", "-", "*", "/"].includes(key)) { action = "operator"; value = key; }
  else if (key === "x" || key === "X") { action = "operator"; value = "*"; }
  else if (key === "%") action = "percent";
  else if (key === "Enter" || key === "=") action = "equals";
  else if (key === "Backspace") action = "delete";
  else if (key === "Escape" || key === "Delete") action = "clear";
  else return;

  // Let Enter activate the theme/history buttons when they have focus.
  if (key === "Enter" && event.target.closest(".theme-toggle, .history")) return;

  event.preventDefault(); // stops "/" quick-find and double-firing on a focused key
  perform(action, value);
  flashKey(action, value);
}

/* ==========================================================
   Event wiring and start-up
   ========================================================== */
els.keypad.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-action]");
  if (btn) perform(btn.dataset.action, btn.dataset.value);
});

els.historyList.addEventListener("click", (event) => {
  const btn = event.target.closest(".history-item");
  if (!btn) return;
  const entry = calcHistory[Number(btn.dataset.index)];
  if (!entry) return;
  // Load a past result as the current number.
  state.error = null;
  state.current = entry.result;
  state.overwrite = true;
  state.awaitingOperand = false;
  render();
});

els.clearHistoryBtn.addEventListener("click", clearHistory);

els.themeToggle.addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

document.addEventListener("keydown", handleKeydown);

// Initialise theme (saved choice, else the system preference) and history.
const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
applyTheme(readStorage(STORAGE.theme, prefersLight ? "light" : "dark"));
calcHistory = readStorage(STORAGE.history, []);
if (!Array.isArray(calcHistory)) calcHistory = [];
renderHistory(false);
render();
