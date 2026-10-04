/* ============================================================
   Next Cube Pro -- cloud sync engine
   Merge-by-id with tombstones, so signing in on a second device
   never overwrites/loses solves -- it combines both.

   FIRESTORE LAYOUT
   - users/{uid}: small metadata only (nickname, email, session names/
     disciplines, current session id, progression, custom phrases).
   - users/{uid}/solves/{solveId}: one document per solve.
   - users/{uid}/tombstones/{solveId}: remembers deletions.

   WHAT COSTS READS / WRITES (free quota: 50k reads / 20k writes per day)
   - Idle app = 0 operations. There is NO polling timer any more: a sync
     runs on page load / login, and afterwards only when the tab regains
     focus AND at least SYNC_MIN_INTERVAL_MS passed since the last one.
   - A sync = ~1 read for users/{uid} (served by the live listener, so
     only the very first one is billed) + 1 query on solves + 1 query on
     tombstones (an empty query is billed as 1 read). Only documents
     changed since the stored cursor are returned.
   - The FULL history is read once per account+device (no cursor yet), or
     when the local solve count dropped for a reason nobody explains.
   - A solve = 1 write (create) / 1 write (DNF, +2, edit) / 2 writes
     (delete = delete + tombstone). Nothing else is written per solve.
   - Metadata / progression / phrases are written only when their
     content really changed (content hash), and debounced.
   - Resetting a session = 1 metadata write (`resetAt` marker), NOT one
     delete per solve. Solves older than `resetAt` are ignored everywhere.
   - Stats (Ao5/Ao12/Ao100, best, charts) are computed from the in-memory
     `timer.sessions[...].solves`, never by querying Firestore.
   ============================================================ */

// Minimum gap between two *automatic* syncs (focus / visibility / online).
// Login, page load and the "Sync now" button always sync immediately.
const SYNC_MIN_INTERVAL_MS = 10 * 60 * 1000;
// Session metadata / progression are debounced; flushed when the tab hides.
const META_PUSH_DEBOUNCE_MS = 20000;
const PROGRESSION_PUSH_DEBOUNCE_MS = 15000;
// Local safety snapshot is refreshed at most this often.
const SAFETY_BACKUP_MIN_INTERVAL_MS = 10 * 60 * 1000;
// Local solve tombstones older than this are forgotten (cloud keeps them).
const SOLVE_TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// ---- Small helpers ----------------------------------------------------
// JSON with sorted keys: two objects with the same content always give the
// same string, regardless of key order (Firestore returns maps key-sorted).
function stableStringify(value) {
    const norm = (v) => {
        if (Array.isArray(v)) return v.map(norm);
        if (v && typeof v === 'object') {
            const out = {};
            for (const k of Object.keys(v).sort()) {
                if (v[k] !== undefined) out[k] = norm(v[k]);
            }
            return out;
        }
        return v;
    };
    return JSON.stringify(norm(value));
}

function countSolves(sessions) {
    return Object.values(sessions || {}).reduce((sum, session) => sum + (Array.isArray(session?.solves) ? session.solves.length : 0), 0);
}

// The per-account "how many solves did I have after the last sync" baseline.
// A drop below it used to mean "something is wrong, re-read everything" --
// but a normal delete/reset ALSO lowers the count and used to trigger a full
// read of the entire history. Every intentional removal now lowers the
// baseline by the same amount, so only unexplained drops count.
function adjustLocalCountBaseline(delta) {
    if (!delta) return;
    const uid = AppStorage.getRaw('lastSyncedUid');
    if (!uid) return;
    const key = `syncLocalSolveCount:${uid}`;
    const current = AppStorage.getRaw(key, null);
    if (current === null) return;
    AppStorage.setRaw(key, String(Math.max(0, (Number(current) || 0) + delta)));
}

// ---- Tombstones: remember what was intentionally deleted -------------
const SyncTombstones = {
    addDeletedSolve(id) {
        if (!id) return;
        const list = AppStorage.getJSON('deletedSolveIds', []);
        list.push({ id, deletedAt: Date.now() });
        AppStorage.setJSON('deletedSolveIds', list);
        adjustLocalCountBaseline(-1);
    },
    // removedSolveCount: how many solves disappeared together with the session
    // (keeps the local-count baseline honest, see adjustLocalCountBaseline).
    addDeletedSession(id, removedSolveCount = 0) {
        if (!id) return;
        const list = AppStorage.getJSON('deletedSessionIds', []);
        list.push({ id, deletedAt: Date.now() });
        AppStorage.setJSON('deletedSessionIds', list);
        adjustLocalCountBaseline(-(Number(removedSolveCount) || 0));
        PendingSync.removePendingForSession(id);
    },
    getDeletedSolveIds() {
        return new Set(AppStorage.getJSON('deletedSolveIds', []).map(x => x.id));
    },
    getDeletedSessionIds() {
        return new Set(AppStorage.getJSON('deletedSessionIds', []).map(x => x.id));
    },

    // Raw entries (with deletedAt) -- used locally for filtering merges.
    getDeletedSolveEntries() {
        return AppStorage.getJSON('deletedSolveIds', []);
    },
    getDeletedSessionEntries() {
        return AppStorage.getJSON('deletedSessionIds', []);
    },

    // Fold tombstones that came from Firestore into this device's local
    // list (union by id). Without this, a deletion made on device A would
    // never be recognized by device B's merge, and would get resurrected
    // the moment B's local (still-has-it) copy gets merged back in.
    mergeRemoteSolveTombstones(remoteEntries) {
        const local = AppStorage.getJSON('deletedSolveIds', []);
        const byId = new Map(local.map(e => [e.id, e]));
        let added = false;
        for (const e of (remoteEntries || [])) {
            if (!byId.has(e.id)) { byId.set(e.id, { id: e.id, deletedAt: e.deletedAt || Date.now() }); added = true; }
        }
        const merged = Array.from(byId.values());
        if (added) AppStorage.setJSON('deletedSolveIds', merged);
        return merged;
    },
    mergeRemoteSessionTombstones(remoteEntries) {
        const local = AppStorage.getJSON('deletedSessionIds', []);
        const byId = new Map(local.map(e => [e.id, e]));
        let added = false;
        for (const e of (remoteEntries || [])) {
            if (!byId.has(e.id)) { byId.set(e.id, e); added = true; }
        }
        const merged = Array.from(byId.values());
        if (added) AppStorage.setJSON('deletedSessionIds', merged);
        return merged;
    },

    // The local solve-tombstone list otherwise grows forever. Safe to forget
    // old entries: the deleted document no longer exists in Firestore, so it
    // can't come back from there. SESSION tombstones are never pruned -- the
    // deleted session's key lingers in the cloud metadata map and this is
    // what keeps hiding it.
    pruneOldSolveTombstones(maxAgeMs = SOLVE_TOMBSTONE_MAX_AGE_MS) {
        const list = AppStorage.getJSON('deletedSolveIds', []);
        const cutoff = Date.now() - maxAgeMs;
        const kept = list.filter(e => !(Number(e.deletedAt) > 0 && Number(e.deletedAt) < cutoff));
        if (kept.length !== list.length) AppStorage.setJSON('deletedSolveIds', kept);
    }
};

