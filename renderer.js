/**
 * MathNote - 描画エンジン
 * app.js から分離
 */

MathNote.prototype.resize = function() {
    const mc = document.getElementById('canvas-container').getBoundingClientRect();
    if (mc.width > 0) {
        this.canvas.width = mc.width;
        this.canvas.height = mc.height;
    }
    this._gridCache = null; // サイズ変更時はキャッシュをクリア
    this.draw();
};

MathNote.prototype._scheduleRender = function() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
        this._rafId = null;
        if (this._dirty) {
            this._dirty = false;
            this._render();
        }
    });
};

MathNote.prototype._render = function() {
    const { ctx, canvas, view } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.drawInfiniteGrid(ctx, canvas, view);

    ctx.save();
    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);

    const vp = this.getViewportBounds();
    this._drawPaths(ctx, vp);
    this._drawShapes(ctx, vp);
    this._drawGraphObjects(ctx, vp);
    this._drawLineObjects(ctx, vp);
    this._drawSelectionUI(ctx);

    ctx.restore();
    this.syncTextBlocks();
};

MathNote.prototype._drawPaths = function(ctx, vp) {
    for (const p of this.paths) {
        if (this.isPathVisible(p, vp)) this.drawPath(ctx, p);
    }
    if (this.currentPath) this.drawPath(ctx, this.currentPath);
};

MathNote.prototype._drawShapes = function(ctx, vp) {
    for (const s of this.shapeObjects) {
        if (this.isRectVisible(s.x, s.y, s.width, s.height, vp)) this.drawShape(ctx, s);
    }
    if (this.previewShape) this.drawShape(ctx, this.previewShape);
};

MathNote.prototype._drawGraphObjects = function(ctx, vp) {
    for (const g of this.graphObjects) {
        if (this.isRectVisible(g.x, g.y, g.width, g.height, vp)) this.drawGraphObject(ctx, g);
    }
};

MathNote.prototype._drawLineObjects = function(ctx, vp) {
    for (const l of this.lineObjects) {
        if (this.isRectVisible(
            Math.min(l.x1, l.x2), Math.min(l.y1, l.y2),
            Math.abs(l.x2 - l.x1), Math.abs(l.y2 - l.y1), vp
        )) this.drawLineObject(ctx, l);
    }
    if (this.previewLine) this.drawLineObject(ctx, this.previewLine);
};

MathNote.prototype._drawSelectionUI = function(ctx) {
    // 1. 選択ハンドル
    if (this.selectedIds.length > 0) {
        const bounds = this.getCombinedBounds(this.selectedIds);
        if (bounds) this.drawSelectionHandles(ctx, bounds);
    }

    // 2. 直線の端点ハンドル
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

    // 3. ラバーバンド
    if (this.isRubberBanding) {
        ctx.strokeStyle = '#4A90E2';
        ctx.lineWidth = 1 / this.view.scale;
        ctx.setLineDash([4 / this.view.scale, 4 / this.view.scale]);
        ctx.fillStyle = 'rgba(74, 144, 226, 0.1)';
        const rx = Math.min(this.rubberStart.x, this.rubberEnd.x);
        const ry = Math.min(this.rubberStart.y, this.rubberEnd.y);
        const rw = Math.abs(this.rubberEnd.x - this.rubberStart.x);
        const rh = Math.abs(this.rubberEnd.y - this.rubberStart.y);
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
    }
};

MathNote.prototype.draw = function() {
    this._dirty = true;
    this._scheduleRender();
};

MathNote.prototype.drawInfiniteGrid = function(ctx, canvas, view) {
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
};

MathNote.prototype.drawPath = function(ctx, path) {
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
};

MathNote.prototype.drawShape = function(ctx, shape) {
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
};

MathNote.prototype.drawGraphObject = function(ctx, graph) {
    ctx.save(); ctx.translate(graph.x, graph.y);
    
    // 背景と枠線を削除
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

    // 軸に矢印をつける
    const headLen = 8 / this.view.scale;

    // X軸 +方向（右）の矢印
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
};

MathNote.prototype.drawLineObject = function(ctx, line) {
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
};

MathNote.prototype.drawLineCap = function(ctx, x, y, angle, cap, size, color) {
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
};

MathNote.prototype.drawSelectionHandles = function(ctx, bounds) {
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
};

MathNote.prototype.getHandles = function(shape) {
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
};

MathNote.prototype.getViewportBounds = function() {
    const { offsetX, offsetY, scale } = this.view;
    return {
        x: -offsetX / scale,
        y: -offsetY / scale,
        width: this.canvas.width / scale,
        height: this.canvas.height / scale,
    };
};

MathNote.prototype.isRectVisible = function(x, y, width, height, vp) {
    return !(x + width < vp.x || x > vp.x + vp.width ||
             y + height < vp.y || y > vp.y + vp.height);
};

MathNote.prototype.isPathVisible = function(path, vp) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of path.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return this.isRectVisible(minX, minY, maxX - minX, maxY - minY, vp);
};
