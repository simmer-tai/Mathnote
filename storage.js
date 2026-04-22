/**
 * MathNote - ストレージ・Firebase同期
 * app.js から分離
 */

function getStoragePrefix() {
    const user = window.firebaseAuth && window.firebaseAuth.currentUser;
    return user ? `mathnote_${user.uid}` : 'mathnote_guest';
}

function storageKey(name) {
    return `${getStoragePrefix()}_${name}`;
}

function migrateOldStorage(uid) {
    // 古いキーが存在すれば新キーへコピーして削除
    const oldIndex = localStorage.getItem('mathnote_index');
    if (oldIndex) {
        localStorage.setItem(`mathnote_${uid}_index`, oldIndex);
        localStorage.removeItem('mathnote_index');
    }
    const oldTags = localStorage.getItem('mathnote_tags');
    if (oldTags) {
        localStorage.setItem(`mathnote_${uid}_tags`, oldTags);
        localStorage.removeItem('mathnote_tags');
    }
    // mathnote_note_xxxxx 系を全スキャンして移行
    Object.keys(localStorage)
        .filter(k => k.startsWith('mathnote_note_'))
        .forEach(k => {
            const newKey = k.replace('mathnote_', `mathnote_${uid}_notes_`);
            localStorage.setItem(newKey, localStorage.getItem(k));
            localStorage.removeItem(k);
        });

    // 既存の壊れたキー（note_ が二重のもの）を修正
    Object.keys(localStorage)
        .filter(k => k.includes('_note_note_'))
        .forEach(k => {
            const newKey = k.replace('_note_note_', '_notes_note_');
            localStorage.setItem(newKey, localStorage.getItem(k));
            localStorage.removeItem(k);
        });
}

// 他のファイル（library.js等）からも参照できるように公開
window.getStoragePrefix = getStoragePrefix;
window.storageKey = storageKey;
window.migrateOldStorage = migrateOldStorage;

