/**
 * MathNote - グラフ詳細編集モジュール (刷新版)
 */

// グラフ編集のグローバル状態
let currentEditGraph = null;
let graphEditScale = 1;
let graphEditOffsetX = 0;
let graphEditOffsetY = 0;
let graphEditStrokes = []; // グラフ内座標 (-10〜10) で保持

let isGraphDrawing = false;
let currentGraphStroke = null;
let lastGraphPinchDist = null;
let lastGraphPinchCenter = null;

// 定数
const PADDING = { top: 20, right: 20, bottom: 40, left: 40 };

// --- 画面遷移 ---

/**
 * メインボードからグラフ編集モードへ移行
 */
function enterGraphEditMode(graph) {
    currentEditGraph = graph;
    graphEditStrokes = graph.strokes ? [...graph.strokes] : [];

    // グラフツールを無効化
    const graphBtn = document.getElementById('tool-graph');
    if (graphBtn) {
        graphBtn.disabled = true;
        graphBtn.style.opacity = '0.3';
        graphBtn.style.cursor = 'not-allowed';
        graphBtn.style.pointerEvents = 'none';
    }

    // main-viewは触らない
    document.getElementById('graph-edit-view').style.display = 'flex';

    initGraphEditCanvas();
}

/**
 * グラフ編集画面を終了してメインボードに戻る
 */
function exitGraphEditMode() {
    // ストロークを保存
    if (currentEditGraph) {
        currentEditGraph.strokes = [...graphEditStrokes];
        if (window.mathNoteApp) {
            window.mathNoteApp.saveCurrentNote();
        }
    }

    // グラフツールを再有効化
    const graphBtn = document.getElementById('tool-graph');
    if (graphBtn) {
        graphBtn.disabled = false;
        graphBtn.style.opacity = '';
        graphBtn.style.cursor = '';
        graphBtn.style.pointerEvents = '';
    }

    // オーバーレイを閉じるだけ（main-viewは触らない）
    document.getElementById('graph-edit-view').style.display = 'none';

    // メインボードはrenderLoopが動いてるのでそのまま表示される
    currentEditGraph = null;
}

/**
 * 保存処理: 編集結果をグラフオブジェクトに書き戻す
 */
function saveGraphEdit() {
    if (currentEditGraph) {
        currentEditGraph.strokes = JSON.parse(JSON.stringify(graphEditStrokes));
        // メインアプリの再描画を促す (MathNote インスタンス経由)
        if (window.mathNoteApp) window.mathNoteApp.saveCurrentNote();
    }
}

// --- 初期化とイベント ---

function initGraphEditCanvas() {
    const canvas = document.getElementById('graph-edit-canvas');
    const header = document.getElementById('graph-edit-header');

    // キャンバスサイズの計算 (ツールバー幅とヘッダー高さのみを引く)
    canvas.width = window.innerWidth - 56;
    const headerH = header ? header.offsetHeight : 56;
    canvas.height = window.innerHeight - headerH;
    
    // 表示設定のリセット
    graphEditScale = 1;
    graphEditOffsetX = 0;
    graphEditOffsetY = 0;
    
    drawGraphEdit();
}

// --- 描画処理 ---

