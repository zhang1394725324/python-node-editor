// ========== 全局变量 ==========
let pyodide = null;
let nodes = [];
let connections = [];
let functionLibrary = {};
let codeMirror = null;
let showExecOrder = false;
let isDraggingNode = false;
let currentDragNode = null;
let dragOffsetX = 0, dragOffsetY = 0;

// ========== 初始化 ==========
window.addEventListener('DOMContentLoaded', async () => {
    console.log('初始化节点编辑器...');
    document.getElementById('exec-status').textContent = '⏳ 加载 Python 运行时...';
    
    // 初始化 CodeMirror
    codeMirror = CodeMirror.fromTextArea(document.getElementById('code-editor'), {
        mode: 'python',
        theme: 'monokai',
        lineNumbers: true,
        readOnly: true,
        lineWrapping: true
    });
    
    // 加载 Pyodide
    pyodide = await loadPyodide();
    await pyodide.loadPackage(['numpy']);
    
    document.getElementById('exec-status').textContent = '⏳ 加载函数库...';
    
    // 加载函数库
    await loadAllFunctions();
    
    document.getElementById('exec-status').textContent = '✅ 就绪';
    
    // 初始化画布
    initCanvas();
    
    // 添加示例节点
    addExampleNodes();
    
    // 更新代码
    updateGeneratedCode();
});

// ========== 监听变化，实时更新代码 ==========
function updateGeneratedCode() {
    const code = generatePythonCode();
    if (codeMirror) {
        codeMirror.setValue(code);
    }
}

// ========== 生成 Python 代码 ==========
function generatePythonCode() {
    const lines = [];
    lines.push('#!/usr/bin/env python3');
    lines.push('# -*- coding: utf-8 -*-');
    lines.push('# 由 Python 节点编辑器自动生成');
    lines.push('');
    lines.push('import math');
    lines.push('');
    
    // 收集已输出的函数名，避免重复
    const addedFunctions = new Set();
    
    // 为每个节点生成函数定义
    for (const node of nodes) {
        if (node.data.code && !addedFunctions.has(node.data.funcName)) {
            addedFunctions.add(node.data.funcName);
            lines.push(node.data.code);
            lines.push('');
        }
    }
    
    lines.push('# ========== 主执行流程 ==========');
    lines.push('');
    
    // 获取拓扑排序的执行顺序
    const order = getTopologicalOrder();
    
    // 存储每个节点的输出变量名
    const nodeOutputVars = {};
    
    for (const nodeId of order) {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) continue;
        
        const outputVar = `_out_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
        nodeOutputVars[nodeId] = outputVar;
        
        // 构建函数调用
        const funcName = node.data.funcName;
        const inputs = node.data.inputs || [];
        
        const argValues = [];
        for (const input of inputs) {
            // 检查是否有连接指向这个输入
            const incomingConn = connections.find(c => c.toNodeId === nodeId && c.toPort === input);
            
            if (incomingConn) {
                // 来自其他节点的输出
                const fromVar = nodeOutputVars[incomingConn.fromNodeId];
                if (fromVar) {
                    argValues.push(fromVar);
                } else {
                    argValues.push('None');
                }
            } else {
                // 手动输入的值
                let val = node.data.inputValues?.[input];
                if (val === undefined || val === '') {
                    argValues.push('None');
                } else if (typeof val === 'string') {
                    // 尝试解析数字
                    const num = parseFloat(val);
                    if (!isNaN(num) && val.trim() !== '') {
                        argValues.push(num);
                    } else {
                        argValues.push(`"${val.replace(/"/g, '\\"')}"`);
                    }
                } else {
                    argValues.push(val);
                }
            }
        }
        
        lines.push(`# 执行节点: ${node.data.label}`);
        lines.push(`${outputVar} = ${funcName}(${argValues.join(', ')})`);
        lines.push(`print(f"  ${node.data.label}: {${outputVar}}")`);
        lines.push('');
    }
    
    if (order.length === 0) {
        lines.push('print("没有节点需要执行")');
    }
    
    return lines.join('\n');
}

