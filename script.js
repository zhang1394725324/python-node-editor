// ========== 全局变量 ==========
let pyodide = null;
let nodes = [];
let connections = [];  // { fromNodeId, fromPort, toNodeId, toPort }
let functionLibrary = {};
let currentDraggingConnection = null;
let execOrder = [];
let nestedEditingNode = null;  // 当前正在编辑的嵌套节点
let codeMirror = null;

// 执行顺序显示状态
let showExecOrder = false;

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
    
    // 示例节点
    addExampleNodes();
    
    // 监听变化，实时更新代码
    watchForChanges();
});

// ========== 监听变化，实时更新代码 ==========
function watchForChanges() {
    // 使用 MutationObserver 或定期检查（简化：每次操作后手动调用）
    // 主要操作都会调用 updateGeneratedCode
}

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
    
    // 收集所有需要导入的模块
    lines.push('import math');
    lines.push('import json');
    lines.push('');
    
    // 为每个节点生成函数定义
    for (const node of nodes) {
        if (node.data.isNested) {
            // 嵌套节点：展开内部逻辑
            lines.push(generateNestedNodeCode(node));
        } else {
            // 普通节点：直接使用其代码
            lines.push(node.data.code);
            lines.push('');
        }
    }
    
    lines.push('');
    lines.push('# ========== 主执行流程 ==========');
    lines.push('');
    
    // 获取拓扑排序的执行顺序
    const order = getTopologicalOrder();
    
    // 存储每个节点的输出变量名
    const nodeOutputVars = {};
    
    for (const nodeId of order) {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) continue;
        
        const outputVar = `_node_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
        nodeOutputVars[nodeId] = outputVar;
        
        // 构建函数调用
        const funcName = node.data.funcName || node.data.label;
        const inputs = node.data.inputs || [];
        
        const argValues = [];
        for (const input of inputs) {
            // 检查是否有连接指向这个输入
            const incomingConn = connections.find(c => c.toNodeId === nodeId && c.toPort === input);
            
            if (incomingConn) {
                // 来自其他节点的输出
                const fromNode = nodes.find(n => n.id === incomingConn.fromNodeId);
                if (fromNode) {
                    const fromVar = nodeOutputVars[incomingConn.fromNodeId];
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
                    argValues.push(`"${val.replace(/"/g, '\\"')}"`);
                } else {
                    argValues.push(JSON.stringify(val));
                }
            }
        }
        
        lines.push(`# 执行节点: ${node.data.label}`);
        lines.push(`${outputVar} = ${funcName}(${argValues.join(', ')})`);
        lines.push(`print(f"${node.data.label}: {${outputVar}}")`);
        lines.push('');
    }
    
    // 添加最终输出
    lines.push('# ========== 最终结果 ==========');
    if (order.length > 0) {
        const lastNode = nodes.find(n => n.id === order[order.length - 1]);
        if (lastNode) {
            const lastVar = nodeOutputVars[order[order.length - 1]];
            lines.push(`print(f"\\n最终结果: {${lastVar}}")`);
        }
    }
    
    return lines.join('\n');
}

