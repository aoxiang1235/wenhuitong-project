import React, { useState, useRef, useEffect } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import './Chat.css';

// 动态导入js-tiktoken，避免构建时错误
let encoding_for_model = null;
let tiktokenAvailable = false;

// 尝试初始化tiktoken
const initTiktoken = async () => {
    try {
        const tiktoken = await import('js-tiktoken');
        encoding_for_model = tiktoken.encoding_for_model;
        tiktokenAvailable = true;
        console.log('js-tiktoken initialized successfully');
    } catch (error) {
        console.warn('js-tiktoken not available, falling back to simple estimation:', error);
        tiktokenAvailable = false;
    }
};

const Chat = () => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [useStreaming, setUseStreaming] = useState(true);
    const [useTokenCounting, setUseTokenCounting] = useState(true);
    const [tokenStats, setTokenStats] = useState(null);
    const [streamingStats, setStreamingStats] = useState(null);
    const [tokenMethod, setTokenMethod] = useState('local'); // local, api, tiktoken
    const chatWindowRef = useRef(null);
    const abortControllerRef = useRef(null);
    const encoderRef = useRef(null);

    // 初始化js-tiktoken编码器
    useEffect(() => {
        initTiktoken().then(() => {
            if (tiktokenAvailable && encoding_for_model) {
                try {
                    encoderRef.current = encoding_for_model('qwen');
                    console.log('TikToken encoder initialized');
                } catch (error) {
                    console.warn('Failed to initialize TikToken encoder:', error);
                    tiktokenAvailable = false;
                }
            }
        });
        
        return () => {
            if (encoderRef.current) {
                try {
                    encoderRef.current.free();
                } catch (error) {
                    console.warn('Error freeing encoder:', error);
                }
            }
        };
    }, []);

    // Token估算函数，支持多种方法
    const estimateTokens = async (text) => {
        if (!text) return 0;
        
        // 方法1: 使用js-tiktoken（免费且较准确）
        if (tokenMethod === 'tiktoken' && tiktokenAvailable && encoderRef.current) {
            try {
                return encoderRef.current.encode(text).length;
            } catch (error) {
                console.warn('TikToken estimation failed:', error);
            }
        }
        
        // 方法2: 调用后端API（有费用但最准确）
        if (tokenMethod === 'api') {
            try {
                const response = await fetch('http://localhost:8000/api/tokenize/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, method: 'api' }),
                });
                
                if (response.ok) {
                    const data = await response.json();
                    return data.token_count;
                }
            } catch (error) {
                console.warn('API tokenization failed:', error);
            }
        }
        
        // 方法3: 本地简单估算（免费但不够精确）
        const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
        const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
        const otherChars = text.length - chineseChars - englishWords;
        
        return Math.ceil(chineseChars + englishWords * 1.3 + otherChars * 0.5);
    };

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
            setStreamingStats(null);
        }
    };

    const handleSend = async () => {
        if (input.trim()) {
            setIsStreaming(true);
            setTokenStats(null);
            setStreamingStats(null);
            const userMessage = { text: input, sender: 'user' };
            setMessages(prevMessages => [...prevMessages, userMessage]);
            const currentInput = input;
            setInput('');

            if (useStreaming) {
                abortControllerRef.current = new AbortController();
                let botMessageAccumulator = { text: '', sender: 'bot' };
                let botMessageIndex = -1;

                try {
                    await fetchEventSource('http://localhost:8000/api/chat/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            message: currentInput, 
                            use_streaming: true,
                            use_token_counting: useTokenCounting
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
                                    // 处理文本消息
                                    botMessageAccumulator.text += data.text;
                                    setMessages(prev => prev.map((msg, idx) => 
                                        idx === botMessageIndex ? { ...botMessageAccumulator } : msg
                                    ));
                                } else if (event.event === 'token_info') {
                                    // 处理Token统计信息
                                    if (data.type === 'input') {
                                        setStreamingStats({
                                            input_tokens: data.input_tokens,
                                            output_tokens: 0,
                                            total_tokens: data.input_tokens,
                                            is_estimate: false,
                                            method: 'dashscope'
                                        });
                                    } else if (data.type === 'progress' || data.type === 'final') {
                                        setStreamingStats({
                                            input_tokens: data.input_tokens || streamingStats?.input_tokens || 0,
                                            output_tokens: data.output_tokens,
                                            total_tokens: data.total_tokens,
                                            is_estimate: false,
                                            method: 'dashscope'
                                        });
                                    }
                                }
                            } catch (error) {
                                console.error('解析消息错误:', error);
                            }
                        },
                        onclose: () => {
                            setIsStreaming(false);
                            // 流式结束后，将统计转换为最终统计
                            if (streamingStats) {
                                setTokenStats(streamingStats);
                                setStreamingStats(null);
                            }
                        },
                        onerror: (err) => {
                            console.error('流式请求错误:', err);
                            setIsStreaming(false);
                            setStreamingStats(null);
                        }
                    });
                } catch (error) {
                    console.error('发送请求错误:', error);
                    setMessages(prev => [...prev, { text: "抱歉，连接出错了。", sender: 'bot' }]);
                    setIsStreaming(false);
                    setStreamingStats(null);
                }
            } else {
                try {
                    const response = await fetch('http://localhost:8000/api/chat/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            message: currentInput, 
                            use_streaming: false,
                            use_token_counting: useTokenCounting
                        }),
                    });

                    if (response.ok) {
                        const data = await response.json();
                        setMessages(prev => [...prev, { text: data.text, sender: 'bot' }]);
                        setTokenStats(data.stats);
                    } else {
                        setMessages(prev => [...prev, { text: "抱歉，服务出错了。", sender: 'bot' }]);
                    }
                } catch (error) {
                    console.error('非流式请求错误:', error);
                    setMessages(prev => [...prev, { text: "抱歉，连接出错了。", sender: 'bot' }]);
                }
                setIsStreaming(false);
            }
        }
    };

    const getMethodDisplay = (method) => {
        switch (method) {
            case 'tiktoken': return 'TikToken (免费)';
            case 'api': return '官方API (收费)';
            case 'local': return '本地估算 (免费)';
            default: return method;
        }
    };

    return (
        <div className="chat-container">
            <div className="chat-window" ref={chatWindowRef}>
                {messages.length === 0 && (
                    <div className="welcome-message">
                        欢迎使用AI聊天助手！请输入您的问题。
                    </div>
                )}
                {messages.map((msg, index) => (
                    <div key={index} className={`message ${msg.sender}`}>
                        {msg.text}
                    </div>
                ))}
            </div>
            
            {/* 实时流式统计 */}
            {streamingStats && (
                <div className="token-stats streaming">
                    <div className="stats-content">
                        输入: {streamingStats.input_tokens} tokens | 输出: {streamingStats.output_tokens} tokens | 总计: {streamingStats.total_tokens} tokens
                    </div>
                    <div className="stats-note">
                        <span className="pulse">●</span> 实时统计中...
                        <span className="method-badge">{streamingStats.method === 'dashscope' ? 'DashScope (准确)' : '估算'}</span>
                    </div>
                </div>
            )}
            
            {/* 最终统计（非流式或流式结束后） */}
            {tokenStats && !streamingStats && (
                <div className="token-stats">
                    <div className="stats-content">
                        输入: {tokenStats.input_tokens} tokens | 输出: {tokenStats.output_tokens} tokens | 总计: {tokenStats.total_tokens} tokens
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
                
                <label>
                    <input 
                        type="checkbox" 
                        checked={useTokenCounting} 
                        onChange={(e) => setUseTokenCounting(e.target.checked)}
                        disabled={isStreaming}
                    />
                    Token统计
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
    );
};

export default Chat;