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
        this.pen = { color: '#7c6ff7', size: 3, style: 'solid' };
        this.shape = { type: 'rect', fillColor: '#ffffff', strokeColor: '#7c6ff7', lineWidth: 2, noFill: true };
        this.paths = []; this.textBlocks = []; this.graphObjects = []; this.shapeObjects = []; 
        
        // インタラクション状態
        this.isDrawing = false; this.currentPath = null;
        this.isPanning = false; this.lastMousePos = { x: 0, y: 0 };
        this.lastTapTime = 0; this.lastPinchDist = null; this.lastPinchCenter = null;
        this.draggingGraphId = null; this.resizingGraphId = null;
        this.draggingShapeId = null; this.resizingShapeId = null;
        this.dragOffset = { x: 0, y: 0 };
        this.previewShape = null; this.shapeStartPos = null;

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

        this.init();
    }

    init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());
        if (window.lucide) lucide.createIcons();
        this.loadNote();
        this.setupEventListeners();
        this.setupSubTooltip();
        this.updateUIModes();
        this.draw();
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

    resize() {
        const mc = document.getElementById('canvas-container').getBoundingClientRect();
        if (mc.width > 0) {
            this.canvas.width = mc.width;
            this.canvas.height = mc.height;
        }
    }

    draw() {
        const { ctx, canvas, view } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.drawInfiniteGrid(ctx, canvas, view);

        ctx.save();
        ctx.translate(view.offsetX, view.offsetY);
        ctx.scale(view.scale, view.scale);

        for (const p of this.paths) this.drawPath(ctx, p);
        if (this.currentPath) this.drawPath(ctx, this.currentPath);
        for (const s of this.shapeObjects) this.drawShape(ctx, s);
        if (this.previewShape) this.drawShape(ctx, this.previewShape);
        
        // 選択状態の強調表示
        if (this.selectedIds.length > 0) {
            const bounds = this.getCombinedBounds(this.selectedIds);
            if (bounds) this.drawSelectionHandles(ctx, bounds);
        }

        for (const g of this.graphObjects) this.drawGraphObject(ctx, g);

        // ラバーバンド描画
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
            ctx.strokeStyle = stroke.color || '#7c6ff7';
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
        const offsetX = view.offsetX % gridSize; const offsetY = view.offsetY % gridSize;
        ctx.beginPath(); ctx.strokeStyle = '#f0f0f0'; ctx.lineWidth = 1;
        for (let x = offsetX; x <= canvas.width; x += gridSize) { ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); }
        for (let y = offsetY; y <= canvas.height; y += gridSize) { ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); }
        ctx.stroke();
    }

    drawPath(ctx, path) {
        if (path.points.length < 2) return;
        ctx.beginPath(); ctx.strokeStyle = path.color; ctx.lineWidth = path.size;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        if (path.style === 'dashed') ctx.setLineDash([12, 12]); else if (path.style === 'dotted') ctx.setLineDash([2, 8]); else ctx.setLineDash([]);
        ctx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) ctx.lineTo(path.points[i].x, path.points[i].y);
        ctx.stroke(); ctx.setLineDash([]);
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
        const xs = path.points.map(p => p.x);
        const ys = path.points.map(p => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        return {
            x: minX,
            y: minY,
            width: Math.max(...xs) - minX,
            height: Math.max(...ys) - minY,
        };
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

        // 3. 削除ボタン (左上の外側)
        const delX = bounds.x - 2 * s;
        const delY = bounds.y - 2 * s;
        const iconR = 8 * s;
        const gx = delX - iconR * 1.5;
        const gy = delY - iconR * 1.5;
        const szTrash = iconR * 0.7;

        ctx.save();
        ctx.strokeStyle = this.isHoverDelete ? 'rgba(220, 80, 80, 0.9)' : 'rgba(180, 180, 180, 0.9)';
        ctx.lineWidth = 1.2 * s;
        ctx.lineCap = 'round';

        // フタ
        ctx.beginPath();
        ctx.moveTo(gx - szTrash, gy - szTrash * 0.3);
        ctx.lineTo(gx + szTrash, gy - szTrash * 0.3);
        ctx.stroke();

        // 取っ手
        ctx.beginPath();
        ctx.moveTo(gx - szTrash * 0.3, gy - szTrash * 0.3);
        ctx.lineTo(gx - szTrash * 0.3, gy - szTrash * 0.8);
        ctx.lineTo(gx + szTrash * 0.3, gy - szTrash * 0.8);
        ctx.lineTo(gx + szTrash * 0.3, gy - szTrash * 0.3);
        ctx.stroke();

        // 本体
        ctx.beginPath();
        ctx.roundRect(gx - szTrash * 0.8, gy - szTrash * 0.1, szTrash * 1.6, szTrash * 1.4, 1 * s);
        ctx.stroke();

        // 縦線2本
        [-szTrash * 0.3, szTrash * 0.3].forEach(offset => {
            ctx.beginPath();
            ctx.moveTo(gx + offset, gy + szTrash * 0.2);
            ctx.lineTo(gx + offset, gy + szTrash * 0.9);
            ctx.stroke();
        });
        ctx.restore();

        this.deleteIconBounds = { x: gx, y: gy, r: iconR * 1.5 };

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

            const colors = ['#7c6ff7', '#f38ba8', '#a6e3a1', '#89b4fa', '#f9e2af', '#cdd6f4'];
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
        }
    }

    deleteSelected() {
        if (this.selectedIds.length === 0) return;
        this.saveHistory();

        const shapeIdsToDelete = this.selectedIds.filter(i => i.type === 'shape').map(i => i.id);
        const pathIndicesToDelete = this.selectedIds.filter(i => i.type === 'path').map(i => i.id).sort((a, b) => b - a);
        const graphIdsToDelete = this.selectedIds.filter(i => i.type === 'graph').map(i => i.id);

        this.shapeObjects = this.shapeObjects.filter(s => !shapeIdsToDelete.includes(s.id));
        this.graphObjects = this.graphObjects.filter(g => !graphIdsToDelete.includes(g.id));
        
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
        if (e.button === 1 || (e.button === 0 && e.altKey)) { this.isPanning = true; this.lastMousePos = { x: e.clientX, y: e.clientY }; return; }

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

            // 2. Check handles (if single selection)
            if (this.selectedIds.length === 1) {
                const item = this.selectedIds[0];
                let rect = null;
                if (item.type === 'shape') {
                    const s = this.shapeObjects.find(obj => obj.id === item.id);
                    if (s) rect = { x: s.x, y: s.y, width: s.width, height: s.height };
                } else if (item.type === 'path') {
                    const p = this.paths[item.id];
                    if (p) rect = this.getPathBounds(p);
                } else if (item.type === 'graph') {
                    const g = this.graphObjects.find(obj => obj.id === item.id);
                    if (g) rect = { x: g.x, y: g.y, width: g.width, height: g.height };
                }

                if (rect) {
                    const h = this.getHandleAt(rect, pos);
                    if (h) {
                        this.resizingHandle = h;
                        this.resizeStartShape = { ...rect };
                        this.resizeStartPos = { ...pos };
                        return;
                    }
                }
            }

            // 2. Hit-testing
            // すでに選択されている要素のいずれかをドラッグ開始するかチェック
            const combinedBounds = this.getCombinedBounds(this.selectedIds);
            if (combinedBounds && pos.x >= combinedBounds.x && pos.x <= combinedBounds.x + combinedBounds.width &&
                pos.y >= combinedBounds.y && pos.y <= combinedBounds.y + combinedBounds.height) {
                this.isDrawing = false; // ドラッグ開始
                this.dragOffset = { x: pos.x, y: pos.y };
                this.isDraggingSelection = true;
                return;
            }

            // 新規に要素を選択
            // 図形
            for (let i = this.shapeObjects.length - 1; i >= 0; i--) {
                const s = this.shapeObjects[i];
                if (pos.x >= s.x && pos.x <= s.x + s.width && pos.y >= s.y && pos.y <= s.y + s.height) {
                    this.selectedIds = [{ type: 'shape', id: s.id }];
                    this.isDraggingSelection = true;
                    this.dragOffset = { x: pos.x, y: pos.y };
                    this.updatePropertiesPanel();
                    this.draw();
                    return;
                }
            }
            // ストローク
            for (let i = this.paths.length - 1; i >= 0; i--) {
                if (this.hitTestPath(this.paths[i], pos, this.view.scale)) {
                    this.selectedIds = [{ type: 'path', id: i }];
                    this.isDraggingSelection = true;
                    this.dragOffset = { x: pos.x, y: pos.y };
                    this.updatePropertiesPanel();
                    this.draw();
                    return;
                }
            }
            // グラフ
            for (let i = this.graphObjects.length - 1; i >= 0; i--) {
                const g = this.graphObjects[i];
                if (pos.x >= g.x && pos.x <= g.x + g.width && pos.y >= g.y && pos.y <= g.y + g.height) {
                    this.selectedIds = [{ type: 'graph', id: g.id }];
                    this.isDraggingSelection = true;
                    this.dragOffset = { x: pos.x, y: pos.y };
                    this.updatePropertiesPanel();
                    this.draw();
                    return;
                }
            }

            // 3. Click on empty space → Rubber band
            this.selectedIds = [];
            this.isRubberBanding = true;
            this.rubberStart = { ...pos };
            this.rubberEnd = { ...pos };
            this.updatePropertiesPanel();
            this.draw();
            return;
        }

        // シェイプオブジェクト の判定
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

        if (this.tool === 'graph') this.addGraph(pos);
        else if (this.tool === 'shape') { this.saveHistory(); this.shapeStartPos = pos; this.previewShape = null; this.isDrawing = true; }
        else if (this.tool === 'pen') { this.saveHistory(); this.isDrawing = true; this.currentPath = { color: this.pen.color, size: this.pen.size / this.view.scale, style: this.pen.style, points: [pos] }; this.draw(); }
        else if (this.tool === 'eraser') { this.saveHistory(); this.eraseAt(pos); this.isDrawing = true; this.draw(); }
        else if (this.tool === 'text') this.showMathDialog(pos);
    }

    handlePointerMove(pos, e) {
        if (this.isPanning) { this.view.offsetX += (e.clientX - this.lastMousePos.x); this.view.offsetY += (e.clientY - this.lastMousePos.y); this.lastMousePos = { x: e.clientX, y: e.clientY }; this.draw(); return; }

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
        if (this.resizingHandle && this.selectedIds.length === 1) {
            const item = this.selectedIds[0];
            const { x, y, width, height } = this.applyResize(this.resizingHandle, this.resizeStartShape, this.resizeStartPos, pos);
            
            if (item.type === 'shape') {
                const s = this.shapeObjects.find(obj => obj.id === item.id);
                if (s) { s.x = x; s.y = y; s.width = width; s.height = height; }
            } else if (item.type === 'path') {
                const p = this.paths[item.id];
                if (p) {
                    const bounds = this.getPathBounds(p);
                    const dx = x - bounds.x;
                    const dy = y - bounds.y;
                    const scaleX = width / bounds.width;
                    const scaleY = height / bounds.height;
                    p.points = p.points.map(pt => ({
                        x: x + (pt.x - bounds.x) * scaleX,
                        y: y + (pt.y - bounds.y) * scaleY
                    }));
                }
            } else if (item.type === 'graph') {
                const g = this.graphObjects.find(obj => obj.id === item.id);
                if (g) { g.x = x; g.y = y; g.width = width; g.height = height; }
            }
            this.updatePropertiesPanel();
            this.draw();
            return;
        }

        // Drag Selection
        if (this.isDraggingSelection) {
            const dx = pos.x - this.dragOffset.x;
            const dy = pos.y - this.dragOffset.y;
            this.dragOffset = { ...pos };

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
            this.resizingHandle = null; this.resizeStartShape = null; this.resizeStartPos = null;
        }

        this.isDrawing = false; this.currentPath = null; this.previewShape = null; this.shapeStartPos = null;
        this.isPanning = false; this.isDraggingSelection = false;
        this.draggingGraphId = null; this.resizingGraphId = null;
        this.draggingShapeId = null; this.resizingShapeId = null;

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
        document.getElementById('confirm-math').onclick = () => this.confirmMath();
        document.getElementById('cancel-math').onclick = () => this.hideMathDialog();

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


        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Tool selection shortcut
            if (e.key === 'v' || e.key === 'V') { this.setTool('select'); }

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
        const target = this.graphObjects.find(g => pos.x >= g.x && pos.x <= g.x + g.width && pos.y >= g.y && pos.y <= g.y + g.height);
        if (target) {
            if (typeof enterGraphEditMode === 'function') {
                enterGraphEditMode(target);
            }
        }
    }

    zoomAt(centerX, centerY, factor, view) {
        const cx = (centerX - view.offsetX) / view.scale; const cy = (centerY - view.offsetY) / view.scale;
        view.scale = Math.min(Math.max(view.scale * factor, view.minScale), view.maxScale);
        view.offsetX = centerX - cx * view.scale; view.offsetY = centerY - cy * view.scale;
        const zoomLabel = document.getElementById('zoom-label');
        if (zoomLabel) zoomLabel.innerText = `${Math.round(view.scale * 100)}%`;
        this.draw();
    }

    updateUIModes() {
        const subToolbar = document.getElementById('sub-toolbar');
        const shapeSubToolbar = document.getElementById('shape-sub-toolbar');
        const canvasContainer = document.getElementById('canvas-container');
        const isPen = this.tool === 'pen';
        const isShape = this.tool === 'shape';

        subToolbar.classList.toggle('visible', isPen);
        shapeSubToolbar.classList.toggle('visible', isShape);
        canvasContainer.classList.toggle('sub-open', isPen || isShape);

        const selectProps = document.getElementById('select-properties');
        if (this.tool !== 'select') {
            selectProps.classList.add('hidden');
        } else {
            this.updatePropertiesPanel();
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

    updatePenColor(c) { this.pen.color = c; document.querySelectorAll('.color-preset').forEach(b => b.classList.toggle('active', b.dataset.color === c)); }
    undo() { if (this.history.length > 0) { this.redoStack.push(JSON.stringify(this.paths)); this.paths = JSON.parse(this.history.pop()); this.saveCurrentNote(); this.draw(); } }
    redo() { if (this.redoStack.length > 0) { this.history.push(JSON.stringify(this.paths)); this.paths = JSON.parse(this.redoStack.pop()); this.saveCurrentNote(); this.draw(); } }
    saveHistory() { this.history.push(JSON.stringify(this.paths)); if (this.history.length > 50) this.history.shift(); this.redoStack = []; }
    eraseAt(pos) { const th = 12 / this.view.scale; for (let i = this.paths.length-1; i >= 0; i--) { for (let j = 0; j < this.paths[i].points.length-1; j++) { if (this.distToSegment(pos, this.paths[i].points[j], this.paths[i].points[j+1]) < th) { this.paths.splice(i, 1); break; } } } }
    
    distToSegment(p, v, w) { 
        const l2 = Math.pow(v.x-w.x, 2) + Math.pow(v.y-w.y, 2); if (l2 === 0) return Math.hypot(p.x-v.x, p.y-v.y); 
        const t = Math.max(0, Math.min(1, ((p.x-v.x)*(w.x-v.x) + (p.y-v.y)*(w.y-v.y)) / l2)); 
        return Math.hypot(p.x-(v.x+t*(w.x-v.x)), p.y-(v.y+t*(w.y-v.y))); 
    }

    showMathDialog(pos) { this.pendingMathPos = pos; document.getElementById('math-input-overlay').classList.remove('hidden'); document.getElementById('math-textarea').value = ''; document.getElementById('math-textarea').focus(); }
    hideMathDialog() { document.getElementById('math-input-overlay').classList.add('hidden'); }
    confirmMath() { 
        const c = document.getElementById('math-textarea').value; 
        if (c.trim()) { const b = { id: Date.now(), x: this.pendingMathPos.x, y: this.pendingMathPos.y, content: c }; this.textBlocks.push(b); this.createTextBlockElement(b); this.saveCurrentNote(); } this.hideMathDialog(); 
    }
    createTextBlockElement(b) { 
        const div = document.createElement('div'); div.className = 'math-block'; div.id = `block-${b.id}`; try { katex.render(b.content, div, { throwOnError: false, displayMode: b.content.includes('$$') }); } catch (e) { div.innerText = b.content; } 
        div.oncontextmenu = (e) => { e.preventDefault(); this.textBlocks = this.textBlocks.filter(blk => blk.id !== b.id); div.remove(); this.saveCurrentNote(); }; 
        div.onclick = (e) => { if (this.tool === 'text') { e.stopPropagation(); this.pendingMathPos = { x: b.x, y: b.y }; document.getElementById('math-textarea').value = b.content; document.getElementById('math-input-overlay').classList.remove('hidden'); this.textBlocks = this.textBlocks.filter(blk => blk.id !== b.id); div.remove(); } }; document.getElementById('canvas-container').appendChild(div); 
    }
    syncTextBlocks() { for (const b of this.textBlocks) { const el = document.getElementById(`block-${b.id}`); if (el) { const vp = this.wToV(b.x, b.y); el.style.left = `${vp.x}px`; el.style.top = `${vp.y}px`; el.style.transform = `scale(${this.view.scale})`; el.style.transformOrigin = '0 0'; } } }
    loadNote() { const s = localStorage.getItem('mathnote_data'); if (s) { this.note = JSON.parse(s); } else { this.note = { id: 'note_' + Date.now(), paths: [], textBlocks: [], graphObjects: [], shapeObjects: [], updateAt: Date.now() }; } this.paths = this.note.paths || []; this.textBlocks = this.note.textBlocks || []; this.graphObjects = this.note.graphObjects || []; this.shapeObjects = this.note.shapeObjects || []; document.querySelectorAll('.math-block').forEach(el => el.remove()); this.textBlocks.forEach(b => this.createTextBlockElement(b)); }
    saveNote() { if (!this.note) return; Object.assign(this.note, { paths: this.paths, textBlocks: this.textBlocks, graphObjects: this.graphObjects, shapeObjects: this.shapeObjects, updateAt: Date.now() }); localStorage.setItem('mathnote_data', JSON.stringify(this.note)); }
    saveCurrentNote() { this.saveNote(); }
    resetView() { this.view = { offsetX: 0, offsetY: 0, scale: 1.0, minScale: 0.1, maxScale: 10.0 }; document.getElementById('zoom-label').innerText = '100%'; }

}

new MathNote();
