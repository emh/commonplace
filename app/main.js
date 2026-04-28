import {
  createCard,
  createCardNote,
  createVocabCard,
  formatCardTimestamp,
  parseKindleHighlight,
  sortCardsDescending
} from "./model.js";

const ICON_PENCIL = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>`;
const ICON_TRASH = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const ICON_PLUS = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>`;
const ICON_QUESTION = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>`;
const ICON_SHARE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/></svg>`;
import { hydrateSnapshot, loadAppState, loadSettings, saveAppState } from "./storage.js";
import { CommonplaceSync, buildDeviceLink, createLinkRoom, nextClock, normalizeCode, observeClock } from "./sync.js";

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
const linkBtn = $("link-btn");
const linkPanel = $("link-panel");
const linkPanelInner = $("link-panel-inner");
const syncDot = $("sync-dot");
const input = $("card-input");
const sourceInput = $("source-input");
const sourceSuggestions = $("source-suggestions");
const saveButton = $("save-card-btn");
const searchInput = $("search-input");
const statsEl = $("card-stats");
const cardList = $("card-list");
const toastEl = $("toast");

let toastTimer;
let parsedSourceCache = null;
let expandedArticle = null;
let pendingExpandCardId = null;
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

function countUniqueSources(cards) {
  const seen = new Set();
  for (const card of cards) {
    if (card.type === "note" && card.source?.title) seen.add(card.source.title.toLowerCase());
  }
  return seen.size;
}

function renderStats(visible, all, filtering) {
  const totalNotes = all.filter((c) => c.type === "note").length;
  const totalDefs = all.filter((c) => c.type === "vocab").length;
  const totalSources = countUniqueSources(all);

  if (!filtering) {
    const parts = [];
    if (totalNotes > 0) parts.push(`${totalNotes} ${totalNotes === 1 ? "note" : "notes"}`);
    if (totalSources > 0) parts.push(`${totalSources} ${totalSources === 1 ? "source" : "sources"}`);
    if (totalDefs > 0) parts.push(`${totalDefs} ${totalDefs === 1 ? "definition" : "definitions"}`);
    statsEl.textContent = parts.join(", ");
    return;
  }

  const visNotes = visible.filter((c) => c.type === "note").length;
  const visDefs = visible.filter((c) => c.type === "vocab").length;
  const visSources = countUniqueSources(visible);

  const parts = [];
  if (totalNotes > 0) parts.push(`${visNotes}/${totalNotes} notes`);
  if (totalSources > 0) parts.push(`${visSources}/${totalSources} sources`);
  if (totalDefs > 0) parts.push(`${visDefs}/${totalDefs} definitions`);
  statsEl.textContent = parts.join(", ");
}

function cardMatchesQuery(card, query) {
  const q = query.toLowerCase();
  const fields = card.type === "vocab"
    ? [card.word, card.definition, card.partOfSpeech]
    : [card.content, card.source?.title, card.source?.author, card.source?.subtitle];

  if (fields.some((f) => f?.toLowerCase().includes(q))) return true;

  if (card.notes) {
    for (const note of card.notes) {
      if (note.content.toLowerCase().includes(q)) return true;
    }
  }

  const convo = cardConversations.get(card.id);
  if (convo) {
    for (const msg of convo.messages) {
      if (msg.question.toLowerCase().includes(q)) return true;
      if (msg.answer.toLowerCase().includes(q)) return true;
    }
  }
  return false;
}

