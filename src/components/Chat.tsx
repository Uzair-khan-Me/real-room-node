import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Send, Hash, Lock, Users, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Message {
  id: string;
  username: string;
  content: string;
  created_at: string;
  room_id: string;
}

interface Room {
  id: string;
  name: string;
  type: 'public' | 'private';
  lastMessage?: string;
  unreadCount?: number;
}

interface UserPresence {
  username: string;
  is_typing: boolean;
  last_seen: string;
}

export const Chat: React.FC = () => {
  const [username, setUsername] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [currentRoom, setCurrentRoom] = useState('general');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [rooms] = useState<Room[]>([
    { id: 'general', name: 'general', type: 'public' },
    { id: 'random', name: 'random', type: 'public' },
    { id: 'tech', name: 'tech', type: 'public' },
  ]);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  const messageInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load messages when joining or switching rooms
  useEffect(() => {
    if (isJoined) {
      loadMessages();
      updatePresence(false);
    }
  }, [isJoined, currentRoom]);

  // Set up real-time subscriptions
  useEffect(() => {
    if (!isJoined) return;

    // Subscribe to new messages
    const messageChannel = supabase
      .channel('messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `room_id=eq.${currentRoom}`
        },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages(prev => [...prev, newMsg]);
          scrollToBottom();
        }
      )
      .subscribe();

    // Subscribe to presence updates
    const presenceChannel = supabase
      .channel('presence')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_presence',
          filter: `room_id=eq.${currentRoom}`
        },
        () => {
          loadPresence();
        }
      )
      .subscribe();

    // Update presence periodically
    const presenceInterval = setInterval(() => {
      updatePresence(false);
    }, 30000); // Every 30 seconds

    return () => {
      supabase.removeChannel(messageChannel);
      supabase.removeChannel(presenceChannel);
      clearInterval(presenceInterval);
      // Clear presence when leaving
      clearPresence();
    };
  }, [isJoined, currentRoom, username]);

  const loadMessages = async () => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('room_id', currentRoom)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) {
      toast({
        title: "Error loading messages",
        description: error.message,
        variant: "destructive"
      });
    } else {
      setMessages(data || []);
      scrollToBottom();
    }
  };

  const loadPresence = async () => {
    const { data } = await supabase
      .from('user_presence')
      .select('*')
      .eq('room_id', currentRoom)
      .gte('last_seen', new Date(Date.now() - 60000).toISOString()); // Active in last minute

    if (data) {
      const online = data.map(p => p.username).filter(u => u !== username);
      setOnlineUsers(online);
      const typing = data.filter(p => p.is_typing && p.username !== username).map(p => p.username);
      setTypingUsers(typing);
    }
  };

  const updatePresence = async (isTyping: boolean) => {
    if (!isJoined) return;

    await supabase
      .from('user_presence')
      .upsert({
        room_id: currentRoom,
        username: username,
        is_typing: isTyping,
        last_seen: new Date().toISOString()
      }, {
        onConflict: 'room_id,username'
      });
  };

  const clearPresence = async () => {
    if (username && currentRoom) {
      await supabase
        .from('user_presence')
        .delete()
        .eq('room_id', currentRoom)
        .eq('username', username);
    }
  };

  // Join chat
  const handleJoin = async () => {
    if (username.trim()) {
      // First, add user to the general room
      const { error: roomError } = await supabase
        .from('room_members')
        .insert([{ room_id: currentRoom, username: username.trim() }]);
      
      if (roomError && !roomError.message.includes('duplicate')) {
        toast({
          title: "Error joining room",
          description: roomError.message,
          variant: "destructive"
        });
        return;
      }
      
      setIsJoined(true);
      
      // Send join message
      const joinMessage = {
        username: 'System',
        content: `${username} joined the chat`,
        room_id: currentRoom
      };
      
      const { error } = await supabase
        .from('messages')
        .insert(joinMessage);

      if (error) {
        toast({
          title: "Error sending join message",
          description: error.message,
          variant: "destructive"
        });
      }
    }
  };

  // Send message
  const handleSendMessage = async () => {
    if (message.trim() && username) {
      const messageData = {
        username,
        content: message,
        room_id: currentRoom
      };
      
      setMessage('');
      messageInputRef.current?.focus();
      
      const { error } = await supabase
        .from('messages')
        .insert(messageData);

      if (error) {
        toast({
          title: "Error sending message",
          description: error.message,
          variant: "destructive"
        });
        setMessage(messageData.content); // Restore message on error
      }
    }
  };

  // Handle typing indicator
  const handleTyping = () => {
    if (isJoined && message.length > 0) {
      updatePresence(true);
      
      // Clear previous timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      
      // Stop typing after 2 seconds of inactivity
      typingTimeoutRef.current = setTimeout(() => {
        updatePresence(false);
      }, 2000);
    }
  };

  // Switch room
  const switchRoom = async (roomId: string) => {
    // Clear presence from old room
    await clearPresence();
    
    // Join the new room
    const { error: roomError } = await supabase
      .from('room_members')
      .insert([{ room_id: roomId, username: username }]);
    
    if (roomError && !roomError.message.includes('duplicate')) {
      toast({
        title: "Error joining room",
        description: roomError.message,
        variant: "destructive"
      });
      return;
    }
    
    setCurrentRoom(roomId);
    
    // Send system message
    const systemMessage = {
      username: 'System',
      content: `${username} switched to #${roomId}`,
      room_id: roomId
    };
    
    await supabase
      .from('messages')
      .insert(systemMessage);
  };

  // Format timestamp
  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
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
            
            <div className="text-center text-sm text-muted-foreground space-y-2">
              <p>Connect with others in real-time</p>
              <p className="text-xs">Share this URL with others: <span className="text-primary">{window.location.origin}</span></p>
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
            <h3 className="text-sm font-medium text-sidebar-foreground">
              Online ({onlineUsers.length + 1})
            </h3>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Circle className="w-2 h-2 fill-current text-success" />
              <span className="text-sm text-sidebar-foreground/80 font-medium">
                {username} (You)
              </span>
            </div>
            {onlineUsers.slice(0, 4).map((user, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Circle className="w-2 h-2 fill-current text-success" />
                <span className="text-sm text-sidebar-foreground/80">{user}</span>
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
        <div className="h-16 border-b border-border bg-card px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Hash className="w-5 h-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold">{currentRoom}</h1>
          </div>
          <div className="text-sm text-muted-foreground">
            Share URL: {window.location.origin}
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-6">
          <div className="space-y-4 max-w-4xl mx-auto">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-3 animate-slide-in-up",
                  msg.username === 'System' && "justify-center"
                )}
              >
                {msg.username === 'System' ? (
                  <div className="text-sm text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
                    {msg.content}
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
                          {formatTime(msg.created_at)}
                        </span>
                      </div>
                      <div className={cn(
                        "inline-block px-4 py-2 rounded-2xl",
                        msg.username === username
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground"
                      )}>
                        {msg.content}
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