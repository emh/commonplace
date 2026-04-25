import {
  createCard,
  createVocabCard,
  formatCardTimestamp,
  parseKindleHighlight,
  sortCardsDescending
} from "./model.js";
import { hydrateSnapshot, loadAppState, loadSettings, saveAppState } from "./storage.js";
import { CommonplaceSync, nextClock, observeClock } from "./sync.js";

const loadedState = loadAppState();
const state = {
  settings: loadSettings(),
  cards: loadedState.cards,
  deviceId: loadedState.deviceId,
  clock: loadedState.clock,
  sync: loadedState.sync,
  syncStatus: loadedState.sync.code ? "ready" : "local"
};

const $ = (id) => document.getElementById(id);
const form = $("card-form");
const input = $("card-input");
const sourceInput = $("source-input");
const sourceSuggestions = $("source-suggestions");
const saveButton = $("save-card-btn");
const cardList = $("card-list");
const toastEl = $("toast");

let toastTimer;
let parsedSourceCache = null;
let expandedArticle = null;
const cardConversations = new Map();

const syncClient = new CommonplaceSync({
  settings: state.settings,
  deviceId: state.deviceId,
  code: state.sync.code,
  getVersion: () => state.sync.stateVersion,
  getSnapshot: () => ({ cards: state.cards }),
  applyRemote: (snapshot, version) => {
    const hydrated = hydrateSnapshot(snapshot);
    state.cards = hydrated.cards;
    state.clock = observeClock(state.clock, version);
    state.sync.stateVersion = version;
    persist(false);
    render();
  },
  onStatus: (status) => {
    state.syncStatus = status;
    renderSyncStatus();
  },
  onError: (message) => {
    if (message) {
      toast(message);
    }
  }
});

function persist(markChange = true) {
  if (markChange) {
    const next = nextClock(state.clock, state.deviceId);
    state.clock = next.clock;
    state.sync.stateVersion = next.version;
  }

  saveAppState({
    cards: state.cards,
    deviceId: state.deviceId,
    clock: state.clock,
    sync: state.sync
  });

  syncClient.flush();
}

function render() {
  renderComposerState();
  renderCards();
  renderSyncStatus();
  renderSourceSuggestions();
}

function renderComposerState() {
  const trimmed = input.value.trim();
  saveButton.disabled = trimmed.length === 0;

  if (!trimmed) {
    return;
  }
}

function renderCards() {
  cardList.innerHTML = "";

  if (state.cards.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No cards yet. Save the first one above and it will appear here.";
    cardList.appendChild(empty);
    return;
  }

  state.cards.forEach((card, index) => {
    const article = document.createElement("article");
    article.className = "card";
    article.style.animationDelay = `${Math.min(index * 40, 160)}ms`;

    const meta = document.createElement("div");
    meta.className = "card-meta";

    const stamp = document.createElement("span");
    stamp.textContent = formatCardTimestamp(card.createdAt);
    meta.append(stamp);

    const body = document.createElement("div");
    body.className = "card-body";

    if (card.type === "vocab") {
      const head = document.createElement("div");
      head.className = "card-vocab-head";

      const wordEl = document.createElement("span");
      wordEl.className = "card-vocab-word";
      wordEl.textContent = card.word;
      head.appendChild(wordEl);

      if (card.phonetic) {
        const phonEl = document.createElement("span");
        phonEl.className = "card-vocab-phonetic";
        phonEl.textContent = card.phonetic;
        head.appendChild(phonEl);
      }

      body.appendChild(head);

      if (card.partOfSpeech) {
        const posEl = document.createElement("p");
        posEl.className = "card-vocab-pos";
        posEl.textContent = card.partOfSpeech;
        body.appendChild(posEl);
      }

      const defEl = document.createElement("p");
      defEl.className = "card-vocab-definition";
      defEl.textContent = card.definition;
      body.appendChild(defEl);
    } else {
      const text = document.createElement("p");
      text.className = "card-text";
      text.textContent = card.content;
      body.appendChild(text);

      const { title: srcTitle, page: srcPage } = card.source || {};
      const sourceLabel = srcTitle
        ? (srcPage ? `${srcTitle}, p. ${srcPage}` : srcTitle)
        : "";
      if (sourceLabel) {
        const sourceEl = document.createElement("p");
        sourceEl.className = "card-source";
        sourceEl.textContent = sourceLabel;
        body.appendChild(sourceEl);
      }
    }

    article.append(meta, body);

    article.addEventListener("click", (event) => {
      if (event.target.closest(".card-conversation")) return;
      if (window.getSelection()?.toString()) return;
      toggleCard(article, card);
    });

    cardList.appendChild(article);
  });
}

