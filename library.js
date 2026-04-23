/**
 * MathNote - ライブラリ画面ロジック
 * library.html から分離されたスクリプト
 */

let currentActiveTagId = 'all';
let currentSearchQuery = '';

function createNewNote() {
    window.location.href = 'index.html';
}

function initDefaultTags() {
    let existing = [];
    try {
        existing = JSON.parse(localStorage.getItem(window.storageKey('tags')) || '[]');
        if (!Array.isArray(existing)) existing = [];
    } catch (e) {
        existing = [];
    }

    const needsMigration = existing.length === 0 || existing.some(t => !t.genre);
    
    if (needsMigration) {
        const defaultTags = [
            { id: 'tag_math',    name: '数学',       color: '#89b4fa', genre: '科目' },
            { id: 'tag_physics', name: '物理',       color: '#cba6f7', genre: '科目' },
            { id: 'tag_chem',    name: '化学',       color: '#a6e3a1', genre: '科目' },
            { id: 'tag_bio',     name: '生物',       color: '#94e2d5', genre: '科目' },
            { id: 'tag_eng',     name: '英語',       color: '#f38ba8', genre: '科目' },
            { id: 'tag_jpn',     name: '国語',       color: '#eba0ac', genre: '科目' },
            { id: 'tag_hist',    name: '歴史',       color: '#e5c890', genre: '科目' },
            { id: 'tag_geo',     name: '地理',       color: '#81c8be', genre: '科目' },
            { id: 'tag_info',    name: '情報',       color: '#ef9f76', genre: '科目' },
            { id: 'tag_imp',     name: '重要',       color: '#f38ba8', genre: 'ステータス' },
            { id: 'tag_rev',     name: '復習必要',   color: '#f9e2af', genre: 'ステータス' },
            { id: 'tag_test',    name: 'テスト範囲', color: '#cba6f7', genre: 'ステータス' },
            { id: 'tag_done',    name: '完了',       color: '#a6e3a1', genre: 'ステータス' },
            { id: 'tag_wip',     name: '未完成',     color: '#585b70', genre: 'ステータス' },
        ];

        // 既存のカスタムタグはgenre:'その他'として保持
        const customTags = existing.filter(t => !t.id.startsWith('tag_')).map(t => {
            if (!t.genre) t.genre = 'その他';
            return t;
        });

        // デフォルトタグとカスタムタグを結合して保存
        localStorage.setItem(window.storageKey('tags'), JSON.stringify([...defaultTags, ...customTags]));
    }
}

function loadTags() {
    let tags = [];
    try {
        tags = JSON.parse(localStorage.getItem(window.storageKey('tags')) || '[]');
        if (!Array.isArray(tags)) tags = [];
    } catch (e) { tags = []; }

    const tagList = document.getElementById('tag-list');
    
    // "すべて" 以外をクリア
    const allItem = tagList.querySelector('[data-tag-id="all"]');
    tagList.innerHTML = '';
    tagList.appendChild(allItem);

    tags.forEach(tag => {
        const li = document.createElement('li');
        li.className = `tag-item ${currentActiveTagId === tag.id ? 'active' : ''}`;
        li.dataset.tagId = tag.id;
        li.onclick = () => filterByTag(tag.id);
        li.oncontextmenu = (e) => {
            e.preventDefault();
            handleTagContextMenu(tag, e);
        };
        li.innerHTML = `
            <span class="tag-dot" style="background:${tag.color}"></span>
            <span class="tag-name">${tag.name}</span>
        `;
        tagList.appendChild(li);
    });
}

function filterByTag(tagId) {
    currentActiveTagId = tagId;
    document.querySelectorAll('.tag-item').forEach(el => {
        el.classList.toggle('active', el.dataset.tagId === tagId);
    });
    loadLibrary(tagId);
}

