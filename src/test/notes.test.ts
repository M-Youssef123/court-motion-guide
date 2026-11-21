import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import * as store from '../../public/serve-coach/js/store.js';

describe('personal practice notes', () => {
  beforeAll(async () => {
    localStorage.setItem('sc-notes', JSON.stringify(['Keep the toss high']));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('serve-coach', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
        const clips = db.createObjectStore('clips', { keyPath: 'id' });
        clips.createIndex('sessionId', 'sessionId'); clips.createIndex('status', 'status');
        db.createObjectStore('chunks', { keyPath: ['clipId', 'seq'] });
        db.createObjectStore('poses', { keyPath: ['clipId', 'seq'] });
        request.transaction?.objectStore('sessions').put({id:'older-practice',createdAt:'2026-11-20T15:00:00Z',status:'ended'});
      };
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
  });

  it('preserves legacy notes without guessing a session', async () => {
    const notes = await store.listNotes();
    expect(notes).toEqual([expect.objectContaining({ text: 'Keep the toss high', sessionId: null, source: 'legacy' })]);
    expect(localStorage.getItem('sc-notes')).toBeNull();
    expect(await store.getSession('older-practice')).toEqual(expect.objectContaining({id:'older-practice',status:'ended'}));
  });

  it('allows linking a migrated note to a selected session', async () => {
    const session = await store.createSession();
    await store.saveNote({ id: 'legacy-note-0', sessionId: session.id, text: 'Keep the toss high' });
    expect(await store.listNotes(session.id)).toEqual([expect.objectContaining({id:'legacy-note-0',sessionId:session.id,text:'Keep the toss high'})]);
  });

  it('saves and reads notes for only their individual session', async () => {
    const first = await store.createSession(), second = await store.createSession();
    const note = await store.saveNote({ sessionId: first.id, text: '  Focus on knee bend  ' });
    expect(await store.listNotes(first.id)).toEqual([expect.objectContaining({ id: note.id, text: 'Focus on knee bend', sessionId: first.id })]);
    expect(await store.listNotes(second.id)).toEqual([]);
  });

  it('edits an existing note without duplicating it or changing creation time', async () => {
    const session = await store.createSession();
    const note = await store.saveNote({ sessionId: session.id, text: 'First thought' });
    await store.saveNote({ id: note.id, sessionId: session.id, text: 'Higher toss next time' });
    expect(await store.listNotes(session.id)).toEqual([expect.objectContaining({ id: note.id, createdAt: note.createdAt, text: 'Higher toss next time' })]);
  });

  it('deletes a saved note', async () => {
    const session = await store.createSession();
    const note = await store.saveNote({ sessionId: session.id, text: 'Remove this' });
    await store.deleteNote(note.id);
    expect(await store.listNotes(session.id)).toEqual([]);
  });

  it('requires nonempty text and a real session for new notes', async () => {
    const session = await store.createSession();
    await expect(store.saveNote({ sessionId: session.id, text: ' ' })).rejects.toThrow();
    await expect(store.saveNote({ sessionId: null, text: 'Unassigned' })).rejects.toThrow();
    await expect(store.saveNote({ sessionId: 'missing-session', text: 'Orphan' })).rejects.toThrow();
  });

  it('removes only the deleted session’s notes', async () => {
    const first = await store.createSession(), second = await store.createSession();
    await store.saveNote({ sessionId: first.id, text: 'Delete with practice' });
    const kept = await store.saveNote({ sessionId: second.id, text: 'Keep this practice note' });
    await store.deleteSession(first.id);
    expect(await store.listNotes(first.id)).toEqual([]);
    expect(await store.listNotes(second.id)).toEqual([kept]);
  });
});