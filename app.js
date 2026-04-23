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
        this._saveTimer = null;

        // Radial Tool Menu state
        this._radialTimer = null;
        this._radialActive = false;
        this._radialOrigin = null; // {x, y} in client coords
        this._radialHovered = null; // tool name
        this._radialProgressInterval = null;
        this._radialProgressValue = 0;
        this._radialProgressDelay = null;
        this._radialJustSwitched = false;

        this.init();
    }

    init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());
        if (window.lucide) lucide.createIcons();
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
                this.saveCurrentNote();   // 念のため即時保存
                this.syncToFirebase();    // Firebaseに同期
                window.location.href = 'library.html';
            };
        } else {
            console.warn('Library button not found');
        }
    }

    // --- Selection tool helpers ---

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
        this.debouncedSave();
        this.draw();
    }

    applyColorToSelected(color) {
        this.selectedIds.forEach(sel => {
            if (sel.type === 'shape') {
                const s = this.shapeObjects.find(obj => obj.id === sel.id);
                if (s) s.strokeColor = color;
            }
        });
        this.debouncedSave();
        this.draw();
    }

    applySizeToSelected(size) {
        this.selectedIds.forEach(sel => {
            if (sel.type === 'shape') {
                const s = this.shapeObjects.find(obj => obj.id === sel.id);
                if (s) s.lineWidth = size;
            }
        });
        this.debouncedSave();
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
        this.debouncedSave(); this.setTool('pen');
        this.draw();
    }

    updatePenColor(c) { 
        this.pen.color = c; 
        const cp = document.getElementById('pen-color');
        if (cp) cp.value = c;
        document.querySelectorAll('.pen-color-btn').forEach(b => b.classList.toggle('active', b.dataset.color === c)); 
    }
    undo() { if (this.history.length > 0) { this.redoStack.push(JSON.stringify(this.paths)); this.paths = JSON.parse(this.history.pop()); this.debouncedSave(); this.draw(); } }
    redo() { if (this.redoStack.length > 0) { this.history.push(JSON.stringify(this.paths)); this.paths = JSON.parse(this.redoStack.pop()); this.debouncedSave(); this.draw(); } }
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

    resetView() { this.view = { offsetX: 0, offsetY: 0, scale: 1.0, minScale: 0.1, maxScale: 10.0 }; document.getElementById('zoom-label').innerText = '100%'; }

    // --- Radial Menu Methods ---
    initRadialMenuPositions() {
        const RADIUS = 64;
        const RADIAL_TOOLS = [
            { tool: 'pen',    angle: -90 },
            { tool: 'select', angle: -18 },
            { tool: 'shape',  angle:  54 },
            { tool: 'eraser', angle: 126 },
            { tool: 'line',   angle: 198 },
        ];
        RADIAL_TOOLS.forEach(item => {
            const el = document.querySelector(`.radial-item[data-tool="${item.tool}"]`);
            if (el) {
                const rad = item.angle * Math.PI / 180;
                el.style.left = (Math.cos(rad) * RADIUS) + 'px';
                el.style.top = (Math.sin(rad) * RADIUS) + 'px';
            }
        });
    }

    showRadialMenu(cx, cy) {
        if (this._radialActive) return;
        this._radialActive = true;
        this._radialOrigin = { x: cx, y: cy };
        this._radialHovered = null;

        const menu = document.getElementById('radial-menu');
        menu.style.left = cx + 'px';
        menu.style.top = cy + 'px';
        menu.classList.remove('hidden');

        if (window.lucide) lucide.createIcons();

        this.initRadialMenuPositions();
        this.updateRadialHighlight();

        // バイブレーション（対応端末のみ）
        if (navigator.vibrate) navigator.vibrate(10);
    }

    hideRadialMenu() {
        if (!this._radialActive) return;
        this._radialActive = false;
        document.getElementById('radial-menu').classList.add('hidden');
        if (this._radialHovered) {
            this.setTool(this._radialHovered);
            this._radialJustSwitched = true;
        }
        this._radialHovered = null;
    }

    updateRadialHighlight() {
        document.querySelectorAll('.radial-item').forEach(el => {
            el.classList.toggle('active', el.dataset.tool === this._radialHovered);
        });
    }

    showRadialProgress(cx, cy) {
        const progress = document.getElementById('radial-progress');
        if (!progress) return;

        progress.style.left = cx + 'px';
        progress.style.top = cy + 'px';
        progress.classList.remove('hidden');

        this._radialProgressValue = 0.6; // 300ms経過した状態から開始
        const fill = progress.querySelector('.radial-progress-fill');
        if (fill) fill.style.strokeDashoffset = 226 * (1 - this._radialProgressValue);

        clearInterval(this._radialProgressInterval);
        this._radialProgressInterval = setInterval(() => {
            this._radialProgressValue += 16 / 500;
            if (this._radialProgressValue >= 1) {
                this._radialProgressValue = 1;
                clearInterval(this._radialProgressInterval);
            }
            if (fill) fill.style.strokeDashoffset = 226 * (1 - this._radialProgressValue);
        }, 16);
    }

    hideRadialProgress() {
        clearInterval(this._radialProgressInterval);
        const progress = document.getElementById('radial-progress');
        if (progress) progress.classList.add('hidden');
    }
}


// MathNote クラス定義はここまで
// 初期化は index.html 側で全スクリプト読み込み後に行う
