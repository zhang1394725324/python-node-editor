// ========== 全局变量 ==========
let pyodide = null;
let nodes = [];
let connections = [];
let functionLibrary = {};
let codeMirror = null;
let showExecOrderFlag = false;
let connectingFrom = null;
let nodeIdCounter = 1;

// ========== 初始化 ==========
window.addEventListener('DOMContentLoaded', async () => {
    console.log('初始化节点编辑器...');
    updateStatus('加载 Python 运行时...');
    
    // 初始化 CodeMirror
    codeMirror = CodeMirror.fromTextArea(document.getElementById('code-editor'), {
        mode: 'python',
        theme: 'monokai',
        lineNumbers: true,
        readOnly: true,
        lineWrapping: true
    });
    
    // 先加载函数库（同步方式，确保显示）
    initFunctionLibrary();
    buildFunctionTree();
    
    // 加载 Pyodide
    updateStatus('加载 Python 运行时...');
    pyodide = await loadPyodide();
    await pyodide.loadPackage(['numpy']);
    
    updateStatus('就绪');
    
    // 初始化画布
    initCanvas();
    
    // 添加示例节点
    addExampleNodes();
    
    // 更新代码
    updateGeneratedCode();
    
    addLog('✨ 编辑器已就绪，从左侧拖拽函数到画布创建节点');
});

function updateStatus(msg) {
    const statusEl = document.getElementById('exec-status');
    if (statusEl) statusEl.textContent = msg;
}

// ========== 函数库（同步初始化，确保显示）==========
function initFunctionLibrary() {
    functionLibrary = {
        'math': {
            name: '数学运算',
            functions: {
                'add': {
                    name: '加法',
                    code: 'def add(a, b):\n    """加法：返回 a + b"""\n    return a + b',
                    inputs: ['a', 'b'],
                    outputs: ['sum']
                },
                'multiply': {
                    name: '乘法',
                    code: 'def multiply(a, b):\n    """乘法：返回 a * b"""\n    return a * b',
                    inputs: ['a', 'b'],
                    outputs: ['product']
                },
                'square': {
                    name: '平方',
                    code: 'def square(x):\n    """平方：返回 x^2"""\n    return x ** 2',
                    inputs: ['x'],
                    outputs: ['result']
                },
                'subtract': {
                    name: '减法',
                    code: 'def subtract(a, b):\n    """减法：返回 a - b"""\n    return a - b',
                    inputs: ['a', 'b'],
                    outputs: ['difference']
                }
            }
        },
        'text': {
            name: '文本处理',
            functions: {
                'to_upper': {
                    name: '转大写',
                    code: 'def to_upper(text):\n    """转换为大写"""\n    return text.upper()',
                    inputs: ['text'],
                    outputs: ['result']
                },
                'greet': {
                    name: '问候',
                    code: 'def greet(name):\n    """生成问候语"""\n    return f"Hello, {name}!"',
                    inputs: ['name'],
                    outputs: ['message']
                },
                'reverse': {
                    name: '反转字符串',
                    code: 'def reverse(text):\n    """反转字符串"""\n    return text[::-1]',
                    inputs: ['text'],
                    outputs: ['result']
                }
            }
        },
        'list': {
            name: '列表操作',
            functions: {
                'sum_list': {
                    name: '列表求和',
                    code: 'def sum_list(arr):\n    """列表所有元素求和"""\n    return sum(arr)',
                    inputs: ['arr'],
                    outputs: ['total']
                },
                'double_list': {
                    name: '列表翻倍',
                    code: 'def double_list(arr):\n    """列表每个元素翻倍"""\n    return [x * 2 for x in arr]',
                    inputs: ['arr'],
                    outputs: ['result']
                }
            }
        }
    };
}

