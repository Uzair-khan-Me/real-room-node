import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VoiceSignaling } from '@/lib/voice-signaling';
import { supabase } from '@/integrations/supabase/client';

interface VoiceCallProps {
  roomId: string;
  userId: string;
  username: string;
  onCallStateChange?: (inCall: boolean) => void;
}

export const VoiceCall: React.FC<VoiceCallProps> = ({ roomId, userId, username, onCallStateChange }) => {
  const [inCall, setInCall] = useState(false);
  const [muted, setMuted] = useState(false);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [remoteUsername, setRemoteUsername] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const signalingRef = useRef<VoiceSignaling | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [callReady, setCallReady] = useState(false);

  // Initialize signaling on mount
  useEffect(() => {
    if (!roomId || !userId) return;

    const sig = new VoiceSignaling(supabase, roomId, userId);
    signalingRef.current = sig;

    const cleanup = sig.connect(
      async (msg) => {
        if (!peerConnectionRef.current) return;

        if (msg.type === 'offer') {
          await peerConnectionRef.current.setRemoteDescription(
            new RTCSessionDescription(msg.payload)
          );
          const answer = await peerConnectionRef.current.createAnswer();
          await peerConnectionRef.current.setLocalDescription(answer);
          await sig.send({ type: 'answer', payload: answer });
        } else if (msg.type === 'answer') {
          await peerConnectionRef.current.setRemoteDescription(
            new RTCSessionDescription(msg.payload)
          );
        } else if (msg.type === 'ice-candidate') {
          try {
            await peerConnectionRef.current.addIceCandidate(
              new RTCIceCandidate(msg.payload)
            );
          } catch (e) {
            console.error('ICE candidate error:', e);
          }
        } else if (msg.type === 'call-start') {
          setInCall(true);
          onCallStateChange?.(true);
          setRemoteUsername(msg.from === userId ? 'Peer' : msg.from);
          setConnected(true);
        } else if (msg.type === 'call-end') {
          setInCall(false);
          setConnected(false);
          setRemoteUsername(null);
          onCallStateChange?.(false);
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          setCallDuration(0);
        }
      },
      () => {
        setInCall(true);
        setConnected(true);
        setRemoteUsername('Peer');
        onCallStateChange?.(true);
        timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
      },
      () => {
        setInCall(false);
        setConnected(false);
        setRemoteUsername(null);
        onCallStateChange?.(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setCallDuration(0);
      }
    );

    return () => {
      if (typeof cleanup === 'function') cleanup();
      sig.disconnect();
      signalingRef.current = null;
      hangUpInternal();
    };
  }, [roomId, userId, onCallStateChange]);

  const createPeerConnection = useCallback(async () => {
    if (peerConnectionRef.current) return;
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    pc.onicecandidate = async (event) => {
      if (event.candidate && signalingRef.current) {
        await signalingRef.current.send({ type: 'ice-candidate', payload: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setConnected(true);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setConnected(false);
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  }, []);

  const startCall = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      setMuted(false);
      const pc = await createPeerConnection();
      if (!pc) return;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await signalingRef.current?.send({ type: 'offer', payload: offer });

      // Send call-start notification
      await signalingRef.current?.send({ type: 'call-start', payload: { username } });

      setInCall(true);
      setConnected(false);
      setRemoteUsername('Peer');
      onCallStateChange?.(true);
      timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
    } catch (e) {
      console.error('Failed to start call:', e);
      alert('Failed to start voice call. Please check microphone permissions.');
    }
  }, [createPeerConnection, username, onCallStateChange]);

  const hangUpInternal = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setInCall(false);
    setCallDuration(0);
    setRemoteUsername(null);
    onCallStateChange?.(false);
    await signalingRef.current?.send({ type: 'call-end', payload: {} });

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
  }, [onCallStateChange]);

  const hangUp = useCallback(async () => {
    await hangUpInternal();
  }, [hangUpInternal]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setMuted((m) => !m);
    }
  }, []);

  return (
    <div className="relative">
      <audio ref={remoteAudioRef} autoPlay className="hidden" />

      {!inCall && (
        <Button
          variant="outline"
          size="icon"
          className="rounded-full h-10 w-10 shadow-lg bg-gradient-to-br from-green-500 to-emerald-600 text-white hover:brightness-110 border-none"
          onClick={startCall}
          title="Start free voice call"
        >
          <Phone className="h-4 w-4" />
        </Button>
      )}

      {inCall && (
        <div className="absolute top-0 right-0 bg-card/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl p-4 w-72 z-50 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-muted-foreground">Free Call</span>
            </div>
            <span className="text-xs font-mono">{Math.floor(callDuration / 60)}:{String(callDuration % 60).padStart(2, '0')}</span>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold shadow-lg">
              {remoteUsername ? remoteUsername.slice(0, 2).toUpperCase() : 'C'}
            </div>
            <div>
              <p className="font-semibold text-sm">{remoteUsername || 'Connecting...'}</p>
              <p className="text-xs text-muted-foreground">{connected ? 'Connected' : 'Connecting...'}</p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              className="flex-1 h-10 rounded-xl"
              onClick={toggleMute}
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Button
              variant="destructive"
              size="icon"
              className="flex-1 h-10 rounded-xl"
              onClick={hangUp}
              title="End call"
            >
              <PhoneOff className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