function loadLibrary(activeTagId = 'all') {
    let index = [];
    let tags = [];
    try {
        index = JSON.parse(localStorage.getItem(window.storageKey('index')) || '[]');
        if (!Array.isArray(index)) index = [];
        tags = JSON.parse(localStorage.getItem(window.storageKey('tags')) || '[]');
        if (!Array.isArray(tags)) tags = [];
    } catch (e) {
        index = []; tags = [];
    }
    const grid = document.getElementById('library-grid');
    const emptyState = document.getElementById('empty-state');

    // フィルタリング
    let filtered = index;
    if (activeTagId !== 'all') {
        filtered = index.filter(note => note.tags && note.tags.includes(activeTagId));
    }

    // テキスト検索フィルタ
    if (currentSearchQuery) {
        filtered = filtered.filter(note =>
            (note.name || '').toLowerCase().includes(currentSearchQuery)
        );
    }

    // 更新日時で降順ソート
    filtered.sort((a, b) => b.updatedAt - a.updatedAt);

    if (filtered.length === 0 && index.length === 0) {
        emptyState.classList.remove('hidden');
        grid.classList.add('hidden');
        if (window.lucide) lucide.createIcons();
        return;
    } else {
        emptyState.classList.add('hidden');
        grid.classList.remove('hidden');
    }

    grid.innerHTML = '';
    filtered.forEach(note => {
        const card = document.createElement('div');
        card.className = 'note-card';
        card.dataset.noteId = note.id;
        
        // カード全体クリックでノートを開く（ヘッダーやタグボタンなどは除く）
        card.onclick = (e) => {
            if (e.target.closest('.note-card-header') || e.target.closest('.tag-add-btn') || e.target.closest('.tag-badge')) return;
            window.location.href = `index.html?id=${note.id}`;
        };

        const date = new Date(note.updatedAt).toLocaleString('ja-JP', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });

        // ヘッダー色の決定
        let headerColor = note.headerColor;
        if (!headerColor && note.tags && note.tags.length > 0) {
            const firstTag = tags.find(t => t.id === note.tags[0]);
            if (firstTag) headerColor = firstTag.color;
        }
        if (!headerColor) headerColor = '#e0e0e0';

        // ヘッダー生成
        const headerEl = document.createElement('div');
        headerEl.className = 'note-card-header';
        headerEl.style.background = headerColor;
        headerEl.addEventListener('click', (e) => {
            e.stopPropagation(); // カード遷移を防ぐ
            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.value = headerColor;
            colorInput.addEventListener('change', (ce) => {
                const newColor = ce.target.value;
                // mathnote_indexのheaderColorを更新
                let idxData = JSON.parse(localStorage.getItem(window.storageKey('index')) || '[]');
                const idx = idxData.findIndex(n => n.id === note.id);
                if (idx !== -1) {
                    idxData[idx].headerColor = newColor;
                    localStorage.setItem(window.storageKey('index'), JSON.stringify(idxData));
                }
                headerEl.style.background = newColor;
            });
            colorInput.click();
        });

        // ボディ生成
        const bodyEl = document.createElement('div');
        bodyEl.className = 'note-card-body';

        // タグバッジの生成
        let tagsHtml = '';
        if (note.tags) {
            note.tags.forEach(tId => {
                const t = tags.find(tag => tag.id === tId);
                if (t) {
                    tagsHtml += `<span class="tag-badge" style="background:${t.color}" onclick="removeTagFromNote('${note.id}', '${t.id}', event)">${t.name}</span>`;
                }
            });
        }

        bodyEl.innerHTML = `
            <div class="note-name">${note.name}</div>
            <div class="note-date">最終更新: ${date}</div>
            <div class="note-tags">
                ${tagsHtml}
                <button class="tag-add-btn" onclick="showTagDropdown('${note.id}', this)">＋</button>
            </div>
        `;

        card.appendChild(headerEl);
        card.appendChild(bodyEl);
        grid.appendChild(card);
    });

    if (window.lucide) lucide.createIcons();
}

function handleSearch(query) {
    currentSearchQuery = query.trim().toLowerCase();
    loadLibrary(currentActiveTagId);
}

// --- タグモーダル関連 ---