function toggleCard(article, card) {
  if (article.classList.contains("expanded")) {
    collapseCard(article);
  } else {
    if (expandedArticle) collapseCard(expandedArticle);
    expandCard(article, card);
  }
}

function expandCard(article, card) {
  expandedArticle = article;
  article.classList.add("expanded");

  const conversation = document.createElement("div");
  conversation.className = "card-conversation";

  const thread = document.createElement("div");
  thread.className = "conversation-thread";

  const prior = cardConversations.get(card.id);
  if (prior) {
    for (const msg of prior.messages) {
      appendThreadMessage(thread, msg.question, msg.answer, false);
    }
  }

  conversation.appendChild(thread);

  const inputRow = document.createElement("div");
  inputRow.className = "conversation-input-row";

  const convoInput = document.createElement("input");
  convoInput.type = "text";
  convoInput.className = "conversation-input";
  convoInput.placeholder = "ask something...";
  convoInput.autocomplete = "off";

  convoInput.addEventListener("keydown", async (event) => {
    if (event.key === "Escape") {
      collapseCard(article);
      return;
    }
    if (event.key !== "Enter") return;

    const question = convoInput.value.trim();
    if (!question) return;

    convoInput.value = "";
    convoInput.disabled = true;

    const history = cardConversations.get(card.id)?.messages || [];
    const qEl = appendThreadMessage(thread, question, null, true);
    qEl.scrollIntoView({ behavior: "smooth", block: "nearest" });

    try {
      const answer = await askStudyPartner(card, question, history);
      qEl.nextElementSibling.textContent = answer;
      qEl.nextElementSibling.classList.remove("loading");

      if (!cardConversations.has(card.id)) cardConversations.set(card.id, { messages: [] });
      cardConversations.get(card.id).messages.push({ question, answer });
    } catch (err) {
      qEl.nextElementSibling.textContent = err.message || "Something went wrong.";
      qEl.nextElementSibling.classList.remove("loading");
      qEl.nextElementSibling.classList.add("error");
    } finally {
      convoInput.disabled = false;
      convoInput.focus();
    }
  });

  inputRow.appendChild(convoInput);
  conversation.appendChild(inputRow);
  article.appendChild(conversation);

  requestAnimationFrame(() => convoInput.focus());
}

function collapseCard(article) {
  article.classList.remove("expanded");
  article.querySelector(".card-conversation")?.remove();
  if (expandedArticle === article) expandedArticle = null;
}

function appendThreadMessage(thread, question, answer, loading) {
  const qEl = document.createElement("p");
  qEl.className = "conversation-question";
  qEl.textContent = question;
  thread.appendChild(qEl);

  const aEl = document.createElement("p");
  aEl.className = loading ? "conversation-answer loading" : "conversation-answer";
  aEl.textContent = loading ? "..." : (answer || "");
  thread.appendChild(aEl);

  return qEl;
}

function buildSourceText(source) {
  if (!source?.title) return "";
  let text = source.title;
  if (source.subtitle) text += `: ${source.subtitle}`;
  if (source.author) text += ` by ${source.author}`;
  return text;
}

async function askStudyPartner(card, question, history) {
  const { studyBaseUrl } = state.settings;
  if (!studyBaseUrl) throw new Error("Study worker is not configured");

  const quote = card.type === "vocab"
    ? `Definition of "${card.word}": ${card.definition}`
    : card.content;
  const source = card.type === "vocab" ? "" : buildSourceText(card.source);

  const response = await fetch(`${studyBaseUrl}/api/study`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quote,
      source,
      question,
      history
    })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  const data = await response.json();
  if (!data.answer) throw new Error("No answer received");
  return data.answer;
}

function renderSyncStatus() {
}

