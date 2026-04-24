/**
 * MathNote - インタラクション・イベント処理
 * app.js から分離
 */

MathNote.prototype.getPointerPos = function(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const pos = { x: clientX - rect.left, y: clientY - rect.top };
    return { x: (pos.x - this.view.offsetX) / this.view.scale, y: (pos.y - this.view.offsetY) / this.view.scale };
};

MathNote.prototype.wToV = function(wx, wy) {
    return { x: wx * this.view.scale + this.view.offsetX, y: wy * this.view.scale + this.view.offsetY };
};

MathNote.prototype.handlePointerDown = function(pos, e) {
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
                        } else if (item.type === 'text') {
                            const b = this.textBlocks.find(obj => obj.id === item.id);
                            if (b) item.snapshot = { x: b.x, y: b.y, width: b.width || 200, height: b.height || 80 };
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
};

MathNote.prototype.handlePointerMove = function(pos, e) {
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
                }, false, this.textStyle); // 最初はフォーカスしない
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
            } else if (item.type === 'text') {
                const b = this.textBlocks.find(obj => obj.id === item.id);
                if (b && item.snapshot) {
                    const snap = item.snapshot;
                    b.x = x + ((snap.x - oldBounds.x) / oldBounds.width) * width;
                    b.y = y + ((snap.y - oldBounds.y) / oldBounds.height) * height;
                    b.width = Math.max(80, (snap.width / oldBounds.width) * width);
                    b.height = Math.max(32, (snap.height / oldBounds.height) * height);

                    // DOM 要素にも反映
                    const el = document.getElementById(`block-${b.id}`);
                    if (el) {
                        el.style.width = b.width + 'px';
                        const ta = el.querySelector('.text-inline-editor');
                        if (ta) ta.style.minHeight = b.height + 'px';
                    }
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
    } else if (this.tool === 'pen') {
        // getCoalescedEvents で間引かれた中間点もすべて収集する
        const events = (e && typeof e.getCoalescedEvents === 'function')
            ? e.getCoalescedEvents()
            : [e];
        const rect = this.canvas.getBoundingClientRect();
        for (const ce of events) {
            const clientX = ce.touches ? ce.touches[0].clientX : ce.clientX;
            const clientY = ce.touches ? ce.touches[0].clientY : ce.clientY;
            const sx = clientX - rect.left;
            const sy = clientY - rect.top;
            const cp = {
                x: (sx - this.view.offsetX) / this.view.scale,
                y: (sy - this.view.offsetY) / this.view.scale
            };
            this.currentPath.points.push(cp);
        }
    }
    else if (this.tool === 'eraser') this.eraseAt(pos);
    else return;
    this.draw();

    // Cursor update for select tool
    if (this.tool === 'select' && !this.draggingShapeId && !this.resizingHandle) {
        this.canvas.style.cursor = this.getCursorForPos(pos);
    }
};

MathNote.prototype.handlePointerUp = function() {
    if (this._radialJustSwitched) {
        this._radialJustSwitched = false;
        return;
    }
    if (this.tool === 'line') {
        if (this.selectedLineHandle) {
            this.selectedLineHandle = null;
            this.dragLineStartSnapshot = null;
            this.debouncedSave();
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
                this.debouncedSave();
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
            }, true, this.textStyle);
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

    this.debouncedSave();
    this.draw();
};

MathNote.prototype.handlePinch = function(touches, canvas) {
    const dist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const center = { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 };
    const rect = canvas.getBoundingClientRect();
    this.zoomAt(center.x - rect.left, center.y - rect.top, dist / this.lastPinchDist, this.view);
    this.view.offsetX += (center.x - this.lastPinchCenter.x); this.view.offsetY += (center.y - this.lastPinchCenter.y);
    this.lastPinchDist = dist; this.lastPinchCenter = center;
    this.draw();
};

MathNote.prototype.onDoubleTap = function(pos) {
    // グラフオブジェクトのダブルタップ → グラフ編集モード
    if (this.tool !== 'select') {
        const target = this.graphObjects.find(g => pos.x >= g.x && pos.x <= g.x + g.width && pos.y >= g.y && pos.y <= g.y + g.height);
        if (target && typeof enterGraphEditMode === 'function') {
            enterGraphEditMode(target);
        }
        return;
    }
};

MathNote.prototype.zoomAt = function(centerX, centerY, factor, view) {
    const cx = (centerX - view.offsetX) / view.scale; const cy = (centerY - view.offsetY) / view.scale;
    view.scale = Math.min(Math.max(view.scale * factor, view.minScale), view.maxScale);
    view.offsetX = centerX - cx * view.scale; view.offsetY = centerY - cy * view.scale;
    const zoomLabel = document.getElementById('zoom-label');
    if (zoomLabel) zoomLabel.innerText = `${Math.round(view.scale * 100)}%`;
    this._gridCache = null; // 倍率変更時に再生成
    this.draw();
};