function openTagModalForCreate() {
    const modal = document.getElementById('tag-modal');
    modal.style.display = 'flex';
    modal.dataset.mode = 'create';
    modal.dataset.editingTagId = '';

    document.getElementById('tag-modal-title').innerText = 'タグを作成';
    document.getElementById('tag-modal-name').value = '';
    document.getElementById('tag-modal-name').readOnly = false;
    document.getElementById('tag-modal-delete').style.display = 'none';
    document.getElementById('tag-modal-save').innerText = '保存';
    document.getElementById('tag-modal-save').className = 'tag-modal-btn-save';

    // ジャンル初期化
    document.querySelectorAll('#tag-modal-genres .genre-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.genre === '科目');
    });

    initTagModalColors();
}

function handleTagContextMenu(tag, e) {
    const menu = document.getElementById('tag-context-menu');
    menu.style.display = 'block';
    menu.dataset.contextTagId = tag.id;

    let x = e.clientX;
    let y = e.clientY;

    // はみ出し防止
    const menuWidth = 120;
    const menuHeight = 80;
    if (x + menuWidth > window.innerWidth) x -= menuWidth;
    if (y + menuHeight > window.innerHeight) y -= menuHeight;

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
}

function openTagModalForEdit() {
    const menu = document.getElementById('tag-context-menu');
    const tagId = menu.dataset.contextTagId;
    menu.style.display = 'none';

    const tags = JSON.parse(localStorage.getItem(window.storageKey('tags')) || '[]');
    const tag = tags.find(t => t.id === tagId);
    if (!tag) return;

    const modal = document.getElementById('tag-modal');
    modal.style.display = 'flex';
    modal.dataset.mode = 'edit';
    modal.dataset.editingTagId = tagId;

    document.getElementById('tag-modal-title').innerText = 'タグを編集';
    document.getElementById('tag-modal-name').value = tag.name;
    document.getElementById('tag-modal-name').readOnly = false;
    document.getElementById('tag-modal-delete').style.display = 'block';
    document.getElementById('tag-modal-save').innerText = '保存';
    document.getElementById('tag-modal-save').className = 'tag-modal-btn-save';

    // ジャンル初期化
    document.querySelectorAll('#tag-modal-genres .genre-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.genre === (tag.genre || 'その他'));
    });

    initTagModalColors(tag.color);
}

function openTagModalForDelete() {
    const menu = document.getElementById('tag-context-menu');
    const tagId = menu.dataset.contextTagId;
    menu.style.display = 'none';

    const tags = JSON.parse(localStorage.getItem(window.storageKey('tags')) || '[]');
    const tag = tags.find(t => t.id === tagId);
    if (!tag) return;

    const modal = document.getElementById('tag-modal');
    modal.style.display = 'flex';
    modal.dataset.mode = 'delete';
    modal.dataset.editingTagId = tagId;

    document.getElementById('tag-modal-title').innerText = 'タグを削除しますか？';
    document.getElementById('tag-modal-name').value = tag.name;
    document.getElementById('tag-modal-name').readOnly = true;
    document.getElementById('tag-modal-delete').style.display = 'none';
    document.getElementById('tag-modal-save').innerText = '削除する';
    document.getElementById('tag-modal-save').className = 'tag-modal-btn-save danger';

    initTagModalColors(tag.color);
}

function confirmDeleteTagFromModal() {
    const modal = document.getElementById('tag-modal');
    const tagId = modal.dataset.editingTagId;
    
    const tags = JSON.parse(localStorage.getItem(window.storageKey('tags')) || '[]');
    const tag = tags.find(t => t.id === tagId);
    if (!tag) return;

    modal.dataset.mode = 'delete';
    document.getElementById('tag-modal-title').innerText = 'タグを削除しますか？';
    document.getElementById('tag-modal-name').readOnly = true;
    document.getElementById('tag-modal-delete').style.display = 'none';
    document.getElementById('tag-modal-save').innerText = '削除する';
    document.getElementById('tag-modal-save').className = 'tag-modal-btn-save danger';
}

