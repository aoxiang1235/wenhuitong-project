#!/usr/bin/env python3
"""
Token计算工具 - 支持多种方法（简化版）
"""
import re
from typing import Optional
from langchain.text_splitter import TokenTextSplitter

def count_tokens_simple(text: str) -> int:
    """
    简单字符估算Token数量
    """
    if not text:
        return 0
    
    # 中文字符
    chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
    # 英文单词
    english_words = len(re.findall(r'[a-zA-Z]+', text))
    # 其他字符
    other_chars = len(text) - chinese_chars - english_words
    
    # 估算公式：中文字符 + 英文单词*1.3 + 其他字符*0.5
    estimated_tokens = chinese_chars + english_words * 1.3 + other_chars * 0.5
    return int(estimated_tokens)

def count_tokens_with_langchain_splitter(text: str, model_name: str = "qwen-turbo") -> int:
    """
    使用LangChain的TokenTextSplitter估算Token数量
    """
    try:
        # 创建TokenTextSplitter
        text_splitter = TokenTextSplitter(
            chunk_size=1000,
            chunk_overlap=0,
            model_name=model_name
        )
        
        # 分割文本并计算Token数量
        chunks = text_splitter.split_text(text)
        
        # 估算总Token数量
        total_tokens = 0
        for chunk in chunks:
            # 每个chunk大约对应chunk_size个tokens
            total_tokens += len(chunk) * 0.8  # 粗略估算
        
        return int(total_tokens)
    except Exception as e:
        print(f"LangChain splitter counting failed: {e}")
        return count_tokens_simple(text)

class TokenCounter:
    """
    Token计数器类，支持多种计算方法
    """
    
    def __init__(self, method: str = "simple"):
        self.method = method
    
    def count(self, text: str) -> int:
        """
        计算文本的Token数量
        """
        if not text:
            return 0
        
        if self.method == "langchain":
            return count_tokens_with_langchain_splitter(text)
        else:
            return count_tokens_simple(text)
    
    def count_messages(self, messages: list) -> int:
        """
        计算消息列表的总Token数量
        """
        total_tokens = 0
        for message in messages:
            if hasattr(message, 'content'):
                total_tokens += self.count(message.content)
            elif isinstance(message, dict) and 'content' in message:
                total_tokens += self.count(message['content'])
            elif isinstance(message, str):
                total_tokens += self.count(message)
        
        return total_tokens

# 便捷函数
def get_token_count(text: str, method: str = "simple") -> int:
    """
    获取文本的Token数量
    """
    counter = TokenCounter(method)
    return counter.count(text)

def compare_token_methods(text: str) -> dict:
    """
    比较不同Token计算方法的结果
    """
    results = {
        "text": text,
        "methods": {}
    }
    
    # 测试不同方法
    methods = ["simple", "langchain"]
    
    for method in methods:
        try:
            counter = TokenCounter(method)
            count = counter.count(text)
            results["methods"][method] = {
                "count": count,
                "status": "success"
            }
        except Exception as e:
            results["methods"][method] = {
                "count": 0,
                "status": "error",
                "error": str(e)
            }
    
    return results 