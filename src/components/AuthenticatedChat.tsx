import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { VoiceCall } from '@/components/VoiceCall';
import { VoiceMessagePlayer } from '@/components/VoiceMessagePlayer';
import { Send, Hash, Lock, Users, Circle, LogOut, Plus, UserPlus, Paperclip, Download, FileText, Image, File } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { User, Session } from '@supabase/supabase-js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';

interface Message {
  id: string;
  username: string;
  content: string;
  created_at: string;
  room_id: string;
  user_id: string | null;
  file_url?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  file_size?: number | null;
  audio_duration?: number | null;
}

interface Room {
  id: string;
  name: string;
  type: 'public' | 'private';
}

interface UserPresence {
  user_id: string;
  username: string;
  is_typing: boolean;
  last_seen: string;
  room_id: string;
}

interface Profile {
  id: string;
  username: string;
}

export const AuthenticatedChat: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [currentRoom, setCurrentRoom] = useState('general');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<UserPresence[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  
  // Private room modals
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

  // Initialize auth state
  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        if (!session) {
          navigate('/auth');
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (!session) {
        navigate('/auth');
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  // Load user profile and rooms
  useEffect(() => {
    if (user) {
      loadProfile();
      loadRooms();
      // Don't call joinRoom here, it's handled in switchRoom
    }
  }, [user]);

  const loadProfile = async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('Error loading profile:', error);
    } else {
      setProfile(data);
    }
  };

  const loadRooms = async () => {
    if (!user) return;

    // Load public rooms and private rooms the user is a member of
    const { data: publicRooms, error: publicError } = await supabase
      .from('rooms')
      .select('*')
      .eq('type', 'public');

    const { data: memberRooms, error: memberError } = await supabase
      .from('room_members')
      .select('room_id')
      .eq('user_id', user.id);

    if (publicError || memberError) {
      console.error('Error loading rooms:', publicError || memberError);
      return;
    }

    const privateRoomIds = memberRooms?.map(m => m.room_id) || [];
    
    const { data: privateRooms } = await supabase
      .from('rooms')
      .select('*')
      .eq('type', 'private')
      .in('id', privateRoomIds.length > 0 ? privateRoomIds : ['none']);

    const allRooms = [
      ...(publicRooms || []),
      ...(privateRooms || [])
    ];

    setRooms(allRooms.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type as 'public' | 'private'
    })));
  };

  const joinRoom = async (roomId: string) => {
    if (!user) return;

    // For general room, no need to explicitly join - it's automatically accessible
    if (roomId === 'general') {
      return;
    }

    // Add user to room members
    const { error } = await supabase
      .from('room_members')
      .insert([{ room_id: roomId, user_id: user.id }]);

    if (error && !error.message.includes('duplicate')) {
      console.error('Error joining room:', error);
    }
  };

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load messages when switching rooms
  useEffect(() => {
    if (user && currentRoom) {
      loadMessages();
      updatePresence(false);
    }
  }, [user, currentRoom]);

  // Set up real-time subscriptions
  useEffect(() => {
    if (!user) return;

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
    }, 30000);

    return () => {
      supabase.removeChannel(messageChannel);
      supabase.removeChannel(presenceChannel);
      clearInterval(presenceInterval);
      if (user && currentRoom) {
        clearPresence();
      }
    };
  }, [user, currentRoom]);

  const loadMessages = async () => {
    if (!user) {
      console.log('No user, skipping message load');
      return;
    }

    console.log('Loading messages for room:', currentRoom);

    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .eq('room_id', currentRoom)
      .order('created_at', { ascending: true })
      .limit(100);

    if (messagesError) {
      console.error('Error loading messages:', messagesError);
      toast({
        title: "Error loading messages",
        description: messagesError.message,
        variant: "destructive"
      });
      return;
    }

    console.log('Loaded messages:', messages?.length || 0);

    // Get profiles for user_ids
    const userIds = [...new Set(messages?.filter(m => m.user_id).map(m => m.user_id))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', userIds);

    // Map usernames to messages
    const profileMap = new Map(profiles?.map(p => [p.id, p.username]) || []);
    const transformedMessages = messages?.map(msg => ({
      ...msg,
      username: msg.user_id ? (profileMap.get(msg.user_id) || msg.username || 'Unknown') : (msg.username || 'System')
    })) || [];
    
    setMessages(transformedMessages);
    scrollToBottom();
  };

  const loadPresence = async () => {
    const { data: presence, error } = await supabase
      .from('user_presence')
      .select('*')
      .eq('room_id', currentRoom)
      .gte('last_seen', new Date(Date.now() - 60000).toISOString());

    if (error) {
      console.error('Error loading presence:', error);
      return;
    }

    // Get profiles for user_ids
    const userIds = [...new Set(presence?.filter(p => p.user_id).map(p => p.user_id))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', userIds);

    // Map usernames to presence
    const profileMap = new Map(profiles?.map(p => [p.id, p.username]) || []);
    const transformedPresence = presence?.map(p => ({
      ...p,
      username: p.user_id ? (profileMap.get(p.user_id) || p.username || 'Unknown') : (p.username || 'Unknown')
    })) || [];

    setOnlineUsers(transformedPresence.filter(p => p.user_id !== user?.id));
    const typing = transformedPresence
      .filter(p => p.is_typing && p.user_id !== user?.id)
      .map(p => p.username);
    setTypingUsers(typing);
  };

  const updatePresence = async (isTyping: boolean) => {
    if (!user || !profile) return;

    await supabase
      .from('user_presence')
      .upsert({
        room_id: currentRoom,
        user_id: user.id,
        username: profile.username,
        is_typing: isTyping,
        last_seen: new Date().toISOString()
      }, {
        onConflict: 'room_id,username'
      });
  };

  const clearPresence = async () => {
    if (user && currentRoom) {
      await supabase
        .from('user_presence')
        .delete()
        .eq('room_id', currentRoom)
        .eq('user_id', user.id);
    }
  };

  const handleSendMessage = async () => {
    if (((message.trim() || selectedFile || audioBlob) && user && profile)) {
      let fileUrl = null;
      let fileName = null;
      let fileType = null;
      let fileSize = null;
      let content = message.trim() ? message : '';

      // Upload file if selected
      if (selectedFile) {
        setUploading(true);
        const fileExt = selectedFile.name.split('.').pop();
        const filePath = `${user.id}/${Date.now()}.${fileExt}`;

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
        const filePath = `${user.id}/${Date.now()}_voice.webm`;
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
        setMessage(messageData.content);
      }
    }
  };

  const handleTyping = () => {
    if (user && message.length > 0) {
      updatePresence(true);
      
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      
      typingTimeoutRef.current = setTimeout(() => {
        updatePresence(false);
      }, 2000);
    }
  };

  const switchRoom = async (roomId: string) => {
    await clearPresence();
    setCurrentRoom(roomId);
    // joinRoom is handled automatically for general room
    if (roomId !== 'general') {
      await joinRoom(roomId);
    }
  };

  const handleCreateRoom = async () => {
    if (!newRoomName.trim() || !newRoomCode.trim()) {
      toast({
        title: "Error",
        description: "Please enter both room name and code",
        variant: "destructive"
      });
      return;
    }

    const { data, error } = await supabase.rpc('create_private_room', {
      p_room_name: newRoomName,
      p_room_code: newRoomCode
    });

    const result = data as { success: boolean; error?: string; room_id?: string; room_code?: string } | null;

    if (error || !result?.success) {
      toast({
        title: "Error creating room",
        description: result?.error || error?.message || "Failed to create room",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Room created!",
      description: `Share the code "${newRoomCode}" with others to join`,
    });

    setCreateRoomOpen(false);
    setNewRoomName('');
    setNewRoomCode('');
    await loadRooms();
    if (result.room_id) {
      switchRoom(result.room_id);
    }
  };

  const handleJoinRoom = async () => {
    if (!joinCode.trim()) {
      toast({
        title: "Error",
        description: "Please enter a room code",
        variant: "destructive"
      });
      return;
    }

    const { data, error } = await supabase.rpc('join_private_room', {
      p_room_code: joinCode
    });

    const result = data as { success: boolean; error?: string; room_id?: string; message?: string } | null;

    if (error || !result?.success) {
      toast({
        title: "Error joining room",
        description: result?.error || error?.message || "Failed to join room",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Joined room successfully!",
      description: result.message || "You can now chat in this room",
    });

    setJoinRoomOpen(false);
    setJoinCode('');
    await loadRooms();
    if (result.room_id) {
      switchRoom(result.room_id);
    }
  };

  const handleSignOut = async () => {
    await clearPresence();
    await supabase.auth.signOut();
    navigate('/');
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!user || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-subtle">
        <Card className="p-8">
          <p className="text-muted-foreground">Loading...</p>
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
            {/* Public Rooms */}
            {rooms.filter(r => r.type === 'public').length > 0 && (
              <>
                <div className="text-xs font-medium text-sidebar-foreground/60 px-3 py-1">
                  Public Rooms
                </div>
                {rooms.filter(r => r.type === 'public').map((room) => (
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
                    <Hash className="w-4 h-4 opacity-60" />
                    <span className="font-medium">{room.name}</span>
                  </button>
                ))}
              </>
            )}
            
            {/* Private Rooms */}
            {rooms.filter(r => r.type === 'private').length > 0 && (
              <>
                <div className="text-xs font-medium text-sidebar-foreground/60 px-3 py-1 mt-3">
                  Private Rooms
                </div>
                {rooms.filter(r => r.type === 'private').map((room) => (
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
                    <Lock className="w-4 h-4 opacity-60" />
                    <span className="font-medium">{room.name}</span>
                  </button>
                ))}
              </>
            )}

            {/* Room Actions */}
            <div className="border-t border-sidebar-border mt-3 pt-3 space-y-2">
              <Dialog open={createRoomOpen} onOpenChange={setCreateRoomOpen}>
                <DialogTrigger asChild>
                  <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors hover:bg-sidebar-accent/50 text-sidebar-foreground">
                    <Plus className="w-4 h-4 opacity-60" />
                    <span className="font-medium">Create Private Room</span>
                  </button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Private Room</DialogTitle>
                    <DialogDescription>
                      Create a private room with a unique code. Share this code with others to let them join.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="room-name">Room Name</Label>
                      <Input
                        id="room-name"
                        placeholder="Enter room name"
                        value={newRoomName}
                        onChange={(e) => setNewRoomName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="room-code">Room Code</Label>
                      <Input
                        id="room-code"
                        placeholder="Enter unique code"
                        value={newRoomCode}
                        onChange={(e) => setNewRoomCode(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Others will use this code to join your room
                      </p>
                    </div>
                    <Button onClick={handleCreateRoom} className="w-full">
                      Create Room
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog open={joinRoomOpen} onOpenChange={setJoinRoomOpen}>
                <DialogTrigger asChild>
                  <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors hover:bg-sidebar-accent/50 text-sidebar-foreground">
                    <UserPlus className="w-4 h-4 opacity-60" />
                    <span className="font-medium">Join Private Room</span>
                  </button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Join Private Room</DialogTitle>
                    <DialogDescription>
                      Enter the room code shared with you to join a private chat room.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="join-code">Room Code</Label>
                      <Input
                        id="join-code"
                        placeholder="Enter room code"
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value)}
                      />
                    </div>
                    <Button onClick={handleJoinRoom} className="w-full">
                      Join Room
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
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
                {profile.username} (You)
              </span>
            </div>
            {onlineUsers.slice(0, 4).map((user, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Circle className="w-2 h-2 fill-current text-success" />
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
                {profile.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">{profile.username}</p>
              <p className="text-xs text-success flex items-center gap-1">
                <Circle className="w-2 h-2 fill-current" />
                Online
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSignOut}
              className="h-8 w-8"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="h-16 border-b border-border bg-card px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Hash className="w-5 h-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold hidden sm:block">{currentRoom}</h1>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <VoiceCall roomId={currentRoom} userId={user.id} username={profile?.username || 'User'} />
            )}
            <span className="text-sm text-muted-foreground hidden md:inline">Secure Chat Room</span>
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
                        msg.user_id === user?.id
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
                        msg.user_id === user?.id
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
            <div className="flex gap-2">
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
                    // 10MB limit
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
                className="flex-shrink-0"
              >
                <Paperclip className="w-4 h-4" />
              </Button>
              <Input
                ref={messageInputRef}
                type="text"
                placeholder={`Message #${currentRoom}`}
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  handleTyping();
                }}
                onKeyPress={(e) => e.key === 'Enter' && !uploading && handleSendMessage()}
                className="flex-1 bg-background border-input"
                disabled={uploading}
              />
              <Button
                onClick={handleSendMessage}
                disabled={(!message.trim() && !selectedFile && !audioBlob) || uploading}
                className="bg-primary hover:bg-primary-glow transition-colors"
              >
                {uploading ? (
                  <div className="w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthenticatedChat;