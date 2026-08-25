import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';

function apiDevMiddlewarePlugin(): Plugin {
  return {
    name: 'api-dev-middleware',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/api/health' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
          return;
        }

        if (req.url === '/api/generate-rules' && req.method === 'POST') {
          let bodyStr = '';
          req.on('data', (chunk: any) => {
            bodyStr += chunk;
          });
          req.on('end', async () => {
            try {
              const body = JSON.parse(bodyStr || '{}');
              const { strategyText, columns, stats } = body;
              const apiKey = process.env.GEMINI_API_KEY;

              if (apiKey && strategyText) {
                try {
                  const { GoogleGenAI } = await import('@google/genai');
                  const ai = new GoogleGenAI({
                    apiKey,
                    httpOptions: {
                      headers: { 'User-Agent': 'aistudio-build' },
                    },
                  });

                  const allCols = Array.isArray(columns)
                    ? Array.from(new Set(['open', 'high', 'low', 'close', ...columns]))
                    : ['open', 'high', 'low', 'close'];

                  const statsLines = allCols
                    .map((c: string) => {
                      const s = stats?.[c];
                      if (s) {
                        return `- ${c}: min=${s.min?.toFixed(4) ?? 'n/d'}, max=${s.max?.toFixed(4) ?? 'n/d'}, media=${s.mean?.toFixed(4) ?? 'n/d'}`;
                      }
                      return `- ${c}`;
                    })
                    .join('\n');

                  const systemPrompt = `Sei un motore di trading quantitativo avanzato che traduce la descrizione in linguaggio naturale di una strategia di trading in una struttura JSON rigorosa, da eseguire automaticamente. Rispondi SOLO con JSON valido.
Schema atteso:
{
  "entry_long": ConditionNode | null,
  "entry_short": ConditionNode | null,
  "exit_long": ExitRuleNode | null,
  "exit_short": ExitRuleNode | null,
  "atr_column": string | null,
  "stop_loss": {"type":"atr_mult"|"fixed_points"|"prev_candle_extreme"|"before_signal_extreme"|"none", "mult"?:number, "value"?:number, "offset"?:number},
  "take_profits": [{"mult"?:number, "r_mult"?:number, "close_pct":number}],
  "after_tp1_sl": "original" | "breakeven" | {"type":"trail_atr_mult","mult":number},
  "trailing_stop": {"type":"trail_atr_mult","mult":number} | null,
  "timeout_bars": integer,
  "entry_timing": "next_open" | "same_close",
  "notes": "spiegazione in italiano"
}
Colonne disponibili:
${statsLines}`;

                  const candidateModels = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.7-flash', 'gemini-3.1-flash-lite'];
                  let parsed = null;

                  for (const modelName of candidateModels) {
                    try {
                      const response = await ai.models.generateContent({
                        model: modelName,
                        contents: `Traduci questa strategia in JSON:\n\n${strategyText}`,
                        config: {
                          systemInstruction: systemPrompt,
                          responseMimeType: 'application/json',
                        },
                      });

                      const clean = (response.text || '{}').trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
                      parsed = JSON.parse(clean);
                      if (parsed) break;
                    } catch (mErr: any) {
                      console.warn(`[Vite API Middleware] Gemini API error on model ${modelName}:`, mErr?.message || mErr);
                    }
                  }

                  if (parsed) {
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: true, rules: parsed, notes: parsed.notes }));
                    return;
                  }
                } catch (aiErr) {
                  console.warn('[Vite API Middleware] Gemini API error:', aiErr);
                }
              }

              // Return fallback signal
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                success: true,
                fallbackUsed: true,
                rules: null,
                notes: 'Fallback locale attivato.',
              }));
            } catch (err: any) {
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 400;
              res.end(JSON.stringify({ error: err?.message || 'Invalid JSON body' }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), apiDevMiddlewarePlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
