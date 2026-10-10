export const voiceService = {
  status: 'unconnected' as const,
  async startListening(): Promise<never> {
    throw new Error('Voice input is not connected. Add a local speech-recognition service before enabling the microphone.')
  },
  async speak(_text: string): Promise<never> {
    throw new Error('Speech output is not connected. Add a local Piper service before enabling playback.')
  },
}