// 生成嵌套节点的代码
function generateNestedNodeCode(node) {
    const lines = [];
    const subNodes = node.data.subNodes || [];
    const subConnections = node.data.subConnections || [];
    const nestedInputs = node.data.nestedInputs || [];
    const nestedOutputs = node.data.nestedOutputs || [];
    
    lines.push(`def ${node.data.funcName || node.data.label}(`);
    lines.push(`    ${nestedInputs.map(inp => inp.name).join(', ')}`);
    lines.push(`):`);
    lines.push(`    """${node.data.description || '嵌套节点'}"""`);
    lines.push('');
    
    // 存储子节点输出
    const subOutputVars = {};
    
    for (const subNode of subNodes) {
        const subOutputVar = `_sub_${subNode.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
        subOutputVars[subNode.id] = subOutputVar;
        
        const subInputs = subNode.data.inputs || [];
        const argValues = [];
        
        for (const subInput of subInputs) {
            const incomingConn = subConnections.find(c => c.toNodeId === subNode.id && c.toPort === subInput);
            
            if (incomingConn) {
                if (incomingConn.fromNodeId === 'nested_input') {
                    // 来自嵌套节点的输入端口
                    const inputIndex = nestedInputs.findIndex(inp => inp.name === incomingConn.fromPort);
                    if (inputIndex >= 0) {
                        argValues.push(nestedInputs[inputIndex].name);
                    } else {
                        argValues.push('None');
                    }
                } else {
                    const fromVar = subOutputVars[incomingConn.fromNodeId];
                    argValues.push(fromVar || 'None');
                }
            } else {
                argValues.push('None');
            }
        }
        
        lines.push(`    # 子节点: ${subNode.data.label}`);
        lines.push(`    ${subOutputVar} = ${subNode.data.funcName || subNode.data.label}(${argValues.join(', ')})`);
    }
    
    // 收集输出
    for (const output of nestedOutputs) {
        const conn = subConnections.find(c => c.fromNodeId === 'nested_output' && c.fromPort === output.name);
        if (conn) {
            const outputVar = subOutputVars[conn.toNodeId];
            if (outputVar) {
                lines.push(`    ${output.name} = ${outputVar}`);
            }
        }
    }
    
    // 返回值
    if (nestedOutputs.length === 1) {
        lines.push(`    return ${nestedOutputs[0].name}`);
    } else if (nestedOutputs.length > 1) {
        lines.push(`    return (${nestedOutputs.map(o => o.name).join(', ')})`);
    } else {
        lines.push(`    return None`);
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
        console.warn('检测到循环依赖');
        return nodes.map(n => n.id);
    }
    
    return order;
}

// ========== 执行节点（按拓扑顺序）==========
async function executeAllNodes() {
    const order = getTopologicalOrder();
    const nodeOutputs = {};
    
    addLog(`🚀 开始执行 ${order.length} 个节点 (拓扑顺序)`);
    
    for (const nodeId of order) {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) continue;
        
        // 高亮当前执行的节点
        highlightNode(nodeId, true);
        
        try {
            await executeNode(node, nodeOutputs);
            addLog(`✅ ${node.data.label} 执行完成`);
        } catch (err) {
            addLog(`❌ ${node.data.label} 失败: ${err.message}`);
        }
        
        highlightNode(nodeId, false);
        await new Promise(r => setTimeout(r, 100));
    }
    
    addLog(`✨ 全部执行完成`);
}

