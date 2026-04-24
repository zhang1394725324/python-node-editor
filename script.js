// ========== 全局变量 ==========
let pyodide = null;
let nodes = [];
let connections = [];
let functionLibrary = {};
let codeMirror = null;
let connectingFrom = null;
let nodeIdCounter = 1;

// ========== 初始化 ==========
window.addEventListener('DOMContentLoaded', async () => {
    console.log('初始化编辑器');
    updateStatus('⏳ 加载 Python...');

    codeMirror = CodeMirror.fromTextArea(document.getElementById('code-editor'), {
        mode: 'python',
        theme: 'monokai',
        lineNumbers: true,
        readOnly: true,
        lineWrapping: true
    });

    initFunctionLibrary();
    buildFunctionTree();

    pyodide = await loadPyodide();
    await pyodide.loadPackage('numpy');
    updateStatus('✅ 就绪');

    initCanvas();
    addExampleNodes();
    updateGeneratedCode();
    addLog('✨ 拖拽左侧函数到画布创建节点');
});

function updateStatus(msg) {
    const el = document.getElementById('exec-status');
    if (el) el.textContent = msg;
}

// ========== 函数库（可扩展） ==========
function initFunctionLibrary() {
    functionLibrary = {
        math: {
            name: '数学运算',
            functions: {
                add: { name: '加法', code: 'def add(a,b): return a+b', inputs: ['a','b'], outputs: ['result'] },
                multiply: { name: '乘法', code: 'def multiply(a,b): return a*b', inputs: ['a','b'], outputs: ['result'] },
                square: { name: '平方', code: 'def square(x): return x**2', inputs: ['x'], outputs: ['result'] }
            }
        },
        text: {
            name: '文本处理',
            functions: {
                to_upper: { name: '转大写', code: 'def to_upper(t): return t.upper()', inputs: ['text'], outputs: ['result'] },
                greet: { name: '问候', code: 'def greet(n): return f"Hello {n}!"', inputs: ['name'], outputs: ['result'] }
            }
        }
    };
}

function buildFunctionTree() {
    const container = document.getElementById('function-tree');
    if (!container) return;
    container.innerHTML = '';

    for (const cat of Object.values(functionLibrary)) {
        const catDiv = document.createElement('div');
        catDiv.className = 'category';

        const header = document.createElement('div');
        header.className = 'category-header';
        header.textContent = `📁 ${cat.name} (${Object.keys(cat.functions).length})`;
        let visible = true;
        header.onclick = () => {
            visible = !visible;
            itemsDiv.style.display = visible ? 'block' : 'none';
        };

        const itemsDiv = document.createElement('div');
        itemsDiv.className = 'category-items';

        for (const [key, fn] of Object.entries(cat.functions)) {
            const item = document.createElement('div');
            item.className = 'function-item';
            item.innerHTML = `<strong>${fn.name}</strong><small>${fn.inputs.join(',')} → ${fn.outputs.join(',')}</small>`;
            item.draggable = true;

            item.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({
                    funcName: key,
                    displayName: fn.name,
                    code: fn.code,
                    inputs: fn.inputs,
                    outputs: fn.outputs
                }));
            };
            itemsDiv.appendChild(item);
        }

        catDiv.appendChild(header);
        catDiv.appendChild(itemsDiv);
        container.appendChild(catDiv);
    }
}

// ========== 画布 & 节点 ==========
function initCanvas() {
    const container = document.getElementById('react-flow');
    container.style.position = 'relative';
    container.style.minHeight = '600px';

    container.addEventListener('dragover', (e) => e.preventDefault());
    container.addEventListener('drop', (e) => {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left + container.scrollLeft - 110;
        const y = e.clientY - rect.top + container.scrollTop - 60;
        try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            createNode(data, x, y);
        } catch (err) { console.error(err); }
    });

    container.addEventListener('click', (e) => {
        if (connectingFrom && !e.target.closest('.input-port')) cancelConnection();
    });
}

function createNode(funcData, x, y) {
    const id = `n_${nodeIdCounter++}`;
    const node = {
        id, x: Math.max(10, x), y: Math.max(10, y),
        data: {
            label: funcData.displayName,
            funcName: funcData.funcName,
            code: funcData.code,
            inputs: [...funcData.inputs],
            outputs: [...funcData.outputs],
            inputValues: {},
            outputValue: null
        }
    };
    nodes.push(node);
    renderAll();
    updateGeneratedCode();
    addLog(`➕ 添加节点: ${node.data.label}`);
}

