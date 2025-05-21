// API端点全局常量
const QUERY_API_ENDPOINT = '/api/query';
const STREAM_API_ENDPOINT = '/api/stream';
const CONFIG_API_ENDPOINT = '/api/config';
const CONVERSATIONS_API_ENDPOINT = '/api/conversations';

// 全局变量
let currentConversationId = null;
let conversations = [];
let isProcessing = false;
let chatMessages = null;
let userInput = null;
let isStreaming = true;
let isWaitingForResponse = false;
let sendButton = null;
let historyTurnsSelect = null;
let currentStreamController = null; // 添加AbortController跟踪当前流式请求

// 更新Markdown内容
function updateMarkdownContent(element, content) {
    // 使用marked库解析Markdown
    if (typeof marked === 'undefined') {
        console.error('marked库未加载');
        element.textContent = content;
        return;
    }

    try {
        const rawHtml = marked.parse(content);
        // 使用DOMPurify清理HTML以防XSS攻击
        if (typeof DOMPurify !== 'undefined') {
            element.innerHTML = DOMPurify.sanitize(rawHtml);
        } else {
            console.warn('DOMPurify未加载，跳过HTML清理');
            element.innerHTML = rawHtml;
        }

        // 代码块语法高亮
        if (typeof hljs !== 'undefined') {
            element.querySelectorAll('pre code').forEach(block => {
                hljs.highlightElement(block);
            });
        }
    } catch (error) {
        console.error('Markdown渲染错误:', error);
        element.textContent = content;
    }
}

// 在全局定义addMessage函数
function addMessage(type, content) {
    if (!chatMessages) {
        chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) {
            console.error('聊天消息容器未找到');
            return null;
        }
    }

    const messageElement = document.createElement('div');
    messageElement.className = `message ${type}`;

    const contentElement = document.createElement('div');
    contentElement.className = 'message-content';

    // 创建Markdown内容容器
    const markdownContent = document.createElement('div');
    markdownContent.className = 'markdown-content';

    // 根据消息类型设置内容
    if (type === 'user') {
        markdownContent.textContent = content;
    } else if (type === 'assistant' || type === 'system') {
        if (content) {
            updateMarkdownContent(markdownContent, content);
        }
    }

    contentElement.appendChild(markdownContent);
    messageElement.appendChild(contentElement);
    chatMessages.appendChild(messageElement);

    scrollToBottom();
    return messageElement;
}

// 滚动到底部
function scrollToBottom() {
    if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

// 加载对话列表
async function fetchConversations() {
    try {
        const response = await fetch(CONVERSATIONS_API_ENDPOINT);
        if (!response.ok) throw new Error(`服务器错误: ${response.status}`);

        const data = await response.json();
        conversations = data.conversations || [];

        updateConversationsList();
        return data;
    } catch (error) {
        console.error('加载对话列表失败:', error);
        if (typeof addMessage === 'function' && chatMessages) {
            addMessage('system', `加载对话列表失败: ${error.message}`);
        } else {
            console.error('addMessage函数未定义或chatMessages未初始化');
        }
        return null;
    }
}

// 渲染对话列表
function updateConversationsList() {
    const conversationsList = document.getElementById('conversations-list');
    if (!conversationsList) {
        console.error('conversations-list元素未找到');
        return;
    }

    conversationsList.innerHTML = '';

    conversations.forEach(conversation => {
        const item = document.createElement('div');
        item.className = 'conversation-item';
        if (conversation.id === currentConversationId) {
            item.classList.add('active');
        }

        // 创建标题元素
        const title = document.createElement('div');
        title.className = 'conversation-title';
        title.textContent = conversation.title || '新对话';

        // 创建操作按钮容器
        const actions = document.createElement('div');
        actions.className = 'conversation-actions';

        // 创建编辑按钮
        const editButton = document.createElement('button');
        editButton.className = 'action-button';
        editButton.innerHTML = '<i class="fas fa-edit"></i>';
        editButton.title = '编辑标题';
        editButton.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditTitleModal(conversation.id, conversation.title);
        });

        // 创建删除按钮
        const deleteButton = document.createElement('button');
        deleteButton.className = 'action-button';
        deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
        deleteButton.title = '删除对话';
        deleteButton.addEventListener('click', (e) => {
            e.stopPropagation();
            confirmDeleteConversation(conversation.id);
        });

        // 将按钮添加到操作容器
        actions.appendChild(editButton);
        actions.appendChild(deleteButton);

        // 将标题和操作添加到项目
        item.appendChild(title);
        item.appendChild(actions);

        // 添加点击事件切换对话
        item.addEventListener('click', () => openConversation(conversation.id));

        // 添加到列表
        conversationsList.appendChild(item);
    });
}

