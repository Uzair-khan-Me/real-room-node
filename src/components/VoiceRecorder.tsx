import React, { useState, useRef, useCallback } from 'react';
import { Mic, Square, Play, Pause, Trash2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface VoiceRecorderProps {
  onAudioReady: (blob: Blob, durationMs: number) => void;
  disabled?: boolean;
  className?: string;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onAudioReady, disabled, className }) => {
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [timer, setTimer] = useState(0);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [visualizerData, setVisualizerData] = useState<number[]>([]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      setDuration(0);
      setTimer(0);
      setRecordedBlob(null);

      timerIntervalRef.current = setInterval(() => {
        setTimer((t) => t + 1);
        setDuration((d) => d + 1000);
      }, 1000);

      // Simple visualizer sampling via AudioContext
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const sampleInterval = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setVisualizerData((prev) => {
          const next = [...prev, avg];
          return next.length > 20 ? next.slice(-20) : next;
        });
      }, 100);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        clearInterval(sampleInterval);
        audioCtx.close().catch(() => {});
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setRecordedBlob(blob);
        setRecording(false);
        setVisualizerData([]);
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      };

      recorder.start();
      setRecording(true);
    } catch (err) {
      console.error('Microphone access denied:', err);
      alert('Microphone access is required for voice messages. Please allow microphone permissions.');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const discard = useCallback(() => {
    setRecordedBlob(null);
    setDuration(0);
    setTimer(0);
    setVisualizerData([]);
  }, []);

  const handleSend = useCallback(() => {
    if (recordedBlob) {
      onAudioReady(recordedBlob, duration);
      setRecordedBlob(null);
      setDuration(0);
      setTimer(0);
    }
  }, [recordedBlob, duration, onAudioReady]);

  const playRecord = useCallback(() => {
    if (!recordedBlob || !audioRef.current) return;
    const url = URL.createObjectURL(recordedBlob);
    audioRef.current.src = url;
    audioRef.current.play();
    setPlaying(true);
    audioRef.current.onended = () => setPlaying(false);
  }, [recordedBlob]);

  const pausePlay = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
    }
  }, []);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <audio ref={audioRef} className="hidden" />
      {!recordedBlob ? (
        <>
          <Button
            variant={recording ? 'destructive' : 'outline'}
            size="icon"
            className="rounded-full h-10 w-10 shadow-md"
            onClick={recording ? stopRecording : startRecording}
            disabled={disabled}
            title={recording ? 'Stop recording' : 'Record voice message'}
          >
            {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          {recording && (
            <div className="flex items-center gap-1 bg-red-50 dark:bg-red-950/30 px-2 py-1 rounded-full text-xs text-red-600 dark:text-red-300 font-medium">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              <span>{timer}s</span>
              {/* Visualizer bars */}
              <div className="flex items-end gap-[2px] h-3 ml-1">
                {visualizerData.map((h, i) => (
                  <span
                    key={i}
                    className="w-[2px] bg-red-500 rounded-full transition-all"
                    style={{ height: `${Math.max(2, Math.min(12, h / 8))}px` }}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2 bg-secondary/40 px-3 py-2 rounded-xl border border-border">
          <Button variant="ghost" size="icon" onClick={playing ? pausePlay : playRecord} className="h-8 w-8 rounded-full">
            {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 ml-0.5" />}
          </Button>
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground">Voice message</span>
            <span className="text-xs font-medium">{(duration / 1000).toFixed(1)}s</span>
          </div>
          <Button variant="ghost" size="icon" onClick={handleSend} className="h-8 w-8 text-green-600 hover:text-green-700" title="Send voice message">
            <Send className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" onClick={discard} className="h-8 w-8 text-destructive hover:text-destructive" title="Discard">
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
};
