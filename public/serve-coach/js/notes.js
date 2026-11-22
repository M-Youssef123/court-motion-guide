/* My notes: local CRUD, explicit session links, and safe text rendering. */
import * as store from "./store.js";

const $ = (id) => document.getElementById(id);
const icon = (path) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const EDIT = icon('<path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/>');
const DELETE = icon('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>');
const sessionLabel = (s) =>
  new Date(s.createdAt).toLocaleString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }) +
  (s.source === "upload" ? " · Uploaded video" : " · Practice") +
  (s.status === "active" ? " · In progress" : "");

export function initNotes() {
  let editing = null,
    busy = false,
    token = 0;
  const form = $("noteForm"),
    input = $("noteIn"),
    select = $("noteSession"),
    save = $("noteSave");
  const message = (text) => {
    $("noteStatus").textContent = text;
  };
  function reset() {
    editing = null;
    input.value = "";
    save.textContent = "Save";
    $("noteCancel").hidden = true;
  }
  function lock(value) {
    busy = value;
    form.querySelectorAll("button, input, select").forEach((el) => {
      el.disabled = value;
    });
    $("notes")
      .querySelectorAll("button")
      .forEach((el) => {
        el.disabled = value;
      });
    save.disabled = value || (!select.value && !(editing && editing.source === "legacy"));
  }
  async function render() {
    const my = ++token;
    try {
      const [sessions, notes] = await Promise.all([store.listSessions(), store.listNotes()]);
      if (my !== token) return;
      const chosen = select.value;
      select.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent =
        editing && editing.source === "legacy"
          ? "Earlier note · No session assigned"
          : "Choose a practice session";
      select.append(placeholder);
      sessions.forEach((session) => {
        const option = document.createElement("option");
        option.value = session.id;
        option.textContent = sessionLabel(session);
        select.append(option);
      });
      select.value = sessions.some((s) => s.id === chosen) ? chosen : sessions[0]?.id || "";
      if (editing && !editing.sessionId) select.value = "";
      const list = $("notes");
      list.replaceChildren();
      notes.forEach((note) => {
        const li = document.createElement("li");
        li.dataset.noteId = note.id;
        const meta = document.createElement("p");
        meta.className = "note-meta";
        const session = sessions.find((s) => s.id === note.sessionId);
        meta.textContent = session ? sessionLabel(session) : "Earlier note · No session assigned";
        const text = document.createElement("p");
        text.className = "note-text";
        text.textContent = note.text;
        const actions = document.createElement("div");
        actions.className = "note-actions";
        function action(label, svg, run) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "btn btn-quiet note-action";
          button.innerHTML = svg;
          button.setAttribute("aria-label", label);
          button.title = label;
          button.addEventListener("click", run);
          actions.append(button);
        }
        action("Edit note", EDIT, () => {
          if (busy) return;
          editing = note;
          input.value = note.text;
          select.options[0].textContent =
            note.source === "legacy"
              ? "Earlier note · No session assigned"
              : "Choose a practice session";
          select.value = note.sessionId || "";
          save.textContent = "Save changes";
          $("noteCancel").hidden = false;
          message("");
          lock(false);
          input.focus();
        });
        action("Delete note", DELETE, async () => {
          if (busy || !window.confirm("Delete this note? This cannot be undone.")) return;
          lock(true);
          try {
            await store.deleteNote(note.id);
            if (editing && editing.id === note.id) reset();
            await render();
            message("Note deleted.");
          } catch (e) {
            message("Couldn’t delete this note. Try again.");
          } finally {
            lock(false);
          }
        });
        li.append(meta, text, actions);
        list.append(li);
      });
      $("notesEmpty").hidden = notes.length > 0;
      if (!sessions.length && !editing)
        message("Start a practice or upload a video to add session notes.");
      lock(busy);
    } catch (e) {
      save.disabled = true;
      message("Couldn’t load notes. Open Progress again to retry.");
    }
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!input.value.trim()) {
      message("Write a note before saving.");
      input.focus();
      return;
    }
    lock(true);
    message("Saving…");
    try {
      await store.saveNote({ id: editing?.id, sessionId: select.value || null, text: input.value });
      reset();
      await render();
      message("Note saved on this device.");
    } catch (e) {
      message(
        "Couldn’t save this note. Check the session and available device storage, then try again.",
      );
    } finally {
      lock(false);
    }
  });
  select.addEventListener("change", () => lock(false));
  $("noteCancel").addEventListener("click", () => {
    reset();
    message("");
    render();
  });
  window.addEventListener("practice-notes-changed", () => {
    reset();
    render();
  });
  return { render };
}