// ---- Pending push queue: solves whose write to Firestore failed --------
// Every local mutation is queued BEFORE its network request begins and
// removed only after Firestore confirms the write. This also survives
// closing the tab while a request is still in flight.
const PendingSync = {
    getPendingSolves() {
        return AppStorage.getJSON('pendingSolveIds', []); // [{ sessionId, id }]
    },
    getPendingSolveIdSet() {
        return new Set(PendingSync.getPendingSolves().map(e => e.id));
    },
    addPendingSolve(sessionId, id) {
        if (!id) return;
        PendingSync.addPendingSolves([{ sessionId, id }]);
    },
    // Bulk variant: one read + one write of the queue for any number of ids
    // (adding thousands one by one was quadratic).
    addPendingSolves(entries) {
        const list = PendingSync.getPendingSolves();
        const known = new Set(list.map(e => e.id));
        let changed = false;
        for (const e of (entries || [])) {
            if (!e?.id || known.has(e.id)) continue;
            known.add(e.id);
            list.push({ sessionId: e.sessionId, id: e.id });
            changed = true;
        }
        if (changed) AppStorage.setJSON('pendingSolveIds', list);
    },
    removePendingSolve(id) {
        PendingSync.removePendingSolves([id]);
    },
    removePendingSolves(ids) {
        const drop = new Set(ids || []);
        const list = PendingSync.getPendingSolves();
        const next = list.filter(e => !drop.has(e.id));
        if (next.length !== list.length) AppStorage.setJSON('pendingSolveIds', next);
    },
    removePendingForSession(sessionId) {
        const list = PendingSync.getPendingSolves();
        const next = list.filter(e => e.sessionId !== sessionId);
        if (next.length !== list.length) AppStorage.setJSON('pendingSolveIds', next);
    },
    getPendingDeletes() {
        return AppStorage.getJSON('pendingDeleteIds', []); // [id, ...]
    },
    addPendingDelete(id) {
        if (!id) return;
        const list = PendingSync.getPendingDeletes();
        if (!list.includes(id)) {
            list.push(id);
            AppStorage.setJSON('pendingDeleteIds', list);
        }
    },
    removePendingDelete(id) {
        const list = PendingSync.getPendingDeletes();
        const next = list.filter(x => x !== id);
        if (next.length !== list.length) AppStorage.setJSON('pendingDeleteIds', next);
    },
    hasPending() {
        return PendingSync.getPendingSolves().length > 0 || PendingSync.getPendingDeletes().length > 0;
    },
    clearAll() {
        AppStorage.setJSON('pendingSolveIds', []);
        AppStorage.setJSON('pendingDeleteIds', []);
    }
};

// Finds which local session currently holds a given solve id. Used only
// to know where to re-read a solve's current state from when retrying a
// failed update push (pure local lookup, no network, no Firestore cost).
function findSessionIdForSolve(solveId) {
    const sessions = window.timer?.sessions || {};
    for (const [sid, session] of Object.entries(sessions)) {
        if ((session.solves || []).some(s => s.id === solveId)) return sid;
    }
    return null;
}

