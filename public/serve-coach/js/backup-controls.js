import { exportPracticeBackup, importPracticeBackup } from './store.js';
import { MAX_BACKUP_BYTES } from './practice-backup.js';
import { saveVideo } from './save-video.js';

export function initBackupControls(onRestored) {
  const section = document.createElement('section');
  section.className = 'block';
  section.innerHTML = `<h2 class="sec-h">Practice backup</h2>
    <p class="empty">JSON backups include sessions, notes, pose measurements, coaching evidence and drill completions. Download video files separately from Video recordings.</p>
    <div class="row">
      <button class="btn btn-court" type="button" id="backupExport">Prepare JSON backup</button>
      <button class="btn btn-quiet" type="button" id="backupImport">Restore JSON backup</button>
      <input type="file" id="backupFile" accept=".json,application/json" hidden>
    </div>
    <p class="empty" role="status"></p>`;
  document.getElementById('journalHeading').closest('.block').after(section);
  const exportButton = section.querySelector('#backupExport');
  const importButton = section.querySelector('#backupImport');
  const fileInput = section.querySelector('#backupFile');
  const status = section.querySelector('[role="status"]');
  const setBusy = (busy) => { exportButton.disabled = importButton.disabled = busy; };
  let ready = null;
  exportButton.addEventListener('click', async () => {
    setBusy(true);
    try {
      if (ready) {
        const outcome = await saveVideo(ready, 'serve-coach-practice-backup.json');
        status.textContent = outcome === 'cancelled' ? 'Sharing cancelled. The backup is still ready.' : 'Backup saved or sent to the selected share destination.';
        if (outcome !== 'cancelled') ready = null;
      } else {
        status.textContent = 'Preparing your data backup…';
        const blob = new Blob([JSON.stringify(await exportPracticeBackup())], { type: 'application/json' });
        if (blob.size > MAX_BACKUP_BYTES) throw new Error('This practice history exceeds the 32 MB JSON backup limit.');
        ready = blob;
        status.textContent = 'Backup ready. Tap Download JSON backup.';
      }
    } catch (error) {
      status.textContent = error.message || 'Couldn’t prepare or save the backup.';
    } finally {
      exportButton.textContent = ready ? 'Download JSON backup' : 'Prepare JSON backup';
      setBusy(false);
    }
  });
  importButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    setBusy(true);
    status.textContent = 'Validating and restoring practice data…';
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('This JSON backup exceeds the 32 MB import limit.');
      let backup;
      try { backup = JSON.parse(await file.text()); } catch { throw new Error('This file is not valid JSON. Choose a Serve Coach backup.'); }
      const result = await importPracticeBackup(backup);
      ready = null;
      exportButton.textContent = 'Prepare JSON backup';
      status.textContent = `Added ${result.sessions} practices, ${result.clips} clip analyses and ${result.notes} notes. Existing records were kept.`;
      onRestored();
    } catch (error) {
      status.textContent = error.message || 'Couldn’t restore this backup. Your existing data was kept.';
    } finally {
      setBusy(false);
    }
  });
}
