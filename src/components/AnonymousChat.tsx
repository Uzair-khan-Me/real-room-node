import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { VoiceCall } from '@/components/VoiceCall';
import { VoiceMessagePlayer } from '@/components/VoiceMessagePlayer';
import { Send, Users, Circle, ArrowLeft, Copy, Check, Paperclip, Download, FileText, Image, File } from 'lucide-react';
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
  file_url?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  file_size?: number | null;
  audio_duration?: number | null;
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isVoiceCallOpen, setIsVoiceCallOpen] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const anonymousUserIdRef = useRef(`anon_${username}_${roomCode}_${Math.random().toString(36).substring(2, 9)}`);
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
    if ((!message.trim() && !selectedFile && !audioBlob) || !roomInfo) return;
    
    let fileUrl = null;
    let fileName = null;
    let fileType = null;
    let fileSize = null;
    let content = message.trim() ? message : '';

    // Upload file if selected
    if (selectedFile) {
      setUploading(true);
      const fileExt = selectedFile.name.split('.').pop();
      const sessionId = `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const filePath = `${sessionId}/${Date.now()}.${fileExt}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('chat-files')
        .upload(filePath, selectedFile);

      if (uploadError) {
        setUploading(false);
        toast({
          title: "Error uploading file",
          description: uploadError.message,
          variant: "destructive"
        });
        return;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('chat-files')
        .getPublicUrl(filePath);

      fileUrl = publicUrl;
      fileName = selectedFile.name;
      fileType = selectedFile.type;
      fileSize = selectedFile.size;
      content = message.trim() ? message : `Shared a file: ${fileName}`;
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploading(false);
    }
    
    // Upload audio if recorded
    if (audioBlob) {
      setUploading(true);
      const sessionId = `anon_voice_${Date.now()}`;
      const filePath = `${sessionId}/audio.webm`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('chat-files')
        .upload(filePath, audioBlob, { contentType: 'audio/webm' });

      if (uploadError) {
        setUploading(false);
        toast({ title: "Error uploading audio", description: uploadError.message, variant: "destructive" });
        return;
      }

      const { data: { publicUrl } } = supabase.storage.from('chat-files').getPublicUrl(filePath);
      fileUrl = publicUrl;
      fileName = 'Voice message';
      fileType = 'audio/webm';
      fileSize = audioBlob.size;
      content = message.trim() ? message : 'Sent a voice message';
      setMessage(content);
      setAudioBlob(null);
      setAudioDuration(0);
      setUploading(false);
    }

    const messageData = {
      username: username,
      content: content || `Shared a file: ${fileName}`,
      room_id: roomInfo.id,
      file_url: fileUrl,
      file_name: fileName,
      file_type: fileType,
      file_size: fileSize,
      audio_duration: audioDuration > 0 ? audioDuration : null,
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
            <VoiceCall roomId={roomInfo.id} userId={anonymousUserIdRef.current} username={username} onCallStateChange={(open) => setIsVoiceCallOpen(open)} />
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
              {msg.file_url && (
                <div className="mt-2">
                  {msg.file_type?.startsWith('audio/') ? (
                    <VoiceMessagePlayer url={msg.file_url} durationSec={msg.audio_duration ? msg.audio_duration / 1000 : 0} />
                  ) : msg.file_type?.startsWith('image/') ? (
                            <div className="relative inline-block">
                              <img 
                                src={msg.file_url} 
                                alt={msg.file_name || 'Shared image'} 
                                className="max-w-sm rounded-lg border border-border"
                              />
                              <a
                                href={msg.file_url}
                                download={msg.file_name}
                                className="absolute top-2 right-2 p-2 bg-background/80 hover:bg-background rounded-lg border border-border"
                              >
                                <Download className="w-4 h-4" />
                              </a>
                            </div>
                          ) : (
                            <a
                              href={msg.file_url}
                              download={msg.file_name}
                              className="inline-flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-lg transition-colors"
                            >
                              {msg.file_type?.includes('pdf') ? (
                                <FileText className="w-4 h-4" />
                              ) : (
                                <File className="w-4 h-4" />
                              )}
                              <span className="text-sm">{msg.file_name}</span>
                              <span className="text-xs text-muted-foreground">
                                ({(msg.file_size ? msg.file_size / 1024 : 0).toFixed(1)} KB)
                              </span>
                              <Download className="w-4 h-4 ml-auto" />
                            </a>
                          )}
                        </div>
                      )}
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
            {selectedFile && (
              <div className="mb-2 p-2 bg-secondary/50 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {selectedFile.type.startsWith('image/') ? (
                    <Image className="w-4 h-4" />
                  ) : selectedFile.type.includes('pdf') ? (
                    <FileText className="w-4 h-4" />
                  ) : (
                    <File className="w-4 h-4" />
                  )}
                  <span className="text-sm">{selectedFile.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                >
                  ✕
                </Button>
              </div>
            )}
            <div className="flex gap-2 items-center">
              <VoiceRecorder
                onAudioReady={(blob, durationMs) => {
                  setAudioBlob(blob);
                  setAudioDuration(durationMs);
                }}
                disabled={uploading}
                className="flex-shrink-0"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.doc,.docx,.txt,.zip,.rar"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    if (file.size > 10 * 1024 * 1024) {
                      toast({
                        title: "File too large",
                        description: "Please select a file smaller than 10MB",
                        variant: "destructive"
                      });
                      return;
                    }
                    setSelectedFile(file);
                  }
                }}
                className="hidden"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Paperclip className="w-4 h-4" />
              </Button>
              <Input
                ref={messageInputRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && !uploading && handleSendMessage()}
                placeholder="Type your message..."
                className="flex-1"
                disabled={uploading}
              />
              <Button 
                onClick={handleSendMessage}
                disabled={(!message.trim() && !selectedFile && !audioBlob) || uploading}
                size="icon"
              >
                {uploading ? (
                  <div className="w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};