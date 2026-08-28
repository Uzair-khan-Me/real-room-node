import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'call-start' | 'call-end';
  from: string;
  to?: string;
  payload: any;
  room: string;
}

export class VoiceSignaling {
  private client: SupabaseClient;
  private channel: any = null;
  private roomId: string;
  private userId: string;

  constructor(client: SupabaseClient, roomId: string, userId: string) {
    this.client = client;
    this.roomId = roomId;
    this.userId = userId;
  }

  async connect(
    onMessage: (msg: SignalingMessage) => void,
    onCallStart?: () => void,
    onCallEnd?: () => void
  ) {
    try {
      const chName = `voice-${this.roomId}`;
      this.channel = this.client.channel(chName, {
        config: { broadcast: { ack: true } },
      });

      this.channel
        .on('broadcast', { event: '*' }, (payload: any) => {
          if (payload.event !== 'voice-msg') return;
          const msg: SignalingMessage = payload.payload as any;
          if (msg.from === this.userId) return;
          if (msg.room !== this.roomId) return;
          if (msg.type === 'call-start') onCallStart?.();
          if (msg.type === 'call-end') onCallEnd?.();
          onMessage(msg);
        })
        .subscribe();
    } catch (e) {
      console.error('Voice signaling subscribe error:', e);
    }

    return () => {
      if (this.channel) {
        this.client.removeChannel(this.channel);
        this.channel = null;
      }
    };
  }

  async send(msg: Omit<SignalingMessage, 'from' | 'room'>) {
    if (!this.channel) return;
    await this.channel.send({
      type: 'broadcast',
      event: 'voice-msg',
      payload: {
        ...msg,
        from: this.userId,
        room: this.roomId,
      },
    });
  }

  disconnect() {
    if (this.channel) {
      this.client.removeChannel(this.channel);
      this.channel = null;
    }
  }
}