function drawGraphEdit() {
    const canvas = document.getElementById('graph-edit-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const plotLeft   = PADDING.left;
    const plotRight  = canvas.width - PADDING.right;
    const plotTop    = PADDING.top;
    const plotBottom = canvas.height - PADDING.bottom;
    const plotWidth  = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;
    
    // 1マス = 描画エリア (中央±10) を分割
    const cellSize = (Math.min(plotWidth, plotHeight) / 20) * graphEditScale;
    
    // 原点のスクリーン座標
    const originX = plotLeft + plotWidth / 2 + graphEditOffsetX;
    const originY = plotTop + plotHeight / 2 + graphEditOffsetY;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // グリッド線 (境界 plotLeft〜plotRight, plotTop〜plotBottom)
    ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 0.5;
    for (let i = -10; i <= 10; i++) {
        const x = originX + i * cellSize;
        const y = originY + i * cellSize;
        
        if (x >= plotLeft && x <= plotRight) {
            ctx.beginPath(); ctx.moveTo(x, plotTop); ctx.lineTo(x, plotBottom); ctx.stroke();
        }
        if (y >= plotTop && y <= plotBottom) {
            ctx.beginPath(); ctx.moveTo(plotLeft, y); ctx.lineTo(plotRight, y); ctx.stroke();
        }
    }
    
    // X軸 (矢印付き)
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5;
    const xStart = originX + (-10) * cellSize;
    const xEnd   = originX + ( 10) * cellSize;
    if (originY >= plotTop && originY <= plotBottom) {
        drawArrow(ctx, xStart, originY, xEnd, originY);
    }
    
    // Y軸 (矢印付き)
    const yStart = originY + ( 10) * cellSize; // -10方向 (下)
    const yEnd   = originY + (-10) * cellSize; // +10方向 (上)
    if (originX >= plotLeft && originX <= plotRight) {
        drawArrow(ctx, originX, yStart, originX, yEnd);
    }
    
    // ラベル (padding領域)
    ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
    for (let i = -10; i <= 10; i++) {
        if (i === 0) continue;
        const x = originX + i * cellSize;
        const y = originY + i * cellSize;
        
        if (x >= plotLeft && x <= plotRight) {
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillText(i, x, plotBottom + 8);
        }
        if (y >= plotTop && y <= plotBottom) {
            ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
            ctx.fillText(-i, plotLeft - 6, y);
        }
    }
    
    // ストローク描画
    drawGraphStrokes(ctx, originX, originY, cellSize);
    
    // ズームラベル更新
    const zoomLabel = document.getElementById('graph-zoom-label');
    if (zoomLabel) zoomLabel.innerText = `${Math.round(graphEditScale * 100)}%`;
}

function drawGraphStrokes(ctx, originX, originY, cellSize) {
    const canvas = ctx.canvas;
    const pl = PADDING.left; const pr = canvas.width - PADDING.right;
    const pt = PADDING.top; const pb = canvas.height - PADDING.bottom;

    ctx.save();
    // 描画エリア外にはみ出さないようにクリッピング
    ctx.beginPath(); ctx.rect(pl, pt, pr - pl, pb - pt); ctx.clip();

    const drawOne = (stroke) => {
        if (stroke.points.length < 2) return;
        ctx.beginPath();
        ctx.strokeStyle = stroke.color || '#7c6ff7';
        ctx.lineWidth = (stroke.width || 3) * (cellSize / (Math.min(pr-pl, pb-pt)/20)); // スケールに応じて太さ調整
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        
        const first = toScreenCoords(stroke.points[0].x, stroke.points[0].y, originX, originY, cellSize);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < stroke.points.length; i++) {
            const p = toScreenCoords(stroke.points[i].x, stroke.points[i].y, originX, originY, cellSize);
            ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
    };

    graphEditStrokes.forEach(drawOne);
    if (currentGraphStroke) drawOne(currentGraphStroke);

    ctx.restore();
}

/**
 * 矢印を描画する
 */
function drawArrow(ctx, fromX, fromY, toX, toY) {
    const headLen = 10 / graphEditScale;
    const angle = Math.atan2(toY - fromY, toX - fromX);

    // 軸の線
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    // 矢印の先端
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(
        toX - headLen * Math.cos(angle - Math.PI / 6),
        toY - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(toX, toY);
    ctx.lineTo(
        toX - headLen * Math.cos(angle + Math.PI / 6),
        toY - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
}

// --- 座標変換 ---

function toGraphCoords(screenX, screenY, originX, originY, cellSize) {
    return {
        x: (screenX - originX) / cellSize,
        y: (originY - screenY) / cellSize, // 数学的な上方向をプラスにする
    };
}

function toScreenCoords(graphX, graphY, originX, originY, cellSize) {
    return {
        x: originX + graphX * cellSize,
        y: originY - graphY * cellSize, // 数学的なプラスはスクリーンではマイナス（上）
    };
}

function getGraphTouchPos(touch) {
    const canvas = document.getElementById('graph-edit-canvas');
    const rect = canvas.getBoundingClientRect();
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
}

// --- ストローク操作 ---

function startGraphStroke(screenPos) {
    const canvas = document.getElementById('graph-edit-canvas');
    const plotLeft   = PADDING.left;
    const plotRight  = canvas.width - PADDING.right;
    const plotTop    = PADDING.top;
    const plotBottom = canvas.height - PADDING.bottom;
    const originX = plotLeft + (plotRight - plotLeft) / 2 + graphEditOffsetX;
    const originY = plotTop + (plotBottom - plotTop) / 2 + graphEditOffsetY;
    const cellSize = (Math.min(plotRight - plotLeft, plotBottom - plotTop) / 20) * graphEditScale;

    // 現在のペンの設定を取得
    const penColor = window.mathNoteApp ? window.mathNoteApp.pen.color : '#7c6ff7';
    const penSize = window.mathNoteApp ? window.mathNoteApp.pen.size : 3;

    currentGraphStroke = {
        color: penColor,
        width: penSize / graphEditScale, // 論理座標系での太さ
        points: [toGraphCoords(screenPos.x, screenPos.y, originX, originY, cellSize)]
    };
}

function continueGraphStroke(screenPos) {
    if (!currentGraphStroke) return;
    const canvas = document.getElementById('graph-edit-canvas');
    const pl = PADDING.left; const pr = canvas.width - PADDING.right;
    const pt = PADDING.top; const pb = canvas.height - PADDING.bottom;
    const originX = pl + (pr - pl) / 2 + graphEditOffsetX;
    const originY = pt + (pb - pt) / 2 + graphEditOffsetY;
    const cellSize = (Math.min(pr - pl, pb - pt) / 20) * graphEditScale;

    currentGraphStroke.points.push(toGraphCoords(screenPos.x, screenPos.y, originX, originY, cellSize));
    drawGraphEdit();
}

function endGraphStroke() {
    if (currentGraphStroke) {
        graphEditStrokes.push(currentGraphStroke);
        currentGraphStroke = null;
        drawGraphEdit();
    }
}

// --- イベントリスナー ---

window.addEventListener('load', () => {
    const gc = document.getElementById('graph-edit-canvas');
    if (!gc) return;

    // マウスイベント (タッチ非対応PC用)
    gc.addEventListener('mousedown', (e) => {
        isGraphDrawing = true;
        const rect = gc.getBoundingClientRect();
        startGraphStroke({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    });
    gc.addEventListener('mousemove', (e) => {
        if (!isGraphDrawing) return;
        const rect = gc.getBoundingClientRect();
        continueGraphStroke({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    });
    gc.addEventListener('mouseup', () => {
        isGraphDrawing = false;
        endGraphStroke();
    });

    // タッチイベント
    gc.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (e.touches.length === 1) {
            isGraphDrawing = true;
            startGraphStroke(getGraphTouchPos(e.touches[0]));
        } else if (e.touches.length === 2) {
            isGraphDrawing = false;
            lastGraphPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            lastGraphPinchCenter = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
        }
    }, { passive: false });

    gc.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (e.touches.length === 1 && isGraphDrawing) {
            continueGraphStroke(getGraphTouchPos(e.touches[0]));
        } else if (e.touches.length === 2) {
            handleGraphPinch(e.touches);
        }
    }, { passive: false });

    gc.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (e.touches.length === 0) {
            if (isGraphDrawing) endGraphStroke();
            isGraphDrawing = false;
        }
    }, { passive: false });

    // ホイールズーム
    gc.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = gc.getBoundingClientRect();
        const factor = Math.pow(1.1, -e.deltaY / 100);
        handleGraphZoom({ x: e.clientX - rect.left, y: e.clientY - rect.top }, factor);
    }, { passive: false });
});

