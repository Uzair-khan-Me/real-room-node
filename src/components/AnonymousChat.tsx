import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Send, Users, Circle, ArrowLeft, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

interface Message {
  id: string;
  username: string;
  content: string;
  created_at: string;
  room_id: string;
}

interface AnonymousChatProps {
  roomCode: string;
  username: string;
  onExit: () => void;
}

export const AnonymousChat: React.FC<AnonymousChatProps> = ({ roomCode, username, onExit }) => {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [roomInfo, setRoomInfo] = useState<{ id: string; name: string } | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Join or create room on mount
  useEffect(() => {
    joinOrCreateRoom();
  }, [roomCode]);

  const joinOrCreateRoom = async () => {
    const { data, error } = await supabase.rpc('join_or_create_anonymous_room', {
      p_room_code: roomCode,
      p_room_name: `Room ${roomCode}`
    });

    const result = data as { success: boolean; room_id: string; room_name: string; action: string } | null;

    if (error || !result?.success) {
      toast({
        title: "Error joining room",
        description: error?.message || "Failed to join room",
        variant: "destructive"
      });
      onExit();
      return;
    }

    setRoomInfo({ id: result.room_id, name: result.room_name });
    
    if (result.action === 'created') {
      toast({
        title: "Room created!",
        description: `Share the code "${roomCode}" with your friend to chat`,
      });
    } else {
      toast({
        title: "Joined room!",
        description: "You can now chat in this room",
      });
    }

    // Send join message
    await supabase
      .from('anonymous_messages')
      .insert({
        room_id: result.room_id,
        username: 'System',
        content: `${username} joined the room`
      });
  };

  // Load messages when room is ready
  useEffect(() => {
    if (roomInfo) {
      loadMessages();
      setupRealtimeSubscription();
    }
  }, [roomInfo]);

  const loadMessages = async () => {
    if (!roomInfo) return;

    const { data, error } = await supabase
      .from('anonymous_messages')
      .select('*')
      .eq('room_id', roomInfo.id)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) {
      console.error('Error loading messages:', error);
      return;
    }

    setMessages(data || []);
    scrollToBottom();
  };

  const setupRealtimeSubscription = () => {
    if (!roomInfo) return;

    const messageChannel = supabase
      .channel(`anonymous_${roomInfo.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'anonymous_messages',
          filter: `room_id=eq.${roomInfo.id}`
        },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages(prev => [...prev, newMsg]);
          scrollToBottom();
          
          // Track online users from messages
          if (newMsg.username !== 'System' && !onlineUsers.includes(newMsg.username)) {
            setOnlineUsers(prev => [...prev, newMsg.username]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messageChannel);
    };
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!message.trim() || !roomInfo) return;
    
    const messageData = {
      username: username,
      content: message,
      room_id: roomInfo.id
    };
    
    setMessage('');
    messageInputRef.current?.focus();
    
    const { error } = await supabase
      .from('anonymous_messages')
      .insert(messageData);

    if (error) {
      toast({
        title: "Error sending message",
        description: error.message,
        variant: "destructive"
      });
      setMessage(messageData.content);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: "Code copied!",
      description: "Share this code with your friend",
    });
  };

  const handleExit = async () => {
    if (roomInfo) {
      await supabase
        .from('anonymous_messages')
        .insert({
          room_id: roomInfo.id,
          username: 'System',
          content: `${username} left the room`
        });
    }
    onExit();
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!roomInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-subtle">
        <Card className="p-8">
          <p className="text-muted-foreground">Connecting to room...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="h-16 border-b border-border bg-card px-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleExit}
              title="Exit room"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-semibold">{roomInfo.name}</h1>
              <p className="text-sm text-muted-foreground">Anonymous Chat Room</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1 bg-secondary rounded-lg">
              <span className="text-sm font-medium">Room Code:</span>
              <span className="text-sm font-mono text-primary">{roomCode}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleCopyCode}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {[...new Set([username, ...onlineUsers.filter(u => u !== username && u !== 'System')])].length} online
              </span>
            </div>
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
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Message Input */}
        <div className="border-t border-border bg-card p-4">
          <div className="max-w-4xl mx-auto">
            <div className="flex gap-3">
              <Input
                ref={messageInputRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Type your message..."
                className="flex-1"
              />
              <Button 
                onClick={handleSendMessage}
                disabled={!message.trim()}
                size="icon"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};