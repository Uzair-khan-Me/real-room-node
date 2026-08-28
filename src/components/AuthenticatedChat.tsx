import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { VoiceCall } from '@/components/VoiceCall';
import { VoiceMessagePlayer } from '@/components/VoiceMessagePlayer';
import { Send, Hash, Lock, Users, Circle, LogOut, Plus, UserPlus, Paperclip, Download, FileText, Image, File, Heart, Smile, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { User, Session } from '@supabase/supabase-js';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';

interface Message {
  id: string; username: string; content: string; created_at: string;
  room_id: string; user_id: string | null;
  file_url?: string | null; file_name?: string | null;
  file_type?: string | null; file_size?: number | null;
  audio_duration?: number | null;
}

interface Room { id: string; name: string; type: 'public' | 'private'; }
interface UserPresence { user_id: string; username: string; is_typing: boolean; last_seen: string; room_id: string; }
interface Profile { id: string; username: string; }

const REACTIONS = ['❤️', '😂', '😍', '👍', '🔥'];

export const AuthenticatedChat: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [currentRoom, setCurrentRoom] = useState('general');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageReactions, setMessageReactions] = useState<Record<string, string[]>>({});
  const [rooms, setRooms] = useState<Room[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<UserPresence[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [joinRoomOpen, setJoinRoomOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomCode, setNewRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  const messageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Auth init
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session); setUser(session?.user ?? null);
      if (!session) navigate('/auth');
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setUser(session?.user ?? null);
      if (!session) navigate('/auth');
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  // Profile + rooms
  useEffect(() => {
    if (user) { loadProfile(); loadRooms(); }
  }, [user]);

  const loadProfile = async () => {
    if (!user) return;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (error) console.error('Profile error:', error); else setProfile(data);
  };

  const loadRooms = async () => {
    if (!user) return;
    const { data: publicRooms, error: publicError } = await supabase.from('rooms').select('*').eq('type', 'public');
    const { data: memberRooms, error: memberError } = await supabase.from('room_members').select('room_id').eq('user_id', user.id);
    if (publicError || memberError) { console.error('Rooms error:', publicError || memberError); return; }
    const privateIds = (memberRooms || []).map((m: any) => m.room_id);
    const { data: privateRooms } = await supabase.from('rooms').select('*').eq('type', 'private').in('id', privateIds.length > 0 ? privateIds : ['none']);
    setRooms([
      ...(publicRooms || []),
      ...(privateRooms || [])
    ].map((r: any) => ({ id: r.id, name: r.name, type: r.type as 'public' | 'private' })));
  };

  const joinRoom = async (roomId: string) => {
    if (!user) return;
    if (roomId === 'general') return;
    try {
      const { error } = await supabase.from('room_members').insert([{ room_id: roomId, user_id: user.id }]);
      if (error && !error.message.includes('duplicate')) console.error('Join error:', error);
    } catch (e: any) { console.error('Join exception:', e); }
  };

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  useEffect(() => { scrollToBottom(); }, [messages]);

  // Load messages + presence
  useEffect(() => {
    if (!user || !currentRoom) return;
    loadMessages(); updatePresence(false);
  }, [user, currentRoom]);

  // Realtime subscriptions
  useEffect(() => {
    if (!user || !currentRoom) return;
    const msgCh = supabase.channel('social-msgs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${currentRoom}` },
        (payload) => { const newMsg = payload.new as Message; setMessages(prev => [...prev, newMsg]); scrollToBottom(); })
      .subscribe();
    const presenceCh = supabase.channel('social-presence')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence', filter: `room_id=eq.${currentRoom}` }, () => loadPresence())
      .subscribe();
    const interval = setInterval(() => updatePresence(false), 30000);
    return () => {
      supabase.removeChannel(msgCh); supabase.removeChannel(presenceCh); clearInterval(interval);
      if (user && currentRoom) clearPresence();
    };
  }, [user, currentRoom]);

  const loadMessages = async () => {
    if (!user || !currentRoom) return;
    try {
      const { data: messages, error } = await supabase.from('messages').select('*').eq('room_id', currentRoom).order('created_at', { ascending: true }).limit(100);
      if (error) { toast({ title: "Error loading messages", description: error.message, variant: "destructive" }); return; }
      const userIds = [...new Set((messages || []).filter((m: any) => m.user_id).map((m: any) => m.user_id))];
      const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', userIds);
      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p.username]));
      setMessages((messages || []).map((msg: any) => ({
        ...msg,
        username: msg.user_id ? (profileMap.get(msg.user_id) || msg.username || 'Unknown') : (msg.username || 'System')
      })));
      scrollToBottom();
    } catch (e: any) { console.error('Load messages error:', e); }
  };

  const loadPresence = async () => {
    try {
      const { data: presence, error } = await supabase.from('user_presence').select('*').eq('room_id', currentRoom).gte('last_seen', new Date(Date.now() - 60000).toISOString());
      if (error) return;
      const userIds = [...new Set((presence || []).filter((p: any) => p.user_id).map((p: any) => p.user_id))];
      const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', userIds);
      const map = new Map((profiles || []).map((p: any) => [p.id, p.username]));
      const transformed = (presence || []).map((p: any) => ({ ...p, username: p.user_id ? (map.get(p.user_id) || p.username || 'Unknown') : (p.username || 'Unknown') }));
      setOnlineUsers(transformed.filter((p: any) => p.user_id !== user?.id));
      setTypingUsers(transformed.filter((p: any) => p.is_typing && p.user_id !== user?.id).map((p: any) => p.username));
    } catch (e: any) { console.error('Presence error:', e); }
  };

  const updatePresence = async (isTyping: boolean) => {
    if (!user || !profile || !currentRoom) return;
    try {
      await supabase.from('user_presence').upsert({
        room_id: currentRoom, user_id: user.id, username: profile.username, is_typing: isTyping, last_seen: new Date().toISOString()
      }, { onConflict: 'room_id,username' });
    } catch (e: any) { console.error('Presence update error:', e); }
  };
  const clearPresence = async () => {
    if (!user || !currentRoom) return;
    try { await supabase.from('user_presence').delete().eq('room_id', currentRoom).eq('user_id', user.id); } catch (e) {}
  };

  const handleSendMessage = useCallback(async () => {
    if ((!message.trim() && !selectedFile && !audioBlob) || !user || !profile || !currentRoom) return;
    try {
      setUploading(true);
      let fileUrl: string | null = null;
      let fileName: string | null = null;
      let fileType: string | null = null;
      let fileSize: number | null = null;
      let content = message.trim() ? message : '';

      if (selectedFile) {
        const fileExt = selectedFile.name.split('.').pop();
        const filePath = `${user.id}/${Date.now()}.${fileExt}`;
        const { data, error: uploadErr } = await supabase.storage.from('chat-files').upload(filePath, selectedFile);
        if (uploadErr) { toast({ title: "Upload failed", description: uploadErr.message, variant: "destructive" }); setUploading(false); return; }
        const { data: { publicUrl } } = supabase.storage.from('chat-files').getPublicUrl(filePath);
        fileUrl = publicUrl; fileName = selectedFile.name; fileType = selectedFile.type; fileSize = selectedFile.size;
        content = message.trim() ? message : `Shared a file: ${fileName}`;
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setUploading(false);
      }

      // Upload audio if recorded
      if (audioBlob) {
        const filePath = `${user.id}/${Date.now()}_voice.webm`;
        const { error: uploadErr } = await supabase.storage.from('chat-files').upload(filePath, audioBlob, { contentType: 'audio/webm' });
        if (uploadErr) { toast({ title: "Audio upload failed", description: uploadErr.message, variant: "destructive" }); setUploading(false); return; }
        const { data: { publicUrl } } = supabase.storage.from('chat-files').getPublicUrl(filePath);
        fileUrl = publicUrl; fileName = 'Voice message'; fileType = 'audio/webm'; fileSize = audioBlob.size;
        content = message.trim() ? message : 'Sent a voice message';
        setMessage(content); setAudioBlob(null); setAudioDuration(0);
      }

      const messageData = {
        username: profile.username,
        content: content || `Shared a file: ${fileName}`,
        room_id: currentRoom,
        user_id: user.id,
        file_url: fileUrl,
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
        audio_duration: audioDuration > 0 ? audioDuration : null,
      };

      if (selectedFile) { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }
      setMessage(''); messageInputRef.current?.focus();
      const { error } = await supabase.from('messages').insert(messageData);
      if (error) { toast({ title: "Send failed", description: error.message, variant: "destructive" }); setMessage(messageData.content); }
    } catch (e: any) {
      toast({ title: "Send error", description: e.message || "Failed to send message", variant: "destructive" });
      setUploading(false);
    } finally { setUploading(false); }
  }, [message, selectedFile, audioBlob, user, profile, currentRoom, audioDuration, toast]);

  const handleTyping = useCallback(() => {
    if (user && message.length > 0) {
      updatePresence(true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => updatePresence(false), 2000);
    }
  }, [message, user]);

  const switchRoom = async (roomId: string) => {
    await clearPresence();
    setCurrentRoom(roomId);
    if (roomId !== 'general') await joinRoom(roomId);
  };

  const handleCreateRoom = async () => {
    if (!newRoomName.trim() || !newRoomCode.trim()) {
      toast({ title: "Error", description: "Please enter both room name and code", variant: "destructive" }); return;
    }
    try {
      const { data, error } = await supabase.rpc('create_private_room', { p_room_name: newRoomName, p_room_code: newRoomCode });
      const result = data as { success: boolean; error?: string; room_id?: string; } | null;
      if (error || !result?.success) {
        toast({ title: "Error creating room", description: result?.error || error?.message || "Failed to create room", variant: "destructive" }); return;
      }
      toast({ title: "Room created!", description: `Share the code "${newRoomCode}" with others to join` });
      setCreateRoomOpen(false); setNewRoomName(''); setNewRoomCode('');
      await loadRooms(); if (result.room_id) switchRoom(result.room_id);
    } catch (e: any) { toast({ title: "Room creation failed", description: e.message || "Unknown error", variant: "destructive" }); }
  };

  const handleJoinRoom = async () => {
    if (!joinCode.trim()) {
      toast({ title: "Error", description: "Please enter a room code", variant: "destructive" }); return;
    }
    try {
      const { data, error } = await supabase.rpc('join_private_room', { p_room_code: joinCode });
      const result = data as { success: boolean; error?: string; room_id?: string; message?: string } | null;
      if (error || !result?.success) {
        toast({ title: "Error joining room", description: result?.error || error?.message || "Failed to join room", variant: "destructive" }); return;
      }
      toast({ title: "Joined successfully!", description: result.message || "Welcome to the room" });
      setJoinRoomOpen(false); setJoinCode(''); await loadRooms(); if (result.room_id) switchRoom(result.room_id);
    } catch (e: any) { toast({ title: "Join failed", description: e.message || "Failed to fetch", variant: "destructive" }); }
  };

  const handleSignOut = async () => {
    await clearPresence(); await supabase.auth.signOut(); navigate('/');
  };

  const formatTime = (dateString: string) => new Date(dateString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const addReaction = async (msgId: string, reaction: string) => {
    setMessageReactions(prev => {
      const existing = prev[msgId] || [];
      return { ...prev, [msgId]: existing.includes(reaction) ? existing.filter(r => r !== reaction) : [...existing, reaction] };
    });
  };

  if (!user || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-subtle">
        <Card className="p-10 shadow-xl bg-card/90 backdrop-blur rounded-3xl border border-border/50">
          <div className="w-14 h-14 rounded-full bg-gradient-primary mx-auto mb-5 shadow-glow animate-pulse-slow" />
          <p className="text-xl font-medium text-foreground text-center">Loading your feed...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gradient-subtle overflow-hidden">
      {/* Sidebar — modern social style */}
      <aside className="w-72 hidden md:flex flex-col bg-card/80 backdrop-blur-xl border-r border-border/60 shadow-xl">
        <div className="p-6 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-gradient-primary shadow-glow flex items-center justify-center text-white font-bold text-lg shadow-md">{profile.username.slice(0, 1).toUpperCase()}</div>
            <div>
              <h2 className="font-bold text-lg leading-tight">{profile.username}</h2>
              <span className="text-xs text-success font-medium flex items-center gap-1"><Circle className="w-2 h-2 fill-current" /> Active now</span>
            </div>
          </div>
        </div>
        
        <ScrollArea className="flex-1 px-4 py-4">
          <div className="space-y-1">
            {/* Public Rooms */}
            {rooms.filter(r => r.type === 'public').length > 0 && (
              <div className="mb-4">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 px-2">Public Channels</h3>
                {rooms.filter(r => r.type === 'public').map(room => (
                  <button key={room.id} onClick={() => switchRoom(room.id)}
                    className={cn("w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-all hover:bg-secondary/60 mb-1",
                      currentRoom === room.id ? "bg-gradient-primary text-white shadow-lg shadow-violet-500/20 scale-[1.02]" : "text-foreground hover:scale-[1.01]")}
                  >
                    <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shadow-sm text-sm font-bold", currentRoom === room.id ? "bg-white/20" : "bg-gradient-to-br from-violet-100 to-indigo-100 text-violet-600")}>
                      {room.name[0]?.toUpperCase() || '#'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{room.name}</p>
                      <p className="text-xs opacity-70 truncate">{currentRoom === room.id ? 'Active now' : 'Public room'}</p>
                    </div>
                    {currentRoom === room.id && <div className="w-2 h-2 rounded-full bg-white animate-pulse" />}
                  </button>
                ))}
              </div>
            )}
            
            {/* Private Rooms */}
            {rooms.filter(r => r.type === 'private').length > 0 && (
              <div className="mb-4">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 px-2">Private Rooms</h3>
                {rooms.filter(r => r.type === 'private').map(room => (
                  <button key={room.id} onClick={() => switchRoom(room.id)}
                    className={cn("w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-all hover:bg-secondary/60 mb-1",
                      currentRoom === room.id ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/20 scale-[1.02]" : "text-foreground hover:scale-[1.01]")}
                  >
                    <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shadow-sm text-sm font-bold", currentRoom === room.id ? "bg-white/20" : "bg-gradient-to-br from-amber-100 to-orange-100 text-amber-600")}>
                      <Lock className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{room.name}</p>
                      <p className="text-xs opacity-70 truncate">Private · {currentRoom === room.id ? 'Active' : 'Locked'}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Room Actions */}
            <div className="border-t border-border/40 pt-4 space-y-1">
              <Dialog open={createRoomOpen} onOpenChange={setCreateRoomOpen}>
                <DialogTrigger asChild>
                  <button className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left text-sm font-semibold transition-all hover:bg-gradient-primary hover:text-white hover:shadow-md hover:scale-[1.02] text-foreground">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white shadow-md"><Plus className="w-4 h-4" /></div>
                    Create Private Room
                  </button>
                </DialogTrigger>
                <DialogContent className="rounded-3xl border-border/50 shadow-2xl bg-card/95 backdrop-blur-xl">
                  <DialogHeader><DialogTitle className="text-xl font-bold">Create Room</DialogTitle><DialogDescription>Create a private space for your friends.</DialogDescription></DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div><Label htmlFor="room-name">Room Name</Label><Input id="room-name" placeholder="Cool room name" value={newRoomName} onChange={e => setNewRoomName(e.target.value)} className="rounded-xl" /></div>
                    <div><Label htmlFor="room-code">Room Code</Label><Input id="room-code" placeholder="Unique code" value={newRoomCode} onChange={e => setNewRoomCode(e.target.value)} className="rounded-xl" /></div>
                    <Button onClick={handleCreateRoom} className="w-full rounded-xl bg-gradient-primary hover:brightness-110 shadow-lg">Create Room</Button>
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog open={joinRoomOpen} onOpenChange={setJoinRoomOpen}>
                <DialogTrigger asChild>
                  <button className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left text-sm font-semibold transition-all hover:bg-gradient-to-r hover:from-violet-600 hover:to-indigo-600 hover:text-white hover:shadow-md hover:scale-[1.02] text-foreground">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-md"><UserPlus className="w-4 h-4" /></div>
                    Join Private Room
                  </button>
                </DialogTrigger>
                <DialogContent className="rounded-3xl border-border/50 shadow-2xl bg-card/95 backdrop-blur-xl">
                  <DialogHeader><DialogTitle className="text-xl font-bold">Join Room</DialogTitle><DialogDescription>Enter the code shared with you.</DialogDescription></DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div><Label htmlFor="join-code">Room Code</Label><Input id="join-code" placeholder="Enter code" value={joinCode} onChange={e => setJoinCode(e.target.value)} className="rounded-xl" /></div>
                    <Button onClick={handleJoinRoom} className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:brightness-110 shadow-lg">Join Room</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </ScrollArea>
        
        {/* Online Users — social style */}
        <div className="border-t border-border/40 p-5 bg-gradient-to-b from-card/50 to-transparent">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Active Now</h3>
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-violet-500 to-indigo-600 rounded-full text-white text-xs font-bold shadow-md">
              <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-[10px]">{profile.username.slice(0, 1).toUpperCase()}</div>
              <span>You</span>
            </div>
            {onlineUsers.slice(0, 6).map((u, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 bg-card rounded-full text-xs font-medium shadow-sm border border-border/30 hover:shadow-md transition-all hover:scale-105">
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-[8px] text-white font-bold">{u.username.slice(0, 1).toUpperCase()}</div>
                <span className="truncate max-w-[80px]">{u.username}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-success" />
              </div>
            ))}
          </div>
        </div>
        
        {/* User info footer */}
        <div className="p-4 border-t border-border/40 bg-card/60 backdrop-blur">
          <button onClick={handleSignOut} className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-sm font-medium text-foreground hover:bg-red-50 hover:text-red-600 transition-all hover:shadow-md hover:scale-[1.01]">
            <Avatar className="h-9 w-9 shadow-md"><AvatarFallback className="bg-gradient-primary text-white text-sm font-bold">{profile.username.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
            <div className="flex-1 text-left"><p className="font-bold text-sm">{profile.username}</p><p className="text-xs text-muted-foreground">Sign out</p></div>
            <LogOut className="w-4 h-4 opacity-60" />
          </button>
        </div>
      </aside>

      {/* Main Chat Area — Instagram-style feed */}
      <main className="flex-1 flex flex-col bg-gradient-subtle min-w-0">
        {/* Modern header with user profile */}
        <header className="h-16 bg-card/80 backdrop-blur-xl border-b border-border/40 px-6 flex items-center justify-between shadow-sm sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10 shadow-lg ring-2 ring-gradient-primary/20 ring-offset-2">
              <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${currentRoom}`} />
              <AvatarFallback className="bg-gradient-to-br from-violet-500 to-indigo-600 text-white font-bold">{currentRoom.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-lg font-extrabold leading-tight">{currentRoom}</h1>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {onlineUsers.length + 1} online</span>
                <span>·</span>
                <span className="flex items-center gap-1"><Circle className="w-1.5 h-1.5 fill-success text-success" /> Secure</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <VoiceCall roomId={currentRoom} userId={user.id} username={profile?.username || 'User'} onCallStateChange={() => {}} />
            <div className="hidden md:block text-xs font-medium text-muted-foreground bg-secondary/50 px-3 py-1.5 rounded-full">Social Chat</div>
          </div>
        </header>

        {/* Messages — modern feed style */}
        <ScrollArea className="flex-1 p-6 md:p-8">
          <div className="max-w-3xl mx-auto space-y-6">
            {/* Welcome banner */}
            <div className="text-center py-4">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-950/20 dark:to-indigo-950/20 rounded-full text-xs font-medium text-violet-600 dark:text-violet-300 shadow-sm border border-violet-100 dark:border-violet-900/20">
                <Smile className="w-3.5 h-3.5" /> Welcome to {currentRoom} — say hello!
              </div>
            </div>
            
            {messages.map((msg) => (
              <div key={msg.id} className={cn("flex gap-3 animate-slide-in-up group", msg.username === 'System' && "justify-center")}>
                {msg.username === 'System' ? (
                  <div className="text-xs text-muted-foreground bg-muted/40 px-4 py-2 rounded-full shadow-inner border border-border/30 backdrop-blur">
                    {msg.content}
                  </div>
                ) : (
                  <>
                    <div className="flex-shrink-0 pt-1">
                      <Avatar className="h-10 w-10 shadow-md ring-2 ring-white dark:ring-card">
                        <AvatarFallback className={cn("text-sm font-bold shadow-inner", msg.user_id === user?.id ? "bg-gradient-to-br from-violet-500 to-indigo-600 text-white" : "bg-gradient-to-br from-amber-100 to-orange-100 text-amber-700 dark:from-amber-900 dark:to-orange-900 dark:text-amber-200")}>
                          {msg.username.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="font-extrabold text-sm text-foreground">{msg.username}</span>
                        <span className="text-[10px] text-muted-foreground font-medium">{formatTime(msg.created_at)}</span>
                      </div>
                      <div className={cn("inline-block px-5 py-3 text-sm leading-relaxed shadow-md", msg.user_id === user?.id ? "bubble-own" : "bubble-other")}>
                        {msg.content}
                      </div>
                      
                      {/* Reactions */}
                      <div className="flex items-center gap-2 mt-1.5 ml-1">
                        {(messageReactions[msg.id] || []).map((r, i) => (
                          <button key={i} onClick={() => addReaction(msg.id, r)} className="text-xs px-2 py-0.5 bg-white dark:bg-card rounded-full shadow-sm border border-border/40 hover:scale-110 transition-transform">{r}</button>
                        ))}
                        <div className="flex gap-0.5">
                          {REACTIONS.map(r => (
                            <button key={r} onClick={() => addReaction(msg.id, r)} className="text-xs hover:scale-125 transition-transform p-0.5 opacity-60 hover:opacity-100">{r}</button>
                          ))}
                        </div>
                      </div>
                      
                      {msg.file_url && (
                        <div className="mt-3 ml-1">
                          {msg.file_type?.startsWith('audio/') ? (
                            <VoiceMessagePlayer url={msg.file_url} durationSec={msg.audio_duration ? msg.audio_duration / 1000 : 0} />
                          ) : msg.file_type?.startsWith('image/') ? (
                            <div className="relative inline-block rounded-2xl overflow-hidden shadow-xl ring-1 ring-border/20">
                              <img src={msg.file_url} alt={msg.file_name || 'Shared'} className="max-w-xs rounded-2xl hover:scale-[1.02] transition-transform duration-300" />
                              <a href={msg.file_url} download={msg.file_name} className="absolute top-2 right-2 p-2 bg-black/30 hover:bg-black/60 rounded-xl backdrop-blur text-white transition-colors"><Download className="w-3.5 h-3.5" /></a>
                            </div>
                          ) : (
                            <a href={msg.file_url} download={msg.file_name} className="inline-flex items-center gap-2.5 px-4 py-2.5 bg-card hover:bg-secondary rounded-2xl shadow-md border border-border/40 transition-all hover:shadow-lg hover:-translate-y-0.5 text-sm font-medium">
                              {msg.file_type?.includes('pdf') ? <FileText className="w-4 h-4 text-red-500" /> : <File className="w-4 h-4 text-blue-500" />}
                              <span className="truncate max-w-[150px]">{msg.file_name}</span>
                              <span className="text-[10px] text-muted-foreground">({(msg.file_size ? msg.file_size / 1024 : 0).toFixed(1)} KB)</span>
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
            
            {/* Typing indicator — modern */}
            {typingUsers.length > 0 && (
              <div className="flex items-center gap-3 pl-14 animate-pulse-slow">
                <div className="w-2 h-2 rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 animate-bounce" />
                <span className="text-xs font-medium text-muted-foreground">{typingUsers.join(', ')} is typing...</span>
                <span className="flex gap-1">
                  {[0, 1, 2].map(i => <span key={i} className="w-1 h-1 rounded-full bg-violet-400/60 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />)}
                </span>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Modern input — Instagram-style */}
        <div className="p-4 md:p-6 bg-card/80 backdrop-blur-xl border-t border-border/40 shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">
          <div className="max-w-3xl mx-auto">
            {selectedFile && (
              <div className="mb-3 p-3 bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-950/20 dark:to-indigo-950/20 rounded-2xl flex items-center justify-between border border-violet-100 dark:border-violet-900/20 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-primary flex items-center justify-center text-white shadow-md">
                    {selectedFile.type.startsWith('image/') ? <Image className="w-4 h-4" /> : selectedFile.type.includes('pdf') ? <FileText className="w-4 h-4" /> : <File className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold truncate max-w-[200px] md:max-w-[300px]">{selectedFile.name}</p>
                    <p className="text-[10px] text-muted-foreground">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="h-7 w-7 rounded-full hover:bg-red-50 hover:text-red-500">
                  <span>✕</span>
                </Button>
              </div>
            )}
            <div className="flex gap-3 items-end">
              <VoiceRecorder onAudioReady={(blob, durationMs) => { setAudioBlob(blob); setAudioDuration(durationMs); }} disabled={uploading} className="flex-shrink-0" />
              <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx,.txt,.zip,.rar" onChange={e => { if (e.target.files?.[0]) { const f = e.target.files[0]; if (f.size > 10 * 1024 * 1024) { toast({ title: "File too large", description: "Please select a file smaller than 10MB", variant: "destructive" }); return; } setSelectedFile(f); } }} className="hidden" />
              <Button variant="outline" size="icon" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="rounded-full h-11 w-11 shadow-sm border-border/60 hover:bg-secondary hover:scale-105 transition-all" title="Attach file"><Paperclip className="w-4 h-4 text-muted-foreground" /></Button>
              <div className="flex-1 relative">
                <Input ref={messageInputRef} type="text" placeholder={`Message ${currentRoom}...`} value={message} onChange={e => { setMessage(e.target.value); handleTyping(); }} onKeyDown={e => e.key === 'Enter' && !uploading && handleSendMessage()} className="h-11 rounded-full bg-white dark:bg-card px-5 shadow-md border-border/30 focus-visible:ring-violet-400 focus-visible:ring-2 focus-visible:border-transparent text-sm pr-12" disabled={uploading} />
              </div>
              <Button onClick={handleSendMessage} disabled={(!message.trim() && !selectedFile && !audioBlob) || uploading} className="h-11 w-11 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:brightness-110 hover:scale-110 shadow-xl shadow-violet-500/25 transition-all" size="icon">
                {uploading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send className="w-4 h-4 text-white" />}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AuthenticatedChat;