// 打开指定对话
async function openConversation(conversationId) {
    try {
        // 如果当前有进行中的流式请求，取消它
        if (currentStreamController) {
            currentStreamController.abort();
            currentStreamController = null;
        }

        currentConversationId = conversationId;

        // 更新UI激活状态
        updateConversationsList();

        // 获取chatMessages元素（如果尚未获取）
        if (!chatMessages) {
            chatMessages = document.getElementById('chat-messages');
            if (!chatMessages) {
                console.error('聊天消息容器未找到');
                return;
            }
        }

        // 清空当前聊天消息
        chatMessages.innerHTML = '';

        // 获取对话历史
        const response = await fetch(`${CONVERSATIONS_API_ENDPOINT}/${conversationId}`);
        if (!response.ok) throw new Error(`服务器错误: ${response.status}`);

        const data = await response.json();

        // 渲染历史消息
        if (data.conversation && data.conversation.messages && data.conversation.messages.length > 0) {
            data.conversation.messages.forEach(msg => {
                addMessage(msg.role, msg.content);
            });
        } else {
            // 添加欢迎消息
            addMessage('system', '你好！我是MCP Agent智能助手，我可以回答问题并使用各种工具帮助你。请输入你的问题。');
        }

        // 滚动到底部
        scrollToBottom();
    } catch (error) {
        console.error('打开对话失败:', error);
        if (typeof addMessage === 'function' && chatMessages) {
            addMessage('system', `打开对话失败: ${error.message}`);
        } else {
            console.error('addMessage函数未定义或chatMessages未初始化');
        }
    }
}

// 创建新对话
async function createNewConversation() {
    if (isProcessing) return;
    isProcessing = true;

    try {
        const response = await fetch(CONVERSATIONS_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title: '新对话' })
        });

        if (!response.ok) {
            throw new Error(`创建对话失败: ${response.status}`);
        }

        const data = await response.json();
        const conversationId = data.conversation?.id || data.conversation_id;

        if (!conversationId) {
            throw new Error('服务器响应中未包含对话ID');
        }

        await fetchConversations();
        openConversation(conversationId);
    } catch (error) {
        console.error('创建新对话出错:', error);
        alert(`创建新对话失败: ${error.message}`);
    } finally {
        isProcessing = false;
    }
}