function saveTagFromModal() {
    const modal = document.getElementById('tag-modal');
    const mode = modal.dataset.mode;
    const tagId = modal.dataset.editingTagId;

    if (mode === 'delete') {
        deleteTag(tagId);
        closeTagModal();
        return;
    }

    const name = document.getElementById('tag-modal-name').value.trim();
    if (!name) return;

    const genre = getSelectedGenre();
    const color = getSelectedColor();

    let tags = JSON.parse(localStorage.getItem(window.storageKey('tags')) || '[]');

    if (mode === 'create') {
        const newTag = {
            id: 'tag_' + Date.now().toString(36),
            name: name,
            color: color,
            genre: genre
        };
        tags.push(newTag);
    } else if (mode === 'edit') {
        const idx = tags.findIndex(t => t.id === tagId);
        if (idx !== -1) {
            tags[idx].name = name;
            tags[idx].genre = genre;
            tags[idx].color = color;
        }
    }

    localStorage.setItem(window.storageKey('tags'), JSON.stringify(tags));
    loadTags();
    loadLibrary(currentActiveTagId);

    // ドロップダウン更新
    const dropdown = document.getElementById('tag-dropdown');
    if (dropdown && dropdown.style.display === 'block') {
        showTagDropdown(dropdown.dataset.currentNoteId, null, true);
    }

    closeTagModal();
}

function closeTagModal(e) {
    if (e && e.target !== e.currentTarget) return;
    document.getElementById('tag-modal').style.display = 'none';
    document.getElementById('tag-context-menu').style.display = 'none';
}

function initTagModalColors(selectedColor) {
    const container = document.getElementById('tag-modal-colors');
    container.innerHTML = '';
    const presets = ['#f38ba8','#fab387','#f9e2af','#a6e3a1','#89b4fa','#cba6f7','#94e2d5','#e5c890','#81c8be','#ef9f76','#585b70','#cdd6f4'];
    
    if (!selectedColor) selectedColor = presets[0];

    presets.forEach(color => {
        const btn = document.createElement('button');
        btn.className = 'color-dot-btn' + (color.toLowerCase() === selectedColor.toLowerCase() ? ' selected' : '');
        btn.style.backgroundColor = color;
        btn.onclick = () => selectTagModalColor(color);
        container.appendChild(btn);
    });
}

function selectTagModalColor(color) {
    document.querySelectorAll('#tag-modal-colors .color-dot-btn').forEach(btn => {
        const btnColor = rgbToHex(btn.style.backgroundColor);
        btn.classList.toggle('selected', btnColor.toLowerCase() === color.toLowerCase());
    });
}

function getSelectedGenre() {
    const activeBtn = document.querySelector('#tag-modal-genres .genre-btn.active');
    return activeBtn ? activeBtn.dataset.genre : 'その他';
}

function getSelectedColor() {
    const activeBtn = document.querySelector('#tag-modal-colors .color-dot-btn.selected');
    return activeBtn ? rgbToHex(activeBtn.style.backgroundColor) : '#f38ba8';
}

function rgbToHex(rgb) {
    if (rgb.startsWith('#')) return rgb;
    const parts = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (!parts) return rgb;
    let r = parseInt(parts[1]).toString(16).padStart(2, '0');
    let g = parseInt(parts[2]).toString(16).padStart(2, '0');
    let b = parseInt(parts[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
}

// イベントリスナー設定
document.addEventListener('DOMContentLoaded', () => {
    // ジャンルボタンクリック
    const genreContainer = document.getElementById('tag-modal-genres');
    if (genreContainer) {
        genreContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('genre-btn')) {
                document.querySelectorAll('#tag-modal-genres .genre-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
            }
        });
    }

    // コンテキストメニュー外クリックで閉じる
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('tag-context-menu');
        if (menu && menu.style.display === 'block' && !menu.contains(e.target)) {
            menu.style.display = 'none';
        }
    });
});

