/**
 * MathNote - テキスト・数式ブロック管理
 * app.js から分離
 */

MathNote.prototype.createInlineTextBlock = function({ x, y, width, height }, focusOnCreate = true) {
    const id = Date.now();
    const block = { id, x, y, width: width || 200, height: height || 80, content: '' };
    this.textBlocks.push(block);
    this.createTextBlockElement(block, focusOnCreate);
    if (focusOnCreate) {
        this.debouncedSave();
    }
    return id;
};

MathNote.prototype.createTextBlockElement = function(b, focusOnCreate = false) {
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
};

MathNote.prototype.enterEditMode = function(id) {
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
};

MathNote.prototype.exitEditMode = function(id) {
    const b = this.textBlocks.find(b => b.id === id);
    const el = document.getElementById(`block-${id}`);
    if (!b || !el) return;
    const ta = el.querySelector('.text-inline-editor');
    const content = ta.value.trim();

    if (!content) {
        this.textBlocks = this.textBlocks.filter(t => t.id !== id);
        el.remove();
        this.debouncedSave();
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
    this.debouncedSave();
};

MathNote.prototype.renderTextBlock = function(b, el) {
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
};

MathNote.prototype.syncTextBlocks = function(force = false) {
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
};

// 廃止されたメソッド（互換性のため空のまま移動）
MathNote.prototype.showMathDialog = function(pos) { /* 廃止 */ };
MathNote.prototype.hideMathDialog = function() { /* 廃止 */ };
MathNote.prototype.confirmMath = function() { /* 廃止 */ };