// ========== 拓扑排序（确定执行顺序）==========
function getTopologicalOrder() {
    const inDegree = {};
    const adjList = {};
    
    // 初始化
    for (const node of nodes) {
        inDegree[node.id] = 0;
        adjList[node.id] = [];
    }
    
    // 构建依赖图
    for (const conn of connections) {
        if (adjList[conn.fromNodeId]) {
            adjList[conn.fromNodeId].push(conn.toNodeId);
        }
        if (inDegree[conn.toNodeId] !== undefined) {
            inDegree[conn.toNodeId]++;
        }
    }
    
    // Kahn 算法
    const queue = [];
    for (const nodeId of Object.keys(inDegree)) {
        if (inDegree[nodeId] === 0) {
            queue.push(nodeId);
        }
    }
    
    const order = [];
    while (queue.length > 0) {
        const nodeId = queue.shift();
        order.push(nodeId);
        
        for (const neighbor of adjList[nodeId] || []) {
            inDegree[neighbor]--;
            if (inDegree[neighbor] === 0) {
                queue.push(neighbor);
            }
        }
    }
    
    // 如果有循环依赖，返回原始顺序
    if (order.length !== nodes.length) {
        return nodes.map(n => n.id);
    }
    
    return order;
}

// ========== 执行所有节点 ==========
async function executeAllNodes() {
    const order = getTopologicalOrder();
    const nodeOutputs = {};
    
    addLog(`🚀 开始执行 ${order.length} 个节点`);
    
    for (const nodeId of order) {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) continue;
        
        highlightNode(nodeId, true);
        
        try {
            await executeNode(node, nodeOutputs);
            addLog(`✅ ${node.data.label} 完成`);
        } catch (err) {
            addLog(`❌ ${node.data.label} 失败: ${err.message}`);
        }
        
        highlightNode(nodeId, false);
        await new Promise(r => setTimeout(r, 100));
    }
    
    renderNodes();
    addLog(`✨ 执行完成`);
}

async function executeNode(node, contextOutputs = {}) {
    node.data.isExecuting = true;
    renderNodes();
    
    try {
        const funcName = node.data.funcName;
        const inputs = node.data.inputs || [];
        
        const argValues = [];
        for (const input of inputs) {
            const incomingConn = connections.find(c => c.toNodeId === node.id && c.toPort === input);
            
            if (incomingConn && contextOutputs[incomingConn.fromNodeId] !== undefined) {
                argValues.push(contextOutputs[incomingConn.fromNodeId]);
            } else if (incomingConn) {
                argValues.push('None');
            } else {
                let val = node.data.inputValues?.[input];
                if (val === undefined || val === '') {
                    argValues.push('None');
                } else {
                    argValues.push(val);
                }
            }
        }
        
        // 确保函数已注册
        await pyodide.runPythonAsync(node.data.code);
        
        const argsStr = argValues.map(v => {
            if (typeof v === 'string') return `"${v.replace(/"/g, '\\"')}"`;
            return String(v);
        }).join(', ');
        
        const execCode = `
try:
    result = ${funcName}(${argsStr})
    result
except Exception as e:
    f"ERROR: {str(e)}"
        `;
        
        const output = await pyodide.runPythonAsync(execCode);
        if (typeof output === 'string' && output.startsWith('ERROR:')) {
            throw new Error(output.replace('ERROR: ', ''));
        }
        
        contextOutputs[node.id] = output;
        node.data.outputValue = output;
        
    } catch (err) {
        node.data.outputValue = `错误`;
        throw err;
    } finally {
        node.data.isExecuting = false;
    }
}

// ========== 画布初始化 ==========
function initCanvas() {
    const container = document.getElementById('react-flow');
    
    // 清空容器
    container.innerHTML = '';
    
    // 拖拽放置
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });
    
    container.addEventListener('drop', (e) => {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left - 110;
        const y = e.clientY - rect.top - 60;
        
        try {
            const funcData = JSON.parse(e.dataTransfer.getData('text/plain'));
            addNode(funcData, x, y);
        } catch (err) {
            console.error('拖拽解析失败:', err);
        }
    });
}

function addNode(funcData, x, y) {
    const nodeId = `node_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
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
            isExecuting: false,
            description: funcData.description || ''
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

function addConnection(fromNodeId, fromPort, toNodeId, toPort) {
    // 检查是否已存在相同连接
    const exists = connections.some(c => c.fromNodeId === fromNodeId && c.fromPort === fromPort && 
                                         c.toNodeId === toNodeId && c.toPort === toPort);
    if (exists) return;
    
    // 检查是否形成循环
    if (wouldCreateCycle(fromNodeId, toNodeId)) {
        addLog('⚠️ 不能创建循环依赖');
        return;
    }
    
    connections.push({ fromNodeId, fromPort, toNodeId, toPort });
    renderNodes();
    updateGeneratedCode();
    addLog(`🔗 连接: ${fromNodeId.slice(-6)}.${fromPort} → ${toNodeId.slice(-6)}.${toPort}`);
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

function removeConnection(fromNodeId, fromPort, toNodeId, toPort) {
    connections = connections.filter(c => !(c.fromNodeId === fromNodeId && c.fromPort === fromPort &&
                                           c.toNodeId === toNodeId && c.toPort === toPort));
    renderNodes();
    updateGeneratedCode();
    addLog(`🔗 删除连接`);
}

function highlightNode(nodeId, highlight) {
    const nodeEl = document.querySelector(`.flow-node[data-node-id="${nodeId}"]`);
    if (nodeEl) {
        if (highlight) {
            nodeEl.classList.add('executing');
        } else {
            nodeEl.classList.remove('executing');
        }
    }
}

// ========== 渲染节点和连线 ==========
function renderNodes() {
    const container = document.getElementById('react-flow');
    if (!container) return;
    
    // 保存滚动位置
    const scrollLeft = container.scrollLeft;
    const scrollTop = container.scrollTop;
    
    container.innerHTML = '';
    
    // 确保容器有相对定位
    container.style.position = 'relative';
    container.style.minHeight = '100%';
    
    // 渲染所有节点
    for (const node of nodes) {
        const nodeDiv = createNodeElement(node);
        container.appendChild(nodeDiv);
    }
    
    // 渲染连线
    renderConnections(container);
    
    // 恢复滚动位置
    container.scrollLeft = scrollLeft;
    container.scrollTop = scrollTop;
    
    // 显示执行顺序
    if (showExecOrder) {
        const order = getTopologicalOrder();
        addLog(`📊 执行顺序: ${order.map(id => nodes.find(n=>n.id===id)?.data.label || '?').join(' → ')}`);
        showExecOrder = false;
    }
}

function createNodeElement(node) {
    const div = document.createElement('div');
    div.className = 'flow-node';
    div.setAttribute('data-node-id', node.id);
    div.style.position = 'absolute';
    div.style.left = `${node.position.x}px`;
    div.style.top = `${node.position.y}px`;
    div.style.minWidth = '220px';
    div.style.backgroundColor = '#2d2d3f';
    div.style.borderRadius = '10px';
    div.style.border = `2px solid ${node.data.isExecuting ? '#f9e45b' : '#89b4fa'}`;
    div.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    div.style.cursor = 'move';
    
    // 头部
    const header = document.createElement('div');
    header.className = 'node-header';
    header.style.padding = '10px 12px';
    header.style.backgroundColor = 'rgba(0,0,0,0.2)';
    header.style.borderRadius = '8px 8px 0 0';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.cursor = 'move';
    header.innerHTML = `
        <span style="color:#89b4fa; font-weight:bold;">🔷 ${node.data.label}</span>
        <button class="delete-node-btn" style="background:none; border:none; color:#f38ba8; cursor:pointer; font-size:16px;" title="删除">✕</button>
    `;
    div.appendChild(header);
    
    // 内容
    const content = document.createElement('div');
    content.style.padding = '10px 12px';
    
    // 输入端口
    if (node.data.inputs && node.data.inputs.length > 0) {
        const inputsDiv = document.createElement('div');
        inputsDiv.style.marginBottom = '12px';
        inputsDiv.innerHTML = '<div style="font-size:10px; color:#6c7086; margin-bottom:6px;">📥 输入</div>';
        
        for (const input of node.data.inputs) {
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
                    <span style="font-size:11px; font-family:monospace;">${input}</span>
                    <span style="margin-left:auto; font-size:10px; color:#6c7086;">← 已连接</span>
                `;
            } else {
                portDiv.innerHTML = `
                    <div style="width:8px; height:8px; background:#a6e3a1; border-radius:50%; margin-right:8px;"></div>
                    <span style="font-size:11px; font-family:monospace;">${input}</span>
                    <input class="input-value" type="text" placeholder="值" value="${node.data.inputValues?.[input] || ''}" style="margin-left:auto; width:80px; background:#1a1b26; border:none; color:#cdd6f4; padding:2px 6px; border-radius:4px; font-size:11px;">
                `;
            }
            inputsDiv.appendChild(portDiv);
        }
        content.appendChild(inputsDiv);
    }
    
    // 输出端口
    if (node.data.outputs && node.data.outputs.length > 0) {
        const outputsDiv = document.createElement('div');
        outputsDiv.style.marginBottom = '12px';
        outputsDiv.innerHTML = '<div style="font-size:10px; color:#6c7086; margin-bottom:6px;">📤 输出</div>';
        
        for (const output of node.data.outputs) {
            const portDiv = document.createElement('div');
            portDiv.className = 'output-port';
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
                <span style="font-size:11px; font-family:monospace;">${output}</span>
                <span class="output-value" style="margin-left:auto; font-size:10px; color:#a6e3a1;">${node.data.outputValue !== null ? String(node.data.outputValue).slice(0, 20) : '📤'}</span>
            `;
            outputsDiv.appendChild(portDiv);
        }
        content.appendChild(outputsDiv);
    }
    
    // 底部按钮
    const footer = document.createElement('div');
    footer.style.padding = '8px 12px';
    footer.style.borderTop = '1px solid #313244';
    footer.style.display = 'flex';
    footer.style.gap = '8px';
    footer.innerHTML = `
        <button class="run-node-btn" style="flex:1; background:#313244; border:none; color:#cdd6f4; padding:4px; border-radius:4px; cursor:pointer;">▶ 执行</button>
    `;
    div.appendChild(content);
    div.appendChild(footer);
    
    // 事件绑定
    const deleteBtn = header.querySelector('.delete-node-btn');
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        deleteNode(node.id);
    };
    
    const runBtn = footer.querySelector('.run-node-btn');
    runBtn.onclick = async (e) => {
        e.stopPropagation();
        await executeNode(node, {});
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
    
    // 输出端口点击（开始连线）
    const outputPorts = div.querySelectorAll('.output-port');
    outputPorts.forEach((port, idx) => {
        port.onclick = (e) => {
            e.stopPropagation();
            startConnection(node.id, node.data.outputs[idx]);
        };
    });
    
    // 拖动
    makeDraggable(div, node);
    
    return div;
}

// 连线功能
let connectionStart = null;

function startConnection(nodeId, portName) {
    connectionStart = { fromNodeId: nodeId, fromPort: portName };
    addLog(`🔌 开始连线: ${nodeId.slice(-6)}.${portName}`);
    document.body.style.cursor = 'crosshair';
}

function finishConnection(toNodeId, toPort) {
    if (connectionStart && connectionStart.fromNodeId !== toNodeId) {
        addConnection(connectionStart.fromNodeId, connectionStart.fromPort, toNodeId, toPort);
    }
    connectionStart = null;
    document.body.style.cursor = '';
}

function cancelConnection() {
    connectionStart = null;
    document.body.style.cursor = '';
}

function renderConnections(container) {
    // 获取所有节点的位置
    const nodeRects = {};
    for (const node of nodes) {
        const nodeEl = container.querySelector(`.flow-node[data-node-id="${node.id}"]`);
        if (nodeEl) {
            const rect = nodeEl.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            nodeRects[node.id] = {
                left: rect.left - containerRect.left,
                top: rect.top - containerRect.top,
                right: rect.right - containerRect.left,
                bottom: rect.bottom - containerRect.top,
                width: rect.width,
                height: rect.height
            };
        }
    }
    
    // 获取端口位置
    const portPositions = {};
    for (const node of nodes) {
        const nodeEl = container.querySelector(`.flow-node[data-node-id="${node.id}"]`);
        if (nodeEl) {
            const outputPorts = nodeEl.querySelectorAll('.output-port');
            outputPorts.forEach((port, idx) => {
                const portName = node.data.outputs[idx];
                const portRect = port.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                portPositions[`${node.id}|out|${portName}`] = {
                    x: portRect.right - containerRect.left - 4,
                    y: (portRect.top + portRect.bottom) / 2 - containerRect.top
                };
            });
            
            const inputPorts = nodeEl.querySelectorAll('.input-port');
            inputPorts.forEach((port, idx) => {
                const portName = node.data.inputs[idx];
                const portRect = port.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                portPositions[`${node.id}|in|${portName}`] = {
                    x: portRect.left - containerRect.left + 4,
                    y: (portRect.top + portRect.bottom) / 2 - containerRect.top
                };
            });
        }
    }
    
    // 创建 SVG
    const svgNS = "http://www.w3.org/2000/svg";
    let svg = container.querySelector('.connections-svg');
    if (svg) svg.remove();
    
    svg = document.createElementNS(svgNS, "svg");
    svg.classList.add('connections-svg');
    svg.style.position = "absolute";
    svg.style.top = "0";
    svg.style.left = "0";
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.pointerEvents = "none";
    svg.style.zIndex = "10";
    
    for (const conn of connections) {
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
            path.style.cursor = "pointer";
            path.style.pointerEvents = "visibleStroke";
            
            path.addEventListener("dblclick", (e) => {
                e.stopPropagation();
                removeConnection(conn.fromNodeId, conn.fromPort, conn.toNodeId, conn.toPort);
            });
            
            svg.appendChild(path);
        }
    }
    
    container.appendChild(svg);
}

function makeDraggable(element, node) {
    let startX, startY, startLeft, startTop;
    
    const header = element.querySelector('.node-header');
    
    header.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('delete-node-btn')) return;
        
        startX = e.clientX;
        startY = e.clientY;
        startLeft = node.position.x;
        startTop = node.position.y;
        
        element.style.zIndex = '1000';
        
        const onMouseMove = (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            node.position.x = startLeft + dx;
            node.position.y = startTop + dy;
            element.style.left = `${node.position.x}px`;
            element.style.top = `${node.position.y}px`;
            
            // 重新绘制连线
            const container = document.getElementById('react-flow');
            renderConnections(container);
        };
        
        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            element.style.zIndex = '';
            updateGeneratedCode();
        };
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
    });
}

// ========== 输入端口点击接收连线 ==========
document.addEventListener('click', (e) => {
    if (!connectionStart) return;
    
    const inputPort = e.target.closest('.input-port');
    if (inputPort) {
        const nodeDiv = inputPort.closest('.flow-node');
        if (nodeDiv) {
            const nodeId = nodeDiv.getAttribute('data-node-id');
            const node = nodes.find(n => n.id === nodeId);
            if (node) {
                // 找到对应的输入端口名
                const inputIndex = Array.from(inputPort.parentElement.querySelectorAll('.input-port')).indexOf(inputPort);
                if (inputIndex >= 0 && node.data.inputs[inputIndex]) {
                    finishConnection(nodeId, node.data.inputs[inputIndex]);
                }
            }
        }
    } else {
        cancelConnection();
    }
});

// ========== 日志 ==========
function addLog(message) {
    const logDiv = document.getElementById('output-log');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.style.padding = '4px 8px';
    entry.style.margin = '2px 0';
    entry.style.backgroundColor = '#24273a';
    entry.style.borderRadius = '4px';
    entry.style.borderLeft = '2px solid #89b4fa';
    entry.style.fontSize = '11px';
    entry.innerHTML = `<span style="color:#89b4fa;">[${new Date().toLocaleTimeString()}]</span> ${message}`;
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;
    
    while (logDiv.children.length > 200) {
        logDiv.removeChild(logDiv.firstChild);
    }
}

function clearLogs() {
    document.getElementById('output-log').innerHTML = '';
}

// ========== 函数库 ==========
async function loadAllFunctions() {
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
                }
            }
        }
    };
    
    buildFunctionTree();
    addLog('📦 函数库加载完成');
}

function buildFunctionTree() {
    const container = document.getElementById('function-tree');
    container.innerHTML = '';
    
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
        
        for (const [funcName, funcData] of Object.entries(catData.functions)) {
            const item = document.createElement('div');
            item.className = 'function-item';
            item.style.padding = '8px 12px';
            item.style.margin = '4px 0';
            item.style.backgroundColor = '#2a2a3c';
            item.style.borderRadius = '6px';
            item.style.cursor = 'grab';
            item.style.borderLeft = '3px solid #89b4fa';
            item.draggable = true;
            item.innerHTML = `
                <strong style="font-size:12px;">${funcData.name}</strong>
                <small style="display:block; font-size:10px; opacity:0.7;">${(funcData.inputs || []).join(', ')} → ${(funcData.outputs || ['result']).join(', ')}</small>
            `;
            
            item.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({
                    funcName: funcName,
                    displayName: funcData.name,
                    code: funcData.code,
                    inputs: funcData.inputs,
                    outputs: funcData.outputs,
                    description: funcData.description || ''
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

function addExampleNodes() {
    // 添加两个示例节点
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
    
    addLog('📌 已添加示例节点');
}

// ========== UI 事件绑定 ==========
function displayExecOrder() {
    const order = getTopologicalOrder();
    const orderText = order.map((id, i) => {
        const node = nodes.find(n => n.id === id);
        return `${i+1}. ${node?.data.label || '?'}`;
    }).join(' → ');
    addLog(`📊 执行顺序: ${orderText}`);
}

async function downloadCode() {
    const code = codeMirror.getValue();
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `node_program_${new Date().toISOString().slice(0,19)}.py`;
    a.click();
    URL.revokeObjectURL(url);
    addLog(`💾 代码已下载`);
}

async function copyCode() {
    const code = codeMirror.getValue();
    await navigator.clipboard.writeText(code);
    addLog(`📋 代码已复制`);
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

// ========== 绑定 UI 按钮 ==========
document.getElementById('clear-canvas')?.addEventListener('click', () => {
    if (confirm('确定清空所有节点吗？')) {
        nodes = [];
        connections = [];
        renderNodes();
        updateGeneratedCode();
        addLog('🗑️ 画布已清空');
    }
});

document.getElementById('run-all')?.addEventListener('click', async () => {
    await executeAllNodes();
    updateGeneratedCode();
});

document.getElementById('toggle-exec-order')?.addEventListener('click', () => {
    displayExecOrder();
});

document.getElementById('copy-code')?.addEventListener('click', copyCode);
document.getElementById('download-code')?.addEventListener('click', downloadCode);
document.getElementById('clear-logs')?.addEventListener('click', clearLogs);
document.getElementById('refresh-functions')?.addEventListener('click', async () => {
    await loadAllFunctions();
    addLog('🔄 函数库已刷新');
});
