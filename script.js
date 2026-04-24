// ========== 全局变量 ==========
let pyodide = null;
let nodes = [];
let connections = [];
let functionLibrary = {};
let codeMirror = null;
let connectingFrom = null;
let nodeIdCounter = 1;
let pyodideLoading = false;

// ========== 初始化 ==========
window.addEventListener('DOMContentLoaded', async () => {
    console.log('初始化编辑器...');
    updateStatus('加载 Python 运行时...');

    if (document.getElementById('code-editor')) {
        codeMirror = CodeMirror.fromTextArea(document.getElementById('code-editor'), {
            mode: 'python',
            theme: 'monokai',
            lineNumbers: true,
            readOnly: true,
            lineWrapping: true
        });
    }

    initFunctionLibrary();
    buildFunctionTree();

    await initPyodide();
    updateStatus('就绪');

    initCanvas();
    addExampleNodes();
    updateGeneratedCode();
    addLog('✨ 从左侧拖拽函数到画布即可创建节点');
    addLog('💡 点击节点的红色输出端口，再点击绿色输入端口即可建立连线');
});

function updateStatus(msg) {
    const el = document.getElementById('exec-status');
    if (el) el.textContent = msg;
}

async function initPyodide() {
    if (pyodide) return pyodide;
    if (pyodideLoading) {
        while (pyodideLoading) {
            await new Promise(r => setTimeout(r, 100));
        }
        return pyodide;
    }
    
    pyodideLoading = true;
    try {
        while (typeof window.loadPyodide === 'undefined') {
            await new Promise(r => setTimeout(r, 100));
        }
        
        pyodide = await window.loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/"
        });
        await pyodide.loadPackage('numpy');
        console.log('Pyodide 加载完成');
        return pyodide;
    } finally {
        pyodideLoading = false;
    }
}

// ========== 函数库 ==========
function initFunctionLibrary() {
    functionLibrary = {
        'math': {
            name: '数学运算',
            functions: {
                'add': { name: '加法', code: 'def add(a, b):\n    return a + b', inputs: ['a', 'b'], outputs: ['result'] },
                'multiply': { name: '乘法', code: 'def multiply(a, b):\n    return a * b', inputs: ['a', 'b'], outputs: ['result'] },
                'square': { name: '平方', code: 'def square(x):\n    return x ** 2', inputs: ['x'], outputs: ['result'] },
                'subtract': { name: '减法', code: 'def subtract(a, b):\n    return a - b', inputs: ['a', 'b'], outputs: ['result'] }
            }
        },
        'text': {
            name: '文本处理',
            functions: {
                'to_upper': { name: '转大写', code: 'def to_upper(text):\n    return text.upper()', inputs: ['text'], outputs: ['result'] },
                'greet': { name: '问候', code: 'def greet(name):\n    return f"Hello, {name}!"', inputs: ['name'], outputs: ['result'] }
            }
        }
    };
}

function buildFunctionTree() {
    const container = document.getElementById('function-tree');
    if (!container) return;
    container.innerHTML = '';

    for (const [catKey, catData] of Object.entries(functionLibrary)) {
        const catDiv = document.createElement('div');
        catDiv.className = 'category';
        catDiv.style.marginBottom = '16px';

        const header = document.createElement('div');
        header.className = 'category-header';
        header.innerHTML = `📁 ${catData.name} <span style="font-size:10px;">(${Object.keys(catData.functions).length})</span>`;

        let visible = true;
        header.onclick = () => {
            visible = !visible;
            itemsDiv.style.display = visible ? 'block' : 'none';
        };

        const itemsDiv = document.createElement('div');
        itemsDiv.className = 'category-items';

        for (const [funcName, funcData] of Object.entries(catData.functions)) {
            const item = document.createElement('div');
            item.className = 'function-item';
            item.innerHTML = `<strong>${funcData.name}</strong><small>${funcData.inputs.join(', ')} → ${funcData.outputs.join(', ')}</small>`;
            item.draggable = true;

            item.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({
                    funcName: funcName,
                    displayName: funcData.name,
                    code: funcData.code,
                    inputs: funcData.inputs,
                    outputs: funcData.outputs
                }));
                e.dataTransfer.effectAllowed = 'copy';
            };
            itemsDiv.appendChild(item);
        }

        catDiv.appendChild(header);
        catDiv.appendChild(itemsDiv);
        container.appendChild(catDiv);
    }
}

