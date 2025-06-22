import json
from django.http import StreamingHttpResponse, JsonResponse
from langchain_community.chat_models import ChatTongyi
from langchain_core.messages import HumanMessage
from django.views.decorators.csrf import csrf_exempt
from dashscope.tokenizers import get_tokenizer


def stream_chat(prompt):
    """
    流式返回模型生成的文本内容，并实时返回累计tokens数（官方分词器）。
    """
    model = ChatTongyi(streaming=True)
    sent_text = ""
    tokenizer = get_tokenizer('qwen-turbo')  # 可根据实际模型名调整
    prompt_tokens = len(tokenizer.encode(prompt))+8
    for chunk in model.stream([HumanMessage(content=prompt)]):
        if chunk.content:
            sent_text += chunk.content
            completion_tokens = len(tokenizer.encode(sent_text))
            total_tokens = prompt_tokens + completion_tokens
            yield f"event: message\ndata: {json.dumps({'text': chunk.content, 'prompt_tokens': prompt_tokens, 'completion_tokens': completion_tokens, 'total_tokens': total_tokens})}\n\n"

@csrf_exempt
def chat_view(request):
    """
    接收用户请求，根据'use_streaming'参数决定
    调用通义千问模型并返回流式或非流式响应。
    """
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            prompt = data.get("message")
            use_streaming = data.get("use_streaming", True)

            if not prompt:
                return JsonResponse({"error": "Message not provided"}, status=400)
            
            if use_streaming:
                # --- 流式响应逻辑 ---
                # 在流式模式下，我们只发送文本块，不发送统计数据。
                return StreamingHttpResponse(
                    stream_chat(prompt), 
                    content_type='text/event-stream'
                )
            else:
                # --- 非流式响应逻辑 ---
                # 在非流式模式下，一次性返回内容和官方的Token统计。
                model = ChatTongyi()
                result = model.invoke([HumanMessage(content=prompt)])
                
                stats = {}
                if result.response_metadata and 'token_usage' in result.response_metadata:
                    stats = result.response_metadata['token_usage']
                    print(f"DEBUG: Successfully fetched token stats: {stats}") # 保留用于调试

                response_data = {
                    'text': result.content,
                    'stats': stats
                }
                return JsonResponse(response_data)

        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)
    else:
        return JsonResponse({"error": "Only POST method is allowed"}, status=405)
