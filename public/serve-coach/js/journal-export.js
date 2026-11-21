import { getJournalData } from './store.js';
import { buildJournal, journalFilename } from './journal.js';
import { saveVideo } from './save-video.js';

export function initJournalExport() {
  const section = document.createElement('section');
  section.className = 'block';
  section.setAttribute('aria-labelledby', 'journalHeading');
  section.innerHTML = `<h2 class="sec-h" id="journalHeading">Practice journal</h2>
    <button class="btn btn-court" id="journalExport" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/></svg><span>Export Journal (.md)</span></button>
    <p class="empty">Downloads your practice sessions, notes, and coaching stats as a readable journal. Videos can be saved individually from the recordings list.</p>
    <p class="empty" id="journalStatus" role="status" aria-live="polite"></p>`;
  document.getElementById('notesH').closest('.block').after(section);
  const button = section.querySelector('button'), label = button.querySelector('span'), status = section.querySelector('[role="status"]');
  let ready = null, busy = false;
  const reset = () => { if (!busy) { ready = null; label.textContent = 'Export Journal (.md)'; status.textContent = ''; } };
  window.addEventListener('hashchange', reset);
  // Notes can be edited after preparation without changing the page.
  document.getElementById('noteForm').addEventListener('submit', reset);
  document.getElementById('notes').addEventListener('click', reset);
  window.addEventListener('practice-notes-changed', reset);
  button.addEventListener('click', () => {
    if (busy) return;
    busy = true; button.disabled = true; button.setAttribute('aria-busy', 'true');
    if (ready) {
      // Directly inside this tap: no database await before native sharing on iOS.
      label.textContent = 'Saving…';
      saveVideo(ready.blob, ready.filename).then(result => {
        status.textContent = result === 'cancelled' ? 'Sharing cancelled. Your journal is still ready.' : result === 'shared' ? 'Journal shared ✓' : 'Journal download started ✓';
        if (result !== 'cancelled') ready = null;
      }).catch(() => { status.textContent = 'Couldn’t save the journal. Please try again.'; }).finally(() => {
        busy = false; button.disabled = false; button.setAttribute('aria-busy', 'false');
        label.textContent = ready ? 'Download Journal (.md)' : 'Export Journal (.md)';
      });
      return;
    }
    label.textContent = 'Exporting…'; status.textContent = '';
    getJournalData().then(data => {
      const date = new Date();
      ready = { blob: new Blob([buildJournal(data, date)], { type: 'text/markdown;charset=utf-8' }), filename: journalFilename(date) };
      status.textContent = 'Journal ready. Tap Download Journal to save or share it.';
    }).catch(() => { status.textContent = 'Couldn’t read your saved practices. Please try again.'; }).finally(() => {
      busy = false; button.disabled = false; button.setAttribute('aria-busy', 'false');
      label.textContent = ready ? 'Download Journal (.md)' : 'Export Journal (.md)';
    });
  });
}