// 初始化 Pyodide
let pyodide = null;
let nodes = [];
let edges = [];
let nodeOutputs = {};

// 自定义函数库（模拟从文件夹加载）
const functionLibrary = {
    'math': {
        name: '数学运算',
        functions: {
            'add': { 
                name: '加法', 
                code: 'def add(a, b):\n    return a + b',
                inputs: ['a', 'b'], 
                outputs: ['result'] 
            },
            'multiply': { 
                name: '乘法', 
                code: 'def multiply(a, b):\n    return a * b',
                inputs: ['a', 'b'], 
                outputs: ['result'] 
            },
            'square': { 
                name: '平方', 
                code: 'def square(x):\n    return x ** 2',
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
                code: 'def to_upper(text):\n    return text.upper()',
                inputs: ['text'], 
                outputs: ['result'] 
            },
            'greet': { 
                name: '问候', 
                code: 'def greet(name):\n    return f"Hello, {name}!"',
                inputs: ['name'], 
                outputs: ['result'] 
            }
        }
    }
};

// 等待页面加载和 Pyodide 初始化
window.addEventListener('DOMContentLoaded', async () => {
    console.log('加载 Pyodide...');
    document.getElementById('exec-status').textContent = '加载 Python 运行时...';
    
    pyodide = await loadPyodide();
    await pyodide.loadPackage(['numpy', 'micropip']);
    
    // 注册所有自定义函数到 Python 环境
    await registerFunctions();
    
    document.getElementById('exec-status').textContent = '就绪 ✅';
    
    // 初始化 React Flow
    initReactFlow();
    buildFunctionTree();
});

// 注册自定义函数
async function registerFunctions() {
    for (const [category, catData] of Object.entries(functionLibrary)) {
        for (const [funcName, funcData] of Object.entries(catData.functions)) {
            await pyodide.runPythonAsync(funcData.code);
            console.log(`注册函数: ${funcName}`);
        }
    }
}

// 构建侧边栏函数树
function buildFunctionTree() {
    const container = document.getElementById('function-tree');
    container.innerHTML = '';
    
    for (const [catKey, catData] of Object.entries(functionLibrary)) {
        const catDiv = document.createElement('div');
        catDiv.className = 'category';
        
        const header = document.createElement('div');
        header.className = 'category-header';
        header.textContent = `📁 ${catData.name}`;
        header.onclick = () => {
            const items = catDiv.querySelector('.category-items');
            items.style.display = items.style.display === 'none' ? 'block' : 'none';
        };
        
        const itemsDiv = document.createElement('div');
        itemsDiv.className = 'category-items';
        
        for (const [funcName, funcData] of Object.entries(catData.functions)) {
            const item = document.createElement('div');
            item.className = 'function-item';
            item.textContent = funcData.name;
            item.draggable = true;
            item.setAttribute('data-func-name', funcName);
            item.setAttribute('data-func-category', catKey);
            item.setAttribute('data-func-code', funcData.code);
            item.setAttribute('data-inputs', JSON.stringify(funcData.inputs));
            item.setAttribute('data-outputs', JSON.stringify(funcData.outputs));
            
            item.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({
                    funcName: funcName,
                    category: catKey,
                    code: funcData.code,
                    inputs: funcData.inputs,
                    outputs: funcData.outputs,
                    displayName: funcData.name
                }));
            };
            
            itemsDiv.appendChild(item);
        }
        
        catDiv.appendChild(header);
        catDiv.appendChild(itemsDiv);
        container.appendChild(catDiv);
    }
}

// 初始化 React Flow
function initReactFlow() {
    const ReactFlow = window.ReactFlow;
    const React = window.React;
    
    // 简化的节点编辑器 - 使用原生方式处理拖拽
    const dropZone = document.getElementById('react-flow');
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        const rect = dropZone.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const funcData = JSON.parse(e.dataTransfer.getData('text/plain'));
        addNode(funcData, x, y);
    });
    
    // 初始示例节点
    addNode({
        funcName: 'add',
        displayName: '加法',
        inputs: ['a', 'b'],
        outputs: ['result'],
        code: functionLibrary.math.functions.add.code
    }, 100, 100);
    
    addNode({
        funcName: 'square',
        displayName: '平方',
        inputs: ['x'],
        outputs: ['result'],
        code: functionLibrary.math.functions.square.code
    }, 400, 100);
}

// 添加节点到画布
function addNode(funcData, x, y) {
    const nodeId = `node_${Date.now()}_${Math.random()}`;
    const node = {
        id: nodeId,
        type: 'pythonNode',
        position: { x, y },
        data: {
            label: funcData.displayName,
            funcName: funcData.funcName,
            code: funcData.code,
            inputs: funcData.inputs,
            outputs: funcData.outputs,
            inputValues: {},
            outputValue: null
        }
    };
    
    nodes.push(node);
    renderNodes();
}