function deleteNode(id) {
    nodes = nodes.filter(n => n.id !== id);
    connections = connections.filter(c => c.fromNodeId !== id && c.toNodeId !== id);
    renderAll();
    updateGeneratedCode();
    addLog('🗑️ 删除节点');
}

function startConnection(nodeId, port) {
    connectingFrom = { nodeId, port };
    document.body.style.cursor = 'crosshair';
    addLog(`🔌 连线: ${port}`);
}

function finishConnection(toId, toPort) {
    if (!connectingFrom) return;
    if (connectingFrom.nodeId === toId) { cancelConnection(); return; }
    if (connections.some(c => c.fromNodeId === connectingFrom.nodeId && c.fromPort === connectingFrom.port &&
                              c.toNodeId === toId && c.toPort === toPort)) {
        addLog('⚠️ 连接已存在');
        cancelConnection();
        return;
    }
    connections.push({
        fromNodeId: connectingFrom.nodeId,
        fromPort: connectingFrom.port,
        toNodeId: toId,
        toPort
    });
    addLog(`🔗 连接: ${connectingFrom.port} → ${toPort}`);
    cancelConnection();
    renderAll();
    updateGeneratedCode();
}

function cancelConnection() {
    connectingFrom = null;
    document.body.style.cursor = '';
}

function removeConnection(idx) {
    connections.splice(idx, 1);
    renderAll();
    updateGeneratedCode();
    addLog('🔗 删除连接');
}

// ========== 渲染节点 & 连线 ==========
function renderAll() {
    const container = document.getElementById('react-flow');
    if (!container) return;
    for (const node of nodes) {
        let el = container.querySelector(`.flow-node[data-id="${node.id}"]`);
        if (!el) {
            el = createNodeElement(node);
            container.appendChild(el);
        }
        updateNodeElement(el, node);
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
    }
    // 清除已删除节点
    document.querySelectorAll('.flow-node').forEach(el => {
        if (!nodes.find(n => n.id === el.getAttribute('data-id'))) el.remove();
    });
    renderConnections();
}

function createNodeElement(node) {
    const div = document.createElement('div');
    div.className = 'flow-node';
    div.setAttribute('data-id', node.id);
    return div;
}

function updateNodeElement(div, node) {
    const header = document.createElement('div');
    header.className = 'node-header';
    header.innerHTML = `<span class="node-title">🔷 ${escapeHtml(node.data.label)}</span>
                        <button class="delete-node-btn">✕</button>`;

    const content = document.createElement('div');
    content.className = 'node-content';

    // 输入区
    if (node.data.inputs.length) {
        const inDiv = document.createElement('div');
        inDiv.innerHTML = '<div class="section-title">📥 输入</div>';
        node.data.inputs.forEach(inp => {
            const conn = connections.find(c => c.toNodeId === node.id && c.toPort === inp);
            const row = document.createElement('div');
            row.className = 'input-port';
            if (conn) {
                row.innerHTML = `<div class="port-dot"></div><span class="port-name">${escapeHtml(inp)}</span>
                                 <span class="connected-badge">← 已连接</span>`;
            } else {
                const val = node.data.inputValues[inp] ?? '';
                row.innerHTML = `<div class="port-dot"></div><span class="port-name">${escapeHtml(inp)}</span>
                                 <input class="input-value" data-input="${inp}" value="${escapeHtml(String(val))}" placeholder="值">`;
                const inpEl = row.querySelector('.input-value');
                inpEl.onchange = (e) => {
                    let v = e.target.value;
                    if (!isNaN(v) && v !== '') v = Number(v);
                    node.data.inputValues[inp] = v;
                    updateGeneratedCode();
                };
            }
            inDiv.appendChild(row);
        });
        content.appendChild(inDiv);
    }

    // 输出区
    if (node.data.outputs.length) {
        const outDiv = document.createElement('div');
        outDiv.innerHTML = '<div class="section-title">📤 输出</div>';
        node.data.outputs.forEach(out => {
            const row = document.createElement('div');
            row.className = 'output-port';
            row.setAttribute('data-node', node.id);
            row.setAttribute('data-port', out);
            row.innerHTML = `<div class="port-dot"></div><span class="port-name">${escapeHtml(out)}</span>
                             <span class="output-value">${node.data.outputValue !== null ? String(node.data.outputValue).slice(0,20) : ''}</span>`;
            row.onclick = (e) => { e.stopPropagation(); startConnection(node.id, out); };
            outDiv.appendChild(row);
        });
        content.appendChild(outDiv);
    }

    // 执行按钮
    const footer = document.createElement('div');
    footer.className = 'node-footer';
    footer.innerHTML = `<button class="run-node-btn">▶ 执行</button>`;
    content.appendChild(footer);

    div.innerHTML = '';
    div.appendChild(header);
    div.appendChild(content);

    // 事件
    div.querySelector('.delete-node-btn').onclick = (e) => { e.stopPropagation(); deleteNode(node.id); };
    div.querySelector('.run-node-btn').onclick = async (e) => {
        e.stopPropagation();
        await executeNode(node);
        updateNodeElement(div, node);
        updateGeneratedCode();
    };
    makeDraggable(div, node);
}