// ========== 画布初始化 ==========
function initCanvas() {
    const container = document.getElementById('react-flow');
    if (!container) return;

    container.style.position = 'relative';
    container.style.minHeight = '600px';
    container.style.overflow = 'auto';

    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    container.addEventListener('drop', (e) => {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left + container.scrollLeft - 110;
        const y = e.clientY - rect.top + container.scrollTop - 60;
        try {
            const funcData = JSON.parse(e.dataTransfer.getData('text/plain'));
            createNode(funcData, x, y);
        } catch (err) {
            console.error('拖拽失败:', err);
        }
    });

    container.addEventListener('click', (e) => {
        if (connectingFrom && !e.target.closest('.input-port')) {
            cancelConnection();
        }
    });
}

function createNode(funcData, x, y) {
    const nodeId = `node_${nodeIdCounter++}`;
    const node = {
        id: nodeId,
        x: Math.max(10, x),
        y: Math.max(10, y),
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

function deleteNode(nodeId) {
    nodes = nodes.filter(n => n.id !== nodeId);
    connections = connections.filter(c => c.fromNodeId !== nodeId && c.toNodeId !== nodeId);
    renderAll();
    updateGeneratedCode();
    addLog(`🗑️ 删除节点`);
}

// ========== 连线操作（修复版）==========
function startConnection(nodeId, portName) {
    connectingFrom = { nodeId, portName };
    document.body.style.cursor = 'crosshair';
    addLog(`🔌 开始连线: 从 "${portName}" 端口`);
}

function finishConnection(toNodeId, toPort) {
    if (!connectingFrom) return;

    if (connectingFrom.nodeId === toNodeId) {
        addLog('⚠️ 不能连接到自己');
        cancelConnection();
        return;
    }

    const exists = connections.some(c =>
        c.fromNodeId === connectingFrom.nodeId &&
        c.fromPort === connectingFrom.portName &&
        c.toNodeId === toNodeId &&
        c.toPort === toPort
    );

    if (exists) {
        addLog('⚠️ 连接已存在');
        cancelConnection();
        return;
    }

    connections.push({
        fromNodeId: connectingFrom.nodeId,
        fromPort: connectingFrom.portName,
        toNodeId: toNodeId,
        toPort: toPort
    });

    addLog(`🔗 连接成功: ${connectingFrom.portName} → ${toPort}`);
    cancelConnection();
    renderAll();  // 重新渲染以显示连线
    updateGeneratedCode();
}

function cancelConnection() {
    connectingFrom = null;
    document.body.style.cursor = '';
}

function removeConnection(index) {
    const conn = connections[index];
    connections.splice(index, 1);
    renderAll();
    updateGeneratedCode();
    addLog(`🔗 删除连接: ${conn.fromPort} → ${conn.toPort}`);
}

// ========== 渲染 ==========
function renderAll() {
    renderNodes();
    renderConnections();
}

function renderNodes() {
    const container = document.getElementById('react-flow');
    if (!container) return;

    for (const node of nodes) {
        let nodeEl = container.querySelector(`.node[data-id="${node.id}"]`);
        if (!nodeEl) {
            nodeEl = createNodeElement(node);
            container.appendChild(nodeEl);
        }
        updateNodeElement(nodeEl, node);
        nodeEl.style.left = `${node.x}px`;
        nodeEl.style.top = `${node.y}px`;
    }

    const existingNodes = container.querySelectorAll('.node');
    existingNodes.forEach(el => {
        const id = el.getAttribute('data-id');
        if (!nodes.find(n => n.id === id)) {
            el.remove();
        }
    });
}

function createNodeElement(node) {
    const div = document.createElement('div');
    div.className = 'node';
    div.setAttribute('data-id', node.id);
    div.style.position = 'absolute';
    div.style.minWidth = '220px';
    div.style.backgroundColor = '#2d2d3f';
    div.style.borderRadius = '8px';
    div.style.border = '2px solid #89b4fa';
    div.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    div.style.cursor = 'move';
    div.style.zIndex = '100';
    return div;
}

function updateNodeElement(div, node) {
    const header = document.createElement('div');
    header.className = 'node-header';
    header.style.padding = '8px 12px';
    header.style.backgroundColor = 'rgba(0,0,0,0.2)';
    header.style.borderRadius = '6px 6px 0 0';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.cursor = 'move';
    header.innerHTML = `
        <span style="color:#89b4fa; font-weight:bold;">🔷 ${escapeHtml(node.data.label)}</span>
        <button class="del-btn" style="background:none; border:none; color:#f38ba8; cursor:pointer; font-size:14px;">✕</button>
    `;

    const content = document.createElement('div');
    content.style.padding = '8px 12px';

    // 输入区域
    if (node.data.inputs.length > 0) {
        const inputsDiv = document.createElement('div');
        inputsDiv.style.marginBottom = '10px';
        inputsDiv.innerHTML = '<div style="font-size:10px; color:#6c7086; margin-bottom:4px;">📥 输入</div>';

        for (let i = 0; i < node.data.inputs.length; i++) {
            const input = node.data.inputs[i];
            const incomingConn = connections.find(c => c.toNodeId === node.id && c.toPort === input);

            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.margin = '3px 0';
            row.style.padding = '3px 6px';
            row.style.backgroundColor = '#24273a';
            row.style.borderRadius = '4px';
            row.style.borderLeft = '2px solid #a6e3a1';

            if (incomingConn) {
                row.innerHTML = `
                    <div style="width:6px; height:6px; background:#a6e3a1; border-radius:50%; margin-right:6px;"></div>
                    <span style="font-size:11px; flex:1;">${escapeHtml(input)}</span>
                    <span style="font-size:9px; color:#6c7086;">← 已连接</span>
                `;
            } else {
                const val = node.data.inputValues[input] !== undefined ? node.data.inputValues[input] : '';
                row.innerHTML = `
                    <div style="width:6px; height:6px; background:#a6e3a1; border-radius:50%; margin-right:6px;"></div>
                    <span style="font-size:11px; width:45px;">${escapeHtml(input)}</span>
                    <input type="text" class="input-val" data-input="${input}" placeholder="值" value="${escapeHtml(String(val))}" style="flex:1; background:#1a1b26; border:none; color:#cdd6f4; padding:2px 6px; border-radius:3px; font-size:10px;">
                `;
            }
            inputsDiv.appendChild(row);
        }
        content.appendChild(inputsDiv);
    }

    // 输出区域
    if (node.data.outputs.length > 0) {
        const outputsDiv = document.createElement('div');
        outputsDiv.innerHTML = '<div style="font-size:10px; color:#6c7086; margin-bottom:4px;">📤 输出</div>';

        for (let i = 0; i < node.data.outputs.length; i++) {
            const output = node.data.outputs[i];
            const row = document.createElement('div');
            row.className = 'output-port';
            row.setAttribute('data-node', node.id);
            row.setAttribute('data-port', output);
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.margin = '3px 0';
            row.style.padding = '3px 6px';
            row.style.backgroundColor = '#24273a';
            row.style.borderRadius = '4px';
            row.style.borderLeft = '2px solid #f38ba8';
            row.style.cursor = 'pointer';
            row.innerHTML = `
                <div style="width:6px; height:6px; background:#f38ba8; border-radius:50%; margin-right:6px;"></div>
                <span style="font-size:11px; flex:1;">${escapeHtml(output)}</span>
                <span class="out-val" style="font-size:9px; color:#a6e3a1;">${node.data.outputValue !== null ? String(node.data.outputValue).slice(0, 20) : ''}</span>
            `;
            outputsDiv.appendChild(row);
        }
        content.appendChild(outputsDiv);
    }

    const footer = document.createElement('div');
    footer.style.marginTop = '8px';
    footer.style.paddingTop = '8px';
    footer.style.borderTop = '1px solid #313244';
    footer.innerHTML = `<button class="run-btn" style="width:100%; background:#313244; border:none; color:#cdd6f4; padding:4px; border-radius:4px; cursor:pointer; font-size:10px;">▶ 执行</button>`;
    content.appendChild(footer);

    div.innerHTML = '';
    div.appendChild(header);
    div.appendChild(content);

    // 事件绑定
    const delBtn = div.querySelector('.del-btn');
    delBtn.onclick = (e) => {
        e.stopPropagation();
        deleteNode(node.id);
    };

    const runBtn = div.querySelector('.run-btn');
    runBtn.onclick = async (e) => {
        e.stopPropagation();
        await initPyodide();
        await executeNode(node);
        updateNodeElement(div, node);
        updateGeneratedCode();
    };

    const inputs = div.querySelectorAll('.input-val');
    inputs.forEach(inp => {
        const inputName = inp.getAttribute('data-input');
        inp.onchange = (e) => {
            let val = e.target.value;
            if (!isNaN(val) && val !== '') val = Number(val);
            node.data.inputValues[inputName] = val;
            updateGeneratedCode();
        };
    });

    const ports = div.querySelectorAll('.output-port');
    ports.forEach(port => {
        port.onclick = (e) => {
            e.stopPropagation();
            const nId = port.getAttribute('data-node');
            const pName = port.getAttribute('data-port');
            startConnection(nId, pName);
        };
    });

    makeDraggable(div, node);
}

function makeDraggable(element, node) {
    let dragging = false;
    let startX, startY, startLeft, startTop;
    const header = element.querySelector('.node-header');

    const onMouseMove = (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        node.x = startLeft + dx;
        node.y = startTop + dy;
        element.style.left = `${node.x}px`;
        element.style.top = `${node.y}px`;
        renderConnections();
    };

    const onMouseUp = () => {
        if (dragging) {
            dragging = false;
            element.style.zIndex = '';
            renderConnections();
            updateGeneratedCode();
        }
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    };

    header.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('del-btn')) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = node.x;
        startTop = node.y;
        element.style.zIndex = '1000';
        e.preventDefault();
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });
}