function buildFunctionTree() {
    const container = document.getElementById('function-tree');
    if (!container) {
        console.error('function-tree 元素未找到');
        return;
    }
    
    container.innerHTML = '';
    console.log('构建函数库，分类数:', Object.keys(functionLibrary).length);
    
    for (const [catKey, catData] of Object.entries(functionLibrary)) {
        const catDiv = document.createElement('div');
        catDiv.className = 'category';
        catDiv.style.marginBottom = '16px';
        
        const header = document.createElement('div');
        header.className = 'category-header';
        header.style.padding = '8px 12px';
        header.style.backgroundColor = '#313244';
        header.style.borderRadius = '6px';
        header.style.cursor = 'pointer';
        header.style.fontSize = '13px';
        header.style.fontWeight = 'bold';
        header.style.color = '#89b4fa';
        header.innerHTML = `📁 ${catData.name} <span style="font-size:10px;">(${Object.keys(catData.functions).length})</span>`;
        
        let visible = true;
        header.onclick = () => {
            visible = !visible;
            itemsDiv.style.display = visible ? 'block' : 'none';
        };
        
        const itemsDiv = document.createElement('div');
        itemsDiv.className = 'category-items';
        itemsDiv.style.marginLeft = '8px';
        itemsDiv.style.marginTop = '8px';
        itemsDiv.style.display = 'block';
        
        for (const [funcName, funcData] of Object.entries(catData.functions)) {
            const item = document.createElement('div');
            item.className = 'function-item';
            item.style.padding = '8px 12px';
            item.style.margin = '4px 0';
            item.style.backgroundColor = '#2a2a3c';
            item.style.borderRadius = '6px';
            item.style.cursor = 'grab';
            item.style.borderLeft = '3px solid #89b4fa';
            item.style.transition = 'all 0.2s';
            item.draggable = true;
            item.innerHTML = `
                <strong style="font-size:12px; display:block;">${escapeHtml(funcData.name)}</strong>
                <small style="font-size:10px; opacity:0.7;">${funcData.inputs.join(', ')} → ${funcData.outputs.join(', ')}</small>
            `;
            
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
    
    addLog(`📦 函数库加载完成，共 ${Object.keys(functionLibrary).length} 个分类`);
}

// ========== 画布初始化 ==========
function initCanvas() {
    const container = document.getElementById('react-flow');
    if (!container) {
        console.error('react-flow 元素未找到');
        return;
    }
    
    // 清空容器
    container.innerHTML = '';
    container.style.position = 'relative';
    container.style.overflow = 'auto';
    container.style.minHeight = '500px';
    container.style.background = '#1a1b26';
    
    // 拖拽放置
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });
    
    container.addEventListener('drop', (e) => {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const scrollLeft = container.scrollLeft;
        const scrollTop = container.scrollTop;
        const x = e.clientX - rect.left + scrollLeft - 110;
        const y = e.clientY - rect.top + scrollTop - 60;
        
        try {
            const funcData = JSON.parse(e.dataTransfer.getData('text/plain'));
            addNode(funcData, x, y);
        } catch (err) {
            console.error('拖拽失败:', err);
        }
    });
    
    // 点击画布取消连线
    container.addEventListener('click', (e) => {
        if (connectingFrom && !e.target.closest('.input-port')) {
            cancelConnection();
        }
    });
}

// ========== 节点操作 ==========
function addNode(funcData, x, y) {
    const nodeId = `node_${nodeIdCounter++}_${Date.now()}`;
    const node = {
        id: nodeId,
        position: { x: Math.max(20, x), y: Math.max(20, y) },
        data: {
            label: funcData.displayName,
            funcName: funcData.funcName,
            code: funcData.code,
            inputs: funcData.inputs || [],
            outputs: funcData.outputs || ['result'],
            inputValues: {},
            outputValue: null,
            isExecuting: false
        }
    };
    
    nodes.push(node);
    renderNodes();
    updateGeneratedCode();
    addLog(`➕ 添加节点: ${node.data.label}`);
}

function deleteNode(nodeId) {
    nodes = nodes.filter(n => n.id !== nodeId);
    connections = connections.filter(c => c.fromNodeId !== nodeId && c.toNodeId !== nodeId);
    renderNodes();
    updateGeneratedCode();
    addLog(`🗑️ 删除节点`);
}

// ========== 连线操作 ==========
function startConnection(nodeId, portName) {
    connectingFrom = { nodeId, portName };
    document.body.style.cursor = 'crosshair';
    addLog(`🔌 开始连线: ${portName}`);
}

