import React, { useState, useRef, useEffect } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import ReactMarkdown from 'react-markdown';
import './Chat.css';

const Chat = () => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [useStreaming, setUseStreaming] = useState(true);
    const [tokenStats, setTokenStats] = useState(null);
    const chatWindowRef = useRef(null);
    const abortControllerRef = useRef(null);
    const [sessionTopic, setSessionTopic] = useState('');
    const topicRequestId = useRef(0);
    const [sessions, setSessions] = useState([]); // 历史会话
    const [currentSessionId, setCurrentSessionId] = useState(Date.now());

    const scrollToBottom = () => {
        if (chatWindowRef.current) {
            chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
        }
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleStop = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            setIsStreaming(false);
        }
    };

    const generateTopic = async (msgs) => {
        const currentRequestId = ++topicRequestId.current;
        try {
            const response = await fetch('http://localhost:8000/api/generate_topic/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: msgs }),
            });
            if (response.ok) {
                const data = await response.json();
                if (currentRequestId === topicRequestId.current) {
                    setSessionTopic(data.topic);
                }
            }
        } catch {
            // 可忽略错误
        }
    };

    // 只在第一条消息后生成主题
    useEffect(() => {
        if (messages.length === 1) {
            generateTopic(messages);
        }
    }, [messages]);

    const handleSend = async () => {
        if (input.trim()) {
            setIsStreaming(true);
            setTokenStats(null);
            const userMessage = { text: input, sender: 'user', timestamp: Date.now() };
            const newMessages = [...messages, userMessage];
            setMessages(newMessages);
            const currentInput = input;
            setInput('');

            if (useStreaming) {
                abortControllerRef.current = new AbortController();
                let botMessageAccumulator = { text: '', sender: 'bot', timestamp: Date.now() };
                let botMessageIndex = -1;

                try {
                    await fetchEventSource('http://localhost:8000/api/chat/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            message: currentInput, 
                            use_streaming: true
                        }),
                        signal: abortControllerRef.current.signal,
                        onopen: async (response) => {
                            if (!response.ok) { 
                                throw new Error(`API error: ${response.status}`); 
                            }
                            setMessages(prev => {
                                botMessageIndex = prev.length;
                                return [...prev, botMessageAccumulator];
                            });
                        },
                        onmessage: (event) => {
                            try {
                                const data = JSON.parse(event.data);
                                if (event.event === 'message') {
                                    botMessageAccumulator.text += data.text;
                                    botMessageAccumulator.timestamp = Date.now();
                                    setMessages(prev => {
                                        const updated = prev.map((msg, idx) =>
                                            idx === botMessageIndex ? { ...botMessageAccumulator, prompt_tokens: data.prompt_tokens, completion_tokens: data.completion_tokens, total_tokens: data.total_tokens } : msg
                                        );
                                        return updated;
                                    });
                                }
                            } catch (error) {
                                console.error('解析消息错误:', error);
                            }
                        },
                        onclose: () => {
                            setIsStreaming(false);
                        },
                        onerror: (err) => {
                            console.error('流式请求错误:', err);
                            setIsStreaming(false);
                        }
                    });
                } catch (error) {
                    console.error('发送请求错误:', error);
                    setMessages(prev => [...prev, { text: "抱歉，连接出错了。", sender: 'bot', timestamp: Date.now() }]);
                    setIsStreaming(false);
                }
            } else {
                try {
                    const response = await fetch('http://localhost:8000/api/chat/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            message: currentInput, 
                            use_streaming: false
                        }),
                    });

                    if (response.ok) {
                        const data = await response.json();
                        setMessages(prev => {
                            const updated = [...prev];
                            // 直接读取根级token字段
                            const promptTokens = data.prompt_tokens;
                            const completionTokens = data.completion_tokens;
                            const totalTokens = data.total_tokens;
                            // 给最后一条用户消息加上 prompt_tokens
                            if (promptTokens !== undefined) {
                                updated[updated.length - 1] = {
                                    ...updated[updated.length - 1],
                                    prompt_tokens: promptTokens
                                };
                            }
                            // bot消息
                            const botMsg = {
                                text: data.text,
                                sender: 'bot',
                                timestamp: Date.now(),
                                prompt_tokens: promptTokens,
                                completion_tokens: completionTokens,
                                total_tokens: totalTokens
                            };
                            return [...updated, botMsg];
                        });
                    } else {
                        setMessages(prev => [...prev, { text: "抱歉，服务出错了。", sender: 'bot', timestamp: Date.now() }]);
                    }
                } catch (error) {
                    console.error('非流式请求错误:', error);
                    setMessages(prev => [...prev, { text: "抱歉，连接出错了。", sender: 'bot', timestamp: Date.now() }]);
                }
                setIsStreaming(false);
            }
        }
    };

    // 新建会话函数
    const handleNewSession = () => {
        // 仅当当前会话有内容且未在sessions中时才保存，防止重复
        if ((messages.length > 0 || sessionTopic) && !sessions.some(s => s.id === currentSessionId)) {
            setSessions(prev => [
                ...prev,
                {
                    id: currentSessionId,
                    topic: sessionTopic || '未命名会话',
                    messages,
                    createdAt: new Date().toISOString()
                }
            ]);
        }
        // 清空当前会话
        setMessages([]);
        setSessionTopic('');
        setTokenStats(null);
        setInput('');
        const newId = Date.now();
        setCurrentSessionId(newId);
    };

    const handleSwitchSession = (id) => {
        // 保存当前会话
        if (messages.length > 0 || sessionTopic) {
            setSessions(prev => prev.map(s =>
                s.id === currentSessionId
                    ? { ...s, messages, topic: sessionTopic }
                    : s
            ));
        }
        // 加载目标会话
        const target = sessions.find(s => s.id === id);
        if (target) {
            setMessages(target.messages);
            setSessionTopic(target.topic);
            setCurrentSessionId(id);
        }
    };

    // 删除会话
    const handleDeleteSession = (id, e) => {
        e.stopPropagation(); // 防止触发切换
        setSessions(prev => prev.filter(s => s.id !== id));
    };

    // 加载本地历史会话
    useEffect(() => {
        const saved = localStorage.getItem('chat_sessions');
        if (saved) {
            setSessions(JSON.parse(saved));
        }
    }, []);

    // sessions变化时写入本地
    useEffect(() => {
        localStorage.setItem('chat_sessions', JSON.stringify(sessions));
    }, [sessions]);

    // 清空历史会话
    const handleClearHistory = () => {
        setSessions([]);
        localStorage.removeItem('chat_sessions');
    };

    return (
        <div style={{ display: 'flex' }}>
            {/* 左侧会话栏 */}
            <div className="sidebar">
                <div style={{textAlign: 'center', marginBottom: 12}}>
                    <button className="clear-history-btn" onClick={handleClearHistory}>清空历史</button>
                </div>
                {sessions.map(session => (
                    <div
                        key={session.id}
                        className={`session-item${session.id === currentSessionId ? ' active' : ''}`}
                        onClick={() => handleSwitchSession(session.id)}
                        style={{ display: 'flex', alignItems: 'float', justifyContent: 'space-between' }}
                    >
                        <span>{session.topic.replace(/^主题：/, '')}</span>
                        <button
                            className="delete-session-btn"
                            onClick={e => handleDeleteSession(session.id, e)}
                            title="删除会话"
                        >✕</button>
                    </div>
                ))}
            </div>
            {/* 主内容区 */}
            <div className="chat-container" style={{ marginLeft: 220 }}>
                {/* 新建会话按钮 */}
                <div style={{ textAlign: 'right', marginBottom: 8 }}>
                    <button className="new-session-btn" onClick={handleNewSession}>新建会话</button>
                </div>
                {sessionTopic && (
                    <div className="session-topic">{sessionTopic.replace(/^主题：/, '')}</div>
                )}
                {/* 新增总token统计 */}
                <div className="total-tokens">
                    本会话总Token消耗：{
                        messages
                            .filter(msg => msg.sender === 'bot' && typeof msg.total_tokens === 'number')
                            .reduce((sum, msg) => sum + msg.total_tokens, 0)
                    }
                </div>
                <div className="chat-window" ref={chatWindowRef}>
                    {messages.length === 0 && (
                        <div className="welcome-message">
                            欢迎使用AI聊天助手！请输入您的问题。
                        </div>
                    )}
                    {messages.map((msg, index) => (
                        <div key={index} className={`message-wrapper`}>
                            <div className={`message ${msg.sender}`}>
                                {msg.sender === 'bot' ? (
                                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                                ) : (
                                    msg.text
                                )}
                            </div>
                            <div className="msg-meta">
                                {msg.timestamp && (
                                    <span className="msg-time">{new Date(msg.timestamp).toLocaleString()}</span>
                                )}
                                {/* 用户消息下展示输入token */}
                                {msg.sender === 'user' && msg.prompt_tokens !== undefined && (
                                    <span className="msg-tokens">输入: {msg.prompt_tokens}</span>
                                )}
                                {/* bot消息下展示输入/输出/总计token */}
                                {msg.sender === 'bot' && (msg.prompt_tokens !== undefined || msg.completion_tokens !== undefined || msg.total_tokens !== undefined) && (
                                    <span className="msg-tokens">
                                        输入: {msg.prompt_tokens !== undefined ? msg.prompt_tokens : '-'}
                                        &nbsp;输出: {msg.completion_tokens !== undefined ? msg.completion_tokens : '-'}
                                        &nbsp;总计: {msg.total_tokens !== undefined ? msg.total_tokens : '-'}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                
                {tokenStats && (
                    <div className="token-stats">
                        <div className="stats-content">
                            输入: {tokenStats.prompt_tokens} tokens | 输出: {tokenStats.completion_tokens} tokens | 总计: {tokenStats.total_tokens} tokens
                        </div>
                        {tokenStats.is_estimate ? (
                            <div className="stats-note">
                                <span className="estimate-icon">ℹ</span> 估算值，仅供参考
                            </div>
                        ) : (
                            <div className="stats-note">
                                <span className="official-icon">✓</span> 官方统计
                            </div>
                        )}
                    </div>
                )}
                
                <div className="controls">
                    <label>
                        <input 
                            type="checkbox" 
                            checked={useStreaming} 
                            onChange={(e) => setUseStreaming(e.target.checked)}
                            disabled={isStreaming}
                        />
                        流式响应
                    </label>
                </div>
                <div className="chat-input">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={(e) => !isStreaming && e.key === 'Enter' && handleSend()}
                        placeholder="输入消息..."
                        disabled={isStreaming}
                    />
                    {isStreaming ? (
                        <button onClick={handleStop} className="stop-button">停止</button>
                    ) : (
                        <button onClick={handleSend}>发送</button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Chat;