function renderCards() {
  cardList.innerHTML = "";

  const query = searchInput.value.trim();
  const visibleCards = query
    ? state.cards.filter((card) => cardMatchesQuery(card, query))
    : state.cards;

  renderStats(visibleCards, state.cards, query.length > 0);

  if (state.cards.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No cards yet. Save the first one above and it will appear here.";
    cardList.appendChild(empty);
    return;
  }

  if (visibleCards.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No cards match your search.";
    cardList.appendChild(empty);
    return;
  }

  visibleCards.forEach((card, index) => {
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
      renderCardContent(body, card.content);

      const { title: srcTitle, page: srcPage, url: srcUrl } = card.source || {};
      const sourceLabel = srcTitle
        ? (srcPage ? `${srcTitle}, p. ${srcPage}` : srcTitle)
        : "";
      if (sourceLabel) {
        const sourceEl = document.createElement("p");
        sourceEl.className = "card-source";
        if (srcUrl) {
          const link = document.createElement("a");
          link.href = srcUrl;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = sourceLabel;
          link.addEventListener("click", (e) => e.stopPropagation());
          sourceEl.appendChild(link);
        } else {
          sourceEl.textContent = sourceLabel;
        }
        body.appendChild(sourceEl);
      }
    }

    article.append(meta, body);

    article.addEventListener("click", (event) => {
      if (event.target.closest(".card-panel")) return;
      if (event.target.closest(".card-edit-form")) return;
      if (window.getSelection()?.toString()) return;
      toggleCard(article, card);
    });

    if (card.id === pendingExpandCardId) {
      expandCard(article, card);
    }

    cardList.appendChild(article);
  });

  pendingExpandCardId = null;
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

  const panel = document.createElement("div");
  panel.className = "card-panel";

  const inline = document.createElement("div");
  inline.className = "card-inline";

  panel.appendChild(buildActionBar(article, card, inline));
  panel.appendChild(inline);

  const notesEl = document.createElement("div");
  notesEl.className = "card-notes";
  renderCardNotes(notesEl, card);
  panel.appendChild(notesEl);

  const thread = document.createElement("div");
  thread.className = "conversation-thread";
  const prior = cardConversations.get(card.id);
  if (prior?.messages.length) {
    for (const msg of prior.messages) {
      appendThreadMessage(thread, msg.question, msg.answer, false);
    }
  }
  panel.appendChild(thread);

  article.appendChild(panel);
}

function collapseCard(article) {
  article.classList.remove("expanded");
  article.querySelector(".card-panel")?.remove();
  article.querySelector(".card-edit-form")?.remove();
  if (expandedArticle === article) expandedArticle = null;
}

function buildActionBar(article, card, inline) {
  const actions = document.createElement("div");
  actions.className = "card-actions";

  function clearInline() {
    inline.innerHTML = "";
    actions.querySelectorAll(".card-action-btn").forEach((b) => b.classList.remove("active"));
  }

  function togglePanel(btn, buildFn) {
    if (btn.classList.contains("active")) { clearInline(); return; }
    clearInline();
    btn.classList.add("active");
    buildFn(inline, clearInline);
    inline.querySelector("textarea, input")?.focus();
  }

  if (card.type !== "vocab") {
    const editBtn = makeActionBtn(ICON_PENCIL, "Edit");
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clearInline();
      activateEdit(article, card);
    });
    actions.appendChild(editBtn);
  }

  const deleteBtn = makeActionBtn(ICON_TRASH, "Delete");
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePanel(deleteBtn, (container, close) => buildDeleteConfirm(container, card, close));
  });
  actions.appendChild(deleteBtn);

  const noteBtn = makeActionBtn(ICON_PLUS, "Add note");
  noteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const notesEl = article.querySelector(".card-notes");
    togglePanel(noteBtn, (container, close) => buildAddNoteForm(container, card, notesEl, close));
  });
  actions.appendChild(noteBtn);

  const askBtn = makeActionBtn(ICON_QUESTION, "Ask question");
  askBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const thread = article.querySelector(".conversation-thread");
    togglePanel(askBtn, (container, close) => buildQuestionInput(container, card, thread, close));
  });
  actions.appendChild(askBtn);

  if (state.settings.syncBaseUrl) {
    const shareBtn = makeActionBtn(ICON_SHARE, "Share");
    shareBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      shareBtn.disabled = true;
      try {
        await shareCard(card);
      } catch (err) {
        toast(err.message || "could not share");
      } finally {
        shareBtn.disabled = false;
      }
    });
    actions.appendChild(shareBtn);
  }

  return actions;
}

