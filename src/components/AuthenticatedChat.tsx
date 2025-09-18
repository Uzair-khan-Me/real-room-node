import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Send, Hash, Lock, Users, Circle, LogOut, Plus, UserPlus } from 'lucide-react';
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
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  const messageInputRef = useRef<HTMLInputElement>(null);
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
      joinRoom(currentRoom);
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
      clearPresence();
    };
  }, [user, currentRoom]);

  const loadMessages = async () => {
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .eq('room_id', currentRoom)
      .order('created_at', { ascending: true })
      .limit(100);

    if (messagesError) {
      console.error('Error loading messages:', messagesError);
      return;
    }

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
    if (message.trim() && user && profile) {
      const messageData = {
        username: profile.username,
        content: message,
        room_id: currentRoom,
        user_id: user.id
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
    await joinRoom(roomId);
    setCurrentRoom(roomId);
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
    navigate('/auth');
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
            <h1 className="text-xl font-semibold">{currentRoom}</h1>
          </div>
          <div className="text-sm text-muted-foreground">
            Secure Chat Room
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

export default AuthenticatedChat;