#!/usr/bin/env python3
"""
测试dashscope token插件的准确性
"""
import os
import sys
import django

# 设置Django环境
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

def test_dashscope_tokenizer():
    """测试dashscope本地分词器"""
    try:
        from dashscope.tokenizers import get_tokenizer
        
        print("🔍 测试dashscope本地分词器")
        print("=" * 50)
        
        # 获取分词器
        tokenizer = get_tokenizer('qwen-turbo')
        
        # 测试文本
        test_texts = [
            "你好世界",
            "Hello World",
            "这是一个测试文本，包含中英文混合内容。This is a test text with mixed Chinese and English content.",
            "通义千问是一个强大的AI模型",
            "Qwen is a powerful AI model"
        ]
        
        for text in test_texts:
            try:
                tokens = tokenizer.encode(text)
                token_count = len(tokens)
                print(f"✅ 文本: {text[:30]}...")
                print(f"   Token数量: {token_count}")
                print(f"   字符数: {len(text)}")
                print(f"   比例: {token_count/len(text):.2f} tokens/char")
                print(f"   Token列表: {tokens[:10]}...")  # 显示前10个token
            except Exception as e:
                print(f"❌ 文本: {text[:30]}...")
                print(f"   错误: {str(e)}")
            
            print("-" * 30)
            
    except ImportError as e:
        print(f"❌ 无法导入dashscope.tokenizers: {e}")
        print("请确保已安装dashscope: pip install dashscope")

def test_dashscope_api():
    """测试dashscope API（需要API key）"""
    try:
        from dashscope import Tokenization
        
        print("🔍 测试dashscope API Tokenization")
        print("=" * 50)
        
        # 测试文本
        test_text = "你好世界"
        
        try:
            response = Tokenization.call(
                model='qwen-turbo',
                prompt=test_text
            )
            
            if response.status_code == 200:
                token_count = response.output.get('token_count', 0)
                print(f"✅ API调用成功")
                print(f"   文本: {test_text}")
                print(f"   Token数量: {token_count}")
                print(f"   响应: {response.output}")
            else:
                print(f"❌ API调用失败: {response.message}")
                
        except Exception as e:
            print(f"❌ API调用异常: {str(e)}")
            print("可能需要设置API key或网络连接问题")
            
    except ImportError as e:
        print(f"❌ 无法导入dashscope: {e}")

if __name__ == "__main__":
    print("🚀 开始测试dashscope token插件")
    print()
    
    # 测试本地分词器
    test_dashscope_tokenizer()
    print()
    
    # 测试API
    test_dashscope_api()
    
    print("✅ 测试完成") 