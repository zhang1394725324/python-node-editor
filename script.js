// ==================== 全局变量 ====================
let pyodide = null;
let nodes = [];
let functionLibrary = {};  // 动态加载的函数库

// ==================== 初始化 ====================
window.addEventListener('DOMContentLoaded', async () => {
    console.log('初始化编辑器...');
    document.getElementById('exec-status').textContent = '加载 Python 运行时...';
    
    // 1. 加载 Pyodide
    pyodide = await loadPyodide();
    await pyodide.loadPackage(['numpy', 'micropip']);
    
    document.getElementById('exec-status').textContent = '加载自定义函数...';
    
    // 2. 从 functions/ 目录加载所有 Python 文件
    await loadAllFunctions();
    
    // 3. 注册所有函数到 Python 环境
    await registerAllFunctions();
    
    document.getElementById('exec-status').textContent = '就绪 ✅';
    
    // 4. 构建侧边栏函数树
    buildFunctionTree();
    
    // 5. 初始化画布
    initCanvas();
    
    // 6. 添加示例节点
    addExampleNodes();
});

// ==================== 动态加载所有 Python 文件 ====================
async function loadAllFunctions() {
    try {
        // 获取 functions 目录下的所有分类文件夹
        const categories = await fetchCategories();
        
        for (const category of categories) {
            // 获取该分类下的所有 .py 文件
            const pyFiles = await fetchPythonFiles(category);
            
            // 初始化该分类
            if (!functionLibrary[category]) {
                functionLibrary[category] = {
                    name: getCategoryDisplayName(category),
                    functions: {}
                };
            }
            
            // 加载每个 .py 文件
            for (const pyFile of pyFiles) {
                await loadPythonFile(category, pyFile);
            }
        }
        
        console.log('函数库加载完成:', functionLibrary);
    } catch (error) {
        console.error('加载函数库失败:', error);
        addLog('❌ 加载函数库失败，请确保 functions/ 目录结构正确');
        // 使用默认示例函数
        loadDefaultFunctions();
    }
}

// 获取所有分类文件夹
async function fetchCategories() {
    // 注意：GitHub Pages 无法直接列出目录，需要你手动维护分类列表
    // 方案1：硬编码分类列表（推荐用于 GitHub Pages）
    return ['math', 'text', 'list', 'string'];
    
    // 方案2：通过 manifest.json 获取（需要你在每个分类下放 manifest.json）
    // try {
    //     const response = await fetch('functions/manifest.json');
    //     const manifest = await response.json();
    //     return manifest.categories;
    // } catch {
    //     return ['math', 'text']; // 降级方案
    // }
}

// 获取指定分类下的所有 .py 文件
async function fetchPythonFiles(category) {
    // 方案1：通过 manifest.json（推荐）
    try {
        const manifestUrl = `functions/${category}/manifest.json`;
        const response = await fetch(manifestUrl);
        if (response.ok) {
            const manifest = await response.json();
            return manifest.files || [];
        }
    } catch (e) {
        console.log(`${category} 没有 manifest.json，尝试其他方式`);
    }
    
    // 方案2：硬编码文件列表
    const hardcodedFiles = {
        'math': ['basic_math.py', 'advanced_math.py'],
        'text': ['string_utils.py', 'formatters.py'],
        'list': ['list_ops.py'],
        'string': ['string_ops.py']
    };
    
    return hardcodedFiles[category] || [];
}

// 获取分类显示名称
function getCategoryDisplayName(category) {
    const names = {
        'math': '数学运算',
        'text': '文本处理',
        'list': '列表操作',
        'string': '字符串处理'
    };
    return names[category] || category;
}

