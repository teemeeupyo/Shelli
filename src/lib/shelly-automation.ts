export const automationService = {
  status: 'locked' as const,
  async execute(_actionId: string): Promise<never> {
    throw new Error('Automation is locked until a secure local companion can enforce approval and permissions.')
  },
}
