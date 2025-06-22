from django.urls import path
from . import views

urlpatterns = [
    path('chat/', views.chat_view, name='chat'),
    path('tokenize/', views.tokenize_view, name='tokenize'),
    path('compare-tokens/', views.compare_tokens_view, name='compare_tokens'),
] 