function makeActionBtn(iconHtml, label) {
  const btn = document.createElement("button");
  btn.className = "card-action-btn";
  btn.title = label;
  btn.innerHTML = iconHtml;
  return btn;
}

function activateEdit(article, card) {
  const body = article.querySelector(".card-body");
  const panel = article.querySelector(".card-panel");
  body.style.display = "none";
  panel.style.display = "none";

  const form = document.createElement("div");
  form.className = "card-edit-form";

  const textarea = document.createElement("textarea");
  textarea.className = "card-edit-textarea";
  textarea.value = card.content;
  textarea.rows = 1;
  textarea.spellcheck = true;
  const resizeEdit = () => { textarea.style.height = "auto"; textarea.style.height = `${textarea.scrollHeight}px`; };
  textarea.addEventListener("input", resizeEdit);

  const srcInput = document.createElement("input");
  srcInput.type = "text";
  srcInput.className = "card-edit-source";
  srcInput.placeholder = "source (optional)";
  const { title, page } = card.source || {};
  srcInput.value = title ? (page ? `${title}, p. ${page}` : title) : "";

  const footer = document.createElement("div");
  footer.className = "card-edit-footer";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "cancel";
  cancelBtn.className = "btn-link";
  cancelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    form.remove();
    body.style.display = "";
    panel.style.display = "";
  });

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "save";
  saveBtn.className = "btn-link btn-link-primary";
  const doSave = (e) => {
    e.stopPropagation();
    const newContent = textarea.value.trim();
    if (!newContent) return;
    const newSource = resolveSource(srcInput.value);
    const idx = state.cards.findIndex((c) => c.id === card.id);
    if (idx !== -1) state.cards[idx] = { ...state.cards[idx], content: newContent, source: newSource };
    pendingExpandCardId = card.id;
    persist(true);
    render();
  };
  saveBtn.addEventListener("click", doSave);
  textarea.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") doSave(e); });

  footer.append(cancelBtn, saveBtn);
  form.append(textarea, srcInput, footer);
  article.insertBefore(form, panel);
  requestAnimationFrame(() => { resizeEdit(); textarea.focus(); textarea.setSelectionRange(textarea.value.length, textarea.value.length); });
}

function buildDeleteConfirm(container, card, close) {
  const el = document.createElement("div");
  el.className = "card-confirm";

  const label = document.createElement("span");
  label.className = "card-confirm-label";
  label.textContent = "delete this card?";

  const yesBtn = document.createElement("button");
  yesBtn.textContent = "yes";
  yesBtn.className = "btn-link btn-link-danger";
  yesBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    state.cards = state.cards.filter((c) => c.id !== card.id);
    persist(true);
    render();
  });

  const noBtn = document.createElement("button");
  noBtn.textContent = "no";
  noBtn.className = "btn-link";
  noBtn.addEventListener("click", (e) => { e.stopPropagation(); close(); });

  el.append(label, yesBtn, noBtn);
  container.appendChild(el);
}