function finishConnection(toNodeId, toPort) {
    if (!connectingFrom) return;
    
    if (connectingFrom.nodeId === toNodeId) {
        addLog('⚠️ 不能连接到自己');
        cancelConnection();
        return;
    }
    
    // 检查是否已存在
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
    
    // 检查循环依赖
    if (wouldCreateCycle(connectingFrom.nodeId, toNodeId)) {
        addLog('⚠️ 不能创建循环依赖');
        cancelConnection();
        return;
    }
    
    connections.push({
        fromNodeId: connectingFrom.nodeId,
        fromPort: connectingFrom.portName,
        toNodeId: toNodeId,
        toPort: toPort
    });
    
    addLog(`🔗 连接: ${connectingFrom.portName} → ${toPort}`);
    cancelConnection();
    renderNodes();
    updateGeneratedCode();
}

function cancelConnection() {
    connectingFrom = null;
    document.body.style.cursor = '';
}

function removeConnection(connIndex) {
    connections.splice(connIndex, 1);
    renderNodes();
    updateGeneratedCode();
    addLog(`🔗 删除连接`);
}

function wouldCreateCycle(fromNodeId, toNodeId) {
    const visited = new Set();
    const stack = [toNodeId];
    
    while (stack.length > 0) {
        const current = stack.pop();
        if (current === fromNodeId) return true;
        if (visited.has(current)) continue;
        visited.add(current);
        
        const outgoing = connections.filter(c => c.fromNodeId === current);
        for (const conn of outgoing) {
            stack.push(conn.toNodeId);
        }
    }
    return false;
}

// ========== 渲染节点 ==========
function renderNodes() {
    const container = document.getElementById('react-flow');
    if (!container) return;
    
    // 保存滚动位置
    const scrollLeft = container.scrollLeft;
    const scrollTop = container.scrollTop;
    
    container.innerHTML = '';
    
    // 渲染所有节点
    for (const node of nodes) {
        const nodeEl = createNodeElement(node);
        container.appendChild(nodeEl);
    }
    
    // 渲染连线
    renderConnections();
    
    // 恢复滚动位置
    container.scrollLeft = scrollLeft;
    container.scrollTop = scrollTop;
}

