/**
 * MathNote MVP - 統合アプリロジック (メインボード・疎結合版)
 */

class MathNote {
    constructor() {
        this.note = null; // 単一ノート
        this.history = []; this.redoStack = [];
        
        // メインキャンバス
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.view = { offsetX: 0, offsetY: 0, scale: 1.0, minScale: 0.1, maxScale: 10.0 };
        
        // モジュール連携用
        window.mathNoteApp = this;

        // 状態 & データ
        this.tool = 'pen';
        this.snapEnabled = false;
        this.line = {
            startCap: 'none',
            endCap: 'arrow-filled',
            snapAngle: true,
        };
        this.lineObjects = [];
        this.previewLine = null;
        this.lineStartPos = null;
        this.selectedLineHandle = null; // 'start' | 'end' | 'body'
        this.draggingLineId = null;
        this.dragLineStartSnapshot = null;
        this.pen = { color: '#2b2b2b', size: 3, style: 'solid' };
        this.shape = { type: 'rect', fillColor: '#ffffff', strokeColor: '#2b2b2b', lineWidth: 2, noFill: true };
        this.paths = []; this.textBlocks = []; this.graphObjects = []; this.shapeObjects = []; 
        
        // インタラクション状態
        this.isDrawing = false; this.currentPath = null;
        this.isPanning = false; this.lastMousePos = { x: 0, y: 0 };
        this.lastTapTime = 0; this.lastPinchDist = null; this.lastPinchCenter = null;
        this.draggingGraphId = null; this.resizingGraphId = null;
        this.draggingShapeId = null; this.resizingShapeId = null;
        this.dragOffset = { x: 0, y: 0 };
        this.previewShape = null; this.shapeStartPos = null;
        this.previewTextBox = null; this.textStartPos = null;
        this.editingTextId = null; this.pendingMathSize = null;
        this.previewTextBlockId = null; // ドラッグ中プレビュー用ID

        // Selection tool state
        this.selectedIds = []; // { type: 'shape'|'path'|'graph', id }
        this.isRubberBanding = false;
        this.rubberStart = { x: 0, y: 0 };
        this.rubberEnd = { x: 0, y: 0 };
        this.resizeStartPos = null;

        // Context UI state
        this.colorSwatchBounds = null;
        this.sizeSwatchBounds = null;
        this.isHoverDelete = false;

        this.pointerDownTime = 0;
        this._gridCache = null; // グリッド描画キャッシュ用
        this.noteId = null;
        this.noteName = "名称未設定";
        this.init();
    }