function buildAddNoteForm(container, card, notesEl, close) {
  const el = document.createElement("div");
  el.className = "card-add-note";

  const textarea = document.createElement("textarea");
  textarea.className = "card-add-note-textarea";
  textarea.placeholder = "add a note...";
  textarea.rows = 2;
  const resizeNote = () => { textarea.style.height = "auto"; textarea.style.height = `${textarea.scrollHeight}px`; };
  textarea.addEventListener("input", resizeNote);

  const footer = document.createElement("div");
  footer.className = "card-add-note-footer";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "cancel";
  cancelBtn.className = "btn-link";
  cancelBtn.addEventListener("click", (e) => { e.stopPropagation(); close(); });

  const okBtn = document.createElement("button");
  okBtn.textContent = "ok";
  okBtn.className = "btn-link btn-link-primary";
  const doSave = (e) => {
    e.stopPropagation();
    const content = textarea.value.trim();
    if (!content) return;
    const note = createCardNote({ content });
    const idx = state.cards.findIndex((c) => c.id === card.id);
    if (idx !== -1) {
      state.cards[idx].notes = [...(state.cards[idx].notes || []), note];
      card.notes = state.cards[idx].notes;
    }
    persist(true);
    renderCardNotes(notesEl, card);
    close();
  };
  okBtn.addEventListener("click", doSave);
  textarea.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") doSave(e); });

  footer.append(cancelBtn, okBtn);
  el.append(textarea, footer);
  container.appendChild(el);
}

function buildQuestionInput(container, card, thread, close) {
  const inputRow = document.createElement("div");
  inputRow.className = "conversation-input-row";

  const convoInput = document.createElement("input");
  convoInput.type = "text";
  convoInput.className = "conversation-input";
  convoInput.placeholder = "ask something...";
  convoInput.autocomplete = "off";

  convoInput.addEventListener("keydown", async (event) => {
    if (event.key === "Escape") { close(); return; }
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
  container.appendChild(inputRow);
}

function renderCardNotes(container, card) {
  container.innerHTML = "";
  if (!card.notes?.length) return;
  for (const note of card.notes) {
    const el = document.createElement("div");
    el.className = "card-note";
    const text = document.createElement("p");
    text.className = "card-note-text";
    text.textContent = note.content;
    el.appendChild(text);
    container.appendChild(el);
  }
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

function renderCardContent(container, content) {
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const isQuote = lines[i].startsWith(">");
    const blockLines = [];
    while (i < lines.length && lines[i].startsWith(">") === isQuote) {
      blockLines.push(isQuote ? lines[i].slice(1).trimStart() : lines[i]);
      i++;
    }
    const text = blockLines.join("\n").trim();
    if (!text) continue;
    const el = document.createElement("p");
    el.className = isQuote ? "card-quote" : "card-text";
    el.textContent = text;
    container.appendChild(el);
  }
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
  if (!syncDot) return;
  const s = state.syncStatus;
  syncDot.classList.toggle("synced", s === "synced");
  syncDot.classList.toggle("syncing", s === "syncing");
  syncDot.classList.toggle("offline", s === "offline");
  const titles = { synced: "synced", syncing: "syncing...", offline: "offline", local: "local only", pending: "pending sync" };
  syncDot.title = titles[s] || "local only";
}

let linkPanelOpen = false;

function toggleLinkPanel() {
  linkPanelOpen = !linkPanelOpen;
  linkPanel.hidden = !linkPanelOpen;
  if (linkPanelOpen) renderLinkPanel();
}

function renderLinkPanel() {
  linkPanelInner.innerHTML = "";

  if (!state.settings.syncBaseUrl) {
    const msg = document.createElement("p");
    msg.className = "link-panel-label";
    msg.textContent = "sync not configured";
    linkPanelInner.append(msg, makeLinkClose("link-panel-close"));
    return;
  }

  if (!state.sync.code) {
    const msg = document.createElement("span");
    msg.className = "link-panel-label";
    msg.textContent = "no sync link yet";

    const createBtn = document.createElement("button");
    createBtn.className = "btn-link btn-link-primary";
    createBtn.textContent = "create link";
    createBtn.addEventListener("click", async () => {
      createBtn.disabled = true;
      createBtn.textContent = "creating...";
      try {
        const code = await createLinkRoom(state.settings.syncBaseUrl);
        if (!code) throw new Error("No code returned");
        state.sync.code = code;
        persist(false);
        syncClient.restart(code);
        renderLinkPanel();
      } catch (err) {
        createBtn.disabled = false;
        createBtn.textContent = "create link";
        toast(err.message || "could not create link");
      }
    });

    const footer = document.createElement("div");
    footer.className = "link-panel-footer";
    footer.append(msg, createBtn);
    linkPanelInner.append(footer, buildEnterCodeForm(), makeLinkClose("link-panel-close"));
    return;
  }

  const linkUrl = buildDeviceLink(location.href, state.sync.code);

  const urlEl = document.createElement("span");
  urlEl.className = "link-panel-url";
  urlEl.textContent = linkUrl;

  const copyBtn = document.createElement("button");
  copyBtn.className = "btn-link btn-link-primary";
  copyBtn.textContent = "copy";
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(linkUrl).then(() => {
      copyBtn.textContent = "copied";
      setTimeout(() => { copyBtn.textContent = "copy"; }, 1500);
    });
  });

  const row = document.createElement("div");
  row.className = "link-panel-row";
  row.append(urlEl, copyBtn);

  const codeLabel = document.createElement("span");
  codeLabel.className = "link-panel-label";
  codeLabel.textContent = state.sync.code;

  linkPanelInner.append(row, codeLabel, buildEnterCodeForm(), makeLinkClose("link-panel-close"));
}