function createNodeElement(node) {
    const div = document.createElement('div');
    div.className = 'flow-node';
    div.setAttribute('data-node-id', node.id);
    div.style.position = 'absolute';
    div.style.left = `${node.position.x}px`;
    div.style.top = `${node.position.y}px`;
    div.style.minWidth = '240px';
    div.style.backgroundColor = '#2d2d3f';
    div.style.borderRadius = '10px';
    div.style.border = `2px solid ${node.data.isExecuting ? '#f9e45b' : '#89b4fa'}`;
    div.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    div.style.cursor = 'move';
    div.style.zIndex = '100';
    
    // 头部
    const header = document.createElement('div');
    header.style.padding = '10px 12px';
    header.style.backgroundColor = 'rgba(0,0,0,0.2)';
    header.style.borderRadius = '8px 8px 0 0';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.cursor = 'move';
    header.innerHTML = `
        <span style="color:#89b4fa; font-weight:bold;">🔷 ${escapeHtml(node.data.label)}</span>
        <button class="delete-node-btn" style="background:none; border:none; color:#f38ba8; cursor:pointer; font-size:16px; padding:0 4px;">✕</button>
    `;
    div.appendChild(header);
    
    // 内容
    const content = document.createElement('div');
    content.style.padding = '10px 12px';
    
    // 输入端口区域
    if (node.data.inputs && node.data.inputs.length > 0) {
        const inputsDiv = document.createElement('div');
        inputsDiv.style.marginBottom = '12px';
        inputsDiv.innerHTML = '<div style="font-size:10px; color:#6c7086; margin-bottom:6px;">📥 输入</div>';
        
        for (let i = 0; i < node.data.inputs.length; i++) {
            const input = node.data.inputs[i];
            const incomingConn = connections.find(c => c.toNodeId === node.id && c.toPort === input);
            
            const portDiv = document.createElement('div');
            portDiv.className = 'input-port';
            portDiv.style.display = 'flex';
            portDiv.style.alignItems = 'center';
            portDiv.style.margin = '4px 0';
            portDiv.style.padding = '4px 6px';
            portDiv.style.backgroundColor = '#24273a';
            portDiv.style.borderRadius = '4px';
            portDiv.style.borderLeft = '2px solid #a6e3a1';
            
            if (incomingConn) {
                portDiv.innerHTML = `
                    <div style="width:8px; height:8px; background:#a6e3a1; border-radius:50%; margin-right:8px;"></div>
                    <span style="font-size:11px; font-family:monospace; flex:1;">${escapeHtml(input)}</span>
                    <span style="font-size:10px; color:#6c7086;">← 已连接</span>
                `;
            } else {
                const currentVal = node.data.inputValues[input] !== undefined ? node.data.inputValues[input] : '';
                portDiv.innerHTML = `
                    <div style="width:8px; height:8px; background:#a6e3a1; border-radius:50%; margin-right:8px;"></div>
                    <span style="font-size:11px; font-family:monospace; width:50px;">${escapeHtml(input)}</span>
                    <input type="text" class="input-value" placeholder="值" value="${escapeHtml(String(currentVal))}" style="flex:1; background:#1a1b26; border:none; color:#cdd6f4; padding:2px 6px; border-radius:4px; font-size:11px; margin-left:8px;">
                `;
            }
            inputsDiv.appendChild(portDiv);
        }
        content.appendChild(inputsDiv);
    }
    
    // 输出端口区域
    if (node.data.outputs && node.data.outputs.length > 0) {
        const outputsDiv = document.createElement('div');
        outputsDiv.style.marginBottom = '8px';
        outputsDiv.innerHTML = '<div style="font-size:10px; color:#6c7086; margin-bottom:6px;">📤 输出</div>';
        
        for (let i = 0; i < node.data.outputs.length; i++) {
            const output = node.data.outputs[i];
            const portDiv = document.createElement('div');
            portDiv.className = 'output-port';
            portDiv.setAttribute('data-node-id', node.id);
            portDiv.setAttribute('data-port-name', output);
            portDiv.style.display = 'flex';
            portDiv.style.alignItems = 'center';
            portDiv.style.margin = '4px 0';
            portDiv.style.padding = '4px 6px';
            portDiv.style.backgroundColor = '#24273a';
            portDiv.style.borderRadius = '4px';
            portDiv.style.borderLeft = '2px solid #f38ba8';
            portDiv.style.cursor = 'pointer';
            portDiv.innerHTML = `
                <div style="width:8px; height:8px; background:#f38ba8; border-radius:50%; margin-right:8px;"></div>
                <span style="font-size:11px; font-family:monospace; flex:1;">${escapeHtml(output)}</span>
                <span class="output-value" style="font-size:10px; color:#a6e3a1; max-width:100px; overflow:hidden; text-overflow:ellipsis;">${node.data.outputValue !== null ? escapeHtml(String(node.data.outputValue).slice(0, 25)) : ''}</span>
            `;
            outputsDiv.appendChild(portDiv);
        }
        content.appendChild(outputsDiv);
    }
    
    // 底部按钮
    const footer = document.createElement('div');
    footer.style.padding = '8px 12px';
    footer.style.borderTop = '1px solid #313244';
    footer.innerHTML = `
        <button class="run-node-btn" style="width:100%; background:#313244; border:none; color:#cdd6f4; padding:5px; border-radius:4px; cursor:pointer; font-size:11px;">▶ 执行</button>
    `;
    content.appendChild(footer);
    div.appendChild(content);
    
    // 绑定事件
    const deleteBtn = header.querySelector('.delete-node-btn');
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        deleteNode(node.id);
    };
    
    const runBtn = footer.querySelector('.run-node-btn');
    runBtn.onclick = async (e) => {
        e.stopPropagation();
        await executeSingleNode(node);
        renderNodes();
        updateGeneratedCode();
    };
    
    // 输入框事件
    const inputFields = div.querySelectorAll('.input-value');
    inputFields.forEach((field, idx) => {
        const inputName = node.data.inputs[idx];
        field.onchange = (e) => {
            let val = e.target.value;
            if (!isNaN(val) && val !== '') val = Number(val);
            node.data.inputValues[inputName] = val;
            updateGeneratedCode();
        };
    });
    
    // 输出端口点击连线
    const outputPorts = div.querySelectorAll('.output-port');
    outputPorts.forEach(port => {
        port.onclick = (e) => {
            e.stopPropagation();
            const nodeId = port.getAttribute('data-node-id');
            const portName = port.getAttribute('data-port-name');
            startConnection(nodeId, portName);
        };
    });
    
    // 拖动功能
    makeDraggable(div, node);
    
    return div;
}