async function executeNode(node, contextOutputs = {}) {
    node.data.isExecuting = true;
    renderNodes();
    
    try {
        const funcName = node.data.funcName || node.data.label;
        const inputs = node.data.inputs || [];
        
        const argValues = [];
        for (const input of inputs) {
            const incomingConn = connections.find(c => c.toNodeId === node.id && c.toPort === input);
            
            if (incomingConn) {
                // 从 contextOutputs 获取值
                const fromNode = nodes.find(n => n.id === incomingConn.fromNodeId);
                if (fromNode && contextOutputs[incomingConn.fromNodeId] !== undefined) {
                    argValues.push(contextOutputs[incomingConn.fromNodeId]);
                } else {
                    argValues.push('None');
                }
            } else {
                let val = node.data.inputValues?.[input];
                if (val === undefined || val === '') {
                    argValues.push('None');
                } else if (typeof val === 'string' && !isNaN(val)) {
                    argValues.push(Number(val));
                } else if (typeof val === 'string') {
                    argValues.push(`"${val.replace(/"/g, '\\"')}"`);
                } else {
                    argValues.push(val);
                }
            }
        }
        
        // 处理嵌套节点
        let result;
        if (node.data.isNested) {
            const nestedCode = generateNestedNodeCode(node);
            await pyodide.runPythonAsync(nestedCode);
            const argsStr = argValues.map(v => {
                if (typeof v === 'string' && v.startsWith('"')) return v;
                return JSON.stringify(v);
            }).join(', ');
            const execCode = `result = ${funcName}(${argsStr})`;
            await pyodide.runPythonAsync(execCode);
            result = await pyodide.runPythonAsync('result');
        } else {
            // 确保函数已注册
            await pyodide.runPythonAsync(node.data.code);
            const argsStr = argValues.map(v => {
                if (typeof v === 'string' && v.startsWith('"')) return v;
                if (typeof v === 'string') return `"${v}"`;
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
            result = output;
        }
        
        contextOutputs[node.id] = result;
        node.data.outputValue = result;
        
    } catch (err) {
        node.data.outputValue = null;
        throw err;
    } finally {
        node.data.isExecuting = false;
    }
}

// ========== 画布操作 ==========
function initCanvas() {
    const container = document.getElementById('react-flow');
    
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
    
    // 监听连线相关的事件
    setupConnectionDrawing();
}

function setupConnectionDrawing() {
    // 使用全局监听来模拟连线绘制
    document.body.addEventListener('click', (e) => {
        const portEl = e.target.closest('.input-port, .output-port');
        if (!portEl) return;
        
        const portType = portEl.classList.contains('input-port') ? 'input' : 'output';
        const nodeId = portEl.closest('.flow-node')?.dataset?.nodeId;
        const portName = portEl.querySelector('.port-name')?.textContent || 
                         portEl.textContent.trim().split(' ')[0];
        
        if (!nodeId) return;
        
        if (currentDraggingConnection === null && portType === 'output') {
            // 开始拖拽连线
            currentDraggingConnection = { fromNodeId: nodeId, fromPort: portName };
            portEl.style.opacity = '0.6';
        } else if (currentDraggingConnection && portType === 'input') {
            // 完成连线
            addConnection(currentDraggingConnection.fromNodeId, currentDraggingConnection.fromPort, nodeId, portName);
            currentDraggingConnection = null;
            document.querySelectorAll('.output-port').forEach(p => p.style.opacity = '');
        } else if (currentDraggingConnection && portType === 'output') {
            // 取消连线
            currentDraggingConnection = null;
            document.querySelectorAll('.output-port').forEach(p => p.style.opacity = '');
        }
    });
}

function addConnection(fromNodeId, fromPort, toNodeId, toPort) {
    // 检查是否已存在相同连接
    const exists = connections.some(c => c.fromNodeId === fromNodeId && c.fromPort === fromPort && 
                                         c.toNodeId === toNodeId && c.toPort === toPort);
    if (exists) return;
    
    // 检查是否形成循环
    if (wouldCreateCycle(fromNodeId, toNodeId)) {
        addLog('⚠️ 不能创建循环依赖的连接');
        return;
    }
    
    connections.push({ fromNodeId, fromPort, toNodeId, toPort });
    renderNodes();
    updateGeneratedCode();
    addLog(`🔗 创建连接: ${fromNodeId.slice(-4)}.${fromPort} → ${toNodeId.slice(-4)}.${toPort}`);
}

function wouldCreateCycle(fromNodeId, toNodeId) {
    // 简化：检查 toNodeId 是否依赖 fromNodeId
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

function addNode(funcData, x, y) {
    const nodeId = `node_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const node = {
        id: nodeId,
        position: { x, y },
        data: {
            label: funcData.displayName,
            funcName: funcData.funcName,
            code: funcData.code,
            inputs: funcData.inputs || [],
            outputs: funcData.outputs || ['result'],
            inputValues: {},
            outputValue: null,
            isExecuting: false,
            isNested: false,
            description: funcData.description || ''
        }
    };
    
    nodes.push(node);
    renderNodes();
    updateGeneratedCode();
    addLog(`➕ 添加节点: ${node.data.label}`);
}

function addNestedNode(name, inputs, outputs, subNodes, subConnections) {
    const nodeId = `nested_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const node = {
        id: nodeId,
        position: { x: 200, y: 200 },
        data: {
            label: name,
            funcName: name.replace(/\s/g, '_').toLowerCase(),
            inputs: inputs.map(i => i.name),
            outputs: outputs.map(o => o.name),
            inputValues: {},
            outputValue: null,
            isExecuting: false,
            isNested: true,
            subNodes: subNodes,
            subConnections: subConnections,
            nestedInputs: inputs,
            nestedOutputs: outputs,
            description: `嵌套节点: ${name}`,
            code: ''  // 动态生成
        }
    };
    
    nodes.push(node);
    renderNodes();
    updateGeneratedCode();
    addLog(`📦 添加嵌套节点: ${name}`);
}

function deleteNode(nodeId) {
    nodes = nodes.filter(n => n.id !== nodeId);
    connections = connections.filter(c => c.fromNodeId !== nodeId && c.toNodeId !== nodeId);
    renderNodes();
    updateGeneratedCode();
    addLog(`🗑️ 删除节点`);
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

// ========== 渲染节点 ==========
function renderNodes() {
    const container = document.getElementById('react-flow');
    container.innerHTML = '';
    
    // 先渲染所有节点
    for (const node of nodes) {
        const nodeDiv = createNodeElement(node);
        container.appendChild(nodeDiv);
    }
    
    // 再渲染连线
    renderConnections(container);
    
    // 更新执行顺序显示
    if (showExecOrder) {
        displayExecOrder();
    }
}

function createNodeElement(node) {
    const div = document.createElement('div');
    div.className = 'flow-node';
    div.setAttribute('data-node-id', node.id);
    div.style.position = 'absolute';
    div.style.left = `${node.position.x}px`;
    div.style.top = `${node.position.y}px`;
    
    if (node.data.isExecuting) {
        div.classList.add('executing');
    }
    
    // Header
    const header = document.createElement('div');
    header.className = 'node-header';
    header.innerHTML = `
        <span class="node-title">🔷 ${node.data.label}</span>
        <div class="node-actions">
            ${node.data.isNested ? '<span class="nested-badge">📦 嵌套</span>' : ''}
            <button class="edit-nested-btn" title="编辑嵌套节点" ${!node.data.isNested ? 'style="display:none"' : ''}>✏️</button>
            <button class="delete-node-btn" title="删除节点">✕</button>
        </div>
    `;
    div.appendChild(header);
    
    // 嵌套节点编辑按钮
    const editBtn = header.querySelector('.edit-nested-btn');
    if (editBtn && node.data.isNested) {
        editBtn.onclick = (e) => {
            e.stopPropagation();
            openNestedEditor(node);
        };
    }
    
    // 删除按钮
    const deleteBtn = header.querySelector('.delete-node-btn');
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        deleteNode(node.id);
    };
    
    // Content
    const content = document.createElement('div');
    content.className = 'node-content';
    
    // 输入端口
    if (node.data.inputs && node.data.inputs.length > 0) {
        const inputsDiv = document.createElement('div');
        inputsDiv.className = 'node-section';
        inputsDiv.innerHTML = '<div class="node-section-title">📥 输入</div>';
        
        for (const input of node.data.inputs) {
            const incomingConn = connections.find(c => c.toNodeId === node.id && c.toPort === input);
            const portDiv = document.createElement('div');
            portDiv.className = 'input-port';
            portDiv.innerHTML = `
                <div class="port-dot"></div>
                <span class="port-name">${input}</span>
                ${!incomingConn ? `<input class="input-value" type="text" placeholder="值" value="${node.data.inputValues?.[input] || ''}">` : '<span style="margin-left:auto; font-size:10px; color:#6c7086;">← 连接</span>'}
            `;
            inputsDiv.appendChild(portDiv);
            
            // 输入框变化事件
            const inputField = portDiv.querySelector('.input-value');
            if (inputField) {
                inputField.onchange = (e) => {
                    let val = e.target.value;
                    if (!isNaN(val) && val !== '') val = Number(val);
                    node.data.inputValues[input] = val;
                    updateGeneratedCode();
                };
            }
        }
        content.appendChild(inputsDiv);
    }
    
    // 输出端口
    if (node.data.outputs && node.data.outputs.length > 0) {
        const outputsDiv = document.createElement('div');
        outputsDiv.className = 'node-section';
        outputsDiv.innerHTML = '<div class="node-section-title">📤 输出</div>';
        
        for (const output of node.data.outputs) {
            const portDiv = document.createElement('div');
            portDiv.className = 'output-port';
            portDiv.innerHTML = `
                <div class="port-dot"></div>
                <span class="port-name">${output}</span>
                <span class="output-value">${node.data.outputValue !== null ? 
                    (typeof node.data.outputValue === 'object' ? JSON.stringify(node.data.outputValue).slice(0, 30) : String(node.data.outputValue).slice(0, 30)) 
                    : '未执行'}</span>
            `;
            outputsDiv.appendChild(portDiv);
        }
        content.appendChild(outputsDiv);
    }
    
    div.appendChild(content);
    
    // Footer
    const footer = document.createElement('div');
    footer.className = 'node-footer';
    footer.innerHTML = `
        <button class="run-node-btn">▶ 执行</button>
    `;
    div.appendChild(footer);
    
    // 执行按钮
    const runBtn = footer.querySelector('.run-node-btn');
    runBtn.onclick = async (e) => {
        e.stopPropagation();
        await executeNode(node, {});
        renderNodes();
        updateGeneratedCode();
    };
    
    // 拖动功能
    makeDraggable(div, node);
    
    return div;
}

function renderConnections(container) {
    // 获取所有节点的位置
    const nodePositions = {};
    for (const node of nodes) {
        const nodeEl = container.querySelector(`.flow-node[data-node-id="${node.id}"]`);
        if (nodeEl) {
            const rect = nodeEl.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            nodePositions[node.id] = {
                x: rect.left - containerRect.left,
                y: rect.top - containerRect.top,
                width: rect.width
            };
        }
    }
    
    // 获取输出端口位置
    const portPositions = {};
    for (const node of nodes) {
        const nodeEl = container.querySelector(`.flow-node[data-node-id="${node.id}"]`);
        if (nodeEl) {
            const outputPorts = nodeEl.querySelectorAll('.output-port');
            for (const port of outputPorts) {
                const portName = port.querySelector('.port-name')?.textContent;
                const portRect = port.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                portPositions[`${node.id}|out|${portName}`] = {
                    x: portRect.right - containerRect.left - 4,
                    y: (portRect.top + portRect.bottom) / 2 - containerRect.top
                };
            }
            
            const inputPorts = nodeEl.querySelectorAll('.input-port');
            for (const port of inputPorts) {
                const portName = port.querySelector('.port-name')?.textContent;
                const portRect = port.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                portPositions[`${node.id}|in|${portName}`] = {
                    x: portRect.left - containerRect.left + 4,
                    y: (portRect.top + portRect.bottom) / 2 - containerRect.top
                };
            }
        }
    }
    
    // 绘制连线
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
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
            svg.appendChild(path);
            
            // 添加删除按钮功能（双击删除）
            path.style.cursor = "pointer";
            path.style.pointerEvents = "visibleStroke";
            path.addEventListener("dblclick", (e) => {
                e.stopPropagation();
                removeConnection(conn.fromNodeId, conn.fromPort, conn.toNodeId, conn.toPort);
            });
        }
    }
    
    container.appendChild(svg);
}

function makeDraggable(element, node) {
    let isDragging = false;
    let startX, startY;
    
    const handle = element.querySelector('.node-header');
    
    handle.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('delete-node-btn') || 
            e.target.classList.contains('edit-nested-btn') ||
            e.target.closest('.node-actions')) {
            return;
        }
        isDragging = true;
        startX = e.clientX - node.position.x;
        startY = e.clientY - node.position.y;
        element.style.zIndex = '1000';
        e.preventDefault();
    });
    
    window.addEventListener('mousemove', (e) => {
        if (isDragging) {
            node.position.x = e.clientX - startX;
            node.position.y = e.clientY - startY;
            element.style.left = `${node.position.x}px`;
            element.style.top = `${node.position.y}px`;
            
            // 重新绘制连线
            renderNodes();
        }
    });
    
    window.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            element.style.zIndex = '1';
            updateGeneratedCode();
        }
    });
}

