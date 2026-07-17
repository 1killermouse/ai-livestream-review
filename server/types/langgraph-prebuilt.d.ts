declare module '@langchain/langgraph/prebuilt' {
  interface ReactAgentInput {
    messages: Array<{
      role: 'user' | 'assistant';
      content: string;
    }>;
  }

  interface ReactAgentResult {
    messages: import('@langchain/core/messages').BaseMessage[];
  }

  interface ReactAgentOptions {
    llm: unknown;
    tools: unknown[];
    name?: string;
    version?: 'v1' | 'v2';
    prompt?: string;
  }

  export function createReactAgent(options: ReactAgentOptions): {
    invoke(
      input: ReactAgentInput,
      config?: { recursionLimit?: number },
    ): Promise<ReactAgentResult>;
  };
}