// 渲染连线
function renderConnections() {
    const container = document.getElementById('react-flow');
    if (!container) return;

    let svg = container.querySelector('.connections-svg');
    if (svg) svg.remove();

    const positions = getPortPositions();

    const svgNS = "http://www.w3.org/2000/svg";
    svg = document.createElementNS(svgNS, "svg");
    svg.classList.add('connections-svg');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '50';

    for (let i = 0; i < connections.length; i++) {
        const conn = connections[i];
        const start = positions[`${conn.fromNodeId}|out|${conn.fromPort}`];
        const end = positions[`${conn.toNodeId}|in|${conn.toPort}`];

        if (start && end) {
            const path = document.createElementNS(svgNS, "path");
            const midX = (start.x + end.x) / 2;
            const d = `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`;
            path.setAttribute('d', d);
            path.setAttribute('stroke', '#89b4fa');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('fill', 'none');
            path.style.pointerEvents = 'visibleStroke';
            path.style.cursor = 'pointer';

            path.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                removeConnection(i);
            });

            svg.appendChild(path);
        }
    }

    container.appendChild(svg);
}

function getPortPositions() {
    const positions = {};
    const container = document.getElementById('react-flow');
    if (!container) return positions;

    const containerRect = container.getBoundingClientRect();

    for (const node of nodes) {
        const nodeEl = container.querySelector(`.node[data-id="${node.id}"]`);
        if (!nodeEl) continue;

        const outputs = nodeEl.querySelectorAll('.output-port');
        outputs.forEach(port => {
            const nodeId = port.getAttribute('data-node');
            const portName = port.getAttribute('data-port');
            const rect = port.getBoundingClientRect();
            positions[`${nodeId}|out|${portName}`] = {
                x: rect.right - containerRect.left - 3,
                y: (rect.top + rect.bottom) / 2 - containerRect.top
            };
        });

        const inputs = nodeEl.querySelectorAll('.input-val');
        inputs.forEach((input, idx) => {
            const portName = node.data.inputs[idx];
            const rect = input.parentElement.getBoundingClientRect();
            positions[`${node.id}|in|${portName}`] = {
                x: rect.left - containerRect.left + 3,
                y: (rect.top + rect.bottom) / 2 - containerRect.top
            };
        });
    }

    return positions;
}