function deleteTag(tagId) {
    let tags = JSON.parse(localStorage.getItem(window.storageKey('tags')) || '[]');
    tags = tags.filter(t => t.id !== tagId);
    localStorage.setItem(window.storageKey('tags'), JSON.stringify(tags));

    let index = JSON.parse(localStorage.getItem(window.storageKey('index')) || '[]');
    index = index.map(note => {
        if (note.tags) {
            note.tags = note.tags.filter(t => t !== tagId);
        }
        return note;
    });
    localStorage.setItem(window.storageKey('index'), JSON.stringify(index));

    if (currentActiveTagId === tagId) currentActiveTagId = 'all';
    loadTags();
    loadLibrary(currentActiveTagId);
}

function showTagDropdown(noteId, anchorEl) {
    const dropdown = document.getElementById('tag-dropdown');
    const columnsEl = document.getElementById('tag-dropdown-columns');
    
    // 同じノートのドロップダウンが開いていれば閉じる
    if (dropdown.style.display === 'block' && dropdown.dataset.currentNoteId === noteId && anchorEl) {
        dropdown.style.display = 'none';
        return;
    }

    dropdown.dataset.currentNoteId = noteId;

    const index = JSON.parse(localStorage.getItem(window.storageKey('index')) || '[]');
    const note = index.find(n => n.id === noteId);
    const noteTags = note ? (note.tags || []) : [];
    const tags = JSON.parse(localStorage.getItem(window.storageKey('tags')) || '[]');

    // ジャンルの表示順を固定
    const genreOrder = ['科目', 'ステータス', 'その他'];
    const genres = {};
    genreOrder.forEach(g => genres[g] = []);

    tags.forEach(tag => {
        const g = tag.genre || 'その他';
        if (!genres[g]) genres[g] = [];
        genres[g].push(tag);
    });

    // カラム生成
    columnsEl.innerHTML = '';
    Object.entries(genres)
        .filter(([_, genreTags]) => genreTags.length > 0)
        .forEach(([genre, genreTags]) => {
            const col = document.createElement('div');
            col.className = 'tag-dropdown-column';
            col.innerHTML = `<div class="tag-dropdown-column-title">${genre}</div>`;
            
            genreTags.forEach(tag => {
                const isActive = noteTags.includes(tag.id);
                const btn = document.createElement('button');
                btn.className = 'tag-dropdown-item' + (isActive ? ' active' : '');
                btn.style.setProperty('--tag-color', tag.color);
                btn.innerHTML = `
                    <span class="tag-dot" style="background:${tag.color}"></span>
                    ${tag.name}
                    ${isActive ? '<span class="tag-check" style="margin-left:auto">✓</span>' : ''}
                `;
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleTagOnNote(noteId, tag.id);
                });
                col.appendChild(btn);
            });
            columnsEl.appendChild(col);
        });

    // 一旦visibility:hiddenで表示してサイズを取得してから位置を確定
    dropdown.style.visibility = 'hidden';
    dropdown.style.display = 'block';

    // 位置調整 (アンカーがある場合のみ)
    if (anchorEl) {
        const rect = anchorEl.getBoundingClientRect();
        const ddRect = dropdown.getBoundingClientRect();
        let top = rect.bottom + 4;
        let left = rect.left;
        
        // 画面外はみ出し防止
        if (top + ddRect.height > window.innerHeight) {
            top = rect.top - ddRect.height - 4;
        }
        if (left + ddRect.width > window.innerWidth) {
            left = window.innerWidth - ddRect.width - 8;
        }
        
        dropdown.style.top = `${top}px`;
        dropdown.style.left = `${left}px`;
    } else {
        // アンカーがない場合は直近の位置を維持するか、
        // あるいは中央などに表示する（ここでは位置を固定しない）
    }
    dropdown.style.visibility = 'visible';
}