// ========== 嵌套节点编辑器 ==========
function openNestedEditor(node) {
    nestedEditingNode = node;
    const modal = document.getElementById('nested-modal');
    const nestedCanvas = document.getElementById('nested-canvas');
    
    // 显示模态框
    modal.style.display = 'block';
    
    // 初始化嵌套画布（简化版）
    nestedCanvas.innerHTML = '<div style="color:#6c7086; padding:20px;">嵌套节点编辑器 - 拖拽左侧函数到此区域</div>';
    
    // 显示输入输出列表
    const inputList = document.getElementById('nested-input-list');
    const outputList = document.getElementById('nested-output-list');
    
    inputList.innerHTML = '';
    outputList.innerHTML = '';
    
    (node.data.nestedInputs || []).forEach((inp, idx) => {
        const item = document.createElement('div');
        item.className = 'port-item';
        item.innerHTML = `
            <span>📥 ${inp.name}</span>
            <button onclick="removeNestedInput(${idx})">✕</button>
        `;
        inputList.appendChild(item);
    });
    
    (node.data.nestedOutputs || []).forEach((out, idx) => {
        const item = document.createElement('div');
        item.className = 'port-item';
        item.innerHTML = `
            <span>📤 ${out.name}</span>
            <button onclick="removeNestedOutput(${idx})">✕</button>
        `;
        outputList.appendChild(item);
    });
}