// ---- Merge logic (pure, no network -- safe to test standalone) -------
const SyncMerge = {
    // Merge two solve arrays (both id-keyed), dropping anything in
    // deletedSolveIds.
    //
    // Conflict rule when the same solve exists on both sides:
    //  - pendingIds given: the cloud copy is authoritative (it is the result
    //    of the last write that reached the server -- no client clock is
    //    involved), EXCEPT for solves with an unsent local edit, which keep
    //    the local copy and are pushed right after the merge.
    //  - pendingIds omitted (legacy embedded solves only): newer `updatedAt`
    //    wins, as before.
    mergeSolves(localSolves, remoteSolves, deletedSolveIds, pendingIds) {
        const byId = new Map();
        for (const solve of (localSolves || [])) byId.set(solve.id, solve);
        for (const solve of (remoteSolves || [])) {
            const existing = byId.get(solve.id);
            if (!existing) {
                byId.set(solve.id, solve);
            } else if (pendingIds) {
                if (!pendingIds.has(solve.id)) byId.set(solve.id, solve);
            } else {
                const existingStamp = existing.updatedAt || existing.timestamp || 0;
                const incomingStamp = solve.updatedAt || solve.timestamp || 0;
                if (incomingStamp > existingStamp) byId.set(solve.id, solve);
            }
        }
        for (const id of deletedSolveIds) byId.delete(id);

        return Array.from(byId.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    },

    // Merge two session metadata dictionaries (keyed by session id).
    // Solves are NOT part of this -- they're merged separately via
    // mergeSolves, keyed by their own sessionId field.
    mergeSessionsMeta(localSessions, remoteSessions, deletedSessionIds) {
        const merged = {};
        const allIds = new Set([
            ...Object.keys(localSessions || {}),
            ...Object.keys(remoteSessions || {})
        ]);

        for (const id of allIds) {
            if (deletedSessionIds.has(id)) continue;

            const local = (localSessions || {})[id];
            const remote = (remoteSessions || {})[id];

            if (local && remote) {
                // local metadata (name, discipline edits) wins on conflict;
                // solves get overwritten below once mergeSolves runs.
                merged[id] = { ...remote, ...local, solves: local.solves || remote.solves || [] };
                // A reset made on ANY device must win, so take the later one.
                const resetAt = Math.max(Number(local.resetAt) || 0, Number(remote.resetAt) || 0);
                if (resetAt) merged[id].resetAt = resetAt;
            } else {
                merged[id] = local || remote;
            }
            if (merged[id]) merged[id].id = id;
        }
        return merged;
    },

    // "Reset session" keeps the session but clears its solves. Instead of
    // deleting every solve in Firestore (N writes), the session carries a
    // `resetAt` timestamp and everything created at or before it is ignored.
    applyResetCutoff(solves, resetAt) {
        const cutoff = Number(resetAt) || 0;
        if (!cutoff) return solves;
        return (solves || []).filter(s => (Number(s?.timestamp) || 0) > cutoff);
    }
};

// ---- Cloud read/write -- talks to Firestore via firebase-init.js's CubeSync
const CloudSync = {
    // Metadata only (nickname, session names/disciplines, current session
    // id, progression, phrases) -- small document. NOT the solve history.
    // When the live listener is running, its latest snapshot is used and the
    // read is free; otherwise one getDoc.
    async pullMeta() {
        const user = window.CubeAuth && window.CubeAuth.getCurrentUser();
        if (!user) return null;
        if (_liveMeta.ready && _liveMeta.uid === user.uid) {
            // Deep copy: the merge code mutates what it gets, and must never
            // touch the listener's cache.
            return _liveMeta.data ? JSON.parse(JSON.stringify(_liveMeta.data)) : null;
        }
        try {
            return await window.CubeSync.loadUserData();
        } catch (e) {
            console.error('CloudSync.pullMeta failed:', e);
            throw e;
        }
    },
    // Custom phrases replace the whole cloud field (see saveCustomPhrases in
    // firebase-init.js) so that deletions propagate too.
    async pushCustomPhrases(customPhrases, customPhrasesUpdatedAt) {
        if (!window.CubeAuth || !window.CubeAuth.getCurrentUser()) return false;
        try {
            if (window.CubeSync?.saveCustomPhrases) await window.CubeSync.saveCustomPhrases(customPhrases, customPhrasesUpdatedAt);
            else await window.CubeSync.saveSessionsMeta({ customPhrases, customPhrasesUpdatedAt });
            return true;
        } catch (e) {
            console.error('CloudSync.pushCustomPhrases failed:', e);
            return false;
        }
    },
    async pushMeta(meta) {
        if (!window.CubeAuth || !window.CubeAuth.getCurrentUser()) return false;
        try {
            await window.CubeSync.saveSessionsMeta(meta);
            return true;
        } catch (e) {
            console.error('CloudSync.pushMeta failed:', e);
            return false;
        }
    },

    // The ENTIRE solve history. Only called when there's no usable local
    // cursor for this account on this device.
    async pullAllSolvesOnce() {
        if (!window.CubeAuth || !window.CubeAuth.getCurrentUser()) return { solves: [], tombstones: [] };
        try {
            return await window.CubeSync.loadAllSolvesOnce();
        } catch (e) {
            console.error('CloudSync.pullAllSolvesOnce failed:', e);
            throw e;
        }
    },

    // Only what changed (created/edited/deleted) since sinceTimestamp.
    // No "overlap" window any more: the exact-cursor query in firebase-init.js
    // does not re-read the newest document on every sync.
    async pullSolvesDelta(sinceTimestamp) {
        if (!window.CubeAuth || !window.CubeAuth.getCurrentUser()) return { solves: [], tombstones: [] };
        try {
            return await window.CubeSync.loadSolvesSince(Math.max(0, Number(sinceTimestamp || 0)));
        } catch (e) {
            console.error('CloudSync.pullSolvesDelta failed:', e);
            throw e;
        }
    },

    // Point writes -- exactly one Firestore operation each.
    async pushNewSolve(sessionId, solve) {
        // Persist the outbox entry synchronously before starting any async
        // work. A browser may terminate an in-flight fetch without ever
        // running catch/finally, especially on mobile.
        PendingSync.addPendingSolve(sessionId, solve.id);
        if (!window.CubeAuth || !window.CubeAuth.getCurrentUser()) {
            return false;
        }
        try {
            await window.CubeSync.saveSolve(sessionId, solve);
            PendingSync.removePendingSolve(solve.id);
            return true;
        } catch (e) {
            console.error('CloudSync.pushNewSolve failed:', e);
            window.dispatchEvent(new CustomEvent('sync-status', { detail: { state: 'error', code: e?.code || 'solve-write-failed' } }));
            return false;
        }
    },

    // Many solves at once (backfill / retry of a long queue): batched writes,
    // same billed cost as one-by-one but far fewer round trips. Entries are
    // queued first, removed only after the batch committed.
    async pushSolvesBulk(entries) {
        if (!entries.length) return true;
        PendingSync.addPendingSolves(entries.map(e => ({ sessionId: e.sessionId, id: e.solve.id })));
        if (!window.CubeAuth || !window.CubeAuth.getCurrentUser() || !window.CubeSync?.saveSolvesBatch) return false;
        const bySession = new Map();
        for (const { sessionId, solve } of entries) {
            if (!bySession.has(sessionId)) bySession.set(sessionId, []);
            bySession.get(sessionId).push(solve);
        }
        let allOk = true;
        for (const [sessionId, solves] of bySession) {
            try {
                await window.CubeSync.saveSolvesBatch(sessionId, solves);
                PendingSync.removePendingSolves(solves.map(s => s.id));
            } catch (e) {
                console.error('CloudSync.pushSolvesBulk failed:', e);
                // A batch is all-or-nothing, so ONE document the server rejects
                // would block every other solve in it forever. For "this
                // document is the problem" errors retry one by one, so only the
                // bad solve stays queued. (Offline / quota errors are not
                // retried per document: they would all fail the same way.)
                const perDocument = ['invalid-argument', 'permission-denied', 'failed-precondition'].includes(e?.code);
                if (perDocument && solves.length > 1 && solves.length <= 1000 && window.CubeSync?.saveSolve) {
                    for (const solve of solves) {
                        try {
                            await window.CubeSync.saveSolve(sessionId, solve);
                            PendingSync.removePendingSolve(solve.id);
                        } catch (inner) {
                            allOk = false;
                            console.error('Solve rejected by the server, kept in the queue:', solve.id, inner);
                        }
                    }
                } else {
                    allOk = false;
                }
                if (!allOk) window.dispatchEvent(new CustomEvent('sync-status', { detail: { state: 'error', code: e?.code || 'solve-write-failed' } }));
            }
        }
        return allOk;
    },

    async pushSolveUpdate(solveId, patch) {
        const sessionId = findSessionIdForSolve(solveId);
        if (sessionId) PendingSync.addPendingSolve(sessionId, solveId);
        if (!window.CubeAuth || !window.CubeAuth.getCurrentUser()) {
            return false;
        }
        try {
            await window.CubeSync.updateSolve(solveId, patch);
            PendingSync.removePendingSolve(solveId);
            return true;
        } catch (e) {
            // The document does not exist yet (its creation is still queued):
            // send the whole solve instead of a patch.
            if (e?.code === 'not-found' && sessionId) {
                const solve = (window.timer?.sessions?.[sessionId]?.solves || []).find(s => s.id === solveId);
                if (solve) return CloudSync.pushNewSolve(sessionId, solve);
            }
            console.error('CloudSync.pushSolveUpdate failed:', e);
            window.dispatchEvent(new CustomEvent('sync-status', { detail: { state: 'error', code: e?.code || 'solve-update-failed' } }));
            return false;
        }
    },
    async pushSolveDelete(solveId) {
        PendingSync.addPendingDelete(solveId);
        PendingSync.removePendingSolve(solveId);
        if (!window.CubeAuth || !window.CubeAuth.getCurrentUser()) {
            return false;
        }
        try {
            await window.CubeSync.deleteSolveRemote(solveId);
            PendingSync.removePendingDelete(solveId);
            PendingSync.removePendingSolve(solveId); // no longer relevant if it was also queued as a pending create/update
            return true;
        } catch (e) {
            console.error('CloudSync.pushSolveDelete failed:', e);
            window.dispatchEvent(new CustomEvent('sync-status', { detail: { state: 'error', code: e?.code || 'solve-delete-failed' } }));
            return false;
        }
    }
};

// Retries anything queued in PendingSync. One failing item no longer aborts
// the whole sync (a single permanently-rejected write used to block every
// later sync forever): everything else still goes through, and the number of
// failures is returned so the caller can report an error at the end.
async function flushPendingSync() {
    const timer = window.timer;
    if (!timer) return 0;
    let failures = 0;

    const toPush = [];
    for (const { sessionId, id } of PendingSync.getPendingSolves()) {
        const solve = (timer.sessions[sessionId]?.solves || []).find(s => s.id === id);
        if (!solve) {
            // No longer exists locally (e.g. deleted meanwhile) -- nothing to retry.
            PendingSync.removePendingSolve(id);
            continue;
        }
        toPush.push({ sessionId, solve });
    }
    if (toPush.length > 1) {
        if (!(await CloudSync.pushSolvesBulk(toPush))) failures++;
    } else if (toPush.length === 1) {
        if (!(await CloudSync.pushNewSolve(toPush[0].sessionId, toPush[0].solve))) failures++;
    }

    for (const id of PendingSync.getPendingDeletes()) {
        if (!(await CloudSync.pushSolveDelete(id))) failures++;
    }
    return failures;
}

// ---- Safety snapshot (local only) --------------------------------------
// A copy of the whole sessions map, kept in localStorage in case the main
// cache gets wiped or corrupted. It doubles the storage used, so it is
// refreshed rarely, and it must never block synchronization.
const SAFETY_BACKUP_KEY = 'cubeTimerSessionsSafetyBackup';
const SAFETY_BACKUP_INFO_KEY = 'cubeTimerSessionsSafetyBackupInfo';

// Brings back solves that exist in the snapshot but not in the live session
// map. Unlike the old "replace everything with the larger snapshot", this is a
// union that skips everything the user deleted on purpose (tombstones, deleted
// sessions, reset sessions) -- so deleting a solve no longer gets undone.
function restoreFromSafetyBackup(timer, user) {
    const saved = AppStorage.getJSON(SAFETY_BACKUP_KEY, null);
    const info = AppStorage.getJSON(SAFETY_BACKUP_INFO_KEY, {}) || {};
    if (!saved || typeof saved !== 'object') return 0;
    if (info.uid && info.uid !== user.uid) return 0; // never leak another account's history
    if (countSolves(saved) <= countSolves(timer.sessions)) return 0;

    const deletedSolves = SyncTombstones.getDeletedSolveIds();
    const deletedSessions = SyncTombstones.getDeletedSessionIds();
    const restored = [];

    for (const [sid, backupSession] of Object.entries(saved)) {
        if (!backupSession || deletedSessions.has(sid)) continue;
        let session = timer.sessions[sid];
        if (!session) {
            const { solves, ...meta } = backupSession; // eslint-disable-line no-unused-vars
            session = { ...meta, id: sid, solves: [] };
            timer.sessions[sid] = session;
        }
        const resetAt = Math.max(Number(session.resetAt) || 0, Number(backupSession.resetAt) || 0);
        const have = new Set((session.solves || []).map(s => s.id));
        const missing = SyncMerge.applyResetCutoff(
            (backupSession.solves || []).filter(s => s && s.id && !have.has(s.id) && !deletedSolves.has(s.id)),
            resetAt
        );
        if (!missing.length) continue;
        session.solves = SyncMerge.mergeSolves(session.solves || [], missing, deletedSolves);
        for (const s of missing) restored.push({ sessionId: sid, id: s.id });
    }
    if (restored.length) {
        if (!timer.sessions[timer.currentSessionId]) {
            timer.currentSessionId = Object.keys(timer.sessions)[0] || 'no-session';
        }
        // Not necessarily in the cloud: queue them so they get uploaded.
        PendingSync.addPendingSolves(restored);
    }
    return restored.length;
}

function writeSafetyBackup(timer, user) {
    try {
        const info = AppStorage.getJSON(SAFETY_BACKUP_INFO_KEY, {}) || {};
        const count = countSolves(timer.sessions);
        const stale = !info.createdAt || (Date.now() - Number(info.createdAt)) > SAFETY_BACKUP_MIN_INTERVAL_MS;
        const differs = count !== (Number(info.solveCount) || 0) || (info.uid && info.uid !== user.uid);
        if (!stale || !differs) return;

        let ok = AppStorage.setJSON(SAFETY_BACKUP_KEY, timer.sessions);
        if (!ok) {
            // Out of localStorage: free the old snapshot and try once more.
            try { localStorage.removeItem(SAFETY_BACKUP_KEY); } catch (_) { /* ignore */ }
            ok = AppStorage.setJSON(SAFETY_BACKUP_KEY, timer.sessions);
        }
        if (!ok) {
            try { localStorage.removeItem(SAFETY_BACKUP_INFO_KEY); } catch (_) { /* ignore */ }
            console.warn('Safety snapshot skipped: not enough local storage.');
            return;
        }
        AppStorage.setJSON(SAFETY_BACKUP_INFO_KEY, { uid: user.uid, createdAt: Date.now(), solveCount: count });
    } catch (e) {
        console.warn('Safety snapshot failed:', e);
    }
}

// ---- Live listener on users/{uid} --------------------------------------
// One listener serves three purposes: (1) the metadata read that every sync
// needs (so sync itself no longer pays for it), (2) live updates of custom
// phrases and progression coming from another device, (3) nothing else.
let _metaListener = null; // { uid, unsubscribe, firstSnapshot }
let _liveMeta = { ready: false, data: null, uid: null };

// ---- Orchestration ------------------------------------------------------
const AppSync = {
    _requestedSync: null,
    _syncRequestedWhileRunning: false,
    lastSyncFinishedAt: 0,
    _retryTimer: null,
    _retryAttempt: 0,
    _lastMetaHash: null,
    _remoteMetaHash: null,
    _metaInFlight: null,
    _lastProgressionHash: null,
    _progressionTimer: null,

    requestSync() {
        if (this._requestedSync) {
            // Remember that someone asked while a sync was running; a re-run
            // happens only if there is unsent work left (see finally below).
            this._syncRequestedWhileRunning = true;
            return this._requestedSync;
        }
        this._syncRequestedWhileRunning = false;
        window.dispatchEvent(new CustomEvent('sync-status', { detail: { state: 'syncing' } }));
        this._requestedSync = Promise.resolve()
            .then(() => this.runSync())
            .then(ran => {
                if (ran) {
                    this.lastSyncFinishedAt = Date.now();
                    this._retryAttempt = 0;
                    clearTimeout(this._retryTimer);
                }
                window.dispatchEvent(new CustomEvent('sync-status', { detail: { state: 'synced', at: Date.now() } }));
            })
            .catch(error => {
                console.error('Automatic sync failed:', error);
                window.dispatchEvent(new CustomEvent('sync-status', { detail: { state: 'error', code: error?.code || 'unknown' } }));
                this._scheduleRetry();
            })
            .finally(() => {
                this._requestedSync = null;
                if (this._syncRequestedWhileRunning) {
                    this._syncRequestedWhileRunning = false;
                    // A solve created during the run is queued in PendingSync
                    // before its request starts, so "pending is empty" really
                    // means nothing is left to do. (Previously EVERY overlapping
                    // request -- login button + auth event + timer-ready --
                    // caused a second complete sync.)
                    if (PendingSync.hasPending()) queueMicrotask(() => this.requestSync());
                }
            });
        return this._requestedSync;
    },

    // After a failed sync: one retry with exponential backoff (30 s .. 15 min),
    // instead of the old fixed 15-second polling loop.
    _scheduleRetry() {
        clearTimeout(this._retryTimer);
        const delay = Math.min(15 * 60 * 1000, 30000 * Math.pow(2, this._retryAttempt++));
        this._retryTimer = setTimeout(() => requestSyncWhenReady({ force: true }), delay);
    },

    // Call this right after a successful login, and once on page load if
    // a session was restored. Returns true when a real sync ran.
    async runSync() {
        const timer = window.timer;
        if (!timer) return false;

        const user = window.CubeAuth?.getCurrentUser?.();
        if (!user) return false;

        // ---- Account switch: local caches belong to a different identity ----
        // Local tombstones and the local sessions cache live in this browser's
        // localStorage, which is NOT scoped to a Firebase account. If the
        // signed-in uid differs from the one this device last synced, a stale
        // "session X was deleted" tombstone from the previous account must not
        // be unioned into the new account's cloud list (that is what once made
        // sessions vanish on every device).
        const lastSyncedUid = AppStorage.getRaw('lastSyncedUid');
        if (lastSyncedUid && lastSyncedUid !== user.uid) {
            AppStorage.setJSON('deletedSolveIds', []);
            AppStorage.setJSON('deletedSessionIds', []);
            PendingSync.clearAll();
            AppStorage.setRaw('lastSyncedAt', '');
            AppStorage.setRaw('cloudSyncCursorV3', '');
            AppStorage.setRaw('cloudSyncInitializedV3', '');
            this._lastMetaHash = null;
            this._remoteMetaHash = null;
            this._lastProgressionHash = null;
            if (window.commentary?.setCustomPhrases) {
                window.commentary.setCustomPhrases({}, 0);
            } else {
                AppStorage.setJSON('customPhrases', {});
                AppStorage.setRaw('customPhrasesUpdatedAt', '0');
            }
            window.progression?.clearLocalState?.();
        }
        AppStorage.setRaw('lastSyncedUid', user.uid);

        // Protocol version. Bumping it forces ONE full re-read on every device
        // (cost = history size per device), so it stays at 7: nothing in the
        // cursor/merge semantics changed in a way that needs it.
        const syncProtocolVersion = '7';
        if (AppStorage.getRaw('syncProtocolVersion') !== syncProtocolVersion) {
            AppStorage.setRaw('lastSyncedAt', '');
            AppStorage.setRaw('cloudSyncCursorV3', '');
            AppStorage.setRaw('cloudSyncInitializedV3', '');
        }

        // Recover solves that went missing locally (union, never undoes deletes).
        const restoredCount = restoreFromSafetyBackup(timer, user);
        SyncTombstones.pruneOldSolveTombstones();

        const cloudCursor = Number(AppStorage.getRaw('cloudSyncCursorV3')) || 0;
        const localCountKey = `syncLocalSolveCount:${user.uid}`;
        const previousLocalSolveCount = Number(AppStorage.getRaw(localCountKey, ''));
        // A missing per-account baseline means this device may have a stale
        // global cursor from an older build. Read the complete cloud history
        // once so an empty/new browser can never skip existing solves.
        const missingAccountBaseline = AppStorage.getRaw(localCountKey, null) === null;
        // Intentional deletes/resets lower the baseline themselves, so this is
        // now true only for UNEXPLAINED losses (cache wiped, storage error).
        const localCountDropped = Number.isFinite(previousLocalSolveCount) && previousLocalSolveCount > 0
            && countSolves(timer.sessions) < previousLocalSolveCount;
        const isFullSync = AppStorage.getRaw('cloudSyncInitializedV3') !== '1' || missingAccountBaseline || localCountDropped;
        if (localCountDropped) {
            AppStorage.setRaw('lastSyncedAt', '');
            AppStorage.setRaw('cloudSyncCursorV3', '');
        }

        const [remoteMeta, remoteHistory] = await Promise.all([
            this.ensureMetaListener().then(() => CloudSync.pullMeta()),
            isFullSync ? CloudSync.pullAllSolvesOnce() : CloudSync.pullSolvesDelta(isFullSync ? 0 : cloudCursor)
        ]);

        // Custom commentary phrases are small account metadata. Use a
        // last-write-wins timestamp so additions and deletions made on one
        // device are reflected on every other signed-in device.
        const localCustomPhrasesUpdatedAt = Number(AppStorage.getRaw('customPhrasesUpdatedAt', '0')) || 0;
        const remoteCustomPhrasesUpdatedAt = Number(remoteMeta?.customPhrasesUpdatedAt) || 0;
        let shouldPushCustomPhrases = localCustomPhrasesUpdatedAt > remoteCustomPhrasesUpdatedAt;

        if (remoteMeta?.customPhrases && remoteCustomPhrasesUpdatedAt >= localCustomPhrasesUpdatedAt) {
            if (window.commentary?.setCustomPhrases) {
                window.commentary.setCustomPhrases(remoteMeta.customPhrases, remoteCustomPhrasesUpdatedAt || Date.now());
            } else {
                AppStorage.setJSON('customPhrases', remoteMeta.customPhrases);
                AppStorage.setRaw('customPhrasesUpdatedAt', String(remoteCustomPhrasesUpdatedAt || Date.now()));
            }
            shouldPushCustomPhrases = false;
        }
        if (remoteMeta?.progressionState) window.progression?.mergeCloudState?.(remoteMeta.progressionState);

        // Fold in tombstones from Firestore FIRST -- otherwise a solve/session
        // deleted on another device looks like one this device never heard was
        // deleted, and the union-merge below would resurrect it. The merge
        // unions into the already-cumulative local list, so passing only the
        // DELTA tombstones is correct.
        if (remoteMeta) {
            SyncTombstones.mergeRemoteSessionTombstones(remoteMeta.deletedSessionIds);
        }
        SyncTombstones.mergeRemoteSolveTombstones(remoteHistory.tombstones);

        const deletedSessionIds = SyncTombstones.getDeletedSessionIds();
        const deletedSolveIds = SyncTombstones.getDeletedSolveIds();
        const pendingIds = PendingSync.getPendingSolveIdSet();

        // Merge session metadata (names/disciplines/resetAt), solves merged below.
        const mergedSessions = remoteMeta
            ? SyncMerge.mergeSessionsMeta(timer.sessions, remoteMeta.sessions, deletedSessionIds)
            : { ...timer.sessions };

        // Group the flat remote solve list by sessionId.
        const remoteSolvesBySession = {};
        for (const solve of remoteHistory.solves) {
            const sid = solve.sessionId || 'no-session';
            (remoteSolvesBySession[sid] = remoteSolvesBySession[sid] || []).push(solve);
        }

        // A point-written solve can exist even if the small parent metadata
        // write was interrupted. Never discard that history just because the
        // session descriptor is temporarily absent.
        for (const sessionId of Object.keys(remoteSolvesBySession)) {
            if (!mergedSessions[sessionId] && !deletedSessionIds.has(sessionId)) {
                mergedSessions[sessionId] = {
                    id: sessionId,
                    name: sessionId === 'no-session' ? 'No Session' : 'Recovered Session',
                    discipline: '3x3',
                    solves: [],
                    subsessions: [],
                    isDefault: sessionId === 'no-session',
                    honestMode: null
                };
            }
        }

        // Solves that exist locally (or only in the legacy embedded field) but
        // never reached the subcollection. Only meaningful in a FULL sync --
        // there remoteSolves is the whole remote set, so "not found" really
        // means "missing from Firestore". Anything that fails to push later is
        // caught by PendingSync.
        const localSolvesNotYetRemote = [];
        for (const sessionId of Object.keys(mergedSessions)) {
            if (deletedSessionIds.has(sessionId)) continue;
            const localSolves = timer.sessions[sessionId]?.solves || [];
            const remoteSolves = remoteSolvesBySession[sessionId] || [];

            let base = localSolves;
            if (isFullSync) {
                // Backward-compat: sessions created before the subcollection
                // rewrite may still have their solves in the OLD embedded field.
                const legacySolves = (remoteMeta?.sessions?.[sessionId]?.solves) || [];
                base = SyncMerge.mergeSolves(localSolves, legacySolves, deletedSolveIds);
            }
            const merged = SyncMerge.applyResetCutoff(
                SyncMerge.mergeSolves(base, remoteSolves, deletedSolveIds, pendingIds),
                mergedSessions[sessionId].resetAt
            );
            mergedSessions[sessionId].solves = merged;
            mergedSessions[sessionId].id = sessionId;
            mergedSessions[sessionId].subsessions = Array.isArray(mergedSessions[sessionId].subsessions) ? mergedSessions[sessionId].subsessions : [];

            if (isFullSync) {
                const remoteIds = new Set(remoteSolves.map(s => s.id));
                for (const solve of merged) {
                    if (!remoteIds.has(solve.id) && !deletedSolveIds.has(solve.id)) {
                        localSolvesNotYetRemote.push({ sessionId, solve });
                    }
                }
            }
        }

        if (!Object.keys(mergedSessions).length) {
            mergedSessions['no-session'] = { id: 'no-session', name: 'No Session', solves: [], subsessions: [], isDefault: true, discipline: '3x3', honestMode: null };
        }

        timer.sessions = mergedSessions;
        if (!mergedSessions[timer.currentSessionId] && remoteMeta?.currentSessionId) {
            timer.currentSessionId = remoteMeta.currentSessionId;
        }
        if (!timer.sessions[timer.currentSessionId]) {
            timer.currentSessionId = Object.keys(timer.sessions)[0] || 'no-session';
        }
        timer.saveSessions();
        timer.renderSessionsList?.();
        timer.updateSessionDetails?.();
        timer.updateUI();

        // Keep the header's "logged in as ..." nickname fresh after a
        // restored session.
        if (remoteMeta?.nickname) {
            AppStorage.setJSON('authUser', { uid: user.uid, nickname: remoteMeta.nickname, email: user.email });
        }

        // Everything above succeeded -- safe to advance the delta baseline.
        // (A loop, not Math.max(...array): spreading a six-figure array
        // overflows the call stack.)
        let newestCursor = cloudCursor;
        for (const s of remoteHistory.solves) newestCursor = Math.max(newestCursor, Number(s.cloudUpdatedAt) || 0);
        for (const t of remoteHistory.tombstones) newestCursor = Math.max(newestCursor, Number(t.cloudDeletedAt) || 0);
        AppStorage.setRaw('cloudSyncCursorV3', String(newestCursor));
        AppStorage.setRaw('cloudSyncInitializedV3', '1');
        AppStorage.setRaw('syncProtocolVersion', syncProtocolVersion);
        AppStorage.setRaw(localCountKey, String(countSolves(timer.sessions)));

        // ---- Push phase: only what is actually different ----
        let deferredError = null;
        const fail = (message, code) => { if (!deferredError) deferredError = Object.assign(new Error(message), { code }); };

        // Remember what the cloud has, so identical content is not rewritten.
        this._seedRemoteMetaHash(remoteMeta, deletedSessionIds);
        if (!(await this.pushSessionsMetaNow())) fail('Session metadata write failed', 'metadata-write-failed');

        // Solves queued earlier (offline, failed) + solves that never reached
        // the cloud. Full sync only for the second kind; both use batched writes.
        if (localSolvesNotYetRemote.length) {
            PendingSync.addPendingSolves(localSolvesNotYetRemote.map(e => ({ sessionId: e.sessionId, id: e.solve.id })));
        }
        if ((await flushPendingSync()) > 0) fail('Pending solve writes failed', 'solve-write-failed');

        if (shouldPushCustomPhrases && !(await this.pushCustomPhrasesNow())) fail('Custom phrases write failed', 'phrases-write-failed');
        window.progression?.ensureDaily?.();
        if (window.progression) {
            const remoteProgressionHash = remoteMeta?.progressionState ? stableStringify(remoteMeta.progressionState) : null;
            if (!(await this.pushProgressionNow(remoteProgressionHash))) fail('Progression write failed', 'progression-write-failed');
        }

        writeSafetyBackup(timer, user);
        void restoredCount;
        this.startCustomPhrasesLiveSync();

        if (deferredError) throw deferredError;
        return true;
    },

    // ---- Point-write helpers, called directly from Timer on each action ----
    pushNewSolve(sessionId, solve) {
        CloudSync.pushNewSolve(sessionId, solve);
        window.dispatchEvent(new CustomEvent('timerdatachange', { detail: { type: 'solve', solveId: solve?.id } }));
    },
    pushSolveUpdate(solveId, patch) {
        CloudSync.pushSolveUpdate(solveId, patch);
        window.dispatchEvent(new CustomEvent('timerdatachange', { detail: { type: 'update', solveId } }));
    },
    pushSolveDelete(solveId) {
        CloudSync.pushSolveDelete(solveId);
        window.dispatchEvent(new CustomEvent('timerdatachange', { detail: { type: 'delete', solveId } }));
    },

    // "Reset session": clears the solves but keeps the session. Costs ONE
    // metadata write (the `resetAt` marker travels with the session metadata
    // that saveSessions() pushes), not one delete per solve. Call this INSTEAD
    // of `session.solves = []`; the caller still calls saveSessions().
    resetSessionSolves(session) {
        if (!session) return 0;
        const removed = Array.isArray(session.solves) ? session.solves.length : 0;
        session.solves = [];
        session.resetAt = Date.now();
        PendingSync.removePendingForSession(session.id);
        adjustLocalCountBaseline(-removed);
        window.dispatchEvent(new CustomEvent('timerdatachange', { detail: { type: 'reset', sessionId: session.id } }));
        return removed;
    },

    async pushCustomPhrasesNow() {
        if (!window.CubeAuth || !window.CubeAuth.getCurrentUser()) return false;
        const customPhrases = AppStorage.getJSON('customPhrases', {});
        const customPhrasesUpdatedAt = Number(AppStorage.getRaw('customPhrasesUpdatedAt', '0')) || Date.now();
        return CloudSync.pushCustomPhrases(customPhrases, customPhrasesUpdatedAt);
    },

    // Progression is written only when its content differs from what was last
    // written / what the cloud already holds.
    async pushProgressionNow(knownRemoteHash = null) {
        if (!window.CubeAuth || !window.CubeAuth.getCurrentUser() || !window.progression) return false;
        clearTimeout(this._progressionTimer);
        this._progressionTimer = null;
        const state = window.progression.exportState();
        const hash = stableStringify(state);
        if (hash === this._lastProgressionHash || hash === knownRemoteHash) {
            this._lastProgressionHash = hash;
            return true;
        }
        const ok = await CloudSync.pushMeta({ progressionState: state });
        if (ok) this._lastProgressionHash = hash;
        return ok;
    },
    // Debounced variant used by the progression system on every change
    // (coins, achievements, ...): several changes in a row -> one write.
    queueProgressionPush(delay = PROGRESSION_PUSH_DEBOUNCE_MS) {
        if (!window.CubeAuth?.getCurrentUser?.()) return;
        clearTimeout(this._progressionTimer);
        this._progressionTimer = setTimeout(() => this.pushProgressionNow(), delay);
    },

    async pushImportedSessions(sessionGroups) {
        const entries = [];
        (sessionGroups || []).forEach(group => (group.solves || []).forEach(solve => {
            if (solve?.id) entries.push({ sessionId: group.sessionId, id: solve.id });
        }));
        // Queue first: if the tab is closed mid-upload, the next sync retries.
        PendingSync.addPendingSolves(entries);
        if (!window.CubeAuth?.getCurrentUser?.()) return false;
        if (!window.CubeSync?.saveSolvesBatch) {
            window.dispatchEvent(new CustomEvent('sync-status', { detail: { state: 'error', code: 'batch-api-unavailable' } }));
            return false;
        }
        window.dispatchEvent(new CustomEvent('sync-status', { detail: { state: 'syncing' } }));
        try {
            for (const group of (sessionGroups || [])) {
                await window.CubeSync.saveSolvesBatch(group.sessionId, group.solves || []);
                PendingSync.removePendingSolves((group.solves || []).map(s => s?.id));
            }
            await this.pushSessionsMetaNow();
            // No full re-read and no "verify everything" pass any more: the
            // batch commit is atomic, and the next delta sync picks the
            // imported documents up by cursor.
            window.dispatchEvent(new CustomEvent('sync-status', { detail: { state: 'synced', at: Date.now() } }));
            return true;
        } catch (error) {
            console.error('Imported solve upload failed:', error);
            window.dispatchEvent(new CustomEvent('sync-status', { detail: { state: 'error', code: error?.code || 'import-upload-failed' } }));
            return false;
        }
    },

    // Starts (once per account) the listener on users/{uid} and resolves after
    // its first snapshot, which doubles as the metadata read of a sync.
    ensureMetaListener() {
        const user = window.CubeAuth?.getCurrentUser?.();
        if (!user || !window.CubeSync?.subscribeUserData) return Promise.resolve(false);
        if (_metaListener && _metaListener.uid === user.uid) return _metaListener.firstSnapshot;
        this.stopCustomPhrasesLiveSync();

        const uid = user.uid;
        let first = true;
        let resolveFirst;
        const firstSnapshot = new Promise(resolve => { resolveFirst = resolve; });
        _liveMeta = { ready: false, data: null, uid };
        try {
            const unsubscribe = window.CubeSync.subscribeUserData((remote, info) => {
                if (_liveMeta.uid !== uid) return;
                _liveMeta.data = remote;
                _liveMeta.ready = true;
                if (first) {
                    first = false;
                    resolveFirst(true);
                    return; // runSync merges this very snapshot itself
                }
                this._applyLiveSnapshot(remote, info);
            }, (error) => {
                console.error('Metadata live listener failed:', error);
                if (_metaListener?.uid === uid) { _metaListener = null; _liveMeta = { ready: false, data: null, uid: null }; }
                resolveFirst(false); // sync falls back to a one-off getDoc
            });
            _metaListener = { uid, unsubscribe, firstSnapshot };
        } catch (e) {
            console.error('Could not start metadata live listener:', e);
            return Promise.resolve(false);
        }
        return firstSnapshot;
    },

    // A change made on another device (progression, custom phrases).
    _applyLiveSnapshot(remote, info) {
        if (info?.pending) return; // echo of our own unsent write
        if (remote?.progressionState) {
            const hash = stableStringify(remote.progressionState);
            if (hash !== this._lastProgressionHash) {
                window.progression?.mergeCloudState?.(JSON.parse(JSON.stringify(remote.progressionState)));
            }
        }
        const remoteUpdatedAt = Number(remote?.customPhrasesUpdatedAt) || 0;
        const localUpdatedAt = Number(AppStorage.getRaw('customPhrasesUpdatedAt', '0')) || 0;
        if (!remote?.customPhrases || remoteUpdatedAt <= localUpdatedAt) return;
        if (window.commentary?.setCustomPhrases) {
            window.commentary.setCustomPhrases(remote.customPhrases, remoteUpdatedAt);
        } else {
            AppStorage.setJSON('customPhrases', remote.customPhrases);
            AppStorage.setRaw('customPhrasesUpdatedAt', String(remoteUpdatedAt));
            window.dispatchEvent(new CustomEvent('customphraseschange'));
        }
    },

    // Kept under the old names: firebase-init.js calls stopCustomPhrasesLiveSync
    // on sign-out and runSync() calls startCustomPhrasesLiveSync().
    startCustomPhrasesLiveSync() {
        this.ensureMetaListener();
    },
    stopCustomPhrasesLiveSync() {
        if (_metaListener) { try { _metaListener.unsubscribe(); } catch (_) { /* ignore */ } }
        _metaListener = null;
        _liveMeta = { ready: false, data: null, uid: null };
        this._lastMetaHash = null;
        this._remoteMetaHash = null;
        this._lastProgressionHash = null;
    },

    // ---- Session metadata (names/disciplines/current session/tombstones) ----
    _buildMetaPayload() {
        const timer = window.timer;
        const sessionsMeta = {};
        for (const [id, session] of Object.entries(timer.sessions)) {
            const { solves, ...meta } = session; // eslint-disable-line no-unused-vars
            sessionsMeta[id] = meta;
        }
        return {
            sessions: sessionsMeta,
            currentSessionId: timer.currentSessionId,
            // sorted, so the same set always hashes the same
            deletedSessionIds: [...SyncTombstones.getDeletedSessionEntries()].sort((a, b) => String(a.id).localeCompare(String(b.id)))
        };
    },

    // Remember what the cloud currently holds for the metadata fields we write.
    _seedRemoteMetaHash(remoteMeta, deletedSessionIds) {
        if (!remoteMeta || !remoteMeta.sessions) { this._remoteMetaHash = null; return; }
        const sessions = {};
        for (const [id, session] of Object.entries(remoteMeta.sessions)) {
            if (deletedSessionIds.has(id)) continue; // lingers in the cloud map, we never send it
            const { solves, ...meta } = session || {}; // eslint-disable-line no-unused-vars
            sessions[id] = meta;
        }
        this._remoteMetaHash = stableStringify({
            sessions,
            currentSessionId: remoteMeta.currentSessionId,
            deletedSessionIds: [...(remoteMeta.deletedSessionIds || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)))
        });
    },

    // Writes metadata only if its CONTENT changed (same hash as the last write
    // or as what the cloud already has -> no write). This is what removes the
    // "3 writes on every sync / on every solve" of the old version.
    pushSessionsMetaNow() {
        if (!window.CubeAuth || !window.CubeAuth.getCurrentUser()) return false;
        const timer = window.timer;
        if (!timer) return false;
        const payload = this._buildMetaPayload();
        const hash = stableStringify(payload);
        if (hash === this._lastMetaHash || hash === this._remoteMetaHash) return Promise.resolve(true);
        if (this._metaInFlight && this._metaInFlight.hash === hash) return this._metaInFlight.promise;
        const promise = CloudSync.pushMeta(payload).then(ok => {
            if (ok) { this._lastMetaHash = hash; this._remoteMetaHash = null; }
            return ok;
        }).finally(() => { if (this._metaInFlight?.promise === promise) this._metaInFlight = null; });
        this._metaInFlight = { hash, promise };
        return promise;
    }
};