// 更新助手消息内容
function updateAssistantMessage(messageElement, content, isStreaming = false) {
    const contentElement = messageElement.querySelector('.markdown-content');

    try {
        if (isStreaming) {
            // 流式更新使用简单格式化
            let formattedContent = content
                // 格式化粗体
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                // 格式化斜体
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                // 格式化行内代码
                .replace(/`([^`]+)`/g, '<code>$1</code>')
                // 替换换行
                .replace(/\n/g, '<br>');

            contentElement.innerHTML = DOMPurify.sanitize(formattedContent);
        } else {
            // 最终内容使用完整Markdown渲染
            updateMarkdownContent(contentElement, content);
        }
    } catch (error) {
        console.error('格式化消息内容时出错:', error);
        contentElement.textContent = content; // 回退到纯文本
    }

    scrollToBottom();
}

// 添加DOMContentLoaded事件处理
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM已加载，初始化应用...');

    // 初始化全局变量
    chatMessages = document.getElementById('chat-messages');
    userInput = document.getElementById('user-input');
    sendButton = document.getElementById('send-button');
    historyTurnsSelect = document.getElementById('history-turns');
    const streamToggle = document.getElementById('stream-toggle');
    const updateConfigButton = document.getElementById('update-config-button');
    const configStatus = document.getElementById('config-status');
    const configEditor = document.getElementById('config-editor');

    // 初始化标准按钮事件监听器
    if (sendButton) {
        sendButton.addEventListener('click', handleSendMessage);
    }

    // 输入框按键事件 (回车键发送，Shift+回车换行)
    if (userInput) {
        userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
            }
        });

        // 页面加载时初始化 - 聚焦输入框
        userInput.focus();
    }

    // 流式响应切换按钮
    if (streamToggle) {
        streamToggle.addEventListener('click', () => {
            isStreaming = !isStreaming;
            streamToggle.classList.toggle('active', isStreaming);
        });
    }

    // 配置更新按钮
    if (updateConfigButton) {
        updateConfigButton.addEventListener('click', updateConfig);
    }

    // 标签页切换初始化
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.getAttribute('data-tab');

            // 更新活动标签
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // 更新活动内容
            tabContents.forEach(tc => tc.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
        });
    });

    // 新建对话按钮
    const newChatButton = document.getElementById('new-chat-button');
    if (newChatButton) {
        newChatButton.addEventListener('click', createNewConversation);
    }

    // 清空所有对话按钮
    const clearAllButton = document.getElementById('clear-all-button');
    if (clearAllButton) {
        clearAllButton.addEventListener('click', confirmClearAllConversations);
    }

    // 编辑标题确认按钮
    const saveTitleButton = document.getElementById('save-title-button');
    if (saveTitleButton) {
        saveTitleButton.addEventListener('click', saveConversationTitle);
    }

    // 模态对话框关闭按钮
    document.querySelectorAll('.close-button, .cancel-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.modal').forEach(modal => {
                modal.classList.remove('active');
            });
        });
    });

    // 确认删除按钮
    const confirmYesButton = document.getElementById('confirm-yes-button');
    if (confirmYesButton) {
        confirmYesButton.addEventListener('click', handleConfirmAction);
    }

    try {
        // 加载对话历史
        await fetchConversations();

        // 创建新对话如果不存在
        if (conversations.length === 0) {
            await createNewConversation();
        } else {
            // 打开最近的对话
            await openConversation(conversations[0].id);
        }
    } catch (error) {
        console.error('初始化过程出错:', error);
        if (typeof addMessage === 'function' && chatMessages) {
            addMessage('system', `初始化失败: ${error.message}`);
        } else {
            console.error('无法显示错误消息: addMessage函数未定义或chatMessages未初始化');
        }
    }
});

// 处理发送消息
async function handleSendMessage() {
    // 获取用户输入
    if (!userInput) {
        userInput = document.getElementById('user-input');
        if (!userInput) {
            console.error('用户输入框未找到');
            return;
        }
    }

    // 获取历史轮次设置
    if (!historyTurnsSelect) {
        historyTurnsSelect = document.getElementById('history-turns');
    }

    // 获取输入内容并清空输入框
    const query = userInput.value.trim();
    if (!query) return;

    // 清空输入框
    userInput.value = '';

    // 如果未选择对话，自动创建新对话
    if (!currentConversationId) {
        await createNewConversation();
    }

    // 禁用发送按钮防止重复提交
    if (sendButton) {
        sendButton.disabled = true;
        isWaitingForResponse = true;
    }

    // 添加用户消息
    addMessage('user', query);

    try {
        // 获取历史轮次设置
        const historyTurns = historyTurnsSelect ? parseInt(historyTurnsSelect.value) : 5;

        // 如果当前有进行中的流式请求，取消它
        if (currentStreamController) {
            currentStreamController.abort();
            currentStreamController = null;
        }

        // 根据流式开关设置使用不同处理方式
        if (isStreaming) {
            await handleStreamRequest(query, historyTurns);
        } else {
            await handleStandardRequest(query, historyTurns);
        }

        // 确保对话列表更新（可能有新对话被创建）
        await fetchConversations();
    } catch (error) {
        console.error('处理消息时发生错误:', error);
        addMessage('system', `处理消息时发生错误: ${error.message}`);
    } finally {
        // 重新启用发送按钮
        if (sendButton) {
            sendButton.disabled = false;
            isWaitingForResponse = false;
        }
    }
}

// 处理标准请求
async function handleStandardRequest(query, historyTurns) {
    // 显示加载指示器
    const loadingMessage = addMessage('assistant', '');
    const loadingElement = document.createElement('div');
    loadingElement.className = 'typing-indicator';
    loadingElement.innerHTML = '<span></span><span></span><span></span>';
    loadingMessage.querySelector('.message-content').appendChild(loadingElement);

    try {
        const response = await fetch(QUERY_API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query,
                conversation_id: currentConversationId,
                history_turns: historyTurns
            })
        });

        // 删除加载指示器
        const typingIndicator = loadingMessage.querySelector('.typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: "未知错误" }));

            // 针对特定错误码显示友好信息
            if (response.status === 503) {
                updateAssistantMessage(loadingMessage, `⚠️ **服务器正在维护中**\n\n${errorData.detail || "服务器正在重启或维护中，请稍后再试。"}`);
            } else {
                updateAssistantMessage(loadingMessage, `⚠️ **请求错误 (${response.status})**\n\n${errorData.detail || response.statusText}`);
            }
            return;
        }

        const data = await response.json();
        console.log("接收到非流式回复:", data); // 添加日志

        // 更新消息内容 - 使用正确的属性名answer而不是response
        updateAssistantMessage(loadingMessage, data.answer);
    } catch (error) {
        // 删除加载指示器并显示错误
        const typingIndicator = loadingMessage.querySelector('.typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }

        // 连接错误的更友好提示
        if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
            updateAssistantMessage(loadingMessage, `⚠️ **无法连接到服务器**\n\n服务器可能正在重启或维护中，请稍后再试。`);
        } else {
            updateAssistantMessage(loadingMessage, `⚠️ **处理请求时发生错误**\n\n${error.message}`);
        }
    }
}

// 工具卡片处理相关函数 ===================
// 创建工具卡片元素
function createToolCard(toolName, args, toolCallId) {
    // 创建卡片主容器
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.setAttribute('data-tool-call-id', toolCallId);

    // 根据工具名称选择合适的图标
    let iconClass = 'fa-wrench';  // 默认图标
    let iconColor = '';  // 默认使用CSS中定义的颜色

    // 根据工具类型设置不同的图标
    if (toolName.includes('search') || toolName.includes('find')) {
        iconClass = 'fa-search';
        iconColor = '#4285f4'; // Google蓝色
    } else if (toolName.includes('web') || toolName.includes('browser')) {
        iconClass = 'fa-globe';
        iconColor = '#34a853'; // Google绿色
    } else if (toolName.includes('file') || toolName.includes('read') || toolName.includes('write')) {
        iconClass = 'fa-file-alt';
        iconColor = '#ea4335'; // Google红色
    } else if (toolName.includes('terminal') || toolName.includes('run') || toolName.includes('execute')) {
        iconClass = 'fa-terminal';
        iconColor = '#333333'; // 终端黑色
    } else if (toolName.includes('edit') || toolName.includes('modify')) {
        iconClass = 'fa-edit';
        iconColor = '#fbbc05'; // Google黄色
    } else if (toolName.includes('list') || toolName.includes('directory')) {
        iconClass = 'fa-folder-open';
        iconColor = '#4285f4'; // Google蓝色
    } else if (toolName.includes('grep') || toolName.includes('code_search')) {
        iconClass = 'fa-code';
        iconColor = '#9c27b0'; // 紫色
    } else if (toolName.includes('delete') || toolName.includes('remove')) {
        iconClass = 'fa-trash-alt';
        iconColor = '#ea4335'; // Google红色
    }

    // 创建卡片头部
    const header = document.createElement('div');
    header.className = 'tool-card-header';

    // 工具标题 - 确保工具名称安全显示
    const title = document.createElement('div');
    title.className = 'tool-card-title';
    const displayName = DOMPurify.sanitize(toolName || '未知工具');
    title.innerHTML = `<i class="fas ${iconClass}" ${iconColor ? `style="color:${iconColor}"` : ''}></i> 工具：${displayName}`;

    // 展开/收起按钮
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'tool-card-toggle';
    toggleBtn.textContent = '展开';

    header.appendChild(title);
    header.appendChild(toggleBtn);
    card.appendChild(header);

    // 创建卡片内容区域
    const content = document.createElement('div');
    content.className = 'tool-card-content';
    content.style.display = 'none'; // 默认收起状态

    // 参数区域
    const argsSection = document.createElement('div');
    argsSection.className = 'tool-card-args';

    // 结果区域
    const resultSection = document.createElement('div');
    resultSection.className = 'tool-card-result';

    content.appendChild(argsSection);
    content.appendChild(resultSection);
    card.appendChild(content);

    // 添加展开/收起交互
    toggleBtn.addEventListener('click', function (e) {
        e.stopPropagation(); // 防止事件冒泡
        const isExpanded = content.style.display !== 'none';
        content.style.display = isExpanded ? 'none' : 'block';
        toggleBtn.textContent = isExpanded ? '展开' : '收起';
    });

    // 点击整个标题栏也可以展开/收起
    header.addEventListener('click', function (e) {
        if (e.target !== toggleBtn) { // 避免按钮点击事件重复触发
            toggleBtn.click();
        }
    });

    // 更新工具参数方法
    function updateArgs(argsData) {
        try {
            let argsStr;
            if (typeof argsData === 'string') {
                // 尝试解析JSON字符串，使格式更美观
                try {
                    const parsed = JSON.parse(argsData);
                    argsStr = JSON.stringify(parsed, null, 2);
                } catch {
                    // 如果不是有效JSON，直接使用原始字符串
                    argsStr = argsData;
                }
            } else {
                argsStr = JSON.stringify(argsData, null, 2);
            }

            // 使用DOMPurify清理内容
            argsSection.innerHTML = DOMPurify.sanitize('<b>请求参数：</b><pre>' + argsStr + '</pre>');
        } catch (err) {
            argsSection.innerHTML = DOMPurify.sanitize('<b>请求参数：</b><pre>无法解析参数数据</pre>');
            console.error('解析工具参数失败:', err);
        }
    }

    // 更新工具结果方法
    function updateResult(resultData) {
        try {
            let resultStr;
            if (typeof resultData === 'string') {
                // 尝试解析JSON字符串，使格式更美观
                try {
                    const parsed = JSON.parse(resultData);
                    resultStr = JSON.stringify(parsed, null, 2);
                } catch {
                    // 如果不是有效JSON，直接使用原始字符串
                    resultStr = resultData;
                }
            } else {
                resultStr = JSON.stringify(resultData, null, 2);
            }

            // 使用DOMPurify清理内容
            resultSection.innerHTML = DOMPurify.sanitize('<b>返回结果：</b><pre>' + resultStr + '</pre>');

            // 自动展开显示结果
            if (content.style.display === 'none') {
                toggleBtn.click();
            }

            // 如果结果很长，添加一个"复制"按钮
            if (resultStr && resultStr.length > 100) {
                const copyBtn = document.createElement('button');
                copyBtn.className = 'copy-result-btn';
                copyBtn.textContent = '复制结果';
                copyBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    navigator.clipboard.writeText(resultStr).then(() => {
                        const originalText = copyBtn.textContent;
                        copyBtn.textContent = '已复制!';
                        setTimeout(() => {
                            copyBtn.textContent = originalText;
                        }, 1000);
                    }).catch(err => {
                        console.error('复制失败:', err);
                        copyBtn.textContent = '复制失败';
                    });
                });
                resultSection.appendChild(copyBtn);
            }
        } catch (err) {
            resultSection.innerHTML = DOMPurify.sanitize('<b>返回结果：</b><pre>无法解析结果数据</pre>');
            console.error('解析工具结果失败:', err);
        }
    }

    // 初始化参数区域
    updateArgs(args || {});

    return {
        element: card,
        updateArgs,
        updateResult
    };
}

// 管理工具卡片的工具箱对象
function createToolCardManager() {
    let cards = {}; // 存储所有卡片的映射表：toolCallId -> card对象

    return {
        // 获取或创建卡片
        getOrCreateCard(toolName, args, toolCallId, container) {
            if (!toolCallId) {
                console.error('创建工具卡片失败: 缺少tool_call_id');
                return null;
            }

            if (!cards[toolCallId]) {
                const card = createToolCard(toolName, args, toolCallId);
                if (card && container) {
                    container.appendChild(card.element);
                    cards[toolCallId] = card;
                }
            }
            return cards[toolCallId];
        },

        // 更新卡片参数
        updateCardArgs(toolCallId, args) {
            if (cards[toolCallId]) {
                cards[toolCallId].updateArgs(args);
            }
        },

        // 更新卡片结果
        updateCardResult(toolCallId, result) {
            if (cards[toolCallId]) {
                cards[toolCallId].updateResult(result);
            } else {
                console.warn(`尝试更新不存在的工具卡片: ${toolCallId}`);
            }
        },

        // 清空所有卡片
        clear() {
            for (const id in cards) {
                if (cards[id].element && cards[id].element.parentNode) {
                    cards[id].element.parentNode.removeChild(cards[id].element);
                }
            }
            cards = {};
        }
    };
}

// 在处理流式请求的函数中，找到处理chunk的部分，修改为支持工具类型消息
async function handleStreamRequest(query, historyTurns) {
    // 添加助手消息占位符
    const assistantMessage = addMessage('assistant', '');
    const contentElement = assistantMessage.querySelector('.message-content');
    if (!contentElement) {
        console.error('聊天消息容器未找到');
        return;
    }

    // 添加打字指示器
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'typing-indicator';
    typingIndicator.innerHTML = '<span></span><span></span><span></span>';
    contentElement.appendChild(typingIndicator);

    // 初始化响应处理变量
    let buffer = '';
    let firstChunk = true;
    let hasFinalContent = false;
    let typingTimeout = null;

    // 闪烁光标效果
    const cursorElement = document.createElement('span');
    cursorElement.className = 'typing-cursor';
    cursorElement.textContent = '|';

    // 创建Markdown内容容器
    const mdContainer = document.createElement('div');
    mdContainer.className = 'markdown-content-stream';

    // 创建工具卡片容器
    const toolCardsContainer = document.createElement('div');
    toolCardsContainer.className = 'tool-cards-container';

    // 创建工具卡片管理器
    const toolCardManager = createToolCardManager();

    try {
        // 创建新的AbortController
        currentStreamController = new AbortController();

        // 发送流式请求
        const response = await fetch(STREAM_API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query,
                conversation_id: currentConversationId,
                history_turns: historyTurns
            }),
            signal: currentStreamController.signal
        });

        // 移除打字指示器并添加内容容器 - 修改顺序，先添加工具卡片容器，再添加Markdown容器
        if (contentElement.contains(typingIndicator)) {
            contentElement.removeChild(typingIndicator);
            contentElement.appendChild(toolCardsContainer); // 工具卡片容器放在上方
            contentElement.appendChild(mdContainer); // Markdown内容容器放在下方
        }

        if (!response.ok) {
            // 处理错误响应
            const errorData = await response.json().catch(() => ({ detail: "未知错误" }));

            // 根据不同状态码显示不同信息
            if (response.status === 503) {
                updateMarkdownContent(mdContainer, `⚠️ **服务器正在维护中**\n\n${errorData.detail || "服务器正在重启或维护中，请稍后再试。"}`);
            } else {
                updateMarkdownContent(mdContainer, `⚠️ **请求错误 (${response.status})**\n\n${errorData.detail || response.statusText}`);
            }
            return;
        }

        // 添加闪烁光标
        mdContainer.appendChild(cursorElement);
        startCursorBlink();

        // 获取响应流
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        // 处理流数据
        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            // 解码当前块
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            // 处理每行数据
            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const data = JSON.parse(line);

                    // 处理工具调用事件
                    if (data.type === 'tool_call') {
                        const { tool_name, args, tool_call_id } = data;
                        toolCardManager.getOrCreateCard(tool_name, args, tool_call_id, toolCardsContainer);
                        continue;
                    }

                    // 处理工具结果事件
                    if (data.type === 'tool_result') {
                        const { tool_call_id, result } = data;
                        toolCardManager.updateCardResult(tool_call_id, result);
                        continue;
                    }

                    // 根据数据类型处理
                    if (data.type === 'content' && data.content) {
                        buffer += data.content;
                        updateStreamingContent(mdContainer, buffer);
                        resetCursorBlink();
                    }
                    else if (data.type === 'final' && data.content) {
                        buffer = data.content;
                        hasFinalContent = true;

                        // 移除光标并显示最终内容
                        stopCursorBlink();
                        if (mdContainer.contains(cursorElement)) {
                            mdContainer.removeChild(cursorElement);
                        }

                        // 最终内容直接更新到当前消息，不创建新消息
                        updateMarkdownContent(mdContainer, buffer);
                    }
                    else if (data.type === 'error') {
                        stopCursorBlink();
                        if (mdContainer.contains(cursorElement)) {
                            mdContainer.removeChild(cursorElement);
                        }
                        updateMarkdownContent(mdContainer, `⚠️ **错误**\n\n${data.error || '未知错误'}`);
                    }

                    scrollToBottom();
                } catch (e) {
                    console.error('解析流数据错误:', e, line);
                }
            }
        }

        // 确保最终内容已显示并移除光标
        if (!hasFinalContent) {
            stopCursorBlink();
            if (mdContainer.contains(cursorElement)) {
                mdContainer.removeChild(cursorElement);
            }
            // 直接更新当前消息内容，不调用updateAssistantMessage
            updateMarkdownContent(mdContainer, buffer);
        }
    } catch (error) {
        // 移除打字指示器和光标
        stopCursorBlink();
        if (contentElement.contains(typingIndicator)) {
            contentElement.removeChild(typingIndicator);
        }

        // 确保工具卡片容器已添加到DOM中
        if (!contentElement.querySelector('.tool-cards-container')) {
            contentElement.appendChild(toolCardsContainer);
        }

        // 创建或确保Markdown容器存在
        let markdownContainer = contentElement.querySelector('.markdown-content-stream');
        if (!markdownContainer) {
            markdownContainer = document.createElement('div');
            markdownContainer.className = 'markdown-content-stream';
            contentElement.appendChild(markdownContainer);
        }

        if (mdContainer.contains(cursorElement)) {
            mdContainer.removeChild(cursorElement);
        }

        // 显示错误信息
        if (error.name === 'AbortError') {
            // 请求被取消，不显示错误信息
            console.log('流式请求被取消');
        } else if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
            // 连接错误的更友好提示
            updateMarkdownContent(markdownContainer, `⚠️ **无法连接到服务器**\n\n服务器可能正在重启或维护中，请稍后再试。`);
        } else {
            // 其他错误
            updateMarkdownContent(markdownContainer, `⚠️ **处理请求时发生错误**\n\n${error.message}`);
        }
    } finally {
        // 清除AbortController引用
        currentStreamController = null;
    }

    // 启动光标闪烁效果
    function startCursorBlink() {
        cursorElement.style.opacity = '1';
        typingTimeout = setInterval(() => {
            cursorElement.style.opacity = cursorElement.style.opacity === '0' ? '1' : '0';
        }, 500);
    }

    // 重置光标闪烁 (重新开始计时)
    function resetCursorBlink() {
        if (cursorElement) {
            cursorElement.style.opacity = '1';
            if (typingTimeout) {
                clearInterval(typingTimeout);
            }
            typingTimeout = setInterval(() => {
                cursorElement.style.opacity = cursorElement.style.opacity === '0' ? '1' : '0';
            }, 500);
        }
    }

    // 停止光标闪烁
    function stopCursorBlink() {
        if (typingTimeout) {
            clearInterval(typingTimeout);
            typingTimeout = null;
        }
    }

    // 更新流式内容 (简单格式化)
    function updateStreamingContent(container, content) {
        // 移除当前的光标
        if (container.contains(cursorElement)) {
            container.removeChild(cursorElement);
        }

        // 格式化内容
        let formattedContent = content
            // 格式化粗体
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // 格式化斜体
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            // 格式化行内代码
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            // 替换换行
            .replace(/\n/g, '<br>');

        // 更新内容并添加光标
        container.innerHTML = DOMPurify.sanitize(formattedContent);
        container.appendChild(cursorElement);
    }
}

// 打开编辑标题模态框
function openEditTitleModal(conversationId, currentTitle) {
    const modal = document.getElementById('edit-title-modal');
    const input = document.getElementById('conversation-title-input');

    // 设置当前值和数据
    input.value = currentTitle || '';
    document.getElementById('save-title-button').dataset.conversationId = conversationId;

    // 显示模态框并聚焦输入框
    modal.classList.add('active');
    input.focus();
}

// 保存对话标题
async function saveConversationTitle() {
    const modal = document.getElementById('edit-title-modal');
    const input = document.getElementById('conversation-title-input');
    const saveButton = document.getElementById('save-title-button');
    const conversationId = saveButton.dataset.conversationId;
    const newTitle = input.value.trim() || '新对话';

    try {
        const response = await fetch(`${CONVERSATIONS_API_ENDPOINT}/${conversationId}/title`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTitle })
        });

        if (!response.ok) throw new Error(`服务器错误: ${response.status}`);

        // 更新本地对话列表
        const conversation = conversations.find(c => c.id === conversationId);
        if (conversation) {
            conversation.title = newTitle;
            updateConversationsList();
        }

        // 关闭模态框
        modal.classList.remove('active');
    } catch (error) {
        console.error('更新对话标题失败:', error);
        alert(`更新对话标题失败: ${error.message}`);
    }
}

// 确认删除对话
function confirmDeleteConversation(conversationId) {
    const modal = document.getElementById('confirm-modal');
    const message = document.getElementById('confirm-message');
    const confirmButton = document.getElementById('confirm-yes-button');

    message.textContent = '确定要删除此对话吗？此操作不可撤销。';
    confirmButton.dataset.action = 'delete-conversation';
    confirmButton.dataset.conversationId = conversationId;

    modal.classList.add('active');
}

// 确认清空所有对话
function confirmClearAllConversations() {
    const modal = document.getElementById('confirm-modal');
    const message = document.getElementById('confirm-message');
    const confirmButton = document.getElementById('confirm-yes-button');

    if (!modal || !message || !confirmButton) {
        console.error('确认模态框元素未找到');
        return;
    }

    message.textContent = '确定要清空所有对话吗？此操作不可撤销。';
    confirmButton.dataset.action = 'clear-all-conversations';

    modal.classList.add('active');
}

// 处理确认操作
async function handleConfirmAction() {
    const confirmButton = document.getElementById('confirm-yes-button');
    const modal = document.getElementById('confirm-modal');

    if (!confirmButton || !modal) {
        console.error('确认按钮或模态框元素未找到');
        return;
    }

    const action = confirmButton.dataset.action;

    try {
        if (action === 'delete-conversation') {
            const conversationId = confirmButton.dataset.conversationId;
            await deleteConversation(conversationId);
        } else if (action === 'clear-all-conversations') {
            await clearAllConversations();
        }

        // 关闭模态框
        modal.classList.remove('active');
    } catch (error) {
        console.error('操作失败:', error);
        alert(`操作失败: ${error.message}`);
        modal.classList.remove('active');
    }
}

// 删除指定对话
async function deleteConversation(conversationId) {
    if (!confirm('确定要删除此对话吗？此操作不可撤销。')) return;

    try {
        const response = await fetch(`${CONVERSATIONS_API_ENDPOINT}/${conversationId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error(`服务器错误: ${response.status}`);
    } catch (error) {
        console.error('删除对话失败:', error);
        alert(`删除对话失败: ${error.message}`);
    }
}

// 清空所有对话
async function clearAllConversations() {
    try {
        const response = await fetch(CONVERSATIONS_API_ENDPOINT, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error(`服务器错误: ${response.status}`);

        // 刷新对话列表
        await fetchConversations();

        // 清空当前对话ID
        currentConversationId = null;

        // 清空聊天界面
        if (chatMessages) {
            chatMessages.innerHTML = '';
        }

        // 创建新对话
        await createNewConversation();
    } catch (error) {
        console.error('清空所有对话失败:', error);
        throw error;
    }
}

// 配置编辑器自动初始化
setTimeout(() => {
    const configEditor = document.getElementById('config-editor');
    if (configEditor && window.CodeMirror && !window.cmConfigEditor) {
        console.log('自动初始化配置编辑器...');

        // 尝试移除现有的CodeMirror实例
        const existingCM = configEditor.nextSibling;
        if (existingCM && existingCM.classList && existingCM.classList.contains('CodeMirror')) {
            existingCM.remove();
        }

        // 创建编辑器实例
        const cmEditor = window.CodeMirror.fromTextArea(configEditor, {
            mode: { name: "javascript", json: true },
            theme: "dracula",
            lineNumbers: true,
            autoCloseBrackets: true,
            matchBrackets: true,
            indentUnit: 4,
            lineWrapping: true,
            foldGutter: true,
            gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
        });

        // 加载配置
        fetch('/api/config')
            .then(response => response.json())
            .then(config => {
                cmEditor.setValue(JSON.stringify(config, null, 4));
                console.log('配置加载完成');

                // 设置编辑器自适应高度
                setTimeout(() => {
                    cmEditor.refresh();
                }, 200);
            })
            .catch(error => {
                console.error('加载配置错误:', error);
            });

        // 存储到全局
        window.cmConfigEditor = cmEditor;

        // 监听标签切换，刷新编辑器大小
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabId = tab.getAttribute('data-tab');
                if (tabId === 'config-tab' && window.cmConfigEditor) {
                    setTimeout(() => {
                        window.cmConfigEditor.refresh();
                    }, 50);
                }
            });
        });
    }
}, 100);