function renderSourceSuggestions() {
  const seen = new Map();
  for (const card of state.cards) {
    const title = card.source?.title;
    if (title && !seen.has(title)) seen.set(title, card.source);
  }
  sourceSuggestions.innerHTML = "";
  for (const title of [...seen.keys()].sort((a, b) => a.localeCompare(b))) {
    const option = document.createElement("option");
    option.value = title;
    sourceSuggestions.appendChild(option);
  }
}


function resolveSource(inputValue) {
  const trimmed = inputValue.trim();
  if (!trimmed) return null;

  // Strip optional page suffix: "Title, p123" / "Title, p. 123" / "Title p123"
  const pageMatch = trimmed.match(/^(.*?),?\s*p\.?\s*(\d+)$/i);
  const titlePart = pageMatch ? pageMatch[1].trim() : trimmed;
  const page = pageMatch ? pageMatch[2] : "";

  if (!titlePart) return null;

  // Look up existing source by title to recover author/subtitle
  const lower = titlePart.toLowerCase();
  const existing = state.cards.find((c) => c.source?.title?.toLowerCase() === lower)?.source;

  return existing
    ? { ...existing, page }
    : { title: titlePart, subtitle: "", author: "", page };
}

async function submitCard() {
  const content = input.value.trim();
  if (!content) return;

  if (isSingleWord(content) && !sourceInput.value.trim()) {
    saveButton.disabled = true;
    input.disabled = true;
    try {
      const vocabData = await fetchDefinition(content);
      const card = createVocabCard(vocabData);
      state.cards = sortCardsDescending([card, ...state.cards]);
      persist(true);
      input.value = "";
      autoResize();
      render();
      input.focus();
      toast(`${vocabData.word} defined`);
    } catch (err) {
      toast(err.message || "word not found");
      saveButton.disabled = false;
      input.disabled = false;
      renderComposerState();
    }
    return;
  }

  const source = parsedSourceCache || resolveSource(sourceInput.value);
  parsedSourceCache = null;

  state.cards = sortCardsDescending([createCard({ content, source }), ...state.cards]);
  persist(true);
  input.value = "";
  sourceInput.value = "";
  autoResize();
  render();
  input.focus();
  toast("card saved");
}

function isSingleWord(text) {
  return /^[a-zA-Z][-a-zA-Z]*$/.test(text.trim()) && text.trim().length >= 2;
}

async function fetchDefinition(word) {
  const response = await fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
  );
  if (!response.ok) {
    throw new Error(`"${word}" not found in dictionary`);
  }
  const entries = await response.json();
  const entry = entries[0];
  const phonetic = entry.phonetics?.find((p) => p.text)?.text || entry.phonetic || "";
  const meaning = entry.meanings?.[0];
  const partOfSpeech = meaning?.partOfSpeech || "";
  const definition = meaning?.definitions?.[0]?.definition || "";
  if (!definition) throw new Error(`No definition found for "${word}"`);
  return { word: entry.word || word, partOfSpeech, phonetic, definition };
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove("visible");
  }, 1800);
}

function autoResize() {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
}

function handleInput() {
  autoResize();
  renderComposerState();
}

function handleKeydown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    submitCard();
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  if (globalThis.location?.protocol === "file:") {
    return;
  }

  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch {
    // Offline support is best-effort during early scaffolding.
  }
}

function attachEvents() {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCard();
  });

  input.addEventListener("input", handleInput);
  input.addEventListener("keydown", handleKeydown);
  input.addEventListener("paste", handlePaste);

  sourceInput.addEventListener("input", () => {
    parsedSourceCache = null;
  });
}

function handlePaste(event) {
  const text = event.clipboardData?.getData("text/plain") || "";
  const parsed = parseKindleHighlight(text);
  if (!parsed) return;

  event.preventDefault();
  input.value = parsed.content;
  const { title, page } = parsed.source;
  sourceInput.value = page ? `${title}, p. ${page}` : title;
  parsedSourceCache = parsed.source;
  autoResize();
  renderComposerState();
}

function init() {
  attachEvents();
  autoResize();
  render();
  syncClient.start(state.sync.code);
  registerServiceWorker();
}

init();
