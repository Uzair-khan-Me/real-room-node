import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Send, Hash, Lock, Users, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  username: string;
  text: string;
  timestamp: Date;
  room: string;
  type: 'message' | 'system';
}

interface Room {
  id: string;
  name: string;
  type: 'public' | 'private';
  lastMessage?: string;
  unreadCount?: number;
}

interface User {
  id: string;
  username: string;
  isOnline: boolean;
  isTyping: boolean;
}

export const Chat: React.FC = () => {
  const [username, setUsername] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [currentRoom, setCurrentRoom] = useState('general');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [rooms, setRooms] = useState<Room[]>([
    { id: 'general', name: 'general', type: 'public' },
    { id: 'random', name: 'random', type: 'public' },
    { id: 'tech', name: 'tech', type: 'public' },
  ]);
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  const messageInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Join chat
  const handleJoin = () => {
    if (username.trim()) {
      setIsJoined(true);
      const systemMessage: Message = {
        id: Date.now().toString(),
        username: 'System',
        text: `${username} joined the chat`,
        timestamp: new Date(),
        room: currentRoom,
        type: 'system',
      };
      setMessages([systemMessage]);
      
      // Simulate some online users
      setOnlineUsers([
        { id: '1', username, isOnline: true, isTyping: false },
        { id: '2', username: 'Alice', isOnline: true, isTyping: false },
        { id: '3', username: 'Bob', isOnline: true, isTyping: false },
      ]);
    }
  };

  // Send message
  const handleSendMessage = () => {
    if (message.trim() && username) {
      const newMessage: Message = {
        id: Date.now().toString(),
        username,
        text: message,
        timestamp: new Date(),
        room: currentRoom,
        type: 'message',
      };
      
      setMessages(prev => [...prev, newMessage]);
      setMessage('');
      messageInputRef.current?.focus();
      
      // Simulate receiving a response after a delay
      if (Math.random() > 0.7) {
        setTimeout(() => {
          const botMessage: Message = {
            id: (Date.now() + 1).toString(),
            username: Math.random() > 0.5 ? 'Alice' : 'Bob',
            text: getRandomResponse(),
            timestamp: new Date(),
            room: currentRoom,
            type: 'message',
          };
          setMessages(prev => [...prev, botMessage]);
        }, 1000 + Math.random() * 2000);
      }
    }
  };

  // Get random response for demo
  const getRandomResponse = () => {
    const responses = [
      'That\'s interesting!',
      'I agree with that',
      'Tell me more about it',
      'Cool! 😊',
      'Thanks for sharing',
      'Great point!',
      'Absolutely!',
      'I was thinking the same thing',
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  };

  // Handle typing indicator
  const handleTyping = () => {
    if (!isTyping) {
      setIsTyping(true);
      // Simulate showing typing to others
      if (Math.random() > 0.8) {
        const randomUser = onlineUsers[Math.floor(Math.random() * onlineUsers.length)];
        if (randomUser && randomUser.username !== username) {
          setTypingUsers(prev => [...prev, randomUser.username]);
          setTimeout(() => {
            setTypingUsers(prev => prev.filter(u => u !== randomUser.username));
          }, 3000);
        }
      }
    }
    
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
    }, 1000);
  };

  // Switch room
  const switchRoom = (roomId: string) => {
    setCurrentRoom(roomId);
    const systemMessage: Message = {
      id: Date.now().toString(),
      username: 'System',
      text: `You switched to #${roomId}`,
      timestamp: new Date(),
      room: roomId,
      type: 'system',
    };
    setMessages(prev => [...prev, systemMessage]);
  };

  // Format timestamp
  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  if (!isJoined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-subtle p-4">
        <Card className="w-full max-w-md p-8 shadow-lg border-border/50 bg-card/95 backdrop-blur">
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                Welcome to Chat
              </h1>
              <p className="text-muted-foreground">Enter your username to get started</p>
            </div>
            
            <div className="space-y-4">
              <Input
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleJoin()}
                className="text-lg py-6 border-border/50 focus:border-primary transition-colors"
                maxLength={20}
              />
              
              <Button 
                onClick={handleJoin} 
                className="w-full bg-gradient-primary hover:opacity-90 transition-opacity text-lg py-6"
                disabled={!username.trim()}
              >
                Join Chat
              </Button>
            </div>
            
            <div className="text-center text-sm text-muted-foreground">
              <p>Connect with others in real-time</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="w-64 bg-sidebar-background border-r border-sidebar-border flex flex-col">
        <div className="p-4 border-b border-sidebar-border">
          <h2 className="font-semibold text-lg text-sidebar-foreground">Chat Rooms</h2>
        </div>
        
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {rooms.map((room) => (
              <button
                key={room.id}
                onClick={() => switchRoom(room.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors",
                  currentRoom === room.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
                )}
              >
                {room.type === 'public' ? (
                  <Hash className="w-4 h-4 opacity-60" />
                ) : (
                  <Lock className="w-4 h-4 opacity-60" />
                )}
                <span className="font-medium">{room.name}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
        
        {/* Online Users */}
        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-sidebar-foreground/60" />
            <h3 className="text-sm font-medium text-sidebar-foreground">Online Users</h3>
          </div>
          <div className="space-y-2">
            {onlineUsers.slice(0, 5).map((user) => (
              <div key={user.id} className="flex items-center gap-2">
                <Circle className={cn(
                  "w-2 h-2 fill-current",
                  user.isOnline ? "text-success" : "text-muted-foreground"
                )} />
                <span className="text-sm text-sidebar-foreground/80">{user.username}</span>
              </div>
            ))}
          </div>
        </div>
        
        {/* User info */}
        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                {username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">{username}</p>
              <p className="text-xs text-success flex items-center gap-1">
                <Circle className="w-2 h-2 fill-current" />
                Online
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="h-16 border-b border-border bg-card px-6 flex items-center">
          <div className="flex items-center gap-2">
            <Hash className="w-5 h-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold">{currentRoom}</h1>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-6">
          <div className="space-y-4 max-w-4xl mx-auto">
            {messages
              .filter(msg => msg.room === currentRoom)
              .map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex gap-3 animate-slide-in-up",
                    msg.type === 'system' && "justify-center"
                  )}
                >
                  {msg.type === 'system' ? (
                    <div className="text-sm text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
                      {msg.text}
                    </div>
                  ) : (
                    <>
                      <Avatar className="h-8 w-8 flex-shrink-0">
                        <AvatarFallback className={cn(
                          "text-xs",
                          msg.username === username 
                            ? "bg-primary text-primary-foreground" 
                            : "bg-secondary text-secondary-foreground"
                        )}>
                          {msg.username.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium text-sm">{msg.username}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatTime(msg.timestamp)}
                          </span>
                        </div>
                        <div className={cn(
                          "inline-block px-4 py-2 rounded-2xl",
                          msg.username === username
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-secondary-foreground"
                        )}>
                          {msg.text}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}
            
            {/* Typing indicator */}
            {typingUsers.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse-slow">
                <span>{typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing</span>
                <span className="flex gap-1">
                  <span className="w-1 h-1 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                  <span className="w-1 h-1 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                  <span className="w-1 h-1 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                </span>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="border-t border-border bg-card p-4">
          <div className="max-w-4xl mx-auto flex gap-2">
            <Input
              ref={messageInputRef}
              type="text"
              placeholder={`Message #${currentRoom}`}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                handleTyping();
              }}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              className="flex-1 bg-background border-input"
            />
            <Button
              onClick={handleSendMessage}
              disabled={!message.trim()}
              className="bg-primary hover:bg-primary-glow transition-colors"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};