function closeNestedModal() {
    document.getElementById('nested-modal').style.display = 'none';
    nestedEditingNode = null;
}

function addNestedInput() {
    if (!nestedEditingNode) return;
    const name = prompt('输入端口名称:');
    if (name) {
        if (!nestedEditingNode.data.nestedInputs) nestedEditingNode.data.nestedInputs = [];
        nestedEditingNode.data.nestedInputs.push({ name });
        if (!nestedEditingNode.data.inputs) nestedEditingNode.data.inputs = [];
        nestedEditingNode.data.inputs.push(name);
        openNestedEditor(nestedEditingNode);
    }
}

function addNestedOutput() {
    if (!nestedEditingNode) return;
    const name = prompt('输出端口名称:');
    if (name) {
        if (!nestedEditingNode.data.nestedOutputs) nestedEditingNode.data.nestedOutputs = [];
        nestedEditingNode.data.nestedOutputs.push({ name });
        if (!nestedEditingNode.data.outputs) nestedEditingNode.data.outputs = [];
        nestedEditingNode.data.outputs.push(name);
        openNestedEditor(nestedEditingNode);
    }
}

function removeNestedInput(idx) {
    if (nestedEditingNode) {
        nestedEditingNode.data.nestedInputs.splice(idx, 1);
        nestedEditingNode.data.inputs.splice(idx, 1);
        openNestedEditor(nestedEditingNode);
    }
}