    init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());
        if (window.lucide) lucide.createIcons();
        this.loadNote();
        this.setupEventListeners();
        this.setupSubTooltip();
        this.setupStorageUI();
        this.setupAuth();
        this.updateUIModes();
        this._dirty = true;
        this._rafId = null;
        this._scheduleRender();
    }

    setupStorageUI() {
        console.log('setupStorageUI called');
        const display = document.getElementById('board-title-display');
        const input = document.getElementById('board-title-input');

        if (display && input) {
            display.onclick = () => {
                display.style.display = 'none';
                input.style.display = 'block';
                input.focus();
                input.select();
            };

            const finishEditing = () => {
                const newName = input.value.trim() || '名称未設定';
                this.renameNote(newName);
                display.innerText = newName;
                input.value = newName;
                input.style.display = 'none';
                display.style.display = 'block';
                this.saveCurrentNote();
            };

            input.onkeydown = (e) => {
                if (e.key === 'Enter') finishEditing();
                if (e.key === 'Escape') {
                    input.value = this.noteName;
                    input.style.display = 'none';
                    display.style.display = 'block';
                }
            };
            input.onblur = finishEditing;
        }

        const libraryBtn = document.getElementById('tool-library');
        if (libraryBtn) {
            libraryBtn.onclick = () => {
                console.log('Library button clicked');
                window.location.href = 'library.html';
            };
        } else {
            console.warn('Library button not found');
        }
    }

    // --- 座標変換ユーティリティ ---
    getPointerPos(e, canvas) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const pos = { x: clientX - rect.left, y: clientY - rect.top };
        return { x: (pos.x - this.view.offsetX) / this.view.scale, y: (pos.y - this.view.offsetY) / this.view.scale };
    }

    wToV(wx, wy) { return { x: wx * this.view.scale + this.view.offsetX, y: wy * this.view.scale + this.view.offsetY }; }

    // --- Firebase Auth & Sync ---
    setupAuth() {
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
                if (loginBtn) loginBtn.classList.add('hidden');
                if (userAvatar) {
                    userAvatar.classList.remove('hidden');
                    if (userIcon) userIcon.src = user.photoURL || '';
                    if (userName) userName.innerText = user.displayName || 'User';
                }
                this.syncFromFirebase();
            } else {
                if (loginBtn) loginBtn.classList.remove('hidden');
                if (userAvatar) userAvatar.classList.add('hidden');
            }
        });
    }

    loginWithGoogle() {
        const provider = new window.GoogleAuthProvider();
        window.signInWithPopup(window.firebaseAuth, provider).catch(err => console.error(err));
    }

    logoutFromGoogle() {
        window.signOut(window.firebaseAuth).catch(err => console.error(err));
    }

    syncToFirebase() {
        const user = window.firebaseAuth.currentUser;
        if (!user || !this.noteId) return;

        const localNoteStr = localStorage.getItem(`mathnote_note_${this.noteId}`);
        const localNote = localNoteStr ? JSON.parse(localNoteStr) : null;
        const indexStr = localStorage.getItem('mathnote_index') || '[]';
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
    }

    syncFromFirebase() {
        const user = window.firebaseAuth.currentUser;
        if (!user) return;

        const dbRef = window.firebaseRef(window.firebaseDB);
        window.firebaseGet(window.firebaseChild(dbRef, `users/${user.uid}/notes`)).then(snapshot => {
            if (!snapshot.exists()) return;

            const firebaseNotes = snapshot.val();
            let localIndex = JSON.parse(localStorage.getItem('mathnote_index') || '[]');
            if (!Array.isArray(localIndex)) localIndex = [];

            let changed = false;

            for (const id in firebaseNotes) {
                const fbNote = firebaseNotes[id];
                const localNoteStr = localStorage.getItem(`mathnote_note_${id}`);
                const localNote = localNoteStr ? JSON.parse(localNoteStr) : null;

                // マージロジック
                if (!localNote || fbNote.updatedAt > localNote.updatedAt) {
                    // Firebaseの方が新しい、またはローカルに存在しない
                    localStorage.setItem(`mathnote_note_${id}`, JSON.stringify(fbNote.data));
                    
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
                localStorage.setItem('mathnote_index', JSON.stringify(localIndex));
                // メインボードが今のノートならリロード
                if (this.noteId && firebaseNotes[this.noteId] && firebaseNotes[this.noteId].updatedAt > (this.updatedAt || 0)) {
                    this.loadNote();
                }
            }
        }).catch(err => {
            console.error("Sync Down Error:", err);
        });
    }

    resize() {
        const mc = document.getElementById('canvas-container').getBoundingClientRect();
        if (mc.width > 0) {
            this.canvas.width = mc.width;
            this.canvas.height = mc.height;
        }
        this._gridCache = null; // サイズ変更時はキャッシュをクリア
        this.draw();
    }

    _scheduleRender() {
        if (this._rafId) return;
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            if (this._dirty) {
                this._dirty = false;
                this._render();
            }
        });
    }

    _render() {
        const { ctx, canvas, view } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.drawInfiniteGrid(ctx, canvas, view);

        ctx.save();
        ctx.translate(view.offsetX, view.offsetY);
        ctx.scale(view.scale, view.scale);

        const vp = this.getViewportBounds();
        for (const p of this.paths) {
            if (this.isPathVisible(p, vp)) this.drawPath(ctx, p);
        }
        if (this.currentPath) this.drawPath(ctx, this.currentPath);
        for (const s of this.shapeObjects) {
            if (this.isRectVisible(s.x, s.y, s.width, s.height, vp)) this.drawShape(ctx, s);
        }
        if (this.previewShape) this.drawShape(ctx, this.previewShape);

        if (this.selectedIds.length > 0) {
            const bounds = this.getCombinedBounds(this.selectedIds);
            if (bounds) this.drawSelectionHandles(ctx, bounds);
        }

        for (const g of this.graphObjects) {
            if (this.isRectVisible(g.x, g.y, g.width, g.height, vp)) this.drawGraphObject(ctx, g);
        }

        for (const l of this.lineObjects) {
            if (this.isRectVisible(
                Math.min(l.x1, l.x2), Math.min(l.y1, l.y2),
                Math.abs(l.x2 - l.x1), Math.abs(l.y2 - l.y1), vp
            )) this.drawLineObject(ctx, l);
        }
        if (this.previewLine) this.drawLineObject(ctx, this.previewLine);

        if (this.tool === 'select' && this.selectedIds.some(i => i.type === 'line')) {
            for (const sel of this.selectedIds.filter(i => i.type === 'line')) {
                const l = this.lineObjects.find(obj => obj.id === sel.id);
                if (!l) continue;
                const hr = 6 / this.view.scale;
                [[l.x1, l.y1], [l.x2, l.y2]].forEach(([x, y]) => {
                    ctx.beginPath();
                    ctx.arc(x, y, hr, 0, Math.PI * 2);
                    ctx.fillStyle = '#ffffff';
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(99,102,241,0.9)';
                    ctx.lineWidth = 1.5 / this.view.scale;
                    ctx.stroke();
                });
            }
        }

        if (this.isRubberBanding) {
            ctx.strokeStyle = '#4A90E2';
            ctx.lineWidth = 1 / view.scale;
            ctx.setLineDash([4 / view.scale, 4 / view.scale]);
            ctx.fillStyle = 'rgba(74, 144, 226, 0.1)';
            const rx = Math.min(this.rubberStart.x, this.rubberEnd.x);
            const ry = Math.min(this.rubberStart.y, this.rubberEnd.y);
            const rw = Math.abs(this.rubberEnd.x - this.rubberStart.x);
            const rh = Math.abs(this.rubberEnd.y - this.rubberStart.y);
            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeRect(rx, ry, rw, rh);
            ctx.setLineDash([]);
        }

        ctx.restore();
        this.syncTextBlocks();
    }

    draw() {
        this._dirty = true;
        this._scheduleRender();
    }

    /**
     * メイン画面でのグラフオブジェクト描画 (プレビュー)
     */
    drawGraphObject(ctx, graph) {
        ctx.save(); ctx.translate(graph.x, graph.y);
        
        // 変更1: 背景と枠線を削除 (削除)
        // 変更2: X軸・Y軸を明確に表示
        const cx = graph.width / 2;
        const cy = graph.height / 2;

        // Y軸（上から下）
        ctx.beginPath();
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1.5 / this.view.scale;
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, graph.height);
        ctx.stroke();

        // X軸（左から右）
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(graph.width, cy);
        ctx.stroke();

        // 変更3: 軸に矢印をつける
        const headLen = 8 / this.view.scale;

        // X軸 +方向（右）の矢印
        const angleX = 0;
        ctx.beginPath();
        ctx.moveTo(graph.width, cy);
        ctx.lineTo(graph.width - headLen * Math.cos(-Math.PI / 6), cy - headLen * Math.sin(-Math.PI / 6));
        ctx.moveTo(graph.width, cy);
        ctx.lineTo(graph.width - headLen * Math.cos(Math.PI / 6), cy - headLen * Math.sin(Math.PI / 6));
        ctx.stroke();

        // Y軸 +方向（上）の矢印
        const yAngle = -Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(
            cx - headLen * Math.cos(yAngle - Math.PI / 6),
            0  - headLen * Math.sin(yAngle - Math.PI / 6)
        );
        ctx.moveTo(cx, 0);
        ctx.lineTo(
            cx - headLen * Math.cos(yAngle + Math.PI / 6),
            0  - headLen * Math.sin(yAngle + Math.PI / 6)
        );
        ctx.stroke();

        // 内部コンテンツ (論理座標系からの変換)
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, graph.width, graph.height); ctx.clip();
        
        ctx.translate(cx, cy); 
        // 1単位 = グラフ幅を20分割したもの
        const unitS = graph.width / 20;
        ctx.scale(unitS, -unitS); // y軸反転
        
        for (const stroke of graph.strokes || []) {
            if (stroke.points.length < 2) continue;
            ctx.beginPath();
            ctx.strokeStyle = stroke.color || '#2b2b2b';
            ctx.lineWidth = (stroke.width || 3) / unitS; // ピクセル太さを維持するため unitS で割る
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
            for (let i = 1; i < stroke.points.length; i++) {
                ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
            }
            ctx.stroke();
        }
        
        ctx.restore(); ctx.restore();
    }

    drawInfiniteGrid(ctx, canvas, view) {
        const gridSize = 50 * view.scale;
        if (gridSize < 6) return;

        const ox = view.offsetX % gridSize;
        const oy = view.offsetY % gridSize;

        // キャッシュヒット判定（倍率と画面サイズが同じなら使い回す）
        const cache = this._gridCache;
        if (cache && 
            cache.scale === view.scale && 
            cache.width === canvas.width && 
            cache.height === canvas.height) {
            // パン（移動）は drawImage のオフセット指定だけで完結するため非常に高速
            ctx.drawImage(cache.canvas, ox - gridSize, oy - gridSize);
            return;
        }

        // キャッシュ再生成（画面サイズ + 2グリッド分確保してパンに備える）
        const cacheW = canvas.width + gridSize * 2;
        const cacheH = canvas.height + gridSize * 2;
        const offscreen = (typeof OffscreenCanvas !== 'undefined')
            ? new OffscreenCanvas(cacheW, cacheH)
            : document.createElement('canvas');
        offscreen.width = cacheW;
        offscreen.height = cacheH;
        
        const octx = offscreen.getContext('2d');
        octx.beginPath();
        octx.strokeStyle = '#f0f0f0';
        octx.lineWidth = 1;
        
        // キャッシュ内では 0,0 基準でグリッドを描画
        for (let x = 0; x <= cacheW; x += gridSize) {
            octx.moveTo(Math.round(x), 0);
            octx.lineTo(Math.round(x), cacheH);
        }
        for (let y = 0; y <= cacheH; y += gridSize) {
            octx.moveTo(0, Math.round(y));
            octx.lineTo(cacheW, Math.round(y));
        }
        octx.stroke();

        this._gridCache = { 
            canvas: offscreen, 
            scale: view.scale, 
            width: canvas.width, 
            height: canvas.height 
        };
        ctx.drawImage(offscreen, ox - gridSize, oy - gridSize);
    }

    drawPath(ctx, path) {
        const pts = path.points;
        if (pts.length < 2) return;

        ctx.beginPath();
        ctx.strokeStyle = path.color;
        ctx.lineWidth = path.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // スタイル設定（破線・点線）
        if (path.style === 'dashed') ctx.setLineDash([12 / this.view.scale, 12 / this.view.scale]); 
        else if (path.style === 'dotted') ctx.setLineDash([2 / this.view.scale, 8 / this.view.scale]); 
        else ctx.setLineDash([]);

        ctx.moveTo(pts[0].x, pts[0].y);
        
        if (pts.length === 2) {
            ctx.lineTo(pts[1].x, pts[1].y);
        } else {
            // 三点以上ある場合は中点との間を二次ベジェ曲線でつなぐ（Smoothing）
            for (let i = 1; i < pts.length - 1; i++) {
                const mx = (pts[i].x + pts[i + 1].x) / 2;
                const my = (pts[i].y + pts[i + 1].y) / 2;
                // pts[i] を制御点、中点 mx, my を終点とする
                ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
            }
            // 最後の点へ直線でつなぐ
            ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        }
        
        ctx.stroke();
        ctx.setLineDash([]);
    }

    drawShape(ctx, shape) {
        ctx.beginPath();
        ctx.strokeStyle = shape.strokeColor;
        ctx.lineWidth = shape.lineWidth;
        if (!shape.noFill) {
            ctx.fillStyle = shape.fillColor;
        }

        if (shape.type === 'rect') {
            ctx.roundRect(shape.x, shape.y, shape.width, shape.height, 0);
        } else if (shape.type === 'circle') {
            const rx = shape.width / 2;
            const ry = shape.height / 2;
            ctx.ellipse(
                shape.x + rx, shape.y + ry,
                Math.abs(rx), Math.abs(ry),
                0, 0, Math.PI * 2
            );
        } else if (shape.type === 'triangle') {
            ctx.moveTo(shape.x + shape.width / 2, shape.y);
            ctx.lineTo(shape.x + shape.width, shape.y + shape.height);
            ctx.lineTo(shape.x, shape.y + shape.height);
            ctx.closePath();
        }

        if (!shape.noFill) ctx.fill();
        ctx.stroke();
    }

    // --- Selection tool helpers ---
    getHandles(shape) {
        const { x, y, width: w, height: h } = shape;
        return [
            { id: 'nw', x, y },
            { id: 'n',  x: x + w/2, y },
            { id: 'ne', x: x + w,   y },
            { id: 'e',  x: x + w,   y: y + h/2 },
            { id: 'se', x: x + w,   y: y + h },
            { id: 's',  x: x + w/2, y: y + h },
            { id: 'sw', x,          y: y + h },
            { id: 'w',  x,          y: y + h/2 },
        ];
    }

    getHandleAt(rect, pos) {
        const handles = this.getHandles(rect);
        const hitSize = 10 / this.view.scale;
        return handles.find(h => Math.abs(pos.x - h.x) < hitSize && Math.abs(pos.y - h.y) < hitSize) || null;
    }

    hitTestPath(path, pos, scale) {
        const threshold = 8 / scale;
        for (let i = 0; i < path.points.length - 1; i++) {
            const d = this.distToSegment(pos, path.points[i], path.points[i+1]);
            if (d < threshold) return true;
        }
        return false;
    }

    getPathBounds(path) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of path.points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    getCombinedBounds(selectedItems) {
        if (selectedItems.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        for (const item of selectedItems) {
            let bounds = null;
            if (item.type === 'shape') {
                const s = this.shapeObjects.find(obj => obj.id === item.id);
                if (s) bounds = { x: s.x, y: s.y, width: s.width, height: s.height };
            } else if (item.type === 'path') {
                const p = this.paths[item.id];
                if (p) bounds = this.getPathBounds(p);
            } else if (item.type === 'graph') {
                const g = this.graphObjects.find(obj => obj.id === item.id);
                if (g) bounds = { x: g.x, y: g.y, width: g.width, height: g.height };
            } else if (item.type === 'line') {
                const l = this.lineObjects.find(obj => obj.id === item.id);
                if (l) bounds = {
                    x: Math.min(l.x1, l.x2), y: Math.min(l.y1, l.y2),
                    width: Math.abs(l.x2 - l.x1), height: Math.abs(l.y2 - l.y1)
                };
            } else if (item.type === 'text') {
                const b = this.textBlocks.find(obj => obj.id === item.id);
                if (b) bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
            }
            
            
            if (bounds) {
                minX = Math.min(minX, bounds.x);
                minY = Math.min(minY, bounds.y);
                maxX = Math.max(maxX, bounds.x + bounds.width);
                maxY = Math.max(maxY, bounds.y + bounds.height);
            }
        }
        
        if (minX === Infinity) return null;
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    rectsOverlap(a, b) {
        return !(a.x + a.width < b.x || b.x + b.width < a.x ||
                 a.y + a.height < b.y || b.y + b.height < a.y);
    }

    getObjectsInRect(rect) {
        const selected = [];
        // 図形
        for (const shape of this.shapeObjects) {
            if (this.rectsOverlap(rect, { x: shape.x, y: shape.y, width: shape.width, height: shape.height })) {
                selected.push({ type: 'shape', id: shape.id });
            }
        }
        // ストローク
        for (let i = 0; i < this.paths.length; i++) {
            const inRect = this.paths[i].points.some(p =>
                p.x >= rect.x && p.x <= rect.x + rect.width &&
                p.y >= rect.y && p.y <= rect.y + rect.height
            );
            if (inRect) selected.push({ type: 'path', id: i });
        }
        // グラフ
        for (const graph of this.graphObjects) {
            if (this.rectsOverlap(rect, { x: graph.x, y: graph.y, width: graph.width, height: graph.height })) {
                selected.push({ type: 'graph', id: graph.id });
            }
        }
        // 直線
        for (const line of this.lineObjects) {
            const minX = Math.min(line.x1, line.x2), minY = Math.min(line.y1, line.y2);
            const maxX = Math.max(line.x1, line.x2), maxY = Math.max(line.y1, line.y2);
            if (this.rectsOverlap(rect, { x: minX, y: minY, width: maxX - minX, height: maxY - minY })) {
                selected.push({ type: 'line', id: line.id });
            }
        }
        // テキスト
        for (const b of this.textBlocks) {
            const el = document.getElementById(`block-${b.id}`);
            const w = b.width || (el ? el.offsetWidth : 200);
            const h = b.height || (el ? el.offsetHeight : 80);
            if (this.rectsOverlap(rect, { x: b.x, y: b.y, width: w, height: h })) {
                selected.push({ type: 'text', id: b.id });
            }
        }
        return selected;
    }

    drawSelectionHandles(ctx, bounds) {
        const view = this.view;
        const s = 1 / view.scale;

        // 1. 選択枠のスタイル (シンプルな実線)
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.7)';
        ctx.lineWidth = s;
        ctx.setLineDash([]);
        ctx.strokeRect(
            bounds.x - 2 * s,
            bounds.y - 2 * s,
            bounds.width + 4 * s,
            bounds.height + 4 * s
        );

        // 2. ハンドルのスタイル (小さい白い丸)
        this.getHandles(bounds).forEach(h => {
            ctx.beginPath();
            ctx.arc(h.x, h.y, 4 * s, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
            ctx.lineWidth = 1.5 * s;
            ctx.stroke();
        });

        // 3. 削除ボタン (左下の外側)
        const btnSize = 30 * s;
        const btnR    = 4 * s;
        const gx = bounds.x - 2 * s;
        const gy = bounds.y + bounds.height + 2 * s;

        ctx.save();

        // 背景: 角丸四角 (#fa2f2f / ホバー時は少し暗く)
        ctx.beginPath();
        ctx.roundRect(gx - btnSize / 2, gy, btnSize, btnSize, btnR);
        ctx.fillStyle = this.isHoverDelete ? '#d42020' : '#fa2f2f';
        ctx.fill();

        // ゴミ箱アイコン (白・中央揃え)
        const cx  = gx;
        const cy  = gy + btnSize / 2;
        const sz  = btnSize * 0.28;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 1.5 * s;
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';

        // フタ
        ctx.beginPath();
        ctx.moveTo(cx - sz,        cy - sz * 0.35);
        ctx.lineTo(cx + sz,        cy - sz * 0.35);
        ctx.stroke();

        // 取っ手
        ctx.beginPath();
        ctx.moveTo(cx - sz * 0.3,  cy - sz * 0.35);
        ctx.lineTo(cx - sz * 0.3,  cy - sz * 0.85);
        ctx.lineTo(cx + sz * 0.3,  cy - sz * 0.85);
        ctx.lineTo(cx + sz * 0.3,  cy - sz * 0.35);
        ctx.stroke();

        // 本体
        ctx.beginPath();
        ctx.roundRect(cx - sz * 0.75, cy - sz * 0.15, sz * 1.5, sz * 1.3, 1 * s);
        ctx.stroke();

        // 縦線2本
        [-sz * 0.3, sz * 0.3].forEach(offset => {
            ctx.beginPath();
            ctx.moveTo(cx + offset, cy + sz * 0.1);
            ctx.lineTo(cx + offset, cy + sz * 0.8);
            ctx.stroke();
        });

        ctx.restore();

        this.deleteIconBounds = { x: gx, y: gy + btnSize / 2, r: btnSize / 2 };

        // 4. 形状編集ツールバー (上部中央・コンパクト)
        const onlyShapes = this.selectedIds.length > 0 && this.selectedIds.every(sel => sel.type === 'shape');
        if (onlyShapes) {
            const tbH = 24 * s;
            const tbPad = 6 * s;
            const swR = 7 * s;
            const swGap = 18 * s;
            const colorCount = 6;
            const tbW = colorCount * swGap + tbPad * 2;
            const tbX = bounds.x + bounds.width / 2 - tbW / 2;
            const tbY = bounds.y - tbH - 10 * s;

            ctx.beginPath();
            ctx.roundRect(tbX, tbY, tbW, tbH, 6 * s);
            ctx.fillStyle = 'rgba(20, 20, 30, 0.85)';
            ctx.fill();

            const colors = ['#2b2b2b', '#f38ba8', '#a6e3a1', '#89b4fa', '#f9e2af', '#cdd6f4'];
            this.colorSwatchBounds = [];
            colors.forEach((c, i) => {
                const sx = tbX + tbPad + i * swGap + swR;
                const sy = tbY + tbH / 2;
                ctx.beginPath();
                ctx.arc(sx, sy, swR, 0, Math.PI * 2);
                ctx.fillStyle = c;
                ctx.fill();

                const firstItem = this.selectedIds[0];
                const shape = this.shapeObjects.find(sObj => sObj.id === firstItem.id);
                if (shape && shape.strokeColor === c) {
                    ctx.beginPath();
                    ctx.arc(sx, sy, swR + 2 * s, 0, Math.PI * 2);
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1.5 * s;
                    ctx.stroke();
                }
                this.colorSwatchBounds.push({ x: sx, y: sy, r: swR + 3 * s, color: c });
            });
            this.sizeSwatchBounds = null; // サイズ変更は一旦簡易化のため非表示、または要望に応じて追加
        } else {
            this.colorSwatchBounds = null;
            this.sizeSwatchBounds = null;
        }
    }

    getCursorForPos(pos) {
        if (this.selectedIds.length === 1) {
            const item = this.selectedIds[0];
            let bounds = null;
            if (item.type === 'shape') {
                const s = this.shapeObjects.find(obj => obj.id === item.id);
                if (s) bounds = { x: s.x, y: s.y, width: s.width, height: s.height };
            } else if (item.type === 'path') {
                const p = this.paths[item.id];
                if (p) bounds = this.getPathBounds(p);
            } else if (item.type === 'graph') {
                const g = this.graphObjects.find(obj => obj.id === item.id);
                if (g) bounds = { x: g.x, y: g.y, width: g.width, height: g.height };
            }

            if (bounds) {
                const handle = this.getHandleAt(bounds, pos);
                if (handle) {
                    const map = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
                    return map[handle.id];
                }
            }
        }
        
        // 移動カーソル判定
        const bounds = this.getCombinedBounds(this.selectedIds);
        if (bounds && pos.x >= bounds.x && pos.x <= bounds.x + bounds.width && pos.y >= bounds.y && pos.y <= bounds.y + bounds.height) {
            return 'move';
        }

        // 要素ホバー判定
        for (let i = this.shapeObjects.length - 1; i >= 0; i--) {
            const s = this.shapeObjects[i];
            if (pos.x >= s.x && pos.x <= s.x + s.width && pos.y >= s.y && pos.y <= s.y + s.height) return 'move';
        }
        for (let i = this.paths.length - 1; i >= 0; i--) {
            if (this.hitTestPath(this.paths[i], pos, this.view.scale)) return 'move';
        }
        // テキストブロックホバー判定
        for (let i = this.textBlocks.length - 1; i >= 0; i--) {
            const b = this.textBlocks[i];
            const el = document.getElementById(`block-${b.id}`);
            const w = b.width || (el ? el.offsetWidth : 200);
            const h = b.height || (el ? el.offsetHeight : 80);
            if (pos.x >= b.x && pos.x <= b.x + w && pos.y >= b.y && pos.y <= b.y + h) {
                return 'move';
            }
        }

        return 'default';
    }

    applyResize(handle, startShape, startPos, currentPos) {
        const dx = currentPos.x - startPos.x;
        const dy = currentPos.y - startPos.y;
        let { x, y, width, height } = startShape;
        if (handle.id.includes('e')) width  = Math.max(20, startShape.width  + dx);
        if (handle.id.includes('s')) height = Math.max(20, startShape.height + dy);
        if (handle.id.includes('w')) { x = startShape.x + dx; width  = Math.max(20, startShape.width  - dx); }
        if (handle.id.includes('n')) { y = startShape.y + dy; height = Math.max(20, startShape.height - dy); }
        return { x, y, width, height };
    }

    updatePropertiesPanel() {
        const panel = document.getElementById('select-properties');
        if (this.selectedIds.length === 0) {
            panel.classList.add('hidden');
            return;
        }

        panel.classList.remove('hidden');
        const label = panel.querySelector('.sub-label');
        
        if (this.selectedIds.length > 1) {
            label.textContent = `${this.selectedIds.length}個の要素を選択中`;
            // 複数選択時は座標などの詳細編集を非表示に（または無効に）
            document.querySelectorAll('.props-xy, .props-wh, .select-fill-group, .select-stroke-group, .select-line-group').forEach(el => el.classList.add('hidden'));
            return;
        }

        // 単一選択時
        document.querySelectorAll('.props-xy, .props-wh, .select-fill-group, .select-stroke-group, .select-line-group').forEach(el => el.classList.remove('hidden'));
        const item = this.selectedIds[0];
        
        if (item.type === 'shape') {
            label.textContent = '図形を選択中';
            const shape = this.shapeObjects.find(s => s.id === item.id);
            if (shape) {
                document.getElementById('prop-x').value = Math.round(shape.x);
                document.getElementById('prop-y').value = Math.round(shape.y);
                document.getElementById('prop-w').value = Math.round(shape.width);
                document.getElementById('prop-h').value = Math.round(shape.height);
                document.getElementById('prop-line-width').value = shape.lineWidth || 2;
                document.querySelectorAll('.select-stroke-group, .select-line-group').forEach(el => el.classList.remove('hidden'));
                document.querySelectorAll('.select-fill-group').forEach(el => el.classList.add('hidden'));
            }
        } else if (item.type === 'path') {
            label.textContent = 'ストロークを選択中';
            const bounds = this.getPathBounds(this.paths[item.id]);
            document.getElementById('prop-x').value = Math.round(bounds.x);
            document.getElementById('prop-y').value = Math.round(bounds.y);
            document.getElementById('prop-w').value = Math.round(bounds.width);
            document.getElementById('prop-h').value = Math.round(bounds.height);
            // パスには塗りつぶし設定などがないため隠す
            document.querySelectorAll('.select-fill-group, .select-stroke-group, .select-line-group').forEach(el => el.classList.add('hidden'));
        } else if (item.type === 'graph') {
            label.textContent = 'グラフを選択中';
            const graph = this.graphObjects.find(g => g.id === item.id);
            if (graph) {
                document.getElementById('prop-x').value = Math.round(graph.x);
                document.getElementById('prop-y').value = Math.round(graph.y);
                document.getElementById('prop-w').value = Math.round(graph.width);
                document.getElementById('prop-h').value = Math.round(graph.height);
                document.querySelectorAll('.select-fill-group, .select-stroke-group, .select-line-group').forEach(el => el.classList.add('hidden'));
            }
        } else if (item.type === 'text') {
            label.textContent = 'テキストを選択中';
            const b = this.textBlocks.find(obj => obj.id === item.id);
            if (b) {
                document.getElementById('prop-x').value = Math.round(b.x);
                document.getElementById('prop-y').value = Math.round(b.y);
                document.getElementById('prop-w').value = Math.round(b.width || 200);
                document.getElementById('prop-h').value = Math.round(b.height || 80);
                document.querySelectorAll('.select-fill-group, .select-stroke-group, .select-line-group').forEach(el => el.classList.add('hidden'));
            }
        }
    }

    deleteSelected() {
        if (this.selectedIds.length === 0) return;
        this.saveHistory();

        const shapeIdsToDelete = this.selectedIds.filter(i => i.type === 'shape').map(i => i.id);
        const pathIndicesToDelete = this.selectedIds.filter(i => i.type === 'path').map(i => i.id).sort((a, b) => b - a);
        const graphIdsToDelete = this.selectedIds.filter(i => i.type === 'graph').map(i => i.id);
        const lineIdsToDelete = this.selectedIds.filter(i => i.type === 'line').map(i => i.id);
        const textIdsToDelete = this.selectedIds.filter(i => i.type === 'text').map(i => i.id);

        this.shapeObjects = this.shapeObjects.filter(s => !shapeIdsToDelete.includes(s.id));
        this.graphObjects = this.graphObjects.filter(g => !graphIdsToDelete.includes(g.id));
        this.lineObjects = this.lineObjects.filter(l => !lineIdsToDelete.includes(l.id));
        
        for (const id of textIdsToDelete) {
            const el = document.getElementById(`block-${id}`);
            if (el) el.remove();
            this.textBlocks = this.textBlocks.filter(b => b.id !== id);
        }

        for (const idx of pathIndicesToDelete) {
            this.paths.splice(idx, 1);
        }

        this.selectedIds = [];
        this.deleteIconBounds = null;
        this.colorSwatchBounds = null;
        this.sizeSwatchBounds = null;
        this.saveCurrentNote();
        this.draw();
    }

    applyColorToSelected(color) {
        this.selectedIds.forEach(sel => {
            if (sel.type === 'shape') {
                const s = this.shapeObjects.find(obj => obj.id === sel.id);
                if (s) s.strokeColor = color;
            }
        });
        this.saveCurrentNote();
        this.draw();
    }

    applySizeToSelected(size) {
        this.selectedIds.forEach(sel => {
            if (sel.type === 'shape') {
                const s = this.shapeObjects.find(obj => obj.id === sel.id);
                if (s) s.lineWidth = size;
            }
        });
        this.saveCurrentNote();
        this.draw();
    }

    updatePropertiesPanel() {
        // 全面的に廃止（Canvas上のContext UIへ移行）
        const panel = document.getElementById('select-properties');
        if (panel) panel.classList.add('hidden');
    }

    deleteSelectedObjects() {
        this.deleteSelected();
    }

    // --- インタラクション ---
    handlePointerDown(pos, e) {
        const isTouch = e.touches !== undefined;
        if (!isTouch && (e.button === 1 || (e.button === 0 && e.altKey))) { this.isPanning = true; this.lastMousePos = { x: e.clientX, y: e.clientY }; return; }

        // Select tool logic
        if (this.tool === 'select') {
            // 1. Context UI Hit Testing
            if (this.deleteIconBounds) {
                const b = this.deleteIconBounds;
                if (Math.hypot(pos.x - b.x, pos.y - b.y) < b.r) {
                    this.deleteSelected(); return;
                }
            }
            if (this.colorSwatchBounds) {
                for (const sw of this.colorSwatchBounds) {
                    if (Math.hypot(pos.x - sw.x, pos.y - sw.y) < sw.r + 4/this.view.scale) {
                        this.applyColorToSelected(sw.color); return;
                    }
                }
            }
            if (this.sizeSwatchBounds) {
                for (const sw of this.sizeSwatchBounds) {
                    if (Math.hypot(pos.x - sw.x, pos.y - sw.y) < sw.r) {
                        this.applySizeToSelected(sw.size); return;
                    }
                }
            }

            // 2. リサイズハンドルのヒットテスト
            if (this.selectedIds.length > 0) {
                const combinedRect = this.getCombinedBounds(this.selectedIds);
                if (combinedRect) {
                    const h = this.getHandleAt(combinedRect, pos);
                    if (h) {
                        this.resizingHandle = h;
                        this.resizeStartShape = { ...combinedRect };
                        this.resizeStartPos = { ...pos };
                        this.resizeStartObjects = this.selectedIds.map(item => {
                            if (item.type === 'shape') {
                                const s = this.shapeObjects.find(obj => obj.id === item.id);
                                return s ? { ...item, snapshot: { x: s.x, y: s.y, width: s.width, height: s.height } } : item;
                            } else if (item.type === 'path') {
                                const p = this.paths[item.id];
                                return p ? { ...item, snapshot: { points: p.points.map(pt => ({ ...pt })) } } : item;
                            } else if (item.type === 'graph') {
                                const g = this.graphObjects.find(obj => obj.id === item.id);
                                return g ? { ...item, snapshot: { x: g.x, y: g.y, width: g.width, height: g.height } } : item;
                            }
                            return item;
                        });
                        return;
                    }
                }
            }

            // 直線の端点ハンドルのヒットテスト（combinedBounds判定より先に行う）
            const lineHr = 10 / this.view.scale;
            for (let i = this.lineObjects.length - 1; i >= 0; i--) {
                const l = this.lineObjects[i];
                if (Math.hypot(pos.x - l.x1, pos.y - l.y1) < lineHr) {
                    this.selectedLineHandle = { id: l.id, point: 'start' };
                    this.selectedIds = [{ type: 'line', id: l.id }];
                    this.draw();
                    return;
                }
                if (Math.hypot(pos.x - l.x2, pos.y - l.y2) < lineHr) {
                    this.selectedLineHandle = { id: l.id, point: 'end' };
                    this.selectedIds = [{ type: 'line', id: l.id }];
                    this.draw();
                    return;
                }
            }

            // 3. オブジェクトのヒットテスト → 選択＋即ドラッグ準備
            const startDrag = (newSelectedIds, snapshotFn) => {
                this.selectedIds = newSelectedIds;
                this.isDraggingSelection = true;
                this.dragStartPos = { x: pos.x, y: pos.y };
                this.dragStartBounds = this.getCombinedBounds(this.selectedIds);
                this.dragStartObjects = snapshotFn();
                this.updatePropertiesPanel();
                this.draw();
            };

            // 既存選択範囲内をタップ → そのままドラッグ
            const combinedBounds = this.getCombinedBounds(this.selectedIds);
            if (combinedBounds &&
                pos.x >= combinedBounds.x && pos.x <= combinedBounds.x + combinedBounds.width &&
                pos.y >= combinedBounds.y && pos.y <= combinedBounds.y + combinedBounds.height) {
                this.isDraggingSelection = true;
                this.dragStartPos = { x: pos.x, y: pos.y };
                this.dragStartBounds = combinedBounds;
                this.dragStartObjects = this.selectedIds.map(item => {
                    if (item.type === 'shape') {
                        const s = this.shapeObjects.find(obj => obj.id === item.id);
                        return s ? { ...item, snapshot: { x: s.x, y: s.y } } : item;
                    } else if (item.type === 'path') {
                        const p = this.paths[item.id];
                        return p ? { ...item, snapshot: { points: p.points.map(pt => ({ ...pt })) } } : item;
                    } else if (item.type === 'graph') {
                        const g = this.graphObjects.find(obj => obj.id === item.id);
                        return g ? { ...item, snapshot: { x: g.x, y: g.y } } : item;
                    } else if (item.type === 'line') {
                        const l = this.lineObjects.find(obj => obj.id === item.id);
                        return l ? { ...item, snapshot: { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 } } : item;
                    } else if (item.type === 'text') {
                        const b = this.textBlocks.find(obj => obj.id === item.id);
                        return b ? { ...item, snapshot: { x: b.x, y: b.y } } : item;
                    }
                    return item;
                });
                return;
            }

            // 図形
            for (let i = this.shapeObjects.length - 1; i >= 0; i--) {
                const s = this.shapeObjects[i];
                if (pos.x >= s.x && pos.x <= s.x + s.width && pos.y >= s.y && pos.y <= s.y + s.height) {
                    startDrag(
                        [{ type: 'shape', id: s.id }],
                        () => [{ type: 'shape', id: s.id, snapshot: { x: s.x, y: s.y } }]
                    );
                    return;
                }
            }
            // ストローク
            for (let i = this.paths.length - 1; i >= 0; i--) {
                if (this.hitTestPath(this.paths[i], pos, this.view.scale)) {
                    const p = this.paths[i];
                    startDrag(
                        [{ type: 'path', id: i }],
                        () => [{ type: 'path', id: i, snapshot: { points: p.points.map(pt => ({ ...pt })) } }]
                    );
                    return;
                }
            }
                // グラフ
                for (let i = this.graphObjects.length - 1; i >= 0; i--) {
                    const g = this.graphObjects[i];
                    if (pos.x >= g.x && pos.x <= g.x + g.width && pos.y >= g.y && pos.y <= g.y + g.height) {
                        startDrag(
                            [{ type: 'graph', id: g.id }],
                            () => [{ type: 'graph', id: g.id, snapshot: { x: g.x, y: g.y } }]
                        );
                        return;
                    }
                }
                // 直線（線全体のドラッグ）
                for (let i = this.lineObjects.length - 1; i >= 0; i--) {
                    const l = this.lineObjects[i];
                    const d = this.distToSegment(pos, { x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 });
                    if (d < 8 / this.view.scale) {
                        startDrag(
                            [{ type: 'line', id: l.id }],
                            () => [{ type: 'line', id: l.id, snapshot: { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 } }]
                        );
                        return;
                    }
                }

                // テキスト
                for (let i = this.textBlocks.length - 1; i >= 0; i--) {
                    const b = this.textBlocks[i];
                    const el = document.getElementById(`block-${b.id}`);
                    const w = b.width || (el ? el.offsetWidth : 200);
                    const h = b.height || (el ? el.offsetHeight : 80);
                    if (pos.x >= b.x && pos.x <= b.x + w && pos.y >= b.y && pos.y <= b.y + h) {
                        const alreadySelected = this.selectedIds.some(item => item.type === 'text' && item.id === b.id);
                        if (alreadySelected) {
                            // 選択中に再度クリックされた場合は編集モードへ
                            if (el) el.style.pointerEvents = 'auto';
                            this.enterEditMode(b.id);
                            return;
                        }

                        startDrag(
                            [{ type: 'text', id: b.id }],
                            () => [{ type: 'text', id: b.id, snapshot: { x: b.x, y: b.y } }]
                        );
                        return;
                    }
                }

                // 4. オブジェクトなし → 即ラバーバンド開始
                this.selectedIds = [];
                this.isRubberBanding = true;
                this.rubberStart = { ...pos };
                this.rubberEnd = { ...pos };
                this.updatePropertiesPanel();
                this.draw();
                return;
            }

        // シェイプオブジェクト の判定 (ペンツール・消しゴム以外)
        if (this.tool !== 'pen' && this.tool !== 'eraser' && this.tool !== 'line') {
            for (let i = this.shapeObjects.length-1; i >= 0; i--) {
                const s = this.shapeObjects[i];
                if (pos.x >= s.x && pos.x <= s.x + s.width && pos.y >= s.y && pos.y <= s.y + s.height) {
                    if (pos.x > s.x + s.width - 15 && pos.y > s.y + s.height - 15) this.resizingShapeId = s.id;
                    else { this.draggingShapeId = s.id; this.dragOffset = { x: pos.x - s.x, y: pos.y - s.y }; }
                    this.draw();
                    return;
                }
            }

            // グラフオブジェクト の判定
            for (let i = this.graphObjects.length-1; i >= 0; i--) {
                const g = this.graphObjects[i];
                if (pos.x >= g.x && pos.x <= g.x + g.width && pos.y >= g.y && pos.y <= g.y + g.height) {
                    if (pos.x > g.x + g.width - 15 && pos.y > g.y + g.height - 15) this.resizingGraphId = g.id;
                    else { this.draggingGraphId = g.id; this.dragOffset = { x: pos.x - g.x, y: pos.y - g.y }; }
                    this.draw();
                    return;
                }
            }
        }

        if (this.tool === 'graph') this.addGraph(pos);
        else if (this.tool === 'shape') { this.saveHistory(); this.shapeStartPos = pos; this.previewShape = null; this.isDrawing = true; }
        else if (this.tool === 'pen') { this.saveHistory(); this.isDrawing = true; this.currentPath = { color: this.pen.color, size: this.pen.size, style: this.pen.style, points: [pos] }; this.draw(); }
        else if (this.tool === 'eraser') { this.saveHistory(); this.eraseAt(pos); this.isDrawing = true; this.draw(); }
        else if (this.tool === 'line') {
            const hr = 10 / this.view.scale;
            // 全lineObjectsに対してヒットテスト（selectedIds不問）
            for (let i = this.lineObjects.length - 1; i >= 0; i--) {
                const l = this.lineObjects[i];
                if (Math.hypot(pos.x - l.x1, pos.y - l.y1) < hr) {
                    this.selectedLineHandle = { id: l.id, point: 'start' };
                    this.selectedIds = [{ type: 'line', id: l.id }];
                    this.draw();
                    return;
                }
                if (Math.hypot(pos.x - l.x2, pos.y - l.y2) < hr) {
                    this.selectedLineHandle = { id: l.id, point: 'end' };
                    this.selectedIds = [{ type: 'line', id: l.id }];
                    this.draw();
                    return;
                }
                // 線全体のドラッグ
                const d = this.distToSegment(pos, { x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 });
                if (d < 8 / this.view.scale) {
                    this.selectedLineHandle = { id: l.id, point: 'body' };
                    this.dragOffset = { x: pos.x, y: pos.y };
                    this.dragLineStartSnapshot = { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 };
                    this.selectedIds = [{ type: 'line', id: l.id }];
                    this.draw();
                    return;
                }
            }
            // 新規直線の描画開始
            this.saveHistory();
            this.isDrawing = true;
            this.lineStartPos = pos;
            this.previewLine = null;
            this.selectedIds = [];
        }
        else if (this.tool === 'text') {
            this.pointerDownTime = Date.now();
            // 既存テキストブロックのヒットテスト
            for (let i = this.textBlocks.length - 1; i >= 0; i--) {
                const b = this.textBlocks[i];
                const el = document.getElementById(`block-${b.id}`);
                if (!el) continue;
                const w = el.offsetWidth;
                const h = el.offsetHeight;
                if (pos.x >= b.x && pos.x <= b.x + w && pos.y >= b.y && pos.y <= b.y + h) {
                    this.enterEditMode(b.id);
                    return;
                }
            }
            // ドラッグ開始フラグを立てる
            this.isDrawing = true;
            this.textStartPos = pos;
            this.previewTextBox = null;
            this.previewTextBlockId = null;
        }
    }

    handlePointerMove(pos, e) {
        if (this.isPanning) { this.view.offsetX += (e.clientX - this.lastMousePos.x); this.view.offsetY += (e.clientY - this.lastMousePos.y); this.lastMousePos = { x: e.clientX, y: e.clientY }; this.draw(); return; }

        // 端点ドラッグ中は他の処理をスキップ
        if (this.tool === 'select' && this.selectedLineHandle) {
            const l = this.lineObjects.find(obj => obj.id === this.selectedLineHandle.id);
            if (l) {
                if (this.selectedLineHandle.point === 'start') { l.x1 = pos.x; l.y1 = pos.y; }
                else if (this.selectedLineHandle.point === 'end') { l.x2 = pos.x; l.y2 = pos.y; }
                this.draw();
            }
            return;
        }

        if (this.tool === 'line') {
            // ハンドルドラッグ
            if (this.selectedLineHandle) {
                const l = this.lineObjects.find(obj => obj.id === this.selectedLineHandle.id);
                if (l) {
                    if (this.selectedLineHandle.point === 'start') {
                        const snapped = this.line.snapAngle ? this.snapAngle45({ x: l.x2, y: l.y2 }, pos) : pos;
                        l.x1 = snapped.x; l.y1 = snapped.y;
                    } else if (this.selectedLineHandle.point === 'end') {
                        const snapped = this.line.snapAngle ? this.snapAngle45({ x: l.x1, y: l.y1 }, pos) : pos;
                        l.x2 = snapped.x; l.y2 = snapped.y;
                    } else if (this.selectedLineHandle.point === 'body') {
                        const dx = pos.x - this.dragOffset.x;
                        const dy = pos.y - this.dragOffset.y;
                        this.dragOffset = { x: pos.x, y: pos.y };
                        l.x1 += dx; l.y1 += dy; l.x2 += dx; l.y2 += dy;
                    }
                    this.draw();
                }
                return;
            }
            // プレビュー描画
            if (this.isDrawing && this.lineStartPos) {
                let endPos = pos;
                if (this.line.snapAngle) endPos = this.snapAngle45(this.lineStartPos, pos);
                this.previewLine = {
                    id: -1,
                    x1: this.lineStartPos.x, y1: this.lineStartPos.y,
                    x2: endPos.x, y2: endPos.y,
                    color: this.pen.color,
                    size: this.pen.size,
                    style: this.pen.style,
                    startCap: this.line.startCap,
                    endCap: this.line.endCap,
                };
                this.draw();
                return;
            }
        }

        if (this.tool === 'text' && this.isDrawing && this.textStartPos) {
            const dist = Math.hypot(pos.x - this.textStartPos.x, pos.y - this.textStartPos.y) * this.view.scale;
            if (dist > 8) {
                const w = Math.abs(pos.x - this.textStartPos.x);
                const h = Math.max(40, Math.abs(pos.y - this.textStartPos.y));
                
                if (!this.previewTextBlockId) {
                    this.previewTextBlockId = this.createInlineTextBlock({
                        x: this.textStartPos.x,
                        y: this.textStartPos.y,
                        width: w,
                        height: h
                    }, false); // 最初はフォーカスしない
                } else {
                    const b = this.textBlocks.find(block => block.id === this.previewTextBlockId);
                    if (b) {
                        b.width = w;
                        b.height = h;
                        const el = document.getElementById(`block-${b.id}`);
                        if (el) {
                            el.style.width = b.width + 'px';
                            const ta = el.querySelector('.text-inline-editor');
                            if (ta) ta.style.minHeight = b.height + 'px';
                        }
                    }
                }
                this.syncTextBlocks(true);
            }
            this.draw();
            return;
        }

        // Hover Detection for Selection Context UI
        if (this.tool === 'select' && this.deleteIconBounds) {
            const db = this.deleteIconBounds;
            const dist = Math.hypot(pos.x - db.x, pos.y - db.y);
            this.isHoverDelete = dist < db.r;
            if (this.isHoverDelete) {
                this.canvas.style.cursor = 'pointer';
                this.draw(); // Redraw for hover color Change
            }
        } else {
            this.isHoverDelete = false;
        }

        // Rubber Band
        if (this.isRubberBanding) {
            this.rubberEnd = { ...pos };
            this.draw();
            return;
        }

        // Resize
        if (this.resizingHandle && this.selectedIds.length > 0 && this.resizeStartObjects) {
            const snappedPos = this.snapEnabled
                ? this.snapHandlePos(pos, this.resizingHandle.id)
                : pos;
            const { x, y, width, height } = this.applyResize(this.resizingHandle, this.resizeStartShape, this.resizeStartPos, snappedPos);
            const oldBounds = this.resizeStartShape;

            for (const item of this.resizeStartObjects) {
                if (!item.snapshot) continue;
                if (item.type === 'shape') {
                    const s = this.shapeObjects.find(obj => obj.id === item.id);
                    if (s) {
                        const snap = item.snapshot;
                        s.x = x + ((snap.x - oldBounds.x) / oldBounds.width) * width;
                        s.y = y + ((snap.y - oldBounds.y) / oldBounds.height) * height;
                        s.width = (snap.width / oldBounds.width) * width;
                        s.height = (snap.height / oldBounds.height) * height;
                    }
                } else if (item.type === 'path') {
                    const p = this.paths[item.id];
                    if (p) {
                        p.points = item.snapshot.points.map(pt => ({
                            x: x + ((pt.x - oldBounds.x) / oldBounds.width) * width,
                            y: y + ((pt.y - oldBounds.y) / oldBounds.height) * height
                        }));
                    }
                } else if (item.type === 'graph') {
                    const g = this.graphObjects.find(obj => obj.id === item.id);
                    if (g) {
                        const snap = item.snapshot;
                        g.x = x + ((snap.x - oldBounds.x) / oldBounds.width) * width;
                        g.y = y + ((snap.y - oldBounds.y) / oldBounds.height) * height;
                        g.width = (snap.width / oldBounds.width) * width;
                        g.height = (snap.height / oldBounds.height) * height;
                    }
                }
            }
            this.updatePropertiesPanel();
            this.draw();
            return;
        }

        // Drag Selection
        if (this.isDraggingSelection) {
            const totalDx = pos.x - this.dragStartPos.x;
            const totalDy = pos.y - this.dragStartPos.y;

            let finalDx = totalDx, finalDy = totalDy;
            if (this.snapEnabled && this.dragStartBounds) {
                const snapped = this.snapBoundsMove(this.dragStartBounds, totalDx, totalDy);
                finalDx = snapped.dx;
                finalDy = snapped.dy;
            }

            for (const item of this.dragStartObjects || this.selectedIds) {
                if (!item.snapshot) continue;
                if (item.type === 'shape') {
                    const s = this.shapeObjects.find(obj => obj.id === item.id);
                    if (s) { s.x = item.snapshot.x + finalDx; s.y = item.snapshot.y + finalDy; }
                } else if (item.type === 'path') {
                    const p = this.paths[item.id];
                    if (p) {
                        p.points = item.snapshot.points.map(pt => ({ x: pt.x + finalDx, y: pt.y + finalDy }));
                    }
                } else if (item.type === 'graph') {
                    const g = this.graphObjects.find(obj => obj.id === item.id);
                    if (g) { g.x = item.snapshot.x + finalDx; g.y = item.snapshot.y + finalDy; }
                } else if (item.type === 'line') {
                    const l = this.lineObjects.find(obj => obj.id === item.id);
                    if (l) {
                        l.x1 = item.snapshot.x1 + finalDx; l.y1 = item.snapshot.y1 + finalDy;
                        l.x2 = item.snapshot.x2 + finalDx; l.y2 = item.snapshot.y2 + finalDy;
                    }
                } else if (item.type === 'text') {
                    const b = this.textBlocks.find(obj => obj.id === item.id);
                    if (b) { b.x = item.snapshot.x + finalDx; b.y = item.snapshot.y + finalDy; }
                }
            }
            this.syncTextBlocks(true);
            this.draw();
            return;
        }

        if (this.draggingShapeId) { const s = this.shapeObjects.find(obj => obj.id === this.draggingShapeId); s.x = pos.x - this.dragOffset.x; s.y = pos.y - this.dragOffset.y; this.draw(); return; }
        if (this.resizingShapeId) { const s = this.shapeObjects.find(obj => obj.id === this.resizingShapeId); s.width = Math.max(50, pos.x - s.x); s.height = Math.max(50, pos.y - s.y); this.draw(); return; }
        if (this.draggingGraphId) { const g = this.graphObjects.find(obj => obj.id === this.draggingGraphId); g.x = pos.x - this.dragOffset.x; g.y = pos.y - this.dragOffset.y; this.draw(); return; }
        if (this.resizingGraphId) { const g = this.graphObjects.find(obj => obj.id === this.resizingGraphId); g.width = Math.max(100, pos.x - g.x); g.height = Math.max(100, pos.y - g.y); this.draw(); return; }
        
        if (!this.isDrawing) {
            // Cursor update for select tool
            if (this.tool === 'select') {
                this.canvas.style.cursor = this.getCursorForPos(pos);
            }
            return;
        }
        if (this.tool === 'shape') {
            const shiftKey = e.shiftKey;
            let width = pos.x - this.shapeStartPos.x;
            let height = pos.y - this.shapeStartPos.y;
            // Shiftキーで正方形・正円に固定
            if (shiftKey) {
                const size = Math.abs(width) > Math.abs(height) ? width : height;
                width = size;
                height = size;
            }
            this.previewShape = {
                id: Date.now(),
                type: this.shape.type,
                x: width < 0 ? this.shapeStartPos.x + width : this.shapeStartPos.x,
                y: height < 0 ? this.shapeStartPos.y + height : this.shapeStartPos.y,
                width: Math.abs(width),
                height: Math.abs(height),
                fillColor: this.shape.fillColor,
                strokeColor: this.shape.strokeColor,
                lineWidth: this.shape.lineWidth,
                noFill: this.shape.noFill
            };
            this.draw();
        } else if (this.tool === 'pen') this.currentPath.points.push(pos);
        else if (this.tool === 'eraser') this.eraseAt(pos);
        else return;
        this.draw();

        // Cursor update for select tool
        if (this.tool === 'select' && !this.draggingShapeId && !this.resizingHandle) {
            this.canvas.style.cursor = this.getCursorForPos(pos);
        }
    }

    handlePointerUp() {
        if (this.tool === 'line') {
            if (this.selectedLineHandle) {
                this.selectedLineHandle = null;
                this.dragLineStartSnapshot = null;
                this.saveCurrentNote();
                this.draw();
                return;
            }
            if (this.isDrawing && this.lineStartPos) {
                let endPos = { x: 0, y: 0 };
                if (this.previewLine) {
                    endPos = { x: this.previewLine.x2, y: this.previewLine.y2 };
                }
                const dist = Math.hypot(endPos.x - this.lineStartPos.x, endPos.y - this.lineStartPos.y);
                if (dist > 5) {
                    const newLine = {
                        id: Date.now(),
                        x1: this.lineStartPos.x, y1: this.lineStartPos.y,
                        x2: endPos.x, y2: endPos.y,
                        color: this.pen.color,
                        size: this.pen.size,
                        style: this.pen.style,
                        startCap: this.line.startCap,
                        endCap: this.line.endCap,
                    };
                    this.lineObjects.push(newLine);
                    this.selectedIds = [{ type: 'line', id: newLine.id }];
                    this.saveCurrentNote();
                }
                this.lineStartPos = null;
                this.previewLine = null;
            }
        }

        if (this.isRubberBanding) {
            const rect = {
                x: Math.min(this.rubberStart.x, this.rubberEnd.x),
                y: Math.min(this.rubberStart.y, this.rubberEnd.y),
                width: Math.abs(this.rubberEnd.x - this.rubberStart.x),
                height: Math.abs(this.rubberEnd.y - this.rubberStart.y)
            };
            if (rect.width > 2 || rect.height > 2) {
                this.selectedIds = this.getObjectsInRect(rect);
            }
            this.isRubberBanding = false;
        }

        if (this.isDrawing && this.currentPath) { this.paths.push(this.currentPath); }
        if (this.isDrawing && this.previewShape && (this.previewShape.width > 5 || this.previewShape.height > 5)) {
            this.shapeObjects.push(this.previewShape);
        }

        if (this.resizingHandle) {
            this.resizingHandle = null; this.resizeStartShape = null; this.resizeStartPos = null; this.resizeStartObjects = null;
        }

        if (this.tool === 'text' && this.isDrawing && this.textStartPos) {
            if (this.previewTextBlockId) {
                // ドラッグ確定時：フォーカスを当てる
                this.enterEditMode(this.previewTextBlockId);
                this.previewTextBlockId = null;
            } else {
                // シングルタップ時：デフォルトサイズで生成してフォーカス
                this.createInlineTextBlock({
                    x: this.textStartPos.x,
                    y: this.textStartPos.y,
                    width: 200,
                    height: 80
                }, true);
            }
            this.textStartPos = null;
        }

        this.isDrawing = false; this.currentPath = null; this.previewShape = null; this.shapeStartPos = null;
        this.previewTextBox = null; this.textStartPos = null;
        this.isPanning = false; this.isDraggingSelection = false;
        this.dragStartPos = null; this.dragStartBounds = null; this.dragStartObjects = null;
        this.draggingGraphId = null; this.resizingGraphId = null;
        this.draggingShapeId = null; this.resizingShapeId = null;
        this.selectedLineHandle = null; this.dragLineStartSnapshot = null;

        if (this.tool === 'select') {
            this.canvas.style.cursor = 'default';
            this.updatePropertiesPanel();
        }

        this.saveCurrentNote();
        this.draw();
    }

    setupEventListeners() {
        const add = (el, type, fn) => el.addEventListener(type, fn, { passive: false });
        
        add(this.canvas, 'mousedown', (e) => this.handlePointerDown(this.getPointerPos(e, this.canvas), e));
        add(this.canvas, 'mousemove', (e) => this.handlePointerMove(this.getPointerPos(e, this.canvas), e));
        add(this.canvas, 'mouseup', (e) => this.handlePointerUp());
        
        add(this.canvas, 'touchstart', (e) => {
            e.preventDefault();
            if (e.touches.length === 1) {
                const pos = this.getPointerPos(e, this.canvas); this.handlePointerDown(pos, e);
                const now = Date.now(); if (now - this.lastTapTime < 300) { this.onDoubleTap(pos); } this.lastTapTime = now;
            } else if (e.touches.length === 2) {
                this.isDrawing = false; this.isPanning = false;
                this.lastPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                this.lastPinchCenter = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
            }
        });
        
        add(this.canvas, 'touchmove', (e) => {
            e.preventDefault();
            if (e.touches.length === 1) this.handlePointerMove(this.getPointerPos(e, this.canvas), e);
            else if (e.touches.length === 2) this.handlePinch(e.touches, this.canvas);
        });
        
        add(this.canvas, 'touchend', (e) => { e.preventDefault(); if (e.touches.length === 0) this.handlePointerUp(); });

        window.addEventListener('wheel', (e) => {
            if (e.target !== this.canvas) return;
            e.preventDefault(); const rect = this.canvas.getBoundingClientRect();
            this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.pow(1.1, -e.deltaY / 100), this.view);
        }, { passive: false });

        document.getElementById('tool-select').onclick = () => this.setTool('select');
        document.getElementById('tool-pen').onclick = () => this.setTool('pen');
        document.getElementById('tool-shape').onclick = () => this.setTool('shape');
        document.getElementById('tool-graph').onclick = () => this.setTool('graph');
        document.getElementById('tool-text').onclick = () => this.setTool('text');
        document.getElementById('tool-eraser').onclick = () => this.setTool('eraser');
        document.getElementById('tool-line').onclick = () => this.setTool('line');
        document.getElementById('tool-undo').onclick = () => this.undo();
        document.getElementById('tool-redo').onclick = () => this.redo();
        document.getElementById('reset-view').onclick = () => this.resetView();

        // Pen size buttons (3-step)
        document.querySelectorAll('.pen-size-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.pen.size = parseInt(btn.dataset.size);
                document.querySelectorAll('.pen-size-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Pen color presets
        document.querySelectorAll('.pen-color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.updatePenColor(btn.dataset.color);
                document.querySelectorAll('.pen-color-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Custom color picker
        document.getElementById('pen-custom-color').addEventListener('click', () => {
            document.getElementById('pen-color').click();
        });
        document.getElementById('pen-color').addEventListener('change', (e) => {
            this.updatePenColor(e.target.value);
            document.querySelectorAll('.pen-color-btn').forEach(b => b.classList.remove('active'));
        });

        // Pen style buttons
        document.querySelectorAll('.pen-style-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.pen.style = btn.dataset.style;
                document.querySelectorAll('.pen-style-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
        const confirmMathBtn = document.getElementById('confirm-math');
        const cancelMathBtn = document.getElementById('cancel-math');
        if (confirmMathBtn) confirmMathBtn.onclick = () => this.confirmMath();
        if (cancelMathBtn) cancelMathBtn.onclick = () => this.hideMathDialog();

        // 図形ツール関連のイベントリスナー
        document.querySelectorAll('.shape-type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.shape.type = btn.dataset.type;
                document.querySelectorAll('.shape-type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // 初期状態の反映
        // toggleFillBtn 関連を削除

        document.querySelectorAll('.shape-color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.shape.strokeColor = btn.dataset.color;
                document.querySelectorAll('.shape-color-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        document.getElementById('shape-custom-color').addEventListener('click', () => {
            document.getElementById('shape-stroke-color-input').click();
        });
        document.getElementById('shape-stroke-color-input').addEventListener('change', (e) => {
            this.shape.strokeColor = e.target.value;
            document.querySelectorAll('.shape-color-btn').forEach(b => b.classList.remove('active'));
        });

        document.querySelectorAll('.shape-size-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.shape.lineWidth = parseInt(btn.dataset.size);
                document.querySelectorAll('.shape-size-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        document.getElementById('line-snap-btn').addEventListener('click', () => {
            this.line.snapAngle = !this.line.snapAngle;
            document.getElementById('line-snap-btn').classList.toggle('active', this.line.snapAngle);
        });

        document.querySelectorAll('.line-start-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.line.startCap = btn.dataset.cap;
                document.querySelectorAll('.line-start-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                // トリガーアイコンを選択中のSVGに更新
                document.getElementById('start-cap-trigger').innerHTML = btn.innerHTML;
                document.getElementById('start-cap-popup').classList.remove('open');
                this.selectedIds.filter(i => i.type === 'line').forEach(sel => {
                    const l = this.lineObjects.find(obj => obj.id === sel.id);
                    if (l) l.startCap = btn.dataset.cap;
                });
                this.saveCurrentNote();
                this.draw();
            });
        });

        document.querySelectorAll('.line-end-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.line.endCap = btn.dataset.cap;
                document.querySelectorAll('.line-end-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                // トリガーアイコンを選択中のSVGに更新
                document.getElementById('end-cap-trigger').innerHTML = btn.innerHTML;
                document.getElementById('end-cap-popup').classList.remove('open');
                this.selectedIds.filter(i => i.type === 'line').forEach(sel => {
                    const l = this.lineObjects.find(obj => obj.id === sel.id);
                    if (l) l.endCap = btn.dataset.cap;
                });
                this.saveCurrentNote();
                this.draw();
            });
        });

        const startTrigger = document.getElementById('start-cap-trigger');
        const startPopup   = document.getElementById('start-cap-popup');
        const endTrigger   = document.getElementById('end-cap-trigger');
        const endPopup     = document.getElementById('end-cap-popup');

        const toggleCapPopup = (showPopup, hidePopup) => {
            const isOpen = showPopup.classList.contains('open');
            hidePopup.classList.remove('open');
            if (isOpen) {
                showPopup.classList.remove('open');
            } else {
                showPopup.classList.add('open');
            }
        };

        // マウスとタッチ両対応
        ['click', 'touchend'].forEach(evtType => {
            if (!startTrigger || !endTrigger) return;
            startTrigger.addEventListener(evtType, (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleCapPopup(startPopup, endPopup);
            }, { passive: false });

            endTrigger.addEventListener(evtType, (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleCapPopup(endPopup, startPopup);
            }, { passive: false });
        });

        // ポップアップ外タップで閉じる
        document.addEventListener('touchend', (e) => {
            if (!startTrigger.contains(e.target) && !startPopup.contains(e.target)) {
                startPopup.classList.remove('open');
            }
            if (!endTrigger.contains(e.target) && !endPopup.contains(e.target)) {
                endPopup.classList.remove('open');
            }
        });

        document.addEventListener('click', (e) => {
            if (!startTrigger.contains(e.target) && !startPopup.contains(e.target)) {
                startPopup.classList.remove('open');
            }
            if (!endTrigger.contains(e.target) && !endPopup.contains(e.target)) {
                endPopup.classList.remove('open');
            }
        });


        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Tool selection shortcut
            if (e.key === 'v' || e.key === 'V') { this.setTool('select'); }
            if (e.key === 'l' || e.key === 'L') { this.setTool('line'); }
            if (e.key === 'p' || e.key === 'P') { this.setTool('pen'); }
            if (e.key === 's' || e.key === 'S') { if (!e.shiftKey) this.setTool('shape'); }
            if (e.key === 'g' || e.key === 'G') { this.setTool('graph'); }
            if (e.key === 't' || e.key === 'T') { this.setTool('text'); }
            if (e.key === 'e' || e.key === 'E') { this.setTool('eraser'); }

            if (this.tool === 'select') {
                if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault();
                    this.deleteSelectedObjects();
                } else if (e.key === 'Escape') {
                    this.selectedIds = [];
                    this.updatePropertiesPanel();
                    this.draw();
                } else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
                    e.preventDefault();
                    if (this.selectedIds.length > 0) {
                        const step = e.shiftKey ? 10 : 1;
                        let dx = 0, dy = 0;
                        if (e.key === 'ArrowLeft') dx = -step;
                        if (e.key === 'ArrowRight') dx = step;
                        if (e.key === 'ArrowUp') dy = -step;
                        if (e.key === 'ArrowDown') dy = step;

                        for (const item of this.selectedIds) {
                            if (item.type === 'shape') {
                                const s = this.shapeObjects.find(obj => obj.id === item.id);
                                if (s) { s.x += dx; s.y += dy; }
                            } else if (item.type === 'path') {
                                const p = this.paths[item.id];
                                if (p) {
                                    p.points = p.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
                                }
                            } else if (item.type === 'graph') {
                                const g = this.graphObjects.find(obj => obj.id === item.id);
                                if (g) { g.x += dx; g.y += dy; }
                            }
                        }
                        this.updatePropertiesPanel();
                        this.saveCurrentNote();
                        this.draw();
                    }
                }
            }

            // Existing undo/redo shortcuts
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); this.undo(); }
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); this.redo(); }
        });

        document.getElementById('tool-snap').addEventListener('click', () => {
            this.snapEnabled = !this.snapEnabled;
            document.getElementById('tool-snap').classList.toggle('active', this.snapEnabled);
        });
    }

    setupSubTooltip() {
        const tooltip = document.getElementById('sub-tooltip');
        document.querySelectorAll('#sub-toolbar .sub-btn, #sub-toolbar .pen-color-btn, #shape-sub-toolbar .sub-btn, #shape-sub-toolbar .shape-color-btn').forEach(btn => {
            btn.addEventListener('mouseenter', (e) => {
                const title = btn.getAttribute('title');
                if (!title) return;
                tooltip.textContent = title;
                tooltip.style.display = 'block';
                tooltip.style.top = (e.clientY - 10) + 'px';
            });
            btn.addEventListener('mousemove', (e) => {
                tooltip.style.top = (e.clientY - 10) + 'px';
            });
            btn.addEventListener('mouseleave', () => {
                tooltip.style.display = 'none';
            });
        });
    }

    handlePinch(touches, canvas) {
        const dist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
        const center = { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 };
        const rect = canvas.getBoundingClientRect();
        this.zoomAt(center.x - rect.left, center.y - rect.top, dist / this.lastPinchDist, this.view);
        this.view.offsetX += (center.x - this.lastPinchCenter.x); this.view.offsetY += (center.y - this.lastPinchCenter.y);
        this.lastPinchDist = dist; this.lastPinchCenter = center;
        this.draw();
    }

    onDoubleTap(pos) {
        // グラフオブジェクトのダブルタップ → グラフ編集モード
        if (this.tool !== 'select') {
            const target = this.graphObjects.find(g => pos.x >= g.x && pos.x <= g.x + g.width && pos.y >= g.y && pos.y <= g.y + g.height);
            if (target && typeof enterGraphEditMode === 'function') {
                enterGraphEditMode(target);
            }
            return;
        }

        // tool === 'select' の場合はシングルタップ開始に変更したため、ここでは何もしない
    }

    zoomAt(centerX, centerY, factor, view) {
        const cx = (centerX - view.offsetX) / view.scale; const cy = (centerY - view.offsetY) / view.scale;
        view.scale = Math.min(Math.max(view.scale * factor, view.minScale), view.maxScale);
        view.offsetX = centerX - cx * view.scale; view.offsetY = centerY - cy * view.scale;
        const zoomLabel = document.getElementById('zoom-label');
        if (zoomLabel) zoomLabel.innerText = `${Math.round(view.scale * 100)}%`;
        this._gridCache = null; // 倍率変更時に再生成
        this.draw();
    }

    updateUIModes() {
        const subToolbar = document.getElementById('sub-toolbar');
        const shapeSubToolbar = document.getElementById('shape-sub-toolbar');
        const canvasContainer = document.getElementById('canvas-container');
        const isPen = this.tool === 'pen';
        const isShape = this.tool === 'shape';
        const isLine = this.tool === 'line';
        const lineSubToolbar = document.getElementById('line-sub-toolbar');

        if (subToolbar) subToolbar.classList.toggle('visible', isPen);
        if (shapeSubToolbar) shapeSubToolbar.classList.toggle('visible', isShape);
        if (lineSubToolbar) lineSubToolbar.classList.toggle('visible', isLine);
        if (canvasContainer) canvasContainer.classList.toggle('sub-open', isPen || isShape || isLine);

        const selectProps = document.getElementById('select-properties');
        if (selectProps) {
            if (this.tool !== 'select') {
                selectProps.classList.add('hidden');
            } else {
                this.updatePropertiesPanel();
            }
        }
    }

    setTool(t) {
        // Clear selection when switching away from select tool
        if (t !== 'select') {
            this.selectedIds = [];
            this.resizingHandle = null;
        }
        this.tool = t; document.querySelectorAll('#toolbar button').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById(`tool-${t}`); if(btn) btn.classList.add('active');

        // 全インラインテキストエリアの pointer-events を切り替え
        document.querySelectorAll('.text-inline-editor').forEach(ta => {
            ta.style.pointerEvents = (t === 'text') ? 'auto' : 'none';
        });
        
        // math-block 全体の pointer-events を切り替え（セレクト時はCanvasへのイベント透過を優先）
        document.querySelectorAll('.math-block').forEach(el => {
            el.style.pointerEvents = (t === 'text') ? 'auto' : 'none';
        });

        this.updateUIModes(); 
    }

    addGraph(pos) {
        this.graphObjects.push({
            id: Date.now(), x: pos.x-150, y: pos.y-150, width: 300, height: 300,
            strokes: [] // 新しい形式
        });
        this.saveCurrentNote(); this.setTool('pen');
        this.draw();
    }

    updatePenColor(c) { 
        this.pen.color = c; 
        const cp = document.getElementById('pen-color');
        if (cp) cp.value = c;
        document.querySelectorAll('.pen-color-btn').forEach(b => b.classList.toggle('active', b.dataset.color === c)); 
    }
    undo() { if (this.history.length > 0) { this.redoStack.push(JSON.stringify(this.paths)); this.paths = JSON.parse(this.history.pop()); this.saveCurrentNote(); this.draw(); } }
    redo() { if (this.redoStack.length > 0) { this.history.push(JSON.stringify(this.paths)); this.paths = JSON.parse(this.redoStack.pop()); this.saveCurrentNote(); this.draw(); } }
    saveHistory() { this.history.push(JSON.stringify(this.paths)); if (this.history.length > 50) this.history.shift(); this.redoStack = []; }
    eraseAt(pos) { const th = 12 / this.view.scale; for (let i = this.paths.length-1; i >= 0; i--) { for (let j = 0; j < this.paths[i].points.length-1; j++) { if (this.distToSegment(pos, this.paths[i].points[j], this.paths[i].points[j+1]) < th) { this.paths.splice(i, 1); break; } } } }
    
    distToSegment(p, v, w) { 
        const l2 = Math.pow(v.x-w.x, 2) + Math.pow(v.y-w.y, 2); if (l2 === 0) return Math.hypot(p.x-v.x, p.y-v.y); 
        const t = Math.max(0, Math.min(1, ((p.x-v.x)*(w.x-v.x) + (p.y-v.y)*(w.y-v.y)) / l2)); 
        return Math.hypot(p.x-(v.x+t*(w.x-v.x)), p.y-(v.y+t*(w.y-v.y))); 
    }

    snapAngle45(start, end) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const angle = Math.atan2(dy, dx);
        const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        const dist = Math.hypot(dx, dy);
        return {
            x: start.x + dist * Math.cos(snapped),
            y: start.y + dist * Math.sin(snapped),
        };
    }

    drawLineCap(ctx, x, y, angle, cap, size, color) {
        if (cap === 'none') return;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        const s = size * 3;
        if (cap === 'arrow-filled') {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-s, -s * 0.4);
            ctx.lineTo(-s,  s * 0.4);
            ctx.closePath();
            ctx.fill();
        } else if (cap === 'arrow-open') {
            ctx.beginPath();
            ctx.moveTo(-s, -s * 0.4);
            ctx.lineTo(0, 0);
            ctx.lineTo(-s,  s * 0.4);
            ctx.stroke();
        } else if (cap === 'circle-filled') {
            ctx.beginPath();
            ctx.arc(-s * 0.5, 0, s * 0.4, 0, Math.PI * 2);
            ctx.fill();
        } else if (cap === 'circle-open') {
            ctx.beginPath();
            ctx.arc(-s * 0.5, 0, s * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.stroke();
        } else if (cap === 'triangle') {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-s, -s * 0.5);
            ctx.lineTo(-s,  s * 0.5);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }

    drawLineObject(ctx, line) {
        const { x1, y1, x2, y2, color, size, style, startCap, endCap } = line;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = size;
        ctx.lineCap = 'round';
        if (style === 'dashed') ctx.setLineDash([12 / this.view.scale, 12 / this.view.scale]);
        else if (style === 'dotted') ctx.setLineDash([2 / this.view.scale, 8 / this.view.scale]);
        else ctx.setLineDash([]);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);

        const angleStart = Math.atan2(y1 - y2, x1 - x2);
        const angleEnd   = Math.atan2(y2 - y1, x2 - x1);
        this.drawLineCap(ctx, x1, y1, angleStart, startCap, size, color);
        this.drawLineCap(ctx, x2, y2, angleEnd,   endCap,   size, color);

        ctx.restore();
    }

    getViewportBounds() {
        const { offsetX, offsetY, scale } = this.view;
        return {
            x: -offsetX / scale,
            y: -offsetY / scale,
            width: this.canvas.width / scale,
            height: this.canvas.height / scale,
        };
    }

    isRectVisible(x, y, width, height, vp) {
        return !(x + width < vp.x || x > vp.x + vp.width ||
                 y + height < vp.y || y > vp.y + vp.height);
    }

    isPathVisible(path, vp) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of path.points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
        return this.isRectVisible(minX, minY, maxX - minX, maxY - minY, vp);
    }
    
    snapToGrid(value) {
        const gridSize = 50;
        return Math.round(value / gridSize) * gridSize;
    }

    snapPos(x, y) {
        return { x: this.snapToGrid(x), y: this.snapToGrid(y) };
    }

    snapBoundsMove(bounds, dx, dy) {
        const gridSize = 50;
        const newX = bounds.x + dx;
        const newY = bounds.y + dy;
        const snappedX = Math.round(newX / gridSize) * gridSize;
        const snappedY = Math.round(newY / gridSize) * gridSize;
        return {
            dx: dx + (snappedX - newX),
            dy: dy + (snappedY - newY),
        };
    }

    snapHandlePos(pos, handleId) {
        const gridSize = 50;
        let x = pos.x, y = pos.y;
        if (handleId.includes('e') || handleId.includes('w')) {
            x = Math.round(pos.x / gridSize) * gridSize;
        }
        if (handleId.includes('n') || handleId.includes('s')) {
            y = Math.round(pos.y / gridSize) * gridSize;
        }
        if (handleId === 'nw' || handleId === 'ne' || handleId === 'sw' || handleId === 'se') {
            x = Math.round(pos.x / gridSize) * gridSize;
            y = Math.round(pos.y / gridSize) * gridSize;
        }
        return { x, y };
    }

    showMathDialog(pos) { /* 廃止 */ }
    hideMathDialog() { /* 廃止 */ }
    confirmMath() { /* 廃止 */ }

    createInlineTextBlock({ x, y, width, height }, focusOnCreate = true) {
        const id = Date.now();
        const block = { id, x, y, width: width || 200, height: height || 80, content: '' };
        this.textBlocks.push(block);
        this.createTextBlockElement(block, focusOnCreate);
        if (focusOnCreate) {
            this.triggerAutoSave ? this.triggerAutoSave() : this.saveCurrentNote();
        }
        return id;
    }

    createTextBlockElement(b, focusOnCreate = false) {
        const div = document.createElement('div');
        div.className = 'math-block' + (focusOnCreate ? ' newly-created' : '');
        div.id = `block-${b.id}`;
        div.style.width = b.width + 'px';
        div.style.pointerEvents = (this.tool === 'text') ? 'auto' : 'none';
        div.style.setProperty('--block-scale', this.view.scale);

        const inner = document.createElement('div');
        inner.className = 'text-block-inner';

        const render = document.createElement('div');
        render.className = 'text-render';
        render.style.display = b.content ? 'block' : 'none';

        const ta = document.createElement('textarea');
        ta.className = 'text-inline-editor';
        ta.style.display = b.content ? 'none' : 'block';
        ta.style.width = '100%';
        ta.style.minHeight = b.height + 'px';
        ta.placeholder = "テキストを入力... (LaTeX: $数式$)";
        ta.value = b.content;
        ta.style.pointerEvents = (this.tool === 'text') ? 'auto' : 'none';

        inner.appendChild(render);
        inner.appendChild(ta);
        div.appendChild(inner);

        // イベント設定
        div.onclick = (e) => {
            if (this.tool === 'text' && ta.style.display === 'none') {
                e.stopPropagation();
                this.enterEditMode(b.id);
            }
        };

        ta.onblur = () => this.exitEditMode(b.id);
        ta.onkeydown = (e) => {
            if (e.key === 'Escape') { ta.blur(); }
            else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); }
        };
        ta.oninput = () => {
            ta.style.height = 'auto';
            ta.style.height = ta.scrollHeight + 'px';
        };

        document.getElementById('canvas-container').appendChild(div);

        if (b.content) {
            this.renderTextBlock(b, div);
        }

        if (focusOnCreate) {
            // DOMがレイアウトされてからfocus
            requestAnimationFrame(() => {
                const ta = div.querySelector('.text-inline-editor');
                if (ta) {
                    ta.style.display = 'block';
                    const render = div.querySelector('.text-render');
                    if (render) render.style.display = 'none';
                    ta.focus();
                }
            });
        }
    }

    enterEditMode(id) {
        const b = this.textBlocks.find(b => b.id === id);
        const el = document.getElementById(`block-${id}`);
        if (!b || !el) return;
        const render = el.querySelector('.text-render');
        const ta = el.querySelector('.text-inline-editor');
        render.style.display = 'none';
        ta.style.display = 'block';
        ta.value = b.content;
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';
        ta.focus();
        ta.selectionStart = ta.selectionEnd = ta.value.length;
    }

    exitEditMode(id) {
        const b = this.textBlocks.find(b => b.id === id);
        const el = document.getElementById(`block-${id}`);
        if (!b || !el) return;
        const ta = el.querySelector('.text-inline-editor');
        const content = ta.value.trim();

        if (!content) {
            this.textBlocks = this.textBlocks.filter(t => t.id !== id);
            el.remove();
            this.saveCurrentNote();
            return;
        }

        b.content = content;
        this.renderTextBlock(b, el);
        
        // 表示を確実に切り替え
        ta.style.display = 'none';
        const render = el.querySelector('.text-render');
        if (render) render.style.display = 'block';
        
        
        // セレクトツール時は要素を透過させてCanvasでドラッグできるように戻す
        if (this.tool === 'select' && el) {
            el.style.pointerEvents = 'none';
        }

        this.saveCurrentNote();
    }

    renderTextBlock(b, el) {
        const render = el.querySelector('.text-render');
        if (!render) return;
        
        let html = b.content;
        // シンプルなLaTeXパース例: $...$ または $$...$$
        // 本格的には正規表現等で置換が必要だが、ここでは基本的な要件を満たす
        const regex = /(\$\$[\s\S]+?\$\$|\$[\s\S]+?\$)/g;
        const parts = html.split(regex);
        
        render.innerHTML = '';
        parts.forEach(part => {
            if (part.startsWith('$')) {
                const isDisplay = part.startsWith('$$');
                const formula = isDisplay ? part.slice(2, -2) : part.slice(1, -1);
                const span = document.createElement('span');
                try {
                    katex.render(formula, span, { throwOnError: false, displayMode: isDisplay });
                } catch (e) {
                    span.innerText = part;
                }
                render.appendChild(span);
            } else {
                const textNode = document.createTextNode(part);
                render.appendChild(textNode);
            }
        });
    }
    syncTextBlocks(force = false) {
        if (this.textBlocks.length === 0) return;
        const { offsetX, offsetY, scale } = this.view;
        // ビューが変化していない場合はスキップ（force=trueの場合は強制更新）
        if (!force && this._lastSyncView &&
            this._lastSyncView.offsetX === offsetX &&
            this._lastSyncView.offsetY === offsetY &&
            this._lastSyncView.scale === scale) return;
        this._lastSyncView = { offsetX, offsetY, scale };
        for (const b of this.textBlocks) {
            const el = document.getElementById(`block-${b.id}`);
            if (el) {
                const vp = this.wToV(b.x, b.y);
                el.style.left = `${vp.x}px`;
                el.style.top = `${vp.y}px`;
                el.style.transform = `scale(${scale})`;
                el.style.transformOrigin = '0 0';
            }
        }
    }
    loadNote() {
        const params = new URLSearchParams(window.location.search);
        this.noteId = params.get('id');

        let data = null;
        if (this.noteId) {
            const s = localStorage.getItem(`mathnote_note_${this.noteId}`);
            if (s) {
                try {
                    data = JSON.parse(s);
                    // インデックスから名前を取得
                    let index = [];
                    try {
                        index = JSON.parse(localStorage.getItem('mathnote_index') || '[]');
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
    }

    renameNote(name) {
        this.noteName = name;
        let index = JSON.parse(localStorage.getItem('mathnote_index') || '[]');
        const entryIdx = index.findIndex(e => e.id === this.noteId);
        if (entryIdx !== -1) {
            index[entryIdx].name = name;
            localStorage.setItem('mathnote_index', JSON.stringify(index));
        }
    }

    saveCurrentNote() {
        const noteData = {
            paths: this.paths,
            textBlocks: this.textBlocks,
            graphObjects: this.graphObjects,
            shapeObjects: this.shapeObjects,
            lineObjects: this.lineObjects,
            updatedAt: Date.now()
        };

        if (!this.noteId) {
            this.noteId = 'note_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
            const newUrl = new URL(window.location);
            newUrl.searchParams.set('id', this.noteId);
            window.history.replaceState({}, '', newUrl);

            let index = [];
            try {
                index = JSON.parse(localStorage.getItem('mathnote_index') || '[]');
                if (!Array.isArray(index)) index = [];
            } catch (e) { index = []; }
            
            index.push({ id: this.noteId, name: this.noteName, tags: [], updatedAt: noteData.updatedAt });
            localStorage.setItem('mathnote_index', JSON.stringify(index));
        }

        localStorage.setItem(`mathnote_note_${this.noteId}`, JSON.stringify(noteData));

        let index = [];
        try {
            index = JSON.parse(localStorage.getItem('mathnote_index') || '[]');
            if (!Array.isArray(index)) index = [];
        } catch (e) { index = []; }

        const entryIdx = index.findIndex(e => e.id === this.noteId);
        if (entryIdx !== -1) {
            index[entryIdx].updatedAt = noteData.updatedAt;
            localStorage.setItem('mathnote_index', JSON.stringify(index));
        }

        // Firebase同期
        this.syncToFirebase();
    }
    resetView() { this.view = { offsetX: 0, offsetY: 0, scale: 1.0, minScale: 0.1, maxScale: 10.0 }; document.getElementById('zoom-label').innerText = '100%'; }

}

new MathNote();