// ---- Live autosync of METADATA ONLY: push after session-level changes --
// Called from Timer.saveSessions() -- which also runs after every solve.
// Debounced hard and content-hashed: a plain solve changes nothing in the
// metadata, so nothing is written for it.
let _metaPushTimer = null;
function queueAutoPush() {
    if (!window.CubeAuth || !window.CubeAuth.getCurrentUser()) return;
    clearTimeout(_metaPushTimer);
    _metaPushTimer = setTimeout(() => {
        _metaPushTimer = null;
        AppSync.pushSessionsMetaNow();
    }, META_PUSH_DEBOUNCE_MS);
}
window.queueAutoPush = queueAutoPush;

// Send debounced writes right away when the tab is hidden / closed.
function flushDebouncedPushes() {
    if (_metaPushTimer) {
        clearTimeout(_metaPushTimer);
        _metaPushTimer = null;
        AppSync.pushSessionsMetaNow();
    }
    if (AppSync._progressionTimer) AppSync.pushProgressionNow();
}

window.SyncTombstones = SyncTombstones;
window.SyncMerge = SyncMerge;
window.CloudSync = CloudSync;
window.AppSync = AppSync;
window.PendingSync = PendingSync;

// ---- When does a sync start? --------------------------------------------
// Firebase, AppSync and CubeTimer are loaded by separate scripts. Whichever
// becomes ready last starts the first sync (forced). Later triggers are
// throttled: coming back to the tab, going online, or an idle tab that stays
// visible. There is deliberately NO fixed-interval polling any more -- the
// old setInterval(..., 15000) re-ran a full sync (3+ reads, 3 writes) every
// 15 seconds in every open tab, 24/7.
function requestSyncWhenReady(options = {}) {
    if (!window.timer || !window.CubeAuth?.getCurrentUser?.()) return;
    const force = options.force === true;
    if (!force && !PendingSync.hasPending() && Date.now() - AppSync.lastSyncFinishedAt < SYNC_MIN_INTERVAL_MS) return;
    AppSync.requestSync();
}
const forceSync = () => requestSyncWhenReady({ force: true });
const throttledSync = () => requestSyncWhenReady();