function makeDraggable(el, node) {
    let drag = false, startX, startY, left, top;
    const header = el.querySelector('.node-header');
    header.onmousedown = (e) => {
        if (e.target.classList.contains('delete-node-btn')) return;
        drag = true;
        startX = e.clientX;
        startY = e.clientY;
        left = node.x;
        top = node.y;
        el.style.zIndex = '1000';
        e.preventDefault();
    };
    window.onmousemove = (e) => {
        if (!drag) return;
        node.x = left + (e.clientX - startX);
        node.y = top + (e.clientY - startY);
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
        renderConnections();
    };
    window.onmouseup = () => {
        if (drag) {
            drag = false;
            el.style.zIndex = '';
            renderConnections();
            updateGeneratedCode();
        }
    };
}

function renderConnections() {
    const container = document.getElementById('react-flow');
    let svg = container.querySelector('.connections-svg');
    if (svg) svg.remove();

    const rect = container.getBoundingClientRect();
    const positions = {};
    for (const node of nodes) {
        const el = container.querySelector(`.flow-node[data-id="${node.id}"]`);
        if (!el) continue;
        // outputs
        el.querySelectorAll('.output-port').forEach(port => {
            const pname = port.getAttribute('data-port');
            const r = port.getBoundingClientRect();
            positions[`${node.id}|out|${pname}`] = { x: r.right - rect.left - 3, y: (r.top + r.bottom)/2 - rect.top };
        });
        // inputs
        el.querySelectorAll('.input-port').forEach((port, idx) => {
            const pname = node.data.inputs[idx];
            const r = port.getBoundingClientRect();
            positions[`${node.id}|in|${pname}`] = { x: r.left - rect.left + 3, y: (r.top + r.bottom)/2 - rect.top };
        });
    }

    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('connections-svg');
    svg.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:50';
    connections.forEach((c, idx) => {
        const s = positions[`${c.fromNodeId}|out|${c.fromPort}`];
        const e = positions[`${c.toNodeId}|in|${c.toPort}`];
        if (s && e) {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const mid = (s.x + e.x)/2;
            path.setAttribute('d', `M ${s.x} ${s.y} C ${mid} ${s.y}, ${mid} ${e.y}, ${e.x} ${e.y}`);
            path.setAttribute('stroke', '#89b4fa');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('fill', 'none');
            path.style.pointerEvents = 'visibleStroke';
            path.style.cursor = 'pointer';
            path.ondblclick = () => removeConnection(idx);
            svg.appendChild(path);
        }
    });
    container.appendChild(svg);
}

// 监听输入端口完成连线
document.addEventListener('click', (e) => {
    if (!connectingFrom) return;
    const inpRow = e.target.closest('.input-port');
    if (!inpRow) return;
    const nodeDiv = inpRow.closest('.flow-node');
    if (!nodeDiv) return;
    const nodeId = nodeDiv.getAttribute('data-id');
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const idx = Array.from(nodeDiv.querySelectorAll('.input-port')).indexOf(inpRow);
    if (idx >= 0 && node.data.inputs[idx]) finishConnection(nodeId, node.data.inputs[idx]);
});

