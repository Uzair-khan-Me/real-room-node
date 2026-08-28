import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { VoiceCall } from '@/components/VoiceCall';
import { VoiceMessagePlayer } from '@/components/VoiceMessagePlayer';
import { Send, Users, ArrowLeft, Copy, Check, Paperclip, Download, FileText, Image, File, Heart, Smile } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

interface Message {
  id: string; username: string; content: string; created_at: string;
  room_id: string; file_url?: string | null; file_name?: string | null;
}

interface AnonymousChatProps { roomCode: string; username: string; onExit: () => void; }

const REACTIONS = ['❤️', '😂', '😍', '👍', '🔥'];

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
  const [messageReactions, setMessageReactions] = useState<Record<string, string[]>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const anonymousUserIdRef = useRef(`anon_${username}_${roomCode}_${Math.random().toString(36).substring(2, 9)}`);
  const { toast } = useToast();

  const joinOrCreateRoom = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('join_or_create_anonymous_room', { p_room_code: roomCode, p_room_name: `Room ${roomCode}` });
      const result = data as { success: boolean; room_id: string; room_name: string; action: string } | null;
      if (error || !result?.success) {
        toast({ title: "Room error", description: error?.message || "Failed to connect", variant: "destructive" });
        onExit(); return;
      }
      setRoomInfo({ id: result.room_id, name: result.room_name });
      if (result.action === 'created') {
        toast({ title: "Room created!", description: `Share code "${roomCode}" with friends` });
      } else {
        toast({ title: "Joined room!", description: "You can now chat" });
      }
      await supabase.from('anonymous_messages').insert({ room_id: result.room_id, username: 'System', content: `${username} joined the room` });
    } catch (e: any) {
      toast({ title: "Connection error", description: e.message || "Failed to fetch", variant: "destructive" });
      onExit();
    }
  }, [roomCode, username, onExit, toast]);

  useEffect(() => { joinOrCreateRoom(); }, [joinOrCreateRoom]);

  useEffect(() => {
    if (!roomInfo) return;
    const load = async () => {
      try {
        const { data, error } = await supabase.from('anonymous_messages').select('*').eq('room_id', roomInfo.id).order('created_at', { ascending: true }).limit(100);
        if (error) return;
        setMessages(data || []);
        scrollToBottom();
      } catch (e) { console.error('Load messages error:', e); }
    };
    load();
    const ch = supabase.channel(`anon_${roomInfo.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'anonymous_messages', filter: `room_id=eq.${roomInfo.id}` }, (payload) => {
      const newMsg = payload.new as Message;
      setMessages(prev => [...prev, newMsg]); scrollToBottom();
      if (newMsg.username !== 'System' && !onlineUsers.includes(newMsg.username)) setOnlineUsers(prev => [...prev, newMsg.username]);
    }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [roomInfo]);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => scrollToBottom(), [messages]);

  const handleSendMessage = useCallback(async () => {
    if ((!message.trim() && !selectedFile && !audioBlob) || !roomInfo) return;
    try {
      setUploading(true);
      let fileUrl = null; let fileName = null; let fileType = null; let fileSize = null; let content = message.trim() ? message : '';
      if (selectedFile) {
        const fileExt = selectedFile.name.split('.').pop();
        const filePath = `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}/${Date.now()}.${fileExt}`;
        const { error: uploadErr } = await supabase.storage.from('chat-files').upload(filePath, selectedFile);
        if (uploadErr) { toast({ title: "Upload failed", description: uploadErr.message, variant: "destructive" }); setUploading(false); return; }
        const { data: { publicUrl } } = supabase.storage.from('chat-files').getPublicUrl(filePath);
        fileUrl = publicUrl; fileName = selectedFile.name; fileType = selectedFile.type; fileSize = selectedFile.size;
        content = message.trim() ? message : `Shared a file: ${fileName}`;
        setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = '';
        setUploading(false);
      }
      if (audioBlob) {
        const filePath = `anon_voice_${Date.now()}/audio.webm`;
        const { error: uploadErr } = await supabase.storage.from('chat-files').upload(filePath, audioBlob, { contentType: 'audio/webm' });
        if (uploadErr) { toast({ title: "Audio upload failed", description: uploadErr.message, variant: "destructive" }); setUploading(false); return; }
        const { data: { publicUrl } } = supabase.storage.from('chat-files').getPublicUrl(filePath);
        fileUrl = publicUrl; fileName = 'Voice message'; fileType = 'audio/webm'; fileSize = audioBlob.size;
        content = message.trim() ? message : 'Sent a voice message';
        setMessage(content); setAudioBlob(null); setAudioDuration(0); setUploading(false);
      }
      if (!audioBlob && !selectedFile && content) {
        const { error } = await supabase.from('anonymous_messages').insert({ username, content, room_id: roomInfo.id });
        if (error) { toast({ title: "Send failed", description: error.message, variant: "destructive" }); return; }
        setMessage(''); messageInputRef.current?.focus();
      }
      if (fileUrl) {
        const { error } = await supabase.from('anonymous_messages').insert({
          username, content: content || `Shared a file: ${fileName}`, room_id: roomInfo.id,
          file_url: fileUrl, file_name: fileName, file_type: fileType, file_size: fileSize,
          
        });
        if (error) { toast({ title: "Send failed", description: error.message, variant: "destructive" }); return; }
        setMessage('');
      }
    } catch (e: any) {
      toast({ title: "Send error", description: e.message || "Failed to fetch", variant: "destructive" });
      setUploading(false);
    } finally { setUploading(false); }
  }, [message, selectedFile, audioBlob, roomInfo, username, audioDuration, toast]);

  const handleCopyCode = () => { navigator.clipboard.writeText(roomCode); setCopied(true); setTimeout(() => setCopied(false), 2000); toast({ title: "Copied!", description: "Share with friends" }); };
  const handleExit = async () => { if (roomInfo) await supabase.from('anonymous_messages').insert({ room_id: roomInfo.id, username: 'System', content: `${username} left` }); onExit(); };
  const formatTime = (dateString: string) => new Date(dateString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const addReaction = (msgId: string, reaction: string) => setMessageReactions(prev => { const existing = prev[msgId] || []; return { ...prev, [msgId]: existing.includes(reaction) ? existing.filter(r => r !== reaction) : [...existing, reaction] }; });

  if (!roomInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-subtle">
        <Card className="p-10 shadow-2xl bg-card/90 backdrop-blur-xl rounded-3xl border border-border/40">
          <div className="w-16 h-16 rounded-full bg-gradient-primary mx-auto mb-6 shadow-glow animate-pulse-slow" />
          <p className="text-xl font-semibold text-foreground">Connecting to room...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gradient-subtle overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Modern header */}
        <header className="h-16 bg-card/80 backdrop-blur-xl border-b border-border/40 px-4 md:px-6 flex items-center justify-between shadow-sm sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={handleExit} className="rounded-full hover:bg-secondary/60 hover:scale-105 transition-all" title="Exit"><ArrowLeft className="h-5 w-5" /></Button>
            <Avatar className="h-9 w-9 shadow-md ring-2 ring-gradient-primary/20"><AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${roomInfo.name}`} /><AvatarFallback className="bg-gradient-primary text-white text-xs font-bold">{roomInfo.name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
            <div className="min-w-0">
              <h1 className="text-base md:text-lg font-extrabold truncate leading-tight">{roomInfo.name}</h1>
              <p className="text-[10px] md:text-xs text-muted-foreground truncate">Anonymous Room · {onlineUsers.filter(u => u !== username && u !== 'System').length + 1} online</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <VoiceCall roomId={roomInfo.id} userId={anonymousUserIdRef.current} username={username} />
            <div className="flex items-center gap-2 px-2.5 md:px-3 py-1.5 bg-secondary/50 rounded-full text-xs md:text-sm font-medium shadow-inner">
              <span className="font-mono text-violet-600 dark:text-violet-300">{roomCode}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full hover:bg-violet-100 dark:hover:bg-violet-900/30" onClick={handleCopyCode}><span className="text-[10px]">{copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}</span></Button>
            </div>
          </div>
        </header>

        {/* Messages feed */}
        <ScrollArea className="flex-1 p-4 md:p-6">
          <div className="max-w-2xl mx-auto space-y-5">
            <div className="text-center py-2">
              <span className="inline-block px-3 py-1 bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-950/20 dark:to-indigo-950/20 rounded-full text-[11px] font-bold text-violet-600 dark:text-violet-300 shadow-sm border border-violet-100 dark:border-violet-900/20">Welcome to the room</span>
            </div>
            {messages.map((msg) => (
              <div key={msg.id} className={cn("flex gap-3 animate-slide-in-up", msg.username === 'System' && "justify-center")}>
                {msg.username === 'System' ? (
                  <div className="text-xs text-muted-foreground bg-muted/40 px-4 py-2 rounded-full shadow-inner backdrop-blur border border-border/30">{msg.content}</div>
                ) : (
                  <>
                    <Avatar className="h-9 w-9 flex-shrink-0 shadow-lg ring-2 ring-white dark:ring-card mt-0.5"><AvatarFallback className={cn("text-xs font-extrabold shadow-inner", msg.username === username ? "bg-gradient-to-br from-violet-500 to-indigo-600 text-white" : "bg-gradient-to-br from-amber-100 to-orange-100 text-amber-700 dark:from-amber-900 dark:to-orange-900 dark:text-amber-200")}>{msg.username.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="font-extrabold text-sm">{msg.username}</span>
                        <span className="text-[10px] text-muted-foreground font-medium">{formatTime(msg.created_at)}</span>
                      </div>
                      <div className={cn("inline-block px-4 py-2.5 text-sm leading-relaxed shadow-md", msg.username === username ? "bubble-own" : "bubble-other")}>
                        {msg.content}
                      </div>
                      {/* Reactions */}
                      <div className="flex items-center gap-1.5 mt-1.5 ml-0.5">
                        {(messageReactions[msg.id] || []).map((r, i) => (
                          <button key={i} onClick={() => addReaction(msg.id, r)} className="text-[11px] px-1.5 py-0.5 bg-white dark:bg-card rounded-full shadow-sm border border-border/30 hover:scale-110 transition-transform">{r}</button>
                        ))}
                        <div className="flex gap-0.5 ml-1">
                          {REACTIONS.map(r => (
                            <button key={r} onClick={() => addReaction(msg.id, r)} className="text-[11px] hover:scale-125 hover:-translate-y-0.5 transition-all p-0.5 opacity-50 hover:opacity-100">{r}</button>
                          ))}
                        </div>
                      </div>
                      {msg.file_url && (
                        <div className="mt-2.5 ml-0.5">
                          {msg.file_type?.startsWith('audio/') ? (
                            <VoiceMessagePlayer url={msg.file_url} durationSec={msg.audio_duration ? msg.audio_duration / 1000 : 0} />
                          ) : msg.file_type?.startsWith('image/') ? (
                            <a href={msg.file_url} className="inline-block rounded-2xl overflow-hidden shadow-xl ring-1 ring-border/20 hover:scale-[1.02] transition-transform duration-300">
                              <img src={msg.file_url} alt={msg.file_name || 'Shared'} className="max-w-[220px] md:max-w-xs rounded-2xl" />
                            </a>
                          ) : (
                            <a href={msg.file_url} download={msg.file_name} className="inline-flex items-center gap-2 px-3.5 py-2 bg-card hover:bg-secondary rounded-2xl shadow-md border border-border/30 transition-all hover:shadow-lg hover:-translate-y-0.5 text-xs font-medium">
                              {msg.file_type?.includes('pdf') ? <FileText className="w-3.5 h-3.5 text-red-500" /> : <File className="w-3.5 h-3.5 text-blue-500" />}
                              <span className="truncate max-w-[120px] md:max-w-[180px]">{msg.file_name}</span>
                              <Download className="w-3 h-3 ml-auto text-muted-foreground" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
            {typingUsers.length > 0 && (
              <div className="flex items-center gap-2 pl-12 animate-pulse-slow">
                <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 animate-bounce" />
                <span className="text-xs font-medium text-muted-foreground">{typingUsers.join(', ')} is typing...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Modern input */}
        <div className="p-3 md:p-4 bg-card/80 backdrop-blur-xl border-t border-border/30 shadow-[0_-4px_25px_rgba(0,0,0,0.02)]">
          <div className="max-w-2xl mx-auto">
            {selectedFile && (
              <div className="mb-2 p-2.5 bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-950/20 dark:to-indigo-950/20 rounded-2xl flex items-center justify-between border border-violet-100 dark:border-violet-900/20 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-gradient-primary flex items-center justify-center text-white shadow-md">{selectedFile.type.startsWith('image/') ? <Image className="w-3.5 h-3.5" /> : selectedFile.type.includes('pdf') ? <FileText className="w-3.5 h-3.5" /> : <File className="w-3.5 h-3.5" />}</div>
                  <div><p className="text-xs font-semibold truncate max-w-[140px] md:max-w-[240px]">{selectedFile.name}</p><p className="text-[10px] text-muted-foreground">{(selectedFile.size / 1024).toFixed(1)} KB</p></div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="h-7 w-7 rounded-full hover:bg-red-50 hover:text-red-500"><span>✕</span></Button>
              </div>
            )}
            <div className="flex gap-2.5 items-end">
              <VoiceRecorder onAudioReady={(blob, durationMs) => { setAudioBlob(blob); setAudioDuration(durationMs); }} disabled={uploading} className="flex-shrink-0" />
              <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx,.txt,.zip,.rar" onChange={e => { if (e.target.files?.[0]) { const f = e.target.files[0]; if (f.size > 10 * 1024 * 1024) { toast({ title: "File too large", description: "Please select a file smaller than 10MB", variant: "destructive" }); return; } setSelectedFile(f); } }} className="hidden" />
              <Button variant="outline" size="icon" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="rounded-full h-10 w-10 shadow-sm border-border/40 hover:bg-secondary hover:scale-105 transition-all"><Paperclip className="w-4 h-4 text-muted-foreground" /></Button>
              <div className="flex-1 relative">
                <Input ref={messageInputRef} type="text" placeholder={`Message ${roomCode}...`} value={message} onChange={e => { setMessage(e.target.value); }} onKeyDown={e => e.key === 'Enter' && !uploading && handleSendMessage()} className="h-10 rounded-full bg-white dark:bg-card px-5 shadow-md border-border/20 focus-visible:ring-violet-400 focus-visible:ring-2 focus-visible:border-transparent text-sm pr-10" disabled={uploading} />
              </div>
              <Button onClick={handleSendMessage} disabled={(!message.trim() && !selectedFile && !audioBlob) || uploading} className="h-10 w-10 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:brightness-110 hover:scale-110 shadow-xl shadow-violet-500/25 transition-all" size="icon">
                {uploading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send className="w-4 h-4 text-white" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