window.addEventListener('firebase-ready', forceSync);
window.addEventListener('firebase-auth-state', forceSync);
window.addEventListener('timer-ready', forceSync);
window.addEventListener('online', throttledSync);
window.addEventListener('focus', throttledSync);
window.addEventListener('pagehide', flushDebouncedPushes);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') throttledSync();
    else flushDebouncedPushes();
});
// A tab left open and visible (second monitor): re-check now and then. The
// throttle above turns this into at most one sync per SYNC_MIN_INTERVAL_MS.
setInterval(() => { if (document.visibilityState === 'visible') throttledSync(); }, 5 * 60 * 1000);
if (document.readyState !== 'loading') queueMicrotask(forceSync);

// ---- Auth error messages -------------------------------------------------
// Maps Firebase Auth error codes to a friendly, translated message.
// Use like: showErr(window.authFirebaseErrorMessage(error.code, getLang()))
// once real sign-in/sign-up calls are wired into the auth buttons.
function authFirebaseErrorMessage(code, lang) {
    const t = translations[lang || getLang()];
    switch (code) {
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
            return t.authErrWrongPassword;
        case 'auth/user-not-found':
            return t.authErrUserNotFound;
        case 'auth/email-already-in-use':
            return t.authErrEmailInUse;
        case 'auth/invalid-email':
            return t.authErrEmailFormat;
        case 'auth/weak-password':
            return t.authErrPasswordShort;
        case 'auth/too-many-requests':
            return t.authErrTooManyRequests;
        default:
            return t.authErrGeneric;
    }
}

window.authFirebaseErrorMessage = authFirebaseErrorMessage;