function toggleTagOnNote(noteId, tagId) {
    const index = JSON.parse(localStorage.getItem(window.storageKey('index')) || '[]');
    const noteIdx = index.findIndex(n => n.id === noteId);
    if (noteIdx === -1) return;

    if (!index[noteIdx].tags) index[noteIdx].tags = [];
    
    const tagIdx = index[noteIdx].tags.indexOf(tagId);
    if (tagIdx === -1) {
        index[noteIdx].tags.push(tagId);
    } else {
        index[noteIdx].tags.splice(tagIdx, 1);
    }

    localStorage.setItem(window.storageKey('index'), JSON.stringify(index));
    
    // ドロップダウンをその場で更新（位置は維持）
    showTagDropdown(noteId, null);
    // カードのタグバッジだけ更新
    updateCardTags(noteId, index[noteIdx].tags);
}

function removeTagFromNote(noteId, tagId, e) {
    e.stopPropagation();
    const index = JSON.parse(localStorage.getItem(window.storageKey('index')) || '[]');
    const noteIdx = index.findIndex(n => n.id === noteId);
    if (noteIdx !== -1 && index[noteIdx].tags) {
        index[noteIdx].tags = index[noteIdx].tags.filter(t => t !== tagId);
        localStorage.setItem(window.storageKey('index'), JSON.stringify(index));
        
        // カードのタグバッジを更新
        updateCardTags(noteId, index[noteIdx].tags);
        // ドロップダウンが開いていれば更新
        const dropdown = document.getElementById('tag-dropdown');
        if (dropdown.style.display === 'block' && dropdown.dataset.currentNoteId === noteId) {
            showTagDropdown(noteId, null);
        }
    }
}

function updateCardTags(noteId, tagIds) {
    const tags = JSON.parse(localStorage.getItem(window.storageKey('tags')) || '[]');
    const card = document.querySelector(`.note-card[data-note-id="${noteId}"]`);
    if (!card) return;
    const tagsContainer = card.querySelector('.note-tags');
    if (!tagsContainer) return;

    // バッジだけ再生成（＋ボタンは残す）
    const addBtn = tagsContainer.querySelector('.tag-add-btn');
    tagsContainer.innerHTML = '';
    tagIds.forEach(tId => {
        const t = tags.find(tag => tag.id === tId);
        if (t) {
            const badge = document.createElement('span');
            badge.className = 'tag-badge';
            badge.style.background = t.color;
            badge.textContent = t.name;
            badge.onclick = (ev) => removeTagFromNote(noteId, t.id, ev);
            tagsContainer.appendChild(badge);
        }
    });
    if (addBtn) tagsContainer.appendChild(addBtn);
}

// ドロップダウンの外クリックで閉じる
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('tag-dropdown');
    if (dropdown.style.display === 'block' && !dropdown.contains(e.target) && !e.target.closest('.tag-add-btn')) {
        dropdown.style.display = 'none';
    }
});

window.onload = () => {
    initDefaultTags();
    loadTags();
    loadLibrary();
};

function syncFromFirebase() {
    const user = window.firebaseAuth.currentUser;
    if (!user) return;

    const dbRef = window.firebaseRef(window.firebaseDB);
    window.firebaseGet(window.firebaseChild(dbRef, `users/${user.uid}/notes`)).then(snapshot => {
        if (!snapshot.exists()) return;

        const firebaseNotes = snapshot.val();
        let localIndex = JSON.parse(localStorage.getItem(window.storageKey('index')) || '[]');
        if (!Array.isArray(localIndex)) localIndex = [];

        let changed = false;

        for (const id in firebaseNotes) {
            const fbNote = firebaseNotes[id];
            const localNoteStr = localStorage.getItem(`${window.storageKey('notes')}_${id}`);
            const localNote = localNoteStr ? JSON.parse(localNoteStr) : null;

            if (!localNote || fbNote.updatedAt > localNote.updatedAt) {
                localStorage.setItem(`${window.storageKey('notes')}_${id}`, JSON.stringify(fbNote.data));
                
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
            }
        }

        if (changed) {
            localStorage.setItem(storageKey('index'), JSON.stringify(localIndex));
            loadLibrary(currentActiveTagId);
        }
    }).catch(err => {
        console.error("Library Sync Error:", err);
    });
}