if (typeof MathNote !== 'undefined') {
    MathNote.prototype.debouncedSave = function() {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this.saveCurrentNote(), 800);
    };

    MathNote.prototype.saveCurrentNote = function() {
        const noteData = {
            paths: this.paths,
            textBlocks: this.textBlocks,
            graphObjects: this.graphObjects,
            shapeObjects: this.shapeObjects,
            lineObjects: this.lineObjects,
            updatedAt: Date.now()
        };

        // indexを一度だけ読む
        let index = [];
        try {
            index = JSON.parse(localStorage.getItem(storageKey('index')) || '[]');
            if (!Array.isArray(index)) index = [];
        } catch (e) { index = []; }

        if (!this.noteId) {
            this.noteId = 'note_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
            const newUrl = new URL(window.location);
            newUrl.searchParams.set('id', this.noteId);
            window.history.replaceState({}, '', newUrl);
            index.push({ id: this.noteId, name: this.noteName, tags: [], updatedAt: noteData.updatedAt });
        } else {
            const entryIdx = index.findIndex(e => e.id === this.noteId);
            if (entryIdx !== -1) index[entryIdx].updatedAt = noteData.updatedAt;
        }

        localStorage.setItem(`${storageKey('notes')}_${this.noteId}`, JSON.stringify(noteData));
        localStorage.setItem(storageKey('index'), JSON.stringify(index));
    };

    MathNote.prototype.loadNote = function() {
        const params = new URLSearchParams(window.location.search);
        this.noteId = params.get('id');

        let data = null;
        if (this.noteId) {
            const s = localStorage.getItem(`${storageKey('notes')}_${this.noteId}`);
            if (s) {
                try {
                    data = JSON.parse(s);
                    // インデックスから名前を取得
                    let index = [];
                    try {
                        index = JSON.parse(localStorage.getItem(storageKey('index')) || '[]');
                        if (!Array.isArray(index)) index = [];
                    } catch (e) { index = []; }

                    const entry = index.find(e => e.id === this.noteId);
                    if (entry) this.noteName = entry.name;
                } catch (e) {
                    console.error("ノートのロードに失敗しました:", e);
                    data = null;
                }
            }
        }

        if (data) {
            this.note = data;
        } else {
            // 新規ノート
            this.note = {
                paths: [], textBlocks: [], graphObjects: [], shapeObjects: [], lineObjects: [],
                updatedAt: Date.now()
            };
            this.noteId = null;
            this.noteName = "名称未設定";
        }

        this.paths = this.note.paths || [];
        this.textBlocks = this.note.textBlocks || [];
        this.graphObjects = this.note.graphObjects || [];
        this.shapeObjects = this.note.shapeObjects || [];
        this.lineObjects = this.note.lineObjects || [];

        // UI同期
        const display = document.getElementById('board-title-display');
        const input = document.getElementById('board-title-input');
        if (display) display.innerText = this.noteName;
        if (input) input.value = this.noteName;

        document.querySelectorAll('.math-block').forEach(el => el.remove());
        this.textBlocks.forEach(b => this.createTextBlockElement(b));
        this.draw();
    };

    MathNote.prototype.renameNote = function(name) {
        this.noteName = name;
        let index = JSON.parse(localStorage.getItem(storageKey('index')) || '[]');
        const entryIdx = index.findIndex(e => e.id === this.noteId);
        if (entryIdx !== -1) {
            index[entryIdx].name = name;
            localStorage.setItem(storageKey('index'), JSON.stringify(index));
        }
    };

    MathNote.prototype.syncToFirebase = function() {
        const user = window.firebaseAuth.currentUser;
        if (!user || !this.noteId) return;

        const localNoteStr = localStorage.getItem(`${storageKey('notes')}_${this.noteId}`);
        const localNote = localNoteStr ? JSON.parse(localNoteStr) : null;
        const indexStr = localStorage.getItem(storageKey('index')) || '[]';
        const index = JSON.parse(indexStr);
        const entry = index.find(e => e.id === this.noteId);

        if (!localNote || !entry) return;

        // 統合ノートオブジェクト作成
        const fullNote = {
            id: this.noteId,
            name: entry.name,
            data: localNote,
            tags: entry.tags || [],
            headerColor: entry.headerColor || null,
            updatedAt: localNote.updatedAt,
            // サムネイル生成（簡易版）
            thumbnail: this.canvas.toDataURL('image/webp', 0.1)
        };

        const dbRef = window.firebaseRef(window.firebaseDB, `users/${user.uid}/notes/${this.noteId}`);
        window.firebaseSet(dbRef, fullNote).catch(err => console.error("Sync Up Error:", err));
    };

    MathNote.prototype.syncFromFirebase = function() {
        const user = window.firebaseAuth.currentUser;
        if (!user) return;

        const dbRef = window.firebaseRef(window.firebaseDB);
        window.firebaseGet(window.firebaseChild(dbRef, `users/${user.uid}/notes`)).then(snapshot => {
            if (!snapshot.exists()) return;

            const firebaseNotes = snapshot.val();
            let localIndex = JSON.parse(localStorage.getItem(storageKey('index')) || '[]');
            if (!Array.isArray(localIndex)) localIndex = [];

            let changed = false;

            for (const id in firebaseNotes) {
                const fbNote = firebaseNotes[id];
                const localNoteStr = localStorage.getItem(`${storageKey('notes')}_${id}`);
                const localNote = localNoteStr ? JSON.parse(localNoteStr) : null;

                // マージロジック
                if (!localNote || fbNote.updatedAt > localNote.updatedAt) {
                    // Firebaseの方が新しい、またはローカルに存在しない
                    localStorage.setItem(`${storageKey('notes')}_${id}`, JSON.stringify(fbNote.data));
                    
                    const idx = localIndex.findIndex(e => e.id === id);
                    const entry = { 
                        id, 
                        name: fbNote.name, 
                        tags: fbNote.tags || [], 
                        updatedAt: fbNote.updatedAt,
                        headerColor: fbNote.headerColor || null
                    };
                    
                    if (idx !== -1) localIndex[idx] = entry;
                    else localIndex.push(entry);
                    
                    changed = true;
                } else if (localNote && localNote.updatedAt > fbNote.updatedAt) {
                    // ローカルの方が新しい -> Firebaseへアップロード
                    // (個別ノートに関しては saveCurrentNote で行われるが、一括同期時も必要ならここで行う)
                    // 今回は個別の保存契機に任せる
                }
            }

            if (changed) {
                localStorage.setItem(storageKey('index'), JSON.stringify(localIndex));
                // メインボードが今のノートならリロード
                if (this.noteId && firebaseNotes[this.noteId] && firebaseNotes[this.noteId].updatedAt > (this.updatedAt || 0)) {
                    this.loadNote();
                }
            }
        }).catch(err => {
            console.error("Sync Down Error:", err);
        });
    };

    MathNote.prototype.setupAuth = function() {
        if (!window.onAuthStateChanged) {
            // SDKロード完了を待ってリトライ
            const retryAuth = () => {
                if (window.onAuthStateChanged) {
                    this.setupAuth();
                } else {
                    setTimeout(retryAuth, 100);
                }
            };
            setTimeout(retryAuth, 100);
            return;
        }

        const loginBtn = document.getElementById('google-login-btn');
        const userAvatar = document.getElementById('user-avatar');
        const userIcon = document.getElementById('user-icon');
        const userName = document.getElementById('user-name');
        const logoutBtn = document.getElementById('google-logout-btn');

        if (loginBtn) loginBtn.onclick = () => this.loginWithGoogle();
        if (logoutBtn) logoutBtn.onclick = () => this.logoutFromGoogle();
        
        if (userAvatar) {
            userAvatar.onclick = (e) => {
                e.stopPropagation();
                const menu = document.getElementById('auth-menu');
                if (menu) menu.classList.toggle('hidden');
            };
        }
        window.onclick = () => {
            const menu = document.getElementById('auth-menu');
            if (menu) menu.classList.add('hidden');
        };

        window.onAuthStateChanged(window.firebaseAuth, (user) => {
            if (user) {
                migrateOldStorage(user.uid);
                this.loadNote();
                if (loginBtn) loginBtn.classList.add('hidden');
                if (userAvatar) {
                    userAvatar.classList.remove('hidden');
                    if (userIcon) userIcon.src = user.photoURL || '';
                    if (userName) userName.innerText = user.displayName || 'User';
                }
                this.syncFromFirebase();
            } else {
                this.loadNote();
                if (loginBtn) loginBtn.classList.remove('hidden');
                if (userAvatar) userAvatar.classList.add('hidden');
                // ログアウト時はライブラリへ戻す（別ユーザーのキャッシュを誤表示しないため）
                window.location.href = 'library.html';
            }
        });
    };

    MathNote.prototype.loginWithGoogle = function() {
        const provider = new window.GoogleAuthProvider();
        window.signInWithPopup(window.firebaseAuth, provider).catch(err => console.error(err));
    };

    MathNote.prototype.logoutFromGoogle = function() {
        window.signOut(window.firebaseAuth).catch(err => console.error(err));
    };
}