function removeNestedOutput(idx) {
    if (nestedEditingNode) {
        nestedEditingNode.data.nestedOutputs.splice(idx, 1);
        nestedEditingNode.data.outputs.splice(idx, 1);
        openNestedEditor(nestedEditingNode);
    }
}

function saveNestedNode() {
    if (!nestedEditingNode) return;
    
    // 这里可以保存子节点和子连接
    addLog(`💾 保存嵌套节点: ${nestedEditingNode.data.label}`);
    closeNestedModal();
    renderNodes();
    updateGeneratedCode();
}

// 全局函数供 HTML 调用
window.removeNestedInput = removeNestedInput;
window.removeNestedOutput = removeNestedOutput;
window.addNestedInput = addNestedInput;
window.addNestedOutput = addNestedOutput;

// ========== 执行顺序显示 ==========
function displayExecOrder() {
    const order = getTopologicalOrder();
    const orderText = order.map((id, idx) => {
        const node = nodes.find(n => n.id === id);
        return `${idx + 1}. ${node?.data.label || id.slice(-4)}`;
    }).join('\n');
    
    addLog(`📊 执行顺序:\n${orderText}`);
}

// ========== 下载和复制 ==========
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
    addLog(`📋 代码已复制到剪贴板`);
}

// ========== 日志 ==========
function addLog(message) {
    const logDiv = document.getElementById('output-log');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span style="color:#89b4fa;">[${new Date().toLocaleTimeString()}]</span> ${message}`;
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;
    
    while (logDiv.children.length > 200) {
        logDiv.removeChild(logDiv.firstChild);
    }
}

function clearLogs() {
    const logDiv = document.getElementById('output-log');
    logDiv.innerHTML = '';
}

// ========== 函数库加载 ==========
async function loadAllFunctions() {
    // 默认函数库
    functionLibrary = {
        'math': {
            name: '数学运算',
            functions: {
                'add': {
                    name: '加法',
                    code: 'def add(a, b):\n    """@name: 加法\n    @description: 返回两个数的和\n    @outputs: sum"""\n    return a + b',
                    inputs: ['a', 'b'],
                    outputs: ['sum']
                },
                'multiply': {
                    name: '乘法',
                    code: 'def multiply(a, b):\n    """乘法函数"""\n    return a * b',
                    inputs: ['a', 'b'],
                    outputs: ['product']
                },
                'square': {
                    name: '平方',
                    code: 'def square(x):\n    """平方函数"""\n    return x ** 2',
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
                    code: 'def to_upper(text):\n    """转大写"""\n    return text.upper()',
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
                'append_item': {
                    name: '添加元素',
                    code: 'def append_item(arr, item):\n    """向列表添加元素"""\n    arr.append(item)\n    return arr',
                    inputs: ['arr', 'item'],
                    outputs: ['result']
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
        
        const header = document.createElement('div');
        header.className = 'category-header';
        header.innerHTML = `📁 ${catData.name} <span style="font-size:10px;">(${Object.keys(catData.functions).length})</span>`;
        let itemsVisible = true;
        header.onclick = () => {
            itemsVisible = !itemsVisible;
            const items = catDiv.querySelector('.category-items');
            items.style.display = itemsVisible ? 'block' : 'none';
        };
        
        const itemsDiv = document.createElement('div');
        itemsDiv.className = 'category-items';
        
        for (const [funcName, funcData] of Object.entries(catData.functions)) {
            const item = document.createElement('div');
            item.className = 'function-item';
            item.innerHTML = `
                <strong>${funcData.name}</strong>
                <small>${(funcData.inputs || []).join(', ')} → ${(funcData.outputs || ['result']).join(', ')}</small>
            `;
            item.draggable = true;
            
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

// ========== 示例节点 ==========
function addExampleNodes() {
    addNode({
        funcName: 'add',
        displayName: '加法示例',
        code: functionLibrary.math.functions.add.code,
        inputs: ['a', 'b'],
        outputs: ['sum']
    }, 100, 100);
    
    addNode({
        funcName: 'square',
        displayName: '平方示例',
        code: functionLibrary.math.functions.square.code,
        inputs: ['x'],
        outputs: ['result']
    }, 400, 100);
}

// ========== Pyodide 加载 ==========
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
    showExecOrder = !showExecOrder;
    if (showExecOrder) {
        displayExecOrder();
    }
});

document.getElementById('copy-code')?.addEventListener('click', copyCode);
document.getElementById('download-code')?.addEventListener('click', downloadCode);
document.getElementById('clear-logs')?.addEventListener('click', clearLogs);
document.getElementById('refresh-functions')?.addEventListener('click', async () => {
    await loadAllFunctions();
    addLog('🔄 函数库已刷新');
});

// 模态框事件
document.querySelector('.modal-close')?.addEventListener('click', closeNestedModal);
document.getElementById('save-nested')?.addEventListener('click', saveNestedNode);
window.addEventListener('click', (e) => {
    const modal = document.getElementById('nested-modal');
    if (e.target === modal) closeNestedModal();
});

// 导出全局变量供调试
window.debug = { nodes, connections, getTopologicalOrder, generatePythonCode };
