/**
 * Optional large-language-model client used by the study assistant to phrase
 * answers from retrieved course passages. It is only enabled when
 * ANTHROPIC_API_KEY is set; otherwise the assistant runs in extractive mode.
 * The model never receives student records - only the question and the
 * passages already authorised for that course.
 */
import Anthropic from '@anthropic-ai/sdk';

export interface Passage { id: number; title: string; text: string }
export interface LlmClient { answer(question: string, passages: Passage[], lang: 'ar' | 'en'): Promise<string | null> }

const SYSTEM = `You are GAM3EY's study assistant inside one university course.
Answer only from the numbered course passages you are given. Cite every claim with its passage number in square brackets, like [2].
If the passages do not contain the answer, reply exactly: INSUFFICIENT_EVIDENCE
Keep answers short and clear for a university student. Never invent grades, deadlines or university rules.`;

export function createLlm(): LlmClient | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  const model = process.env.GAM3EY_MODEL || 'claude-opus-5-5';
  return {
    async answer(question, passages, lang) {
      const context = passages.map((p, i) => `[${i + 1}] (${p.title})\n${p.text}`).join('\n\n');
      try {
        const response: any = await (client.beta.messages.create as any)({
          model,
          max_tokens: 2000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low' },
          system: SYSTEM,
          messages: [{
            role: 'user',
            content: `Course passages:\n${context}\n\nStudent question (answer in ${lang === 'ar' ? 'Arabic' : 'English'}):\n${question}`,
          }],
        });
        if (response.stop_reason === 'refusal') return null;
        const text = (response.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
        if (!text || text.includes('INSUFFICIENT_EVIDENCE')) return null;
        return text;
      } catch (error) {
        if (error instanceof Anthropic.APIError) console.error(`LLM error ${error.status}: ${error.message}`);
        else console.error('LLM call failed', error);
        return null; // caller falls back to extractive answer
      }
    },
  };
}