// 更新配置
async function updateConfig() {
    const configStatus = document.getElementById('config-status');
    const updateConfigButton = document.getElementById('update-config-button');

    if (!configStatus || !updateConfigButton) {
        console.error('配置状态或更新按钮元素未找到');
        return;
    }

    try {
        // 获取编辑器实例
        const editor = window.cmConfigEditor;
        if (!editor) {
            showConfigStatus('error', '配置编辑器未初始化', configStatus);
            return;
        }

        const configJson = editor.getValue();
        const configData = JSON.parse(configJson);

        updateConfigButton.disabled = true;
        updateConfigButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 更新中...';

        const response = await fetch('/api/config/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: configData })
        });

        const result = await response.json();

        if (response.ok) {
            configStatus.textContent = '配置更新中，服务器正在重启...';
            configStatus.className = 'status-message info';

            // 如果后端返回了更新ID，则开始轮询状态
            if (result.update_id) {
                pollConfigUpdateStatus(result.update_id);
            } else {
                // 没有更新ID时的处理
                setTimeout(() => {
                    configStatus.textContent = '配置已更新，但无法跟踪重启状态';
                    configStatus.className = 'status-message success';
                    updateConfigButton.disabled = false;
                    updateConfigButton.innerHTML = '<i class="fas fa-save"></i> 更新配置';
                }, 2000);
            }
        } else {
            configStatus.textContent = `更新失败: ${result.message || '未知错误'}`;
            configStatus.className = 'status-message error';
            updateConfigButton.disabled = false;
            updateConfigButton.innerHTML = '<i class="fas fa-save"></i> 更新配置';
        }
    } catch (error) {
        console.error('更新配置错误:', error);
        showConfigStatus('error', `配置格式错误: ${error.message}`, configStatus);
        updateConfigButton.disabled = false;
        updateConfigButton.innerHTML = '<i class="fas fa-save"></i> 更新配置';
    }
}