// 全局点击事件：监听输入端口完成连线
document.addEventListener('click', (e) => {
    if (!connectingFrom) return;

    // 查找被点击的输入端口
    const inputRow = e.target.closest('.input-val')?.parentElement;
    if (!inputRow) return;

    const nodeDiv = inputRow.closest('.node');
    if (!nodeDiv) return;

    const nodeId = nodeDiv.getAttribute('data-id');
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const inputIndex = Array.from(nodeDiv.querySelectorAll('.input-val')).indexOf(e.target.closest('.input-val'));
    if (inputIndex >= 0 && node.data.inputs[inputIndex]) {
        finishConnection(nodeId, node.data.inputs[inputIndex]);
    }
});

// ========== 执行节点 ==========
async function executeNode(node) {
    if (!pyodide) {
        addLog('❌ Python 未就绪');
        return;
    }

    try {
        await pyodide.runPythonAsync(node.data.code);

        const args = [];
        for (const input of node.data.inputs) {
            const incoming = connections.find(c => c.toNodeId === node.id && c.toPort === input);
            if (incoming) {
                args.push('None');
            } else {
                let val = node.data.inputValues[input];
                if (val === undefined || val === '') {
                    args.push('None');
                } else if (typeof val === 'string') {
                    args.push(`"${val.replace(/"/g, '\\"')}"`);
                } else {
                    args.push(val);
                }
            }
        }

        const code = `result = ${node.data.funcName}(${args.join(',')})`;
        await pyodide.runPythonAsync(code);
        const output = await pyodide.runPythonAsync('result');

        node.data.outputValue = output;
        addLog(`✅ ${node.data.label} = ${output}`);

    } catch (err) {
        node.data.outputValue = '错误';
        addLog(`❌ ${node.data.label}: ${err.message}`);
    }
}

