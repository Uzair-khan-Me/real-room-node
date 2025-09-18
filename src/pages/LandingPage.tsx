import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Globe, Lock, Users, ArrowRight } from 'lucide-react';
import { AnonymousChat } from '@/components/AnonymousChat';
import { useToast } from '@/hooks/use-toast';

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [mode, setMode] = useState<'landing' | 'anonymous'>('landing');
  const [roomCode, setRoomCode] = useState('');
  const [username, setUsername] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [inputUsername, setInputUsername] = useState('');

  const handleGlobalChat = () => {
    navigate('/auth');
  };

  const handleAnonymousJoin = () => {
    if (!inputCode.trim() || !inputUsername.trim()) {
      toast({
        title: "Missing information",
        description: "Please enter both a room code and username",
        variant: "destructive"
      });
      return;
    }

    setRoomCode(inputCode.trim());
    setUsername(inputUsername.trim());
    setMode('anonymous');
  };

  const handleExitAnonymous = () => {
    setMode('landing');
    setRoomCode('');
    setUsername('');
    setInputCode('');
    setInputUsername('');
  };

  if (mode === 'anonymous' && roomCode && username) {
    return (
      <AnonymousChat 
        roomCode={roomCode} 
        username={username}
        onExit={handleExitAnonymous}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-subtle flex items-center justify-center p-4">
      <div className="max-w-6xl w-full">
        <div className="text-center mb-12">
          <div className="flex justify-center mb-6">
            <div className="p-4 bg-primary/10 rounded-2xl">
              <MessageCircle className="h-16 w-16 text-primary" />
            </div>
          </div>
          <h1 className="text-5xl font-bold mb-4 bg-gradient-primary bg-clip-text text-transparent">
            Emon Chat
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Connect with the world or create private rooms with friends. Choose your chat experience.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* Global Chat Option */}
          <Card className="p-8 hover:shadow-lg transition-shadow">
            <div className="flex justify-center mb-6">
              <div className="p-3 bg-blue-500/10 rounded-xl">
                <Globe className="h-10 w-10 text-blue-500" />
              </div>
            </div>
            <h2 className="text-2xl font-semibold mb-4 text-center">Global Chat</h2>
            <p className="text-muted-foreground mb-6 text-center">
              Create an account to chat with people from around the world in public and private rooms.
            </p>
            <ul className="space-y-2 mb-6">
              <li className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 text-primary" />
                <span>Public chat rooms</span>
              </li>
              <li className="flex items-center gap-2 text-sm">
                <Lock className="h-4 w-4 text-primary" />
                <span>Create private rooms with codes</span>
              </li>
              <li className="flex items-center gap-2 text-sm">
                <MessageCircle className="h-4 w-4 text-primary" />
                <span>Persistent chat history</span>
              </li>
            </ul>
            <Button 
              onClick={handleGlobalChat} 
              className="w-full"
              size="lg"
            >
              Sign Up / Login
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Card>

          {/* Anonymous Chat Option */}
          <Card className="p-8 hover:shadow-lg transition-shadow">
            <div className="flex justify-center mb-6">
              <div className="p-3 bg-purple-500/10 rounded-xl">
                <Lock className="h-10 w-10 text-purple-500" />
              </div>
            </div>
            <h2 className="text-2xl font-semibold mb-4 text-center">Quick Private Room</h2>
            <p className="text-muted-foreground mb-6 text-center">
              No account needed. Just enter a room code to chat privately with friends.
            </p>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="room-code">Room Code</Label>
                <Input
                  id="room-code"
                  placeholder="Enter or create a code"
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAnonymousJoin()}
                />
                <p className="text-xs text-muted-foreground">
                  Share this code with your friend to connect
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="username">Your Name</Label>
                <Input
                  id="username"
                  placeholder="Choose a display name"
                  value={inputUsername}
                  onChange={(e) => setInputUsername(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAnonymousJoin()}
                />
              </div>
              <Button 
                onClick={handleAnonymousJoin}
                className="w-full"
                size="lg"
                variant="secondary"
              >
                Join Room
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-4 text-center">
              Rooms expire after 24 hours
            </p>
          </Card>
        </div>

        <div className="text-center mt-12">
          <p className="text-sm text-muted-foreground">
            For testing: You can disable email confirmation in the{' '}
            <a 
              href="https://supabase.com/dashboard/project/yafocvasvswdehcukqaa/auth/providers"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Supabase Dashboard
            </a>
            {' '}to speed up the signup process.
          </p>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;