// ========== 执行逻辑 ==========
async function executeNode(node) {
    if (!pyodide) { addLog('❌ 未就绪'); return; }
    try {
        await pyodide.runPythonAsync(node.data.code);
        const args = node.data.inputs.map(inp => {
            const conn = connections.find(c => c.toNodeId === node.id && c.toPort === inp);
            if (conn) return 'None';
            let v = node.data.inputValues[inp];
            if (v === undefined || v === '') return 'None';
            return typeof v === 'string' ? `"${v}"` : v;
        });
        const code = `result = ${node.data.funcName}(${args.join(',')})`;
        await pyodide.runPythonAsync(code);
        const out = await pyodide.runPythonAsync('result');
        node.data.outputValue = out;
        addLog(`✅ ${node.data.label} = ${out}`);
    } catch (err) {
        node.data.outputValue = '错误';
        addLog(`❌ ${node.data.label}: ${err.message}`);
    }
}

async function executeAll() {
    if (!pyodide) return;
    addLog(`🚀 执行 ${nodes.length} 个节点`);
    for (const node of nodes) await executeNode(node);
    renderAll();
    addLog('✨ 完成');
}

// ========== 代码生成 ==========
function generatePythonCode() {
    const lines = ['# 由节点编辑器生成', ''];
    const added = new Set();
    nodes.forEach(n => {
        if (!added.has(n.data.funcName)) {
            added.add(n.data.funcName);
            lines.push(n.data.code, '');
        }
    });
    lines.push('# 执行流程');
    const vars = {};
    nodes.forEach(n => {
        const args = n.data.inputs.map(inp => {
            const conn = connections.find(c => c.toNodeId === n.id && c.toPort === inp);
            return (conn && vars[conn.fromNodeId]) ? vars[conn.fromNodeId] : (n.data.inputValues[inp] || 'None');
        });
        const vname = `_${n.data.funcName}_${n.id.slice(-4)}`;
        vars[n.id] = vname;
        lines.push(`${vname} = ${n.data.funcName}(${args.join(',')})`);
    });
    return lines.join('\n');
}

function updateGeneratedCode() { if (codeMirror) codeMirror.setValue(generatePythonCode()); }

// ========== 辅助 ==========
function addExampleNodes() {
    const add = functionLibrary.math.functions.add;
    const sq = functionLibrary.math.functions.square;
    if (add) createNode({ ...add, displayName: '加法' }, 80, 100);
    if (sq) createNode({ ...sq, displayName: '平方' }, 380, 150);
}

function escapeHtml(str) { return String(str).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])); }
function addLog(msg) {
    const log = document.getElementById('output-log');
    if (log) {
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
    }
}
function clearLogs() { const log = document.getElementById('output-log'); if (log) log.innerHTML = ''; }
function clearCanvas() { if (confirm('清空所有节点？')) { nodes = []; connections = []; renderAll(); updateGeneratedCode(); addLog('🗑️ 清空'); } }
function showOrder() { addLog(`📊 节点顺序: ${nodes.map(n => n.data.label).join(' → ') || '无'}`); }
async function copyCode() { await navigator.clipboard.writeText(codeMirror.getValue()); addLog('📋 已复制'); }
function downloadCode() {
    const blob = new Blob([codeMirror.getValue()], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nodes_${Date.now()}.py`;
    a.click();
    URL.revokeObjectURL(a.href);
    addLog('💾 已下载');
}
function loadPyodide() {
    return new Promise((resolve, reject) => {
        if (window.loadPyodide) {
            window.loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/' }).then(resolve).catch(reject);
        } else {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js';
            script.onload = () => window.loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/' }).then(resolve).catch(reject);
            script.onerror = reject;
            document.head.appendChild(script);
        }
    });
}

// 绑定按钮
document.getElementById('clear-canvas')?.addEventListener('click', clearCanvas);
document.getElementById('run-all')?.addEventListener('click', executeAll);
document.getElementById('toggle-exec-order')?.addEventListener('click', showOrder);
document.getElementById('copy-code')?.addEventListener('click', copyCode);
document.getElementById('download-code')?.addEventListener('click', downloadCode);
document.getElementById('clear-logs')?.addEventListener('click', clearLogs);
document.getElementById('refresh-functions')?.addEventListener('click', () => { buildFunctionTree(); addLog('🔄 刷新函数库'); });