async function executeAll() {
    await initPyodide();
    if (!pyodide) return;

    addLog(`🚀 执行 ${nodes.length} 个节点`);
    for (const node of nodes) {
        await executeNode(node);
    }
    renderAll();
    addLog(`✨ 执行完成`);
}

// ========== 代码生成 ==========
function generatePythonCode() {
    const lines = ['# 由 Python 节点编辑器生成', ''];
    const added = new Set();

    for (const node of nodes) {
        if (!added.has(node.data.funcName)) {
            added.add(node.data.funcName);
            lines.push(node.data.code);
            lines.push('');
        }
    }

    lines.push('# ========== 执行 ==========');
    const results = {};

    for (const node of nodes) {
        const args = [];
        for (const input of node.data.inputs) {
            const incoming = connections.find(c => c.toNodeId === node.id && c.toPort === input);
            if (incoming && results[incoming.fromNodeId]) {
                args.push(results[incoming.fromNodeId]);
            } else {
                let val = node.data.inputValues[input];
                if (!val) args.push('None');
                else if (typeof val === 'string') args.push(`"${val.replace(/"/g, '\\"')}"`);
                else args.push(val);
            }
        }
        const varName = `res_${node.id.slice(-4)}`;
        results[node.id] = varName;
        lines.push(`${varName} = ${node.data.funcName}(${args.join(', ')})`);
        lines.push(`print(f"${node.data.label}: {${varName}}")`);
        lines.push('');
    }
    return lines.join('\n');
}

function updateGeneratedCode() {
    if (codeMirror) codeMirror.setValue(generatePythonCode());
}

function addExampleNodes() {
    const addFunc = functionLibrary.math.functions.add;
    const squareFunc = functionLibrary.math.functions.square;

    createNode({
        funcName: 'add',
        displayName: '加法',
        code: addFunc.code,
        inputs: addFunc.inputs,
        outputs: addFunc.outputs
    }, 80, 80);

    createNode({
        funcName: 'square',
        displayName: '平方',
        code: squareFunc.code,
        inputs: squareFunc.inputs,
        outputs: squareFunc.outputs
    }, 400, 150);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
}

function addLog(msg) {
    const logDiv = document.getElementById('output-log');
    if (!logDiv) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `[${new Date().toLocaleTimeString()}] ${escapeHtml(msg)}`;
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;
}

function clearLogs() {
    const logDiv = document.getElementById('output-log');
    if (logDiv) logDiv.innerHTML = '';
}

function clearCanvas() {
    if (confirm('清空所有节点？')) {
        nodes = [];
        connections = [];
        renderAll();
        updateGeneratedCode();
        addLog('🗑️ 画布已清空');
    }
}

function showOrder() {
    const order = nodes.map(n => n.data.label).join(' → ');
    addLog(`📊 节点顺序: ${order || '无'}`);
}

async function copyCode() {
    const code = codeMirror?.getValue() || '';
    await navigator.clipboard.writeText(code);
    addLog('📋 代码已复制');
}

function downloadCode() {
    const code = codeMirror?.getValue() || '';
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `node_program_${Date.now()}.py`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('💾 代码已下载');
}

// 绑定按钮
document.getElementById('clear-canvas')?.addEventListener('click', clearCanvas);
document.getElementById('run-all')?.addEventListener('click', executeAll);
document.getElementById('toggle-exec-order')?.addEventListener('click', showOrder);
document.getElementById('copy-code')?.addEventListener('click', copyCode);
document.getElementById('download-code')?.addEventListener('click', downloadCode);
document.getElementById('clear-logs')?.addEventListener('click', clearLogs);
document.getElementById('refresh-functions')?.addEventListener('click', () => {
    buildFunctionTree();
    addLog('🔄 函数库已刷新');
});