// 渲染节点（简易版，不依赖复杂 React Flow）
function renderNodes() {
    const container = document.getElementById('react-flow');
    container.innerHTML = '';
    
    nodes.forEach(node => {
        const nodeDiv = document.createElement('div');
        nodeDiv.className = 'flow-node';
        nodeDiv.style.position = 'absolute';
        nodeDiv.style.left = `${node.position.x}px`;
        nodeDiv.style.top = `${node.position.y}px`;
        nodeDiv.style.width = '200px';
        nodeDiv.style.background = '#2d2d3f';
        nodeDiv.style.border = '2px solid #89b4fa';
        nodeDiv.style.borderRadius = '8px';
        nodeDiv.style.padding = '12px';
        nodeDiv.style.color = 'white';
        nodeDiv.style.fontSize = '12px';
        nodeDiv.style.cursor = 'move';
        
        // 标题
        const title = document.createElement('div');
        title.textContent = `🔷 ${node.data.label}`;
        title.style.fontWeight = 'bold';
        title.style.marginBottom = '8px';
        title.style.borderBottom = '1px solid #89b4fa';
        title.style.paddingBottom = '4px';
        nodeDiv.appendChild(title);
        
        // 输入端口
        const inputsDiv = document.createElement('div');
        inputsDiv.style.marginBottom = '8px';
        inputsDiv.innerHTML = '<strong>输入:</strong><br>';
        node.data.inputs.forEach(input => {
            const inputWrapper = document.createElement('div');
            inputWrapper.style.display = 'flex';
            inputWrapper.style.alignItems = 'center';
            inputWrapper.style.marginTop = '4px';
            
            const port = document.createElement('div');
            port.textContent = '●';
            port.style.color = '#a6e3a1';
            port.style.marginRight = '6px';
            port.style.fontSize = '14px';
            
            const inputField = document.createElement('input');
            inputField.placeholder = input;
            inputField.style.flex = '1';
            inputField.style.background = '#1e1e2f';
            inputField.style.border = '1px solid #45475a';
            inputField.style.color = 'white';
            inputField.style.padding = '4px';
            inputField.style.borderRadius = '4px';
            inputField.value = node.data.inputValues[input] || '';
            inputField.onchange = (e) => {
                node.data.inputValues[input] = e.target.value;
                // 自动尝试转换数字
                if (!isNaN(e.target.value) && e.target.value !== '') {
                    node.data.inputValues[input] = Number(e.target.value);
                }
            };
            
            inputWrapper.appendChild(port);
            inputWrapper.appendChild(inputField);
            inputsDiv.appendChild(inputWrapper);
        });
        nodeDiv.appendChild(inputsDiv);
        
        // 输出端口
        const outputsDiv = document.createElement('div');
        outputsDiv.style.marginTop = '8px';
        outputsDiv.style.paddingTop = '8px';
        outputsDiv.style.borderTop = '1px solid #45475a';
        outputsDiv.innerHTML = '<strong>输出:</strong><br>';
        node.data.outputs.forEach(output => {
            const port = document.createElement('div');
            port.style.display = 'flex';
            port.style.alignItems = 'center';
            port.style.marginTop = '4px';
            port.innerHTML = `<span style="color:#f38ba8;">●</span> <span style="margin-left:6px;">${output}: </span>`;
            
            const valueSpan = document.createElement('span');
            valueSpan.style.marginLeft = 'auto';
            valueSpan.style.color = '#a6e3a1';
            valueSpan.textContent = node.data.outputValue !== null ? String(node.data.outputValue) : '未执行';
            port.appendChild(valueSpan);
            
            outputsDiv.appendChild(port);
        });
        nodeDiv.appendChild(outputsDiv);
        
        // 执行按钮
        const runBtn = document.createElement('button');
        runBtn.textContent = '▶ 执行';
        runBtn.style.marginTop = '10px';
        runBtn.style.width = '100%';
        runBtn.style.background = '#89b4fa';
        runBtn.style.border = 'none';
        runBtn.style.padding = '4px';
        runBtn.style.borderRadius = '4px';
        runBtn.style.cursor = 'pointer';
        runBtn.onclick = () => executeNode(node);
        nodeDiv.appendChild(runBtn);
        
        // 拖动功能
        let isDragging = false;
        let startX, startY;
        
        nodeDiv.addEventListener('mousedown', (e) => {
            if (e.target === nodeDiv || e.target === title) {
                isDragging = true;
                startX = e.clientX - node.position.x;
                startY = e.clientY - node.position.y;
                nodeDiv.style.zIndex = '1000';
                e.preventDefault();
            }
        });
        
        window.addEventListener('mousemove', (e) => {
            if (isDragging) {
                node.position.x = e.clientX - startX;
                node.position.y = e.clientY - startY;
                nodeDiv.style.left = `${node.position.x}px`;
                nodeDiv.style.top = `${node.position.y}px`;
            }
        });
        
        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                nodeDiv.style.zIndex = '1';
                renderNodes(); // 重绘更新位置
            }
        });
        
        container.appendChild(nodeDiv);
    });
}

// 执行单个节点
async function executeNode(node) {
    try {
        const codeLines = node.data.code.split('\n');
        const funcNameMatch = codeLines[0].match(/def\s+(\w+)\(/);
        const funcName = funcNameMatch ? funcNameMatch[1] : node.data.funcName;
        
        // 构建函数参数
        const args = node.data.inputs.map(input => {
            return JSON.stringify(node.data.inputValues[input] || 0);
        }).join(', ');
        
        // 生成执行代码
        const execCode = `
import json
result = ${funcName}(${args})
result
        `;
        
        const output = await pyodide.runPythonAsync(execCode);
        node.data.outputValue = output;
        
        // 记录到日志
        addLog(`执行 ${node.data.label} → ${JSON.stringify(output)}`);
        
        renderNodes();
    } catch (err) {
        node.data.outputValue = `错误: ${err.message}`;
        addLog(`❌ ${node.data.label} 失败: ${err.message}`);
        renderNodes();
    }
}

// 添加日志
function addLog(message) {
    const logDiv = document.getElementById('output-log');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;
}

// 清空画布
document.getElementById('clear-canvas')?.addEventListener('click', () => {
    nodes = [];
    renderNodes();
    addLog('清空画布');
});

// 运行所有节点
document.getElementById('run-all')?.addEventListener('click', async () => {
    addLog('开始批量执行...');
    for (const node of nodes) {
        await executeNode(node);
    }
    addLog('批量执行完成');
});