function buildEnterCodeForm() {
  const row = document.createElement("div");
  row.className = "link-panel-enter-code";

  const label = document.createElement("span");
  label.className = "link-panel-label";
  label.textContent = "enter code from another device";

  const codeInput = document.createElement("input");
  codeInput.type = "text";
  codeInput.className = "link-panel-code-input";
  codeInput.placeholder = "code";
  codeInput.autocomplete = "off";
  codeInput.autocapitalize = "characters";
  codeInput.spellcheck = false;
  codeInput.maxLength = 12;

  const joinBtn = document.createElement("button");
  joinBtn.className = "btn-link btn-link-primary";
  joinBtn.textContent = "join";

  const doJoin = () => {
    const code = normalizeCode(codeInput.value);
    if (!code) return;
    state.sync.code = code;
    persist(false);
    syncClient.restart(code);
    renderLinkPanel();
  };

  joinBtn.addEventListener("click", doJoin);
  codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doJoin(); });

  row.append(label, codeInput, joinBtn);
  return row;
}

function makeLinkClose(extraClass) {
  const btn = document.createElement("button");
  btn.className = extraClass ? `btn-link ${extraClass}` : "btn-link";
  btn.textContent = "close";
  btn.addEventListener("click", () => {
    linkPanelOpen = false;
    linkPanel.hidden = true;
  });
  return btn;
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
    : { title: titlePart, subtitle: "", author: "", url: "", page };
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

function looksLikeUrl(text) {
  return /^https?:\/\/./.test(text) || /^www\../.test(text);
}

async function fetchAndFillSource(url) {
  sourceInput.disabled = true;
  sourceInput.dataset.loading = "true";
  try {
    const info = await fetchArticleInfo(url);
    if (sourceInput.value.trim() === url || looksLikeUrl(sourceInput.value.trim())) {
      sourceInput.value = info.title;
      parsedSourceCache = { title: info.title, subtitle: "", author: info.author, url: info.url, page: "" };
    }
  } catch {
    // leave as-is
  } finally {
    sourceInput.disabled = false;
    delete sourceInput.dataset.loading;
    sourceInput.focus();
  }
}

async function fetchArticleInfo(url) {
  const { articleBaseUrl } = state.settings;
  const response = await fetch(`${articleBaseUrl}/api/fetch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

function attachEvents() {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCard();
  });

  input.addEventListener("input", handleInput);
  input.addEventListener("keydown", handleKeydown);
  input.addEventListener("paste", handlePaste);

  let urlFetchTimer;
  sourceInput.addEventListener("input", () => {
    parsedSourceCache = null;
    clearTimeout(urlFetchTimer);
    const val = sourceInput.value.trim();
    if (looksLikeUrl(val) && state.settings.articleBaseUrl) {
      urlFetchTimer = setTimeout(() => fetchAndFillSource(val), 400);
    }
  });

  let searchTimer;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderCards, 180);
  });

  linkBtn?.addEventListener("click", toggleLinkPanel);
}

function handlePaste(event) {
  const text = event.clipboardData?.getData("text/plain") || "";
  const parsed = parseKindleHighlight(text);
  if (!parsed) return;

  event.preventDefault();
  input.value = parsed.content.split("\n").map((line) => line.trim() ? `> ${line}` : line).join("\n");
  const { title, page } = parsed.source;
  sourceInput.value = page ? `${title}, p. ${page}` : title;
  parsedSourceCache = parsed.source;
  autoResize();
  renderComposerState();
}

async function shareCard(card) {
  const { syncBaseUrl } = state.settings;
  if (!syncBaseUrl) throw new Error("sync not configured");

  const appUrl = location.origin + location.pathname;
  const response = await fetch(`${syncBaseUrl}/api/shares`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ card, appUrl })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `request failed: ${response.status}`);
  }

  const data = await response.json();
  const shareUrl = data.shareUrl;
  if (!shareUrl) throw new Error("no share URL returned");

  if (navigator.share) {
    const title = card.type === "vocab" ? card.word : (card.source?.title || "commonplace");
    await navigator.share({ title, url: shareUrl });
  } else {
    await navigator.clipboard?.writeText(shareUrl);
    toast("link copied");
  }
}

async function loadSharedCard(code) {
  const { syncBaseUrl } = state.settings;
  if (!syncBaseUrl) return;
  try {
    const response = await fetch(`${syncBaseUrl}/api/shares/${encodeURIComponent(code)}`);
    if (!response.ok) throw new Error("share not found");
    const data = await response.json();
    showSharedCardView(data.share.card);
  } catch (err) {
    toast(err.message || "could not load shared card");
  }
}

function showSharedCardView(card) {
  const overlay = document.createElement("div");
  overlay.className = "shared-card-overlay";
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  const modal = document.createElement("div");
  modal.className = "shared-card-modal";

  const header = document.createElement("div");
  header.className = "shared-card-header";
  const label = document.createElement("span");
  label.className = "shared-card-label";
  label.textContent = "shared card";
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn-link";
  closeBtn.textContent = "close";
  closeBtn.addEventListener("click", () => overlay.remove());
  header.append(label, closeBtn);

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
    renderCardContent(body, card.content);
    const { title: srcTitle, page: srcPage, url: srcUrl } = card.source || {};
    const sourceLabel = srcTitle ? (srcPage ? `${srcTitle}, p. ${srcPage}` : srcTitle) : "";
    if (sourceLabel) {
      const sourceEl = document.createElement("p");
      sourceEl.className = "card-source";
      if (srcUrl) {
        const link = document.createElement("a");
        link.href = srcUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = sourceLabel;
        sourceEl.appendChild(link);
      } else {
        sourceEl.textContent = sourceLabel;
      }
      body.appendChild(sourceEl);
    }
  }

  modal.append(header, body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function init() {
  attachEvents();
  autoResize();
  render();

  const params = new URLSearchParams(location.search);
  const linkParam = normalizeCode(params.get("link") || "");
  if (linkParam && linkParam !== state.sync.code) {
    state.sync.code = linkParam;
    saveAppState({ cards: state.cards, deviceId: state.deviceId, clock: state.clock, sync: state.sync });
    history.replaceState(null, "", location.pathname);
  }

  const shareParam = normalizeCode(params.get("share") || "");
  if (shareParam) {
    history.replaceState(null, "", location.pathname);
    loadSharedCard(shareParam);
  }

  syncClient.start(state.sync.code);
  registerServiceWorker();
}

init();