// --- ズームロジック ---

function handleGraphPinch(touches) {
    const newDist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const center = { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 };
    const factor = newDist / lastGraphPinchDist;
    
    handleGraphZoom(center, factor);
    
    // パン（中心移動）の補正
    graphEditOffsetX += (center.x - lastGraphPinchCenter.x);
    graphEditOffsetY += (center.y - lastGraphPinchCenter.y);
    
    lastGraphPinchDist = newDist;
    lastGraphPinchCenter = center;
    drawGraphEdit();
}

/**
 * 特定の点 (centerX, centerY) を基準にズーム
 */
function handleGraphZoom(center, factor) {
    const canvas = document.getElementById('graph-edit-canvas');
    const pl = PADDING.left; const pr = canvas.width - PADDING.right;
    const pt = PADDING.top; const pb = canvas.height - PADDING.bottom;
    const pw = pr - pl; const ph = pb - pt;
    
    const centerX = pl + pw / 2;
    const centerY = pt + ph / 2;

    // 現在のスケールにおける基準点からの相対座標 (論理座標)
    const cx = (center.x - centerX - graphEditOffsetX) / graphEditScale;
    const cy = (center.y - centerY - graphEditOffsetY) / graphEditScale;
    
    // スケール更新 (0.3 〜 10倍)
    graphEditScale = Math.min(Math.max(graphEditScale * factor, 0.3), 10);
    
    // 基準点がズレないように offset を補正
    graphEditOffsetX = center.x - centerX - cx * graphEditScale;
    graphEditOffsetY = center.y - centerY - cy * graphEditScale;
    
    drawGraphEdit();
}

// 画面リサイズ対応
window.addEventListener('resize', () => {
    if (document.getElementById('graph-edit-view').style.display === 'flex') {
        initGraphEditCanvas();
    }
});