// 监听输入端口点击完成连线
document.addEventListener('click', (e) => {
    if (!connectingFrom) return;
    
    const inputPort = e.target.closest('.input-port');
    if (inputPort) {
        const nodeDiv = inputPort.closest('.flow-node');
        if (nodeDiv) {
            const nodeId = nodeDiv.getAttribute('data-node-id');
            const node = nodes.find(n => n.id === nodeId);
            if (node) {
                const inputsDiv = inputPort.parentElement;
                const inputIndex = Array.from(inputsDiv.querySelectorAll('.input-port')).indexOf(inputPort);
                if (inputIndex >= 0 && node.data.inputs[inputIndex]) {
                    finishConnection(nodeId, node.data.inputs[inputIndex]);
                }
            }
        }
    }
});

function makeDraggable(element, node) {
    let isDragging = false;
    let startX, startY, startLeft, startTop;
    
    const header = element.querySelector('.node-header') || element;
    
    header.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('delete-node-btn')) return;
        
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = node.position.x;
        startTop = node.position.y;
        element.style.zIndex = '1000';
        e.preventDefault();
    });
    
    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        node.position.x = startLeft + dx;
        node.position.y = startTop + dy;
        element.style.left = `${node.position.x}px`;
        element.style.top = `${node.position.y}px`;
        renderConnections();
    });
    
    window.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            element.style.zIndex = '';
            renderConnections();
            updateGeneratedCode();
        }
    });
}