// 加载单个 Python 文件并解析其中的函数
async function loadPythonFile(category, fileName) {
    try {
        const filePath = `functions/${category}/${fileName}`;
        const response = await fetch(filePath);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${filePath}`);
        }
        
        const code = await response.text();
        
        // 保存原始代码，稍后注册到 Pyodide
        const parsedFunctions = parsePythonFunctions(code, fileName);
        
        for (const [funcName, funcInfo] of Object.entries(parsedFunctions)) {
            functionLibrary[category].functions[funcName] = {
                name: funcInfo.displayName || funcName,
                code: funcInfo.code,
                inputs: funcInfo.inputs,
                outputs: funcInfo.outputs || ['result'],
                fileName: fileName,
                description: funcInfo.description || ''
            };
        }
        
        console.log(`✅ 加载: ${category}/${fileName} → ${Object.keys(parsedFunctions).length} 个函数`);
    } catch (error) {
        console.error(`❌ 加载失败 ${category}/${fileName}:`, error);
        addLog(`⚠️ 无法加载 ${category}/${fileName}: ${error.message}`);
    }
}

// 解析 Python 文件，提取函数定义
function parsePythonFunctions(code, fileName) {
    const functions = {};
    
    // 正则匹配函数定义
    const funcRegex = /def\s+(\w+)\s*\(([^)]*)\)\s*:\s*(?:\n\s*"""(.*?)""")?/gs;
    let match;
    
    while ((match = funcRegex.exec(code)) !== null) {
        const funcName = match[1];
        const paramsStr = match[2];
        const docstring = match[3] || '';
        
        // 解析参数
        const inputs = paramsStr.split(',').map(p => p.trim().split('=')[0].trim()).filter(p => p);
        
        // 解析 docstring 获取函数信息
        const displayName = extractDocValue(docstring, '@name') || funcName;
        const description = extractDocValue(docstring, '@description') || '';
        const outputs = extractDocValue(docstring, '@outputs');
        
        // 找到完整的函数代码（包括函数体）
        const fullFuncCode = extractFunctionCode(code, funcName);
        
        functions[funcName] = {
            name: funcName,
            displayName: displayName,
            code: fullFuncCode,
            inputs: inputs,
            outputs: outputs ? outputs.split(',').map(o => o.trim()) : ['result'],
            description: description
        };
    }
    
    return functions;
}

// 从 docstring 中提取特定标记的值
function extractDocValue(docstring, tag) {
    const regex = new RegExp(`${tag}\\s*[:：]\\s*(.+?)(?:\\n|$)`, 'i');
    const match = docstring.match(regex);
    return match ? match[1].trim() : null;
}

// 提取完整的函数代码
function extractFunctionCode(fullCode, funcName) {
    const lines = fullCode.split('\n');
    let funcLines = [];
    let insideFunc = false;
    let indentLevel = null;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (!insideFunc && line.match(new RegExp(`^def\\s+${funcName}\\s*\\(`))) {
            insideFunc = true;
            funcLines.push(line);
            // 计算缩进级别
            const indentMatch = line.match(/^(\s*)/);
            indentLevel = indentMatch ? indentMatch[1].length : 0;
            continue;
        }
        
        if (insideFunc) {
            // 检查当前行的缩进
            const currentIndent = line.match(/^(\s*)/);
            const currentIndentLevel = currentIndent ? currentIndent[1].length : 0;
            
            // 如果缩进级别 <= 函数定义的缩进级别，且不是空行，说明函数结束
            if (currentIndentLevel <= indentLevel && line.trim() !== '' && !line.match(/^\s*#/)) {
                break;
            }
            funcLines.push(line);
        }
    }
    
    return funcLines.join('\n');
}

// 注册所有函数到 Pyodide
async function registerAllFunctions() {
    for (const [category, catData] of Object.entries(functionLibrary)) {
        for (const [funcName, funcData] of Object.entries(catData.functions)) {
            try {
                await pyodide.runPythonAsync(funcData.code);
                console.log(`✅ 注册: ${funcName}`);
            } catch (error) {
                console.error(`❌ 注册失败 ${funcName}:`, error);
                addLog(`⚠️ 函数 ${funcName} 注册失败: ${error.message}`);
            }
        }
    }
}

// 加载默认函数（当无法从文件加载时使用）
function loadDefaultFunctions() {
    functionLibrary = {
        'math': {
            name: '数学运算',
            functions: {
                'add': {
                    name: '加法',
                    code: 'def add(a, b):\n    """加法函数"""\n    return a + b',
                    inputs: ['a', 'b'],
                    outputs: ['result']
                },
                'multiply': {
                    name: '乘法',
                    code: 'def multiply(a, b):\n    """乘法函数"""\n    return a * b',
                    inputs: ['a', 'b'],
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
                }
            }
        }
    };
    addLog('📦 使用默认函数库');
}

// ==================== 构建侧边栏 ====================
function buildFunctionTree() {
    const container = document.getElementById('function-tree');
    container.innerHTML = '';
    
    for (const [catKey, catData] of Object.entries(functionLibrary)) {
        const catDiv = document.createElement('div');
        catDiv.className = 'category';
        
        const header = document.createElement('div');
        header.className = 'category-header';
        header.innerHTML = `📁 ${catData.name} <span style="font-size:10px;">(${Object.keys(catData.functions).length})</span>`;
        header.onclick = () => {
            const items = catDiv.querySelector('.category-items');
            items.style.display = items.style.display === 'none' ? 'block' : 'none';
        };
        
        const itemsDiv = document.createElement('div');
        itemsDiv.className = 'category-items';
        itemsDiv.style.display = 'block';
        
        for (const [funcName, funcData] of Object.entries(catData.functions)) {
            const item = createFunctionDragItem(funcName, funcData, catKey);
            itemsDiv.appendChild(item);
        }
        
        catDiv.appendChild(header);
        catDiv.appendChild(itemsDiv);
        container.appendChild(catDiv);
    }
}

function createFunctionDragItem(funcName, funcData, category) {
    const item = document.createElement('div');
    item.className = 'function-item';
    item.innerHTML = `
        <strong>${funcData.name || funcName}</strong>
        <span style="font-size:10px; color:#89b4fa; display:block;">${funcData.inputs.join(', ')} → ${funcData.outputs.join(', ')}</span>
    `;
    item.draggable = true;
    item.setAttribute('data-func-name', funcName);
    item.setAttribute('data-func-category', category);
    item.setAttribute('data-func-code', funcData.code);
    item.setAttribute('data-inputs', JSON.stringify(funcData.inputs));
    item.setAttribute('data-outputs', JSON.stringify(funcData.outputs));
    item.setAttribute('data-display-name', funcData.name || funcName);
    
    item.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({
            funcName: funcName,
            category: category,
            code: funcData.code,
            inputs: funcData.inputs,
            outputs: funcData.outputs,
            displayName: funcData.name || funcName
        }));
        e.dataTransfer.effectAllowed = 'copy';
    };
    
    return item;
}

// ==================== 画布相关 ====================
function initCanvas() {
    const container = document.getElementById('react-flow');
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });
    
    container.addEventListener('drop', (e) => {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left - 100;
        const y = e.clientY - rect.top - 50;
        
        const funcData = JSON.parse(e.dataTransfer.getData('text/plain'));
        addNode(funcData, x, y);
    });
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
            inputs: funcData.inputs,
            outputs: funcData.outputs,
            inputValues: {},
            outputValue: null,
            isExecuting: false
        }
    };
    
    nodes.push(node);
    renderNodes();
}

function addExampleNodes() {
    // 添加示例节点（如果存在加法函数）
    if (functionLibrary.math?.functions['add']) {
        addNode({
            funcName: 'add',
            displayName: '加法示例',
            code: functionLibrary.math.functions['add'].code,
            inputs: ['a', 'b'],
            outputs: ['result']
        }, 100, 100);
    }
}

function renderNodes() {
    const container = document.getElementById('react-flow');
    container.innerHTML = '';
    
    nodes.forEach(node => {
        const nodeDiv = createNodeElement(node);
        container.appendChild(nodeDiv);
        addDragBehavior(nodeDiv, node);
    });
}

function createNodeElement(node) {
    const div = document.createElement('div');
    div.className = 'flow-node';
    div.style.position = 'absolute';
    div.style.left = `${node.position.x}px`;
    div.style.top = `${node.position.y}px`;
    div.style.width = '240px';
    div.style.background = '#2d2d3f';
    div.style.border = `2px solid ${node.data.isExecuting ? '#f9e45b' : '#89b4fa'}`;
    div.style.borderRadius = '8px';
    div.style.padding = '12px';
    div.style.color = 'white';
    div.style.fontSize = '12px';
    div.style.cursor = 'move';
    div.style.userSelect = 'none';
    
    // 删除按钮
    const deleteBtn = document.createElement('div');
    deleteBtn.textContent = '✕';
    deleteBtn.style.position = 'absolute';
    deleteBtn.style.top = '4px';
    deleteBtn.style.right = '8px';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.style.color = '#f38ba8';
    deleteBtn.style.fontSize = '14px';
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        nodes = nodes.filter(n => n.id !== node.id);
        renderNodes();
        addLog(`🗑️ 删除节点: ${node.data.label}`);
    };
    div.appendChild(deleteBtn);
    
    // 标题
    const title = document.createElement('div');
    title.textContent = `🔷 ${node.data.label}`;
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '8px';
    title.style.paddingRight = '20px';
    div.appendChild(title);
    
    // 输入区域
    const inputsDiv = document.createElement('div');
    inputsDiv.style.marginBottom = '8px';
    inputsDiv.innerHTML = '<strong>📥 输入</strong><br>';
    
    node.data.inputs.forEach(input => {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.marginTop = '4px';
        
        const port = document.createElement('div');
        port.textContent = '●';
        port.style.color = '#a6e3a1';
        port.style.marginRight = '6px';
        
        const inputField = document.createElement('input');
        inputField.placeholder = input;
        inputField.style.flex = '1';
        inputField.style.background = '#1e1e2f';
        inputField.style.border = '1px solid #45475a';
        inputField.style.color = 'white';
        inputField.style.padding = '4px 8px';
        inputField.style.borderRadius = '4px';
        inputField.value = node.data.inputValues[input] !== undefined ? node.data.inputValues[input] : '';
        
        inputField.onchange = (e) => {
            let val = e.target.value;
            // 尝试解析数字
            if (!isNaN(val) && val !== '') {
                val = Number(val);
            }
            node.data.inputValues[input] = val;
        };
        
        wrapper.appendChild(port);
        wrapper.appendChild(inputField);
        inputsDiv.appendChild(wrapper);
    });
    div.appendChild(inputsDiv);
    
    // 输出区域
    const outputsDiv = document.createElement('div');
    outputsDiv.style.marginTop = '8px';
    outputsDiv.style.paddingTop = '8px';
    outputsDiv.style.borderTop = '1px solid #45475a';
    outputsDiv.innerHTML = '<strong>📤 输出</strong><br>';
    
    node.data.outputs.forEach(output => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.marginTop = '4px';
        
        const port = document.createElement('div');
        port.textContent = '●';
        port.style.color = '#f38ba8';
        port.style.marginRight = '6px';
        
        const valueSpan = document.createElement('span');
        valueSpan.style.flex = '1';
        valueSpan.style.wordBreak = 'break-word';
        
        if (node.data.outputValue !== null) {
            const val = node.data.outputValue;
            valueSpan.textContent = typeof val === 'object' ? JSON.stringify(val) : String(val);
            valueSpan.style.color = '#a6e3a1';
        } else {
            valueSpan.textContent = '未执行';
            valueSpan.style.color = '#6c7086';
        }
        
        row.appendChild(port);
        row.appendChild(valueSpan);
        outputsDiv.appendChild(row);
    });
    div.appendChild(outputsDiv);
    
    // 执行按钮
    const runBtn = document.createElement('button');
    runBtn.textContent = node.data.isExecuting ? '⏳ 执行中...' : '▶ 执行';
    runBtn.style.width = '100%';
    runBtn.style.marginTop = '10px';
    runBtn.style.background = '#89b4fa';
    runBtn.style.border = 'none';
    runBtn.style.padding = '6px';
    runBtn.style.borderRadius = '4px';
    runBtn.style.cursor = 'pointer';
    runBtn.style.fontWeight = 'bold';
    runBtn.disabled = node.data.isExecuting;
    
    runBtn.onclick = async () => {
        if (!node.data.isExecuting) {
            await executeNode(node);
            renderNodes(); // 刷新显示输出
        }
    };
    div.appendChild(runBtn);
    
    return div;
}

function addDragBehavior(element, node) {
    let isDragging = false;
    let startX, startY;
    
    element.addEventListener('mousedown', (e) => {
        if (e.target === element || e.target.parentElement === element || e.target.classList?.contains('flow-node')) {
            isDragging = true;
            startX = e.clientX - node.position.x;
            startY = e.clientY - node.position.y;
            element.style.zIndex = '1000';
            e.preventDefault();
        }
    });
    
    window.addEventListener('mousemove', (e) => {
        if (isDragging) {
            node.position.x = e.clientX - startX;
            node.position.y = e.clientY - startY;
            element.style.left = `${node.position.x}px`;
            element.style.top = `${node.position.y}px`;
        }
    });
    
    window.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            element.style.zIndex = '1';
        }
    });
}

// ==================== 执行节点 ====================
async function executeNode(node) {
    node.data.isExecuting = true;
    renderNodes();
    
    try {
        const codeLines = node.data.code.split('\n');
        const funcNameMatch = codeLines[0].match(/def\s+(\w+)\s*\(/);
        const funcName = funcNameMatch ? funcNameMatch[1] : node.data.funcName;
        
        // 构建参数字符串
        const args = node.data.inputs.map(input => {
            const val = node.data.inputValues[input];
            if (val === undefined || val === '') {
                return 'None';
            }
            if (typeof val === 'string') {
                return `"${val.replace(/"/g, '\\"')}"`;
            }
            return JSON.stringify(val);
        }).join(', ');
        
        const execCode = `
try:
    result = ${funcName}(${args})
    result
except Exception as e:
    f"ERROR: {str(e)}"
        `;
        
        const output = await pyodide.runPythonAsync(execCode);
        
        if (typeof output === 'string' && output.startsWith('ERROR:')) {
            throw new Error(output.replace('ERROR: ', ''));
        }
        
        node.data.outputValue = output;
        addLog(`✅ ${node.data.label} → ${typeof output === 'object' ? JSON.stringify(output) : output}`);
        
    } catch (err) {
        node.data.outputValue = null;
        addLog(`❌ ${node.data.label} 失败: ${err.message}`);
    } finally {
        node.data.isExecuting = false;
    }
}

// ==================== 日志和工具函数 ====================
function addLog(message) {
    const logDiv = document.getElementById('output-log');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const time = new Date().toLocaleTimeString();
    entry.innerHTML = `<span style="color:#89b4fa;">[${time}]</span> ${message}`;
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;
    
    // 限制日志条数
    while (logDiv.children.length > 100) {
        logDiv.removeChild(logDiv.firstChild);
    }
}

// 清空画布
document.getElementById('clear-canvas')?.addEventListener('click', () => {
    if (confirm('确定清空所有节点吗？')) {
        nodes = [];
        renderNodes();
        addLog('🗑️ 画布已清空');
    }
});

// 运行所有节点
document.getElementById('run-all')?.addEventListener('click', async () => {
    if (nodes.length === 0) {
        addLog('⚠️ 画布上没有节点');
        return;
    }
    
    addLog(`🚀 开始批量执行 ${nodes.length} 个节点...`);
    
    for (const node of nodes) {
        await executeNode(node);
        renderNodes();
        // 添加小延迟避免 Pyodide 过载
        await new Promise(r => setTimeout(r, 50));
    }
    
    addLog('✨ 批量执行完成');
});

// 加载 Pyodide（兼容性封装）
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