MathNote.prototype.setupEventListeners = function() {
    const add = (el, type, fn) => el.addEventListener(type, fn, { passive: false });
    
    add(this.canvas, 'mousedown', (e) => this.handlePointerDown(this.getPointerPos(e, this.canvas), e));
    add(this.canvas, 'mousemove', (e) => this.handlePointerMove(this.getPointerPos(e, this.canvas), e));
    add(this.canvas, 'mouseup', (e) => this.handlePointerUp());
    

    add(this.canvas, 'touchstart', (e) => {
        e.preventDefault();
        if (e.touches.length === 1) {
            const pos = this.getPointerPos(e, this.canvas);
            this.handlePointerDown(pos, e);
            const now = Date.now(); if (now - this.lastTapTime < 300) { this.onDoubleTap(pos); } this.lastTapTime = now;
        } else if (e.touches.length === 2) {
            // 2本指タップ検出用
            this._twoFingerTapStart = {
                time: Date.now(),
                x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
            };
            this.isDrawing = false; this.isPanning = false;
            this.lastPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            this.lastPinchCenter = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
        }
    });
    
    add(this.canvas, 'touchmove', (e) => {
        e.preventDefault();
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            
            if (this._radialActive) {
                // ラジアルメニュー操作中
                const dx = touch.clientX - this._radialOrigin.x;
                const dy = touch.clientY - this._radialOrigin.y;
                const dist = Math.hypot(dx, dy);

                if (dist < 12) {
                    this._radialHovered = null;
                } else {
                    // 角度から最寄りのツールを判定
                    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                    const RADIAL_TOOLS = [
                        { tool: 'pen',    angle: -90 },
                        { tool: 'select', angle: -18 },
                        { tool: 'shape',  angle:  54 },
                        { tool: 'eraser', angle: 126 },
                        { tool: 'line',   angle: 198 },
                    ];
                    
                    let minDiff = Infinity;
                    let bestTool = null;
                    RADIAL_TOOLS.forEach(item => {
                        let diff = Math.abs(angle - item.angle);
                        if (diff > 180) diff = 360 - diff;
                        if (diff < minDiff) {
                            minDiff = diff;
                            bestTool = item.tool;
                        }
                    });
                    this._radialHovered = bestTool;
                }
                this.updateRadialHighlight();
            } else {
                this.handlePointerMove(this.getPointerPos(e, this.canvas), e);
            }
        } else if (e.touches.length === 2) {
            // 指が動いたらタップ判定をキャンセル
            this._twoFingerTapStart = null;
            this.handlePinch(e.touches, this.canvas);
        }
    });
    
    add(this.canvas, 'touchend', (e) => {
        e.preventDefault();
        if (this._radialActive) {
            this.hideRadialMenu();
        } else if (e.touches.length === 0) {
            // 2本指タップ判定
            if (this._twoFingerTapStart) {
                const elapsed = Date.now() - this._twoFingerTapStart.time;
                if (elapsed < 220) {
                    // タップとして認識 → ラジアルメニューを表示
                    this.showRadialMenu(this._twoFingerTapStart.x, this._twoFingerTapStart.y);
                }
                this._twoFingerTapStart = null;
            }
            this.handlePointerUp();
        }
    });

    add(this.canvas, 'touchcancel', (e) => {
        this._twoFingerTapStart = null;
        if (this._radialActive) this.hideRadialMenu();
    });

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
            this.debouncedSave();
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
            this.debouncedSave();
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
                    this.debouncedSave();
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

    // ===== テキストサブツールバー =====

    // フォントサイズボタン
    document.querySelectorAll('.text-size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.text-size-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.textStyle.fontSize = parseInt(btn.dataset.size);
        });
    });

    // 文字色ボタン
    document.querySelectorAll('.text-color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.text-color-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.textStyle.color = btn.dataset.color;
            document.getElementById('text-color-input').value = btn.dataset.color;
        });
    });

    // カスタム文字色
    const textCustomColorBtn = document.getElementById('text-custom-color');
    const textColorInput = document.getElementById('text-color-input');
    if (textCustomColorBtn && textColorInput) {
        textCustomColorBtn.addEventListener('click', () => textColorInput.click());
        textColorInput.addEventListener('input', (e) => {
            this.textStyle.color = e.target.value;
            document.querySelectorAll('.text-color-btn').forEach(b => b.classList.remove('active'));
        });
    }

    // 水平揃えボタン
    document.querySelectorAll('.text-align-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.text-align-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.textStyle.textAlign = btn.dataset.align;
        });
    });

    // 垂直配置ボタン
    document.querySelectorAll('.text-valign-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.text-valign-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.textStyle.verticalAlign = btn.dataset.valign;
        });
    });
};

MathNote.prototype.setupSubTooltip = function() {
    const tooltip = document.getElementById('sub-tooltip');
    document.querySelectorAll('#sub-toolbar .sub-btn, #sub-toolbar .pen-color-btn, #shape-sub-toolbar .sub-btn, #shape-sub-toolbar .shape-color-btn, #text-sub-toolbar .sub-btn, #text-sub-toolbar .text-color-btn').forEach(btn => {
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
};