// ========== 渲染连线 ==========
function renderConnections() {
    const container = document.getElementById('react-flow');
    if (!container) return;
    
    let svg = container.querySelector('.connections-svg');
    if (svg) svg.remove();
    
    const portPositions = getPortPositions();
    
    const svgNS = "http://www.w3.org/2000/svg";
    svg = document.createElementNS(svgNS, "svg");
    svg.classList.add('connections-svg');
    svg.style.position = "absolute";
    svg.style.top = "0";
    svg.style.left = "0";
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.pointerEvents = "none";
    svg.style.zIndex = "50";
    
    for (let i = 0; i < connections.length; i++) {
        const conn = connections[i];
        const startKey = `${conn.fromNodeId}|out|${conn.fromPort}`;
        const endKey = `${conn.toNodeId}|in|${conn.toPort}`;
        
        const start = portPositions[startKey];
        const end = portPositions[endKey];
        
        if (start && end) {
            const path = document.createElementNS(svgNS, "path");
            const midX = (start.x + end.x) / 2;
            const d = `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`;
            path.setAttribute("d", d);
            path.setAttribute("stroke", "#89b4fa");
            path.setAttribute("stroke-width", "2");
            path.setAttribute("fill", "none");
            path.style.pointerEvents = "visibleStroke";
            path.style.cursor = "pointer";
            
            path.addEventListener("dblclick", (e) => {
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
        const nodeEl = container.querySelector(`.flow-node[data-node-id="${node.id}"]`);
        if (!nodeEl) continue;
        
        const nodeRect = nodeEl.getBoundingClientRect();
        
        const outputPorts = nodeEl.querySelectorAll('.output-port');
        outputPorts.forEach(port => {
            const portName = port.getAttribute('data-port-name');
            const portRect = port.getBoundingClientRect();
            positions[`${node.id}|out|${portName}`] = {
                x: portRect.right - containerRect.left - 4,
                y: (portRect.top + portRect.bottom) / 2 - containerRect.top
            };
        });
        
        const inputPorts = nodeEl.querySelectorAll('.input-port');
        inputPorts.forEach((port, idx) => {
            const portName = node.data.inputs[idx];
            const portRect = port.getBoundingClientRect();
            positions[`${node.id}|in|${portName}`] = {
                x: portRect.left - containerRect.left + 4,
                y: (portRect.top + portRect.bottom) / 2 - containerRect.top
            };
        });
    }
    
    return positions;
}

// ========== 执行节点 ==========
async function executeSingleNode(node) {
    if (!pyodide) {
        addLog('❌ Python 运行时未就绪');
        return;
    }
    
    node.data.isExecuting = true;
    renderNodes();
    
    try {
        await pyodide.runPythonAsync(node.data.code);
        
        const args = [];
        for (const input of node.data.inputs) {
            const incomingConn = connections.find(c => c.toNodeId === node.id && c.toPort === input);
            if (incomingConn) {
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
        
        const argsStr = args.join(', ');
        const execCode = `
try:
    result = ${node.data.funcName}(${argsStr})
    result
except Exception as e:
    f"ERROR: {str(e)}"
        `;
        
        const output = await pyodide.runPythonAsync(execCode);
        if (typeof output === 'string' && output.startsWith('ERROR:')) {
            throw new Error(output.replace('ERROR: ', ''));
        }
        
        node.data.outputValue = output;
        addLog(`✅ ${node.data.label} = ${typeof output === 'object' ? JSON.stringify(output) : output}`);
        
    } catch (err) {
        node.data.outputValue = '错误';
        addLog(`❌ ${node.data.label} 失败: ${err.message}`);
    } finally {
        node.data.isExecuting = false;
    }
}

async function executeAllNodes() {
    if (!pyodide) {
        addLog('❌ Python 运行时未就绪');
        return;
    }
    
    const order = getTopologicalOrder();
    const results = {};
    
    addLog(`🚀 开始执行 ${order.length} 个节点`);
    
    for (const node of order) {
        const nodeEl = document.querySelector(`.flow-node[data-node-id="${node.id}"]`);
        if (nodeEl) nodeEl.style.borderColor = '#f9e45b';
        
        try {
            await pyodide.runPythonAsync(node.data.code);
            
            const args = [];
            for (const input of node.data.inputs) {
                const incomingConn = connections.find(c => c.toNodeId === node.id && c.toPort === input);
                if (incomingConn && results[incomingConn.fromNodeId] !== undefined) {
                    let val = results[incomingConn.fromNodeId];
                    if (typeof val === 'string') val = `"${val.replace(/"/g, '\\"')}"`;
                    args.push(val);
                } else if (incomingConn) {
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
            
            const argsStr = args.join(', ');
            const execCode = `
try:
    result = ${node.data.funcName}(${argsStr})
    result
except Exception as e:
    f"ERROR: {str(e)}"
            `;
            
            const output = await pyodide.runPythonAsync(execCode);
            if (typeof output === 'string' && output.startsWith('ERROR:')) {
                throw new Error(output.replace('ERROR: ', ''));
            }
            
            results[node.id] = output;
            node.data.outputValue = output;
            addLog(`✅ ${node.data.label} = ${typeof output === 'object' ? JSON.stringify(output) : output}`);
            
        } catch (err) {
            node.data.outputValue = '错误';
            addLog(`❌ ${node.data.label} 失败: ${err.message}`);
        }
        
        if (nodeEl) nodeEl.style.borderColor = '#89b4fa';
        await new Promise(r => setTimeout(r, 50));
    }
    
    renderNodes();
    addLog(`✨ 执行完成`);
}

function getTopologicalOrder() {
    const inDegree = {};
    const adjList = {};
    
    for (const node of nodes) {
        inDegree[node.id] = 0;
        adjList[node.id] = [];
    }
    
    for (const conn of connections) {
        adjList[conn.fromNodeId].push(conn.toNodeId);
        inDegree[conn.toNodeId]++;
    }
    
    const queue = [];
    for (const node of nodes) {
        if (inDegree[node.id] === 0) queue.push(node);
    }
    
    const order = [];
    while (queue.length > 0) {
        const node = queue.shift();
        order.push(node);
        
        for (const neighborId of adjList[node.id]) {
            inDegree[neighborId]--;
            if (inDegree[neighborId] === 0) {
                const neighborNode = nodes.find(n => n.id === neighborId);
                if (neighborNode) queue.push(neighborNode);
            }
        }
    }
    
    return order;
}

// ========== 代码生成 ==========
function generatePythonCode() {
    const lines = [];
    lines.push('#!/usr/bin/env python3');
    lines.push('# 由 Python 节点编辑器自动生成');
    lines.push('');
    
    const addedFuncs = new Set();
    for (const node of nodes) {
        if (!addedFuncs.has(node.data.funcName)) {
            addedFuncs.add(node.data.funcName);
            lines.push(node.data.code);
            lines.push('');
        }
    }
    
    lines.push('# ========== 主程序 ==========');
    lines.push('');
    
    const order = getTopologicalOrder();
    const results = {};
    
    for (const node of order) {
        const args = [];
        for (const input of node.data.inputs) {
            const incomingConn = connections.find(c => c.toNodeId === node.id && c.toPort === input);
            if (incomingConn && results[incomingConn.fromNodeId]) {
                args.push(results[incomingConn.fromNodeId]);
            } else if (incomingConn) {
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
        
        const varName = `_${node.data.funcName}_${node.id.slice(-4)}`;
        results[node.id] = varName;
        lines.push(`${varName} = ${node.data.funcName}(${args.join(', ')})`);
        lines.push(`print(f"${node.data.label}: {${varName}}")`);
        lines.push('');
    }
    
    return lines.join('\n');
}

function updateGeneratedCode() {
    const code = generatePythonCode();
    if (codeMirror) {
        codeMirror.setValue(code);
    }
}

// ========== 示例节点 ==========
function addExampleNodes() {
    if (!functionLibrary.math) return;
    
    const addFunc = functionLibrary.math.functions.add;
    const squareFunc = functionLibrary.math.functions.square;
    
    addNode({
        funcName: 'add',
        displayName: '加法',
        code: addFunc.code,
        inputs: addFunc.inputs,
        outputs: addFunc.outputs
    }, 100, 100);
    
    addNode({
        funcName: 'square',
        displayName: '平方',
        code: squareFunc.code,
        inputs: squareFunc.inputs,
        outputs: squareFunc.outputs
    }, 400, 150);
    
    addLog('📌 已添加示例节点，拖拽左侧函数可创建更多节点');
}

// ========== 工具函数 ==========
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function addLog(msg) {
    const logDiv = document.getElementById('output-log');
    if (!logDiv) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.style.padding = '4px 8px';
    entry.style.margin = '2px 0';
    entry.style.backgroundColor = '#24273a';
    entry.style.borderRadius = '4px';
    entry.style.borderLeft = '2px solid #89b4fa';
    entry.style.fontSize = '11px';
    entry.innerHTML = `<span style="color:#89b4fa;">[${new Date().toLocaleTimeString()}]</span> ${escapeHtml(msg)}`;
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;
    
    while (logDiv.children.length > 200) {
        logDiv.removeChild(logDiv.firstChild);
    }
}

function clearLogs() {
    const logDiv = document.getElementById('output-log');
    if (logDiv) logDiv.innerHTML = '';
}

function showExecutionOrder() {
    const order = getTopologicalOrder();
    const names = order.map(n => n.data.label).join(' → ');
    addLog(`📊 执行顺序: ${names || '无节点'}`);
}

async function copyCode() {
    const code = codeMirror ? codeMirror.getValue() : '';
    await navigator.clipboard.writeText(code);
    addLog('📋 代码已复制');
}

function downloadCode() {
    const code = codeMirror ? codeMirror.getValue() : '';
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `node_program_${new Date().toISOString().slice(0,19)}.py`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('💾 代码已下载');
}

function clearCanvas() {
    if (confirm('确定清空所有节点吗？')) {
        nodes = [];
        connections = [];
        renderNodes();
        updateGeneratedCode();
        addLog('🗑️ 画布已清空');
    }
}

function loadPyodide() {
    return new Promise((resolve, reject) => {
        if (window.loadPyodide) {
            window.loadPyodide({
                indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/"
            }).then(resolve).catch(reject);
        } else {
            const script = document.createElement('script');
            script.src = "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js";
            script.onload = () => {
                window.loadPyodide({
                    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/"
                }).then(resolve).catch(reject);
            };
            script.onerror = reject;
            document.head.appendChild(script);
        }
    });
}

// ========== 绑定 UI 事件 ==========
document.getElementById('clear-canvas')?.addEventListener('click', clearCanvas);
document.getElementById('run-all')?.addEventListener('click', executeAllNodes);
document.getElementById('toggle-exec-order')?.addEventListener('click', showExecutionOrder);
document.getElementById('copy-code')?.addEventListener('click', copyCode);
document.getElementById('download-code')?.addEventListener('click', downloadCode);
document.getElementById('clear-logs')?.addEventListener('click', clearLogs);
document.getElementById('refresh-functions')?.addEventListener('click', () => {
    buildFunctionTree();
    addLog('🔄 函数库已刷新');
});