// 轮询配置更新状态
async function pollConfigUpdateStatus(updateId, attempts = 0) {
    const configStatus = document.getElementById('config-status');
    const updateConfigButton = document.getElementById('update-config-button');

    if (!configStatus || !updateConfigButton) {
        console.error('配置状态或更新按钮元素未找到');
        return;
    }

    // 最大尝试次数 (60秒)
    const maxAttempts = 60;

    try {
        const response = await fetch('/api/config/status');
        if (!response.ok) {
            throw new Error(`服务器错误: ${response.status}`);
        }

        const statusData = await response.json();

        // 检查是否为当前更新ID
        if (statusData.update_id !== updateId) {
            console.log('更新ID不匹配，可能是另一个更新进程');
            updateConfigButton.disabled = false;
            updateConfigButton.innerHTML = '<i class="fas fa-save"></i> 更新配置';
            return;
        }

        // 更新状态显示
        if (statusData.updating) {
            // 仍在更新中
            configStatus.textContent = statusData.message || '配置更新中，服务器正在重启...';
            configStatus.className = 'status-message info';

            // 继续轮询
            if (attempts < maxAttempts) {
                setTimeout(() => pollConfigUpdateStatus(updateId, attempts + 1), 1000);
            } else {
                // 超时
                configStatus.textContent = '配置更新超时，请刷新页面查看状态';
                configStatus.className = 'status-message warning';
                updateConfigButton.disabled = false;
                updateConfigButton.innerHTML = '<i class="fas fa-save"></i> 更新配置';
            }
        } else {
            // 更新已完成
            if (statusData.success) {
                configStatus.textContent = statusData.message || '配置已成功更新并应用！';
                configStatus.className = 'status-message success';
            } else {
                configStatus.textContent = statusData.message || '配置更新失败';
                configStatus.className = 'status-message error';
            }

            updateConfigButton.disabled = false;
            updateConfigButton.innerHTML = '<i class="fas fa-save"></i> 更新配置';

            // 5秒后清除状态消息
            setTimeout(() => {
                if (configStatus.textContent === statusData.message) {
                    configStatus.textContent = '';
                    configStatus.className = 'status-message';
                }
            }, 5000);
        }
    } catch (error) {
        console.error('轮询配置状态错误:', error);

        // 如果服务器正在重启中，可能暂时无法连接，继续轮询
        if (attempts < maxAttempts) {
            // 更新状态消息以反映连接问题
            if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
                configStatus.textContent = '正在等待服务器重启完成...';
                configStatus.className = 'status-message info';
            }

            // 增加轮询间隔，减小服务器负担
            const delay = Math.min(1000 * (1 + attempts * 0.1), 3000); // 逐渐增加延迟，最大3秒
            setTimeout(() => pollConfigUpdateStatus(updateId, attempts + 1), delay);
        } else {
            configStatus.textContent = `无法获取更新状态: ${error.message}`;
            configStatus.className = 'status-message error';
            updateConfigButton.disabled = false;
            updateConfigButton.innerHTML = '<i class="fas fa-save"></i> 更新配置';
        }
    }
}

// 显示配置状态消息
function showConfigStatus(type, message, statusElement) {
    if (!statusElement) {
        statusElement = document.getElementById('config-status');
        if (!statusElement) {
            console.error('配置状态元素未找到');
            return;
        }
    }

    statusElement.textContent = message;
    statusElement.className = 'status-message ' + type;

    // 5秒后自动隐藏
    setTimeout(() => {
        statusElement.className = 'status-message';
    }, 5000);
}